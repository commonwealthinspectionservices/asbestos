"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { formatDate, STATUS_LABEL } from "@/components/admin/JobsDashboard";
import { toTitleCase } from "@/lib/name";
import { telHref, formatPhoneNumber } from "@/lib/phone";
import { expandAddress } from "@/lib/address";

interface HomeownerJob {
  id: string;
  project_number: string | null;
  service_address: string;
  status: string;
  requested_date: string | null;
  confirmed_date: string | null;
}

interface Homeowner {
  name: string;
  phone: string | null;
  jobs: HomeownerJob[];
  jobCount: number;
}

// Read-only — assembled from job records (see /api/admin/homeowners), not
// its own table. A subcontractor-referred homeowner (Boston Harbor Water
// Restoration, Newton Fire & Flood, ...) never becomes a real contact
// anywhere else, so without this there's no way to see "have I done work
// for this person before" short of opening every past job one at a time.
export default function HomeownersDirectory({
  mobileSearch,
}: {
  /** The parent's single shared mobile search box — this tab's own search box below is desktop-only now. */
  mobileSearch: string;
}) {
  const [homeowners, setHomeowners] = useState<Homeowner[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    fetch("/api/admin/homeowners")
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error ?? "Failed to load homeowners");
        setHomeowners(data.homeowners);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load homeowners"))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = (search || mobileSearch).trim().toLowerCase();
    if (!q) return homeowners;
    return homeowners.filter(
      (h) =>
        h.name.toLowerCase().includes(q) ||
        h.phone?.toLowerCase().includes(q) ||
        h.jobs.some((j) => j.service_address.toLowerCase().includes(q))
    );
  }, [homeowners, search, mobileSearch]);

  return (
    <div>
      {/* Desktop only — mobile uses the parent's single shared search box instead. */}
      <input
        className="hidden w-full rounded-lg border border-slate-300 px-3 py-2 text-sm sm:block"
        placeholder="Search by name, phone, or address…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {error && <div className="mt-3 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}

      {loading ? (
        <p className="mt-6 text-sm text-slate-500">Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="mt-6 text-sm text-slate-500">
          {homeowners.length === 0 ? "No homeowners on any job yet." : "No matches."}
        </p>
      ) : (
        <div className="mt-4 space-y-2">
          {filtered.map((h) => {
            const key = `${h.name.toLowerCase()}|${h.phone ?? ""}`;
            return (
              <button
                key={key}
                onClick={() => setSelectedKey(key)}
                className="block w-full rounded-lg border border-slate-200 bg-white p-3 text-left hover:border-brand-400"
              >
                <div className="font-medium text-slate-800">{toTitleCase(h.name)}</div>
                {/* Most recent job's address — the newest entry in each
                    group, since /api/admin/homeowners already orders
                    jobs newest-first before grouping. */}
                <div className="truncate text-sm text-slate-500">{expandAddress(h.jobs[0]?.service_address)}</div>
              </button>
            );
          })}
        </div>
      )}

      {selectedKey && (
        <HomeownerDetailDialog
          homeowner={filtered.find((h) => `${h.name.toLowerCase()}|${h.phone ?? ""}` === selectedKey) ?? null}
          onClose={() => setSelectedKey(null)}
        />
      )}
    </div>
  );
}

function HomeownerDetailDialog({ homeowner, onClose }: { homeowner: Homeowner | null; onClose: () => void }) {
  if (!homeowner) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-5">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-semibold text-slate-800">{toTitleCase(homeowner.name)}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">✕</button>
        </div>

        <div className="mt-3 text-sm">
          <span className="text-slate-500">Phone </span>
          {homeowner.phone ? (
            <a href={telHref(homeowner.phone)} className="text-brand-700 hover:underline">{formatPhoneNumber(homeowner.phone)}</a>
          ) : "—"}
        </div>

        <div className="mt-4 space-y-2 border-t border-slate-100 pt-4">
          {homeowner.jobs.map((j) => (
            <Link
              key={j.id}
              href={`/admin/dashboard?jobId=${j.id}`}
              className="block rounded-lg border border-slate-100 bg-slate-50 p-2 text-sm hover:border-brand-400"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono font-medium text-slate-700">{j.project_number ?? "—"}</span>
                <span className="text-xs uppercase text-slate-500">{STATUS_LABEL[j.status] ?? j.status}</span>
              </div>
              <div className="text-slate-600">{expandAddress(j.service_address)}</div>
              <div className="text-xs text-slate-400">
                {formatDate(j.confirmed_date ?? j.requested_date) || "No date"}
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
