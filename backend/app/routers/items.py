from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..events import hub
from ..models import MenuItem
from ..schemas import MenuItemOut, MenuItemUpdate
from .orders import _parse_price

router = APIRouter(prefix="/api", tags=["items"])


def _norm(name: str) -> str:
    """프론트의 중복 병합 키와 같은 규칙: 소문자 + 공백 정리."""
    return " ".join(name.lower().split())


@router.patch("/menu-items/{item_id}", response_model=MenuItemOut)
def update_item(item_id: str, body: MenuItemUpdate, db: Session = Depends(get_db)) -> MenuItem:
    item = db.get(MenuItem, item_id)
    if item is None:
        raise HTTPException(404, "메뉴 항목을 찾을 수 없습니다.")
    for field in ("category", "original_name", "translated_name", "description"):
        value = getattr(body, field)
        if value is not None:
            setattr(item, field, value.strip())
    if body.price_text is not None:
        item.price_text = body.price_text.strip()
        item.price_value = _parse_price(item.price_text)
    if body.tags is not None:
        item.tags = [t.strip() for t in body.tags if t.strip()]
    db.commit()
    db.refresh(item)
    hub.publish("item.changed", {"session_id": item.session_id, "item_id": item.id})
    return item


@router.delete("/menu-items/{item_id}", status_code=204)
def delete_item(item_id: str, db: Session = Depends(get_db)) -> None:
    item = db.get(MenuItem, item_id)
    if item is None:
        raise HTTPException(404, "메뉴 항목을 찾을 수 없습니다.")
    session_id = item.session_id
    key = _norm(item.original_name)
    # 여러 사진에서 중복 추출된 같은 메뉴는 화면에서 하나로 합쳐 보이므로 함께 지운다.
    # (하나만 지우면 다른 사진의 중복 항목이 다시 나타난다)
    siblings = db.scalars(select(MenuItem).where(MenuItem.session_id == session_id)).all()
    for other in siblings:
        if _norm(other.original_name) == key:
            db.delete(other)
    db.commit()
    hub.publish("item.changed", {"session_id": session_id, "item_id": item_id})
