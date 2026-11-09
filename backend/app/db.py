from collections.abc import Generator

from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session, sessionmaker

from .config import settings

settings.data_dir.mkdir(parents=True, exist_ok=True)
settings.photo_dir.mkdir(parents=True, exist_ok=True)

engine = create_engine(
    f"sqlite:///{settings.db_path}",
    connect_args={"check_same_thread": False},
)


@event.listens_for(engine, "connect")
def _sqlite_pragmas(dbapi_conn, _record):  # noqa: ANN001
    cur = dbapi_conn.cursor()
    cur.execute("PRAGMA journal_mode=WAL")
    cur.execute("PRAGMA foreign_keys=ON")
    cur.close()


SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


# create_all 은 기존 테이블에 컬럼을 추가하지 않으므로, 새로 생긴 컬럼은 여기서 보강한다.
_EXTRA_COLUMNS: dict[str, dict[str, str]] = {
    "photos": {
        "progress_total": "INTEGER NOT NULL DEFAULT 0",
        "started_at": "DATETIME",
    },
}


def migrate() -> None:
    from sqlalchemy import text

    with engine.begin() as conn:
        for table, cols in _EXTRA_COLUMNS.items():
            existing = {row[1] for row in conn.execute(text(f"PRAGMA table_info({table})"))}
            if not existing:
                continue
            for name, ddl in cols.items():
                if name not in existing:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}"))


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
