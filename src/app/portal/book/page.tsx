import { redirect } from "next/navigation";
import { getContractorSession } from "@/lib/contractor-api";
import PortalNav from "@/components/portal/PortalNav";
import PortalBookingForm from "@/components/portal/PortalBookingForm";
import GuestBookingForm from "@/components/portal/GuestBookingForm";

export const dynamic = "force-dynamic";

// A signed-in, fully onboarded contractor sees the same authenticated
// wizard as always. A signed-in but not-yet-onboarded account (company
// mid-signup, or an Invite recipient) still resumes onboarding first,
// unchanged. No session at all no longer bounces to /portal/login — that
// used to be the only path here, forcing even a brand-new homeowner to
// create an account before describing the job they wanted. The chooser at
// /portal only ever links here for the "I'm a homeowner" option, so a
// missing session at this specific route means a guest individual
// booking — GuestBookingForm collects everything itself and only creates
// an account at the very end.
export default async function PortalBookPage() {
  const session = await getContractorSession();
  if (session?.customer?.onboarding_completed_at) {
    return (
      <div className="min-h-screen bg-slate-50">
        <PortalNav isIndividual={session.customer.is_individual} />
        <PortalBookingForm isIndividual={session.customer.is_individual} />
      </div>
    );
  }
  if (session) redirect("/portal/onboarding");

  return (
    <div className="min-h-screen bg-slate-50">
      <GuestBookingForm />
    </div>
  );
}
