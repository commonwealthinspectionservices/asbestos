"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import AddressAutocompleteInput from "@/components/shared/AddressAutocompleteInput";
import ZipInput, { useAutoZip } from "@/components/shared/ZipInput";
import { buildBillingAddress, US_STATES } from "@/lib/address";
import { formatPhoneNumber } from "@/lib/phone";
import { formatDateMDY } from "@/lib/date-format";
import { TIME_OPTIONS } from "@/lib/time-options";
import { formatCents } from "@/lib/pricing";

interface ServiceTypeOption {
  key: string;
  label: string;
  rateLabel: string;
  base_fee_cents: number;
}

// Per Tim, 2026-09-12 — company/portal bookings had no way to request Rush
// at all, unlike GuestBookingForm.tsx's individuals-only flow (which has
// carried this since 2026-09-02). Same flat-rate-replaces-per-sample rule,
// copied rather than shared — this codebase's existing precedent for these
// small per-form copies (see PendingRequestEditor.tsx's own comment).
// Lead and mold swab have no rush rate; their price line doesn't change.
const RUSH_SAMPLE_CENTS: Record<string, number> = {
  asbestos_bulk: 5000,
  asbestos_pre_reno: 5000,
  asbestos_pre_demo: 5000,
  mold_bulk: 5000,
  mold_air: 10000,
};
function displayRateLabel(s: ServiceTypeOption, rush: boolean): string {
  const rushCents = rush ? RUSH_SAMPLE_CENTS[s.key] : undefined;
  if (rushCents != null) {
    return `${formatCents(s.base_fee_cents)} base + ${formatCents(rushCents)}/sample (Rush)`;
  }
  return s.rateLabel;
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatPreferredTime(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return hhmm;
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 || 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${period}`;
}

// Same display-only overrides as PortalBookingForm.tsx — kept in sync by
// hand since the two forms don't share a services step to factor this into.
function serviceTypeDisplayLabel(key: string, fallbackLabel: string): string {
  if (key === "mold_bulk") return "Mold Surface Sampling";
  if (key === "lead_bulk") return "Lead Paint Sampling";
  return fallbackLabel;
}

/**
 * Single-page company booking form — per Tim, 2026-09-10: "for dave at FLI
 * he needs to fill out a form not go window to window, the form should be
 * like my add project form, make that the standard for companys and then
 * the current set up as standard for individuals." Styled after the
 * admin's AddProjectDialog (JobsDashboard.tsx) rather than
 * PortalBookingForm.tsx's step wizard, which remains individuals-only.
 *
 * No Company/Individual toggle here — unlike the admin dialog (which
 * creates jobs for either kind of customer), this form only ever runs for
 * an already-authenticated company account, so which company it is (and
 * whether it's FLI specifically) comes from the session, never a choice
 * made on the form itself.
 */
export default function CompanyBookingForm({ isFliEnvironmental }: { isFliEnvironmental: boolean }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ date: string | null } | null>(null);

  const [street, setStreet] = useState("");
  const [unit, setUnit] = useState("");
  const [city, setCity] = useState("");
  const [addrState, setAddrState] = useState("MA");
  const [zip, setZip] = useState("");

  // Populated by the background address check below once street/city/state
  // are all filled in — this form has no separate "check address" step the
  // way PortalBookingForm.tsx does, so the same /api/book lookup that
  // powers that step instead runs silently as the address fields settle.
  const [checkedAddress, setCheckedAddress] = useState<string | null>(null);
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [distanceMiles, setDistanceMiles] = useState<number | null>(null);
  const [addrValidState, setAddrValidState] = useState<string | null>(null);
  const [serviceTypes, setServiceTypes] = useState<ServiceTypeOption[]>([]);
  const [addressError, setAddressError] = useState<string | null>(null);
  const lastCheckedRef = useRef<string | null>(null);

  const [fliProjectNumber, setFliProjectNumber] = useState("");
  const [endClientCompany, setEndClientCompany] = useState("");
  const [endClientStreet, setEndClientStreet] = useState("");
  const [endClientUnit, setEndClientUnit] = useState("");
  const [endClientCity, setEndClientCity] = useState("");
  const [endClientState, setEndClientState] = useState("MA");
  const [endClientZip, setEndClientZip] = useState("");
  const [endClientContactFirstName, setEndClientContactFirstName] = useState("");
  const [endClientContactLastName, setEndClientContactLastName] = useState("");
  const [endClientContactPhone, setEndClientContactPhone] = useState("");
  const [endClientContactEmail, setEndClientContactEmail] = useState("");

  const [siteContactName, setSiteContactName] = useState("");
  const [siteContactPhone, setSiteContactPhone] = useState("");

  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [rush, setRush] = useState(false);
  const [scopeOfWork, setScopeOfWork] = useState("");
  const [notes, setNotes] = useState("");

  const [scheduleViaContact, setScheduleViaContact] = useState(false);
  const [date, setDate] = useState(todayIso());
  const dateInputRef = useRef<HTMLInputElement>(null);
  const [preferredTime, setPreferredTime] = useState("");

  useAutoZip(street, city, addrState, setZip, "/api/portal");
  useAutoZip(endClientStreet, endClientCity, endClientState, setEndClientZip, "/api/portal");

  function toggleServiceType(key: string) {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // Debounced background address check — same /api/book lookup
  // PortalBookingForm.tsx's "address" step calls explicitly, just fired
  // automatically here once there's a plausibly-complete address, so the
  // form never needs its own visible "check address" step.
  useEffect(() => {
    const built = buildBillingAddress({ street, unit, city, state: addrState, zip });
    if (!street.trim() || !city.trim() || !addrState.trim()) {
      setCheckedAddress(null);
      setServiceTypes([]);
      return;
    }
    if (built === lastCheckedRef.current) return;
    const timer = setTimeout(async () => {
      lastCheckedRef.current = built;
      setLoading(true);
      setAddressError(null);
      try {
        const res = await fetch("/api/book", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ step: "address", address: built }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Something went wrong");
        if (!data.withinArea) throw new Error("That address is outside our current service area.");
        setCheckedAddress(data.formattedAddress);
        setLat(data.lat);
        setLng(data.lng);
        setDistanceMiles(data.distanceMiles);
        setAddrValidState(data.state);
        setServiceTypes(data.serviceTypes);
      } catch (e) {
        setCheckedAddress(null);
        setServiceTypes([]);
        setAddressError(e instanceof Error ? e.message : "Something went wrong");
      } finally {
        setLoading(false);
      }
    }, 600);
    return () => clearTimeout(timer);
  }, [street, unit, city, addrState, zip]);

  const canSubmit =
    !!checkedAddress &&
    selectedKeys.size > 0 &&
    scopeOfWork.trim() &&
    siteContactName.trim() &&
    siteContactPhone.trim() &&
    (scheduleViaContact || date);

  async function submit() {
    if (!checkedAddress) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/portal/book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address: checkedAddress, lat, lng, distanceMiles, state: addrValidState,
          serviceTypeKeys: Array.from(selectedKeys),
          rush,
          scopeOfWork,
          date: scheduleViaContact ? null : date,
          requestedTime: scheduleViaContact ? null : preferredTime || null,
          scheduleViaContact,
          siteContactName, siteContactPhone, notes, disclaimerAck: true,
          fliProjectNumber: isFliEnvironmental ? fliProjectNumber.trim() || undefined : undefined,
          subcontractorClientCompany: isFliEnvironmental ? endClientCompany.trim() || undefined : undefined,
          subcontractorClientAddress: isFliEnvironmental
            ? buildBillingAddress({ street: endClientStreet, unit: endClientUnit, city: endClientCity, state: endClientState, zip: endClientZip }) || undefined
            : undefined,
          subcontractorClientContactName: isFliEnvironmental
            ? [endClientContactFirstName.trim(), endClientContactLastName.trim()].filter(Boolean).join(" ") || undefined
            : undefined,
          subcontractorClientContactPhone: isFliEnvironmental ? endClientContactPhone.trim() || undefined : undefined,
          subcontractorClientContactEmail: isFliEnvironmental ? endClientContactEmail.trim() || undefined : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Something went wrong");
      setDone({ date: data.date });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="mx-auto max-w-lg px-4 py-8">
        <div className="rounded-lg bg-emerald-50 px-4 py-4 text-sm text-emerald-800">
          <p className="font-medium">
            {done.date ? `Your request has been sent for ${formatDateMDY(done.date)}.` : "Request sent — we'll coordinate scheduling directly with your job site contact."}
          </p>
          <p className="mt-1">We'll confirm that date and time.</p>
        </div>
        <button className="mt-3 text-sm text-brand-600 underline" onClick={() => router.push("/portal/dashboard")}>
          Back to my projects
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-base font-bold uppercase text-brand-700">Book a project</h1>
        <button
          onClick={() => router.push("/portal/dashboard")}
          aria-label="Cancel"
          className="text-slate-400 hover:text-slate-600"
        >
          ✕
        </button>
      </div>

      {error && <div className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      <label className="mt-5 block text-sm font-medium text-slate-700">Job site address</label>
      <div className="mt-1 flex flex-col gap-1.5 sm:flex-row">
        <div className="min-w-0 sm:w-0 sm:flex-1">
          <AddressAutocompleteInput
            apiBase="/api/portal"
            value={street}
            onChange={setStreet}
            onSelectAddress={(fields) => {
              setStreet(fields.street);
              setUnit(fields.unit);
              setCity(fields.city);
              setAddrState(fields.state || "MA");
              setZip(fields.zip);
            }}
            placeholder="Street address"
            townHint={city}
          />
        </div>
        <input
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm sm:w-28 sm:shrink-0"
          placeholder="Unit #"
          value={unit}
          onChange={(e) => setUnit(e.target.value)}
        />
      </div>
      <div className="mt-1.5 grid grid-cols-1 gap-1.5 sm:grid-cols-3">
        <AddressAutocompleteInput
          apiBase="/api/portal"
          value={city}
          onChange={(v) => {
            setCity(v);
            if (!v.trim()) setZip("");
          }}
          mode="city"
          onSelectAddress={(fields) => {
            setCity(fields.city);
            setAddrState("MA");
            setZip(fields.zip);
          }}
          placeholder="Town"
        />
        <select
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          value={addrState}
          onChange={(e) => setAddrState(e.target.value)}
        >
          {US_STATES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <ZipInput street={street} city={city} state={addrState} zip={zip} setZip={setZip} apiBase="/api/portal" />
      </div>
      {addressError && <p className="mt-1 text-xs text-red-600">{addressError}</p>}
      {loading && !checkedAddress && <p className="mt-1 text-xs text-slate-400">Checking address…</p>}

      {isFliEnvironmental && (
        <>
          <label className="mt-4 block text-sm font-medium text-slate-700">FLI Project #</label>
          <input
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            value={fliProjectNumber}
            onChange={(e) => setFliProjectNumber(e.target.value)}
            placeholder="e.g. 26-3115"
          />

          <label className="mt-4 block text-sm font-medium text-slate-700">FLI&apos;s client</label>
          <input
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            value={endClientCompany}
            onChange={(e) => setEndClientCompany(e.target.value)}
            placeholder="Company name"
          />
          <div className="mt-1.5 flex flex-col gap-1.5 sm:flex-row">
            <div className="min-w-0 sm:w-0 sm:flex-1">
              <AddressAutocompleteInput
                apiBase="/api/portal"
                value={endClientStreet}
                onChange={setEndClientStreet}
                onSelectAddress={(fields) => {
                  setEndClientStreet(fields.street);
                  setEndClientUnit(fields.unit);
                  setEndClientCity(fields.city);
                  setEndClientState(fields.state || "MA");
                  setEndClientZip(fields.zip);
                }}
                placeholder="Billing street address"
                townHint={endClientCity}
              />
            </div>
            <input
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm sm:w-28 sm:shrink-0"
              placeholder="Unit #"
              value={endClientUnit}
              onChange={(e) => setEndClientUnit(e.target.value)}
            />
          </div>
          <div className="mt-1.5 grid grid-cols-1 gap-1.5 sm:grid-cols-3">
            <AddressAutocompleteInput
              apiBase="/api/portal"
              value={endClientCity}
              onChange={(v) => {
                setEndClientCity(v);
                if (!v.trim()) setEndClientZip("");
              }}
              mode="city"
              onSelectAddress={(fields) => {
                setEndClientCity(fields.city);
                setEndClientState(fields.state || "MA");
                setEndClientZip(fields.zip);
              }}
              placeholder="Town"
            />
            <input
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="State"
              value={endClientState}
              onChange={(e) => setEndClientState(e.target.value)}
            />
            <ZipInput street={endClientStreet} city={endClientCity} state={endClientState} zip={endClientZip} setZip={setEndClientZip} apiBase="/api/portal" />
          </div>
          <div className="mt-1.5 flex flex-col gap-2 sm:flex-row">
            <input
              className="min-w-0 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm sm:flex-1"
              value={endClientContactFirstName}
              onChange={(e) => setEndClientContactFirstName(e.target.value)}
              placeholder="Contact first name"
            />
            <input
              className="min-w-0 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm sm:flex-1"
              value={endClientContactLastName}
              onChange={(e) => setEndClientContactLastName(e.target.value)}
              placeholder="Contact last name"
            />
          </div>
          <div className="mt-1.5 flex flex-col gap-2 sm:flex-row">
            <input
              className="min-w-0 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm sm:flex-1"
              placeholder="Contact's phone"
              value={endClientContactPhone}
              onChange={(e) => setEndClientContactPhone(formatPhoneNumber(e.target.value))}
            />
            <input
              className="min-w-0 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm sm:flex-1"
              value={endClientContactEmail}
              onChange={(e) => setEndClientContactEmail(e.target.value)}
              placeholder="Contact's email"
            />
          </div>
        </>
      )}

      <label className="mt-4 block text-sm font-medium text-slate-700">Job site contact</label>
      <div className="mt-1 flex flex-col gap-2 sm:flex-row">
        <input
          className="min-w-0 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm sm:flex-1"
          value={siteContactName}
          onChange={(e) => setSiteContactName(e.target.value)}
          placeholder="Name"
        />
        <input
          className="min-w-0 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm sm:flex-1"
          placeholder="Phone"
          value={siteContactPhone}
          onChange={(e) => setSiteContactPhone(formatPhoneNumber(e.target.value))}
        />
      </div>

      <div className="mt-4 flex items-end justify-between gap-2">
        <label className="block text-sm font-medium text-slate-700">Service type</label>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className="text-xs font-bold text-slate-700">Turnaround Time</span>
          <div className="flex items-center gap-1.5 text-xs font-bold uppercase">
            <button
              type="button"
              onClick={() => setRush(false)}
              className={`rounded px-2 py-1 ${!rush ? "bg-slate-700 text-white" : "bg-slate-100 text-slate-600"}`}
            >
              Standard
            </button>
            <button
              type="button"
              onClick={() => setRush(true)}
              className={`rounded px-2 py-1 text-slate-600 ${rush ? "bg-yellow-100" : "bg-slate-100"}`}
            >
              Rush
            </button>
          </div>
        </div>
      </div>
      <div className="mt-1 space-y-1.5">
        {serviceTypes.length === 0 ? (
          <p className="text-xs text-slate-400">Enter a complete job site address above to see available services.</p>
        ) : (
          serviceTypes
            .filter((s) => s.key !== "mold_swab")
            .map((s) => (
              <label key={s.key} className="flex items-center justify-between gap-1.5 text-sm text-slate-700">
                <span className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={selectedKeys.has(s.key)}
                    onChange={() => toggleServiceType(s.key)}
                  />
                  {serviceTypeDisplayLabel(s.key, s.label)}
                </span>
                <span className="text-xs text-slate-400">{displayRateLabel(s, rush)}</span>
              </label>
            ))
        )}
      </div>

      <label className="mt-4 block text-sm font-medium text-slate-700">Scope of Work</label>
      <textarea
        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        rows={4}
        value={scopeOfWork}
        onChange={(e) => setScopeOfWork(e.target.value)}
      />

      <label className="mt-4 flex items-start gap-2 rounded-lg border border-slate-200 px-4 py-3 text-sm text-slate-700">
        <input
          type="checkbox"
          className="mt-1"
          checked={scheduleViaContact}
          onChange={(e) => setScheduleViaContact(e.target.checked)}
        />
        Coordinate date and time with job site contact.
      </label>

      {!scheduleViaContact && (
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <div className="sm:flex-1">
            <label className="block text-sm font-medium text-slate-700">Preferred date</label>
            {/* Same fake-div/opacity-0 fix as the admin's Add Project form
                (JobsDashboard.tsx) — a plain input[type=date] renders
                visibly shorter than a paired <select> in Safari. */}
            <div
              className="relative mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white"
              onClick={() => dateInputRef.current?.showPicker?.()}
            >
              <div className="flex h-full items-center px-3 text-sm text-slate-800">
                {date ? formatDateMDY(date) : <span className="text-slate-400">Date</span>}
              </div>
              <input
                ref={dateInputRef}
                type="date"
                min={todayIso()}
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="absolute inset-0 h-full w-full opacity-0"
              />
            </div>
          </div>
          <div className="sm:flex-1">
            <label className="block text-sm font-medium text-slate-700">Preferred time</label>
            <select
              className="mt-1 h-10 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={preferredTime}
              onChange={(e) => setPreferredTime(e.target.value)}
            >
              <option value="">No preference</option>
              {TIME_OPTIONS.map((t) => (
                <option key={t} value={t}>{formatPreferredTime(t)}</option>
              ))}
            </select>
          </div>
        </div>
      )}

      <label className="mt-4 block text-sm font-medium text-slate-700">Notes</label>
      <textarea
        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        rows={3}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
      />

      <button
        className="mt-5 flex w-full items-center justify-center border-[3px] border-brand-700 bg-brand-50 py-3 pt-[14px] text-sm font-extrabold uppercase leading-none text-brand-700 hover:bg-yellow-100 disabled:opacity-50"
        disabled={!canSubmit || submitting}
        onClick={submit}
      >
        {submitting ? "Submitting…" : "Confirm booking"}
      </button>
    </div>
  );
}
