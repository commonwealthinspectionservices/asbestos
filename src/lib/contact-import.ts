import { getSupabaseAdmin } from "@/lib/supabase";
import {
  getValidAccessToken,
  getGmailConnectionStatus,
  listMessageIdsByQuery,
  getMessageHeaders,
  getHeader,
  extractNamedAddresses,
  getOrCreateLabelId,
  addLabelToMessage,
} from "@/lib/gmail";

// Per Tim, 2026-09-11 — "anyone that emails me... should be saved in there
// regardless of whether or not i have their phone": every unique person on
// the From/To/Cc of any email in the connected inbox becomes a Directory
// contact, name + email only (phone stays blank — nothing in an email
// header ever has one), no company attached (there's no reliable way to
// turn "cbre.com" into "CBRE" from the domain alone; left for the owner to
// attach by hand, same as any manually-added contact). One shared function,
// two entry points: the 15-min cron (see api/cron/import-contacts) keeps
// this current going forward, and calling that same route by hand (with
// CRON_SECRET) as many times as needed catches up on the existing inbox
// history — no separate one-off backfill script, since both are just "run
// this again" against whatever's still unlabeled.
//
// Bounded per run (maxMessages), not the whole inbox at once — Gmail's API
// is one call per message for headers, and this needs to stay well inside
// the route's own maxDuration. A message already labeled gets skipped by
// the query and, belt-and-suspenders, by checking labelIds directly on the
// ones that do come back (same authoritative-recheck pattern
// checkForLabResultEmails uses for its own PROCESSED_LABEL, since Gmail's
// search index can lag a same-second label write).
const IMPORTED_LABEL = "Contacts Imported";

// Skips the obviously-not-a-real-person senders a broad To/Cc/From scan
// would otherwise happily add as "contacts" — automated notification/
// delivery addresses, not people who ever emailed Tim on purpose.
const AUTOMATED_SENDER_PATTERN = /^(no-?reply|do-?not-?reply|notifications?|mailer-daemon|postmaster|bounce|calendar-notification|drive-shares-noreply|docs-noreply)@/i;

export interface ContactImportResult {
  scanned: number;
  created: { name: string; email: string }[];
  skippedExisting: number;
  skippedAutomated: number;
}

export async function importContactsFromRecentEmail(maxMessages: number): Promise<ContactImportResult> {
  const accessToken = await getValidAccessToken();
  if (!accessToken) throw new Error("Gmail is not connected");

  const supabase = getSupabaseAdmin();
  const { email: connectedEmail } = await getGmailConnectionStatus();
  const ownEmails = new Set(
    [connectedEmail, process.env.OWNER_EMAIL].filter((e): e is string => Boolean(e)).map((e) => e.toLowerCase())
  );

  const labelId = await getOrCreateLabelId(accessToken, IMPORTED_LABEL);

  // Deliberately excludes Promotions/Social (Gmail's own categorization) —
  // a real newsletter or social notification is never a real contact, and
  // there are enough of them in a typical inbox to badly dilute a Directory
  // built from raw To/Cc/From otherwise. Not excluding Updates/Forums —
  // real vendor/client threads (lab results, permit offices) sometimes land
  // there too, and this pipeline's own per-address automated-sender filter
  // already catches the obvious non-person senders regardless of category.
  const query = `-label:"${IMPORTED_LABEL}" -category:promotions -category:social -in:spam -in:trash`;
  const candidates = await listMessageIdsByQuery(accessToken, query, maxMessages);

  const { data: existingRows } = await supabase.from("customers").select("email").not("email", "is", null);
  const existingEmails = new Set((existingRows ?? []).map((r) => (r.email as string).toLowerCase()));

  const created: { name: string; email: string }[] = [];
  // is_individual deliberately left at its own column default (false), not
  // asserted true — that field really means "a homeowner," and a bulk
  // import scoops up plenty of company reps (a property manager, a lab
  // contact) alongside real homeowners with no way to tell them apart from
  // an email header alone. Wrongly marking one true would misroute it
  // through this app's individual-only flows (the payment gate, portal
  // booking) the moment it's ever attached to a job. Leaving it false and
  // company_id null creates a neutral, uncategorized contact instead —
  // exactly as blank as one the owner started typing into "Add contact"
  // and hasn't finished yet — for him to properly categorize by hand later.
  const toInsert: { name: string; email: string; phone: string }[] = [];
  let skippedExisting = 0;
  let skippedAutomated = 0;

  for (const candidate of candidates) {
    const message = await getMessageHeaders(accessToken, candidate.id);
    // Authoritative recheck — same reasoning as checkForLabResultEmails'
    // own labelIds check on PROCESSED_LABEL: the query's own -label
    // exclusion can lag a label just written this same run.
    if (message.labelIds?.includes(labelId)) continue;

    const headerValues = [getHeader(message, "From"), getHeader(message, "To"), getHeader(message, "Cc")].filter(
      (v): v is string => Boolean(v)
    );
    const seenThisMessage = new Set<string>();
    for (const value of headerValues) {
      for (const { name, email } of extractNamedAddresses(value)) {
        const lower = email.toLowerCase();
        if (seenThisMessage.has(lower)) continue;
        seenThisMessage.add(lower);

        if (ownEmails.has(lower)) continue;
        if (AUTOMATED_SENDER_PATTERN.test(lower)) {
          skippedAutomated++;
          continue;
        }
        if (existingEmails.has(lower)) {
          skippedExisting++;
          continue;
        }
        // Mark as known immediately — the same address on a later message
        // in this same run (or a second To/Cc slot in this same message)
        // must not queue a second insert for it.
        existingEmails.add(lower);
        // Always lowercased before insert — customers_email_idx is a plain
        // (not case-insensitive) unique index, relying on every writer
        // already doing this (see its own comment in schema.sql).
        const contactName = name || email;
        toInsert.push({ name: contactName, email: lower, phone: "" });
        created.push({ name: contactName, email: lower });
      }
    }

    await addLabelToMessage(accessToken, candidate.id, labelId);
  }

  if (toInsert.length > 0) {
    // onConflict "email" — belt-and-suspenders against the same address
    // somehow making it into toInsert twice (shouldn't happen given the
    // in-memory existingEmails check above, but a real unique constraint
    // violation here would otherwise fail the whole batch instead of just
    // skipping the duplicate).
    await supabase.from("customers").upsert(toInsert, { onConflict: "email", ignoreDuplicates: true });
  }

  return { scanned: candidates.length, created, skippedExisting, skippedAutomated };
}
