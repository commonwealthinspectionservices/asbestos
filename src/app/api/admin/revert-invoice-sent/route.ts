import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-api";
import { withApiErrors } from "@/lib/api-handler";
import { getSupabaseAdmin } from "@/lib/supabase";

// Corrects a mistaken mark-report-invoice-sent call that marked BOTH
// report and invoice sent when only the report had actually gone out.
// Reverts invoice_sent_at and status back to the un-sent-invoice state
// (report_sent_at is left untouched — that one really did happen).
// Delete this route after use.
export const POST = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

  const { projectNumber } = await req.json();
  if (!projectNumber) return NextResponse.json({ error: "projectNumber required" }, { status: 400 });

  const supabase = getSupabaseAdmin();
  const { data: job, error } = await supabase
    .from("jobs")
    .select("id, status, report_sent_at")
    .eq("project_number", projectNumber)
    .single();
  if (error || !job) return NextResponse.json({ error: error?.message ?? "not found" }, { status: 404 });

  // Matches JobsDashboard.tsx's own status derivation
  // (`job.invoice_sent_at ? "report_invoice_sent" : "ready_to_send"`).
  const update = { invoice_sent_at: null, status: "ready_to_send" };
  await supabase.from("jobs").update(update).eq("id", job.id);

  return NextResponse.json({ ok: true, update, report_sent_at_unchanged: job.report_sent_at });
});
