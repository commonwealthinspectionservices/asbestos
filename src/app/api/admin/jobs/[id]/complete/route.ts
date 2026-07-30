import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireAdminApi } from "@/lib/admin-api";
import { withApiErrors } from "@/lib/api-handler";
import { parseLineItems, lineItemsTotalCents } from "@/lib/invoice-line-items";
import type { Customer, Job } from "@/lib/types";

// Second half of the two-stage completion workflow ("Enter lab results" in
// src/components/admin/JobsDashboard.tsx): the samples were already
// counted by .../sample/route.ts ("Mark sampled"); this adds the lab's
// info, the report summary, and a manual line-item invoice (matching the
// owner's existing Quantity/Billing Unit/Description/Unit Cost workflow),
// then invoices. Stripe invoicing is on hold for now — the total is just
// stored so /invoice can render an itemized PDF to send by hand.
export const POST = withApiErrors(async (
  req: NextRequest,
  { params }: { params: { id: string } }
) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

  const body = await req.json().catch(() => null);
  const labName: string | undefined = body?.labName;
  const labCostCents =
    body?.labCostCents !== undefined && body?.labCostCents !== null
      ? Number(body.labCostCents)
      : undefined;
  const labNistCert: string | undefined = body?.labNistCert;
  const labMassdlsCert: string | undefined = body?.labMassdlsCert;
  const reportSummary: string | undefined = body?.reportSummary;
  const reportNotes: string | undefined = body?.reportNotes;

  const parsed = parseLineItems(body?.lineItems);
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const { items } = parsed;
  const totalCents = lineItemsTotalCents(items);

  const supabase = getSupabaseAdmin();
  const { data: job, error: jobError } = await supabase
    .from("jobs")
    .select("*, customers!customer_id(*)")
    .eq("id", params.id)
    .single();

  if (jobError || !job) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  // The Supabase client has no generated Database type, so a joined select
  // resolves to an untyped/`never` shape at the call site — cast once here
  // rather than at each field access below.
  const jobRow = job as unknown as Job & { customers: Customer };

  if (jobRow.status !== "pending_lab_results") {
    return NextResponse.json(
      { error: `Project must be pending lab results (currently ${jobRow.status})` },
      { status: 400 }
    );
  }

  const { data: updated, error: updateError } = await supabase
    .from("jobs")
    .update({
      lab_name: labName?.trim() || null,
      lab_cost_cents: labCostCents ?? null,
      lab_nist_cert: labNistCert?.trim() || null,
      lab_massdls_cert: labMassdlsCert?.trim() || null,
      report_summary: reportSummary?.trim() || null,
      report_notes: reportNotes ?? null,
      invoice_line_items: items,
      invoice_total_cents: totalCents,
      status: "ready_to_send",
    })
    .eq("id", params.id)
    .select("*")
    .single();

  if (updateError || !updated) {
    return NextResponse.json({ error: updateError?.message }, { status: 500 });
  }
  return NextResponse.json({ job: updated });
});
