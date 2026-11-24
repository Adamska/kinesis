// Cache-first for content that never changes at a given URL: the pinned MediaPipe
// runtime, the versioned models and the hashed build assets. Everything else, the
// HTML shell included, goes to the network so a deploy is picked up immediately.
const CACHE = 'kinesis-v1'
const IMMUTABLE_PREFIXES = [
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@',
  'https://storage.googleapis.com/mediapipe-models/',
  `${self.location.origin}/assets/`,
]

self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys()
      await Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name)))
      await self.clients.claim()
    })(),
  )
})

async function cacheFirst(request) {
  const cache = await caches.open(CACHE)
  const cached = await cache.match(request)
  if (cached) return cached
  const response = await fetch(request)
  if (response.ok) await cache.put(request, response.clone())
  return response
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET' || !IMMUTABLE_PREFIXES.some((prefix) => request.url.startsWith(prefix))) return
  event.respondWith(cacheFirst(request))
})
