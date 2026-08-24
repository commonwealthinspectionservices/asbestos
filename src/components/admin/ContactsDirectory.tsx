"use client";

import { useEffect, useState } from "react";
import type { Customer } from "@/lib/types";
import { ContactDetailDialog, ContactForm } from "@/components/admin/ContactDetailDialog";

function ContactRow({ c, onClick }: { c: Customer; onClick: () => void }) {
  // Companies still show their subtext as-is; a standalone individual's
  // subtext is just "Individual" — the company name obviously isn't
  // relevant to their own card.
  return (
    <button
      onClick={onClick}
      className="w-full rounded-lg border border-slate-200 bg-white p-3 text-left hover:border-brand-400"
    >
      <div className="font-medium text-slate-800">{c.name}</div>
      {c.company ? (
        <div className="text-sm text-slate-500">{c.company}</div>
      ) : (
        <div className="text-sm text-slate-500">Individual</div>
      )}
    </button>
  );
}

// Every individual on file, whether they're a standalone client (an
// individual who's the client themselves) or one of several contacts at a
// company (an employee of Boston Harbor Water Restoration) — companies
// themselves live on their own "Companies" tab, not here.
export default function ContactsDirectory({
  adding, onAddingChange, mobileSearch,
}: {
  /** Controlled from the parent so the header's mobile-only "Add Contact" button (next to the Directory title) and this row's own desktop button open the same form. */
  adding: boolean;
  onAddingChange: (v: boolean) => void;
  /** The parent's single shared mobile search box — this tab's own search row below is desktop-only now. */
  mobileSearch: string;
}) {
  const [contacts, setContacts] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Lets another page deep-link straight to one contact (e.g. a job's
  // "Customer" link) via /admin/customers?tab=contacts&contactId=<id>.
  // Read in an effect, not the useState initializer above — the initializer
  // also runs during SSR (no window there), so reading location from it
  // would make the client's first render diverge from the server's and
  // trip a hydration mismatch instead of just opening the dialog a render late.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("contactId");
    if (id) setSelectedId(id);
  }, []);

  async function loadContacts(q = search) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/customers${q ? `?q=${encodeURIComponent(q)}` : ""}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load contacts");
      setContacts(data.customers);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load contacts");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadContacts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounced so mobile typing doesn't fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => loadContacts(mobileSearch), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mobileSearch]);

  return (
    <div>
      {/* Hidden on mobile — the header's own Add Contact button (next to
          the Directory title) covers that width instead. */}
      <div className="hidden items-center justify-end gap-2 sm:flex">
        <button
          onClick={() => onAddingChange(true)}
          className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white"
        >
          ADD CONTACT
        </button>
      </div>

      {/* Desktop only — mobile uses the parent's single shared search box instead. */}
      <div className="mt-3 hidden gap-2 sm:flex">
        <input
          className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
          placeholder="Search by name, company, or email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && loadContacts()}
        />
        <button onClick={() => loadContacts()} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
          Search
        </button>
      </div>

      {error && <div className="mt-3 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}

      {loading ? (
        <p className="mt-6 text-sm text-slate-500">Loading…</p>
      ) : contacts.length === 0 ? (
        <p className="mt-6 text-sm text-slate-500">No contacts found.</p>
      ) : (
        <div className="mt-4 space-y-2">
          {contacts.map((c) => (
            <ContactRow key={c.id} c={c} onClick={() => setSelectedId(c.id)} />
          ))}
        </div>
      )}

      {adding && (
        <ContactForm
          onClose={() => onAddingChange(false)}
          onDone={() => {
            onAddingChange(false);
            loadContacts();
          }}
        />
      )}

      {selectedId && (
        <ContactDetailDialog
          customerId={selectedId}
          onClose={() => setSelectedId(null)}
          onChanged={() => loadContacts()}
        />
      )}
    </div>
  );
}
