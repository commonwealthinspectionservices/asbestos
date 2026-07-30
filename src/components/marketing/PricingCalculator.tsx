"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import AddressAutocompleteInput from "@/components/shared/AddressAutocompleteInput";
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

// For the calculator only: asbestos and lead are priced per "material"
// tested (each material is actually 2 lab samples under the hood, at $25
// each) rather than per raw sample — simpler for a customer to estimate,
// and it works out to a flat $50/material.
const MATERIAL_BASED_KEYS = ["asbestos_bulk", "asbestos_pre_demo", "lead_bulk"];
const PRICE_PER_MATERIAL_CENTS = 5000;

export default function PricingCalculator() {
  const [address, setAddress] = useState("");
  const [serviceTypes, setServiceTypes] = useState<ServiceTypeQuote[] | null>(null);
  const [withinArea, setWithinArea] = useState(true);
  const [addressChecked, setAddressChecked] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [sampleCount, setSampleCount] = useState(10);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
        if (first) setSampleCount(first.typical_samples_min || 10);
      })
      .catch(() => {});
  }, []);

  // Once a real address is typed, refine the base fee with any zone
  // override — same lookup the real booking form uses — without gating
  // the rest of the calculator behind a separate step.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (address.trim().length < 8) {
      setAddressChecked(false);
      return;
    }
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
  }, [address]);

  const selected = useMemo(
    () => serviceTypes?.find((s) => s.key === selectedKey) ?? null,
    [serviceTypes, selectedKey]
  );

  function selectService(service: ServiceTypeQuote) {
    setSelectedKey(service.key);
    setSampleCount(service.typical_samples_min || 10);
  }

  const isMaterialBased = selected ? MATERIAL_BASED_KEYS.includes(selected.key) : false;
  const unitLabel = isMaterialBased ? "Materials" : "Samples";
  const unitCents = selected ? (isMaterialBased ? PRICE_PER_MATERIAL_CENTS : selected.per_sample_cents) : 0;

  const estimateCents = selected
    ? computeInvoiceTotalCents(selected.base_fee_cents, unitCents, sampleCount)
    : null;

  return (
    <div className="mx-auto max-w-4xl rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <p className="text-sm font-semibold uppercase text-slate-700">Service Address</p>
      <div className="mt-2">
        <AddressAutocompleteInput value={address} onChange={setAddress} apiBase="" />
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
            className={`group flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
              selectedKey === service.key
                ? "border-brand-700 bg-brand-50 font-semibold text-brand-700"
                : "border-slate-200 text-slate-600 hover:border-brand-400"
            }`}
          >
            <input
              type="checkbox"
              checked={selectedKey === service.key}
              onChange={() => selectService(service)}
              className="accent-brand-700"
            />
            <span className="group-hover:underline">{service.label}</span>
          </label>
        ))}
      </div>

      {selected && (
        <div className="mt-6">
          <label className="flex items-center justify-between text-sm font-semibold uppercase text-slate-700" htmlFor="sample-count">
            <span>Estimated Number of {unitLabel}</span>
            <span>{sampleCount}</span>
          </label>
          <input
            id="sample-count"
            type="range"
            min={1}
            step={1}
            max={isMaterialBased ? 20 : 40}
            value={sampleCount}
            onChange={(e) => setSampleCount(Number(e.target.value))}
            className="mt-2 w-full accent-brand-700"
          />

          <div className="mt-6 rounded-lg bg-slate-50 p-4 text-center">
            <p className="text-xs uppercase tracking-wide text-slate-500">Estimated total</p>
            <p className="text-3xl font-black text-brand-700">{formatCents(estimateCents ?? 0)}</p>
          </div>

          <div className="mt-6 flex justify-center">
            <Link
              href="/portal"
              className="inline-flex h-[22px] items-center border-[3px] border-brand-700 bg-brand-50 px-4 text-sm font-extrabold uppercase leading-none text-brand-700 hover:bg-yellow-100 sm:h-[29px]"
            >
              Book an Inspection
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
