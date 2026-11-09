"""SSE 브로드캐스트 허브.

모든 접속자는 /api/events 로 구독한다. 상태 변경(세션/사진/주문)이 생기면
publish() 가 모든 구독자 큐에 이벤트를 넣고, 클라이언트는 이벤트를 받아 다시 조회한다.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator
from typing import Any


class EventHub:
    def __init__(self) -> None:
        self._subscribers: set[asyncio.Queue[str]] = set()
        self._lock = asyncio.Lock()

    async def subscribe(self) -> AsyncIterator[str]:
        queue: asyncio.Queue[str] = asyncio.Queue(maxsize=100)
        async with self._lock:
            self._subscribers.add(queue)
        try:
            # 연결 직후 재시도 간격과 헬로 이벤트
            yield "retry: 3000\nevent: hello\ndata: {}\n\n"
            while True:
                try:
                    msg = await asyncio.wait_for(queue.get(), timeout=20)
                    yield msg
                except asyncio.TimeoutError:
                    # 프록시의 유휴 연결 종료를 막기 위한 keep-alive 주석
                    yield ": ping\n\n"
        finally:
            async with self._lock:
                self._subscribers.discard(queue)

    def publish(self, event: str, data: dict[str, Any]) -> None:
        payload = f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"
        for q in list(self._subscribers):
            try:
                q.put_nowait(payload)
            except asyncio.QueueFull:
                # 느린 구독자는 건너뜀 (재접속 시 전체 재조회함)
                pass

    @property
    def subscriber_count(self) -> int:
        return len(self._subscribers)


hub = EventHub()
