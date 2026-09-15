import { NextResponse } from "next/server";
import { NextRequest } from "next/server";
import { requireAdminApi } from "@/lib/admin-api";
import { withApiErrors } from "@/lib/api-handler";
import { getSupabaseAdmin } from "@/lib/supabase";
import { computeLabCostCentsFromDocuments } from "@/lib/lab-cost";

// One-off: confirmed live 2026-09-14 (Tim) — invoice #6602 ($510, 34
// samples) on 26-0015 is a real Crystal charge that does NOT belong to
// this job (no second round of sampling ever happened at 10 Vasa St; the
// job's own invoice to the client only ever billed 30 samples, matching
// invoice #6593's $405 exactly). Searched every job in the system for
// this transaction number and for any job missing a matching ~34-sample
// charge — found neither, so the true owner can't be identified from our
// own data; Crystal mislabeled it on their end. Zeroing rather than
// deleting the document — same durable-fix pattern as the 2026-09-04
// 26-0015 incident (see project_lab_cost_accuracy_fixes memory):
// deleting let the reprocessing pipeline silently recreate it. Delete
// this route after use.
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
    d.lab_invoice_number === "6602" ? { ...d, amount_cents: 0 } : d
  );
  const newLabCostCents = computeLabCostCentsFromDocuments(documents);

  await supabase.from("jobs").update({ documents, lab_cost_cents: newLabCostCents }).eq("id", job.id);

  return NextResponse.json({ ok: true, before: job.lab_cost_cents, after: newLabCostCents });
});
