"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";

// Same breakdown pages the public marketing site links to (see
// SERVICE_LINKS in marketing/MarketingNav.tsx) — logged-in clients get the
// same dropdown so they don't have to leave the portal to look up what a
// service type actually involves.
const SERVICE_LINKS = [
  { href: "/services/asbestos", label: "Asbestos Inspections" },
  { href: "/services/mold", label: "Mold Inspections" },
  { href: "/services/lead", label: "Lead Paint Sampling" },
];

export default function PortalNav({ isHomeowner = false }: { isHomeowner?: boolean }) {
  const pathname = usePathname();
  const router = useRouter();

  async function logout() {
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    router.push("/portal/login");
    router.refresh();
  }

  const linkClass = (href: string) =>
    `shrink-0 whitespace-nowrap px-1.5 py-1 text-sm font-semibold uppercase text-brand-700 hover:underline ${
      pathname === href ? "underline" : ""
    }`;

  return (
    // The inner row is capped at max-w-4xl, same as MarketingNav — keeps
    // the header content lined up with the marketing site's width instead
    // of stretching out to the edges on wide desktop screens.
    <nav className="border-b border-slate-200 bg-white px-3 py-1.5">
      <div className="mx-auto flex max-w-4xl flex-nowrap items-center justify-between gap-2">
        <Link href="/portal/dashboard" className="flex shrink-0 items-center gap-1.5 whitespace-nowrap">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="" width={24} height={24} className="shrink-0 rounded-full" />
          <span className="text-sm font-semibold uppercase text-brand-700">Commonwealth Inspection Services</span>
        </Link>
        <div className="flex shrink-0 items-center gap-1 whitespace-nowrap">
          <Link href="/portal/dashboard" className={linkClass("/portal/dashboard")}>My Projects</Link>
          <Link href="/portal/chat" className={linkClass("/portal/chat")}>Chat</Link>
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
                    className="block whitespace-nowrap px-3 py-2 text-sm font-semibold uppercase text-brand-700 hover:underline"
                  >
                    {service.label}
                  </Link>
                ))}
              </div>
            </div>
          </div>
          <Link href="/portal/addresses" className={linkClass("/portal/addresses")}>Addresses</Link>
          {!isHomeowner && (
            <Link href="/portal/contacts" className={linkClass("/portal/contacts")}>Contacts</Link>
          )}
          <Link href="/portal/account" className={linkClass("/portal/account")}>My Account</Link>
          <button
            onClick={logout}
            className="ml-1 inline-flex h-[22px] shrink-0 items-center whitespace-nowrap border-[3px] border-brand-700 bg-brand-50 px-1.5 pt-0.5 text-sm font-semibold uppercase leading-none text-brand-700 hover:bg-yellow-100 sm:h-[29px]"
          >
            Sign out
          </button>
        </div>
      </div>
    </nav>
  );
}
