"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Job } from "@/lib/types";

const STATUS_LABEL: Record<string, string> = {
  scheduled: "Scheduled",
  completed: "Completed",
  invoiced: "Invoiced",
  ready_to_send: "Report and Invoice Ready",
  paid: "Paid",
  cancelled: "Cancelled",
};

const REPORT_READY_STATUSES = new Set(["completed", "invoiced", "ready_to_send", "paid"]);

const STATUS_COLOR: Record<string, string> = {
  scheduled: "bg-blue-100 text-blue-700",
  completed: "bg-slate-100 text-slate-700",
  invoiced: "bg-amber-100 text-amber-700",
  ready_to_send: "bg-amber-100 text-amber-700",
  paid: "bg-emerald-100 text-emerald-700",
  cancelled: "bg-red-100 text-red-700",
};

export default function ProjectsList() {
  const [projects, setProjects] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/portal/projects")
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error ?? "Failed to load projects");
        setProjects(data.projects);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load projects"))
      .finally(() => setLoading(false));
  }, []);

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
          {projects.map((p) => (
            <div key={p.id} className="rounded-lg border border-slate-200 bg-white p-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-medium text-slate-800">{p.service_address}</div>
                  <div className="mt-1 text-sm text-slate-600">
                    {p.requested_date} · {p.service_type} · {p.window}
                  </div>
                </div>
                <span className={`shrink-0 rounded-full px-2 py-1 text-xs font-medium ${STATUS_COLOR[p.status]}`}>
                  {STATUS_LABEL[p.status]}
                </span>
              </div>
              {REPORT_READY_STATUSES.has(p.status) && (
                <a
                  href={`/api/portal/projects/${p.id}/report`}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-block text-sm text-brand-600 underline"
                >
                  Download report
                </a>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
