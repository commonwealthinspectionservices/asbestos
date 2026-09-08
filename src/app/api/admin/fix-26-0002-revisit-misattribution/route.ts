import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-api";
import { getSupabaseAdmin } from "@/lib/supabase";
import { withApiErrors } from "@/lib/api-handler";
import { computeLabCostCentsFromDocuments } from "@/lib/lab-cost";
import type { Job, JobDocument } from "@/lib/types";

// One-off, 2026-09-08 — real charges for revisit job 26-0002.1 (36
// Drummer Rd, Acton) were misattributed to its parent 26-0002 by
// PROJECT_NUMBER_PATTERN dropping the ".1" suffix (now fixed in
// parse-lab-invoice.ts). Reprocessing the source email correctly filed
// #6568/#6610/#6611 under 26-0002.1 (confirmed live), but left the same
// three charges still sitting on 26-0002 too — same "zero, don't delete"
// correction pattern as the 26-0015 duplicate fix (2026-09-03), for the
// same idempotency reason: deleting would let a future reprocessing of
// this same email re-add the (now-corrected) numbers here again, since
// existingDocsForNum only checks presence, not correctness.
const WRONGLY_ATTRIBUTED_NUMS = new Set(["6568", "6610", "6611"]);

export const GET = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;
  if (req.nextUrl.searchParams.get("confirm") !== "true") {
    return NextResponse.json({ error: "pass confirm=true to actually apply this" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { data: job, error } = await supabase.from("jobs").select("*").ilike("project_number", "26-0002").maybeSingle();
  if (error || !job) return NextResponse.json({ error: error?.message ?? "26-0002 not found" }, { status: 500 });

  const before = (job as unknown as Job).documents ?? [];
  let zeroed = 0;
  const updated = before.map((d: JobDocument) => {
    if (d.kind === "lab_invoice" && d.lab_invoice_number && WRONGLY_ATTRIBUTED_NUMS.has(d.lab_invoice_number) && d.amount_cents) {
      zeroed++;
      return { ...d, amount_cents: 0 };
    }
    return d;
  });

  const newLabCostCents = computeLabCostCentsFromDocuments(updated);
  await supabase.from("jobs").update({ documents: updated, lab_cost_cents: newLabCostCents }).eq("id", job.id);

  return NextResponse.json({ ok: true, docsZeroed: zeroed, oldLabCostCents: (job as unknown as Job).lab_cost_cents, newLabCostCents });
});
