import { NextRequest } from "next/server";
import { jsonOk, requireCapability } from "@/lib/api/http";
import { analyticsSummary } from "@/lib/site-features/analytics";

export const dynamic = "force-dynamic";

/**
 * Analytics summary for the developer dashboard and the Telegram bot's
 * daily digest (v1.3.0). Reads flush the pending event buffer first so the
 * numbers are as fresh as possible.
 */
export async function GET(req: NextRequest) {
  const denied = await requireCapability(req, "analytics.read");
  if (denied) return denied;
  const summary = await analyticsSummary();
  return jsonOk(summary);
}
