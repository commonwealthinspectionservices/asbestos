import { describe, it, expect } from "vitest";
import { stripGmailForwardBoilerplate } from "@/lib/job-intake";

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
});
