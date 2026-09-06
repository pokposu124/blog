import { YEARS_LABEL, type BearCase } from "./schema";

/**
 * 같은 종목의 두 분석 결과를 필드 단위로 비교한다.
 *
 * 배열 중 개수가 고정된 것(collapse_scenarios, valuation_attack)은 순서를 의미로
 * 보고 인덱스끼리 맞춘다. 자유 길이 문자열 배열은 집합으로 보고 추가/삭제만 낸다.
 */

export type Change =
  | { kind: "added"; path: string; value: string }
  | { kind: "removed"; path: string; value: string }
  | { kind: "changed"; path: string; before: string; after: string };

function cmpField(
  path: string,
  before: string,
  after: string,
  out: Change[],
): void {
  if (before !== after) out.push({ kind: "changed", path, before, after });
}

function cmpStringSet(
  path: string,
  before: readonly string[],
  after: readonly string[],
  out: Change[],
): void {
  const b = new Set(before);
  const a = new Set(after);
  for (const v of after) if (!b.has(v)) out.push({ kind: "added", path, value: v });
  for (const v of before) if (!a.has(v)) out.push({ kind: "removed", path, value: v });
}

export function diffBearCase(before: BearCase, after: BearCase): Change[] {
  const out: Change[] = [];

  const n = Math.max(
    before.collapse_scenarios.length,
    after.collapse_scenarios.length,
  );
  for (let i = 0; i < n; i++) {
    const b = before.collapse_scenarios[i];
    const a = after.collapse_scenarios[i];
    const path = `붕괴 시나리오 ${i + 1}`;
    if (!b && a) {
      out.push({ kind: "added", path, value: a.trigger });
      continue;
    }
    if (b && !a) {
      out.push({ kind: "removed", path, value: b.trigger });
      continue;
    }
    if (!b || !a) continue;
    cmpField(`${path} · 촉발`, b.trigger, a.trigger, out);
    cmpField(`${path} · 경로`, b.mechanism, a.mechanism, out);
    cmpField(
      `${path} · 시점`,
      YEARS_LABEL[b.years_to_impact],
      YEARS_LABEL[a.years_to_impact],
      out,
    );
    cmpStringSet(`${path} · 선행지표`, b.leading_indicators, a.leading_indicators, out);
  }

  const moatLabels: Record<keyof BearCase["moat_erosion"], string> = {
    tech_substitution: "해자 · 기술 대체",
    regulatory: "해자 · 규제",
    demand_shift: "해자 · 수요 이동",
    customer_concentration: "해자 · 고객 집중",
  };
  for (const key of Object.keys(moatLabels) as (keyof BearCase["moat_erosion"])[]) {
    cmpField(moatLabels[key], before.moat_erosion[key], after.moat_erosion[key], out);
  }

  const m = Math.max(
    before.valuation_attack.length,
    after.valuation_attack.length,
  );
  for (let i = 0; i < m; i++) {
    const b = before.valuation_attack[i];
    const a = after.valuation_attack[i];
    const path = `밸류에이션 공격 ${i + 1}`;
    if (!b && a) {
      out.push({ kind: "added", path, value: a.assumption });
      continue;
    }
    if (b && !a) {
      out.push({ kind: "removed", path, value: b.assumption });
      continue;
    }
    if (!b || !a) continue;
    cmpField(`${path} · 가정`, b.assumption, a.assumption, out);
    cmpField(`${path} · 취약한 이유`, b.why_fragile, a.why_fragile, out);
    cmpField(
      `${path} · 하방 가치`,
      `${b.downside_case_value.toLocaleString("ko-KR")}원`,
      `${a.downside_case_value.toLocaleString("ko-KR")}원`,
      out,
    );
  }

  cmpStringSet("테제 붕괴 신호", before.thesis_breakers, after.thesis_breakers, out);
  cmpStringSet(
    "공매도가 아는 것",
    before.what_the_short_knows,
    after.what_the_short_knows,
    out,
  );

  return out;
}
