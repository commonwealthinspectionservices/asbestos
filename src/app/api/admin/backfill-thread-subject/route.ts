import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-api";
import { withApiErrors } from "@/lib/api-handler";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getValidAccessToken, getMessage, getHeader } from "@/lib/gmail";

// One-off: backfills email_thread_subject (added 2026-09-14, see
// schema.sql's own comment) for a job created before that column existed —
// reads the job's real Gmail thread's very first message and stores its
// actual Subject header, exactly what job-intake.ts would have captured at
// creation had the column existed then. Delete this route once used.
export const POST = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

  const { projectNumber } = await req.json();
  if (!projectNumber) return NextResponse.json({ error: "projectNumber required" }, { status: 400 });

  const supabase = getSupabaseAdmin();
  const { data: job, error } = await supabase
    .from("jobs")
    .select("id, project_number, email_gmail_thread_id, email_thread_message_ids, email_thread_subject")
    .eq("project_number", projectNumber)
    .single();
  if (error || !job) return NextResponse.json({ error: error?.message ?? "not found" }, { status: 404 });
  if (job.email_thread_subject) {
    return NextResponse.json({ ok: true, skipped: "already set", email_thread_subject: job.email_thread_subject });
  }
  if (!job.email_gmail_thread_id) {
    return NextResponse.json({ error: "job has no email_gmail_thread_id" }, { status: 400 });
  }

  const accessToken = await getValidAccessToken();
  if (!accessToken) return NextResponse.json({ error: "Gmail not connected" }, { status: 400 });

  // The thread's own first/oldest message id doubles as its own Gmail
  // message id here (same id used for both threads.get and messages.get) —
  // confirmed against this job's real thread.
  const message = await getMessage(accessToken, job.email_gmail_thread_id);
  const subject = getHeader(message, "Subject");
  if (!subject) return NextResponse.json({ error: "no Subject header found" }, { status: 400 });

  await supabase.from("jobs").update({ email_thread_subject: subject }).eq("id", job.id);

  return NextResponse.json({ ok: true, email_thread_subject: subject });
});
