import { NextRequest, NextResponse } from "next/server";
import { requireContractorApi } from "@/lib/contractor-api";
import { getSupabaseAdmin } from "@/lib/supabase";
import { upsertCompany } from "@/lib/companies";
import { withApiErrors } from "@/lib/api-handler";

// A "contact" is just a customers row sharing the account's company_id —
// no login of its own (auth_user_id stays null), purely a directory entry
// so the account can pick who gets results/invoices per job. Reuses the
// exact same companies/billing_contact_id machinery the admin dashboard
// already has for this, rather than a parallel structure.
export const GET = withApiErrors(async () => {
  const auth = await requireContractorApi();
  if (auth.error) return auth.error;

  if (!auth.customer.company_id) {
    return NextResponse.json({ contacts: [], billingContactId: null, selfId: auth.customer.id });
  }

  const supabase = getSupabaseAdmin();
  const [{ data: contacts }, { data: company }] = await Promise.all([
    supabase
      .from("customers")
      .select("id, name, email, phone, auth_user_id, onboarding_completed_at")
      .eq("company_id", auth.customer.company_id)
      .order("created_at", { ascending: true }),
    supabase.from("companies").select("billing_contact_id").eq("id", auth.customer.company_id).single(),
  ]);

  return NextResponse.json({
    // Supabase creates the auth account (and sets auth_user_id, via the
    // on_auth_user_created trigger) the instant an invite is generated —
    // well before the person actually opens the email and sets a password.
    // hasLogin only means "actually finished," so the Invite button doesn't
    // permanently vanish for someone who was invited but never followed
    // through; `invited` distinguishes that pending state from "never
    // invited at all" so it's not confused with either extreme.
    contacts: (contacts ?? []).map(({ auth_user_id, onboarding_completed_at, ...rest }) => ({
      ...rest,
      hasLogin: Boolean(auth_user_id) && Boolean(onboarding_completed_at),
      invited: Boolean(auth_user_id) && !onboarding_completed_at,
    })),
    billingContactId: company?.billing_contact_id ?? null,
    selfId: auth.customer.id,
  });
});

export const POST = withApiErrors(async (req: NextRequest) => {
  const auth = await requireContractorApi();
  if (auth.error) return auth.error;

  const body = await req.json().catch(() => null);
  const email = body?.email?.trim()?.toLowerCase();
  if (!email) {
    return NextResponse.json({ error: "Email is required" }, { status: 400 });
  }

  // Per Tim, 2026-09-04 — a real "Adina Koch" row in the companies table,
  // created by exactly this path: TeammatesSection is hidden for
  // individuals client-side (see AccountForm's `!isIndividual` check), but
  // that's UI-only gating and this route never checked is_individual
  // itself, so anything reaching it anyway (client/server account-type
  // flags can drift out of sync — session.accountType comes from Supabase
  // Auth metadata, is_individual from the customers row, set in different
  // places) would lazily provision a company named after the individual
  // and merge their own name/company fields — the exact shape of that bug.
  // "Add a contact" is a company-account concept (other people sharing
  // that company's jobs/invoices); an individual has no company to add
  // one to. Mirrors the admin invite route's own guard.
  if (auth.customer.is_individual) {
    return NextResponse.json({ error: "Individuals don't have contacts to add — that's a company account feature." }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  // Lazily provisions the company on the first contact ever added — most
  // portal accounts never need this until they actually try to add someone.
  let companyId = auth.customer.company_id;
  if (!companyId) {
    const company = await upsertCompany(auth.customer.company || auth.customer.name);
    companyId = company.id;
    await supabase.from("customers").update({ company_id: companyId }).eq("id", auth.customer.id);
  }

  // name is deliberately just the email here, not collected from whoever's
  // sending the invite — same sentinel the on_auth_user_created trigger uses
  // for a brand-new signup (see OnboardingForm's hasKnownName check), so the
  // invited person fills in their own name/phone once, on the one onboarding
  // screen, rather than someone else typing it in for them.
  const { data: contact, error } = await supabase
    .from("customers")
    .insert({ name: email, email, phone: "", company_id: companyId })
    .select("id, name, email, phone")
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "This email is already associated with another account." }, { status: 400 });
    }
    throw new Error(error.message);
  }

  return NextResponse.json({ contact });
});
