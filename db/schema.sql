-- 기동 시 멱등 실행된다. 컬럼 추가는 이 파일에 CREATE ... IF NOT EXISTS로만 쌓는다.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- Files API에 올린 PDF. sha256으로 재업로드를 막는다.
CREATE TABLE IF NOT EXISTS documents (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  sha256      TEXT    NOT NULL UNIQUE,
  filename    TEXT    NOT NULL,
  page_count  INTEGER NOT NULL,
  size_bytes  INTEGER NOT NULL,
  file_id     TEXT    NOT NULL,
  uploaded_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS analyses (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  ticker             TEXT    NOT NULL,
  name               TEXT    NOT NULL,
  price              INTEGER NOT NULL,
  target_price       INTEGER NOT NULL,
  thesis             TEXT    NOT NULL,
  bull_assumptions   TEXT    NOT NULL,          -- JSON string[]
  web_search_enabled INTEGER NOT NULL,          -- 0 | 1
  model              TEXT    NOT NULL,
  status             TEXT    NOT NULL,          -- running | done | error
  result             TEXT,                      -- JSON BearCase
  citations          TEXT,                      -- JSON {url,title}[]
  usage              TEXT,                      -- JSON
  error              TEXT,
  created_at         TEXT    NOT NULL DEFAULT (datetime('now')),
  finished_at        TEXT
);

CREATE INDEX IF NOT EXISTS idx_analyses_ticker
  ON analyses (ticker, created_at DESC);

CREATE TABLE IF NOT EXISTS analysis_documents (
  analysis_id INTEGER NOT NULL REFERENCES analyses(id)  ON DELETE CASCADE,
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  PRIMARY KEY (analysis_id, document_id)
);

-- thesis_breakers 확인 여부. 분석 실행이 아니라 종목+신호 문구에 묶는다.
-- 재분석해도 같은 신호면 확인 표시가 유지된다. 행의 존재 = 확인됨.
CREATE TABLE IF NOT EXISTS breaker_checks (
  ticker     TEXT NOT NULL,
  breaker    TEXT NOT NULL,
  checked_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (ticker, breaker)
);
