"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { JobWithCustomer } from "@/lib/types";
import { ProjectDetailDialog, EditProjectDialog } from "@/components/admin/JobsDashboard";
import { extractTimeRange, parseWindowStartTime24h } from "@/components/admin/AcceptScheduleControl";
import { googleMapsUrl, expandAddress } from "@/lib/address";
import { formatDateMDY } from "@/lib/date-format";
import { formatPhoneNumber, telHref } from "@/lib/phone";
import { toTitleCase } from "@/lib/name";

const STATUS_LABEL: Record<string, string> = {
  needs_scheduling: "To Be Scheduled",
  scheduled: "Scheduled",
  fieldwork_in_progress: "Fieldwork In Progress",
  awaiting_lab_results: "Awaiting Lab Results",
  needs_report: "Fieldwork Complete Needs Report",
  pending_lab_results: "Pending Lab Results",
  completed: "Report Ready",
  invoiced: "Invoiced",
  ready_to_send: "Ready for Review",
  report_invoice_sent: "Payment Pending",
  paid: "Paid",
  cancelled: "Cancelled",
};

const STATUS_COLOR: Record<string, string> = {
  needs_scheduling: "bg-slate-200 text-slate-700",
  scheduled: "bg-blue-100 text-blue-700",
  fieldwork_in_progress: "bg-indigo-100 text-indigo-700",
  awaiting_lab_results: "bg-purple-100 text-purple-700",
  needs_report: "bg-orange-100 text-orange-700",
  pending_lab_results: "bg-purple-100 text-purple-700",
  completed: "bg-teal-100 text-teal-700",
  invoiced: "bg-amber-100 text-amber-700",
  ready_to_send: "bg-amber-100 text-amber-700",
  report_invoice_sent: "bg-cyan-100 text-cyan-700",
  paid: "bg-emerald-100 text-emerald-700",
  cancelled: "bg-red-100 text-red-700",
};

// A "Location Name - Street" prefix on the street portion (e.g. "Freedom
// Trail Clinic - 25 Staniford Street") gets its own line, since some
// service addresses are a business/site name and some are just a street.
function splitLocationName(streetPart: string): { locationName: string; street: string } {
  const dashMatch = streetPart.match(/^(.+?)\s+-\s+(.+)$/);
  if (dashMatch) return { locationName: dashMatch[1].trim(), street: dashMatch[2].trim() };
  return { locationName: "", street: streetPart };
}

// Splits a formatted address into a location-name line (if any), a
// street/business/unit line, and a city/state/zip line — the last two
// comma-separated segments are always "City" and "State [Zip]".
function splitAddress(address: string | null | undefined): { locationName: string; street: string; cityStateZip: string } {
  if (!address) return { locationName: "", street: "", cityStateZip: "" };
  const parts = address.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length <= 2) return { ...splitLocationName(address), cityStateZip: "" };
  const cityStateZip = parts.slice(-2).join(", ");
  return { ...splitLocationName(parts.slice(0, -2).join(", ")), cityStateZip };
}

function formatTime(time: string | null | undefined): string {
  if (!time) return "";
  const [h, m] = time.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 || 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${period}`;
}

function formatDate(date: string | null | undefined): string {
  return formatDateMDY(date) ?? "";
}

// Local-component based, never through toISOString() — that converts
// through UTC first, which silently rolls the date backward or forward for
// any US timezone once the local clock is close enough to midnight.
function toISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function parseISO(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function addDays(d: Date, n: number): Date {
  const next = new Date(d);
  next.setDate(next.getDate() + n);
  return next;
}
function addMonths(d: Date, n: number): Date {
  const next = new Date(d);
  next.setMonth(next.getMonth() + n);
  return next;
}
function startOfWeek(d: Date): Date {
  const next = new Date(d);
  next.setDate(next.getDate() - next.getDay());
  return next;
}
// Always 6 full weeks (42 days) so the grid's height doesn't jump around
// from month to month.
function monthGridDays(anchor: Date): Date[] {
  const firstOfMonth = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const gridStart = startOfWeek(firstOfMonth);
  return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
}
const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type ViewMode = "day" | "month";

function JobCard({
  job, onOpen,
}: {
  job: JobWithCustomer;
  onOpen: () => void;
}) {
  const { locationName, street, cityStateZip } = splitAddress(job.service_address);
  const isPending = job.status === "needs_scheduling";
  return (
    <div
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onOpen()}
      className={`cursor-pointer rounded-lg border p-3 hover:border-brand-400 ${
        isPending ? "border-dashed border-slate-300 bg-slate-50" : "border-slate-200 bg-white"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <div className="flex min-w-0 items-center gap-2">
            {job.project_number && (
              <span className="shrink-0 whitespace-nowrap rounded bg-slate-100 px-1.5 py-0.5 text-sm font-mono text-slate-700">{job.project_number}</span>
            )}
            <div className="min-w-0 truncate whitespace-nowrap text-sm font-medium text-slate-700">
              {job.customers?.company || (job.customers?.name ? toTitleCase(job.customers.name) : undefined)}
            </div>
          </div>
          <div className="truncate whitespace-nowrap text-sm text-slate-700">
            {isPending
              ? `Requested for: ${formatDate(job.requested_date)}${job.requested_time ? ` ${formatTime(job.requested_time)}` : ""}`
              : job.source === "subcontractor" && job.confirmed_time && job.confirmed_time === parseWindowStartTime24h(job.subcontractor_preferred_window)
              ? extractTimeRange(job.subcontractor_preferred_window) ?? formatTime(job.confirmed_time)
              : formatTime(job.confirmed_time ?? job.requested_time) || "--:--"}
          </div>
          {job.service_address && (
            <a
              href={googleMapsUrl(job.service_address)}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="block truncate whitespace-nowrap text-sm text-slate-700 hover:underline"
            >
              {[locationName, expandAddress(street), expandAddress(cityStateZip)].filter(Boolean).join(", ")}
            </a>
          )}
          {(job.site_contact_name || job.site_contact_phone) && (
            <div className="truncate whitespace-nowrap text-sm text-slate-700">
              Job site contact: {job.site_contact_name ? toTitleCase(job.site_contact_name) : ""}{job.site_contact_name && job.site_contact_phone ? " · " : ""}
              {job.site_contact_phone && (
                <a href={telHref(job.site_contact_phone)} className="text-brand-700 hover:underline" onClick={(e) => e.stopPropagation()}>
                  {formatPhoneNumber(job.site_contact_phone)}
                </a>
              )}
            </div>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <span className={`shrink-0 rounded px-2 py-1 text-sm font-medium ${STATUS_COLOR[job.status]}`}>
            {STATUS_LABEL[job.status]}
          </span>
        </div>
      </div>
    </div>
  );
}

export default function ScheduleView() {
  const [jobs, setJobs] = useState<JobWithCustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("month");
  const [anchorDate, setAnchorDate] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState(() => toISO(new Date()));
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [editingJobId, setEditingJobId] = useState<string | null>(null);
  const dateInputRef = useRef<HTMLInputElement>(null);

  function loadJobs() {
    setLoading(true);
    setError(null);
    return fetch("/api/admin/jobs")
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error ?? "Failed to load schedule");
        setJobs(data.jobs);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load schedule"))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadJobs();
  }, []);

  async function patchJob(job: JobWithCustomer, patch: Record<string, unknown>) {
    const res = await fetch(`/api/admin/jobs/${job.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (res.ok) loadJobs();
  }

  const jobsByDate = useMemo(() => {
    const map = new Map<string, JobWithCustomer[]>();
    for (const job of jobs) {
      // Every status shows, not just upcoming ones — the schedule is meant
      // to double as a look-back record of what happened on a given day,
      // not just a forward-looking booking calendar.
      const key = job.confirmed_date ?? job.requested_date;
      if (!key) continue;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(job);
    }
    for (const dateJobs of map.values()) {
      dateJobs.sort((a, b) => ((a.confirmed_time ?? a.requested_time) ?? "99:99").localeCompare((b.confirmed_time ?? b.requested_time) ?? "99:99"));
    }
    return map;
  }, [jobs]);

  // Navigating (Prev/Next/Today) moves both the visible range and which
  // day's cards are shown below; clicking a specific cell in month view
  // only changes the selected day, leaving the range in place.
  function goTo(nextAnchor: Date) {
    setAnchorDate(nextAnchor);
    setSelectedDate(toISO(nextAnchor));
  }

  function step(n: number) {
    if (viewMode === "day") goTo(addDays(anchorDate, n));
    else goTo(addMonths(anchorDate, n));
  }

  const rangeLabel = useMemo(() => {
    if (viewMode === "day") {
      return anchorDate.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
    }
    return anchorDate.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  }, [viewMode, anchorDate]);

  const selectedDateLabel = useMemo(() => {
    return parseISO(selectedDate).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  }, [selectedDate]);

  // Switching into Day view snaps its single date to whatever was already
  // selected (from Month), so the header and the cards below it never
  // disagree about which day is showing.
  function selectView(v: ViewMode) {
    setViewMode(v);
    if (v === "day") setAnchorDate(parseISO(selectedDate));
  }

  const todayIso = toISO(new Date());
  const selectedJobs = jobsByDate.get(selectedDate) ?? [];

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold uppercase text-slate-800">Schedule</h1>
        <div className="flex gap-1">
          {(["day", "month"] as ViewMode[]).map((v) => (
            <button
              key={v}
              onClick={() => selectView(v)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium capitalize ${viewMode === v ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600"}`}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <div className="flex items-center gap-1">
          <button onClick={() => step(-1)} className="rounded-lg bg-slate-100 px-2.5 py-1.5 text-sm font-bold text-slate-600">
            ‹
          </button>
          <button onClick={() => goTo(new Date())} title="Jump to today" className="rounded-lg bg-slate-100 px-3 py-1.5 text-sm font-semibold text-slate-700">
            {rangeLabel}
          </button>
          <button onClick={() => step(1)} className="rounded-lg bg-slate-100 px-2.5 py-1.5 text-sm font-bold text-slate-600">
            ›
          </button>
          {viewMode === "day" && (
            <div className="relative">
              <button
                onClick={() => dateInputRef.current?.showPicker?.() ?? dateInputRef.current?.focus()}
                aria-label="Jump to date"
                title="Jump to date"
                className="rounded-lg bg-slate-100 px-2.5 py-1.5 text-sm"
              >
                📅
              </button>
              <input
                ref={dateInputRef}
                type="date"
                value={toISO(anchorDate)}
                onChange={(e) => e.target.value && goTo(parseISO(e.target.value))}
                className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                tabIndex={-1}
              />
            </div>
          )}
        </div>
      </div>

      {error && <div className="mt-3 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}

      {loading ? (
        <p className="mt-6 text-sm text-slate-500">Loading…</p>
      ) : (
        <>
          {viewMode === "month" && (
            <div className="mt-4 overflow-x-auto">
              <div className="min-w-0 sm:min-w-[560px]">
                <div className="grid grid-cols-7 gap-1 text-center text-xs font-semibold text-slate-400">
                  {WEEKDAY_SHORT.map((w) => (
                    <div key={w} className="py-1">{w}</div>
                  ))}
                </div>
                <div className="grid grid-cols-7 gap-1">
                  {monthGridDays(anchorDate).map((d) => {
                    const iso = toISO(d);
                    const dayJobs = jobsByDate.get(iso) ?? [];
                    const inMonth = d.getMonth() === anchorDate.getMonth();
                    const isToday = iso === todayIso;
                    const isSelected = iso === selectedDate;
                    return (
                      <button
                        key={iso}
                        onClick={() => setSelectedDate(iso)}
                        className={`flex h-16 flex-col items-center rounded-lg border p-1 ${
                          isSelected ? "border-brand-600 bg-brand-50" : "border-slate-200 bg-white"
                        } ${inMonth ? "" : "opacity-40"}`}
                      >
                        <span className={`text-xs font-medium ${isToday ? "flex h-5 w-5 items-center justify-center rounded-full bg-brand-600 text-white" : "text-slate-600"}`}>
                          {d.getDate()}
                        </span>
                        {dayJobs.length > 0 && (
                          <span className="mt-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-slate-700 px-1 text-[10px] font-bold text-white">
                            {dayJobs.length}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {viewMode === "day" && (
            <div className="mt-4 space-y-6">
              {[anchorDate].map((d) => {
                const iso = toISO(d);
                const dayJobs = jobsByDate.get(iso) ?? [];
                const isToday = iso === todayIso;
                return (
                  <section key={iso}>
                    <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-600">
                      {d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
                      {isToday && (
                        <span className="rounded-full bg-brand-600 px-2 py-0.5 text-[10px] font-bold text-white">Today</span>
                      )}
                    </h2>
                    <div className="mt-2 space-y-2">
                      {dayJobs.length === 0 ? (
                        <p className="text-sm text-slate-500">Nothing scheduled.</p>
                      ) : (
                        dayJobs.map((job) => <JobCard
                          key={job.id}
                          job={job}
                          onOpen={() => setSelectedJobId(job.id)}
                        />)
                      )}
                    </div>
                  </section>
                );
              })}
            </div>
          )}

          {viewMode === "month" && (
            <section className="mt-6">
              <h2 className="text-sm font-semibold text-slate-500">{selectedDateLabel}</h2>
              <div className="mt-2 space-y-2">
                {selectedJobs.length === 0 ? (
                  <p className="text-sm text-slate-500">Nothing scheduled.</p>
                ) : (
                  selectedJobs.map((job) => <JobCard
                          key={job.id}
                          job={job}
                          onOpen={() => setSelectedJobId(job.id)}
                        />)
                )}
              </div>
            </section>
          )}
        </>
      )}

      {(() => {
        const detailJob = selectedJobId ? jobs.find((j) => j.id === selectedJobId) : null;
        if (!detailJob) return null;
        return (
          <ProjectDetailDialog
            job={detailJob}
            onClose={() => setSelectedJobId(null)}
            onChanged={() => loadJobs()}
            onEdit={() => setEditingJobId(detailJob.id)}
            onStatusChange={(status) => patchJob(detailJob, { status })}
          />
        );
      })()}

      {(() => {
        const editJob = editingJobId ? jobs.find((j) => j.id === editingJobId) : null;
        if (!editJob) return null;
        return (
          <EditProjectDialog
            job={editJob}
            onClose={() => setEditingJobId(null)}
            onSaved={() => loadJobs()}
          />
        );
      })()}
    </div>
  );
}
