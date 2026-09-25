import { randomUUID } from "crypto";
import { getSupabaseAdminFresh } from "@/lib/supabase";
import { getStripe } from "@/lib/stripe";
import type { JobDocument } from "@/lib/types";

// Per Tim, 2026-09-25 — "the paid invoice from stripe needs to save w each
// job": Stripe's own invoice PDF (its `invoice_pdf` link — always renders
// the invoice's current state, so once it's paid it reads as paid) is
// downloaded and filed on the job as a "paid_invoice" document, so the
// proof of payment lives with the job instead of only inside Stripe.
// Best-effort by design — a Stripe or storage hiccup here must never get in
// the way of recording the payment itself (see markJobPaid), and it's
// idempotent: a second call just replaces the job's one paid_invoice.
export async function savePaidInvoiceDocument(jobId: string): Promise<{ saved: boolean; reason?: string }> {
  const supabase = getSupabaseAdminFresh();
  const { data: job } = await supabase
    .from("jobs")
    .select("id, project_number, stripe_invoice_id, documents")
    .eq("id", jobId)
    .maybeSingle();
  if (!job) return { saved: false, reason: "job not found" };
  if (!job.stripe_invoice_id) return { saved: false, reason: "no Stripe invoice on this job (paid another way)" };

  const invoice = await getStripe().invoices.retrieve(job.stripe_invoice_id);
  if (invoice.status !== "paid") return { saved: false, reason: `Stripe invoice is ${invoice.status}, not paid` };
  if (!invoice.invoice_pdf) return { saved: false, reason: "Stripe has no PDF for this invoice" };

  const res = await fetch(invoice.invoice_pdf, { cache: "no-store" });
  if (!res.ok) return { saved: false, reason: `couldn't download the Stripe PDF (${res.status})` };
  const pdf = Buffer.from(await res.arrayBuffer());

  const docId = randomUUID();
  const fileName = `paid-invoice-${job.project_number ?? job.id}.pdf`;
  const storagePath = `${job.id}/${docId}-${fileName}`;
  const { error: uploadError } = await supabase.storage.from("job-documents").upload(storagePath, pdf, { contentType: "application/pdf" });
  if (uploadError) return { saved: false, reason: `storage upload failed: ${uploadError.message}` };

  const existing = (job.documents ?? []) as JobDocument[];
  const stale = existing.filter((d) => d.kind === "paid_invoice");
  const document: JobDocument = {
    id: docId,
    kind: "paid_invoice",
    service_type: "",
    file_name: fileName,
    storage_path: storagePath,
    uploaded_at: new Date().toISOString(),
    project_number_mismatch: null,
  };
  const { error } = await supabase
    .from("jobs")
    .update({ documents: [...existing.filter((d) => d.kind !== "paid_invoice"), document] })
    .eq("id", jobId);
  if (error) return { saved: false, reason: error.message };
  if (stale.length > 0) await supabase.storage.from("job-documents").remove(stale.map((d) => d.storage_path));
  return { saved: true };
}
