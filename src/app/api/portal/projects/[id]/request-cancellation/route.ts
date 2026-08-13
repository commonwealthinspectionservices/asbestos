import { NextRequest, NextResponse } from "next/server";
import { requireContractorApi, getCompanyCustomerIds } from "@/lib/contractor-api";
import { getSupabaseAdmin } from "@/lib/supabase";
import { sendEmail, emailShell } from "@/lib/email";
import { escapeHtml } from "@/lib/html";
import { getAppUrl } from "@/lib/app-url";
import { withApiErrors } from "@/lib/api-handler";

// A notification only — doesn't touch job.status itself. Cancelling a
// project can mean coordinating with the lab or a contractor already on
// the way, so that stays a deliberate action on the admin's own dashboard
// rather than something a client click does automatically.
export const POST = withApiErrors(async (
  req: NextRequest,
  { params }: { params: { id: string } }
) => {
  const auth = await requireContractorApi();
  if (auth.error) return auth.error;

  const companyCustomerIds = await getCompanyCustomerIds(auth.customer);

  const supabase = getSupabaseAdmin();
  const { data: job } = await supabase
    .from("jobs")
    .select("id, project_number, service_address")
    .eq("id", params.id)
    .in("customer_id", companyCustomerIds)
    .maybeSingle();
  if (!job) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  // The real record of the request — set regardless of whether the email
  // below actually sends, so a Resend hiccup can never make this request
  // vanish without a trace. See the schema.sql comment on this column.
  await supabase
    .from("jobs")
    .update({ cancellation_requested_at: new Date().toISOString() })
    .eq("id", params.id)
    .is("cancellation_requested_at", null);

  if (process.env.OWNER_EMAIL) {
    const appUrl = getAppUrl();
    const adminLink = appUrl ? `${appUrl}/admin` : "";
    await sendEmail({
      to: process.env.OWNER_EMAIL,
      subject: `Cancellation requested — project ${job.project_number ?? ""}`,
      html: emailShell(`
        <p>${escapeHtml(auth.customer.name)} requested cancellation of project${job.project_number ? ` ${escapeHtml(job.project_number)}` : ""}:</p>
        <p style="padding:12px; background:#f4f6fb; border-radius:8px; color:#16213a;">${escapeHtml(job.service_address ?? "")}</p>
        ${adminLink ? `<p><a href="${adminLink}">Open in the admin dashboard</a></p>` : ""}
      `),
    });
  }

  return NextResponse.json({ ok: true });
});
