"use client";

import { useState } from "react";
import AddressAutocompleteInput from "@/components/shared/AddressAutocompleteInput";
import ZipInput, { useAutoZip } from "@/components/shared/ZipInput";
import { buildBillingAddress, parseAddressToFields, US_STATES } from "@/lib/address";
import { formatPhoneNumber } from "@/lib/phone";
import { splitFullName, joinName } from "@/lib/name";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";
import type { Customer } from "@/lib/types";

export default function AccountForm({
  customer,
  email,
  accountType,
}: {
  customer: Customer;
  email: string | undefined;
  accountType: "contractor" | "homeowner" | null;
}) {
  const isHomeowner = accountType === "homeowner";
  const initialName = splitFullName(customer.name);
  const initialAddress = parseAddressToFields(customer.billing_address);

  const [firstName, setFirstName] = useState(initialName.first);
  const [lastName, setLastName] = useState(initialName.last);
  const [company, setCompany] = useState(customer.company ?? "");
  const [phone, setPhone] = useState(customer.phone ?? "");
  const [street, setStreet] = useState(initialAddress.street);
  const [unit, setUnit] = useState(initialAddress.unit);
  const [city, setCity] = useState(initialAddress.city);
  const [addrState, setAddrState] = useState(initialAddress.state || "MA");
  const [zip, setZip] = useState(initialAddress.zip);
  const [saving, setSaving] = useState(false);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useAutoZip(street, city, addrState, setZip, "/api/portal");

  async function saveContactInfo() {
    setSaving(true);
    setError(null);
    setSavedMessage(null);
    try {
      const name = joinName(firstName, lastName);
      const billingAddress = buildBillingAddress({ street, unit, city, state: addrState, zip });
      const res = await fetch("/api/portal/account", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, phone, company: isHomeowner ? undefined : company, billingAddress }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save");
      setSavedMessage("Saved.");
      setTimeout(() => setSavedMessage(null), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSaved, setPasswordSaved] = useState(false);

  async function changePassword() {
    if (newPassword !== confirmPassword) {
      setPasswordError("Passwords don't match");
      return;
    }
    setPasswordSaving(true);
    setPasswordError(null);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
      if (updateError) throw updateError;
      setNewPassword("");
      setConfirmPassword("");
      setPasswordSaved(true);
      setTimeout(() => setPasswordSaved(false), 2000);
    } catch (e) {
      setPasswordError(e instanceof Error ? e.message : "Failed to update password");
    } finally {
      setPasswordSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <h1 className="text-lg font-semibold text-slate-800">My Account</h1>

      <div className="mt-4 rounded-lg border border-slate-200 bg-white p-3">
        <h2 className="text-xs font-bold uppercase text-slate-500">Account</h2>
        <div className="mt-2 space-y-1 text-sm">
          <div><span className="text-slate-500">Email </span>{email}</div>
          <div><span className="text-slate-500">Account type </span>{isHomeowner ? "Individual" : "Company"}</div>
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-slate-200 bg-white p-3">
        <h2 className="text-xs font-bold uppercase text-slate-500">Contact info</h2>
        {error && <div className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

        <div className="mt-2 flex gap-2">
          <input className="w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="First name" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
          <input className="w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Last name" value={lastName} onChange={(e) => setLastName(e.target.value)} />
        </div>
        {!isHomeowner && (
          <input className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Company" value={company} onChange={(e) => setCompany(e.target.value)} />
        )}
        <input className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Phone" type="tel" value={phone} onChange={(e) => setPhone(formatPhoneNumber(e.target.value))} />

        <p className="mt-3 text-xs font-semibold uppercase text-slate-500">Billing address</p>
        <div className="mt-1 flex gap-2">
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
              inputClassName="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <input
            className="w-20 shrink-0 rounded-lg border border-slate-300 px-3 py-2 text-sm"
            placeholder="Unit #"
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
          />
        </div>
        <div className="mt-2 grid grid-cols-[2fr_0.8fr_1fr] gap-2">
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
            inputClassName="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
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
          <ZipInput
            street={street}
            city={city}
            state={addrState}
            zip={zip}
            setZip={setZip}
            apiBase="/api/portal"
            inputClassName="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </div>

        <div className="mt-3 flex items-center gap-2">
          <button
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            disabled={saving || !firstName || !lastName || !phone || (!isHomeowner && !company)}
            onClick={saveContactInfo}
          >
            {saving ? "Saving…" : "Save"}
          </button>
          {savedMessage && <span className="text-sm text-emerald-600">{savedMessage}</span>}
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-slate-200 bg-white p-3">
        <h2 className="text-xs font-bold uppercase text-slate-500">Change password</h2>
        {passwordError && <div className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{passwordError}</div>}
        <input
          type="password"
          className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          placeholder="New password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
        />
        <input
          type="password"
          className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          placeholder="Confirm new password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
        />
        <div className="mt-3 flex items-center gap-2">
          <button
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 disabled:opacity-50"
            disabled={passwordSaving || newPassword.length < 6 || newPassword !== confirmPassword}
            onClick={changePassword}
          >
            {passwordSaving ? "Saving…" : "Update password"}
          </button>
          {passwordSaved && <span className="text-sm text-emerald-600">Password updated.</span>}
        </div>
      </div>
    </div>
  );
}
