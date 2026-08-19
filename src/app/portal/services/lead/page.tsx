import Link from "next/link";
import { redirect } from "next/navigation";
import { getContractorSession } from "@/lib/contractor-api";
import PortalNav from "@/components/portal/PortalNav";
import { LeadServiceInfo } from "@/components/shared/ServiceInfo";

export const dynamic = "force-dynamic";

// Portal's own copy of /services/lead — see the asbestos version's comment.
export default async function PortalLeadServicePage() {
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
      <div className="mx-auto max-w-2xl px-4 py-10">
        <LeadServiceInfo />
        <div className="mt-8 flex justify-center">
          <Link href="/portal/book" className="inline-flex h-[22px] sm:h-[29px] items-center border-[3px] border-brand-700 bg-brand-50 px-4 text-sm font-extrabold uppercase pt-0.5 leading-none text-brand-700 hover:bg-yellow-100">
            Book a Project
          </Link>
        </div>
      </div>
    </div>
  );
}
