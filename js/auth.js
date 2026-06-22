/* Macro Map — accounts & cloud sync (Supabase).
 *
 * Optional layer on top of the local store. When a Supabase project is
 * configured in config.js, users can sign in and their entire app state syncs
 * to a single per-user row (table `app_state`, protected by Row-Level Security).
 *
 * Model: localStorage stays the live working store so the app is instant and
 * works offline / signed-out. When signed in we (a) pull the cloud copy on
 * login and (b) debounce-push local changes up. Last-write-wins per device —
 * fine for a personal app; documented as a known limitation.
 */
window.MM = window.MM || {};

window.MM.auth = (function () {
  var client = null;
  var user = null;
  var syncedUserId = null;     // user we've already done the login-merge for
  var stateListeners = [];
  var pushTimer = null;
  var pushing = false;

  function cfg() { return window.MM.CONFIG || {}; }
  function isEnabled() { return !!(cfg().supabaseUrl && cfg().supabaseAnonKey); }
  function currentUser() { return user; }

  function toast(msg, kind) { if (window.MM.ui) window.MM.ui.toast(msg, kind); }

  /* ----------------------------------------------------------- lifecycle */

  function init() {
    if (!isEnabled()) { emit(); return; }
    if (!window.supabase || !window.supabase.createClient) {
      console.warn("Macro Map: Supabase library not loaded; running local-only.");
      emit();
      return;
    }
    client = window.supabase.createClient(cfg().supabaseUrl, cfg().supabaseAnonKey);

    client.auth.onAuthStateChange(function (event, session) {
      var nextUser = session ? session.user : null;
      var signedIn = !!nextUser;
      user = nextUser;

      if (signedIn) {
        // Only run the login merge once per user (ignore TOKEN_REFRESHED etc.).
        if (syncedUserId !== user.id) {
          syncedUserId = user.id;
          syncOnLogin();
        }
      } else {
        syncedUserId = null;
      }
      emit();
    });

    // Mirror local changes up to the cloud (debounced), unless the change came
    // from a sync pull.
    window.MM.store.onChange(function (state, meta) {
      if (meta && meta.fromSync) return;
      schedulePush();
    });
  }

  /* ------------------------------------------------------------- syncing */

  function syncOnLogin() {
    if (!client || !user) return;
    toast("Syncing your data…");
    client.from("app_state").select("data").eq("user_id", user.id).maybeSingle()
      .then(function (res) {
        if (res.error) throw res.error;
        if (res.data && res.data.data) {
          // Cloud copy exists -> adopt it as the working state.
          window.MM.store.importAll(res.data.data);
          toast("Welcome back — data restored", "ok");
        } else {
          // No cloud copy yet -> push whatever is local up as the baseline.
          return pushNow().then(function () {
            toast("Account ready — your data is now synced", "ok");
          });
        }
      })
      .then(function () { emit(); })
      .catch(function (err) {
        console.error("Macro Map sync (pull) failed:", err);
        toast("Couldn't sync: " + (err.message || "unknown error"), "err");
      });
  }

  function schedulePush() {
    if (!client || !user) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(function () { pushNow(); }, 800);
  }

  function pushNow() {
    if (!client || !user) return Promise.resolve();
    if (pushing) { schedulePush(); return Promise.resolve(); }
    pushing = true;
    var payload = {
      user_id: user.id,
      data: window.MM.store.exportAll(),
      updated_at: new Date().toISOString()
    };
    return client.from("app_state").upsert(payload, { onConflict: "user_id" })
      .then(function (res) {
        if (res.error) throw res.error;
      })
      .catch(function (err) {
        console.error("Macro Map sync (push) failed:", err);
      })
      .then(function () { pushing = false; });
  }

  /* --------------------------------------------------------- auth actions */

  function signUp(email, password) {
    if (!client) return Promise.reject(new Error("Cloud accounts are not configured."));
    return client.auth.signUp({ email: email, password: password })
      .then(function (res) {
        if (res.error) throw res.error;
        // If email confirmation is on, there's no session yet.
        if (!res.data.session) {
          return { needsConfirmation: true };
        }
        return { needsConfirmation: false };
      });
  }

  // OAuth (Google). Redirects the browser to Google and back; on return the
  // Supabase client detects the session in the URL and fires onAuthStateChange,
  // which runs the normal login sync. Requires the Google provider to be enabled
  // in the Supabase dashboard (see README).
  function signInWithGoogle() {
    if (!client) return Promise.reject(new Error("Cloud accounts are not configured."));
    return client.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin + window.location.pathname }
    }).then(function (res) {
      if (res.error) throw res.error;
      return res.data; // the browser is now navigating to Google
    });
  }

  function signIn(email, password) {
    if (!client) return Promise.reject(new Error("Cloud accounts are not configured."));
    return client.auth.signInWithPassword({ email: email, password: password })
      .then(function (res) {
        if (res.error) throw res.error;
        return res.data;
      });
  }

  function signOut() {
    if (!client) return Promise.resolve();
    // Flush any pending change first, then sign out.
    clearTimeout(pushTimer);
    return pushNow().then(function () {
      return client.auth.signOut();
    }).then(function () {
      user = null; syncedUserId = null; emit();
    });
  }

  /* ----------------------------------------------------------- listeners */

  function onState(fn) { if (typeof fn === "function") stateListeners.push(fn); }
  function emit() {
    var status = { enabled: isEnabled(), user: user };
    stateListeners.forEach(function (fn) { try { fn(status); } catch (e) { console.error(e); } });
  }

  return {
    init: init,
    isEnabled: isEnabled,
    currentUser: currentUser,
    signUp: signUp,
    signIn: signIn,
    signInWithGoogle: signInWithGoogle,
    signOut: signOut,
    onState: onState,
    pushNow: pushNow
  };
})();
