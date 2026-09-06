/**
 * 개발용 가짜 Anthropic 서버.
 *
 * `ANTHROPIC_BASE_URL`을 여기로 돌리면 API 요금 없이 앱 전체를 돌려볼 수 있다.
 * 업로드 → 스트리밍 → 검증/재시도 → 저장 → 히스토리 diff까지 전부 실제 코드를 탄다.
 *
 *   터미널 1:  npm run mock
 *   터미널 2:  ANTHROPIC_API_KEY=mock ANTHROPIC_BASE_URL=http://localhost:4010 npm run dev
 *
 * 종목 코드로 예외 경로를 부른다. 그 외에는 정상 결과를 돌려준다.
 *
 *   RETRY   1차 응답이 규격 위반(시나리오 2개 + 관측 불가능한 신호) → 재시도 경로
 *   SEARCH  검색 실패 블록을 섞어 보냄 (content가 배열이 아니라 에러 객체인 분기)
 *   REFUSE  stop_reason: "refusal"
 *   NOTOOL  emit_bear_case를 끝내 호출하지 않음
 *
 * 웹 검색을 켜면 (모드와 무관하게) 인용 출처가 함께 온다.
 * 결과 수치는 입력한 목표주가에서 파생된다. 목표주가를 바꿔 다시 돌리면
 * 히스토리 diff에 변화가 잡힌다.
 */
import http from "node:http";
import crypto from "node:crypto";

const PORT = Number(process.env.MOCK_PORT ?? 4010);
/** 스트리밍이 눈에 보이도록 청크 사이에 두는 지연(ms). 0이면 즉시. */
const DELAY = Number(process.env.MOCK_DELAY ?? 35);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const round100 = (n) => Math.round(n / 100) * 100;

/* ------------------------------------------------------------------ */
/* 결과 만들기                                                          */
/* ------------------------------------------------------------------ */

function buildResult(targetPrice) {
  const base = targetPrice || 100_000;
  const scenario = (n, years) => ({
    trigger: [
      "최대 고객 A사가 2027년 물량을 내부 생산으로 전환",
      "중국 경쟁사가 동급 사양을 20% 낮은 단가로 진입",
      "전방 산업 재고가 12주를 넘어 신규 발주 중단",
    ][n],
    mechanism: [
      "A사 물량이 빠지면 가동률이 82%에서 61%로 내려간다. 손익분기 가동률이 63%라 " +
        "고정비 레버리지가 역으로 걸리고, 영업이익률은 18%에서 6%로 축소된다. " +
        "감익이 두 개 분기 이어지면 멀티플도 같이 내려간다.",
      "단가 경쟁이 시작되면 ASP가 12% 낮아진다. 원가는 그대로라 매출총이익률이 " +
        "34%에서 25%로 떨어지고, 판관비를 줄여도 영업이익률 한 자릿수를 벗어나기 어렵다.",
      "재고 조정은 발주 중단 → 매출 인식 지연 → 운전자본 증가 순으로 온다. " +
        "매출채권 회전일수가 이미 91일이라 현금흐름이 먼저 꺾이고, 차입금이 늘어난다.",
    ][n],
    years_to_impact: years,
    leading_indicators: [
      ["분기 보고서상 최대 고객 매출 비중 40% 하회", "A사 설비투자 공시에 자체 라인 증설 포함"],
      ["업계 평균 판가 전분기 대비 5% 이상 하락", "경쟁사 분기 출하량 30% 이상 증가"],
      ["전방 산업 재고회전일수 90일 초과", "월간 수주잔고 2개 분기 연속 감소"],
    ][n],
  });

  return {
    collapse_scenarios: [
      scenario(0, "1-2y"),
      scenario(1, "2-3y"),
      scenario(2, "<1y"),
    ],
    moat_erosion: {
      tech_substitution:
        "차세대 공정으로 전환되면 현재 장비 자산이 2년 내 진부화된다. 전환 비용은 라인당 400억원 수준으로 추정된다.",
      regulatory:
        "2027년 시행 예정 배출 규제가 라인당 400억원의 개조 비용을 발생시킨다. 시행령 원안은 3월 확정된다.",
      demand_shift:
        "전방 수요가 프리미엄에서 보급형으로 이동하면서 ASP가 12% 낮아진다. 물량으로 만회하려면 점유율 3%p가 더 필요하다.",
      customer_concentration:
        "상위 2개 고객이 매출의 58%를 차지한다. 최대 고객 비중이 3년간 31%에서 41%로 올라 단가 협상력이 고객 쪽에 있다.",
    },
    valuation_attack: [
      {
        assumption: "2027년까지 매출 CAGR 22%가 유지된다",
        why_fragile:
          "전방 수요 증가율이 이미 9%로 둔화됐다. 이 성장률은 점유율을 3%p 더 가져와야 성립하는데, 경쟁사 증설 계획을 반영하면 점유율은 오히려 하락한다.",
        downside_case_value: round100(base * 0.4),
      },
      {
        assumption: "영업이익률 18%가 구조적으로 유지된다",
        why_fragile:
          "18%는 가동률 82%에서 나온 숫자다. 고객 한 곳만 빠져도 손익분기 가동률 63%에 근접한다. 마진은 구조가 아니라 물량의 함수다.",
        downside_case_value: round100(base * 0.42),
      },
      {
        assumption: "설비투자가 감가상각 범위 안에서 끝난다",
        why_fragile:
          "2027년 규제 대응 개조가 감가상각과 별개로 들어온다. 개발비 자산화 비율이 21%에서 44%로 오른 것도 현금흐름이 이미 빡빡하다는 신호다.",
        downside_case_value: round100(base * 0.44),
      },
    ],
    thesis_breakers: [
      `분기 매출총이익률 ${base > 110_000 ? 31 : 34}% 하회`,
      "사업보고서상 최대 고객 매출 비중 40% 초과",
      "2분기 실적발표에서 연간 가이던스 철회",
      "경쟁사 증설 완공 공시 (예정 시점 2027년 상반기)",
    ],
    what_the_short_knows: [
      "개발비 자산화 비율이 3년간 21%에서 44%로 올라갔다. 비용화했다면 작년 영업이익은 19% 낮았다.",
      "매출채권 회전일수가 62일에서 91일로 늘었다. 매출 인식과 현금 회수 사이가 벌어지고 있다.",
      "관계사 매출이 전체의 11%인데 단가 근거가 공시에 없다.",
    ],
  };
}

/** 규격을 일부러 위반한 응답. 서버의 검증·재시도 경로를 태운다. */
function buildBadResult(targetPrice) {
  const good = buildResult(targetPrice);
  return {
    ...good,
    collapse_scenarios: good.collapse_scenarios.slice(0, 2), // 3개여야 하는데 2개
    thesis_breakers: ["시장 심리 악화", "투자자 신뢰 하락"], // 관측 불가능
  };
}

/* ------------------------------------------------------------------ */
/* SSE                                                                 */
/* ------------------------------------------------------------------ */

async function streamMessages(req, res, body) {
  const mode =
    (body.match(/\((RETRY|SEARCH|REFUSE|NOTOOL)\)/) || [])[1] ?? "DEFAULT";
  const target = Number(
    (body.match(/사용자 목표주가: ([\d,]+)원/) || [])[1]?.replace(/,/g, "") ?? 0,
  );
  // 교정 메시지가 섞여 있으면 재시도 요청이다.
  const isRetry = body.includes("다시 한 번 호출하세요");
  // 실제 API처럼, 툴이 선언돼 있으면 검색 결과를 돌려준다.
  const hasWebSearch = body.includes("web_search_20260209");
  const payload =
    mode === "RETRY" && !isRetry ? buildBadResult(target) : buildResult(target);

  console.log(
    `[mock] /v1/messages mode=${mode}${isRetry ? " (재시도)" : ""} target=${target || "-"}`,
  );

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  const ev = (type, data) =>
    res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  const direct = { type: "direct" };
  let index = 0;

  ev("message_start", {
    message: {
      id: `msg_mock_${crypto.randomUUID().slice(0, 8)}`,
      type: "message",
      role: "assistant",
      model: "claude-opus-5",
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 7200, output_tokens: 1 },
    },
  });

  // 사고 요약
  const thinking = [
    "강세 가정 세 개를 각각 반증 가능한 형태로 분해한다. ",
    "고객 집중도와 가동률 민감도가 가장 약한 고리로 보인다. ",
    "목표주가를 역산해 어떤 가정이 깔려 있는지 확인한다.",
  ];
  ev("content_block_start", {
    index,
    content_block: { type: "thinking", thinking: "", signature: "" },
  });
  for (const t of thinking) {
    ev("content_block_delta", { index, delta: { type: "thinking_delta", thinking: t } });
    await sleep(DELAY);
  }
  ev("content_block_stop", { index });
  index += 1;

  // 짧은 진행 코멘트
  ev("content_block_start", { index, content_block: { type: "text", text: "", caller: direct } });
  ev("content_block_delta", {
    index,
    delta: { type: "text_delta", text: "분석을 시작합니다." },
  });
  ev("content_block_stop", { index });
  index += 1;

  if (mode === "REFUSE") {
    ev("message_delta", {
      delta: {
        stop_reason: "refusal",
        stop_sequence: null,
        stop_details: {
          type: "refusal",
          category: "other",
          explanation: "목 서버가 만든 가짜 거절입니다.",
        },
      },
      usage: { input_tokens: 7200, output_tokens: 40 },
    });
    ev("message_stop", {});
    res.end();
    return;
  }

  if (hasWebSearch) {
    ev("content_block_start", {
      index,
      content_block: {
        type: "server_tool_use",
        id: "srvtoolu_mock",
        name: "web_search",
        input: {},
        caller: direct,
      },
    });
    ev("content_block_stop", { index });
    index += 1;
    await sleep(DELAY * 4);

    ev("content_block_start", {
      index,
      content_block: {
        type: "web_search_tool_result",
        tool_use_id: "srvtoolu_mock",
        caller: direct,
        content: [
          { type: "web_search_result", url: "https://example.com/capex", title: "경쟁사 증설 계획 공시", encrypted_content: "mock", page_age: null },
          { type: "web_search_result", url: "https://example.com/rule", title: "배출 규제 시행령 원안", encrypted_content: "mock", page_age: null },
          { type: "web_search_result", url: "https://example.com/capex", title: "중복 URL (합쳐져야 함)", encrypted_content: "mock", page_age: null },
        ],
      },
    });
    ev("content_block_stop", { index });
    index += 1;

  }

  // 검색 실패 분기(content가 배열이 아니라 에러 객체)는 SEARCH 모드에서만 태운다.
  if (mode === "SEARCH") {
    ev("content_block_start", {
      index,
      content_block: {
        type: "web_search_tool_result",
        tool_use_id: "srvtoolu_mock2",
        caller: direct,
        content: { type: "web_search_tool_result_error", error_code: "max_uses_exceeded" },
      },
    });
    ev("content_block_stop", { index });
    index += 1;
  }

  if (mode === "NOTOOL") {
    ev("message_delta", {
      delta: { stop_reason: "end_turn", stop_sequence: null },
      usage: { input_tokens: 7200, output_tokens: 60 },
    });
    ev("message_stop", {});
    res.end();
    return;
  }

  ev("content_block_start", {
    index,
    content_block: {
      type: "tool_use",
      id: `toolu_mock_${crypto.randomUUID().slice(0, 8)}`,
      name: "emit_bear_case",
      input: {},
      caller: direct,
    },
  });
  const json = JSON.stringify(payload);
  for (let i = 0; i < json.length; i += 400) {
    ev("content_block_delta", {
      index,
      delta: { type: "input_json_delta", partial_json: json.slice(i, i + 400) },
    });
    await sleep(DELAY);
  }
  ev("content_block_stop", { index });

  ev("message_delta", {
    delta: { stop_reason: "tool_use", stop_sequence: null },
    usage: { input_tokens: 7200, output_tokens: 4800 },
  });
  ev("message_stop", {});
  res.end();
}

/* ------------------------------------------------------------------ */
/* 서버                                                                */
/* ------------------------------------------------------------------ */

http
  .createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const path = req.url?.split("?")[0] ?? "";

      // Files API. 실제로 저장하지 않고 file_id만 만들어 준다.
      if (path === "/v1/files" && req.method === "POST") {
        const id = `file_mock_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
        console.log(`[mock] /v1/files → ${id}`);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            id,
            type: "file",
            filename: "uploaded.pdf",
            mime_type: "application/pdf",
            size_bytes: Buffer.byteLength(body),
            created_at: new Date().toISOString(),
            downloadable: false,
          }),
        );
        return;
      }

      if (path === "/v1/messages" && req.method === "POST") {
        streamMessages(req, res, body).catch((err) => {
          console.error("[mock] 스트리밍 실패:", err);
          res.end();
        });
        return;
      }

      console.log(`[mock] 404 ${req.method} ${path}`);
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: `목 서버에 없는 경로: ${path}` } }));
    });
  })
  .listen(PORT, () => {
    console.log(`[mock] http://localhost:${PORT} 에서 대기 중`);
    console.log(
      `[mock] 앱을 이렇게 띄우세요:\n` +
        `       ANTHROPIC_API_KEY=mock ANTHROPIC_BASE_URL=http://localhost:${PORT} npm run dev`,
    );
  });
