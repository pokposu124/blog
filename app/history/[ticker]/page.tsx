import Link from "next/link";
import { notFound } from "next/navigation";
import { BearCaseView } from "@/app/_components/BearCaseView";
import { listAnalysesByTicker, type AnalysisRow } from "@/lib/db";
import { diffBearCase, type Change } from "@/lib/diff";
import type { Citation } from "@/lib/events";
import type { BearCase } from "@/lib/schema";

// SQLite를 읽으므로 빌드 시점에 미리 렌더하지 않는다.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function parseResult(row: AnalysisRow): BearCase | null {
  if (!row.result) return null;
  try {
    return JSON.parse(row.result) as BearCase;
  } catch {
    return null;
  }
}

function parseCitations(row: AnalysisRow): Citation[] {
  if (!row.citations) return [];
  try {
    return JSON.parse(row.citations) as Citation[];
  } catch {
    return [];
  }
}

const KIND_STYLE: Record<Change["kind"], { label: string; cls: string }> = {
  added: { label: "추가", cls: "text-keep bg-keep-soft" },
  removed: { label: "삭제", cls: "text-attack bg-attack-soft" },
  changed: { label: "변경", cls: "text-ink-2 bg-raised" },
};

function DiffList({ changes }: { changes: Change[] }) {
  if (changes.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-line p-5 text-center text-[13px] text-ink-3">
        직전 분석과 구조적으로 동일하다.
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-px overflow-hidden rounded-lg border border-line bg-line">
      {changes.map((c, i) => {
        const style = KIND_STYLE[c.kind];
        return (
          <li key={i} className="bg-surface px-4 py-3">
            <div className="mb-1.5 flex items-center gap-2">
              <span className={`rounded px-1.5 py-0.5 text-[10.5px] font-semibold ${style.cls}`}>
                {style.label}
              </span>
              <span className="text-[11.5px] text-ink-3">{c.path}</span>
            </div>
            {c.kind === "changed" ? (
              <div className="grid gap-1.5 text-[13px] leading-relaxed sm:grid-cols-2">
                <p className="text-ink-3 line-through decoration-line">{c.before}</p>
                <p>{c.after}</p>
              </div>
            ) : (
              <p className="text-[13px] leading-relaxed">{c.value}</p>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export default async function HistoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ ticker: string }>;
  searchParams: Promise<{ id?: string }>;
}) {
  const { ticker: raw } = await params;
  const { id } = await searchParams;
  const ticker = decodeURIComponent(raw);

  const rows = listAnalysesByTicker(ticker);
  if (rows.length === 0) notFound();

  const index = id ? Math.max(0, rows.findIndex((r) => String(r.id) === id)) : 0;
  const current = rows[index];
  const previous = rows[index + 1];

  const result = parseResult(current);
  const prevResult = previous ? parseResult(previous) : null;
  const changes = result && prevResult ? diffBearCase(prevResult, result) : null;

  return (
    <main className="mx-auto flex max-w-[1100px] flex-col gap-6 p-5 lg:p-7">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <Link href="/" className="text-[12.5px] text-ink-2 underline decoration-line underline-offset-2 hover:text-ink">
          ← 새 분석
        </Link>
        <h1 className="text-[17px] font-bold tracking-tight">
          {current.name} <span className="font-mono text-[13px] font-normal text-ink-3">{ticker}</span>
        </h1>
        <span className="text-[12.5px] text-ink-3">분석 {rows.length}회</span>
      </header>

      <section>
        <h2 className="mb-2 text-[12px] font-medium text-ink-2">실행 이력</h2>
        <ul className="flex flex-col gap-px overflow-hidden rounded-lg border border-line bg-line">
          {rows.map((r, i) => (
            <li key={r.id}>
              <Link
                href={`/history/${encodeURIComponent(ticker)}?id=${r.id}`}
                className={`flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-[12.5px] ${
                  i === index ? "bg-raised" : "bg-surface hover:bg-raised"
                }`}
              >
                <span className="tabular font-mono text-ink-3">{r.created_at}</span>
                <span className="tabular font-mono">
                  현재가 {r.price.toLocaleString("ko-KR")} · 목표 {r.target_price.toLocaleString("ko-KR")}
                </span>
                {r.web_search_enabled === 1 && (
                  <span className="rounded bg-keep-soft px-1.5 py-0.5 text-[10.5px] font-semibold text-keep">
                    웹검색
                  </span>
                )}
                {i === index && (
                  <span className="ml-auto text-[11px] font-semibold text-ink-2">보는 중</span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {previous && (
        <section>
          <h2 className="mb-2 text-[12px] font-medium text-ink-2">
            직전 분석({previous.created_at}) 대비 변경
          </h2>
          {changes ? <DiffList changes={changes} /> : null}
        </section>
      )}

      {result ? (
        <BearCaseView result={result} price={current.price} citations={parseCitations(current)} />
      ) : (
        <p className="rounded-lg border border-attack bg-attack-soft p-4 text-[13px]">
          저장된 결과를 읽을 수 없다.
        </p>
      )}
    </main>
  );
}
