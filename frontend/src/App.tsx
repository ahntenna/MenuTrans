import { createContext, FormEvent, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { Link, Outlet } from 'react-router-dom'
import { api, ApiError, UNAUTHORIZED_EVENT } from './api'
import { AutoThemeIcon, GearIcon, MoonIcon, SunIcon } from './components/icons'
import { THEME_LABEL, useTheme } from './theme'
import { ServerEvent, useServerEvents } from './useEvents'

// 하위 페이지가 서버 이벤트를 구독할 수 있도록 컨텍스트로 전달한다.
type Listener = (e: ServerEvent) => void
interface EventBus {
  subscribe: (fn: Listener) => () => void
  connected: boolean
  /** 서버에 닿지 않아 저장된 내용만 보여 주는 상태 */
  offline: boolean
}
const EventBusContext = createContext<EventBus>({ subscribe: () => () => {}, connected: false, offline: false })
export const useEventBus = () => useContext(EventBusContext)

type Boot = 'checking' | 'login' | 'ok' | 'fail'
const MIN_SPLASH_MS = 500 // 너무 빨리 사라져 깜빡이는 것 방지
const HEALTH_TIMEOUT_MS = 8000
const RETRY_MS = 3000
const OFFLINE_RECHECK_MS = 10000
// 한 번이라도 정상 진입했던 기기인지 (오프라인일 때 저장된 내용으로 진입 허용)
const READY_KEY = 'mt_ready'

async function serverReachable(): Promise<boolean> {
  const ctrl = new AbortController()
  const timeout = window.setTimeout(() => ctrl.abort(), HEALTH_TIMEOUT_MS)
  try {
    const res = await fetch('/api/health', { cache: 'no-store', signal: ctrl.signal })
    return res.ok
  } catch {
    return false
  } finally {
    window.clearTimeout(timeout)
  }
}

function wasReady(): boolean {
  try {
    return localStorage.getItem(READY_KEY) === '1'
  } catch {
    return false
  }
}
function markReady(v: boolean): void {
  try {
    if (v) localStorage.setItem(READY_KEY, '1')
    else localStorage.removeItem(READY_KEY)
  } catch {
    /* ignore */
  }
}

export default function App() {
  const [boot, setBoot] = useState<Boot>('checking')
  const [offline, setOffline] = useState(false)
  const themeState = useTheme() // 스플래시·로그인 화면에도 테마가 적용되도록 최상위에서 호출
  const timer = useRef<number | null>(null)

  const clearTimer = () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current)
      timer.current = null
    }
  }

  // 진입 시: 서버 연결 확인 → 인증 확인. 서버에 닿지 않으면 저장된 내용으로 오프라인 진입.
  const check = useCallback(async (silent = false) => {
    clearTimer()
    if (!silent) setBoot('checking')
    const started = Date.now()
    let next: Boot = 'fail'
    let nextOffline = false

    if (await serverReachable()) {
      try {
        const auth = await api.authStatus()
        next = auth.authenticated ? 'ok' : 'login'
        markReady(auth.authenticated)
      } catch {
        next = 'fail'
      }
    } else if (wasReady()) {
      next = 'ok'
      nextOffline = true
    }

    const apply = () => {
      setOffline(nextOffline)
      setBoot((prev) => (silent && next === 'fail' ? prev : next))
      if (next === 'fail') timer.current = window.setTimeout(() => void check(silent), RETRY_MS)
      else if (nextOffline) timer.current = window.setTimeout(() => void check(true), OFFLINE_RECHECK_MS) // 연결 복구 감시
    }
    if (silent) apply()
    else window.setTimeout(apply, Math.max(0, MIN_SPLASH_MS - (Date.now() - started)))
  }, [])

  useEffect(() => {
    void check()
    const onUnauthorized = () => {
      markReady(false)
      setBoot('login')
    }
    const onOnline = () => void check(true)
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
    window.addEventListener('online', onOnline)
    return () => {
      clearTimer()
      window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
      window.removeEventListener('online', onOnline)
    }
  }, [check])

  if (boot === 'login') {
    return (
      <LoginScreen
        onDone={() => {
          markReady(true)
          setBoot('ok')
        }}
      />
    )
  }

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

  return <Shell offline={offline} themeState={themeState} />
}

/** 인증이 끝난 뒤의 본 화면. SSE 는 여기서부터 연결한다. */
function Shell({ offline, themeState }: { offline: boolean; themeState: ReturnType<typeof useTheme> }) {
  const { theme, cycle } = themeState
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

  // 오프라인에서 돌아오면 화면을 다시 불러오도록 알린다
  const wasOffline = useRef(offline)
  useEffect(() => {
    if (wasOffline.current && !offline) listeners.forEach((fn) => fn({ type: 'resync' }))
    wasOffline.current = offline
  }, [offline, listeners])

  return (
    <EventBusContext.Provider value={{ subscribe, connected, offline }}>
      <header className="topbar">
        <Link to="/" className="brand">
          MenuTrans
        </Link>
        <div className="topbar-right">
          <span className={`dot ${connected && !offline ? 'on' : 'off'}`} title={connected ? '실시간 연결됨' : '재연결 중'} />
          <button
            className="icon theme-toggle"
            onClick={cycle}
            aria-label={`테마: ${THEME_LABEL[theme]} (눌러서 변경)`}
            title={`테마: ${THEME_LABEL[theme]}`}
          >
            {theme === 'auto' ? <AutoThemeIcon /> : theme === 'dark' ? <MoonIcon /> : <SunIcon />}
          </button>
          <Link to="/settings" className="icon-link" aria-label="설정" title="설정">
            <GearIcon />
          </Link>
        </div>
      </header>
      {offline && <div className="offline-bar">오프라인 · 저장된 내용을 표시 중입니다. 변경은 연결 후에 할 수 있습니다.</div>}
      <main className="page">
        <Outlet />
      </main>
    </EventBusContext.Provider>
  )
}

function LoginScreen({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (ev: FormEvent) => {
    ev.preventDefault()
    if (!password) return
    setBusy(true)
    setError('')
    try {
      await api.login(password)
      onDone()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '로그인에 실패했습니다.')
      setPassword('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="splash" onSubmit={submit}>
      <img src="/icon.svg" alt="" className="splash-logo" />
      <div className="splash-title">MenuTrans</div>
      <p className="splash-msg">비밀번호를 입력해 주세요.</p>
      <input
        className="login-input"
        type="password"
        inputMode="numeric"
        autoComplete="current-password"
        autoFocus
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="비밀번호"
        aria-label="비밀번호"
      />
      {error && <p className="splash-msg fail">{error}</p>}
      <button type="submit" className="primary" disabled={busy || !password}>
        들어가기
      </button>
    </form>
  )
}
