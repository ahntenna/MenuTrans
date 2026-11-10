from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .analyzer import analyzer
from .config import settings
from .db import engine, migrate
from .events import hub
from .models import Base
from .routers import events, items, orders, photos, sessions

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("menutrans")

# 빌드된 프론트엔드 위치 (Docker: /app/static, 로컬: ../frontend/dist)
STATIC_DIR = Path(__file__).resolve().parents[2] / "frontend" / "dist"
if (Path(__file__).resolve().parents[1] / "static").exists():
    STATIC_DIR = Path(__file__).resolve().parents[1] / "static"


@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(engine)
    migrate()
    analyzer.bind_loop(asyncio.get_running_loop())
    if not settings.anthropic_api_key:
        log.warning("ANTHROPIC_API_KEY 가 설정되지 않았습니다. SDK 의 다른 자격증명 경로가 없으면 분석이 실패합니다.")
    n = analyzer.requeue_unfinished()
    if n:
        log.info("미완료 사진 %d장을 다시 분석 큐에 넣었습니다.", n)
    yield


app = FastAPI(title="MenuTrans", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(sessions.router)
app.include_router(photos.router)
app.include_router(items.router)
app.include_router(orders.router)
app.include_router(events.router)


@app.get("/api/health")
def health() -> dict:
    return {"ok": True, "model": settings.claude_model, "subscribers": hub.subscriber_count}


# ---- 프론트엔드 정적 파일 + SPA 폴백 ----
if STATIC_DIR.exists():
    app.mount("/assets", StaticFiles(directory=STATIC_DIR / "assets"), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def spa(full_path: str, request: Request):  # noqa: ARG001
        if full_path.startswith("api/"):
            return JSONResponse({"detail": "Not Found"}, status_code=404)
        candidate = STATIC_DIR / full_path
        if full_path and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(STATIC_DIR / "index.html")
else:
    log.warning("프론트엔드 빌드(%s)가 없습니다. API 만 제공합니다.", STATIC_DIR)
