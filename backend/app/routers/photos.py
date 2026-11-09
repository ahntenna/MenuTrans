from __future__ import annotations

import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session, selectinload

from ..analyzer import analyzer
from ..config import settings
from ..db import get_db
from ..events import hub
from ..images import make_thumbnail, sniff_is_image
from ..models import Photo, RestaurantSession
from ..schemas import PhotoOut

router = APIRouter(prefix="/api", tags=["photos"])

_EXT_BY_TYPE = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/heic": ".heic",
    "image/heif": ".heif",
    "image/webp": ".webp",
}


@router.post("/sessions/{session_id}/photos", response_model=PhotoOut, status_code=201)
async def upload_photo(session_id: str, file: UploadFile = File(...), db: Session = Depends(get_db)) -> Photo:
    if db.get(RestaurantSession, session_id) is None:
        raise HTTPException(404, "세션을 찾을 수 없습니다.")

    content_type = (file.content_type or "").lower()
    ext = _EXT_BY_TYPE.get(content_type) or Path(file.filename or "").suffix.lower() or ".jpg"

    photo_id = uuid.uuid4().hex
    rel_dir = Path(session_id)
    abs_dir = settings.photo_dir / rel_dir
    abs_dir.mkdir(parents=True, exist_ok=True)
    rel_file = rel_dir / f"{photo_id}{ext}"
    rel_thumb = rel_dir / f"{photo_id}_thumb.jpg"
    abs_file = settings.photo_dir / rel_file

    # 스트리밍으로 저장하며 크기 제한
    size = 0
    with abs_file.open("wb") as out:
        while chunk := await file.read(1024 * 1024):
            size += len(chunk)
            if size > settings.max_upload_bytes:
                out.close()
                abs_file.unlink(missing_ok=True)
                raise HTTPException(413, f"파일이 너무 큽니다 (최대 {settings.max_upload_bytes // (1024*1024)}MB).")
            out.write(chunk)

    if size == 0 or not sniff_is_image(abs_file):
        abs_file.unlink(missing_ok=True)
        raise HTTPException(400, "이미지 파일이 아닙니다.")

    try:
        make_thumbnail(abs_file, settings.photo_dir / rel_thumb)
    except Exception as e:  # noqa: BLE001
        abs_file.unlink(missing_ok=True)
        raise HTTPException(400, f"이미지를 열 수 없습니다: {e}") from e

    photo = Photo(
        id=photo_id,
        session_id=session_id,
        original_name=file.filename or "",
        file_path=rel_file.as_posix(),
        thumb_path=rel_thumb.as_posix(),
        content_type=content_type or "image/jpeg",
        size_bytes=size,
        status="pending",
    )
    db.add(photo)
    db.commit()
    db.refresh(photo)

    hub.publish("photo.created", {"session_id": session_id, "photo_id": photo.id})
    analyzer.schedule(photo.id)
    return photo


def _get_photo(db: Session, photo_id: str) -> Photo:
    p = db.get(Photo, photo_id, options=[selectinload(Photo.items)])
    if p is None:
        raise HTTPException(404, "사진을 찾을 수 없습니다.")
    return p


@router.get("/photos/{photo_id}", response_model=PhotoOut)
def get_photo(photo_id: str, db: Session = Depends(get_db)) -> Photo:
    return _get_photo(db, photo_id)


@router.get("/photos/{photo_id}/file")
def photo_file(photo_id: str, db: Session = Depends(get_db)) -> FileResponse:
    p = _get_photo(db, photo_id)
    return FileResponse(settings.photo_dir / p.file_path, media_type=p.content_type, headers={"Cache-Control": "private, max-age=86400"})


@router.get("/photos/{photo_id}/thumb")
def photo_thumb(photo_id: str, db: Session = Depends(get_db)) -> FileResponse:
    p = _get_photo(db, photo_id)
    return FileResponse(settings.photo_dir / p.thumb_path, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=86400"})


@router.post("/photos/{photo_id}/retry", response_model=PhotoOut)
def retry_photo(photo_id: str, db: Session = Depends(get_db)) -> Photo:
    p = _get_photo(db, photo_id)
    if p.status == "processing":
        raise HTTPException(409, "이미 분석 중입니다.")
    p.status = "pending"
    p.error = ""
    db.commit()
    hub.publish("photo.updated", {"session_id": p.session_id, "photo_id": p.id, "status": "pending"})
    analyzer.schedule(p.id)
    return p


@router.delete("/photos/{photo_id}", status_code=204)
def delete_photo(photo_id: str, db: Session = Depends(get_db)) -> None:
    p = _get_photo(db, photo_id)
    session_id = p.session_id
    paths = [settings.photo_dir / p.file_path, settings.photo_dir / p.thumb_path]
    db.delete(p)
    db.commit()
    for path in paths:
        path.unlink(missing_ok=True)
    hub.publish("photo.deleted", {"session_id": session_id, "photo_id": photo_id})
