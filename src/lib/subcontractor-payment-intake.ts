// Per Tim, 2026-09-28 — "in the future all of these should be logged in
// my admin page and in QuickBooks automatically... the whole point too":
// Fast Mold Testing's own two emails (their invoice PDF, then Mercury's
// "sent you $X" payment confirmation once he's actually been paid) are
// matched together by invoice number and turned into: a job on the
// admin's own schedule (if one doesn't already exist for that invoice)
// marked paid the moment the Mercury payment lands, and that same payment
// posted into QuickBooks as real Project revenue — no manual entry either
// side. Narrowly scoped to Fast Mold Testing specifically, same as the
// (now-removed) automated assignment-email intake this restores the
// spirit of — see ae86beb's own commit message. Never guesses through a
// genuine ambiguity (ties by invoice number alone); anything it can't
// resolve gets an owner alert instead, same discipline as job-intake.ts.
import { getSupabaseAdmin } from "@/lib/supabase";
import { upsertCompany, upsertCompanyContact } from "@/lib/companies";
import { generateProjectNumber } from "@/lib/project-number";
import { sendEmail, emailShell } from "@/lib/email";
import { escapeHtml } from "@/lib/html";
import { recordProjectRevenueInQuickBooks, isQuickBooksConnected } from "@/lib/quickbooks";
import { parseFastMoldInvoiceText, isFastMoldInvoiceText } from "@/lib/parse-fast-mold-invoice";
import { parseMercuryPaymentText, isMercuryPaymentText } from "@/lib/parse-mercury-payment";
import {
  getValidAccessToken,
  listMessagesByQuery,
  getMessage,
  getHeader,
  findPdfParts,
  getAttachmentData,
  markMessageRead,
  getOrCreateLabelId,
  addLabelToMessage,
  getMessageBodyText,
} from "@/lib/gmail";
import { parsePdfWithRetry } from "@/lib/lab-email";

const PROCESSED_LABEL = "Processed/Subcontractor Payments";
const FAST_MOLD_COMPANY_NAME = "Fast Mold Testing, Inc.";
const FAST_MOLD_DOMAIN = "fastmoldtesting.com";

export interface SubcontractorPaymentIntakeResult {
  invoicesChecked: number;
  jobsCreated: { projectNumber: string; jobId: string }[];
  paymentsChecked: number;
  jobsMarkedPaid: { projectNumber: string; jobId: string; amountCents: number }[];
  issues: number;
}

async function alertIssue(subject: string, reason: string, bodyExcerpt: string): Promise<void> {
  try {
    await sendEmail({
      to: process.env.OWNER_EMAIL!,
      subject: `Action needed: ${subject}`,
      html: emailShell(`
        <p style="font-size:15px;">${escapeHtml(reason)}</p>
        <p style="margin-top:16px; white-space:pre-wrap; font-size:13px; color:#555; border-top:1px solid #e2e8f0; padding-top:12px;">${escapeHtml(bodyExcerpt.slice(0, 800))}</p>
      `),
    });
  } catch (err) {
    console.error("subcontractor-payment-intake: failed to send alert email:", err);
  }
}

function formatDollarString(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

async function processInvoiceEmails(
  accessToken: string,
  processedLabelId: string,
  result: SubcontractorPaymentIntakeResult
): Promise<void> {
  const supabase = getSupabaseAdmin();
  const query = `from:${FAST_MOLD_DOMAIN} subject:invoice -label:"${PROCESSED_LABEL}" newer_than:30d`;
  const candidates = await listMessagesByQuery(accessToken, query);
  const messages = await Promise.all(candidates.map((c) => getMessage(accessToken, c.id)));
  messages.sort((a, b) => Number(a.internalDate ?? 0) - Number(b.internalDate ?? 0));

  for (const message of messages) {
    const subject = getHeader(message, "Subject") ?? "(no subject)";
    let handled = false;
    for (const part of findPdfParts(message.payload)) {
      const data = await getAttachmentData(accessToken, message.id, part.attachmentId);
      let text: string;
      try {
        text = (await parsePdfWithRetry(data, `${message.id}:${part.filename}`, 3)).text;
      } catch {
        continue;
      }
      if (!isFastMoldInvoiceText(text)) continue;

      result.invoicesChecked++;
      const parsed = parseFastMoldInvoiceText(text);
      if (!parsed) {
        await alertIssue(
          "couldn't read a Fast Mold Testing invoice",
          `A Fast Mold Testing invoice PDF ("${subject}") didn't match the expected format — check it by hand.`,
          text
        );
        handled = true;
        continue;
      }

      const { data: existing } = await supabase.from("jobs").select("id").eq("invoice_number", parsed.invoiceNumber).maybeSingle();
      if (!existing) {
        const company = await upsertCompany(FAST_MOLD_COMPANY_NAME, { email: "info@fastmoldtesting.com", phone: "(424) 274-7425" });
        const contact = await upsertCompanyContact(FAST_MOLD_COMPANY_NAME, company.id, { email: "info@fastmoldtesting.com", phone: "(424) 274-7425" });
        const projectNumber = await generateProjectNumber();
        const { data: job, error } = await supabase
          .from("jobs")
          .insert({
            project_number: projectNumber,
            customer_id: contact.id,
            service_address: parsed.serviceAddress,
            site_contact_name: parsed.endClientName,
            service_type: "Mold Inspection",
            requested_date: parsed.inspectionDate,
            requested_time: parsed.inspectionTime,
            status: "completed",
            source: "subcontractor",
            subcontractor_client_company: parsed.endClientCompany,
            subcontractor_compensation: {
              base: formatDollarString(parsed.baseAmountCents),
              labFees: formatDollarString(parsed.labFeeCents),
              net: formatDollarString(parsed.netAmountCents),
            },
            payment_type: "check",
            invoice_number: parsed.invoiceNumber,
            invoice_emails: "info@fastmoldtesting.com",
            report_emails: "info@fastmoldtesting.com",
            disclaimer_ack: true,
            is_individual: false,
          })
          .select("id, project_number")
          .single();
        if (error || !job) {
          await alertIssue(
            "couldn't create a job from a Fast Mold Testing invoice",
            `Parsed invoice ${parsed.invoiceNumber} fine, but creating the job failed: ${error?.message ?? "unknown error"}.`,
            text
          );
          handled = true;
          continue;
        }
        result.jobsCreated.push({ projectNumber: job.project_number, jobId: job.id });
      }
      handled = true;
    }
    if (handled) {
      await markMessageRead(accessToken, message.id);
      await addLabelToMessage(accessToken, message.id, processedLabelId);
    }
  }
}

async function processPaymentEmails(
  accessToken: string,
  processedLabelId: string,
  result: SubcontractorPaymentIntakeResult
): Promise<void> {
  const supabase = getSupabaseAdmin();
  const query = `from:mercury.com "${FAST_MOLD_COMPANY_NAME}" -label:"${PROCESSED_LABEL}" newer_than:30d`;
  const candidates = await listMessagesByQuery(accessToken, query);
  const messages = await Promise.all(candidates.map((c) => getMessage(accessToken, c.id)));
  messages.sort((a, b) => Number(a.internalDate ?? 0) - Number(b.internalDate ?? 0));

  for (const message of messages) {
    const subject = getHeader(message, "Subject") ?? "(no subject)";
    const bodyText = getMessageBodyText(message);
    if (!isMercuryPaymentText(bodyText) || !bodyText.includes(FAST_MOLD_COMPANY_NAME)) continue;

    result.paymentsChecked++;
    const parsed = parseMercuryPaymentText(bodyText);
    if (!parsed || !parsed.invoiceNumber) {
      await alertIssue(
        "a Fast Mold Testing payment couldn't be matched to an invoice",
        `Mercury notification ("${subject}") named a payment from ${parsed?.payerCompany ?? "Fast Mold Testing"} but had no invoice number to match it against — file it on the right job by hand.`,
        bodyText
      );
      await markMessageRead(accessToken, message.id);
      await addLabelToMessage(accessToken, message.id, processedLabelId);
      continue;
    }

    const { data: job } = await supabase
      .from("jobs")
      .select("id, project_number, paid_date, subcontractor_compensation")
      .eq("invoice_number", parsed.invoiceNumber)
      .maybeSingle();

    if (!job) {
      await alertIssue(
        "a Fast Mold Testing payment couldn't be matched to a job",
        `Mercury confirmed payment of ${formatDollarString(parsed.amountCents)} for invoice ${parsed.invoiceNumber}, but no job on file has that invoice number — the invoice email may not have been processed yet, or never arrived.`,
        bodyText
      );
      await markMessageRead(accessToken, message.id);
      await addLabelToMessage(accessToken, message.id, processedLabelId);
      continue;
    }

    if (!job.paid_date) {
      await supabase.from("jobs").update({ status: "paid", paid_date: parsed.sentDate }).eq("id", job.id);

      if (await isQuickBooksConnected()) {
        try {
          await recordProjectRevenueInQuickBooks({
            customerName: parsed.payerCompany,
            amountCents: parsed.amountCents,
            date: parsed.sentDate,
            description: `${FAST_MOLD_COMPANY_NAME} — Mold Inspection (Job ${job.project_number}, Invoice ${parsed.invoiceNumber})`,
          });
        } catch (e) {
          await alertIssue(
            "a Fast Mold Testing payment was recorded here but failed to post to QuickBooks",
            `Job ${job.project_number} was marked paid, but posting ${formatDollarString(parsed.amountCents)} to QuickBooks failed: ${e instanceof Error ? e.message : String(e)}. Log it there by hand.`,
            bodyText
          );
        }
      }

      result.jobsMarkedPaid.push({ projectNumber: job.project_number, jobId: job.id, amountCents: parsed.amountCents });
    }

    await markMessageRead(accessToken, message.id);
    await addLabelToMessage(accessToken, message.id, processedLabelId);
  }
}

export async function checkForSubcontractorPayments(): Promise<SubcontractorPaymentIntakeResult> {
  const accessToken = await getValidAccessToken();
  if (!accessToken) throw new Error("Gmail is not connected");

  const result: SubcontractorPaymentIntakeResult = {
    invoicesChecked: 0,
    jobsCreated: [],
    paymentsChecked: 0,
    jobsMarkedPaid: [],
    issues: 0,
  };
  const processedLabelId = await getOrCreateLabelId(accessToken, PROCESSED_LABEL);

  // Invoices first, always — a same-run Mercury payment can only match a
  // job that already exists, and an invoice always arrives (days) before
  // its own payment in practice, but processing order shouldn't depend on
  // Gmail's own delivery timing within one run.
  await processInvoiceEmails(accessToken, processedLabelId, result);
  await processPaymentEmails(accessToken, processedLabelId, result);

  return result;
}
