import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseAdmin } from "@/lib/supabase";
import type { Customer } from "@/lib/types";

export interface ContractorSession {
  authUserId: string;
  email: string | undefined;
  /** Individual-vs-company choice from signup (src/app/portal/signup), stored in auth user metadata. */
  accountType: "company" | "individual" | null;
  /** null if the auth account exists but hasn't finished onboarding (src/app/portal/onboarding) yet. */
  customer: Customer | null;
  /**
   * Whether this auth account has ever set a real password (see
   * customer_has_password in schema.sql) — false for a brand-new signup or
   * an Invite that hasn't been completed yet, even though `customer` above
   * may already be non-null (the on_auth_user_created trigger, or an
   * admin-prefilled Invite row). Only /portal/onboarding's redirect gate
   * needs this; everything else's "is this a real account" check is still
   * just `customer !== null`.
   */
  hasPassword: boolean;
}

/**
 * Resolves the current Supabase Auth session and its linked `customers`
 * profile, if any. Used by both Server Component pages (which redirect on
 * a missing session/profile) and requireContractorApi() below (which
 * returns a 401/404 JSON response instead).
 *
 * Uses getUser(), never getSession() — getSession() only decodes the JWT
 * from the cookie without revalidating it against the auth server.
 */
export async function getContractorSession(): Promise<ContractorSession | null> {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) return null;

  const admin = getSupabaseAdmin();
  const [{ data: customer }, { data: hasPassword }] = await Promise.all([
    admin.from("customers").select("*").eq("auth_user_id", user.id).single(),
    admin.rpc("customer_has_password", { target_auth_user_id: user.id }),
  ]);

  const accountType = user.user_metadata?.account_type;

  return {
    authUserId: user.id,
    email: user.email,
    accountType: accountType === "company" || accountType === "individual" ? accountType : null,
    customer: (customer as unknown as Customer) ?? null,
    hasPassword: hasPassword === true,
  };
}

/**
 * Every `customers` row id sharing the given customer's company_id — the
 * full set of accounts whose projects this customer should be able to see,
 * since a company (e.g. a restoration company) can have several logins.
 * Falls back to just the customer's own id when they aren't linked to a
 * company yet (e.g. an individual, or a company account pre-onboarding).
 */
export async function getCompanyCustomerIds(customer: Customer): Promise<string[]> {
  if (!customer.company_id) return [customer.id];

  const admin = getSupabaseAdmin();
  const { data } = await admin.from("customers").select("id").eq("company_id", customer.company_id);
  const ids = (data ?? []).map((row) => row.id as string);
  return ids.length ? ids : [customer.id];
}

type ContractorAuthResult =
  | { customer: Customer; error?: undefined }
  | { customer?: undefined; error: NextResponse };

/** API-route counterpart of getContractorSession(): same lookup, JSON error responses instead of redirects. */
export async function requireContractorApi(): Promise<ContractorAuthResult> {
  const session = await getContractorSession();

  if (!session) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  if (!session.customer) {
    return {
      error: NextResponse.json({ error: "No contractor profile found for this account" }, { status: 404 }),
    };
  }

  return { customer: session.customer };
}
