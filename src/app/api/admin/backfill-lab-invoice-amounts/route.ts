import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-api";
import { getSupabaseAdmin } from "@/lib/supabase";
import { withApiErrors } from "@/lib/api-handler";
import type { Job } from "@/lib/types";

// Per Tim, 2026-08-28 — a one-time retroactive sweep, not a route anything
// else calls. amount_cents (see its own comment on JobDocument) only ever
// gets set on a NEW lab_invoice document going forward, by every writer in
// lib/lab-email.ts and the manual upload route — see
// computeLabCostCentsFromDocuments's own comment in lib/lab-cost.ts for why
// Job's own lab_cost_cents is now derived from these instead of written
// directly. That can't retroactively catch a document already sitting in
// the database from before amount_cents existed. Confirmed live the same
// day this shipped: every job on file bills under exactly one real invoice
// number right now, so a job's own *current* lab_cost_cents already IS the
// correct amount_cents for every one of its lab_invoice documents — no
// need to re-download and re-parse the PDFs the way
// backfill-lab-invoice-numbers does. A job that already spans more than
// one distinct invoice number by the time this actually runs is skipped
// and reported rather than guessed at — there'd be no safe way to split
// one lab_cost_cents figure back across several real invoices after the
// fact. GET (not POST) — nothing here is destructive (no deletes, no file
// changes, only a number), same reasoning as the other backfill routes.
export const GET = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

  const supabase = getSupabaseAdmin();
  const { data: jobs, error } = await supabase
    .from("jobs")
    .select("id, project_number, lab_cost_cents, documents");
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let scanned = 0;
  let alreadySet = 0;
  let newlySet = 0;
  const skippedMultiInvoice: { project_number: string | null; invoice_numbers: string[] }[] = [];
  const skippedNoCost: { project_number: string | null }[] = [];

  for (const job of (jobs ?? []) as unknown as Pick<Job, "id" | "project_number" | "lab_cost_cents" | "documents">[]) {
    const invoiceDocs = (job.documents ?? []).filter((d) => d.kind === "lab_invoice");
    if (invoiceDocs.length === 0) continue;
    scanned += invoiceDocs.length;

    const missingAmount = invoiceDocs.filter((d) => d.amount_cents == null);
    if (missingAmount.length === 0) {
      alreadySet += invoiceDocs.length;
      continue;
    }

    const distinctInvoiceNumbers = new Set(invoiceDocs.map((d) => d.lab_invoice_number ?? d.id));
    if (distinctInvoiceNumbers.size > 1) {
      skippedMultiInvoice.push({ project_number: job.project_number, invoice_numbers: [...distinctInvoiceNumbers] });
      continue;
    }

    if (job.lab_cost_cents == null) {
      skippedNoCost.push({ project_number: job.project_number });
      continue;
    }

    const updatedDocuments = (job.documents ?? []).map((d) =>
      d.kind === "lab_invoice" && d.amount_cents == null ? { ...d, amount_cents: job.lab_cost_cents } : d
    );
    await supabase.from("jobs").update({ documents: updatedDocuments }).eq("id", job.id);
    newlySet += missingAmount.length;
  }

  return NextResponse.json({ scanned, alreadySet, newlySet, skippedMultiInvoice, skippedNoCost });
});
