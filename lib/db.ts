import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

/**
 * SQLite 접근은 전부 이 파일을 통한다. 라우트에서 직접 `new Database()`를 열지 않는다.
 *
 * 개발 모드에서 모듈이 다시 평가되어도 연결이 하나만 유지되도록 globalThis에 캐싱한다.
 */

const DB_PATH = path.join(process.cwd(), "db", "bear-case.db");
const SCHEMA_PATH = path.join(process.cwd(), "db", "schema.sql");

type Conn = Database.Database;

const globalForDb = globalThis as unknown as { __bearCaseDb?: Conn };

function connect(): Conn {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const conn = new Database(DB_PATH);
  // 마이그레이션은 기동 시 멱등 실행.
  conn.exec(fs.readFileSync(SCHEMA_PATH, "utf8"));
  return conn;
}

export function db(): Conn {
  if (!globalForDb.__bearCaseDb) globalForDb.__bearCaseDb = connect();
  return globalForDb.__bearCaseDb;
}

/* ------------------------------------------------------------------ */
/* documents                                                           */
/* ------------------------------------------------------------------ */

export interface DocumentRow {
  id: number;
  sha256: string;
  filename: string;
  page_count: number;
  size_bytes: number;
  file_id: string;
  uploaded_at: string;
}

export function findDocumentBySha(sha256: string): DocumentRow | undefined {
  return db()
    .prepare<[string], DocumentRow>("SELECT * FROM documents WHERE sha256 = ?")
    .get(sha256);
}

export function findDocumentsByIds(ids: readonly number[]): DocumentRow[] {
  if (ids.length === 0) return [];
  const holes = ids.map(() => "?").join(",");
  return db()
    .prepare<number[], DocumentRow>(
      `SELECT * FROM documents WHERE id IN (${holes})`,
    )
    .all(...ids);
}

export function insertDocument(row: {
  sha256: string;
  filename: string;
  page_count: number;
  size_bytes: number;
  file_id: string;
}): DocumentRow {
  const info = db()
    .prepare(
      `INSERT INTO documents (sha256, filename, page_count, size_bytes, file_id)
       VALUES (@sha256, @filename, @page_count, @size_bytes, @file_id)`,
    )
    .run(row);
  return db()
    .prepare<[number], DocumentRow>("SELECT * FROM documents WHERE id = ?")
    .get(Number(info.lastInsertRowid))!;
}

/* ------------------------------------------------------------------ */
/* analyses                                                            */
/* ------------------------------------------------------------------ */

export interface AnalysisRow {
  id: number;
  ticker: string;
  name: string;
  price: number;
  target_price: number;
  thesis: string;
  bull_assumptions: string;
  web_search_enabled: number;
  model: string;
  status: "running" | "done" | "error";
  result: string | null;
  citations: string | null;
  usage: string | null;
  error: string | null;
  created_at: string;
  finished_at: string | null;
}

export function insertAnalysis(row: {
  ticker: string;
  name: string;
  price: number;
  target_price: number;
  thesis: string;
  bull_assumptions: string[];
  web_search_enabled: boolean;
  model: string;
}): number {
  const info = db()
    .prepare(
      `INSERT INTO analyses
         (ticker, name, price, target_price, thesis, bull_assumptions,
          web_search_enabled, model, status)
       VALUES
         (@ticker, @name, @price, @target_price, @thesis, @bull_assumptions,
          @web_search_enabled, @model, 'running')`,
    )
    .run({
      ...row,
      bull_assumptions: JSON.stringify(row.bull_assumptions),
      web_search_enabled: row.web_search_enabled ? 1 : 0,
    });
  return Number(info.lastInsertRowid);
}

export function linkAnalysisDocuments(
  analysisId: number,
  documentIds: readonly number[],
): void {
  if (documentIds.length === 0) return;
  const stmt = db().prepare(
    "INSERT OR IGNORE INTO analysis_documents (analysis_id, document_id) VALUES (?, ?)",
  );
  const tx = db().transaction((ids: readonly number[]) => {
    for (const id of ids) stmt.run(analysisId, id);
  });
  tx(documentIds);
}

export function finishAnalysis(
  id: number,
  payload: { result: unknown; citations: unknown; usage: unknown },
): void {
  db()
    .prepare(
      `UPDATE analyses
          SET status = 'done', result = ?, citations = ?, usage = ?,
              finished_at = datetime('now')
        WHERE id = ?`,
    )
    .run(
      JSON.stringify(payload.result),
      JSON.stringify(payload.citations),
      JSON.stringify(payload.usage),
      id,
    );
}

export function failAnalysis(id: number, message: string): void {
  db()
    .prepare(
      `UPDATE analyses
          SET status = 'error', error = ?, finished_at = datetime('now')
        WHERE id = ?`,
    )
    .run(message, id);
}

/** 같은 종목의 완료된 분석을 최신순으로. diff의 기준이 된다. */
export function listAnalysesByTicker(ticker: string): AnalysisRow[] {
  return db()
    .prepare<[string], AnalysisRow>(
      `SELECT * FROM analyses
        WHERE ticker = ? AND status = 'done'
        ORDER BY created_at DESC, id DESC`,
    )
    .all(ticker);
}

export function getAnalysis(id: number): AnalysisRow | undefined {
  return db()
    .prepare<[number], AnalysisRow>("SELECT * FROM analyses WHERE id = ?")
    .get(id);
}

/* ------------------------------------------------------------------ */
/* breaker_checks                                                      */
/* ------------------------------------------------------------------ */

export interface BreakerCheckRow {
  breaker: string;
  checked_at: string;
}

/** 확인된 신호만 돌려준다. 문구 → 확인 시각. */
export function listBreakerChecks(ticker: string): Record<string, string> {
  const rows = db()
    .prepare<[string], BreakerCheckRow>(
      "SELECT breaker, checked_at FROM breaker_checks WHERE ticker = ?",
    )
    .all(ticker);
  return Object.fromEntries(rows.map((r) => [r.breaker, r.checked_at]));
}

/** 체크하면 행을 만들고, 해제하면 지운다. 돌려주는 값은 확인 시각(해제면 null). */
export function setBreakerCheck(
  ticker: string,
  breaker: string,
  checked: boolean,
): string | null {
  if (!checked) {
    db()
      .prepare("DELETE FROM breaker_checks WHERE ticker = ? AND breaker = ?")
      .run(ticker, breaker);
    return null;
  }
  db()
    .prepare(
      `INSERT INTO breaker_checks (ticker, breaker) VALUES (?, ?)
       ON CONFLICT (ticker, breaker) DO NOTHING`,
    )
    .run(ticker, breaker);
  const row = db()
    .prepare<[string, string], BreakerCheckRow>(
      "SELECT breaker, checked_at FROM breaker_checks WHERE ticker = ? AND breaker = ?",
    )
    .get(ticker, breaker);
  return row?.checked_at ?? null;
}
