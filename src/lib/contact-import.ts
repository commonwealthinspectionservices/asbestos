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
// header ever has one). Company is grouped by email domain (see
// resolveCompanyIdForDomain below) rather than left blank — Tim asked for
// this explicitly after seeing a real imported contact with no company
// attached. One shared function, two entry points: the 15-min cron (see
// api/cron/import-contacts) keeps this current going forward, and calling
// that same route by hand (with CRON_SECRET) as many times as needed
// catches up on the existing inbox history — no separate one-off backfill
// script, since both are just "run this again" against whatever's still
// unlabeled.
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

// Personal/free email providers — never a real company's own domain, so a
// contact on one of these stays company-less even though it's a perfectly
// real person. Not exhaustive (there's no way to be), just the common ones.
const PERSONAL_EMAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "ymail.com", "hotmail.com", "outlook.com",
  "live.com", "msn.com", "aol.com", "icloud.com", "me.com", "mac.com",
  "protonmail.com", "proton.me", "comcast.net", "verizon.net", "att.net", "sbcglobal.net",
]);

// Best-effort company NAME guessed straight from the domain text — "Sanair"
// from sanair.com, "Cbre" from cbre.com — not a real verified company name
// (an acronym like CBRE has no way to come out correctly-cased from this
// alone). Deliberately not a live web lookup: fetching an arbitrary
// external site per new domain, synchronously, inside a bounded cron run
// is a real reliability/latency risk (a slow or blocking site stalls the
// whole run) for a payoff that's still just a guess at a "clean" name
// either way. This gets the two things Tim actually needs automatically —
// people from the same company land under the SAME company record, and it
// isn't blank — at zero added failure modes; a wrong guess is a one-field
// rename in the Directory he already has, same as fixing a typo.
export function guessCompanyNameFromDomain(domain: string): string {
  const withoutTld = domain.replace(/\.[a-z]{2,}$/i, "");
  const mainLabel = withoutTld.split(".").pop() ?? withoutTld;
  return mainLabel
    .split(/[-_]/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
}

function domainOf(email: string): string {
  return email.slice(email.lastIndexOf("@") + 1).toLowerCase();
}

type SupabaseClient = ReturnType<typeof getSupabaseAdmin>;

// Domain -> company_id, seeded from every existing contact that already has
// both an email and a company on file — so a brand-new contact at an
// address CBRE has used before lands under the same real company record
// this app already has, not a fresh duplicate. Shared by
// importContactsFromRecentEmail and backfillCompanyForExistingContacts
// below — same lookup either way, just a different set of contacts
// getting resolved against it.
async function buildCompanyIdByDomainMap(supabase: SupabaseClient): Promise<Map<string, string | null>> {
  const { data: companyRows } = await supabase
    .from("customers")
    .select("email, company_id")
    .not("email", "is", null)
    .not("company_id", "is", null);
  const companyIdByDomain = new Map<string, string | null>(); // null = this domain maps to more than one company on file — ambiguous, don't guess
  for (const row of companyRows ?? []) {
    const domain = domainOf(row.email as string);
    const companyId = row.company_id as string;
    if (!companyIdByDomain.has(domain)) {
      companyIdByDomain.set(domain, companyId);
    } else if (companyIdByDomain.get(domain) !== companyId) {
      companyIdByDomain.set(domain, null);
    }
  }
  return companyIdByDomain;
}

// Resolves (and creates, if genuinely new) one company per unique
// non-personal domain — resolvedCompanyIdByDomain is the caller's own
// per-run cache, so a domain shared by several contacts in the same run
// (three people at the same company CC'd on one thread; three
// already-imported contacts sharing a domain in the backfill) only ever
// looks up/creates that company once, and they all land under the same
// resulting row.
async function resolveCompanyIdForDomain(
  supabase: SupabaseClient,
  domain: string,
  companyIdByDomain: Map<string, string | null>,
  resolvedCompanyIdByDomain: Map<string, string | null>
): Promise<string | null> {
  if (PERSONAL_EMAIL_DOMAINS.has(domain)) return null;
  if (resolvedCompanyIdByDomain.has(domain)) return resolvedCompanyIdByDomain.get(domain)!;
  const fromExisting = companyIdByDomain.get(domain);
  if (fromExisting !== undefined) {
    resolvedCompanyIdByDomain.set(domain, fromExisting);
    return fromExisting;
  }
  const guessedName = guessCompanyNameFromDomain(domain);
  const { data: existingCompany } = await supabase.from("companies").select("id").ilike("name", guessedName).maybeSingle();
  let companyId: string | null = existingCompany?.id ?? null;
  if (!companyId) {
    const { data: newCompany } = await supabase.from("companies").insert({ name: guessedName }).select("id").maybeSingle();
    companyId = newCompany?.id ?? null;
  }
  resolvedCompanyIdByDomain.set(domain, companyId);
  return companyId;
}

export interface ContactImportResult {
  scanned: number;
  created: { name: string; email: string; company: string | null }[];
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
  const companyIdByDomain = await buildCompanyIdByDomainMap(supabase);

  const pending: { name: string; email: string; domain: string }[] = [];
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
        pending.push({ name: name || email, email: lower, domain: domainOf(lower) });
      }
    }

    await addLabelToMessage(accessToken, candidate.id, labelId);
  }

  const resolvedCompanyIdByDomain = new Map<string, string | null>();

  // is_individual is deliberately left off (its own column default, false)
  // even for a company-less contact — that field really means "a
  // homeowner," and a personal-domain address with no company match is
  // just as likely to be some other kind of contact this pipeline can't
  // tell apart from an email header alone. Wrongly marking one true would
  // misroute it through this app's individual-only flows (the payment
  // gate, portal booking) the moment it's ever attached to a job.
  const created: { name: string; email: string; company: string | null }[] = [];
  const toInsert: { name: string; email: string; phone: string; company_id: string | null }[] = [];
  const companyNameById = new Map<string, string>();
  for (const p of pending) {
    const companyId = await resolveCompanyIdForDomain(supabase, p.domain, companyIdByDomain, resolvedCompanyIdByDomain);
    let companyName: string | null = null;
    if (companyId) {
      if (!companyNameById.has(companyId)) {
        const { data } = await supabase.from("companies").select("name").eq("id", companyId).maybeSingle();
        companyNameById.set(companyId, data?.name ?? "");
      }
      companyName = companyNameById.get(companyId) ?? null;
    }
    toInsert.push({ name: p.name, email: p.email, phone: "", company_id: companyId });
    created.push({ name: p.name, email: p.email, company: companyName });
  }

  if (toInsert.length > 0) {
    // onConflict "email" — belt-and-suspenders against the same address
    // somehow making it into toInsert twice (shouldn't happen given the
    // in-memory existingEmails check above, but a real unique constraint
    // violation here would otherwise fail the whole batch instead of just
    // skipping the duplicate). Always lowercased before insert —
    // customers_email_idx is a plain (not case-insensitive) unique index,
    // relying on every writer already doing this (see its own comment in
    // schema.sql) — already true for every row here, set above.
    await supabase.from("customers").upsert(toInsert, { onConflict: "email", ignoreDuplicates: true });
  }

  return { scanned: candidates.length, created, skippedExisting, skippedAutomated };
}

// Per Tim, 2026-09-11 — one-time catch-up for contacts the cron already
// imported before company-grouping existed (confirmed live: a real
// imported contact, irijksen@sanair.com, sat with no company attached).
// Same domain-matching/company-creation logic as the live import path
// above, just run backward over every already-existing company-less
// customer instead of forward over new Gmail messages. Safe to call more
// than once — a contact that already has a company (including one this
// same function just gave it) is simply skipped.
export async function backfillCompanyForExistingContacts(): Promise<{ updated: { name: string; email: string; company: string }[] }> {
  const supabase = getSupabaseAdmin();
  const companyIdByDomain = await buildCompanyIdByDomainMap(supabase);
  const resolvedCompanyIdByDomain = new Map<string, string | null>();

  const { data: rows } = await supabase
    .from("customers")
    .select("id, name, email")
    .is("company_id", null)
    .not("email", "is", null);

  const updated: { name: string; email: string; company: string }[] = [];
  const companyNameById = new Map<string, string>();
  for (const row of rows ?? []) {
    const email = row.email as string;
    const domain = domainOf(email);
    const companyId = await resolveCompanyIdForDomain(supabase, domain, companyIdByDomain, resolvedCompanyIdByDomain);
    if (!companyId) continue;

    if (!companyNameById.has(companyId)) {
      const { data } = await supabase.from("companies").select("name").eq("id", companyId).maybeSingle();
      companyNameById.set(companyId, data?.name ?? "");
    }
    await supabase.from("customers").update({ company_id: companyId }).eq("id", row.id);
    updated.push({ name: row.name as string, email, company: companyNameById.get(companyId) ?? "" });
  }

  return { updated };
}
