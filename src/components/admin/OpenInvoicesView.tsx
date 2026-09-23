"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { formatCents } from "@/lib/pricing";
import { formatDateMDY } from "@/lib/date-format";
import { isPastDue } from "@/components/admin/BillingView";

interface OpenInvoiceRow {
  id: string;
  amountDueCents: number;
  dueDate: string | null;
  created: string;
  customerEmail: string | null;
  hostedInvoiceUrl: string | null;
  projectNumber: string | null;
  serviceAddress: string | null;
  customerName: string;
}

// Per Tim, 2026-09-23 — "my Stripe account has a ton of invoices that are
// open and they all list everywhere... I just want it to just be the
// active ones": Stripe's own Transactions page shows one row per payment
// ATTEMPT, so every invoice this app ever voided-and-replaced leaves
// permanent "Incomplete"/"Canceled" clutter behind for the same job. This
// page asks Stripe directly for invoices whose real status is "open" —
// see the route's own comment — so it's exactly the "what's actually
// still owed right now" list, without Tim needing to know Stripe's own
// Invoices-vs-Transactions distinction or dig through its Filter menu.
export default function OpenInvoicesView() {
  const [invoices, setInvoices] = useState<OpenInvoiceRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch("/api/admin/stripe-open-invoices")
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error ?? "Failed to load open invoices");
        setInvoices(data.invoices);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load open invoices"))
      .finally(() => setLoaded(true));
  }, []);

  const totalCents = useMemo(() => invoices.reduce((sum, inv) => sum + inv.amountDueCents, 0), [invoices]);

  return (
    <div>
      <Link href="/admin/billing" className="mb-2 inline-flex items-center gap-1 text-sm text-brand-600 hover:text-brand-700">
        ← Billing
      </Link>
      <h1 className="text-lg font-bold text-slate-800">Open Invoices</h1>
      <p className="mt-1 text-sm text-slate-500">
        Straight from Stripe — only invoices that are actually still open (not paid, not voided, not a superseded old attempt).
      </p>

      {error && <div className="mt-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}
      {!loaded ? (
        <p className="mt-6 text-sm text-slate-500">Loading…</p>
      ) : invoices.length === 0 ? (
        <p className="mt-6 text-sm text-slate-500">Nothing open right now.</p>
      ) : (
        <>
          <div className="mt-4 rounded-xl border border-slate-200 bg-white px-4 py-3">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm text-slate-600">Total open</span>
              <span className="text-lg font-bold text-slate-800">{formatCents(totalCents)}</span>
            </div>
          </div>

          <div className="mt-4 space-y-3">
            {invoices.map((inv) => {
              const overdue = inv.dueDate ? isPastDue(inv.dueDate.slice(0, 10)) : false;
              return (
                <a
                  key={inv.id}
                  href={inv.hostedInvoiceUrl ?? undefined}
                  target="_blank"
                  rel="noreferrer"
                  className="block rounded-xl border border-slate-200 bg-white px-4 py-3 hover:border-brand-300 hover:bg-brand-50"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-slate-800">
                        {inv.projectNumber ?? "—"} <span className="font-normal text-slate-500">— {inv.customerName}</span>
                      </p>
                      {inv.serviceAddress && <p className="text-xs text-slate-500">{inv.serviceAddress}</p>}
                    </div>
                    <span className="shrink-0 text-sm font-bold text-slate-800">{formatCents(inv.amountDueCents)}</span>
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-xs">
                    <span className={overdue ? "font-bold uppercase text-red-600" : "text-slate-500"}>
                      {inv.dueDate ? `Due ${formatDateMDY(inv.dueDate)}${overdue ? " — overdue" : ""}` : `Created ${formatDateMDY(inv.created)}`}
                    </span>
                  </div>
                </a>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
