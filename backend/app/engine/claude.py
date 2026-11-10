"""Claude 비전 모델 기반 OCR + 번역 엔진 (스트리밍).

Structured Outputs(JSON 스키마) 로 응답을 받되 스트리밍으로 텍스트를 누적하면서,
items 배열 안의 객체가 하나 닫힐 때마다 즉시 파싱해 이벤트로 내보낸다.
"""

from __future__ import annotations

import base64
import json
from collections.abc import AsyncIterator

import anthropic

from .base import MENU_SCHEMA, EngineEvent, EngineMeta, EngineUsage, ExtractedItem, MenuEngine, MenuExtraction


class EngineRefused(Exception):
    """모델이 요청을 거부(stop_reason=refusal)한 경우."""


class _ItemStreamParser:
    """누적되는 JSON 텍스트에서 최상위 "items" 배열의 완성된 객체를 순서대로 꺼낸다."""

    def __init__(self) -> None:
        self.buf = ""
        self._pos = 0
        self._in_items = False
        self._items_done = False
        self._depth = 0
        self._in_str = False
        self._esc = False
        self._obj_start = -1
        self.meta: dict | None = None

    def feed(self, text: str) -> list[dict]:
        self.buf += text
        out: list[dict] = []
        if not self._in_items:
            idx = self.buf.find('"items"', self._pos)
            if idx < 0:
                self._pos = max(0, len(self.buf) - len('"items"'))
                return out
            br = self.buf.find("[", idx)
            if br < 0:
                return out
            self._in_items = True
            self._pos = br + 1
            self.meta = self._parse_prefix(self.buf[:idx])
        if self._items_done:
            return out

        i = self._pos
        n = len(self.buf)
        while i < n:
            ch = self.buf[i]
            if self._in_str:
                if self._esc:
                    self._esc = False
                elif ch == "\\":
                    self._esc = True
                elif ch == '"':
                    self._in_str = False
            elif ch == '"':
                self._in_str = True
            elif ch == "{":
                if self._depth == 0:
                    self._obj_start = i
                self._depth += 1
            elif ch == "}":
                self._depth -= 1
                if self._depth == 0 and self._obj_start >= 0:
                    try:
                        out.append(json.loads(self.buf[self._obj_start : i + 1]))
                    except json.JSONDecodeError:
                        pass
                    self._obj_start = -1
            elif ch == "]" and self._depth == 0:
                self._items_done = True
                i += 1
                break
            i += 1
        self._pos = i
        return out

    @staticmethod
    def _parse_prefix(prefix: str) -> dict | None:
        """`{"is_menu": true, ..., ` 형태의 앞부분을 닫아서 메타 정보만 먼저 읽는다."""
        s = prefix.rstrip().rstrip(",")
        try:
            return json.loads(s + "}")
        except json.JSONDecodeError:
            return None


class ClaudeMenuEngine(MenuEngine):
    def __init__(self, model: str, target_language: str, source_languages: list[str], api_key: str | None = None) -> None:
        # api_key 가 None 이면 ANTHROPIC_API_KEY 환경변수 등에서 자동으로 읽는다.
        self._client = anthropic.AsyncAnthropic(api_key=api_key, max_retries=3, timeout=300.0)
        self._model = model
        self._system = (
            "You are an expert menu reader and translator for Korean travelers.\n"
            f"The photo shows a restaurant menu written in one of: {', '.join(source_languages)}.\n"
            f"Extract every dish visible and translate names and descriptions into {target_language}.\n"
            "Rules:\n"
            "- First decide item_count_estimate: count the distinct dishes you can see before listing them.\n"
            "- Keep original_name exactly as printed (including accents/kana/kanji).\n"
            "- translated_name must be a natural Korean dish name, not a transliteration only. "
            "If a dish has a well-known Korean name, use it; otherwise translate meaning and add the "
            "transliteration in parentheses when helpful (e.g. '소고기 타르타르 (타르타르 드 뵈프)').\n"
            "- description: one short Korean sentence a traveler needs to decide whether to order.\n"
            "- Preserve the menu's reading order and put section headings (translated to Korean) in category.\n"
            "- box: give each item's approximate location in the image as [x0, y0, x1, y1] on a 0-1000 scale.\n"
            "- Prices: copy exactly into price_text; parse the number into price_value.\n"
            "- If part of the image is cut off or unreadable, still return what you can and mention it in notes.\n"
            "- If the image is not a menu at all, set is_menu=false, item_count_estimate=0 and return no items."
        )

    async def extract_stream(self, image_jpeg: bytes) -> AsyncIterator[EngineEvent]:
        data = base64.standard_b64encode(image_jpeg).decode("ascii")
        parser = _ItemStreamParser()
        meta_sent = False

        async with self._client.messages.stream(
            model=self._model,
            max_tokens=16000,
            system=self._system,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": data}},
                        {"type": "text", "text": "Read this menu and return the structured extraction."},
                    ],
                }
            ],
            output_config={"format": {"type": "json_schema", "schema": MENU_SCHEMA}},
        ) as stream:
            async for text in stream.text_stream:
                items = parser.feed(text)
                if not meta_sent and parser.meta is not None:
                    meta_sent = True
                    yield ("meta", EngineMeta.model_validate(parser.meta))
                for raw in items:
                    try:
                        yield ("item", ExtractedItem.model_validate(raw))
                    except Exception:  # noqa: BLE001  잘못된 항목 하나는 건너뜀
                        continue
            final = await stream.get_final_message()

        yield ("usage", EngineUsage(model=self._model, input_tokens=final.usage.input_tokens, output_tokens=final.usage.output_tokens))

        if final.stop_reason == "refusal":
            detail = ""
            if final.stop_details is not None:
                detail = f" ({final.stop_details.category or ''} {final.stop_details.explanation or ''})".rstrip()
            raise EngineRefused(f"모델이 분석을 거부했습니다{detail}")
        if final.stop_reason == "max_tokens":
            raise RuntimeError("출력이 너무 길어 잘렸습니다. 사진을 나눠 찍어 주세요.")

        text = "".join(b.text for b in final.content if b.type == "text")
        try:
            result = MenuExtraction.model_validate_json(text)
        except Exception as e:  # noqa: BLE001
            raise RuntimeError(f"모델 응답을 해석하지 못했습니다: {e}") from e
        if not meta_sent:
            yield ("meta", EngineMeta.model_validate(result.model_dump(exclude={"items", "notes"})))
        yield ("done", result)
