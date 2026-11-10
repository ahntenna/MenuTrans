from __future__ import annotations

import json
import shutil
from datetime import timedelta, timezone
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload

from ..config import settings
from ..db import get_db
from ..events import hub
from ..models import MenuItem, Order, Photo, RestaurantSession, UsageLog
from ..schemas import SessionCreate, SessionDetail, SessionSummary, SessionUpdate
from .usage import summarize

router = APIRouter(prefix="/api/sessions", tags=["sessions"])

_STORE_FIELDS = ("store_name", "address", "map_url", "lat", "lng", "visited_at")
KST = timezone(timedelta(hours=9))


@router.get("", response_model=list[SessionSummary])
def list_sessions(q: str = Query(default="", max_length=100), db: Session = Depends(get_db)) -> list[SessionSummary]:
    photo_count = (
        select(Photo.session_id, func.count(Photo.id).label("n"),
               func.sum(func.iif(Photo.status.in_(["pending", "processing"]), 1, 0)).label("pending"))
        .group_by(Photo.session_id).subquery()
    )
    item_count = select(MenuItem.session_id, func.count(MenuItem.id).label("n")).group_by(MenuItem.session_id).subquery()
    order_count = select(Order.session_id, func.count(Order.id).label("n")).group_by(Order.session_id).subquery()

    stmt = (
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
    )

    term = q.strip()
    if term:
        # 세션 이름/상호명/주소/메모, 그리고 그 세션의 메뉴(원어·번역명)에서 검색
        like = f"%{term}%"
        item_match = select(MenuItem.session_id).where(
            or_(MenuItem.original_name.ilike(like), MenuItem.translated_name.ilike(like))
        )
        stmt = stmt.where(
            or_(
                RestaurantSession.name.ilike(like),
                RestaurantSession.store_name.ilike(like),
                RestaurantSession.address.ilike(like),
                RestaurantSession.note.ilike(like),
                RestaurantSession.id.in_(item_match),
            )
        )

    out: list[SessionSummary] = []
    for s, pc, pend, ic, oc in db.execute(stmt).all():
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
    # 응답 스키마(SessionDetail.usage)가 읽어 가는 비영속 속성
    s.usage = summarize(db, UsageLog.session_id == session_id)
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


@router.post("/{session_id}/reanalyze", response_model=SessionDetail)
def reanalyze_session(session_id: str, db: Session = Depends(get_db)) -> RestaurantSession:
    """메뉴판 다시 불러오기: 추출된 메뉴를 모두 지우고 세션의 모든 사진을 다시 분석한다."""
    from ..analyzer import analyzer

    s = _load(db, session_id)
    if any(p.status in ("pending", "processing") for p in s.photos):
        raise HTTPException(409, "분석 중인 사진이 있습니다. 끝난 뒤 다시 시도해 주세요.")
    photo_ids = []
    for p in s.photos:
        for item in list(p.items):
            db.delete(item)
        p.status = "pending"
        p.error = ""
        p.progress_total = 0
        p.started_at = None
        photo_ids.append(p.id)
    db.commit()
    hub.publish("session.updated", {"session_id": session_id})
    for pid in photo_ids:
        analyzer.schedule(pid)
    return _load(db, session_id)


# ---------- 내보내기 ----------
def _norm(name: str) -> str:
    return " ".join(name.lower().split())


def _merged_items(s: RestaurantSession) -> list[MenuItem]:
    """화면과 같은 규칙으로 중복 메뉴를 합친 목록."""
    seen: dict[str, MenuItem] = {}
    for p in s.photos:
        for it in p.items:
            seen.setdefault(_norm(it.original_name), it)
    return list(seen.values())


def _map_link(s: RestaurantSession) -> str:
    if s.map_url:
        return s.map_url
    if s.lat is not None and s.lng is not None:
        return f"https://www.google.com/maps/search/?api=1&query={s.lat},{s.lng}"
    query = " ".join(x for x in (s.store_name or s.name, s.address) if x).strip()
    return f"https://www.google.com/maps/search/?api=1&query={quote(query)}" if query else ""


def _to_markdown(s: RestaurantSession) -> str:
    lines = [f"# {s.name}", ""]
    if s.store_name:
        lines.append(f"- 상호명: {s.store_name}")
    if s.address:
        lines.append(f"- 주소: {s.address}")
    if s.visited_at:
        v = s.visited_at if s.visited_at.tzinfo else s.visited_at.replace(tzinfo=timezone.utc)
        lines.append(f"- 방문: {v.astimezone(KST).strftime('%Y-%m-%d %H:%M')} (KST)")
    link = _map_link(s)
    if link:
        lines.append(f"- 지도: {link}")
    if s.note:
        lines += ["", s.note]

    if s.orders:
        lines += ["", "## 주문한 메뉴", ""]
        total = 0.0
        for o in s.orders:
            title = o.original_name or o.name_snapshot
            sub = f" / {o.translated_name}" if o.translated_name else ""
            price = f" — {o.price_snapshot}" if o.price_snapshot else ""
            lines.append(f"- {title}{sub} × {o.quantity}{price}")
            total += (o.price_value or 0) * o.quantity
        currency = next((p.currency for p in s.photos if p.currency), "")
        if total:
            lines += ["", f"합계: {total:,.2f} {currency}".rstrip()]

    items = _merged_items(s)
    if items:
        lines += ["", "## 메뉴판"]
        current = None
        for it in items:
            cat = it.category or "기타"
            if cat != current:
                lines += ["", f"### {cat}", ""]
                current = cat
            price = f" — {it.price_text}" if it.price_text else ""
            lines.append(f"- **{it.translated_name}** ({it.original_name}){price}")
            if it.description:
                lines.append(f"  - {it.description}")
    return "\n".join(lines) + "\n"


@router.get("/{session_id}/export")
def export_session(session_id: str, format: str = Query(default="md", pattern="^(md|json)$"), db: Session = Depends(get_db)) -> Response:
    s = _load(db, session_id)
    safe = "".join(c if c.isalnum() or c in " -_" else "_" for c in s.name).strip() or "session"
    if format == "json":
        body = json.dumps(SessionDetail.model_validate(s).model_dump(mode="json"), ensure_ascii=False, indent=2)
        media, ext = "application/json; charset=utf-8", "json"
    else:
        body, media, ext = _to_markdown(s), "text/markdown; charset=utf-8", "md"
    return Response(
        body,
        media_type=media,
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(safe)}.{ext}"},
    )


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
