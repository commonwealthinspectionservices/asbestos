import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-api";
import { withApiErrors } from "@/lib/api-handler";
import { parseSampleItems } from "@/lib/sample-items";
import { sendCocEmailToLab } from "@/lib/lab-email";
import type { CocType } from "@/lib/types";

const COC_TYPES: CocType[] = ["asbestos_bulk", "mold_air_o_cell", "mold_bulk", "mold_swab"];

// The Chain of Custody tab's "Send to Lab" button — per Tim, 2026-09-30:
// "a button that actually sends it straight to the lab in one click (with
// a quick confirm), instead of creating a Gmail draft you have to go find
// and send yourself." Same validation as the coc-draft route (its sibling,
// kept for anyone who still wants to review before sending); this one
// calls sendCocEmailToLab (a real gmail.send) instead of
// createCocDraftForJob.
export const POST = withApiErrors(async (
  req: NextRequest,
  { params }: { params: { id: string } }
) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

  const body = await req.json().catch(() => null);
  const cocType = body?.cocType;
  if (!COC_TYPES.includes(cocType)) {
    return NextResponse.json({ error: "Invalid or missing cocType" }, { status: 400 });
  }

  const parsed = parseSampleItems(body?.sampleItems);
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const sampleItems = parsed.items.filter((s) => s.sample_number || s.material || s.location);
  if (sampleItems.length === 0) {
    return NextResponse.json({ error: "Add at least one sample before sending a Chain of Custody email" }, { status: 400 });
  }

  const turnaround = body?.turnaround === "Rush" || body?.turnaround === "24-Hr" ? body.turnaround : null;
  const dateNeeded = typeof body?.dateNeeded === "string" && body.dateNeeded ? body.dateNeeded : null;
  const relinquishedDate = typeof body?.relinquishedDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.relinquishedDate) ? body.relinquishedDate : null;
  const relinquishedTime = typeof body?.relinquishedTime === "string" && /^\d{2}:\d{2}$/.test(body.relinquishedTime) ? body.relinquishedTime : null;

  const note = typeof body?.note === "string" && body.note.trim() ? body.note.trim().slice(0, 500) : null;

  const { messageId } = await sendCocEmailToLab(params.id, { cocType, sampleItems, turnaround, dateNeeded, relinquishedDate, relinquishedTime, note });
  return NextResponse.json({ ok: true, messageId });
});
