/* Macro Map — calorie & macro target calculation.
 *
 * BMR via Mifflin–St Jeor, scaled by an activity multiplier to TDEE, then
 * adjusted for the user's weight goal and rate. Macro split is chosen from the
 * user's fitness focus, with protein anchored to body weight where it matters.
 */
window.MM = window.MM || {};

window.MM.macros = (function () {

  var ACTIVITY = {
    sedentary:   { mult: 1.2,   label: "Sedentary (little/no exercise)" },
    light:       { mult: 1.375, label: "Light (1–3 days/week)" },
    moderate:    { mult: 1.55,  label: "Moderate (3–5 days/week)" },
    active:      { mult: 1.725, label: "Active (6–7 days/week)" },
    very_active: { mult: 1.9,   label: "Very active (hard daily training/physical job)" }
  };

  var GOALS = {
    lose:     { label: "Lose weight",     dir: -1 },
    maintain: { label: "Maintain weight", dir: 0 },
    gain:     { label: "Gain weight",     dir: 1 }
  };

  // Rate in lbs/week -> kcal/day adjustment (~3500 kcal per lb / 7 days = 500).
  var RATES = {
    "0.25": { label: "0.25 lb / week (slow & steady)", kcal: 125 },
    "0.5":  { label: "0.5 lb / week (recommended)",    kcal: 250 },
    "1":    { label: "1 lb / week (aggressive)",       kcal: 500 },
    "1.5":  { label: "1.5 lb / week (very aggressive)",kcal: 750 }
  };

  // Fitness focus -> carb/fat ratio for non-protein calories, plus protein in g/kg body weight.
  // c and f are only used as a ratio (c : f) to split remaining calories after protein is set.
  // proteinPerLbmKg is used when the user supplies a body fat % (Katch-McArdle path).
  var FOCUS = {
    fat_loss:   { label: "Fat loss / cutting",        c: 0.50, f: 0.50, proteinPerKg: 2.2, proteinPerLbmKg: 2.5 },
    muscle:     { label: "Build muscle",              c: 0.65, f: 0.35, proteinPerKg: 1.8, proteinPerLbmKg: 2.0 },
    recomp:     { label: "Body recomposition",        c: 0.55, f: 0.45, proteinPerKg: 2.0, proteinPerLbmKg: 2.3 },
    endurance:  { label: "Endurance / activity",      c: 0.73, f: 0.27, proteinPerKg: 1.4, proteinPerLbmKg: 1.6 },
    general:    { label: "General health",            c: 0.60, f: 0.40, proteinPerKg: 1.4, proteinPerLbmKg: 1.6 }
  };

  function lbToKg(lb) { return lb * 0.453592; }
  function inToCm(inch) { return inch * 2.54; }

  // Mifflin–St Jeor BMR. weightKg, heightCm, age years.
  function bmr(sex, weightKg, heightCm, age) {
    var base = 10 * weightKg + 6.25 * heightCm - 5 * age;
    return sex === "female" ? base - 161 : base + 5;
  }

  /* Compute full target recommendation from a profile object.
   * profile: { age, sex, heightCm, weightKg, activity, goal, rate, focus, bodyFatPct? }
   * When bodyFatPct is supplied, uses Katch-McArdle BMR (LBM-based) which is more accurate
   * for body composition goals. Protein is then anchored to lean body mass instead of
   * total weight, which avoids over-prescribing protein for higher body-fat individuals.
   */
  function compute(profile) {
    var lbm = null, b;
    if (profile.bodyFatPct > 0 && profile.bodyFatPct < 100) {
      lbm = profile.weightKg * (1 - profile.bodyFatPct / 100);
      b = 370 + 21.6 * lbm; // Katch-McArdle
    } else {
      b = bmr(profile.sex, profile.weightKg, profile.heightCm, profile.age); // Mifflin-St Jeor
    }
    var mult = (ACTIVITY[profile.activity] || ACTIVITY.moderate).mult;
    var tdee = b * mult;

    var goal = GOALS[profile.goal] || GOALS.maintain;
    var rateKcal = goal.dir === 0 ? 0 : (RATES[profile.rate] || RATES["0.5"]).kcal;
    var kcal = Math.round(tdee + goal.dir * rateKcal);

    // Safety floor so recommendations never go dangerously low.
    var floor = profile.sex === "female" ? 1200 : 1500;
    if (kcal < floor) kcal = floor;

    var focus = FOCUS[profile.focus] || FOCUS.general;

    // Protein anchored to lean body mass when known, otherwise to total weight.
    // Floor: 20% of calories. Cap: 35% of calories.
    var proteinBase = lbm != null ? lbm : profile.weightKg;
    var pPerKg = lbm != null ? focus.proteinPerLbmKg : focus.proteinPerKg;
    var protein = Math.round(
      Math.min(Math.max(pPerKg * proteinBase, kcal * 0.20 / 4), kcal * 0.35 / 4)
    );

    var proteinKcal = protein * 4;
    var remaining = Math.max(kcal - proteinKcal, 0);
    var cShare = focus.c / (focus.c + focus.f);
    var carbs = Math.round((remaining * cShare) / 4);
    var fat = Math.round((remaining * (1 - cShare)) / 9);

    return {
      bmr: Math.round(b),
      tdee: Math.round(tdee),
      kcal: kcal,
      protein: protein,
      carbs: carbs,
      fat: fat,
      manual: false
    };
  }

  /* Returns a plain object describing each step of the calculation for a given
   * profile — used by the Profile tab's "How was this calculated?" panel. */
  function explain(profile) {
    var lbm = null, b, method;
    if (profile.bodyFatPct > 0 && profile.bodyFatPct < 100) {
      lbm = Math.round(profile.weightKg * (1 - profile.bodyFatPct / 100) * 10) / 10;
      b = 370 + 21.6 * lbm;
      method = "katch_mcardle";
    } else {
      b = bmr(profile.sex, profile.weightKg, profile.heightCm, profile.age);
      method = "mifflin";
    }
    var bRound = Math.round(b);
    var act = ACTIVITY[profile.activity] || ACTIVITY.moderate;
    var tdee = Math.round(b * act.mult);
    var goal = GOALS[profile.goal] || GOALS.maintain;
    var rateObj = RATES[profile.rate] || RATES["0.5"];
    var rateKcal = goal.dir === 0 ? 0 : rateObj.kcal;
    var kcalRaw = Math.round(tdee + goal.dir * rateKcal);
    var floor = profile.sex === "female" ? 1200 : 1500;
    var kcal = Math.max(kcalRaw, floor);
    var focus = FOCUS[profile.focus] || FOCUS.general;
    var proteinKg = lbm != null ? lbm : profile.weightKg;
    var pPerKg = lbm != null ? focus.proteinPerLbmKg : focus.proteinPerKg;
    var pRaw = pPerKg * proteinKg;
    var pMin = kcal * 0.20 / 4;
    var pMax = kcal * 0.35 / 4;
    var protein = Math.round(Math.min(Math.max(pRaw, pMin), pMax));
    var clamped = pRaw < pMin ? "floor" : (pRaw > pMax ? "cap" : null);
    var remKcal = Math.max(kcal - protein * 4, 0);
    var cShare = focus.c / (focus.c + focus.f);
    var cPct = Math.round(cShare * 100);
    return {
      method: method, lbm: lbm, bmr: bRound,
      activityMult: act.mult, activityLabel: act.label,
      tdee: tdee, goalLabel: goal.label, goalDir: goal.dir,
      rateLabel: rateObj.label, rateKcal: rateKcal,
      kcalRaw: kcalRaw, kcal: kcal, floorApplied: kcalRaw < floor, floorValue: floor,
      proteinBasis: lbm != null ? "LBM" : "body weight",
      proteinPerKg: pPerKg, proteinKg: proteinKg,
      proteinRaw: Math.round(pRaw), protein: protein,
      proteinClamped: clamped, proteinMinG: Math.round(pMin), proteinMaxG: Math.round(pMax),
      remainingKcal: remKcal, cPct: cPct, fPct: 100 - cPct,
      carbs: Math.round((remKcal * cShare) / 4),
      fat: Math.round((remKcal * (1 - cShare)) / 9),
      focusLabel: focus.label
    };
  }

  return {
    ACTIVITY: ACTIVITY,
    GOALS: GOALS,
    RATES: RATES,
    FOCUS: FOCUS,
    lbToKg: lbToKg,
    inToCm: inToCm,
    kgToLb: function (kg) { return kg / 0.453592; },
    cmToIn: function (cm) { return cm / 2.54; },
    bmr: bmr,
    compute: compute,
    explain: explain
  };
})();
