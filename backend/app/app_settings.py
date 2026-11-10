"""화면에서 바꿀 수 있는 설정 (현재는 분석 모델 하나).

접속한 모두가 같은 화면을 보는 앱이므로 설정도 기기별이 아니라 서버에 하나만 둔다.
data_dir/settings.json 에 저장하며, 저장된 값이 없으면 환경변수 CLAUDE_MODEL 이 기본값이다.
"""

from __future__ import annotations

import json
import logging
import threading

from .config import settings
from .pricing import PRICES_PER_MTOK

log = logging.getLogger(__name__)

# 설정 화면에 보여 줄 모델. 위에서부터 품질이 높고 비싸다.
MODEL_CHOICES: list[dict[str, str]] = [
    {"id": "claude-fable-5-2", "label": "Claude Fable 5.2", "hint": "가장 정확하지만 가장 비싸고 느립니다."},
    {"id": "claude-opus-5-5", "label": "Claude Opus 5.5", "hint": "손글씨·흐린 사진도 잘 읽습니다. 권장."},
    {"id": "claude-sonnet-5-5", "label": "Claude Sonnet 5.5", "hint": "빠르고 저렴합니다. 인쇄된 메뉴판에 적당합니다."},
    {"id": "claude-haiku-5-5", "label": "Claude Haiku 5.5", "hint": "가장 빠르고 저렴합니다. 복잡한 메뉴판은 누락될 수 있습니다."},
]

_lock = threading.Lock()
_cache: dict | None = None


def _path():
    return settings.data_dir / "settings.json"


def _load() -> dict:
    global _cache
    if _cache is None:
        try:
            data = json.loads(_path().read_text(encoding="utf-8"))
            _cache = data if isinstance(data, dict) else {}
        except FileNotFoundError:
            _cache = {}
        except Exception as e:  # noqa: BLE001
            log.warning("settings.json 을 읽지 못해 기본값을 사용합니다: %s", e)
            _cache = {}
    return _cache


def model_choices() -> list[dict]:
    """선택 가능한 모델 목록 (단가 포함). 환경변수로 목록 밖의 모델을 지정했다면 그것도 넣는다."""
    choices = [dict(c) for c in MODEL_CHOICES]
    default = settings.claude_model
    if default not in {c["id"] for c in choices}:
        choices.append({"id": default, "label": default, "hint": "서버 환경변수(CLAUDE_MODEL)로 지정된 모델입니다."})
    for c in choices:
        price = PRICES_PER_MTOK.get(c["id"])
        c["input_usd_per_mtok"] = price[0] if price else None
        c["output_usd_per_mtok"] = price[1] if price else None
    return choices


def get_model() -> str:
    """지금 분석에 쓸 모델. 저장된 값이 더 이상 목록에 없으면 기본값으로 돌아간다."""
    with _lock:
        saved = _load().get("model")
    if isinstance(saved, str) and saved in {c["id"] for c in model_choices()}:
        return saved
    return settings.claude_model


def set_model(model: str) -> None:
    if model not in {c["id"] for c in model_choices()}:
        raise ValueError("선택할 수 없는 모델입니다.")
    with _lock:
        data = {**_load(), "model": model}
        settings.data_dir.mkdir(parents=True, exist_ok=True)
        tmp = _path().with_suffix(".json.tmp")
        tmp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        tmp.replace(_path())
        global _cache
        _cache = data
