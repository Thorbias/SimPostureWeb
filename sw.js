// SimPosture service worker — precaches the static web bundle so the app starts
// and runs without a network connection after the first load (F-050, NF-002).
//
// The cache name carries the app version, passed in via the registration URL
// (`sw.js?v=<version>`, stamped from Kotlin's appVersion in main.kt). A new
// release registers a new SW URL -> new cache -> old caches are purged on
// activate, so users never get a "stale app" after a deploy (ADR-0012).
//
// All paths are relative so the same SW works under a project sub-path
// (/SimPostureWeb/) and at the custom-domain root (simposture.com/).

var VERSION = new URL(self.location.href).searchParams.get('v') || 'dev';
var CACHE = 'simposture-cache-' + VERSION;

// Known, stable assets. The Kotlin/Wasm output (composeApp.js/.wasm), fonts and
// Compose resources are cached lazily by the fetch handler on first load, so
// their (potentially hashed) names need not be listed here.
var PRECACHE = [
    './',
    'index.html',
    'manifest.json',
    'favicon-16.png',
    'favicon-32.png',
    'icon-192.png',
    'icon-512.png',
    'apple-touch-icon.png',
    // MediaPipe pose estimation runs fully on-device; precache it and the model
    // so the analysis also works offline even if it was never run while online.
    'mediapipe/vision_bundle.mjs',
    'mediapipe/wasm/vision_wasm_internal.js',
    'mediapipe/wasm/vision_wasm_internal.wasm',
    'pose_landmarker_lite.task'
];

self.addEventListener('install', function (event) {
    event.waitUntil(
        caches.open(CACHE)
            .then(function (cache) { return cache.addAll(PRECACHE); })
            .then(function () { return self.skipWaiting(); })
    );
});

self.addEventListener('activate', function (event) {
    event.waitUntil(
        caches.keys().then(function (keys) {
            return Promise.all(keys.map(function (key) {
                if (key !== CACHE) { return caches.delete(key); }
            }));
        }).then(function () { return self.clients.claim(); })
    );
});

// Cache-first with runtime population: serve from cache when present, otherwise
// fetch, cache same-origin GET responses, and return them. Everything here is
// static and executed on-device, so no network-first logic is needed.
self.addEventListener('fetch', function (event) {
    var request = event.request;
    if (request.method !== 'GET') { return; }
    if (new URL(request.url).origin !== self.location.origin) { return; }

    event.respondWith(
        caches.match(request).then(function (cached) {
            if (cached) { return cached; }
            return fetch(request).then(function (response) {
                if (response && response.status === 200 && response.type === 'basic') {
                    var copy = response.clone();
                    caches.open(CACHE).then(function (cache) { cache.put(request, copy); });
                }
                return response;
            }).catch(function () {
                // Offline and not cached: fall back to the shell for navigations.
                if (request.mode === 'navigate') { return caches.match('./'); }
                return Response.error();
            });
        })
    );
});
