import { NextRequest, NextResponse } from "next/server";
import { randomUUID, createHash } from "crypto";
import { requireAdminApi } from "@/lib/admin-api";
import { getSupabaseAdmin } from "@/lib/supabase";
import { withApiErrors } from "@/lib/api-handler";
import { computeLabCostCentsFromDocuments } from "@/lib/lab-cost";
import { checkLabInvoiceLineItemPrice } from "@/lib/lab-pricing";
import type { JobDocument } from "@/lib/types";

// One-off, 2026-09-11 — not a route anything else calls. Delete after use.
//
// Three real Crystal Analytical charges from the September 6-12, 2026
// weekly report never got attached to a job: Crystal's own export printed
// no project number at all on these three lines (confirmed against the
// real PDF, re-downloaded and read directly), so processWeeklyLabSummaryEmail's
// unmatched-transaction path is all that ever touched them — no sibling
// line in the same report shared their address either, so even the
// same-report address fallback (see its own comment in lab-email.ts)
// couldn't resolve them. Found by reconciling against Tim's real
// QuickBooks Crystal Analytical expense total (2026-09-11): a $585 gap
// between QuickBooks and the app's own lab-cost tracking, $420 of which
// is these three. Files each the same way the real pipeline would have,
// reusing the exact bytes of the report's own final/complete PDF (already
// on file under 26-0019, report_total_cents $1,255.50 — the fullest
// version of this week's report).
const SOURCE_STORAGE_PATH = "02d16558-77c4-4efa-8f6a-df97bf2612b7/8fd49ae1-d0a9-4a12-b226-8b266daa6857-weekly-lab-summary.pdf";
const REPORT_TOTAL_CENTS = 125550;
const REPORT_DATE_RANGE = "September 6-12, 2026";

const CORRECTIONS = [
  {
    projectNumber: "26-0010",
    num: "6559",
    amountCents: 14400,
    testDescription: "Analytical Services:Asbestos Analysis:PLM - Bulk CVE, Per-Layer - 24 Hr TAT",
    unitPriceCents: 1200,
  },
  {
    projectNumber: "26-0017",
    num: "6614",
    amountCents: 18000,
    testDescription: "Analytical Services:Asbestos Analysis:PLM - Bulk CVE, Per-Layer - 3Hr TAT",
    unitPriceCents: 1500,
  },
  {
    projectNumber: "26-0018",
    num: "6680",
    amountCents: 9600,
    testDescription: "Analytical Services:Asbestos Analysis:PLM - Bulk CVE, Per-Layer - 24 Hr TAT",
    unitPriceCents: 1200,
  },
] as const;

export const GET = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

  const dryRun = req.nextUrl.searchParams.get("dryRun") !== "false";
  const supabase = getSupabaseAdmin();

  const { data: pdfBlob, error: downloadError } = await supabase.storage.from("job-documents").download(SOURCE_STORAGE_PATH);
  if (downloadError || !pdfBlob) {
    return NextResponse.json({ error: `Failed to download source PDF: ${downloadError?.message}` }, { status: 500 });
  }
  const pdfBuffer = Buffer.from(await pdfBlob.arrayBuffer());
  const contentHash = createHash("sha256").update(pdfBuffer).digest("hex");

  const results: Record<string, unknown>[] = [];

  for (const c of CORRECTIONS) {
    const { data: job } = await supabase.from("jobs").select("*").eq("project_number", c.projectNumber).maybeSingle();
    if (!job) {
      results.push({ projectNumber: c.projectNumber, skipped: "job not found" });
      continue;
    }

    const existing = ((job.documents ?? []) as JobDocument[]).filter(
      (d) => d.kind === "lab_invoice" && d.lab_invoice_number === c.num
    );
    if (existing.length > 0) {
      results.push({ projectNumber: c.projectNumber, skipped: "already filed" });
      continue;
    }

    const priceCheck = checkLabInvoiceLineItemPrice(c.testDescription, c.unitPriceCents);
    const flag = !priceCheck.ok && priceCheck.expectedUnitPriceCents != null
      ? `Billed $${(c.unitPriceCents / 100).toFixed(2)}/sample, expected $${(priceCheck.expectedUnitPriceCents / 100).toFixed(2)}/sample.`
      : priceCheck.expectedUnitPriceCents == null
      ? `Unrecognized test/turnaround — price not verified (billed $${(c.unitPriceCents / 100).toFixed(2)}/sample).`
      : null;

    if (!dryRun) {
      const docId = randomUUID();
      const storagePath = `${job.id}/${docId}-weekly-lab-summary.pdf`;
      const { error: uploadError } = await supabase.storage.from("job-documents").upload(storagePath, pdfBuffer, { contentType: "application/pdf" });
      if (uploadError) {
        results.push({ projectNumber: c.projectNumber, error: uploadError.message });
        continue;
      }

      const serviceTypeLabels = (job.service_type ?? "").split(",").map((s: string) => s.trim()).filter(Boolean);
      const uploadedAt = new Date().toISOString();
      const newDocs: JobDocument[] = (serviceTypeLabels.length > 0 ? serviceTypeLabels : [""]).map((label: string) => ({
        id: randomUUID(),
        kind: "lab_invoice",
        service_type: label,
        file_name: `weekly-lab-summary-${c.num}.pdf`,
        storage_path: storagePath,
        uploaded_at: uploadedAt,
        project_number_mismatch: null,
        lab_invoice_number: c.num,
        amount_cents: c.amountCents,
        content_hash: contentHash,
        report_total_cents: REPORT_TOTAL_CENTS,
        report_date_range: REPORT_DATE_RANGE,
        lab_invoice_flag: flag,
      }));
      const mergedDocuments = [...(job.documents ?? []), ...newDocs];
      const newLabCostCents = computeLabCostCentsFromDocuments(mergedDocuments);

      await supabase.from("jobs").update({ documents: mergedDocuments, lab_cost_cents: newLabCostCents }).eq("id", job.id);
      results.push({ projectNumber: c.projectNumber, filedAmountCents: c.amountCents, newLabCostCents, flag });
    } else {
      results.push({ projectNumber: c.projectNumber, wouldFileAmountCents: c.amountCents, flag });
    }
  }

  return NextResponse.json({ dryRun, results });
});
