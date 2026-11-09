import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api, SessionDetail } from '../api'
import { useEventBus } from '../App'
import PhotoUploader from '../components/PhotoUploader'
import PhotoStrip from '../components/PhotoStrip'
import MenuList from '../components/MenuList'
import OrderPanel from '../components/OrderPanel'
import ProgressBanner from '../components/ProgressBanner'

type Tab = 'menu' | 'orders' | 'photos'

export default function SessionDetailPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { subscribe } = useEventBus()
  const [session, setSession] = useState<SessionDetail | null>(null)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<Tab>('menu')
  const [editing, setEditing] = useState(false)
  const reloadTimer = useRef<number | null>(null)

  const load = useCallback(async () => {
    try {
      setSession(await api.getSession(id))
      setError('')
    } catch (e) {
      setError((e as Error).message)
    }
  }, [id])

  // 항목이 하나씩 추가될 때 이벤트가 연달아 오므로 짧게 모아서 한 번만 다시 조회한다.
  const scheduleLoad = useCallback(() => {
    if (reloadTimer.current !== null) return
    reloadTimer.current = window.setTimeout(() => {
      reloadTimer.current = null
      void load()
    }, 250)
  }, [load])

  useEffect(() => {
    void load()
    const unsub = subscribe((e) => {
      if (e.type === 'session.deleted' && e.session_id === id) {
        navigate('/')
        return
      }
      if (e.type === 'resync' || !e.session_id || e.session_id === id) scheduleLoad()
    })
    return () => {
      unsub()
      if (reloadTimer.current !== null) window.clearTimeout(reloadTimer.current)
    }
  }, [id, load, scheduleLoad, subscribe, navigate])

  const currency = useMemo(() => {
    const counts = new Map<string, number>()
    session?.photos.forEach((p) => p.currency && counts.set(p.currency, (counts.get(p.currency) ?? 0) + 1))
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? ''
  }, [session])

  if (error && !session) return <p className="error">{error}</p>
  if (!session) return <p className="muted">불러오는 중…</p>

  const onRename = async () => {
    const name = window.prompt('식당 이름', session.name)
    if (name && name.trim() && name.trim() !== session.name) {
      await api.updateSession(session.id, { name: name.trim() })
    }
    setEditing(false)
  }
  const onDelete = async () => {
    if (!window.confirm(`"${session.name}" 세션과 사진, 주문 기록을 모두 삭제할까요?`)) return
    await api.deleteSession(session.id)
    navigate('/')
  }

  return (
    <>
      <div className="session-title">
        <h1 onClick={() => setEditing((v) => !v)}>{session.name}</h1>
        {editing && (
          <div className="row">
            <button onClick={onRename}>이름 변경</button>
            <button className="danger" onClick={onDelete}>
              세션 삭제
            </button>
          </div>
        )}
      </div>

      <PhotoUploader sessionId={session.id} onError={setError} />
      {error && <p className="error">{error}</p>}
      <ProgressBanner photos={session.photos} />

      <nav className="tabs">
        <button className={tab === 'menu' ? 'active' : ''} onClick={() => setTab('menu')}>
          메뉴판
        </button>
        <button className={tab === 'orders' ? 'active' : ''} onClick={() => setTab('orders')}>
          주문 {session.orders.length > 0 && <span className="badge">{session.orders.length}</span>}
        </button>
        <button className={tab === 'photos' ? 'active' : ''} onClick={() => setTab('photos')}>
          사진 {session.photos.length}
        </button>
      </nav>

      {tab === 'menu' && <MenuList session={session} currency={currency} onError={setError} />}
      {tab === 'orders' && <OrderPanel session={session} currency={currency} onError={setError} />}
      {tab === 'photos' && <PhotoStrip photos={session.photos} onError={setError} />}
    </>
  )
}
