"use client";

import { useEffect, useState } from "react";
import type { SavedAddress } from "@/lib/types";
import AddressAutocompleteInput from "@/components/shared/AddressAutocompleteInput";
import ZipInput, { useAutoZip } from "@/components/shared/ZipInput";
import { buildBillingAddress, US_STATES } from "@/lib/address";

export default function AddressBook() {
  const [addresses, setAddresses] = useState<SavedAddress[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Same structured street/unit/town/state/zip fields as Book a Project and
  // the admin's Add Project form (see JobsDashboard.tsx / PortalBookingForm.tsx).
  const [street, setStreet] = useState("");
  const [unit, setUnit] = useState("");
  const [city, setCity] = useState("");
  const [addrState, setAddrState] = useState("MA");
  const [zip, setZip] = useState("");
  const [adding, setAdding] = useState(false);

  useAutoZip(street, city, addrState, setZip, "/api/portal");

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
      const address = buildBillingAddress({ street, unit, city, state: addrState, zip });
      const res = await fetch("/api/portal/addresses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save address");
      setStreet("");
      setUnit("");
      setCity("");
      setAddrState("MA");
      setZip("");
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
      {error && <div className="mb-3 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}

      <div className="rounded-lg border border-slate-200 bg-white p-3">
        <h2 className="mb-2 text-xs font-bold uppercase text-slate-500">Save a new address</h2>
        <div className="flex flex-col gap-1.5 sm:flex-row">
          <div className="min-w-0 sm:w-0 sm:flex-1">
            <AddressAutocompleteInput
              apiBase="/api/portal"
              value={street}
              onChange={setStreet}
              onSelectAddress={(fields) => {
                setStreet(fields.street);
                setUnit(fields.unit);
                setCity(fields.city);
                setAddrState(fields.state || "MA");
                setZip(fields.zip);
              }}
              placeholder="Street address"
              townHint={city}
            />
          </div>
          <input
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm sm:w-20 sm:shrink-0"
            placeholder="Unit #"
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
          />
        </div>
        <div className="mt-1.5 grid grid-cols-1 gap-1.5 sm:grid-cols-3">
          <AddressAutocompleteInput
            apiBase="/api/portal"
            value={city}
            onChange={(v) => {
              setCity(v);
              if (!v.trim()) setZip("");
            }}
            mode="city"
            onSelectAddress={(fields) => {
              setCity(fields.city);
              setAddrState("MA");
              setZip(fields.zip);
            }}
            placeholder="Town"
          />
          <select
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            value={addrState}
            onChange={(e) => setAddrState(e.target.value)}
          >
            {US_STATES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <ZipInput street={street} city={city} state={addrState} zip={zip} setZip={setZip} apiBase="/api/portal" />
        </div>
        <button
          className="mt-2 inline-flex h-[22px] items-center border-[3px] border-brand-700 bg-brand-50 px-4 pt-0.5 text-sm font-extrabold uppercase leading-none text-brand-700 hover:bg-yellow-100 disabled:opacity-50 sm:h-[29px]"
          disabled={adding || !street.trim() || !city.trim() || !addrState.trim()}
          onClick={addAddress}
        >
          {adding ? "Saving…" : "Save"}
        </button>
      </div>

      <h2 className="mt-6 text-xs font-bold uppercase text-slate-500">Saved addresses</h2>

      {loading ? (
        <p className="mt-2 text-sm text-slate-500">Loading…</p>
      ) : addresses.length === 0 ? (
        <p className="mt-2 text-sm text-slate-500">No saved addresses yet.</p>
      ) : (
        <div className="mt-2 space-y-2">
          {addresses.map((a) => (
            <div key={a.id} className="flex items-center justify-between rounded-lg border border-slate-200 bg-white p-3">
              <div>
                {a.label && <div className="text-sm font-medium text-slate-800">{a.label}</div>}
                <div className="text-sm text-slate-600">{a.address}</div>
              </div>
              <button onClick={() => removeAddress(a.id)} className="text-sm text-red-600 hover:underline">
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
