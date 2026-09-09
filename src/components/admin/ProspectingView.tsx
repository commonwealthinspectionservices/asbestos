"use client";

import { useEffect, useMemo, useState } from "react";
import { telHref } from "@/lib/phone";

type Prospect = {
  id: string;
  company_name: string;
  phone: string | null;
  address: string | null;
  website: string | null;
  category: string | null;
  town: string | null;
  status: string;
  discovered_at: string;
  possibleExistingCustomer: boolean;
};

// Default sourcing sweep, 2026-09-08 — restoration companies only (per
// Tim: "we don't sell to abatement contractors"), across the towns
// actually spanning his real service area (Greater Boston, North Shore,
// MetroWest, South Shore — grounded in real job address history, not the
// stale service_radius_miles setting). Kept here rather than baked into
// the API route so the button's own label can say exactly what it's
// about to run.
const SWEEP_CATEGORIES = [
  "water damage restoration company",
  "fire damage restoration company",
  "mold remediation company",
  "disaster restoration company",
];
const SWEEP_TOWNS = [
  "Boston", "Cambridge", "Somerville", "Newton", "Brookline", "Quincy",
  "Braintree", "Weymouth", "Dedham", "Needham", "Waltham", "Framingham",
  "Natick", "Woburn", "Peabody", "Salem", "Lynn", "Andover", "Brockton", "Plymouth",
];

const STATUS_LABELS: Record<string, string> = {
  new: "New",
  contacted: "Contacted",
  not_a_fit: "Not a fit",
  converted: "Converted",
};
const STATUS_TABS = ["all", "new", "contacted", "not_a_fit", "converted"];

export default function ProspectingView() {
  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [sweeping, setSweeping] = useState(false);
  const [sweepResult, setSweepResult] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/prospecting/list");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load prospects");
      setProspects(data.prospects);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load prospects");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function runSweep() {
    setSweeping(true);
    setSweepResult(null);
    setError(null);
    try {
      const res = await fetch("/api/admin/prospecting/source", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categories: SWEEP_CATEGORIES, towns: SWEEP_TOWNS }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Sweep failed");
      setSweepResult(`Found ${data.totalFound} listings, ${data.totalNew} new.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sweep failed");
    } finally {
      setSweeping(false);
    }
  }

  async function updateStatus(id: string, status: string) {
    // Optimistic — the review workflow is mark-many-in-a-row, and waiting
    // on a round-trip per click would make that feel broken.
    setProspects((prev) => prev.map((p) => (p.id === id ? { ...p, status } : p)));
    try {
      const res = await fetch(`/api/admin/prospecting/list?id=${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error("Failed to update status");
    } catch {
      load();
    }
  }

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: prospects.length };
    for (const p of prospects) c[p.status] = (c[p.status] ?? 0) + 1;
    return c;
  }, [prospects]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return prospects.filter((p) => {
      if (statusFilter !== "all" && p.status !== statusFilter) return false;
      if (!q) return true;
      return (
        p.company_name.toLowerCase().includes(q) ||
        (p.town ?? "").toLowerCase().includes(q) ||
        (p.category ?? "").toLowerCase().includes(q)
      );
    });
  }, [prospects, statusFilter, search]);

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-brand-700">Prospecting</h1>
        <button
          onClick={runSweep}
          disabled={sweeping}
          className="shrink-0 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {sweeping ? "Sourcing…" : "Run Sourcing Sweep"}
        </button>
      </div>
      <p className="mt-1 text-sm text-slate-500">
        Restoration companies found via Google Places across {SWEEP_TOWNS.length} towns — not connected to
        outreach drafting yet.
      </p>
      {sweepResult && <div className="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{sweepResult}</div>}
      {error && <div className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      <div className="mt-4 flex flex-wrap gap-1.5">
        {STATUS_TABS.map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`rounded-full border px-3 py-1 text-xs font-medium ${
              statusFilter === s
                ? "border-brand-700 bg-brand-700 text-white"
                : "border-slate-300 bg-white text-slate-600"
            }`}
          >
            {s === "all" ? "All" : STATUS_LABELS[s]} ({counts[s] ?? 0})
          </button>
        ))}
      </div>

      <input
        className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        placeholder="Search by name, town, or category…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {loading ? (
        <p className="mt-6 text-sm text-slate-500">Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="mt-6 text-sm text-slate-500">No prospects found.</p>
      ) : (
        <div className="mt-4 space-y-2">
          {filtered.map((p) => (
            <div key={p.id} className="rounded-lg border border-slate-200 bg-white p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="font-medium text-slate-800">
                    {p.company_name}
                    {p.possibleExistingCustomer && (
                      <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                        Possible existing customer
                      </span>
                    )}
                  </div>
                  {p.address && <div className="text-sm text-slate-500">{p.address}</div>}
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-sm">
                    {p.phone && (
                      <a href={telHref(p.phone)} className="text-brand-700 hover:underline">
                        {p.phone}
                      </a>
                    )}
                    {p.website && (
                      <a href={p.website} target="_blank" rel="noopener noreferrer" className="text-brand-700 hover:underline">
                        Website
                      </a>
                    )}
                  </div>
                  <div className="mt-1 text-xs text-slate-400">
                    {p.category} — {p.town}
                  </div>
                </div>
                <select
                  value={p.status}
                  onChange={(e) => updateStatus(p.id, e.target.value)}
                  className="rounded-lg border border-slate-300 px-2 py-1 text-sm"
                >
                  {Object.entries(STATUS_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
