import { redirect } from "next/navigation";
import { getContractorSession } from "@/lib/contractor-api";
import PortalNav from "@/components/portal/PortalNav";
import AccountForm from "@/components/portal/AccountForm";

export const dynamic = "force-dynamic";

export default async function PortalAccountPage() {
  const session = await getContractorSession();
  if (!session) redirect("/portal/login");
  if (!session.customer) redirect("/portal/onboarding");

  return (
    <div className="min-h-screen bg-slate-50">
      <PortalNav isIndividual={session.customer.is_individual} />
      <AccountForm customer={session.customer} email={session.email} accountType={session.accountType} />
    </div>
  );
}
