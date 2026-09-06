"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { BearCaseView } from "./_components/BearCaseView";
import type { AnalyzeEvent, Citation, Phase } from "@/lib/events";
import type { BearCase } from "@/lib/schema";

interface Doc {
  id: number;
  filename: string;
  page_count: number;
  reused: boolean;
}

const PHASE_LABEL: Record<Phase, string> = {
  starting: "시작",
  reading: "문서 읽는 중",
  searching: "검색 중",
  drafting: "작성 중",
  validating: "검증 중",
  retrying: "재요청",
  saving: "저장 중",
};

const field =
  "w-full rounded-md border border-line bg-surface px-3 py-2 text-[13.5px] " +
  "placeholder:text-ink-3 focus:border-ink-3 focus:outline-none focus:ring-2 focus:ring-line";
const label = "mb-1.5 block text-[12px] font-medium text-ink-2";

export default function Home() {
  const [ticker, setTicker] = useState("");
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [targetPrice, setTargetPrice] = useState("");
  const [thesis, setThesis] = useState("");
  const [bulls, setBulls] = useState(["", "", ""]);
  const [webSearch, setWebSearch] = useState(false);

  const [docs, setDocs] = useState<Doc[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string[]>([]);

  const [running, setRunning] = useState(false);
  const [phase, setPhase] = useState<Phase | null>(null);
  const [log, setLog] = useState("");
  const [bytes, setBytes] = useState(0);
  const [citations, setCitations] = useState<Citation[]>([]);
  const [result, setResult] = useState<BearCase | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const abortRef = useRef<AbortController | null>(null);

  async function upload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    setUploadError([]);
    const body = new FormData();
    for (const f of Array.from(files)) body.append("files", f);
    try {
      const res = await fetch("/api/documents", { method: "POST", body });
      const json = await res.json();
      if (!res.ok) {
        const perFile: string[] = (json.files ?? []).map(
          (f: { filename: string; message: string }) => `${f.filename} — ${f.message}`,
        );
        setUploadError(perFile.length > 0 ? perFile : [json.error ?? "업로드 실패"]);
        return;
      }
      setDocs((prev) => {
        const seen = new Set(prev.map((d) => d.id));
        return [...prev, ...json.documents.filter((d: Doc) => !seen.has(d.id))];
      });
    } catch (e) {
      setUploadError([e instanceof Error ? e.message : String(e)]);
    } finally {
      setUploading(false);
    }
  }

  function apply(ev: AnalyzeEvent) {
    switch (ev.type) {
      case "status":
        setPhase(ev.phase);
        break;
      case "thinking":
      case "text":
        setLog((l) => (l + ev.text).slice(-4000));
        break;
      case "progress":
        setBytes(ev.bytes);
        break;
      case "citations":
        setCitations(ev.citations);
        break;
      case "result":
        setResult(ev.result);
        setCitations(ev.citations);
        setPhase(null);
        break;
      case "error":
        setError(ev.message);
        setPhase(null);
        break;
    }
  }

  async function run(e: React.FormEvent) {
    e.preventDefault();
    setRunning(true);
    setResult(null);
    setError(null);
    setFieldErrors({});
    setCitations([]);
    setLog("");
    setBytes(0);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          ticker: ticker.trim(),
          name: name.trim(),
          price: Number(price),
          target_price: Number(targetPrice),
          thesis: thesis.trim(),
          bull_assumptions: bulls.map((b) => b.trim()),
          document_ids: docs.map((d) => d.id),
          web_search_enabled: webSearch,
        }),
      });

      if (!res.ok || !res.body) {
        const json = await res.json().catch(() => ({}));
        setFieldErrors(json.fields ?? {});
        setError(json.error ?? `요청이 실패했습니다 (HTTP ${res.status}).`);
        return;
      }

      // POST 본문이 필요해 EventSource를 못 쓴다. 스트림을 직접 읽는다.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const chunks = buf.split("\n\n");
        buf = chunks.pop() ?? "";
        for (const chunk of chunks) {
          const line = chunk.trim();
          if (!line.startsWith("data:")) continue;
          try {
            apply(JSON.parse(line.slice(5)) as AnalyzeEvent);
          } catch {
            /* 잘린 프레임은 버린다 */
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  }

  const upside =
    price && targetPrice && Number(price) > 0
      ? ((Number(targetPrice) / Number(price) - 1) * 100).toFixed(1)
      : null;

  return (
    <main className="mx-auto grid max-w-[1400px] gap-6 p-5 lg:grid-cols-[minmax(340px,400px)_minmax(0,1fr)] lg:p-7">
      {/* ---------------- 입력 ---------------- */}
      <form onSubmit={run} className="flex flex-col gap-4 lg:sticky lg:top-7 lg:self-start">
        <header>
          <h1 className="text-[17px] font-bold tracking-tight">투자 테제 반박</h1>
          <p className="mt-1 text-[12.5px] leading-relaxed text-ink-2">
            강세 테제를 넣으면 그 테제를 무너뜨리는 논거만 돌려준다.
          </p>
        </header>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={label} htmlFor="ticker">종목 코드</label>
            <input id="ticker" className={field} value={ticker}
              onChange={(e) => setTicker(e.target.value)} placeholder="005930" />
            {fieldErrors.ticker && <p className="mt-1 text-[11.5px] text-attack">{fieldErrors.ticker}</p>}
          </div>
          <div>
            <label className={label} htmlFor="name">종목명</label>
            <input id="name" className={field} value={name}
              onChange={(e) => setName(e.target.value)} placeholder="삼성전자" />
            {fieldErrors.name && <p className="mt-1 text-[11.5px] text-attack">{fieldErrors.name}</p>}
          </div>
          <div>
            <label className={label} htmlFor="price">현재가 (원)</label>
            <input id="price" inputMode="numeric" className={`${field} tabular font-mono`}
              value={price} onChange={(e) => setPrice(e.target.value.replace(/[^0-9]/g, ""))} />
            {fieldErrors.price && <p className="mt-1 text-[11.5px] text-attack">{fieldErrors.price}</p>}
          </div>
          <div>
            <label className={label} htmlFor="target">내 목표주가 (원)</label>
            <input id="target" inputMode="numeric" className={`${field} tabular font-mono`}
              value={targetPrice} onChange={(e) => setTargetPrice(e.target.value.replace(/[^0-9]/g, ""))} />
            {upside && <p className="mt-1 text-[11.5px] text-ink-3">상승여력 {upside}%</p>}
            {fieldErrors.target_price && <p className="mt-1 text-[11.5px] text-attack">{fieldErrors.target_price}</p>}
          </div>
        </div>

        <div>
          <label className={label} htmlFor="thesis">테제 원문</label>
          <textarea id="thesis" rows={6} className={`${field} resize-y leading-relaxed`}
            value={thesis} onChange={(e) => setThesis(e.target.value)}
            placeholder="이 종목을 사는 이유를 그대로 붙여넣는다." />
          {fieldErrors.thesis && <p className="mt-1 text-[11.5px] text-attack">{fieldErrors.thesis}</p>}
        </div>

        <div>
          <label className={label}>강세 가정 3개</label>
          <div className="flex flex-col gap-2">
            {bulls.map((b, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="tabular w-4 shrink-0 font-mono text-[11px] text-ink-3">{i + 1}</span>
                <input className={field} value={b}
                  onChange={(e) => setBulls((prev) => prev.map((v, j) => (j === i ? e.target.value : v)))} />
              </div>
            ))}
          </div>
          {fieldErrors.bull_assumptions && (
            <p className="mt-1 text-[11.5px] text-attack">{fieldErrors.bull_assumptions}</p>
          )}
        </div>

        <div>
          <label className={label} htmlFor="pdfs">사업보고서 등 PDF (100페이지 이하)</label>
          <input id="pdfs" type="file" accept="application/pdf" multiple disabled={uploading}
            onChange={(e) => { void upload(e.target.files); e.target.value = ""; }}
            className="w-full text-[12.5px] text-ink-2 file:mr-3 file:rounded-md file:border file:border-line
                       file:bg-raised file:px-3 file:py-1.5 file:text-[12.5px] file:text-ink" />
          {uploading && <p className="mt-1.5 text-[11.5px] text-ink-3">업로드 중…</p>}
          {uploadError.map((m, i) => (
            <p key={i} className="mt-1.5 text-[11.5px] leading-snug text-attack">{m}</p>
          ))}
          {docs.length > 0 && (
            <ul className="mt-2 flex flex-col gap-1">
              {docs.map((d) => (
                <li key={d.id} className="flex items-center gap-2 rounded border border-line bg-surface px-2.5 py-1.5 text-[12px]">
                  <span className="truncate">{d.filename}</span>
                  <span className="tabular ml-auto shrink-0 font-mono text-[11px] text-ink-3">{d.page_count}p</span>
                  {d.reused && (
                    <span className="shrink-0 rounded bg-raised px-1.5 py-0.5 text-[10.5px] text-ink-3">재사용</span>
                  )}
                  <button type="button" aria-label={`${d.filename} 제외`}
                    onClick={() => setDocs((prev) => prev.filter((x) => x.id !== d.id))}
                    className="shrink-0 text-ink-3 hover:text-attack">✕</button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <label className="flex cursor-pointer items-center gap-2.5 rounded-md border border-line bg-surface px-3 py-2.5">
          <input type="checkbox" checked={webSearch} onChange={(e) => setWebSearch(e.target.checked)} />
          <span className="text-[13px]">웹 검색으로 반증 자료 찾기</span>
          <span className="ml-auto font-mono text-[11px] text-ink-3">최대 8회</span>
        </label>

        <button type="submit" disabled={running}
          className="rounded-md bg-ink px-4 py-2.5 text-[13.5px] font-semibold text-surface
                     disabled:opacity-45">
          {running ? "분석 중…" : "테제 반박하기"}
        </button>

        {ticker.trim() && (
          <Link href={`/history/${encodeURIComponent(ticker.trim())}`}
            className="text-center text-[12.5px] text-ink-2 underline decoration-line underline-offset-2 hover:text-ink">
            {ticker.trim()} 히스토리 보기 →
          </Link>
        )}
      </form>

      {/* ---------------- 결과 ---------------- */}
      <div className="min-w-0">
        {error && (
          <div className="mb-5 rounded-lg border border-attack bg-attack-soft p-4">
            <div className="mb-1 text-[12px] font-semibold text-attack">분석 실패</div>
            <p className="whitespace-pre-wrap text-[13px] leading-relaxed">{error}</p>
          </div>
        )}

        {running && (
          <div className="mb-5 rounded-lg border border-line bg-surface p-4">
            <div className="flex items-center gap-2.5">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-attack" />
              <span className="text-[13px] font-medium">
                {phase ? PHASE_LABEL[phase] : "연결 중"}
              </span>
              {bytes > 0 && (
                <span className="tabular ml-auto font-mono text-[11px] text-ink-3">
                  {bytes.toLocaleString("ko-KR")}B 수신
                </span>
              )}
            </div>
            {log && (
              <pre className="mt-3 max-h-44 overflow-y-auto whitespace-pre-wrap border-t border-line-2 pt-3
                              text-[11.5px] leading-relaxed text-ink-3">{log}</pre>
            )}
          </div>
        )}

        {result && <BearCaseView result={result} price={Number(price)} citations={citations} />}

        {!result && !running && !error && (
          <div className="rounded-lg border border-dashed border-line p-10 text-center text-[13px] text-ink-3">
            왼쪽에 테제를 넣고 실행하면 결과가 여기 표시된다.
          </div>
        )}
      </div>
    </main>
  );
}
