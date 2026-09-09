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
  rating: number | null;
  user_rating_count: number | null;
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
// "priority" isn't a real status — it's a computed view (see
// priorityScore/priorityList below), listed first since it's the actual
// answer to "who do I call today," not just another filter.
const VIEW_TABS = ["priority", "all", "new", "contacted", "not_a_fit", "converted"];

// A real Google rating/review-count is the only signal Places API gives
// about which listing is an established, legitimate business versus a
// thin one-review storefront — better than an arbitrary or alphabetical
// order for "who to call first." Reviews matter more than a bare star
// average (a 5.0 from one review is weaker evidence than a 4.6 from 80),
// so this weights review count, with rating as the tiebreaker.
function priorityScore(p: Prospect): number {
  const count = p.user_rating_count ?? 0;
  const rating = p.rating ?? 0;
  return Math.log(count + 1) * 10 + rating;
}

export default function ProspectingView() {
  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState("priority");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sweeping, setSweeping] = useState(false);
  const [sweepResult, setSweepResult] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

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

  // Any filter/search change invalidates whatever was checked — carrying
  // a hidden selection across views is more likely to bulk-update the
  // wrong rows than to save a click.
  useEffect(() => {
    setSelected(new Set());
  }, [view, search]);

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

  async function bulkUpdateStatus(status: string) {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    setBulkBusy(true);
    // Optimistic — this is a mark-a-batch-in-a-row workflow, waiting on
    // a round-trip before the list visibly updates would make it feel
    // broken.
    setProspects((prev) => prev.map((p) => (ids.includes(p.id) ? { ...p, status } : p)));
    setSelected(new Set());
    try {
      const res = await fetch("/api/admin/prospecting/list", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, status }),
      });
      if (!res.ok) throw new Error("Failed to update status");
    } catch {
      load();
    } finally {
      setBulkBusy(false);
    }
  }

  async function updateStatus(id: string, status: string) {
    setProspects((prev) => prev.map((p) => (p.id === id ? { ...p, status } : p)));
    try {
      const res = await fetch("/api/admin/prospecting/list", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [id], status }),
      });
      if (!res.ok) throw new Error("Failed to update status");
    } catch {
      load();
    }
  }

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: prospects.length };
    for (const p of prospects) c[p.status] = (c[p.status] ?? 0) + 1;
    c.priority = prospects.filter(
      (p) => p.status === "new" && !p.possibleExistingCustomer && p.phone
    ).length;
    return c;
  }, [prospects]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const matchesSearch = (p: Prospect) =>
      !q ||
      p.company_name.toLowerCase().includes(q) ||
      (p.town ?? "").toLowerCase().includes(q) ||
      (p.category ?? "").toLowerCase().includes(q);

    if (view === "priority") {
      return prospects
        .filter((p) => p.status === "new" && !p.possibleExistingCustomer && p.phone)
        .filter(matchesSearch)
        .sort((a, b) => priorityScore(b) - priorityScore(a))
        .slice(0, 30);
    }
    return prospects.filter((p) => (view === "all" || p.status === view) && matchesSearch(p));
  }, [prospects, view, search]);

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelected((prev) => (prev.size === filtered.length ? new Set() : new Set(filtered.map((p) => p.id))));
  }

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
        {VIEW_TABS.map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`rounded-full border px-3 py-1 text-xs font-medium ${
              view === v ? "border-brand-700 bg-brand-700 text-white" : "border-slate-300 bg-white text-slate-600"
            }`}
          >
            {v === "priority" ? "⭐ Call These Next" : v === "all" ? "All" : STATUS_LABELS[v]} ({counts[v] ?? 0})
          </button>
        ))}
      </div>
      {view === "priority" && (
        <p className="mt-2 text-xs text-slate-500">
          The top {filtered.length} new, real-phone-number prospects, ranked by Google review count and rating —
          the closest thing to "most likely a real, established company worth calling first."
        </p>
      )}

      <input
        className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        placeholder="Search by name, town, or category…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {filtered.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-b border-slate-200 pb-2 text-sm">
          <label className="flex items-center gap-1.5 text-slate-600">
            <input type="checkbox" checked={selected.size === filtered.length} onChange={toggleSelectAll} />
            Select all ({filtered.length})
          </label>
          {selected.size > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-slate-500">{selected.size} selected —</span>
              <button
                disabled={bulkBusy}
                onClick={() => bulkUpdateStatus("not_a_fit")}
                className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 disabled:opacity-50"
              >
                Mark Not a fit
              </button>
              <button
                disabled={bulkBusy}
                onClick={() => bulkUpdateStatus("contacted")}
                className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 disabled:opacity-50"
              >
                Mark Contacted
              </button>
            </div>
          )}
        </div>
      )}

      {loading ? (
        <p className="mt-6 text-sm text-slate-500">Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="mt-6 text-sm text-slate-500">No prospects found.</p>
      ) : (
        <div className="mt-2 space-y-2">
          {filtered.map((p, i) => (
            <div key={p.id} className="flex gap-3 rounded-lg border border-slate-200 bg-white p-3">
              <input
                type="checkbox"
                className="mt-1 shrink-0"
                checked={selected.has(p.id)}
                onChange={() => toggleSelected(p.id)}
              />
              <div className="flex-1">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="font-medium text-slate-800">
                      {view === "priority" && <span className="mr-1 text-slate-400">#{i + 1}</span>}
                      {p.company_name}
                      {p.possibleExistingCustomer && (
                        <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                          Possible existing customer
                        </span>
                      )}
                      {p.rating != null && (
                        <span className="ml-2 text-xs font-normal text-slate-500">
                          ★ {p.rating} ({p.user_rating_count ?? 0})
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
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
