var CACHE_NAME = "orbita-cache-v4";
var APP_SHELL = ["./", "./index.html", "./manifest.json"];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) { return cache.addAll(APP_SHELL); })
  );
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE_NAME; }).map(function (k) { return caches.delete(k); }));
    })
  );
  self.clients.claim();
});

self.addEventListener("fetch", function (event) {
  var req = event.request;
  if (req.method !== "GET" || req.url.indexOf(self.location.origin) !== 0) return;

  // Always prefer the network for the app shell itself, so a new deploy is
  // picked up immediately instead of an old cached page sticking around.
  if (req.mode === "navigate" || req.destination === "document") {
    event.respondWith(
      fetch(req)
        .then(function (response) {
          var copy = response.clone();
          caches.open(CACHE_NAME).then(function (cache) { cache.put(req, copy); });
          return response;
        })
        .catch(function () { return caches.match(req); })
    );
    return;
  }

  // Static assets (icons, manifest): cache-first for speed, refreshed in the background.
  event.respondWith(
    caches.match(req).then(function (cached) {
      var networkFetch = fetch(req)
        .then(function (response) {
          if (response && response.status === 200) {
            var copy = response.clone();
            caches.open(CACHE_NAME).then(function (cache) { cache.put(req, copy); });
          }
          return response;
        })
        .catch(function () { return cached; });
      return cached || networkFetch;
    })
  );
});

// Real push notifications: shown by the OS even with the app fully closed,
// since this runs in the service worker, not the page.
self.addEventListener("push", function (event) {
  var data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) {}
  var title = data.title || "ÓRBITA";
  var options = {
    body: data.body || "",
    icon: "icons/icon-192.png",
    badge: "icons/icon-192.png",
    tag: data.tag || "orbita-reminder-" + Date.now(),
    vibrate: [200, 100, 200],
    requireInteraction: false,
    // Guardamos os dados do compromisso aqui pra poder falar em voz alta
    // assim que o usuário tocar na notificação (ver notificationclick abaixo)
    // — um celular travado não deixa nenhum app tocar áudio customizado
    // vindo direto da notificação, então a fala só acontece quando o app
    // realmente abre/ganha foco.
    data: {
      url: data.url || "./",
      apptTitle: data.apptTitle || "",
      apptTime: data.apptTime || "",
      apptLocation: data.apptLocation || ""
    }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  var data = event.notification.data || {};
  var url = data.url || "./";
  var speakMsg = data.apptTitle
    ? { type: "speak-reminder", apptTitle: data.apptTitle, apptTime: data.apptTime, apptLocation: data.apptLocation }
    : null;

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        if ("focus" in list[i]) {
          if (speakMsg) list[i].postMessage(speakMsg);
          return list[i].focus();
        }
      }
      if (clients.openWindow) {
        // Não há janela aberta pra mandar a mensagem: a página ainda vai
        // carregar, então passamos os dados pela própria URL — o app lê
        // esses parâmetros assim que inicia e fala o lembrete.
        if (speakMsg) {
          var qs = "speak=1"
            + "&apptTitle=" + encodeURIComponent(data.apptTitle || "")
            + "&apptTime=" + encodeURIComponent(data.apptTime || "")
            + "&apptLocation=" + encodeURIComponent(data.apptLocation || "");
          url += (url.indexOf("?") === -1 ? "?" : "&") + qs;
        }
        return clients.openWindow(url);
      }
    })
  );
});
