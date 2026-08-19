import { redirect } from "next/navigation";
import { getContractorSession } from "@/lib/contractor-api";
import PortalNav from "@/components/portal/PortalNav";
import AccountForm from "@/components/portal/AccountForm";

export const dynamic = "force-dynamic";

export default async function PortalAccountPage() {
  const session = await getContractorSession();
  if (!session) redirect("/portal/login");
  if (!session.customer) redirect("/portal/onboarding");
  // See dashboard/page.tsx's identical check for why this can't just be
  // "session.customer exists" — that's true from the moment an invite link
  // is generated, not once the person has actually finished setting up.
  if (!session.customer.onboarding_completed_at) redirect("/portal/onboarding");

  return (
    <div className="min-h-screen bg-slate-50">
      <PortalNav isIndividual={session.customer.is_individual} />
      <AccountForm customer={session.customer} email={session.email} accountType={session.accountType} />
    </div>
  );
}
