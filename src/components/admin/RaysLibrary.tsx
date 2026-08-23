"use client";

import { useEffect, useMemo, useState } from "react";
import type { RaysLibraryEntry, RaysLibraryPhoto } from "@/lib/types";

// A reference catalog of materials sampled across real past full-inspection
// asbestos reports (all inspected by Raymond Leger at the owner's prior
// company, plus a couple by the owner himself) — a pre-job "bank of what to
// look for" the owner reviews before a full inspection. Deliberately not
// wired into any data-entry workflow: a job's own materials (MaterialsEditor
// in JobsDashboard.tsx) are entered fresh per job, independent of this list.
//
// Each row in rays_library is one real occurrence (one homogeneous material
// sampled once) — aggregated here by material into a positive count, which
// grows more accurate as more real reports get added over time. Locations
// aren't tracked here — just the material and how often it's turned out to
// be ACM. A material with real site photos (rays_library_photos — only ever
// populated for materials that tested positive somewhere, since that's the
// only thing the source reports photograph) is clickable to view them.
//
// is_acm can be null — a handful of entries are official ACM-category
// reference materials (from EPA/college facilities-management guidance)
// that haven't shown up in a real sampled report yet. Those count toward
// `total` (so the material is listed at all) but not `sampled`/`positive`,
// so the card reads "Not yet sampled" instead of a fabricated "0 of 1".
interface MaterialGroup {
  material: string;
  total: number;
  sampled: number;
  positive: number;
}

export default function RaysLibrary() {
  const [entries, setEntries] = useState<RaysLibraryEntry[]>([]);
  const [photos, setPhotos] = useState<RaysLibraryPhoto[]>([]);
  const [reportCount, setReportCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [viewingMaterial, setViewingMaterial] = useState<string | null>(null);

  async function load(q = search) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/rays-library${q ? `?q=${encodeURIComponent(q)}` : ""}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load library");
      setEntries(data.entries);
      // Only the unfiltered load reflects the library's real source-report
      // count — a search-filtered fetch would undercount it.
      if (!q) {
        const projectNumbers = new Set(
          (data.entries as RaysLibraryEntry[])
            .map((e) => e.source_project_number)
            .filter((p): p is string => Boolean(p && p.trim()))
        );
        setReportCount(projectNumbers.size);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load library");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    fetch("/api/admin/rays-library/photos")
      .then((res) => res.json())
      .then((data) => setPhotos(data.photos ?? []))
      .catch(() => {});
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
      const existing = byMaterial.get(e.material) ?? { material: e.material, total: 0, sampled: 0, positive: 0 };
      existing.total += 1;
      if (e.is_acm !== null) {
        existing.sampled += 1;
        if (e.is_acm) existing.positive += 1;
      }
      byMaterial.set(e.material, existing);
    }
    return Array.from(byMaterial.values()).sort((a, b) => a.material.localeCompare(b.material));
  }, [entries]);

  const photosByMaterial = useMemo(() => {
    const map = new Map<string, RaysLibraryPhoto[]>();
    for (const p of photos) {
      const list = map.get(p.material) ?? [];
      list.push(p);
      map.set(p.material, list);
    }
    return map;
  }, [photos]);

  const viewingPhotos = viewingMaterial ? photosByMaterial.get(viewingMaterial) ?? [] : [];

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <div className="flex items-baseline gap-2">
        <h1 className="text-lg font-semibold text-slate-800">Ray&apos;s Library</h1>
        {reportCount !== null && (
          <span className="text-sm text-slate-400">
            pulling from {reportCount} {reportCount === 1 ? "report" : "reports"}
          </span>
        )}
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
            const hasPhotos = photosByMaterial.has(g.material);
            return (
              <button
                key={g.material}
                onClick={() => hasPhotos && setViewingMaterial(g.material)}
                disabled={!hasPhotos}
                className={`flex w-full items-center justify-between rounded-lg border border-slate-200 bg-white p-3 text-left ${hasPhotos ? "cursor-pointer hover:border-slate-300" : "cursor-default"}`}
              >
                <span className="flex items-center gap-1.5 font-medium text-slate-800">
                  {g.material}
                  {hasPhotos && <span className="text-slate-400">📷</span>}
                </span>
                <span className={`text-sm font-semibold ${g.positive > 0 ? "text-red-600" : "text-slate-500"}`}>
                  {g.sampled > 0 ? `${g.positive} of ${g.sampled} positive` : "Not yet sampled"}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {viewingMaterial && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
          onClick={() => setViewingMaterial(null)}
        >
          <div className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white" onClick={(e) => e.stopPropagation()}>
            <div className="sticky top-0 z-10 flex items-center justify-between gap-2 bg-white p-5 pb-3">
              <h3 className="font-semibold text-slate-800">{viewingMaterial}</h3>
              <button onClick={() => setViewingMaterial(null)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm">
                Close
              </button>
            </div>
            <div className="space-y-3 px-5 pb-5">
              {viewingPhotos.map((p) => (
                <img
                  key={p.id}
                  src={`/api/admin/rays-library/photos/${p.id}`}
                  alt={viewingMaterial}
                  className="w-full rounded-lg border border-slate-200"
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
