import { describe, expect, it } from "vitest";
import { buildBillingAddress } from "../address";

describe("buildBillingAddress", () => {
  it("labels a bare unit number so it doesn't render as a lone digit", () => {
    expect(
      buildBillingAddress({ street: "29 Tilesboro St", unit: "3", city: "Dorchester", state: "MA", zip: "02122" })
    ).toBe("29 Tilesboro St Unit 3, Dorchester, MA 02122");
  });

  it("doesn't double-label a unit that already names its own type", () => {
    expect(
      buildBillingAddress({ street: "36 Finnell Dr", unit: "Suite 1", city: "Weymouth", state: "MA", zip: "02188" })
    ).toBe("36 Finnell Dr Suite 1, Weymouth, MA 02188");
    expect(
      buildBillingAddress({ street: "1 Main St", unit: "Apt 2", city: "Boston", state: "MA", zip: "02108" })
    ).toBe("1 Main St Apt 2, Boston, MA 02108");
    expect(
      buildBillingAddress({ street: "1 Main St", unit: "#4", city: "Boston", state: "MA", zip: "02108" })
    ).toBe("1 Main St #4, Boston, MA 02108");
  });

  it("omits the unit segment entirely when none is given", () => {
    expect(
      buildBillingAddress({ street: "29 Tilesboro St", unit: "", city: "Dorchester", state: "MA", zip: "02122" })
    ).toBe("29 Tilesboro St, Dorchester, MA 02122");
  });
});
