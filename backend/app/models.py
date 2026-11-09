from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import JSON, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


def _uuid() -> str:
    return uuid.uuid4().hex


def _now() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class RestaurantSession(Base):
    """세션 = 식당 방문 1회. 여러 장의 메뉴판 사진과 주문 기록을 묶는다."""

    __tablename__ = "sessions"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String(200))
    note: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)

    photos: Mapped[list[Photo]] = relationship(
        back_populates="session", cascade="all, delete-orphan", order_by="Photo.created_at"
    )
    orders: Mapped[list[Order]] = relationship(
        back_populates="session", cascade="all, delete-orphan", order_by="Order.created_at"
    )


class Photo(Base):
    __tablename__ = "photos"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    session_id: Mapped[str] = mapped_column(ForeignKey("sessions.id", ondelete="CASCADE"), index=True)
    original_name: Mapped[str] = mapped_column(String(300), default="")
    # data_dir/photos 아래 상대 경로
    file_path: Mapped[str] = mapped_column(String(300))
    thumb_path: Mapped[str] = mapped_column(String(300), default="")
    content_type: Mapped[str] = mapped_column(String(100), default="image/jpeg")
    size_bytes: Mapped[int] = mapped_column(Integer, default=0)

    # pending | processing | done | error
    status: Mapped[str] = mapped_column(String(20), default="pending", index=True)
    error: Mapped[str] = mapped_column(Text, default="")
    detected_language: Mapped[str] = mapped_column(String(50), default="")
    currency: Mapped[str] = mapped_column(String(10), default="")
    restaurant_hint: Mapped[str] = mapped_column(String(200), default="")
    # 진행률: 모델이 먼저 보고한 예상 항목 수 (완료 시 실제 개수로 갱신)
    progress_total: Mapped[int] = mapped_column(Integer, default=0)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    analyzed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    session: Mapped[RestaurantSession] = relationship(back_populates="photos")
    items: Mapped[list[MenuItem]] = relationship(
        back_populates="photo", cascade="all, delete-orphan", order_by="MenuItem.position"
    )


class MenuItem(Base):
    __tablename__ = "menu_items"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    photo_id: Mapped[str] = mapped_column(ForeignKey("photos.id", ondelete="CASCADE"), index=True)
    session_id: Mapped[str] = mapped_column(ForeignKey("sessions.id", ondelete="CASCADE"), index=True)
    position: Mapped[int] = mapped_column(Integer, default=0)

    category: Mapped[str] = mapped_column(String(200), default="")
    original_name: Mapped[str] = mapped_column(String(300))
    translated_name: Mapped[str] = mapped_column(String(300))
    description: Mapped[str] = mapped_column(Text, default="")
    price_text: Mapped[str] = mapped_column(String(100), default="")
    price_value: Mapped[float | None] = mapped_column(Float, nullable=True)
    tags: Mapped[list] = mapped_column(JSON, default=list)

    photo: Mapped[Photo] = relationship(back_populates="items")
    orders: Mapped[list[Order]] = relationship(back_populates="menu_item")


class Order(Base):
    __tablename__ = "orders"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    session_id: Mapped[str] = mapped_column(ForeignKey("sessions.id", ondelete="CASCADE"), index=True)
    # 메뉴 항목이 삭제(사진 삭제)돼도 주문 기록은 남기기 위해 SET NULL
    menu_item_id: Mapped[str | None] = mapped_column(
        ForeignKey("menu_items.id", ondelete="SET NULL"), nullable=True, index=True
    )
    # 항목 삭제에 대비해 주문 시점의 이름/가격을 복사해 둔다
    name_snapshot: Mapped[str] = mapped_column(String(300))
    price_snapshot: Mapped[str] = mapped_column(String(100), default="")
    price_value: Mapped[float | None] = mapped_column(Float, nullable=True)
    quantity: Mapped[int] = mapped_column(Integer, default=1)
    note: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    session: Mapped[RestaurantSession] = relationship(back_populates="orders")
    menu_item: Mapped[MenuItem | None] = relationship(back_populates="orders")
