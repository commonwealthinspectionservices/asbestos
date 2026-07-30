import Link from "next/link";
import MarketingNav from "@/components/marketing/MarketingNav";
import MarketingFooter from "@/components/marketing/MarketingFooter";

export const metadata = {
  title: "Mold Inspections | Commonwealth Inspection Services, LLC.",
  description: "Independent mold inspections and lab sampling for homeowners, contractors and property managers across Massachusetts.",
};

export default function MoldServicePage() {
  return (
    <div className="min-h-screen bg-white">
      <MarketingNav />
      <div className="mx-auto max-w-2xl px-4 py-10">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/marketing/mold-sample.jpg" alt="Mold growth on framing material" className="h-56 w-full rounded-lg object-cover" />
        <h1 className="mt-6 text-2xl font-bold text-brand-700">Mold Inspections</h1>
        <p className="mt-4 text-slate-700">
          Visible mold, water damage, musty odors or a recent leak can all be reasons to have a
          property assessed before a renovation, sale or remediation project. We perform an
          independent visual assessment of the affected areas and collect samples — surface,
          air or bulk material, depending on what&apos;s found — for lab analysis.
        </p>
        <p className="mt-4 text-slate-700">
          The lab results come back with a clear report identifying what was found and where, so
          you know exactly what needs to be addressed before hiring a remediation company —
          and can verify the work afterward with a follow-up clearance inspection.
        </p>
        <p className="mt-4 text-slate-700">
          As with our asbestos work, we only inspect and test — we don&apos;t perform remediation —
          so our findings stay independent and unbiased.
        </p>
        <div className="mt-8 flex justify-center gap-3">
          <Link href="/portal" className="inline-flex h-[22px] sm:h-[29px] items-center border-[3px] border-brand-700 bg-brand-50 px-4 text-sm font-extrabold uppercase leading-none text-brand-700 hover:bg-yellow-100">
            Book a Project
          </Link>
          <Link href="/contact" className="inline-flex h-[22px] sm:h-[29px] items-center border-[3px] border-brand-700 bg-brand-50 px-4 text-sm font-extrabold uppercase leading-none text-brand-700 hover:bg-yellow-100">
            Contact Us
          </Link>
        </div>
      </div>
      <MarketingFooter />
    </div>
  );
}
