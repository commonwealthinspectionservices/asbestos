import { redirect } from "next/navigation";
import { getContractorSession } from "@/lib/contractor-api";
import OnboardingForm from "@/components/portal/OnboardingForm";

export const dynamic = "force-dynamic";

export default async function PortalOnboardingPage() {
  const session = await getContractorSession();
  if (!session) redirect("/portal/login");
  if (session.customer) redirect("/portal/dashboard");

  return <OnboardingForm accountType={session.accountType} />;
}
