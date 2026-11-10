from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..db import get_db
from ..events import hub
from ..models import MenuItem, Order, RestaurantSession
from ..schemas import OrderCreate, OrderOut, OrderUpdate

router = APIRouter(prefix="/api", tags=["orders"])


@router.post("/sessions/{session_id}/orders", response_model=OrderOut, status_code=201)
def create_order(session_id: str, body: OrderCreate, db: Session = Depends(get_db)) -> Order:
    if db.get(RestaurantSession, session_id) is None:
        raise HTTPException(404, "세션을 찾을 수 없습니다.")

    if body.menu_item_id:
        item = db.get(MenuItem, body.menu_item_id)
        if item is None or item.session_id != session_id:
            raise HTTPException(404, "메뉴 항목을 찾을 수 없습니다.")
        name = f"{item.translated_name}" + (f" ({item.original_name})" if item.original_name else "")
        order = Order(
            session_id=session_id, menu_item_id=item.id, name_snapshot=name,
            original_name=item.original_name, translated_name=item.translated_name,
            price_snapshot=item.price_text, price_value=item.price_value,
            quantity=body.quantity, note=body.note,
        )
    else:
        if not body.name or not body.name.strip():
            raise HTTPException(400, "메뉴 이름이 필요합니다.")
        order = Order(
            session_id=session_id, menu_item_id=None, name_snapshot=body.name.strip(),
            original_name=body.name.strip(), translated_name="",
            price_snapshot=(body.price_text or "").strip(), price_value=_parse_price(body.price_text),
            quantity=body.quantity, note=body.note,
        )
    # 같은 메뉴를 다시 주문하면 새 줄을 만들지 않고 기존 주문의 수량을 올린다.
    existing = _find_same_order(db, session_id, order)
    if existing is not None:
        existing.quantity = min(99, existing.quantity + order.quantity)
        if existing.menu_item_id is None and order.menu_item_id is not None:
            existing.menu_item_id = order.menu_item_id  # 재분석으로 끊긴 연결 복구
        order = existing
    else:
        db.add(order)
    db.commit()
    db.refresh(order)
    hub.publish("order.changed", {"session_id": session_id, "order_id": order.id})
    return order


def _norm(name: str) -> str:
    return " ".join(name.lower().split())


def _find_same_order(db: Session, session_id: str, new: Order) -> Order | None:
    """같은 메뉴의 기존 주문을 찾는다.

    - 메뉴판에서 고른 주문: 같은 메뉴 항목이거나 원어 이름이 같으면 동일 (재분석으로 id 가 바뀌어도 합쳐짐)
    - 직접 입력한 주문: 이름과 가격 표기가 모두 같을 때만 동일
    """
    key = _norm(new.original_name)
    for o in db.query(Order).filter(Order.session_id == session_id).order_by(Order.created_at):
        if new.menu_item_id is not None:
            if o.menu_item_id == new.menu_item_id or (o.original_name and _norm(o.original_name) == key):
                return o
        elif _norm(o.original_name or o.name_snapshot) == key and o.price_snapshot == new.price_snapshot:
            return o
    return None


@router.patch("/orders/{order_id}", response_model=OrderOut)
def update_order(order_id: str, body: OrderUpdate, db: Session = Depends(get_db)) -> Order:
    order = db.get(Order, order_id)
    if order is None:
        raise HTTPException(404, "주문을 찾을 수 없습니다.")
    if body.quantity is not None:
        order.quantity = body.quantity
    if body.note is not None:
        order.note = body.note
    db.commit()
    db.refresh(order)
    hub.publish("order.changed", {"session_id": order.session_id, "order_id": order.id})
    return order


@router.delete("/orders/{order_id}", status_code=204)
def delete_order(order_id: str, db: Session = Depends(get_db)) -> None:
    order = db.get(Order, order_id)
    if order is None:
        raise HTTPException(404, "주문을 찾을 수 없습니다.")
    session_id = order.session_id
    db.delete(order)
    db.commit()
    hub.publish("order.changed", {"session_id": session_id, "order_id": order_id})


def _parse_price(text: str | None) -> float | None:
    if not text:
        return None
    cleaned = "".join(ch for ch in text if ch.isdigit() or ch in ".,")
    if not cleaned:
        return None
    # "12,50" 처럼 쉼표 소수점 표기 처리
    if "," in cleaned and "." not in cleaned and len(cleaned.split(",")[-1]) == 2:
        cleaned = cleaned.replace(",", ".")
    else:
        cleaned = cleaned.replace(",", "")
    try:
        return float(cleaned)
    except ValueError:
        return None
