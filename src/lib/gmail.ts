import { getSupabaseAdmin } from "@/lib/supabase";
import { FROM } from "@/lib/email";

// The owner's own Gmail inbox, watched for incoming lab result emails —
// OAuth tokens live in their own table (gmail_connection), never on
// `settings`, since GET /api/admin/settings returns that row wholesale to
// the browser and a refresh token has no business reaching client JS.
const CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID ?? "";
const CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? "";
const REDIRECT_URI = process.env.GOOGLE_OAUTH_REDIRECT_URI ?? "";

// modify (read + label changes, e.g. marking a processed email read so it
// isn't redrafted on the next check) and compose (create drafts). No full
// mail.google.com. gmail.send was added 2026-08-15, deliberately narrow:
// the ONLY two call sites that ever use it are sendCustomerBookingReceivedEmail
// and sendJobConfirmedEmailIfDue in lib/booking-notify.ts — fixed-template
// confirmations, not free-form content, sent so a job's whole email history
// (received -> confirmed -> final report) reads as one real Gmail thread
// instead of scattered emails (see lib/email-thread.ts's header-matching
// approach, which turned out not to work through Resend/SES — it silently
// overwrites Message-ID). Everything with real stakes — the report, the
// invoice, payment reminders — is still draft-only; the owner still reviews
// and sends those themselves. Adding this scope requires reconnecting
// Gmail (Settings -> disconnect, then reconnect) since a scope change
// doesn't retroactively apply to an already-issued refresh token.
const SCOPES = [
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/gmail.send",
].join(" ");

interface GoogleTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
  token_type?: string;
}

export function getGoogleAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: SCOPES,
    access_type: "offline",
    // Forces Google to always return a refresh_token, even on a repeat
    // connect from the same account — without this, re-connecting after a
    // disconnect can silently omit it and leave the app unable to refresh.
    prompt: "consent",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function exchangeCodeForTokens(code: string): Promise<GoogleTokenResponse> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) throw new Error(`Google token exchange failed: ${await res.text()}`);
  return res.json();
}

async function refreshAccessToken(refreshToken: string): Promise<GoogleTokenResponse> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`Google token refresh failed: ${await res.text()}`);
  return res.json();
}

export async function getGmailProfileEmail(accessToken: string): Promise<string> {
  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Failed to load Gmail profile: ${await res.text()}`);
  const data = await res.json();
  return data.emailAddress;
}

// Used to be "connected" purely because a refresh_token exists in the DB —
// never actually asked Google. A refresh token can go dead without this app
// doing anything (most commonly: the OAuth consent screen is still in
// Google's "Testing" publishing status, which auto-expires refresh tokens
// after 7 days) — Settings kept showing "Connected" while
// check-lab-emails' cron silently 500'd every 15 minutes underneath,
// invisible until someone noticed a job never got processed. Now actually
// exercises the token via getValidAccessToken() (which refreshes/throws
// for real) so "Connected" means what it says.
export async function getGmailConnectionStatus(): Promise<{ connected: boolean; email: string | null }> {
  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from("gmail_connection")
    .select("email, refresh_token")
    .eq("id", 1)
    .maybeSingle();
  if (!data?.refresh_token) return { connected: false, email: null };

  try {
    await getValidAccessToken();
    return { connected: true, email: data.email ?? null };
  } catch (err) {
    console.error("getGmailConnectionStatus: stored refresh token is no longer valid:", err);
    return { connected: false, email: data.email ?? null };
  }
}

export async function saveGmailTokens(params: {
  email: string;
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
}): Promise<void> {
  const supabase = getSupabaseAdmin();
  const patch: Record<string, unknown> = {
    id: 1,
    email: params.email,
    access_token: params.accessToken,
    token_expiry: new Date(Date.now() + params.expiresIn * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  };
  // Google only sends refresh_token on the very first consent (or when
  // prompt=consent forces it) — never overwrite a good one with nothing.
  if (params.refreshToken) patch.refresh_token = params.refreshToken;
  const { error } = await supabase.from("gmail_connection").upsert(patch);
  if (error) throw new Error(`Failed to save Gmail tokens: ${error.message}`);
}

export async function disconnectGmail(): Promise<void> {
  const supabase = getSupabaseAdmin();
  await supabase.from("gmail_connection").delete().eq("id", 1);
}

interface GmailMessagePart {
  mimeType?: string;
  filename?: string;
  body?: { attachmentId?: string; size?: number };
  parts?: GmailMessagePart[];
  headers?: { name: string; value: string }[];
}

export interface GmailMessage {
  id: string;
  threadId: string;
  payload?: GmailMessagePart;
}

// Headers (Subject, From, etc.) live on the top-level payload node, same
// shape as any other part. Used for the chain-of-custody receipt path,
// which identifies its target project from the subject line rather than
// PDF text — that PDF is a scan of a handwritten form, with no reliable
// extractable text.
export function getHeader(message: GmailMessage, name: string): string | null {
  const header = message.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase());
  return header?.value ?? null;
}

async function gmailFetch(accessToken: string, path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me${path}`, {
    ...init,
    headers: { ...init?.headers, Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Gmail API ${path} failed (${res.status}): ${await res.text()}`);
  return res;
}

// Unread + has an attachment is a deliberately loose net — this app has no
// reliable way to know a lab's sending address in advance, and the actual
// match (does the PDF's own project number line up with a real job) is
// what decides a hit, not this query. newer_than bounds how far back a
// first run (or one after downtime) reaches, rather than scanning the
// whole mailbox.
const CANDIDATE_QUERY = "is:unread has:attachment filename:pdf newer_than:14d";

export async function listCandidateMessages(accessToken: string): Promise<{ id: string; threadId: string }[]> {
  const res = await gmailFetch(accessToken, `/messages?q=${encodeURIComponent(CANDIDATE_QUERY)}&maxResults=25`);
  const data = await res.json();
  return data.messages ?? [];
}

export async function getMessage(accessToken: string, id: string): Promise<GmailMessage> {
  const res = await gmailFetch(accessToken, `/messages/${id}?format=full`);
  return res.json();
}

// Walks a message's MIME tree (attachments can be nested under
// multipart/mixed > multipart/related, etc.) collecting every PDF part.
export function findPdfParts(payload: GmailMessagePart | undefined): { filename: string; attachmentId: string }[] {
  if (!payload) return [];
  const found: { filename: string; attachmentId: string }[] = [];
  function walk(part: GmailMessagePart) {
    if (part.mimeType === "application/pdf" && part.body?.attachmentId) {
      found.push({ filename: part.filename || "attachment.pdf", attachmentId: part.body.attachmentId });
    }
    for (const child of part.parts ?? []) walk(child);
  }
  walk(payload);
  return found;
}

export async function getAttachmentData(accessToken: string, messageId: string, attachmentId: string): Promise<Buffer> {
  const res = await gmailFetch(accessToken, `/messages/${messageId}/attachments/${attachmentId}`);
  const data = await res.json();
  // Gmail's attachment data is web-safe base64 (- and _ instead of + and /) — Buffer's base64url encoding handles that directly.
  return Buffer.from(data.data, "base64url");
}

export async function markMessageRead(accessToken: string, messageId: string): Promise<void> {
  await gmailFetch(accessToken, `/messages/${messageId}/modify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ removeLabelIds: ["UNREAD"] }),
  });
}

// RFC 2047 "encoded word" — a header value with any non-ASCII character
// (e.g. an em dash in a Subject built from a formatted address) has to be
// wrapped like this, or Gmail renders it as raw UTF-8 bytes misread as
// Latin-1 (garbled as "Ã¢Â€Â"" instead of "—"). Plain ASCII values pass
// through untouched — the common case for most of what this app sends.
function encodeHeaderValue(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, "utf-8").toString("base64")}?=`;
}

function buildRawEmail(params: {
  from?: string;
  to: string;
  cc?: string;
  subject: string;
  bodyText?: string;
  bodyHtml?: string;
  attachments: { filename: string; mimeType: string; content: Buffer }[];
  // Extra raw headers — e.g. In-Reply-To/References to join an existing
  // email thread (see lib/email-thread.ts) started by an earlier
  // auto-sent email. Values are trusted, not escaped — callers only ever
  // pass Message-IDs this app generated itself.
  headers?: Record<string, string>;
}): string {
  const boundary = `cis_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const lines = [
    ...(params.from ? [`From: ${params.from}`] : []),
    `To: ${params.to}`,
    ...(params.cc ? [`Cc: ${params.cc}`] : []),
    `Subject: ${encodeHeaderValue(params.subject)}`,
    ...Object.entries(params.headers ?? {}).map(([name, value]) => `${name}: ${value}`),
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    params.bodyHtml ? 'Content-Type: text/html; charset="UTF-8"' : 'Content-Type: text/plain; charset="UTF-8"',
    "",
    params.bodyHtml ?? params.bodyText ?? "",
  ];
  for (const att of params.attachments) {
    lines.push(
      `--${boundary}`,
      `Content-Type: ${att.mimeType}; name="${att.filename}"`,
      `Content-Disposition: attachment; filename="${att.filename}"`,
      "Content-Transfer-Encoding: base64",
      "",
      att.content.toString("base64").replace(/(.{76})/g, "$1\n")
    );
  }
  lines.push(`--${boundary}--`);
  return Buffer.from(lines.join("\r\n")).toString("base64url");
}

// Creates a draft only — never gmail.send. The owner reviews it in their
// own Drafts folder and hits send themselves. Returns both the draft's id
// (to later check whether it's still sitting in Drafts, draftExists below)
// and its underlying message id (to later tell, once the draft is gone,
// whether it's gone because the owner sent it — getSentMessageInfo below —
// versus deleted it outright).
export async function createDraft(
  accessToken: string,
  params: {
    to: string; cc?: string; subject: string;
    // HTML lets a draft body carry a real hyperlink (e.g. "Link to pay"
    // instead of a pasted-in-full Stripe URL) — bodyText stays the default
    // for drafts that don't need one. buildRawEmail prefers bodyHtml when
    // both are present.
    bodyText?: string; bodyHtml?: string;
    attachments: { filename: string; mimeType: string; content: Buffer }[];
    headers?: Record<string, string>;
    // Joins an existing Gmail thread (see lib/email-thread.ts) — used so a
    // job's final report/invoice draft lands as the next reply in the same
    // conversation as its earlier "received"/"confirmed" emails, not a
    // brand new thread.
    threadId?: string;
  }
): Promise<{ id: string; messageId: string }> {
  const raw = buildRawEmail({ ...params, from: FROM });
  const res = await gmailFetch(accessToken, "/drafts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: { raw, ...(params.threadId ? { threadId: params.threadId } : {}) } }),
  });
  const data = await res.json();
  return { id: data.id, messageId: data.message.id };
}

// Sends immediately — real gmail.send, not a draft. Deliberately narrow:
// the only two call sites are sendCustomerBookingReceivedEmail and
// sendJobConfirmedEmailIfDue in lib/booking-notify.ts (see the SCOPES
// comment above for the full reasoning). Returns the real threadId Gmail
// assigned, and the message's own id — pass that id to getMessageIdHeader
// below to read back the real RFC Message-ID for the next email's
// In-Reply-To/References.
export async function sendMessage(
  accessToken: string,
  params: { to: string; subject: string; bodyHtml: string; headers?: Record<string, string>; threadId?: string }
): Promise<{ id: string; threadId: string }> {
  const raw = buildRawEmail({ from: FROM, to: params.to, subject: params.subject, bodyHtml: params.bodyHtml, attachments: [], headers: params.headers });
  const res = await gmailFetch(accessToken, "/messages/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ raw, ...(params.threadId ? { threadId: params.threadId } : {}) }),
  });
  const data = await res.json();
  return { id: data.id, threadId: data.threadId };
}

// Unlike Resend (which silently overwrites any custom Message-ID with its
// own — confirmed by testing, see the commit that added this), Gmail is a
// mailbox this app actually owns, so instead of guessing what Message-ID
// it assigned, this just asks. Whatever comes back is guaranteed real,
// regardless of whether Gmail happened to keep the one we set ourselves.
export async function getMessageIdHeader(accessToken: string, messageId: string): Promise<string | null> {
  const res = await gmailFetch(accessToken, `/messages/${messageId}?format=metadata&metadataHeaders=Message-ID`);
  const data = await res.json();
  const header = (data.payload?.headers ?? []).find((h: { name: string; value: string }) => h.name.toLowerCase() === "message-id");
  return header?.value ?? null;
}

// Best-effort cleanup when a draft is being recreated — if the previous one
// was already sent (or deleted by hand), its draft id is already gone from
// Gmail and this just 404s harmlessly; sending a draft consumes it, so this
// can never end up deleting an already-sent message.
export async function deleteDraft(accessToken: string, draftId: string): Promise<void> {
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/drafts/${draftId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(`Gmail API DELETE /drafts/${draftId} failed (${res.status}): ${await res.text()}`);
  }
}

// A draft the owner has since sent or deleted from Gmail no longer exists
// there — this is checked live (not inferred from our own stored
// timestamp) so the Final Report tab never claims a draft is waiting when
// it isn't. A 404 here is the expected "gone" case, not a real error.
export async function draftExists(accessToken: string, draftId: string): Promise<boolean> {
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/drafts/${draftId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 404) return false;
  if (!res.ok) throw new Error(`Gmail API /drafts/${draftId} failed (${res.status}): ${await res.text()}`);
  return true;
}

// There's no "sent" webhook and this app deliberately never has
// gmail.send, so "sent" is inferred the only way possible: once a draft
// disappears from Drafts, its underlying message either now carries
// Gmail's own SENT label (the owner hit send) or is gone entirely /
// unlabeled (the owner deleted the draft without sending). internalDate
// gives the real send time rather than whenever the admin happened to
// check.
export async function getSentMessageInfo(accessToken: string, messageId: string): Promise<{ sent: boolean; sentAt: string | null }> {
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=minimal`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 404) return { sent: false, sentAt: null };
  if (!res.ok) throw new Error(`Gmail API /messages/${messageId} failed (${res.status}): ${await res.text()}`);
  const data = await res.json();
  const sent = Array.isArray(data.labelIds) && data.labelIds.includes("SENT");
  const sentAt = sent && data.internalDate ? new Date(Number(data.internalDate)).toISOString() : null;
  return { sent, sentAt };
}

/** Refreshes first if the stored access token is missing/expiring, so callers never think about token lifetime. */
export async function getValidAccessToken(): Promise<string | null> {
  const supabase = getSupabaseAdmin();
  const { data } = await supabase.from("gmail_connection").select("*").eq("id", 1).maybeSingle();
  if (!data?.refresh_token) return null;

  const expiry = data.token_expiry ? new Date(data.token_expiry).getTime() : 0;
  if (data.access_token && expiry - Date.now() > 60_000) {
    return data.access_token;
  }

  const refreshed = await refreshAccessToken(data.refresh_token);
  await supabase
    .from("gmail_connection")
    .update({
      access_token: refreshed.access_token,
      token_expiry: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", 1);
  return refreshed.access_token;
}
