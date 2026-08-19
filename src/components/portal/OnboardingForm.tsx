"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AddressAutocompleteInput from "@/components/shared/AddressAutocompleteInput";
import ZipInput, { useAutoZip } from "@/components/shared/ZipInput";
import { buildBillingAddress, parseAddressToFields, US_STATES } from "@/lib/address";
import { formatPhoneNumber } from "@/lib/phone";
import { joinName, splitFullName } from "@/lib/name";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";
import type { Customer } from "@/lib/types";

export default function OnboardingForm({
  accountType,
  email,
  customer,
}: {
  accountType: "company" | "individual" | null;
  email: string | undefined;
  // Only set for a real existing customers row — an admin Invite (or a
  // returning contact whose row predates their own login) can already
  // carry a real name/phone/company/billing address, in which case the
  // only thing actually missing is a password. `customer.name !== email`
  // is what tells that apart from the on_auth_user_created trigger's own
  // stub row (always `name: email, phone: ''`, created the instant anyone
  // signs up, before onboarding ever runs — see schema.sql) — pre-filling
  // from that stub would show a garbled "first name" of someone's own
  // email address for a brand-new self-signup, so this only pre-fills once
  // there's a real name on file to show.
  customer: Customer | null;
}) {
  const hasRealProfile = Boolean(customer && customer.name && customer.name !== customer.email);
  const prefilledName = hasRealProfile ? splitFullName(customer!.name) : { first: "", last: "" };
  const prefilledAddress = hasRealProfile ? parseAddressToFields(customer!.billing_address) : null;

  const router = useRouter();
  const [firstName, setFirstName] = useState(prefilledName.first);
  const [lastName, setLastName] = useState(prefilledName.last);
  const [company, setCompany] = useState(hasRealProfile ? customer!.company ?? "" : "");
  const [phone, setPhone] = useState(hasRealProfile && customer!.phone ? formatPhoneNumber(customer!.phone) : "");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  // Same structured street/unit/town/state/zip layout as Book a Project and
  // the admin's Add Project form (see AddressBook.tsx / PortalBookingForm.tsx).
  const [street, setStreet] = useState(prefilledAddress?.street ?? "");
  const [unit, setUnit] = useState(prefilledAddress?.unit ?? "");
  const [city, setCity] = useState(prefilledAddress?.city ?? "");
  const [addrState, setAddrState] = useState(prefilledAddress?.state || "MA");
  const [zip, setZip] = useState(prefilledAddress?.zip ?? "");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // No customer row exists yet at this point in the flow, so the
  // auth-gated /api/portal address routes 404 here (they require one) —
  // use the public, unauthenticated routes instead, same as the marketing
  // pricing calculator. Fine either way: this page is itself only
  // reachable with a valid logged-in session.
  useAutoZip(street, city, addrState, setZip, "/api");

  async function submit() {
    if (password !== confirmPassword) {
      setError("Passwords don't match");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // Nobody arriving here has a real password yet — signup sends an
      // email-confirmation link with no password involved (see
      // /portal/signup), and an admin/teammate Invite never sets one
      // either. This is the first and only place either path lands, so
      // it's the right place to set one, alongside the rest of the profile.
      const supabase = createSupabaseBrowserClient();
      const { error: passwordError } = await supabase.auth.updateUser({ password });
      if (passwordError) throw passwordError;

      const billingAddress = buildBillingAddress({ street, unit, city, state: addrState, zip });
      const name = joinName(firstName, lastName);
      const res = await fetch("/api/portal/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, company, phone, billingAddress, accountType }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save profile");
      router.push("/portal/dashboard");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save profile");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative mx-auto max-w-lg px-4 py-16">
      <Link
        href="/"
        aria-label="Close"
        className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center text-3xl text-slate-400 hover:text-slate-600"
      >
        ×
      </Link>

      {error && <div className="rounded-lg bg-red-50 px-5 py-4 text-base text-red-700">{error}</div>}

      {email && (
        <div className="mb-4 rounded-lg bg-slate-100 px-4 py-3 text-sm text-slate-600">{email}</div>
      )}

      <div className="flex gap-2">
        <input className="w-0 flex-1 rounded-lg border border-slate-300 px-4 py-3 text-base" placeholder="First name" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
        <input className="w-0 flex-1 rounded-lg border border-slate-300 px-4 py-3 text-base" placeholder="Last name" value={lastName} onChange={(e) => setLastName(e.target.value)} />
      </div>
      {accountType !== "individual" && (
        <input className="mt-4 w-full rounded-lg border border-slate-300 px-4 py-3 text-base" placeholder="Company" value={company} onChange={(e) => setCompany(e.target.value)} />
      )}
      <input className="mt-4 w-full rounded-lg border border-slate-300 px-4 py-3 text-base" placeholder="Phone" type="tel" value={phone} onChange={(e) => setPhone(formatPhoneNumber(e.target.value))} />
      <input className="mt-4 w-full rounded-lg border border-slate-300 px-4 py-3 text-base" placeholder="Create a password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
      <input className="mt-4 w-full rounded-lg border border-slate-300 px-4 py-3 text-base" placeholder="Confirm password" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />

      <p className="mt-4 text-sm font-semibold uppercase text-slate-500">Billing address</p>
      <div className="mt-2 flex gap-2">
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
            inputClassName="w-full rounded-lg border border-slate-300 px-4 py-3 text-base"
          />
        </div>
        <input
          className="w-24 shrink-0 rounded-lg border border-slate-300 px-4 py-3 text-base"
          placeholder="Unit #"
          value={unit}
          onChange={(e) => setUnit(e.target.value)}
        />
      </div>
      <div className="mt-2 grid grid-cols-[2fr_0.8fr_1fr] gap-2">
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
          inputClassName="w-full rounded-lg border border-slate-300 px-4 py-3 text-base"
        />
        <select
          className="rounded-lg border border-slate-300 px-4 py-3 text-base"
          value={addrState}
          onChange={(e) => setAddrState(e.target.value)}
        >
          {US_STATES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <ZipInput
          street={street}
          city={city}
          state={addrState}
          zip={zip}
          setZip={setZip}
          apiBase="/api"
          inputClassName="w-full rounded-lg border border-slate-300 px-4 py-3 text-base"
        />
      </div>

      <button
        className="mt-5 flex w-full items-center justify-center border-[3px] border-brand-700 bg-brand-50 py-4 pt-[18px] text-base font-extrabold uppercase leading-none text-brand-700 hover:bg-yellow-100 disabled:opacity-50"
        disabled={
          loading ||
          !firstName ||
          !lastName ||
          !phone ||
          (accountType !== "individual" && !company) ||
          password.length < 6 ||
          password !== confirmPassword
        }
        onClick={submit}
      >
        {loading ? "Saving…" : "Continue"}
      </button>
    </div>
  );
}
