import Link from "next/link";
import MarketingNav from "@/components/marketing/MarketingNav";
import MarketingFooter from "@/components/marketing/MarketingFooter";
import IndependentTestingBanner from "@/components/shared/IndependentTestingBanner";

// $50/referral, confirmed by Tim — deliberately no accounts, referral
// codes, or payout tracking yet (see git history for the earlier
// no-dollar-figure version). This is intentionally just the advertised
// offer to gauge real demand before building any of that infrastructure;
// payouts stay a manual Venmo/PayPal send on Tim's end either way, since
// moving money isn't something to automate through this app regardless of
// volume.
export const metadata = {
  title: "Referral Program | Commonwealth Inspection Services, LLC.",
  description: "Refer someone to Commonwealth Inspection Services and get $50 when their inspection is complete.",
};

export default function ReferralProgramPage() {
  return (
    <div className="min-h-screen bg-white">
      <MarketingNav />
      <IndependentTestingBanner />
      <div className="mx-auto max-w-2xl px-4 py-10">
        <h1 className="text-2xl font-bold uppercase text-brand-700">Refer Someone, Get $50</h1>
        <p className="mt-4 text-slate-700">
          If you've worked with us before — or know a homeowner, contractor, or agent who could
          use an independent asbestos, mold, or lead inspection — send them our way. Once their
          inspection is complete, you get $50.
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
              Have them mention your name when they book or reach out. Once their inspection is
              complete, you'll get $50 — no sign-up, referral code, or account needed.
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
