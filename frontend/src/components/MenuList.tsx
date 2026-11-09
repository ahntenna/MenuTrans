import { useMemo, useState } from 'react'
import { api, MenuItem, SessionDetail } from '../api'
import { formatMoney } from '../format'

// 여러 장의 사진에서 같은 메뉴가 중복 추출될 수 있으므로 원문 이름 기준으로 합친다.
// 분석 중인 사진의 항목도 포함하므로 번역되는 순서대로 목록에 나타난다.
function mergeItems(session: SessionDetail): { category: string; items: MenuItem[] }[] {
  const seen = new Map<string, MenuItem>()
  for (const photo of session.photos) {
    for (const it of photo.items) {
      const key = it.original_name.toLowerCase().replace(/\s+/g, ' ').trim()
      if (!seen.has(key)) seen.set(key, it)
    }
  }
  const groups = new Map<string, MenuItem[]>()
  for (const it of seen.values()) {
    const cat = it.category || '기타'
    if (!groups.has(cat)) groups.set(cat, [])
    groups.get(cat)!.push(it)
  }
  return [...groups.entries()].map(([category, items]) => ({ category, items }))
}

export default function MenuList({
  session,
  currency,
  onError,
}: {
  session: SessionDetail
  currency: string
  onError: (m: string) => void
}) {
  const groups = useMemo(() => mergeItems(session), [session])
  const [query, setQuery] = useState('')
  const [adding, setAdding] = useState<string | null>(null)

  const orderedQty = useMemo(() => {
    const m = new Map<string, number>()
    session.orders.forEach((o) => o.menu_item_id && m.set(o.menu_item_id, (m.get(o.menu_item_id) ?? 0) + o.quantity))
    return m
  }, [session.orders])

  const order = async (item: MenuItem) => {
    setAdding(item.id)
    try {
      await api.createOrder(session.id, { menu_item_id: item.id, quantity: 1 })
    } catch (e) {
      onError((e as Error).message)
    } finally {
      setAdding(null)
    }
  }

  const q = query.trim().toLowerCase()
  const filtered = groups
    .map((g) => ({
      ...g,
      items: q
        ? g.items.filter((it) =>
            [it.original_name, it.translated_name, it.description, ...it.tags].some((s) => s.toLowerCase().includes(q)),
          )
        : g.items,
    }))
    .filter((g) => g.items.length > 0)

  if (groups.length === 0) {
    const analyzing = session.photos.some((p) => p.status === 'pending' || p.status === 'processing')
    return (
      <p className="muted">
        {analyzing ? '번역된 항목이 생기는 대로 여기에 표시됩니다.' : '아직 번역된 메뉴가 없습니다. 메뉴판을 촬영해 주세요.'}
      </p>
    )
  }

  return (
    <>
      <input className="search" placeholder="메뉴 검색 (한국어/원문)" value={query} onChange={(e) => setQuery(e.target.value)} />
      {filtered.map((g) => (
        <section key={g.category} className="menu-group">
          <h2>{g.category}</h2>
          <ul className="list">
            {g.items.map((it) => {
              const qty = orderedQty.get(it.id) ?? 0
              return (
                <li key={it.id} className="card menu-item">
                  <div className="menu-main">
                    <div className="menu-names">
                      <strong>{it.translated_name}</strong>
                      <span className="muted small">{it.original_name}</span>
                    </div>
                    <div className="menu-price">
                      <span>{it.price_text || formatMoney(it.price_value, currency)}</span>
                    </div>
                  </div>
                  {it.description && <p className="desc">{it.description}</p>}
                  <div className="menu-foot">
                    <div className="chips">
                      {it.tags.map((t) => (
                        <span key={t} className="chip">
                          {t}
                        </span>
                      ))}
                    </div>
                    <button className={qty ? 'ordered' : 'primary'} onClick={() => order(it)} disabled={adding === it.id}>
                      {qty ? `주문 ${qty} · 추가` : '주문'}
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </>
  )
}
