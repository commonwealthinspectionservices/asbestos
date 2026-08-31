"use client";

import Link from "next/link";

// Generic, job-independent Chain of Custody templates — printed ahead of
// time in stacks and filled out entirely by hand in the field, rather than
// pulled per-job (see blank-coc-pdf.tsx / mold-coc-pdf.tsx for the job-
// specific versions surfaced instead on each job's own detail view).
const FORMS = [
  { key: "asbestos", label: "Asbestos Bulk Sample", url: "/api/admin/blank-coc", filename: "coc-blank.pdf" },
  { key: "mold-air_o_cell", label: "Mold — Air-O-Cell", url: "/api/admin/mold-coc?type=air_o_cell", filename: "mold-coc-air-o-cell-blank.pdf" },
  { key: "mold-bulk", label: "Mold — Bulk", url: "/api/admin/mold-coc?type=bulk", filename: "mold-coc-bulk-blank.pdf" },
  { key: "mold-swab", label: "Mold — Swab", url: "/api/admin/mold-coc?type=swab", filename: "mold-coc-swab-blank.pdf" },
];

export default function ChainOfCustody() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <h1 className="text-lg font-semibold text-slate-800">Chain of Custody</h1>

      <div className="mt-4 divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
        {FORMS.map((form) => (
          <div key={form.key} className="flex items-center justify-between gap-3 px-4 py-3">
            <span className="text-sm font-medium text-slate-700">{form.label}</span>
            <div className="flex shrink-0 gap-3 text-sm">
              <a href={form.url} target="_blank" rel="noreferrer" className="text-brand-600 hover:underline">
                View
              </a>
              <a
                href={`${form.url}${form.url.includes("?") ? "&" : "?"}download=1`}
                download={form.filename}
                className="text-brand-600 hover:underline"
              >
                Download
              </a>
            </div>
          </div>
        ))}
      </div>

      {/* Per Tim, 2026-08-31 — "delete Ray's Library from the tabs on top
          and just make it a small link at the bottom of the Chain of
          Custody page" — no longer a top-level nav tab, still a real page. */}
      <div className="mt-6">
        <Link href="/admin/rays-library" className="text-sm text-slate-500 hover:underline">
          Ray&apos;s Library
        </Link>
      </div>
    </div>
  );
}
