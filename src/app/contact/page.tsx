import Link from "next/link";
import type { Metadata } from "next";
import MarketingNav from "@/components/marketing/MarketingNav";
import MarketingFooter from "@/components/marketing/MarketingFooter";

export const metadata: Metadata = {
  title: "Contact Us | Commonwealth Inspection Services, LLC.",
  description: "Get in touch with Commonwealth Inspection Services for asbestos and mold inspections across Massachusetts, or book your inspection online.",
};

export default function ContactPage() {
  return (
    <div className="min-h-screen bg-white">
      <MarketingNav />
      <div className="mx-auto max-w-md px-4 py-10 text-center">
        <h1 className="text-2xl font-bold text-brand-700">Contact Us</h1>
        <p className="mt-4 text-slate-600">Massachusetts</p>
        <p className="mt-2 text-lg font-semibold text-slate-800">
          <a href="tel:617-390-4778" className="hover:text-brand-600">617-390-4778</a>
        </p>
        <p className="mt-1">
          <a href="mailto:maasbestos@gmail.com" className="text-brand-600 underline">
            maasbestos@gmail.com
          </a>
        </p>
        <Link
          href="/portal"
          className="mt-6 inline-block rounded-lg bg-brand-600 px-5 py-3 text-sm font-bold text-white hover:bg-brand-700"
        >
          Client Portal
        </Link>
      </div>
      <MarketingFooter />
    </div>
  );
}
