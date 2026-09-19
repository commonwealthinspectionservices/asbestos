import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { stripGmailForwardBoilerplate, extractOtherRecipients, extractPhoneOnlyReply } from "@/lib/job-intake";
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

describe("extractPhoneOnlyReply", () => {
  it("extracts a phone number from a real Boston Harbor follow-up reply", () => {
    expect(extractPhoneOnlyReply("Phone number is-\n617-319-3631\n")).toBe("617-319-3631");
  });

  it("extracts a phone number with the dash and number on the same line", () => {
    expect(extractPhoneOnlyReply("Phone number is- 617-319-3631")).toBe("617-319-3631");
  });

  it("returns null for a full order email that isn't a phone-only reply", () => {
    expect(extractPhoneOnlyReply("Customer Name\nTim Howard\nAddress\n7 Lafayette st")).toBeNull();
  });

  // The real shapes Boston Harbor used on 26-0037/0038/0039/0023/0027, 2026-09-19.
  it("reads the other reply shapes Boston Harbor actually sends", () => {
    expect(extractPhoneOnlyReply("Number is-\n518-231-1595\n\nOn Wed, Sep 16, 2026 at 4:20 PM Niall Dalton <niall@bostonharborwater.com>\nwrote:\n> Customer Name")).toBe("518-231-1595");
    expect(extractPhoneOnlyReply("Phone number-\n+1 (617) 921-0599\nOn Wed, Sep 16, 2026 at 4:24 PM Niall Dalton <niall@x.com>\nwrote:")).toBe("617-921-0599");
    expect(extractPhoneOnlyReply("978-886-7270, thank you! Again I don't know why that's not going through.\n\nOn Wed, Sep 9, 2026 at 11:20 AM Tim Hall <\ntim@x.com> wrote:")).toBe("978-886-7270");
    expect(extractPhoneOnlyReply("919-452-4709\n\nOn Thu, Sep 10, 2026 at 11:23 AM Tim Hall <\ntim@x.com> wrote:\n\n-- \nJack Cook\n781-985-7432")).toBe("919-452-4709");
  });

  it("ignores a phone number that's only in the quoted history or a signature", () => {
    expect(extractPhoneOnlyReply("Tim, the front door code is 6988.\n\nOn Thu, Sep 10, 2026 at 11:22 AM Niall <n@x.com> wrote:\n> call 617-555-0199")).toBeNull();
    expect(extractPhoneOnlyReply("Sounds good, thanks\n\n-- \nRyan Hammond\nBoston Harbor\n617-555-0100")).toBeNull();
  });

  it("returns null when the message has two different numbers", () => {
    expect(extractPhoneOnlyReply("Call 617-555-0100 or 781-555-0111")).toBeNull();
  });

  it("returns null when fewer than 10 digits follow the lead-in", () => {
    expect(extractPhoneOnlyReply("Phone number is- 555-1234")).toBeNull();
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
