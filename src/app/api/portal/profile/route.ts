import { NextRequest, NextResponse } from "next/server";
import { getContractorSession } from "@/lib/contractor-api";
import { getSupabaseAdmin } from "@/lib/supabase";
import { withApiErrors } from "@/lib/api-handler";
import { upsertCompany } from "@/lib/companies";
import { sendEmail, emailShell } from "@/lib/email";
import { getAppUrl } from "@/lib/app-url";
import { escapeHtml } from "@/lib/html";

// Called once, right after signup/first login, to link (or create) the
// customers row for this account. Not gated by requireContractorApi()
// since that requires a customer profile to already exist — this route is
// what creates it, so it only needs a valid auth session.
export const POST = withApiErrors(async (req: NextRequest) => {
  const session = await getContractorSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const name = body?.name?.trim();
  const phone = body?.phone?.trim();
  const company = body?.company?.trim() || null;
  const billingAddress = body?.billingAddress?.trim() || null;
  const accountType = body?.accountType;
  const isIndividual = accountType === "individual";

  if (!name || !phone || (!isIndividual && !company)) {
    return NextResponse.json({ error: "Name and phone are required" }, { status: 400 });
  }

  const email = (session.email ?? "").toLowerCase();
  if (!email) {
    return NextResponse.json({ error: "Account has no email on file" }, { status: 400 });
  }

  const admin = getSupabaseAdmin();

  // This account may already have a customers row from a prior anonymous
  // booking, or from an admin-sent Invite (which pre-assigns company_id) —
  // link that one rather than creating a duplicate, so their existing
  // project history/company assignment carries over to the new account.
  const { data: existing } = await admin
    .from("customers")
    .select("id, company_id")
    .eq("email", email)
    .maybeSingle();

  // Self-signup only auto-links a company that doesn't exist on file yet
  // (setting up a brand-new client, safe since nobody else is on it) — if
  // the typed name matches an existing company, leave company_id unset
  // rather than joining it automatically, since that would let anyone type
  // a real company's exact name and immediately see all of its jobs.
  // Getting added to an existing company only happens two ways: the admin
  // edits their contact directly, or sends them an Invite (which already
  // has company_id set on the contact row before the link ever exists,
  // hence preserving existing?.company_id below instead of re-deriving it).
  let newCompany = null;
  let needsCompanyReview = false;
  if (!isIndividual && company && !existing?.company_id) {
    const { data: matchedCompany } = await admin
      .from("companies")
      .select("id")
      .ilike("name", company)
      .maybeSingle();
    // No match — safe to self-service create it. A match means this name
    // already belongs to someone else on file, so leave company_id unset
    // rather than joining them to it automatically — flagged below so the
    // admin gets pinged to review and link it by hand instead.
    if (matchedCompany) {
      needsCompanyReview = true;
    } else {
      newCompany = await upsertCompany(company, { billingAddress });
    }
  }

  const patch = {
    auth_user_id: session.authUserId,
    name,
    // Canonical spelling from the newly created company row (when we made
    // one), not whatever casing this particular signup typed — keeps it in
    // sync with company_id instead of drifting from it over time.
    company: newCompany?.name ?? company,
    company_id: existing?.company_id ?? newCompany?.id ?? null,
    phone,
    billing_address: billingAddress,
    is_individual: isIndividual,
  };

  let { data: customer, error } = existing
    ? await admin.from("customers").update(patch).eq("id", existing.id).select("*").single()
    : await admin.from("customers").insert({ ...patch, email }).select("*").single();

  // Two concurrent onboarding submits for the same email (double-click,
  // a slow-network auto-retry) can both see `existing === null` above and
  // both attempt this insert — the loser hits customers_email_idx's
  // unique constraint. Same recovery as the sibling route
  // (POST /api/portal/contacts already handles this exact case): fall
  // back to updating the winner's row instead of surfacing a raw 500 for
  // what's really just an ordinary race.
  if (error?.code === "23505" && !existing) {
    ({ data: customer, error } = await admin.from("customers").update(patch).eq("email", email).select("*").single());
  }

  if (error || !customer) {
    throw new Error(`Failed to save profile: ${error?.message}`);
  }

  // Best-effort — same pattern as every other admin alert (see
  // area-health.ts, route-runner.ts): a failed notification shouldn't fail
  // the signup that already succeeded.
  if (needsCompanyReview) {
    const appUrl = getAppUrl();
    const contactUrl = appUrl ? `${appUrl}/admin/customers?tab=contacts&contactId=${customer.id}` : null;
    await sendEmail({
      to: process.env.OWNER_EMAIL!,
      subject: `Review needed: ${name} signed up for an existing company`,
      html: emailShell(`
        <p style="font-size:15px;"><strong>${escapeHtml(name)}</strong> (${escapeHtml(email)}) just signed up and entered <strong>${escapeHtml(company ?? "")}</strong> as their company — that name already matches a company on file, so they were <strong>not</strong> automatically linked to it or given access to its jobs.</p>
        <p>If they really do belong there, link them to it now, or send them an Invite from that company's other contacts going forward so this doesn't come up again.</p>
        ${contactUrl ? `<p style="margin-top:12px; font-size:13px;"><a href="${contactUrl}" style="color:#1f3f80;">Review this contact</a></p>` : ""}
      `),
    });
  }

  return NextResponse.json({ customer });
});
