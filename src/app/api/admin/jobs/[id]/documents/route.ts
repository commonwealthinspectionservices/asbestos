import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
// Imports the implementation directly rather than the package root — the
// root index.js has a debug-only block that (when bundled by webpack/Next)
// unconditionally tries to read a test fixture PDF that only exists inside
// pdf-parse's own node_modules folder, breaking the production build.
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import { requireAdminApi } from "@/lib/admin-api";
import { getSupabaseAdmin } from "@/lib/supabase";
import { withApiErrors } from "@/lib/api-handler";
import { extractSampleCount, detectAsbestosResult, extractSampleResults, extractReportProjectNumber, detectLabInfo, extractMoldSampleCount, extractMoldSampleResults, extractSampledDate, extractCrystalAnalyticalMaterialDescriptions } from "@/lib/parse-lab-report";
import { isLabInvoiceText, extractLabInvoiceTotalCents, extractInvoiceNumber } from "@/lib/parse-lab-invoice";
import { computeLabCostCentsFromDocuments } from "@/lib/lab-cost";
import { splitTrailingCocPages } from "@/lib/split-lab-report-coc";
import { extractPositionOrderedText } from "@/lib/pdf-position-text";
import { ASBESTOS_NEGATIVE_REMARK, ASBESTOS_POSITIVE_REMARK } from "@/lib/report-findings";
import type { Job, JobDocument } from "@/lib/types";

const DOCUMENT_KINDS = new Set(["coc", "lab_report", "lab_invoice", "report", "other"]);

// Scanned chain-of-custody forms and lab report PDFs get kept on file
// forever alongside the job — the actual sample-level record of what was
// taken, since the app itself only tracks a sample count.
export const POST = withApiErrors(async (
  req: NextRequest,
  { params }: { params: { id: string } }
) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

  const formData = await req.formData().catch(() => null);
  const file = formData?.get("file");
  const kind = formData?.get("kind");
  const serviceType = formData?.get("serviceType");

  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "A file is required" }, { status: 400 });
  }
  if (typeof kind !== "string" || !DOCUMENT_KINDS.has(kind)) {
    return NextResponse.json({ error: `kind must be one of: ${[...DOCUMENT_KINDS].join(", ")}` }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { data: job, error: jobError } = await supabase
    .from("jobs")
    .select("*")
    .eq("id", params.id)
    .single();

  if (jobError || !job) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  const jobRow = job as unknown as Job;

  const docId = randomUUID();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const storagePath = `${params.id}/${docId}-${safeName}`;
  const fileBuffer = Buffer.from(await file.arrayBuffer());

  const update: Record<string, unknown> = {};
  let projectNumberMismatch: string | null = null;
  let domainMismatch = false;
  let invoiceMismatch = false;
  let invoiceAmountCents: number | null = null;
  let invoiceNumber: string | null = null;

  // Lab results PDFs list one row (asbestos) or one column (mold's
  // Air-O-Cell/Swab genus tables) per physical sample — pull the count
  // straight from the report instead of making the admin count and re-type
  // it by hand. Best effort: any parsing failure just leaves the count for
  // manual entry.
  if (kind === "lab_report" && typeof serviceType === "string" && serviceType && file.type === "application/pdf") {
    try {
      const { text } = await pdfParse(fileBuffer);
      const isMold = /mold/i.test(serviceType);
      const isLead = /lead/i.test(serviceType);
      // Per Tim, 2026-08-27 — same "fungal" signal the automated lab-email
      // path uses to tell mold and asbestos reports apart (see
      // isMoldLabReport in lib/lab-email.ts), checked here too: a manual
      // upload is picked by hand, so this catches the admin choosing the
      // wrong service type from the dropdown, not just an automated
      // misclassification. Only flags mold vs. not-mold — lead reports
      // don't have their own equivalent keyword yet.
      const looksLikeFungalReport = /fungal/i.test(text);
      if (!isLead && isMold !== looksLikeFungalReport) domainMismatch = true;

      // See pdf-position-text.ts — Crystal Analytical's tables (and its
      // "Date(s) Sampled:"/"Collected:" line, see extractSampledDate) only
      // parse correctly from reading-order text, not the raw PDF stream.
      // Computed once, up front, since the sample count below, the
      // sample-by-sample results/positive-negative call further down, and
      // the sampled-date extraction all need it — using it for some but
      // not others let them disagree (26-0001, live: sample_counts said 2,
      // sample_results correctly listed all 4 of the same report's
      // samples). Not needed for lead — not in scope yet.
      const positionOrderedText = !isLead ? await extractPositionOrderedText(fileBuffer) : undefined;

      const count = isMold ? extractMoldSampleCount(text, serviceType) : extractSampleCount(text, positionOrderedText);
      if (count != null) {
        update.sample_counts = { ...(jobRow.sample_counts ?? {}), [serviceType]: count };
      }

      // The report's own actual sample-collection date — see
      // extractSampledDate's own comment for why this isn't requested_date
      // (the scheduled/booked date, which can differ from when the tech
      // actually collected samples). One field per domain, same as
      // lab_name/mold_lab_name/lead_lab_name above.
      const sampledDate = extractSampledDate(text, positionOrderedText);
      if (sampledDate != null) {
        if (isMold) update.mold_date_sampled = sampledDate;
        else if (isLead) update.lead_date_sampled = sampledDate;
        else update.lab_date_sampled = sampledDate;
      }

      // The lab's own identity/certs are constant per lab — no need to make
      // the admin type them in by hand once the report format is recognized.
      // Written to each domain's own separate field — mold_lab_name,
      // lead_lab_name/lead_lab_cert, or asbestos's plain lab_name/
      // lab_nist_cert/lab_massdls_cert — never a shared one. A job combining
      // domains can use two different labs, and until this split, whichever
      // domain's report got uploaded second would silently overwrite the
      // other's lab name/certs.
      const labInfo = detectLabInfo(text);
      if (labInfo) {
        if (isMold) {
          update.mold_lab_name = labInfo.labName;
        } else if (isLead) {
          update.lead_lab_name = labInfo.labName;
          update.lead_lab_cert = labInfo.nistCert;
        } else {
          update.lab_name = labInfo.labName;
          update.lab_nist_cert = labInfo.nistCert;
          update.lab_massdls_cert = labInfo.massdlsCert;
        }
      }

      if (isMold) {
        // No asbestos-style pass/fail for mold — genus-level findings live
        // only in the uploaded report itself. Just confirms which samples
        // were actually received and analyzed (see extractMoldSampleResults).
        // Mold's own field, separate from asbestos/lead's sample_results
        // below, so the two domains' per-sample lists never clobber
        // each other on a mixed job.
        const sampleResults = extractMoldSampleResults(text, serviceType);
        if (sampleResults.length > 0) {
          // Tagged per-label (serviceType above), not overwritten wholesale
          // — Crystal Analytical bundles every mold method into one PDF
          // that gets uploaded once per label (Air Sampling, then Bulk
          // Sampling), so a second upload replacing the whole array would
          // wipe out the first label's own results. Only this upload's own
          // label's prior entries get replaced; every other label's stay.
          const priorOtherLabels = (jobRow.mold_sample_results ?? []).filter((r) => r.serviceType !== serviceType);
          update.mold_sample_results = [...priorOtherLabels, ...sampleResults];
        }
      }

      // Positive/negative for the final report — asbestos jobs only, for
      // now (lead isn't in scope yet). Recognizes both EMSL's and Crystal
      // Analytical's report layouts (see bestReportSamplesAnyLab in
      // lib/parse-lab-report.ts); an unrecognized format just leaves this
      // for the admin to set by hand on the Final Report tab.
      if (/asbestos/i.test(serviceType)) {
        const result = detectAsbestosResult(text, positionOrderedText);
        if (result != null) {
          update.asbestos_result = result;
          // The positive/negative flag alone doesn't fill in the letter's
          // actual findings sentence — that's report_summary, which only
          // ever got set by an admin picking from the Result dropdown.
          // Confirmed live on 26-0001: asbestos_result auto-filled
          // "negative" but report_summary stayed blank, so the Result
          // field (and the report itself) still looked unfilled. Default
          // it to the same canned remark the dropdown would set for this
          // result — only when nothing's there yet, so a manually-edited
          // summary from a prior upload is never overwritten.
          if (!jobRow.report_summary) {
            update.report_summary = result === "positive" ? ASBESTOS_POSITIVE_REMARK : ASBESTOS_NEGATIVE_REMARK;
          }
        }
        const sampleResults = extractSampleResults(text, positionOrderedText);
        if (sampleResults.length > 0) {
          // Per Tim, 2026-08-31 — see the matching comment in lab-email.ts
          // (the automated-email upload path) for why this merges rather
          // than replaces, and why it's Crystal-Analytical-only for now.
          const labName = (labInfo?.labName ?? jobRow.lab_name ?? "").toLowerCase();
          let resultsWithMaterial = sampleResults;
          if (positionOrderedText && labName.includes("crystal analytical")) {
            const materials = extractCrystalAnalyticalMaterialDescriptions(positionOrderedText);
            // Per Tim, 2026-09-01 — material shown for every sample row now,
            // not just positive ones — see the matching comment in
            // lab-email.ts.
            resultsWithMaterial = sampleResults.map((s) => (materials[s.fieldCode] ? { ...s, material: materials[s.fieldCode] } : s));
            const existingByCode = new Map((jobRow.sample_findings ?? []).map((f) => [f.fieldCode, f]));
            const findings = sampleResults
              .filter((s) => /%/.test(s.result))
              .map((s) => {
                const existing = existingByCode.get(s.fieldCode);
                return {
                  fieldCode: s.fieldCode,
                  material: materials[s.fieldCode] || existing?.material || "",
                  estimated_quantity: existing?.estimated_quantity ?? "",
                  unit: existing?.unit ?? "sq_ft",
                };
              });
            if (findings.length > 0) update.sample_findings = findings;
          }
          update.sample_results = resultsWithMaterial;
        }
      }

      // The report itself almost always echoes the client's own project
      // number back somewhere in its text (EMSL always does, right after
      // its own "Project:" label; Crystal Analytical's own reports embed it
      // too, just without that exact label — see extractReportProjectNumber's
      // generic fallback) — catches uploading the right kind of file to the
      // wrong job by mistake. Only flags when the report clearly names a
      // *different* number; says nothing when it can't find one at all. A
      // flag only — the rest of the extraction above still runs and saves
      // normally either way.
      // Per Tim, 2026-08-31 — an FLI Environmental subcontract job's own
      // report never echoes this app's internal project_number at all —
      // Crystal Analytical's "FLI Project#:" field carries FLI's own
      // number instead (confirmed live on 26-0011: extracted "26-3115",
      // this app's own number is "26-0011" — same "26-NNNN" shape, FLI
      // runs its own numbering the same way, so every such upload would
      // otherwise get flagged as a false mismatch). Compare against
      // fli_project_number when the job has one on file instead.
      // Per Tim, 2026-09-02 — confirmed wrong live on 26-0002.1: a revisit's
      // own physical paperwork almost always carries just the base project
      // number ("26-0002"), never the ".1" suffix this app appends on its
      // own (see is_revisit's own comment in types.ts and the matching
      // "prefer an open revisit" logic in lab-email.ts) — the lab has no
      // way to know a revisit happened, so that's expected, not a real
      // mismatch. Accept either form.
      const reportProjectNumber = extractReportProjectNumber(text);
      const expectedProjectNumber = jobRow.fli_project_number || jobRow.project_number;
      const expectedBaseProjectNumber = expectedProjectNumber?.split(".")[0];
      if (
        reportProjectNumber &&
        expectedProjectNumber &&
        reportProjectNumber.toLowerCase() !== expectedProjectNumber.toLowerCase() &&
        reportProjectNumber.toLowerCase() !== expectedBaseProjectNumber?.toLowerCase()
      ) {
        projectNumberMismatch = reportProjectNumber;
      }
    } catch {
      // Not a recognized report format, or an unreadable PDF — leave
      // sample_counts and asbestos_result untouched for the admin to fill
      // in by hand.
    }
  }

  // Per Tim, 2026-08-28 — the Lab Invoice station had no content check at
  // all (unlike Laboratory Results just above), so a finished report
  // dragged into the wrong drop zone by mistake was accepted silently —
  // exactly the "bad PDF upload" Tim described. Same isLabInvoiceText
  // signal the automated Gmail pipeline uses to tell an invoice apart from
  // a results report (see lib/parse-lab-invoice.ts) — best-effort, same
  // as the domain check above: any parsing failure just leaves this
  // unflagged rather than blocking the upload.
  if (kind === "lab_invoice" && file.type === "application/pdf") {
    try {
      const { text } = await pdfParse(fileBuffer);
      if (!isLabInvoiceText(text)) invoiceMismatch = true;
      // Per Tim, 2026-08-28 — same amount_cents/lab_invoice_number every
      // automated path now sets (see computeLabCostCentsFromDocuments in
      // lib/lab-cost.ts), so a manually-uploaded/re-uploaded invoice feeds
      // this job's lab_cost_cents the same way an automated one would,
      // instead of only ever clearing the invoice_mismatch flag.
      invoiceAmountCents = extractLabInvoiceTotalCents(text);
      invoiceNumber = extractInvoiceNumber(text);
    } catch {
      // Unreadable PDF — leave unflagged; nothing else here depends on it.
    }
  }

  // Crystal Analytical (and similarly-shaped labs) send back one PDF with
  // the typed lab data pages followed by the scanned, handwritten chain-of-
  // custody form as the trailing page(s) — never a separate file. Splitting
  // it here means the Laboratory Results station only ever holds the lab's
  // own data pages, and the CoC form gets filed on the Chain of Custody
  // station automatically, same as the inbound-email path already does.
  // Run only after the pdfParse-based extraction above is fully done —
  // splitTrailingCocPages dynamically imports pdf-lib, which corrupts
  // pdf-parse's bundled legacy pdf.js state for any pdfParse call after it
  // (see split-lab-report-coc.ts's own comment on this).
  const split =
    kind === "lab_report" && file.type === "application/pdf"
      ? await splitTrailingCocPages(fileBuffer).catch(() => null)
      : null;
  const reportBuffer = split?.reportBuffer ?? fileBuffer;
  const cocBuffer = split?.cocBuffer ?? null;

  const { error: uploadError } = await supabase.storage
    .from("job-documents")
    .upload(storagePath, reportBuffer, {
      contentType: file.type || "application/octet-stream",
    });
  if (uploadError) {
    throw new Error(`Failed to upload document: ${uploadError.message}`);
  }

  const documents: JobDocument[] = [
    {
      id: docId,
      kind: kind as JobDocument["kind"],
      service_type: typeof serviceType === "string" ? serviceType : "",
      file_name: file.name,
      storage_path: storagePath,
      uploaded_at: new Date().toISOString(),
      project_number_mismatch: projectNumberMismatch,
      domain_mismatch: domainMismatch || null,
      invoice_mismatch: invoiceMismatch || null,
      ...(kind === "lab_invoice" ? { lab_invoice_number: invoiceNumber, amount_cents: invoiceAmountCents } : {}),
    },
  ];

  if (cocBuffer) {
    const cocDocId = randomUUID();
    const cocStoragePath = `${params.id}/${cocDocId}-coc.pdf`;
    const { error: cocUploadError } = await supabase.storage
      .from("job-documents")
      .upload(cocStoragePath, cocBuffer, { contentType: "application/pdf" });
    if (!cocUploadError) {
      documents.push({
        id: cocDocId,
        kind: "coc",
        service_type: typeof serviceType === "string" ? serviceType : "",
        file_name: "coc.pdf",
        storage_path: cocStoragePath,
        uploaded_at: new Date().toISOString(),
        project_number_mismatch: null,
      });
    }
  }

  // Per Tim, 2026-08-27 — a prior lab_report upload for this exact same
  // service type gets superseded (removed), not just appended alongside,
  // when this new one is also a lab_report. Without this, replacing a
  // document that got flagged domain_mismatch (see the check above and
  // report-packet.ts's DomainMismatchError) could never actually clear
  // that flag — the old flagged row would just keep sitting in the array
  // forever, permanently blocking this domain's report even after the
  // admin fixed it. Per Tim, 2026-08-28 — lab_invoice gets the same
  // treatment now that it has its own mismatch flag above: re-uploading
  // the correct file needs to actually clear a flagged invoice_mismatch,
  // not just add a second document alongside the bad one.
  const priorDocuments =
    kind === "lab_report" || kind === "lab_invoice"
      ? (jobRow.documents ?? []).filter((d) => !(d.kind === kind && d.service_type === serviceType))
      : (jobRow.documents ?? []);
  update.documents = [...priorDocuments, ...documents];
  if (kind === "lab_invoice") {
    update.lab_cost_cents = computeLabCostCentsFromDocuments(update.documents as JobDocument[]);
  }

  // asbestos_result/sample_results may not exist yet if these migrations
  // haven't been run — tolerate that rather than losing the document
  // upload itself over it.
  const TOLERATED_MISSING_COLUMNS = ["asbestos_result", "sample_results", "sample_findings"];
  let updated: Record<string, unknown> | null = null;
  let updateError: { message?: string } | null = null;
  for (let attempt = 0; attempt <= TOLERATED_MISSING_COLUMNS.length; attempt++) {
    ({ data: updated, error: updateError } = await supabase
      .from("jobs")
      .update(update)
      .eq("id", params.id)
      .select("*")
      .single());
    if (!updateError) break;
    const missingColumn = TOLERATED_MISSING_COLUMNS.find(
      (col) => col in update && new RegExp(col, "i").test(updateError?.message ?? "")
    );
    if (!missingColumn) break;
    delete update[missingColumn];
  }

  if (updateError || !updated) {
    return NextResponse.json({ error: updateError?.message }, { status: 500 });
  }
  return NextResponse.json({ job: updated });
});
