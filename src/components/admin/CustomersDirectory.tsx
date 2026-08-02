"use client";

import { useState } from "react";
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

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <h1 className="text-lg font-semibold text-slate-800">Directory</h1>

      <div className="mt-3 flex gap-1 border-b border-slate-200">
        <button
          onClick={() => setTab("companies")}
          className={`px-3 py-2 text-sm font-medium ${tab === "companies" ? "border-b-2 border-brand-600 text-brand-600" : "text-slate-500"}`}
        >
          Companies
        </button>
        <button
          onClick={() => setTab("contacts")}
          className={`px-3 py-2 text-sm font-medium ${tab === "contacts" ? "border-b-2 border-brand-600 text-brand-600" : "text-slate-500"}`}
        >
          Individuals
        </button>
        <button
          onClick={() => setTab("accounts")}
          className={`px-3 py-2 text-sm font-medium ${tab === "accounts" ? "border-b-2 border-brand-600 text-brand-600" : "text-slate-500"}`}
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
