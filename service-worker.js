const CACHE_NAME = "gastos-negocio-v3";
// app.js es un módulo ES que importa a todos los demás — si alguno de
// estos no queda precacheado, un arranque offline (o con la red lenta
// justo en ese archivo) puede fallar entero al no poder resolver el
// import, aunque index.html/app.js sí hayan cargado. Por eso van todos
// acá, no solo el punto de entrada.
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./ajustes.js",
  "./checklist.js",
  "./facturado.js",
  "./firebase.js",
  "./gastos.js",
  "./identidad.js",
  "./ideas.js",
  "./inversion.js",
  "./navegacion.js",
  "./reportes.js",
  "./resumen.js",
  "./sesion.js",
  "./setup.js",
  "./state.js",
  "./utils.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Solo manejamos GET del mismo origen (el shell de la app).
  // Todo lo demás (Firestore, Auth, APIs externas) pasa directo a la red.
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) {
    return;
  }

  // Red primero: así cualquier actualización del sitio se ve apenas hay
  // internet (no hace falta bumpear versiones a mano en cada deploy). Si no
  // hay red, recién ahí se usa lo último guardado en caché — eso es lo que
  // permite abrir la app sin conexión.
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.status === 200) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
        }
        return res;
      })
      .catch(() => caches.match(req))
  );
});
