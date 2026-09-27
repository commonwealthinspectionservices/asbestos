import MarketingNav from "@/components/marketing/MarketingNav";
import MarketingFooter from "@/components/marketing/MarketingFooter";

export const metadata = { title: "Terms of Service | Commonwealth Inspection Services" };

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-white">
      <MarketingNav />
      <div className="mx-auto max-w-2xl px-4 py-10">
        <h1 className="text-2xl font-bold text-brand-700">Terms of Service</h1>
        <p className="mt-2 text-sm text-slate-500">Last updated September 27, 2026</p>

        <div className="mt-6 space-y-5 text-sm leading-relaxed text-slate-700">
          <p>
            These terms cover your use of commonwealthinspectionservices.com and the services booked
            through it, provided by Commonwealth Inspection Services, LLC ("Commonwealth").
          </p>

          <h2 className="text-lg font-semibold text-brand-700">Our services</h2>
          <p>
            Commonwealth provides asbestos, mold, and lead inspection and sampling services in
            Massachusetts. Reports are based on samples and observations at the time of inspection and
            reflect conditions at that specific time.
          </p>

          <h2 className="text-lg font-semibold text-brand-700">Payment</h2>
          <p>
            Invoices are payable by the due date shown on the invoice. Payments are processed securely
            through Stripe.
          </p>

          <h2 className="text-lg font-semibold text-brand-700">"Commonwealth Mileage Sync" integration</h2>
          <p>
            Commonwealth Mileage Sync is an internal accounting tool built by Commonwealth Inspection
            Services solely for its own use — connecting our own job-scheduling software to our own
            QuickBooks Online account to record business mileage automatically. It is not a public
            product, is not distributed to other businesses, and this end-user license covers
            Commonwealth's own use of it as the sole authorized user.
          </p>

          <h2 className="text-lg font-semibold text-brand-700">Contact</h2>
          <p>
            Questions about these terms can be sent to{" "}
            <a href="mailto:tim@commonwealthinspectionservices.com" className="text-brand-600 underline">
              tim@commonwealthinspectionservices.com
            </a>
            .
          </p>
        </div>
      </div>
      <MarketingFooter />
    </div>
  );
}
