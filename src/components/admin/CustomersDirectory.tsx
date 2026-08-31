"use client";

import { useEffect, useState } from "react";
import CompaniesDirectory from "@/components/admin/CompaniesDirectory";
import ContactsDirectory from "@/components/admin/ContactsDirectory";
import HomeownersDirectory from "@/components/admin/HomeownersDirectory";

// One directory, three tabs — companies (Boston Harbor Water Restoration),
// individual contacts (a client who's an individual, or an employee at one
// of those companies), and homeowners (a read-only view built from job
// records, not a table of its own — see HomeownersDirectory). A company's
// own card can still open one of its contacts, and a contact's own card can
// jump back to their company — the tab is just which list you start
// browsing from.
//
// Per Tim, 2026-08-30 — dropped the "Portal Accounts" tab (every Supabase
// Auth account, including ones stuck mid-signup): felt like a repeat of
// Individuals with no real day-to-day use. See PortalAccountsDirectory.tsx
// in git history if that raw-accounts view is ever needed again.
export default function CustomersDirectory() {
  const [tab, setTab] = useState<"companies" | "contacts" | "homeowners">("companies");
  // Lifted up from CompaniesDirectory/ContactsDirectory so the header's
  // mobile-only Add button (next to the Directory title) and each tab's
  // own desktop button open the same form.
  const [addingCompany, setAddingCompany] = useState(false);
  const [addingContact, setAddingContact] = useState(false);
  // One shared search box for mobile, rendered once in a fixed spot
  // regardless of which tab is active — previously each tab drew its own
  // search row (or, for Portal Accounts, none at all), so the whole layout
  // shifted every time the tab changed. Desktop is untouched: each tab
  // still has its own search row exactly as before.
  const [mobileSearch, setMobileSearch] = useState("");
  useEffect(() => {
    setMobileSearch("");
  }, [tab]);

  // Lets other pages deep-link straight into a tab (e.g. a job's "Customer"
  // link opens here with ?tab=contacts so the right list is already showing
  // before ContactsDirectory opens the specific contact via ?contactId=).
  // Read in an effect, not a useState initializer — the initializer runs
  // during SSR too (no window), so reading location there would make the
  // client's first render diverge from the server's and trip a hydration
  // mismatch instead of just picking the tab a render late.
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    if (t === "contacts" || t === "homeowners") setTab(t);
  }, []);

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold uppercase text-slate-800">Directory</h1>
        {/* Mobile only, always both regardless of the active tab — on
            desktop, these stay where they've always been, inside each
            tab's own search row. Clicking either one switches to that
            tab too, since the actual add form lives there. */}
        <div className="flex shrink-0 gap-2 sm:hidden">
          <button
            onClick={() => { setTab("companies"); setAddingCompany(true); }}
            className="shrink-0 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white"
          >
            ADD COMPANY
          </button>
          <button
            onClick={() => { setTab("contacts"); setAddingContact(true); }}
            className="shrink-0 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white"
          >
            ADD CONTACT
          </button>
        </div>
      </div>

      {/* Mobile: a single dropdown instead of a tab row — desktop keeps the
          unchanged left-packed row of tab buttons below. */}
      <div className="relative mt-3 sm:hidden">
        <select
          value={tab}
          onChange={(e) => setTab(e.target.value as typeof tab)}
          className="w-full appearance-none rounded-lg border border-slate-300 bg-white py-2 pl-3 pr-10 text-sm font-medium text-slate-700"
        >
          <option value="companies">Companies</option>
          <option value="contacts">Individuals</option>
          <option value="homeowners">Homeowners</option>
        </select>
        <span className="pointer-events-none absolute inset-y-0 right-0 flex w-9 items-center justify-center text-slate-500">▾</span>
      </div>

      {/* Same shared search box, same spot, on every tab (mobile only). */}
      <input
        className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm sm:hidden"
        placeholder={
          tab === "companies" ? "Search by company name…" :
          tab === "contacts" ? "Search by name, company, or email…" :
          "Search by name, phone, or address…"
        }
        value={mobileSearch}
        onChange={(e) => setMobileSearch(e.target.value)}
      />

      <div className="mt-3 hidden gap-1 border-b border-slate-200 sm:flex">
        <button
          onClick={() => setTab("companies")}
          className={`shrink-0 whitespace-nowrap px-3 py-2 text-sm font-medium uppercase ${tab === "companies" ? "border-b-2 border-brand-600 text-brand-600" : "text-slate-500 hover:underline"}`}
        >
          Companies
        </button>
        <button
          onClick={() => setTab("contacts")}
          className={`shrink-0 whitespace-nowrap px-3 py-2 text-sm font-medium uppercase ${tab === "contacts" ? "border-b-2 border-brand-600 text-brand-600" : "text-slate-500 hover:underline"}`}
        >
          Individuals
        </button>
        <button
          onClick={() => setTab("homeowners")}
          className={`shrink-0 whitespace-nowrap px-3 py-2 text-sm font-medium uppercase ${tab === "homeowners" ? "border-b-2 border-brand-600 text-brand-600" : "text-slate-500 hover:underline"}`}
        >
          Homeowners
        </button>
      </div>

      <div className="mt-4">
        {tab === "companies" ? (
          <CompaniesDirectory adding={addingCompany} onAddingChange={setAddingCompany} mobileSearch={mobileSearch} />
        ) : tab === "contacts" ? (
          <ContactsDirectory adding={addingContact} onAddingChange={setAddingContact} mobileSearch={mobileSearch} />
        ) : (
          <HomeownersDirectory mobileSearch={mobileSearch} />
        )}
      </div>
    </div>
  );
}
