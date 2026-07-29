import type { InvoiceLineItem } from "@/lib/types";

/** Validates and normalizes a raw InvoiceLineItem[] payload. */
export function parseLineItems(raw: unknown): { items: InvoiceLineItem[] } | { error: string } {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { error: "At least one invoice line item is required" };
  }

  const items: InvoiceLineItem[] = [];
  for (const rawItem of raw) {
    const description = typeof rawItem?.description === "string" ? rawItem.description.trim() : "";
    const quantity = Number(rawItem?.quantity);
    const unitCostCents = Number(rawItem?.unit_cost_cents);
    const billingUnit = typeof rawItem?.billing_unit === "string" ? rawItem.billing_unit.trim() : "";

    if (!description) return { error: "Each line item needs a description" };
    if (!Number.isFinite(quantity) || quantity <= 0) return { error: `Invalid quantity for "${description}"` };
    if (!Number.isFinite(unitCostCents) || unitCostCents < 0) return { error: `Invalid unit cost for "${description}"` };

    items.push({ description, quantity, billing_unit: billingUnit || "Each", unit_cost_cents: unitCostCents });
  }

  return { items };
}

export function lineItemsTotalCents(items: InvoiceLineItem[]): number {
  return items.reduce((total, item) => total + Math.round(item.quantity * item.unit_cost_cents), 0);
}
