"use client";

import { useEffect, useState } from "react";
import type { Company, Customer } from "@/lib/types";
import { ComboboxInput, formatDate } from "@/components/admin/JobsDashboard";
import { joinName, splitFullName, toTitleCase } from "@/lib/name";
import { telHref } from "@/lib/phone";
import AddressAutocompleteInput from "@/components/shared/AddressAutocompleteInput";
import ZipInput, { useAutoZip } from "@/components/shared/ZipInput";
import { buildBillingAddress, parseAddressToFields, US_STATES, expandAddress } from "@/lib/address";
import { NEWTON_FIRE_FLOOD_COMPANY_ID } from "@/lib/report-findings";

export interface JobSummary {
  id: string;
  project_number: string | null;
  service_address: string;
  requested_date: string | null;
  status: string;
}

// Formats digits into XXX-XXX-XXXX as they're typed, matching the
// dash-separated format already used for real contact phone numbers.
export function formatPhoneInput(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 10);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
}

export function JobList({ jobs }: { jobs: JobSummary[] }) {
  if (jobs.length === 0) return <p className="mt-2 text-sm text-slate-500">No projects yet.</p>;
  return (
    <div className="mt-2 space-y-1">
      {jobs.map((j) => (
        // A plain <a> (not next/link) — this opens a different page
        // (/admin/dashboard) entirely, so a full navigation is simplest and
        // avoids the soft-navigation staleness a client-side route change
        // could otherwise leave behind (see the same choice on the
        // Project Info tab's Customer name link).
        <a
          key={j.id}
          href={`/admin/dashboard?jobId=${j.id}`}
          className="block overflow-x-auto whitespace-nowrap rounded-lg border border-slate-100 px-2 py-1.5 text-sm hover:border-brand-400"
        >
          <span className="font-mono text-xs text-slate-500">{j.project_number ?? "—"}</span>{" "}
          {expandAddress(j.service_address)} <span className="text-slate-400">· {j.requested_date ? formatDate(j.requested_date) : "unscheduled"}</span>
        </a>
      ))}
    </div>
  );
}

// A contact is any individual person — an individual who's the client
// themselves, or one of several employees at a company (Boston Harbor Water
// Restoration might have both Joe Kline and Ryan Hammond on file). The
// Company field/picker here is what tells the two apart, not a separate
// record type.
export function ContactForm({
  onClose, onDone, initial, prefill,
}: {
  onClose: () => void;
  onDone: (customer?: Customer) => void;
  initial?: Customer;
  // Pre-fills a brand-new contact from whatever the caller already had
  // typed elsewhere (e.g. Add Project's Name/Company field before it found
  // no match in the Directory) — distinct from `initial`, which prefills a
  // full existing record for editing.
  prefill?: { isCompany?: boolean; name?: string; company?: string; phone?: string };
}) {
  const [isCompany, setIsCompany] = useState(initial ? !initial.is_individual : (prefill?.isCompany ?? false));
  const [company, setCompany] = useState(initial?.company ?? prefill?.company ?? "");
  const [companyId, setCompanyId] = useState(initial?.company_id ?? "");
  const initialName = splitFullName(initial?.name ?? prefill?.name);
  const [firstName, setFirstName] = useState(initialName.first);
  const [lastName, setLastName] = useState(initialName.last);
  const [email, setEmail] = useState(initial?.email ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? prefill?.phone ?? "");
  const addressInit = parseAddressToFields(initial?.billing_address);
  const [street, setStreet] = useState(addressInit.street);
  const [unit, setUnit] = useState(addressInit.unit);
  const [city, setCity] = useState(addressInit.city);
  const [addrState, setAddrState] = useState(addressInit.state || "MA");
  const [zip, setZip] = useState(addressInit.zip);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useAutoZip(street, city, addrState, setZip, "/api/admin");

  const canSubmit = firstName.trim() && lastName.trim() && email.trim() && (!isCompany || company.trim());

  async function searchCompanies(q: string): Promise<Company[]> {
    const res = await fetch(`/api/admin/companies?q=${encodeURIComponent(q)}`);
    const data = await res.json();
    return data.companies ?? [];
  }

  function selectCompany(c: Company) {
    setCompany(c.name);
    setCompanyId(c.id);
  }

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const billingAddress = buildBillingAddress({ street, unit, city, state: addrState, zip });
      const url = initial ? `/api/admin/customers/${initial.id}` : "/api/admin/customers";
      const res = await fetch(url, {
        method: initial ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: joinName(firstName, lastName),
          company: isCompany ? company.trim() : null,
          // Explicit null (not just omitted) when switching to Individual —
          // otherwise a contact whose company/company_id was already set
          // (stray data, or a prior Company-contact save) keeps pointing at
          // that company even though it now reads as an individual. When a
          // suggestion was picked (companyId set), send it so the backend
          // links directly to that row instead of falling back to
          // upsertCompany's fuzzy name match.
          ...(isCompany ? (companyId ? { companyId } : {}) : { companyId: null }),
          is_individual: !isCompany,
          email: email.trim(),
          phone: phone.trim(),
          billingAddress: billingAddress.trim() || null,
          billing_address: billingAddress.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save contact");
      onDone(data.customer);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save contact");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black/40 px-4">
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl bg-white p-5">
        <h3 className="font-semibold text-slate-800">{initial ? "Edit contact" : "Add contact"}</h3>

        {error && <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

        <div className="mt-4 flex gap-6">
          <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
            <input
              type="radio"
              name="contactType"
              checked={!isCompany}
              onChange={() => setIsCompany(false)}
              className="h-4 w-4 accent-brand-600"
            />
            Individual
          </label>
          <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
            <input
              type="radio"
              name="contactType"
              checked={isCompany}
              onChange={() => setIsCompany(true)}
              className="h-4 w-4 accent-brand-600"
            />
            Company contact
          </label>
        </div>

        {isCompany && (
          <>
            <label className="mt-3 block text-sm font-medium text-slate-700">Company *</label>
            <div className="mt-1">
              <ComboboxInput
                value={company}
                onChange={(v) => { setCompany(v); setCompanyId(""); }}
                fetchOptions={searchCompanies}
                getLabel={(c) => c.name}
                onSelect={selectCompany}
                placeholder="e.g. Boston Harbor Water Restoration"
              />
            </div>
          </>
        )}

        <label className="mt-3 block text-sm font-medium text-slate-700">Name *</label>
        <div className="mt-1 flex gap-2">
          <input className="w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="First name" />
          <input className="w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Last name" />
        </div>

        <div className="mt-3 flex gap-2">
          <div className="flex-1">
            <label className="block text-sm font-medium text-slate-700">Email *</label>
            <input type="email" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="flex-1">
            <label className="block text-sm font-medium text-slate-700">Phone</label>
            <input className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" value={phone} onChange={(e) => setPhone(formatPhoneInput(e.target.value))} />
          </div>
        </div>

        {!isCompany && (
          <>
            <label className="mt-3 block text-sm font-medium text-slate-700">Billing address</label>
            <div className="mt-1 flex gap-1.5">
              <div className="w-0 flex-1">
                <AddressAutocompleteInput
                  apiBase="/api/admin"
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
                apiBase="/api/admin"
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
              <ZipInput street={street} city={city} state={addrState} zip={zip} setZip={setZip} apiBase="/api/admin" />
            </div>
          </>
        )}

        <div className="mt-4 flex gap-2">
          <button
            onClick={submit}
            disabled={submitting || !canSubmit}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {submitting ? "Saving…" : "Save"}
          </button>
          <button onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

export function ContactDetailDialog({
  customerId, onClose, onChanged,
}: {
  customerId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  const [inviteDrafted, setInviteDrafted] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [sendingCardLink, setSendingCardLink] = useState(false);
  const [cardLinkDrafted, setCardLinkDrafted] = useState(false);
  const [cardLinkError, setCardLinkError] = useState<string | null>(null);
  const [hasUnlinkedAuthAccount, setHasUnlinkedAuthAccount] = useState(false);
  const [linking, setLinking] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [merging, setMerging] = useState(false);
  const [mergeQuery, setMergeQuery] = useState("");
  const [mergeTarget, setMergeTarget] = useState<Customer | null>(null);
  const [mergeSubmitting, setMergeSubmitting] = useState(false);
  const [mergeError, setMergeError] = useState<string | null>(null);
  const [confirmingMerge, setConfirmingMerge] = useState(false);

  async function load() {
    setLoading(true);
    const res = await fetch(`/api/admin/customers/${customerId}`);
    const data = await res.json();
    if (res.ok) {
      setCustomer(data.customer);
      setJobs(data.jobs);
      setHasUnlinkedAuthAccount(!!data.hasUnlinkedAuthAccount);
    }
    setLoading(false);
  }

  async function linkAuth() {
    setLinking(true);
    setLinkError(null);
    try {
      const res = await fetch(`/api/admin/customers/${customerId}/link-auth`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to link account");
      setCustomer(data.customer);
      setHasUnlinkedAuthAccount(false);
      onChanged();
    } catch (e) {
      setLinkError(e instanceof Error ? e.message : "Failed to link account");
    } finally {
      setLinking(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId]);

  async function deleteContact() {
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/admin/customers/${customerId}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "Failed to delete contact");
      }
      onChanged();
      onClose();
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : "Failed to delete contact");
      setDeleting(false);
    }
  }

  async function sendInvite() {
    setInviting(true);
    setInviteError(null);
    try {
      const res = await fetch(`/api/admin/customers/${customerId}/invite`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to create invite draft");
      setInviteDrafted(true);
    } catch (e) {
      setInviteError(e instanceof Error ? e.message : "Failed to create invite draft");
    } finally {
      setInviting(false);
    }
  }

  async function sendCardOnFileLink() {
    setSendingCardLink(true);
    setCardLinkError(null);
    try {
      const res = await fetch(`/api/admin/customers/${customerId}/payment-method-link`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to create card setup draft");
      setCardLinkDrafted(true);
    } catch (e) {
      setCardLinkError(e instanceof Error ? e.message : "Failed to create card setup draft");
    } finally {
      setSendingCardLink(false);
    }
  }

  async function mergeIntoTarget() {
    if (!mergeTarget) return;
    setMergeSubmitting(true);
    setMergeError(null);
    try {
      const res = await fetch("/api/admin/customers/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ survivorId: mergeTarget.id, loserId: customerId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to merge contacts");
      onChanged();
      onClose();
    } catch (e) {
      setMergeError(e instanceof Error ? e.message : "Failed to merge contacts");
      setConfirmingMerge(false);
    } finally {
      setMergeSubmitting(false);
    }
  }

  if (editing && customer) {
    return (
      <ContactForm
        initial={customer}
        onClose={() => setEditing(false)}
        onDone={() => {
          setEditing(false);
          load();
          onChanged();
        }}
      />
    );
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black/40 px-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-5">
        {loading || !customer ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : (
          <>
            <div className="flex items-start justify-between gap-2">
              <h3 className="font-semibold text-slate-800">{toTitleCase(customer.name)}</h3>
              <button onClick={onClose} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>

            <div className="mt-3 space-y-1 text-sm">
              {customer.is_individual ? (
                <div>Individual</div>
              ) : (
                customer.company && <div><span className="text-slate-500">Company </span>{customer.company}</div>
              )}
              <div>
                <span className="text-slate-500">Phone </span>
                {customer.phone ? <a href={telHref(customer.phone)} className="text-brand-700 hover:underline">{customer.phone}</a> : "—"}
              </div>
              <div><span className="text-slate-500">Email </span>{customer.email}</div>
              {/* Billing address is a company-level concern once this contact
                  belongs to one — shown on the company's own record instead,
                  not repeated on every employee's card. Only a standalone
                  contact (no company) shows their own billing address here. */}
              {!customer.company && customer.billing_address && (
                <div><span className="text-slate-500">Billing address </span>{expandAddress(customer.billing_address)}</div>
              )}
            </div>

            {customer.auth_user_id && customer.onboarding_completed_at ? (
              <div className="mt-4 border-t border-slate-100 pt-4 text-sm uppercase text-emerald-700">
                <span>Portal login </span>
                <span>Connected</span>
              </div>
            ) : customer.auth_user_id ? (
              // The invite link/auth account exists (Supabase creates it the
              // instant generateLink runs, not when they actually click it —
              // see the on_auth_user_created trigger in schema.sql), but
              // onboarding_completed_at only gets set once they finish
              // setting a password and submitting their profile. Without
              // this distinct state, "Connected" would show — and the
              // "Draft invite link" / "Invite" button would permanently
              // disappear — the moment an invite is sent, even if they
              // never open the email.
              <div className="mt-4 border-t border-slate-100 pt-4">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Portal login</h4>
                <p className="mt-1 text-sm text-slate-500">Invited — hasn&apos;t finished setting up their login yet.</p>
                {inviteError && <p className="mt-2 text-sm text-red-600">{inviteError}</p>}
                <button
                  onClick={sendInvite}
                  disabled={inviting || !customer.email}
                  className="mt-2 rounded-lg border border-slate-300 px-3 py-1.5 text-sm disabled:opacity-50"
                  title="Their original link may have expired — this generates a fresh one and drafts a new email with it"
                >
                  {inviting ? "Drafting…" : "Draft new invite link"}
                </button>
                {inviteDrafted && (
                  <p className="mt-1.5 text-xs text-slate-400">
                    Drafted in Gmail — review it in your Drafts folder and hit send yourself.
                  </p>
                )}
              </div>
            ) : hasUnlinkedAuthAccount ? (
              <div className="mt-4 border-t border-slate-100 pt-4">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Portal login</h4>
                <p className="mt-1 text-sm text-slate-500">
                  A portal login already exists for {customer.email} — they signed up but never
                  finished onboarding, so it was never connected to this contact.
                </p>
                {linkError && <p className="mt-2 text-sm text-red-600">{linkError}</p>}
                <button
                  onClick={linkAuth}
                  disabled={linking}
                  className="mt-2 rounded-lg border border-slate-300 px-3 py-1.5 text-sm disabled:opacity-50"
                >
                  {linking ? "Linking…" : "Link existing portal account"}
                </button>
              </div>
            ) : customer.is_individual ? (
              // An invite link's whole purpose is bringing someone onto a
              // team (see the company-only branch below) — an individual
              // has no team to join, so there's nothing to invite them
              // into, and no admin action applies here. Just the same
              // plain status line the "Connected" branch above uses,
              // rather than a paragraph explaining why it's not connected.
              <div className="mt-4 border-t border-slate-100 pt-4 text-sm uppercase text-slate-400">
                <span>Portal login </span>
                <span>Not connected</span>
              </div>
            ) : (
              <div className="mt-4 border-t border-slate-100 pt-4">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Portal login</h4>
                <p className="mt-1 text-sm text-slate-500">No portal login yet.</p>
                {inviteError && <p className="mt-2 text-sm text-red-600">{inviteError}</p>}
                <button
                  onClick={sendInvite}
                  disabled={inviting || !customer.email}
                  className="mt-2 rounded-lg border border-slate-300 px-3 py-1.5 text-sm disabled:opacity-50"
                >
                  {inviting ? "Drafting…" : "Draft invite link"}
                </button>
                {inviteDrafted && (
                  <p className="mt-1.5 text-xs text-slate-400">
                    Drafted in Gmail — review it in your Drafts folder and hit send yourself.
                  </p>
                )}
              </div>
            )}

            {/* Per Tim, 2026-08-27 — Newton Fire & Flood only, for now: a
                card on file that gets charged automatically 30 days after
                each invoice goes out, instead of a manual "Pay" click
                every time. See payment-method-link/route.ts and the
                net-30 cron (net30-autocharge.ts) for the other two
                pieces — this button is just what starts it. */}
            {customer.company_id === NEWTON_FIRE_FLOOD_COMPANY_ID && (
              <div className="mt-4 border-t border-slate-100 pt-4">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Automatic Payment</h4>
                <p className="mt-1 text-sm text-slate-500">
                  Once a card is on file, invoices are charged automatically 30 days after they go out.
                </p>
                {cardLinkError && <p className="mt-2 text-sm text-red-600">{cardLinkError}</p>}
                <button
                  onClick={sendCardOnFileLink}
                  disabled={sendingCardLink || !customer.email}
                  className="mt-2 rounded-lg border border-slate-300 px-3 py-1.5 text-sm disabled:opacity-50"
                >
                  {sendingCardLink ? "Drafting…" : "Draft card-on-file setup link"}
                </button>
                {cardLinkDrafted && (
                  <p className="mt-1.5 text-xs text-slate-400">
                    Drafted in Gmail — review it in your Drafts folder and hit send yourself.
                  </p>
                )}
              </div>
            )}

            <div className="mt-4 border-t border-slate-100 pt-4">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Projects ({jobs.length})</h4>
              <JobList jobs={jobs} />
            </div>

            <div className="mt-4 border-t border-slate-100 pt-4">
              {!merging ? (
                <button onClick={() => setMerging(true)} className="text-sm text-brand-600 underline">
                  Merge into another contact…
                </button>
              ) : (
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Merge into another contact</h4>
                  {mergeError && <p className="mt-2 text-sm text-red-600">{mergeError}</p>}
                  <div className="mt-2">
                    <ComboboxInput
                      value={mergeTarget ? mergeTarget.name : mergeQuery}
                      onChange={(v) => {
                        setMergeQuery(v);
                        setMergeTarget(null);
                      }}
                      fetchOptions={async (q) => {
                        const res = await fetch(`/api/admin/customers?q=${encodeURIComponent(q)}`);
                        const data = await res.json();
                        return ((data.customers ?? []) as Customer[]).filter((c) => c.id !== customerId);
                      }}
                      getLabel={(c: Customer) => c.name}
                      getSublabel={(c: Customer) => c.email}
                      onSelect={(c: Customer) => {
                        setMergeTarget(c);
                        setMergeQuery("");
                      }}
                      placeholder="Search contacts by name, company, or email…"
                    />
                  </div>
                  <div className="mt-3 flex gap-2">
                    <button
                      onClick={() => setConfirmingMerge(true)}
                      disabled={!mergeTarget}
                      className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                    >
                      Merge
                    </button>
                    <button
                      onClick={() => {
                        setMerging(false);
                        setMergeTarget(null);
                        setMergeQuery("");
                        setMergeError(null);
                      }}
                      className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-4">
              <button onClick={() => setEditing(true)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm">
                Edit
              </button>
              <button
                onClick={() => setConfirmingDelete(true)}
                aria-label="Delete contact"
                className="rounded-lg p-2 text-lg hover:bg-red-50"
              >
                🗑️
              </button>
            </div>
          </>
        )}
      </div>

      {confirmingMerge && mergeTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-sm rounded-xl bg-white p-5">
            <h3 className="font-semibold text-slate-800">Merge into {mergeTarget.name}?</h3>
            <p className="mt-2 text-sm text-slate-600">
              This action is permanent. {customer?.name}&apos;s projects, saved addresses, and portal login (if any) move onto {mergeTarget.name}, and this record is deleted.
            </p>
            <div className="mt-4 flex gap-2">
              <button
                onClick={mergeIntoTarget}
                disabled={mergeSubmitting}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
              >
                {mergeSubmitting ? "MERGING…" : "MERGE"}
              </button>
              <button
                onClick={() => setConfirmingMerge(false)}
                disabled={mergeSubmitting}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmingDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-sm rounded-xl bg-white p-5">
            <h3 className="font-semibold text-slate-800">Delete this contact?</h3>
            <p className="mt-2 text-sm text-slate-600">This action is permanent. Are you sure you want to delete this contact?</p>
            {deleteError && <p className="mt-2 text-sm text-red-600">{deleteError}</p>}
            <div className="mt-4 flex gap-2">
              <button
                onClick={deleteContact}
                disabled={deleting}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
              >
                {deleting ? "DELETING…" : "DELETE"}
              </button>
              <button
                onClick={() => setConfirmingDelete(false)}
                disabled={deleting}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
