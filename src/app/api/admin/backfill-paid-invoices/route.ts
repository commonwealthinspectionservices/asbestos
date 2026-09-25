import { NextRequest, NextResponse } from "next/server";
import { requireOwnerApi } from "@/lib/admin-api";
import { withApiErrors } from "@/lib/api-handler";
import { getSupabaseAdminFresh } from "@/lib/supabase";
import { savePaidInvoiceDocument } from "@/lib/paid-invoice";
import type { JobDocument } from "@/lib/types";

// Owner-only: files Stripe's paid invoice PDF on every job that's already
// paid but doesn't have one yet (new payments do this on their own — see
// markJobPaid). Safe to re-run; skips jobs that already have one.
export const POST = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireOwnerApi(req);
  if (unauthorized) return unauthorized;

  const { data: jobs, error } = await getSupabaseAdminFresh()
    .from("jobs")
    .select("id, project_number, documents")
    .eq("status", "paid")
    .not("stripe_invoice_id", "is", null);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const results: { project: string | null; saved: boolean; reason?: string }[] = [];
  for (const job of jobs ?? []) {
    if (((job.documents ?? []) as JobDocument[]).some((d) => d.kind === "paid_invoice")) continue;
    const r = await savePaidInvoiceDocument(job.id).catch((e) => ({ saved: false, reason: e instanceof Error ? e.message : String(e) }));
    results.push({ project: job.project_number, ...r });
  }
  return NextResponse.json({ results });
});
