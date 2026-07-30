import Link from "next/link";
import MarketingNav from "@/components/marketing/MarketingNav";
import MarketingFooter from "@/components/marketing/MarketingFooter";

export const metadata = {
  title: "Lead Inspections | Commonwealth Inspection Services, LLC.",
  description: "Lead bulk sampling of painted surfaces for renovation and demolition compliance across Massachusetts.",
};

export default function LeadServicePage() {
  return (
    <div className="min-h-screen bg-white">
      <MarketingNav />
      <div className="mx-auto max-w-2xl px-4 py-10">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/marketing/lead-sample.jpg" alt="Framing and insulation during a renovation" className="h-56 w-full rounded-lg object-cover" />
        <h1 className="mt-6 text-2xl font-bold text-brand-700">Lead Inspections</h1>
        <p className="mt-4 text-slate-700">
          Homes built before 1978 often have lead-based paint on interior and exterior surfaces.
          Before renovation or demolition work disturbs painted surfaces, a lead bulk sampling
          inspection identifies whether lead is present so the work can be planned and permitted
          correctly.
        </p>
        <p className="mt-4 text-slate-700">
          We collect bulk paint samples from the surfaces that will be disturbed by the project
          and send them to an accredited lab for analysis. The report identifies which surfaces
          test positive, so contractors and property owners know exactly what precautions apply
          before work begins.
        </p>
        <p className="mt-4 text-slate-700">
          As with our asbestos and mold work, we only inspect and test — we don&apos;t perform
          abatement — so findings stay independent and conflict-free.
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
