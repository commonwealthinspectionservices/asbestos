import { describe, it, expect } from "vitest";
import { formatDateLongOrdinal } from "@/lib/date-format";

describe("formatDateLongOrdinal", () => {
  it("uses st/nd/rd/th correctly across the month, including the 11-13 exception", () => {
    expect(formatDateLongOrdinal(new Date(2026, 7, 1))).toBe("August 1st, 2026");
    expect(formatDateLongOrdinal(new Date(2026, 7, 2))).toBe("August 2nd, 2026");
    expect(formatDateLongOrdinal(new Date(2026, 7, 3))).toBe("August 3rd, 2026");
    expect(formatDateLongOrdinal(new Date(2026, 7, 4))).toBe("August 4th, 2026");
    expect(formatDateLongOrdinal(new Date(2026, 7, 11))).toBe("August 11th, 2026");
    expect(formatDateLongOrdinal(new Date(2026, 7, 12))).toBe("August 12th, 2026");
    expect(formatDateLongOrdinal(new Date(2026, 7, 13))).toBe("August 13th, 2026");
    expect(formatDateLongOrdinal(new Date(2026, 7, 20))).toBe("August 20th, 2026");
    expect(formatDateLongOrdinal(new Date(2026, 7, 21))).toBe("August 21st, 2026");
    expect(formatDateLongOrdinal(new Date(2026, 7, 22))).toBe("August 22nd, 2026");
    expect(formatDateLongOrdinal(new Date(2026, 7, 23))).toBe("August 23rd, 2026");
    expect(formatDateLongOrdinal(new Date(2026, 7, 31))).toBe("August 31st, 2026");
  });
});
