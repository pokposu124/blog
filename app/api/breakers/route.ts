import { NextResponse } from "next/server";
import { listBreakerChecks, setBreakerCheck } from "@/lib/db";
import { BreakerCheckInput } from "@/lib/schema";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const ticker = new URL(req.url).searchParams.get("ticker")?.trim();
  if (!ticker) {
    return NextResponse.json({ error: "ticker가 필요합니다." }, { status: 400 });
  }
  return NextResponse.json({ checks: listBreakerChecks(ticker) });
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON 본문이 아닙니다." }, { status: 400 });
  }

  const parsed = BreakerCheckInput.safeParse(body);
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

  const { ticker, breaker, checked } = parsed.data;
  const checkedAt = setBreakerCheck(ticker, breaker, checked);
  return NextResponse.json({ breaker, checked_at: checkedAt });
}
