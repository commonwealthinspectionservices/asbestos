"use client";

import { useEffect, useMemo, useState } from "react";
import type { RaysLibraryEntry } from "@/lib/types";

// A reference catalog of materials sampled across real past full-inspection
// asbestos reports (all inspected by Raymond Leger at the owner's prior
// company, plus a couple by the owner himself) — a pre-job "bank of what to
// look for" the owner reviews before a full inspection. Deliberately not
// wired into any data-entry workflow: a job's own materials (MaterialsEditor
// in JobsDashboard.tsx) are entered fresh per job, independent of this list.
//
// Each row in rays_library is one real occurrence (one homogeneous material
// sampled once) — aggregated here by material into a positive rate, which
// grows more accurate as more real reports get added over time. Locations
// aren't tracked here — just the material and how often it's turned out to
// be ACM.
interface MaterialGroup {
  material: string;
  total: number;
  positive: number;
}

export default function RaysLibrary() {
  const [entries, setEntries] = useState<RaysLibraryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

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
    const byMaterial = new Map<string, MaterialGroup>();
    for (const e of entries) {
      const existing = byMaterial.get(e.material);
      if (existing) {
        existing.total += 1;
        if (e.is_acm) existing.positive += 1;
      } else {
        byMaterial.set(e.material, { material: e.material, total: 1, positive: e.is_acm ? 1 : 0 });
      }
    }
    return Array.from(byMaterial.values()).sort((a, b) => a.material.localeCompare(b.material));
  }, [entries]);

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <h1 className="text-lg font-semibold text-slate-800">Ray&apos;s Library</h1>

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
            const pct = Math.round((g.positive / g.total) * 100);
            return (
              <div key={g.material} className="flex items-center justify-between rounded-lg border border-slate-200 bg-white p-3">
                <span className="font-medium text-slate-800">{g.material}</span>
                <span className={`text-sm font-semibold ${pct > 0 ? "text-red-600" : "text-slate-500"}`}>
                  {pct}% positive <span className="font-normal text-slate-400">({g.positive} of {g.total})</span>
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
