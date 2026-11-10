from __future__ import annotations

from datetime import datetime, timezone

from pydantic import BaseModel, ConfigDict, Field, field_serializer, field_validator


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    # SQLite 는 tzinfo 를 버리므로, UTC 로 저장된 값에 'Z' 를 붙여 내보낸다 (브라우저가 현지 시간으로 변환).
    @field_serializer("created_at", "updated_at", "started_at", "analyzed_at", "visited_at", check_fields=False)
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


class MenuItemUpdate(BaseModel):
    category: str | None = Field(default=None, max_length=200)
    original_name: str | None = Field(default=None, min_length=1, max_length=300)
    translated_name: str | None = Field(default=None, min_length=1, max_length=300)
    description: str | None = None
    price_text: str | None = Field(default=None, max_length=100)
    tags: list[str] | None = None


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
    original_name: str
    translated_name: str
    price_snapshot: str
    price_value: float | None
    quantity: int
    note: str
    created_at: datetime


# ---------- Session ----------
class _StoreFields(BaseModel):
    """가게 정보 + 방문 일시. 생성/수정 요청에서 공통으로 사용."""

    store_name: str | None = Field(default=None, max_length=200)
    address: str | None = Field(default=None, max_length=500)
    map_url: str | None = Field(default=None, max_length=1000)
    lat: float | None = Field(default=None, ge=-90, le=90)
    lng: float | None = Field(default=None, ge=-180, le=180)
    visited_at: datetime | None = None

    @field_validator("map_url")
    @classmethod
    def _check_url(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = v.strip()
        if v and not (v.startswith("https://") or v.startswith("http://")):
            raise ValueError("지도 링크는 http(s):// 로 시작해야 합니다.")
        return v

    @field_validator("visited_at")
    @classmethod
    def _to_utc(cls, v: datetime | None) -> datetime | None:
        # 클라이언트는 ISO(UTC, 'Z') 로 보낸다. tz 없는 값은 UTC 로 간주.
        if v is None:
            return None
        if v.tzinfo is None:
            return v.replace(tzinfo=timezone.utc)
        return v.astimezone(timezone.utc)


class SessionCreate(_StoreFields):
    name: str = Field(min_length=1, max_length=200)
    note: str = ""


class SessionUpdate(_StoreFields):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    note: str | None = None
    # lat/lng/visited_at 을 비우려면 clear_* 플래그 사용 (None 은 "변경 없음" 이므로)
    clear_location: bool = False
    clear_visited_at: bool = False


class _SessionBase(ORMModel):
    id: str
    name: str
    note: str
    store_name: str
    address: str
    map_url: str
    lat: float | None
    lng: float | None
    visited_at: datetime | None
    created_at: datetime
    updated_at: datetime


class SessionSummary(_SessionBase):
    photo_count: int = 0
    item_count: int = 0
    order_count: int = 0
    pending_count: int = 0


class SessionDetail(_SessionBase):
    photos: list[PhotoOut]
    orders: list[OrderOut]
