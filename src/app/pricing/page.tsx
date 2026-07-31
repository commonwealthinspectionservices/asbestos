import MarketingNav from "@/components/marketing/MarketingNav";
import MarketingFooter from "@/components/marketing/MarketingFooter";
import PricingCalculator from "@/components/marketing/PricingCalculator";

export const metadata = {
  title: "Pricing Estimator | Commonwealth Inspection Services, LLC.",
  description: "Estimate the cost of an asbestos, mold or lead inspection in Massachusetts.",
};

export default function PricingPage() {
  return (
    <div className="min-h-screen bg-white">
      <MarketingNav />
      <div className="px-4 py-20">
        <h1 className="text-center text-xl font-black uppercase text-brand-700">
          Pricing Estimator
        </h1>
        <div className="mt-6">
          <PricingCalculator />
        </div>
      </div>
      <MarketingFooter />
    </div>
  );
}
