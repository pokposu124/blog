import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { PDFDocument } from "pdf-lib";
import { toFile } from "@anthropic-ai/sdk";
import {
  anthropic,
  describeApiError,
  MAX_PDF_PAGES,
} from "@/lib/anthropic";
import {
  findDocumentBySha,
  insertDocument,
  type DocumentRow,
} from "@/lib/db";

// better-sqlite3와 파일 업로드는 Edge에서 동작하지 않는다.
export const runtime = "nodejs";

/** Files API 한도는 500MB지만, 사업보고서 한 권이 이보다 클 이유가 없다. */
const MAX_BYTES = 32 * 1024 * 1024;

interface Candidate {
  filename: string;
  bytes: Uint8Array;
  sha256: string;
  pageCount: number;
  /** 이미 올라가 있으면 재사용할 행. */
  existing?: DocumentRow;
}

interface FileError {
  filename: string;
  message: string;
}

function sha256(bytes: Uint8Array): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

/** 페이지 수를 센다. 열 수 없는 PDF는 사유를 담아 던진다. */
async function countPages(bytes: Uint8Array, filename: string): Promise<number> {
  try {
    const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
    return pdf.getPageCount();
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`PDF를 열 수 없습니다 (${filename}): ${detail}`);
  }
}

function serialize(row: DocumentRow, reused: boolean) {
  return {
    id: row.id,
    filename: row.filename,
    page_count: row.page_count,
    size_bytes: row.size_bytes,
    file_id: row.file_id,
    uploaded_at: row.uploaded_at,
    reused,
  };
}

export async function GET() {
  const { db } = await import("@/lib/db");
  const rows = db()
    .prepare<[], DocumentRow>(
      "SELECT * FROM documents ORDER BY uploaded_at DESC",
    )
    .all();
  return NextResponse.json({ documents: rows.map((r) => serialize(r, true)) });
}

export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "multipart/form-data 요청이 아닙니다." },
      { status: 400 },
    );
  }

  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return NextResponse.json(
      { error: "첨부된 파일이 없습니다. 'files' 필드로 PDF를 보내세요." },
      { status: 400 },
    );
  }

  // 1단계: 전부 검사한다. 하나라도 걸리면 아무것도 올리지 않는다.
  //         부분 업로드로 어중간한 상태를 남기지 않기 위해서다.
  const candidates: Candidate[] = [];
  const errors: FileError[] = [];

  for (const file of files) {
    const filename = file.name || "unnamed.pdf";

    if (file.size > MAX_BYTES) {
      errors.push({
        filename,
        message: `파일이 너무 큽니다 (${(file.size / 1024 / 1024).toFixed(1)}MB). 32MB 이하만 됩니다.`,
      });
      continue;
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const hash = sha256(bytes);

    // 이미 올린 파일이면 페이지 수를 다시 세지도, 다시 올리지도 않는다.
    const existing = findDocumentBySha(hash);
    if (existing) {
      candidates.push({
        filename,
        bytes,
        sha256: hash,
        pageCount: existing.page_count,
        existing,
      });
      continue;
    }

    let pageCount: number;
    try {
      pageCount = await countPages(bytes, filename);
    } catch (err) {
      errors.push({
        filename,
        message: err instanceof Error ? err.message : String(err),
      });
      continue;
    }

    if (pageCount > MAX_PDF_PAGES) {
      errors.push({
        filename,
        message: `장/절 경계로 분할 필요 (현재 ${pageCount}페이지, 최대 ${MAX_PDF_PAGES}페이지)`,
      });
      continue;
    }

    candidates.push({ filename, bytes, sha256: hash, pageCount });
  }

  if (errors.length > 0) {
    return NextResponse.json(
      {
        error: "업로드할 수 없는 파일이 있어 전체를 중단했습니다.",
        files: errors,
      },
      { status: 400 },
    );
  }

  // 2단계: 통과한 것만 올린다.
  const documents: ReturnType<typeof serialize>[] = [];
  try {
    for (const c of candidates) {
      if (c.existing) {
        documents.push(serialize(c.existing, true));
        continue;
      }

      const uploaded = await anthropic().files.upload({
        file: await toFile(c.bytes, c.filename, { type: "application/pdf" }),
      });

      const row = insertDocument({
        sha256: c.sha256,
        filename: c.filename,
        page_count: c.pageCount,
        size_bytes: c.bytes.byteLength,
        file_id: uploaded.id,
      });
      documents.push(serialize(row, false));
    }
  } catch (err) {
    const { status, message } = describeApiError(err);
    return NextResponse.json({ error: message }, { status });
  }

  return NextResponse.json({ documents });
}
