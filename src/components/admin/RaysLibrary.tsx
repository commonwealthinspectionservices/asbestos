"use client";

import { useEffect, useState } from "react";
import type { RaysLibraryEntry } from "@/lib/types";

// A reference-only catalog of materials/locations/results seen across real
// past full-inspection asbestos reports (all inspected by Raymond Leger at
// the owner's prior company) — kept for the owner's own reference while
// doing full inspections himself. Deliberately not wired into any
// data-entry workflow: a job's own materials (MaterialsEditor in
// JobsDashboard.tsx) are entered fresh per job, independent of this list.
export default function RaysLibrary() {
  const [entries, setEntries] = useState<RaysLibraryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);

  async function load(q = search) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/rays-library${q ? `?q=${encodeURIComponent(q)}` : ""}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load library");
      setEntries(data.entries);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load library");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const t = setTimeout(() => load(search), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  async function removeEntry(id: string) {
    const res = await fetch(`/api/admin/rays-library/${id}`, { method: "DELETE" });
    if (res.ok) load();
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold text-slate-800">Ray&apos;s Library</h1>
          <p className="text-sm text-slate-500">
            Reference catalog of materials, locations, and results from real past full-inspection asbestos reports — not used by any report or job.
          </p>
        </div>
        <button
          onClick={() => setAdding(true)}
          className="shrink-0 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white"
        >
          Add Entry
        </button>
      </div>

      <input
        className="mt-4 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        placeholder="Search by material, address, or notes…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {error && <div className="mt-3 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}

      {loading ? (
        <p className="mt-6 text-sm text-slate-500">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="mt-6 text-sm text-slate-500">No entries found.</p>
      ) : (
        <div className="mt-4 space-y-2">
          {entries.map((e) => (
            <div key={e.id} className="rounded-lg border border-slate-200 bg-white p-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-slate-800">{e.material}</span>
                    {e.is_acm === true && <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs font-bold uppercase text-red-700">ACM</span>}
                    {e.is_acm === false && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-bold uppercase text-slate-600">Non-ACM</span>}
                  </div>
                  {e.locations.length > 0 && <div className="mt-0.5 text-sm text-slate-600">{e.locations.join(", ")}</div>}
                  {(e.source_project_number || e.source_address) && (
                    <div className="mt-0.5 text-xs text-slate-400">
                      {[e.source_project_number, e.source_address].filter(Boolean).join(" — ")}
                    </div>
                  )}
                  {e.notes && <div className="mt-1 text-sm text-slate-500">{e.notes}</div>}
                </div>
                <button onClick={() => removeEntry(e.id)} className="shrink-0 text-sm text-red-600 hover:underline">
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {adding && (
        <AddEntryForm
          onClose={() => setAdding(false)}
          onDone={() => {
            setAdding(false);
            load();
          }}
        />
      )}
    </div>
  );
}

function AddEntryForm({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [material, setMaterial] = useState("");
  const [locations, setLocations] = useState("");
  const [isAcm, setIsAcm] = useState<"unknown" | "yes" | "no">("unknown");
  const [sourceProjectNumber, setSourceProjectNumber] = useState("");
  const [sourceAddress, setSourceAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/rays-library", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          material,
          locations: locations.split(",").map((l) => l.trim()).filter(Boolean),
          is_acm: isAcm === "unknown" ? null : isAcm === "yes",
          source_project_number: sourceProjectNumber,
          source_address: sourceAddress,
          notes,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save entry");
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save entry");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-md rounded-xl bg-white p-5">
        <h3 className="font-semibold text-slate-800">Add library entry</h3>
        {error && <div className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
        <div className="mt-3 space-y-2">
          <input className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Material" value={material} onChange={(e) => setMaterial(e.target.value)} />
          <input className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Locations (comma-separated)" value={locations} onChange={(e) => setLocations(e.target.value)} />
          <select className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" value={isAcm} onChange={(e) => setIsAcm(e.target.value as "unknown" | "yes" | "no")}>
            <option value="unknown">ACM unknown / varies</option>
            <option value="yes">ACM</option>
            <option value="no">Non-ACM</option>
          </select>
          <input className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Source project #" value={sourceProjectNumber} onChange={(e) => setSourceProjectNumber(e.target.value)} />
          <input className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Source address" value={sourceAddress} onChange={(e) => setSourceAddress(e.target.value)} />
          <textarea className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" rows={3} placeholder="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">Cancel</button>
          <button onClick={save} disabled={saving || !material.trim()} className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
