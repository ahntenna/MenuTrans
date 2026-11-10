/* MenuTrans 서비스 워커: 오프라인 조회용 캐시.
 *
 * - 앱 셸(index.html, /assets): 한 번 받은 뒤 캐시에서 제공
 * - API GET (세션 목록/상세, 환율, 사용량): 네트워크 우선, 실패하면 마지막으로 받은 응답
 * - 사진 원본/썸네일: 바뀌지 않으므로 캐시 우선
 * - 인증, 상태 확인, SSE, 내보내기, 그리고 모든 쓰기 요청은 캐시하지 않는다
 */
const VERSION = 'v1'
const SHELL = `mt-shell-${VERSION}`
const API = `mt-api-${VERSION}`
const IMG = `mt-img-${VERSION}`
const NETWORK_TIMEOUT_MS = 6000

self.addEventListener('install', (event) => {
  self.skipWaiting()
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(['/', '/icon.svg', '/manifest.webmanifest'])))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([SHELL, API, IMG])
      for (const key of await caches.keys()) {
        if (key.startsWith('mt-') && !keep.has(key)) await caches.delete(key)
      }
      await self.clients.claim()
    })(),
  )
})

const NO_CACHE = ['/api/events', '/api/health', '/api/auth', '/api/login', '/api/logout', '/api/status']

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return
  const path = url.pathname
  if (NO_CACHE.includes(path) || path.endsWith('/export')) return

  if (/^\/api\/photos\/[^/]+\/(file|thumb)$/.test(path)) {
    event.respondWith(cacheFirst(req, IMG))
  } else if (path.startsWith('/api/')) {
    event.respondWith(networkFirst(req, API, req))
  } else if (req.mode === 'navigate') {
    // SPA: 어떤 경로든 같은 index.html. 캐시 키는 '/' 하나로 통일
    event.respondWith(networkFirst(req, SHELL, '/'))
  } else {
    event.respondWith(cacheFirst(req, SHELL))
  }
})

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName)
  const hit = await cache.match(req)
  if (hit) return hit
  const res = await fetch(req)
  if (res.ok) cache.put(req, res.clone())
  return res
}

async function networkFirst(req, cacheName, cacheKey) {
  const cache = await caches.open(cacheName)
  try {
    const res = await withTimeout(fetch(req), NETWORK_TIMEOUT_MS)
    if (res.ok) cache.put(cacheKey, res.clone())
    return res // 401/404 등은 그대로 전달 (캐시로 덮지 않음)
  } catch (err) {
    const hit = await cache.match(cacheKey)
    if (hit) return hit
    throw err
  }
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms)
    promise.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        reject(e)
      },
    )
  })
}
