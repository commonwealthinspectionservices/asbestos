import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireAdminApi } from "@/lib/admin-api";
import { withApiErrors } from "@/lib/api-handler";
import { upsertCompany } from "@/lib/companies";

// A directory of every individual contact — a standalone client (e.g. an
// individual) or someone affiliated with a company (e.g. an employee of
// Boston Harbor Water Restoration), distinguished by company_id. Backs the
// "Contacts" tab and the existing-contact picker in Add Project.
export const GET = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim();
  // Looking up the known contacts under one company (Add Project's Contact
  // name dropdown) rather than a fuzzy search.
  const companyId = url.searchParams.get("companyId")?.trim();
  const company = url.searchParams.get("company")?.trim();

  const supabase = getSupabaseAdmin();
  let query = supabase.from("customers").select("*").order("name", { ascending: true });
  if (companyId) {
    query = query.eq("company_id", companyId);
  } else if (company) {
    query = query.eq("company", company);
  } else if (q) {
    query = query.or(`name.ilike.%${q}%,company.ilike.%${q}%,email.ilike.%${q}%`);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ customers: data });
});

export const POST = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

  const body = await req.json().catch(() => null);
  // Per Tim, 2026-09-01 — email is often genuinely unknown for a company
  // contact (e.g. an FLI job's own site contact, saved from just a name and
  // phone), so it's optional here — null, never "", since customers.email
  // is only a plain unique index (see schema.sql), and a blank string would
  // collide with the next contact saved the same way.
  const email = body?.email?.trim()?.toLowerCase() || null;
  const isIndividual = body?.is_individual === true;
  let name = body?.name?.trim();
  if (isIndividual && !name) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }
  // A company contact can be added with just an email — same sentinel
  // POST /api/portal/contacts uses for a self-service Teammates invite, so
  // this admin-created row is indistinguishable from one Joe invited
  // himself: OnboardingForm's hasKnownName check treats name === email as
  // "not actually known yet" and lets the invited person fill in their own
  // name (and phone) instead of an admin typing it in for them. Only
  // applies when there's an email to use as that sentinel — with neither
  // name nor email, there's nothing to identify this contact by at all.
  if (!name && email) name = email;
  if (!name) {
    return NextResponse.json({ error: "Name or email is required" }, { status: 400 });
  }

  const companyId = body?.companyId?.trim() || null;
  const companyName = body?.company?.trim() || null;
  const billingAddress = body?.billingAddress?.trim() || null;

  const supabase = getSupabaseAdmin();

  // An exact companyId (e.g. picked from a dropdown) skips the name-based
  // dedup lookup entirely — it's already resolved to a specific company.
  let company = null;
  if (companyId) {
    const { data } = await supabase.from("companies").select("*").eq("id", companyId).single();
    company = data ?? null;
  } else if (companyName) {
    company = await upsertCompany(companyName, { billingAddress });
  }

  // This upserts on the email unique constraint below, which is fine when
  // it's the same person being re-added to the same company (idempotent),
  // but an admin typing a new name whose email happens to already belong
  // to someone else entirely — a standalone individual, or a contact at a
  // different company — would otherwise silently overwrite that person's
  // name/company/billing_address instead of creating anyone new. Block
  // that specific case and point at the "search existing contacts" picker
  // instead, which links by id rather than guessing from typed text.
  const resolvedCompanyId = company?.id ?? null;
  if (email) {
    const { data: existingByEmail } = await supabase
      .from("customers")
      .select("id, name, company, company_id")
      .eq("email", email)
      .maybeSingle();
    if (existingByEmail && existingByEmail.company_id !== resolvedCompanyId) {
      return NextResponse.json(
        {
          error: `${email} already belongs to an existing contact (${existingByEmail.name}${existingByEmail.company ? ` at ${existingByEmail.company}` : ""}). Search for them by name instead of typing a new one.`,
        },
        { status: 409 }
      );
    }
  }

  const { data, error } = await supabase
    .from("customers")
    .upsert(
      {
        name,
        company: company?.name ?? null,
        company_id: company?.id ?? null,
        email,
        phone: body?.phone?.trim() || "",
        billing_address: company?.billing_address ?? billingAddress,
        is_individual: isIndividual,
      },
      { onConflict: "email" }
    )
    .select("*")
    .single();

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "Failed to save customer" }, { status: 500 });
  }
  return NextResponse.json({ customer: data });
});
