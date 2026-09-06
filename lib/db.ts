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
