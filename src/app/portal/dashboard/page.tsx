import { redirect } from "next/navigation";
import { getContractorSession } from "@/lib/contractor-api";
import PortalNav from "@/components/portal/PortalNav";
import ProjectsList from "@/components/portal/ProjectsList";

export const dynamic = "force-dynamic";

export default async function PortalDashboardPage() {
  const session = await getContractorSession();
  if (!session) redirect("/portal/login");
  if (!session.customer) redirect("/portal/onboarding");
  // An invite/confirm link authenticates the browser (and the DB trigger
  // creates this stub customers row) the instant the link is generated —
  // well before the person sets a real password and finishes the form. Not
  // gating this lets that half-finished session reach real portal pages.
  if (!session.customer.onboarding_completed_at) redirect("/portal/onboarding");

  return (
    <div className="min-h-screen bg-slate-50">
      <PortalNav isIndividual={session.customer.is_individual} />
      <ProjectsList />
    </div>
  );
}
