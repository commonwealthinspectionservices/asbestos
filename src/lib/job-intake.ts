// Automated intake for repeat commercial clients who start a job by email
// instead of booking through the portal — Boston Harbor Water Restoration's
// "ACM Order" emails (see parse-job-intake.ts) are the first, and so far
// only, sender this is built for. Deliberately narrow (a small hardcoded
// list, same shape as parse-lab-report.ts's KNOWN_LABS) rather than a
// general "detect any company's freeform job request" system — a wrong
// guess here creates a real job with a wrong address, a much worse failure
// than a lab report's blank sample count, so this only ever acts on a
// sender/format combination that's actually been confirmed against real
// emails.
import { getSupabaseAdmin } from "@/lib/supabase";
import { getSettings } from "@/lib/settings";
import { geocodeAddress, GeocodeError } from "@/lib/geocode";
import { generateProjectNumber } from "@/lib/project-number";
import { resolveServiceSelection } from "@/lib/portal-booking";
import { parseAcmOrderEmail, type ParsedJobIntake } from "@/lib/parse-job-intake";
import { sendNewBookingRequestEmail } from "@/lib/booking-notify";
import {
  getValidAccessToken,
  listMessagesByQuery,
  getMessage,
  getHeader,
  getMessageBodyText,
  markMessageRead,
  type GmailMessage,
} from "@/lib/gmail";
import type { Settings } from "@/lib/types";

interface JobIntakeSender {
  /** Matched against the message's From header, case-insensitively. */
  domain: string;
  companyName: string;
  serviceTypeKey: string;
  /** Gmail search term — narrows candidates before the real content check (parseAcmOrderEmail) decides. */
  subjectHint: string;
}

const KNOWN_SENDERS: JobIntakeSender[] = [
  { domain: "bostonharborwater.com", companyName: "Boston Harbor Water Restoration", serviceTypeKey: "asbestos_bulk", subjectHint: "ACM Order" },
];

export interface JobIntakeResult {
  checked: number;
  created: { projectNumber: string; jobId: string }[];
  unmatched: number;
}

export async function checkForJobIntakeEmails(): Promise<JobIntakeResult> {
  const accessToken = await getValidAccessToken();
  if (!accessToken) throw new Error("Gmail is not connected");

  const settings = await getSettings();
  const result: JobIntakeResult = { checked: 0, created: [], unmatched: 0 };

  for (const sender of KNOWN_SENDERS) {
    const query = `is:unread from:${sender.domain} subject:"${sender.subjectHint}" newer_than:14d`;
    const candidates = await listMessagesByQuery(accessToken, query);

    for (const candidate of candidates) {
      result.checked++;
      try {
        const message = await getMessage(accessToken, candidate.id);
        const from = getHeader(message, "From") ?? "";
        if (!from.toLowerCase().includes(sender.domain)) {
          result.unmatched++;
          continue;
        }

        const bodyText = getMessageBodyText(message);
        const parsed = parseAcmOrderEmail(bodyText);
        if (!parsed) {
          // Off-template — left unread on purpose, same as an unmatched lab
          // email, so it stays visible in the inbox for manual handling
          // instead of silently vanishing into "checked, found nothing."
          result.unmatched++;
          continue;
        }

        const rfcMessageId = getHeader(message, "Message-ID");
        const job = await createJobFromIntake({ sender, parsed, settings, message, rfcMessageId });
        // No acknowledgment reply here on purpose — per explicit owner
        // instruction, the only automated thing for this intake channel is
        // the final report draft (see draftReportEmailForJob's own
        // threading, lib/lab-email.ts), once lab results actually land.
        // Everything else in this conversation — including the initial
        // reply to the client — stays manual, same as it already is today.
        await markMessageRead(accessToken, candidate.id);
        result.created.push({ projectNumber: job.projectNumber, jobId: job.jobId });
      } catch (err) {
        console.error(`checkForJobIntakeEmails: failed to process message ${candidate.id}:`, err);
        result.unmatched++;
      }
    }
  }

  return result;
}

// Exported so it's independently testable without needing a real inbound
// Gmail message — every real caller reaches this through
// checkForJobIntakeEmails above.
export async function createJobFromIntake(params: {
  sender: JobIntakeSender;
  parsed: ParsedJobIntake;
  settings: Settings;
  message: GmailMessage;
  rfcMessageId: string | null;
}): Promise<{ jobId: string; projectNumber: string; serviceLabel: string; address: string }> {
  const { sender, parsed, settings, message, rfcMessageId } = params;
  const supabase = getSupabaseAdmin();

  const { data: company } = await supabase
    .from("companies")
    .select("id")
    .ilike("name", sender.companyName)
    .maybeSingle();
  if (!company) {
    throw new Error(`No company on file matching "${sender.companyName}" — add it in the Directory first`);
  }

  const { data: contacts } = await supabase
    .from("customers")
    .select("id, email")
    .eq("company_id", company.id);
  if (!contacts || contacts.length === 0) {
    throw new Error(`Company "${sender.companyName}" has no contact on file to bill this job to`);
  }
  const customer = contacts[0];

  // Geocoded first so resolveServiceSelection's own pricing-zone lookup
  // (matched by town name, see its own comment) sees the full address, not
  // just the bare street — a street-only string can't match a zone at all.
  const fullAddress = `${parsed.streetAddress}, ${parsed.town}, MA`;
  let lat: number | null = null;
  let lng: number | null = null;
  let formattedAddress = fullAddress;
  try {
    const geo = await geocodeAddress(fullAddress);
    lat = geo.lat;
    lng = geo.lng;
    formattedAddress = geo.formattedAddress;
  } catch (err) {
    // Best-effort — an ambiguous or unrecognized address shouldn't block
    // the job from being created; it just won't have a map pin until the
    // admin edits it. GeocodeError has its own status field worth logging
    // distinctly from a generic failure.
    console.error(`createJobFromIntake: geocoding failed for "${fullAddress}":`, err instanceof GeocodeError ? err.status : err);
  }

  // Same zone-aware pricing every other job (portal or admin-entered) gets
  // — no special-cased flat rate for this sender.
  const resolved = resolveServiceSelection([sender.serviceTypeKey], formattedAddress, settings);
  if ("error" in resolved) throw new Error(resolved.error);
  const { serviceTypeLabel, baseFeeCents, perSampleCents } = resolved;

  const projectNumber = await generateProjectNumber();

  const { data: job, error } = await supabase
    .from("jobs")
    .insert({
      project_number: projectNumber,
      customer_id: customer.id,
      service_address: formattedAddress,
      lat, lng,
      site_contact_name: parsed.homeownerName,
      site_contact_phone: parsed.homeownerPhone,
      service_type: serviceTypeLabel,
      base_fee_cents: baseFeeCents,
      per_sample_cents: perSampleCents,
      requested_date: parsed.requestedDate,
      window: "ANY",
      status: "needs_scheduling",
      source: "email_intake",
      scope_of_work: parsed.scopeOfWork,
      // The actual person who emailed this in — not a customers row of
      // their own, since no email address for them is ever given in these
      // messages (only the on-file company contact's). Kept as plain,
      // visible text on the job rather than guessed at.
      notes: `Requested via email by ${parsed.companyContactName} (${parsed.companyContactPhone}), ${sender.companyName}.`,
      disclaimer_ack: true,
      is_individual: false,
      // Seeds this job's own email thread with the client's original
      // message, so the later confirmed/reminder/report emails (see
      // lib/booking-notify.ts, lib/job-reminders.ts) all join the exact
      // same conversation Boston Harbor started, not a new one the app
      // started — the whole point of this feature.
      email_gmail_thread_id: message.threadId,
      email_thread_message_ids: rfcMessageId ? [rfcMessageId] : [],
    })
    .select("id")
    .single();

  if (error || !job) {
    throw new Error(`Failed to create job from email intake: ${error?.message}`);
  }

  try {
    await sendNewBookingRequestEmail({
      jobId: job.id,
      projectNumber,
      customerName: parsed.homeownerName,
      company: sender.companyName,
      address: formattedAddress,
      serviceLabel: serviceTypeLabel,
      requestedDate: parsed.requestedDate,
      requestedTime: null,
      scopeOfWork: parsed.scopeOfWork,
      notes: `Requested by ${parsed.companyContactName} (${parsed.companyContactPhone})`,
      siteContactName: parsed.homeownerName,
      siteContactPhone: parsed.homeownerPhone,
    });
  } catch (err) {
    console.error(`createJobFromIntake: owner alert failed for job ${job.id}:`, err);
  }

  return { jobId: job.id, projectNumber, serviceLabel: serviceTypeLabel, address: formattedAddress };
}
