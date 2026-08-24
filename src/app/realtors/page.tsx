import Link from "next/link";
import MarketingNav from "@/components/marketing/MarketingNav";
import MarketingFooter from "@/components/marketing/MarketingFooter";
import IndependentTestingBanner from "@/components/shared/IndependentTestingBanner";

// Not linked from the main nav on purpose — this is a page meant to be
// shared directly with realtors/agents as its own link, not something a
// homeowner browsing the site needs to stumble into.
export const metadata = {
  title: "For Realtors | Commonwealth Inspection Services, LLC.",
  description:
    "Fast, independent mold and asbestos testing for real estate transactions across Massachusetts — pre-purchase testing that doesn't hold up a closing.",
};

export default function RealtorsPage() {
  return (
    <div className="min-h-screen bg-white">
      <MarketingNav />
      <IndependentTestingBanner />
      <div className="mx-auto max-w-2xl px-4 py-10">
        <h1 className="text-2xl font-bold uppercase text-brand-700">For Realtors &amp; Agents</h1>
        <p className="mt-4 text-slate-700">
          A finished basement, a musty smell, or a buyer who just wants a clear answer before
          committing — pre-purchase mold and asbestos testing comes up often enough in
          Massachusetts real estate that it's worth having a fast, reliable inspector on hand
          instead of scrambling when it does.
        </p>

        <div className="mt-6 space-y-4">
          <div className="rounded-lg border border-slate-200 p-4">
            <h3 className="font-bold text-brand-700">Fast turnaround</h3>
            <p className="mt-1 text-slate-700">
              Site visits are usually scheduled within a day or two, and lab results are
              typically back in 24 to 48 hours — rush turnaround is available when a closing
              timeline is tight.
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 p-4">
            <h3 className="font-bold text-brand-700">Independent results</h3>
            <p className="mt-1 text-slate-700">
              No remediation or abatement business on the other side of the report — your
              client gets an honest answer, not a sales pitch for work we'd financially
              benefit from recommending.
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 p-4">
            <h3 className="font-bold text-brand-700">Licensed and covers all of Massachusetts</h3>
            <p className="mt-1 text-slate-700">
              Massachusetts-licensed asbestos consulting service provider (AF154) and InterNACHI
              member, serving Greater Boston, the North and South Shores, MetroWest, Central and
              Western Massachusetts, Cape Cod, and the Islands.
            </p>
          </div>
        </div>

        <p className="mt-6 text-slate-700">
          Have a client who needs testing on a tight timeline? Reach out directly and mention
          you're working with a buyer or seller — happy to coordinate straight with you, the
          client, or both.
        </p>

        <div className="mt-8 flex justify-center gap-3">
          <Link href="/portal" className="inline-flex h-[22px] sm:h-[29px] items-center border-[3px] border-brand-700 bg-brand-50 px-4 text-sm font-extrabold uppercase pt-0.5 leading-none text-brand-700 hover:bg-yellow-100">
            Book a Project
          </Link>
          <Link href="/contact" className="inline-flex h-[22px] sm:h-[29px] items-center border-[3px] border-brand-700 bg-brand-50 px-4 text-sm font-extrabold uppercase pt-0.5 leading-none text-brand-700 hover:bg-yellow-100">
            Contact
          </Link>
        </div>
      </div>
      <MarketingFooter />
    </div>
  );
}
