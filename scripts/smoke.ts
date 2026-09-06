/**
 * 실제 API로만 확인되는 두 가지를 한 번에 태운다.
 *
 *   1. strict 커스텀 툴 + web_search 서버 툴을 같은 요청에 넣어도 받아주는가
 *   2. Files API로 올린 PDF를 file_id로 첨부하면 읽는가
 *
 * 실행:  npm run smoke            (웹서치 켬)
 *        npm run smoke -- --no-search --pdf ./sample.pdf
 *
 * 실제 요금이 나간다. 최소 입력으로 한 번만 호출한다.
 */
import Anthropic, { toFile } from "@anthropic-ai/sdk";
import fs from "node:fs";
import path from "node:path";
import { BearCaseResult, EMIT_TOOL_NAME } from "../lib/schema";
import {
  emitBearCaseTool,
  MAX_TOKENS,
  MODEL,
  systemPrompt,
  webSearchTool,
} from "../lib/anthropic";

// .env.local을 직접 읽는다 (Next 밖에서 도는 스크립트라 자동 로드가 없다).
function loadEnv(): void {
  const file = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}

function ok(label: string) { console.log(`  \x1b[32m✓\x1b[0m ${label}`); }
function bad(label: string) { console.log(`  \x1b[31m✗\x1b[0m ${label}`); }

async function main() {
  loadEnv();
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY가 없습니다. .env.local에 넣으세요.");
    process.exit(1);
  }

  const args = process.argv.slice(2);
  const useSearch = !args.includes("--no-search");
  const pdfArg = args.indexOf("--pdf");
  const pdfPath = pdfArg >= 0 ? args[pdfArg + 1] : undefined;

  const client = new Anthropic();
  const content: Anthropic.ContentBlockParam[] = [];

  if (pdfPath) {
    console.log(`\nPDF 업로드: ${pdfPath}`);
    const uploaded = await client.files.upload({
      file: await toFile(fs.readFileSync(pdfPath), path.basename(pdfPath), {
        type: "application/pdf",
      }),
    });
    ok(`업로드 성공 — file_id ${uploaded.id}`);
    content.push({
      type: "document",
      source: { type: "file", file_id: uploaded.id },
      title: path.basename(pdfPath),
    });
  }

  content.push({
    type: "text",
    text: [
      "## 분석 대상",
      "종목명: 스모크테스트 (TEST)",
      "현재가: 10,000원",
      "사용자 목표주가: 15,000원 (현재가 대비 50.0%)",
      "",
      "## 테제 원문",
      "신제품 출시로 향후 3년간 매출이 두 배가 된다.",
      "",
      "## 사용자가 명시한 강세 가정",
      "1. 신제품 수요가 견조하다\n2. 경쟁사 진입이 늦다\n3. 마진이 유지된다",
      "",
      "## 첨부 문서",
      pdfPath ? `- ${path.basename(pdfPath)}` : "- 없음",
      "",
      "## 웹 검색",
      useSearch ? "켜짐." : "꺼짐. 검색하지 말 것.",
    ].join("\n"),
  });

  const tools: Anthropic.ToolUnion[] = [emitBearCaseTool];
  if (useSearch) tools.push(webSearchTool);

  console.log(
    `\n요청: model=${MODEL} / strict tool=${(emitBearCaseTool as { strict?: boolean }).strict} / web_search=${useSearch}`,
  );

  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    thinking: { type: "adaptive", display: "summarized" },
    output_config: { effort: "high" },
    system: systemPrompt(),
    tools,
    tool_choice: { type: "auto" },
    messages: [{ role: "user", content }],
  });

  let searched = false;
  let readDoc = false;
  for await (const ev of stream) {
    if (
      ev.type === "content_block_start" &&
      ev.content_block.type === "server_tool_use"
    ) {
      searched = true;
    }
    if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
      process.stdout.write(ev.delta.text);
    }
  }

  const final = await stream.finalMessage();
  console.log("\n\n--- 결과 ---");
  ok(`요청이 수락됨 (strict 툴 + ${useSearch ? "web_search" : "툴 없음"} 조합 문제 없음)`);
  console.log(`  stop_reason: ${final.stop_reason}`);

  if (final.stop_reason === "refusal") {
    bad(`거절됨: ${final.stop_details?.explanation ?? "(사유 없음)"}`);
    process.exit(1);
  }

  if (useSearch) (searched ? ok : bad)("web_search 서버 툴이 실제로 돌았다");

  for (const b of final.content) {
    if (b.type === "web_search_tool_result") {
      const n = Array.isArray(b.content) ? b.content.length : 0;
      ok(`web_search_tool_result 수신 — 결과 ${n}건${Array.isArray(b.content) ? "" : " (에러 객체)"}`);
    }
  }
  if (pdfPath) {
    readDoc = final.usage.input_tokens > 3000;
    (readDoc ? ok : bad)(
      `첨부 문서가 입력 토큰에 반영됨 (input_tokens=${final.usage.input_tokens})`,
    );
  }

  const emit = final.content.find(
    (b): b is Anthropic.ToolUseBlock =>
      b.type === "tool_use" && b.name === EMIT_TOOL_NAME,
  );
  if (!emit) {
    bad(`${EMIT_TOOL_NAME} 툴이 호출되지 않았다`);
    process.exit(1);
  }
  ok(`${EMIT_TOOL_NAME} 호출됨`);

  const parsed = BearCaseResult.safeParse(emit.input);
  if (parsed.success) {
    ok("Zod 검증 통과 (개수 제약 포함)");
  } else {
    bad("Zod 검증 실패 — 서버가 재시도를 걸 상황:");
    for (const i of parsed.error.issues) {
      console.log(`      ${i.path.join(".") || "(root)"}: ${i.message}`);
    }
  }

  console.log(
    `\n  usage: in=${final.usage.input_tokens} out=${final.usage.output_tokens}`,
  );
}

main().catch((err) => {
  console.error("\n실패:", err);
  process.exit(1);
});
