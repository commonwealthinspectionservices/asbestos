"use client";

import { useState } from "react";
import type { JobWithCustomer } from "@/lib/types";

function formatDate(date: string | null | undefined): string {
  if (!date) return "";
  const [y, m, d] = date.split("-");
  if (!y || !m || !d) return date;
  return `${m}/${d}/${y}`;
}

function formatTime(time: string | null | undefined): string {
  if (!time) return "";
  const [h, m] = time.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 || 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${period}`;
}

// The one deliberate step that turns a customer's request (requested_date/
// requested_time) into a real confirmed job — sets confirmed_date/
// confirmed_time, flips status to "scheduled", and turns on
// schedule_visible_to_customer, all in one action. Renders nothing once a
// job is past "needs_scheduling".
export function AcceptScheduleControl({
  job, onAccept, variant, stopPropagation,
}: {
  job: JobWithCustomer;
  onAccept: (patch: Record<string, unknown>) => void | Promise<void>;
  variant: "button" | "panel";
  stopPropagation?: boolean;
}) {
  const [date, setDate] = useState(job.requested_date ?? "");
  const [time, setTime] = useState(job.requested_time ?? "");
  const [submitting, setSubmitting] = useState(false);

  if (job.status !== "needs_scheduling") return null;

  async function acceptWith(confirmedDate: string | null, confirmedTime: string | null) {
    setSubmitting(true);
    try {
      await onAccept({
        status: "scheduled",
        confirmed_date: confirmedDate,
        confirmed_time: confirmedTime,
        schedule_visible_to_customer: true,
      });
    } finally {
      setSubmitting(false);
    }
  }

  if (variant === "button") {
    const label = job.requested_date
      ? `Accept · ${formatDate(job.requested_date)}${job.requested_time ? ` ${formatTime(job.requested_time)}` : ""}`
      : "Accept";
    return (
      <button
        type="button"
        disabled={submitting || !job.requested_date}
        onClick={(e) => {
          if (stopPropagation) e.stopPropagation();
          acceptWith(job.requested_date, job.requested_time ?? null);
        }}
        className="shrink-0 whitespace-nowrap rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-bold uppercase text-white disabled:opacity-50"
      >
        {submitting ? "Accepting…" : label}
      </button>
    );
  }

  return (
    <div
      onClick={(e) => stopPropagation && e.stopPropagation()}
      className="rounded-lg border border-slate-200 bg-slate-50 p-3"
    >
      <p className="text-xs font-bold uppercase text-slate-500">Accept & Schedule</p>
      <p className="mt-1 text-xs text-slate-500">Confirms this date/time and makes it visible to the customer.</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="rounded-lg border border-slate-300 px-2 py-1 text-sm"
        />
        <input
          type="time"
          value={time}
          onChange={(e) => setTime(e.target.value)}
          className="rounded-lg border border-slate-300 px-2 py-1 text-sm"
        />
        <button
          type="button"
          disabled={submitting || !date}
          onClick={() => acceptWith(date || null, time || null)}
          className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-bold text-white disabled:opacity-50"
        >
          {submitting ? "Accepting…" : "Accept & Schedule"}
        </button>
      </div>
    </div>
  );
}
