// 오프라인 조회 지원: 서비스 워커 등록 + 세션 전체 미리 받아 두기
import { api, SessionSummary } from './api'

/** 서비스 워커는 HTTPS 또는 localhost 에서만 동작한다. 개발 서버(Vite)에서는 등록하지 않는다. */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* 비보안 컨텍스트 등: 오프라인 기능 없이 계속 동작 */
    })
  })
}

export function offlineCapable(): boolean {
  return 'serviceWorker' in navigator && !!navigator.serviceWorker.controller
}

const done = new Set<string>()
let running = false

/**
 * 목록에 있는 모든 세션의 상세와 사진(썸네일·원본)을 백그라운드로 받아 서비스 워커 캐시에 넣는다.
 * 열어 보지 않은 세션도 오프라인에서 볼 수 있게 하기 위함. 사진은 캐시 우선이라 다시 받지 않는다.
 */
export async function prefetchSessions(sessions: SessionSummary[]): Promise<void> {
  if (running || !offlineCapable() || !navigator.onLine) return
  running = true
  try {
    for (const s of sessions) {
      if (s.pending_count > 0) continue // 분석이 끝난 뒤에 받는다
      const key = `${s.id}:${s.updated_at}:${s.photo_count}:${s.item_count}:${s.order_count}`
      if (done.has(key)) continue
      try {
        const detail = await api.getSession(s.id)
        for (const p of detail.photos) {
          await fetch(api.thumbUrl(p.id)).catch(() => undefined)
          await fetch(api.photoUrl(p.id)).catch(() => undefined)
        }
        done.add(key)
      } catch {
        return // 네트워크가 끊겼으면 중단, 다음 기회에 이어서
      }
    }
  } finally {
    running = false
  }
}
