import Link from "next/link";
import { notFound } from "next/navigation";
import MarketingNav from "@/components/marketing/MarketingNav";
import MarketingFooter from "@/components/marketing/MarketingFooter";
import FaqAccordion from "@/components/marketing/FaqAccordion";
import IndependentTestingBanner from "@/components/shared/IndependentTestingBanner";
import Credentials from "@/components/shared/Credentials";
import { localTowns, REGION_CONTEXT } from "@/lib/local-towns";
import { faqs } from "@/lib/faqs";

// Mirrors the real pricing model (base fee + per-sample lab cost) behind
// the site's own pricing estimator and the mold cost blog post — not
// independently maintained numbers, just presented as a table here since
// that's a much easier format to scan than a paragraph when someone's
// specifically trying to budget for it.
const PRICING_ROWS = [
  { label: "1 area + outdoor baseline (2 samples)", price: "$620" },
  { label: "2 areas + outdoor baseline (3 samples)", price: "$705" },
  { label: "3 areas + outdoor baseline (4 samples)", price: "$790" },
  { label: "4 areas + outdoor baseline (5 samples)", price: "$875" },
];

const moldFaqs = faqs.filter((f) => f.category === "mold");

export function generateStaticParams() {
  return localTowns.map((t) => ({ town: t.slug }));
}

export function generateMetadata({ params }: { params: { town: string } }) {
  const town = localTowns.find((t) => t.slug === params.town);
  if (!town) return {};
  return {
    title: `Mold Air Sampling in ${town.name}, MA | Commonwealth Inspection Services, LLC.`,
    description: `Independent mold air sampling for homeowners in ${town.name}, Massachusetts — no remediation, no conflict of interest, lab results in 24-48 hours.`,
  };
}

export default function TownMoldTestingPage({ params }: { params: { town: string } }) {
  const town = localTowns.find((t) => t.slug === params.town);
  if (!town) notFound();

  const nearbyTowns = town.nearby
    .map((name) => localTowns.find((t) => t.name === name))
    .filter((t): t is NonNullable<typeof t> => Boolean(t));

  return (
    <div className="min-h-screen bg-white">
      <MarketingNav />
      <IndependentTestingBanner />
      <div className="mx-auto max-w-2xl px-4 py-10">
        <h1 className="text-2xl font-bold uppercase text-brand-700">
          Mold Air Sampling in {town.name}, MA
        </h1>
        <p className="mt-4 text-slate-700">
          Serving homeowners in {town.name} and the surrounding {town.region} area with
          independent mold air quality testing — a musty smell, a past leak, or just wanting a
          clear answer are all common reasons to test. {REGION_CONTEXT[town.region]}
        </p>

        <div className="mt-6 space-y-4">
          <div className="rounded-lg border border-slate-200 p-4">
            <h3 className="font-bold text-brand-700">How it works</h3>
            <p className="mt-1 text-slate-700">
              A quick, non-invasive visit — usually well under an hour — measures indoor air in
              the room or area of concern and compares it against an outdoor baseline. Lab
              results are typically back within 24 to 48 hours.
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 p-4">
            <h3 className="font-bold text-brand-700">Pricing in {town.name}</h3>
            <p className="mt-1 text-slate-700">
              Same rate everywhere in Massachusetts — a base visit fee plus a per-sample lab
              cost, no regional markup for {town.name} specifically.
            </p>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[360px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-slate-500">
                    <th className="py-1.5 pr-2 font-medium">Scope</th>
                    <th className="py-1.5 pl-2 text-right font-medium">Typical Total</th>
                  </tr>
                </thead>
                <tbody>
                  {PRICING_ROWS.map((row) => (
                    <tr key={row.label} className="border-b border-slate-100 last:border-0">
                      <td className="py-1.5 pr-2 text-slate-700">{row.label}</td>
                      <td className="py-1.5 pl-2 text-right font-medium text-brand-700">{row.price}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Get an exact quote for your address with the pricing estimator on the homepage.
            </p>
          </div>
        </div>

        <div className="mt-6">
          <Credentials show={["internachi"]} />
        </div>

        {moldFaqs.length > 0 && (
          <div className="mt-8">
            <h2 className="text-lg font-bold text-brand-700">Common questions</h2>
            <div className="mt-3">
              <FaqAccordion faqs={moldFaqs} />
            </div>
          </div>
        )}

        <div className="mt-8 flex justify-center gap-3">
          <Link href="/portal" className="inline-flex h-[22px] sm:h-[29px] items-center border-[3px] border-brand-700 bg-brand-50 px-4 text-sm font-extrabold uppercase pt-0.5 leading-none text-brand-700 hover:bg-yellow-100">
            Book a Project
          </Link>
          <Link href="/contact" className="inline-flex h-[22px] sm:h-[29px] items-center border-[3px] border-brand-700 bg-brand-50 px-4 text-sm font-extrabold uppercase pt-0.5 leading-none text-brand-700 hover:bg-yellow-100">
            Contact
          </Link>
        </div>

        {nearbyTowns.length > 0 && (
          <p className="mt-8 text-center text-sm text-slate-500">
            Also serving nearby:{" "}
            {nearbyTowns.map((t, i) => (
              <span key={t.slug}>
                {i > 0 && ", "}
                <Link href={`/mold-testing/${t.slug}`} className="text-brand-600 underline">
                  {t.name}
                </Link>
              </span>
            ))}
          </p>
        )}
      </div>
      <MarketingFooter />
    </div>
  );
}
