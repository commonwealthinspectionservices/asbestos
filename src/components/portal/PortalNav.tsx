"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";

// Same breakdown pages the public marketing site links to (see
// SERVICE_LINKS in marketing/MarketingNav.tsx) — logged-in clients get the
// same dropdown so they don't have to leave the portal to look up what a
// service type actually involves — pointed at the portal's own copies
// (/portal/services/*, wrapped in this same PortalNav) rather than the
// public marketing pages, so clicking one doesn't drop the client out of
// the portal shell into the marketing site's nav/footer.
const SERVICE_LINKS = [
  { href: "/portal/services/asbestos", label: "Asbestos Inspections" },
  { href: "/portal/services/mold", label: "Mold Inspections" },
  { href: "/portal/services/lead", label: "Lead Paint Sampling" },
];

// Same visual language as MarketingNav/AdminNav — boxed brand button on the
// left, uppercase underline-on-active links, a boxed Sign out button on the
// right, collapsing into a hamburger below sm instead of wrapping or
// overflowing.
export default function PortalNav({ isIndividual = false }: { isIndividual?: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  async function logout() {
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    router.push("/portal/login");
    router.refresh();
  }

  // text-sm flat (no responsive downsize to text-xs on narrow viewports)
  // — matches the page body's own labels (ALL PROJECTS, SORT BY, SEARCH
  // BY, etc.), all of which are text-sm regardless of viewport.
  const linkClass = (href: string) =>
    `shrink-0 whitespace-nowrap px-1.5 py-1 text-sm font-bold uppercase text-brand-700 hover:underline ${
      pathname === href ? "underline" : ""
    }`;

  const mobileLinkClass = (href: string) =>
    `block px-1 py-2 text-sm font-bold uppercase text-brand-700 ${pathname === href ? "underline" : ""}`;

  const signOutClass =
    "inline-flex h-[29px] shrink-0 items-center whitespace-nowrap border-[3px] border-brand-700 bg-brand-50 px-2 pt-0.5 text-sm font-extrabold uppercase leading-none text-brand-700 hover:bg-yellow-100";

  const homeButtonClass =
    "inline-flex h-[29px] shrink-0 items-center whitespace-nowrap border-[3px] border-brand-700 bg-brand-50 px-2 pt-0.5 text-sm font-extrabold uppercase leading-none text-brand-700";

  const projectsLabel = isIndividual ? "My Projects" : "Projects";
  const accountLabel = isIndividual ? "My Account" : "Account";

  return (
    <nav className="relative border-b-4 border-brand-700 bg-brand-50 px-4 py-3">
      <div className="mx-auto flex max-w-4xl items-center justify-between gap-2">
        <Link href="/portal/dashboard" className={`shrink-0 ${homeButtonClass}`}>
          Commonwealth Inspection Services, LLC
        </Link>

        <div className="hidden shrink-0 items-center gap-0.5 whitespace-nowrap sm:flex md:gap-1">
          <Link href="/portal/dashboard" className={linkClass("/portal/dashboard")}>{projectsLabel}</Link>
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
          {!isIndividual && (
            <Link href="/portal/addresses" className={linkClass("/portal/addresses")}>Addresses</Link>
          )}
          <Link href="/portal/account" className={linkClass("/portal/account")}>{accountLabel}</Link>
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
          <Link href="/portal/dashboard" className={mobileLinkClass("/portal/dashboard")}>{projectsLabel}</Link>
          <div className="px-1 py-2 text-sm font-bold uppercase text-slate-400">Services</div>
          {SERVICE_LINKS.map((service) => (
            <Link key={service.href} href={service.href} className={`${mobileLinkClass(service.href)} pl-4`}>
              {service.label}
            </Link>
          ))}
          {!isIndividual && (
            <Link href="/portal/addresses" className={mobileLinkClass("/portal/addresses")}>Addresses</Link>
          )}
          <Link href="/portal/account" className={mobileLinkClass("/portal/account")}>{accountLabel}</Link>
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
