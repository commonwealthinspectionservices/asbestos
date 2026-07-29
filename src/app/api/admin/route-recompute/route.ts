import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-api";
import { runMorningRoute } from "@/lib/route-runner";
import { getSettings } from "@/lib/settings";
import { nowInTimeZone } from "@/lib/tz";
import { withApiErrors } from "@/lib/api-handler";

export const POST = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

  const body = await req.json().catch(() => ({}));
  let date = body?.date as string | undefined;

  if (!date) {
    const settings = await getSettings();
    date = nowInTimeZone(settings.timezone).dateIso;
  }

  const result = await runMorningRoute(date);
  return NextResponse.json({ ok: true, date, ...result });
});
