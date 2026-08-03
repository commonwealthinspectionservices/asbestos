import { redirect } from "next/navigation";
import { getContractorSession } from "@/lib/contractor-api";
import PortalNav from "@/components/portal/PortalNav";
import PortalChatHub from "@/components/portal/PortalChatHub";

export const dynamic = "force-dynamic";

export default async function PortalChatPage() {
  const session = await getContractorSession();
  if (!session) redirect("/portal/login");
  if (!session.customer) redirect("/portal/onboarding");

  return (
    <div className="min-h-screen bg-slate-50">
      <PortalNav isHomeowner={session.customer.is_homeowner} />
      <PortalChatHub />
    </div>
  );
}
