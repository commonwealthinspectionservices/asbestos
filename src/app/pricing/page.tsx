import MarketingNav from "@/components/marketing/MarketingNav";
import MarketingFooter from "@/components/marketing/MarketingFooter";
import PricingCalculator from "@/components/marketing/PricingCalculator";

export const metadata = {
  title: "Pricing Calculator | Commonwealth Inspection Services, LLC.",
  description: "Estimate the cost of an asbestos, mold or lead inspection in Massachusetts.",
};

export default function PricingPage() {
  return (
    <div className="min-h-screen bg-white">
      <MarketingNav />
      <div className="px-4 py-10">
        <PricingCalculator />
      </div>
      <MarketingFooter />
    </div>
  );
}
