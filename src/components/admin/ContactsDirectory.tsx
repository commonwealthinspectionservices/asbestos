"use client";

import { useEffect, useMemo, useState } from "react";
import type { Customer } from "@/lib/types";
import { ContactDetailDialog, ContactForm } from "@/components/admin/ContactDetailDialog";

function ContactRow({ c, onClick }: { c: Customer; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full rounded-lg border border-slate-200 bg-white p-3 text-left hover:border-brand-400"
    >
      <div className="font-medium text-slate-800">{c.name}</div>
      {c.company && <div className="text-sm text-slate-500">{c.company}</div>}
    </button>
  );
}

// Every individual on file, whether they're a standalone client (an
// individual who's the client themselves) or one of several contacts at a
// company (an employee of Boston Harbor Water Restoration) — companies
// themselves live on their own "Companies" tab, not here.
export default function ContactsDirectory() {
  const [contacts, setContacts] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
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

  const needsPortalAccount = useMemo(() => contacts.filter((c) => !c.auth_user_id), [contacts]);
  const hasPortalAccount = useMemo(() => contacts.filter((c) => c.auth_user_id), [contacts]);

  return (
    <div>
      <div className="flex items-center justify-end gap-2">
        <button
          onClick={() => setAdding(true)}
          className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white"
        >
          ADD CONTACT
        </button>
      </div>

      <div className="mt-3 flex gap-2">
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
        <>
          {needsPortalAccount.length > 0 && (
            <div className="mt-4">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Needs portal account ({needsPortalAccount.length})
              </h4>
              <div className="mt-2 space-y-2">
                {needsPortalAccount.map((c) => (
                  <ContactRow key={c.id} c={c} onClick={() => setSelectedId(c.id)} />
                ))}
              </div>
            </div>
          )}

          {hasPortalAccount.length > 0 && (
            <div className="mt-4">
              {needsPortalAccount.length > 0 && (
                <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  All contacts
                </h4>
              )}
              <div className="mt-2 space-y-2">
                {hasPortalAccount.map((c) => (
                  <ContactRow key={c.id} c={c} onClick={() => setSelectedId(c.id)} />
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {adding && (
        <ContactForm
          onClose={() => setAdding(false)}
          onDone={() => {
            setAdding(false);
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
