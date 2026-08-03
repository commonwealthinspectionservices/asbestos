"use client";

import { useEffect, useState } from "react";
import CompaniesDirectory from "@/components/admin/CompaniesDirectory";
import ContactsDirectory from "@/components/admin/ContactsDirectory";
import PortalAccountsDirectory from "@/components/admin/PortalAccountsDirectory";

// One directory, three tabs — companies (Boston Harbor Water Restoration),
// individual contacts (a homeowner client, or an employee at one of those
// companies), and every portal account (Supabase Auth), including ones
// that never finished onboarding into a customers row. A company's own
// card can still open one of its contacts, and a contact's own card can
// jump back to their company — the tab is just which list you start
// browsing from.
export default function CustomersDirectory() {
  const [tab, setTab] = useState<"companies" | "contacts" | "accounts">("companies");

  // Lets other pages deep-link straight into a tab (e.g. a job's "Customer"
  // link opens here with ?tab=contacts so the right list is already showing
  // before ContactsDirectory opens the specific contact via ?contactId=).
  // Read in an effect, not a useState initializer — the initializer runs
  // during SSR too (no window), so reading location there would make the
  // client's first render diverge from the server's and trip a hydration
  // mismatch instead of just picking the tab a render late.
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    if (t === "contacts" || t === "accounts") setTab(t);
  }, []);

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <h1 className="text-lg font-semibold uppercase text-slate-800">Directory</h1>

      <div className="mt-3 flex gap-1 border-b border-slate-200">
        <button
          onClick={() => setTab("companies")}
          className={`px-3 py-2 text-sm font-medium uppercase ${tab === "companies" ? "border-b-2 border-brand-600 text-brand-600" : "text-slate-500 hover:underline"}`}
        >
          Companies
        </button>
        <button
          onClick={() => setTab("contacts")}
          className={`px-3 py-2 text-sm font-medium uppercase ${tab === "contacts" ? "border-b-2 border-brand-600 text-brand-600" : "text-slate-500 hover:underline"}`}
        >
          Individuals
        </button>
        <button
          onClick={() => setTab("accounts")}
          className={`px-3 py-2 text-sm font-medium uppercase ${tab === "accounts" ? "border-b-2 border-brand-600 text-brand-600" : "text-slate-500 hover:underline"}`}
        >
          Portal Accounts
        </button>
      </div>

      <div className="mt-4">
        {tab === "companies" ? <CompaniesDirectory /> : tab === "contacts" ? <ContactsDirectory /> : <PortalAccountsDirectory />}
      </div>
    </div>
  );
}
