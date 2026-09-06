# 투자 테제 반박 도구 (bear-case)

강세 테제를 입력하면 Claude가 그 테제를 무너뜨리는 논거를 고정 스키마 JSON으로 돌려주는
로컬 전용 도구. 인증 없음, 배포 안 함, 단일 사용자.

## 스택

- Next.js (App Router) + TypeScript + Tailwind
- SQLite (`better-sqlite3`) — 파일 DB, 마이그레이션은 기동 시 `db/schema.sql` 멱등 실행
- `@anthropic-ai/sdk` — **서버 라우트에서만** import. 클라이언트 컴포넌트에서 import 금지
- 키는 `.env.local`의 `ANTHROPIC_API_KEY`. `.env.local`은 커밋하지 않는다

## 절대 규칙

1. **루프백에만 바인딩한다.** `next dev`의 기본값은 `0.0.0.0`이라 같은 네트워크의
   누구나 접속할 수 있다. 이 앱은 인증이 없으므로 그대로 두면 남이 내 키로 분석을
   돌릴 수 있다. `dev` 스크립트에 `-H 127.0.0.1`을 유지한다.
2. **API 키는 서버에서만.** `NEXT_PUBLIC_` 접두사가 붙은 키를 만들지 않는다.
3. **모든 라우트는 Node 런타임.** `export const runtime = "nodejs"` 를 명시한다.
   better-sqlite3와 파일 업로드가 Edge에서 동작하지 않는다.
4. **프롬프트는 코드에 넣지 않는다.** 본문은 전부 `prompts/bear-case.md`.
   코드는 이 파일을 읽어서 system 프롬프트로 넣기만 한다.
5. **출력은 자유 서술 금지.** 결과는 반드시 아래 고정 스키마를 통과해야 한다.
6. **PDF는 재업로드 금지.** 같은 파일은 SQLite에 저장된 `file_id`를 재사용한다.

## Claude API — 이 프로젝트에서 확정된 사용법

버전 드리프트가 잦은 영역이다. 아래는 확인된 현재 API이며, 기억에 있는 옛 패턴으로
되돌리지 말 것.

| 항목 | 값 | 주의 |
|---|---|---|
| 모델 | `claude-opus-5` | 날짜 접미사 붙이지 않는다 |
| 확장 사고 | `thinking: { type: "adaptive", display: "summarized" }` | `budget_tokens`는 Opus 5에서 **400 에러**. Opus 5는 thinking이 기본 ON이고, `display` 기본값이 `"omitted"`라 UI에 사고 과정을 보이려면 `"summarized"`를 명시해야 한다 |
| 사고 깊이 | `output_config: { effort: "high" }` | `low`~`max`. 기본 `high` |
| 스트리밍 | `client.messages.stream(...)` + `await stream.finalMessage()` | `max_tokens: 64000` |
| 웹서치 | `{ type: "web_search_20260209", name: "web_search", max_uses: 8 }` | Opus 5에서 쓰는 최신 variant. `web_search_20250305`는 구형 |
| Files API | `client.files.upload({ file: await toFile(...) })` | **베타 아님.** `client.beta.files` + `files-api-2025-04-14` 헤더는 구형 경로 |
| PDF 첨부 | `{ type: "document", source: { type: "file", file_id } }` | |
| 에러 처리 | `Anthropic.BadRequestError` → `RateLimitError` → `APIError` 순 | 문자열 매칭 금지 |

### 고정 출력을 얻는 방법: `output_config.format`이 아니라 strict tool

`output_config.format`(structured outputs)을 쓰지 않는다. 두 가지 이유다.

1. 스키마에서 **배열 개수를 강제할 수 없다.** `minItems`는 0 또는 1만 지원하고
   `maxItems`는 미지원이라 "시나리오 정확히 3개"를 스키마로 못 박을 수 없다.
2. 서버 툴(web_search) 및 스트리밍과의 조합이 공식 문서에 명시돼 있지 않다.
   웹서치 ON일 때 동작을 보장할 수 없다.

대신 `emit_bear_case` **커스텀 툴을 `strict: true`로 정의**하고, 프롬프트에서
"분석이 끝나면 이 툴을 정확히 한 번 호출하라"고 지시한다.

- `tool_choice`는 `{ type: "auto" }`. 강제하면 web_search를 먼저 못 돈다.
- 결과 JSON은 `tool_use` 블록의 `input`에서 꺼낸다. 스트리밍 중에는
  `input_json_delta`로 부분 JSON이 흘러오므로 진행 상황 표시에 쓸 수 있다.
- `strict: true`는 스키마 적합성만 보장한다. **개수(3개) 검증은 Zod로 서버에서**
  다시 한다. 어기면 교정 메시지와 함께 1회 재시도하고, 그래도 실패하면 에러로 처리한다.
- 툴 input은 반드시 `JSON.parse`로 읽는다. 직렬화된 문자열을 정규식으로 긁지 않는다.

### 응답 블록 처리

한 응답의 `content`에 여러 종류가 섞여 온다.

- `thinking` — `display: "summarized"`일 때만 내용이 있다. UI 진행 표시에만 쓴다
- `text` — 모델의 짧은 진행 코멘트. 이어붙여 로그로 남기되 **결과로 쓰지 않는다**
- `server_tool_use` / `web_search_tool_result` — 인용 출처. `.content`가
  **성공이면 배열, 실패면 `{ error_code }` 객체**다. 인덱싱 전에 분기할 것.
  각 `web_search_result`의 `url` / `title`을 모아 결과 하단 출처 목록으로 쓴다
- `tool_use` (`emit_bear_case`) — 실제 결과

### 거절(refusal) 처리

`stop_reason === "refusal"`이면 `content`를 읽기 전에 먼저 분기한다. Opus 5는
서버사이드 폴백을 쓸 수 있다 (`client.beta.messages.*` + `betas: ["server-side-fallback-2026-07-01"]`
+ `fallbacks: "default"`). 켤지 여부는 `lib/anthropic.ts` 상단 플래그 하나로 토글한다.

## 고정 출력 스키마

```ts
{
  collapse_scenarios: [        // 정확히 3개
    { trigger, mechanism, years_to_impact, leading_indicators: string[] }
  ],
  moat_erosion: {
    tech_substitution, regulatory, demand_shift, customer_concentration
  },
  valuation_attack: [          // 정확히 3개
    { assumption, why_fragile, downside_case_value }
  ],
  thesis_breakers: string[],   // 관측 가능한 지표만. "심리", "정서" 같은 표현 금지
  what_the_short_knows: string[]
}
```

`thesis_breakers`는 관측 가능해야 한다 — 숫자, 공시 항목, 발표 일정처럼 확인 가능한
사건. 프롬프트에 이 제약을 넣고, 서버에서도 휴리스틱으로 한 번 거른다.

## PDF 업로드 규칙

1. 브라우저에서 받은 파일을 서버 라우트에서 `pdf-lib`로 열어 `getPageCount()`.
2. **100p 초과면 업로드하지 않고 400.** 메시지에 실제 페이지 수를 담아
   "장/절 경계로 분할 필요 (현재 N페이지)"로 돌려준다.
   (API 자체 한도는 600p/32MB지만, 분석 품질을 위해 더 좁게 잡은 자체 규칙이다.)
3. 통과하면 Files API 업로드 → `file_id`를 `documents` 테이블에 저장.
4. 재분석 시 `sha256` 해시로 기존 행을 찾아 **업로드를 건너뛰고 `file_id` 재사용**.

## 데이터 모델

- `documents` — `id, sha256, filename, page_count, file_id, uploaded_at`
- `analyses` — `id, ticker, name, price, target_price, thesis, bull_assumptions(JSON),
  web_search_enabled, model, result(JSON), citations(JSON), usage(JSON), created_at, status, error`
- `analysis_documents` — `analysis_id, document_id` (N:N)
- `breaker_checks` — `ticker, breaker, checked_at` (PK: ticker+breaker)

`thesis_breakers` 확인 여부는 **분석 실행이 아니라 종목+신호 문구에** 묶는다.
재분석해도 같은 문구의 신호면 확인 표시가 유지된다 — 신호는 특정 실행의 산출물이
아니라 세상에 대한 관측이기 때문이다. 행의 존재 자체가 "확인됨"이고, 해제하면 지운다.

`web_search_enabled`는 결과와 함께 저장한다. 히스토리 목록에서 뱃지로 표시한다.
같은 `ticker`의 직전 분석과 구조적 diff를 보여준다 (필드 단위 추가/삭제/변경).

## 파일 배치

```
app/
  page.tsx                      입력 폼 + 결과
  history/[ticker]/page.tsx     종목별 히스토리 + diff
  api/documents/route.ts        PDF 업로드 (페이지 수 검사 → Files API)
  api/breakers/route.ts         붕괴 신호 확인 상태 조회/토글
  api/analyze/route.ts          분석 스트리밍 (SSE)
  _components/BearCaseView.tsx  결과 렌더 (두 페이지가 공유)
lib/
  anthropic.ts                  클라이언트 + 모델/툴 상수
  schema.ts                     Zod 스키마 + JSON Schema (단일 출처)
  db.ts                         better-sqlite3 연결 + 마이그레이션
  diff.ts                       결과 구조 diff
  events.ts                     SSE 이벤트 계약 (서버·UI 공유)
prompts/
  bear-case.md                  시스템 프롬프트 (코드 수정 없이 튜닝)
db/
  schema.sql
scripts/
  smoke.ts                      실서버 확인용 1회 호출
  mock-anthropic.mjs            개발용 가짜 Anthropic 서버 (요금 없이 전체 흐름)
  make-test-pdf.mjs             첨부 확인용 PDF 생성
design/                         (이전 작업물 — 이 프로젝트와 무관)
```

`lib/schema.ts`가 스키마의 **단일 출처**다. Zod 스키마를 정의하고 거기서 툴의
`input_schema`(JSON Schema)를 파생시킨다. 두 벌을 손으로 관리하지 않는다.

## 명령어

```bash
npm run dev        # localhost:3000

# 요금 없이 전체 흐름 돌려보기 (터미널 둘)
npm run mock
ANTHROPIC_API_KEY=mock ANTHROPIC_BASE_URL=http://localhost:4010 npm run dev
npm run build
npm run typecheck  # tsc --noEmit

# 실제 API로만 확인되는 것들을 한 번에 태운다 (요금 발생)
npm run smoke                              # 웹서치 켜고 호출
npm run smoke -- --no-search               # 툴 조합만 확인
npm run smoke -- --pdf ./사업보고서.pdf     # Files API + file_id 첨부까지
```

`next.config.ts`에 `serverExternalPackages: ["better-sqlite3"]`가 필요하다.
네이티브 모듈이라 번들링되면 안 된다.

## 컨벤션

- 서버 라우트는 `zod`로 입력을 파싱하고, 실패 시 400과 필드별 메시지를 돌려준다
- SQLite 접근은 `lib/db.ts`를 통해서만. 라우트에서 직접 `new Database()` 금지
- 금액은 정수(원) 그대로 저장한다. 부동소수 반올림을 DB에 남기지 않는다
- 긴 작업은 전부 스트리밍. 클라이언트에서 `EventSource`가 아니라
  `fetch` + `ReadableStream`으로 읽는다 (POST 본문이 필요하므로)
