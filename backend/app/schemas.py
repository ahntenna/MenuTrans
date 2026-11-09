from __future__ import annotations

from datetime import datetime, timezone

from pydantic import BaseModel, ConfigDict, Field, field_serializer


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    # SQLite 는 tzinfo 를 버리므로, UTC 로 저장된 값에 'Z' 를 붙여 내보낸다 (브라우저가 현지 시간으로 변환).
    @field_serializer("created_at", "updated_at", "started_at", "analyzed_at", check_fields=False)
    def _ser_dt(self, v: datetime | None) -> str | None:
        if v is None:
            return None
        if v.tzinfo is None:
            v = v.replace(tzinfo=timezone.utc)
        return v.isoformat().replace("+00:00", "Z")


# ---------- Menu item ----------
class MenuItemOut(ORMModel):
    id: str
    photo_id: str
    session_id: str
    position: int
    category: str
    original_name: str
    translated_name: str
    description: str
    price_text: str
    price_value: float | None
    tags: list[str]


# ---------- Photo ----------
class PhotoOut(ORMModel):
    id: str
    session_id: str
    original_name: str
    content_type: str
    size_bytes: int
    status: str
    error: str
    detected_language: str
    currency: str
    restaurant_hint: str
    progress_total: int
    created_at: datetime
    started_at: datetime | None
    analyzed_at: datetime | None
    items: list[MenuItemOut] = []


# ---------- Order ----------
class OrderCreate(BaseModel):
    menu_item_id: str | None = None
    # menu_item_id 가 없을 때(메뉴판에 없는 주문) 직접 입력
    name: str | None = None
    price_text: str | None = None
    quantity: int = Field(default=1, ge=1, le=99)
    note: str = ""


class OrderUpdate(BaseModel):
    quantity: int | None = Field(default=None, ge=1, le=99)
    note: str | None = None


class OrderOut(ORMModel):
    id: str
    session_id: str
    menu_item_id: str | None
    name_snapshot: str
    price_snapshot: str
    price_value: float | None
    quantity: int
    note: str
    created_at: datetime


# ---------- Session ----------
class SessionCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    note: str = ""


class SessionUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    note: str | None = None


class SessionSummary(ORMModel):
    id: str
    name: str
    note: str
    created_at: datetime
    updated_at: datetime
    photo_count: int = 0
    item_count: int = 0
    order_count: int = 0
    pending_count: int = 0


class SessionDetail(ORMModel):
    id: str
    name: str
    note: str
    created_at: datetime
    updated_at: datetime
    photos: list[PhotoOut]
    orders: list[OrderOut]
