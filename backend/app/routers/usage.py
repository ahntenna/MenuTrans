"""번역 API 사용량/비용 집계."""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import UsageLog

router = APIRouter(prefix="/api", tags=["usage"])


def summarize(db: Session, *where) -> dict:
    row = db.execute(
        select(
            func.count(UsageLog.id),
            func.coalesce(func.sum(UsageLog.input_tokens), 0),
            func.coalesce(func.sum(UsageLog.output_tokens), 0),
            func.coalesce(func.sum(UsageLog.cost_usd), 0.0),
        ).where(*where)
    ).one()
    return {"calls": row[0], "input_tokens": int(row[1]), "output_tokens": int(row[2]), "cost_usd": round(float(row[3]), 6)}


@router.get("/usage")
def usage(db: Session = Depends(get_db)) -> dict:
    now = datetime.now(timezone.utc)
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    by_model = db.execute(
        select(UsageLog.model, func.count(UsageLog.id), func.coalesce(func.sum(UsageLog.cost_usd), 0.0))
        .group_by(UsageLog.model)
        .order_by(func.count(UsageLog.id).desc())
    ).all()
    return {
        "total": summarize(db),
        "this_month": summarize(db, UsageLog.created_at >= month_start),
        "by_model": [{"model": m, "calls": c, "cost_usd": round(float(cost), 6)} for m, c, cost in by_model],
    }
