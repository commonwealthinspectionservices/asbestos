"use client";

import { useState } from "react";
import type { JobWithCustomer } from "@/lib/types";

function ordinalSuffix(day: number): string {
  if (day >= 11 && day <= 13) return "th";
  switch (day % 10) {
    case 1: return "st";
    case 2: return "nd";
    case 3: return "rd";
    default: return "th";
  }
}

// "Thursday August 7th, 2026" — the full spelled-out form, used only for
// the "Requested for" bubble, which is meant to read like a sentence
// rather than a compact MM/DD/YYYY field value.
function formatFullDate(date: string | null | undefined): string {
  if (!date) return "";
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return date;
  const parsed = new Date(y, m - 1, d);
  const weekday = parsed.toLocaleDateString("en-US", { weekday: "long" });
  const month = parsed.toLocaleDateString("en-US", { month: "long" });
  return `${weekday} ${month} ${d}${ordinalSuffix(d)}, ${y}`;
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
// confirmed_time, flips status to "scheduled", and asks once whether to
// turn on schedule_visible_to_customer before finalizing (rather than
// always defaulting it on) — the answer becomes the toggle's starting
// state, still changeable afterward from JobRow. The "button" variant's
// red X opens the job's chat instead of taking any direct action on the
// request itself — for working out a real time with the customer rather
// than guessing at one. Renders nothing once a job is past
// "needs_scheduling", or if it's needs_scheduling for a reason other than
// a real unreviewed request (portal_booking or email_intake — e.g. the
// admin entered it directly via Add Project and left it unscheduled on
// purpose).
export function AcceptScheduleControl({
  job, onAccept, onOpenChat, variant, stopPropagation,
}: {
  job: JobWithCustomer;
  onAccept: (patch: Record<string, unknown>) => void | Promise<void>;
  onOpenChat?: () => void;
  variant: "button" | "panel";
  stopPropagation?: boolean;
}) {
  const [date, setDate] = useState(job.requested_date ?? "");
  const [time, setTime] = useState(job.requested_time ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [confirmingVisibility, setConfirmingVisibility] = useState(false);

  if (job.status !== "needs_scheduling" || (job.source !== "portal_booking" && job.source !== "email_intake")) return null;

  async function finalize(confirmedDate: string | null, confirmedTime: string | null, visibleToCustomer: boolean) {
    setSubmitting(true);
    try {
      await onAccept({
        status: "scheduled",
        confirmed_date: confirmedDate,
        confirmed_time: confirmedTime,
        schedule_visible_to_customer: visibleToCustomer,
      });
    } finally {
      setSubmitting(false);
      setConfirmingVisibility(false);
    }
  }

  if (confirmingVisibility) {
    const confirmedDate = variant === "button" ? job.requested_date : date || null;
    const confirmedTime = variant === "button" ? job.requested_time ?? null : time || null;
    return (
      <div
        onClick={(e) => stopPropagation && e.stopPropagation()}
        className="flex shrink-0 flex-wrap items-center gap-1.5 rounded-lg border border-slate-200 bg-white p-2 text-xs"
      >
        <span className="whitespace-nowrap font-medium text-slate-700">Show the date and time to the customer?</span>
        <button
          type="button"
          disabled={submitting}
          onClick={() => finalize(confirmedDate, confirmedTime, true)}
          className="shrink-0 rounded bg-emerald-600 px-2 py-1 font-bold text-white disabled:opacity-50"
        >
          {submitting ? "…" : "Yes"}
        </button>
        <button
          type="button"
          disabled={submitting}
          onClick={() => finalize(confirmedDate, confirmedTime, false)}
          className="shrink-0 rounded border border-slate-300 px-2 py-1 font-bold text-slate-600 disabled:opacity-50"
        >
          {submitting ? "…" : "No"}
        </button>
      </div>
    );
  }

  if (variant === "button") {
    return (
      <div onClick={(e) => stopPropagation && e.stopPropagation()} className="flex shrink-0 flex-wrap items-center gap-1.5">
        <span className="whitespace-nowrap rounded bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">
          {job.requested_date
            ? `Requested for ${formatFullDate(job.requested_date)}${job.requested_time ? ` at ${formatTime(job.requested_time)}` : ""}`
            : "No requested time"}
        </span>
        <button
          type="button"
          title="Accept this request"
          aria-label="Accept this request"
          disabled={!job.requested_date}
          onClick={() => setConfirmingVisibility(true)}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-sm font-bold leading-none text-white disabled:opacity-50"
        >
          ✓
        </button>
        <button
          type="button"
          title="Message the customer about this request"
          aria-label="Message the customer about this request"
          onClick={() => onOpenChat?.()}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-red-600 text-sm font-bold leading-none text-white"
        >
          ✕
        </button>
      </div>
    );
  }

  return (
    <div
      onClick={(e) => stopPropagation && e.stopPropagation()}
      className="rounded-lg border border-slate-200 bg-slate-50 p-3"
    >
      <p className="text-xs font-bold uppercase text-slate-500">Accept & Schedule</p>
      <p className="mt-1 text-xs text-slate-500">Confirms this date/time, then asks whether to show it to the customer.</p>
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
          disabled={!date}
          onClick={() => setConfirmingVisibility(true)}
          className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-bold text-white disabled:opacity-50"
        >
          Accept & Schedule
        </button>
      </div>
    </div>
  );
}
