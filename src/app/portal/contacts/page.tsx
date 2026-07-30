import { redirect } from "next/navigation";
import { getContractorSession } from "@/lib/contractor-api";
import PortalNav from "@/components/portal/PortalNav";
import ContactsList from "@/components/portal/ContactsList";

export const dynamic = "force-dynamic";

export default async function PortalContactsPage() {
  const session = await getContractorSession();
  if (!session) redirect("/portal/login");
  if (!session.customer) redirect("/portal/onboarding");

  return (
    <div className="min-h-screen bg-slate-50">
      <PortalNav />
      <ContactsList />
    </div>
  );
}
