"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";

export default function PortalNav() {
  const pathname = usePathname();
  const router = useRouter();

  async function logout() {
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    router.push("/portal/login");
    router.refresh();
  }

  const linkClass = (href: string) =>
    `px-3 py-2 text-sm rounded-lg ${
      pathname === href ? "bg-brand-600 text-white" : "text-slate-600 hover:bg-slate-100"
    }`;

  return (
    <nav className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
      <div className="flex items-center gap-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="" width={24} height={24} className="rounded-full" />
        <span className="text-sm font-semibold text-brand-700">Commonwealth Inspection Services</span>
        <Link href="/portal/dashboard" className={linkClass("/portal/dashboard")}>My Projects</Link>
        <Link href="/portal/book" className={linkClass("/portal/book")}>Book a Project</Link>
        <Link href="/portal/addresses" className={linkClass("/portal/addresses")}>Addresses</Link>
        <Link href="/portal/contacts" className={linkClass("/portal/contacts")}>Contacts</Link>
      </div>
      <button onClick={logout} className="text-sm text-slate-500 hover:text-slate-800">
        Sign out
      </button>
    </nav>
  );
}
