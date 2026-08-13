import type { Metadata } from "next";
import MarketingNav from "@/components/marketing/MarketingNav";
import MarketingFooter from "@/components/marketing/MarketingFooter";
import ContactForm from "@/components/marketing/ContactForm";
import { getSettings } from "@/lib/settings";

export const metadata: Metadata = {
  title: "Contact Us | Commonwealth Inspection Services, LLC.",
  description: "Get in touch with Commonwealth Inspection Services for asbestos and mold inspections across Massachusetts, or book your inspection online.",
};

export default async function ContactPage() {
  const settings = await getSettings();

  return (
    <div className="min-h-screen bg-white">
      <MarketingNav />
      <div className="mx-auto max-w-2xl px-4 py-10">
        <h1 className="text-2xl font-bold uppercase text-brand-700">Contact</h1>

        <div className="mt-6 flex flex-col gap-4">
          <div className="rounded-lg border border-slate-200 p-4">
            <h3 className="font-bold text-brand-700">Phone</h3>
            <p className="mt-1 text-slate-700">
              <a href={`tel:${settings.business_phone}`} className="hover:text-brand-600">
                {settings.business_phone}
              </a>
            </p>
          </div>

          <div className="rounded-lg border border-slate-200 p-4">
            <h3 className="font-bold text-brand-700">Email</h3>
            <p className="mt-1 text-slate-700">
              <a href="mailto:maasbestos@gmail.com" className="text-brand-600 underline">
                maasbestos@gmail.com
              </a>
            </p>
          </div>

          <div className="rounded-lg border border-slate-200 p-4">
            <h3 className="font-bold text-brand-700">Licensing</h3>
            <p className="mt-1 text-slate-700">
              Commonwealth Inspection Services, LLC
              <br />
              MA Asbestos Consulting Service Provider License #AF154
            </p>
            <p className="mt-2 text-sm text-slate-500">
              All inspections are performed in accordance with Massachusetts DLS and MassDEP
              guidance. Sample results are reported by an accredited third-party laboratory.
            </p>
          </div>
        </div>

        <div className="mt-6">
          <ContactForm />
        </div>
      </div>
      <MarketingFooter />
    </div>
  );
}
