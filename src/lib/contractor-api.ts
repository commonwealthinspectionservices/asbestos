import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseAdmin } from "@/lib/supabase";
import type { Customer } from "@/lib/types";

export interface ContractorSession {
  authUserId: string;
  email: string | undefined;
  /** Homeowner-vs-contractor choice from signup (src/app/portal/signup), stored in auth user metadata. */
  accountType: "contractor" | "homeowner" | null;
  /** null if the auth account exists but hasn't finished onboarding (src/app/portal/onboarding) yet. */
  customer: Customer | null;
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
  const { data: customer } = await admin
    .from("customers")
    .select("*")
    .eq("auth_user_id", user.id)
    .single();

  const accountType = user.user_metadata?.account_type;

  return {
    authUserId: user.id,
    email: user.email,
    accountType: accountType === "contractor" || accountType === "homeowner" ? accountType : null,
    customer: (customer as unknown as Customer) ?? null,
  };
}

/**
 * Every `customers` row id sharing the given customer's company_id — the
 * full set of accounts whose projects this customer should be able to see,
 * since a company (e.g. a restoration company) can have several logins.
 * Falls back to just the customer's own id when they aren't linked to a
 * company yet (e.g. a homeowner, or a contractor account pre-onboarding).
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
