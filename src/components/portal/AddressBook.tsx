"use client";

import { useEffect, useState } from "react";
import type { SavedAddress } from "@/lib/types";

export default function AddressBook() {
  const [addresses, setAddresses] = useState<SavedAddress[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [address, setAddress] = useState("");
  const [adding, setAdding] = useState(false);

  function load() {
    setLoading(true);
    fetch("/api/portal/addresses")
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error ?? "Failed to load addresses");
        setAddresses(data.addresses);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load addresses"))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function addAddress() {
    setAdding(true);
    setError(null);
    try {
      const res = await fetch("/api/portal/addresses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label, address }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save address");
      setLabel("");
      setAddress("");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save address");
    } finally {
      setAdding(false);
    }
  }

  async function removeAddress(id: string) {
    const res = await fetch(`/api/portal/addresses/${id}`, { method: "DELETE" });
    if (res.ok) load();
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <h1 className="text-lg font-semibold text-slate-800">Saved addresses</h1>
      <p className="mt-1 text-sm text-slate-500">Save job sites you visit often for one-click booking.</p>

      {error && <div className="mt-3 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}

      <div className="mt-4 rounded-lg border border-slate-200 bg-white p-3">
        <input
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          placeholder="Label (optional) — e.g. 'Smith renovation'"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <input
          className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          placeholder="Address"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
        />
        <button
          className="mt-2 rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          disabled={adding || !address.trim()}
          onClick={addAddress}
        >
          {adding ? "Saving…" : "Save address"}
        </button>
      </div>

      {loading ? (
        <p className="mt-6 text-sm text-slate-500">Loading…</p>
      ) : addresses.length === 0 ? (
        <p className="mt-6 text-sm text-slate-500">No saved addresses yet.</p>
      ) : (
        <div className="mt-4 space-y-2">
          {addresses.map((a) => (
            <div key={a.id} className="flex items-center justify-between rounded-lg border border-slate-200 bg-white p-3">
              <div>
                {a.label && <div className="text-sm font-medium text-slate-800">{a.label}</div>}
                <div className="text-sm text-slate-600">{a.address}</div>
              </div>
              <button onClick={() => removeAddress(a.id)} className="text-sm text-red-600">
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
