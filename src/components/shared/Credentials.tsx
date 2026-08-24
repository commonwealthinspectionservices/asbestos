// Public-facing licensing/credibility badges. Shown on the homepage (both
// credentials, since it covers every service) and on the individual service
// pages filtered to just the credential relevant to that service — showing
// the asbestos license on the mold page (or vice versa) read as confusing/
// out of place, so callers pass `show` to pick which ones apply. Deliberately
// just the business-level license (not Tim's individual inspector license
// number, which stays off the public site per his explicit call), and no
// mention of the mold inspection course he completed through InterNACHI,
// since he's still an applicant for full CPI membership rather than
// formally mold-certified. Extend CREDENTIALS as more come in.
//
// Field order (label, then issuer, then detail) is deliberate — the license
// number reads as the "fine print" and belongs last/at the bottom, not
// sandwiched between the title and the issuing body.
const CREDENTIALS: {
  key: string;
  label: string;
  issuer: string;
  detail?: string;
  /** Mobile-only manual line break point within `issuer` — natural wrap on
   * a narrow screen split "Certified" from "Home Inspectors" instead, which
   * reads worse than breaking after "of". Desktop has room to stay on one
   * line, so this only affects the stacked mobile rendering. */
  mobileIssuerBreakAfter?: string;
}[] = [
  {
    key: "asbestos",
    label: "Asbestos Consulting Service Provider",
    issuer: "Mass. Department of Labor Standards",
    detail: "License #AF154",
  },
  {
    key: "internachi",
    label: "InterNACHI Member",
    issuer: "International Association of Certified Home Inspectors",
    mobileIssuerBreakAfter: "International Association of",
  },
];

export default function Credentials({ show }: { show?: string[] }) {
  const items = show ? CREDENTIALS.filter((c) => show.includes(c.key)) : CREDENTIALS;
  if (items.length === 0) return null;

  return (
    <div className="mx-auto max-w-4xl px-4">
      <h2 className="text-center text-xl font-black uppercase text-brand-700">
        Licensed &amp; Certified
      </h2>
      <div className="mx-auto mt-4 space-y-3">
        {items.map((c) => (
          <div key={c.key} className="rounded-lg border border-slate-200 p-4 text-center">
            {/* Mobile: no room for one line, so each piece of information
                (label, issuer, license #) gets its own line instead of
                wrapping mid-sentence or forcing a horizontal scroll. */}
            <div className="sm:hidden">
              <p className="text-base font-bold text-brand-700">{c.label}</p>
              <p className="mt-1 text-base text-slate-500">
                {c.mobileIssuerBreakAfter ? (
                  <>
                    {c.mobileIssuerBreakAfter}
                    <br />
                    {c.issuer.slice(c.mobileIssuerBreakAfter.length + 1)}
                  </>
                ) : (
                  c.issuer
                )}
              </p>
              {c.detail && <p className="mt-1 text-base text-slate-600">{c.detail}</p>}
            </div>
            {/* Desktop: enough width for all of it on one line. */}
            <p className="hidden whitespace-nowrap text-base sm:block">
              <span className="font-bold text-brand-700">{c.label}</span>
              <span className="text-slate-500"> — {c.issuer}</span>
              {c.detail && <span className="text-slate-600"> — {c.detail}</span>}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
