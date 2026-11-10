"""원화 환산용 환율.

하루(한국 시간 기준) 한 번, 그날 처음 요청이 들어올 때 받아 와 data_dir/rates.json 에 저장한다.
그날의 이후 요청은 저장된 값을 그대로 쓴다. 받아 오지 못하면 마지막으로 저장된 값을 stale 로 돌려준다.
"""

from __future__ import annotations

import json
import logging
import threading
import time
import urllib.request
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException

from ..config import settings

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["rates"])

KST = timezone(timedelta(hours=9))
_SOURCE_URL = "https://open.er-api.com/v6/latest/KRW"  # 키 불필요, 하루 1회 갱신
_lock = threading.Lock()
_last_fail = 0.0
_RETRY_AFTER_FAIL = 600  # 실패 후 10분간은 다시 시도하지 않음


def _path():
    return settings.data_dir / "rates.json"


def _read() -> dict | None:
    try:
        return json.loads(_path().read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return None


def _fetch() -> dict[str, float]:
    req = urllib.request.Request(_SOURCE_URL, headers={"User-Agent": "MenuTrans"})
    with urllib.request.urlopen(req, timeout=10) as res:  # noqa: S310 (고정 https URL)
        data = json.load(res)
    if data.get("result") != "success":
        raise RuntimeError(f"rate api error: {data.get('error-type')}")
    # 응답은 1 KRW 당 외화 → 외화 1단위당 원화로 뒤집는다
    return {cur: round(1 / v, 6) for cur, v in data["rates"].items() if v}


@router.get("/rates")
def get_rates() -> dict:
    global _last_fail
    today = datetime.now(KST).date().isoformat()
    cached = _read()
    if cached and cached.get("date") == today:
        return {**cached, "stale": False}
    with _lock:
        cached = _read()
        if cached and cached.get("date") == today:
            return {**cached, "stale": False}
        if time.time() - _last_fail > _RETRY_AFTER_FAIL:
            try:
                fresh = {
                    "date": today,
                    "fetched_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
                    "source": "open.er-api.com",
                    "krw_per_unit": _fetch(),
                }
                _path().write_text(json.dumps(fresh), encoding="utf-8")
                return {**fresh, "stale": False}
            except Exception as e:  # noqa: BLE001
                _last_fail = time.time()
                log.warning("환율을 받아 오지 못했습니다: %s", e)
    if cached:
        return {**cached, "stale": True}
    raise HTTPException(503, "환율 정보를 받아 오지 못했습니다.")
