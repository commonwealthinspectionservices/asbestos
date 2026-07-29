"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

export default function AdminNav() {
  const pathname = usePathname();
  const router = useRouter();

  async function logout() {
    await fetch("/api/admin/login", { method: "DELETE" });
    router.push("/admin/login");
    router.refresh();
  }

  const linkClass = (href: string) =>
    `px-3 py-2 text-sm rounded-lg ${
      pathname === href ? "bg-brand-600 text-white" : "text-slate-600 hover:bg-slate-100"
    }`;

  return (
    <nav className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="Commonwealth Inspection Services, LLC." width={44} height={44} className="rounded-full" />
          <div className="ml-2 flex items-center gap-2">
            <Link href="/admin/dashboard" className={linkClass("/admin/dashboard")}>Projects</Link>
            <Link href="/admin/invoices" className={linkClass("/admin/invoices")}>Invoices</Link>
            <Link href="/admin/schedule" className={linkClass("/admin/schedule")}>Schedule</Link>
            <Link href="/admin/customers" className={linkClass("/admin/customers")}>Directory</Link>
            <Link href="/admin/settings" className={linkClass("/admin/settings")}>Settings</Link>
          </div>
        </div>
        <button onClick={logout} className="text-sm text-slate-500 hover:text-slate-800">
          Sign out
        </button>
      </div>
    </nav>
  );
}

export function AdminFooter() {
  return (
    <footer className="border-t border-slate-200 bg-white px-4 py-3 text-right text-sm text-slate-500">
      Commonwealth Inspection Services, LLC.
    </footer>
  );
}
