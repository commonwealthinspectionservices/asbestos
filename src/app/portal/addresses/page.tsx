import { redirect } from "next/navigation";
import { getContractorSession } from "@/lib/contractor-api";
import PortalNav from "@/components/portal/PortalNav";
import AddressBook from "@/components/portal/AddressBook";

export const dynamic = "force-dynamic";

export default async function PortalAddressesPage() {
  const session = await getContractorSession();
  if (!session) redirect("/portal/login");
  if (!session.customer) redirect("/portal/onboarding");
  // Saved addresses (multiple job sites to pick from when booking) is a
  // company concept — individuals don't have this tab in the nav, so don't
  // leave the page reachable by direct URL either.
  if (session.customer.is_individual) redirect("/portal/dashboard");

  return (
    <div className="min-h-screen bg-slate-50">
      <PortalNav isIndividual={session.customer.is_individual} />
      <AddressBook />
    </div>
  );
}
