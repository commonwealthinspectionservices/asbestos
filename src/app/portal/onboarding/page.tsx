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
  // one too, both before a password is ever set. hasPassword checks
  // Supabase's own auth.users.encrypted_password directly, which is the
  // only reliable signal (see customer_has_password in schema.sql).
  if (session.customer && session.hasPassword) redirect("/portal/dashboard");

  return <OnboardingForm accountType={session.accountType} email={session.email} />;
}
