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
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [sampleCounts, setSampleCounts] = useState<Record<string, number>>({});
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useAutoZip(street, city, addrState, setZip, "");

  // Unzoned defaults, shown immediately so service type + sample count can
  // be picked before an address is entered — the estimate itself stays
  // hidden until addressChecked (an unzoned price could be misleading).
  useEffect(() => {
    fetch("/api/pricing")
      .then((res) => res.json())
      .then((data) => {
        const merged = mergeAsbestosTypes(data.serviceTypes ?? []);
        setServiceTypes(merged);
        const first = merged[0];
        if (first) {
          setSelectedKeys(new Set([first.key]));
          const max = MAX_SAMPLES_BY_KEY[first.key] ?? DEFAULT_MAX_SAMPLES;
          setSampleCounts({ [first.key]: Math.min(10, max) });
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

  const selectedServices = useMemo(
    () => (serviceTypes ?? []).filter((s) => selectedKeys.has(s.key)),
    [serviceTypes, selectedKeys]
  );

  function toggleService(service: ServiceTypeQuote) {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(service.key)) {
        next.delete(service.key);
      } else {
        next.add(service.key);
        setSampleCounts((counts) => {
          if (service.key in counts) return counts;
          const max = MAX_SAMPLES_BY_KEY[service.key] ?? DEFAULT_MAX_SAMPLES;
          return { ...counts, [service.key]: Math.min(10, max) };
        });
      }
      return next;
    });
  }

  function setSampleCountFor(key: string, count: number) {
    setSampleCounts((counts) => ({ ...counts, [key]: count }));
  }

  // Base fee is address/zone-driven only — it's charged once regardless of
  // how many service types are selected on the same visit (matches the real
  // booking flow in api/admin/jobs/route.ts: zone fee, or the sum fallback,
  // never per-selected-type multiplication).
  const baseFeeCents = selectedServices[0]?.base_fee_cents ?? 0;

  const samplesTotalCents = selectedServices.reduce((sum, service) => {
    const unitCents = PRICE_PER_SAMPLE_CENTS_BY_KEY[service.key] ?? DEFAULT_PRICE_PER_SAMPLE_CENTS;
    const count = sampleCounts[service.key] ?? 0;
    return sum + unitCents * count;
  }, 0);

  const estimateCents = selectedServices.length > 0
    ? computeInvoiceTotalCents(baseFeeCents, 1, samplesTotalCents)
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

      <p className="mt-6 text-sm font-semibold uppercase text-slate-700">Service Type(s)</p>
      <div className="mt-2 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {(serviceTypes ?? []).map((service) => (
          <label
            key={service.key}
            className={`group flex cursor-pointer items-center gap-2 overflow-hidden rounded-lg border px-3 py-2 text-xs ${
              selectedKeys.has(service.key)
                ? "border-brand-700 bg-brand-50 font-semibold text-brand-700"
                : "border-slate-200 text-slate-600 hover:border-brand-400"
            }`}
          >
            <input
              type="checkbox"
              checked={selectedKeys.has(service.key)}
              onChange={() => toggleService(service)}
              className="shrink-0 accent-brand-700"
            />
            <span className="truncate group-hover:underline">{service.label}</span>
          </label>
        ))}
      </div>

      {selectedServices.length > 0 && (
        <div className="mt-6">
          {selectedServices.map((service) => {
            const maxSamples = MAX_SAMPLES_BY_KEY[service.key] ?? DEFAULT_MAX_SAMPLES;
            const count = sampleCounts[service.key] ?? Math.min(10, maxSamples);
            return (
              <div key={service.key} className="mt-4 first:mt-0">
                <label
                  className="flex items-center justify-between text-sm font-semibold uppercase text-slate-700"
                  htmlFor={`sample-count-${service.key}`}
                >
                  <span>{service.label} &mdash; Estimated Samples</span>
                  <span>{count}</span>
                </label>
                <input
                  id={`sample-count-${service.key}`}
                  type="range"
                  min={1}
                  step={1}
                  max={maxSamples}
                  value={count}
                  onChange={(e) => setSampleCountFor(service.key, Number(e.target.value))}
                  className="mt-2 w-full accent-brand-700"
                />
              </div>
            );
          })}

          <div className="mt-6 rounded-lg bg-slate-50 p-4 text-center">
            {addressChecked ? (
              <>
                <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Estimated total</p>
                <p className="text-3xl font-black text-brand-700">
                  {formatCents(estimateLowCents ?? 0)} &ndash; {formatCents(estimateHighCents ?? 0)}
                </p>
              </>
            ) : (
              <p className="text-sm text-slate-500">Enter your address above to see a price estimate.</p>
            )}
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
