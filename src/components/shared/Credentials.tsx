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
const CREDENTIALS = [
  {
    key: "asbestos",
    label: "Asbestos Consulting Service Provider",
    detail: "License #AF154",
    issuer: "Mass. Department of Labor Standards",
  },
  {
    key: "internachi",
    label: "InterNACHI Member",
    issuer: "International Association of Certified Home Inspectors",
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
          <div key={c.key} className="overflow-x-auto rounded-lg border border-slate-200 p-4 text-center">
            <p className="whitespace-nowrap text-sm sm:text-base">
              <span className="font-bold text-brand-700">{c.label}</span>
              {c.detail && <span className="text-slate-600"> — {c.detail}</span>}
              <span className="text-slate-500"> — {c.issuer}</span>
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
