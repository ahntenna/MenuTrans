import { FormEvent, useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, SessionSummary } from '../api'
import { useEventBus } from '../App'
import { formatDate } from '../format'

export default function SessionListPage() {
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null)
  const [error, setError] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const { subscribe } = useEventBus()

  const load = useCallback(async () => {
    try {
      setSessions(await api.listSessions())
      setError('')
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])

  useEffect(() => {
    void load()
    return subscribe(() => void load())
  }, [load, subscribe])

  const onCreate = async (ev: FormEvent) => {
    ev.preventDefault()
    if (!name.trim()) return
    setBusy(true)
    try {
      await api.createSession(name.trim())
      setName('')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <form className="card row" onSubmit={onCreate}>
        <input
          placeholder="식당 이름 (새 세션)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={200}
        />
        <button type="submit" disabled={busy || !name.trim()}>
          만들기
        </button>
      </form>

      {error && <p className="error">{error}</p>}
      {sessions === null && <p className="muted">불러오는 중…</p>}
      {sessions && sessions.length === 0 && <p className="muted">아직 세션이 없습니다. 식당 이름을 입력해 시작하세요.</p>}

      <ul className="list">
        {sessions?.map((s) => (
          <li key={s.id}>
            <Link to={`/sessions/${s.id}`} className="card session">
              <div className="session-head">
                <strong>{s.name}</strong>
                <span className="muted small">{formatDate(s.created_at)}</span>
              </div>
              <div className="chips">
                <span className="chip">사진 {s.photo_count}</span>
                <span className="chip">메뉴 {s.item_count}</span>
                <span className="chip">주문 {s.order_count}</span>
                {s.pending_count > 0 && <span className="chip warn">분석 중 {s.pending_count}</span>}
              </div>
              {s.note && <p className="muted small">{s.note}</p>}
            </Link>
          </li>
        ))}
      </ul>
    </>
  )
}
