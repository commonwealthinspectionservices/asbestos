import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-api";
import { getSupabaseAdmin } from "@/lib/supabase";
import { createStripeInvoiceForJob } from "@/lib/stripe";
import { withApiErrors } from "@/lib/api-handler";
import type { Customer, Job } from "@/lib/types";

// Admin counterpart of /api/portal/projects/[id]/pay — same idempotent
// Stripe hosted-invoice lookup, for the "Get payment link" button on the
// Invoice tab, so the admin can grab/share the link directly without
// having to go through the invoice email draft.
export const POST = withApiErrors(async (
  req: NextRequest,
  { params }: { params: { id: string } }
) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

  const supabase = getSupabaseAdmin();
  const { data: job, error } = await supabase
    .from("jobs")
    .select("*, customers!customer_id(*)")
    .eq("id", params.id)
    .single();
  if (error || !job) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const jobRow = job as unknown as Job & { customers: Customer };
  if (jobRow.invoice_total_cents == null || !jobRow.invoice_line_items.length) {
    return NextResponse.json({ error: "Project has not been invoiced yet" }, { status: 400 });
  }

  const { hostedInvoiceUrl } = await createStripeInvoiceForJob(jobRow, jobRow.customers);
  if (!hostedInvoiceUrl) {
    return NextResponse.json({ error: "Stripe did not return a payment link" }, { status: 502 });
  }

  return NextResponse.json({ url: hostedInvoiceUrl });
});
