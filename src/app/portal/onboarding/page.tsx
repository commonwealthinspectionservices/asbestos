import { redirect } from "next/navigation";
import { getContractorSession } from "@/lib/contractor-api";
import OnboardingForm from "@/components/portal/OnboardingForm";

export const dynamic = "force-dynamic";

export default async function PortalOnboardingPage() {
  const session = await getContractorSession();
  if (!session) redirect("/portal/login");
  // A customers row existing isn't proof onboarding actually finished — the
  // on_auth_user_created trigger (schema.sql) creates one the instant
  // someone signs up, and an admin Invite can pre-fill a real name/phone on
  // one too, both before a password is ever set. onboarding_completed_at is
  // set only by a successful POST /api/portal/profile, which OnboardingForm
  // only ever calls right after updateUser({password}) succeeds — so its
  // presence is real proof a password was set, unlike checking
  // auth.users.encrypted_password directly (tried that first; turns out
  // Supabase doesn't leave it empty for OTP-only accounts, so that check
  // returned true for accounts that never set a password at all).
  if (session.customer?.onboarding_completed_at) redirect("/portal/dashboard");

  return <OnboardingForm accountType={session.accountType} email={session.email} />;
}
