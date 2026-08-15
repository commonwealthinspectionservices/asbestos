"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Customer, Job } from "@/lib/types";
import { splitAddress, googleMapsUrl } from "@/lib/address";
import { formatDateDMY } from "@/lib/date-format";
import ProjectDetailModal from "@/components/portal/ProjectDetailModal";

const OPEN_STATUSES = new Set(["needs_scheduling", "scheduled", "fieldwork_in_progress", "awaiting_lab_results", "needs_report", "pending_lab_results", "completed", "invoiced", "ready_to_send"]);
const CLOSED_STATUSES = new Set(["paid", "cancelled"]);

// Matches if the target contains every word of the query as a substring, in
// any order — mirrors the admin dashboard's own matchesAnyWord.
function matchesAnyWord(target: string, query: string): boolean {
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const t = target.toLowerCase();
  return words.every((w) => t.includes(w));
}

type SortField = "date" | "project_number";
const SORT_FIELDS: { key: SortField; label: string }[] = [
  { key: "date", label: "Date" },
  { key: "project_number", label: "Project #" },
];

// Same pipeline the admin filters by, collapsed to the statuses a client
// actually sees distinct labels for — ready_to_send reads identically to
// pending_lab_results here (see STATUS_LABEL's own comment above), so
// selecting either one filters for both underlying keys at once.
const PIPELINE_STATUSES: { key: string; matches: string[] }[] = [
  { key: "needs_scheduling", matches: ["needs_scheduling"] },
  { key: "scheduled", matches: ["scheduled"] },
  { key: "pending_lab_results", matches: ["pending_lab_results", "ready_to_send"] },
  { key: "paid", matches: ["paid"] },
  { key: "cancelled", matches: ["cancelled"] },
];

function formatDate(date: string | null | undefined): string {
  return formatDateDMY(date) ?? "";
}

function formatClockTime(totalMinutes: number): string {
  const normalized = ((totalMinutes % 1440) + 1440) % 1440;
  const h = Math.floor(normalized / 60);
  const m = normalized % 60;
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 || 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${period}`;
}

// Mirrors ProjectDetailModal.tsx's formatTimeWindow — the admin's exact
// confirmed_time (e.g. "2:00 PM"), falling back to the coarser AM/PM window
// only when no specific time has been set yet, and to nothing at all for
// "ANY" with no time set.
function formatTimeWindow(confirmedTime: string | null | undefined, window: string | null | undefined): string {
  if (confirmedTime) {
    const [h, m] = confirmedTime.split(":").map(Number);
    if (!Number.isNaN(h) && !Number.isNaN(m)) {
      return formatClockTime(h * 60 + m);
    }
  }
  if (window === "AM") return "Morning";
  if (window === "PM") return "Afternoon";
  return "";
}

// Mirrors STATUS_LABEL/STATUS_COLOR in admin/JobsDashboard.tsx — kept as a
// separate copy (not imported) so the portal's client bundle doesn't pull
// in the whole admin dashboard module just for these two lookup tables.
// One deliberate difference: "ready_to_send" reads identically to
// "pending_lab_results" here — that status means the report/invoice are
// drafted but still awaiting the admin's own approval to send, which isn't
// a distinction a client needs to see. It should just still look pending
// until it's actually sent.
export const STATUS_LABEL: Record<string, string> = {
  needs_scheduling: "Pending Approval",
  scheduled: "Scheduled",
  fieldwork_in_progress: "Fieldwork In Progress",
  awaiting_lab_results: "Awaiting Lab Results",
  needs_report: "Fieldwork Complete Needs Report",
  pending_lab_results: "Pending Lab Results",
  completed: "Report Ready",
  invoiced: "Invoiced",
  ready_to_send: "Pending Lab Results",
  paid: "Paid",
  cancelled: "Cancelled",
};

export const STATUS_COLOR: Record<string, string> = {
  needs_scheduling: "bg-slate-200 text-slate-700",
  scheduled: "bg-blue-100 text-blue-700",
  fieldwork_in_progress: "bg-indigo-100 text-indigo-700",
  awaiting_lab_results: "bg-purple-100 text-purple-700",
  needs_report: "bg-orange-100 text-orange-700",
  pending_lab_results: "bg-purple-100 text-purple-700",
  completed: "bg-teal-100 text-teal-700",
  invoiced: "bg-amber-100 text-amber-700",
  ready_to_send: "bg-purple-100 text-purple-700",
  paid: "bg-emerald-100 text-emerald-700",
  cancelled: "bg-red-100 text-red-700",
};

export default function ProjectsList() {
  const [projects, setProjects] = useState<Job[]>([]);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [statusView, setStatusView] = useState<"all" | "open" | "closed">("open");
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [statusFilterOpen, setStatusFilterOpen] = useState(false);
  const [serviceTypeFilter, setServiceTypeFilter] = useState<Set<string>>(new Set());
  const [serviceTypeFilterOpen, setServiceTypeFilterOpen] = useState(false);
  const [sortBy, setSortBy] = useState<SortField>("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [projectNumberQuery, setProjectNumberQuery] = useState("");
  const [addressQuery, setAddressQuery] = useState("");
  const [dateQuery, setDateQuery] = useState("");

  function selectStatusView(view: "all" | "open" | "closed") {
    setStatusView(view);
    setStatusFilter(null);
  }

  function toggleServiceTypeFilter(label: string) {
    setServiceTypeFilter((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }

  function toggleSort(field: SortField) {
    if (sortBy === field) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortBy(field);
      setSortDir("asc");
    }
  }

  function load() {
    fetch("/api/portal/projects")
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error ?? "Failed to load projects");
        setProjects(data.projects);
        setCustomer(data.customer);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load projects"))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  // Derived from the live `projects` array (not a separately-held copy) so
  // JobRecipients' edits (Send results to / Billing contact) show up in the
  // open modal immediately after `load()` refetches, instead of needing to
  // close and reopen it.
  const selected = projects.find((p) => p.id === selectedId) ?? null;

  // Options for the Service Type filter — derived from whatever's actually
  // on this account's own projects rather than a settings fetch, since a
  // client only ever needs to filter within their own history.
  const availableServiceTypes = useMemo(() => {
    const labels = new Set<string>();
    for (const p of projects) {
      for (const label of (p.service_type ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
        labels.add(label);
      }
    }
    return [...labels].sort();
  }, [projects]);

  const filteredProjects = useMemo(() => {
    let result = projects;
    if (statusFilter) {
      const matches = PIPELINE_STATUSES.find((s) => s.key === statusFilter)?.matches ?? [statusFilter];
      result = result.filter((p) => matches.includes(p.status));
    } else if (statusView === "open") {
      result = result.filter((p) => OPEN_STATUSES.has(p.status));
    } else if (statusView === "closed") {
      result = result.filter((p) => CLOSED_STATUSES.has(p.status));
    }

    if (serviceTypeFilter.size > 0) {
      result = result.filter((p) => {
        const labels = (p.service_type ?? "").split(",").map((s) => s.trim());
        return labels.some((label) => serviceTypeFilter.has(label));
      });
    }

    if (projectNumberQuery.trim()) {
      result = result.filter((p) => matchesAnyWord(p.project_number ?? "", projectNumberQuery));
    }
    if (addressQuery.trim()) {
      result = result.filter((p) => matchesAnyWord(p.service_address ?? "", addressQuery));
    }
    if (dateQuery) {
      result = result.filter((p) => p.requested_date === dateQuery);
    }
    return result;
  }, [projects, statusView, statusFilter, serviceTypeFilter, projectNumberQuery, addressQuery, dateQuery]);

  const sortedProjects = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    return [...filteredProjects].sort((a, b) => {
      if (sortBy === "project_number") {
        return dir * (a.project_number ?? "").localeCompare(b.project_number ?? "");
      }
      return dir * (a.requested_date ?? "").localeCompare(b.requested_date ?? "");
    });
  }, [filteredProjects, sortBy, sortDir]);

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <div className="mt-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold uppercase text-brand-700">My Projects</h1>
        <Link
          href="/portal/book"
          className="inline-flex h-10 items-center bg-emerald-600 px-6 text-lg font-extrabold uppercase leading-none text-white hover:underline sm:h-12"
        >
          Book a project
        </Link>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 border-b border-slate-200 pb-4">
        <button
          onClick={() => selectStatusView("all")}
          className={`rounded-lg px-2.5 py-1 text-sm font-medium uppercase ${!statusFilter && statusView === "all" ? "bg-slate-700 text-white" : "bg-slate-100 text-slate-600"}`}
        >
          All Projects
        </button>
        <button
          onClick={() => selectStatusView("open")}
          className={`rounded-lg px-2.5 py-1 text-sm font-medium uppercase ${!statusFilter && statusView === "open" ? "bg-slate-700 text-white" : "bg-slate-100 text-slate-600"}`}
        >
          Open Projects
        </button>
        <button
          onClick={() => selectStatusView("closed")}
          className={`rounded-lg px-2.5 py-1 text-sm font-medium uppercase ${!statusFilter && statusView === "closed" ? "bg-slate-700 text-white" : "bg-slate-100 text-slate-600"}`}
        >
          Closed Projects
        </button>
      </div>

      {projects.length > 0 && (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium uppercase text-slate-500">Sort by:</span>
            {SORT_FIELDS.map((f) => (
              <button
                key={f.key}
                onClick={() => toggleSort(f.key)}
                className={`rounded-lg px-2.5 py-1 text-sm font-medium uppercase ${sortBy === f.key ? "bg-slate-700 text-white" : "bg-slate-100 text-slate-600"}`}
              >
                {f.label}{sortBy === f.key ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
              </button>
            ))}
            <div
              className="relative"
              onMouseEnter={() => setStatusFilterOpen(true)}
              onMouseLeave={() => setStatusFilterOpen(false)}
            >
              <button className={`rounded-lg px-2.5 py-1 text-sm font-medium uppercase ${statusFilter ? "bg-slate-700 text-white" : "bg-slate-100 text-slate-600"}`}>
                Status ▾
              </button>
              {statusFilterOpen && (
                <div className="absolute z-10 mt-1 w-56 rounded-lg border border-slate-200 bg-white p-2 shadow-lg">
                  {PIPELINE_STATUSES.map((s) => (
                    <label key={s.key} className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-slate-50">
                      <input
                        type="radio"
                        name="statusFilter"
                        checked={statusFilter === s.key}
                        onChange={() => setStatusFilter(s.key)}
                        className="h-3.5 w-3.5 shrink-0"
                      />
                      {STATUS_LABEL[s.key]}
                    </label>
                  ))}
                  {statusFilter && (
                    <button onClick={() => setStatusFilter(null)} className="mt-1 w-full rounded px-2 py-1 text-left text-xs text-brand-600 underline">
                      Clear
                    </button>
                  )}
                </div>
              )}
            </div>
            {availableServiceTypes.length > 0 && (
              <div
                className="relative"
                onMouseEnter={() => setServiceTypeFilterOpen(true)}
                onMouseLeave={() => setServiceTypeFilterOpen(false)}
              >
                <button className={`rounded-lg px-2.5 py-1 text-sm font-medium uppercase ${serviceTypeFilter.size > 0 ? "bg-slate-700 text-white" : "bg-slate-100 text-slate-600"}`}>
                  Service Type{serviceTypeFilter.size > 0 ? ` (${serviceTypeFilter.size})` : ""} ▾
                </button>
                {serviceTypeFilterOpen && (
                  <div className="absolute z-10 mt-1 w-max max-w-xs rounded-lg border border-slate-200 bg-white p-2 shadow-lg">
                    {availableServiceTypes.map((label) => (
                      <label key={label} className="flex items-center gap-2 whitespace-nowrap rounded px-2 py-1.5 text-sm hover:bg-slate-50">
                        <input
                          type="checkbox"
                          checked={serviceTypeFilter.has(label)}
                          onChange={() => toggleServiceTypeFilter(label)}
                          className="h-3.5 w-3.5 shrink-0"
                        />
                        {label}
                      </label>
                    ))}
                    {serviceTypeFilter.size > 0 && (
                      <button onClick={() => setServiceTypeFilter(new Set())} className="mt-1 w-full rounded px-2 py-1 text-left text-xs text-brand-600 underline">
                        Clear
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="shrink-0 text-sm font-medium uppercase text-slate-500">Search by:</span>
            <input
              value={projectNumberQuery}
              onChange={(e) => setProjectNumberQuery(e.target.value)}
              placeholder="Project #"
              className="w-0 min-w-[8rem] flex-1 rounded-lg border border-slate-300 px-2.5 py-1 text-sm"
            />
            <input
              value={addressQuery}
              onChange={(e) => setAddressQuery(e.target.value)}
              placeholder="Address"
              className="w-0 min-w-[8rem] flex-1 rounded-lg border border-slate-300 px-2.5 py-1 text-sm"
            />
            <input
              type="date"
              value={dateQuery}
              onChange={(e) => setDateQuery(e.target.value)}
              className="w-36 shrink-0 rounded-lg border border-slate-300 px-2.5 py-1 text-sm"
            />
            {dateQuery && (
              <button onClick={() => setDateQuery("")} className="text-xs text-brand-600 underline">
                Clear date
              </button>
            )}
          </div>
        </>
      )}

      {error && <div className="mt-3 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}

      {loading ? (
        <p className="mt-6 text-sm text-slate-500">Loading…</p>
      ) : projects.length === 0 ? (
        <p className="mt-6 text-lg text-slate-500">No projects yet.</p>
      ) : sortedProjects.length === 0 ? (
        <p className="mt-6 text-sm uppercase text-slate-500">No projects match these filters.</p>
      ) : (
        <div className="mt-6 space-y-2">
          {sortedProjects.map((p) => {
            const { locationName, street, cityStateZip } = splitAddress(p.service_address);
            const serviceLabels = (p.service_type ?? "").split(",").map((s) => s.trim()).filter(Boolean);
            const closed = CLOSED_STATUSES.has(p.status);
            return (
              <div
                key={p.id}
                onClick={() => setSelectedId(p.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setSelectedId(p.id)}
                className="flex w-full cursor-pointer flex-col rounded-lg border border-slate-200 bg-white p-3 hover:border-brand-400"
              >
                <div className="flex w-full items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    {p.project_number && (
                      <span className="shrink-0 whitespace-nowrap rounded bg-slate-200 px-2 py-0.5 text-sm font-mono font-bold text-slate-800 hover:underline">
                        {p.project_number}
                      </span>
                    )}
                  </div>
                  <span className={`shrink-0 whitespace-nowrap rounded px-2 py-0.5 text-sm font-bold uppercase ${STATUS_COLOR[p.status]}`}>
                    {STATUS_LABEL[p.status]}
                  </span>
                </div>

                <div className="text-sm text-slate-500">&nbsp;</div>

                <div className="flex w-full items-start gap-3">
                  <a
                    href={googleMapsUrl(p.service_address)}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="min-w-0 flex-[0.9] hover:underline"
                  >
                    {locationName && <div className="truncate whitespace-nowrap text-sm text-slate-500">{locationName}</div>}
                    <div className="truncate whitespace-nowrap text-sm text-slate-500">{street}</div>
                    {cityStateZip && <div className="truncate whitespace-nowrap text-sm text-slate-500">{cityStateZip}</div>}
                  </a>

                  <div className="min-w-0 flex-[1.2]">
                    {serviceLabels.map((label, i) => (
                      <div key={i} className="whitespace-nowrap text-sm text-slate-500">
                        {label}{i < serviceLabels.length - 1 ? "," : ""}
                      </div>
                    ))}
                  </div>

                  <div className="flex min-w-0 flex-[0.9] flex-col items-end gap-0.5 text-xs text-slate-500">
                    {closed ? (
                      <>
                        <span>Date of Project: {formatDate(p.confirmed_date) || "—"}</span>
                        <span>Date of Payment: {formatDate(p.paid_date) || "—"}</span>
                      </>
                    ) : p.status === "scheduled" ? (
                      <>
                        <span>{formatDate(p.confirmed_date) || "—"}</span>
                        <span>{formatTimeWindow(p.confirmed_time, p.window) || "—"}</span>
                      </>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {selected && customer && (
        <ProjectDetailModal job={selected} customer={customer} onClose={() => setSelectedId(null)} onChanged={load} />
      )}
    </div>
  );
}
