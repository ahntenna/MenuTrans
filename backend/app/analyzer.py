"""사진 분석 작업 큐.

업로드된 사진을 백그라운드에서 엔진으로 분석한다. 엔진이 항목을 하나씩 내보낼 때마다
DB 에 저장하고 SSE 로 알리므로, 화면에는 번역되는 순서대로 메뉴가 추가된다.
서버 시작 시 pending/processing 상태로 남아 있던 사진도 다시 큐에 넣는다.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

from sqlalchemy import select

from .config import settings
from .db import SessionLocal
from .engine import ClaudeMenuEngine, MenuEngine
from .engine.base import EngineMeta, EngineUsage, ExtractedItem, MenuExtraction
from .engine.claude import EngineRefused
from .events import hub
from .images import analysis_jpeg
from .models import MenuItem, Photo, UsageLog
from .pricing import cost_usd

log = logging.getLogger(__name__)


class Analyzer:
    def __init__(self, engine: MenuEngine) -> None:
        self._engine = engine
        self._sem = asyncio.Semaphore(settings.analyze_concurrency)
        self._tasks: set[asyncio.Task] = set()
        self._loop: asyncio.AbstractEventLoop | None = None

    def bind_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        """서버 시작 시 이벤트 루프를 등록한다 (스레드풀에서 도는 동기 엔드포인트에서도 예약할 수 있도록)."""
        self._loop = loop

    def schedule(self, photo_id: str) -> None:
        # 동기 엔드포인트는 스레드풀에서 실행되어 실행 중인 루프가 없으므로 루프 스레드로 넘긴다.
        loop = self._loop
        if loop is None:
            loop = asyncio.get_running_loop()
        loop.call_soon_threadsafe(self._spawn, photo_id)

    def _spawn(self, photo_id: str) -> None:
        task = asyncio.create_task(self._run(photo_id))
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    def requeue_unfinished(self) -> int:
        with SessionLocal() as db:
            ids = db.scalars(select(Photo.id).where(Photo.status.in_(["pending", "processing"]))).all()
        for pid in ids:
            self.schedule(pid)
        return len(ids)

    async def _run(self, photo_id: str) -> None:
        async with self._sem:
            # 시작: 상태 갱신 + 이전 추출 결과 제거 (재분석 대비)
            with SessionLocal() as db:
                photo = db.get(Photo, photo_id)
                if photo is None:
                    return
                for old in list(photo.items):
                    db.delete(old)
                photo.status = "processing"
                photo.error = ""
                photo.progress_total = 0
                photo.started_at = datetime.now(timezone.utc)
                db.commit()
                session_id = photo.session_id
                path = settings.photo_dir / photo.file_path
            self._notify(session_id, photo_id, "processing")

            count = 0
            try:
                jpeg = await asyncio.to_thread(analysis_jpeg, path)
                async for kind, payload in self._engine.extract_stream(jpeg):
                    if kind == "meta":
                        self._apply_meta(photo_id, payload)
                        self._notify(session_id, photo_id, "processing")
                    elif kind == "item":
                        if self._add_item(photo_id, session_id, count, payload):
                            count += 1
                            hub.publish("item.added", {"session_id": session_id, "photo_id": photo_id, "count": count})
                    elif kind == "usage":
                        self._record_usage(photo_id, session_id, payload)
                    elif kind == "done":
                        self._finish(photo_id, payload, count)
                        self._notify(session_id, photo_id, "done")
            except EngineRefused as e:
                self._fail(photo_id, session_id, str(e), count)
            except Exception as e:  # noqa: BLE001
                log.exception("analyze failed for %s", photo_id)
                self._fail(photo_id, session_id, _friendly_error(e), count)

    # ---- DB helpers (짧은 트랜잭션 단위) ----
    def _apply_meta(self, photo_id: str, meta: EngineMeta) -> None:
        with SessionLocal() as db:
            photo = db.get(Photo, photo_id)
            if photo is None:
                return
            photo.detected_language = meta.detected_language
            photo.currency = meta.currency
            photo.restaurant_hint = meta.restaurant_hint
            photo.progress_total = max(0, meta.item_count_estimate)
            db.commit()

    def _add_item(self, photo_id: str, session_id: str, position: int, it: ExtractedItem) -> bool:
        with SessionLocal() as db:
            if db.get(Photo, photo_id) is None:  # 분석 중 사진이 삭제됨
                return False
            db.add(
                MenuItem(
                    photo_id=photo_id,
                    session_id=session_id,
                    position=position,
                    category=it.category.strip(),
                    original_name=it.original_name.strip(),
                    translated_name=it.translated_name.strip(),
                    description=it.description.strip(),
                    price_text=it.price_text.strip(),
                    price_value=it.price_value,
                    tags=[t for t in it.tags if t],
                    bbox=it.box,
                )
            )
            db.commit()
            return True

    def _record_usage(self, photo_id: str, session_id: str, usage: EngineUsage) -> None:
        cost = cost_usd(usage.model, usage.input_tokens, usage.output_tokens)
        with SessionLocal() as db:
            db.add(UsageLog(session_id=session_id, photo_id=photo_id, model=usage.model,
                            input_tokens=usage.input_tokens, output_tokens=usage.output_tokens, cost_usd=cost))
            photo = db.get(Photo, photo_id)
            if photo is not None:
                photo.engine_model = usage.model
                photo.input_tokens = usage.input_tokens
                photo.output_tokens = usage.output_tokens
                photo.cost_usd = cost
            db.commit()

    def _finish(self, photo_id: str, result: MenuExtraction, count: int) -> None:
        with SessionLocal() as db:
            photo = db.get(Photo, photo_id)
            if photo is None:
                return
            photo.analyzed_at = datetime.now(timezone.utc)
            photo.progress_total = count
            if not result.is_menu:
                photo.status = "error"
                photo.error = result.notes or "메뉴판 사진으로 인식되지 않았습니다."
            else:
                photo.status = "done"
                photo.error = result.notes  # 참고 메모(잘린 부분 등)가 있으면 표시
            db.commit()

    def _fail(self, photo_id: str, session_id: str, message: str, count: int) -> None:
        with SessionLocal() as db:
            photo = db.get(Photo, photo_id)
            if photo is not None:
                photo.status = "error"
                prefix = f"{count}개 추출 후 중단: " if count else ""
                photo.error = (prefix + message)[:2000]
                db.commit()
        self._notify(session_id, photo_id, "error")

    @staticmethod
    def _notify(session_id: str, photo_id: str, status: str) -> None:
        hub.publish("photo.updated", {"session_id": session_id, "photo_id": photo_id, "status": status})


def _friendly_error(e: Exception) -> str:
    """SDK/네트워크 예외를 사용자에게 보여 줄 한국어 메시지로 바꾼다."""
    import anthropic

    if isinstance(e, TypeError) and "authentication" in str(e).lower():
        return "ANTHROPIC_API_KEY 가 설정되지 않았습니다. 서버 환경변수를 확인한 뒤 '다시 분석' 을 눌러 주세요."
    if isinstance(e, anthropic.AuthenticationError):
        return "Claude API 인증에 실패했습니다. ANTHROPIC_API_KEY 를 확인해 주세요."
    if isinstance(e, anthropic.RateLimitError):
        return "Claude API 호출 한도에 걸렸습니다. 잠시 후 '다시 분석' 을 눌러 주세요."
    if isinstance(e, anthropic.APIConnectionError):
        return "Claude API 에 연결하지 못했습니다. 네트워크를 확인해 주세요."
    if isinstance(e, anthropic.APIStatusError):
        return f"Claude API 오류 ({e.status_code}): {e.message}"
    return f"{type(e).__name__}: {e}"


def build_default_engine() -> MenuEngine:
    if settings.menu_engine.lower() == "fake":
        from .engine.fake import FakeMenuEngine

        log.warning("MENU_ENGINE=fake: 데모 엔진을 사용합니다. 실제 번역은 수행되지 않습니다.")
        return FakeMenuEngine()
    return ClaudeMenuEngine(
        model=settings.claude_model,
        target_language=settings.target_language,
        source_languages=settings.source_languages,
        api_key=settings.anthropic_api_key,
    )


analyzer = Analyzer(build_default_engine())
