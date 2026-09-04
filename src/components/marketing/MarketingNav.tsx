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
  { href: "/blog", label: "Blog" },
  { href: "/faq", label: "FAQ" },
  { href: "/contact", label: "Contact" },
];

export default function MarketingNav() {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  // Below md (768px) collapses into a hamburger — moved up from the
  // original sm (640px) once Login + Create Account made the full row too
  // wide to fit in the 640-768px range even squeezed down.
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  const linkClass = (href: string) =>
    `shrink-0 whitespace-nowrap px-1.5 py-1 text-xs font-bold uppercase text-brand-700 hover:underline md:text-sm ${
      pathname === href ? "underline" : ""
    }`;

  const mobileLinkClass = (href: string) =>
    `block px-1 py-2 text-sm font-bold uppercase text-brand-700 hover:underline ${pathname === href ? "underline" : ""}`;

  const clientPortalClass =
    "inline-flex h-[22px] shrink-0 items-center whitespace-nowrap border-[3px] border-brand-700 bg-brand-50 px-1.5 pt-0.5 text-[9px] font-extrabold uppercase leading-none text-brand-700 hover:bg-yellow-100 sm:px-2 sm:text-xs md:h-[29px] md:text-sm";

  // Same border/height format as the Client Portal button, but no yellow
  // hover fill (this one's just branding/home, not an action) and a
  // smaller mobile font so the full company name fits next to the
  // hamburger without overflowing the header. Below md, it's the only
  // thing sharing the row with the hamburger, so it grows wider (centered
  // text) to mostly fill the width instead of sitting tight around its own
  // text with a big empty gap to the hamburger.
  const homeButtonClass =
    "inline-flex h-[22px] items-center justify-center whitespace-nowrap border-[3px] border-brand-700 bg-brand-50 px-1.5 pt-0.5 text-[13px] font-extrabold uppercase leading-none text-brand-700 sm:px-2 sm:text-xs md:h-[29px] md:text-sm";

  return (
    // The inner row is capped at max-w-4xl, same as the pricing estimator
    // card and the Service Type grid, so on wide desktop screens the header
    // content lines up with the body content's width instead of stretching
    // out to the edges of the browser window.
    <nav className="relative border-b-4 border-brand-700 bg-brand-50 px-4 py-3">
      <div className="mx-auto flex max-w-4xl items-center justify-between gap-2">
        <Link href="/" className={`w-[85%] md:w-auto md:shrink-0 ${homeButtonClass}`}>
          Commonwealth Inspection Services, LLC
        </Link>

        <div className="hidden shrink-0 items-center gap-0.5 whitespace-nowrap md:flex">
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
            Login
          </Link>
          <Link href="/portal/signup" className={`ml-1.5 ${clientPortalClass}`}>
            Create Account
          </Link>
        </div>

        {/* Below md: just the hamburger — Login/Create Account move into
            the collapsible menu itself instead of sitting in the header row. */}
        <div className="flex shrink-0 items-center gap-2 md:hidden">
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
        <div className="absolute left-0 top-full z-20 w-full border-b-4 border-brand-700 bg-brand-50 px-4 py-2 shadow-md md:hidden">
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
          <Link href="/portal" className={`${mobileLinkClass("/portal")} mt-1 border-t border-brand-700/20 pt-3`}>
            Login
          </Link>
          <Link href="/portal/signup" className={mobileLinkClass("/portal/signup")}>
            Create Account
          </Link>
        </div>
      )}
    </nav>
  );
}
