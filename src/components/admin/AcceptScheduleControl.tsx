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

// subcontractor_preferred_window carries the date too (e.g. "Wednesday,
// August 19, 2026 at 1:00 PM - 4:00 PM") — the "Requested for" bubble
// already states the date on its own, so this pulls out just the "1:00 PM
// - 4:00 PM" portion rather than repeating it.
export function extractTimeRange(windowText: string | null | undefined): string | null {
  if (!windowText) return null;
  const match = windowText.match(/\d{1,2}:\d{2}\s*[AP]M\s*-\s*\d{1,2}:\d{2}\s*[AP]M/i);
  return match ? match[0] : null;
}

// The window's own start time (e.g. "1:00 PM" out of "... 1:00 PM - 4:00
// PM"), as a 24-hour "HH:MM" for confirmed_time — accepting fills this in
// as a real starting point rather than leaving it blank; still editable by
// hand afterward once the exact arrival time is confirmed with the client.
export function parseWindowStartTime24h(windowText: string | null | undefined): string | null {
  if (!windowText) return null;
  const match = windowText.match(/(\d{1,2}):(\d{2})\s*([AP]M)/i);
  if (!match) return null;
  let hour = Number(match[1]);
  const period = match[3].toUpperCase();
  if (period === "PM" && hour !== 12) hour += 12;
  if (period === "AM" && hour === 12) hour = 0;
  return `${String(hour).padStart(2, "0")}:${match[2]}`;
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
// a real unreviewed request (portal_booking/email_intake, or subcontractor
// — e.g. the admin entered it directly via Add Project and left it
// unscheduled on purpose).
//
// Subcontractor jobs get the same accept-checkmark, but two things differ:
// there's no client-facing portal for a subcontracting company's contact
// to see a date/time in, so the "show this to the customer?" prompt is
// skipped entirely (accepts immediately, schedule_visible_to_customer
// stays off); and there's no Chat tab for these jobs (see
// JobsDashboard.tsx), so the red X opens the Edit dialog instead of chat —
// for picking a real date/time by hand when the requested window doesn't
// work as-is, via onEditManually rather than onOpenChat.
export function AcceptScheduleControl({
  job, onAccept, onOpenChat, onEditManually, variant, stopPropagation,
}: {
  job: JobWithCustomer;
  onAccept: (patch: Record<string, unknown>) => void | Promise<void>;
  onOpenChat?: () => void;
  onEditManually?: () => void;
  /** "inline" is a subcontractor-only ✓/✗ pair with no bubble/card — meant to sit directly next to a "Preferred window" field that already shows the date/time, rather than repeating it. */
  variant: "button" | "panel" | "inline";
  stopPropagation?: boolean;
}) {
  const [date, setDate] = useState(job.requested_date ?? "");
  const [time, setTime] = useState(job.requested_time ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [confirmingVisibility, setConfirmingVisibility] = useState(false);

  const isSubcontractor = job.source === "subcontractor";
  if (job.status !== "needs_scheduling" || !(job.source === "portal_booking" || job.source === "email_intake" || isSubcontractor)) return null;

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

  function startAccepting() {
    if (isSubcontractor) {
      // No client-facing portal to ask about — accept straight away.
      // confirmed_time gets the window's own start time (e.g. 1:00 PM out
      // of "1:00 PM - 4:00 PM") rather than staying blank — JobsDashboard's
      // Scheduled Time field shows the full range for as long as
      // confirmed_time still matches that start, and falls back to just
      // the specific time once it's edited by hand to something else.
      finalize(job.requested_date, parseWindowStartTime24h(job.subcontractor_preferred_window), false);
    } else {
      setConfirmingVisibility(true);
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
    const timeRange = isSubcontractor ? extractTimeRange(job.subcontractor_preferred_window) : null;
    const windowSuffix = timeRange
      ? ` (${timeRange})`
      : job.requested_time ? ` at ${formatTime(job.requested_time)}` : "";
    return (
      <div onClick={(e) => stopPropagation && e.stopPropagation()} className="flex w-full flex-wrap items-center gap-1.5 sm:w-auto sm:shrink-0">
        <span className="rounded bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700 sm:whitespace-nowrap">
          {job.requested_date
            ? `Requested for ${formatFullDate(job.requested_date)}${windowSuffix}`
            : "No requested time"}
        </span>
        <button
          type="button"
          title="Accept this request"
          aria-label="Accept this request"
          disabled={!job.requested_date}
          onClick={startAccepting}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-sm font-bold leading-none text-white disabled:opacity-50"
        >
          ✓
        </button>
        <button
          type="button"
          title={isSubcontractor ? "Set a different date/time by hand" : "Message the customer about this request"}
          aria-label={isSubcontractor ? "Set a different date/time by hand" : "Message the customer about this request"}
          onClick={() => (isSubcontractor ? onEditManually?.() : onOpenChat?.())}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-red-600 text-sm font-bold leading-none text-white"
        >
          ✕
        </button>
      </div>
    );
  }

  if (variant === "inline") {
    // A subcontracted job only ever carries a window range
    // (subcontractor_preferred_window), never a real appointment time, so
    // this is just accept/deny of that window — no bubble repeating the
    // date/time, since it's meant to sit right next to the "Preferred
    // window" field that already shows it.
    return (
      <span onClick={(e) => stopPropagation && e.stopPropagation()} className="inline-flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          title="Accept this window"
          aria-label="Accept this window"
          disabled={!job.requested_date || submitting}
          onClick={startAccepting}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-sm font-bold leading-none text-white disabled:opacity-50"
        >
          ✓
        </button>
        <button
          type="button"
          title="Deny — set a different date/time by hand"
          aria-label="Deny — set a different date/time by hand"
          onClick={() => onEditManually?.()}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-red-600 text-sm font-bold leading-none text-white"
        >
          ✕
        </button>
      </span>
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
          onClick={startAccepting}
          className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-bold text-white disabled:opacity-50"
        >
          Accept & Schedule
        </button>
      </div>
    </div>
  );
}
