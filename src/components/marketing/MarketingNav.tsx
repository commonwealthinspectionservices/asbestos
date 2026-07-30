"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function MarketingNav() {
  const pathname = usePathname();

  const linkClass = (href: string) =>
    `px-3 py-2 text-sm rounded-lg ${
      pathname === href ? "bg-brand-600 text-white" : "text-slate-600 hover:bg-slate-100"
    }`;

  return (
    <nav className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
      <div className="flex items-center gap-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="" width={32} height={32} className="rounded-full" />
        <span className="hidden text-sm font-semibold text-brand-700 sm:inline">
          Commonwealth Inspection Services
        </span>
      </div>
      <div className="flex items-center gap-1">
        <Link href="/" className={linkClass("/")}>Home</Link>
        <Link href="/blog" className={linkClass("/blog")}>Blog</Link>
        <Link href="/faq" className={linkClass("/faq")}>FAQ</Link>
        <Link href="/contact" className={linkClass("/contact")}>Contact</Link>
        <Link
          href="/portal"
          className="ml-2 rounded-lg bg-brand-600 px-3 py-2 text-sm font-bold text-white hover:bg-brand-700"
        >
          Client Portal
        </Link>
      </div>
    </nav>
  );
}
