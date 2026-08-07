"use client";

import { useEffect, useState } from "react";
import type { Job } from "@/lib/types";
import AddressAutocompleteInput from "@/components/shared/AddressAutocompleteInput";
import ZipInput, { useAutoZip } from "@/components/shared/ZipInput";
import { buildBillingAddress, parseAddressToFields, US_STATES } from "@/lib/address";
import { formatPhoneNumber } from "@/lib/phone";

interface ServiceTypeOption {
  key: string;
  label: string;
  rateLabel: string;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

// Mirrors PortalBookingForm.tsx's own copy of these — 30-min slots,
// 1-hour same-day notice, asbestos-subtype exclusivity. Kept as a separate
// copy rather than shared, matching this codebase's existing precedent
// (PricingCalculator.tsx/AcceptScheduleControl.tsx each keep their own
// small formatter copies too).
const TIME_OPTIONS: string[] = [];
for (let totalMinutes = 5 * 60; totalMinutes <= 19 * 60 + 30; totalMinutes += 30) {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  TIME_OPTIONS.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
}

function availableTimeOptions(selectedDate: string): string[] {
  if (selectedDate !== todayIso()) return TIME_OPTIONS;
  const now = new Date();
  const earliestMinutes = now.getHours() * 60 + now.getMinutes() + 60;
  return TIME_OPTIONS.filter((t) => {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + m >= earliestMinutes;
  });
}

function formatPreferredTime(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return hhmm;
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 || 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${period}`;
}

function serviceTypeSubtext(key: string): string | null {
  if (key === "asbestos_bulk") return "Sampling of specific area(s) as determined by the client";
  if (key === "asbestos_pre_reno") return "Sampling of materials prior to a renovation project";
  if (key === "asbestos_pre_demo") return "Sampling of materials prior to a demolition project";
  if (key === "mold_air") return "Sampling of indoor air quality";
  if (key === "mold_bulk") return "Sampling of specific materials";
  if (key === "mold_swab") return "Sampling of surfaces";
  return null;
}

const CATEGORY_LABELS: Record<string, string> = {
  asbestos: "Asbestos Inspection",
  mold: "Mold Inspection",
  lead: "Lead Paint Sampling",
};

function categoryKeyOf(serviceTypeKey: string): string {
  return serviceTypeKey.split("_")[0];
}

function categoryLabelOf(categoryKeyValue: string): string {
  return CATEGORY_LABELS[categoryKeyValue] ?? categoryKeyValue;
}

const ASBESTOS_EXCLUSIVE_KEYS = ["asbestos_bulk", "asbestos_pre_reno", "asbestos_pre_demo"];

// Everything about a still-pending request (job.status === "needs_scheduling")
// is editable here — address, service type(s), scope, requested date/time
// (or coordinate-via-contact), notes, site contact — locking the moment the
// owner accepts it (ProjectDetailModal only renders this while pending; see
// its own status check). Saves via PATCH /api/portal/projects/[id]'s
// `request` block, which re-validates and re-prices server-side exactly
// like the original booking did.
export default function PendingRequestEditor({
  job, isIndividual, onSaved,
}: {
  job: Job;
  isIndividual: boolean;
  onSaved: () => void;
}) {
  const [street, setStreet] = useState("");
  const [unit, setUnit] = useState("");
  const [city, setCity] = useState("");
  const [addrState, setAddrState] = useState("MA");
  const [zip, setZip] = useState("");

  const [address, setAddress] = useState(job.service_address ?? "");
  const [lat, setLat] = useState<number | null>(job.lat);
  const [lng, setLng] = useState<number | null>(job.lng);
  const [distanceMiles, setDistanceMiles] = useState<number | null>(job.distance_miles);
  const [state, setState] = useState<string | null>(null);
  const [serviceTypes, setServiceTypes] = useState<ServiceTypeOption[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());

  const [scopeOfWork, setScopeOfWork] = useState(job.scope_of_work ?? "");
  const [date, setDate] = useState(job.requested_date ?? todayIso());
  const [preferredTime, setPreferredTime] = useState(job.requested_time ?? "");
  const [suggestedDate, setSuggestedDate] = useState<string | null>(null);
  const [scheduleViaContact, setScheduleViaContact] = useState(job.requested_date == null);
  const [siteContactName, setSiteContactName] = useState(job.site_contact_name ?? "");
  const [siteContactPhone, setSiteContactPhone] = useState(job.site_contact_phone ?? "");
  const [notes, setNotes] = useState(job.notes ?? "");

  const [loadingTypes, setLoadingTypes] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Editing doesn't save as you go — it's a deliberate resubmission, so
  // "Resubmit request" opens a confirm step instead of saving immediately.
  // Closing the modal without confirming discards the in-progress edits.
  const [confirmingResubmit, setConfirmingResubmit] = useState(false);

  // Seeded once per job, keyed on job.id only — NOT on the whole `job`
  // object, which gets a new identity on every unrelated save in this same
  // modal (e.g. JobRecipients saving independently triggers onChanged ->
  // a full project refetch). Keying on `job` would silently wipe an
  // in-progress edit here whenever that happens.
  useEffect(() => {
    const fields = parseAddressToFields(job.service_address ?? "");
    setStreet(fields.street);
    setUnit(fields.unit);
    setCity(fields.city);
    setAddrState(fields.state || "MA");
    setZip(fields.zip);
    setAddress(job.service_address ?? "");
    setLat(job.lat);
    setLng(job.lng);
    setDistanceMiles(job.distance_miles);
    setScopeOfWork(job.scope_of_work ?? "");
    setDate(job.requested_date ?? todayIso());
    setPreferredTime(job.requested_time ?? "");
    setScheduleViaContact(job.requested_date == null);
    setSiteContactName(job.site_contact_name ?? "");
    setSiteContactPhone(job.site_contact_phone ?? "");
    setNotes(job.notes ?? "");
    setSaved(false);
    setConfirmingResubmit(false);
    setError(null);

    if (!job.service_address) return;
    setLoadingTypes(true);
    fetch("/api/book", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ step: "address", address: job.service_address }),
    })
      .then((r) => r.json())
      .then((data) => {
        const types: ServiceTypeOption[] = data.serviceTypes ?? [];
        setServiceTypes(types);
        setState(data.state ?? null);
        // job.service_type is a comma-joined label string built at save
        // time — match it back to keys, same precedent as EditProjectDialog
        // (JobsDashboard.tsx) uses on the admin side.
        const parts = (job.service_type ?? "").split(",").map((p) => p.trim()).filter(Boolean);
        const matchedKeys = types.filter((t) => parts.includes(t.label)).map((t) => t.key);
        setSelectedKeys(new Set(matchedKeys));
      })
      .finally(() => setLoadingTypes(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.id]);

  useEffect(() => {
    if (preferredTime && !availableTimeOptions(date).includes(preferredTime)) {
      setPreferredTime("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, preferredTime]);

  useAutoZip(street, city, addrState, setZip, "/api/portal");

  function toggleServiceType(key: string) {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        if (ASBESTOS_EXCLUSIVE_KEYS.includes(key)) {
          for (const exclusiveKey of ASBESTOS_EXCLUSIVE_KEYS) {
            if (exclusiveKey !== key) next.delete(exclusiveKey);
          }
        }
        next.add(key);
      }
      return next;
    });
  }

  // User-initiated address change — unlike the mount-time fetch above, this
  // clears the current selection (a different address can offer different
  // pricing/zone types), same as PortalBookingForm.tsx's own checkAddress().
  async function updateAddress() {
    setLoadingTypes(true);
    setError(null);
    try {
      const res = await fetch("/api/book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step: "address", address: buildBillingAddress({ street, unit, city, state: addrState, zip }) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Something went wrong");
      if (!data.withinArea) throw new Error("That address is outside our current service area.");
      setAddress(data.formattedAddress);
      setLat(data.lat);
      setLng(data.lng);
      setDistanceMiles(data.distanceMiles);
      setState(data.state);
      setServiceTypes(data.serviceTypes);
      setSelectedKeys(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoadingTypes(false);
    }
  }

  async function checkDate(candidateDate: string) {
    setSuggestedDate(null);
    try {
      const res = await fetch("/api/book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step: "date", date: candidateDate }),
      });
      const data = await res.json();
      if (res.ok && data.full) setSuggestedDate(data.nextAvailableDate);
    } catch {
      // Best-effort nudge only — not required for the date itself to save.
    }
  }

  async function resubmit() {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const res = await fetch(`/api/portal/projects/${job.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          request: {
            address, lat, lng, distanceMiles, state,
            serviceTypeKeys: Array.from(selectedKeys),
            scopeOfWork,
            date: scheduleViaContact ? null : date,
            requestedTime: scheduleViaContact ? null : preferredTime || null,
            scheduleViaContact,
            siteContactName, siteContactPhone, notes,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Something went wrong");
      setSaved(true);
      setConfirmingResubmit(false);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4 rounded-lg border border-amber-200 bg-amber-50 p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">
        Pending approval — editable until accepted
      </p>
      {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      <div>
        <label className="block text-sm font-medium text-slate-700">Job site address</label>
        <div className="mt-1 flex gap-1.5">
          <div className="w-0 flex-1">
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
            className="w-20 shrink-0 rounded-lg border border-slate-300 px-2 py-2 text-sm"
            placeholder="Unit #"
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
          />
        </div>
        <div className="mt-1.5 grid grid-cols-3 gap-1.5">
          <AddressAutocompleteInput
            apiBase="/api/portal"
            value={city}
            onChange={(v) => { setCity(v); if (!v.trim()) setZip(""); }}
            mode="city"
            onSelectAddress={(fields) => { setCity(fields.city); setAddrState("MA"); setZip(fields.zip); }}
            placeholder="Town"
          />
          <select
            className="rounded-lg border border-slate-300 px-2 py-2 text-sm"
            value={addrState}
            onChange={(e) => setAddrState(e.target.value)}
          >
            {US_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <ZipInput street={street} city={city} state={addrState} zip={zip} setZip={setZip} apiBase="/api/portal" />
        </div>
        <button
          type="button"
          disabled={loadingTypes}
          className="mt-1.5 text-xs text-brand-600 underline disabled:opacity-50"
          onClick={updateAddress}
        >
          {loadingTypes ? "Checking…" : "Update address"}
        </button>
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700">Service types</label>
        <div className="mt-2 space-y-3">
          {Array.from(new Set(serviceTypes.map((s) => categoryKeyOf(s.key)))).map((c) => {
            const subtypes = serviceTypes.filter((s) => categoryKeyOf(s.key) === c);
            return (
              <div key={c}>
                <div className="text-sm font-medium text-slate-700">{categoryLabelOf(c)}</div>
                <div className="mt-1 space-y-1.5">
                  {subtypes.map((s) => (
                    <label
                      key={s.key}
                      className={`flex w-full cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-sm ${
                        selectedKeys.has(s.key) ? "border-brand-600 bg-brand-50" : "border-slate-300"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selectedKeys.has(s.key)}
                        onChange={() => toggleServiceType(s.key)}
                        className="mt-0.5 shrink-0 accent-brand-700"
                      />
                      <span>
                        <span className="block">{s.label}</span>
                        {serviceTypeSubtext(s.key) && (
                          <span className="block text-xs text-slate-500">{serviceTypeSubtext(s.key)}</span>
                        )}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700">Scope of work</label>
        <textarea
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          rows={3}
          value={scopeOfWork}
          onChange={(e) => setScopeOfWork(e.target.value)}
        />
      </div>

      {!isIndividual && (
        <label className="flex items-start gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
          <input
            type="checkbox"
            className="mt-1"
            checked={scheduleViaContact}
            onChange={(e) => { setScheduleViaContact(e.target.checked); setSuggestedDate(null); }}
          />
          Coordinate date and time with job site contact.
        </label>
      )}
      {!scheduleViaContact && (
        <>
          <div>
            <label className="block text-sm font-medium text-slate-700">Preferred date</label>
            <input
              type="date"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              min={todayIso()}
              value={date}
              onChange={(e) => { setDate(e.target.value); checkDate(e.target.value); }}
            />
          </div>
          {suggestedDate && (
            <div className="rounded-lg bg-amber-100 px-3 py-2 text-sm text-amber-800">
              {date} is fully booked. Next available date is{" "}
              <button type="button" className="font-semibold underline" onClick={() => { setDate(suggestedDate); setSuggestedDate(null); }}>
                {suggestedDate}
              </button>.
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-slate-700">Preferred time</label>
            <select
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={preferredTime}
              onChange={(e) => setPreferredTime(e.target.value)}
            >
              <option value="">No preference</option>
              {availableTimeOptions(date).map((t) => <option key={t} value={t}>{formatPreferredTime(t)}</option>)}
            </select>
          </div>
        </>
      )}

      {!isIndividual && (
        <div>
          <label className="block text-sm font-medium text-slate-700">Job site contact</label>
          <input
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            placeholder="Site contact name"
            value={siteContactName}
            onChange={(e) => setSiteContactName(e.target.value)}
          />
          <input
            className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            placeholder="Site contact phone"
            type="tel"
            value={siteContactPhone}
            onChange={(e) => setSiteContactPhone(formatPhoneNumber(e.target.value))}
          />
        </div>
      )}

      <div>
        <label className="block text-sm font-medium text-slate-700">Notes</label>
        <textarea
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          rows={2}
          placeholder="Gate code, anything else we should know (optional)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>

      {confirmingResubmit ? (
        <div className="rounded-lg border border-brand-200 bg-white p-3">
          <p className="text-sm font-medium text-slate-700">Resubmit this request with your changes?</p>
          <p className="mt-1 text-xs text-slate-500">We'll review the updated request the same way as your original one.</p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              disabled={saving}
              className="flex-1 rounded-lg bg-brand-700 py-2 text-sm font-bold uppercase text-white disabled:opacity-50"
              onClick={resubmit}
            >
              {saving ? "Resubmitting…" : "Yes, resubmit"}
            </button>
            <button
              type="button"
              disabled={saving}
              className="flex-1 rounded-lg border border-slate-300 py-2 text-sm font-bold uppercase text-slate-600 disabled:opacity-50"
              onClick={() => setConfirmingResubmit(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          disabled={selectedKeys.size === 0 || !address}
          className="flex w-full items-center justify-center border-[3px] border-brand-700 bg-brand-50 py-2.5 text-sm font-extrabold uppercase leading-none text-brand-700 hover:bg-yellow-100 disabled:opacity-50"
          onClick={() => setConfirmingResubmit(true)}
        >
          {saved ? "Saved — resubmit again?" : "Resubmit request"}
        </button>
      )}
    </div>
  );
}
