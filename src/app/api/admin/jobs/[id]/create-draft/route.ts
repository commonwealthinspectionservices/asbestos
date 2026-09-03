import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-api";
import { withApiErrors } from "@/lib/api-handler";
import { getSupabaseAdmin } from "@/lib/supabase";
import { createCombinedDraftForJob, createInvoiceDraftForJob, createReportDraftForJob, createSelectedDraftForJob } from "@/lib/lab-email";
import { BOSTON_HARBOR_WATER_RESTORATION_COMPANY_ID, type ReportDomain } from "@/lib/report-findings";

// Backing the Email tab's "View Draft" buttons — same draft-creation
// path the automatic Gmail check and markJobPaid use, callable on demand
// any time the admin wants the freshest attachments (this always replaces
// whatever draft is already sitting there, deleting it first — see
// draftCombinedEmailForJob's own stale-draft cleanup — rather than opening
// a possibly-stale one). `kind=combined` is the common-case UI button
// (report + invoice as one draft); Boston Harbor's two independent header
// buttons use "invoice"/"report" directly (see JobsDashboard.tsx's
// reportOnlyDraft/invoiceOnlyDraft hooks). Always returns the new draft's
// Gmail message id — confirmed live 2026-08-26: the "invoice"/"report"
// branches originally omitted it, so their buttons' window.open() call
// always got closed with nothing to navigate to instead of landing on
// the actual draft.
export const POST = withApiErrors(async (
  req: NextRequest,
  { params }: { params: { id: string } }
) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

  const kind = req.nextUrl.searchParams.get("kind");
  if (kind === "invoice") {
    const { messageId } = await createInvoiceDraftForJob(params.id);
    return NextResponse.json({ ok: true, messageId });
  }
  if (kind === "report") {
    const { messageId } = await createReportDraftForJob(params.id);
    return NextResponse.json({ ok: true, messageId });
  }
  // The Email tab's checklist — any combination of report domain(s)/
  // Invoice/Moisture Mapping Report, read from the request body instead
  // of always sending everything the job has (see createSelectedDraftForJob).
  if (kind === "custom") {
    const body = await req.json().catch(() => null);
    const domains: ReportDomain[] = Array.isArray(body?.domains) ? body.domains : [];
    const includeInvoice = Boolean(body?.includeInvoice);
    const includeMoistureMapping = Boolean(body?.includeMoistureMapping);
    const subject = typeof body?.subject === "string" ? body.subject : undefined;
    const { messageId } = await createSelectedDraftForJob(params.id, { domains, includeInvoice, includeMoistureMapping, subject });
    return NextResponse.json({ ok: true, messageId });
  }

  // Boston Harbor Water Restoration: per Tim, the report draft that goes
  // out to the whole team must never carry the invoice or payment link —
  // that's always its own separate email (see job-intake.ts's own
  // BOSTON_HARBOR_WATER_RESTORATION_COMPANY_ID comment for why this
  // company gets special-cased at all). "View Draft" would otherwise
  // build one combined draft with both, same as every other company, so
  // this one creates the report and invoice as two separate drafts
  // instead and jumps to the report — the one that's actually reviewed
  // and sent from here.
  const supabase = getSupabaseAdmin();
  const { data: jobRow } = await supabase
    .from("jobs")
    .select("customers!customer_id(company_id)")
    .eq("id", params.id)
    .single();
  const companyId = (jobRow as unknown as { customers: { company_id: string | null } } | null)?.customers?.company_id;
  if (companyId === BOSTON_HARBOR_WATER_RESTORATION_COMPANY_ID) {
    const [{ messageId }] = await Promise.all([
      createReportDraftForJob(params.id),
      createInvoiceDraftForJob(params.id),
    ]);
    return NextResponse.json({ ok: true, messageId });
  }

  const { messageId } = await createCombinedDraftForJob(params.id);
  return NextResponse.json({ ok: true, messageId });
});
