import MarketingNav from "@/components/marketing/MarketingNav";
import MarketingFooter from "@/components/marketing/MarketingFooter";

export const metadata = { title: "Privacy Policy | Commonwealth Inspection Services" };

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-white">
      <MarketingNav />
      <div className="mx-auto max-w-2xl px-4 py-10">
        <h1 className="text-2xl font-bold text-brand-700">Privacy Policy</h1>
        <p className="mt-2 text-sm text-slate-500">Last updated September 27, 2026</p>

        <div className="mt-6 space-y-5 text-sm leading-relaxed text-slate-700">
          <p>
            Commonwealth Inspection Services, LLC ("Commonwealth," "we," "us") provides asbestos, mold,
            and lead inspection and testing services in Massachusetts. This policy explains what
            information we collect and how we use it, both through this website and through the internal
            tools we use to run our business.
          </p>

          <h2 className="text-lg font-semibold text-brand-700">Information we collect</h2>
          <p>
            When you book a service, request a quote, or work with us as a client, contractor, or
            partner company, we collect the information needed to schedule and complete that work:
            name, email, phone number, property address, and details about the inspection or testing
            requested. If you pay online, payment is processed by Stripe; we do not store your card
            details ourselves.
          </p>

          <h2 className="text-lg font-semibold text-brand-700">How we use it</h2>
          <p>
            We use this information to schedule inspections, produce reports, send invoices and
            receipts, and communicate with you about your project. We do not sell your information to
            third parties.
          </p>

          <h2 className="text-lg font-semibold text-brand-700">Internal accounting tools</h2>
          <p>
            We use QuickBooks Online for our own bookkeeping. A small internal integration ("Commonwealth
            Mileage Sync") connects our own job-scheduling software directly to our own QuickBooks
            Online account, so that business mileage we track for tax purposes is recorded automatically
            instead of re-entered by hand. This integration is for Commonwealth's own internal use only
            — it is not offered to, or usable by, any other company, and it does not share any client
            data with QuickBooks; it only records our own mileage expense entries.
          </p>

          <h2 className="text-lg font-semibold text-brand-700">Questions</h2>
          <p>
            If you have questions about this policy or your information, contact us at{" "}
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
