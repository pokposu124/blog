import Anthropic from "@anthropic-ai/sdk";
import fs from "node:fs";
import path from "node:path";
import { BEAR_CASE_JSON_SCHEMA, EMIT_TOOL_NAME } from "./schema.ts";

/**
 * Anthropic 클라이언트와 모델/툴 상수. **서버에서만** import한다.
 * 클라이언트 컴포넌트에서 이 모듈을 부르면 키가 번들에 실린다.
 */

export const MODEL = "claude-opus-5";

/** 스트리밍이므로 넉넉히 잡는다. */
export const MAX_TOKENS = 64_000;

/**
 * 거절 시 서버사이드 폴백. 끔.
 * 켜려면 client.beta.messages.* 경로 + betas: ["server-side-fallback-2026-07-01"]
 * + fallbacks: "default" 로 바꿔야 한다.
 */
export const ENABLE_REFUSAL_FALLBACK = false;

/** 자체 규칙. API 한도(600p)보다 좁게 잡아 분석 품질을 지킨다. */
export const MAX_PDF_PAGES = 100;

const globalForClient = globalThis as unknown as { __anthropic?: Anthropic };

export function anthropic(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      "ANTHROPIC_API_KEY가 없습니다. .env.local에 키를 넣고 dev 서버를 다시 시작하세요.",
    );
  }
  if (!globalForClient.__anthropic) globalForClient.__anthropic = new Anthropic();
  return globalForClient.__anthropic;
}

/** 프롬프트 본문은 코드가 아니라 이 파일에서 온다. */
export function systemPrompt(): string {
  return fs.readFileSync(
    path.join(process.cwd(), "prompts", "bear-case.md"),
    "utf8",
  );
}

/**
 * 결과를 받아내는 유일한 통로.
 * `strict: true`는 스키마 적합성만 보장한다 — 배열 개수는 서버에서 Zod로 다시 검증한다.
 */
export const emitBearCaseTool = {
  name: EMIT_TOOL_NAME,
  description:
    "약세 분석이 끝났을 때 결과를 제출한다. 분석당 정확히 한 번만 호출한다.",
  strict: true,
  input_schema: BEAR_CASE_JSON_SCHEMA,
} as unknown as Anthropic.Tool;

/** 웹서치가 켜졌을 때만 tools 배열에 더한다. */
export const webSearchTool = {
  type: "web_search_20260209",
  name: "web_search",
  max_uses: 8,
} as unknown as Anthropic.ToolUnion;

/** 라우트에서 그대로 쓸 수 있게 API 에러를 사용자용 메시지로 옮긴다. */
export function describeApiError(err: unknown): { status: number; message: string } {
  if (err instanceof Anthropic.BadRequestError) {
    return { status: 400, message: `요청이 거부되었습니다: ${err.message}` };
  }
  if (err instanceof Anthropic.AuthenticationError) {
    return { status: 401, message: "ANTHROPIC_API_KEY가 유효하지 않습니다." };
  }
  if (err instanceof Anthropic.RateLimitError) {
    return { status: 429, message: "레이트 리밋에 걸렸습니다. 잠시 후 다시 시도하세요." };
  }
  if (err instanceof Anthropic.APIError) {
    return { status: err.status ?? 500, message: `API 오류 ${err.status}: ${err.message}` };
  }
  return { status: 500, message: err instanceof Error ? err.message : String(err) };
}
