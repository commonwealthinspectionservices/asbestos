"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { SavedAddress } from "@/lib/types";
import AddressAutocompleteInput from "@/components/shared/AddressAutocompleteInput";
import ZipInput, { useAutoZip } from "@/components/shared/ZipInput";
import { buildBillingAddress, parseAddressToFields, US_STATES } from "@/lib/address";
import { formatPhoneNumber } from "@/lib/phone";

interface ServiceTypeOption {
  key: string;
  label: string;
  rateLabel: string;
}

type Step = "address" | "category" | "service" | "scope" | "date" | "contact" | "review" | "done";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

// Mirrors ProjectsList.tsx's formatDate — MM/DD/YYYY instead of the raw
// YYYY-MM-DD the <input type="date"> stores.
function formatDate(isoDate: string): string {
  const [y, m, d] = isoDate.split("-");
  if (!y || !m || !d) return isoDate;
  return `${m}/${d}/${y}`;
}

// Mirrors ProjectsList.tsx's formatClockTime — "2:00 PM" instead of the
// raw 24-hour "14:00" the <input type="time"> stores.
function formatPreferredTime(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return hhmm;
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 || 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${period}`;
}

// Clarifies what's being sampled for the service types where it isn't
// obvious from the label alone. Keyed off service_type.key (see supabase
// settings.service_types) rather than the label text, so an admin
// relabeling a service type in Settings doesn't silently drop this note.
function serviceTypeSubtext(key: string): string | null {
  if (key === "asbestos_bulk") return "Sampling of specific area(s) as determined by the client";
  if (key === "mold_air") return "Sampling of indoor air quality";
  if (key === "mold_bulk") return "Sampling physical building materials";
  if (key === "mold_swab") return "Sampling of surfaces";
  return null;
}

// Groups the underlying per-sample-type service types (see
// supabase settings.service_types) into the 3 broad categories a client
// picks from first — the specific subtype (with its own pricing/duration)
// is still chosen one screen later. Keyed off the key prefix before "_" so
// a category with only one subtype today (lead) still works if a second
// lead service type is ever added. An unrecognized prefix falls back to
// its own single-item category rather than silently disappearing.
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

export default function PortalBookingForm({ isIndividual }: { isIndividual: boolean }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("address");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [savedAddresses, setSavedAddresses] = useState<SavedAddress[]>([]);
  const [saveNewAddress, setSaveNewAddress] = useState(true);
  // Same structured street/unit/town/state/zip fields as the admin's Add
  // Project form (see JobsDashboard.tsx) — kept separate from `address`
  // below, which is the server's own validated/formatted result once this
  // is checked, not what the user is actively typing.
  const [street, setStreet] = useState("");
  const [unit, setUnit] = useState("");
  const [city, setCity] = useState("");
  const [addrState, setAddrState] = useState("MA");
  const [zip, setZip] = useState("");
  // Distinguishes "just typed a new address" (offer to save it) from "just
  // picked an already-saved one" (already saved, don't re-save) — both
  // populate the same street/unit/city/addrState/zip fields above, so the
  // fields themselves can't tell the two cases apart.
  const [addressWasTyped, setAddressWasTyped] = useState(false);

  const [address, setAddress] = useState("");
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [distanceMiles, setDistanceMiles] = useState<number | null>(null);
  const [state, setState] = useState<string | null>(null);
  const [serviceTypes, setServiceTypes] = useState<ServiceTypeOption[]>([]);

  const [categoryKey, setCategoryKey] = useState("");
  const [serviceTypeKey, setServiceTypeKey] = useState("");
  const [scopeOfWork, setScopeOfWork] = useState("");

  const [date, setDate] = useState(todayIso());
  const [preferredTime, setPreferredTime] = useState("");
  const [suggestedDate, setSuggestedDate] = useState<string | null>(null);
  const [scheduleViaContact, setScheduleViaContact] = useState(false);

  const [siteContactName, setSiteContactName] = useState("");
  const [siteContactPhone, setSiteContactPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [confirmedDate, setConfirmedDate] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/portal/addresses")
      .then((r) => r.json())
      .then((data) => setSavedAddresses(data.addresses ?? []));
  }, []);

  useAutoZip(street, city, addrState, setZip, "/api/portal");

  async function checkAddress(candidateAddress: string) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step: "address", address: candidateAddress }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Something went wrong");
      if (!data.withinArea) {
        throw new Error("That address is outside our current service area.");
      }
      setAddress(data.formattedAddress);
      setLat(data.lat);
      setLng(data.lng);
      setDistanceMiles(data.distanceMiles);
      setState(data.state);
      setServiceTypes(data.serviceTypes);
      setCategoryKey("");
      setServiceTypeKey("");
      setStep("category");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  // A category with only one subtype (lead) skips straight past the subtype
  // list — nothing to pick there — while a category with several (asbestos,
  // mold) still needs its own screen for the pricing/duration differences.
  function pickCategory(pickedCategoryKey: string) {
    setCategoryKey(pickedCategoryKey);
    const matches = serviceTypes.filter((s) => categoryKeyOf(s.key) === pickedCategoryKey);
    if (matches.length === 1) {
      setServiceTypeKey(matches[0].key);
      setStep("scope");
    } else {
      setServiceTypeKey("");
      setStep("service");
    }
  }

  function pickSavedAddress(a: SavedAddress) {
    const fields = parseAddressToFields(a.address);
    setStreet(fields.street);
    setUnit(fields.unit);
    setCity(fields.city);
    setAddrState(fields.state || "MA");
    setZip(fields.zip);
    setAddressWasTyped(false);
    checkAddress(a.address);
  }

  async function checkDate(candidateDate: string) {
    setLoading(true);
    setError(null);
    setSuggestedDate(null);
    try {
      const res = await fetch("/api/book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step: "date", date: candidateDate }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Something went wrong");
      if (data.full) setSuggestedDate(data.nextAvailableDate);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  async function submitBooking() {
    setLoading(true);
    setError(null);
    try {
      if (saveNewAddress && addressWasTyped) {
        await fetch("/api/portal/addresses", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ address }),
        }).catch(() => {});
      }

      const res = await fetch("/api/portal/book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address, lat, lng, distanceMiles, state,
          serviceTypeKey,
          scopeOfWork,
          date: scheduleViaContact ? null : date,
          requestedTime: scheduleViaContact ? null : preferredTime || null,
          scheduleViaContact,
          siteContactName, siteContactPhone, notes, disclaimerAck: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Something went wrong");
      setConfirmedDate(data.date);
      setStep("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-md px-4 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-sm font-bold uppercase text-brand-700">Book a project</h1>
        <button
          onClick={() => router.push("/portal/dashboard")}
          aria-label="Cancel"
          className="text-slate-400 hover:text-slate-600"
        >
          ✕
        </button>
      </div>

      {error && <div className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {step === "address" && (
        <section className="mt-6 space-y-4">
          <div>
            <label className="block text-sm font-medium uppercase text-slate-700">Enter an address</label>
            <div className="mt-1 flex gap-1.5">
              <div className="w-0 flex-1">
                <AddressAutocompleteInput
                  apiBase="/api/portal"
                  value={street}
                  onChange={(v) => {
                    setStreet(v);
                    setAddressWasTyped(true);
                  }}
                  onSelectAddress={(fields) => {
                    setStreet(fields.street);
                    setUnit(fields.unit);
                    setCity(fields.city);
                    setAddrState(fields.state || "MA");
                    setZip(fields.zip);
                    setAddressWasTyped(true);
                  }}
                  placeholder="Street address"
                  townHint={city}
                />
              </div>
              <input
                className="w-20 shrink-0 rounded-lg border border-slate-300 px-2 py-2 text-sm"
                placeholder="Unit #"
                value={unit}
                onChange={(e) => {
                  setUnit(e.target.value);
                  setAddressWasTyped(true);
                }}
              />
            </div>
            <div className="mt-1.5 grid grid-cols-3 gap-1.5">
              <AddressAutocompleteInput
                apiBase="/api/portal"
                value={city}
                onChange={(v) => {
                  setCity(v);
                  setAddressWasTyped(true);
                  if (!v.trim()) setZip("");
                }}
                mode="city"
                onSelectAddress={(fields) => {
                  setCity(fields.city);
                  setAddrState("MA");
                  setZip(fields.zip);
                  setAddressWasTyped(true);
                }}
                placeholder="Town"
              />
              <select
                className="rounded-lg border border-slate-300 px-2 py-2 text-sm"
                value={addrState}
                onChange={(e) => {
                  setAddrState(e.target.value);
                  setAddressWasTyped(true);
                }}
              >
                {US_STATES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              <ZipInput street={street} city={city} state={addrState} zip={zip} setZip={setZip} apiBase="/api/portal" />
            </div>
            <label className="mt-2 flex items-center gap-2 text-sm text-slate-600">
              <input type="checkbox" checked={saveNewAddress} onChange={(e) => setSaveNewAddress(e.target.checked)} />
              Save this address
            </label>
          </div>

          {savedAddresses.length > 0 && (
            <div>
              <label className="block text-sm font-medium uppercase text-slate-700">Saved addresses</label>
              <div className="mt-2 space-y-2">
                {savedAddresses.map((a) => (
                  <button
                    key={a.id}
                    className="w-full rounded-lg border border-slate-300 px-4 py-3 text-left hover:border-brand-600"
                    onClick={() => pickSavedAddress(a)}
                  >
                    {a.label && <div className="font-medium">{a.label}</div>}
                    <div className="text-sm text-slate-500">{a.address}</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          <button
            className="flex w-full items-center justify-center border-[3px] border-brand-700 bg-brand-50 py-3 pt-[14px] text-sm font-extrabold uppercase leading-none text-brand-700 hover:bg-yellow-100 disabled:opacity-50"
            disabled={loading || !street.trim() || !city.trim() || !addrState.trim()}
            onClick={() => checkAddress(buildBillingAddress({ street, unit, city, state: addrState, zip }))}
          >
            {loading ? "Checking…" : "Continue"}
          </button>
        </section>
      )}

      {step === "category" && (
        <section className="mt-6 space-y-4">
          <button className="text-sm text-brand-600 underline" onClick={() => setStep("address")}>
            ← Back
          </button>
          <p className="text-sm text-slate-600">{address}</p>
          <div className="space-y-2">
            {Array.from(new Set(serviceTypes.map((s) => categoryKeyOf(s.key)))).map((c) => (
              <button
                key={c}
                className="w-full rounded-lg border border-slate-300 px-4 py-3 text-left font-medium hover:border-brand-600"
                onClick={() => pickCategory(c)}
              >
                {categoryLabelOf(c)}
              </button>
            ))}
          </div>
        </section>
      )}

      {step === "service" && (
        <section className="mt-6 space-y-4">
          <p className="text-sm text-slate-600">{address}</p>
          <button className="text-sm text-brand-600 underline" onClick={() => setStep("category")}>
            ← Back
          </button>
          <div className="space-y-2">
            {serviceTypes.filter((s) => categoryKeyOf(s.key) === categoryKey).map((s) => (
              <button
                key={s.key}
                className={`w-full rounded-lg border px-4 py-3 text-left ${
                  serviceTypeKey === s.key ? "border-brand-600 bg-brand-50" : "border-slate-300"
                }`}
                onClick={() => setServiceTypeKey(s.key)}
              >
                <div className="font-medium">{s.label}</div>
                {serviceTypeSubtext(s.key) && (
                  <div className="text-xs text-slate-400">{serviceTypeSubtext(s.key)}</div>
                )}
              </button>
            ))}
          </div>
          <button
            className="flex w-full items-center justify-center border-[3px] border-brand-700 bg-brand-50 py-3 pt-[14px] text-sm font-extrabold uppercase leading-none text-brand-700 hover:bg-yellow-100 disabled:opacity-50"
            disabled={!serviceTypeKey}
            onClick={() => setStep("scope")}
          >
            Continue
          </button>
        </section>
      )}

      {step === "scope" && (
        <section className="mt-6 space-y-4">
          <button
            className="text-sm text-brand-600 underline"
            onClick={() => {
              const matches = serviceTypes.filter((s) => categoryKeyOf(s.key) === categoryKey);
              setStep(matches.length > 1 ? "service" : "category");
            }}
          >
            ← Back
          </button>
          <div>
            <label className="block text-sm font-medium uppercase text-slate-700">Scope of work</label>
            <p className="mt-1 text-xs text-slate-500">
              What needs to be inspected or sampled? e.g. &ldquo;kitchen and bathroom flooring, basement pipe insulation&rdquo;
            </p>
            <textarea
              className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2"
              rows={4}
              placeholder="Describe the scope of work"
              value={scopeOfWork}
              onChange={(e) => setScopeOfWork(e.target.value)}
            />
          </div>
          <button
            className="flex w-full items-center justify-center border-[3px] border-brand-700 bg-brand-50 py-3 pt-[14px] text-sm font-extrabold uppercase leading-none text-brand-700 hover:bg-yellow-100 disabled:opacity-50"
            disabled={!scopeOfWork.trim()}
            onClick={() => setStep("date")}
          >
            Continue
          </button>
        </section>
      )}

      {step === "date" && (
        <section className="mt-6 space-y-4">
          <button className="text-sm text-brand-600 underline" onClick={() => setStep("scope")}>
            ← Back
          </button>
          {!isIndividual && (
            <label className="flex items-start gap-2 rounded-lg border border-slate-200 px-4 py-3 text-sm text-slate-700">
              <input
                type="checkbox"
                className="mt-1"
                checked={scheduleViaContact}
                onChange={(e) => {
                  setScheduleViaContact(e.target.checked);
                  setSuggestedDate(null);
                }}
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
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                  min={todayIso()}
                  value={date}
                  onChange={(e) => {
                    setDate(e.target.value);
                    checkDate(e.target.value);
                  }}
                />
              </div>
              {suggestedDate && (
                <div className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  {date} is fully booked. Next available date is{" "}
                  <button className="font-semibold underline" onClick={() => { setDate(suggestedDate); setSuggestedDate(null); }}>
                    {suggestedDate}
                  </button>.
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-slate-700">Preferred time</label>
                <input
                  type="time"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                  value={preferredTime}
                  onChange={(e) => setPreferredTime(e.target.value)}
                />
                <p className="mt-1 text-xs text-slate-500">Optional — leave blank if you don&apos;t have a preference.</p>
              </div>
              {isIndividual && (
                <div>
                  <label className="block text-sm font-medium text-slate-700">Notes</label>
                  <textarea
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                    placeholder="Gate code, anything else we should know (optional)"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                  />
                </div>
              )}
            </>
          )}
          <button
            className="flex w-full items-center justify-center border-[3px] border-brand-700 bg-brand-50 py-3 pt-[14px] text-sm font-extrabold uppercase leading-none text-brand-700 hover:bg-yellow-100 disabled:opacity-50"
            disabled={loading || (!scheduleViaContact && !!suggestedDate)}
            onClick={() => setStep(isIndividual ? "review" : "contact")}
          >
            Continue
          </button>
        </section>
      )}

      {step === "contact" && (
        <section className="mt-6 space-y-4">
          <button className="text-sm text-brand-600 underline" onClick={() => setStep("date")}>
            ← Back
          </button>
          <p className="text-sm font-medium text-slate-700">Job site contact</p>
          <input
            className="w-full rounded-lg border border-slate-300 px-3 py-2"
            placeholder="Site contact name"
            value={siteContactName}
            onChange={(e) => setSiteContactName(e.target.value)}
          />
          <input
            className="w-full rounded-lg border border-slate-300 px-3 py-2"
            placeholder="Site contact phone"
            type="tel"
            value={siteContactPhone}
            onChange={(e) => setSiteContactPhone(formatPhoneNumber(e.target.value))}
          />
          <textarea
            className="w-full rounded-lg border border-slate-300 px-3 py-2"
            placeholder="Notes — gate code, contact on site, etc. (optional)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
          <button
            className="flex w-full items-center justify-center border-[3px] border-brand-700 bg-brand-50 py-3 pt-[14px] text-sm font-extrabold uppercase leading-none text-brand-700 hover:bg-yellow-100 disabled:opacity-50"
            disabled={!siteContactName.trim() || !siteContactPhone.trim()}
            onClick={() => setStep("review")}
          >
            Continue
          </button>
        </section>
      )}

      {step === "review" && (
        <section className="mt-6 space-y-4">
          <button className="text-sm text-brand-600 underline" onClick={() => setStep(isIndividual ? "date" : "contact")}>
            ← Back
          </button>

          <div className="space-y-3 rounded-lg border border-slate-200 px-4 py-3 text-sm">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Address</div>
              <div className="text-slate-700">{address}</div>
            </div>
            {(() => {
              const selected = serviceTypes.find((s) => s.key === serviceTypeKey);
              return selected ? (
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Service</div>
                  <div className="text-slate-700">{selected.label}</div>
                  {serviceTypeSubtext(selected.key) && (
                    <div className="text-xs text-slate-500">{serviceTypeSubtext(selected.key)}</div>
                  )}
                  {/* Rate already reflects the zone pricing for the address picked earlier — see resolveZoneBaseFeeCents in /api/book. */}
                  <div className="text-slate-500">{selected.rateLabel}</div>
                </div>
              ) : null;
            })()}
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Scope of work</div>
              <div className="whitespace-pre-wrap text-slate-700">{scopeOfWork}</div>
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Preferred date</div>
              <div className="text-slate-700">
                {scheduleViaContact ? "To be scheduled with the job site contact" : formatDate(date)}
              </div>
            </div>
            {!scheduleViaContact && preferredTime && (
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Preferred time</div>
                <div className="text-slate-700">{formatPreferredTime(preferredTime)}</div>
              </div>
            )}
            {(siteContactName || siteContactPhone) && (
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Job site contact</div>
                <div className="text-slate-700">{[siteContactName, siteContactPhone].filter(Boolean).join(" — ")}</div>
              </div>
            )}
            {notes && (
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Notes</div>
                <div className="text-slate-700">{notes}</div>
              </div>
            )}
          </div>

          <button
            className="flex w-full items-center justify-center border-[3px] border-brand-700 bg-brand-50 py-3 pt-[14px] text-sm font-extrabold uppercase leading-none text-brand-700 hover:bg-yellow-100 disabled:opacity-50"
            disabled={loading}
            onClick={submitBooking}
          >
            {loading ? "Booking…" : "Confirm booking"}
          </button>
        </section>
      )}

      {step === "done" && (
        <section className="mt-6 space-y-3">
          <div className="rounded-lg bg-emerald-50 px-4 py-4 text-sm text-emerald-800">
            <p className="font-medium">
              {confirmedDate ? `Request sent for ${confirmedDate}.` : "Request sent — we'll coordinate scheduling directly with your job site contact."}
            </p>
            <p className="mt-1">We'll follow up to confirm your date and time.</p>
          </div>
          <button className="text-sm text-brand-600 underline" onClick={() => router.push("/portal/dashboard")}>
            Back to my projects
          </button>
        </section>
      )}
    </div>
  );
}
