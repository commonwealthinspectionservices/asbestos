import Link from "next/link";
import MarketingNav from "@/components/marketing/MarketingNav";
import MarketingFooter from "@/components/marketing/MarketingFooter";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col bg-white">
      <MarketingNav />
      <div className="mx-auto flex max-w-md flex-1 flex-col items-center px-4 py-10 text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/marketing/icon-inspector-ppe.png"
          alt=""
          className="h-40 w-auto"
        />
        <h1 className="mt-6 text-3xl font-bold text-brand-700">Page Not Found</h1>
        <p className="mt-3 text-slate-600">
          We couldn&apos;t find the page you were looking for. It may have moved, or the link
          might be out of date.
        </p>
        <div className="mt-6 flex gap-3">
          <Link
            href="/"
            className="inline-flex h-[22px] items-center border-[3px] border-brand-700 bg-brand-50 px-1.5 pt-0.5 text-[9px] font-extrabold uppercase leading-none text-brand-700 hover:bg-yellow-100 sm:px-2 sm:text-xs md:h-[29px] md:text-sm"
          >
            Home
          </Link>
          <Link
            href="/contact"
            className="inline-flex h-[22px] items-center border-[3px] border-brand-700 bg-brand-50 px-1.5 pt-0.5 text-[9px] font-extrabold uppercase leading-none text-brand-700 hover:bg-yellow-100 sm:px-2 sm:text-xs md:h-[29px] md:text-sm"
          >
            Contact
          </Link>
        </div>
      </div>
      <MarketingFooter />
    </div>
  );
}
