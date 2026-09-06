"use client";

import { useEffect, useState } from "react";

/**
 * thesis_breakers 확인 목록.
 *
 * 확인 상태는 종목 + 신호 문구에 묶여 저장된다. 분석을 다시 돌려도 같은 문구의
 * 신호면 표시가 유지된다.
 */
export function BreakerChecklist({
  ticker,
  breakers,
  initialChecks,
}: {
  ticker: string;
  breakers: readonly string[];
  /** 서버에서 미리 읽어 넘기면 첫 렌더에 깜빡임이 없다. 없으면 마운트 후 가져온다. */
  initialChecks?: Record<string, string>;
}) {
  const [checks, setChecks] = useState<Record<string, string>>(
    initialChecks ?? {},
  );
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialChecks || !ticker) return;
    let alive = true;
    void (async () => {
      try {
        const res = await fetch(
          `/api/breakers?ticker=${encodeURIComponent(ticker)}`,
        );
        if (!res.ok) return;
        const json = await res.json();
        if (alive) setChecks(json.checks ?? {});
      } catch {
        /* 확인 상태를 못 읽어도 목록 자체는 보여준다 */
      }
    })();
    return () => {
      alive = false;
    };
  }, [ticker, initialChecks]);

  async function toggle(breaker: string, next: boolean) {
    const previous = checks;
    // 낙관적으로 먼저 반영하고, 실패하면 되돌린다.
    setChecks((c) => {
      const copy = { ...c };
      if (next) copy[breaker] = "저장 중";
      else delete copy[breaker];
      return copy;
    });
    setPending((p) => new Set(p).add(breaker));
    setError(null);

    try {
      const res = await fetch("/api/breakers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker, breaker, checked: next }),
      });
      if (!res.ok) throw new Error(`저장 실패 (HTTP ${res.status})`);
      const json = await res.json();
      setChecks((c) => {
        const copy = { ...c };
        if (json.checked_at) copy[breaker] = json.checked_at;
        else delete copy[breaker];
        return copy;
      });
    } catch (e) {
      setChecks(previous);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending((p) => {
        const copy = new Set(p);
        copy.delete(breaker);
        return copy;
      });
    }
  }

  const done = breakers.filter((b) => b in checks).length;

  return (
    <div>
      <ul className="flex flex-col gap-px overflow-hidden rounded-lg border border-line bg-line">
        {breakers.map((b, i) => {
          const at = checks[b];
          const isChecked = at !== undefined;
          const id = `breaker-${i}`;
          return (
            <li key={b} className="bg-surface">
              <label
                htmlFor={id}
                className="flex cursor-pointer items-start gap-3 px-4 py-3"
              >
                <input
                  id={id}
                  type="checkbox"
                  checked={isChecked}
                  disabled={pending.has(b)}
                  onChange={(e) => void toggle(b, e.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-attack)]"
                />
                <span
                  className={`text-[13.5px] leading-snug ${
                    isChecked ? "text-ink-3 line-through decoration-line" : ""
                  }`}
                >
                  {b}
                </span>
                {isChecked && (
                  <span className="tabular ml-auto shrink-0 self-center font-mono text-[11px] text-ink-3">
                    {at === "저장 중" ? "…" : `확인 ${at.slice(0, 10)}`}
                  </span>
                )}
              </label>
            </li>
          );
        })}
      </ul>
      <div className="mt-2 flex items-center gap-3">
        <span className="tabular font-mono text-[11.5px] text-ink-3">
          {done} / {breakers.length} 확인됨
        </span>
        {error && <span className="text-[11.5px] text-attack">{error}</span>}
      </div>
    </div>
  );
}
