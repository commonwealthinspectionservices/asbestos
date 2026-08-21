"use client";

import { useEffect, useMemo, useState } from "react";
import { ContactDetailDialog } from "@/components/admin/ContactDetailDialog";

interface PortalAccount {
  id: string;
  email: string;
  createdAt: string;
  lastSignInAt: string | null;
  emailConfirmed: boolean;
  accountType: string | null;
  onboardingComplete: boolean;
  customerId: string | null;
  name: string | null;
  company: string | null;
}

// Every Supabase Auth account, not just the ones that finished onboarding
// into a customers row — surfaces accounts stuck mid-signup, which are
// otherwise invisible anywhere else in the admin.
export default function PortalAccountsDirectory({
  mobileSearch,
}: {
  /** The parent's single shared mobile search box — this tab never had its own search row, so this is the only way it filters. */
  mobileSearch: string;
}) {
  const [users, setUsers] = useState<PortalAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);

  function load() {
    setLoading(true);
    fetch("/api/admin/users")
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error ?? "Failed to load users");
        setUsers(data.users);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load users"))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  const filtered = useMemo(() => {
    const q = mobileSearch.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) => u.name?.toLowerCase().includes(q) || u.email.toLowerCase().includes(q));
  }, [users, mobileSearch]);

  return (
    <div>
      {error && <div className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}

      {loading ? (
        <p className="mt-6 text-sm text-slate-500">Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="mt-6 text-sm text-slate-500">{users.length === 0 ? "No portal accounts yet." : "No matches."}</p>
      ) : (
        <div className="mt-4 space-y-2">
          {filtered.map((u) => (
            // Only a completed onboarding has a customers row (the same
            // page opened from the Companies/Individuals tabs' own contact
            // cards) — an account still mid-signup has nowhere to link to.
            <div
              key={u.id}
              onClick={u.customerId ? () => setSelectedCustomerId(u.customerId) : undefined}
              className={`w-full rounded-lg border border-slate-200 bg-white p-3 text-left ${
                u.customerId ? "cursor-pointer hover:border-brand-400" : ""
              }`}
            >
              <div className="font-medium text-slate-800">{u.name ?? u.email}</div>
              {u.name && u.name !== u.email && <div className="text-sm text-slate-500">{u.email}</div>}
            </div>
          ))}
        </div>
      )}

      {selectedCustomerId && (
        <ContactDetailDialog
          customerId={selectedCustomerId}
          onClose={() => setSelectedCustomerId(null)}
          onChanged={load}
        />
      )}
    </div>
  );
}
