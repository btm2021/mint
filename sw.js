/**
 * MintChart Service Worker — Network Only
 *
 * Purpose: Make the app installable as a PWA without caching any source code.
 * Every request always goes to the network. The SW acts as a transparent proxy.
 * This means the app always loads the latest code on every open.
 */

const SW_VERSION = 'v1';

// Install: activate immediately, skip waiting
self.addEventListener('install', () => {
  self.skipWaiting();
});

// Activate: claim all clients immediately so the SW takes effect right away
self.addEventListener('activate', (e) => {
  e.waitUntil(self.clients.claim());
});

// Fetch: always go to network, never serve from cache
self.addEventListener('fetch', (e) => {
  // Let the browser handle non-GET requests normally
  if (e.request.method !== 'GET') return;

  e.respondWith(
    fetch(e.request).catch(() => {
      // Offline fallback: return a minimal offline page so the app
      // at least shows something when there's no connection.
      return new Response(
        `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>MintChart — Offline</title>
  <style>
    body { margin:0; background:#080810; color:#c3c6ce;
           font-family:system-ui,sans-serif; display:flex;
           align-items:center; justify-content:center; height:100vh;
           flex-direction:column; gap:16px; }
    .icon { font-size:48px; }
    h1 { margin:0; font-size:20px; color:#fff; }
    p  { margin:0; font-size:13px; color:#5a6272; }
  </style>
</head>
<body>
  <div class="icon">📡</div>
  <h1>No Connection</h1>
  <p>MintChart needs internet to load live chart data.</p>
  <p>Please check your connection and try again.</p>
</body>
</html>`,
        {
          status: 503,
          headers: { 'Content-Type': 'text/html; charset=utf-8' }
        }
      );
    })
  );
});
