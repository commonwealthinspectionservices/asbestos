"use client";

import { useEffect, useState } from "react";

interface PortalAccount {
  id: string;
  email: string;
  createdAt: string;
  lastSignInAt: string | null;
  emailConfirmed: boolean;
  accountType: string | null;
  onboardingComplete: boolean;
  name: string | null;
  company: string | null;
}

// Every Supabase Auth account, not just the ones that finished onboarding
// into a customers row — surfaces accounts stuck mid-signup, which are
// otherwise invisible anywhere in the admin.
export default function PortalAccountsDirectory() {
  const [users, setUsers] = useState<PortalAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div>
      {error && <div className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}

      {loading ? (
        <p className="mt-6 text-sm text-slate-500">Loading…</p>
      ) : users.length === 0 ? (
        <p className="mt-6 text-sm text-slate-500">No portal accounts yet.</p>
      ) : (
        <div className="mt-4 space-y-2">
          {users.map((u) => (
            <div key={u.id} className="rounded-lg border border-slate-200 bg-white p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-medium text-slate-800">{u.name ?? u.email}</div>
                <div className="flex gap-1.5">
                  {!u.emailConfirmed && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                      Unconfirmed
                    </span>
                  )}
                  {!u.onboardingComplete && (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                      Onboarding incomplete
                    </span>
                  )}
                </div>
              </div>
              <div className="text-sm text-slate-500">{u.email}</div>
              {u.company && <div className="text-sm text-slate-500">{u.company}</div>}
              <div className="mt-1 text-xs text-slate-400">
                {u.accountType && <span className="uppercase">{u.accountType} · </span>}
                Signed up {new Date(u.createdAt).toLocaleDateString()}
                {u.lastSignInAt && ` · Last sign-in ${new Date(u.lastSignInAt).toLocaleDateString()}`}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
