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
| `CLAUDE_MODEL` | `claude-opus-5-5` | 분석 모델의 기본값. 앱의 설정 화면(상단 톱니바퀴)에서 바꾸면 그 값이 우선하며 `DATA_DIR/settings.json` 에 저장된다 |
| `APP_PASSWORD` | (없음) | 공용 비밀번호. 설정하면 모든 API 가 로그인 쿠키를 요구한다. 비워 두면 주소를 아는 누구나 접근 가능 |
| `MENU_ENGINE` | `claude` | `fake` 로 두면 API 키 없이 데모 항목을 1.5초 간격으로 흘려보내 UI(실시간 추가·진행률)를 시험할 수 있다 |
| `DATA_DIR` | `./data` (Docker: `/data`) | DB 와 사진 저장 위치 |
| `ANALYZE_CONCURRENCY` | `2` | 동시 분석 사진 수 |
| `MAX_UPLOAD_BYTES` | `31457280` | 업로드 상한 (30MB) |

## 엔진 교체

`backend/app/engine/base.py` 의 `MenuEngine.extract(image_jpeg) -> MenuExtraction` 를 구현하고
`backend/app/analyzer.py` 의 `build_default_engine()` 에서 바꿔 끼우면 된다.

## 주요 기능 메모

- **공용 비밀번호**: `APP_PASSWORD` 를 `.env` 에 넣는다 (저장소에는 올리지 않는다). 5회 연속 실패하면 해당 IP 를 5분간 잠근다. 비밀번호를 바꾸면 기존 로그인은 모두 무효가 된다.
- **업로드 전 사진 축소**: 업로드 버튼 아래 체크박스로 켜고 끈다 (기본 끔, 기기별로 기억). 켜면 긴 변 2000px JPEG 로 줄여 보내며, 서버에 보관되는 사진도 축소본이 된다.
- **직원에게 보여주기**: 주문 탭에서 원어 메뉴명과 수량만 큰 글씨, 밝은 배경의 전체 화면으로 띄운다.
- **원화 환산**: 한국 시간 기준 하루 한 번, 그날 첫 요청 때 환율을 받아 `data/rates.json` 에 저장하고 그날은 같은 값을 쓴다 (출처: open.er-api.com). 받지 못하면 직전 값을 쓰고 화면에 표시한다.
- **사진 속 위치 표시**: 메뉴 카드의 사진 아이콘을 누르면 원본 사진에서 해당 항목 위치를 강조한다. 좌표는 모델이 추정한 대략적인 값이며, 이 기능 추가 전에 분석된 메뉴는 "메뉴판 다시 불러오기" 후에 표시된다.
- **세션 검색**: 목록 화면에서 세션 이름, 상호명, 주소, 메모, 메뉴 이름(원어·번역)으로 찾는다.
- **내보내기**: 세션 카드의 "공유"(기기 공유 시트 또는 클립보드)와 "내보내기"(`.md` / `.json` 파일). API 는 `GET /api/sessions/{id}/export?format=md|json`.
- **오프라인 조회**: 서비스 워커가 앱 화면, 세션 목록·상세, 사진을 캐시한다. 목록을 열면 모든 세션의 상세와 사진을 백그라운드로 미리 받아 두므로 열어 보지 않은 세션도 오프라인에서 볼 수 있다. 오프라인에서는 조회만 가능하다. 서비스 워커는 HTTPS 또는 localhost 에서만 동작하므로, `http://<PC IP>` 로 접속한 개발 환경에서는 이 기능이 꺼진다.
- **비용 가시화**: 분석 1회마다 토큰 사용량을 `usage_log` 에 기록하고, 세션 카드·사진 상세·목록 하단에 누적 비용을 보여 준다 (`GET /api/usage`). 단가는 `backend/app/pricing.py` 의 표 기준 추정치이며, 중간에 실패한 분석은 집계에서 빠질 수 있다.
