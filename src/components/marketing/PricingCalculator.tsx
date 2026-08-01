"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import AddressAutocompleteInput from "@/components/shared/AddressAutocompleteInput";
import ZipInput, { useAutoZip } from "@/components/shared/ZipInput";
import { buildBillingAddress, US_STATES } from "@/lib/address";
import { formatCents, computeInvoiceTotalCents } from "@/lib/pricing";
import type { ServiceType } from "@/lib/types";

type ServiceTypeQuote = ServiceType & { rateLabel: string };

// The calculator shows one simplified "Asbestos Inspection" option instead
// of separately listing Limited and Pre-Renovation asbestos inspections —
// they're priced identically, and the distinction isn't meaningful for a
// quick estimate. Pre-Demolition stays separate since it's still its own
// listed option.
function mergeAsbestosTypes(types: ServiceTypeQuote[]): ServiceTypeQuote[] {
  return types
    .filter((s) => s.key !== "asbestos_pre_reno")
    .map((s) => (s.key === "asbestos_bulk" ? { ...s, label: "Asbestos Inspection" } : s));
}

// The calculator quotes its own simplified per-sample rate for each service
// type rather than pulling the real per_sample_cents from Settings.
const PRICE_PER_SAMPLE_CENTS_BY_KEY: Record<string, number> = {
  asbestos_bulk: 2500,
  asbestos_pre_demo: 2500,
  mold_air: 8500,
  mold_bulk: 2500,
  mold_swab: 8500,
  lead_bulk: 2500,
};
const DEFAULT_PRICE_PER_SAMPLE_CENTS = 2500;

const MAX_SAMPLES_BY_KEY: Record<string, number> = {
  asbestos_bulk: 40,
  asbestos_pre_demo: 40,
  mold_air: 20,
  mold_bulk: 40,
  mold_swab: 20,
  lead_bulk: 20,
};
const DEFAULT_MAX_SAMPLES = 40;

export default function PricingCalculator() {
  // Same structured street/unit/town/state/zip layout as Book a Project and
  // the admin's Add Project form (see AddressBook.tsx / PortalBookingForm.tsx).
  const [street, setStreet] = useState("");
  const [unit, setUnit] = useState("");
  const [city, setCity] = useState("");
  const [addrState, setAddrState] = useState("MA");
  const [zip, setZip] = useState("");
  const [serviceTypes, setServiceTypes] = useState<ServiceTypeQuote[] | null>(null);
  const [withinArea, setWithinArea] = useState(true);
  const [addressChecked, setAddressChecked] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [sampleCount, setSampleCount] = useState(10);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useAutoZip(street, city, addrState, setZip, "");

  // Unzoned defaults, shown immediately so the whole calculator (service
  // types + slider + estimate) is usable before any address is entered.
  useEffect(() => {
    fetch("/api/pricing")
      .then((res) => res.json())
      .then((data) => {
        const merged = mergeAsbestosTypes(data.serviceTypes ?? []);
        setServiceTypes(merged);
        const first = merged[0];
        setSelectedKey(first?.key ?? null);
        if (first) {
          const max = MAX_SAMPLES_BY_KEY[first.key] ?? DEFAULT_MAX_SAMPLES;
          setSampleCount(Math.min(first.typical_samples_min || 10, max));
        }
      })
      .catch(() => {});
  }, []);

  // Once a real address is typed, refine the base fee with any zone
  // override — same lookup the real booking form uses — without gating
  // the rest of the calculator behind a separate step.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!street.trim() || !city.trim() || !addrState.trim()) {
      setAddressChecked(false);
      return;
    }
    const address = buildBillingAddress({ street, unit, city, state: addrState, zip });
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch("/api/book", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ step: "address", address }),
        });
        const data = await res.json();
        if (!res.ok) return;
        setServiceTypes(mergeAsbestosTypes(data.serviceTypes ?? []));
        setWithinArea(data.withinArea);
        setAddressChecked(true);
      } catch {
        // Silently keep the unzoned defaults — this is an estimate, not a booking.
      }
    }, 500);
  }, [street, unit, city, addrState, zip]);

  const selected = useMemo(
    () => serviceTypes?.find((s) => s.key === selectedKey) ?? null,
    [serviceTypes, selectedKey]
  );

  function selectService(service: ServiceTypeQuote) {
    setSelectedKey(service.key);
    const max = MAX_SAMPLES_BY_KEY[service.key] ?? DEFAULT_MAX_SAMPLES;
    setSampleCount(Math.min(service.typical_samples_min || 10, max));
  }

  const unitCents = selected
    ? (PRICE_PER_SAMPLE_CENTS_BY_KEY[selected.key] ?? DEFAULT_PRICE_PER_SAMPLE_CENTS)
    : 0;
  const maxSamples = selected ? (MAX_SAMPLES_BY_KEY[selected.key] ?? DEFAULT_MAX_SAMPLES) : DEFAULT_MAX_SAMPLES;

  const estimateCents = selected
    ? computeInvoiceTotalCents(selected.base_fee_cents, unitCents, sampleCount)
    : null;

  const ESTIMATE_RANGE_CENTS = 15000;
  const estimateLowCents = estimateCents !== null ? Math.max(0, estimateCents - ESTIMATE_RANGE_CENTS) : null;
  const estimateHighCents = estimateCents !== null ? estimateCents + ESTIMATE_RANGE_CENTS : null;

  return (
    <div className="mx-auto max-w-4xl rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <p className="text-sm font-semibold uppercase text-slate-700">Service Address</p>
      <div className="mt-2 flex gap-1.5">
        <div className="w-0 flex-1">
          <AddressAutocompleteInput
            apiBase="/api"
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
          apiBase="/api"
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
          className="rounded-lg border border-slate-300 px-2 py-2 text-sm"
          value={addrState}
          onChange={(e) => setAddrState(e.target.value)}
        >
          {US_STATES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <ZipInput street={street} city={city} state={addrState} zip={zip} setZip={setZip} apiBase="/api" />
      </div>
      {addressChecked && !withinArea && (
        <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          This address looks outside our usual service area — contact us and we&apos;ll confirm.
        </p>
      )}

      <p className="mt-6 text-sm font-semibold uppercase text-slate-700">Service Type</p>
      <div className="mt-2 grid grid-cols-3 gap-4">
        {(serviceTypes ?? []).map((service) => (
          <label
            key={service.key}
            className={`group flex cursor-pointer items-center gap-2 overflow-hidden rounded-lg border px-3 py-2 text-xs ${
              selectedKey === service.key
                ? "border-brand-700 bg-brand-50 font-semibold text-brand-700"
                : "border-slate-200 text-slate-600 hover:border-brand-400"
            }`}
          >
            <input
              type="checkbox"
              checked={selectedKey === service.key}
              onChange={() => selectService(service)}
              className="shrink-0 accent-brand-700"
            />
            <span className="truncate group-hover:underline">{service.label}</span>
          </label>
        ))}
      </div>

      {selected && (
        <div className="mt-6">
          <label className="flex items-center justify-between text-sm font-semibold uppercase text-slate-700" htmlFor="sample-count">
            <span>Estimated Number of Samples</span>
            <span>{sampleCount}</span>
          </label>
          <input
            id="sample-count"
            type="range"
            min={1}
            step={1}
            max={maxSamples}
            value={sampleCount}
            onChange={(e) => setSampleCount(Number(e.target.value))}
            className="mt-2 w-full accent-brand-700"
          />

          <div className="mt-6 rounded-lg bg-slate-50 p-4 text-center">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Estimated total</p>
            <p className="text-3xl font-black text-brand-700">
              {formatCents(estimateLowCents ?? 0)} &ndash; {formatCents(estimateHighCents ?? 0)}
            </p>
          </div>

          <div className="mt-6 flex justify-center">
            <Link
              href="/portal"
              className="inline-flex h-[22px] items-center border-[3px] border-brand-700 bg-brand-50 px-4 text-sm font-extrabold uppercase pt-0.5 leading-none text-brand-700 hover:bg-yellow-100 sm:h-[29px]"
            >
              Book an Inspection
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
