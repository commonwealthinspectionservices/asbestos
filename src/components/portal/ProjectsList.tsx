"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Customer, Job } from "@/lib/types";
import { splitAddress } from "@/lib/address";
import ProjectDetailModal from "@/components/portal/ProjectDetailModal";

const CLOSED_STATUSES = new Set(["paid", "cancelled"]);

function formatDate(date: string | null | undefined): string {
  if (!date) return "";
  const [y, m, d] = date.split("-");
  if (!y || !m || !d) return date;
  return `${m}/${d}/${y}`;
}

// Mirrors STATUS_LABEL/STATUS_COLOR in admin/JobsDashboard.tsx — kept as a
// separate copy (not imported) so the portal's client bundle doesn't pull
// in the whole admin dashboard module just for these two lookup tables.
export const STATUS_LABEL: Record<string, string> = {
  needs_scheduling: "To Be Scheduled",
  scheduled: "Scheduled",
  fieldwork_in_progress: "Fieldwork In Progress",
  awaiting_lab_results: "Awaiting Lab Results",
  needs_report: "Fieldwork Complete Needs Report",
  pending_lab_results: "Pending Lab Results",
  completed: "Report Ready",
  invoiced: "Invoiced",
  ready_to_send: "Report and Invoice Ready",
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
  ready_to_send: "bg-amber-100 text-amber-700",
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
        <h1 className="text-lg font-semibold text-slate-800">My Projects</h1>
        <Link href="/portal/book" className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white">
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
                      <span className="shrink-0 whitespace-nowrap rounded bg-slate-200 px-2 py-0.5 text-sm font-mono font-bold text-slate-800">
                        {p.project_number}
                      </span>
                    )}
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-1 text-xs font-medium ${STATUS_COLOR[p.status]}`}>
                    {STATUS_LABEL[p.status]}
                  </span>
                </div>

                <div className="text-sm text-slate-500">&nbsp;</div>

                <div className="flex w-full items-start gap-3">
                  <div className="min-w-0 flex-[0.9]">
                    {locationName && <div className="truncate whitespace-nowrap text-sm text-slate-500">{locationName}</div>}
                    <div className="truncate whitespace-nowrap text-sm text-slate-500">{street}</div>
                    {cityStateZip && <div className="truncate whitespace-nowrap text-sm text-slate-500">{cityStateZip}</div>}
                  </div>

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
                    ) : (
                      <span>{formatDate(p.confirmed_date)}</span>
                    )}
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
