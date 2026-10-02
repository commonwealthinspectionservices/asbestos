// Straight to a job's invoice in the Stripe dashboard (live mode) — where a
// card on file can actually be charged by hand. Not the customer-facing
// hosted payment page that the Invoice tab's "Stripe Payment Link" opens.
export function stripeDashboardInvoiceUrl(stripeInvoiceId: string): string {
  return `https://dashboard.stripe.com/invoices/${stripeInvoiceId}`;
}
