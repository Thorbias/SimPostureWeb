// SimPosture root kill-switch service worker.
//
// Until F-057 the app lived at the site root, so returning visitors have a
// service worker registered with scope "/" that serves the OLD app cache-first
// (F-050). After the move to /app/, the root would otherwise keep serving that
// stale cached app forever — the new landing page would never appear, because
// nothing at the root supersedes the old worker (GUIDELINES, "Web/Wasm").
//
// This worker's only job is to remove itself: purge the old caches, unregister,
// and reload the controlled pages once so they fetch the real landing page from
// the network. The landing page itself registers no service worker; the app
// keeps its own worker under /app/.

self.addEventListener('install', function () {
    self.skipWaiting();
});

self.addEventListener('activate', function (event) {
    event.waitUntil(
        caches.keys()
            .then(function (names) {
                return Promise.all(
                    names
                        .filter(function (name) { return name.indexOf('simposture-cache-') === 0; })
                        .map(function (name) { return caches.delete(name); })
                );
            })
            .then(function () { return self.registration.unregister(); })
            .then(function () { return self.clients.matchAll({ type: 'window' }); })
            .then(function (clients) {
                clients.forEach(function (client) { client.navigate(client.url); });
            })
    );
});
