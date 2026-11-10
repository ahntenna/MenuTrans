import { FormEvent, useState } from 'react'
import { api, Order, SessionDetail } from '../api'
import { formatMoney } from '../format'
import { TrashIcon } from './icons'

export default function OrderPanel({
  session,
  currency,
  onError,
}: {
  session: SessionDetail
  currency: string
  onError: (m: string) => void
}) {
  const [name, setName] = useState('')
  const [price, setPrice] = useState('')

  const total = session.orders.reduce((sum, o) => sum + (o.price_value ?? 0) * o.quantity, 0)
  const hasUnknown = session.orders.some((o) => o.price_value === null)

  const changeQty = async (o: Order, delta: number) => {
    const next = Math.max(1, o.quantity + delta)
    if (next === o.quantity) return
    try {
      await api.updateOrder(o.id, { quantity: next })
    } catch (e) {
      onError((e as Error).message)
    }
  }

  const remove = async (o: Order) => {
    if (!window.confirm(`"${o.original_name || o.name_snapshot}" 주문을 삭제할까요?`)) return
    try {
      await api.deleteOrder(o.id)
    } catch (e) {
      onError((e as Error).message)
    }
  }

  const addManual = async (ev: FormEvent) => {
    ev.preventDefault()
    if (!name.trim()) return
    try {
      await api.createOrder(session.id, { name: name.trim(), price_text: price.trim(), quantity: 1 })
      setName('')
      setPrice('')
    } catch (e) {
      onError((e as Error).message)
    }
  }

  return (
    <>
      {session.orders.length === 0 ? (
        <p className="muted">아직 주문 기록이 없습니다. 메뉴판 탭에서 "주문" 을 누르거나 아래에 직접 입력하세요.</p>
      ) : (
        <ul className="list">
          {session.orders.map((o) => {
            // 원어 메뉴명을 제목으로 강조 (직원에게 그대로 보여 줄 수 있도록). 예전 주문은 name_snapshot 으로 대체.
            const title = o.original_name || o.name_snapshot
            const priceLabel = o.price_snapshot || formatMoney(o.price_value, currency) || '가격 미상'
            return (
              <li key={o.id} className="card order">
                <div className="order-main">
                  <div className="order-names">
                    <strong className="order-title">{title}</strong>
                    {o.translated_name && <div className="order-sub">{o.translated_name}</div>}
                    <div className="muted small">{priceLabel}</div>
                  </div>
                  <div className="qty">
                    <button onClick={() => changeQty(o, -1)} aria-label="수량 감소" disabled={o.quantity <= 1}>
                      −
                    </button>
                    <span>{o.quantity}</span>
                    <button onClick={() => changeQty(o, +1)} aria-label="수량 증가">
                      +
                    </button>
                    <button className="danger icon" onClick={() => remove(o)} aria-label="주문 삭제" title="주문 삭제">
                      <TrashIcon />
                    </button>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {session.orders.length > 0 && (
        <p className="total">
          합계 {formatMoney(total, currency) || total.toLocaleString('ko-KR')}
          {hasUnknown && <span className="muted small"> (가격 미상 항목 제외)</span>}
        </p>
      )}

      <form className="card row" onSubmit={addManual}>
        <input placeholder="메뉴판에 없는 주문 직접 입력" value={name} onChange={(e) => setName(e.target.value)} />
        <input placeholder="가격" value={price} onChange={(e) => setPrice(e.target.value)} style={{ maxWidth: '7rem' }} />
        <button type="submit" disabled={!name.trim()}>
          추가
        </button>
      </form>
    </>
  )
}
