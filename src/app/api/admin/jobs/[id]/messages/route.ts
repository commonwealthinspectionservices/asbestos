import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-api";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getSettings } from "@/lib/settings";
import { sendEmail, emailShell } from "@/lib/email";
import { escapeHtml } from "@/lib/html";
import { getAppUrl } from "@/lib/app-url";
import { withApiErrors } from "@/lib/api-handler";
import type { Job } from "@/lib/types";

export const GET = withApiErrors(async (
  req: NextRequest,
  { params }: { params: { id: string } }
) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

  const supabase = getSupabaseAdmin();
  const { data: messages, error } = await supabase
    .from("job_messages")
    .select("*")
    .eq("job_id", params.id)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);

  // Opening the tab is the read receipt — mark anything the customer sent
  // as read by the admin now that they're looking at it.
  await supabase
    .from("job_messages")
    .update({ read_by_admin: true })
    .eq("job_id", params.id)
    .eq("sender_role", "customer")
    .eq("read_by_admin", false);

  return NextResponse.json({ messages: messages ?? [] });
});

export const POST = withApiErrors(async (
  req: NextRequest,
  { params }: { params: { id: string } }
) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

  const body = await req.json().catch(() => null);
  const text = body?.body?.trim();
  if (!text) {
    return NextResponse.json({ error: "Message body is required" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { data: job, error: jobError } = await supabase
    .from("jobs")
    .select("*, customers!customer_id(*)")
    .eq("id", params.id)
    .single();
  if (jobError || !job) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  const jobRow = job as unknown as Job & { customers: { email: string; name: string } };

  const settings = await getSettings();

  const { data: message, error: insertError } = await supabase
    .from("job_messages")
    .insert({
      job_id: params.id,
      sender_role: "admin",
      sender_name: settings.owner_name || settings.business_name,
      body: text,
      read_by_admin: true,
      read_by_customer: false,
    })
    .select("*")
    .single();
  if (insertError || !message) {
    throw new Error(`Failed to send message: ${insertError?.message}`);
  }

  if (jobRow.customers?.email) {
    const appUrl = getAppUrl();
    const portalLink = appUrl ? `${appUrl}/portal/dashboard` : "";
    await sendEmail({
      to: jobRow.customers.email,
      subject: `New message about project ${jobRow.project_number ?? ""}`,
      html: emailShell(`
        <p>Hi ${escapeHtml(jobRow.customers.name)},</p>
        <p>${escapeHtml(settings.owner_name || settings.business_name)} sent you a message about your project${jobRow.project_number ? ` (${escapeHtml(jobRow.project_number)})` : ""}:</p>
        <p style="padding:12px; background:#f4f6fb; border-radius:8px; color:#16213a;">${escapeHtml(text)}</p>
        ${portalLink ? `<p><a href="${portalLink}">View and reply in your project portal</a></p>` : ""}
      `),
    });
  }

  return NextResponse.json({ message });
});
