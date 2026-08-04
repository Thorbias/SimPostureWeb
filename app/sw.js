// SimPosture service worker — precaches the static web bundle so the app starts
// and runs without a network connection after the first load (F-050, NF-002).
//
// All paths are relative so the same SW works under a project sub-path
// (/SimPostureWeb/) and at the custom-domain root (simposture.com/).

// The app version, passed in via the registration URL (`sw.js?v=<version>`,
// stamped from Kotlin's appVersion in main.kt).
var VERSION = new URL(self.location.href).searchParams.get('v') || 'dev';

// Bump by hand whenever this file changes. A client stuck on an old build
// re-registers its OLD `sw.js?v=…` URL, so VERSION alone would still name the
// very cache it is stuck on and `activate` would spare it. Folding a revision
// of this file into the name guarantees a fresh cache on every service-worker
// change, which is what releases such a client (B-009).
var SW_REVISION = '2';
var SHELL_CACHE = 'simposture-shell-' + VERSION + '-' + SW_REVISION;

// Bump only when the files in IMMUTABLE below actually change — a model swap or
// a MediaPipe upgrade. They are ~9 MB together and identical across app
// releases, so they sit outside the version-scoped shell cache instead of being
// re-downloaded with every deploy. The flip side is that they are invisible to
// a release: forgetting this bump pins users to the old model indefinitely.
var ASSET_REVISION = '1';
var ASSET_CACHE = 'simposture-assets-' + ASSET_REVISION;

// Pose estimation runs fully on-device; precache the runtime and the model so
// the analysis also works offline even if it was never run while online.
var IMMUTABLE = [
    'mediapipe/vision_bundle.mjs',
    'mediapipe/wasm/vision_wasm_internal.js',
    'mediapipe/wasm/vision_wasm_internal.wasm',
    'pose_landmarker_lite.task'
];

// Known, stable shell assets. The Kotlin/Wasm output and Compose resources are
// cached lazily by the fetch handler on first load, so their (hashed) names need
// not be listed here.
var SHELL = [
    './',
    'index.html',
    'manifest.json',
    'favicon-16.png',
    'favicon-32.png',
    'icon-192.png',
    'icon-512.png',
    'apple-touch-icon.png'
];

self.addEventListener('install', function (event) {
    event.waitUntil(
        Promise.all([
            caches.open(SHELL_CACHE).then(function (cache) { return cache.addAll(SHELL); }),
            caches.open(ASSET_CACHE).then(function (cache) { return cache.addAll(IMMUTABLE); })
        ]).then(function () { return self.skipWaiting(); })
    );
});

self.addEventListener('activate', function (event) {
    event.waitUntil(
        caches.keys().then(function (keys) {
            return Promise.all(keys.map(function (key) {
                if (key !== SHELL_CACHE && key !== ASSET_CACHE) { return caches.delete(key); }
            }));
        }).then(function () { return self.clients.claim(); })
    );
});

self.addEventListener('fetch', function (event) {
    var request = event.request;
    if (request.method !== 'GET') { return; }
    var url = new URL(request.url);
    if (url.origin !== self.location.origin) { return; }

    // The shell goes network-first (B-009). Serving it from cache would hide
    // every new release from the only code that could notice one: the app
    // version that forms the next service worker's URL is compiled into
    // composeApp.js, so a cached bundle keeps re-registering the URL it is
    // already on and nothing ever advances. The cache remains the offline
    // fallback, so NF-002 is untouched.
    if (request.mode === 'navigate' || url.pathname.endsWith('/composeApp.js')) {
        event.respondWith(networkFirst(request));
        return;
    }
    event.respondWith(cacheFirst(request));
});

function networkFirst(request) {
    return fetch(request).then(function (response) {
        put(request, response, SHELL_CACHE);
        return response;
    }).catch(function () {
        return caches.match(request).then(function (cached) {
            return cached || offlineFallback(request);
        });
    });
}

function cacheFirst(request) {
    return caches.match(request).then(function (cached) {
        if (cached) { return cached; }
        return fetch(request).then(function (response) {
            put(request, response, isImmutable(request) ? ASSET_CACHE : SHELL_CACHE);
            return response;
        }).catch(function () { return offlineFallback(request); });
    });
}

/** Stores a copy of a usable same-origin response; ignores anything else. */
function put(request, response, cacheName) {
    if (!response || response.status !== 200 || response.type !== 'basic') { return; }
    var copy = response.clone();
    caches.open(cacheName).then(function (cache) { cache.put(request, copy); });
}

function offlineFallback(request) {
    if (request.mode === 'navigate') { return caches.match('./'); }
    return Response.error();
}

function isImmutable(request) {
    var path = new URL(request.url).pathname;
    for (var i = 0; i < IMMUTABLE.length; i++) {
        if (path.endsWith(IMMUTABLE[i])) { return true; }
    }
    return false;
}
