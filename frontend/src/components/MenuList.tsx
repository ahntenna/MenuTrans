import { FormEvent, useMemo, useState } from 'react'
import { api, MenuItem, SessionDetail } from '../api'
import { formatMoney } from '../format'
import { formatKrw, toKrw, useRates } from '../rates'
import { ImageIcon, PencilIcon, RefreshIcon, TrashIcon } from './icons'
import PhotoLocateDialog from './PhotoLocateDialog'

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()

// 여러 장의 사진에서 같은 메뉴가 중복 추출될 수 있으므로 원문 이름 기준으로 합친다.
// 분석 중인 사진의 항목도 포함하므로 번역되는 순서대로 목록에 나타난다.
function mergeItems(session: SessionDetail): { category: string; items: MenuItem[] }[] {
  const seen = new Map<string, MenuItem>()
  for (const photo of session.photos) {
    for (const it of photo.items) {
      const key = norm(it.original_name)
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
  const [editing, setEditing] = useState<MenuItem | null>(null)
  const [reloading, setReloading] = useState(false)
  const [locating, setLocating] = useState<MenuItem | null>(null)
  const rates = useRates()

  const analyzing = session.photos.some((p) => p.status === 'pending' || p.status === 'processing')

  // 주문 수량: 항목 id 또는 원어 이름으로 연결 (재분석으로 id 가 바뀌어도 유지)
  const qtyOf = (it: MenuItem) => {
    const key = norm(it.original_name)
    return session.orders.reduce(
      (sum, o) => (o.menu_item_id === it.id || (o.original_name && norm(o.original_name) === key) ? sum + o.quantity : sum),
      0,
    )
  }

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

  const remove = async (item: MenuItem) => {
    if (!window.confirm(`"${item.translated_name}" 메뉴를 목록에서 삭제할까요? (주문 기록은 남습니다)`)) return
    try {
      await api.deleteMenuItem(item.id)
    } catch (e) {
      onError((e as Error).message)
    }
  }

  const reload = async () => {
    const n = session.photos.length
    if (
      !window.confirm(
        `메뉴판을 초기화하고 사진 ${n}장을 모두 다시 분석합니다.\n직접 수정하거나 삭제한 메뉴는 원래대로 돌아갑니다. 계속할까요?`,
      )
    )
      return
    setReloading(true)
    try {
      await api.reanalyzeSession(session.id)
    } catch (e) {
      onError((e as Error).message)
    } finally {
      setReloading(false)
    }
  }

  const reloadButton = (withLabel: boolean) =>
    session.photos.length > 0 && (
      <button
        className={withLabel ? '' : 'icon'}
        onClick={reload}
        disabled={reloading || analyzing}
        aria-label="메뉴판 다시 불러오기"
        title="메뉴판 다시 불러오기 (초기화 후 전체 재분석)"
      >
        <RefreshIcon />
        {withLabel && ' 메뉴판 다시 불러오기'}
      </button>
    )

  if (groups.length === 0) {
    return (
      <>
        <p className="muted">
          {analyzing ? '번역된 항목이 생기는 대로 여기에 표시됩니다.' : '아직 번역된 메뉴가 없습니다. 메뉴판을 촬영해 주세요.'}
        </p>
        {!analyzing && <div className="info-actions">{reloadButton(true)}</div>}
      </>
    )
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

  return (
    <>
      <div className="menu-tools">
        <input className="search" placeholder="메뉴 검색 (한국어/원문)" value={query} onChange={(e) => setQuery(e.target.value)} />
        {reloadButton(false)}
      </div>
      {filtered.map((g) => (
        <section key={g.category} className="menu-group">
          <h2>{g.category}</h2>
          <ul className="list">
            {g.items.map((it) => {
              const qty = qtyOf(it)
              const krw = formatKrw(toKrw(it.price_value, currency, rates))
              return (
                <li key={it.id} className="card menu-item">
                  <div className="menu-main">
                    <div className="menu-names">
                      <strong>{it.translated_name}</strong>
                      <span className="muted small">{it.original_name}</span>
                    </div>
                    <div className="menu-price">
                      <span>{it.price_text || formatMoney(it.price_value, currency)}</span>
                      {krw && <span className="krw">{krw}</span>}
                    </div>
                  </div>
                  {it.description && <p className="desc">{it.description}</p>}
                  {it.tags.length > 0 && (
                    <div className="chips menu-tags">
                      {it.tags.map((t) => (
                        <span key={t} className="chip">
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="menu-foot">
                    <div className="item-actions">
                      <button className="icon" onClick={() => setLocating(it)} aria-label="사진에서 위치 보기" title="사진에서 위치 보기">
                        <ImageIcon />
                      </button>
                      <button className="icon" onClick={() => setEditing(it)} aria-label="메뉴 수정" title="메뉴 수정">
                        <PencilIcon />
                      </button>
                      <button className="icon danger" onClick={() => remove(it)} aria-label="메뉴 삭제" title="메뉴 삭제">
                        <TrashIcon />
                      </button>
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

      {locating && <PhotoLocateDialog item={locating} onClose={() => setLocating(null)} />}
      {editing && <EditItemDialog item={editing} onClose={() => setEditing(null)} onError={onError} />}
    </>
  )
}

function EditItemDialog({ item, onClose, onError }: { item: MenuItem; onClose: () => void; onError: (m: string) => void }) {
  const [translated, setTranslated] = useState(item.translated_name)
  const [original, setOriginal] = useState(item.original_name)
  const [description, setDescription] = useState(item.description)
  const [price, setPrice] = useState(item.price_text)
  const [category, setCategory] = useState(item.category)
  const [tags, setTags] = useState(item.tags.join(', '))
  const [saving, setSaving] = useState(false)

  const submit = async (ev: FormEvent) => {
    ev.preventDefault()
    if (!translated.trim() || !original.trim()) return
    setSaving(true)
    try {
      await api.updateMenuItem(item.id, {
        translated_name: translated.trim(),
        original_name: original.trim(),
        description: description.trim(),
        price_text: price.trim(),
        category: category.trim(),
        tags: tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
      })
      onClose()
    } catch (e) {
      onError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal" onClick={onClose}>
      <form className="modal-body form" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2>메뉴 수정</h2>
        <label>
          <span>
            번역명 <span className="req">*</span>
          </span>
          <input value={translated} onChange={(e) => setTranslated(e.target.value)} maxLength={300} required />
        </label>
        <label>
          <span>
            원어 메뉴명 <span className="req">*</span>
          </span>
          <input value={original} onChange={(e) => setOriginal(e.target.value)} maxLength={300} required />
        </label>
        <label>
          설명
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
        </label>
        <label>
          가격
          <input value={price} onChange={(e) => setPrice(e.target.value)} maxLength={100} placeholder="예: 12,50 €" />
        </label>
        <label>
          분류
          <input value={category} onChange={(e) => setCategory(e.target.value)} maxLength={200} placeholder="예: 전채, 메인, 음료" />
        </label>
        <label>
          태그 <span className="muted small">(쉼표로 구분)</span>
          <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="예: 매운맛, 채식" />
        </label>
        <div className="row form-actions">
          <span className="spacer" />
          <button type="button" onClick={onClose}>
            취소
          </button>
          <button type="submit" className="primary" disabled={saving || !translated.trim() || !original.trim()}>
            저장
          </button>
        </div>
      </form>
    </div>
  )
}
