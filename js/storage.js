/* Macro Map — persistence layer.
 *
 * Everything is stored in localStorage under a single namespaced root so the
 * user's profile, targets, daily food logs and history survive across sessions
 * on the same browser. All access goes through this module.
 */
window.MM = window.MM || {};

window.MM.store = (function () {
  var KEY = "macromap.v1";

  var defaults = {
    profile: null,        // { age, sex, heightCm, weightKg, units, activity, goal, rate, focus }
    targets: null,        // { kcal, protein, carbs, fat, manual }
    logs: {},             // { "YYYY-MM-DD": [ logEntry, ... ] }
    savedMeals: [],       // [ { id, name, items:[logEntry] } ]
    frequents: {},        // { "chainId::itemName": count }
    requests: [],         // [ { id, chain, note, lat, lng, date } ]
    lastLocation: null,   // { lat, lng, label }
    weights: {},          // { "YYYY-MM-DD": kg } — body weight log, stored in kg
    bodyFats: {},         // { "YYYY-MM-DD": % } — body fat percentage log
    habits: null,         // [ { id, name, emoji } ] — null until seeded with defaults
    habitLog: {},         // { "YYYY-MM-DD": { habitId: true } }
    favorites: []         // [ { id, name, chainId?, chainName?, kcal, protein, carbs, fat, sodium, fiber, sugar, custom } ]
  };

  // Time-of-day → meal bucket used when adding a log entry without an explicit meal.
  function defaultMeal(d) {
    var h = (d ? new Date(d) : new Date()).getHours();
    if (h < 11) return "breakfast";
    if (h < 15) return "lunch";
    if (h < 21) return "dinner";
    return "snack";
  }
  var MEAL_ORDER = ["breakfast", "lunch", "dinner", "snack"];

  var DEFAULT_HABITS = [
    { id: "protein", name: "Hit protein goal", emoji: "💪" },
    { id: "water",   name: "Drink water",      emoji: "💧" },
    { id: "move",    name: "Move / exercise",  emoji: "🚶" },
    { id: "veggies", name: "Eat veggies",      emoji: "🥦" }
  ];

  // Walk back from `endKey` (a YYYY-MM-DD string), yielding each prior day key.
  function prevDayKey(key) {
    var d = new Date(key + "T00:00:00");
    d.setDate(d.getDate() - 1);
    return todayKey(d);
  }

  var state = load();
  var listeners = [];

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return clone(defaults);
      var parsed = JSON.parse(raw);
      // Merge so newly-added default keys appear for returning users.
      return Object.assign(clone(defaults), parsed);
    } catch (e) {
      console.warn("Macro Map: could not read storage, starting fresh.", e);
      return clone(defaults);
    }
  }

  function writeLocal() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) {
      console.error("Macro Map: failed to save.", e);
    }
  }

  // Persist a local change and notify listeners (e.g. the cloud sync engine).
  // Writes are debounced so rapid changes (e.g. qty +/– clicks) don't thrash
  // localStorage. Notifications fire immediately so the UI stays in sync.
  var _persistTimer = null;
  function persist() {
    notify(false);
    clearTimeout(_persistTimer);
    _persistTimer = setTimeout(writeLocal, 300);
  }

  function notify(fromSync) {
    listeners.forEach(function (fn) {
      try { fn(state, { fromSync: !!fromSync }); } catch (e) { console.error(e); }
    });
  }

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function todayKey(d) {
    var dt = d ? new Date(d) : new Date();
    var y = dt.getFullYear();
    var m = String(dt.getMonth() + 1).padStart(2, "0");
    var day = String(dt.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + day;
  }

  return {
    // ---- profile & targets ----
    getProfile: function () { return state.profile; },
    setProfile: function (p) { state.profile = p; persist(); },

    getTargets: function () { return state.targets; },
    setTargets: function (t) { state.targets = t; persist(); },

    // ---- daily logs ----
    getLog: function (dateKey) {
      var k = dateKey || todayKey();
      return state.logs[k] ? state.logs[k].slice() : [];
    },
    addLogEntry: function (entry, dateKey) {
      var k = dateKey || todayKey();
      if (!state.logs[k]) state.logs[k] = [];
      entry.id = entry.id || ("e" + Date.now() + Math.floor(Math.random() * 1000));
      // Default the meal bucket from the clock when one isn't supplied. Use the
      // current time for today, but a sensible "lunch" placeholder when
      // backfilling a past day (the user can change it inline).
      if (!entry.meal) {
        entry.meal = (k === todayKey()) ? defaultMeal() : "lunch";
      }
      state.logs[k].push(entry);
      // bump frequency counter
      var fk = (entry.chainId || "?") + "::" + entry.name;
      state.frequents[fk] = (state.frequents[fk] || 0) + 1;
      persist();
      return entry;
    },
    removeLogEntry: function (id, dateKey) {
      var k = dateKey || todayKey();
      if (!state.logs[k]) return;
      state.logs[k] = state.logs[k].filter(function (e) { return e.id !== id; });
      persist();
    },
    updateLogEntry: function (id, patch, dateKey) {
      var k = dateKey || todayKey();
      if (!state.logs[k]) return;
      state.logs[k] = state.logs[k].map(function (e) {
        return e.id === id ? Object.assign({}, e, patch) : e;
      });
      persist();
    },
    clearDay: function (dateKey) {
      var k = dateKey || todayKey();
      delete state.logs[k];
      persist();
    },
    // dates that have at least one entry, newest first
    loggedDates: function () {
      return Object.keys(state.logs)
        .filter(function (k) { return state.logs[k] && state.logs[k].length; })
        .sort()
        .reverse();
    },

    // ---- saved meals ----
    getSavedMeals: function () { return state.savedMeals.slice(); },
    saveMeal: function (meal) {
      meal.id = meal.id || ("m" + Date.now());
      state.savedMeals.push(meal);
      persist();
      return meal;
    },
    deleteSavedMeal: function (id) {
      state.savedMeals = state.savedMeals.filter(function (m) { return m.id !== id; });
      persist();
    },

    // ---- frequents ----
    topFrequents: function (limit) {
      var arr = Object.keys(state.frequents).map(function (k) {
        return { key: k, count: state.frequents[k] };
      });
      arr.sort(function (a, b) { return b.count - a.count; });
      return arr.slice(0, limit || 8);
    },

    // ---- data requests ----
    getRequests: function () { return state.requests.slice(); },
    addRequest: function (req) {
      req.id = "r" + Date.now();
      req.date = req.date || new Date().toISOString();
      state.requests.push(req);
      persist();
      return req;
    },

    // ---- location ----
    getLastLocation: function () { return state.lastLocation; },
    setLastLocation: function (loc) { state.lastLocation = loc; persist(); },

    // ---- body weight log (kg internally) ----
    getWeight: function (dateKey) {
      var k = dateKey || todayKey();
      return typeof state.weights[k] === "number" ? state.weights[k] : null;
    },
    setWeight: function (kg, dateKey) {
      var k = dateKey || todayKey();
      if (kg == null || isNaN(kg)) { delete state.weights[k]; }
      else { state.weights[k] = Math.round(kg * 10) / 10; }
      persist();
    },
    // Chronological series of { date, kg }, oldest first.
    weightSeries: function () {
      return Object.keys(state.weights)
        .filter(function (k) { return typeof state.weights[k] === "number"; })
        .sort()
        .map(function (k) { return { date: k, kg: state.weights[k] }; });
    },

    // ---- body fat % log ----
    getBodyFat: function (dateKey) {
      var k = dateKey || todayKey();
      return typeof state.bodyFats[k] === "number" ? state.bodyFats[k] : null;
    },
    setBodyFat: function (pct, dateKey) {
      var k = dateKey || todayKey();
      if (pct == null || isNaN(pct)) { delete state.bodyFats[k]; }
      else { state.bodyFats[k] = Math.round(pct * 10) / 10; }
      persist();
    },
    bodyFatSeries: function () {
      return Object.keys(state.bodyFats)
        .filter(function (k) { return typeof state.bodyFats[k] === "number"; })
        .sort()
        .map(function (k) { return { date: k, pct: state.bodyFats[k] }; });
    },

    // ---- habits ----
    getHabits: function () {
      if (!state.habits) { state.habits = clone(DEFAULT_HABITS); writeLocal(); }
      return state.habits.slice();
    },
    addHabit: function (name, emoji) {
      if (!state.habits) state.habits = clone(DEFAULT_HABITS);
      var id = "h" + Date.now() + Math.floor(Math.random() * 1000);
      state.habits.push({ id: id, name: name, emoji: emoji || "✅" });
      persist();
      return id;
    },
    removeHabit: function (id) {
      if (!state.habits) return;
      state.habits = state.habits.filter(function (h) { return h.id !== id; });
      // also drop its checkmarks across all days
      Object.keys(state.habitLog).forEach(function (day) {
        if (state.habitLog[day]) delete state.habitLog[day][id];
      });
      persist();
    },
    isHabitDone: function (id, dateKey) {
      var k = dateKey || todayKey();
      return !!(state.habitLog[k] && state.habitLog[k][id]);
    },
    toggleHabit: function (id, dateKey) {
      var k = dateKey || todayKey();
      if (!state.habitLog[k]) state.habitLog[k] = {};
      if (state.habitLog[k][id]) delete state.habitLog[k][id];
      else state.habitLog[k][id] = true;
      if (!Object.keys(state.habitLog[k]).length) delete state.habitLog[k];
      persist();
      return this.isHabitDone(id, k);
    },
    // Current streak of consecutive done-days ending today (today may still be
    // pending without breaking the streak).
    habitStreak: function (id) {
      var day = todayKey();
      var isDone = function (d) { return !!(state.habitLog[d] && state.habitLog[d][id]); };
      if (!isDone(day)) day = prevDayKey(day); // grace: today not done yet
      var streak = 0;
      while (isDone(day)) { streak++; day = prevDayKey(day); }
      return streak;
    },

    // Consecutive days (ending today) that have at least one logged food item.
    loggingStreak: function () {
      var day = todayKey();
      var has = function (d) { return !!(state.logs[d] && state.logs[d].length); };
      if (!has(day)) day = prevDayKey(day); // today still open
      var streak = 0;
      while (has(day)) { streak++; day = prevDayKey(day); }
      return streak;
    },

    // ---- favorites ("my usual" pinned items, distinct from frequents) ----
    getFavorites: function () { return state.favorites.slice(); },
    addFavorite: function (item) {
      // Normalize to the same shape we use for log entries so a star action can
      // round-trip directly into the log without remapping fields.
      var fav = {
        id: "f" + Date.now() + Math.floor(Math.random() * 1000),
        name: (item.name || "").trim() || "Custom item",
        chainId: item.chainId || null,
        chainName: item.chainName || (item.chainId ? null : "Custom"),
        kcal: +item.kcal || 0, protein: +item.protein || 0,
        carbs: +item.carbs || 0, fat: +item.fat || 0,
        sodium: +item.sodium || 0, fiber: +item.fiber || 0, sugar: +item.sugar || 0,
        custom: !!item.custom
      };
      state.favorites.push(fav);
      persist();
      return fav;
    },
    removeFavorite: function (id) {
      state.favorites = state.favorites.filter(function (f) { return f.id !== id; });
      persist();
    },
    // Build a Set of "name::chainId" keys for O(1) bulk lookups (e.g. per-card
    // star checks during a page render). Build once per render pass.
    getFavoriteSet: function () {
      var s = new Set();
      state.favorites.forEach(function (f) {
        s.add((f.name || "").trim().toLowerCase() + "::" + (f.chainId || ""));
      });
      return s;
    },
    // True when a name+chain pair is already pinned (so the UI knows to draw a
    // filled star). chainId may be null for custom favorites.
    isFavorited: function (name, chainId) {
      var n = (name || "").trim().toLowerCase();
      return state.favorites.some(function (f) {
        return (f.name || "").trim().toLowerCase() === n &&
               (f.chainId || null) === (chainId || null);
      });
    },
    // Reverse lookup so a star toggle can remove an existing favorite without
    // having to know its id.
    findFavoriteId: function (name, chainId) {
      var n = (name || "").trim().toLowerCase();
      var match = state.favorites.filter(function (f) {
        return (f.name || "").trim().toLowerCase() === n &&
               (f.chainId || null) === (chainId || null);
      })[0];
      return match ? match.id : null;
    },

    // ---- aggregates for charts + achievements ----
    // Returns an array of { date, kcal, protein, carbs, fat } for the last `n`
    // days, ending today. Days without entries report zeros (so charts have
    // consistent x-axes).
    recentTotals: function (n) {
      n = n || 7;
      var day = todayKey();
      var out = [];
      for (var i = 0; i < n; i++) {
        var entries = state.logs[day] || [];
        var t = { date: day, kcal: 0, protein: 0, carbs: 0, fat: 0 };
        entries.forEach(function (e) {
          var q = e.qty || 1;
          t.kcal += (e.kcal || 0) * q; t.protein += (e.protein || 0) * q;
          t.carbs += (e.carbs || 0) * q; t.fat += (e.fat || 0) * q;
        });
        out.push(t);
        day = prevDayKey(day);
      }
      return out.reverse();
    },
    // Consecutive days (ending today, with today's grace) where the day's
    // totals met or exceeded a target for the given macro. Used for protein-hit
    // and similar "habit by outcome" streaks. tolerance lets close-enough days
    // count (e.g. 0.9 → 90% counts as a hit).
    hitTargetStreak: function (macro, target, tolerance) {
      if (!target) return 0;
      var thresh = target * (tolerance || 1);
      var day = todayKey();
      var hit = function (d) {
        var entries = state.logs[d];
        if (!entries || !entries.length) return false;
        var sum = 0;
        entries.forEach(function (e) { sum += (e[macro] || 0) * (e.qty || 1); });
        return sum >= thresh;
      };
      if (!hit(day)) day = prevDayKey(day); // today still open — grace
      var streak = 0;
      while (hit(day)) { streak++; day = prevDayKey(day); }
      return streak;
    },
    // Mirror of hitTargetStreak but for "stay under" macros (calories,
    // sodium). Days with no entries don't count, so vacuous streaks aren't
    // awarded for skipped days.
    underTargetStreak: function (macro, target) {
      if (!target) return 0;
      var day = todayKey();
      var ok = function (d) {
        var entries = state.logs[d];
        if (!entries || !entries.length) return false;
        var sum = 0;
        entries.forEach(function (e) { sum += (e[macro] || 0) * (e.qty || 1); });
        return sum <= target;
      };
      if (!ok(day)) day = prevDayKey(day);
      var streak = 0;
      while (ok(day)) { streak++; day = prevDayKey(day); }
      return streak;
    },
    // Total distinct days with at least one logged entry. Useful for
    // milestone-style achievements.
    daysLoggedCount: function () {
      return Object.keys(state.logs).filter(function (k) {
        return state.logs[k] && state.logs[k].length;
      }).length;
    },

    // expose meal helpers + ordering so the UI doesn't re-derive them
    MEAL_ORDER: MEAL_ORDER,
    defaultMeal: defaultMeal,

    // ---- sync hooks ----
    // Register a callback fired after every change. Receives (state, { fromSync }).
    onChange: function (fn) { if (typeof fn === "function") listeners.push(fn); },
    // Overwrite the whole state from an external source (cloud pull). Writes
    // locally and notifies with fromSync=true so the sync engine doesn't echo it back.
    importAll: function (newState) {
      state = Object.assign(clone(defaults), newState || {});
      writeLocal();
      notify(true);
    },
    // True if the user has any meaningful local data worth syncing up.
    hasData: function () {
      return !!(state.profile || state.targets ||
        Object.keys(state.logs).length || state.savedMeals.length || state.requests.length);
    },

    // ---- utility ----
    todayKey: todayKey,
    exportAll: function () { return clone(state); },
    resetAll: function () { state = clone(defaults); persist(); }
  };
})();
