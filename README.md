# 투자 테제 반박 도구 (bear-case)

강세 테제를 넣으면 Claude가 그 테제를 무너뜨리는 논거만 고정 스키마 JSON으로
돌려주는 로컬 전용 도구. 인증 없음, 배포 안 함.

규약과 API 사용법은 [CLAUDE.md](./CLAUDE.md)에 있다.

## 시작하기

```bash
npm install
cp .env.local.example .env.local   # ANTHROPIC_API_KEY 채우기
npm run dev                        # http://localhost:3000
```

첫 실행 시 `db/bear-case.db`가 만들어진다 (git에 올라가지 않는다).

## 실서버 확인

실제 호출로만 드러나는 두 가지 — strict 커스텀 툴과 web_search 서버 툴의 조합,
Files API `file_id` 첨부 — 는 스모크 스크립트로 한 번에 확인한다. 요금이 나간다.

```bash
npm run smoke
npm run smoke -- --pdf ./사업보고서.pdf
```

터미널을 못 쓸 때는 GitHub Actions로 돌린다. 저장소 시크릿에
`ANTHROPIC_API_KEY`를 등록하고(Settings → Secrets and variables → Actions),
Actions 탭의 **스모크 (실서버 확인)** 워크플로를 수동 실행하면 된다.
결과는 잡 요약(Summary)에 그대로 찍힌다.

## 화면

- `/` — 테제 입력, PDF 첨부, 웹서치 토글, 스트리밍 결과
- `/history/[ticker]` — 종목별 실행 이력과 직전 분석 대비 구조 diff

## design/

이전 작업물(리서치 회사 홈 시안). 이 프로젝트와 무관하다.
