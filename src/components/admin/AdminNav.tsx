"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

type NavLink = { href: string; label: string };

// Per Tim, 2026-08-30 — Invoices, Lab Costs, and Margins merged into one
// Billing page ("too many clicks... a lot of repeating information"), so
// the "Billing ▾" dropdown that used to group those three links (per Tim,
// 2026-08-29 — "idk it just seems like so many tabs") is gone too — one
// page needs one plain link, not a dropdown.
// Per Tim, 2026-08-31 — "delete Ray's Library from the tabs on top and
// just make it a small link at the bottom of the Chain of Custody page":
// it's still a real page (see /admin/rays-library), just no longer
// promoted to a top-level tab — the link now lives on the Chain of
// Custody page instead (see ChainOfCustodyView.tsx).
const NAV_LINKS: NavLink[] = [
  { href: "/admin/dashboard", label: "Projects" },
  { href: "/admin/billing", label: "Billing" },
  { href: "/admin/schedule", label: "Schedule" },
  { href: "/admin/customers", label: "Directory" },
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

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  // Per Tim, 2026-08-31 — "always make it so that the header is default at
  // the top of the screen... sometimes it starts with the header hidden,
  // and I don't want that to ever happen ever," then again: "when I go to
  // the billing tab, the default thing is to hide the header... it should
  // always start at the very, very, very top of the page." Mobile browsers
  // (Safari especially) restore the previous scroll position on back/
  // forward navigation by default — landing back on an admin page already
  // scrolled past the header. Forcing manual restoration + an explicit
  // scroll-to-top on every mount handles a normal navigation (present on
  // every admin page, since AdminNav renders at the top of each), but a
  // real back/forward-cache restore on Safari resumes the exact frozen
  // page — no remount, no mount effect — so it can still reassert its own
  // scroll position after this effect already ran once. The pageshow
  // listener (checking event.persisted, which is specifically true for a
  // bfcache restore) re-forces scroll-to-top for that case too.
  useEffect(() => {
    if ("scrollRestoration" in window.history) {
      window.history.scrollRestoration = "manual";
    }
    window.scrollTo(0, 0);
    const handlePageShow = (e: PageTransitionEvent) => {
      if (e.persisted) window.scrollTo(0, 0);
    };
    window.addEventListener("pageshow", handlePageShow);
    return () => window.removeEventListener("pageshow", handlePageShow);
  }, []);

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
          {NAV_LINKS.map((link) => (
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
          {NAV_LINKS.map((link) => (
            <Link key={link.href} href={link.href} className={mobileLinkClass(link.href)}>{link.label}</Link>
          ))}
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
