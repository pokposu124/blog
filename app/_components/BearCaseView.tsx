import type { Citation } from "@/lib/events";
import { YEARS_LABEL, type BearCase } from "@/lib/schema";

/** 상호작용이 없어 서버·클라이언트 양쪽에서 쓴다. */

function Section({
  n,
  title,
  note,
  children,
}: {
  n: string;
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-t border-line pt-5">
      <div className="mb-3 flex items-baseline gap-3">
        <span className="font-mono text-[11px] tracking-widest text-ink-3">{n}</span>
        <h2 className="text-[15px] font-bold tracking-tight">{title}</h2>
        {note && <span className="text-xs text-ink-3">{note}</span>}
      </div>
      {children}
    </section>
  );
}

export function BearCaseView({
  result,
  price,
  citations,
}: {
  result: BearCase;
  price: number;
  citations?: Citation[];
}) {
  return (
    <div className="flex flex-col gap-7">
      <Section n="01" title="붕괴 시나리오" note="서로 독립적인 세 경로">
        <div className="grid gap-3 lg:grid-cols-3">
          {result.collapse_scenarios.map((s, i) => (
            <article
              key={i}
              className="flex flex-col gap-2.5 rounded-lg border border-line bg-surface p-4"
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-[11px] text-ink-3">S{i + 1}</span>
                <span className="rounded bg-raised px-2 py-0.5 text-[11px] text-ink-2">
                  {YEARS_LABEL[s.years_to_impact]}
                </span>
              </div>
              <h3 className="text-[13.5px] font-semibold leading-snug">{s.trigger}</h3>
              <p className="text-[13px] leading-relaxed text-ink-2">{s.mechanism}</p>
              <div className="mt-1 border-t border-line-2 pt-2.5">
                <div className="mb-1.5 text-[11px] font-medium tracking-wide text-ink-3">
                  선행 지표
                </div>
                <ul className="flex flex-col gap-1.5">
                  {s.leading_indicators.map((ind, j) => (
                    <li key={j} className="flex gap-2 text-[12.5px] leading-snug text-ink-2">
                      <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-ink-3" />
                      {ind}
                    </li>
                  ))}
                </ul>
              </div>
            </article>
          ))}
        </div>
      </Section>

      <Section n="02" title="해자 침식">
        <div className="grid gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-2">
          {(
            [
              ["기술 대체", result.moat_erosion.tech_substitution],
              ["규제", result.moat_erosion.regulatory],
              ["수요 이동", result.moat_erosion.demand_shift],
              ["고객 집중", result.moat_erosion.customer_concentration],
            ] as const
          ).map(([label, text]) => (
            <div key={label} className="bg-surface p-4">
              <div className="mb-1.5 text-[11px] font-medium tracking-wide text-ink-3">
                {label}
              </div>
              <p className="text-[13px] leading-relaxed text-ink-2">{text}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section n="03" title="밸류에이션 공격" note={`현재가 ${price.toLocaleString("ko-KR")}원 대비`}>
        <div className="flex flex-col gap-px overflow-hidden rounded-lg border border-line bg-line">
          {result.valuation_attack.map((v, i) => {
            const drop = (v.downside_case_value / price - 1) * 100;
            return (
              <div key={i} className="grid gap-3 bg-surface p-4 sm:grid-cols-[1fr_auto]">
                <div>
                  <h3 className="mb-1.5 text-[13.5px] font-semibold leading-snug">
                    {v.assumption}
                  </h3>
                  <p className="text-[13px] leading-relaxed text-ink-2">{v.why_fragile}</p>
                </div>
                <div className="flex shrink-0 flex-row items-baseline gap-3 sm:flex-col sm:items-end sm:gap-0.5">
                  <div className="tabular font-mono text-lg font-semibold text-attack">
                    {v.downside_case_value.toLocaleString("ko-KR")}
                    <span className="ml-0.5 text-xs font-normal">원</span>
                  </div>
                  <div className="tabular font-mono text-xs text-ink-3">
                    {drop > 0 ? "+" : ""}
                    {drop.toFixed(1)}%
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </Section>

      <Section n="04" title="테제 붕괴 신호" note="이게 확인되면 접는다">
        <ul className="flex flex-col gap-px overflow-hidden rounded-lg border border-line bg-line">
          {result.thesis_breakers.map((b, i) => (
            <li key={i} className="flex items-start gap-3 bg-surface px-4 py-3">
              <span className="tabular mt-px shrink-0 font-mono text-[11px] text-ink-3">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className="text-[13.5px] leading-snug">{b}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section n="05" title="공매도가 아는 것">
        <ul className="flex flex-col gap-2">
          {result.what_the_short_knows.map((w, i) => (
            <li
              key={i}
              className="border-l-2 border-attack bg-attack-soft px-3.5 py-2.5 text-[13.5px] leading-relaxed"
            >
              {w}
            </li>
          ))}
        </ul>
      </Section>

      {citations && citations.length > 0 && (
        <Section n="—" title="출처" note={`${citations.length}건`}>
          <ol className="flex flex-col gap-1.5">
            {citations.map((c, i) => (
              <li key={i} className="flex gap-2.5 text-[12.5px] leading-snug">
                <span className="tabular font-mono text-ink-3">{i + 1}</span>
                <a
                  href={c.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-ink-2 underline decoration-line underline-offset-2 hover:text-ink"
                >
                  {c.title || c.url}
                </a>
              </li>
            ))}
          </ol>
        </Section>
      )}
    </div>
  );
}
