import Link from "next/link";
import MarketingNav from "@/components/marketing/MarketingNav";
import MarketingFooter from "@/components/marketing/MarketingFooter";

export const metadata = {
  title: "Lead Paint Sampling | Commonwealth Inspection Services, LLC.",
  description: "Lead bulk sampling of painted surfaces for renovation and demolition compliance across Massachusetts.",
};

export default function LeadServicePage() {
  return (
    <div className="min-h-screen bg-white">
      <MarketingNav />
      <div className="mx-auto max-w-2xl px-4 py-10">
        <h1 className="text-2xl font-bold uppercase text-brand-700">Lead Services</h1>

        <div className="mt-6 rounded-lg border border-slate-200 p-4">
          <h3 className="font-bold text-brand-700">Lead Paint Sampling</h3>
          <p className="mt-1 text-slate-700">
            We collect paint chip samples from the specific surfaces your project will disturb —
            walls, trim, windows, siding, and similar — and send them to an accredited lab for
            analysis. Because lead paint is typically layered under newer coats, each surface is
            sampled in a pair to get a reliable read through all of the paint layers present.
            This is the right test before sanding, scraping, cutting, or demolishing painted
            surfaces in a home built before 1978, and it&apos;s often part of the permitting
            process for renovation or demolition work on older properties.
          </p>
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
