import { NextRequest, NextResponse } from "next/server";
import { requireContractorApi, getCompanyCustomerIds } from "@/lib/contractor-api";
import { getSupabaseAdmin } from "@/lib/supabase";
import { sendEmail, emailShell } from "@/lib/email";
import { escapeHtml } from "@/lib/html";
import { getAppUrl } from "@/lib/app-url";
import { withApiErrors } from "@/lib/api-handler";

export const GET = withApiErrors(async (
  req: NextRequest,
  { params }: { params: { id: string } }
) => {
  const auth = await requireContractorApi();
  if (auth.error) return auth.error;

  const companyCustomerIds = await getCompanyCustomerIds(auth.customer);

  const supabase = getSupabaseAdmin();
  const { data: job } = await supabase
    .from("jobs")
    .select("id")
    .eq("id", params.id)
    .in("customer_id", companyCustomerIds)
    .maybeSingle();
  if (!job) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const { data: messages, error } = await supabase
    .from("job_messages")
    .select("*")
    .eq("job_id", params.id)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);

  // Opening the tab is the read receipt — mark anything the admin sent as
  // read by the client now that they're looking at it.
  await supabase
    .from("job_messages")
    .update({ read_by_customer: true })
    .eq("job_id", params.id)
    .eq("sender_role", "admin")
    .eq("read_by_customer", false);

  return NextResponse.json({ messages: messages ?? [] });
});

export const POST = withApiErrors(async (
  req: NextRequest,
  { params }: { params: { id: string } }
) => {
  const auth = await requireContractorApi();
  if (auth.error) return auth.error;

  const body = await req.json().catch(() => null);
  const text = body?.body?.trim();
  if (!text) {
    return NextResponse.json({ error: "Message body is required" }, { status: 400 });
  }

  const companyCustomerIds = await getCompanyCustomerIds(auth.customer);

  const supabase = getSupabaseAdmin();
  const { data: job } = await supabase
    .from("jobs")
    .select("id, project_number")
    .eq("id", params.id)
    .in("customer_id", companyCustomerIds)
    .maybeSingle();
  if (!job) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const { data: message, error: insertError } = await supabase
    .from("job_messages")
    .insert({
      job_id: params.id,
      sender_role: "customer",
      sender_name: auth.customer.name,
      body: text,
      read_by_admin: false,
      read_by_customer: true,
    })
    .select("*")
    .single();
  if (insertError || !message) {
    throw new Error(`Failed to send message: ${insertError?.message}`);
  }

  if (process.env.OWNER_EMAIL) {
    const appUrl = getAppUrl();
    const adminLink = appUrl ? `${appUrl}/admin` : "";
    await sendEmail({
      to: process.env.OWNER_EMAIL,
      subject: `New message about project ${job.project_number ?? ""}`,
      html: emailShell(`
        <p>${escapeHtml(auth.customer.name)} sent a message about project${job.project_number ? ` ${escapeHtml(job.project_number)}` : ""}:</p>
        <p style="padding:12px; background:#f4f6fb; border-radius:8px; color:#16213a;">${escapeHtml(text)}</p>
        ${adminLink ? `<p><a href="${adminLink}">View and reply in the admin dashboard</a></p>` : ""}
      `),
    });
  }

  return NextResponse.json({ message });
});
