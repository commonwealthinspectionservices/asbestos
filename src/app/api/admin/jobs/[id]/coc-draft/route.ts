import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-api";
import { withApiErrors } from "@/lib/api-handler";
import { parseSampleItems } from "@/lib/sample-items";
import { createCocDraftForJob } from "@/lib/lab-email";
import type { CocType } from "@/lib/types";

const COC_TYPES: CocType[] = ["asbestos_bulk", "mold_air_o_cell", "mold_bulk", "mold_swab"];

// The Chain of Custody tab's "Create Draft" button — same draft-creation
// path (createDraft, never gmail.send) as every other document this app
// emails out. See createCocDraftForJob's own comment in lab-email.ts.
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
    return NextResponse.json({ error: "Add at least one sample before creating a Chain of Custody draft" }, { status: 400 });
  }

  const turnaround = body?.turnaround === "Rush" || body?.turnaround === "24-Hr" ? body.turnaround : null;
  const dateNeeded = typeof body?.dateNeeded === "string" && body.dateNeeded ? body.dateNeeded : null;

  const { messageId } = await createCocDraftForJob(params.id, { cocType, sampleItems, turnaround, dateNeeded });
  return NextResponse.json({ ok: true, messageId });
});
