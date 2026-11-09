from __future__ import annotations

import shutil

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from ..config import settings
from ..db import get_db
from ..events import hub
from ..models import MenuItem, Order, Photo, RestaurantSession
from ..schemas import SessionCreate, SessionDetail, SessionSummary, SessionUpdate

router = APIRouter(prefix="/api/sessions", tags=["sessions"])

_STORE_FIELDS = ("store_name", "address", "map_url", "lat", "lng", "visited_at")


@router.get("", response_model=list[SessionSummary])
def list_sessions(db: Session = Depends(get_db)) -> list[SessionSummary]:
    photo_count = (
        select(Photo.session_id, func.count(Photo.id).label("n"),
               func.sum(func.iif(Photo.status.in_(["pending", "processing"]), 1, 0)).label("pending"))
        .group_by(Photo.session_id).subquery()
    )
    item_count = select(MenuItem.session_id, func.count(MenuItem.id).label("n")).group_by(MenuItem.session_id).subquery()
    order_count = select(Order.session_id, func.count(Order.id).label("n")).group_by(Order.session_id).subquery()

    rows = db.execute(
        select(
            RestaurantSession,
            func.coalesce(photo_count.c.n, 0),
            func.coalesce(photo_count.c.pending, 0),
            func.coalesce(item_count.c.n, 0),
            func.coalesce(order_count.c.n, 0),
        )
        .outerjoin(photo_count, photo_count.c.session_id == RestaurantSession.id)
        .outerjoin(item_count, item_count.c.session_id == RestaurantSession.id)
        .outerjoin(order_count, order_count.c.session_id == RestaurantSession.id)
        # 방문 일시가 있으면 그 기준, 없으면 생성 시각 기준 최신순
        .order_by(func.coalesce(RestaurantSession.visited_at, RestaurantSession.created_at).desc())
    ).all()
    out: list[SessionSummary] = []
    for s, pc, pend, ic, oc in rows:
        summary = SessionSummary.model_validate(s)
        summary.photo_count, summary.pending_count, summary.item_count, summary.order_count = pc, pend, ic, oc
        out.append(summary)
    return out


@router.post("", response_model=SessionDetail, status_code=201)
def create_session(body: SessionCreate, db: Session = Depends(get_db)) -> RestaurantSession:
    s = RestaurantSession(name=body.name.strip(), note=body.note)
    for f in _STORE_FIELDS:
        v = getattr(body, f)
        if v is not None:
            setattr(s, f, v.strip() if isinstance(v, str) else v)
    db.add(s)
    db.commit()
    db.refresh(s)
    hub.publish("session.created", {"session_id": s.id})
    return _load(db, s.id)


def _load(db: Session, session_id: str) -> RestaurantSession:
    s = db.scalar(
        select(RestaurantSession)
        .where(RestaurantSession.id == session_id)
        .options(selectinload(RestaurantSession.photos).selectinload(Photo.items), selectinload(RestaurantSession.orders))
    )
    if s is None:
        raise HTTPException(404, "세션을 찾을 수 없습니다.")
    return s


@router.get("/{session_id}", response_model=SessionDetail)
def get_session(session_id: str, db: Session = Depends(get_db)) -> RestaurantSession:
    return _load(db, session_id)


@router.patch("/{session_id}", response_model=SessionDetail)
def update_session(session_id: str, body: SessionUpdate, db: Session = Depends(get_db)) -> RestaurantSession:
    s = _load(db, session_id)
    if body.name is not None:
        s.name = body.name.strip()
    if body.note is not None:
        s.note = body.note
    for f in _STORE_FIELDS:
        v = getattr(body, f)
        if v is not None:
            setattr(s, f, v.strip() if isinstance(v, str) else v)
    if body.clear_location:
        s.lat = None
        s.lng = None
    if body.clear_visited_at:
        s.visited_at = None
    db.commit()
    hub.publish("session.updated", {"session_id": s.id})
    return _load(db, session_id)


@router.delete("/{session_id}", status_code=204)
def delete_session(session_id: str, db: Session = Depends(get_db)) -> None:
    s = db.get(RestaurantSession, session_id)
    if s is None:
        raise HTTPException(404, "세션을 찾을 수 없습니다.")
    db.delete(s)
    db.commit()
    # 세션별 사진 폴더 제거
    shutil.rmtree(settings.photo_dir / session_id, ignore_errors=True)
    hub.publish("session.deleted", {"session_id": session_id})
