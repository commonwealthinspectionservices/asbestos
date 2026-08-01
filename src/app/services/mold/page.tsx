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
        <h1 className="text-2xl font-bold uppercase text-brand-700">Mold Inspection Services</h1>

        <div className="mt-6 space-y-4">
          <div className="rounded-lg border border-slate-200 p-4">
            <h3 className="font-bold text-brand-700">Mold Air Sampling</h3>
            <p className="mt-1 text-slate-700">
              A sample of the air in a specific room or area, tested and compared against an
              outdoor baseline to see whether indoor mold spore counts are elevated — one sample
              per area. This is the right test when there&apos;s a musty smell, health symptoms,
              or a general air-quality concern, but nothing visibly growing on a surface.
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 p-4">
            <h3 className="font-bold text-brand-700">Mold Bulk Sampling</h3>
            <p className="mt-1 text-slate-700">
              A physical piece of an affected material — a section of drywall, insulation, or
              subfloor — is collected and sent to the lab to identify what&apos;s growing and how
              extensive it is, one sample per material. Best for when mold is visible on a
              specific material and you need to know exactly what you&apos;re dealing with before
              remediation.
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 p-4">
            <h3 className="font-bold text-brand-700">Mold Swab Sampling</h3>
            <p className="mt-1 text-slate-700">
              A swab taken directly from a surface with visible growth or staining, used to
              quickly confirm whether it&apos;s actually mold — one sample per material or
              surface. Often the fastest way to get a clear answer on a suspicious stain on a
              wall, ceiling, or other surface before deciding on next steps.
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
