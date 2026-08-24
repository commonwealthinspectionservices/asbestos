// A prominent trust callout — deliberately visually distinct (colored
// background, not just another plain white section) since this is the
// single biggest thing separating an independent inspector from a company
// that also sells the abatement/remediation/removal work its own testing
// would justify. True across every service here (asbestos, mold, lead), not
// just mold, so the copy stays generic rather than naming one — shown high
// up on the homepage and every individual service page, where the "is this
// legit" decision actually gets made.
export default function IndependentTestingBanner() {
  return (
    <div className="bg-yellow-100 px-4 py-8">
      <div className="mx-auto max-w-3xl text-center">
        <h2 className="text-lg font-black uppercase text-brand-700 sm:text-xl">
          Independent Testing. No Abatement. No Conflict of Interest.
        </h2>
        <p className="mt-3 text-sm text-brand-700 sm:text-base">
          We only test — we don&apos;t sell abatement, remediation, or removal work of any
          kind. A lot of &quot;free&quot; or discounted testing comes from companies who
          profit from finding a problem for them to fix. Since we have no abatement business
          on the other side, our results are just the results — an honest, unbiased answer
          instead of a sales pitch.
        </p>
      </div>
    </div>
  );
}
