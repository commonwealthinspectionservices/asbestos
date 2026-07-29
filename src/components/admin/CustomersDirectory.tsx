"use client";

import { useState } from "react";
import CompaniesDirectory from "@/components/admin/CompaniesDirectory";
import ContactsDirectory from "@/components/admin/ContactsDirectory";

// One directory, two tabs — companies (Boston Harbor Water Restoration) and
// individual contacts (a homeowner client, or an employee at one of those
// companies). A company's own card can still open one of its contacts, and
// a contact's own card can jump back to their company — the tab is just
// which list you start browsing from.
export default function CustomersDirectory() {
  const [tab, setTab] = useState<"companies" | "contacts">("companies");

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
      </div>

      <div className="mt-4">
        {tab === "companies" ? <CompaniesDirectory /> : <ContactsDirectory />}
      </div>
    </div>
  );
}
