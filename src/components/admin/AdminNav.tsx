"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

type NavLink = { href: string; label: string };

// Per Tim, 2026-08-29 — "idk it just seems like so many tabs": Invoices,
// Lab Costs, and Margins are the three money-tracking pages (what
// customers owe, what the lab charges, and the two combined) — grouped
// under one "Billing" dropdown so the top-level bar reads as 7 items
// instead of 9, without actually merging any of those pages (each still
// answers a different question — see their own comments).
const BILLING_LINKS: NavLink[] = [
  { href: "/admin/invoices", label: "Invoices" },
  { href: "/admin/lab-invoices", label: "Lab Costs" },
  { href: "/admin/margins", label: "Margins" },
];

const NAV_LINKS: NavLink[] = [
  { href: "/admin/dashboard", label: "Projects" },
  { href: "/admin/schedule", label: "Schedule" },
  { href: "/admin/customers", label: "Directory" },
  { href: "/admin/rays-library", label: "Ray's Library" },
  { href: "/admin/chain-of-custody", label: "Chain of Custody" },
  { href: "/admin/settings", label: "Settings" },
];

// Same visual language as the marketing site's MarketingNav — boxed brand
// button on the left, uppercase underline-on-active links, a boxed CTA
// button on the right (Client Portal there, Sign out here), collapsing into
// a hamburger below sm instead of wrapping awkwardly.
export default function AdminNav() {
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [billingOpen, setBillingOpen] = useState(false);
  const billingRef = useRef<HTMLDivElement>(null);
  const isBillingRoute = BILLING_LINKS.some((l) => l.href === pathname);

  useEffect(() => {
    setMenuOpen(false);
    setBillingOpen(false);
  }, [pathname]);

  // Closes the Billing dropdown on a click anywhere outside it — the usual
  // way a nav dropdown behaves; nothing else in this file needed this
  // pattern before since the mobile menu is a full-width overlay instead.
  useEffect(() => {
    if (!billingOpen) return;
    function onClick(e: MouseEvent) {
      if (billingRef.current && !billingRef.current.contains(e.target as Node)) {
        setBillingOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [billingOpen]);

  async function logout() {
    await fetch("/api/admin/login", { method: "DELETE" });
    router.push("/admin/login");
    router.refresh();
  }

  const linkClass = (href: string) =>
    `shrink-0 whitespace-nowrap px-1.5 py-1 text-xs font-bold uppercase text-brand-700 hover:underline md:text-sm ${
      pathname === href ? "underline" : ""
    }`;

  const mobileLinkClass = (href: string) =>
    `block px-1 py-2 text-sm font-bold uppercase text-brand-700 ${pathname === href ? "underline" : ""}`;

  const signOutClass =
    "inline-flex h-[22px] shrink-0 items-center whitespace-nowrap border-[3px] border-brand-700 bg-brand-50 px-1.5 pt-0.5 text-[9px] font-extrabold uppercase leading-none text-brand-700 hover:bg-yellow-100 sm:px-2 sm:text-xs md:h-[29px] md:text-sm";

  const adminButtonClass =
    "inline-flex h-[22px] shrink-0 items-center whitespace-nowrap border-[3px] border-brand-700 bg-brand-50 px-1.5 pt-0.5 text-[9px] font-extrabold uppercase leading-none text-brand-700 sm:px-2 sm:text-xs md:h-[29px] md:text-sm";

  return (
    <nav className="relative border-b-4 border-brand-700 bg-brand-50 px-4 py-3">
      <div className="mx-auto flex max-w-4xl items-center justify-between gap-2">
        <Link href="/admin/dashboard" className={`shrink-0 ${adminButtonClass}`}>
          Admin
        </Link>

        <div className="hidden shrink-0 items-center gap-0.5 whitespace-nowrap sm:flex md:gap-1">
          <Link href="/admin/dashboard" className={linkClass("/admin/dashboard")}>Projects</Link>

          <div ref={billingRef} className="relative">
            <button
              type="button"
              onClick={() => setBillingOpen((v) => !v)}
              aria-expanded={billingOpen}
              className={`shrink-0 whitespace-nowrap px-1.5 py-1 text-xs font-bold uppercase text-brand-700 hover:underline md:text-sm ${
                isBillingRoute ? "underline" : ""
              }`}
            >
              Billing ▾
            </button>
            {billingOpen && (
              <div className="absolute left-0 top-full z-20 mt-1 w-36 rounded border-2 border-brand-700 bg-brand-50 py-1 shadow-md">
                {BILLING_LINKS.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={`block px-3 py-1.5 text-xs font-bold uppercase text-brand-700 hover:underline md:text-sm ${
                      pathname === link.href ? "underline" : ""
                    }`}
                  >
                    {link.label}
                  </Link>
                ))}
              </div>
            )}
          </div>

          {NAV_LINKS.slice(1).map((link) => (
            <Link key={link.href} href={link.href} className={linkClass(link.href)}>{link.label}</Link>
          ))}
          <button type="button" onClick={logout} className={`ml-1 ${signOutClass}`}>
            Sign out
          </button>
        </div>

        <div className="flex shrink-0 items-center gap-2 sm:hidden">
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
          <Link href="/admin/dashboard" className={mobileLinkClass("/admin/dashboard")}>Projects</Link>

          {/* Per Tim, 2026-08-29 — grouped under a small "Billing" heading
              on mobile too, same three links, just always expanded (no
              nested toggle) since the mobile menu is already its own
              full-width overlay — a second layer of collapsing here would
              be more taps, not fewer. */}
          <div className="mt-1 border-t border-brand-700/20 pt-1">
            <div className="px-1 pt-1 text-xs font-bold uppercase tracking-wide text-brand-700/50">Billing</div>
            {BILLING_LINKS.map((link) => (
              <Link key={link.href} href={link.href} className={mobileLinkClass(link.href)}>{link.label}</Link>
            ))}
          </div>

          <div className="mt-1 border-t border-brand-700/20 pt-1">
            {NAV_LINKS.slice(1).map((link) => (
              <Link key={link.href} href={link.href} className={mobileLinkClass(link.href)}>{link.label}</Link>
            ))}
          </div>

          <button
            type="button"
            onClick={logout}
            className={`${mobileLinkClass("")} mt-1 w-full border-t border-brand-700/20 pt-3 text-left`}
          >
            Sign out
          </button>
        </div>
      )}
    </nav>
  );
}

export function AdminFooter() {
  return (
    <footer className="border-t border-slate-200 bg-white px-4 py-3 text-right text-sm text-slate-500">
      Commonwealth Inspection Services, LLC
    </footer>
  );
}
