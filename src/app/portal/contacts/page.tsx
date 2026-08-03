import { redirect } from "next/navigation";
import { getContractorSession } from "@/lib/contractor-api";
import PortalNav from "@/components/portal/PortalNav";
import ContactsList from "@/components/portal/ContactsList";

export const dynamic = "force-dynamic";

export default async function PortalContactsPage() {
  const session = await getContractorSession();
  if (!session) redirect("/portal/login");
  if (!session.customer) redirect("/portal/onboarding");
  // Contacts (who gets results/invoices, per company) is a company
  // concept — individuals don't have this tab in the nav, so don't leave
  // the page reachable by direct URL either.
  if (session.customer.is_individual) redirect("/portal/dashboard");

  return (
    <div className="min-h-screen bg-slate-50">
      <PortalNav isIndividual={session.customer.is_individual} />
      <ContactsList />
    </div>
  );
}
