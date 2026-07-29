"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { SavedAddress } from "@/lib/types";

interface ServiceTypeOption {
  key: string;
  label: string;
  rateLabel: string;
}

type Step = "address" | "service" | "date" | "confirm" | "done";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function PortalBookingForm() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("address");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [savedAddresses, setSavedAddresses] = useState<SavedAddress[]>([]);
  const [newAddressInput, setNewAddressInput] = useState("");
  const [saveNewAddress, setSaveNewAddress] = useState(true);

  const [address, setAddress] = useState("");
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [distanceMiles, setDistanceMiles] = useState<number | null>(null);
  const [state, setState] = useState<string | null>(null);
  const [serviceTypes, setServiceTypes] = useState<ServiceTypeOption[]>([]);
  const [disclaimerText, setDisclaimerText] = useState("");

  const [serviceTypeKey, setServiceTypeKey] = useState("");

  const [date, setDate] = useState(todayIso());
  const [window_, setWindow] = useState<"AM" | "PM" | "ANY">("ANY");
  const [suggestedDate, setSuggestedDate] = useState<string | null>(null);

  const [siteContactName, setSiteContactName] = useState("");
  const [siteContactPhone, setSiteContactPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [disclaimerAck, setDisclaimerAck] = useState(false);
  const [confirmedDate, setConfirmedDate] = useState<string | null>(null);
  const [dateChanged, setDateChanged] = useState(false);

  useEffect(() => {
    fetch("/api/portal/addresses")
      .then((r) => r.json())
      .then((data) => setSavedAddresses(data.addresses ?? []));
  }, []);

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
      setDisclaimerText(data.disclaimerText);
      setStep("service");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  function pickSavedAddress(a: SavedAddress) {
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
      if (saveNewAddress && newAddressInput.trim()) {
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
          serviceTypeKey, date, window: window_,
          siteContactName, siteContactPhone, notes, disclaimerAck,
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

  return (
    <div className="mx-auto max-w-md px-4 py-8">
      <h1 className="text-lg font-semibold text-slate-800">Book a project</h1>

      {error && <div className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {step === "address" && (
        <section className="mt-6 space-y-4">
          {savedAddresses.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-slate-700">Saved addresses</label>
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

          <div>
            <label className="block text-sm font-medium text-slate-700">Or enter a new address</label>
            <input
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              value={newAddressInput}
              onChange={(e) => setNewAddressInput(e.target.value)}
              placeholder="123 Main St, Boston, MA"
            />
            <label className="mt-2 flex items-center gap-2 text-sm text-slate-600">
              <input type="checkbox" checked={saveNewAddress} onChange={(e) => setSaveNewAddress(e.target.checked)} />
              Save this address for next time
            </label>
          </div>

          <button
            className="w-full rounded-lg bg-brand-600 px-4 py-3 font-medium text-white disabled:opacity-50"
            disabled={loading || !newAddressInput.trim()}
            onClick={() => checkAddress(newAddressInput)}
          >
            {loading ? "Checking…" : "Continue"}
          </button>
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
              <button className="font-semibold underline" onClick={() => { setDate(suggestedDate); setSuggestedDate(null); }}>
                {suggestedDate}
              </button>.
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-slate-700">Preferred window</label>
            <div className="mt-1 grid grid-cols-3 gap-2">
              {(["AM", "PM", "ANY"] as const).map((w) => (
                <button
                  key={w}
                  className={`rounded-lg border px-3 py-2 text-sm ${window_ === w ? "border-brand-600 bg-brand-50" : "border-slate-300"}`}
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
            onClick={() => setStep("confirm")}
          >
            Continue
          </button>
        </section>
      )}

      {step === "confirm" && (
        <section className="mt-6 space-y-4">
          <div>
            <p className="text-sm font-medium text-slate-700">On-site contact</p>
            <p className="text-xs text-slate-500">Who we should coordinate scheduling with at the property (e.g. the homeowner).</p>
          </div>
          <input
            className="w-full rounded-lg border border-slate-300 px-3 py-2"
            placeholder="Site contact name (optional)"
            value={siteContactName}
            onChange={(e) => setSiteContactName(e.target.value)}
          />
          <input
            className="w-full rounded-lg border border-slate-300 px-3 py-2"
            placeholder="Site contact phone (optional)"
            type="tel"
            value={siteContactPhone}
            onChange={(e) => setSiteContactPhone(e.target.value)}
          />
          <textarea
            className="w-full rounded-lg border border-slate-300 px-3 py-2"
            placeholder="Notes — gate code, contact on site, etc. (optional)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
          <div className="rounded-lg border border-slate-200 px-4 py-3 text-xs text-slate-600">{disclaimerText}</div>
          <label className="flex items-start gap-2 text-sm text-slate-700">
            <input type="checkbox" className="mt-1" checked={disclaimerAck} onChange={(e) => setDisclaimerAck(e.target.checked)} />
            I acknowledge the above.
          </label>
          <button
            className="w-full rounded-lg bg-brand-600 px-4 py-3 font-medium text-white disabled:opacity-50"
            disabled={loading || !disclaimerAck}
            onClick={submitBooking}
          >
            {loading ? "Booking…" : "Confirm booking"}
          </button>
        </section>
      )}

      {step === "done" && (
        <section className="mt-6 space-y-3">
          <div className="rounded-lg bg-emerald-50 px-4 py-4 text-sm text-emerald-800">
            <p className="font-medium">Booked for {confirmedDate}.</p>
            {dateChanged && <p className="mt-1">Your requested date was full, so we moved you to the next available date.</p>}
          </div>
          <button className="text-sm text-brand-600 underline" onClick={() => router.push("/portal/dashboard")}>
            Back to my projects
          </button>
        </section>
      )}
    </div>
  );
}
