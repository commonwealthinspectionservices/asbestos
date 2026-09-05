import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-api";
import { getSupabaseAdmin } from "@/lib/supabase";
import { withApiErrors } from "@/lib/api-handler";
import type { Job } from "@/lib/types";

// One-time cleanup, 2026-09-05 — audit-lab-invoices predates weekly/daily
// summary PDFs being filed under kind "lab_invoice" (see
// processWeeklyLabSummaryEmail in lib/lab-email.ts), so its isLabInvoiceText
// check — looking for Crystal's single-invoice "Invoice no.:"/"Federal Tax
// ID" markers — never matched a weekly summary's own "Commonwealth
// Inspection Weekly Report" content, and it wrongly persisted
// invoice_mismatch: true on every one of them the one time it was run.
// isLabInvoiceText now accepts weekly-summary content too (see its own
// comment in lib/parse-lab-invoice.ts), so this only needs to run once to
// clear the flags that were already written. GET, same read-then-write
// pattern as the audit routes it's cleaning up after.
export const GET = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

  const supabase = getSupabaseAdmin();
  const { data: jobs, error } = await supabase.from("jobs").select("id, project_number, documents");
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const reverted: { project_number: string | null; file_name: string }[] = [];

  for (const job of (jobs ?? []) as unknown as Pick<Job, "id" | "project_number" | "documents">[]) {
    const docs = job.documents ?? [];
    let changed = false;
    const updated = docs.map((d) => {
      if (d.kind === "lab_invoice" && d.invoice_mismatch === true && d.file_name.startsWith("weekly-lab-summary")) {
        changed = true;
        reverted.push({ project_number: job.project_number, file_name: d.file_name });
        const { invoice_mismatch, ...rest } = d;
        return rest;
      }
      return d;
    });
    if (changed) {
      await supabase.from("jobs").update({ documents: updated }).eq("id", job.id);
    }
  }

  return NextResponse.json({ reverted: reverted.length, details: reverted });
});
