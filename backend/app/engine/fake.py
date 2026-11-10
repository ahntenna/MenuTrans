"""API 키 없이 UI 를 시험하기 위한 데모 엔진 (MENU_ENGINE=fake).

실제 이미지는 보지 않고, 고정된 이탈리아 메뉴 항목을 일정 간격으로 흘려보낸다.
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator

from .base import EngineEvent, EngineMeta, EngineUsage, ExtractedItem, MenuEngine, MenuExtraction

_DEMO_ITEMS: list[ExtractedItem] = [
    ExtractedItem(category="전채", original_name="Bruschetta al pomodoro", translated_name="토마토 브루스케타", description="구운 빵 위에 토마토와 바질을 올린 전채", price_text="7,50 €", price_value=7.5, tags=["채식"], box=[80, 80, 920, 190]),
    ExtractedItem(category="전채", original_name="Carpaccio di manzo", translated_name="소고기 카르파초", description="얇게 썬 생소고기에 루콜라와 파르메산을 곁들임", price_text="12,00 €", price_value=12.0, tags=[], box=[80, 220, 920, 330]),
    ExtractedItem(category="파스타", original_name="Spaghetti alla carbonara", translated_name="카르보나라 스파게티", description="관찰레, 달걀, 페코리노 치즈로 만든 로마식 파스타", price_text="11,00 €", price_value=11.0, tags=["인기"], box=[80, 360, 920, 470]),
    ExtractedItem(category="파스타", original_name="Risotto ai funghi", translated_name="버섯 리소토", description="포르치니 버섯을 넣은 크리미한 쌀 요리", price_text="13,50 €", price_value=13.5, tags=["채식"], box=[80, 500, 920, 610]),
    ExtractedItem(category="메인", original_name="Saltimbocca alla romana", translated_name="살팀보카", description="송아지고기에 프로슈토와 세이지를 올려 화이트와인에 조린 요리", price_text="18,00 €", price_value=18.0, tags=["추천"], box=[80, 640, 920, 750]),
    ExtractedItem(category="디저트", original_name="Tiramisù", translated_name="티라미수", description="커피에 적신 비스킷과 마스카르포네 크림 디저트", price_text="6,00 €", price_value=6.0, tags=["인기"], box=[80, 780, 920, 890]),
]


class FakeMenuEngine(MenuEngine):
    def __init__(self, delay: float = 1.5) -> None:
        self._delay = delay

    async def extract_stream(self, image_jpeg: bytes) -> AsyncIterator[EngineEvent]:
        await asyncio.sleep(self._delay * 2)  # "메뉴판 읽는 중" 단계 흉내
        yield ("meta", EngineMeta(is_menu=True, detected_language="Italian", currency="EUR", restaurant_hint="Demo Trattoria", item_count_estimate=len(_DEMO_ITEMS)))
        for it in _DEMO_ITEMS:
            await asyncio.sleep(self._delay)
            yield ("item", it)
        yield ("usage", EngineUsage(model="fake", input_tokens=1800, output_tokens=1200))
        yield ("done", MenuExtraction(is_menu=True, detected_language="Italian", currency="EUR", restaurant_hint="Demo Trattoria", item_count_estimate=len(_DEMO_ITEMS), items=_DEMO_ITEMS, notes="데모 엔진 결과입니다 (MENU_ENGINE=fake)."))
