"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AddressAutocompleteInput from "@/components/shared/AddressAutocompleteInput";
import ZipInput, { useAutoZip } from "@/components/shared/ZipInput";
import { buildBillingAddress, US_STATES } from "@/lib/address";
import { formatPhoneNumber } from "@/lib/phone";
import { formatDateMDY } from "@/lib/date-format";
import { createSupabaseBrowserClient, createSupabaseEmailLinkClient } from "@/lib/supabase-browser";

interface ServiceTypeOption {
  key: string;
  label: string;
  rateLabel: string;
}

type Step = "address" | "category" | "scope" | "date" | "account" | "review" | "done" | "check-email" | "already-registered";

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// 30-minute slots from 5:00 AM to 7:30 PM — mirrors PortalBookingForm.tsx.
const TIME_OPTIONS: string[] = [];
for (let totalMinutes = 5 * 60; totalMinutes <= 19 * 60 + 30; totalMinutes += 30) {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  TIME_OPTIONS.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
}

function formatDate(isoDate: string): string {
  return formatDateMDY(isoDate) ?? isoDate;
}

function formatPreferredTime(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return hhmm;
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 || 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${period}`;
}

function serviceTypeSubtext(key: string): string | null {
  if (key === "asbestos_bulk") return "Sampling of specific area(s) as determined by the client";
  if (key === "asbestos_pre_reno") return "Sampling of materials prior to a renovation project";
  if (key === "asbestos_pre_demo") return "Sampling of materials prior to a demolition project";
  if (key === "mold_air") return "Sampling of indoor air quality";
  if (key === "mold_bulk") return "Sampling of mold growing on walls, ceilings, or other surfaces";
  if (key === "mold_swab") return "Sampling of surfaces";
  return null;
}

// Per Tim, 2026-09-02 — "mold_bulk" should read "Mold Surface Sampling" on
// this booking form specifically, not "Mold Bulk Sampling" (the settings-
// editable label used everywhere else — admin, invoices, reports). Display-
// only override, same pattern as serviceTypeSubtext above; the underlying
// key/label from settings.service_types is unchanged.
function serviceTypeDisplayLabel(key: string, fallbackLabel: string): string {
  if (key === "mold_bulk") return "Mold Surface Sampling";
  // Per Tim, 2026-09-02 — "lead bulk sampling box should just say lead
  // paint sampling" (its category header is hidden below since it's the
  // only item in that category and would otherwise just repeat this).
  if (key === "lead_bulk") return "Lead Paint Sampling";
  return fallbackLabel;
}

const CATEGORY_LABELS: Record<string, string> = {
  asbestos: "Asbestos Inspection",
  mold: "Mold Inspection",
  lead: "Lead Paint Sampling",
};

function categoryKeyOf(serviceTypeKey: string): string {
  return serviceTypeKey.split("_")[0];
}

function categoryLabelOf(categoryKeyValue: string): string {
  return CATEGORY_LABELS[categoryKeyValue] ?? categoryKeyValue;
}

const ASBESTOS_EXCLUSIVE_KEYS = ["asbestos_bulk", "asbestos_pre_reno", "asbestos_pre_demo"];

// Individuals-only guest counterpart of PortalBookingForm.tsx — reachable
// with no session at all (see portal/book/page.tsx), since a brand-new
// homeowner shouldn't need an account until the very end. Every step here
// is the same address/category/scope/date wizard; the only real
// difference is one added "account" step (name/email/phone/password)
// right before Review, since there's no existing customer row to pull
// that from yet. Companies keep today's sign-in-first flow — see
// /portal/page.tsx's chooser — so there's no scheduleViaContact/separate
// job-site-contact step here at all.
export default function GuestBookingForm() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("address");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [street, setStreet] = useState("");
  const [unit, setUnit] = useState("");
  const [city, setCity] = useState("");
  const [addrState, setAddrState] = useState("MA");
  const [zip, setZip] = useState("");

  const [address, setAddress] = useState("");
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [distanceMiles, setDistanceMiles] = useState<number | null>(null);
  const [state, setState] = useState<string | null>(null);
  const [serviceTypes, setServiceTypes] = useState<ServiceTypeOption[]>([]);

  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [scopeOfWork, setScopeOfWork] = useState("");

  const [date, setDate] = useState(todayIso());
  const [preferredTime, setPreferredTime] = useState("");
  const [suggestedDate, setSuggestedDate] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [confirmedDate, setConfirmedDate] = useState<string | null>(null);
  // Set the instant /api/portal/book-guest succeeds — guards against
  // creating a second, duplicate job if the account-creation steps below
  // fail and the person hits "Confirm booking" again. Once this is set,
  // a retry only ever retries account creation, never the booking itself.
  const [jobId, setJobId] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  useAutoZip(street, city, addrState, setZip, "/api");

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
      setSelectedKeys(new Set());
      setStep("category");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  function toggleServiceType(key: string) {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        if (ASBESTOS_EXCLUSIVE_KEYS.includes(key)) {
          for (const exclusiveKey of ASBESTOS_EXCLUSIVE_KEYS) {
            if (exclusiveKey !== key) next.delete(exclusiveKey);
          }
        }
        next.add(key);
      }
      return next;
    });
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

  // Confirm booking does three things in one action: create the job (no
  // account needed for this part at all), then create the account with
  // the password just typed, then finish onboarding so they land straight
  // in an active dashboard — matching "fill out everything, only make an
  // account at the end."
  async function confirmBooking() {
    setLoading(true);
    setError(null);
    try {
      // Only ever runs once — a retry after this succeeds but account
      // creation below fails must not re-create the job. See jobId's
      // comment.
      if (!jobId) {
        const bookRes = await fetch("/api/portal/book-guest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            address, lat, lng, distanceMiles, state,
            serviceTypeKeys: Array.from(selectedKeys),
            scopeOfWork,
            date, requestedTime: preferredTime || null,
            notes, disclaimerAck: true,
            name, email, phone,
          }),
        });
        const bookData = await bookRes.json();
        if (!bookRes.ok) throw new Error(bookData.error ?? "Something went wrong");
        setJobId(bookData.jobId);
        setConfirmedDate(bookData.date);
      }

      // The booking above is already secured regardless of what happens
      // next — signUp only creates the login to track it. Uses the plain
      // (non-persisted) email-link client to initiate, not the regular
      // browser client — see that client's own comment: createBrowserClient()
      // hardcodes PKCE, which breaks the emailed confirmation link's
      // round-trip if one ends up being sent (confirmed live on the
      // equivalent password-reset flow). A session returned directly here
      // (confirmation off) is picked up on the *persisted* client below,
      // exactly like /portal/confirm does for the signup-link case.
      const emailLinkClient = createSupabaseEmailLinkClient();
      const { data: signUpData, error: signUpError } = await emailLinkClient.auth.signUp({
        email,
        password,
        options: {
          data: { account_type: "individual" },
          emailRedirectTo: `${window.location.origin}/portal/confirm`,
        },
      });
      if (signUpError) {
        // A previously-registered email signs up "successfully" with no
        // new identity created (Supabase's anti-enumeration behavior) —
        // there's no reliable error code to detect that case, so this
        // only ever fires for a real signup failure (weak password, rate
        // limit, an Auth-service-side mailer failure, etc). Wrapped in a
        // plain Error with our own wording rather than rethrown as-is —
        // signUpError's own .message can be a raw, malformed, or
        // unhelpful string straight from the Auth API response.
        throw new Error("We couldn't finish setting up your account. Your request has already been sent — try again in a moment, or contact us directly.");
      }
      // identities is empty (not absent) specifically for "email already
      // registered" under anti-enumeration behavior — a genuinely new user
      // always has at least one identity attached. This also legitimately
      // fires on a retry of this exact form: signUp can succeed while the
      // profile call below fails for an unrelated reason, so a second
      // attempt with the same email/password is really our own account,
      // not someone else's — sign in with what was just typed before
      // assuming it's a real conflict.
      let session = signUpData.session;
      if (signUpData.user && signUpData.user.identities?.length === 0) {
        const browserClient = createSupabaseBrowserClient();
        const { data: signInData } = await browserClient.auth.signInWithPassword({ email, password });
        if (!signInData.session) {
          setStep("already-registered");
          return;
        }
        session = signInData.session;
      }

      if (session) {
        const browserClient = createSupabaseBrowserClient();
        await browserClient.auth.setSession({
          access_token: session.access_token,
          refresh_token: session.refresh_token,
        });
        const profileRes = await fetch("/api/portal/profile", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, phone, accountType: "individual" }),
        });
        if (!profileRes.ok) {
          const profileData = await profileRes.json().catch(() => ({}));
          throw new Error(profileData.error ?? "Failed to finish setting up your account");
        }
        router.push("/portal/dashboard");
        router.refresh();
        return;
      }

      // No session came back — this Supabase project requires clicking an
      // emailed confirmation link. The booking is already in either way.
      setStep("check-email");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-md px-4 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-base font-bold uppercase text-brand-700">Book a project</h1>
        <Link href="/" aria-label="Cancel" className="text-slate-400 hover:text-slate-600">
          ✕
        </Link>
      </div>

      {error && <div className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {step === "address" && (
        <section className="mt-6 space-y-4">
          <div>
            <label className="block text-base font-medium text-slate-700">Enter job site address</label>
            <div className="mt-1 flex flex-col gap-1.5">
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
              <input
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder="Unit #"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
              />
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
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={addrState}
                onChange={(e) => setAddrState(e.target.value)}
              >
                {US_STATES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              <ZipInput street={street} city={city} state={addrState} zip={zip} setZip={setZip} apiBase="/api" />
            </div>
          </div>

          <button
            className="flex w-full items-center justify-center border-[3px] border-brand-700 bg-brand-50 py-3 pt-[14px] text-sm font-extrabold uppercase leading-none text-brand-700 hover:bg-yellow-100 disabled:opacity-50"
            disabled={loading || !street.trim() || !city.trim() || !addrState.trim()}
            onClick={() => checkAddress(buildBillingAddress({ street, unit, city, state: addrState, zip }))}
          >
            {loading ? "Checking…" : "Continue"}
          </button>

          <p className="text-center text-sm text-slate-500">
            Already have an account? <Link href="/portal/login" className="text-brand-600 underline">Sign in</Link>
          </p>
        </section>
      )}

      {step === "category" && (
        <section className="mt-6 space-y-4">
          <button className="text-sm text-brand-600 underline" onClick={() => setStep("address")}>
            ← Back
          </button>
          <p className="text-sm text-slate-600">{address}</p>
          <label className="block text-base font-medium text-slate-700">Service types</label>
          <div className="space-y-4">
            {/* Per Tim, 2026-09-02 — "delete mold swab sampling as an option
                in the booking screen": not offered here, same scoping as
                serviceTypeDisplayLabel above (this booking form only —
                still a normal service_types entry admins can pick for a
                job from the admin dashboard). */}
            {Array.from(new Set(serviceTypes.filter((s) => s.key !== "mold_swab").map((s) => categoryKeyOf(s.key)))).map((c) => {
              const subtypes = serviceTypes.filter((s) => categoryKeyOf(s.key) === c && s.key !== "mold_swab");
              return (
                // Per Tim, 2026-09-02 — Lead Paint Sampling drops down with
                // some extra breathing room, set apart from Mold Inspection
                // above it, now that it has no header of its own to mark
                // the category change.
                <div key={c} className={c === "lead" ? "mt-12" : undefined}>
                  {/* Per Tim, 2026-09-02 — "the lead paint sampling title
                      should just be removed": Lead Paint Sampling is the
                      only item in this category, and the box itself now
                      says that (see serviceTypeDisplayLabel above), so the
                      header would just repeat it. */}
                  {c !== "lead" && <div className="text-sm font-medium uppercase text-slate-700">{categoryLabelOf(c)}</div>}
                  <div className="mt-2 space-y-2">
                    {subtypes.map((s) => (
                      <label
                        key={s.key}
                        className={`flex w-full cursor-pointer items-start gap-2 rounded-lg border px-4 py-3 text-left font-medium ${
                          selectedKeys.has(s.key) ? "border-brand-600 bg-brand-50" : "border-slate-300 hover:border-brand-600"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={selectedKeys.has(s.key)}
                          onChange={() => toggleServiceType(s.key)}
                          className="mt-1 shrink-0 accent-brand-700"
                        />
                        <span>
                          <span className="block">{serviceTypeDisplayLabel(s.key, s.label)}</span>
                          {serviceTypeSubtext(s.key) && (
                            <span className="block text-xs font-normal text-slate-500">{serviceTypeSubtext(s.key)}</span>
                          )}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          <button
            className="flex w-full items-center justify-center border-[3px] border-brand-700 bg-brand-50 py-3 pt-[14px] text-sm font-extrabold uppercase leading-none text-brand-700 hover:bg-yellow-100 disabled:opacity-50"
            disabled={selectedKeys.size === 0}
            onClick={() => setStep("scope")}
          >
            Continue
          </button>
        </section>
      )}

      {step === "scope" && (
        <section className="mt-6 space-y-4">
          <button className="text-sm text-brand-600 underline" onClick={() => setStep("category")}>
            ← Back
          </button>
          <div>
            <label className="block text-base font-medium uppercase text-slate-700">Scope of work</label>
            <p className="mt-1 text-xs text-slate-500">
              What needs to be inspected or sampled? e.g. &ldquo;air quality concerns in my bedroom&rdquo; or &ldquo;renovating a bathroom and removing tiles + walls&rdquo;
            </p>
            <textarea
              className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2"
              rows={4}
              placeholder="Describe the scope of work"
              value={scopeOfWork}
              onChange={(e) => setScopeOfWork(e.target.value)}
            />
          </div>
          <button
            className="flex w-full items-center justify-center border-[3px] border-brand-700 bg-brand-50 py-3 pt-[14px] text-sm font-extrabold uppercase leading-none text-brand-700 hover:bg-yellow-100 disabled:opacity-50"
            disabled={!scopeOfWork.trim()}
            onClick={() => setStep("date")}
          >
            Continue
          </button>
        </section>
      )}

      {step === "date" && (
        <section className="mt-6 space-y-4">
          <button className="text-sm text-brand-600 underline" onClick={() => setStep("scope")}>
            ← Back
          </button>
          <div>
            <label className="block text-sm font-medium text-slate-700">Preferred date</label>
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
            <label className="block text-sm font-medium text-slate-700">Preferred time</label>
            <select
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              value={preferredTime}
              onChange={(e) => setPreferredTime(e.target.value)}
            >
              <option value="">No preference</option>
              {TIME_OPTIONS.map((t) => (
                <option key={t} value={t}>{formatPreferredTime(t)}</option>
              ))}
            </select>
            <p className="mt-1 text-xs text-slate-500">Leave blank if you don't have a preference.</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700">Notes</label>
            <textarea
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              rows={4}
              placeholder="Gate code, anything else we should know (optional)"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
          <button
            className="flex w-full items-center justify-center border-[3px] border-brand-700 bg-brand-50 py-3 pt-[14px] text-sm font-extrabold uppercase leading-none text-brand-700 hover:bg-yellow-100 disabled:opacity-50"
            disabled={loading || !!suggestedDate}
            onClick={() => setStep("account")}
          >
            Continue
          </button>
        </section>
      )}

      {step === "account" && (
        <section className="mt-6 space-y-4">
          <button className="text-sm text-brand-600 underline" onClick={() => setStep("date")}>
            ← Back
          </button>
          <p className="text-sm text-slate-600">
            Last step — your info, and a password so you can track this job afterward.
          </p>
          <input
            className="w-full rounded-lg border border-slate-300 px-3 py-2"
            placeholder="Your name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            className="w-full rounded-lg border border-slate-300 px-3 py-2 disabled:bg-slate-100 disabled:text-slate-500"
            placeholder="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            // Locked once the booking is already submitted (jobId set) —
            // the job's customer record is already tied to this exact
            // email server-side, so changing it here on a retry would
            // create the account under a different email than the one the
            // job is actually attached to, orphaning the booking.
            disabled={!!jobId}
          />
          <input
            className="w-full rounded-lg border border-slate-300 px-3 py-2"
            placeholder="Phone"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(formatPhoneNumber(e.target.value))}
          />
          <input
            className="w-full rounded-lg border border-slate-300 px-3 py-2"
            placeholder="Create a password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <input
            className="w-full rounded-lg border border-slate-300 px-3 py-2"
            placeholder="Confirm password"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
          />
          <button
            className="flex w-full items-center justify-center border-[3px] border-brand-700 bg-brand-50 py-3 pt-[14px] text-sm font-extrabold uppercase leading-none text-brand-700 hover:bg-yellow-100 disabled:opacity-50"
            disabled={
              !name.trim() || !email.trim() || !phone.trim() ||
              password.length < 6 || password !== confirmPassword
            }
            onClick={() => setStep("review")}
          >
            Continue
          </button>
        </section>
      )}

      {step === "review" && (
        <section className="mt-6 space-y-4">
          <button className="text-sm text-brand-600 underline" onClick={() => setStep("account")}>
            ← Back
          </button>

          <div className="space-y-3 rounded-lg border border-slate-200 px-4 py-3 text-sm">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Address</div>
              <div className="text-slate-700">{address}</div>
            </div>
            {(() => {
              const selected = serviceTypes.filter((s) => selectedKeys.has(s.key));
              return selected.length > 0 ? (
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Service{selected.length > 1 ? "s" : ""}
                  </div>
                  <div className="space-y-2">
                    {selected.map((s) => (
                      <div key={s.key}>
                        <div className="text-slate-700">{serviceTypeDisplayLabel(s.key, s.label)}</div>
                        {serviceTypeSubtext(s.key) && (
                          <div className="text-xs text-slate-500">{serviceTypeSubtext(s.key)}</div>
                        )}
                        <div className="text-slate-500">{s.rateLabel}</div>
                      </div>
                    ))}
                  </div>
                  {selected.length > 1 && (
                    <div className="mt-1 text-xs text-slate-400">
                      One base fee applies regardless of how many services are selected.
                    </div>
                  )}
                </div>
              ) : null;
            })()}
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Scope of work</div>
              <div className="whitespace-pre-wrap text-slate-700">{scopeOfWork}</div>
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Preferred date</div>
              <div className="text-slate-700">{formatDate(date)}</div>
            </div>
            {preferredTime && (
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Preferred time</div>
                <div className="text-slate-700">{formatPreferredTime(preferredTime)}</div>
              </div>
            )}
            {notes && (
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Notes</div>
                <div className="text-slate-700">{notes}</div>
              </div>
            )}
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Contact</div>
              <div className="text-slate-700">{[name, email, phone].filter(Boolean).join(" — ")}</div>
            </div>
          </div>

          <button
            className="flex w-full items-center justify-center border-[3px] border-brand-700 bg-brand-50 py-3 pt-[14px] text-sm font-extrabold uppercase leading-none text-brand-700 hover:bg-yellow-100 disabled:opacity-50"
            disabled={loading}
            onClick={confirmBooking}
          >
            {loading ? "Booking…" : jobId ? "Retry account setup" : "Confirm booking"}
          </button>
        </section>
      )}

      {step === "done" && (
        <section className="mt-6 space-y-3">
          <div className="rounded-lg bg-emerald-50 px-4 py-4 text-sm text-emerald-800">
            <p className="font-medium">
              {confirmedDate ? `Your request has been sent for ${formatDate(confirmedDate)}.` : "Request sent."}
            </p>
            <p className="mt-1">We'll confirm that date and time.</p>
          </div>
        </section>
      )}

      {step === "check-email" && (
        <section className="mt-6 space-y-3">
          <div className="rounded-lg bg-emerald-50 px-4 py-4 text-sm text-emerald-800">
            <p className="font-medium">
              {confirmedDate ? `Your request has been sent for ${formatDate(confirmedDate)}.` : "Your request has been sent."}
            </p>
            <p className="mt-1">We'll confirm that date and time.</p>
          </div>
          <div className="rounded-lg bg-slate-100 px-4 py-4 text-sm text-slate-600">
            <p>Check your email at {email} to activate your account and see this job any time.</p>
          </div>
        </section>
      )}

      {step === "already-registered" && (
        <section className="mt-6 space-y-3">
          <div className="rounded-lg bg-emerald-50 px-4 py-4 text-sm text-emerald-800">
            <p className="font-medium">
              {confirmedDate ? `Your request has been sent for ${formatDate(confirmedDate)}.` : "Your request has been sent."}
            </p>
            <p className="mt-1">We'll confirm that date and time.</p>
          </div>
          <div className="rounded-lg bg-slate-100 px-4 py-4 text-sm text-slate-600">
            <p>{email} already has an account — sign in to see this job.</p>
            <Link href="/portal/login" className="mt-2 inline-block text-brand-600 underline">
              Sign in
            </Link>
          </div>
        </section>
      )}
    </div>
  );
}
