"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const SERVICE_LINKS = [
  { href: "/services/asbestos", label: "Asbestos Inspections" },
  { href: "/services/mold", label: "Mold Inspections" },
  { href: "/services/lead", label: "Lead Paint Sampling" },
];

const NAV_LINKS = [
  { href: "/", label: "Home" },
  { href: "/pricing", label: "Pricing" },
  { href: "/blog", label: "Blog" },
  { href: "/faq", label: "FAQ" },
  { href: "/contact", label: "Contact" },
];

export default function MarketingNav() {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  // Only true mobile (below sm, 640px) collapses into a hamburger — from sm
  // up through tablet widths the full row just gets tighter (smaller text,
  // smaller gaps) rather than hiding anything, since that width range has
  // room to fit everything without it, once squeezed.
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  const linkClass = (href: string) =>
    `shrink-0 whitespace-nowrap px-1.5 py-1 text-xs font-bold uppercase text-brand-700 hover:underline md:text-sm ${
      pathname === href ? "underline" : ""
    }`;

  const mobileLinkClass = (href: string) =>
    `block px-1 py-2 text-sm font-bold uppercase text-brand-700 ${pathname === href ? "underline" : ""}`;

  const clientPortalClass =
    "inline-flex h-[22px] shrink-0 items-center whitespace-nowrap border-[3px] border-brand-700 bg-brand-50 px-2 pt-0.5 text-xs font-extrabold uppercase leading-none text-brand-700 hover:bg-yellow-100 md:h-[29px] md:text-sm";

  return (
    // The inner row is capped at max-w-4xl, same as the pricing estimator
    // card (src/components/marketing/PricingCalculator.tsx) and every other
    // body section's content — px-4 outer padding matches too, so the logo
    // and Client Portal line up with the page content's edges instead of
    // sitting closer to the screen edge than the content does.
    <nav className="relative border-b-4 border-brand-700 bg-brand-50 px-4 py-1.5">
      <div className="mx-auto flex max-w-4xl items-center justify-between gap-2">
        <Link href="/" className="inline-flex shrink-0 items-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/letterhead.png" alt="Commonwealth Inspection Services, LLC" className="h-9 w-auto sm:h-9 md:h-11" />
        </Link>

        <div className="hidden shrink-0 items-center gap-0.5 whitespace-nowrap sm:flex md:gap-1">
          {NAV_LINKS.slice(0, 1).map((link) => (
            <Link key={link.href} href={link.href} className={linkClass(link.href)}>{link.label}</Link>
          ))}
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
          {NAV_LINKS.slice(1).map((link) => (
            <Link key={link.href} href={link.href} className={linkClass(link.href)}>{link.label}</Link>
          ))}
          <Link href="/portal" className={`ml-1 ${clientPortalClass}`}>
            Client Portal
          </Link>
        </div>

        {/* Below sm: Client Portal still always stays visible in the header
            row itself, never inside the collapsible menu — the hamburger
            toggle sits next to it instead of replacing it. */}
        <div className="flex shrink-0 items-center gap-2 sm:hidden">
          <Link href="/portal" className={clientPortalClass}>
            Client Portal
          </Link>
          <button
            type="button"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
            className="flex h-[22px] w-[22px] shrink-0 flex-col items-center justify-center gap-0.5 border-[3px] border-brand-700"
          >
            <span className={`h-0.5 w-3 bg-brand-700 transition ${menuOpen ? "translate-y-1 rotate-45" : ""}`} />
            <span className={`h-0.5 w-3 bg-brand-700 transition ${menuOpen ? "opacity-0" : ""}`} />
            <span className={`h-0.5 w-3 bg-brand-700 transition ${menuOpen ? "-translate-y-1 -rotate-45" : ""}`} />
          </button>
        </div>
      </div>

      {menuOpen && (
        <div className="absolute left-0 top-full z-20 w-full border-b-4 border-brand-700 bg-brand-50 px-4 py-2 shadow-md sm:hidden">
          <Link href="/" className={mobileLinkClass("/")}>Home</Link>
          <div className="px-1 py-2 text-sm font-bold uppercase text-slate-400">Services</div>
          {SERVICE_LINKS.map((service) => (
            <Link key={service.href} href={service.href} className={`${mobileLinkClass(service.href)} pl-4`}>
              {service.label}
            </Link>
          ))}
          {NAV_LINKS.slice(1).map((link) => (
            <Link key={link.href} href={link.href} className={mobileLinkClass(link.href)}>{link.label}</Link>
          ))}
        </div>
      )}
    </nav>
  );
}
