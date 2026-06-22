/* Macro Map — shared data source (Supabase).
 *
 * The nutrition database lives in Supabase (`chains` + `menu_items`) so it can
 * grow for everyone without redeploying. This module loads it at runtime and
 * caches it, falling back to the bundled seed in nutrition-data.js if Supabase
 * is unconfigured or unreachable — so the app never breaks. It also routes
 * chain-data requests to the central `data_requests` table.
 */
window.MM = window.MM || {};

window.MM.data = (function () {
  var CACHE_KEY = "macromap.nutrition.v1";

  function cfg() { return window.MM.CONFIG || {}; }
  function enabled() { return !!(cfg().supabaseUrl && cfg().supabaseAnonKey); }
  function headers() {
    return { apikey: cfg().supabaseAnonKey, Authorization: "Bearer " + cfg().supabaseAnonKey };
  }

  // Use a cached cloud copy immediately (instant fresh data on load) if present.
  function applyCache() {
    try {
      var raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return;
      var arr = JSON.parse(raw);
      if (Array.isArray(arr) && arr.length) window.MM.NUTRITION = arr;
    } catch (e) { /* ignore — keep bundled seed */ }
  }

  // Turn the two flat tables into the nested chain/items shape the app expects.
  function assemble(chains, items) {
    var byId = {};
    chains.forEach(function (c) {
      byId[c.id] = { id: c.id, name: c.name, color: c.color, match: c.match || [], items: [] };
    });
    items.forEach(function (it) {
      var c = byId[it.chain_id];
      if (!c) return;
      c.items.push({
        name: it.name, category: it.category,
        kcal: +it.kcal, protein: +it.protein, carbs: +it.carbs, fat: +it.fat,
        sodium: +it.sodium, fiber: +it.fiber, sugar: +it.sugar
      });
    });
    return Object.keys(byId).map(function (k) { return byId[k]; })
      .filter(function (c) { return c.items.length; });
  }

  // Pull the latest database from Supabase, replace MM.NUTRITION, cache it.
  function loadNutrition(onUpdate) {
    if (!enabled()) return Promise.resolve(false);
    var base = cfg().supabaseUrl + "/rest/v1/";
    return Promise.all([
      fetch(base + "chains?select=*", { headers: headers() }).then(function (r) { return r.json(); }),
      fetch(base + "menu_items?select=*&order=chain_id", { headers: headers() }).then(function (r) { return r.json(); })
    ]).then(function (res) {
      var chains = res[0], items = res[1];
      if (!Array.isArray(chains) || !Array.isArray(items) || !chains.length) return false;
      var assembled = assemble(chains, items);
      if (!assembled.length) return false;
      window.MM.NUTRITION = assembled;
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(assembled)); } catch (e) { /* quota */ }
      if (onUpdate) onUpdate(assembled);
      return true;
    }).catch(function (e) {
      console.warn("Macro Map: couldn't load nutrition from Supabase; using bundled/cached data.", e);
      return false;
    });
  }

  // Submit a chain-data request: always kept locally for the user's list, and
  // pushed to the central data_requests table when Supabase is configured.
  function submitRequest(req) {
    var local = window.MM.store.addRequest({ chain: req.chain, note: req.note, lat: req.lat, lng: req.lng });
    if (!enabled()) return Promise.resolve(local);
    var user = window.MM.auth && window.MM.auth.currentUser && window.MM.auth.currentUser();
    var payload = {
      chain: req.chain, note: req.note || null,
      lat: req.lat || null, lng: req.lng || null,
      user_id: user ? user.id : null
    };
    return fetch(cfg().supabaseUrl + "/rest/v1/data_requests", {
      method: "POST",
      headers: Object.assign({ "Content-Type": "application/json", Prefer: "return=minimal" }, headers()),
      body: JSON.stringify(payload)
    }).then(function (r) {
      if (!r.ok) return r.text().then(function (t) { throw new Error(t); });
      return local;
    }).catch(function (e) {
      console.warn("Macro Map: request saved locally but not sent to server.", e);
      return local;
    });
  }

  applyCache();

  return { loadNutrition: loadNutrition, submitRequest: submitRequest };
})();
