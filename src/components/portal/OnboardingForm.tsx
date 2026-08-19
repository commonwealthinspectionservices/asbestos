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
  companyName,
  companyBillingAddress,
}: {
  accountType: "company" | "individual" | null;
  email: string | undefined;
  // Only set for a real existing customers row — an admin Invite, or
  // another portal user's own "Teammates" invite, can already carry some
  // real profile data before a password is ever set. The two paths don't
  // carry the *same* fields though (see each flag below), so this is
  // checked per field, not as one all-or-nothing "has a profile" flag —
  // an admin Invite sets name/phone/company/billing address all at once,
  // while a Teammates invite (POST /api/portal/contacts) only ever sets an
  // email, leaving name/phone/company/address genuinely blank. Locking
  // fields that are actually still empty would strand that person with no
  // way to fill them in and a Continue button that can never enable.
  customer: Customer | null;
  // Resolved server-side (see onboarding/page.tsx) — falls back to a
  // company_id lookup when customer.company itself is blank, which is
  // exactly the Teammates-invite case: company_id is already set and
  // already governs the real link (POST /api/portal/profile keeps
  // whatever company_id an existing row already has, regardless of what's
  // typed here), so this is display-only, never a source of truth to edit.
  companyName: string | null;
  // Same company_id fallback as companyName, for the same reason — but
  // unlike name/phone, a company account's billing address is never
  // something the person being invited fills in here at all, known or not.
  // It belongs to the company (companies.billing_address is the one place
  // it's meant to live), not to whoever happens to be joining it.
  companyBillingAddress: string | null;
}) {
  // Stub rows from the on_auth_user_created trigger (schema.sql) always
  // have name === email and phone === '' — this is what tells a genuinely
  // unknown field apart from one a real invite already filled in. Pre-
  // filling a brand-new self-signup's First Name with their own email
  // would be worse than just leaving it blank.
  const hasKnownName = Boolean(customer && customer.name && customer.name !== customer.email);
  const hasKnownPhone = Boolean(customer?.phone);
  const hasKnownCompany = Boolean(companyName);
  const isCompanyAccount = accountType !== "individual";
  // A company account never edits its billing address on this screen — it's
  // predetermined by the company, not the person joining it. Individuals
  // have no company to inherit from, so they still enter their own below
  // when one isn't already on file.
  const resolvedAddress = customer?.billing_address || (isCompanyAccount ? companyBillingAddress : null);
  const hasKnownAddress = Boolean(resolvedAddress);
  const addressIsEditable = !isCompanyAccount && !hasKnownAddress;

  const prefilledName = hasKnownName ? splitFullName(customer!.name) : { first: "", last: "" };
  const prefilledAddress = hasKnownAddress ? parseAddressToFields(resolvedAddress!) : null;

  const router = useRouter();
  const [firstName, setFirstName] = useState(prefilledName.first);
  const [lastName, setLastName] = useState(prefilledName.last);
  const [company, setCompany] = useState(hasKnownCompany ? companyName ?? "" : "");
  const [phone, setPhone] = useState(hasKnownPhone ? formatPhoneNumber(customer!.phone) : "");
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

      {(hasKnownName || (accountType !== "individual" && hasKnownCompany) || hasKnownPhone) && (
        // Confirmation of whatever's already on file — not a form. Each
        // field below only shows here once, either here (read-only) or as
        // an editable input further down, never both and never neither.
        <div className="mb-4 space-y-2 rounded-lg bg-slate-100 px-4 py-3 text-sm text-slate-600">
          {hasKnownName && <div>{joinName(firstName, lastName)}</div>}
          {accountType !== "individual" && hasKnownCompany && <div>{company}</div>}
          {hasKnownPhone && <div>{phone}</div>}
        </div>
      )}

      {!hasKnownName && (
        <div className="flex gap-2">
          <input className="w-0 flex-1 rounded-lg border border-slate-300 px-4 py-3 text-base" placeholder="First name" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
          <input className="w-0 flex-1 rounded-lg border border-slate-300 px-4 py-3 text-base" placeholder="Last name" value={lastName} onChange={(e) => setLastName(e.target.value)} />
        </div>
      )}
      {accountType !== "individual" && !hasKnownCompany && (
        <input className="mt-4 w-full rounded-lg border border-slate-300 px-4 py-3 text-base" placeholder="Company" value={company} onChange={(e) => setCompany(e.target.value)} />
      )}
      {!hasKnownPhone && (
        <input className="mt-4 w-full rounded-lg border border-slate-300 px-4 py-3 text-base" placeholder="Phone" type="tel" value={phone} onChange={(e) => setPhone(formatPhoneNumber(e.target.value))} />
      )}

      <input className="mt-4 w-full rounded-lg border border-slate-300 px-4 py-3 text-base" placeholder="Create a password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
      <input className="mt-4 w-full rounded-lg border border-slate-300 px-4 py-3 text-base" placeholder="Confirm password" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />

      {hasKnownAddress && (
        <div className="mt-4 space-y-1 rounded-lg bg-slate-100 px-4 py-3 text-sm text-slate-600">
          <p className="text-xs font-semibold uppercase text-slate-500">Billing address</p>
          <div>{[street, unit].filter(Boolean).join(" ")}{(street || unit) && (city || addrState || zip) ? ", " : ""}{[city, addrState, zip].filter(Boolean).join(" ")}</div>
        </div>
      )}
      {addressIsEditable && (
        <>
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
        </>
      )}

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
