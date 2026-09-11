import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-api";
import { getSupabaseAdmin } from "@/lib/supabase";
import { withApiErrors } from "@/lib/api-handler";
import { paymentDueDate, localDateOnly } from "@/lib/invoice-due-date";
import type { Job } from "@/lib/types";

// One-off, 2026-09-10 — not a route anything else calls. Delete after use.
//
// EditProjectDialog's Payment Due Date field used to silently re-save on
// every dialog save, for any reason at all, computed off confirmed_date+30
// (the site-visit date) — not invoice_sent_at+30 (when the invoice really
// went out, which is what dueDateFor's own default now uses, see
// invoice-due-date.ts). That mismatch was invisible until today: dueDateFor
// ignored this column entirely, so it never showed up anywhere. Now that a
// stored payment_due_date wins again (a deliberate, real override), every
// job whose stored value only ever came from that stale side effect needs
// resetting back to null so it goes back to recomputing live — a real
// admin-set override is indistinguishable from the bug's own output by
// value alone, but this field had no visible effect until today, so
// nothing currently stored can be a deliberate recent choice.
export const GET = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

  const supabase = getSupabaseAdmin();
  const { data: jobs, error } = await supabase
    .from("jobs")
    .select("id, project_number, payment_due_date, invoice_sent_at, confirmed_date, requested_date")
    .not("payment_due_date", "is", null);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  type Row = Pick<Job, "id" | "project_number" | "payment_due_date" | "invoice_sent_at" | "confirmed_date" | "requested_date">;

  const dryRun = req.nextUrl.searchParams.get("dryRun") !== "false";
  const reset: { project_number: string | null; wasStoredAs: string | null; correctDefault: string | null }[] = [];
  const kept: { project_number: string | null; value: string | null }[] = [];

  for (const job of (jobs ?? []) as unknown as Row[]) {
    const correctDefault = job.invoice_sent_at
      ? paymentDueDate(localDateOnly(job.invoice_sent_at))
      : paymentDueDate(job.confirmed_date ?? job.requested_date ?? "");

    if (job.payment_due_date === correctDefault) {
      kept.push({ project_number: job.project_number, value: job.payment_due_date });
      continue;
    }

    reset.push({ project_number: job.project_number, wasStoredAs: job.payment_due_date, correctDefault });
    if (!dryRun) {
      await supabase.from("jobs").update({ payment_due_date: null }).eq("id", job.id);
    }
  }

  return NextResponse.json({ dryRun, resetCount: reset.length, keptCount: kept.length, reset, kept });
});
