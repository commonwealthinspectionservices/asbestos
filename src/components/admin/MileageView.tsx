"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { splitAddress } from "@/lib/address";
import { withZip } from "@/lib/address";
import { LAB_ADDRESS, LAB_LABEL, MILEAGE_RATE_CENTS, newStopId, totalMiles, type MileageDay, type MileageStop } from "@/lib/mileage-shared";
import { formatCents } from "@/lib/pricing";
import { COMPANY_START_DATE } from "@/lib/company-dates";

function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleString("en-US", { month: "long", year: "numeric" });
}

function dayLabel(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleString("en-US", { weekday: "long", month: "long", day: "numeric" });
}

function shiftMonth(key: string, delta: number): string {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function currentMonthKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const smallLink = "text-sm font-medium text-brand-600 hover:underline disabled:opacity-40";

/** A stop's full address on one line, in a single text style. */
function AddressBlock({ stop }: { stop: MileageStop }) {
  const { street, cityStateZip } = splitAddress(stop.address);
  const full = [street || stop.address, cityStateZip].filter(Boolean).join(", ");
  return <p className="min-w-0 text-[13px] font-medium leading-snug text-slate-800">{full}</p>;
}

type Project = { id: string; project_number: string | null; service_address: string; customers?: { name?: string; company?: string } | null };

/**
 * One search box for adding a stop, instead of separate Home/Crystal
 * buttons + a project list + an address field always shown at once — Tim,
 * 2026-09-21: "doesn't look very clean with all the projects open." Typing
 * filters recent projects by number/address/company and (once it looks
 * like an address) queries Google's autocomplete; Home/Crystal only show
 * up top when relevant.
 */
function AddStopSearch({
  busy, homeAddress, projects, onPick,
}: {
  busy: boolean;
  homeAddress: string | undefined;
  projects: Project[];
  onPick: (stop: MileageStop) => void;
}) {
  const [query, setQuery] = useState("");
  const [addressSuggestions, setAddressSuggestions] = useState<{ placeId: string; description: string }[]>([]);
  const [loadingAddr, setLoadingAddr] = useState(false);
  const [resolving, setResolving] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.trim().length < 4) {
      setAddressSuggestions([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setLoadingAddr(true);
      try {
        const res = await fetch(`/api/admin/places-autocomplete?input=${encodeURIComponent(query)}`);
        const data = await res.json();
        setAddressSuggestions(data.suggestions ?? []);
      } finally {
        setLoadingAddr(false);
      }
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  // The box is a pure address search once you start typing — Home/Crystal/
  // a few recent projects are just quick-tap defaults shown while it's
  // empty, not something the typed text filters.
  const q = query.trim();
  const isSearching = q.length > 0;
  const quickProjects = projects.slice(0, 4);

  async function pickAddress(s: { placeId: string; description: string }) {
    setResolving(true);
    try {
      const res = await fetch(`/api/admin/place-details?placeId=${s.placeId}`);
      const data = await res.json();
      const formatted = withZip(data.formattedAddress ?? s.description, data.zip);
      onPick({ id: newStopId(), kind: "other", label: formatted, address: formatted });
    } catch {
      onPick({ id: newStopId(), kind: "other", label: s.description, address: s.description });
    } finally {
      setResolving(false);
      setQuery("");
      setAddressSuggestions([]);
    }
  }

  return (
    <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50 p-2">
      <input
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Type an address"
        className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm"
      />
      <div className="mt-2 max-h-64 space-y-1 overflow-y-auto">
        {!isSearching && (
          <>
            {homeAddress && (
              <button
                type="button"
                disabled={busy}
                onClick={() => onPick({ id: newStopId(), kind: "home", label: "Home", address: homeAddress })}
                className="block w-full rounded-lg bg-white px-3 py-2 text-left hover:bg-brand-50 disabled:opacity-40"
              >
                <p className="text-[13px] font-semibold text-slate-800">Home</p>
                <p className="text-xs text-slate-500">{homeAddress.replace(/,\s*(USA|United States)\s*$/i, "")}</p>
              </button>
            )}
            {/* Per Tim, 2026-09-22 — "the first two options should always
                be home and lab": shown even on a day that already has a
                Crystal stop, since a second lab trip the same day is a
                real thing (a morning drop-off and an afternoon pickup,
                say), not something to hide once the day has one. */}
            <button
              type="button"
              disabled={busy}
              onClick={() => onPick({ id: newStopId(), kind: "lab", label: LAB_LABEL, address: LAB_ADDRESS })}
              className="block w-full rounded-lg bg-white px-3 py-2 text-left hover:bg-brand-50 disabled:opacity-40"
            >
              <p className="text-[13px] font-semibold text-slate-800">Crystal Analytical</p>
              <p className="text-xs text-slate-500">{LAB_ADDRESS.replace(/,\s*(USA|United States)\s*$/i, "")}</p>
            </button>
            {quickProjects.map((p) => (
              <button
                key={p.id}
                type="button"
                disabled={busy}
                onClick={() =>
                  onPick({
                    id: newStopId(),
                    kind: "job",
                    label: `${p.project_number ?? "Job"} — ${p.service_address}`,
                    address: p.service_address.replace(/,\s*(USA|United States)\s*$/i, ""),
                    job_id: p.id,
                  })
                }
                className="block w-full rounded-lg bg-white px-3 py-2 text-left hover:bg-brand-50 disabled:opacity-40"
              >
                <p className="text-[13px] font-semibold text-slate-800">
                  {p.project_number} <span className="font-normal text-slate-500">— {p.customers?.company || p.customers?.name || ""}</span>
                </p>
                <p className="text-xs text-slate-500">{p.service_address.replace(/,\s*(USA|United States)\s*$/i, "")}</p>
              </button>
            ))}
          </>
        )}
        {isSearching &&
          addressSuggestions.map((s) => (
            <button
              key={s.placeId}
              type="button"
              disabled={busy || resolving}
              onClick={() => pickAddress(s)}
              className="flex w-full items-start gap-2 rounded-lg bg-white px-3 py-2 text-left text-sm hover:bg-brand-50 disabled:opacity-40"
            >
              <span className="text-slate-700">{s.description}</span>
            </button>
          ))}
        {isSearching && loadingAddr && <p className="px-3 py-1.5 text-xs text-slate-400">Searching…</p>}
        {isSearching && !loadingAddr && q.length < 4 && <p className="px-3 py-2 text-sm text-slate-400">Keep typing…</p>}
        {isSearching && !loadingAddr && q.length >= 4 && addressSuggestions.length === 0 && <p className="px-3 py-2 text-sm text-slate-400">No matches</p>}
      </div>
    </div>
  );
}

function DayCard({ day, onSaved, onReset }: { day: MileageDay; onSaved: (d: MileageDay) => void; onReset: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addingOpen, setAddingOpen] = useState(false);
  const [projects, setProjects] = useState<{ id: string; project_number: string | null; service_address: string; customers?: { name?: string; company?: string } | null }[]>([]);

  const save = useCallback(
    async (stops: MileageStop[], legOverride?: { index: number; miles: number | null }, dayTotal?: number) => {
      setBusy(true);
      setError(null);
      try {
        const res = await fetch(`/api/admin/mileage/${day.day}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stops, legOverride, dayTotal }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Couldn't save");
        onSaved(data.day);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't save");
      } finally {
        setBusy(false);
      }
    },
    [day.day, onSaved]
  );

  /** Swaps a stop with its neighbor — simpler and more reliable on a phone than drag or tap-to-move. */
  function move(i: number, delta: -1 | 1) {
    const j = i + delta;
    if (j < 0 || j >= day.stops.length) return;
    const next = [...day.stops];
    [next[i], next[j]] = [next[j], next[i]];
    save(next);
  }

  function remove(i: number) {
    if (day.stops.length <= 2) return;
    save(day.stops.filter((_, idx) => idx !== i));
  }

  function addStop(stop: MileageStop, beforeLastHome: boolean) {
    const next = [...day.stops];
    const last = next[next.length - 1];
    if (beforeLastHome && last?.kind === "home") next.splice(next.length - 1, 0, stop);
    else next.push(stop);
    save(next);
    setAddingOpen(false);
  }

  const isSummary = !!day.legs[0]?.total;
  useEffect(() => {
    if (isSummary) return;
    fetch("/api/admin/mileage/projects")
      .then(async (r) => (r.ok ? setProjects((await r.json()).projects) : null))
      .catch(() => {});
  }, [isSummary]);

  const total = totalMiles(day);
  const hasLab = day.stops.some((s) => s.kind === "lab");
  const homeAddress = day.stops.find((s) => s.kind === "home")?.address;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-base font-bold text-slate-800">{dayLabel(day.day)}</h3>
        <span className="text-sm font-semibold text-slate-800">
          {total.toFixed(1)} mi <span className="font-normal text-slate-500">· {formatCents(Math.round(total * MILEAGE_RATE_CENTS))}</span>
        </span>
      </div>

      <ol className="mt-3">
        {day.stops.map((stop, i) => (
          <li key={stop.id}>
            <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2 py-2">
              <div className="min-w-0 flex-1">
                <AddressBlock stop={stop} />
              </div>
              {!isSummary && (
                <div className="flex shrink-0 flex-col">
                  <button type="button" disabled={busy || i === 0} onClick={() => move(i, -1)} className="px-1 leading-none text-slate-500 disabled:opacity-20" aria-label="Move up">▲</button>
                  <button type="button" disabled={busy || i === day.stops.length - 1} onClick={() => move(i, 1)} className="px-1 leading-none text-slate-500 disabled:opacity-20" aria-label="Move down">▼</button>
                </div>
              )}
              {!isSummary && (
                <button type="button" disabled={busy || day.stops.length <= 2} onClick={() => remove(i)} className="shrink-0 px-1 text-sm text-red-600 disabled:opacity-30" aria-label="Remove stop">✕</button>
              )}
            </div>
            {i < day.stops.length - 1 && <div className="relative left-12 mx-auto h-4 w-0.5 bg-slate-300" aria-hidden="true" />}
          </li>
        ))}
      </ol>

      <div className="mt-4 flex items-center gap-3">
        <span className="text-sm text-slate-600">Total miles</span>
        <input
          key={`${day.day}-${total}`}
          type="number"
          step="0.1"
          min="0"
          defaultValue={total}
          onBlur={(e) => {
            const v = parseFloat(e.target.value);
            if (!Number.isFinite(v) || v === total) return;
            if (isSummary) save(day.stops, { index: 0, miles: v });
            else save(day.stops, undefined, v);
          }}
          className="h-9 w-24 rounded-lg border border-slate-300 bg-white px-2 text-right text-sm text-slate-700"
        />
        <span className="text-sm text-slate-500">mi</span>
      </div>

      {!isSummary && (
        <div className="mt-3">
          <div className="flex justify-end">
            <button type="button" disabled={busy} onClick={() => setAddingOpen((v) => !v)} className={smallLink}>
              {addingOpen ? "Close" : "+ Add stop"}
            </button>
          </div>
          {addingOpen && (
            <AddStopSearch
              busy={busy}
              homeAddress={homeAddress}
              projects={projects}
              onPick={(stop) => addStop(stop, true)}
            />
          )}
        </div>
      )}
      {busy && <p className="mt-2 text-xs text-slate-400">Saving…</p>}
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}

export default function MileageView() {
  const [month, setMonth] = useState(currentMonthKey);
  const [days, setDays] = useState<MileageDay[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openDay, setOpenDay] = useState<string | null>(null);
  // Miles per month ("YYYY-MM") across every saved day, for the By month table.
  const [monthlyMiles, setMonthlyMiles] = useState<Record<string, number>>({});

  const load = useCallback(async (m: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/mileage?month=${m}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Couldn't load mileage");
      setDays(data.days);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load mileage");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(month);
  }, [month, load]);

  // Miles-by-month totals: fetched once (read-only, no schedule sync — see
  // route.ts) on mount, then kept in step locally as the visible month's
  // days change, instead of re-fetching on every edit. Per Tim, 2026-09-22
  // (26-0042/44/45) — refetching the wide-range summary on every save raced
  // against this page's own month sync and corrupted a real day's stops
  // (a duplicate Home, the lab stop dropped). Two concurrent syncs of
  // overlapping day ranges, each working off its own stale read, is
  // unsafe — so only one path (the visible month, below) is ever allowed
  // to rewrite a day's stops; the summary path only reads/creates.
  useEffect(() => {
    fetch("/api/admin/mileage?summary=1")
      .then(async (r) => (r.ok ? setMonthlyMiles((await r.json()).monthlyMiles) : null))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (days.length === 0) return;
    const byMonth: Record<string, number> = {};
    for (const d of days) {
      const key = d.day.slice(0, 7);
      byMonth[key] = Math.round(((byMonth[key] ?? 0) + totalMiles(d)) * 10) / 10;
    }
    setMonthlyMiles((cur) => ({ ...cur, ...byMonth }));
  }, [days]);

  const monthMiles = Math.round(days.reduce((s, d) => s + totalMiles(d), 0) * 10) / 10;
  const canGoBack = shiftMonth(month, -1) >= COMPANY_START_DATE.slice(0, 7);
  const canGoForward = month < shiftMonth(currentMonthKey(), 12);

  return (
    <div>
      <Link href="/admin/billing" className="text-sm text-brand-600 hover:underline">← Billing</Link>
      <h1 className="mt-3 text-2xl font-bold text-slate-800">Mileage</h1>

      <div className="mt-5 flex items-center justify-between gap-2">
        <button type="button" disabled={!canGoBack} onClick={() => setMonth(shiftMonth(month, -1))} className={`${smallLink} px-1 text-lg leading-none`} aria-label="Previous month">←</button>
        <p className="whitespace-nowrap text-center text-sm text-slate-600">
          <span className="font-bold text-slate-800">{monthLabel(month)}</span> · {monthMiles.toFixed(1)} mi · {formatCents(Math.round(monthMiles * MILEAGE_RATE_CENTS))}
        </p>
        <button type="button" disabled={!canGoForward} onClick={() => setMonth(shiftMonth(month, 1))} className={`${smallLink} px-1 text-lg leading-none`} aria-label="Next month">→</button>
      </div>

      {error && <div className="mt-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}
      {loading ? (
        <p className="mt-6 text-sm text-slate-500">Building routes…</p>
      ) : (
        <Calendar
          month={month}
          days={days}
          onPick={async (day) => {
            if (!days.some((d) => d.day === day)) {
              const res = await fetch(`/api/admin/mileage/${day}`, { method: "POST" });
              const data = await res.json();
              if (!res.ok) {
                setError(data.error ?? "Couldn't start that day");
                return;
              }
              setDays((cur) => [...cur, data.day].sort((a, b) => b.day.localeCompare(a.day)));
            }
            setOpenDay(day);
          }}
        />
      )}

      <div className="mt-8 flex items-baseline justify-between gap-2">
        <h2 className="text-lg font-bold text-slate-800">Miles by month</h2>
        <a href="/api/admin/mileage/export" download className="text-sm font-medium text-brand-600 hover:underline">
          Download CSV
        </a>
      </div>
      <div className="mt-3 overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="grid grid-cols-[minmax(0,1fr)_90px_100px] gap-x-2 border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs font-bold uppercase tracking-wide text-slate-500">
          <div>Month</div>
          <div className="text-right">Miles</div>
          <div className="text-right">Deduction</div>
        </div>
        {Object.keys(monthlyMiles).sort().reverse().map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setMonth(key)}
            className="grid w-full grid-cols-[minmax(0,1fr)_90px_100px] gap-x-2 border-b border-slate-100 px-4 py-3 text-left text-sm hover:bg-slate-50"
          >
            <div className="text-slate-700">{monthLabel(key)}</div>
            <div className="text-right text-slate-800">{monthlyMiles[key].toFixed(1)}</div>
            <div className="text-right font-medium text-slate-800">{formatCents(Math.round(monthlyMiles[key] * MILEAGE_RATE_CENTS))}</div>
          </button>
        ))}
        <div className="grid grid-cols-[minmax(0,1fr)_90px_100px] gap-x-2 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-800">
          <div>All time</div>
          <div className="text-right">{Object.values(monthlyMiles).reduce((a, b) => a + b, 0).toFixed(1)}</div>
          <div className="text-right">{formatCents(Math.round(Object.values(monthlyMiles).reduce((a, b) => a + b, 0) * MILEAGE_RATE_CENTS))}</div>
        </div>
      </div>

      {(() => {
        const d = days.find((x) => x.day === openDay);
        if (!d) return null;
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-2" onClick={() => setOpenDay(null)}>
            <div className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-xl bg-white" onClick={(e) => e.stopPropagation()}>
              <div className="flex justify-end px-3 pt-2">
                <button type="button" onClick={() => setOpenDay(null)} className="px-2 py-1 text-2xl leading-none text-slate-500" aria-label="Close">×</button>
              </div>
              <div className="overflow-y-auto px-2 pb-3">
                <DayCard
                  day={d}
                  onSaved={(saved) => setDays((cur) => cur.map((x) => (x.day === saved.day ? saved : x)))}
                  onReset={async () => {
                    await fetch(`/api/admin/mileage/${d.day}`, { method: "DELETE" });
                    setOpenDay(null);
                    load(month);
                  }}
                />
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

function Calendar({ month, days, onPick }: { month: string; days: MileageDay[]; onPick: (day: string) => void }) {
  const [y, m] = month.split("-").map(Number);
  const first = new Date(y, m - 1, 1).getDay();
  const count = new Date(y, m, 0).getDate();
  const byDay = new Map(days.map((d) => [d.day, d]));
  const now = new Date();
  const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const cells: (number | null)[] = [...Array(first).fill(null), ...Array.from({ length: count }, (_, i) => i + 1)];
  return (
    <div className="mt-4 rounded-xl border border-slate-200 bg-white p-2">
      <div className="grid grid-cols-7 pb-1 text-center text-xs font-bold uppercase text-slate-400">
        {["S", "M", "T", "W", "T", "F", "S"].map((l, i) => (
          <div key={i}>{l}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((n, i) => {
          if (n == null) return <div key={`b${i}`} />;
          const key = `${month}-${String(n).padStart(2, "0")}`;
          const d = byDay.get(key);
          const isFuture = key > todayKey;
          return (
            <button
              key={key}
              type="button"
              disabled={false}
              onClick={() => onPick(key)}
              className={`flex h-14 flex-col items-center justify-center rounded-lg text-sm ${d ? "border border-brand-600 bg-brand-50 font-semibold text-slate-800 hover:bg-brand-100" : isFuture ? "text-slate-400 hover:bg-slate-50" : "text-slate-500 hover:bg-slate-50"}`}
            >
              <span>{n}</span>
              {d && <span className="text-[11px] font-medium text-brand-700">{totalMiles(d).toFixed(0)} mi</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
