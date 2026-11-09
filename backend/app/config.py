from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """환경변수(.env)로 설정. 모든 키는 MENUTRANS_ 접두사 없이 그대로 사용."""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # 데이터 저장 루트 (SQLite + 사진). Docker 에서는 /data 볼륨.
    data_dir: Path = Path("./data")

    # 분석 엔진: "claude" (기본) | "fake" (API 키 없이 UI 시험용 데모 데이터)
    menu_engine: str = "claude"

    # Claude API
    anthropic_api_key: str | None = None
    claude_model: str = "claude-opus-5-5"
    # 동시에 분석할 사진 수
    analyze_concurrency: int = 2

    # 업로드 제한 (바이트)
    max_upload_bytes: int = 30 * 1024 * 1024

    # 번역 대상 언어 (고정: 한국어)
    target_language: str = "Korean"
    # 허용 원문 언어
    source_languages: list[str] = ["English", "Japanese", "French", "Spanish", "Italian"]

    # 개발 중 Vite dev 서버 CORS 허용
    cors_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]

    @property
    def db_path(self) -> Path:
        return self.data_dir / "menutrans.sqlite3"

    @property
    def photo_dir(self) -> Path:
        return self.data_dir / "photos"


settings = Settings()
