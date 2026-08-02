"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Customer, Job } from "@/lib/types";
import { splitAddress, googleMapsUrl } from "@/lib/address";
import ProjectDetailModal from "@/components/portal/ProjectDetailModal";

const CLOSED_STATUSES = new Set(["paid", "cancelled"]);

function formatDate(date: string | null | undefined): string {
  if (!date) return "";
  const [y, m, d] = date.split("-");
  if (!y || !m || !d) return date;
  return `${m}/${d}/${y}`;
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
  needs_scheduling: "To Be Scheduled",
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

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <div className="flex items-center justify-between">
        <h1 className="text-sm font-bold uppercase text-brand-700">My Projects</h1>
        <Link
          href="/portal/book"
          className="inline-flex h-[22px] items-center bg-emerald-600 px-4 pt-0.5 text-sm font-extrabold uppercase leading-none text-white hover:underline sm:h-[29px]"
        >
          Book a project
        </Link>
      </div>

      {error && <div className="mt-3 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}

      {loading ? (
        <p className="mt-6 text-sm text-slate-500">Loading…</p>
      ) : projects.length === 0 ? (
        <p className="mt-6 text-sm text-slate-500">No projects yet.</p>
      ) : (
        <div className="mt-6 space-y-2">
          {projects.map((p) => {
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
