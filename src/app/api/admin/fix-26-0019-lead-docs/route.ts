import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-api";
import { withApiErrors } from "@/lib/api-handler";
import { getSupabaseAdmin } from "@/lib/supabase";
import type { JobDocument } from "@/lib/types";

// One-off, 2026-09-12 (26-0019) — not a route anything else calls. Delete
// after use.
//
// Confirmed against the real PDF (Crystal Analytical's cover letter says
// "the lead testing report", pages 2-5 are SanAir's own lead-in-paint
// analysis) — this lab_report + its trailing coc got filed under "Limited
// Asbestos Inspection" instead of "Lead Bulk Sampling" (the domain-mismatch
// flag on the lab_report already caught this, but nothing moved it to the
// right place). Moves both to the correct service_type label and clears
// domain_mismatch — it's no longer a mismatch once correctly classified.
// Doesn't touch sample_results/asbestos_result (already correct, real
// asbestos data — confirmed unaffected by the mismatched upload) or any
// lead_result/lead_report_summary field, which stay for Tim's own manual
// review exactly as this app already requires for every lead job.
const JOB_ID = "02d16558-77c4-4efa-8f6a-df97bf2612b7";
const LAB_REPORT_DOC_ID = "bfbba5ac-fead-457c-bec2-fa525ad28d56";
const COC_DOC_ID = "cb89cf82-6a02-4b29-84c6-5b95d15050dc";
const CORRECT_SERVICE_TYPE = "Lead Bulk Sampling";

export const GET = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

  const supabase = getSupabaseAdmin();
  const { data: job } = await supabase.from("jobs").select("documents").eq("id", JOB_ID).maybeSingle();
  if (!job) return NextResponse.json({ error: "job not found" }, { status: 404 });

  const documents: JobDocument[] = (job.documents ?? []).map((d: JobDocument) => {
    if (d.id === LAB_REPORT_DOC_ID) {
      return { ...d, service_type: CORRECT_SERVICE_TYPE, domain_mismatch: null };
    }
    if (d.id === COC_DOC_ID) {
      return { ...d, service_type: CORRECT_SERVICE_TYPE };
    }
    return d;
  });

  await supabase.from("jobs").update({ documents }).eq("id", JOB_ID);
  return NextResponse.json({
    moved: documents.filter((d) => d.id === LAB_REPORT_DOC_ID || d.id === COC_DOC_ID),
  });
});
