"use client";

import { useState } from "react";
import Link from "next/link";
import { formatPhoneNumber } from "@/lib/phone";

interface ServiceTypeOption {
  key: string;
  label: string;
  base_fee_cents: number;
  per_sample_cents: number;
  duration_minutes: number;
  rateLabel: string;
}

type Step = "address" | "waitlist" | "waitlistDone" | "service" | "date" | "contact" | "done";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function BookingForm() {
  const [step, setStep] = useState<Step>("address");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // address step
  const [address, setAddress] = useState("");
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [distanceMiles, setDistanceMiles] = useState<number | null>(null);
  const [state, setState] = useState<string | null>(null);
  const [serviceTypes, setServiceTypes] = useState<ServiceTypeOption[]>([]);
  const [disclaimerText, setDisclaimerText] = useState("");

  // service step
  const [serviceTypeKey, setServiceTypeKey] = useState<string>("");

  // date step
  const [date, setDate] = useState(todayIso());
  const [window_, setWindow] = useState<"AM" | "PM" | "ANY">("ANY");
  const [suggestedDate, setSuggestedDate] = useState<string | null>(null);

  // contact step
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [billingAddress, setBillingAddress] = useState("");
  const [siteContactName, setSiteContactName] = useState("");
  const [siteContactPhone, setSiteContactPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [disclaimerAck, setDisclaimerAck] = useState(false);
  const [confirmedDate, setConfirmedDate] = useState<string | null>(null);
  const [dateChanged, setDateChanged] = useState(false);

  async function submitAddress() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step: "address", address }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Something went wrong");

      setLat(data.lat);
      setLng(data.lng);
      setAddress(data.formattedAddress);
      setDistanceMiles(data.distanceMiles);
      setState(data.state);

      if (!data.withinArea) {
        setStep("waitlist");
      } else {
        setServiceTypes(data.serviceTypes);
        setDisclaimerText(data.disclaimerText);
        setStep("service");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  async function submitWaitlist() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step: "waitlist", address, lat, lng, distanceMiles, name, email, phone }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Something went wrong");
      setStep("waitlistDone");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
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
      if (data.full) {
        setSuggestedDate(data.nextAvailableDate);
      }
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
      const res = await fetch("/api/book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          step: "submit",
          address, lat, lng, distanceMiles, state,
          serviceTypeKey, date, window: window_,
          name, company, email, phone, billingAddress,
          siteContactName, siteContactPhone, notes,
          disclaimerAck,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Something went wrong");
      setConfirmedDate(data.date);
      setDateChanged(data.dateChanged);
      setStep("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  const selectedService = serviceTypes.find((s) => s.key === serviceTypeKey);

  return (
    <div className="mx-auto max-w-md px-4 py-8">
      <div className="flex items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="" width={40} height={40} className="rounded-full" />
        <div>
          <h1 className="text-xl font-semibold text-brand-700">Commonwealth Inspection Services, LLC.</h1>
          <p className="text-sm text-slate-500">Asbestos &amp; mold inspections — metro Boston</p>
        </div>
      </div>

      {error && (
        <div className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {step === "address" && (
        <section className="mt-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700">Property address</label>
            <input
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-base"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="123 Main St, Boston, MA"
            />
          </div>
          <button
            className="w-full rounded-lg bg-brand-600 px-4 py-3 font-medium text-white disabled:opacity-50"
            disabled={loading || !address.trim()}
            onClick={submitAddress}
          >
            {loading ? "Checking address…" : "Continue"}
          </button>
          <p className="text-center text-sm text-slate-500">
            Repeat contractor?{" "}
            <Link href="/portal/login" className="text-brand-600 underline">
              Sign in for faster booking
            </Link>
          </p>
        </section>
      )}

      {step === "waitlist" && (
        <section className="mt-6 space-y-4">
          <div className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
            This address is just outside our service area ({distanceMiles} mi from our coverage
            center). We&apos;re expanding — leave your info and we&apos;ll reach out if that changes.
          </div>
          <input className="w-full rounded-lg border border-slate-300 px-3 py-2" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <input className="w-full rounded-lg border border-slate-300 px-3 py-2" placeholder="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <input className="w-full rounded-lg border border-slate-300 px-3 py-2" placeholder="Phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
          <button
            className="w-full rounded-lg bg-brand-600 px-4 py-3 font-medium text-white disabled:opacity-50"
            disabled={loading || !name || !email || !phone}
            onClick={submitWaitlist}
          >
            {loading ? "Submitting…" : "Join waitlist"}
          </button>
        </section>
      )}

      {step === "waitlistDone" && (
        <section className="mt-6 rounded-lg bg-emerald-50 px-4 py-4 text-sm text-emerald-800">
          Thanks — we&apos;ve got your info and will reach out if we expand into your area.
        </section>
      )}

      {step === "service" && (
        <section className="mt-6 space-y-4">
          <p className="text-sm text-slate-600">{address}</p>
          <div className="space-y-2">
            {serviceTypes.map((s) => (
              <button
                key={s.key}
                className={`w-full rounded-lg border px-4 py-3 text-left ${
                  serviceTypeKey === s.key ? "border-brand-600 bg-brand-50" : "border-slate-300"
                }`}
                onClick={() => setServiceTypeKey(s.key)}
              >
                <div className="font-medium">{s.label}</div>
                <div className="text-sm text-slate-500">{s.rateLabel}</div>
              </button>
            ))}
          </div>
          <p className="text-xs text-slate-500">
            Final total depends on the number of samples taken on site.
          </p>
          <button
            className="w-full rounded-lg bg-brand-600 px-4 py-3 font-medium text-white disabled:opacity-50"
            disabled={!serviceTypeKey}
            onClick={() => setStep("date")}
          >
            Continue
          </button>
        </section>
      )}

      {step === "date" && (
        <section className="mt-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700">Date</label>
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
              <button
                className="font-semibold underline"
                onClick={() => {
                  setDate(suggestedDate);
                  setSuggestedDate(null);
                }}
              >
                {suggestedDate}
              </button>
              .
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-slate-700">Preferred window</label>
            <div className="mt-1 grid grid-cols-3 gap-2">
              {(["AM", "PM", "ANY"] as const).map((w) => (
                <button
                  key={w}
                  className={`rounded-lg border px-3 py-2 text-sm ${
                    window_ === w ? "border-brand-600 bg-brand-50" : "border-slate-300"
                  }`}
                  onClick={() => setWindow(w)}
                >
                  {w === "ANY" ? "No preference" : w}
                </button>
              ))}
            </div>
          </div>
          <button
            className="w-full rounded-lg bg-brand-600 px-4 py-3 font-medium text-white disabled:opacity-50"
            disabled={loading || !!suggestedDate}
            onClick={() => setStep("contact")}
          >
            Continue
          </button>
        </section>
      )}

      {step === "contact" && (
        <section className="mt-6 space-y-4">
          <div className="rounded-lg bg-slate-100 px-4 py-3 text-sm text-slate-700">
            No payment today. We invoice after the inspection, due within 30 days.
          </div>
          <input className="w-full rounded-lg border border-slate-300 px-3 py-2" placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} />
          <input className="w-full rounded-lg border border-slate-300 px-3 py-2" placeholder="Company (optional)" value={company} onChange={(e) => setCompany(e.target.value)} />
          <input className="w-full rounded-lg border border-slate-300 px-3 py-2" placeholder="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <input className="w-full rounded-lg border border-slate-300 px-3 py-2" placeholder="Phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
          <input className="w-full rounded-lg border border-slate-300 px-3 py-2" placeholder="Billing address" value={billingAddress} onChange={(e) => setBillingAddress(e.target.value)} />

          <div>
            <p className="text-sm font-medium text-slate-700">Job site contact (if different from above)</p>
            <p className="text-xs text-slate-500">Who we should coordinate scheduling with at the property — e.g. the homeowner.</p>
          </div>
          <input className="w-full rounded-lg border border-slate-300 px-3 py-2" placeholder="Site contact name (optional)" value={siteContactName} onChange={(e) => setSiteContactName(e.target.value)} />
          <input className="w-full rounded-lg border border-slate-300 px-3 py-2" placeholder="Site contact phone (optional)" type="tel" value={siteContactPhone} onChange={(e) => setSiteContactPhone(formatPhoneNumber(e.target.value))} />

          <textarea className="w-full rounded-lg border border-slate-300 px-3 py-2" placeholder="Notes — gate code, contact on site, etc. (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />

          <div className="rounded-lg border border-slate-200 px-4 py-3 text-xs text-slate-600">
            {disclaimerText}
          </div>
          <label className="flex items-start gap-2 text-sm text-slate-700">
            <input type="checkbox" className="mt-1" checked={disclaimerAck} onChange={(e) => setDisclaimerAck(e.target.checked)} />
            I acknowledge the above.
          </label>

          <button
            className="w-full rounded-lg bg-brand-600 px-4 py-3 font-medium text-white disabled:opacity-50"
            disabled={loading || !name || !email || !phone || !billingAddress || !disclaimerAck}
            onClick={submitBooking}
          >
            {loading ? "Booking…" : "Confirm booking"}
          </button>
        </section>
      )}

      {step === "done" && (
        <section className="mt-6 space-y-3">
          <div className="rounded-lg bg-emerald-50 px-4 py-4 text-sm text-emerald-800">
            <p className="font-medium">You&apos;re booked for {confirmedDate}.</p>
            {dateChanged && (
              <p className="mt-1">
                Your originally requested date was full, so we moved you to the next available
                date.
              </p>
            )}
            <p className="mt-1">A confirmation email is on its way to {email}.</p>
          </div>
        </section>
      )}
    </div>
  );
}
