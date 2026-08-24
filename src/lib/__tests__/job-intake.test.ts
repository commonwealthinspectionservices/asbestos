import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { stripGmailForwardBoilerplate, extractOtherRecipients } from "@/lib/job-intake";
import type { GmailMessage } from "@/lib/gmail";

function messageWithHeaders(headers: Record<string, string>): GmailMessage {
  return {
    id: "msg1",
    threadId: "thread1",
    payload: {
      headers: Object.entries(headers).map(([name, value]) => ({ name, value })),
    },
  };
}

const ORIGINAL_BODY = `Peter Linski
22 Sunnyplain Ave
Weymouth
781-974-6204
Jack Cook
781-985-7432
2026-08-18
Dining room ceiling`;

describe("stripGmailForwardBoilerplate", () => {
  it("returns the body untouched and a null sender when there's no forward block", () => {
    expect(stripGmailForwardBoilerplate(ORIGINAL_BODY)).toEqual({
      originalFrom: null,
      body: ORIGINAL_BODY,
    });
  });

  it("extracts the original sender and strips Gmail's standard forward boilerplate", () => {
    const forwarded = `---------- Forwarded message ---------
From: Jack Cook <jack@bostonharborwater.com>
Date: Tue, Aug 18, 2026 at 9:14 AM
Subject: ACM Order - 22 Sunnyplain Ave
To: Tim Hall <tim@commonwealthinspectionservices.com>

${ORIGINAL_BODY}`;
    expect(stripGmailForwardBoilerplate(forwarded)).toEqual({
      originalFrom: "Jack Cook <jack@bostonharborwater.com>",
      body: ORIGINAL_BODY,
    });
  });

  it("is case-insensitive on the forward marker and From label", () => {
    const forwarded = `---------- forwarded message ---------
from: Jack Cook <jack@bostonharborwater.com>

${ORIGINAL_BODY}`;
    expect(stripGmailForwardBoilerplate(forwarded).originalFrom).toBe("Jack Cook <jack@bostonharborwater.com>");
  });

  it("extracts the original sender and strips Outlook's forward boilerplate", () => {
    // Verbatim shape (trimmed) of a real order the owner forwarded from his
    // Outlook-based day-job address — underscore-line marker, and extra
    // Sent:/Cc: header lines the Gmail case doesn't have.
    const forwarded = `Tim Hall
Project Manager
________________________________
From: Jack Cook <jack@bostonharborwater.com>
Sent: Sunday, 23 August 2026 10:24:17
To: Timothy Hall <thall@flienv.com>
Cc: joe@bostonharborwater.com <joe@bostonharborwater.com>
Subject: ACM Order

${ORIGINAL_BODY}`;
    expect(stripGmailForwardBoilerplate(forwarded)).toEqual({
      originalFrom: "Jack Cook <jack@bostonharborwater.com>",
      body: ORIGINAL_BODY,
    });
  });

  it("extracts the original sender from a real CRLF-line-ended Outlook forward", () => {
    // Outlook sends "\r\n" line endings. The From: line's untrimmed
    // trailing "\r" previously broke the exact-end regex match even though
    // marker detection and body stripping (which already .trim()) worked.
    const crlfBody = ORIGINAL_BODY.replace(/\n/g, "\r\n");
    const forwarded =
      "Tim Hall\r\nProject Manager\r\n________________________________\r\n" +
      "From: Jack Cook <jack@bostonharborwater.com>\r\nSent: Sunday, 23 August 2026 10:24:17\r\n" +
      "To: Timothy Hall <thall@flienv.com>\r\nSubject: ACM Order\r\n\r\n" + crlfBody;
    expect(stripGmailForwardBoilerplate(forwarded)).toEqual({
      originalFrom: "Jack Cook <jack@bostonharborwater.com>",
      body: ORIGINAL_BODY,
    });
  });
});

describe("extractOtherRecipients", () => {
  let originalOwnerEmail: string | undefined;
  beforeAll(() => {
    originalOwnerEmail = process.env.OWNER_EMAIL;
    process.env.OWNER_EMAIL = "tim@commonwealthinspectionservices.com";
  });
  afterAll(() => {
    if (originalOwnerEmail === undefined) delete process.env.OWNER_EMAIL;
    else process.env.OWNER_EMAIL = originalOwnerEmail;
  });

  it("collects sender + To + Cc, deduped and lowercased, minus the owner's own inbox", () => {
    const message = messageWithHeaders({
      From: "Patrick McDonough <patrick@bostonharborwater.com>",
      To: "tim@commonwealthinspectionservices.com",
      Cc: "joe@bostonharborwater.com, Ryan Hammond <Ryan@bostonharborwater.com>, nazli@bostonharborwater.com, niall@bostonharborwater.com, jack@bostonharborwater.com",
    });
    expect(extractOtherRecipients(message)).toEqual([
      "patrick@bostonharborwater.com",
      "joe@bostonharborwater.com",
      "ryan@bostonharborwater.com",
      "nazli@bostonharborwater.com",
      "niall@bostonharborwater.com",
      "jack@bostonharborwater.com",
    ]);
  });

  it("dedupes when the same address appears in more than one header", () => {
    const message = messageWithHeaders({
      From: "jack@bostonharborwater.com",
      To: "tim@commonwealthinspectionservices.com",
      Cc: "jack@bostonharborwater.com, joe@bostonharborwater.com",
    });
    expect(extractOtherRecipients(message)).toEqual(["jack@bostonharborwater.com", "joe@bostonharborwater.com"]);
  });

  it("only excludes the owner's real inbox, not a different address of his own (e.g. a forwarded day-job email)", () => {
    // Real shape of job 26-0001's thread — Tim forwarded a real order from
    // his old FLI Environmental address, so the message's own From/To
    // headers are just Tim forwarding to himself, not the actual BHWR team
    // (who are only named inside the forwarded body text, not these
    // headers) — extractOtherRecipients has no way to know that, so this
    // case is expected to need a manual fix rather than a good automatic
    // recipient list.
    const message = messageWithHeaders({
      From: "Timothy Hall <thall@flienv.com>",
      To: "tim@commonwealthinspectionservices.com",
    });
    expect(extractOtherRecipients(message)).toEqual(["thall@flienv.com"]);
  });

  if (originalOwnerEmail === undefined) delete process.env.OWNER_EMAIL;
  else process.env.OWNER_EMAIL = originalOwnerEmail;
});
