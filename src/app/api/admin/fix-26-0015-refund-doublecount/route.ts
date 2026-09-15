import { NextResponse } from "next/server";
import { NextRequest } from "next/server";
import { requireAdminApi } from "@/lib/admin-api";
import { withApiErrors } from "@/lib/api-handler";
import { getSupabaseAdmin } from "@/lib/supabase";
import { computeLabCostCentsFromDocuments } from "@/lib/lab-cost";

// One-off: confirmed live 2026-09-15 — Crystal issued a real refund
// (#6768, -$510.00) for the earlier mislabeled #6602 charge on 26-0015,
// and the app's own automated pipeline correctly picked it up and filed
// it. But #6602 itself was manually zeroed out earlier the same day
// (see the now-deleted fix-26-0015-lab-cost route) to correct the same
// $510 error by hand — so the real refund now double-subtracts it:
// 0 (zeroed #6602) + $405 (#6593) + -$510 (#6768 refund) = -$105.
// Restoring #6602 to its real original amount lets the charge and
// refund net out together the way the pipeline is actually designed to
// handle a refund, instead of conflicting with the earlier manual fix:
// $510 (#6602) + $405 (#6593) + -$510 (#6768) = $405, the confirmed
// correct total. Delete this route after use.
export const POST = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

  const supabase = getSupabaseAdmin();
  const { data: job, error } = await supabase
    .from("jobs")
    .select("id, project_number, documents, lab_cost_cents")
    .eq("project_number", "26-0015")
    .single();
  if (error || !job) return NextResponse.json({ error: error?.message ?? "not found" }, { status: 404 });

  const documents = (job.documents ?? []).map((d: { lab_invoice_number?: string; amount_cents?: number }) =>
    d.lab_invoice_number === "6602" ? { ...d, amount_cents: 51000 } : d
  );
  const newLabCostCents = computeLabCostCentsFromDocuments(documents);

  await supabase.from("jobs").update({ documents, lab_cost_cents: newLabCostCents }).eq("id", job.id);

  return NextResponse.json({ ok: true, before: job.lab_cost_cents, after: newLabCostCents });
});
