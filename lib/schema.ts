import { z } from "zod";

/**
 * 이 파일이 출력 스키마의 단일 출처다.
 *
 * 여기서 두 가지가 파생된다.
 *  1. `BEAR_CASE_JSON_SCHEMA` — `emit_bear_case` 툴의 `input_schema`
 *  2. `BearCaseResult`        — 서버에서 결과를 다시 검증하는 Zod 스키마
 *
 * 둘을 나눈 이유: strict tool의 JSON Schema는 배열 개수를 강제하지 못한다
 * (`minItems`는 0/1만, `maxItems`는 미지원). 그래서 "정확히 3개" 같은 제약은
 * JSON Schema에서 빼고 Zod 쪽에만 얹는다. 필드 구성 자체는 아래 `shape` 하나뿐이다.
 */

/** 영향이 나타나기까지 걸리는 시간. 히스토리 diff에서 비교 가능하도록 이산값으로 고정한다. */
export const YEARS_TO_IMPACT = ["<1y", "1-2y", "2-3y", "3-5y", ">5y"] as const;

export const CollapseScenario = z.strictObject({
  trigger: z
    .string()
    .describe("붕괴를 촉발하는 구체적 사건. 관측 가능한 형태로 쓴다."),
  mechanism: z
    .string()
    .describe(
      "촉발 사건이 실적·현금흐름·멀티플로 전달되는 경로. 인과를 단계로 서술한다.",
    ),
  years_to_impact: z
    .enum(YEARS_TO_IMPACT)
    .describe("촉발 사건이 실적에 반영되기까지의 시간 구간."),
  leading_indicators: z
    .array(z.string())
    .describe(
      "이 시나리오가 진행 중임을 먼저 알려주는 선행 지표. 각 항목은 확인 가능한 수치·공시·일정이어야 한다.",
    ),
});

export const MoatErosion = z.strictObject({
  tech_substitution: z
    .string()
    .describe("기술 대체로 해자가 무너지는 경로. 대체재와 전환 비용을 명시한다."),
  regulatory: z
    .string()
    .describe("규제·정책 변화가 해자를 깎는 경로. 해당 규제와 시행 시점을 명시한다."),
  demand_shift: z
    .string()
    .describe("수요 구조 변화가 해자를 깎는 경로. 어떤 수요가 어디로 옮겨가는지 쓴다."),
  customer_concentration: z
    .string()
    .describe("고객 집중도에서 오는 취약성. 주요 고객의 이탈·단가 인하 협상력을 다룬다."),
});

export const ValuationAttack = z.strictObject({
  assumption: z
    .string()
    .describe("현재 밸류에이션이 암묵적으로 깔고 있는 가정 하나."),
  why_fragile: z
    .string()
    .describe("그 가정이 깨지기 쉬운 이유. 반증 가능한 근거를 든다."),
  downside_case_value: z
    .number()
    .int()
    .describe(
      "그 가정이 깨졌을 때의 주당 가치. 원 단위 정수로만 쓴다. 범위나 통화 기호를 넣지 않는다.",
    ),
});

/** 필드 구성의 단일 출처. 개수 제약은 여기 넣지 않는다. */
const shape = {
  collapse_scenarios: z
    .array(CollapseScenario)
    .describe("서로 독립적인 붕괴 시나리오. 정확히 3개."),
  moat_erosion: MoatErosion.describe("해자 침식 경로를 네 축으로 나눠 평가한다."),
  valuation_attack: z
    .array(ValuationAttack)
    .describe("밸류에이션이 깔고 있는 취약한 가정. 정확히 3개."),
  thesis_breakers: z
    .array(z.string())
    .describe(
      "이것이 확인되면 강세 테제를 접어야 하는 사건. 수치·공시 항목·발표 일정처럼 " +
        "관측 가능한 것만 쓴다. 심리·정서·기대감 같은 표현은 금지.",
    ),
  what_the_short_knows: z
    .array(z.string())
    .describe("공매도 측이 보고 있으나 강세론자가 대체로 놓치는 사실."),
};

/** JSON Schema 파생용 (개수 제약 없음). */
const BearCaseShape = z.strictObject(shape);

/** 서버 검증용 (개수 제약 포함). */
export const BearCaseResult = z.strictObject({
  ...shape,
  collapse_scenarios: z.array(CollapseScenario).length(3),
  valuation_attack: z.array(ValuationAttack).length(3),
  thesis_breakers: z.array(z.string()).min(1),
  what_the_short_knows: z.array(z.string()).min(1),
});

export type BearCase = z.infer<typeof BearCaseResult>;
export type CollapseScenarioT = z.infer<typeof CollapseScenario>;
export type ValuationAttackT = z.infer<typeof ValuationAttack>;

/**
 * 툴 스키마가 지원하지 않는 JSON Schema 키워드.
 *
 * 수치 제약(minimum/maximum/multipleOf), 문자열 길이 제약, 그리고 `minItems: 0|1`을
 * 넘어서는 배열 제약은 받지 않는다. Zod의 `.int()`가 안전 정수 범위를
 * minimum/maximum으로 뱉기 때문에 그대로 넘기면 스키마가 거부된다.
 */
const UNSUPPORTED_KEYWORDS = [
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minLength",
  "maxLength",
  "maxItems",
] as const;

function stripUnsupported(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(stripUnsupported);
  if (node === null || typeof node !== "object") return node;

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if ((UNSUPPORTED_KEYWORDS as readonly string[]).includes(key)) continue;
    // minItems는 0 또는 1만 허용된다.
    if (key === "minItems" && typeof value === "number" && value > 1) continue;
    out[key] = stripUnsupported(value);
  }
  return out;
}

/**
 * `emit_bear_case` 툴에 넘길 JSON Schema.
 * `$schema` 키는 Anthropic 툴 스키마에 필요 없으므로 떼어낸다.
 */
export const BEAR_CASE_JSON_SCHEMA = (() => {
  const { $schema: _drop, ...rest } = z.toJSONSchema(BearCaseShape, {
    io: "input",
  }) as Record<string, unknown>;
  return stripUnsupported(rest) as Record<string, unknown>;
})();

export const EMIT_TOOL_NAME = "emit_bear_case";

/* ------------------------------------------------------------------ */
/* 입력 스키마                                                          */
/* ------------------------------------------------------------------ */

export const AnalyzeInput = z.strictObject({
  ticker: z.string().trim().min(1, "종목 코드를 입력하세요."),
  name: z.string().trim().min(1, "종목명을 입력하세요."),
  price: z.number().int().positive("현재가는 0보다 큰 정수여야 합니다."),
  target_price: z
    .number()
    .int()
    .positive("목표주가는 0보다 큰 정수여야 합니다."),
  thesis: z.string().trim().min(1, "테제 원문을 입력하세요."),
  bull_assumptions: z
    .array(z.string().trim().min(1))
    .length(3, "강세 가정은 정확히 3개여야 합니다."),
  document_ids: z.array(z.number().int().positive()).default([]),
  web_search_enabled: z.boolean().default(false),
});

export type AnalyzeInputT = z.infer<typeof AnalyzeInput>;

/* ------------------------------------------------------------------ */
/* thesis_breakers 관측 가능성 휴리스틱                                  */
/* ------------------------------------------------------------------ */

/**
 * 관측 불가능한 서술을 걸러내기 위한 표현 목록.
 * 프롬프트에서 이미 금지하지만, 서버에서 한 번 더 거른다.
 */
const VAGUE_TERMS = [
  "심리",
  "정서",
  "기대감",
  "분위기",
  "센티먼트",
  "sentiment",
  "모멘텀",
  "투자자 신뢰",
  "인식 변화",
  "우려가 커지",
  "관심이 줄",
];

/** 관측 가능해 보이지 않는 thesis_breakers 항목을 돌려준다. 비어 있으면 통과다. */
export function findVagueBreakers(breakers: readonly string[]): string[] {
  return breakers.filter((b) => {
    const lower = b.toLowerCase();
    return VAGUE_TERMS.some((t) => lower.includes(t.toLowerCase()));
  });
}
