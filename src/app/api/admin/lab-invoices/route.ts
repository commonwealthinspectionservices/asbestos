import { NextRequest, NextResponse } from "next/server";
import { requireOwnerApi } from "@/lib/admin-api";
import { withApiErrors } from "@/lib/api-handler";
import { getSupabaseAdmin } from "@/lib/supabase";

/**
 * One entry per real, distinct document Crystal Analytical has ever sent
 * (deduped by content_hash — the same daily/weekly summary PDF often
 * ends up attached to several jobs, one per job it actually bills), with
 * every job that references it. Per Tim, 2026-09-15 — "make sure I have
 * everything in one spot": scans every job's own documents rather than
 * a separate ledger, so this can never drift out of sync with what each
 * job actually has on file — see BillingView.tsx's own similar
 * weeklyLabInvoicePdfHrefs for the closest existing precedent, which
 * this generalizes into its own full page instead of just a per-week
 * PDF link.
 */
export const GET = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireOwnerApi(req);
  if (unauthorized) return unauthorized;

  const supabase = getSupabaseAdmin();
  const { data: jobs, error } = await supabase
    .from("jobs")
    .select("id, project_number, service_address, documents");
  if (error) throw new Error(error.message);

  type Doc = {
    id: string;
    kind: string;
    file_name: string;
    storage_path: string;
    content_hash?: string | null;
    uploaded_at: string;
    report_date_range?: string | null;
  };

  const byHash = new Map<string, {
    fileName: string;
    uploadedAt: string;
    reportDateRange: string | null;
    viewHref: string;
    jobs: { id: string; projectNumber: string; address: string }[];
  }>();

  for (const job of (jobs as unknown as { id: string; project_number: string; service_address: string; documents: Doc[] | null }[])) {
    for (const doc of job.documents ?? []) {
      if (doc.kind !== "lab_invoice") continue;
      const key = doc.content_hash || doc.storage_path;
      const viewHref = `/api/admin/jobs/${job.id}/documents/${doc.id}`;
      const existing = byHash.get(key);
      if (existing) {
        if (!existing.jobs.some((j) => j.id === job.id)) {
          existing.jobs.push({ id: job.id, projectNumber: job.project_number, address: job.service_address });
        }
        // Earliest upload wins for display — the first time this exact
        // file actually arrived, not a later job's own re-attachment of
        // the same bytes.
        if (doc.uploaded_at < existing.uploadedAt) {
          existing.uploadedAt = doc.uploaded_at;
          existing.fileName = doc.file_name;
          existing.viewHref = viewHref;
        }
      } else {
        byHash.set(key, {
          fileName: doc.file_name,
          uploadedAt: doc.uploaded_at,
          reportDateRange: doc.report_date_range ?? null,
          viewHref,
          jobs: [{ id: job.id, projectNumber: job.project_number, address: job.service_address }],
        });
      }
    }
  }

  const documents = [...byHash.values()]
    .map((d) => ({ ...d, jobs: d.jobs.sort((a, b) => a.projectNumber.localeCompare(b.projectNumber, undefined, { numeric: true })) }))
    .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));

  return NextResponse.json({ documents });
});
