"use client";

import { useEffect, useState } from "react";
import type { Customer, Company } from "@/lib/types";
import { ContactDetailDialog, JobList, formatPhoneInput, type JobSummary } from "@/components/admin/ContactDetailDialog";

export default function CompaniesDirectory() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  async function loadCompanies(q = search) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/companies${q ? `?q=${encodeURIComponent(q)}` : ""}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load companies");
      setCompanies(data.companies);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load companies");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadCompanies();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <div className="flex items-center justify-end gap-2">
        <button
          onClick={() => setAdding(true)}
          className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white"
        >
          ADD COMPANY
        </button>
      </div>

      <div className="mt-3 flex gap-2">
        <input
          className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
          placeholder="Search by company name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && loadCompanies()}
        />
        <button onClick={() => loadCompanies()} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
          Search
        </button>
      </div>

      {error && <div className="mt-3 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}

      {loading ? (
        <p className="mt-6 text-sm text-slate-500">Loading…</p>
      ) : companies.length === 0 ? (
        <p className="mt-6 text-sm text-slate-500">No companies found.</p>
      ) : (
        <div className="mt-4 space-y-2">
          {companies.map((c) => (
            <button
              key={c.id}
              onClick={() => setSelectedId(c.id)}
              className="w-full rounded-lg border border-slate-200 bg-white p-3 text-left hover:border-brand-400"
            >
              <div className="font-medium text-slate-800">{c.name}</div>
              {c.billing_address && <div className="text-sm text-slate-500">{c.billing_address}</div>}
            </button>
          ))}
        </div>
      )}

      {adding && (
        <CompanyAddForm
          onClose={() => setAdding(false)}
          onDone={() => {
            setAdding(false);
            loadCompanies();
          }}
        />
      )}

      {selectedId && (
        <CompanyDetailDialog
          companyId={selectedId}
          onClose={() => setSelectedId(null)}
          onChanged={() => loadCompanies()}
        />
      )}
    </div>
  );
}

function CompanyAddForm({
  onClose, onDone,
}: {
  onClose: () => void;
  onDone: () => void;
}) {
  const [name, setName] = useState("");
  const [billingAddress, setBillingAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/companies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          billingAddress: billingAddress.trim() || undefined,
          phone: phone.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to add company");
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add company");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black/40 px-4">
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl bg-white p-5">
        <h3 className="font-semibold text-slate-800">Add company</h3>

        {error && <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

        <label className="mt-3 block text-sm font-medium text-slate-700">Company name *</label>
        <input className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Boston Harbor Water Restoration" />

        <label className="mt-3 block text-sm font-medium text-slate-700">Billing address</label>
        <input className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" value={billingAddress} onChange={(e) => setBillingAddress(e.target.value)} />

        <label className="mt-3 block text-sm font-medium text-slate-700">Phone</label>
        <input className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" value={phone} onChange={(e) => setPhone(formatPhoneInput(e.target.value))} />

        <div className="mt-4 flex gap-2">
          <button
            onClick={submit}
            disabled={submitting || !name.trim()}
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

function CompanyEditForm({
  company, onClose, onDone,
}: {
  company: Company;
  onClose: () => void;
  onDone: () => void;
}) {
  const [name, setName] = useState(company.name);
  const [billingAddress, setBillingAddress] = useState(company.billing_address ?? "");
  const [phone, setPhone] = useState(company.phone ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/companies/${company.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          billing_address: billingAddress.trim() || null,
          phone: phone.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save company");
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save company");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black/40 px-4">
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl bg-white p-5">
        <h3 className="font-semibold text-slate-800">Edit company</h3>

        {error && <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

        <label className="mt-3 block text-sm font-medium text-slate-700">Company name *</label>
        <input className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" value={name} onChange={(e) => setName(e.target.value)} />

        <label className="mt-3 block text-sm font-medium text-slate-700">Billing address</label>
        <input className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" value={billingAddress} onChange={(e) => setBillingAddress(e.target.value)} />

        <label className="mt-3 block text-sm font-medium text-slate-700">Phone</label>
        <input className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" value={phone} onChange={(e) => setPhone(formatPhoneInput(e.target.value))} />

        <div className="mt-4 flex gap-2">
          <button
            onClick={submit}
            disabled={submitting || !name.trim()}
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

function AddContactForm({
  companyId, onClose, onDone,
}: {
  companyId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), phone: phone.trim(), companyId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to add contact");
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add contact");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black/40 px-4">
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl bg-white p-5">
        <h3 className="font-semibold text-slate-800">Add contact</h3>

        {error && <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

        <label className="mt-3 block text-sm font-medium text-slate-700">Name *</label>
        <input className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Ryan Hammond" />

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

        <div className="mt-4 flex gap-2">
          <button
            onClick={submit}
            disabled={submitting || !name.trim() || !email.trim()}
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

function GoogleLink({ company }: { company: Company }) {
  const searchUrl = `https://www.google.com/search?q=${encodeURIComponent([company.name, company.billing_address].filter(Boolean).join(" "))}`;
  return (
    <a href={searchUrl} target="_blank" rel="noreferrer" className="text-xs font-medium text-brand-600 hover:underline">
      View on Google ↗
    </a>
  );
}

export function CompanyDetailDialog({
  companyId, onClose, onChanged,
}: {
  companyId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [company, setCompany] = useState<Company | null>(null);
  const [contacts, setContacts] = useState<Customer[]>([]);
  const [jobs, setJobs] = useState<(JobSummary & { customer_id: string })[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"contacts" | "projects">("contacts");
  const [editing, setEditing] = useState(false);
  const [addingContact, setAddingContact] = useState(false);
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
  const [phoneInput, setPhoneInput] = useState("");
  const [savingPhone, setSavingPhone] = useState(false);
  const [savingBillingContact, setSavingBillingContact] = useState(false);
  const [savingInvoiceCc, setSavingInvoiceCc] = useState(false);
  const [invoiceCcSelect, setInvoiceCcSelect] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const res = await fetch(`/api/admin/companies/${companyId}`);
    const data = await res.json();
    if (res.ok) {
      setCompany(data.company);
      setContacts(data.contacts);
      setJobs(data.jobs);
      setPhoneInput(data.company.phone ?? "");
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
    setTab("contacts");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  async function savePhone() {
    if (!company || phoneInput === (company.phone ?? "")) return;
    setSavingPhone(true);
    try {
      const res = await fetch(`/api/admin/companies/${companyId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: phoneInput.trim() || null }),
      });
      const data = await res.json();
      if (res.ok) {
        setCompany(data.company);
        onChanged();
      }
    } finally {
      setSavingPhone(false);
    }
  }

  async function saveBillingContact(contactId: string) {
    setSavingBillingContact(true);
    try {
      const res = await fetch(`/api/admin/companies/${companyId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ billing_contact_id: contactId || null }),
      });
      const data = await res.json();
      if (res.ok) {
        setCompany(data.company);
        onChanged();
      }
    } finally {
      setSavingBillingContact(false);
    }
  }

  async function saveInvoiceCcContacts(contactIds: string[]) {
    setSavingInvoiceCc(true);
    try {
      const res = await fetch(`/api/admin/companies/${companyId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoice_cc_contact_ids: contactIds }),
      });
      const data = await res.json();
      if (res.ok) {
        setCompany(data.company);
        onChanged();
      }
    } finally {
      setSavingInvoiceCc(false);
    }
  }

  async function deleteCompany() {
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/admin/companies/${companyId}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "Failed to delete company");
      }
      onChanged();
      onClose();
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : "Failed to delete company");
      setDeleting(false);
    }
  }

  if (editing && company) {
    return (
      <CompanyEditForm
        company={company}
        onClose={() => setEditing(false)}
        onDone={() => {
          setEditing(false);
          load();
          onChanged();
        }}
      />
    );
  }

  if (addingContact) {
    return (
      <AddContactForm
        companyId={companyId}
        onClose={() => setAddingContact(false)}
        onDone={() => {
          setAddingContact(false);
          load();
          onChanged();
        }}
      />
    );
  }

  if (selectedContactId) {
    return (
      <ContactDetailDialog
        customerId={selectedContactId}
        onClose={() => setSelectedContactId(null)}
        onChanged={() => {
          load();
          onChanged();
        }}
      />
    );
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black/40 px-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-5">
        {loading || !company ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : (
          <>
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="font-semibold text-slate-800">{company.name}</h3>
                <GoogleLink company={company} />
              </div>
              <button onClick={onClose} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>

            <div className="mt-3 space-y-1 text-sm">
              {company.billing_address && <div><span className="text-slate-500">Billing address </span>{company.billing_address}</div>}
              <div className="flex items-center gap-2">
                <span className="text-slate-500">Phone </span>
                <input
                  className="flex-1 rounded-md border border-transparent px-1.5 py-0.5 text-sm hover:border-slate-200 focus:border-slate-300 focus:outline-none"
                  value={phoneInput}
                  placeholder="—"
                  onChange={(e) => setPhoneInput(formatPhoneInput(e.target.value))}
                  onBlur={savePhone}
                />
                {savingPhone && <span className="text-xs text-slate-400">Saving…</span>}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-slate-500">Billing contact </span>
                <select
                  className="flex-1 rounded-md border border-transparent px-1.5 py-0.5 text-sm hover:border-slate-200 focus:border-slate-300 focus:outline-none"
                  value={company.billing_contact_id ?? ""}
                  onChange={(e) => saveBillingContact(e.target.value)}
                  title="Who invoices for this company's projects get sent to — the project's own contact is Cc'd automatically"
                >
                  <option value="">Use each project's own contact</option>
                  {contacts.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                {savingBillingContact && <span className="text-xs text-slate-400">Saving…</span>}
              </div>
            </div>

            <div className="mt-4 flex gap-1 border-b border-slate-200">
              <button
                onClick={() => setTab("contacts")}
                className={`px-3 py-1.5 text-sm font-medium ${tab === "contacts" ? "border-b-2 border-brand-600 text-brand-600" : "text-slate-500"}`}
              >
                Contacts ({contacts.length})
              </button>
              <button
                onClick={() => setTab("projects")}
                className={`px-3 py-1.5 text-sm font-medium ${tab === "projects" ? "border-b-2 border-brand-600 text-brand-600" : "text-slate-500"}`}
              >
                Projects ({jobs.length})
              </button>
            </div>

            {tab === "contacts" && (
              <div className="mt-3">
                {contacts.length === 0 ? (
                  <p className="text-sm text-slate-500">No contacts yet.</p>
                ) : (
                  <div className="space-y-1">
                    {contacts.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => setSelectedContactId(c.id)}
                        className="w-full rounded-lg border border-slate-100 px-2 py-1.5 text-left text-sm hover:border-brand-300"
                      >
                        <div className="font-medium text-slate-800">{c.name}</div>
                        <div className="flex items-baseline justify-between text-slate-500">
                          <span>{c.email}</span>
                          <span>{c.phone || "—"}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
                <button onClick={() => setAddingContact(true)} className="mt-2 text-xs font-medium text-brand-600">+ Add contact</button>
              </div>
            )}

            {tab === "projects" && (
              <div className="mt-3">
                <JobList jobs={jobs} />
              </div>
            )}

            <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-4">
              <button onClick={() => setEditing(true)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm">
                Edit
              </button>
              <button
                onClick={() => setConfirmingDelete(true)}
                aria-label="Delete company"
                className="rounded-lg p-2 text-lg hover:bg-red-50"
              >
                🗑️
              </button>
            </div>
          </>
        )}
      </div>

      {confirmingDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-sm rounded-xl bg-white p-5">
            <h3 className="font-semibold text-slate-800">Delete this company?</h3>
            <p className="mt-2 text-sm text-slate-600">This action is permanent. Are you sure you want to delete this company?</p>
            {deleteError && <p className="mt-2 text-sm text-red-600">{deleteError}</p>}
            <div className="mt-4 flex gap-2">
              <button
                onClick={deleteCompany}
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
