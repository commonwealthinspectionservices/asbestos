import { getSupabaseAdminFresh } from "@/lib/supabase";
import { mileageRateCentsForDay, totalMiles, type MileageDay } from "@/lib/mileage-shared";
import { sendEmail, emailShell } from "@/lib/email";
import { escapeHtml } from "@/lib/html";

// Per Tim, 2026-09-27 — a real, ongoing sync of the app's own mileage
// tracking (mileage_days) into QuickBooks, so the standard-mileage-rate
// deduction shows up on the books without him re-entering it by hand.
// Posted as a Journal Entry (not an Expense/Purchase transaction) because
// QuickBooks won't let an Expense's payment account be an Equity account
// paired with a real Expense category — confirmed live, 2026-09-27, on the
// "Owner paid" cleanup this was modeled on. A Journal Entry has no such
// restriction: Debit "Vehicle expenses" (a real cost), Credit "Owner paid"
// (Tim personally supplied the vehicle, same pattern as every other
// personally-paid business expense already flowing through that account).

// Fallback endpoints if the discovery document (below) can't be reached —
// these are Intuit's own well-known, stable OAuth URLs, unchanged in years.
const FALLBACK_AUTHORIZE_URL = "https://appcenter.intuit.com/connect/oauth2";
const FALLBACK_TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";

const DISCOVERY_URLS: Record<string, string> = {
  production: "https://developer.api.intuit.com/.well-known/openid_configuration",
  sandbox: "https://developer.api.intuit.com/.well-known/openid_sandbox_configuration",
};

// Cached per server process (a cold start re-fetches) — Intuit's own docs
// recommend pulling the current authorize/token endpoints from this
// discovery document rather than hardcoding them, in case they're ever
// rotated. Best-effort: falls back to the hardcoded URLs above on any
// failure, since a discovery-fetch outage must never block the real OAuth
// flow it's only meant to keep pointed at the right place.
let discoveryCache: { authorizeUrl: string; tokenUrl: string } | null = null;

async function discoveryEndpoints(environment: string): Promise<{ authorizeUrl: string; tokenUrl: string }> {
  if (discoveryCache) return discoveryCache;
  try {
    const res = await fetch(DISCOVERY_URLS[environment] ?? DISCOVERY_URLS.sandbox);
    if (!res.ok) throw new Error(`discovery document ${res.status}`);
    const doc = await res.json();
    if (!doc.authorization_endpoint || !doc.token_endpoint) throw new Error("discovery document missing endpoints");
    discoveryCache = { authorizeUrl: doc.authorization_endpoint, tokenUrl: doc.token_endpoint };
  } catch {
    discoveryCache = { authorizeUrl: FALLBACK_AUTHORIZE_URL, tokenUrl: FALLBACK_TOKEN_URL };
  }
  return discoveryCache;
}

function apiBaseUrl(environment: string): string {
  return environment === "production"
    ? "https://quickbooks.api.intuit.com"
    : "https://sandbox-quickbooks.api.intuit.com";
}

/** One retry, after a short delay, for a transient network failure or 5xx — never for a real 4xx rejection (bad credentials, invalid_grant, etc.), which retrying can't fix. */
async function fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
  const attempt = () => fetch(url, init);
  try {
    const res = await attempt();
    if (res.status < 500) return res;
    await new Promise((r) => setTimeout(r, 1000));
    return attempt();
  } catch (err) {
    await new Promise((r) => setTimeout(r, 1000));
    return attempt();
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function redirectUri(): string {
  // No existing "our own site's base URL" env var in this codebase (Stripe's
  // hosted_invoice_url etc. never needed one) — same hardcoded-domain
  // pattern as FROM in email.ts, with an override for local/sandbox testing
  // against a tunnel URL.
  const base = process.env.QUICKBOOKS_REDIRECT_BASE_URL ?? "https://commonwealthinspectionservices.com";
  return `${base.replace(/\/$/, "")}/api/admin/quickbooks/callback`;
}

function connectionEnvironment(): string {
  return process.env.QUICKBOOKS_ENVIRONMENT === "production" ? "production" : "sandbox";
}

/** The URL to send the admin to for the one-time "Connect to QuickBooks" consent screen. */
export async function quickbooksAuthorizeUrl(state: string): Promise<string> {
  const { authorizeUrl } = await discoveryEndpoints(connectionEnvironment());
  const params = new URLSearchParams({
    client_id: requireEnv("QUICKBOOKS_CLIENT_ID"),
    response_type: "code",
    scope: "com.intuit.quickbooks.accounting",
    redirect_uri: redirectUri(),
    state,
  });
  return `${authorizeUrl}?${params.toString()}`;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number; // seconds
  x_refresh_token_expires_in: number; // seconds
}

/**
 * A failed refresh specifically because the refresh_token itself is no
 * longer valid (revoked, or past its ~100-day life) — the one failure mode
 * retrying can never fix, and the one QuickBooks' own docs say to handle
 * by clearing the stored connection and asking the admin to reconnect
 * (see notifyReconnectNeeded below), rather than just erroring out.
 */
class QuickBooksReauthRequired extends Error {}

async function requestTokens(body: URLSearchParams, { isRefresh = false } = {}): Promise<TokenResponse> {
  const clientId = requireEnv("QUICKBOOKS_CLIENT_ID");
  const clientSecret = requireEnv("QUICKBOOKS_CLIENT_SECRET");
  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const { tokenUrl } = await discoveryEndpoints(connectionEnvironment());

  const res = await fetchWithRetry(tokenUrl, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    if (isRefresh && res.status === 400 && /invalid_grant/.test(text)) {
      throw new QuickBooksReauthRequired(text);
    }
    throw new Error(`QuickBooks token request failed (${res.status}): ${text}`);
  }
  return res.json();
}

/** Best-effort email to the owner with a direct reconnect link — never blocks or masks the real error it's reporting alongside. */
async function notifyReconnectNeeded(reason: string): Promise<void> {
  try {
    await sendEmail({
      to: process.env.OWNER_EMAIL!,
      subject: "QuickBooks needs to be reconnected",
      html: emailShell(`
        <p style="font-size:15px;">The QuickBooks connection for mileage sync has expired or was revoked and needs to be reconnected.</p>
        <p style="font-size:13px; color:#64748b;">${escapeHtml(reason)}</p>
        <p style="font-size:15px;"><a href="https://commonwealthinspectionservices.com/api/admin/quickbooks/connect">Click here to reconnect</a>.</p>
      `),
    });
  } catch {
    // Best-effort — see cron-auth.ts's own withCronAlert for the same pattern.
  }
}

/** Called once, from the OAuth callback route, with the ?code and ?realmId Intuit sends back. */
export async function exchangeCodeForConnection(code: string, realmId: string): Promise<void> {
  const environment = connectionEnvironment();
  const tokens = await requestTokens(
    new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri() })
  );

  const supabase = getSupabaseAdminFresh();
  const now = Date.now();
  await supabase.from("quickbooks_connection").upsert({
    id: 1,
    realm_id: realmId,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    access_token_expires_at: new Date(now + tokens.expires_in * 1000).toISOString(),
    refresh_token_expires_at: new Date(now + tokens.x_refresh_token_expires_in * 1000).toISOString(),
    environment,
    updated_at: new Date().toISOString(),
  });
}

interface QuickBooksConnection {
  realm_id: string;
  access_token: string;
  refresh_token: string;
  access_token_expires_at: string;
  environment: string;
  vehicle_expense_account_id: string | null;
  owner_paid_account_id: string | null;
}

/**
 * A valid (non-expired) access token + realm, refreshing first if the
 * stored one is stale or close to expiring. Every refresh call rotates
 * the refresh_token too (Intuit's own behavior) and resets its ~100-day
 * clock — storing the new one each time is what keeps this connection
 * alive indefinitely without Tim ever re-authorizing by hand, as long as
 * the sync runs at least every ~100 days (it runs daily).
 */
async function getValidConnection(): Promise<QuickBooksConnection> {
  const supabase = getSupabaseAdminFresh();
  const { data, error } = await supabase.from("quickbooks_connection").select("*").eq("id", 1).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("QuickBooks isn't connected yet — visit /api/admin/quickbooks/connect first");

  const expiresAt = new Date(data.access_token_expires_at).getTime();
  if (expiresAt - Date.now() > 5 * 60_000) {
    return data as QuickBooksConnection;
  }

  let tokens: TokenResponse;
  try {
    tokens = await requestTokens(
      new URLSearchParams({ grant_type: "refresh_token", refresh_token: data.refresh_token }),
      { isRefresh: true }
    );
  } catch (err) {
    if (err instanceof QuickBooksReauthRequired) {
      await supabase.from("quickbooks_connection").delete().eq("id", 1);
      await notifyReconnectNeeded(err.message);
    }
    throw err;
  }
  const now = Date.now();
  const updated = {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    access_token_expires_at: new Date(now + tokens.expires_in * 1000).toISOString(),
    refresh_token_expires_at: new Date(now + tokens.x_refresh_token_expires_in * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  };
  await supabase.from("quickbooks_connection").update(updated).eq("id", 1);
  return { ...data, ...updated } as QuickBooksConnection;
}

async function qbFetch(conn: QuickBooksConnection, path: string, init?: RequestInit): Promise<any> {
  const res = await fetchWithRetry(`${apiBaseUrl(conn.environment)}/v3/company/${conn.realm_id}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${conn.access_token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(init?.headers ?? {}),
    },
  });
  // Intuit's own recommendation: capture intuit_tid from every response so
  // a support ticket can be traced to the exact request on their side,
  // without having to reproduce the failure. Included on both the error
  // path (most useful there) and logged even on success, in case a
  // response looked fine here but Intuit support needs to check it later.
  const intuitTid = res.headers.get("intuit_tid");
  if (!res.ok) {
    throw new Error(`QuickBooks API ${path} failed (${res.status}, intuit_tid=${intuitTid ?? "none"}): ${await res.text()}`);
  }
  if (intuitTid) console.log(`QuickBooks API ${path} intuit_tid=${intuitTid}`);
  return res.json();
}

/** Finds and caches the two account IDs the mileage journal entry needs — looked up by name once, reused after. */
async function accountIdsForMileage(conn: QuickBooksConnection): Promise<{ vehicleExpenseId: string; ownerPaidId: string }> {
  if (conn.vehicle_expense_account_id && conn.owner_paid_account_id) {
    return { vehicleExpenseId: conn.vehicle_expense_account_id, ownerPaidId: conn.owner_paid_account_id };
  }

  const findAccountId = async (name: string): Promise<string> => {
    const query = `select Id from Account where Name = '${name.replace(/'/g, "\\'")}'`;
    const result = await qbFetch(conn, `/query?query=${encodeURIComponent(query)}`);
    const id = result?.QueryResponse?.Account?.[0]?.Id;
    if (!id) throw new Error(`QuickBooks account "${name}" not found — has the Chart of Accounts changed?`);
    return id;
  };

  const [vehicleExpenseId, ownerPaidId] = await Promise.all([
    findAccountId("Vehicle expenses"),
    findAccountId("Owner paid"),
  ]);

  const supabase = getSupabaseAdminFresh();
  await supabase.from("quickbooks_connection").update({ vehicle_expense_account_id: vehicleExpenseId, owner_paid_account_id: ownerPaidId }).eq("id", 1);

  return { vehicleExpenseId, ownerPaidId };
}

/** cents, rounded to the nearest cent, for one mileage day at its own day's IRS rate. */
export function mileageCentsForDay(day: Pick<MileageDay, "day" | "legs">): number {
  const miles = totalMiles(day);
  const rateCents = mileageRateCentsForDay(day.day);
  return Math.round(miles * rateCents);
}

/**
 * Syncs every mileage_days row with a nonzero dollar amount into a
 * QuickBooks Journal Entry — creating one where none exists yet, updating
 * it where the day's miles (and so its dollar value) changed since the
 * last sync, and skipping it otherwise. Safe to call daily (cron) or
 * on-demand (admin button); never double-posts the same day.
 */
export async function syncMileageToQuickBooks(): Promise<{ created: number; updated: number; skipped: number }> {
  const conn = await getValidConnection();
  const { vehicleExpenseId, ownerPaidId } = await accountIdsForMileage(conn);
  const supabase = getSupabaseAdminFresh();

  const { data: days, error } = await supabase
    .from("mileage_days")
    .select("day, legs, qb_journal_entry_id, qb_synced_amount_cents");
  if (error) throw error;

  let created = 0, updated = 0, skipped = 0;

  for (const day of days ?? []) {
    const cents = mileageCentsForDay(day as Pick<MileageDay, "day" | "legs">);
    if (cents <= 0) { skipped++; continue; }
    if (day.qb_journal_entry_id && day.qb_synced_amount_cents === cents) { skipped++; continue; }

    const amount = Math.round(cents) / 100;
    const line = (id: string, amt: number, postingType: "Debit" | "Credit") => ({
      Amount: amt,
      DetailType: "JournalEntryLineDetail",
      Description: `Mileage ${day.day} — standard IRS rate`,
      JournalEntryLineDetail: { PostingType: postingType, AccountRef: { value: id } },
    });

    const payload: Record<string, unknown> = {
      TxnDate: day.day,
      PrivateNote: `Auto-synced from Commonwealth mileage tracking (${day.day})`,
      Line: [line(vehicleExpenseId, amount, "Debit"), line(ownerPaidId, amount, "Credit")],
    };

    let entryId: string;
    if (day.qb_journal_entry_id) {
      // QuickBooks requires the current SyncToken on every update.
      const existing = await qbFetch(conn, `/journalentry/${day.qb_journal_entry_id}`);
      payload.Id = day.qb_journal_entry_id;
      payload.SyncToken = existing.JournalEntry.SyncToken;
      const result = await qbFetch(conn, "/journalentry", { method: "POST", body: JSON.stringify(payload) });
      entryId = result.JournalEntry.Id;
      updated++;
    } else {
      const result = await qbFetch(conn, "/journalentry", { method: "POST", body: JSON.stringify(payload) });
      entryId = result.JournalEntry.Id;
      created++;
    }

    await supabase
      .from("mileage_days")
      .update({ qb_journal_entry_id: entryId, qb_synced_amount_cents: cents, qb_synced_at: new Date().toISOString() })
      .eq("day", day.day);
  }

  return { created, updated, skipped };
}

export async function isQuickBooksConnected(): Promise<boolean> {
  const supabase = getSupabaseAdminFresh();
  const { data } = await supabase.from("quickbooks_connection").select("id").eq("id", 1).maybeSingle();
  return Boolean(data);
}
