import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-api";
import { withApiErrors } from "@/lib/api-handler";
import { getValidAccessToken, listLabels } from "@/lib/gmail";

// One-off, 2026-09-05 — read-only. Confirms the exact real Gmail label
// name Tim already uses for Boston Harbor before wiring up auto-labeling,
// so getOrCreateLabelId reuses his existing label instead of creating a
// near-duplicate from a guessed name.
export const GET = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;
  const accessToken = await getValidAccessToken();
  if (!accessToken) return NextResponse.json({ error: "Gmail is not connected" }, { status: 500 });
  const labels = await listLabels(accessToken);
  return NextResponse.json({ labels: labels.map((l) => l.name).sort() });
});
