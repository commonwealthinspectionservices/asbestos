// Automated calendar-only intake for companies that subcontract work TO
// Tim, rather than his own clients who he bills and reports to directly —
// Fast Mold Testing is the first, and so far only, one. Deliberately much
// lighter than job-intake.ts: no pricing, no lab tracking, no final
// report/invoice — the subcontracting company owns all of that themselves.
// All Tim needs is the job on his schedule so he doesn't double-book, plus
// enough context (address, client contact, job notes) to actually go do
// the site visit. See jobs.source === "subcontractor" — gates the Report &
// Invoice tab in JobsDashboard.tsx down to a one-line note instead of the
// normal checklist, since jobReportDomains() would otherwise default an
// unrecognized service_type to "needs an asbestos report" (see its own
// comment), which is wrong for a job Tim was never going to report on.
import { getSupabaseAdmin } from "@/lib/supabase";
import { upsertCompany } from "@/lib/companies";
import { generateProjectNumber } from "@/lib/project-number";
import { sendEmail, emailShell } from "@/lib/email";
import { escapeHtml } from "@/lib/html";
import { parseNewAssignmentEmail, parseRescheduledEmail, type ParsedAssignment } from "@/lib/parse-subcontractor-assignment";
import {
  getValidAccessToken,
  listMessagesByQuery,
  getMessage,
  getHeader,
  getMessageBodyHtml,
  markMessageRead,
} from "@/lib/gmail";

interface SubcontractorSender {
  domain: string;
  companyName: string;
  companyPhone: string;
}

const KNOWN_SUBCONTRACTOR_SENDERS: SubcontractorSender[] = [
  { domain: "fastmoldtesting.com", companyName: "Fast Mold Testing", companyPhone: "424-274-7425" },
];

export interface SubcontractorIntakeResult {
  checked: number;
  created: { projectNumber: string; jobId: string }[];
  updated: { projectNumber: string; jobId: string }[];
  unmatched: number;
}

async function alertOwnerOfIssue(params: { sender: SubcontractorSender; subject: string; reason: string; bodyExcerpt: string }): Promise<void> {
  try {
    await sendEmail({
      to: process.env.OWNER_EMAIL!,
      subject: `Action needed: couldn't process a ${params.sender.companyName} assignment email`,
      html: emailShell(`
        <p style="font-size:15px;">An email from <strong>${escapeHtml(params.sender.companyName)}</strong> couldn't be turned into (or matched to) a job on your schedule automatically.</p>
        <p><strong>Subject:</strong> ${escapeHtml(params.subject)}</p>
        <p><strong>Reason:</strong> ${escapeHtml(params.reason)}</p>
        <p>Check your inbox and add/update it on your schedule by hand if it's real.</p>
        <p style="margin-top:16px; white-space:pre-wrap; font-size:13px; color:#555; border-top:1px solid #e2e8f0; padding-top:12px;">${escapeHtml(params.bodyExcerpt.slice(0, 800))}</p>
      `),
    });
  } catch (err) {
    console.error("alertOwnerOfIssue (subcontractor-intake): failed to send alert email:", err);
  }
}

export async function checkForSubcontractorAssignments(): Promise<SubcontractorIntakeResult> {
  const accessToken = await getValidAccessToken();
  if (!accessToken) throw new Error("Gmail is not connected");

  const result: SubcontractorIntakeResult = { checked: 0, created: [], updated: [], unmatched: 0 };

  for (const sender of KNOWN_SUBCONTRACTOR_SENDERS) {
    const query = `is:unread from:${sender.domain} newer_than:14d`;
    const candidates = await listMessagesByQuery(accessToken, query);

    for (const candidate of candidates) {
      result.checked++;
      const message = await getMessage(accessToken, candidate.id);
      const from = getHeader(message, "From") ?? "";
      const subject = getHeader(message, "Subject") ?? "(no subject)";
      if (!from.toLowerCase().includes(sender.domain)) {
        result.unmatched++;
        continue;
      }

      const html = getMessageBodyHtml(message);

      try {
        if (/reschedul/i.test(subject)) {
          const parsed = parseRescheduledEmail(html);
          if (!parsed) {
            await alertOwnerOfIssue({ sender, subject, reason: "Didn't match the expected reschedule format.", bodyExcerpt: html });
            await markMessageRead(accessToken, candidate.id);
            result.unmatched++;
            continue;
          }
          const job = await applyReschedule({ sender, parsed });
          if (!job) {
            await alertOwnerOfIssue({
              sender, subject,
              reason: `No open ${sender.companyName} job found on file at "${parsed.address}" to reschedule.`,
              bodyExcerpt: html,
            });
          } else {
            result.updated.push(job);
          }
          await markMessageRead(accessToken, candidate.id);
          continue;
        }

        if (!/new assignment/i.test(subject)) {
          // A known sender, but not an assignment or reschedule email (e.g.
          // a reply in an onboarding thread) — nothing for this pipeline to
          // do, left unread since it's not this pipeline's to touch.
          result.unmatched++;
          continue;
        }

        const parsed = parseNewAssignmentEmail(html);
        if (!parsed) {
          await alertOwnerOfIssue({ sender, subject, reason: "Didn't match the expected new-assignment format.", bodyExcerpt: html });
          await markMessageRead(accessToken, candidate.id);
          result.unmatched++;
          continue;
        }

        const job = await createSubcontractorJob({ sender, parsed });
        await markMessageRead(accessToken, candidate.id);
        if (job) result.created.push(job);
        else result.unmatched++; // duplicate — see createSubcontractorJob's own comment
      } catch (err) {
        console.error(`checkForSubcontractorAssignments: failed to process message ${candidate.id}:`, err);
        await alertOwnerOfIssue({
          sender, subject,
          reason: err instanceof Error ? err.message : "Unknown error.",
          bodyExcerpt: html,
        });
        await markMessageRead(accessToken, candidate.id);
        result.unmatched++;
      }
    }
  }

  return result;
}

// The one contact record standing in for "whoever at this subcontracting
// company sends the work" — there's no real per-job contact to bill (Tim
// isn't billing them through this app at all), so one placeholder per
// company is enough. Reused across every job from that sender.
async function getOrCreateSenderContact(sender: SubcontractorSender): Promise<{ id: string }> {
  const supabase = getSupabaseAdmin();
  const company = await upsertCompany(sender.companyName, { phone: sender.companyPhone });

  const placeholderEmail = `partners@${sender.domain}`;
  const { data: existing } = await supabase
    .from("customers")
    .select("id")
    .eq("company_id", company.id)
    .limit(1)
    .maybeSingle();
  if (existing) return existing;

  const { data: created, error } = await supabase
    .from("customers")
    .upsert(
      { name: sender.companyName, email: placeholderEmail, phone: sender.companyPhone, company_id: company.id, is_individual: false },
      { onConflict: "email" }
    )
    .select("id")
    .single();
  if (error || !created) throw new Error(`Failed to set up ${sender.companyName} as a company contact: ${error?.message}`);
  return created;
}

function buildJobNotes(params: { sender: SubcontractorSender; parsed: ParsedAssignment }): string {
  const { sender, parsed } = params;
  const lines = [
    `Subcontracted via ${sender.companyName} — they handle the final report and invoice for this job, not us.`,
    `Preferred window: ${parsed.preferredWindowText} — call/text the client to confirm the exact time.`,
    `Client: ${parsed.clientName}${parsed.clientPhone ? ` (${parsed.clientPhone})` : ""}${parsed.clientEmail ? ` — ${parsed.clientEmail}` : ""}`,
  ];
  if (parsed.baseCompensation) {
    lines.push(`Compensation: ${parsed.baseCompensation} base${parsed.labFees ? `, ${parsed.labFees} est. lab fees` : ""}${parsed.netPayment ? `, ${parsed.netPayment} est. net` : ""} (estimated by ${sender.companyName}, not tracked here).`);
  }
  if (parsed.clientNotes) lines.push(`\nClient notes: ${parsed.clientNotes}`);
  if (parsed.jobNotes) lines.push(`\nJob notes:\n${parsed.jobNotes}`);
  return lines.join("\n");
}

// Exported so it's independently testable. Returns null for a likely
// duplicate (same sender + same address + created in the last 3 days) —
// Fast Mold Testing's own system sent two near-identical copies of the
// same assignment three seconds apart in the very first real example seen,
// almost certainly an infra retry rather than two real jobs.
export async function createSubcontractorJob(params: {
  sender: SubcontractorSender;
  parsed: NonNullable<ReturnType<typeof parseNewAssignmentEmail>>;
}): Promise<{ jobId: string; projectNumber: string } | null> {
  const { sender, parsed } = params;
  const supabase = getSupabaseAdmin();
  const contact = await getOrCreateSenderContact(sender);

  const { data: possibleDuplicate } = await supabase
    .from("jobs")
    .select("id")
    .eq("customer_id", contact.id)
    .eq("service_address", parsed.address)
    .gte("created_at", new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString())
    .limit(1)
    .maybeSingle();
  if (possibleDuplicate) return null;

  const projectNumber = await generateProjectNumber();
  const { data: job, error } = await supabase
    .from("jobs")
    .insert({
      project_number: projectNumber,
      customer_id: contact.id,
      service_address: parsed.address,
      site_contact_name: parsed.clientName,
      site_contact_phone: parsed.clientPhone || null,
      // Deliberately NOT one of the app's own billable service types (no
      // "mold"/"lead" substring either) — jobReportDomains() defaults
      // anything else to "needs an asbestos report," which JobsDashboard's
      // Report & Invoice tab special-cases away entirely for
      // source === "subcontractor" (see that file's own comment).
      service_type: `Subcontracted Inspection — ${sender.companyName}`,
      requested_date: parsed.preferredDate,
      window: "ANY",
      status: "needs_scheduling",
      source: "subcontractor",
      scope_of_work: parsed.jobNotes || null,
      notes: buildJobNotes({ sender, parsed }),
      disclaimer_ack: true,
      is_individual: false,
    })
    .select("id")
    .single();

  if (error || !job) throw new Error(`Failed to create subcontractor job: ${error?.message}`);
  return { jobId: job.id, projectNumber };
}

async function applyReschedule(params: {
  sender: SubcontractorSender;
  parsed: NonNullable<ReturnType<typeof parseRescheduledEmail>>;
}): Promise<{ jobId: string; projectNumber: string } | null> {
  const { sender, parsed } = params;
  const supabase = getSupabaseAdmin();
  const contact = await getOrCreateSenderContact(sender);

  const { data: job } = await supabase
    .from("jobs")
    .select("id, project_number, notes")
    .eq("customer_id", contact.id)
    .eq("service_address", parsed.address)
    .not("status", "in", "(cancelled,completed,paid)")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!job) return null;

  await supabase
    .from("jobs")
    .update({
      requested_date: parsed.newDate,
      notes: `${job.notes ?? ""}\n\nRescheduled by ${sender.companyName} — new preferred window: ${parsed.newWindowText}. Call/text the client to reconfirm.`.trim(),
    })
    .eq("id", job.id);

  return { jobId: job.id, projectNumber: job.project_number };
}
