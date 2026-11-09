# MenuTrans

아이폰 카메라로 찍은 해외 식당 메뉴판을 한국어로 번역해 세션(식당)별로 모아 두고, 주문한 메뉴를 기록하는 반응형 웹앱.

- 원문 언어: 영어 · 일본어 · 프랑스어 · 스페인어 · 이탈리아어 (자동 감지) → 한국어
- OCR + 번역: Claude 비전 모델 한 번 호출로 메뉴 항목을 구조화 JSON 으로 추출
- 모든 접속자가 같은 화면: SSE(`/api/events`) 로 변경 사항 실시간 반영
- 원본 사진 보관, 사진별 분석 상태/재시도, 세션별 주문 기록과 합계

## 구조

```
backend/   FastAPI (Python 3.12+), SQLite, 사진 저장, Claude 호출, SSE
frontend/  Vite + React + TypeScript, PWA 매니페스트
Dockerfile / docker-compose.yml   단일 컨테이너 (프론트 빌드 포함), /data 볼륨
scripts/   로컬 실행 배치 스크립트 (dev.bat, build_and_run.bat)
```

### 데이터 모델
- `sessions` 식당 방문 1회
- `photos` 세션에 속한 원본 사진 (status: pending → processing → done | error)
- `menu_items` 사진에서 추출된 항목 (원문, 번역, 설명, 가격, 태그, 카테고리)
- `orders` 주문 기록 (이름/가격 스냅샷 보관 → 사진 삭제 후에도 유지)

### API 요약
| 메서드 | 경로 | 설명 |
|---|---|---|
| GET/POST | `/api/sessions` | 세션 목록 / 생성 |
| GET/PATCH/DELETE | `/api/sessions/{id}` | 세션 상세(사진·메뉴·주문 포함) / 수정 / 삭제 |
| POST | `/api/sessions/{id}/photos` | 사진 업로드(multipart `file`) → 분석 큐 |
| GET | `/api/photos/{id}/file`, `/thumb` | 원본 / 썸네일 |
| POST/DELETE | `/api/photos/{id}/retry`, `/api/photos/{id}` | 재분석 / 삭제 |
| POST | `/api/sessions/{id}/orders` | 주문 추가 (`menu_item_id` 또는 `name`+`price_text`) |
| PATCH/DELETE | `/api/orders/{id}` | 수량·메모 수정 / 삭제 |
| GET | `/api/events` | SSE 스트림 |
| GET | `/api/health` | 상태 |

## 로컬 실행

```bat
copy backend\.env.example backend\.env   # ANTHROPIC_API_KEY 입력
scripts\dev.bat
```

- `dev.bat` 은 venv / node_modules 가 없으면 먼저 설치한 뒤, 백엔드(8000)와 Vite(5173) 창을 각각 연다.
- PC: http://localhost:5173 (Vite 가 `/api` 를 8000 으로 프록시)
- 아이폰: 같은 Wi-Fi 에서 `http://<PC IP>:5173` (스크립트가 IPv4 주소를 출력한다). 사진 촬영용 `<input type="file" capture>` 는 HTTP 에서도 동작한다.
  (홈 화면 추가(PWA) 와 `getUserMedia` 만 HTTPS 가 필요)
- 빌드 결과를 FastAPI 하나로 서빙해 보려면 `scripts\build_and_run.bat` → http://localhost:8000

## 서버 배포 (Docker, 기존 리버스 프록시 뒤)

```bash
cp .env.example .env    # ANTHROPIC_API_KEY 입력
docker compose up -d --build
```

컨테이너는 `127.0.0.1:8000` 에만 바인딩된다. 기존 리버스 프록시에서 HTTPS 도메인을 `http://127.0.0.1:8000` 으로 프록시하면 된다.

SSE 가 끊기지 않도록 프록시 설정에 다음을 넣는다 (Nginx 예시).

```nginx
location / {
    proxy_pass http://127.0.0.1:8000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_buffering off;          # SSE
    proxy_read_timeout 1h;        # SSE 유휴 연결 유지 (서버가 20초마다 ping 전송)
    client_max_body_size 32m;     # 사진 업로드
}
```

Caddy 는 기본 설정으로 SSE 와 업로드가 동작한다 (`reverse_proxy 127.0.0.1:8000`).

데이터(SQLite + 원본 사진)는 `menutrans_data` 볼륨에 있다. 백업은 볼륨을 통째로 복사하면 된다.

## 환경변수

| 이름 | 기본값 | 설명 |
|---|---|---|
| `ANTHROPIC_API_KEY` | – | Claude API 키 (필수) |
| `CLAUDE_MODEL` | `claude-opus-5-5` | 분석 모델. 비용을 낮추려면 `claude-sonnet-5-5` / `claude-haiku-5-5` 로 실측 비교 |
| `MENU_ENGINE` | `claude` | `fake` 로 두면 API 키 없이 데모 항목을 1.5초 간격으로 흘려보내 UI(실시간 추가·진행률)를 시험할 수 있다 |
| `DATA_DIR` | `./data` (Docker: `/data`) | DB 와 사진 저장 위치 |
| `ANALYZE_CONCURRENCY` | `2` | 동시 분석 사진 수 |
| `MAX_UPLOAD_BYTES` | `31457280` | 업로드 상한 (30MB) |

## 엔진 교체

`backend/app/engine/base.py` 의 `MenuEngine.extract(image_jpeg) -> MenuExtraction` 를 구현하고
`backend/app/analyzer.py` 의 `build_default_engine()` 에서 바꿔 끼우면 된다.
