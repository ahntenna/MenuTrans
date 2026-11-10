"""설정 조회/변경 (분석 모델 선택)."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from .. import app_settings
from ..config import settings
from ..events import hub

router = APIRouter(prefix="/api", tags=["settings"])


class SettingsPatch(BaseModel):
    model: str


def _payload() -> dict:
    return {
        "model": app_settings.get_model(),
        "default_model": settings.claude_model,
        "models": app_settings.model_choices(),
        # "fake" 면 데모 엔진이라 모델 선택이 실제 분석에 쓰이지 않는다
        "engine": settings.menu_engine.lower(),
    }


@router.get("/settings")
def get_settings() -> dict:
    return _payload()


@router.put("/settings")
def put_settings(patch: SettingsPatch) -> dict:
    try:
        app_settings.set_model(patch.model)
    except ValueError as e:
        raise HTTPException(422, str(e)) from e
    hub.publish("settings.changed", {"model": patch.model})
    return _payload()
