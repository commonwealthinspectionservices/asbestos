"use client";

import { useEffect, useState } from "react";
import type { Job } from "@/lib/types";

interface Contact {
  id: string;
  name: string;
  email: string;
  phone: string | null;
}

// Only renders once the account has actually added other contacts (see
// /portal/contacts) — most accounts never touch this, so it stays out of
// the way rather than showing an empty picker with just yourself in it.
export default function JobRecipients({ job, onChanged }: { job: Job; onChanged: () => void }) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [billingContactId, setBillingContactId] = useState<string | null>(null);
  const [selfId, setSelfId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/portal/contacts")
      .then((r) => r.json())
      .then((data) => {
        setContacts(data.contacts ?? []);
        setBillingContactId(data.billingContactId ?? null);
        setSelfId(data.selfId ?? null);
      })
      .catch(() => {});
  }, []);

  const others = contacts.filter((c) => c.id !== selfId);
  if (others.length === 0) return null;

  const selectedRecipients = new Set(
    (job.report_emails ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean)
  );

  async function patchJob(patch: Record<string, unknown>) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/portal/projects/${job.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Something went wrong");
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  function toggleRecipient(email: string) {
    const next = new Set(selectedRecipients);
    if (next.has(email.toLowerCase())) next.delete(email.toLowerCase());
    else next.add(email.toLowerCase());
    patchJob({ resultRecipientEmails: Array.from(next) });
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Send results to</h4>
        {others.map((c) => (
          <label key={c.id} className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={selectedRecipients.has(c.email.toLowerCase())}
              disabled={saving}
              onChange={() => toggleRecipient(c.email)}
            />
            {c.name} — {c.email}
          </label>
        ))}
      </div>

      <div className="space-y-1">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Billing contact for this project</h4>
        <select
          className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
          value={job.billing_contact_id ?? ""}
          disabled={saving}
          onChange={(e) => patchJob({ billingContactId: e.target.value || null })}
        >
          <option value="">
            Account default{billingContactId ? ` (${contacts.find((c) => c.id === billingContactId)?.name ?? ""})` : ""}
          </option>
          {contacts.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}{c.id === selfId ? " (You)" : ""}
            </option>
          ))}
        </select>
      </div>

      {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}
    </div>
  );
}
