import { describe, it, expect } from "vitest";
import { parseNewAssignmentEmail, parseRescheduledEmail } from "@/lib/parse-subcontractor-assignment";

// Verbatim (formatting preserved) from a real Fast Mold Testing "New
// Assignment" email — including the stray HTML comment their own template
// leaks into the sent email between the Job Notes label and its value,
// which the parser must not capture as content.
const NEW_ASSIGNMENT_HTML = `
<table style="width: 100%; border-collapse: collapse;">
  <tr>
    <td style="padding: 8px 0; color: #718096; width: 120px;">Preferred Windows:</td>
    <td style="padding: 8px 0; color: #2d3748;">
      <div style="margin-bottom: 0;">
        <strong>Window 1:</strong> Wednesday, August 19, 2026, 8:00 AM - 4:00 PM
      </div>
    </td>
  </tr>
  <tr>
    <td style="padding: 8px 0; color: #718096;">Address:</td>
    <td style="padding: 8px 0; color: #2d3748;">352 Centre Street, Boston, MA 02122</td>
  </tr>
</table>
<table style="width: 100%; border-collapse: collapse;">
  <tr>
    <td style="padding: 8px 0; color: #718096; width: 180px;">Base Compensation:</td>
    <td style="padding: 8px 0; color: #2d3748; font-weight: 600;">$470.16</td>
  </tr>
  <tr>
    <td style="padding: 8px 0; color: #718096;">Est. Lab Fees (4 samples):</td>
    <td style="padding: 8px 0; color: #dc2626; font-weight: 600;">-$100.00</td>
  </tr>
  <tr>
    <td style="padding: 12px 0 8px; color: #166534; font-weight: 600;">Est. Net Payment:</td>
    <td style="padding: 12px 0 8px; color: #166534; font-weight: 700; font-size: 18px;">$370.16</td>
  </tr>
</table>
<table style="width: 100%; border-collapse: collapse;">
  <tr>
    <td style="padding: 8px 0; color: #718096; width: 120px;">Name:</td>
    <td style="padding: 8px 0; color: #2d3748;">Shaki</td>
  </tr>
  <tr>
    <td style="padding: 8px 0; color: #718096;">Email:</td>
    <td style="padding: 8px 0; color: #2d3748;">shakid79@gmail.com</td>
  </tr>
  <tr>
    <td style="padding: 8px 0; color: #718096;">Phone:</td>
    <td style="padding: 8px 0; color: #2d3748;">+18573852993</td>
  </tr>
  <tr>
    <td style="padding: 8px 0; color: #718096;">Client Notes:</td>
    <td style="padding: 8px 0; color: #2d3748;">Client believes there is mold in her apartment.</td>
  </tr>
  <tr>
    <td style="padding: 8px 0; color: #718096;">Job Notes:</td>
    <!-- Story 0820 — pre-line, or HTML collapses every newline. -->
    <td style="padding: 8px 0; color: #2d3748; white-space: pre-line;">PLEASE CALL/TEXT CLIENT TO CONFIRM ARRIVAL TIME:

Infrared used in all areas of property by request of client.</td>
  </tr>
</table>
`;

const RESCHEDULED_HTML = `
<p>The inspection at 352 Centre Street, Boston, MA 02122 has been rescheduled:</p>
<p>
  <strong>From:</strong> Wednesday, August 19, 2026 at 8:00 AM - 4:00 PM<br>
  <strong>To:</strong> Wednesday, August 19, 2026 at 1:00 PM - 4:00 PM
</p>
<p>Please update your calendar accordingly.</p>
`;

describe("parseNewAssignmentEmail", () => {
  it("extracts every labeled field from a real assignment email, skipping the stray HTML comment", () => {
    const result = parseNewAssignmentEmail(NEW_ASSIGNMENT_HTML);
    expect(result).toEqual({
      address: "352 Centre Street, Boston, MA 02122",
      preferredWindowText: "Wednesday, August 19, 2026, 8:00 AM - 4:00 PM",
      preferredDate: "2026-08-19",
      clientName: "Shaki",
      clientEmail: "shakid79@gmail.com",
      clientPhone: "+18573852993",
      clientNotes: "Client believes there is mold in her apartment.",
      jobNotes: "PLEASE CALL/TEXT CLIENT TO CONFIRM ARRIVAL TIME:\nInfrared used in all areas of property by request of client.",
      baseCompensation: "$470.16",
      labFees: "-$100.00",
      netPayment: "$370.16",
    });
  });

  it("returns null for a body that doesn't match the expected table format at all", () => {
    expect(parseNewAssignmentEmail("<p>Hey, just checking in.</p>")).toBeNull();
  });
});

describe("parseRescheduledEmail", () => {
  it("extracts the address and new window from a real reschedule email", () => {
    const result = parseRescheduledEmail(RESCHEDULED_HTML);
    expect(result).toEqual({
      address: "352 Centre Street, Boston, MA 02122",
      newWindowText: "Wednesday, August 19, 2026 at 1:00 PM - 4:00 PM",
      newDate: "2026-08-19",
    });
  });

  it("returns null for a body that doesn't match the expected reschedule format", () => {
    expect(parseRescheduledEmail("<p>Unrelated email.</p>")).toBeNull();
  });
});
