"""이미지 저장/변환 유틸.

- 원본은 그대로 보관한다.
- 분석용 JPEG (긴 변 1568px) 와 썸네일 (긴 변 480px) 을 파생 생성한다.
"""

from __future__ import annotations

import io
from pathlib import Path

from PIL import Image, ImageOps

try:  # iOS 에서 HEIC 가 그대로 올라오는 경우 대비
    from pillow_heif import register_heif_opener

    register_heif_opener()
except Exception:  # pragma: no cover
    pass

ANALYSIS_MAX_EDGE = 1568  # Claude 비전 권장 최대 변
THUMB_MAX_EDGE = 480


def _open(path: Path) -> Image.Image:
    img = Image.open(path)
    img = ImageOps.exif_transpose(img)  # 아이폰 회전 정보 반영
    if img.mode not in ("RGB", "L"):
        img = img.convert("RGB")
    return img


def _resized_jpeg(img: Image.Image, max_edge: int, quality: int) -> bytes:
    img = img.copy()
    img.thumbnail((max_edge, max_edge), Image.LANCZOS)
    buf = io.BytesIO()
    img.convert("RGB").save(buf, format="JPEG", quality=quality, optimize=True)
    return buf.getvalue()


def make_thumbnail(original: Path, thumb: Path) -> None:
    img = _open(original)
    thumb.write_bytes(_resized_jpeg(img, THUMB_MAX_EDGE, 80))


def analysis_jpeg(original: Path) -> bytes:
    img = _open(original)
    return _resized_jpeg(img, ANALYSIS_MAX_EDGE, 88)


def sniff_is_image(path: Path) -> bool:
    try:
        with Image.open(path) as img:
            img.verify()
        return True
    except Exception:
        return False
