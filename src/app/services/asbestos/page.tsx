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
        <h1 className="text-2xl font-bold uppercase text-brand-700">Asbestos Inspection Services</h1>

        <div className="mt-6 space-y-4">
          <div className="rounded-lg border border-slate-200 p-4">
            <h3 className="font-bold text-brand-700">Limited Asbestos Inspection</h3>
            <p className="mt-1 text-slate-700">
              Our standard inspection for most residential and light commercial projects. We
              evaluate and sample the specific materials tied to your renovation scope — the
              flooring, plaster, or drywall in one room, for example — rather than surveying the
              whole building. It&apos;s the right choice for most bathroom and kitchen remodels,
              flooring replacements, and general renovation work where only part of the property
              is being disturbed.
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 p-4">
            <h3 className="font-bold text-brand-700">Pre-Renovation Asbestos Inspection</h3>
            <p className="mt-1 text-slate-700">
              Priced and scoped the same as a limited inspection, but tied specifically to
              renovation work that&apos;s about to begin. Sampling focuses on the materials your
              contractor is actually going to cut, sand, or remove, so the report lines up
              directly with the project and supports your permit application. Best for
              homeowners and contractors who already have a renovation scope defined and need
              documentation before work starts.
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 p-4">
            <h3 className="font-bold text-brand-700">Pre-Demolition Asbestos Inspection</h3>
            <p className="mt-1 text-slate-700">
              A more comprehensive survey covering the entire structure rather than one area,
              required before full or partial demolition in Massachusetts. Because demolition
              affects the whole building instead of a single room, this inspection evaluates all
              accessible materials throughout the property, which is why it carries a higher base
              fee than a limited or pre-renovation inspection. Best for full-property demolition,
              tear-downs, and whole-house gut renovations.
            </p>
          </div>
        </div>

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
