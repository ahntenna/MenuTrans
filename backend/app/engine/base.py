"""OCR + 번역 엔진 인터페이스.

엔진은 이미지 바이트를 받아 이벤트를 순서대로 내보낸다.
  ("meta", EngineMeta)        : 메뉴판 여부, 언어, 통화, 예상 항목 수 (항목보다 먼저 도착)
  ("item", ExtractedItem)     : 항목 하나가 완성될 때마다
  ("done", MenuExtraction)    : 전체 결과 (notes 포함)
다른 엔진(Google Vision 등)으로 바꾸려면 MenuEngine 을 구현하면 된다.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import AsyncIterator
from typing import Any

from pydantic import BaseModel, Field


class ExtractedItem(BaseModel):
    category: str = ""
    original_name: str
    translated_name: str
    description: str = ""
    price_text: str = ""
    price_value: float | None = None
    tags: list[str] = Field(default_factory=list)


class EngineMeta(BaseModel):
    is_menu: bool = True
    detected_language: str = ""
    currency: str = ""
    restaurant_hint: str = ""
    item_count_estimate: int = 0


class MenuExtraction(EngineMeta):
    items: list[ExtractedItem] = Field(default_factory=list)
    notes: str = ""


EngineEvent = tuple[str, Any]


# Structured Outputs 용 JSON 스키마. 키 순서가 모델 출력 순서가 되므로
# 메타 정보 → 예상 항목 수 → items → notes 순으로 둔다 (진행률 표시에 필요).
ITEM_SCHEMA: dict = {
    "type": "object",
    "properties": {
        "category": {"type": "string", "description": "Section heading this item is under, translated to Korean (e.g. 전채, 메인, 음료). Empty string if none."},
        "original_name": {"type": "string", "description": "Dish name exactly as printed, in the original language."},
        "translated_name": {"type": "string", "description": "Natural Korean name of the dish."},
        "description": {"type": "string", "description": "One short Korean sentence: what the dish is. Translate the menu's own description if present, otherwise briefly explain. Empty string only if truly nothing to say."},
        "price_text": {"type": "string", "description": "Price exactly as printed (e.g. '12,50 €', '$14', '¥1,200'). Empty string if not shown."},
        "price_value": {"type": ["number", "null"], "description": "Numeric price parsed from price_text, or null."},
        "tags": {"type": "array", "items": {"type": "string"}, "description": "Korean tags such as 매운맛, 채식, 비건, 글루텐프리, 견과류, 해산물, 추천, 인기 — only when clearly indicated on the menu."},
    },
    "required": ["category", "original_name", "translated_name", "description", "price_text", "price_value", "tags"],
    "additionalProperties": False,
}

MENU_SCHEMA: dict = {
    "type": "object",
    "properties": {
        "is_menu": {"type": "boolean", "description": "True if the image is a restaurant menu or part of one."},
        "detected_language": {"type": "string", "description": "Main language of the menu text: English, Japanese, French, Spanish, Italian, or Other."},
        "currency": {"type": "string", "description": "ISO 4217 code if determinable (EUR, USD, JPY...), else empty string."},
        "restaurant_hint": {"type": "string", "description": "Restaurant name if printed, else empty string."},
        "item_count_estimate": {"type": "integer", "description": "Your best count of distinct menu items visible in the image, decided BEFORE listing them. Used as a progress total."},
        "items": {"type": "array", "items": ITEM_SCHEMA, "description": "Every menu item visible, in reading order."},
        "notes": {"type": "string", "description": "Korean note for the user: unreadable or cut-off parts, non-menu image, etc. Empty string if nothing to say."},
    },
    "required": ["is_menu", "detected_language", "currency", "restaurant_hint", "item_count_estimate", "items", "notes"],
    "additionalProperties": False,
}


class MenuEngine(ABC):
    @abstractmethod
    def extract_stream(self, image_jpeg: bytes) -> AsyncIterator[EngineEvent]:
        """JPEG 이미지를 분석하며 ("meta"|"item"|"done", payload) 이벤트를 순서대로 내보낸다. 실패 시 예외."""
