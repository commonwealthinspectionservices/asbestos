import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-api";
import { withApiErrors } from "@/lib/api-handler";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getStripe } from "@/lib/stripe";
import { NEWTON_FIRE_FLOOD_COMPANY_ID } from "@/lib/report-findings";

// One-off: restricts every currently-open Stripe invoice (created before
// the card-removal fix) to ACH only, in place — same lever
// createStripeInvoiceForJob now applies at creation time, applied
// retroactively so an already-sent "Link to pay" keeps working without
// offering card. Newton Fire & Flood is excluded, same as the creation
// path. Delete this route after use.
export const POST = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

  const { projectNumbers } = await req.json().catch(() => ({ projectNumbers: null }));

  const supabase = getSupabaseAdmin();
  // Not restricted to ready_to_send/report_invoice_sent — confirmed live,
  // 26-0031 (Ruben Rodrigues) has a real open Stripe invoice
  // (invoice_sent_at set) but sits at status "pending_lab_results" (the
  // early-invoice flow for individuals lets the invoice go out before lab
  // results are even in). Any job with a real invoice reference that
  // hasn't been paid yet is in scope.
  let query = supabase
    .from("jobs")
    .select("project_number, stripe_invoice_id, status, customers!customer_id(company_id)")
    .not("stripe_invoice_id", "is", null)
    .neq("status", "paid");
  if (Array.isArray(projectNumbers) && projectNumbers.length > 0) {
    query = query.in("project_number", projectNumbers);
  }
  const { data: jobs, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const stripe = getStripe();
  const results: { project_number: string; status: string; detail?: string }[] = [];

  for (const job of jobs as unknown as { project_number: string; stripe_invoice_id: string; customers: { company_id: string | null } | null }[]) {
    if (job.customers?.company_id === NEWTON_FIRE_FLOOD_COMPANY_ID) {
      results.push({ project_number: job.project_number, status: "skipped-newton" });
      continue;
    }
    try {
      const invoice = await stripe.invoices.update(job.stripe_invoice_id, {
        payment_settings: { payment_method_types: ["us_bank_account"] },
      });
      results.push({ project_number: job.project_number, status: "updated", detail: invoice.status ?? undefined });
    } catch (e) {
      results.push({ project_number: job.project_number, status: "error", detail: e instanceof Error ? e.message : String(e) });
    }
  }

  return NextResponse.json({ ok: true, results });
});
