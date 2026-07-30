import MarketingNav from "@/components/marketing/MarketingNav";
import MarketingFooter from "@/components/marketing/MarketingFooter";
import FaqAccordion from "@/components/marketing/FaqAccordion";
import { faqs } from "@/lib/faqs";

export default function FaqPage() {
  return (
    <div className="min-h-screen bg-white">
      <MarketingNav />
      <div className="mx-auto max-w-2xl px-4 py-10">
        <h1 className="text-2xl font-bold text-brand-700">Frequently Asked Questions</h1>
        <div className="mt-6">
          <FaqAccordion faqs={faqs} />
        </div>
      </div>
      <MarketingFooter />
    </div>
  );
}
