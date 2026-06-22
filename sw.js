/* Macro Map — service worker (offline support + installability).
 *
 * Network-first for same-origin requests: online users always get the latest
 * app, and when offline they fall back to the last cached copy. Cross-origin
 * requests (map tiles, Supabase, Overpass/Nominatim, CDN libs) are left to the
 * network — they need connectivity anyway. Bump CACHE on each release. */
var CACHE = "macromap-v8";
var SHELL = [
  "./", "./index.html", "./manifest.webmanifest",
  "./icons/icon-192.png", "./icons/icon-512.png", "./icons/icon-180.png",
  "./css/styles.css?v=6",
  "./js/config.js?v=5", "./js/nutrition-data.js?v=4", "./js/storage.js?v=5",
  "./js/macros.js?v=4", "./js/recommend.js?v=4", "./js/map.js?v=4",
  "./js/ui.js?v=4", "./js/auth.js?v=4", "./js/data-source.js?v=5", "./js/app.js?v=5",
  "./js/admin-feedback-delete.js?v=2"
];

self.addEventListener("install", function (e) {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(function (c) {
    // Don't fail the whole install if one asset can't be fetched.
    return Promise.all(SHELL.map(function (u) { return c.add(u).catch(function () {}); }));
  }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; })
        .map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // bypass tiles / Supabase / CDNs

  e.respondWith(
    fetch(req).then(function (resp) {
      var copy = resp.clone();
      caches.open(CACHE).then(function (c) { c.put(req, copy); });
      return resp;
    }).catch(function () {
      return caches.match(req).then(function (m) { return m || caches.match("./index.html"); });
    })
  );
});
