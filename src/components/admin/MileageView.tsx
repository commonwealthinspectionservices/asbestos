"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
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

function DayCard({ day, onSaved, onReset }: { day: MileageDay; onSaved: (d: MileageDay) => void; onReset: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [newAddress, setNewAddress] = useState("");
  const [newLabel, setNewLabel] = useState("");

  const save = useCallback(
    async (stops: MileageStop[], legOverride?: { index: number; miles: number | null }) => {
      setBusy(true);
      setError(null);
      try {
        const res = await fetch(`/api/admin/mileage/${day.day}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stops, legOverride }),
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

  function move(from: number, to: number) {
    if (to < 0 || to >= day.stops.length || from === to) return;
    const next = [...day.stops];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
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
  }

  const total = totalMiles(day);
  const hasLab = day.stops.some((s) => s.kind === "lab");

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-base font-bold text-slate-800">{dayLabel(day.day)}</h3>
        <span className="text-sm font-semibold text-slate-800">
          {total.toFixed(1)} mi <span className="font-normal text-slate-500">· {formatCents(Math.round(total * MILEAGE_RATE_CENTS))}</span>
        </span>
      </div>

      <ol className="mt-3 space-y-1">
        {day.stops.map((stop, i) => (
          <li key={stop.id}>
            <div
              draggable
              onDragStart={() => setDragIndex(i)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                if (dragIndex != null) move(dragIndex, i);
                setDragIndex(null);
              }}
              className={`flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2 py-2 ${dragIndex === i ? "opacity-50" : ""}`}
            >
              <span className="cursor-grab select-none px-1 text-slate-400" aria-hidden="true">⋮⋮</span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-800">{stop.label}</p>
                {stop.label !== stop.address && <p className="truncate text-xs text-slate-500">{stop.address}</p>}
              </div>
              <button type="button" disabled={busy || i === 0} onClick={() => move(i, i - 1)} className="px-1 text-slate-500 disabled:opacity-30" aria-label="Move up">▲</button>
              <button type="button" disabled={busy || i === day.stops.length - 1} onClick={() => move(i, i + 1)} className="px-1 text-slate-500 disabled:opacity-30" aria-label="Move down">▼</button>
              <button type="button" disabled={busy || day.stops.length <= 2} onClick={() => remove(i)} className="px-1 text-sm text-red-600 disabled:opacity-30" aria-label="Remove stop">✕</button>
            </div>
            {i < day.stops.length - 1 && (
              <div className="flex items-center gap-2 py-1 pl-8 text-xs text-slate-500">
                <span>↓ drive</span>
                <input
                  key={`${stop.id}-${day.legs[i]?.miles}`}
                  type="number"
                  step="0.1"
                  min="0"
                  defaultValue={day.legs[i]?.miles ?? 0}
                  onBlur={(e) => {
                    const v = parseFloat(e.target.value);
                    if (Number.isFinite(v) && v !== day.legs[i]?.miles) save(day.stops, { index: i, miles: v });
                  }}
                  className="h-8 w-20 rounded-lg border border-slate-300 bg-white px-2 text-right text-sm text-slate-700"
                />
                <span>mi</span>
                {day.legs[i]?.manual && (
                  <button type="button" onClick={() => save(day.stops, { index: i, miles: null })} className="text-brand-600 hover:underline">
                    use Google&apos;s number
                  </button>
                )}
              </div>
            )}
          </li>
        ))}
      </ol>

      {adding ? (
        <div className="mt-3 space-y-2 rounded-lg border border-slate-200 p-3">
          <input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="What is it? (e.g. Supply run)" className="h-9 w-full rounded-lg border border-slate-300 px-3 text-sm" />
          <input value={newAddress} onChange={(e) => setNewAddress(e.target.value)} placeholder="Address" className="h-9 w-full rounded-lg border border-slate-300 px-3 text-sm" />
          <div className="flex gap-3">
            <button
              type="button"
              disabled={busy || !newAddress.trim()}
              onClick={() => {
                addStop({ id: newStopId(), kind: "other", label: newLabel.trim() || newAddress.trim(), address: newAddress.trim() }, true);
                setAdding(false);
                setNewAddress("");
                setNewLabel("");
              }}
              className={smallLink}
            >
              Add stop
            </button>
            <button type="button" onClick={() => setAdding(false)} className="text-sm text-slate-500 hover:underline">Cancel</button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap justify-end gap-x-4 gap-y-1">
          <button type="button" disabled={busy} onClick={() => setAdding(true)} className={smallLink}>+ Stop</button>
          {!hasLab && (
            <button type="button" disabled={busy} onClick={() => addStop({ id: newStopId(), kind: "lab", label: LAB_LABEL, address: LAB_ADDRESS }, true)} className={smallLink}>
              + Lab trip
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (confirm("Rebuild this day's route from its jobs? Your edits to this day will be lost.")) onReset();
            }}
            className="text-sm text-slate-500 hover:underline disabled:opacity-40"
          >
            Reset to jobs
          </button>
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

  const monthMiles = Math.round(days.reduce((s, d) => s + totalMiles(d), 0) * 10) / 10;
  const canGoBack = shiftMonth(month, -1) >= COMPANY_START_DATE.slice(0, 7);
  const canGoForward = month < currentMonthKey();

  return (
    <div>
      <Link href="/admin/billing" className="text-sm text-brand-600 hover:underline">← Billing</Link>
      <h1 className="mt-3 text-2xl font-bold text-slate-800">Mileage</h1>
      <p className="mt-1 text-sm text-slate-500">
        Each day is filled in from that day&apos;s jobs: home, each job, the lab, home. Drag stops (or use the arrows) into the order you drove, add stops, or type over a leg&apos;s miles.
      </p>

      <div className="mt-5 flex items-center justify-between gap-2">
        <button type="button" disabled={!canGoBack} onClick={() => setMonth(shiftMonth(month, -1))} className={smallLink}>← Previous</button>
        <div className="text-center">
          <p className="text-base font-bold text-slate-800">{monthLabel(month)}</p>
          <p className="text-sm text-slate-600">
            {monthMiles.toFixed(1)} mi · {formatCents(Math.round(monthMiles * MILEAGE_RATE_CENTS))}
            <span className="text-slate-400"> at {MILEAGE_RATE_CENTS}¢/mi</span>
          </p>
        </div>
        <button type="button" disabled={!canGoForward} onClick={() => setMonth(shiftMonth(month, 1))} className={smallLink}>Next →</button>
      </div>

      {error && <div className="mt-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}
      {loading ? (
        <p className="mt-6 text-sm text-slate-500">Building routes…</p>
      ) : days.length === 0 && !error ? (
        <p className="mt-6 text-sm text-slate-500">No jobs scheduled this month yet.</p>
      ) : (
        <div className="mt-4 space-y-4">
          {days.map((d) => (
            <DayCard
              key={d.day}
              day={d}
              onSaved={(saved) => setDays((cur) => cur.map((x) => (x.day === saved.day ? saved : x)))}
              onReset={async () => {
                await fetch(`/api/admin/mileage/${d.day}`, { method: "DELETE" });
                load(month);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
