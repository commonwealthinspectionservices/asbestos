import { describe, it, expect } from "vitest";
import { extractNamedAddresses } from "@/lib/gmail";

describe("extractNamedAddresses", () => {
  it("keeps a comma inside a quoted display name intact", () => {
    expect(extractNamedAddresses('"Rancourt, Marco @ Nashua" <Marco.Rancourt@cbre.com>')).toEqual([
      { name: "Rancourt, Marco @ Nashua", email: "Marco.Rancourt@cbre.com" },
    ]);
  });

  it("splits a real multi-recipient Cc header, mixing quoted and bare names", () => {
    const header =
      'Jarrett Lau <jarrett@greenoceanpm.com>, "Marquardt, Richard @ Branford" <Richard.Marquardt@cbre.com>, "Maxim, Kevin @ New Bedford" <Kevin.Maxim@cbre.com>, Daniela Sever <4dsever@gmail.com>';
    expect(extractNamedAddresses(header)).toEqual([
      { name: "Jarrett Lau", email: "jarrett@greenoceanpm.com" },
      { name: "Marquardt, Richard @ Branford", email: "Richard.Marquardt@cbre.com" },
      { name: "Maxim, Kevin @ New Bedford", email: "Kevin.Maxim@cbre.com" },
      { name: "Daniela Sever", email: "4dsever@gmail.com" },
    ]);
  });

  it("falls back to a null name for a bare address with no display name", () => {
    expect(extractNamedAddresses("tim@commonwealthinspectionservices.com")).toEqual([
      { name: null, email: "tim@commonwealthinspectionservices.com" },
    ]);
  });

  it("handles a single unquoted display name", () => {
    expect(extractNamedAddresses("Kai Rodriguez <kai@greenoceanpm.com>")).toEqual([
      { name: "Kai Rodriguez", email: "kai@greenoceanpm.com" },
    ]);
  });
});
