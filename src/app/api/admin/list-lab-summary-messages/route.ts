import { NextRequest, NextResponse } from "next/server";
import { requireOwnerApi } from "@/lib/admin-api";
import { withApiErrors } from "@/lib/api-handler";
import { getValidAccessToken, listMessagesByQuery, getMessage, getHeader } from "@/lib/gmail";

// Read-only — owner-only: lists recent Crystal Analytical weekly-summary
// Gmail messages (same query runLabReconciliation already uses) with just
// enough to find the right messageId for /api/admin/reprocess-lab-summary,
// since that route needs one and there was previously no way to look one
// up without digging through Gmail by hand.
export const GET = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireOwnerApi(req);
  if (unauthorized) return unauthorized;

  const accessToken = await getValidAccessToken();
  if (!accessToken) return NextResponse.json({ error: "Gmail is not connected" }, { status: 500 });

  const messages = await listMessagesByQuery(
    accessToken,
    `from:quickbooks@notification.intuit.com subject:"Crystal Analytical" subject:Summary newer_than:21d`
  );

  const results = await Promise.all(
    messages.map(async (m) => {
      const message = await getMessage(accessToken, m.id);
      return {
        id: m.id,
        subject: getHeader(message, "Subject") ?? null,
        date: message.internalDate ? new Date(Number(message.internalDate)).toISOString() : null,
      };
    })
  );

  results.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  return NextResponse.json({ messages: results });
});
