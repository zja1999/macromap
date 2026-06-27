/* Macro Map — shared data source (Supabase).
 *
 * The nutrition database lives in Supabase (`chains` + `menu_items`) and is
 * fetched fresh on every session. There is no local fallback — if Supabase is
 * unreachable or unconfigured the app shows an error so the user knows data is
 * missing rather than seeing stale information.
 */
window.MM = window.MM || {};

window.MM.data = (function () {
  function cfg() { return window.MM.CONFIG || {}; }
  function enabled() { return !!(cfg().supabaseUrl && cfg().supabaseAnonKey); }
  function headers() {
    return { apikey: cfg().supabaseAnonKey, Authorization: "Bearer " + cfg().supabaseAnonKey };
  }

  // Clear any nutrition data that was cached by a previous version of the app.
  try { localStorage.removeItem("macromap.nutrition.v1"); } catch (e) {}

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

  // Pull the latest nutrition database from Supabase and populate MM.NUTRITION.
  // Rejects with a user-readable Error if Supabase is unconfigured, unreachable,
  // or returns an empty dataset — the caller is responsible for showing an error.
  function loadNutrition(onUpdate) {
    if (!enabled()) {
      return Promise.reject(new Error(
        "Supabase is not configured. Add your project URL and anon key to js/config.js."
      ));
    }
    var base = cfg().supabaseUrl + "/rest/v1/";
    return Promise.all([
      fetch(base + "chains?select=*", { headers: headers() }).then(function (r) {
        if (!r.ok) throw new Error("Chains table request failed (" + r.status + ").");
        return r.json();
      }),
      fetch(base + "menu_items?select=*&order=chain_id", { headers: headers() }).then(function (r) {
        if (!r.ok) throw new Error("Menu items request failed (" + r.status + ").");
        return r.json();
      })
    ]).then(function (res) {
      var chains = res[0], items = res[1];
      if (!Array.isArray(chains) || !Array.isArray(items) || !chains.length) {
        throw new Error("No restaurant data found in the database. Upload a CSV from the Admin tab.");
      }
      var assembled = assemble(chains, items);
      if (!assembled.length) {
        throw new Error("Chains exist but have no menu items. Upload items from the Admin tab.");
      }
      window.MM.NUTRITION = assembled;
      if (onUpdate) onUpdate(assembled);
      return true;
    }).catch(function (e) {
      console.warn("Macro Map: nutrition load failed.", e);
      throw e; // propagate so callers can show an error UI
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
    if (log.length >= 10)
      return { ok: false, reason: "You've hit the daily request limit of 10. Thanks for the suggestions — check back tomorrow!" };
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

    var admin = isAdmin();

    // Admins can re-request any chain and are not rate-limited.
    if (!admin) {
      var already = window.MM.store.getRequests().some(function (r) {
        return (r.chain || "").trim().toLowerCase() === chain.toLowerCase();
      });
      if (already) return Promise.reject(new Error("You've already requested \"" + chain + "\"."));

      var rl = throttleCheck();
      if (!rl.ok) return Promise.reject(new Error(rl.reason));
      recordSubmission();
    }

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
   * Reads/updates run as an authenticated admin (JWT in the Authorization
   * header) so RLS grants access to all rows; see supabase/admin-schema.sql.
   * isAdmin() only toggles UI — the database enforces the real boundary. */
  function authHeaders() {
    var token = (window.MM.auth && window.MM.auth.accessToken && window.MM.auth.accessToken()) || cfg().supabaseAnonKey;
    return { apikey: cfg().supabaseAnonKey, Authorization: "Bearer " + token };
  }
  function adminEmails() {
    var raw = Array.isArray(cfg().adminEmails) ? cfg().adminEmails : (cfg().adminEmail ? [cfg().adminEmail] : []);
    return raw.map(function (email) { return String(email || "").trim().toLowerCase(); })
      .filter(function (email) { return !!email; });
  }
  function isAdmin() {
    var u = window.MM.auth && window.MM.auth.currentUser && window.MM.auth.currentUser();
    if (!u || !u.email) return false;
    return adminEmails().indexOf(String(u.email).trim().toLowerCase()) !== -1;
  }
  function getJSON(path) {
    return fetch(cfg().supabaseUrl + "/rest/v1/" + path, { headers: authHeaders() })
      .then(function (r) { return r.json(); });
  }
  function fetchRequests() { return getJSON("data_requests?select=*&order=created_at.desc&limit=200"); }
  function fetchFeedback() { return getJSON("feedback?select=*&order=created_at.desc&limit=200"); }

  /* ---- admin: bulk nutrition upload (CSV / Excel) ----
   * Parses a formatted spreadsheet in the browser, validates it, rejects
   * duplicates (within the file or already in the database) BEFORE writing,
   * then upserts chains + inserts items and records the upload in upload_log.
   * Writes run as the signed-in admin (authHeaders), gated by is_admin() RLS. */
  var REQUIRED_COLS = ["chain_id", "chain_name", "name", "kcal", "protein", "carbs", "fat", "sodium", "fiber", "sugar"];
  var NUMERIC_COLS = ["kcal", "protein", "carbs", "fat", "sodium", "fiber", "sugar"];

  function uploadSlug(t) {
    var s = String(t == null ? "" : t).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    return s || "item";
  }

  // Lazy-load SheetJS only when an admin actually uploads (keeps it off the
  // critical path for everyone else). Handles .xlsx/.xls and .csv uniformly.
  var xlsxPromise = null;
  function loadXLSX() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    if (xlsxPromise) return xlsxPromise;
    xlsxPromise = new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
      s.onload = function () { window.XLSX ? resolve(window.XLSX) : reject(new Error("Spreadsheet parser failed to load.")); };
      s.onerror = function () { reject(new Error("Couldn't load the spreadsheet parser — check your connection and retry.")); };
      document.head.appendChild(s);
    });
    return xlsxPromise;
  }

  function readRows(file) {
    return loadXLSX().then(function (XLSX) {
      return new Promise(function (resolve, reject) {
        var reader = new FileReader();
        reader.onload = function (e) {
          try {
            var wb = XLSX.read(new Uint8Array(e.target.result), { type: "array" });
            var sheet = wb.Sheets[wb.SheetNames[0]];
            if (!sheet) { reject(new Error("That file has no readable sheet.")); return; }
            resolve(XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false }));
          } catch (err) { reject(new Error("Couldn't read that file — is it a valid CSV or Excel file?")); }
        };
        reader.onerror = function () { reject(new Error("Couldn't read the file.")); };
        reader.readAsArrayBuffer(file);
      });
    });
  }

  // Validate + shape rows into { chains, items, errors, dupesInFile }.
  function buildFromRows(rows) {
    if (!rows || !rows.length) return { errors: ["The file has no data rows."] };
    var headers = Object.keys(rows[0]).map(function (h) { return String(h).trim(); });
    var missing = REQUIRED_COLS.filter(function (c) { return headers.indexOf(c) === -1; });
    if (missing.length) {
      return { errors: ["Missing required column(s): " + missing.join(", ") + ". Download the template and match its header row exactly."] };
    }

    var chains = {}, items = [], errors = [], idSeen = {}, dupes = [];
    rows.forEach(function (row, idx) {
      var line = idx + 2; // +1 header, +1 to 1-index
      var cid = String(row.chain_id == null ? "" : row.chain_id).trim();
      var name = String(row.name == null ? "" : row.name).trim();
      if (!cid || !name) { errors.push("Line " + line + ": chain_id and name are required."); return; }

      var nums = {};
      NUMERIC_COLS.forEach(function (col) {
        var raw = String(row[col] == null ? "" : row[col]).trim();
        // Tolerate thousands separators / stray spaces from Excel/Sheets exports
        // (e.g. "1,200" or "1 200") so valid data doesn't hard-fail.
        var cleaned = raw.replace(/[,\s]/g, "");
        var v = cleaned === "" ? 0 : Number(cleaned);
        if (isNaN(v)) { errors.push("Line " + line + " (" + name + "): \"" + col + "\" is not a number: \"" + raw + "\""); v = 0; }
        nums[col] = v;
      });

      var id = cid + ":" + uploadSlug(name);
      if (idSeen[id]) dupes.push(name + "  ·  " + cid); else idSeen[id] = true;

      if (!chains[cid]) {
        var aliases = String(row.match == null ? "" : row.match).split("|")
          .map(function (a) { return a.trim().toLowerCase(); }).filter(Boolean);
        if (!aliases.length) aliases = [String(row.chain_name || cid).trim().toLowerCase()];
        chains[cid] = {
          id: cid,
          name: String(row.chain_name || cid).trim(),
          color: String(row.chain_color == null ? "" : row.chain_color).trim() || null,
          match: aliases
        };
      }

      items.push(Object.assign({ id: id, chain_id: cid, name: name, category: String(row.category == null ? "" : row.category).trim() || null }, nums));
    });
    return { errors: errors, chains: chains, items: items, dupesInFile: dupes };
  }

  function bullets(list, max) {
    var shown = list.slice(0, max || 15).map(function (x) { return "• " + x; }).join("\n");
    return shown + (list.length > (max || 15) ? "\n• …and " + (list.length - (max || 15)) + " more" : "");
  }

  function checkOk(r) {
    if (!r.ok) return r.text().then(function (t) { throw new Error(t || ("Server error " + r.status)); });
    return true;
  }

  function fetchExistingItemIds(chainIds) {
    if (!chainIds.length) return Promise.resolve({});
    var inList = chainIds.map(function (c) { return '"' + String(c).replace(/"/g, "") + '"'; }).join(",");
    return fetch(cfg().supabaseUrl + "/rest/v1/menu_items?select=id&chain_id=in.(" + encodeURIComponent(inList) + ")", { headers: authHeaders() })
      // Fail loudly on a bad read — a swallowed error here would skip duplicate
      // detection and let us write items that already exist.
      .then(function (r) {
        if (!r.ok) return r.text().then(function (t) { throw new Error("Couldn't check for existing items (server " + r.status + "). Nothing was uploaded. " + (t || "")); });
        return r.json();
      })
      .then(function (rows) {
        var m = {};
        (Array.isArray(rows) ? rows : []).forEach(function (x) { m[x.id] = true; });
        return m;
      });
  }

  function upsertChains(rows) {
    if (!rows.length) return Promise.resolve();
    return fetch(cfg().supabaseUrl + "/rest/v1/chains?on_conflict=id", {
      method: "POST",
      headers: Object.assign({ "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" }, authHeaders()),
      body: JSON.stringify(rows)
    }).then(checkOk);
  }

  function insertItemsBatched(items) {
    var BATCH = 200, chunks = [];
    for (var i = 0; i < items.length; i += BATCH) chunks.push(items.slice(i, i + BATCH));
    var inserted = 0;
    return chunks.reduce(function (p, chunk) {
      return p.then(function () {
        return fetch(cfg().supabaseUrl + "/rest/v1/menu_items", {
          method: "POST",
          headers: Object.assign({ "Content-Type": "application/json", Prefer: "return=minimal" }, authHeaders()),
          body: JSON.stringify(chunk)
        }).then(checkOk).then(function () { inserted += chunk.length; });
      });
    }, Promise.resolve()).catch(function (err) {
      // Writes aren't transactional; remember how many rows made it in so the
      // caller can tell the admin exactly how to recover.
      err.insertedCount = inserted;
      throw err;
    });
  }

  function insertUploadLog(summary) {
    var user = window.MM.auth && window.MM.auth.currentUser && window.MM.auth.currentUser();
    var payload = Object.assign({
      uploader_email: user ? user.email : null,
      uploader_id: user ? user.id : null
    }, summary);
    return fetch(cfg().supabaseUrl + "/rest/v1/upload_log", {
      method: "POST",
      headers: Object.assign({ "Content-Type": "application/json", Prefer: "return=minimal" }, authHeaders()),
      body: JSON.stringify(payload)
    }).then(checkOk);
  }

  // Orchestrates a full upload. Resolves a summary; rejects with a friendly,
  // multi-line Error (validation problems, in-file dupes, or DB clashes).
  function uploadNutrition(file) {
    if (!isAdmin()) return Promise.reject(new Error("Admins only."));
    if (!enabled()) return Promise.reject(new Error("Cloud connection isn't configured."));

    return readRows(file).then(function (rows) {
      var built = buildFromRows(rows);
      if (built.errors && built.errors.length) {
        throw new Error("The file has " + built.errors.length + " formatting problem(s):\n" + bullets(built.errors, 12));
      }
      if (built.dupesInFile && built.dupesInFile.length) {
        throw new Error("Duplicate items inside the file (same chain + item appears more than once):\n" + bullets(built.dupesInFile) + "\n\nRemove the duplicates and re-upload.");
      }

      var chainKeys = Object.keys(built.chains);
      return fetchExistingItemIds(chainKeys).then(function (existing) {
        var clash = built.items.filter(function (it) { return existing[it.id]; })
          .map(function (it) { return it.name + "  ·  " + it.chain_id; });
        if (clash.length) {
          throw new Error(clash.length + " item(s) already exist in the database:\n" + bullets(clash) +
            "\n\nNothing was added. Remove those rows (or delete the existing items first) and re-upload.");
        }

        var chainRows = chainKeys.map(function (k) { return built.chains[k]; });
        return upsertChains(chainRows)
          .then(function () { return insertItemsBatched(built.items); })
          .then(function () {
            var summary = {
              item_count: built.items.length,
              chain_count: chainKeys.length,
              chains: chainRows.map(function (c) { return c.name; }).join(", "),
              filename: (file && file.name) || null
            };
            return insertUploadLog(summary).then(function () { return summary; });
          })
          .catch(function (err) {
            // A mid-batch failure leaves a partial import (no transaction). Tell
            // the admin what landed and how to finish — re-uploading lists the
            // already-saved items so they can drop those rows and upload the rest.
            var done = err && err.insertedCount;
            if (typeof done === "number" && done > 0 && done < built.items.length) {
              throw new Error("Upload interrupted after saving " + done + " of " + built.items.length +
                " items — the rest were not added. Re-upload this same file: it will list the items that already exist; remove those rows and upload the remainder. (" + (err.message || "error") + ")");
            }
            throw err;
          });
      });
    });
  }

  function fetchUploadLog() { return getJSON("upload_log?select=*&order=created_at.desc&limit=100"); }

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

  return {
    loadNutrition: loadNutrition,
    submitRequest: submitRequest,
    submitFeedback: submitFeedback,
    isAdmin: isAdmin,
    fetchRequests: fetchRequests,
    fetchFeedback: fetchFeedback,
    updateRequestStatus: updateRequestStatus,
    uploadNutrition: uploadNutrition,
    fetchUploadLog: fetchUploadLog
  };
})();
