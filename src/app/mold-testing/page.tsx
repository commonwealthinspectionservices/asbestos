import Link from "next/link";
import MarketingNav from "@/components/marketing/MarketingNav";
import MarketingFooter from "@/components/marketing/MarketingFooter";
import { localTowns } from "@/lib/local-towns";

export const metadata = {
  title: "Mold Air Sampling by Town | Commonwealth Inspection Services, LLC.",
  description: "Independent mold air sampling for homeowners across Massachusetts — find your town.",
};

export default function MoldTestingIndexPage() {
  const byRegion = new Map<string, typeof localTowns>();
  for (const town of localTowns) {
    if (!byRegion.has(town.region)) byRegion.set(town.region, []);
    byRegion.get(town.region)!.push(town);
  }

  return (
    <div className="min-h-screen bg-white">
      <MarketingNav />
      <div className="mx-auto max-w-2xl px-4 py-10">
        <h1 className="text-2xl font-bold uppercase text-brand-700">Mold Air Sampling by Town</h1>
        <p className="mt-4 text-slate-700">
          Independent mold air sampling for homeowners across Massachusetts. Find your town
          below, or use the pricing estimator on the homepage for a specific quote.
        </p>

        <div className="mt-6 space-y-6">
          {[...byRegion.entries()].map(([region, towns]) => (
            <div key={region}>
              <h2 className="text-sm font-bold uppercase text-slate-500">{region}</h2>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                {towns.map((town) => (
                  <Link
                    key={town.slug}
                    href={`/mold-testing/${town.slug}`}
                    className="text-brand-600 underline"
                  >
                    {town.name}
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
      <MarketingFooter />
    </div>
  );
}
