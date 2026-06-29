/* Macro Map — recommendation engine.
 *
 * Given the user's remaining macros for the day and a set of available chains,
 * score every menu item by how well it fits. Pure functions, no DOM.
 */
window.MM = window.MM || {};

window.MM.recommend = (function () {

  /* Build the candidate pool: all items belonging to chains the user has
   * available (by chainId). If availableChainIds is null, use the whole DB. */
  function pool(availableChainIds) {
    var all = window.MM.allItems();
    if (!availableChainIds || !availableChainIds.length) return all;
    var set = {};
    availableChainIds.forEach(function (id) { set[id] = true; });
    return all.filter(function (it) { return set[it.chainId]; });
  }

  /* Score a single item against remaining macros + preferences.
   * remaining: { kcal, protein, carbs, fat }
   * opts: { maxKcal, minProtein, maxSodium, maxSugar, mealSize, prioritize }
   * Returns { score, reasons:[], proteinPerCal }
   */
  function scoreItem(item, remaining, opts) {
    opts = opts || {};
    var reasons = [];
    var score = 0;

    var proteinPerCal = item.kcal > 0 ? item.protein / item.kcal : 0;

    // Hard filters first — disqualify (return null) if violated.
    if (opts.maxKcal && item.kcal > opts.maxKcal) return null;
    if (opts.minProtein && item.protein < opts.minProtein) return null;
    if (opts.maxSodium && item.sodium > opts.maxSodium) return null;
    if (opts.maxSugar && item.sugar > opts.maxSugar) return null;

    // Meal-size band (calories) — soft preference.
    var band = { snack: [50, 350], regular: [350, 700], large: [700, 1300] }[opts.mealSize];

    // 1) Protein efficiency (protein per calorie) — central to most goals.
    var ppcScore = Math.min(proteinPerCal / 0.12, 1) * 40; // 0.12 g/kcal is excellent
    score += ppcScore;
    if (proteinPerCal >= 0.08) reasons.push("High protein per calorie");

    // 2) Fit within remaining calories for the day.
    if (remaining && remaining.kcal > 0) {
      if (item.kcal <= remaining.kcal) {
        // When >60% of the day's budget remains (early day), target ~33% of
        // remaining per meal so single-serving items beat bulk platters.
        // Late day (<40% left): keep 55% to favor heavier protein hits.
        var useFrac = item.kcal / remaining.kcal;
        var earlyDay = !opts.dayBudget || remaining.kcal / opts.dayBudget > 0.60;
        var sweetSpot = earlyDay ? 0.33 : 0.55;
        var calScore = (1 - Math.abs(useFrac - sweetSpot)) * 25;
        score += Math.max(calScore, 0);
        reasons.push("Fits remaining calories");
      } else {
        // Over budget — penalize proportionally to the overage.
        var over = (item.kcal - remaining.kcal) / remaining.kcal;
        score -= Math.min(over * 40, 45);
        reasons.push("Over remaining calories");
      }
    }

    // 3) Help close the remaining protein gap.
    if (remaining && remaining.protein > 0) {
      var covers = item.protein / remaining.protein;
      if (covers <= 1.5) {
        score += Math.min(covers, 1) * 20;
      } else {
        // Gently penalize extreme overshoot (e.g. 30-piece nuggets when only
        // 40g protein remains) — the item wastes more protein than needed.
        score += 20 - Math.min((covers - 1.5) * 6, 8);
      }
      if (covers >= 0.4) reasons.push("Covers a big chunk of protein left");
    }

    // 4) Respect remaining carb/fat budgets gently.
    if (remaining) {
      if (remaining.carbs >= 0 && item.carbs > remaining.carbs * 1.2) {
        score -= 6; reasons.push("Carb-heavy for what's left");
      }
      if (remaining.fat >= 0 && item.fat > remaining.fat * 1.2) {
        score -= 6; reasons.push("Fat-heavy for what's left");
      }
    }

    // 5) Meal-size preference.
    if (band) {
      if (item.kcal >= band[0] && item.kcal <= band[1]) { score += 8; }
      else { score -= 6; }
    }

    // 6) Explicit prioritization toggle.
    if (opts.prioritize === "protein") score += proteinPerCal * 60;
    if (opts.prioritize === "lowcal")  score += Math.max(0, (700 - item.kcal) / 700) * 18;
    if (opts.prioritize === "lowcarb") score += Math.max(0, (60 - item.carbs) / 60) * 14;
    if (opts.prioritize === "lowfat")  score += Math.max(0, (30 - item.fat) / 30) * 14;

    return { score: Math.round(score * 10) / 10, reasons: reasons, proteinPerCal: proteinPerCal };
  }

  /* Rank items. Returns array of { ...item, _score, _reasons, _ppc } sorted desc. */
  function rank(remaining, opts, availableChainIds, limit) {
    opts = opts || {};
    var candidates = pool(availableChainIds);

    // Cheap pre-filters — eliminate items before the scoring math runs.
    if (opts.categoryGroup) {
      candidates = candidates.filter(function (it) {
        return (it.category_group || "Other") === opts.categoryGroup;
      });
    }
    if (opts.maxKcal)    candidates = candidates.filter(function (it) { return it.kcal <= opts.maxKcal; });
    if (opts.minProtein) candidates = candidates.filter(function (it) { return it.protein >= opts.minProtein; });

    var uniqueChainCount = (function () {
      var s = {};
      candidates.forEach(function (it) { s[it.chainId] = true; });
      return Object.keys(s).length;
    })();

    var scored = [];
    candidates.forEach(function (item) {
      var r = scoreItem(item, remaining, opts);
      if (r === null) return;
      scored.push(Object.assign({}, item, {
        _score: r.score,
        _reasons: r.reasons,
        _ppc: r.proteinPerCal
      }));
    });
    scored.sort(function (a, b) { return b._score - a._score; });

    // Enforce per-chain variety when multiple chains are present.
    if (opts.chainVariety && uniqueChainCount > 1) {
      var chainCounts = {};
      scored = scored.filter(function (it) {
        chainCounts[it.chainId] = (chainCounts[it.chainId] || 0) + 1;
        return chainCounts[it.chainId] <= opts.chainVariety;
      });
    }

    return limit ? scored.slice(0, limit) : scored;
  }

  // Named presets the UI can offer as one-tap queries.
  var PRESETS = {
    high_protein_700: {
      label: "Best high-protein meal under 700 cal",
      opts: { maxKcal: 700, prioritize: "protein", mealSize: "regular" }
    },
    fits_remaining: {
      label: "Best fit for my remaining macros today",
      opts: { prioritize: "protein" } // uses remaining macros as the main signal
    },
    light_under_400: {
      label: "Light option under 400 cal",
      opts: { maxKcal: 400, prioritize: "lowcal", mealSize: "snack" }
    },
    low_carb: {
      label: "Lower-carb, high-protein pick",
      opts: { prioritize: "lowcarb", minProtein: 20 }
    },
    low_sodium: {
      label: "Lower-sodium option (≤ 700mg)",
      opts: { maxSodium: 700, prioritize: "protein" }
    }
  };

  /* Suggest same-chain entree + side meal combos that fit the calorie budget.
   * Only considers chains that have plate_config.category_roles defined,
   * since those explicitly map which categories are entrees vs sides.
   * Returns array of { chainName, entree, side, score } sorted by score desc. */
  function suggestCombos(remaining, chainIdFilter, categoryFilter, limit) {
    limit = limit || 5;
    var chains = window.MM.NUTRITION || [];
    var results = [];

    chains.forEach(function (chain) {
      if (chainIdFilter && chain.id !== chainIdFilter) return;

      var cfg = window.MM.getChainConfig ? window.MM.getChainConfig(chain) : null;
      var roles = cfg && cfg.category_roles;
      if (!roles || !roles.entree || !roles.side) return; // no role mapping — skip

      var entreeCats = roles.entree;
      var sideCats = roles.side;

      var entrees = chain.items.filter(function (it) {
        if (entreeCats.indexOf(it.category) === -1) return false;
        if (categoryFilter && it.category !== categoryFilter) return false;
        return true;
      }).map(function (it) {
        return Object.assign({ chainId: chain.id, chainName: chain.name }, it);
      });

      var sides = chain.items.filter(function (it) {
        if (sideCats.indexOf(it.category) === -1) return false;
        // Don't filter sides by categoryFilter — that's for entrees
        return true;
      }).map(function (it) {
        return Object.assign({ chainId: chain.id, chainName: chain.name }, it);
      });

      if (!entrees.length || !sides.length) return;

      var maxCal = remaining ? remaining.kcal : Infinity;
      var best = null, bestScore = -Infinity;

      entrees.forEach(function (en) {
        sides.forEach(function (si) {
          if (en.kcal + si.kcal > maxCal) return;
          var remAfterEntree = remaining ? {
            kcal: remaining.kcal - en.kcal,
            protein: remaining.protein - en.protein,
            carbs: remaining.carbs - en.carbs,
            fat: remaining.fat - en.fat
          } : null;
          var enScore = scoreItem(en, remaining, { prioritize: "protein" });
          var siScore = scoreItem(si, remAfterEntree, { prioritize: "protein" });
          if (!enScore || !siScore) return;
          var combined = enScore.score + siScore.score;
          if (combined > bestScore) {
            bestScore = combined;
            best = { chainName: chain.name, entree: en, side: si, score: combined };
          }
        });
      });

      if (best) results.push(best);
    });

    results.sort(function (a, b) { return b.score - a.score; });
    return results.slice(0, limit);
  }

  return {
    scoreItem: scoreItem,
    rank: rank,
    suggestCombos: suggestCombos,
    PRESETS: PRESETS
  };
})();
