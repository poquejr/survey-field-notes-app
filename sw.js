/* Field Notes service worker — PWA app-shell cache. Not used by a later Capacitor native shell. */
const CACHE = "field-notes-shell-v13";
const TILE_CACHE = "field-notes-tiles-v1";
const ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./config.json",
  "./css/app.css",
  "./js/platform.js",
  "./js/idb.js",
  "./js/bundled-data.js",
  "./js/app.js",
  "./js/vendor/jszip.min.js",
  "./js/jxl.js",
  "./js/weather.js",
  "./js/crs.js",
  "./js/pdf.js",
  "./js/tools.js",
  "./js/opus.js",
  "./js/vendor/proj4.js",
  "./js/vendor/leaflet/leaflet.js",
  "./js/vendor/leaflet/leaflet.css",
  "./js/vendor/leaflet/images/marker-icon.png",
  "./js/vendor/leaflet/images/marker-icon-2x.png",
  "./js/vendor/leaflet/images/marker-shadow.png",
  "./presets/index.json",
  "./presets/generic-default.json",
  "./presets/nv5-sandiego.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png"
];

function isBasemapTile(url) {
  return /tile\.openstreetmap\.org|server\.arcgisonline\.com|services\.arcgisonline\.com/.test(url);
}

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) { return cache.addAll(ASSETS); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE && k !== TILE_CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (event) {
  var req = event.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  if (isBasemapTile(url.href)) {
    event.respondWith(
      caches.open(TILE_CACHE).then(function (cache) {
        return cache.match(req).then(function (hit) {
          return fetch(req).then(function (res) {
            if (res && res.ok) cache.put(req, res.clone());
            return res;
          }).catch(function () { return hit; });
        });
      })
    );
    return;
  }
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    caches.match(req).then(function (cached) {
      var fetched = fetch(req).then(function (res) {
        if (res && res.ok) {
          var copy = res.clone();
          caches.open(CACHE).then(function (cache) { cache.put(req, copy); });
        }
        return res;
      }).catch(function () { return cached; });
      return cached || fetched;
    })
  );
});
