/* Macro Map — application controller.
 *
 * Owns navigation between views, shared state (selected chain, nearby places,
 * the date being viewed), and the cross-cutting helpers used by every view:
 * daily totals, remaining macros, and logging an item. Each view has a render
 * function that rebuilds its persistent container on demand.
 */
window.MM = window.MM || {};

window.MM.app = (function () {
  var ui = window.MM.ui;
  var el = ui.el;

  var state = {
    view: "profile",
    selectedChainId: null,   // chain shown in Menu view (set by Discover; synced into filters)
    nearbyPlaces: [],        // last Overpass results
    viewDate: window.MM.store.todayKey(),
    compare: [],             // items selected for comparison in Menu view
    profileEditing: false    // whether the profile form is expanded for editing
  };

  // Persistent filter state for the Browse tab — survives tab switches and reloads.
  function lsGet(key, def) {
    var v = localStorage.getItem(key);
    if (v === null) return def;
    if (typeof def === "boolean") return v === "true";
    return v;
  }
  function lsGetJSON(key, def) {
    try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : def; } catch(e) { return def; }
  }

  var CATEGORY_GROUPS = {
    "Breakfast": ["Breakfast", "Bagels"],
    "Entrees":   ["Entrees", "Burgers", "Chicken", "Chicken Breast", "Chicken Dippers",
                  "Sandwiches", "Wraps", "Wraps & Tacos", "Bap", "Ciabatta", "Focaccia",
                  "Toasties/ Croques", "Beef", "Seafood", "Wings", "Wings - Per Wing"],
    "Salads":    ["Salads"],
    "Sides":     ["Sides", "Beans", "Greens", "Rice", "Salsas", "Tortillas", "Vegetables"],
    "Soups":     ["Soup", "Soups"],
    "Snacks":    ["Appetizers", "Grab N Go", "Impulse Items", "Value",
                  "Add-ons", "Modifiers", "Toppings", "Breads"],
    "Desserts":  ["Desserts", "Desserts & Snacks", "Cookies", "Sweets",
                  "Loaf Cakes", "Muffins & Donuts", "Bar cakes", "Bakery", "Treats"],
    "Drinks":    ["Beverages", "Drinks", "Cold Coffee", "Espresso Drinks", "Frappuccino",
                  "Hot Chocolates", "Hot Teas", "Tea Latte", "Protein Beverages",
                  "Refreshments", "Promo Beverages", "Promo Beverages Alt Coffees",
                  "Bottled Beverages", "Blonde and Decaf Cold Coffee",
                  "Blonde and Decaf Espresso Drinks", "Blonde and Decaf Frappuccino"]
  };
  // Build a reverse lookup: raw category → group name
  var _catGroupCache = null;
  function _buildCatGroupCache() {
    if (_catGroupCache) return _catGroupCache;
    _catGroupCache = {};
    Object.keys(CATEGORY_GROUPS).forEach(function (g) {
      CATEGORY_GROUPS[g].forEach(function (c) { _catGroupCache[c] = g; });
    });
    return _catGroupCache;
  }
  function getCategoryGroup(rawCat) {
    return _buildCatGroupCache()[rawCat] || "Other";
  }
  var filters = {
    recMode:    lsGet("mm_rec_mode",           false),
    category:   lsGet("mm_filter_category",    ""),
    chainIds:   lsGetJSON("mm_filter_chains",  []),
    search:     lsGet("mm_filter_search",      ""),
    sort:       lsGet("mm_filter_sort",        "ppc"),
    favorites:  lsGet("mm_filter_favorites",   false),
    fit:        lsGet("mm_filter_fit",         false),
    combosOpen: lsGet("mm_combos_open",        false)
  };
  function saveFilter(key, value) { localStorage.setItem(key, String(value)); }
  function saveChainIds() { localStorage.setItem("mm_filter_chains", JSON.stringify(filters.chainIds)); }

  // Set to an error string if loadNutrition() fails; null while loading or after success.
  var nutritionError = null;

  // PWA install state. The listeners are registered at module-eval time (below)
  // rather than inside start() — Chrome can fire `beforeinstallprompt` before
  // DOMContentLoaded, and a late listener would miss it.
  var deferredInstallPrompt = null;
  var installBtnRef = null;
  window.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault();
    deferredInstallPrompt = e;
    if (installBtnRef) installBtnRef.classList.remove("hidden");
  });
  window.addEventListener("appinstalled", function () {
    deferredInstallPrompt = null;
    if (installBtnRef) installBtnRef.classList.add("hidden");
    if (window.MM.ui) window.MM.ui.toast("Macro Map installed — find it on your home screen", "ok");
  });

  var VIEWS = [
    { id: "profile",   label: "Profile",   icon: "👤" },
    { id: "discover",  label: "Discover",  icon: "📍" },
    { id: "menu",      label: "Browse",    icon: "🍔" },
    { id: "tracker",   label: "Tracker",   icon: "📊" },
    { id: "requests",  label: "Add Data",  icon: "➕" }
  ];

  // Meal-bucket display metadata, ordered to match storage.MEAL_ORDER.
  var MEAL_META = {
    breakfast: { label: "Breakfast", emoji: "🍳" },
    lunch:     { label: "Lunch",     emoji: "🥗" },
    dinner:    { label: "Dinner",    emoji: "🍽️" },
    snack:     { label: "Snack",     emoji: "🍿" }
  };

  // Centralized favorite-toggle: works for any item shape (menu, log, rec).
  // Returns true if the item is now favorited, false if it was just removed.
  function toggleFavorite(item) {
    var existing = window.MM.store.findFavoriteId(item.name, item.chainId || (item.chain && item.chain.id) || null);
    if (existing) {
      window.MM.store.removeFavorite(existing);
      ui.toast("Removed from favorites");
      return false;
    }
    window.MM.store.addFavorite({
      name: item.name,
      chainId: item.chainId || (item.chain && item.chain.id) || null,
      chainName: item.chainName || (item.chain && item.chain.name) || null,
      kcal: item.kcal, protein: item.protein, carbs: item.carbs, fat: item.fat,
      sodium: item.sodium, fiber: item.fiber, sugar: item.sugar,
      custom: !!item.custom
    });
    ui.toast("⭐ Added to favorites", "ok");
    return true;
  }

  // Reusable star button — clicking it toggles favorite state and re-renders
  // the host. Caller passes a `rerender` callback so the icon reflects the new
  // state without a full view rebuild when possible.
  function starButton(item, rerender) {
    var on = window.MM.store.isFavorited(item.name, item.chainId || (item.chain && item.chain.id) || null);
    var btn = el("button", {
      class: "star-btn" + (on ? " on" : ""),
      title: on ? "Remove from favorites" : "Add to favorites",
      "aria-label": on ? "Remove from favorites" : "Add to favorites",
      onclick: function (ev) {
        ev.stopPropagation();
        toggleFavorite(item);
        if (rerender) rerender();
      }
    }, on ? "★" : "☆");
    return btn;
  }

  // Fitness-goal ordering by weight goal, so the most relevant focus is the
  // default (and listed first) instead of always "Fat loss / cutting".
  var FOCUS_PRIORITY = {
    lose:     ["fat_loss", "recomp", "general", "endurance", "muscle"],
    gain:     ["muscle", "recomp", "endurance", "general", "fat_loss"],
    maintain: ["recomp", "general", "endurance", "muscle", "fat_loss"]
  };
  function focusOptionsFor(goal) {
    var FOCUS = window.MM.macros.FOCUS;
    var order = FOCUS_PRIORITY[goal] || Object.keys(FOCUS);
    return order.filter(function (k) { return FOCUS[k]; })
      .map(function (k) { return { v: k, label: FOCUS[k].label }; });
  }

  /* ---------------------------------------------------------------- helpers */

  function totals(entries) {
    var t = { kcal: 0, protein: 0, carbs: 0, fat: 0, sodium: 0, fiber: 0, sugar: 0 };
    entries.forEach(function (e) {
      var q = e.qty || 1;
      t.kcal += (e.kcal || 0) * q;
      t.protein += (e.protein || 0) * q;
      t.carbs += (e.carbs || 0) * q;
      t.fat += (e.fat || 0) * q;
      t.sodium += (e.sodium || 0) * q;
      t.fiber += (e.fiber || 0) * q;
      t.sugar += (e.sugar || 0) * q;
    });
    return t;
  }

  // Remaining macros for the *current* day, vs saved targets.
  function remaining() {
    var tg = window.MM.store.getTargets();
    if (!tg) return null;
    var c = totals(window.MM.store.getLog(window.MM.store.todayKey()));
    return {
      kcal: tg.kcal - c.kcal,
      protein: tg.protein - c.protein,
      carbs: tg.carbs - c.carbs,
      fat: tg.fat - c.fat
    };
  }

  function availableChainIds() {
    var ids = {};
    state.nearbyPlaces.forEach(function (p) { if (p.hasData) ids[p.chain.id] = true; });
    return Object.keys(ids);
  }

  function addToLog(item, qty) {
    var entry = {
      name: item.name,
      chainId: item.chainId || (item.chain && item.chain.id) || null,
      chainName: item.chainName || (item.chain && item.chain.name) || "Custom",
      kcal: item.kcal, protein: item.protein, carbs: item.carbs, fat: item.fat,
      sodium: item.sodium || 0, fiber: item.fiber || 0, sugar: item.sugar || 0,
      qty: qty || 1
    };
    // Log to the day currently being viewed in the Tracker (defaults to today),
    // so you can backfill previous days too.
    window.MM.store.addLogEntry(entry, state.viewDate);
    var where = state.viewDate === window.MM.store.todayKey() ? "today's log" : prettyDate(state.viewDate);
    ui.toast("Added " + item.name + " to " + where, "ok");
    renderTracker();
    renderNavBadge();
  }

  /* ----------------------------------------------------------- navigation */

  function navigate(view) {
    // "recommend" was the old For You tab — redirect to Browse with rec mode on.
    if (view === "recommend") {
      filters.recMode = true;
      saveFilter("mm_rec_mode", true);
      view = "menu";
    }
    state.view = view;
    document.querySelectorAll(".view").forEach(function (v) { v.classList.add("hidden"); });
    var target = document.getElementById("view-" + view);
    if (target) target.classList.remove("hidden");
    document.querySelectorAll(".nav-item").forEach(function (n) {
      n.classList.toggle("active", n.getAttribute("data-view") === view);
    });
    // Sync Discover → Browse chain selection into persisted filter state.
    if (view === "menu" && state.selectedChainId) {
      filters.chainIds = [state.selectedChainId];
      saveChainIds();
      state.selectedChainId = null;
    }
    // per-view refresh on show
    if (view === "profile") renderProfile();
    if (view === "discover") { renderDiscover(); window.MM.map.invalidate(); }
    if (view === "menu") renderMenu();
    if (view === "onboarding") renderOnboarding();
    if (view === "tracker") renderTracker();
    if (view === "requests") renderRequests();
    if (view === "admin") renderAdmin();
    window.scrollTo(0, 0);
  }

  function renderNav() {
    var nav = document.getElementById("nav");
    ui.clear(nav);
    var views = VIEWS.slice();
    if (window.MM.data.isAdmin()) views.push({ id: "admin", label: "Admin", icon: "🛠️" });
    views.forEach(function (v) {
      nav.appendChild(el("button", {
        class: "nav-item" + (v.id === state.view ? " active" : ""), "data-view": v.id,
        onclick: function () { navigate(v.id); }
      }, [
        el("span", { class: "nav-icon" }, v.icon),
        el("span", { class: "nav-label" }, v.label)
      ]));
    });
    renderNavBadge();
  }

  function renderNavBadge() {
    // show remaining-cal badge on the Tracker nav item
    var item = document.querySelector('.nav-item[data-view="tracker"]');
    if (!item) return;
    var existing = item.querySelector(".nav-badge");
    if (existing) existing.remove();
    var rem = remaining();
    if (!rem) return;
    var b = el("span", { class: "nav-badge" + (rem.kcal < 0 ? " over" : "") }, ui.fmt(Math.abs(rem.kcal)));
    item.appendChild(b);
  }

  /* =====================================================================
   *  PROFILE VIEW
   * ===================================================================== */

  // Build the profile form element. opts: { submitLabel, cancelLabel, onCancel, onSubmit }
  function buildProfileForm(p, opts) {
    var m = window.MM.macros;
    var form = el("form", { class: "card form-grid", id: "profile-form" });

    var unitWrap = el("div", { class: "field span2" }, [
      el("label", null, "Units"),
      segmented("units", [
        { v: "imperial", label: "Imperial (lb / ft)" },
        { v: "metric", label: "Metric (kg / cm)" }
      ], p.units || "imperial", function () { rerenderMeasures(); })
    ]);
    form.appendChild(unitWrap);

    form.appendChild(field("Age", numInput("age", p.age, 13, 100)));
    form.appendChild(field("Sex", select("sex", [
      { v: "male", label: "Male" }, { v: "female", label: "Female" }
    ], p.sex)));

    var measures = el("div", { class: "span2 form-grid measures" });
    form.appendChild(measures);

    function rerenderMeasures() {
      ui.clear(measures);
      var units = form.querySelector('input[name="units"]:checked').value;
      if (units === "imperial") {
        var ft = Math.floor(m.cmToIn(p.heightCm) / 12);
        var inch = Math.round(m.cmToIn(p.heightCm) - ft * 12);
        measures.appendChild(el("div", { class: "field" }, [
          el("label", null, "Height"),
          el("div", { class: "inline" }, [
            numInput("heightFt", ft, 3, 8), el("span", { class: "unit" }, "ft"),
            numInput("heightIn", inch, 0, 11), el("span", { class: "unit" }, "in")
          ])
        ]));
        measures.appendChild(field("Weight",
          el("div", { class: "inline" }, [numInput("weightLb", Math.round(m.kgToLb(p.weightKg)), 50, 700), el("span", { class: "unit" }, "lb")])));
      } else {
        measures.appendChild(field("Height",
          el("div", { class: "inline" }, [numInput("heightCm", Math.round(p.heightCm), 100, 250), el("span", { class: "unit" }, "cm")])));
        measures.appendChild(field("Weight",
          el("div", { class: "inline" }, [numInput("weightKg", Math.round(p.weightKg), 30, 320), el("span", { class: "unit" }, "kg")])));
      }
    }
    rerenderMeasures();

    form.appendChild(field("Body fat % (optional)",
      el("div", { class: "inline" }, [
        numInput("bodyFatPct", p.bodyFatPct || "", 3, 60, ""),
        el("span", { class: "unit" }, "% · unlocks LBM-based protein & Katch-McArdle BMR")
      ])
    ));

    form.appendChild(field("Activity level", select("activity",
      Object.keys(m.ACTIVITY).map(function (k) { return { v: k, label: m.ACTIVITY[k].label }; }), p.activity), "span2"));

    form.appendChild(field("Weight goal", select("goal",
      Object.keys(m.GOALS).map(function (k) { return { v: k, label: m.GOALS[k].label }; }), p.goal,
      onGoalChange)));

    var rateOpts = Object.keys(m.RATES)
      .sort(function (a, b) { return parseFloat(a) - parseFloat(b); })
      .map(function (k) { return { v: k, label: m.RATES[k].label }; });
    var rateField = field("Rate of progress", select("rate", rateOpts, p.rate));
    form.appendChild(rateField);

    var focusSelect = select("focus", focusOptionsFor(p.goal), p.focus);
    form.appendChild(field("Fitness goal", focusSelect, "span2"));

    function updateRateVisibility() {
      var goal = form.querySelector('select[name="goal"]').value;
      rateField.style.display = goal === "maintain" ? "none" : "";
    }
    function onGoalChange() {
      updateRateVisibility();
      var goalopts = focusOptionsFor(form.querySelector('select[name="goal"]').value);
      ui.clear(focusSelect);
      goalopts.forEach(function (o) { focusSelect.appendChild(el("option", { value: o.v }, o.label)); });
      focusSelect.value = goalopts[0].v;
    }
    updateRateVisibility();

    if (!opts.noActions) {
      var actions = el("div", { class: "span2 form-actions" }, [
        el("button", { class: "btn primary", type: "submit" }, opts.submitLabel)
      ]);
      if (opts.cancelLabel) {
        actions.appendChild(el("button", { class: "btn ghost", type: "button",
          onclick: opts.onCancel }, opts.cancelLabel));
      }
      form.appendChild(actions);
    }

    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      opts.onSubmit(readProfileForm(form));
    });

    return form;
  }

  function renderProfile() {
    var root = document.getElementById("view-profile");
    ui.clear(root);
    var m = window.MM.macros;
    var saved = window.MM.store.getProfile();
    var savedTargets = window.MM.store.getTargets();

    if (saved && savedTargets && !state.profileEditing) {
      root.appendChild(header("Your nutrition profile",
        "Your targets are set. Edit anytime as your weight or goals change."));
      root.appendChild(targetsCard(savedTargets, saved));
      root.appendChild(profileSummaryCard(saved));
      return;
    }

    var p = saved || {
      age: 30, sex: "male", heightCm: 178, weightKg: m.lbToKg(175),
      units: "imperial", activity: "moderate", goal: "lose", rate: "0.5", focus: "fat_loss"
    };

    root.appendChild(header("Your nutrition profile",
      "Tell us about you and we'll estimate daily calories and macros. Saved automatically and reused next time."));

    root.appendChild(buildProfileForm(p, {
      submitLabel: saved ? "Save changes" : "Calculate my targets",
      cancelLabel: saved ? "Cancel" : null,
      onCancel: function () { state.profileEditing = false; renderProfile(); },
      onSubmit: function (prof) {
        window.MM.store.setProfile(prof);
        window.MM.store.setTargets(m.compute(prof));
        state.profileEditing = false;
        ui.toast("Targets saved to your profile", "ok");
        renderProfile();
        renderNavBadge();
      }
    }));
  }

  function readProfileForm(form) {
    var m = window.MM.macros;
    var units = form.querySelector('input[name="units"]:checked').value;
    var heightCm, weightKg;
    if (units === "imperial") {
      var ft = parseFloat(form.querySelector('[name="heightFt"]').value) || 0;
      var inch = parseFloat(form.querySelector('[name="heightIn"]').value) || 0;
      heightCm = m.inToCm(ft * 12 + inch);
      weightKg = m.lbToKg(parseFloat(form.querySelector('[name="weightLb"]').value) || 0);
    } else {
      heightCm = parseFloat(form.querySelector('[name="heightCm"]').value) || 0;
      weightKg = parseFloat(form.querySelector('[name="weightKg"]').value) || 0;
    }
    var bfRaw = parseFloat(form.querySelector('[name="bodyFatPct"]').value);
    var bodyFatPct = (!isNaN(bfRaw) && bfRaw > 0 && bfRaw < 100) ? bfRaw : null;
    return {
      age: parseInt(form.querySelector('[name="age"]').value, 10) || 30,
      sex: form.querySelector('[name="sex"]').value,
      heightCm: heightCm,
      weightKg: weightKg,
      units: units,
      activity: form.querySelector('[name="activity"]').value,
      goal: form.querySelector('[name="goal"]').value,
      rate: form.querySelector('[name="rate"]').value,
      focus: form.querySelector('[name="focus"]').value,
      bodyFatPct: bodyFatPct
    };
  }

  function targetsCard(t, p) {
    var card = el("div", { class: "card targets-card" });
    card.appendChild(el("div", { class: "targets-head" }, [
      el("h3", null, "Your daily targets"),
      t.manual ? ui.badge("Manually adjusted", "muted") : ui.badge("Calculated", "ok")
    ]));

    if (p) {
      card.appendChild(el("p", { class: "muted small" },
        "Based on BMR " + ui.fmt(t.bmr || 0) + " · maintenance ≈ " + ui.fmt(t.tdee || 0) + " cal/day" +
        (p.bodyFatPct ? " · LBM " + Math.round(p.weightKg * (1 - p.bodyFatPct / 100) * 10) / 10 + " kg" : "") + "."));
    }

    var grid = el("div", { class: "target-grid" }, [
      bigStat(ui.fmt(t.kcal), "calories", "cal"),
      bigStat(ui.fmt(t.protein) + "g", "protein", "p"),
      bigStat(ui.fmt(t.carbs) + "g", "carbs", "c"),
      bigStat(ui.fmt(t.fat) + "g", "fat", "f")
    ]);
    card.appendChild(grid);

    if (p && !t.manual) {
      var expCollapsed = true;
      var expChevron = el("span", { class: "collapsible-chevron" }, "▶");
      var expHead = el("div", { class: "calc-explain-head collapsible-head" }, [expChevron, "How were these calculated?"]);
      var expBody = el("div", { class: "collapsible-body collapsed" });
      expBody.appendChild(buildCalcExplain(t, p));
      expHead.addEventListener("click", function () {
        expCollapsed = !expCollapsed;
        expChevron.textContent = expCollapsed ? "▶" : "▼";
        expBody.classList.toggle("collapsed", expCollapsed);
      });
      card.appendChild(expHead);
      card.appendChild(expBody);
    } else if (p && t.manual) {
      var expCollapsed2 = true;
      var expChevron2 = el("span", { class: "collapsible-chevron" }, "▶");
      var expHead2 = el("div", { class: "calc-explain-head collapsible-head" }, [expChevron2, "Original calculation (manually adjusted)"]);
      var expBody2 = el("div", { class: "collapsible-body collapsed" });
      expBody2.appendChild(buildCalcExplain(t, p));
      expHead2.addEventListener("click", function () {
        expCollapsed2 = !expCollapsed2;
        expChevron2.textContent = expCollapsed2 ? "▶" : "▼";
        expBody2.classList.toggle("collapsed", expCollapsed2);
      });
      card.appendChild(expHead2);
      card.appendChild(expBody2);
    }

    card.appendChild(el("div", { class: "form-actions" }, [
      el("button", { class: "btn", onclick: function () { openManualAdjust(t); } }, "Adjust manually"),
      el("button", { class: "btn ghost", onclick: function () {
        window.MM.app.navigate("discover");
      } }, "Find food nearby →")
    ]));
    return card;
  }

  function profileSummaryCard(p) {
    var m = window.MM.macros;
    var ht, wt;
    if (p.units === "metric") {
      ht = Math.round(p.heightCm) + " cm";
      wt = Math.round(p.weightKg) + " kg";
    } else {
      var ti = m.cmToIn(p.heightCm), ft = Math.floor(ti / 12);
      ht = ft + "'" + Math.round(ti - ft * 12) + "\"";
      wt = Math.round(m.kgToLb(p.weightKg)) + " lb";
    }
    function lbl(map, k) { return map[k] ? map[k].label : k; }
    var pairs = [
      ["Age", p.age], ["Sex", p.sex === "female" ? "Female" : "Male"],
      ["Height", ht], ["Weight", wt],
      ["Activity", lbl(m.ACTIVITY, p.activity)],
      ["Weight goal", lbl(m.GOALS, p.goal)],
      ["Fitness goal", lbl(m.FOCUS, p.focus)]
    ];
    if (p.goal !== "maintain") pairs.splice(6, 0, ["Rate", lbl(m.RATES, p.rate)]);
    if (p.bodyFatPct) {
      var lbmKg = p.weightKg * (1 - p.bodyFatPct / 100);
      var lbmStr = p.units === "metric"
        ? (Math.round(lbmKg * 10) / 10) + " kg"
        : Math.round(m.kgToLb(lbmKg)) + " lb";
      pairs.splice(4, 0, ["Body fat", p.bodyFatPct + "%"], ["Lean mass", lbmStr]);
    }

    var card = el("div", { class: "card" });
    card.appendChild(el("div", { class: "targets-head" }, [
      el("h3", null, "Profile"),
      el("button", { class: "btn small", onclick: function () { state.profileEditing = true; renderProfile(); } }, "Edit profile")
    ]));
    card.appendChild(el("div", { class: "summary-grid" }, pairs.map(function (kv) {
      return el("div", { class: "summary-item" }, [
        el("div", { class: "summary-key" }, kv[0]),
        el("div", { class: "summary-val" }, String(kv[1]))
      ]);
    })));
    return card;
  }

  function openManualAdjust(t) {
    var body = el("div", { class: "form-grid" }, [
      field("Calories", numInput("mKcal", t.kcal, 800, 6000)),
      field("Protein (g)", numInput("mP", t.protein, 0, 500)),
      field("Carbs (g)", numInput("mC", t.carbs, 0, 800)),
      field("Fat (g)", numInput("mF", t.fat, 0, 400))
    ]);
    ui.modal("Adjust targets manually", body, [
      { label: "Cancel", kind: "ghost" },
      { label: "Save", kind: "primary", onClick: function () {
        var nt = {
          kcal: parseInt(body.querySelector('[name="mKcal"]').value, 10),
          protein: parseInt(body.querySelector('[name="mP"]').value, 10),
          carbs: parseInt(body.querySelector('[name="mC"]').value, 10),
          fat: parseInt(body.querySelector('[name="mF"]').value, 10),
          bmr: t.bmr, tdee: t.tdee, manual: true
        };
        window.MM.store.setTargets(nt);
        ui.toast("Targets updated", "ok");
        renderProfile(); renderNavBadge();
      } }
    ]);
  }

  /* =====================================================================
   *  DISCOVER VIEW (map)
   * ===================================================================== */

  var mapReady = false;
  var discoverSetMode = null; // set in renderDiscover; lets runSearch auto-switch to the list on mobile
  var discoverFilters = { withDataOnly: false, fitsOnly: false };
  function renderDiscover() {
    var root = document.getElementById("view-discover");
    if (root.getAttribute("data-built") === "1") {
      // already built; just ensure map sized & list current
      window.MM.map.invalidate();
      return;
    }
    root.setAttribute("data-built", "1");
    ui.clear(root);

    root.appendChild(header("Find food near you",
      "Use your location or search a city/address. We'll map nearby restaurants and flag which ones have macro data."));

    var controls = el("div", { class: "card discover-controls" }, [
      el("div", { class: "discover-row" }, [
        el("button", { class: "btn primary", id: "btn-locate" }, "📍 Use my location"),
        el("input", { class: "input grow", id: "addr-input", placeholder: "or search a city or address…", type: "text" }),
        el("button", { class: "btn", id: "btn-geocode" }, "Search"),
        select("radius", [
          { v: "1600", label: "1 mi" },
          { v: "2400", label: "1.5 mi" },
          { v: "4000", label: "2.5 mi" },
          { v: "8000", label: "5 mi" },
          { v: "16093", label: "10 mi" },
          { v: "40234", label: "25 mi" }
        ], "2400")
      ])
    ]);
    root.appendChild(controls);

    // Discover filters — wired to re-render place list without re-querying the network.
    var cbData = el("input", { type: "checkbox", id: "filter-data" });
    if (discoverFilters.withDataOnly) cbData.setAttribute("checked", "checked");
    var cbFits = el("input", { type: "checkbox", id: "filter-fits" });
    if (discoverFilters.fitsOnly) cbFits.setAttribute("checked", "checked");
    var filterRow = el("div", { class: "discover-filters" }, [
      el("label", { class: "check tiny" }, [cbData, el("span", null, "Only places with data")]),
      el("label", { class: "check tiny" }, [cbFits, el("span", null, "Only where something fits my macros")])
    ]);
    cbData.addEventListener("change", function () {
      discoverFilters.withDataOnly = cbData.checked;
      if (state.nearbyPlaces.length) renderPlaceList(state.nearbyPlaces);
    });
    cbFits.addEventListener("change", function () {
      discoverFilters.fitsOnly = cbFits.checked;
      if (state.nearbyPlaces.length) renderPlaceList(state.nearbyPlaces);
    });
    controls.appendChild(filterRow);

    // Mobile-only Map/List toggle (hidden on desktop via CSS, where both show).
    var viewToggle = el("div", { class: "map-toggle" }, [
      el("button", { class: "mt-btn active", type: "button", "data-mt": "map" }, "🗺 Map"),
      el("button", { class: "mt-btn", type: "button", "data-mt": "list" }, "📋 List")
    ]);
    root.appendChild(viewToggle);

    var layout = el("div", { class: "discover-layout" }, [
      el("div", { id: "map", class: "map" }),
      el("div", { id: "place-list", class: "place-list" }, [emptyHint("Search to see nearby places.")])
    ]);
    root.appendChild(layout);

    discoverSetMode = function (mode) {
      layout.classList.toggle("show-list", mode === "list");
      viewToggle.querySelectorAll(".mt-btn").forEach(function (b) {
        b.classList.toggle("active", b.getAttribute("data-mt") === mode);
      });
      if (mode === "map") window.MM.map.invalidate();
    };
    viewToggle.querySelectorAll(".mt-btn").forEach(function (b) {
      b.addEventListener("click", function () { discoverSetMode(b.getAttribute("data-mt")); });
    });

    if (!mapReady) { window.MM.map.init("map"); mapReady = true; }

    var last = window.MM.store.getLastLocation();
    if (last) {
      window.MM.map.setView(last.lat, last.lng, last.label);
      runSearch(last.lat, last.lng, last.label);
    }

    controls.querySelector("#btn-locate").addEventListener("click", function () {
      ui.toast("Locating…");
      window.MM.map.locateUser().then(function (pos) {
        window.MM.map.setView(pos.lat, pos.lng, "Your location");
        runSearch(pos.lat, pos.lng, "Your location");
      }).catch(function (e) { ui.toast(e.message, "err"); });
    });
    function doGeocode() {
      var q = controls.querySelector("#addr-input").value.trim();
      if (!q) { ui.toast("Type a city or address first", "err"); return; }
      ui.toast("Searching…");
      window.MM.map.geocode(q).then(function (loc) {
        window.MM.map.setView(loc.lat, loc.lng, loc.label);
        runSearch(loc.lat, loc.lng, loc.label);
      }).catch(function (e) { ui.toast(e.message, "err"); });
    }
    controls.querySelector("#btn-geocode").addEventListener("click", doGeocode);
    controls.querySelector("#addr-input").addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); doGeocode(); }
    });
    window.MM.map.invalidate();
  }

  var searchInFlight = false;

  function runSearch(lat, lng, label) {
    if (searchInFlight) return; // drop concurrent requests — prevents double-firing 429s
    searchInFlight = true;

    // Disable the locate button for the duration of the search
    var locateBtn = document.getElementById("btn-locate");
    if (locateBtn) { locateBtn.disabled = true; locateBtn.textContent = "Searching…"; }

    var radius = parseInt(document.querySelector('#view-discover [name="radius"]').value, 10) || 2400;
    var listEl = document.getElementById("place-list");
    ui.clear(listEl);
    listEl.appendChild(emptyHint("Searching nearby restaurants…"));
    window.MM.map.searchNearby(lat, lng, radius).then(function (places) {
      state.nearbyPlaces = places;
      window.MM.map.renderPlaces(places, radius, function (place) {
        state.selectedChainId = place.chain.id;
        navigate("menu");
      });
      renderPlaceList(places);
      renderNavBadge();
    }).catch(function (e) {
      ui.clear(listEl);
      listEl.appendChild(emptyHint("Couldn't load nearby places: " + e.message));
    }).then(function () {
      searchInFlight = false;
      if (locateBtn) { locateBtn.disabled = false; locateBtn.textContent = "📍 Use my location"; }
    });
  }

  function renderPlaceList(places) {
    var listEl = document.getElementById("place-list");
    ui.clear(listEl);
    // Apply active discover filters before splitting into sections.
    var filtered = places;
    if (discoverFilters.withDataOnly || discoverFilters.fitsOnly) {
      filtered = places.filter(function (p) {
        if (discoverFilters.withDataOnly && !p.hasData) return false;
        if (discoverFilters.fitsOnly) {
          var rem = remaining();
          if (!rem || !p.hasData) return false;
          var chain = window.MM.getChainById(p.chain.id);
          return chain && chain.items.some(function (it) { return it.kcal <= rem.kcal; });
        }
        return true;
      });
    }
    var isFiltered = filtered.length !== places.length;
    var withData = filtered.filter(function (p) { return p.hasData; });
    var without = filtered.filter(function (p) { return !p.hasData; });

    listEl.appendChild(el("div", { class: "list-head" }, [
      el("strong", null, filtered.length + " places" + (isFiltered ? " (filtered)" : " nearby")),
      el("span", { class: "muted small" }, withData.length + " with macro data")
    ]));

    // On mobile, surface results immediately by flipping to the List view.
    if (discoverSetMode && window.matchMedia("(max-width: 640px)").matches) discoverSetMode("list");

    if (!filtered.length) {
      listEl.appendChild(emptyHint(isFiltered
        ? "No places match the active filters. Try unchecking a filter."
        : "No restaurants found in this area. Try a larger radius."));
      return;
    }

    withData.forEach(function (p) { listEl.appendChild(placeRow(p)); });
    if (without.length) {
      // De-dupe by name (keeping the nearest occurrence, since places are sorted
      // by distance) so every distinct missing chain shows — no arbitrary cap.
      var seen = {};
      var uniqueWithout = without.filter(function (p) {
        var key = (p.name || "").trim().toLowerCase();
        if (seen[key]) return false;
        seen[key] = true;
        return true;
      });
      listEl.appendChild(el("div", { class: "list-subhead" }, "No data yet — help us add them (" + uniqueWithout.length + ")"));
      uniqueWithout.forEach(function (p) { listEl.appendChild(placeRow(p)); });
    }
  }

  function placeRow(p) {
    var miles = window.MM.map.metresToMiles(p.distance).toFixed(1);
    var dot = el("span", { class: "place-dot", style: "background:" + (p.hasData ? (p.chain.color || "#16a34a") : "#cbd5e1") });
    var meta = el("div", { class: "place-meta" }, [
      el("div", { class: "place-name" }, p.name),
      el("div", { class: "muted small" }, (p.amenity || "food") + " · " + miles + " mi")
    ]);
    var action = p.hasData
      ? el("button", { class: "btn small", onclick: function () { state.selectedChainId = p.chain.id; navigate("menu"); } }, "Menu")
      : el("button", { class: "btn small ghost", onclick: function () { quickRequest(p); } }, "Request");
    return el("div", { class: "place-row" }, [dot, meta, action]);
  }

  function quickRequest(place) {
    window.MM.data.submitRequest({
      chain: place.name, note: "Requested from Discover (no data found nearby)",
      lat: place.lat, lng: place.lng
    }).then(function () {
      ui.toast("Requested macro data for " + place.name, "ok");
      if (state.view === "requests") renderRequests();
    }).catch(function (e) { ui.toast(e.message, "err"); });
  }

  /* =====================================================================
   *  MENU VIEW
   * ===================================================================== */

  function renderMenu() {
    var root = document.getElementById("view-menu");
    var savedY = window.scrollY;
    ui.clear(root);

    if (!window.MM.NUTRITION || !window.MM.NUTRITION.length) {
      root.appendChild(header("Browse", "Find and compare restaurant menu items."));
      root.appendChild(noticeCard(
        nutritionError ? "Couldn't load restaurant data" : "Loading restaurant data…",
        nutritionError || "Fetching menus from the database — this only takes a moment.",
        nutritionError ? "Reload" : null,
        nutritionError ? function () { location.reload(); } : null
      ));
      return;
    }

    var chains = window.MM.NUTRITION;
    var nearbyIds = availableChainIds();
    var tg = window.MM.store.getTargets();
    var rem = remaining();


    root.appendChild(header("Browse",
      filters.recMode
        ? "Picks ranked by how well they fit your remaining macros today."
        : "Compare items by macros. Add anything straight to your log.",
      helpBtn(filters.recMode ? "How recommendations work" : "Reading the menu",
              filters.recMode ? recommendHelp() : menuHelp())));

    // 1. Remaining macros strip (always, when targets set)
    if (tg) root.appendChild(remainingStrip(rem));

    // 2. Recommendations toggle
    root.appendChild(buildToggleRow());

    // 3. Shared filters
    root.appendChild(buildSharedFilters(chains));

    // 4. Mode content
    if (filters.recMode) {
      renderRecModeContent(root, chains, nearbyIds, rem, tg);
    } else {
      renderBrowseModeContent(root, chains, nearbyIds, rem);
    }

    window.scrollTo(0, savedY);
  }

  function buildToggleRow() {
    var cb = el("input", { type: "checkbox", id: "rec-mode-cb", class: "toggle-input" });
    if (filters.recMode) cb.setAttribute("checked", "checked");
    cb.addEventListener("change", function () {
      filters.recMode = cb.checked;
      saveFilter("mm_rec_mode", cb.checked);
      renderMenu();
    });
    return el("div", { class: "card rec-toggle-row" }, [
      el("span", { class: "toggle-side-label" + (!filters.recMode ? " toggle-side-active" : " toggle-side-muted") },
        "All Menu Items"),
      el("label", { class: "toggle-switch", for: "rec-mode-cb" }, [cb,
        el("span", { class: "toggle-track" }, [el("span", { class: "toggle-thumb" })])
      ]),
      el("span", { class: "toggle-side-label" + (filters.recMode ? " toggle-side-active" : " toggle-side-muted") },
        "Recommendations")
    ]);
  }

  function buildSharedFilters(chains) {
    var wrap = el("div", { class: "card shared-filters" });

    // ── 1. Chain multi-select ─────────────────────────────────────────────
    var chainChips = el("div", { class: "filter-chips" });
    chains.forEach(function (c) {
      var on = filters.chainIds.indexOf(c.id) !== -1;
      chainChips.appendChild(el("button", {
        class: "chip" + (on ? " active" : ""),
        onclick: function () {
          var idx = filters.chainIds.indexOf(c.id);
          if (idx === -1) filters.chainIds.push(c.id);
          else filters.chainIds.splice(idx, 1);
          // Changing chains may invalidate the current category; reset if needed
          var validCats = getCatsForChains(filters.chainIds, chains);
          if (filters.category && validCats.indexOf(filters.category) === -1) {
            filters.category = "";
            saveFilter("mm_filter_category", "");
          }
          saveChainIds();
          renderMenu();
        }
      }, c.name));
    });
    wrap.appendChild(el("div", { class: "filter-group" }, [
      el("div", { class: "filter-group-label" }, "Restaurants" + (filters.chainIds.length ? "" : " (all)")),
      chainChips
    ]));

    // ── 2. Category dropdown ─────────────────────────────────────────────
    var availCats = getCatsForChains(filters.chainIds, chains);
    // If the persisted category is no longer valid for selected chains, clear it
    if (filters.category && availCats.indexOf(filters.category) === -1) {
      filters.category = "";
      saveFilter("mm_filter_category", "");
    }
    var catOptions = [{ v: "", label: "All categories" }].concat(
      availCats.map(function (c) { return { v: c, label: c }; })
    );
    var catSel = select("category", catOptions, filters.category, function (e) {
      filters.category = e.target.value;
      saveFilter("mm_filter_category", filters.category);
      renderMenu();
    });
    wrap.appendChild(el("div", { class: "filter-group" }, [
      el("div", { class: "filter-group-label" }, "Category"),
      catSel
    ]));

    // ── 3. Favorites chip ────────────────────────────────────────────────
    wrap.appendChild(el("button", {
      class: "chip fav-chip" + (filters.favorites ? " active" : ""),
      onclick: function () { filters.favorites = !filters.favorites; saveFilter("mm_filter_favorites", filters.favorites); renderMenu(); }
    }, "⭐ Favorites only"));

    // ── 4. Active filter bar ─────────────────────────────────────────────
    var activeLabels = [];
    if (filters.chainIds.length) activeLabels = activeLabels.concat(
      filters.chainIds.map(function (id) {
        var c = chains.find(function (ch) { return ch.id === id; });
        return c ? c.name : id;
      })
    );
    if (filters.category) activeLabels.push(filters.category);
    if (filters.favorites) activeLabels.push("⭐");
    if (!filters.recMode && filters.search) activeLabels.push('"' + filters.search + '"');
    if (!filters.recMode && filters.fit) activeLabels.push("Fit only");

    if (activeLabels.length) {
      wrap.appendChild(el("div", { class: "active-filters-bar" }, [
        el("span", { class: "muted small" }, "Filtered: " + activeLabels.join(" · ")),
        el("button", { class: "link-btn small", onclick: clearAllFilters }, "× Clear all")
      ]));
    }

    return wrap;
  }

  // Major category groups present in the items of the given chainIds (or all chains if empty).
  function getCatsForChains(chainIds, chains) {
    var pool = chainIds.length
      ? chains.filter(function (c) { return chainIds.indexOf(c.id) !== -1; })
      : chains;
    var seen = {};
    pool.forEach(function (c) {
      (c.items || []).forEach(function (it) {
        if (it.category) seen[getCategoryGroup(it.category)] = true;
      });
    });
    // Return in a fixed display order
    return ["Breakfast","Entrees","Salads","Sides","Soups","Snacks","Desserts","Drinks","Other"]
      .filter(function (g) { return seen[g]; });
  }

  function clearAllFilters() {
    filters.chainIds = []; filters.category = ""; filters.search = "";
    filters.favorites = false; filters.fit = false;
    localStorage.setItem("mm_filter_chains", "[]");
    ["mm_filter_category", "mm_filter_search"].forEach(function (k) { localStorage.setItem(k, ""); });
    localStorage.setItem("mm_filter_favorites", "false");
    localStorage.setItem("mm_filter_fit", "false");
    renderMenu();
  }

  function applySharedItemFilters(items) {
    if (filters.chainIds && filters.chainIds.length) {
      var chainSet = {};
      filters.chainIds.forEach(function (id) { chainSet[id] = true; });
      items = items.filter(function (it) { return chainSet[it.chainId]; });
    }
    if (filters.category) items = items.filter(function (it) { return getCategoryGroup(it.category) === filters.category; });
    if (filters.favorites) {
      var favMap = {};
      window.MM.store.getFavorites().forEach(function (f) { favMap[f.name] = true; });
      items = items.filter(function (it) { return favMap[it.name]; });
    }
    return items;
  }

  // Shared search card: collapsible section containing quick pick presets + custom criteria.
  // onSearch(opts) is called when a preset is clicked or "Find matches" is hit.
  function buildSearchCard(onSearch) {
    var card = el("div", { class: "card" });

    // Collapsible section (collapsed by default) containing quick picks + criteria form
    var csCollapsed = true;
    var csChevron = el("span", { class: "collapsible-chevron" }, "▶");
    var csHead = el("div", { class: "section-label collapsible-head" },
      [csChevron, "Search & filter"]);
    var csBody = el("div", { class: "collapsible-body collapsed" });

    // Quick picks inside the collapsible
    var presetWrap = el("div", { class: "preset-wrap", style: "margin-bottom:12px" });
    Object.keys(window.MM.recommend.PRESETS).forEach(function (key) {
      var preset = window.MM.recommend.PRESETS[key];
      presetWrap.appendChild(el("button", {
        class: "preset", onclick: function () { onSearch(preset.opts); }
      }, preset.label));
    });
    csBody.appendChild(presetWrap);

    var criteriaGrid = el("div", { class: "form-grid" });
    criteriaGrid.appendChild(field("Max calories", numInput("c_maxKcal", "", 0, 3000)));
    criteriaGrid.appendChild(field("Min protein (g)", numInput("c_minProtein", "", 0, 200)));
    criteriaGrid.appendChild(field("Max sodium (mg)", numInput("c_maxSodium", "", 0, 4000)));
    criteriaGrid.appendChild(field("Max sugar (g)", numInput("c_maxSugar", "", 0, 200)));
    criteriaGrid.appendChild(field("Meal size", select("c_mealSize", [
      { v: "", label: "Any" }, { v: "snack", label: "Snack" }, { v: "regular", label: "Regular" }, { v: "large", label: "Large" }
    ], "")));
    criteriaGrid.appendChild(field("Prioritize", select("c_prioritize", [
      { v: "protein", label: "Protein efficiency" }, { v: "lowcal", label: "Low calorie" },
      { v: "lowcarb", label: "Low carb" }, { v: "lowfat", label: "Low fat" }
    ], "protein")));
    criteriaGrid.appendChild(el("div", { class: "span2 form-actions" }, [
      el("button", { class: "btn primary", onclick: function () {
        onSearch({
          maxKcal: numOrNull(card, "c_maxKcal"), minProtein: numOrNull(card, "c_minProtein"),
          maxSodium: numOrNull(card, "c_maxSodium"), maxSugar: numOrNull(card, "c_maxSugar"),
          mealSize: card.querySelector('[name="c_mealSize"]').value || null,
          prioritize: card.querySelector('[name="c_prioritize"]').value
        });
      }}, "Find matches")
    ]));
    csBody.appendChild(criteriaGrid);
    csHead.addEventListener("click", function () {
      csCollapsed = !csCollapsed;
      csChevron.textContent = csCollapsed ? "▶" : "▼";
      csBody.classList.toggle("collapsed", csCollapsed);
    });
    card.appendChild(csHead);
    card.appendChild(csBody);
    return card;
  }

  function renderBrowseModeContent(root, chains, nearbyIds, rem) {
    var activeOpts = { prioritize: filters.sort || "ppc" };
    root.appendChild(buildSearchCard(function (opts) { activeOpts = opts; draw(); }));

    var listWrap = el("div", { id: "menu-list", class: "card-list" });
    root.appendChild(listWrap);
    var compareBar = el("div", { id: "compare-bar", class: "compare-bar hidden" });
    root.appendChild(compareBar);

    function draw() {
      var savedY2 = window.scrollY;
      ui.clear(listWrap);
      var opts = activeOpts || {};

      // Build item pool from selected chains (or all if none selected)
      var activeChains = filters.chainIds.length
        ? chains.filter(function (c) { return filters.chainIds.indexOf(c.id) !== -1; })
        : chains;
      var items = [];
      activeChains.forEach(function (chain) {
        chain.items.forEach(function (it) {
          items.push(Object.assign({ chainId: chain.id, chainName: chain.name, chainColor: chain.color }, it));
        });
      });

      items = applySharedItemFilters(items);
      if (opts.maxKcal)     items = items.filter(function (it) { return it.kcal <= opts.maxKcal; });
      if (opts.minProtein)  items = items.filter(function (it) { return it.protein >= opts.minProtein; });
      if (opts.maxSodium)   items = items.filter(function (it) { return (it.sodium || 0) <= opts.maxSodium; });
      if (opts.maxSugar)    items = items.filter(function (it) { return (it.sugar || 0) <= opts.maxSugar; });
      if (opts.mealSize === "snack")   items = items.filter(function (it) { return it.kcal < 300; });
      if (opts.mealSize === "regular") items = items.filter(function (it) { return it.kcal >= 300 && it.kcal <= 600; });
      if (opts.mealSize === "large")   items = items.filter(function (it) { return it.kcal > 600; });
      if (rem && opts.fitOnly) items = items.filter(function (it) { return it.kcal <= rem.kcal; });

      var pri = opts.prioritize || "ppc";
      items.sort(function (a, b) {
        if (pri === "protein" || pri === "protein_per_cal") return b.protein - a.protein;
        if (pri === "lowcal")  return a.kcal - b.kcal;
        if (pri === "lowcarb") return (a.carbs || 0) - (b.carbs || 0);
        if (pri === "lowfat")  return (a.fat || 0) - (b.fat || 0);
        return (b.protein / b.kcal) - (a.protein / a.kcal); // ppc default
      });

      if (!items.length) { listWrap.appendChild(browseEmptyState()); window.scrollTo(0, savedY2); return; }

      // Show plate builder card for any plate-builder chain in the active pool
      activeChains.forEach(function (pbChain) {
        var pbCfg = window.MM.getChainConfig(pbChain);
        if (!pbCfg || pbCfg.interaction_type !== "plate_builder") return;
        var pbRoles = pbCfg.category_roles || {};
        var pbRoleKeys = Object.keys(pbRoles);
        var hasItems = pbRoleKeys.length === 0
          ? pbChain.items.length > 0
          : pbRoleKeys.some(function (role) {
              var cats = pbRoles[role] || [];
              return pbChain.items.some(function (it) { return cats.indexOf(it.category) !== -1; });
            });
        if (!hasItems) return;
        listWrap.appendChild(el("div", { class: "card pb-entry-card" }, [
          el("div", { class: "pb-entry-text" }, [
            el("strong", null, pbChain.name + " — Build your order"),
            el("div", { class: "muted small" }, "Pick a size and fill your slots. Live macros update as you build.")
          ]),
          el("button", { class: "btn primary", onclick: function () {
            window.MM.plateBuilder.openPlateBuilder(pbChain, addToLog);
          } }, "Open Builder →")
        ]));
      });

      // Pass per-item chain/cfg for plate builder link in itemCard (single chain only)
      var singleChain = activeChains.length === 1 ? activeChains[0] : null;
      var singleCfg = singleChain ? window.MM.getChainConfig(singleChain) : null;
      items.forEach(function (it) { listWrap.appendChild(itemCard(it, rem, draw, singleChain, singleCfg)); });
      window.scrollTo(0, savedY2);
    }

    draw();
    drawCompareBar();
  }

  function renderRecModeContent(root, chains, nearbyIds, rem, tg) {
    if (!tg) {
      root.appendChild(noticeCard("Set up your profile first",
        "We need your calorie & macro targets to recommend food. Head to the Profile tab.",
        "Go to Profile", function () { navigate("profile"); }));
      return;
    }

    root.appendChild(buildSearchCard(runRecommend));

    // Meal Combos
    root.appendChild(buildCombosSection(rem));

    var results = el("div", { id: "rec-results", class: "card-list" });
    root.appendChild(results);

    runRecommend(window.MM.recommend.PRESETS.fits_remaining.opts);

    function getChainIds() {
      return filters.chainIds && filters.chainIds.length ? filters.chainIds : null;
    }

    function runRecommend(opts) {
      var ids = getChainIds();
      var rem2 = remaining();
      var ranked = window.MM.recommend.rank(rem2, opts, ids, 50);
      ranked = applySharedItemFilters(ranked).slice(0, 15);
      ui.clear(results);
      var scopeLabel = ids && ids.length === 1
        ? (window.MM.getChainById(ids[0]) || {}).name || "1 chain"
        : ids ? (ids.length + " chains") : "all chains";
      results.appendChild(el("div", { class: "list-head" }, [
        el("strong", null, "Top matches"),
        el("span", { class: "muted small" }, "from " + scopeLabel)
      ]));
      if (!ranked.length) { results.appendChild(recEmptyState()); return; }
      ranked.forEach(function (it, i) { results.appendChild(recCard(it, i + 1)); });
    }
  }

  function buildCombosSection(rem) {
    var collapsed = !filters.combosOpen;
    var chevron = el("span", { class: "collapsible-chevron" }, collapsed ? "▶" : "▼");
    var head = el("div", { class: "section-label collapsible-head" }, [chevron, "Meal Combos"]);
    var body = el("div", { class: "combos-body collapsible-body" + (collapsed ? " collapsed" : "") });
    var built = false;

    function buildCombos() {
      if (built) return; built = true;
      ui.clear(body);
      body.appendChild(el("p", { class: "muted small", style: "margin:0 0 10px" },
        "Same-chain entree + side that together fit your remaining calorie budget."));
      if (!rem || rem.kcal <= 0) {
        body.appendChild(emptyHint("Log some food today to see combos based on your remaining macros."));
        return;
      }
      var comboChainFilter = (filters.chainIds && filters.chainIds.length === 1) ? filters.chainIds[0] : null;
      var combos = window.MM.recommend.suggestCombos(rem, comboChainFilter, filters.category || null, 5);
      if (!combos.length) {
        body.appendChild(emptyHint("No combos found within your remaining budget. Try clearing chain or category filters."));
        return;
      }
      combos.forEach(function (combo) { body.appendChild(comboCard(combo)); });
    }

    head.addEventListener("click", function () {
      collapsed = !collapsed;
      chevron.textContent = collapsed ? "▶" : "▼";
      body.classList.toggle("collapsed", collapsed);
      filters.combosOpen = !collapsed;
      saveFilter("mm_combos_open", !collapsed);
      if (!collapsed) buildCombos();
    });
    if (!collapsed) buildCombos();
    return el("div", { class: "card" }, [head, body]);
  }

  function comboCard(combo) {
    var totItem = {
      kcal: combo.entree.kcal + combo.side.kcal,
      protein: combo.entree.protein + combo.side.protein,
      carbs: combo.entree.carbs + combo.side.carbs,
      fat: combo.entree.fat + combo.side.fat
    };
    function itemRow(it, roleLabel) {
      return el("div", { class: "combo-item-row" }, [
        el("div", { class: "combo-item-info" }, [
          el("span", { class: "combo-role-badge" }, roleLabel),
          el("span", { class: "combo-item-name" }, it.name)
        ]),
        el("div", { class: "combo-item-right" }, [
          ui.macroPills(it),
          el("button", { class: "btn small primary", onclick: function () { addToLog(it, 1); } }, "Add")
        ])
      ]);
    }
    var card = el("div", { class: "card combo-card" });
    card.appendChild(el("div", { class: "combo-chain" }, combo.chainName));
    card.appendChild(itemRow(combo.entree, "Entree"));
    card.appendChild(itemRow(combo.side, "Side"));
    card.appendChild(el("div", { class: "combo-totals" }, [
      el("span", { class: "muted small" }, "Combined: "),
      ui.macroPills(totItem)
    ]));
    return card;
  }

  function browseEmptyState() {
    return el("div", { class: "card empty-state" }, [
      el("div", { class: "empty-state-icon" }, "🔍"),
      el("p", null, "No items match your filters."),
      el("button", { class: "btn", onclick: clearAllFilters }, "Clear filters")
    ]);
  }

  function recEmptyState() {
    return el("div", { class: "empty-state" }, [
      el("p", null, "No items match. Try loosening your filters or clearing them."),
      el("button", { class: "btn", onclick: function () {
        filters.category = ""; filters.chainId = ""; filters.favorites = false;
        saveFilter("mm_filter_category", ""); saveFilter("mm_filter_chain", "");
        saveFilter("mm_filter_favorites", "false");
        renderMenu();
      } }, "Clear filters")
    ]);
  }

  function itemFlags(it) {
    var flags = [];
    var ppc = it.kcal > 0 ? it.protein / it.kcal : 0;
    if (ppc >= 0.09) flags.push(ui.badge("High protein", "p"));
    if (it.kcal <= 400) flags.push(ui.badge("Lower cal", "c"));
    if (it.sodium >= 1200) flags.push(ui.badge("High sodium", "warn"));
    if (it.sugar >= 20) flags.push(ui.badge("High sugar", "warn"));
    return flags;
  }

  function itemCard(it, rem, redraw, chain, chainCfg) {
    var fits = rem ? it.kcal <= rem.kcal : null;
    var checked = state.compare.some(function (c) { return c.chainId === it.chainId && c.name === it.name; });

    var head = el("div", { class: "item-head" }, [
      el("div", null, [
        el("div", { class: "item-name" }, it.name),
        el("div", { class: "muted small" }, it.chainName + " · " + (it.category || ""))
      ]),
      el("div", { class: "item-head-right" }, [
        el("div", { class: "item-flags" }, itemFlags(it)),
        starButton(it, redraw)
      ])
    ]);

    // Items with serving_label get a qty stepper; all others get plain Add
    var actionBtn;
    if (it.serving_label && chain) {
      var slLabel = it.serving_label;
      actionBtn = el("button", { class: "btn small primary qs-open-btn", onclick: function () {
        window.MM.plateBuilder.openQtySlider(it, chain, addToLog);
      } }, "Add " + slLabel + "s…");
    } else {
      actionBtn = el("button", { class: "btn small primary", onclick: function () { addToLog(it, 1); } }, "Add");
    }

    var foot = el("div", { class: "item-foot" }, [
      el("label", { class: "check tiny" }, [
        el("input", { type: "checkbox", checked: checked ? "checked" : null, onchange: function (e) { toggleCompare(it, e.target.checked); } }),
        el("span", null, "Compare")
      ]),
      el("div", { class: "item-actions" }, [
        rem ? el("span", {
          class: "muted small" + (fits ? "" : " over-note"),
          title: "Compared to the calories you have left today (" + ui.fmt(rem.kcal) + " cal)"
        }, fits ? ui.fmt(rem.kcal - it.kcal) + " cal left after" : "over by " + ui.fmt(it.kcal - rem.kcal) + " cal") : null,
        actionBtn
      ])
    ]);

    return el("div", { class: "card item-card" + (rem && !fits ? " dim" : "") }, [head, ui.macroPills(it),
      el("div", { class: "micro muted small" }, "Sodium " + ui.fmt(it.sodium) + "mg · Fiber " + ui.fmt(it.fiber) + "g · Sugar " + ui.fmt(it.sugar) + "g"),
      foot]);
  }

  function toggleCompare(it, on) {
    if (on) {
      if (!state.compare.some(function (c) { return c.chainId === it.chainId && c.name === it.name; }))
        state.compare.push(it);
    } else {
      state.compare = state.compare.filter(function (c) { return !(c.chainId === it.chainId && c.name === it.name); });
    }
    drawCompareBar();
  }

  function drawCompareBar() {
    var bar = document.getElementById("compare-bar");
    if (!bar) return;
    ui.clear(bar);
    if (state.compare.length < 1) { bar.classList.add("hidden"); return; }
    bar.classList.remove("hidden");
    bar.appendChild(el("div", { class: "compare-head" }, [
      el("strong", null, "Comparing " + state.compare.length + " item(s)"),
      el("div", null, [
        el("button", { class: "btn small ghost", onclick: function () { state.compare = []; renderMenu(); } }, "Clear"),
        el("button", { class: "btn small", onclick: openCompare }, "View comparison")
      ])
    ]));
  }

  function openCompare() {
    if (!state.compare.length) return;
    var tg = window.MM.store.getTargets();
    var rem = remaining();

    var rows = ["Calories", "Protein (g)", "Carbs (g)", "Fat (g)", "Sodium (mg)", "Sugar (g)", "P / 100 cal"];
    if (rem) rows.push("Cal left after");

    var table = el("table", { class: "compare-table" });
    var thead = el("tr", null, [el("th", null, "")].concat(state.compare.map(function (it) {
      return el("th", null, it.name);
    })));
    table.appendChild(thead);
    rows.forEach(function (label) {
      var tr = el("tr", null, [el("td", { class: "rowlab" }, label)]);
      state.compare.forEach(function (it) {
        var v, cls = "";
        if (label === "Calories") v = ui.fmt(it.kcal);
        else if (label === "Protein (g)") v = ui.fmt(it.protein);
        else if (label === "Carbs (g)") v = ui.fmt(it.carbs);
        else if (label === "Fat (g)") v = ui.fmt(it.fat);
        else if (label === "Sodium (mg)") v = ui.fmt(it.sodium);
        else if (label === "Sugar (g)") v = ui.fmt(it.sugar);
        else if (label === "P / 100 cal") v = (it.kcal > 0 ? (it.protein / it.kcal * 100).toFixed(1) : "—");
        else { // Cal left after
          var left = rem.kcal - it.kcal;
          v = (left < 0 ? "−" : "") + ui.fmt(Math.abs(left));
          cls = left < 0 ? "neg" : "pos";
        }
        tr.appendChild(el("td", { class: cls }, String(v)));
      });
      table.appendChild(tr);
    });

    var content = [];
    if (tg && rem) {
      content.push(el("div", { class: "compare-context" }, [
        el("span", { class: "muted" }, "Today: target " + ui.fmt(tg.kcal) + " · " + ui.fmt(tg.kcal - rem.kcal) + " eaten · "),
        el("strong", null, ui.fmt(rem.kcal) + " cal left")
      ]));
    }
    content.push(el("div", { class: "compare-scroll" }, [table]));
    ui.modal("Compare items", el("div", null, content), [{ label: "Done", kind: "primary" }]);
  }

  /* =====================================================================
   *  RECOMMEND VIEW
   * ===================================================================== */

  // Legacy For You tab is now the Browse tab with recommendations on.
  // This stub is kept so any remaining navigate("recommend") calls still work;
  // navigate() itself also redirects "recommend" → "menu" before calling here.
  function renderRecommend() { navigate("menu"); }

  function recCard(it, rankNum) {
    var head = el("div", { class: "item-head" }, [
      el("div", { class: "rec-title" }, [
        el("span", { class: "rank" }, "#" + rankNum),
        el("div", null, [
          el("div", { class: "item-name" }, it.name),
          el("div", { class: "muted small" }, it.chainName)
        ])
      ]),
      el("div", { class: "item-head-right" }, [
        el("div", { class: "score", title: "fit score" }, ui.fmt(Math.max(it._score, 0))),
        starButton(it, renderMenu)
      ])
    ]);
    var reasons = el("div", { class: "reasons" }, (it._reasons || []).slice(0, 3).map(function (r) {
      var bad = /over|heavy/i.test(r);
      return ui.badge(r, bad ? "warn" : "ok");
    }));
    var foot = el("div", { class: "item-foot" }, [
      el("span", { class: "muted small" }, (it._ppc * 100).toFixed(1) + " g protein / 100 cal"),
      el("button", { class: "btn small primary", onclick: function () { addToLog(it, 1); } }, "Add")
    ]);
    return el("div", { class: "card item-card" }, [head, ui.macroPills(it), reasons, foot]);
  }

  function remainingStrip(rem) {
    if (!rem) return el("div");
    return el("div", { class: "card remaining-strip" }, [
      el("div", { class: "section-label" }, "Remaining today"),
      el("div", { class: "rem-grid" }, [
        remStat(rem.kcal, "cal", "cal"),
        remStat(rem.protein, "g protein", "p"),
        remStat(rem.carbs, "g carbs", "c"),
        remStat(rem.fat, "g fat", "f")
      ])
    ]);
  }
  function remStat(v, label, cls) {
    var over = v < 0;
    return el("div", { class: "rem-stat " + cls + (over ? " over" : "") }, [
      el("div", { class: "rem-num" }, (over ? "−" : "") + ui.fmt(Math.abs(v))),
      el("div", { class: "rem-label" }, over ? "over " + label : label + " left")
    ]);
  }

  /* =====================================================================
   *  TRACKER VIEW
   * ===================================================================== */

  function renderTracker() {
    var root = document.getElementById("view-tracker");
    var savedY = window.scrollY;
    ui.clear(root);

    var tg = window.MM.store.getTargets();
    var entries = window.MM.store.getLog(state.viewDate);
    var c = totals(entries);

    // date navigation
    var isToday = state.viewDate === window.MM.store.todayKey();
    var nav = el("div", { class: "tracker-datenav" }, [
      el("button", { class: "icon-btn", onclick: function () { shiftDate(-1); } }, "‹"),
      el("div", { class: "date-label" }, [
        el("strong", null, prettyDate(state.viewDate)),
        isToday ? ui.badge("Today", "ok") : null
      ]),
      el("button", { class: "icon-btn", disabled: isToday ? "disabled" : null, onclick: function () { shiftDate(1); } }, "›"),
      el("div", { class: "spacer" }),
      historySelect()
    ]);
    root.appendChild(nav);

    if (!tg) {
      root.appendChild(noticeCard("No targets set yet", "Create your profile to see calories & macros remaining.",
        "Go to Profile", function () { navigate("profile"); }));
    }

    // summary: ring + macro bars
    var summary = el("div", { class: "card tracker-summary" });
    summary.appendChild(ui.calorieRing(c.kcal, tg ? tg.kcal : 0));
    var bars = el("div", { class: "tracker-bars" }, [
      ui.macroRow("Calories", c.kcal, tg ? tg.kcal : 0, "cal"),
      ui.macroRow("Protein", c.protein, tg ? tg.protein : 0, "p"),
      ui.macroRow("Carbs", c.carbs, tg ? tg.carbs : 0, "c"),
      ui.macroRow("Fat", c.fat, tg ? tg.fat : 0, "f")
    ]);
    summary.appendChild(bars);
    root.appendChild(summary);

    // smart coach insight (today only)
    var coach = coachInsight();
    if (coach) root.appendChild(coach);

    // micro totals
    root.appendChild(el("div", { class: "card micro-row-card" }, [
      microStat("Sodium", ui.fmt(c.sodium) + " mg"),
      microStat("Fiber", ui.fmt(c.fiber) + " g"),
      microStat("Sugar", ui.fmt(c.sugar) + " g"),
      microStat("Items", String(entries.length))
    ]));

    // 7-day overview — always shows the trailing week regardless of viewDate.
    var weekly = weeklyCard();
    if (weekly) root.appendChild(weekly);

    // quick add row
    root.appendChild(quickAddCard());

    // log list
    var streak = window.MM.store.loggingStreak();
    var logCard = el("div", { class: "card" });
    logCard.appendChild(el("div", { class: "list-head" }, [
      el("div", { class: "loghead-title" }, [
        el("strong", null, "Food log"),
        (isToday && streak >= 2) ? el("span", { class: "streak-pill", title: streak + " days logged in a row" }, "🔥 " + streak) : null
      ]),
      entries.length ? el("div", null, [
        el("button", { class: "btn small ghost", onclick: saveDayAsMeal }, "Save as meal"),
        el("button", { class: "btn small ghost", onclick: clearDay }, "Clear day")
      ]) : null
    ]));
    if (!entries.length) {
      logCard.appendChild(emptyHint("Nothing logged yet. Add items from Browse or quick-add above."));
    } else {
      // Group entries into meal buckets — gives the log breakfast/lunch/dinner/
      // snack structure, with each bucket showing its own totals. Unknown meals
      // (legacy entries before the field existed) fall into "lunch" so they're
      // not stranded at the bottom.
      var byMeal = { breakfast: [], lunch: [], dinner: [], snack: [] };
      entries.forEach(function (e) {
        var m = e.meal && byMeal[e.meal] ? e.meal : "lunch";
        byMeal[m].push(e);
      });
      window.MM.store.MEAL_ORDER.forEach(function (m) {
        if (byMeal[m].length) logCard.appendChild(mealSection(m, byMeal[m]));
      });
    }
    root.appendChild(logCard);

    // progress: weigh-in + body fat + habits
    root.appendChild(weighInCard());
    root.appendChild(bodyFatCard());
    root.appendChild(habitsCard());
    var ach = achievementsCard();
    if (ach) root.appendChild(ach);

    renderNavBadge();
    window.scrollTo(0, savedY);
  }

  /* ---------- smart coach insight (reacts to today's remaining macros) ----- */
  function coachInsight() {
    var tg = window.MM.store.getTargets();
    if (!tg) return null;
    if (state.viewDate !== window.MM.store.todayKey()) return null; // coaching is about *today*
    var rem = remaining();
    if (!rem) return null;
    var logged = window.MM.store.getLog(state.viewDate).length;

    var emoji = "🧭", msg, action = null;
    if (rem.kcal < -50) {
      emoji = "⚖️";
      msg = "You're " + ui.fmt(-rem.kcal) + " cal over target today. No stress — consistency beats any single day.";
    } else if (!logged) {
      emoji = "🌅";
      msg = "Fresh start: " + ui.fmt(rem.kcal) + " cal and " + ui.fmt(Math.max(rem.protein, 0)) + "g protein to go. Log your first item to get rolling.";
      action = { label: "Find food →", view: "menu" };
    } else if (rem.protein > 25 && rem.kcal > 150) {
      emoji = "💪";
      msg = "You have " + ui.fmt(rem.protein) + "g protein and " + ui.fmt(rem.kcal) + " cal left — a high-protein pick would round out your day.";
      action = { label: "See picks →", view: "menu" };
    } else if (rem.kcal <= 120 && rem.protein <= 15) {
      emoji = "🎯";
      msg = "Dialed in — you've essentially hit your calories and protein for today. Nice work.";
    } else {
      emoji = "🍽️";
      msg = ui.fmt(Math.max(rem.kcal, 0)) + " cal left and " + ui.fmt(Math.max(rem.protein, 0)) + "g protein to go.";
      action = { label: "Find food →", view: "menu" };
    }

    var children = [el("span", { class: "coach-emoji" }, emoji), el("div", { class: "coach-msg" }, msg)];
    if (action) children.push(el("button", { class: "btn small", onclick: function () { navigate(action.view); } }, action.label));
    return el("div", { class: "card coach-card" }, children);
  }

  /* ---------- weigh-in card (body-weight log + trend) ---------------------- */
  function weighInCard() {
    var store = window.MM.store, m = window.MM.macros;
    var prof = store.getProfile();
    var metric = prof && prof.units === "metric";
    var toDisp = function (kg) { return metric ? kg : m.kgToLb(kg); };
    var fromDisp = function (v) { return metric ? v : m.lbToKg(v); };
    var unit = metric ? "kg" : "lb";

    var card = el("div", { class: "card" });
    card.appendChild(el("div", { class: "section-label" }, "Weigh-in · " + prettyDate(state.viewDate)));

    var existing = store.getWeight(state.viewDate);
    var input = el("input", {
      class: "input", type: "number", step: "0.1", min: "0", placeholder: "Weight",
      value: existing != null ? String(Math.round(toDisp(existing) * 10) / 10) : null
    });
    var form = el("form", { class: "weigh-form" }, [
      input, el("span", { class: "unit" }, unit),
      el("button", { class: "btn primary small", type: "submit" }, existing != null ? "Update" : "Log"),
      existing != null ? el("button", {
        class: "btn ghost small", type: "button",
        onclick: function () { store.setWeight(null, state.viewDate); renderTracker(); }
      }, "Clear") : null
    ]);
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var v = parseFloat(input.value);
      if (isNaN(v) || v <= 0) { ui.toast("Enter a valid weight", "err"); return; }
      store.setWeight(fromDisp(v), state.viewDate);
      ui.toast("Weight logged for " + prettyDate(state.viewDate), "ok");
      renderTracker();
    });
    card.appendChild(form);

    var series = store.weightSeries();
    if (series.length >= 2) card.appendChild(weightTrend(series, toDisp, unit, prof));
    else if (series.length === 1) card.appendChild(el("p", { class: "muted small" }, "Log another day to see your trend."));
    return card;
  }

  function weightTrend(series, toDisp, unit, prof) {
    var first = series[0], last = series[series.length - 1];
    var net = toDisp(last.kg) - toDisp(first.kg);
    var days = Math.max(1, (new Date(last.date + "T00:00:00") - new Date(first.date + "T00:00:00")) / 86400000);
    var perWeek = net / days * 7;
    var signed = function (x) { return (x >= 0 ? "+" : "−") + Math.abs(x).toFixed(1); };

    var goalDir = prof ? ({ lose: -1, gain: 1, maintain: 0 })[prof.goal] : null;
    var aligned = goalDir == null ? null
      : goalDir === 0 ? Math.abs(perWeek) < 0.4
      : goalDir < 0 ? perWeek < -0.05 : perWeek > 0.05;
    var insight;
    if (goalDir == null) insight = Math.abs(perWeek).toFixed(1) + " " + unit + "/wk";
    else if (goalDir === 0) insight = aligned ? "Holding steady — right on target." : "Drifting " + (perWeek > 0 ? "up" : "down") + " " + Math.abs(perWeek).toFixed(1) + " " + unit + "/wk.";
    else if (aligned) insight = "On track — " + Math.abs(perWeek).toFixed(1) + " " + unit + "/wk toward your goal.";
    else insight = "Trending the other way (" + signed(perWeek) + " " + unit + "/wk). Worth a look at intake.";

    return el("div", { class: "weight-trend" }, [
      sparkline(series.map(function (s) { return toDisp(s.kg); }), aligned),
      el("div", { class: "weight-stats" }, [
        el("div", null, [
          el("span", { class: "wt-num" }, signed(net) + " " + unit),
          el("span", { class: "muted small" }, " since " + prettyDate(first.date) + " · " + series.length + " weigh-ins")
        ]),
        el("div", { class: "muted small" + (aligned ? " good" : "") }, insight)
      ])
    ]);
  }

  // Inline SVG sparkline of a numeric series. `good` tints the line (green/amber).
  function sparkline(values, good) {
    var w = 240, h = 46, pad = 5;
    var min = Math.min.apply(null, values), max = Math.max.apply(null, values);
    var span = (max - min) || 1, n = values.length;
    var pts = values.map(function (v, i) {
      var x = pad + (n === 1 ? 0 : (i / (n - 1)) * (w - 2 * pad));
      var y = pad + (1 - (v - min) / span) * (h - 2 * pad);
      return x.toFixed(1) + "," + y.toFixed(1);
    });
    var stroke = good === false ? "var(--warn)" : "var(--accent)";
    var lastPt = pts[pts.length - 1].split(",");
    var svg = "<svg viewBox='0 0 " + w + " " + h + "' width='100%' height='" + h + "' preserveAspectRatio='none'>" +
      "<polyline fill='none' stroke='" + stroke + "' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' points='" + pts.join(" ") + "'/>" +
      "<circle cx='" + lastPt[0] + "' cy='" + lastPt[1] + "' r='3.2' fill='" + stroke + "'/></svg>";
    return el("div", { class: "spark", html: svg });
  }

  /* ---------- body fat % tracker ----------------------------------------- */
  function bodyFatCard() {
    var store = window.MM.store;
    var prof = store.getProfile();
    var metric = prof && prof.units === "metric";
    var card = el("div", { class: "card" });
    card.appendChild(el("div", { class: "section-label" }, "Body Fat % · " + prettyDate(state.viewDate)));
    var existing = store.getBodyFat(state.viewDate);
    var input = el("input", {
      class: "input", type: "number", step: "0.1", min: "1", max: "60", placeholder: "e.g. 20",
      value: existing != null ? String(Math.round(existing * 10) / 10) : null
    });
    var form = el("form", { class: "weigh-form" }, [
      input, el("span", { class: "unit" }, "%"),
      el("button", { class: "btn primary small", type: "submit" }, existing != null ? "Update" : "Log"),
      existing != null ? el("button", {
        class: "btn ghost small", type: "button",
        onclick: function () { store.setBodyFat(null, state.viewDate); renderTracker(); }
      }, "Clear") : null
    ]);
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var v = parseFloat(input.value);
      if (isNaN(v) || v <= 0 || v >= 100) { ui.toast("Enter a valid body fat % (1–99)", "err"); return; }
      store.setBodyFat(v, state.viewDate);
      // Optionally show lean mass alongside if weight is logged for this day
      var wt = store.getWeight(state.viewDate);
      var extra = "";
      if (wt) {
        var lbm = wt * (1 - v / 100);
        extra = " · Lean mass " + (metric ? (Math.round(lbm * 10) / 10) + " kg" : Math.round(window.MM.macros.kgToLb(lbm)) + " lb");
      }
      ui.toast("Body fat logged for " + prettyDate(state.viewDate) + extra, "ok");
      renderTracker();
    });
    card.appendChild(form);
    if (existing != null) {
      var wt2 = store.getWeight(state.viewDate);
      if (wt2) {
        var lbm2 = wt2 * (1 - existing / 100);
        var lbmStr = metric ? (Math.round(lbm2 * 10) / 10) + " kg" : Math.round(window.MM.macros.kgToLb(lbm2)) + " lb";
        card.appendChild(el("p", { class: "muted small", style: "margin:8px 0 0" },
          "Lean mass: " + lbmStr + " · Fat mass: " +
          (metric ? (Math.round((wt2 - lbm2) * 10) / 10) + " kg" : Math.round(window.MM.macros.kgToLb(wt2 - lbm2)) + " lb")));
      }
    }
    var series = store.bodyFatSeries();
    if (series.length >= 2) card.appendChild(bodyFatTrend(series));
    else if (series.length === 1) card.appendChild(el("p", { class: "muted small" }, "Log another day to see your body fat trend."));
    return card;
  }

  function bodyFatTrend(series) {
    var first = series[0], last = series[series.length - 1];
    var net = last.pct - first.pct;
    var days = Math.max(1, (new Date(last.date + "T00:00:00") - new Date(first.date + "T00:00:00")) / 86400000);
    var perWeek = net / days * 7;
    var signed = function (x) { return (x >= 0 ? "+" : "−") + Math.abs(x).toFixed(1); };
    var prof = window.MM.store.getProfile();
    var goalDir = prof ? ({ lose: -1, gain: 1, maintain: 0 })[prof.goal] : null;
    var aligned = goalDir == null ? null
      : goalDir === 0 ? Math.abs(perWeek) < 0.2
      : goalDir < 0 ? perWeek < -0.05 : null; // gaining muscle doesn't mean BF should rise
    var insight = goalDir === null ? Math.abs(perWeek).toFixed(1) + "%/wk change"
      : goalDir === 0 ? (aligned ? "Body fat holding steady." : "Body fat drifting " + (perWeek > 0 ? "up" : "down") + " " + Math.abs(perWeek).toFixed(1) + "%/wk.")
      : goalDir < 0 ? (aligned ? "On track — body fat trending down." : "Body fat trending up — check intake vs targets.")
      : "Body fat " + (perWeek < 0 ? "decreasing while gaining — great recomp signal." : "holding while gaining — expected on a bulk.");
    return el("div", { class: "weight-trend" }, [
      sparkline(series.map(function (s) { return s.pct; }), aligned === null ? null : !aligned),
      el("div", { class: "weight-stats" }, [
        el("div", null, [
          el("span", { class: "wt-num" }, signed(net) + "%"),
          el("span", { class: "muted small" }, " since " + prettyDate(first.date) + " · " + series.length + " readings")
        ]),
        el("div", { class: "muted small" + (aligned ? " good" : "") }, insight)
      ])
    ]);
  }

  /* ---------- calculation explanation (used in targets card) -------------- */
  function buildCalcExplain(t, p) {
    var m = window.MM.macros;
    var d = m.explain(p);
    var fmt = ui.fmt;
    var wrap = el("div", { class: "calc-explain" });

    function step(num, title, val, lines) {
      var head = el("div", { class: "calc-step-head" }, [
        el("span", { class: "calc-step-num" }, num + "."),
        el("span", { class: "calc-step-title" }, title),
        val ? el("span", { class: "calc-step-val" }, val) : null
      ]);
      var item = el("div", { class: "calc-step" }, [head]);
      if (lines && lines.length) {
        var ul = el("ul", { class: "calc-step-lines" });
        lines.forEach(function (line) { ul.appendChild(el("li", null, line)); });
        item.appendChild(ul);
      }
      return item;
    }

    // 1. BMR
    var bmrLines = [];
    if (d.method === "katch_mcardle") {
      bmrLines.push("Formula: Katch-McArdle (body fat known — doesn't require height/age)");
      bmrLines.push("LBM = " + p.weightKg.toFixed(1) + " kg × (1 − " + p.bodyFatPct + "%) = " + d.lbm + " kg");
      bmrLines.push("370 + (21.6 × " + d.lbm + " kg) = " + fmt(d.bmr) + " cal/day");
    } else {
      bmrLines.push("Formula: Mifflin–St Jeor");
      var sexAdj = p.sex === "female" ? "− 161" : "+ 5";
      bmrLines.push("(10 × " + p.weightKg.toFixed(1) + ") + (6.25 × " + p.heightCm.toFixed(0) + ") − (5 × " + p.age + ") " + sexAdj + " = " + fmt(d.bmr) + " cal/day");
    }
    wrap.appendChild(step(1, "Basal Metabolic Rate (BMR)", fmt(d.bmr) + " cal/day", bmrLines));

    // 2. TDEE
    wrap.appendChild(step(2, "Total Daily Energy (TDEE)", fmt(d.tdee) + " cal/day", [
      "Activity: " + d.activityLabel,
      fmt(d.bmr) + " × " + d.activityMult + " = " + fmt(d.tdee) + " cal/day"
    ]));

    // 3. Calorie target
    var calLines = [];
    if (d.goalDir === 0) {
      calLines.push("Goal: maintain — target equals TDEE");
    } else {
      var sign = d.goalDir < 0 ? "−" : "+";
      calLines.push("Goal: " + d.goalLabel + " — " + d.rateLabel);
      calLines.push(fmt(d.tdee) + " " + sign + " " + fmt(d.rateKcal) + " cal = " + fmt(d.kcalRaw) + " cal/day");
    }
    if (d.floorApplied) calLines.push("Safety minimum applied: raised to " + d.floorValue + " cal/day");
    if (t && t.manual) calLines.push("Note: you have manually adjusted these targets from the calculated values");
    wrap.appendChild(step(3, "Calorie Target", fmt(d.kcal) + " cal/day", calLines));

    // 4. Protein
    var protLines = [
      "Focus: " + d.focusLabel,
      d.proteinPerKg + " g/kg " + d.proteinBasis + " × " + d.proteinKg.toFixed(1) + " kg = " + d.proteinRaw + "g"
    ];
    if (d.proteinClamped === "cap") protLines.push("Capped at 35% of calories (max " + d.proteinMaxG + "g) to avoid excess");
    if (d.proteinClamped === "floor") protLines.push("Raised to 20% minimum (" + d.proteinMinG + "g) for adequate protein");
    wrap.appendChild(step(4, "Protein", d.protein + "g/day", protLines));

    // 5. Carbs & Fat
    wrap.appendChild(step(5, "Carbs & Fat", d.carbs + "g carbs · " + d.fat + "g fat", [
      "Calories remaining after protein: " + fmt(d.remainingKcal) + " cal",
      "Carbs (" + d.cPct + "%): " + fmt(Math.round(d.remainingKcal * d.cPct / 100)) + " cal ÷ 4 = " + d.carbs + "g",
      "Fat (" + d.fPct + "%): " + fmt(Math.round(d.remainingKcal * d.fPct / 100)) + " cal ÷ 9 = " + d.fat + "g"
    ]));

    return wrap;
  }

  /* ---------- daily habits (toggles + streaks) ---------------------------- */
  function habitsCard() {
    var store = window.MM.store;
    var habits = store.getHabits();
    var card = el("div", { class: "card" });
    card.appendChild(el("div", { class: "list-head" }, [
      el("strong", null, "Daily habits"),
      el("button", { class: "btn small ghost", onclick: addHabitPrompt }, "+ Add habit")
    ]));
    if (!habits.length) { card.appendChild(emptyHint("No habits yet. Add one to start a streak.")); return card; }

    var grid = el("div", { class: "habit-grid" });
    habits.forEach(function (hb) {
      var done = store.isHabitDone(hb.id, state.viewDate);
      var streak = store.habitStreak(hb.id);
      var btn = el("button", {
        class: "habit" + (done ? " done" : ""),
        onclick: function () { store.toggleHabit(hb.id, state.viewDate); renderTracker(); }
      }, [
        el("span", { class: "habit-emoji" }, hb.emoji),
        el("span", { class: "habit-name" }, hb.name),
        streak > 0 ? el("span", { class: "habit-streak" }, "🔥 " + streak) : null,
        el("span", { class: "habit-check" }, done ? "✓" : "")
      ]);
      var del = el("button", {
        class: "habit-del", title: "Remove habit",
        onclick: function (ev) { ev.stopPropagation(); store.removeHabit(hb.id); renderTracker(); }
      }, "✕");
      grid.appendChild(el("div", { class: "habit-wrap" }, [btn, del]));
    });
    card.appendChild(grid);
    return card;
  }

  function addHabitPrompt() {
    var emojiIn = el("input", { class: "input", placeholder: "✅", maxlength: "2", value: "✅" });
    var nameIn = el("input", { class: "input", placeholder: "e.g. 10k steps" });
    ui.modal("Add a habit", el("div", { class: "form-grid" }, [
      field("Emoji", emojiIn), field("Habit", nameIn)
    ]), [
      { label: "Cancel", kind: "ghost" },
      { label: "Add", kind: "primary", onClick: function () {
        var name = nameIn.value.trim();
        if (!name) { ui.toast("Name your habit", "err"); return true; }
        window.MM.store.addHabit(name, emojiIn.value.trim() || "✅");
        renderTracker();
      } }
    ]);
  }

  function logRow(e) {
    var q = e.qty || 1;
    var mealSel = el("select", { class: "meal-sel" });
    window.MM.store.MEAL_ORDER.forEach(function (m) {
      var opt = el("option", { value: m }, MEAL_META[m].emoji + " " + MEAL_META[m].label);
      if (m === (e.meal || "lunch")) opt.setAttribute("selected", "selected");
      mealSel.appendChild(opt);
    });
    mealSel.addEventListener("change", function () {
      window.MM.store.updateLogEntry(e.id, { meal: mealSel.value }, state.viewDate);
      renderTracker();
    });
    return el("div", { class: "log-row" }, [
      starButton(e, renderTracker),
      el("div", { class: "log-main" }, [
        el("div", { class: "item-name" }, e.name),
        el("div", { class: "muted small" }, e.chainName + " · " + ui.fmt(e.kcal * q) + " cal · P" + ui.fmt(e.protein * q) + " C" + ui.fmt(e.carbs * q) + " F" + ui.fmt(e.fat * q))
      ]),
      el("div", { class: "log-right" }, [
        mealSel,
        el("div", { class: "qty" }, [
          el("button", { class: "icon-btn small", onclick: function () { changeQty(e, -1); } }, "–"),
          el("span", { class: "qty-num" }, "×" + q),
          el("button", { class: "icon-btn small", onclick: function () { changeQty(e, 1); } }, "+"),
          el("button", { class: "icon-btn small danger", onclick: function () {
            window.MM.store.removeLogEntry(e.id, state.viewDate); renderTracker();
          } }, "✕")
        ])
      ])
    ]);
  }

  // Renders a named meal bucket header (with totals) followed by its log rows.
  function mealSection(meal, entries) {
    var meta = MEAL_META[meal] || { label: meal, emoji: "🍽️" };
    var t = totals(entries);
    var wrap = el("div", { class: "meal-section" });
    wrap.appendChild(el("div", { class: "meal-header" }, [
      el("span", { class: "meal-emoji" }, meta.emoji),
      el("span", { class: "meal-label" }, meta.label),
      el("span", { class: "meal-cals muted small" },
        ui.fmt(Math.round(t.kcal)) + " cal · P" + ui.fmt(Math.round(t.protein)) +
        " C" + ui.fmt(Math.round(t.carbs)) + " F" + ui.fmt(Math.round(t.fat)))
    ]));
    entries.forEach(function (e) { wrap.appendChild(logRow(e)); });
    return wrap;
  }

  function changeQty(e, delta) {
    var q = Math.max(1, (e.qty || 1) + delta);
    window.MM.store.updateLogEntry(e.id, { qty: q }, state.viewDate);
    renderTracker();
  }

  function quickAddCard() {
    var card = el("div", { class: "card" });
    card.appendChild(el("div", { class: "section-label" }, "Quick add"));

    // Favorites — pinned items for fast re-logging, separate from frequents.
    var favs = window.MM.store.getFavorites();
    if (favs.length) {
      var favChips = el("div", { class: "chips" });
      favs.forEach(function (fav) {
        favChips.appendChild(el("button", {
          class: "chip fav",
          title: (fav.chainName || "Custom") + " · " + fav.kcal + " cal",
          onclick: function () { addToLog(fav, 1); }
        }, "★ " + fav.name));
      });
      card.appendChild(el("div", { class: "fav-section" }, [
        el("div", { class: "fav-label" }, "Favorites"),
        favChips
      ]));
    }

    // frequents + saved meals chips
    var chips = el("div", { class: "chips" });
    window.MM.store.topFrequents(6).forEach(function (f) {
      var parts = f.key.split("::");
      var chain = window.MM.getChainById(parts[0]);
      if (!chain) return;
      var item = chain.items.filter(function (i) { return i.name === parts[1]; })[0];
      if (!item) return;
      chips.appendChild(el("button", { class: "chip", onclick: function () {
        addToLog(Object.assign({ chainId: chain.id, chainName: chain.name }, item), 1);
      } }, "↺ " + item.name));
    });
    window.MM.store.getSavedMeals().forEach(function (meal) {
      chips.appendChild(el("button", { class: "chip meal", onclick: function () {
        meal.items.forEach(function (it) { window.MM.store.addLogEntry(Object.assign({}, it, { id: null }), state.viewDate); });
        ui.toast("Added meal: " + meal.name, "ok"); renderTracker();
      } }, "🍱 " + meal.name));
    });
    if (chips.childNodes.length) card.appendChild(chips);

    // custom item form
    var form = el("form", { class: "quickadd-form" }, [
      el("input", { class: "input grow", name: "qa_name", placeholder: "Custom item name", type: "text", required: "required" }),
      numInput("qa_kcal", "", 0, 5000, "cal"),
      numInput("qa_p", "", 0, 500, "P"),
      numInput("qa_c", "", 0, 800, "C"),
      numInput("qa_f", "", 0, 400, "F"),
      el("button", { class: "btn primary", type: "submit" }, "Add")
    ]);
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      addToLog({
        name: form.qa_name.value || "Custom item",
        chainName: "Custom",
        kcal: +form.qa_kcal.value || 0, protein: +form.qa_p.value || 0,
        carbs: +form.qa_c.value || 0, fat: +form.qa_f.value || 0
      }, 1);
      form.reset();
    });
    card.appendChild(form);
    return card;
  }

  function shiftDate(delta) {
    var d = new Date(state.viewDate + "T00:00:00");
    d.setDate(d.getDate() + delta);
    var key = window.MM.store.todayKey(d);
    if (key > window.MM.store.todayKey()) return; // no future
    state.viewDate = key;
    renderTracker();
  }

  function historySelect() {
    var dates = window.MM.store.loggedDates();
    if (!dates.length) return el("span");
    var opts = dates.map(function (d) { return { v: d, label: prettyDate(d) }; });
    return select("history", opts, dates.indexOf(state.viewDate) !== -1 ? state.viewDate : opts[0].v, function (e) {
      state.viewDate = e.target.value; renderTracker();
    });
  }

  function clearDay() {
    ui.modal("Clear this day?", el("p", null, "This removes all logged items for " + prettyDate(state.viewDate) + "."), [
      { label: "Cancel", kind: "ghost" },
      { label: "Clear", kind: "danger", onClick: function () {
        window.MM.store.clearDay(state.viewDate); renderTracker(); ui.toast("Day cleared");
      } }
    ]);
  }

  function saveDayAsMeal() {
    var entries = window.MM.store.getLog(state.viewDate);
    if (!entries.length) return;
    var input = el("input", { class: "input", placeholder: "e.g. My usual Chipotle order", type: "text" });
    ui.modal("Save these items as a meal", el("div", { class: "form-grid" }, [field("Meal name", input)]), [
      { label: "Cancel", kind: "ghost" },
      { label: "Save meal", kind: "primary", onClick: function () {
        var name = input.value.trim() || "Saved meal";
        var items = entries.map(function (e) {
          return { name: e.name, chainId: e.chainId, chainName: e.chainName, kcal: e.kcal, protein: e.protein, carbs: e.carbs, fat: e.fat, sodium: e.sodium, fiber: e.fiber, sugar: e.sugar, qty: e.qty };
        });
        window.MM.store.saveMeal({ name: name, items: items });
        ui.toast("Saved meal: " + name, "ok"); renderTracker();
      } }
    ]);
  }

  /* ---------- 7-day weekly overview card --------------------------------- */
  function weeklyCard() {
    var tg = window.MM.store.getTargets();
    if (!tg) return null;
    var data = window.MM.store.recentTotals(7); // oldest → newest

    var card = el("div", { class: "card weekly-card" });
    card.appendChild(el("div", { class: "list-head" }, [
      el("strong", null, "This week"),
      el("span", { class: "muted small" }, "trailing 7 days")
    ]));
    card.appendChild(weeklyChart(data, tg));

    var logged = data.filter(function (d) { return d.kcal > 0; });
    var avgKcal = logged.length
      ? Math.round(logged.reduce(function (s, d) { return s + d.kcal; }, 0) / logged.length) : 0;
    var avgProt = logged.length
      ? Math.round(logged.reduce(function (s, d) { return s + d.protein; }, 0) / logged.length) : 0;
    var vsTarget = avgKcal ? avgKcal - tg.kcal : 0;

    card.appendChild(el("div", { class: "weekly-stats" }, [
      el("div", { class: "ws-stat" }, [
        el("div", { class: "ws-num" }, avgKcal ? ui.fmt(avgKcal) : "—"),
        el("div", { class: "ws-label" }, "avg cal/day")
      ]),
      el("div", { class: "ws-stat" }, [
        el("div", { class: "ws-num" }, avgProt ? ui.fmt(avgProt) + "g" : "—"),
        el("div", { class: "ws-label" }, "avg protein")
      ]),
      el("div", { class: "ws-stat" }, [
        el("div", { class: "ws-num" }, logged.length + "/7"),
        el("div", { class: "ws-label" }, "days logged")
      ]),
      el("div", { class: "ws-stat" }, [
        el("div", { class: "ws-num" + (!avgKcal ? "" : vsTarget > 0 ? " wover" : " wok") },
          !avgKcal ? "—"
            : (vsTarget > 0 ? "+" : "−") + ui.fmt(Math.abs(vsTarget))),
        el("div", { class: "ws-label" }, "vs cal target")
      ])
    ]));
    return card;
  }

  function weeklyChart(data, tg) {
    var W = 320, H = 110, padB = 22, padT = 8;
    var chartH = H - padT - padB;
    var n = data.length; // always 7
    var slotW = W / n;
    var calBarW = Math.floor(slotW * 0.34);
    var protBarW = Math.floor(slotW * 0.2);
    var g = 2;

    var maxCal = 0;
    data.forEach(function (d) { if (d.kcal > maxCal) maxCal = d.kcal; });
    maxCal = Math.max(maxCal * 1.1, tg.kcal * 1.2, 1);
    var yOf = function (v) {
      return (padT + chartH - Math.min((v / maxCal) * chartH, chartH)).toFixed(1);
    };
    var tgY = yOf(tg.kcal);

    var parts = [];
    // dashed target line
    parts.push("<line x1='0' x2='" + W + "' y1='" + tgY + "' y2='" + tgY + "' class='wc-target'/>");

    var dayAbbr = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
    var today = window.MM.store.todayKey();
    data.forEach(function (d, i) {
      var cx = (i * slotW + slotW / 2).toFixed(1);
      var lbl = dayAbbr[new Date(d.date + "T00:00:00").getDay()];
      parts.push("<text x='" + cx + "' y='" + (H - 5) + "' text-anchor='middle' class='wc-lbl" +
        (d.date === today ? " wc-today" : "") + "'>" + lbl + "</text>");
      if (d.kcal > 0) {
        var cH = Math.min((d.kcal / maxCal) * chartH, chartH).toFixed(1);
        var cY = yOf(d.kcal);
        var cls = d.kcal > tg.kcal * 1.05 ? "wc-cal wc-over" : "wc-cal";
        parts.push("<rect x='" + ((+cx) - calBarW - g / 2).toFixed(1) + "' y='" + cY +
          "' width='" + calBarW + "' height='" + cH + "' class='" + cls + "' rx='2'/>");
      }
      if (d.protein > 0 && tg.protein > 0) {
        var pH = Math.min((d.protein / tg.protein) * chartH, chartH).toFixed(1);
        var pY = (padT + chartH - +pH).toFixed(1);
        parts.push("<rect x='" + ((+cx) + g / 2).toFixed(1) + "' y='" + pY +
          "' width='" + protBarW + "' height='" + pH + "' class='wc-prot' rx='2'/>");
      }
    });

    // Weight trendline overlay (only if ≥2 readings fall within the 7-day window).
    var wAll = window.MM.store.weightSeries();
    var wWin = wAll.filter(function (w) {
      return w.date >= data[0].date && w.date <= data[n - 1].date;
    });
    if (wWin.length >= 2) {
      var prof = window.MM.store.getProfile();
      var metric = prof && prof.units === "metric";
      var toDisp = metric ? function (k) { return k; } : window.MM.macros.kgToLb;
      var wVals = wWin.map(function (w) { return toDisp(w.kg); });
      var wMin = Math.min.apply(null, wVals), wMax = Math.max.apply(null, wVals);
      var wSpan = (wMax - wMin) || 1;
      var wPts = [];
      wWin.forEach(function (w) {
        var di = -1;
        for (var j = 0; j < n; j++) { if (data[j].date === w.date) { di = j; break; } }
        if (di < 0) return;
        var cx2 = di * slotW + slotW / 2;
        // Map weight onto the upper 55% of chart height so it doesn't clash with bars.
        var wy = padT + chartH * 0.1 + ((wMax - toDisp(w.kg)) / wSpan) * chartH * 0.55;
        wPts.push(cx2.toFixed(1) + "," + wy.toFixed(1));
      });
      if (wPts.length >= 2) {
        parts.push("<polyline points='" + wPts.join(" ") + "' class='wc-wline'/>");
        wPts.forEach(function (p) {
          var xy = p.split(",");
          parts.push("<circle cx='" + xy[0] + "' cy='" + xy[1] + "' r='2.5' class='wc-wdot'/>");
        });
      }
    }

    return el("div", { class: "weekly-chart", html:
      "<svg viewBox='0 0 " + W + " " + H + "' width='100%' height='" + H +
      "' xmlns='http://www.w3.org/2000/svg'>" + parts.join("") + "</svg>"
    });
  }

  /* ---------- achievement badges ----------------------------------------- */
  function achievementsCard() {
    var store = window.MM.store;
    var tg = store.getTargets();
    var items = [];

    var logStreak = store.loggingStreak();
    if (logStreak >= 3) items.push({ emoji: "🔥", val: logStreak + " days", label: "Logging streak" });

    if (tg) {
      var protStreak = store.hitTargetStreak("protein", tg.protein, 0.9);
      if (protStreak >= 3) items.push({ emoji: "💪", val: protStreak + " days", label: "Protein goal hit in a row" });
      var calStreak = store.underTargetStreak("kcal", tg.kcal * 1.05);
      if (calStreak >= 3) items.push({ emoji: "🎯", val: calStreak + " days", label: "Calories on target" });
    }

    var total = store.daysLoggedCount();
    var milestones = [7, 14, 30, 60, 100];
    var top = milestones.filter(function (m) { return total >= m; }).pop();
    if (top) items.push({ emoji: "📅", val: total + " days", label: top + "-day milestone" });

    var wLen = store.weightSeries().length;
    if (wLen >= 5) items.push({ emoji: "⚖️", val: wLen + " entries", label: "Weigh-ins logged" });

    if (!items.length) return null;

    var card = el("div", { class: "card ach-card" });
    card.appendChild(el("div", { class: "section-label" }, "Achievements"));
    var grid = el("div", { class: "ach-grid" });
    items.forEach(function (a) {
      grid.appendChild(el("div", { class: "ach-item" }, [
        el("span", { class: "ach-emoji" }, a.emoji),
        el("div", null, [
          el("div", { class: "ach-val" }, a.val),
          el("div", { class: "ach-lbl muted small" }, a.label)
        ])
      ]));
    });
    card.appendChild(grid);
    return card;
  }

  /* =====================================================================
   *  REQUESTS VIEW
   * ===================================================================== */

  function renderRequests() {
    var root = document.getElementById("view-requests");
    ui.clear(root);
    root.appendChild(header("Missing a restaurant?",
      "Our database is growing. If a chain near you has no macro data, request it and we'll prioritize adding it."));

    // nearby-without-data quick chips — hide any chain the user has already
    // requested (so they vanish on click and stay gone on a later visit).
    var requested = {};
    window.MM.store.getRequests().forEach(function (r) {
      requested[(r.chain || "").trim().toLowerCase()] = true;
    });
    var without = state.nearbyPlaces.filter(function (p) {
      return !p.hasData && !requested[(p.name || "").trim().toLowerCase()];
    });
    if (without.length) {
      var chips = el("div", { class: "chips" });
      var seen = {};
      without.forEach(function (p) {
        var key = (p.name || "").trim().toLowerCase();
        if (seen[key]) return; seen[key] = true;
        chips.appendChild(el("button", { class: "chip add", onclick: function () { quickRequest(p); renderRequests(); } }, "➕ " + p.name));
      });
      root.appendChild(el("div", { class: "card" }, [
        el("div", { class: "section-label" }, "Spotted near you without data"),
        chips
      ]));
    }

    // manual request form
    var form = el("form", { class: "card form-grid" });
    form.appendChild(el("div", { class: "section-label span2" }, "Request a chain"));
    var nameInput = el("input", { class: "input", name: "rq_chain", placeholder: "Restaurant / chain name", type: "text", required: "required" });
    form.appendChild(field("Restaurant", nameInput, "span2"));
    var noteInput = el("textarea", { class: "input", name: "rq_note", placeholder: "Anything that helps — location, specific items…", rows: "2" });
    form.appendChild(field("Note (optional)", noteInput, "span2"));
    form.appendChild(el("div", { class: "span2 form-actions" }, [
      el("button", { class: "btn primary", type: "submit" }, "Submit request")
    ]));
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var cur = window.MM.map.getCurrent();
      window.MM.data.submitRequest({
        chain: nameInput.value.trim(), note: noteInput.value.trim(),
        lat: cur ? cur.lat : null, lng: cur ? cur.lng : null
      }).then(function () {
        ui.toast("Request submitted — thank you!", "ok");
        renderRequests();
      }).catch(function (e) { ui.toast(e.message, "err"); });
    });
    root.appendChild(form);

    // existing requests
    var reqs = window.MM.store.getRequests().slice().reverse();
    var listCard = el("div", { class: "card" });
    listCard.appendChild(el("div", { class: "section-label" }, "Your requests (" + reqs.length + ")"));
    if (!reqs.length) {
      listCard.appendChild(emptyHint("No requests yet."));
    } else {
      reqs.forEach(function (r) {
        listCard.appendChild(el("div", { class: "req-row" }, [
          el("div", null, [
            el("div", { class: "item-name" }, r.chain),
            el("div", { class: "muted small" }, (r.note ? r.note + " · " : "") + prettyDateTime(r.date))
          ]),
          ui.badge("Submitted", "muted")
        ]));
      });
    }
    root.appendChild(listCard);
  }

  /* =====================================================================
   *  ADMIN VIEW (owner only)
   * ===================================================================== */

  function renderAdmin() {
    var root = document.getElementById("view-admin");
    ui.clear(root);
    root.appendChild(header("Admin", "Requests and feedback from your users.",
      el("button", { class: "btn small ghost", onclick: renderAdmin }, "Refresh")));

    if (!window.MM.data.isAdmin()) {
      root.appendChild(noticeCard("Owner only", "Sign in with the admin account to view requests and feedback.",
        "Back to Tracker", function () { navigate("tracker"); }));
      return;
    }

    function makeSection(label, id, startCollapsed, badge) {
      var collapsed = startCollapsed;
      var chevron = el("span", { class: "collapsible-chevron" }, collapsed ? "▶" : "▼");
      var labelParts = [chevron, label];
      if (badge) { labelParts.push(badge); }
      var head = el("div", { class: "section-label collapsible-head" }, labelParts);
      var body = el("div", { id: id, class: "collapsible-body" + (collapsed ? " collapsed" : "") }, [emptyHint("Loading…")]);
      head.addEventListener("click", function () {
        collapsed = !collapsed;
        chevron.textContent = collapsed ? "▶" : "▼";
        body.classList.toggle("collapsed", collapsed);
      });
      var card = el("div", { class: "card" });
      card.appendChild(head);
      card.appendChild(body);
      return card;
    }

    var reqBadge = el("span", { class: "badge warn", style: "display:none;margin-left:8px;vertical-align:middle" });
    var uploadsCard = makeSection("Upload history", "admin-uploads", true);
    var reqCard = makeSection("Chain requests", "admin-requests", true, reqBadge);
    var fbCard = makeSection("Feedback", "admin-feedback", false);

    root.appendChild(uploadCard());
    root.appendChild(uploadsCard);
    root.appendChild(reqCard);
    root.appendChild(fbCard);
    root.appendChild(macroCheckerCard());

    refreshUploadLog();

    window.MM.data.fetchRequests().then(function (rows) {
      var host = document.getElementById("admin-requests"); if (!host) return;
      ui.clear(host);
      if (!rows || !rows.length) { host.appendChild(emptyHint("No requests yet.")); return; }
      // open ones first
      rows.sort(function (a, b) { return (a.status === "open" ? 0 : 1) - (b.status === "open" ? 0 : 1); });
      rows.forEach(function (r) { host.appendChild(adminRequestRow(r)); });
      var openCount = rows.filter(function (r) { return r.status === "open"; }).length;
      if (openCount > 0) { reqBadge.textContent = openCount + " open"; reqBadge.style.display = ""; }
    }).catch(function (e) { adminError("admin-requests", e); });

    window.MM.data.fetchFeedback().then(function (rows) {
      var host = document.getElementById("admin-feedback"); if (!host) return;
      ui.clear(host);
      if (!rows || !rows.length) { host.appendChild(emptyHint("No feedback yet.")); return; }
      rows.forEach(function (f) { host.appendChild(adminFeedbackRow(f)); });
    }).catch(function (e) { adminError("admin-feedback", e); });
  }

  function adminError(hostId, e) {
    var host = document.getElementById(hostId); if (!host) return;
    ui.clear(host);
    var msg = /relation|schema cache|404|does not exist/i.test(e.message || "")
      ? "Table not found — run supabase/admin-schema.sql to grant admin access."
      : "Couldn't load: " + (e.message || "error");
    host.appendChild(emptyHint(msg));
  }

  /* ---- admin: macro sanity checker ---- */
  function macroCheckerCard() {
    var m = window.MM.macros;
    var card = el("div", { class: "card" });
    var collapsed = false;
    var chevron = el("span", { class: "collapsible-chevron" }, "▼");
    var head = el("div", { class: "section-label collapsible-head" }, [chevron, "Macro calculator checker"]);
    head.addEventListener("click", function () {
      collapsed = !collapsed;
      chevron.textContent = collapsed ? "▶" : "▼";
      body.classList.toggle("collapsed", collapsed);
    });
    card.appendChild(head);
    var body = el("div", { class: "collapsible-body" });
    body.appendChild(el("p", { class: "muted small" },
      "Enter any profile to see macro targets across all focus × goal combinations. Use this to sanity-check the calculation logic."));

    // inputs
    var ageIn    = el("input",  { type: "number", class: "input", value: "30", min: "15", max: "80", style: "width:70px" });
    var weightIn = el("input",  { type: "number", class: "input", value: "170", min: "80", max: "600", style: "width:80px" });
    var sexSel   = el("select", { class: "input", style: "width:100px" }, [
      el("option", { value: "male" },   "Male"),
      el("option", { value: "female" }, "Female")
    ]);
    var actSel   = el("select", { class: "input", style: "width:190px" });
    Object.keys(m.ACTIVITY).forEach(function (k) {
      actSel.appendChild(el("option", { value: k }, m.ACTIVITY[k].label));
    });
    actSel.value = "moderate";

    var tableWrap = el("div", { style: "overflow-x:auto;margin-top:12px" });

    function rebuild() {
      var age    = parseInt(ageIn.value, 10)    || 30;
      var wLb    = parseFloat(weightIn.value)   || 170;
      var sex    = sexSel.value;
      var act    = actSel.value;
      var wkg    = m.lbToKg(wLb);
      var hcm    = sex === "female" ? 163 : 178; // neutral height

      var GOALS  = ["lose", "maintain", "gain"];
      var FOCUSES = Object.keys(m.FOCUS);

      // header row: one column per goal
      var thCells = [el("th", null, "Focus")];
      GOALS.forEach(function (g) {
        thCells.push(el("th", { colspan: "4", style: "text-align:center;border-left:2px solid var(--border)" },
          m.GOALS[g].label));
      });

      // subheader
      var subCells = [el("th", null, "")];
      GOALS.forEach(function () {
        ["kcal","prot","carb","fat"].forEach(function (lbl) {
          subCells.push(el("th", { class: "muted small", style: "min-width:46px;text-align:right" + (lbl === "kcal" ? ";border-left:2px solid var(--border)" : "") }, lbl));
        });
      });

      var rows = [el("tr", null, thCells), el("tr", null, subCells)];

      FOCUSES.forEach(function (fk) {
        var cells = [el("td", { style: "white-space:nowrap;font-weight:500" }, m.FOCUS[fk].label)];
        GOALS.forEach(function (gk) {
          var t = m.compute({ sex: sex, weightKg: wkg, heightCm: hcm, age: age,
                              activity: act, goal: gk, rate: "0.5", focus: fk });
          var pPct = Math.round(t.protein * 4 / t.kcal * 100);
          var warn  = pPct > 40 || pPct < 15;
          var style = "text-align:right" + (warn ? ";color:var(--warn)" : "");
          var bstyle = "text-align:right;border-left:2px solid var(--border)";
          cells.push(el("td", { style: bstyle }, String(t.kcal)));
          cells.push(el("td", { style: style  }, t.protein + "g"));
          cells.push(el("td", { style: "text-align:right" }, t.carbs + "g"));
          cells.push(el("td", { style: "text-align:right" }, t.fat + "g"));
        });
        rows.push(el("tr", null, cells));
      });

      var gpkg = el("div", { class: "muted small", style: "margin-top:6px" },
        "At " + wLb + " lb (" + wkg.toFixed(1) + " kg) — protein g/kg shown: " +
        Object.keys(m.FOCUS).map(function (fk) {
          var t = m.compute({ sex: sex, weightKg: wkg, heightCm: hcm, age: age,
                              activity: act, goal: "maintain", rate: "0.5", focus: fk });
          return fk + " " + (t.protein / wkg).toFixed(2);
        }).join(" · "));

      ui.clear(tableWrap);
      tableWrap.appendChild(el("table", { style: "border-collapse:collapse;font-size:13px;width:100%" }, rows));
      tableWrap.appendChild(gpkg);
    }

    var controls = el("div", { style: "display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:8px" }, [
      el("label", { class: "muted small" }, "Age"),   ageIn,
      el("label", { class: "muted small" }, "Weight (lb)"), weightIn,
      el("label", { class: "muted small" }, "Sex"),   sexSel,
      el("label", { class: "muted small" }, "Activity"), actSel,
      el("button", { class: "btn small primary", onclick: rebuild }, "Recalculate")
    ]);

    body.appendChild(controls);
    body.appendChild(tableWrap);
    card.appendChild(body);
    rebuild();
    return card;
  }

  var STATUS_CLS = { open: "warn", added: "ok", declined: "muted" };
  function adminRequestRow(r) {
    var status = r.status || "open";

    var actions = el("div", { class: "admin-actions" }, [
      status !== "added" ? el("button", { class: "btn small primary", onclick: function () { setReqStatus(r.id, "added"); } }, "Mark added") : null,
      status !== "declined" ? el("button", { class: "btn small ghost", onclick: function () { setReqStatus(r.id, "declined"); } }, "Decline") : null,
      status !== "open" ? el("button", { class: "btn small ghost", onclick: function () { setReqStatus(r.id, "open"); } }, "Reopen") : null
    ]);
    return el("div", { class: "admin-row" }, [
      el("div", { class: "admin-main" }, [
        el("div", { class: "item-name" }, [r.chain, " ", ui.badge(status, STATUS_CLS[status] || "muted")]),
        el("div", { class: "muted small" }, (r.note ? r.note + " · " : "") + prettyDateTime(r.created_at))
      ]),
      actions
    ]);
  }

  function setReqStatus(id, status) {
    window.MM.data.updateRequestStatus(id, status)
      .then(function () { ui.toast("Marked " + status, "ok"); renderAdmin(); })
      .catch(function (e) { ui.toast(e.message, "err"); });
  }

  /* ---- admin: bulk nutrition upload ---- */
  function uploadCard() {
    var card = el("div", { class: "card" });
    var collapsed = false;
    var chevron = el("span", { class: "collapsible-chevron" }, "▼");
    var head = el("div", { class: "list-head collapsible-head" }, [
      el("strong", null, [chevron, "Upload nutrition data"]),
      el("a", { class: "btn small ghost", href: "data/menu_template.csv", download: "macromap_menu_template.csv" }, "⬇ Template")
    ]);
    var body = el("div", { class: "collapsible-body" });
    body.appendChild(el("p", { class: "muted small" },
      "Upload a CSV or Excel file matching the template. The file is validated first — if any item is duplicated in the file or already exists in the database, nothing is added and you'll see what to fix."));
    body.appendChild(el("p", { class: "muted small", html:
      "<b>Required columns:</b> chain_id, chain_name, name, kcal, protein, carbs, fat, sodium, fiber, sugar. " +
      "<b>Optional:</b> chain_color, match, category (safe to leave blank)." }));

    var fileIn = el("input", { type: "file", class: "input file-input", accept: ".csv,.xlsx,.xls,text/csv" });
    fileIn.multiple = true;
    var btn = el("button", { class: "btn primary", type: "button" }, "Upload & process");
    var status = el("div", { class: "upload-status" });

    btn.addEventListener("click", function () {
      var files = fileIn.files && fileIn.files.length ? Array.from(fileIn.files) : [];
      if (!files.length) { ui.toast("Choose a file first", "err"); return; }
      btn.disabled = true;

      var results = [], errors = [];
      var idx = 0;

      function processNext() {
        if (idx >= files.length) {
          fileIn.value = "";
          btn.disabled = false;
          window.MM.data.loadNutrition(function () {});
          refreshUploadLog();
          if (errors.length) {
            status.className = "upload-status err";
            status.textContent = errors.join(" | ");
          } else {
            status.className = "upload-status ok";
            status.textContent = "✅ " + results.join(" | ");
          }
          return;
        }
        var f = files[idx];
        status.className = "upload-status busy";
        status.textContent = "Processing " + f.name + " (" + (idx + 1) + "/" + files.length + ")…";
        window.MM.data.uploadNutrition(f).then(function (sum) {
          results.push(sum.chains + ": " + sum.item_count + " items");
          idx++;
          processNext();
        }).catch(function (e) {
          errors.push(f.name + ": " + (e.message || "failed"));
          idx++;
          processNext();
        });
      }

      processNext();
    });

    body.appendChild(el("div", { class: "upload-row" }, [fileIn, btn]));
    body.appendChild(status);

    head.addEventListener("click", function (e) {
      if (e.target.tagName === "A" || (e.target.closest && e.target.closest("a"))) return;
      collapsed = !collapsed;
      chevron.textContent = collapsed ? "▶" : "▼";
      body.classList.toggle("collapsed", collapsed);
    });

    card.appendChild(head);
    card.appendChild(body);
    return card;
  }

  function refreshUploadLog() {
    window.MM.data.fetchUploadLog().then(function (rows) {
      var host = document.getElementById("admin-uploads"); if (!host) return;
      ui.clear(host);
      if (!rows || !rows.length) { host.appendChild(emptyHint("No uploads yet.")); return; }
      rows.forEach(function (u) { host.appendChild(adminUploadRow(u)); });
    }).catch(function (e) { adminError("admin-uploads", e); });
  }

  function adminUploadRow(u) {
    return el("div", { class: "admin-row" }, [
      el("div", { class: "admin-main" }, [
        el("div", { class: "item-name" }, [
          (u.uploader_email || "unknown"), " ",
          ui.badge(u.item_count + " items · " + u.chain_count + " chains", "ok")
        ]),
        el("div", { class: "muted small" }, prettyDateTime(u.created_at) + (u.filename ? " · " + u.filename : "")),
        u.chains ? el("div", { class: "muted small upload-chains" }, u.chains) : null
      ])
    ]);
  }

  function adminFeedbackRow(f) {
    return el("div", { class: "admin-row" }, [
      el("div", { class: "admin-main" }, [
        el("div", { class: "item-name" }, [
          ui.badge(f.category || "general", "muted"), " ",
          el("span", { class: "muted small" }, prettyDateTime(f.created_at) + (f.context ? " · " + f.context : ""))
        ]),
        el("div", { class: "fb-msg" }, f.message)
      ])
    ]);
  }

  /* ------------------------------------------------------ small builders */

  function header(title, sub, help) {
    return el("div", { class: "view-header" }, [
      el("div", { class: "view-header-row" }, [el("h2", null, title), help || null]),
      sub ? el("p", { class: "muted" }, sub) : null
    ]);
  }
  // A small "?" button that opens an explanatory modal.
  function helpBtn(title, bodyNode) {
    return el("button", {
      class: "help-btn", "aria-label": "How this works", title: "How this works",
      onclick: function () { ui.modal(title, bodyNode, [{ label: "Got it", kind: "primary" }]); }
    }, "?");
  }
  function field(label, control, cls) {
    return el("div", { class: "field " + (cls || "") }, [el("label", null, label), control]);
  }
  function numInput(name, value, min, max, placeholder) {
    return el("input", { class: "input", type: "number", name: name, value: value === "" || value == null ? null : value, min: min, max: max, placeholder: placeholder || "", step: "1" });
  }
  function select(name, options, selected, onchange) {
    var s = el("select", { class: "input", name: name });
    options.forEach(function (o) {
      var opt = el("option", { value: o.v }, o.label);
      if (String(o.v) === String(selected)) opt.setAttribute("selected", "selected");
      s.appendChild(opt);
    });
    if (onchange) s.addEventListener("change", onchange);
    return s;
  }
  function segmented(name, options, selected, onchange) {
    var wrap = el("div", { class: "segmented" });
    options.forEach(function (o) {
      var id = name + "-" + o.v;
      var input = el("input", { type: "radio", name: name, id: id, value: o.v });
      if (o.v === selected) input.setAttribute("checked", "checked");
      input.addEventListener("change", onchange);
      wrap.appendChild(input);
      wrap.appendChild(el("label", { for: id }, o.label));
    });
    return wrap;
  }
  function bigStat(value, label, cls) {
    return el("div", { class: "big-stat " + cls }, [
      el("div", { class: "big-num" }, value),
      el("div", { class: "big-label" }, label)
    ]);
  }
  function microStat(label, value) {
    return el("div", { class: "micro-stat" }, [
      el("div", { class: "micro-num" }, value),
      el("div", { class: "micro-label" }, label)
    ]);
  }
  function googleIcon() {
    return el("span", { class: "g-icon", html:
      "<svg viewBox='0 0 18 18' width='17' height='17' xmlns='http://www.w3.org/2000/svg'>" +
      "<path fill='#4285F4' d='M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.71-1.57 2.68-3.88 2.68-6.62z'/>" +
      "<path fill='#34A853' d='M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z'/>" +
      "<path fill='#FBBC05' d='M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z'/>" +
      "<path fill='#EA4335' d='M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z'/>" +
      "</svg>" });
  }
  function emptyHint(text) { return el("div", { class: "empty-hint" }, text); }

  // ----- help content -----
  function recommendHelp() {
    return el("div", { class: "help-body" }, [
      el("p", null, "Every nearby item gets a fit score (higher = better) based on how well it matches what you still have room for today."),
      el("p", { class: "section-label" }, "What goes into the score"),
      el("ul", null, [
        el("li", { html: "<b>Protein per calorie</b> — the biggest factor. More protein for fewer calories scores higher (shown as “g protein / 100 cal”)." }),
        el("li", { html: "<b>Fits your remaining calories</b> — items that use a sensible share of the calories you have left score well; going over is penalized." }),
        el("li", { html: "<b>Covers protein left</b> — items that help close your remaining protein gap get a boost." }),
        el("li", { html: "<b>Carb / fat budgets, meal size & your “Prioritize” choice</b> — nudge the score up or down." })
      ]),
      el("p", { class: "section-label" }, "Badges" ),
      el("p", { html: "<b>Fits remaining calories</b> means the item is at or under the calories you have left today (target minus what you've logged). <b>High protein per calorie</b> flags especially efficient picks." }),
      el("p", { class: "muted small" }, "Scores are a guide to compare options, not an exact grade.")
    ]);
  }
  function menuHelp() {
    return el("div", { class: "help-body" }, [
      el("p", { html: "<b>“… cal left after”</b> shows where an item puts you against the calories you have left today (your target minus what you've already logged). If it would put you over, it shows how far." }),
      el("p", { html: "<b>Sort by “protein per calorie”</b> ranks items by how much protein you get per calorie — handy for high-protein, lower-calorie picks." }),
      el("p", { html: "Flags: <b>High protein</b> (efficient protein), <b>Lower cal</b> (≤ 400 cal), plus <b>High sodium / sugar</b> warnings." }),
      el("p", { html: "Tick <b>Compare</b> on a few items to see them side by side, including how each affects your remaining calories." })
    ]);
  }
  function noticeCard(title, body, btn, onClick) {
    var children = [el("h3", null, title), el("p", { class: "muted" }, body)];
    if (btn) children.push(el("button", { class: "btn primary", onclick: onClick }, btn));
    return el("div", { class: "card notice" }, children);
  }
  function numOrNull(scope, name) {
    var v = scope.querySelector('[name="' + name + '"]').value;
    return v === "" ? null : (+v);
  }
  function prettyDate(key) {
    var d = new Date(key + "T00:00:00");
    return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  }
  function prettyDateTime(iso) {
    try { return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" }); }
    catch (e) { return ""; }
  }

  /* =====================================================================
   *  ACCOUNT / AUTH UI
   * ===================================================================== */

  // Re-run the active view's render (used after a cloud sync replaces state).
  function refreshCurrent() {
    var v = state.view;
    if (v === "profile") renderProfile();
    else if (v === "menu") renderMenu();
    else if (v === "tracker") renderTracker();
    else if (v === "requests") renderRequests();
    else if (v === "admin") renderAdmin();
    renderNavBadge();
  }

  function renderAccount(status) {
    var host = document.getElementById("account");
    if (!host) return;
    ui.clear(host);

    if (!status.enabled) {
      // Cloud accounts not configured — make the local-only nature visible.
      host.appendChild(el("button", {
        class: "acct-chip local", title: "Your data is saved in this browser. Add a Supabase project in config.js to enable accounts & sync.",
        onclick: function () {
          ui.modal("Local mode", el("div", null, [
            el("p", null, "Your profile, targets and food log are saved in this browser via localStorage — no account needed, and it persists across sessions on this device."),
            el("p", { class: "muted small" }, "To sync across devices, create a free Supabase project, run supabase/schema.sql, and paste your URL + anon key into js/config.js. The app will show sign-in automatically.")
          ]), [{ label: "Got it", kind: "primary" }]);
        }
      }, "💾 Local"));
      return;
    }

    if (status.user) {
      var email = status.user.email || "Account";
      var initial = email[0] ? email[0].toUpperCase() : "•";
      host.appendChild(el("button", {
        class: "acct-chip user", title: email,
        onclick: function () {
          ui.modal("Account", el("div", null, [
            el("p", null, ["Signed in as ", el("strong", null, email), "."]),
            el("p", { class: "muted small" }, "Your data syncs automatically to your account. Last-write-wins across devices.")
          ]), [
            { label: "Sign out", kind: "danger", onClick: function () {
              window.MM.auth.signOut().then(function () { ui.toast("Signed out"); });
            } },
            { label: "Close", kind: "ghost" }
          ]);
        }
      }, [el("span", { class: "avatar" }, initial), el("span", { class: "acct-email" }, email)]));
    } else {
      host.appendChild(el("button", { class: "btn small primary", onclick: openAuthModal }, "Sign in"));
    }
  }

  function openAuthModal() {
    var mode = "signin";
    var emailIn = el("input", { class: "input", type: "email", placeholder: "you@example.com", autocomplete: "email", required: "required" });
    var pwIn = el("input", { class: "input", type: "password", placeholder: "Password (min 6 characters)", autocomplete: "current-password", minlength: "6", required: "required" });
    var msg = el("div", { class: "auth-msg" });
    var submitBtn = el("button", { class: "btn primary", type: "submit" }, "Sign in");
    var toggle = el("button", { class: "btn ghost small", type: "button" });

    var googleBtn = el("button", { class: "btn google", type: "button" }, [googleIcon(), el("span", null, "Continue with Google")]);
    googleBtn.addEventListener("click", function () {
      msg.textContent = ""; msg.className = "auth-msg";
      googleBtn.disabled = true;
      window.MM.auth.signInWithGoogle().catch(function (err) {
        showMsg(err.message || "Google sign-in isn't available. Enable the Google provider in Supabase.", true);
        googleBtn.disabled = false;
      });
    });

    var form = el("form", { class: "auth-form" }, [
      googleBtn,
      el("div", { class: "auth-divider" }, el("span", null, "or use email")),
      field("Email", emailIn),
      field("Password", pwIn),
      msg,
      el("div", { class: "form-actions" }, [submitBtn, toggle])
    ]);

    function applyMode() {
      var signin = mode === "signin";
      submitBtn.textContent = signin ? "Sign in" : "Create account";
      toggle.textContent = signin ? "Need an account? Create one" : "Have an account? Sign in";
      pwIn.setAttribute("autocomplete", signin ? "current-password" : "new-password");
      msg.textContent = "";
      msg.className = "auth-msg";
    }
    toggle.addEventListener("click", function () { mode = mode === "signin" ? "signup" : "signin"; applyMode(); });
    applyMode();

    var close = ui.modal("Welcome to Macro Map", form, [{ label: "Cancel", kind: "ghost" }]);

    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var email = emailIn.value.trim();
      var pw = pwIn.value;
      if (!email || pw.length < 6) { showMsg("Enter an email and a password of at least 6 characters.", true); return; }
      submitBtn.disabled = true;
      submitBtn.textContent = mode === "signin" ? "Signing in…" : "Creating…";

      var p = mode === "signin" ? window.MM.auth.signIn(email, pw) : window.MM.auth.signUp(email, pw);
      p.then(function (res) {
        if (mode === "signup" && res && res.needsConfirmation) {
          mode = "signin"; applyMode();
          showMsg("Account created. Check your email to confirm, then sign in.", false);
          submitBtn.disabled = false;
          return;
        }
        close(); // onAuthStateChange will sync + refresh the UI
      }).catch(function (err) {
        showMsg(err.message || "Something went wrong.", true);
        submitBtn.disabled = false;
        applyModeKeepMsg();
      });
    });

    function showMsg(text, isErr) { msg.textContent = text; msg.className = "auth-msg " + (isErr ? "err" : "ok"); }
    function applyModeKeepMsg() { submitBtn.textContent = mode === "signin" ? "Sign in" : "Create account"; }
  }

  /* ------------------------------------------------------------- feedback */

  function openFeedbackModal() {
    var cat = select("fb_cat", [
      { v: "general", label: "General feedback" },
      { v: "idea", label: "Feature idea" },
      { v: "bug", label: "Bug report" }
    ], "general");
    var msg = el("textarea", { class: "input", rows: "4", maxlength: "1000",
      placeholder: "What's working, what's not, what you'd love to see…" });
    var note = el("div", { class: "auth-msg" });
    var body = el("div", { class: "form-grid" }, [
      field("Type", cat, "span2"),
      field("Your feedback", msg, "span2"),
      note
    ]);
    var close = ui.modal("Send feedback", body, [
      { label: "Cancel", kind: "ghost" },
      { label: "Send", kind: "primary", onClick: function () {
        window.MM.data.submitFeedback({ message: msg.value, category: cat.value, context: state.view })
          .then(function () { ui.toast("Thanks for the feedback!", "ok"); close(); })
          .catch(function (e) { note.textContent = e.message; note.className = "auth-msg err"; });
        return true; // keep open; close manually on success
      } }
    ]);
  }

  /* ------------------------------------------------------------- bootstrap */

  function start() {
    renderNav();
    var landing = !window.MM.store.getProfile() ? "onboarding"
      : (state.view === "onboarding" ? "tracker" : "tracker");
    navigate(landing);
    renderNavBadge();

    // Wire up accounts/sync. onState fires on init and on every auth change;
    // after a login pull replaces local state, refresh whatever view is open.
    window.MM.auth.onState(function (status) {
      renderAccount(status);
      renderNav(); // show/hide the Admin tab as auth changes
      if (state.view === "admin" && !window.MM.data.isAdmin()) { navigate("tracker"); return; }
      refreshCurrent();
    });
    window.MM.auth.init();

    // Pull the nutrition database from Supabase. Refresh data-dependent views
    // when it arrives; show an error in those views if the load fails.
    window.MM.data.loadNutrition(function () {
      nutritionError = null;
      if (state.view === "menu" || state.view === "onboarding") refreshCurrent();
    }).catch(function (e) {
      nutritionError = e.message || "Couldn't reach the server.";
      if (state.view === "menu") refreshCurrent();
    });

    var fb = document.getElementById("feedback-link");
    if (fb) fb.addEventListener("click", openFeedbackModal);

    // Register the service worker for offline support + installability (PWA).
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("sw.js").catch(function (e) {
        console.warn("Macro Map: service worker registration failed.", e);
      });
    }

    setupInstall();
  }

  /* ------------------------------------------------------------- PWA install */

  // "Install app" button in the top bar. Uses the native beforeinstallprompt
  // flow where supported (Chrome/Edge/Android); elsewhere (notably iOS Safari)
  // it opens platform-specific "add to home screen" instructions. Hidden once
  // the app is already installed / running standalone.
  function setupInstall() {
    var btn = document.getElementById("install-btn");
    if (!btn) return;

    var standalone = (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) ||
      window.navigator.standalone === true;
    if (standalone) return; // already installed — leave it hidden

    installBtnRef = btn; // hand the button to the early install listeners

    var ua = navigator.userAgent || "";
    var isIOS = /iphone|ipad|ipod/i.test(ua) ||
      (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1); // iPadOS reports as Mac

    // The prompt may already have fired before boot; iOS never fires it at all.
    if (deferredInstallPrompt || isIOS) btn.classList.remove("hidden");

    btn.addEventListener("click", function () {
      if (deferredInstallPrompt) {
        deferredInstallPrompt.prompt();
        deferredInstallPrompt.userChoice.then(function (res) {
          if (res && res.outcome === "accepted") btn.classList.add("hidden");
          deferredInstallPrompt = null;
        });
      } else {
        showInstallHelp(isIOS);
      }
    });
  }

  function showInstallHelp(isIOS) {
    var body;
    if (isIOS) {
      body = el("div", { class: "help-body" }, [
        el("p", null, "To install Macro Map on your iPhone or iPad:"),
        el("ol", null, [
          el("li", { html: "Open this page in <b>Safari</b> (install isn't available in Chrome/Firefox on iOS)." }),
          el("li", { html: "Tap the <b>Share</b> button (the square with an up-arrow)." }),
          el("li", { html: "Scroll down and tap <b>Add to Home Screen</b>." }),
          el("li", { html: "Tap <b>Add</b> — Macro Map will appear as an app icon." })
        ])
      ]);
    } else {
      body = el("div", { class: "help-body" }, [
        el("p", null, "Your browser didn't offer a one-tap install. You can still add Macro Map as an app:"),
        el("ul", null, [
          el("li", { html: "<b>Chrome / Edge (desktop):</b> click the install icon in the address bar, or menu (⋮) → “Install Macro Map”." }),
          el("li", { html: "<b>Chrome (Android):</b> menu (⋮) → “Add to Home screen” / “Install app”." }),
          el("li", { html: "<b>Safari (Mac):</b> File → “Add to Dock”." })
        ]),
        el("p", { class: "muted small" }, "Tip: Chrome and Edge offer the smoothest one-tap install.")
      ]);
    }
    ui.modal("Install Macro Map", body, [{ label: "Got it", kind: "primary" }]);
  }

  /* =====================================================================
   *  ONBOARDING WIZARD (new users only — shown when no profile exists)
   * ===================================================================== */

  function renderOnboarding() {
    var root = document.getElementById("view-onboarding");
    if (!root) return;
    ui.clear(root);
    var step = parseInt(localStorage.getItem("mm_onboarding_step") || "0", 10);
    var m = window.MM.macros;

    function goStep(n) { localStorage.setItem("mm_onboarding_step", String(n)); renderOnboarding(); }

    function stepHeader(num, title, sub, actions) {
      var children = [
        el("div", { class: "onboard-steps" },
          [1, 2, 3].map(function (i) {
            return el("div", { class: "onboard-dot" + (i === num ? " active" : i < num ? " done" : "") });
          })
        ),
        el("strong", null, "Step " + num + " of 3 — " + title),
        el("p", { class: "muted small", style: "margin:4px 0 0" }, sub)
      ];
      if (actions) children.push(el("div", { class: "form-actions", style: "margin-top:12px" }, actions));
      return el("div", { class: "onboard-discover-bar card" }, children);
    }

    if (step === 0) {
      var defaults = {
        age: 30, sex: "male", heightCm: 178, weightKg: m.lbToKg(175),
        units: "imperial", activity: "moderate", goal: "lose", rate: "0.5", focus: "fat_loss"
      };
      function skipStep1() {
        window.MM.store.setProfile(defaults);
        window.MM.store.setTargets(m.compute(defaults));
        goStep(2);
      }
      root.appendChild(stepHeader(1, "Set your goals",
        "Tell us about yourself and we'll calculate your daily calorie and macro targets.",
        [
          el("button", { class: "btn primary", type: "button", onclick: function () {
            document.getElementById("profile-form").requestSubmit();
          }}, "Next →"),
          el("button", { class: "btn ghost", type: "button", onclick: skipStep1 }, "Skip setup")
        ]
      ));
      root.appendChild(buildProfileForm(defaults, {
        submitLabel: "Next →",
        noActions: true,
        onSubmit: function (prof) {
          window.MM.store.setProfile(prof);
          window.MM.store.setTargets(m.compute(prof));
          goStep(1);
        }
      }));

    } else if (step === 1) {
      // Step 2 uses the real Discover view (map is a singleton, can't be embedded).
      // Navigate there and inject an onboarding progress banner at the top.
      navigate("discover");
      var discoverEl = document.getElementById("view-discover");
      if (!discoverEl.querySelector(".onboard-discover-bar")) {
        function finishStep2() {
          var bar = discoverEl.querySelector(".onboard-discover-bar");
          if (bar) bar.remove();
          goStep(2);
          navigate("onboarding");
        }
        var bar = el("div", { class: "onboard-discover-bar card" }, [
          el("div", { class: "onboard-steps" }, [
            el("span", { class: "onboard-dot done" }),
            el("span", { class: "onboard-dot active" }),
            el("span", { class: "onboard-dot" })
          ]),
          el("strong", null, "Step 2 of 3 — Find restaurants near you"),
          el("p", { class: "muted small", style: "margin:4px 0 12px" },
            "Use your location or search an address to find nearby chains. When you're ready, tap Done."),
          el("div", { class: "form-actions" }, [
            el("button", { class: "btn primary", onclick: finishStep2 }, "Next →"),
            el("button", { class: "btn ghost", onclick: finishStep2 }, "Skip")
          ])
        ]);
        discoverEl.insertBefore(bar, discoverEl.firstChild);
      }

    } else {
      function finishOnboarding() {
        localStorage.removeItem("mm_onboarding_step");
        filters.recMode = true;
        saveFilter("mm_rec_mode", true);
        navigate("menu");
      }
      root.appendChild(stepHeader(3, "You're all set! 🎉", "Here are your daily targets.",
        [el("button", { class: "btn primary", onclick: finishOnboarding }, "Done →")]
      ));

      var tg = window.MM.store.getTargets();
      if (tg) root.appendChild(targetsCard(tg, window.MM.store.getProfile()));

      if (window.MM.NUTRITION && window.MM.NUTRITION.length) {
        var nearbyChainIds = availableChainIds();
        var ids = nearbyChainIds.length ? nearbyChainIds : null;
        var rem2 = remaining();
        var ranked = window.MM.recommend.rank(rem2, window.MM.recommend.PRESETS.fits_remaining.opts, ids, 3);
        if (ranked.length) {
          var previewCard = el("div", { class: "card" });
          previewCard.appendChild(el("div", { class: "section-label" }, "Top picks for you right now"));
          ranked.forEach(function (it, i) { previewCard.appendChild(recCard(it, i + 1)); });
          root.appendChild(previewCard);
        }
      }

    }
  }

  return {
    start: start,
    navigate: navigate,
    addToLog: addToLog,
    remaining: remaining,
    totals: totals,
    state: state
  };
})();

document.addEventListener("DOMContentLoaded", function () { window.MM.app.start(); });
