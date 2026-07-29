import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-api";
import { getSettings, updateSettings } from "@/lib/settings";
import { withApiErrors } from "@/lib/api-handler";

export const GET = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

  const settings = await getSettings();
  return NextResponse.json({ settings });
});

export const PUT = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const settings = await updateSettings(body);
  return NextResponse.json({ settings });
});
