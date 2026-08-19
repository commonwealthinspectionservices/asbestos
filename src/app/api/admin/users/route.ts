import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireAdminApi } from "@/lib/admin-api";
import { withApiErrors } from "@/lib/api-handler";

// Every account that's ever signed up through the portal (Supabase Auth),
// cross-referenced against `customers` — a user can exist here without a
// customers row if they abandoned onboarding partway through, which is
// otherwise invisible anywhere else in the admin (the Directory only shows
// completed customers rows).
export const GET = withApiErrors(async (req: NextRequest) => {
  const unauthorized = requireAdminApi(req);
  if (unauthorized) return unauthorized;

  const supabase = getSupabaseAdmin();
  const { data: authData, error: authError } = await supabase.auth.admin.listUsers();
  if (authError) {
    return NextResponse.json({ error: authError.message }, { status: 500 });
  }

  const { data: customers, error: customersError } = await supabase
    .from("customers")
    .select("id, auth_user_id, name, company, onboarding_completed_at");
  if (customersError) {
    return NextResponse.json({ error: customersError.message }, { status: 500 });
  }

  const customerByAuthId = new Map(
    customers.filter((c) => c.auth_user_id).map((c) => [c.auth_user_id, c])
  );

  const users = authData.users
    .map((u) => {
      const customer = customerByAuthId.get(u.id);
      return {
        id: u.id,
        email: u.email,
        createdAt: u.created_at,
        lastSignInAt: u.last_sign_in_at ?? null,
        emailConfirmed: !!u.email_confirmed_at,
        accountType: (u.user_metadata?.account_type as string | undefined) ?? null,
        // The on_auth_user_created trigger creates a customers row the
        // instant this auth account exists — including the moment an
        // admin/teammate invite is generated, well before the person ever
        // opens the email. A customers row existing is proof of an invite
        // or signup attempt, not proof they actually finished onboarding.
        onboardingComplete: Boolean(customer?.onboarding_completed_at),
        customerId: customer?.id ?? null,
        name: customer?.name ?? null,
        company: customer?.company ?? null,
      };
    })
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return NextResponse.json({ users });
});
