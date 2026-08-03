"use client";

import { useEffect, useState } from "react";
import { joinName } from "@/lib/name";

interface Contact {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  hasLogin: boolean;
}

// Company-account-only section on My Account (see AccountForm.tsx) — lets
// any logged-in member of a company invite teammates, who land already
// linked to the same company and immediately see all of its projects. Was
// previously its own "Contacts" nav tab; folded in here since it's really
// just another account-settings concern, not a separate destination.
export default function TeammatesSection() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [billingContactId, setBillingContactId] = useState<string | null>(null);
  const [selfId, setSelfId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [adding, setAdding] = useState(false);
  const [invitingId, setInvitingId] = useState<string | null>(null);
  const [invitedId, setInvitedId] = useState<string | null>(null);

  function load() {
    setLoading(true);
    fetch("/api/portal/contacts")
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error ?? "Failed to load teammates");
        setContacts(data.contacts);
        setBillingContactId(data.billingContactId);
        setSelfId(data.selfId);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load teammates"))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function addAndInvite() {
    setAdding(true);
    setError(null);
    try {
      const res = await fetch("/api/portal/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: joinName(firstName, lastName), email }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save teammate");

      const inviteRes = await fetch(`/api/portal/contacts/${data.contact.id}/invite`, { method: "POST" });
      const inviteData = await inviteRes.json();
      if (!inviteRes.ok) throw new Error(inviteData.error ?? "Teammate saved, but the invite failed to send");

      setFirstName("");
      setLastName("");
      setEmail("");
      setInvitedId(data.contact.id);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to send invite");
      load();
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

  async function invite(id: string) {
    setInvitingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/portal/contacts/${id}/invite`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to send invite");
      setInvitedId(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to send invite");
    } finally {
      setInvitingId(null);
    }
  }

  return (
    <div className="mt-4 rounded-lg border border-slate-200 bg-white p-3">
      <h2 className="text-xs font-bold uppercase text-slate-500">Teammates</h2>
      <p className="mt-1 text-sm text-slate-500">
        Invite people at your company to set up their own login — they&apos;ll immediately see all of your company&apos;s projects.
      </p>

      {error && <div className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      <div className="mt-3 flex gap-2">
        <input
          className="w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
          placeholder="First name"
          value={firstName}
          onChange={(e) => setFirstName(e.target.value)}
        />
        <input
          className="w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
          placeholder="Last name"
          value={lastName}
          onChange={(e) => setLastName(e.target.value)}
        />
      </div>
      <input
        className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        placeholder="Email"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <button
        className="mt-2 inline-flex h-[22px] items-center border-[3px] border-brand-700 bg-brand-50 px-4 pt-0.5 text-sm font-extrabold uppercase leading-none text-brand-700 hover:bg-yellow-100 disabled:opacity-50 sm:h-[29px]"
        disabled={adding || !firstName.trim() || !lastName.trim() || !email.trim()}
        onClick={addAndInvite}
      >
        {adding ? "Sending…" : "Add teammate"}
      </button>

      {loading ? (
        <p className="mt-4 text-sm text-slate-500">Loading…</p>
      ) : contacts.length === 0 ? (
        <p className="mt-4 text-sm text-slate-500">No teammates yet — they&apos;ll appear here once you invite one.</p>
      ) : (
        <div className="mt-3 space-y-2">
          {contacts.map((c) => (
            <div key={c.id} className="flex items-center justify-between rounded-lg border border-slate-200 p-3">
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
                {c.id !== selfId && !c.hasLogin && (
                  invitedId === c.id ? (
                    <span className="text-xs font-medium text-emerald-700">Invite sent</span>
                  ) : (
                    <button
                      onClick={() => invite(c.id)}
                      disabled={invitingId === c.id}
                      className="text-xs text-brand-600 underline disabled:opacity-50"
                    >
                      {invitingId === c.id ? "Sending…" : "Invite"}
                    </button>
                  )
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
