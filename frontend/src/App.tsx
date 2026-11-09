import { createContext, useCallback, useContext, useState } from 'react'
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
