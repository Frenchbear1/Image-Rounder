/* Image Rounder service worker: offline support + "Share to Image Rounder" on Android. */
const VERSION = "v2.0.0";
const CORE = `image-rounder-core-${VERSION}`;
const RUNTIME = `image-rounder-runtime-${VERSION}`;
const SHARE = "image-rounder-share";

const CORE_FILES = [
  "./",
  "index.html",
  "app.js",
  "manifest.webmanifest",
  "favicon.ico",
  "icons/icon-192x192.png",
  "icons/icon-512x512.png",
  "icons/apple-touch-icon.png",
  "icons/icon-32x32.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CORE).then((c) => c.addAll(CORE_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key !== CORE && key !== RUNTIME && key !== SHARE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

async function handleShare(request) {
  try {
    const form = await request.formData();
    const files = form.getAll("images").filter((f) => f && typeof f !== "string");
    const cache = await caches.open(SHARE);
    let i = 0;
    for (const file of files) {
      await cache.put(
        new Request(`shared/${Date.now()}-${i++}`),
        new Response(file, { headers: { "content-type": file.type || "application/octet-stream", "x-name": encodeURIComponent(file.name || "shared-image") } })
      );
    }
  } catch (err) {
    // fall through to opening the app anyway
  }
  return Response.redirect("./?share=1", 303);
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.method === "POST" && url.pathname.endsWith("/share-target")) {
    event.respondWith(handleShare(request));
    return;
  }
  if (request.method !== "GET") return;

  // Pages + app code: network first so updates land immediately, cache as offline fallback.
  if (request.mode === "navigate" || /\/(index\.html|app\.js|manifest\.webmanifest)?$/.test(url.pathname)) {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(request);
        if (fresh.ok) (await caches.open(CORE)).put(request.mode === "navigate" ? "./" : request, fresh.clone());
        return fresh;
      } catch (err) {
        return (await caches.match(request, { ignoreSearch: true })) || (await caches.match("./")) || Response.error();
      }
    })());
    return;
  }

  // Everything else (icons, lazy decoders): cache first, fill on demand.
  event.respondWith((async () => {
    const hit = await caches.match(request, { ignoreSearch: true });
    if (hit) return hit;
    const res = await fetch(request);
    if (res.ok) (await caches.open(RUNTIME)).put(request, res.clone());
    return res;
  })());
});
