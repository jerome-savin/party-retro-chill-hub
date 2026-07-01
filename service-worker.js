const CACHE_NAME = "prch-pwa-v1";
const APP_SHELL = [
  "./",
  "./index.html",
  "./connexion.html",
  "./chat.html",
  "./assets/escape.css",
  "./assets/api-config.js",
  "./assets/auth.js",
  "./assets/pwa.js",
  "./assets/push-config.js",
  "./assets/favicons/favicon-prch.png"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys
        .filter(key => key !== CACHE_NAME)
        .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") {
    return;
  }

  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) {
        return cached;
      }

      return fetch(request)
        .then(response => {
          const copy = response.clone();
          if (response.ok && new URL(request.url).origin === self.location.origin) {
            caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.match("./index.html"));
    })
  );
});

self.addEventListener("push", event => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (error) {
    payload = { body: event.data ? event.data.text() : "" };
  }

  const title = payload.title || "Party Retro Chill Hub";
  const options = {
    body: payload.body || "Nouvelle notification PRCH.",
    icon: "assets/favicons/favicon-prch.png",
    badge: "assets/favicons/favicon-prch.png",
    data: {
      url: payload.url || "chat.html"
    }
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data && event.notification.data.url ? event.notification.data.url : "index.html", self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(clients => {
      const existing = clients.find(client => client.url === targetUrl);
      if (existing) {
        return existing.focus();
      }
      return self.clients.openWindow(targetUrl);
    })
  );
});
