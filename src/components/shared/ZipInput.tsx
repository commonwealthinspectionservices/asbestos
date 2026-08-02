"use client";

import { useEffect, useRef, useState } from "react";

// Shared by the admin Add/Edit Project forms and the contractor portal's
// Book a Project form — same structured street/unit/town/state/zip layout
// and auto-fill behavior, pointed at either /api/admin or /api/portal so
// each surface hits its own auth-gated geocode-zip/zips-for-town routes.
export function useAutoZip(street: string, city: string, state: string, setZip: (v: string) => void, apiBase: string) {
  useEffect(() => {
    if (!street.trim() || !city.trim() || !state.trim()) return;
    const address = `${street}, ${city}, ${state}`;
    const timer = setTimeout(() => {
      fetch(`${apiBase}/geocode-zip?address=${encodeURIComponent(address)}`)
        .then((r) => r.json())
        .then((data) => {
          if (data.zip) setZip(data.zip);
        })
        .catch(() => {});
    }, 600);
    return () => clearTimeout(timer);
  }, [street, city, state, setZip, apiBase]);
}

// Every ZIP a town maps to — empty until a town+state are known and no
// street has been typed yet. The caller auto-fills when there's exactly
// one and offers a pick-list when there are several, rather than silently
// guessing wrong for a multi-ZIP town.
function useTownZipOptions(street: string, city: string, state: string, apiBase: string): string[] {
  const [options, setOptions] = useState<string[]>([]);
  useEffect(() => {
    if (street.trim() || !city.trim() || !state.trim()) {
      setOptions([]);
      return;
    }
    const timer = setTimeout(() => {
      fetch(`${apiBase}/zips-for-town?town=${encodeURIComponent(city)}&state=${encodeURIComponent(state)}`)
        .then((r) => r.json())
        .then((data) => setOptions(data.zips ?? []))
        .catch(() => setOptions([]));
    }, 400);
    return () => clearTimeout(timer);
  }, [street, city, state, apiBase]);
  return options;
}

// ZIP input that auto-fills itself when its town resolves to exactly one
// ZIP, and offers a one-click pick-list instead of leaving the user to type
// one when the town has several.
export default function ZipInput({
  street, city, state, zip, setZip, apiBase, inputClassName,
}: {
  street: string;
  city: string;
  state: string;
  zip: string;
  setZip: (v: string) => void;
  /** "/api/admin" or "/api/portal" — which auth-gated zip routes to call. */
  apiBase: string;
  /** Overrides the input's own classes (size/padding) — see AddressAutocompleteInput's version of this prop. */
  inputClassName?: string;
}) {
  const options = useTownZipOptions(street, city, state, apiBase);
  const [open, setOpen] = useState(false);
  const lastAutoFilledRef = useRef<string | null>(null);

  useEffect(() => {
    if (options.length !== 1) return;
    // Only overwrite an empty field or one we auto-filled ourselves last
    // time — never clobber a value the user actually typed in.
    if (!zip.trim() || zip === lastAutoFilledRef.current) {
      setZip(options[0]);
      lastAutoFilledRef.current = options[0];
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options]);

  return (
    <div className="relative">
      <div className="flex gap-1">
        <input
          className={inputClassName ?? "w-full rounded-lg border border-slate-300 px-2 py-2 text-sm"}
          placeholder="ZIP"
          value={zip}
          onChange={(e) => setZip(e.target.value)}
        />
        {options.length > 1 && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="shrink-0 rounded-lg border border-slate-300 px-2 py-2 text-xs text-slate-500"
          >
            ▾
          </button>
        )}
      </div>
      {open && options.length > 1 && (
        <div className="absolute right-0 z-10 mt-1 max-h-48 w-28 overflow-y-auto rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
          {options.map((z) => (
            <button
              key={z}
              type="button"
              onClick={() => {
                setZip(z);
                setOpen(false);
              }}
              className="block w-full rounded px-2 py-1 text-left text-sm hover:bg-slate-50"
            >
              {z}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
