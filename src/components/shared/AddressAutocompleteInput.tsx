"use client";

import { useRef, useState } from "react";
import { parseAddressToFields, withZip } from "@/lib/address";
import type { AddressFields } from "@/lib/address";

// Shared by the admin Add/Edit Project forms and the contractor portal's
// Book a Project form — same type-ahead behavior, pointed at either
// /api/admin or /api/portal so each surface hits its own auth-gated route.
export default function AddressAutocompleteInput({
  value, onChange, onSelectAddress, placeholder, mode = "address", townHint, apiBase, inputClassName,
}: {
  value: string;
  onChange: (v: string) => void;
  onSelectAddress?: (fields: AddressFields) => void;
  placeholder?: string;
  /** "city" restricts suggestions to town/locality matches (no street) — for a Town field used before a street is known. */
  mode?: "address" | "city";
  /** An already-known town to scope street suggestions to (e.g. "Newton") — only used in "address" mode. */
  townHint?: string;
  /** "/api/admin" or "/api/portal" — which auth-gated autocomplete routes to call. */
  apiBase: string;
  /** Overrides the input's own classes (size/padding) — callers that need to match a different field size on their form (e.g. onboarding's larger inputs) can pass one instead of the default compact styling. */
  inputClassName?: string;
}) {
  const [suggestions, setSuggestions] = useState<{ placeId: string; description: string }[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleInput(v: string) {
    onChange(v);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (v.trim().length < 4) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const townParam = mode === "address" && townHint?.trim() ? `&town=${encodeURIComponent(townHint.trim())}` : "";
        const res = await fetch(`${apiBase}/places-autocomplete?input=${encodeURIComponent(v)}&mode=${mode}${townParam}`);
        const data = await res.json();
        setSuggestions(data.suggestions ?? []);
        setOpen(true);
      } finally {
        setLoading(false);
      }
    }, 300);
  }

  async function select(suggestion: { placeId: string; description: string }) {
    setOpen(false);
    setSuggestions([]);
    try {
      const res = await fetch(`${apiBase}/place-details?placeId=${suggestion.placeId}`);
      const data = await res.json();
      const formatted = withZip(data.formattedAddress ?? suggestion.description, data.zip);
      if (onSelectAddress) {
        onSelectAddress(parseAddressToFields(formatted));
      } else {
        onChange(formatted);
      }
    } catch {
      onChange(suggestion.description);
    }
  }

  return (
    <div className="relative">
      <input
        className={inputClassName ?? "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"}
        value={value}
        placeholder={placeholder}
        onChange={(e) => handleInput(e.target.value)}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && (suggestions.length > 0 || loading) && (
        <ul className="absolute z-10 mt-1 w-full rounded-lg border border-slate-200 bg-white text-sm shadow-lg">
          {loading && <li className="px-3 py-2 text-slate-400">Searching…</li>}
          {suggestions.map((s) => (
            <li
              key={s.placeId}
              onMouseDown={() => select(s)}
              className="cursor-pointer px-3 py-2 hover:bg-slate-50"
            >
              {s.description}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
