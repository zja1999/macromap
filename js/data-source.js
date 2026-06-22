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

  /* ---- client-side request spam protection ----
   * Deters casual abuse: validates input, blocks duplicates, and rate-limits.
   * Note: this is best-effort client-side throttling — the anon insert endpoint
   * is still open, so a determined actor could bypass it. Stronger protection
   * would need a Supabase Edge Function or per-IP limiting in front of the API. */
  var RL_KEY = "macromap.reqlog";
  function reqLog() {
    try { return JSON.parse(localStorage.getItem(RL_KEY) || "[]"); } catch (e) { return []; }
  }
  function throttleCheck() {
    var now = Date.now();
    var log = reqLog().filter(function (t) { return now - t < 86400000; }); // last 24h
    if (log.length && now - log[log.length - 1] < 8000)
      return { ok: false, reason: "Easy there — wait a few seconds before requesting again." };
    if (log.filter(function (t) { return now - t < 600000; }).length >= 8)
      return { ok: false, reason: "That's a lot of requests at once. Try again in a few minutes." };
    if (log.length >= 25)
      return { ok: false, reason: "You've hit the daily request limit. Thanks for the suggestions!" };
    return { ok: true };
  }
  function recordSubmission() {
    var log = reqLog(); log.push(Date.now());
    try { localStorage.setItem(RL_KEY, JSON.stringify(log)); } catch (e) { /* quota */ }
  }

  // Submit a chain-data request: validated + throttled, kept locally for the
  // user's list, and pushed to the central data_requests table when configured.
  // Rejects with a friendly Error when blocked.
  function submitRequest(req) {
    var chain = (req.chain || "").trim();
    if (chain.length < 2) return Promise.reject(new Error("Please enter a valid restaurant name."));
    if (chain.length > 80) chain = chain.slice(0, 80);
    var note = (req.note || "").trim().slice(0, 280);

    // Don't let the same place be requested twice from this browser.
    var already = window.MM.store.getRequests().some(function (r) {
      return (r.chain || "").trim().toLowerCase() === chain.toLowerCase();
    });
    if (already) return Promise.reject(new Error("You've already requested \"" + chain + "\"."));

    var rl = throttleCheck();
    if (!rl.ok) return Promise.reject(new Error(rl.reason));
    recordSubmission();

    var local = window.MM.store.addRequest({ chain: chain, note: note, lat: req.lat, lng: req.lng });
    if (!enabled()) return Promise.resolve(local);
    var user = window.MM.auth && window.MM.auth.currentUser && window.MM.auth.currentUser();
    var payload = {
      chain: chain, note: note || null,
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

  /* ---- user feedback ---- */
  var FB_KEY = "macromap.fblog";
  function fbLog() { try { return JSON.parse(localStorage.getItem(FB_KEY) || "[]"); } catch (e) { return []; } }
  function fbThrottle() {
    var now = Date.now();
    var log = fbLog().filter(function (t) { return now - t < 86400000; });
    if (log.length && now - log[log.length - 1] < 5000)
      return { ok: false, reason: "Give it a moment before sending more." };
    if (log.length >= 15)
      return { ok: false, reason: "Thanks for all the feedback today! Try again tomorrow." };
    return { ok: true };
  }

  // Send user feedback to the central `feedback` table. Validated + throttled.
  function submitFeedback(fb) {
    var msg = (fb.message || "").trim();
    if (msg.length < 4) return Promise.reject(new Error("Please add a little more detail."));
    msg = msg.slice(0, 1000);
    if (!enabled()) return Promise.reject(new Error("Feedback needs the app's cloud connection."));
    var t = fbThrottle();
    if (!t.ok) return Promise.reject(new Error(t.reason));
    var log = fbLog(); log.push(Date.now());
    try { localStorage.setItem(FB_KEY, JSON.stringify(log)); } catch (e) { /* quota */ }

    var user = window.MM.auth && window.MM.auth.currentUser && window.MM.auth.currentUser();
    var payload = {
      message: msg,
      category: fb.category || null,
      context: fb.context || null,
      user_id: user ? user.id : null
    };
    return fetch(cfg().supabaseUrl + "/rest/v1/feedback", {
      method: "POST",
      headers: Object.assign({ "Content-Type": "application/json", Prefer: "return=minimal" }, headers()),
      body: JSON.stringify(payload)
    }).then(function (r) {
      if (!r.ok) return r.text().then(function (t) { throw new Error(t); });
      return true;
    });
  }

  /* ---- admin (owner-only) ----
   * Reads/updates run as the authenticated owner (JWT in the Authorization
   * header) so RLS grants access to all rows; see supabase/admin-schema.sql.
   * isAdmin() only toggles UI — the database enforces the real boundary. */
  function authHeaders() {
    var token = (window.MM.auth && window.MM.auth.accessToken && window.MM.auth.accessToken()) || cfg().supabaseAnonKey;
    return { apikey: cfg().supabaseAnonKey, Authorization: "Bearer " + token };
  }
  function isAdmin() {
    var u = window.MM.auth && window.MM.auth.currentUser && window.MM.auth.currentUser();
    var admin = cfg().adminEmail;
    return !!(u && admin && u.email && u.email.toLowerCase() === String(admin).toLowerCase());
  }
  function getJSON(path) {
    return fetch(cfg().supabaseUrl + "/rest/v1/" + path, { headers: authHeaders() })
      .then(function (r) { return r.json(); });
  }
  function fetchRequests() { return getJSON("data_requests?select=*&order=created_at.desc&limit=200"); }
  function fetchFeedback() { return getJSON("feedback?select=*&order=created_at.desc&limit=200"); }
  function updateRequestStatus(id, status) {
    return fetch(cfg().supabaseUrl + "/rest/v1/data_requests?id=eq." + encodeURIComponent(id), {
      method: "PATCH",
      headers: Object.assign({ "Content-Type": "application/json", Prefer: "return=minimal" }, authHeaders()),
      body: JSON.stringify({ status: status })
    }).then(function (r) {
      if (!r.ok) return r.text().then(function (t) { throw new Error(t); });
      return true;
    });
  }

  applyCache();

  return {
    loadNutrition: loadNutrition,
    submitRequest: submitRequest,
    submitFeedback: submitFeedback,
    isAdmin: isAdmin,
    fetchRequests: fetchRequests,
    fetchFeedback: fetchFeedback,
    updateRequestStatus: updateRequestStatus
  };
})();
