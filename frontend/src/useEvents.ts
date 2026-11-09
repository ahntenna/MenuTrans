// SSE 구독 훅. 서버에서 변경 이벤트가 오면 콜백을 호출한다.
// 어떤 이벤트든 "다시 조회" 로 처리하므로 페이로드는 session_id 필터 용도로만 쓴다.
import { useEffect, useRef, useState } from 'react'

export interface ServerEvent {
  type: string
  session_id?: string
  photo_id?: string
  order_id?: string
  status?: string
}

const EVENT_TYPES = [
  'session.created',
  'session.updated',
  'session.deleted',
  'photo.created',
  'photo.updated',
  'photo.deleted',
  'item.added',
  'order.changed',
]

export function useServerEvents(onEvent: (e: ServerEvent) => void): { connected: boolean } {
  const [connected, setConnected] = useState(false)
  const handler = useRef(onEvent)
  handler.current = onEvent

  useEffect(() => {
    const es = new EventSource('/api/events')
    es.addEventListener('hello', () => setConnected(true))
    es.onopen = () => setConnected(true)
    es.onerror = () => setConnected(false) // 브라우저가 자동 재접속함
    for (const type of EVENT_TYPES) {
      es.addEventListener(type, (ev) => {
        let data: Record<string, string> = {}
        try {
          data = JSON.parse((ev as MessageEvent).data)
        } catch {
          /* ignore */
        }
        handler.current({ type, ...data })
      })
    }
    // 백그라운드에서 돌아온 뒤(iOS Safari) 연결이 끊겨 있을 수 있으므로 재조회 트리거
    const onVisible = () => {
      if (document.visibilityState === 'visible') handler.current({ type: 'resync' })
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      es.close()
    }
  }, [])

  return { connected }
}
