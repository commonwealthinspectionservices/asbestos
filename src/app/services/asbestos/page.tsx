import Link from "next/link";
import MarketingNav from "@/components/marketing/MarketingNav";
import MarketingFooter from "@/components/marketing/MarketingFooter";

export const metadata = {
  title: "Asbestos Inspections | Commonwealth Inspection Services, LLC.",
  description: "Limited asbestos (PLM bulk sample) inspections for renovation, demolition and building permit compliance across Massachusetts.",
};

export default function AsbestosServicePage() {
  return (
    <div className="min-h-screen bg-white">
      <MarketingNav />
      <div className="mx-auto max-w-2xl px-4 py-10">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/marketing/hero-inspection-notes.jpg" alt="Inspector recording findings on-site" className="h-56 w-full rounded-lg object-cover" />
        <h1 className="mt-6 text-2xl font-bold text-brand-700">Asbestos Inspections</h1>
        <p className="mt-4 text-slate-700">
          Before a renovation, demolition or building permit application, Massachusetts requires a
          licensed asbestos inspection of the affected materials. We provide limited asbestos
          (PLM bulk sample) inspections — an independent, licensed inspector visits the property,
          collects bulk samples from suspect materials, and sends them to an accredited lab for
          analysis.
        </p>
        <p className="mt-4 text-slate-700">
          Commonly sampled materials include pipe and boiler insulation, vinyl floor tile and
          mastic, joint compound, textured ceilings, and roofing or siding materials. The final
          report is formatted to meet Massachusetts DEP, DLS and local building department
          requirements, so it can be submitted directly with a permit application.
        </p>
        <p className="mt-4 text-slate-700">
          We specialize exclusively in inspection and testing — we don&apos;t perform abatement —
          so findings and recommendations are always independent and conflict-free.
        </p>

        <div className="mt-10 grid gap-6 sm:grid-cols-2 sm:items-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/marketing/acm-house-diagram.jpg" alt="Common places asbestos-containing materials are found in a home" className="mx-auto w-full max-w-sm rounded-lg" />
          <div className="space-y-4 text-slate-700">
            <p>
              Asbestos was commonly used in residential building materials for decades,
              particularly in homes built before 1980. It is often found in insulation around
              pipes, boilers and furnaces. Other common spots include vinyl floor tiles and
              flooring adhesives. Ceiling tiles, textured ceilings are hot spots as well as joint
              compound materials and roofing/siding materials. An asbestos inspection helps
              identify these materials before renovation or demolition work begins.
            </p>
            <p>
              Commonwealth Inspection Services specializes exclusively in asbestos inspection and
              testing and does not do asbestos removal. Independence guarantees unbiased findings
              and transparent recommendations.
            </p>
          </div>
        </div>

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
