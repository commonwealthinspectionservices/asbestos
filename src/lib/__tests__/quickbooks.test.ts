import { describe, it, expect } from "vitest";
import { weekEndingFridayFor } from "@/lib/quickbooks";

describe("weekEndingFridayFor", () => {
  it("maps every day in a Saturday-through-Friday week to that week's own Friday", () => {
    // Sat 9/26 through Fri 10/2, 2026.
    expect(weekEndingFridayFor("2026-09-26")).toBe("2026-10-02"); // Saturday (week start)
    expect(weekEndingFridayFor("2026-09-27")).toBe("2026-10-02"); // Sunday
    expect(weekEndingFridayFor("2026-09-28")).toBe("2026-10-02"); // Monday
    expect(weekEndingFridayFor("2026-09-30")).toBe("2026-10-02"); // Wednesday
    expect(weekEndingFridayFor("2026-10-02")).toBe("2026-10-02"); // Friday (week end)
  });

  it("rolls over correctly across a month boundary", () => {
    // Sat 9/26 is the start of the week ending Fri 10/2 — one day earlier
    // (Fri 9/25) belongs to the PRIOR week, ending 9/25 itself.
    expect(weekEndingFridayFor("2026-09-25")).toBe("2026-09-25");
  });
});
