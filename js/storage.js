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
    habits: null,         // [ { id, name, emoji } ] — null until seeded with defaults
    habitLog: {}          // { "YYYY-MM-DD": { habitId: true } }
  };

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
  function persist() {
    writeLocal();
    notify(false);
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
