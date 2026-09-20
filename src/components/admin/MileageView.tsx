"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { splitAddress } from "@/lib/address";
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

/** A stop's full address on two lines: street, then town/state/zip. */
function AddressBlock({ stop }: { stop: MileageStop }) {
  const { street, cityStateZip } = splitAddress(stop.address);
  return (
    <div className="min-w-0 text-xs leading-snug">
      <p className="text-[12px] font-medium text-slate-800">{street || stop.address}</p>
      {cityStateZip && <p className="text-[11px] text-slate-500">{cityStateZip}</p>}
    </div>
  );
}

function DayCard({ day, onSaved, onReset }: { day: MileageDay; onSaved: (d: MileageDay) => void; onReset: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
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
  const isSummary = !!day.legs[0]?.total;
  const hasLab = day.stops.some((s) => s.kind === "lab");

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-base font-bold text-slate-800">{dayLabel(day.day)}</h3>
        <span className="text-sm font-semibold text-slate-800">
          {total.toFixed(1)} mi <span className="font-normal text-slate-500">· {formatCents(Math.round(total * MILEAGE_RATE_CENTS))}</span>
        </span>
      </div>

      {isSummary ? (
        <ol className="mt-3 space-y-1">
          {day.stops.map((stop, i) => (
            <li key={stop.id}>
              <div
                data-stop-index={i}
                className={`flex items-center gap-2 rounded-lg border bg-slate-50 px-2 py-2 ${dragIndex === i ? "border-brand-600 opacity-60" : overIndex === i && dragIndex != null ? "border-brand-600" : "border-slate-200"}`}
              >
                {!isSummary && (
                <span
                  className="cursor-grab touch-none select-none px-2 py-1 text-slate-400"
                  aria-label="Drag to reorder"
                  onPointerDown={(e) => {
                    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                    setDragIndex(i);
                    setOverIndex(i);
                  }}
                  onPointerMove={(e) => {
                    if (dragIndex == null) return;
                    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-stop-index]");
                    if (el) setOverIndex(Number(el.getAttribute("data-stop-index")));
                  }}
                  onPointerUp={() => {
                    if (dragIndex != null && overIndex != null) move(dragIndex, overIndex);
                    setDragIndex(null);
                    setOverIndex(null);
                  }}
                  onPointerCancel={() => {
                    setDragIndex(null);
                    setOverIndex(null);
                  }}
                >
                  ⋮⋮
                </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-800">{stop.label}</p>
                  {!stop.label.toLowerCase().includes(stop.address.toLowerCase()) && <p className="truncate text-xs text-slate-500">{stop.address}</p>}
                </div>
                {!isSummary && <button type="button" disabled={busy || day.stops.length <= 2} onClick={() => remove(i)} className="px-1 text-sm text-red-600 disabled:opacity-30" aria-label="Remove stop">✕</button>}
              </div>
              {!isSummary && i < day.stops.length - 1 && (
                <div className="my-0.5 ml-6 flex items-center gap-2 border-l-2 border-slate-300 py-2 pl-4 text-xs text-slate-500">
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
                    className="h-7 w-16 rounded-full border border-slate-300 bg-white px-2 text-right text-xs font-medium text-slate-700"
                  />
                  <span>mi</span>
                </div>
              )}
            </li>
          ))}
        </ol>
      ) : (
        <ol className="mt-3 space-y-2">
          {day.legs.map((leg, i) => {
            const from = day.stops[i];
            const to = day.stops[i + 1];
            if (!from || !to) return null;
            return (
              <li
                key={`${from.id}-${to.id}`}
                data-stop-index={i + 1}
                className={`flex items-center gap-1 rounded-lg border bg-slate-50 px-1.5 py-2 ${dragIndex === i + 1 ? "border-brand-600 opacity-60" : overIndex === i + 1 && dragIndex != null ? "border-brand-600" : "border-slate-200"}`}
              >
                <span
                  className="cursor-grab touch-none select-none px-0.5 py-1 text-slate-400"
                  aria-label="Drag to reorder"
                  onPointerDown={(e) => {
                    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                    setDragIndex(i + 1);
                    setOverIndex(i + 1);
                  }}
                  onPointerMove={(e) => {
                    if (dragIndex == null) return;
                    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-stop-index]");
                    if (el) setOverIndex(Number(el.getAttribute("data-stop-index")));
                  }}
                  onPointerUp={() => {
                    if (dragIndex != null && overIndex != null) move(dragIndex, overIndex);
                    setDragIndex(null);
                    setOverIndex(null);
                  }}
                  onPointerCancel={() => {
                    setDragIndex(null);
                    setOverIndex(null);
                  }}
                >
                  ⋮⋮
                </span>
                <div className="flex min-w-0 flex-1 items-center gap-1.5">
                  <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-1.5">
                    <AddressBlock stop={from} />
                    <p className="text-center text-[10px] font-medium uppercase text-slate-400">to</p>
                    <AddressBlock stop={to} />
                  </div>
                  <div className="relative shrink-0">
                    <input
                      key={`${to.id}-${leg.miles}`}
                      type="number"
                      step="0.1"
                      min="0"
                      defaultValue={leg.miles}
                      onBlur={(e) => {
                        const v = parseFloat(e.target.value);
                        if (Number.isFinite(v) && v !== leg.miles) save(day.stops, { index: i, miles: v });
                      }}
                      className="h-8 w-[3.6rem] rounded-lg border border-slate-300 bg-white pl-1 pr-5 text-right text-xs font-medium text-slate-700"
                    />
                    <span className="pointer-events-none absolute inset-y-0 right-1 flex items-center text-[10px] text-slate-400">mi</span>
                  </div>
                  <button type="button" disabled={busy || day.stops.length <= 2} onClick={() => remove(i + 1)} className="shrink-0 text-sm leading-none text-red-600 disabled:opacity-30" aria-label="Remove this stop">✕</button>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {isSummary && (
        <div className="mt-4 flex items-center gap-3">
          <span className="text-sm text-slate-600">Total miles driven</span>
          <input
            key={day.legs[0]?.miles}
            type="number"
            step="0.1"
            min="0"
            defaultValue={day.legs[0]?.miles ?? 0}
            onBlur={(e) => {
              const v = parseFloat(e.target.value);
              if (Number.isFinite(v) && v !== day.legs[0]?.miles) save(day.stops, { index: 0, miles: v });
            }}
            className="h-9 w-24 rounded-lg border border-slate-300 bg-white px-2 text-right text-sm text-slate-700"
          />
          <span className="text-sm text-slate-500">mi</span>
        </div>
      )}

      {isSummary ? null : adding ? (
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
              + Crystal
            </button>
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
        Each day is filled in from that day&apos;s jobs: home, each job, the lab, home. Tap any day to open it, including days with no jobs. Drag stops into the order you drove, add stops, or type over a leg&apos;s miles.
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
              disabled={!d && isFuture}
              onClick={() => onPick(key)}
              className={`flex h-14 flex-col items-center justify-center rounded-lg text-sm ${d ? "border border-brand-600 bg-brand-50 font-semibold text-slate-800 hover:bg-brand-100" : isFuture ? "text-slate-300" : "text-slate-500 hover:bg-slate-50"}`}
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
