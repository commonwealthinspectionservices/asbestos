"use client";

import { useEffect, useState } from "react";

interface Contact {
  id: string;
  name: string;
  email: string;
  phone: string | null;
}

export default function ContactsList() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [billingContactId, setBillingContactId] = useState<string | null>(null);
  const [selfId, setSelfId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [adding, setAdding] = useState(false);

  function load() {
    setLoading(true);
    fetch("/api/portal/contacts")
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error ?? "Failed to load contacts");
        setContacts(data.contacts);
        setBillingContactId(data.billingContactId);
        setSelfId(data.selfId);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load contacts"))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function addContact() {
    setAdding(true);
    setError(null);
    try {
      const res = await fetch("/api/portal/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save contact");
      setName("");
      setEmail("");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save contact");
    } finally {
      setAdding(false);
    }
  }

  async function removeContact(id: string) {
    const res = await fetch(`/api/portal/contacts/${id}`, { method: "DELETE" });
    if (res.ok) load();
  }

  async function makeBillingContact(id: string) {
    const res = await fetch(`/api/portal/contacts/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isBillingContact: true }),
    });
    if (res.ok) load();
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <h1 className="text-lg font-semibold text-slate-800">Contacts</h1>
      <p className="mt-1 text-sm text-slate-500">
        Add people at your company so you can pick who gets results and invoices, per project.
      </p>

      {error && <div className="mt-3 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}

      <div className="mt-4 rounded-lg border border-slate-200 bg-white p-3">
        <input
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          placeholder="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          placeholder="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <button
          className="mt-2 inline-flex h-[22px] items-center border-[3px] border-brand-700 bg-brand-50 px-4 pt-0.5 text-sm font-extrabold uppercase leading-none text-brand-700 hover:bg-yellow-100 disabled:opacity-50 sm:h-[29px]"
          disabled={adding || !name.trim() || !email.trim()}
          onClick={addContact}
        >
          {adding ? "Saving…" : "Add contact"}
        </button>
      </div>

      {loading ? (
        <p className="mt-6 text-sm text-slate-500">Loading…</p>
      ) : contacts.length === 0 ? (
        <p className="mt-6 text-sm text-slate-500">No contacts yet — they'll appear here once you add one.</p>
      ) : (
        <div className="mt-4 space-y-2">
          {contacts.map((c) => (
            <div key={c.id} className="flex items-center justify-between rounded-lg border border-slate-200 bg-white p-3">
              <div>
                <div className="text-sm font-medium text-slate-800">
                  {c.name}
                  {c.id === selfId && <span className="text-slate-400"> (You)</span>}
                </div>
                <div className="text-sm text-slate-600">{c.email}</div>
              </div>
              <div className="flex items-center gap-3">
                {billingContactId === c.id ? (
                  <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-700">
                    Billing contact
                  </span>
                ) : (
                  <button onClick={() => makeBillingContact(c.id)} className="text-xs text-brand-600 underline">
                    Make billing contact
                  </button>
                )}
                {c.id !== selfId && (
                  <button onClick={() => removeContact(c.id)} className="text-sm text-red-600">
                    Remove
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
