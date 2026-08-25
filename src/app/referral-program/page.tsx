import Link from "next/link";
import MarketingNav from "@/components/marketing/MarketingNav";
import MarketingFooter from "@/components/marketing/MarketingFooter";
import IndependentTestingBanner from "@/components/shared/IndependentTestingBanner";

// Broader than /realtors (which is a targeted pitch for real estate agents
// specifically) — this one's for anyone: past clients, contractors,
// friends. Deliberately no dollar figure or tracking mechanism here — a
// cash-per-referral incentive is a real financial commitment that's Tim's
// call to make, not something to invent. If he decides on terms later,
// this page is the natural place to add them.
export const metadata = {
  title: "Referral Program | Commonwealth Inspection Services, LLC.",
  description: "Refer a friend, client, or contact to Commonwealth Inspection Services for independent asbestos, mold, and lead testing across Massachusetts.",
};

export default function ReferralProgramPage() {
  return (
    <div className="min-h-screen bg-white">
      <MarketingNav />
      <IndependentTestingBanner />
      <div className="mx-auto max-w-2xl px-4 py-10">
        <h1 className="text-2xl font-bold uppercase text-brand-700">Refer Someone</h1>
        <p className="mt-4 text-slate-700">
          If you've worked with us before — or know a homeowner, contractor, or agent who could
          use an independent asbestos, mold, or lead inspection — sending them our way is the
          easiest way to help both sides out. They get a fast, honest inspector; we get a client
          who already trusts the referral.
        </p>

        <div className="mt-6 space-y-4">
          <div className="rounded-lg border border-slate-200 p-4">
            <h3 className="font-bold text-brand-700">Who this is for</h3>
            <p className="mt-1 text-slate-700">
              Past clients, contractors, property managers, real estate agents (see our{" "}
              <Link href="/realtors" className="text-brand-600 underline">dedicated realtor page</Link>{" "}
              for that specific case), or just someone you know who mentioned needing a test.
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 p-4">
            <h3 className="font-bold text-brand-700">How it works</h3>
            <p className="mt-1 text-slate-700">
              Just send them to commonwealthinspectionservices.com to book, or have them mention
              your name when they reach out. There's no sign-up or referral code needed — it's
              genuinely just letting someone know about us.
            </p>
          </div>
        </div>

        <div className="mt-8 flex justify-center gap-3">
          <Link href="/contact" className="inline-flex h-[22px] sm:h-[29px] items-center border-[3px] border-brand-700 bg-brand-50 px-4 text-sm font-extrabold uppercase pt-0.5 leading-none text-brand-700 hover:bg-yellow-100">
            Contact
          </Link>
        </div>
      </div>
      <MarketingFooter />
    </div>
  );
}
