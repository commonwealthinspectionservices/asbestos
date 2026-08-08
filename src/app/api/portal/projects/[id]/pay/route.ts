import { NextResponse } from "next/server";
import { requireContractorApi, getCompanyCustomerIds } from "@/lib/contractor-api";
import { getSupabaseAdmin } from "@/lib/supabase";
import { createStripeInvoiceForJob } from "@/lib/stripe";
import { withApiErrors } from "@/lib/api-handler";
import type { Customer, Job } from "@/lib/types";

// Resolves (creating if needed) the Stripe hosted invoice page for a job so
// the portal's "Pay now" button can send the contractor straight there —
// createStripeInvoiceForJob is idempotent, reusing job.stripe_invoice_id on
// repeat calls rather than creating a duplicate invoice.
export const POST = withApiErrors(async (
  req: Request,
  { params }: { params: { id: string } }
) => {
  const auth = await requireContractorApi();
  if (auth.error) return auth.error;

  const companyCustomerIds = await getCompanyCustomerIds(auth.customer);

  const supabase = getSupabaseAdmin();
  const { data: job, error } = await supabase
    .from("jobs")
    .select("*, customers!customer_id(*)")
    .eq("id", params.id)
    .in("customer_id", companyCustomerIds)
    .single();

  if (error || !job) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const jobRow = job as unknown as Job & { customers: Customer };
  if (jobRow.invoice_total_cents == null || !jobRow.invoice_line_items.length) {
    return NextResponse.json({ error: "Project has not been invoiced yet" }, { status: 400 });
  }
  if (jobRow.payment_type === "check") {
    return NextResponse.json({ error: "This project is billed by check, not online payment" }, { status: 400 });
  }

  // Bill the job's own customer, not necessarily the logged-in viewer — a
  // colleague at the same company can pay this invoice too.
  const { hostedInvoiceUrl } = await createStripeInvoiceForJob(jobRow, jobRow.customers);
  if (!hostedInvoiceUrl) {
    return NextResponse.json({ error: "Stripe did not return a payment link" }, { status: 502 });
  }

  return NextResponse.json({ url: hostedInvoiceUrl });
});
