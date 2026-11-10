"""공용 비밀번호 인증.

APP_PASSWORD 가 설정되어 있으면 모든 API 가 쿠키 인증을 요구한다 (미설정 시 인증 없음).
쿠키 값은 비밀번호에서 유도한 HMAC 이므로 서버를 재시작해도 로그인이 유지되고,
비밀번호를 바꾸면 기존 로그인은 모두 무효가 된다.
"""

from __future__ import annotations

import hashlib
import hmac
import time

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel

from .config import settings

COOKIE = "mt_auth"
_MAX_FAILS = 5
_LOCK_SECONDS = 300
_fails: dict[str, tuple[int, float]] = {}  # ip -> (연속 실패 횟수, 잠금 해제 시각)

router = APIRouter(prefix="/api", tags=["auth"])


def auth_enabled() -> bool:
    return bool(settings.app_password)


def _token() -> str:
    return hmac.new((settings.app_password or "").encode(), b"menutrans-auth-v1", hashlib.sha256).hexdigest()


def is_authenticated(request: Request) -> bool:
    if not auth_enabled():
        return True
    return hmac.compare_digest(request.cookies.get(COOKIE, ""), _token())


def require_auth(request: Request) -> None:
    if not is_authenticated(request):
        raise HTTPException(401, "비밀번호가 필요합니다.")


class LoginBody(BaseModel):
    password: str


@router.get("/auth")
def auth_status(request: Request) -> dict:
    return {"required": auth_enabled(), "authenticated": is_authenticated(request)}


@router.post("/login")
def login(body: LoginBody, request: Request, response: Response) -> dict:
    if not auth_enabled():
        return {"ok": True}
    ip = request.client.host if request.client else "?"
    fails, locked_until = _fails.get(ip, (0, 0.0))
    now = time.time()
    if locked_until > now:
        raise HTTPException(429, f"시도 횟수를 초과했습니다. {int(locked_until - now) + 1}초 뒤에 다시 시도해 주세요.")
    if not hmac.compare_digest(body.password.encode(), (settings.app_password or "").encode()):
        fails += 1
        _fails[ip] = (0, now + _LOCK_SECONDS) if fails >= _MAX_FAILS else (fails, 0.0)
        raise HTTPException(401, "비밀번호가 올바르지 않습니다.")
    _fails.pop(ip, None)
    response.set_cookie(
        COOKIE,
        _token(),
        max_age=365 * 24 * 3600,
        httponly=True,
        samesite="lax",
        secure=request.url.scheme == "https",
        path="/",
    )
    return {"ok": True}


@router.post("/logout")
def logout(response: Response) -> dict:
    response.delete_cookie(COOKIE, path="/")
    return {"ok": True}
