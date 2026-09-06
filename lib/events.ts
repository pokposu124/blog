import type { BearCase } from "./schema";

/**
 * 분석 라우트가 SSE로 흘려보내는 이벤트. 서버와 UI가 공유하는 계약이라
 * 서버 전용 모듈(anthropic, db)을 import하지 않는다.
 */

export interface Citation {
  url: string;
  title: string;
}

export type Phase =
  | "starting"
  | "reading"
  | "searching"
  | "drafting"
  | "validating"
  | "retrying"
  | "saving";

export type AnalyzeEvent =
  | { type: "status"; phase: Phase; message: string }
  | { type: "thinking"; text: string }
  | { type: "text"; text: string }
  /** 툴 인자가 흘러 들어오는 중. 누적 바이트 수만 보낸다 (부분 JSON은 파싱할 수 없다). */
  | { type: "progress"; bytes: number }
  | { type: "citations"; citations: Citation[] }
  | { type: "result"; analysis_id: number; result: BearCase; citations: Citation[] }
  | { type: "error"; message: string };

/** SSE 한 줄로 직렬화한다. */
export function sse(event: AnalyzeEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}
