import type Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import {
  anthropic,
  describeApiError,
  emitBearCaseTool,
  MAX_TOKENS,
  MODEL,
  systemPrompt,
  webSearchTool,
} from "@/lib/anthropic";
import {
  failAnalysis,
  findDocumentsByIds,
  finishAnalysis,
  insertAnalysis,
  linkAnalysisDocuments,
  type DocumentRow,
} from "@/lib/db";
import { sse, type AnalyzeEvent, type Citation } from "@/lib/events";
import {
  AnalyzeInput,
  BearCaseResult,
  EMIT_TOOL_NAME,
  findVagueBreakers,
  type AnalyzeInputT,
  type BearCase,
} from "@/lib/schema";

export const runtime = "nodejs";

/** 스키마·개수 위반 시 교정 메시지와 함께 다시 물어보는 횟수. */
const MAX_RETRIES = 1;

/* ------------------------------------------------------------------ */
/* 프롬프트 조립                                                        */
/* ------------------------------------------------------------------ */

function buildUserText(input: AnalyzeInputT, docs: DocumentRow[]): string {
  const upside = ((input.target_price / input.price - 1) * 100).toFixed(1);
  const assumptions = input.bull_assumptions
    .map((a, i) => `${i + 1}. ${a}`)
    .join("\n");
  const attached =
    docs.length > 0
      ? docs.map((d) => `- ${d.filename} (${d.page_count}페이지)`).join("\n")
      : "- 없음";
  const search = input.web_search_enabled
    ? "켜짐. 테제를 깨는 자료를 찾는 데 쓴다."
    : "꺼짐. 검색하지 말 것. 확인이 필요한 수치는 단정하지 말고 thesis_breakers로 넘긴다.";

  return [
    "## 분석 대상",
    `종목명: ${input.name} (${input.ticker})`,
    `현재가: ${input.price.toLocaleString("ko-KR")}원`,
    `사용자 목표주가: ${input.target_price.toLocaleString("ko-KR")}원 (현재가 대비 ${upside}%)`,
    "",
    "## 테제 원문",
    input.thesis,
    "",
    "## 사용자가 명시한 강세 가정",
    assumptions,
    "",
    "## 첨부 문서",
    attached,
    "",
    "## 웹 검색",
    search,
  ].join("\n");
}

function buildFirstMessage(
  input: AnalyzeInputT,
  docs: DocumentRow[],
): Anthropic.MessageParam {
  const content: Anthropic.ContentBlockParam[] = docs.map((d) => ({
    type: "document",
    source: { type: "file", file_id: d.file_id },
    title: d.filename,
  }));
  content.push({ type: "text", text: buildUserText(input, docs) });
  return { role: "user", content };
}

/* ------------------------------------------------------------------ */
/* 응답 블록 해석                                                       */
/* ------------------------------------------------------------------ */

/**
 * 인용 출처를 모은다.
 * `web_search_tool_result.content`는 성공이면 배열, 실패면 에러 객체다.
 * 인덱싱 전에 반드시 분기한다.
 */
function collectCitations(message: Anthropic.Message): Citation[] {
  const out: Citation[] = [];
  for (const block of message.content) {
    if (block.type !== "web_search_tool_result") continue;
    if (!Array.isArray(block.content)) continue; // { error_code: ... }
    for (const r of block.content) {
      if (r.type === "web_search_result") out.push({ url: r.url, title: r.title });
    }
  }
  return out;
}

function findEmitBlock(
  message: Anthropic.Message,
): Anthropic.ToolUseBlock | undefined {
  return message.content.find(
    (b): b is Anthropic.ToolUseBlock =>
      b.type === "tool_use" && b.name === EMIT_TOOL_NAME,
  );
}

function dedupe(citations: Citation[]): Citation[] {
  const seen = new Set<string>();
  return citations.filter((c) =>
    seen.has(c.url) ? false : (seen.add(c.url), true),
  );
}

/* ------------------------------------------------------------------ */
/* 검증                                                                */
/* ------------------------------------------------------------------ */

interface Rejection {
  /** 모델에게 되돌려줄 교정 지시. */
  correction: string;
  /** 사용자/로그용 요약. */
  summary: string;
}

/**
 * `strict: true`는 스키마 적합성만 보장한다.
 * 개수와 thesis_breakers 관측 가능성은 여기서 다시 본다.
 */
function validate(
  raw: unknown,
): { ok: true; value: BearCase } | { ok: false; rejection: Rejection } {
  const parsed = BearCaseResult.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `- ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    return {
      ok: false,
      rejection: {
        correction:
          `제출한 결과가 스키마를 만족하지 못했습니다.\n${issues}\n\n` +
          `위 항목을 고쳐서 ${EMIT_TOOL_NAME}를 다시 한 번 호출하세요.`,
        summary: `스키마 위반:\n${issues}`,
      },
    };
  }

  const vague = findVagueBreakers(parsed.data.thesis_breakers);
  if (vague.length > 0) {
    const list = vague.map((v) => `- "${v}"`).join("\n");
    return {
      ok: false,
      rejection: {
        correction:
          `thesis_breakers에 관측 불가능한 항목이 있습니다.\n${list}\n\n` +
          "각 항목을 임계값이 붙은 수치, 공시·보고서의 특정 항목, 또는 날짜가 있는 " +
          `사건으로 바꿔서 ${EMIT_TOOL_NAME}를 다시 한 번 호출하세요.`,
        summary: `관측 불가능한 thesis_breakers:\n${list}`,
      },
    };
  }

  return { ok: true, value: parsed.data };
}

/* ------------------------------------------------------------------ */
/* 라우트                                                              */
/* ------------------------------------------------------------------ */

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON 본문이 아닙니다." }, { status: 400 });
  }

  const parsed = AnalyzeInput.safeParse(body);
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      fields[issue.path.join(".") || "(root)"] = issue.message;
    }
    return NextResponse.json(
      { error: "입력이 올바르지 않습니다.", fields },
      { status: 400 },
    );
  }
  const input = parsed.data;

  const docs = findDocumentsByIds(input.document_ids);
  if (docs.length !== input.document_ids.length) {
    const found = new Set(docs.map((d) => d.id));
    const missing = input.document_ids.filter((id) => !found.has(id));
    return NextResponse.json(
      { error: `등록되지 않은 문서입니다: ${missing.join(", ")}` },
      { status: 400 },
    );
  }

  // 클라이언트가 요청을 끊으면 API 호출도 같이 끊는다.
  const abort = new AbortController();
  req.signal.addEventListener("abort", () => abort.abort());

  const analysisId = insertAnalysis({
    ticker: input.ticker,
    name: input.name,
    price: input.price,
    target_price: input.target_price,
    thesis: input.thesis,
    bull_assumptions: input.bull_assumptions,
    web_search_enabled: input.web_search_enabled,
    model: MODEL,
  });
  linkAnalysisDocuments(analysisId, input.document_ids);

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (event: AnalyzeEvent) => {
        if (closed) return;
        controller.enqueue(encoder.encode(sse(event)));
      };

      try {
        const client = anthropic();
        const tools: Anthropic.ToolUnion[] = [emitBearCaseTool];
        if (input.web_search_enabled) tools.push(webSearchTool);

        const messages: Anthropic.MessageParam[] = [
          buildFirstMessage(input, docs),
        ];
        const citations: Citation[] = [];

        send({
          type: "status",
          phase: docs.length > 0 ? "reading" : "starting",
          message:
            docs.length > 0
              ? `첨부 문서 ${docs.length}건을 읽는 중`
              : "분석을 시작하는 중",
        });

        let result: BearCase | null = null;
        let lastRejection: Rejection | null = null;
        let usage: Anthropic.Usage | null = null;

        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
          let toolBytes = 0;

          const run = client.messages.stream(
            {
              model: MODEL,
              max_tokens: MAX_TOKENS,
              thinking: { type: "adaptive", display: "summarized" },
              output_config: { effort: "high" },
              system: systemPrompt(),
              tools,
              tool_choice: { type: "auto" },
              messages,
            },
            { signal: abort.signal },
          );

          for await (const event of run) {
            if (event.type === "content_block_start") {
              if (event.content_block.type === "server_tool_use") {
                send({
                  type: "status",
                  phase: "searching",
                  message: "웹에서 반증 자료를 찾는 중",
                });
              } else if (
                event.content_block.type === "tool_use" &&
                event.content_block.name === EMIT_TOOL_NAME
              ) {
                send({
                  type: "status",
                  phase: "drafting",
                  message: "결과를 작성하는 중",
                });
              }
              continue;
            }

            if (event.type !== "content_block_delta") continue;
            switch (event.delta.type) {
              case "thinking_delta":
                send({ type: "thinking", text: event.delta.thinking });
                break;
              case "text_delta":
                send({ type: "text", text: event.delta.text });
                break;
              case "input_json_delta":
                toolBytes += event.delta.partial_json.length;
                send({ type: "progress", bytes: toolBytes });
                break;
            }
          }

          const final = await run.finalMessage();
          usage = final.usage;

          // content를 읽기 전에 거절부터 본다.
          if (final.stop_reason === "refusal") {
            const why = final.stop_details?.explanation ?? "사유가 제공되지 않았습니다.";
            throw new Error(`모델이 요청을 거절했습니다: ${why}`);
          }

          const found = collectCitations(final);
          if (found.length > 0) {
            citations.push(...found);
            send({ type: "citations", citations: dedupe(citations) });
          }

          const emit = findEmitBlock(final);
          if (!emit) {
            lastRejection = {
              correction:
                `${EMIT_TOOL_NAME} 툴을 호출하지 않았습니다. ` +
                "분석 결과를 이 툴의 인자로 넣어 정확히 한 번 호출하세요.",
              summary: `${EMIT_TOOL_NAME} 툴이 호출되지 않았습니다.`,
            };
          } else {
            send({
              type: "status",
              phase: "validating",
              message: "결과를 검증하는 중",
            });
            const checked = validate(emit.input);
            if (checked.ok) {
              result = checked.value;
              break;
            }
            lastRejection = checked.rejection;
          }

          if (attempt === MAX_RETRIES) break;

          send({
            type: "status",
            phase: "retrying",
            message: "결과가 규격을 벗어나 다시 요청하는 중",
          });
          messages.push({ role: "assistant", content: final.content });
          messages.push({ role: "user", content: lastRejection.correction });
        }

        if (!result) {
          throw new Error(
            `재시도 후에도 규격을 만족하지 못했습니다.\n${lastRejection?.summary ?? ""}`,
          );
        }

        send({ type: "status", phase: "saving", message: "결과를 저장하는 중" });
        const finalCitations = dedupe(citations);
        finishAnalysis(analysisId, {
          result,
          citations: finalCitations,
          usage,
        });
        send({
          type: "result",
          analysis_id: analysisId,
          result,
          citations: finalCitations,
        });
      } catch (err) {
        const { message } = describeApiError(err);
        failAnalysis(analysisId, message);
        send({ type: "error", message });
      } finally {
        closed = true;
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // 프록시가 SSE를 버퍼링하지 않게 한다.
      "X-Accel-Buffering": "no",
    },
  });
}
