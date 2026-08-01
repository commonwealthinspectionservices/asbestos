import { NextRequest, NextResponse } from "next/server";
import { requireContractorApi, getCompanyCustomerIds } from "@/lib/contractor-api";
import { getSupabaseAdmin } from "@/lib/supabase";
import { withApiErrors } from "@/lib/api-handler";

// The only two portal-writable fields on an existing job: who gets the
// results email (report_emails) and who this specific job's invoice goes
// to (billing_contact_id, overriding the company-wide default) — both
// scoped to contacts sharing the requesting account's company_id.
export const PATCH = withApiErrors(async (
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

  const body = await req.json().catch(() => null);
  const patch: Record<string, unknown> = {};

  // Self is always included via the existing customer.email fallback (see
  // draftInvoiceEmailForJob in lib/lab-email.ts) — report_emails only ever
  // needs to carry the *additional* selected contacts.
  if (Array.isArray(body?.resultRecipientEmails)) {
    const selfEmail = auth.customer.email.toLowerCase();
    const emails = Array.from(
      new Set(
        body.resultRecipientEmails
          .map((e: unknown) => String(e).trim().toLowerCase())
          .filter((e: string) => e && e !== selfEmail)
      )
    );
    patch.report_emails = emails.length ? emails.join(",") : null;
  }

  if ("billingContactId" in (body ?? {})) {
    const billingContactId = body.billingContactId;
    if (billingContactId) {
      const { data: contact } = await supabase
        .from("customers")
        .select("id, company_id")
        .eq("id", billingContactId)
        .maybeSingle();
      if (!contact || !auth.customer.company_id || contact.company_id !== auth.customer.company_id) {
        return NextResponse.json({ error: "Invalid billing contact" }, { status: 400 });
      }
    }
    patch.billing_contact_id = billingContactId || null;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "No editable fields provided" }, { status: 400 });
  }

  const { error } = await supabase.from("jobs").update(patch).eq("id", params.id);
  if (error) throw new Error(error.message);
  return NextResponse.json({ ok: true });
});
