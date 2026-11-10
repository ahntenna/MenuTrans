import { FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, SessionSummary, UsageReport } from '../api'
import { useEventBus } from '../App'
import { formatDate, formatVisit } from '../format'
import { prefetchSessions } from '../offline'
import { formatKrw, formatUsd, toKrw, useRates } from '../rates'

export default function SessionListPage() {
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null)
  const [usage, setUsage] = useState<UsageReport | null>(null)
  const [error, setError] = useState('')
  const [name, setName] = useState('')
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const { subscribe, offline } = useEventBus()
  const rates = useRates()
  const queryRef = useRef('')

  const load = useCallback(async () => {
    const q = queryRef.current
    try {
      const list = await api.listSessions(q)
      if (q !== queryRef.current) return // 그사이 검색어가 바뀜
      setSessions(list)
      setError('')
      if (!q) void prefetchSessions(list) // 오프라인 조회용으로 세션 전체를 미리 받아 둔다
    } catch (e) {
      setError((e as Error).message)
    }
    api.usage().then(setUsage, () => undefined)
  }, [])

  useEffect(() => {
    void load()
    return subscribe(() => void load())
  }, [load, subscribe])

  // 검색어 입력은 잠깐 모았다가 조회
  useEffect(() => {
    queryRef.current = query.trim()
    const t = window.setTimeout(() => void load(), 250)
    return () => window.clearTimeout(t)
  }, [query, load])

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

  const searching = query.trim().length > 0

  return (
    <>
      <form className="card row" onSubmit={onCreate}>
        <input
          placeholder="식당 이름 (새 세션)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={200}
          disabled={offline}
        />
        <button type="submit" disabled={busy || offline || !name.trim()}>
          만들기
        </button>
      </form>

      <input
        className="search session-search"
        type="search"
        placeholder="세션 검색 (식당, 주소, 메뉴 이름)"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      {error && <p className="error">{error}</p>}
      {sessions === null && !error && <p className="muted">불러오는 중…</p>}
      {sessions && sessions.length === 0 && (
        <p className="muted">{searching ? '검색 결과가 없습니다.' : '아직 세션이 없습니다. 식당 이름을 입력해 시작하세요.'}</p>
      )}

      <ul className="list">
        {sessions?.map((s) => (
          <li key={s.id}>
            <Link to={`/sessions/${s.id}`} className="card session">
              <div className="session-head">
                <strong>{s.name}</strong>
                <span className="muted small">{s.visited_at ? `방문 ${formatVisit(s.visited_at)}` : formatDate(s.created_at)}</span>
              </div>
              {(s.store_name || s.address) && (
                <div className="muted small store-line">
                  {s.store_name && s.store_name !== s.name && <span>{s.store_name}</span>}
                  {s.address && <span>{s.address}</span>}
                </div>
              )}
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

      {usage && usage.total.calls > 0 && (
        <div className="usage-foot muted small">
          <div>
            번역 비용 누적 <strong>{formatUsd(usage.total.cost_usd)}</strong> {formatKrw(toKrw(usage.total.cost_usd, 'USD', rates))} · 분석{' '}
            {usage.total.calls}회
          </div>
          <div>
            이번 달 {formatUsd(usage.this_month.cost_usd)} {formatKrw(toKrw(usage.this_month.cost_usd, 'USD', rates))} · {usage.this_month.calls}회
          </div>
          <div>토큰 단가 기준 추정치이며 실제 청구액과 다를 수 있습니다.</div>
        </div>
      )}
    </>
  )
}
