"use client";

import { useEffect, useMemo, useState } from "react";
import type { RaysLibraryEntry } from "@/lib/types";

// A reference-only catalog of materials sampled across real past
// full-inspection asbestos reports (all inspected by Raymond Leger at the
// owner's prior company, plus a couple by the owner himself) — kept for the
// owner's own reference while doing full inspections himself. Deliberately
// not wired into any data-entry workflow: a job's own materials
// (MaterialsEditor in JobsDashboard.tsx) are entered fresh per job,
// independent of this list. This is purely "what gets sampled and where" —
// results (positive/negative) aren't tracked here.
interface MaterialGroup {
  material: string;
  locations: string[];
}

export default function RaysLibrary() {
  const [entries, setEntries] = useState<RaysLibraryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

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

  const groups: MaterialGroup[] = useMemo(() => {
    const byMaterial = new Map<string, string[]>();
    for (const e of entries) {
      const locations = byMaterial.get(e.material) ?? [];
      locations.push(...(e.locations ?? []).filter((l) => l.trim().length > 0));
      byMaterial.set(e.material, locations);
    }
    return Array.from(byMaterial.entries())
      .map(([material, locations]) => ({ material, locations }))
      .sort((a, b) => a.material.localeCompare(b.material));
  }, [entries]);

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold text-slate-800">Ray&apos;s Library</h1>
          <p className="text-sm text-slate-500">
            Reference catalog of materials sampled across real past full-inspection asbestos reports — not used by any report or job.
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
        placeholder="Search by material…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {error && <div className="mt-3 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}

      {loading ? (
        <p className="mt-6 text-sm text-slate-500">Loading…</p>
      ) : groups.length === 0 ? (
        <p className="mt-6 text-sm text-slate-500">No entries found.</p>
      ) : (
        <div className="mt-4 space-y-2">
          {groups.map((g) => {
            const isOpen = expanded === g.material;
            return (
              <div key={g.material} className="rounded-lg border border-slate-200 bg-white">
                <button
                  onClick={() => setExpanded(isOpen ? null : g.material)}
                  className="flex w-full items-center justify-between p-3 text-left"
                >
                  <span className="font-medium text-slate-800">{g.material}</span>
                  <span className="text-sm text-slate-400">
                    {g.locations.length} sampled {isOpen ? "▲" : "▼"}
                  </span>
                </button>
                {isOpen && (
                  <div className="border-t border-slate-100 px-3 pb-3 pt-2">
                    {g.locations.length === 0 ? (
                      <p className="text-sm text-slate-400">No locations recorded.</p>
                    ) : (
                      <ul className="list-inside list-disc space-y-1 text-sm text-slate-600">
                        {g.locations.map((loc, i) => (
                          <li key={i}>{loc}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            );
          })}
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
  const [location, setLocation] = useState("");
  const [sourceProjectNumber, setSourceProjectNumber] = useState("");
  const [sourceAddress, setSourceAddress] = useState("");
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
          locations: location.trim() ? [location.trim()] : [],
          source_project_number: sourceProjectNumber,
          source_address: sourceAddress,
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
        <h3 className="font-semibold text-slate-800">Add a sampled material</h3>
        <p className="mt-1 text-xs text-slate-500">One material, one location — this adds to that material&apos;s list of sampled locations.</p>
        {error && <div className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
        <div className="mt-3 space-y-2">
          <input className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Material" value={material} onChange={(e) => setMaterial(e.target.value)} />
          <input className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Location sampled" value={location} onChange={(e) => setLocation(e.target.value)} />
          <input className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Source project # (optional)" value={sourceProjectNumber} onChange={(e) => setSourceProjectNumber(e.target.value)} />
          <input className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Source address (optional)" value={sourceAddress} onChange={(e) => setSourceAddress(e.target.value)} />
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
