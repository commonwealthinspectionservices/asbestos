// Public-facing licensing/credibility badges — shown on the homepage and
// service landing pages. Deliberately just the business-level license (not
// Tim's individual inspector license number, which stays off the public
// site per his explicit call), and deliberately NOT claiming a "Certified
// Mold Inspector" title — he's an InterNACHI member and passed their mold
// inspection course, but is still an applicant for full CPI membership, so
// this sticks to what's true today rather than overstating it. Extend
// CREDENTIALS as more certifications (e.g. a finished CPI membership) come in.
const CREDENTIALS = [
  {
    label: "Asbestos Consulting Service Provider",
    detail: "License #AF154",
    issuer: "Massachusetts Department of Labor Standards",
  },
  {
    label: "InterNACHI Member",
    detail: `Completed: "How to Perform Mold Inspections"`,
    issuer: "International Association of Certified Home Inspectors",
  },
];

export default function Credentials() {
  return (
    <div className="mx-auto max-w-4xl px-4">
      <h2 className="text-center text-xl font-black uppercase text-brand-700">
        Licensed &amp; Certified
      </h2>
      <div className="mx-auto mt-4 grid max-w-2xl grid-cols-1 gap-4 sm:grid-cols-2">
        {CREDENTIALS.map((c) => (
          <div key={c.label} className="rounded-lg border border-slate-200 p-4 text-center">
            <p className="font-bold text-brand-700">{c.label}</p>
            <p className="mt-1 text-sm text-slate-600">{c.detail}</p>
            <p className="mt-1 text-xs text-slate-500">{c.issuer}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
