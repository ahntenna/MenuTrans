import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { Link, Outlet } from 'react-router-dom'
import { ServerEvent, useServerEvents } from './useEvents'

// 하위 페이지가 서버 이벤트를 구독할 수 있도록 컨텍스트로 전달한다.
type Listener = (e: ServerEvent) => void
interface EventBus {
  subscribe: (fn: Listener) => () => void
  connected: boolean
}
const EventBusContext = createContext<EventBus>({ subscribe: () => () => {}, connected: false })
export const useEventBus = () => useContext(EventBusContext)

type Boot = 'checking' | 'ok' | 'fail'
const MIN_SPLASH_MS = 500 // 너무 빨리 사라져 깜빡이는 것 방지
const HEALTH_TIMEOUT_MS = 8000
const RETRY_MS = 3000

export default function App() {
  const [listeners] = useState(() => new Set<Listener>())
  const { connected } = useServerEvents((e) => listeners.forEach((fn) => fn(e)))
  const subscribe = useCallback(
    (fn: Listener) => {
      listeners.add(fn)
      return () => {
        listeners.delete(fn)
      }
    },
    [listeners],
  )

  // ---- 진입 시 서버 연결 확인 ----
  const [boot, setBoot] = useState<Boot>('checking')
  const retryTimer = useRef<number | null>(null)

  const check = useCallback(async () => {
    if (retryTimer.current !== null) {
      window.clearTimeout(retryTimer.current)
      retryTimer.current = null
    }
    setBoot('checking')
    const started = Date.now()
    const ctrl = new AbortController()
    const timeout = window.setTimeout(() => ctrl.abort(), HEALTH_TIMEOUT_MS)
    let ok = false
    try {
      const res = await fetch('/api/health', { cache: 'no-store', signal: ctrl.signal })
      ok = res.ok
    } catch {
      ok = false
    } finally {
      window.clearTimeout(timeout)
    }
    const wait = Math.max(0, MIN_SPLASH_MS - (Date.now() - started))
    window.setTimeout(() => {
      if (ok) {
        setBoot('ok')
      } else {
        setBoot('fail')
        retryTimer.current = window.setTimeout(() => void check(), RETRY_MS) // 자동 재시도
      }
    }, wait)
  }, [])

  useEffect(() => {
    void check()
    return () => {
      if (retryTimer.current !== null) window.clearTimeout(retryTimer.current)
    }
  }, [check])

  if (boot !== 'ok') {
    return (
      <div className="splash">
        <img src="/icon.svg" alt="" className="splash-logo" />
        <div className="splash-title">MenuTrans</div>
        {boot === 'checking' ? (
          <>
            <div className="spinner" aria-hidden />
            <p className="splash-msg">서버 연결 확인 중…</p>
          </>
        ) : (
          <>
            <p className="splash-msg fail">서버에 연결할 수 없습니다.</p>
            <p className="splash-sub">잠시 후 자동으로 다시 시도합니다.</p>
            <button className="primary" onClick={() => void check()}>
              지금 다시 시도
            </button>
          </>
        )}
      </div>
    )
  }

  return (
    <EventBusContext.Provider value={{ subscribe, connected }}>
      <header className="topbar">
        <Link to="/" className="brand">
          MenuTrans
        </Link>
        <span className={`dot ${connected ? 'on' : 'off'}`} title={connected ? '실시간 연결됨' : '재연결 중'} />
      </header>
      <main className="page">
        <Outlet />
      </main>
    </EventBusContext.Provider>
  )
}
