from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from ..events import hub

router = APIRouter(prefix="/api", tags=["events"])


@router.get("/events")
async def events() -> StreamingResponse:
    return StreamingResponse(
        hub.subscribe(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            # Nginx 가 응답을 버퍼링하지 않도록
            "X-Accel-Buffering": "no",
        },
    )
