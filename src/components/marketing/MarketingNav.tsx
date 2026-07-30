"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const SERVICE_LINKS = [
  { href: "/services/asbestos", label: "Asbestos Inspections" },
  { href: "/services/mold", label: "Mold Inspections" },
  { href: "/services/lead", label: "Lead Inspections" },
];

export default function MarketingNav() {
  const pathname = usePathname();

  const linkClass = (href: string) =>
    `shrink-0 whitespace-nowrap px-2 py-1 text-sm font-bold uppercase text-brand-700 hover:underline ${
      pathname === href ? "underline" : ""
    }`;

  return (
    <nav className="flex flex-nowrap items-center justify-between gap-3 border-b-4 border-brand-700 bg-brand-50 px-4 py-1.5">
      <Link href="/" className="inline-flex shrink-0 items-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/letterhead.png" alt="Commonwealth Inspection Services, LLC" className="h-12 w-auto sm:h-16" />
      </Link>
      <div className="flex shrink-0 items-center gap-1 whitespace-nowrap">
        <Link href="/" className={linkClass("/")}>Home</Link>
        <div className="group relative shrink-0">
          <button type="button" className={linkClass("/services")}>
            Services
          </button>
          <div className="invisible absolute left-0 top-full z-10 min-w-[9rem] pt-1 opacity-0 transition group-hover:visible group-hover:opacity-100">
            <div className="overflow-hidden border border-slate-200 bg-white shadow-md">
              {SERVICE_LINKS.map((service) => (
                <Link
                  key={service.href}
                  href={service.href}
                  className="block whitespace-nowrap px-3 py-2 text-sm font-bold uppercase text-brand-700 hover:underline"
                >
                  {service.label}
                </Link>
              ))}
            </div>
          </div>
        </div>
        <Link href="/pricing" className={linkClass("/pricing")}>Pricing</Link>
        <Link href="/blog" className={linkClass("/blog")}>Blog</Link>
        <Link href="/faq" className={linkClass("/faq")}>FAQ</Link>
        <Link href="/contact" className={linkClass("/contact")}>Contact</Link>
        <Link
          href="/portal"
          className="ml-2 shrink-0 whitespace-nowrap inline-flex h-[22px] sm:h-[29px] items-center border-[3px] border-brand-700 bg-brand-50 px-2 text-sm font-extrabold uppercase leading-none text-brand-700 hover:bg-yellow-100"
        >
          Client Portal
        </Link>
      </div>
    </nav>
  );
}
