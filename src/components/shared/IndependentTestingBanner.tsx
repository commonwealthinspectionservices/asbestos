// A prominent trust callout — deliberately visually distinct (colored
// background, not just another plain white section) since this is the
// single biggest thing separating an independent inspector from a
// remediation company that also happens to sell mold testing. Shown high
// up on the homepage and the mold service page, where the "is this legit"
// decision actually gets made.
export default function IndependentTestingBanner() {
  return (
    <div className="bg-brand-700 px-4 py-8">
      <div className="mx-auto max-w-3xl text-center">
        <h2 className="text-lg font-black uppercase text-white sm:text-xl">
          Independent Testing. No Remediation. No Conflict of Interest.
        </h2>
        <p className="mt-3 text-sm text-brand-50 sm:text-base">
          We only test — we don&apos;t sell mold removal or remediation work. A lot of
          &quot;free&quot; or discounted mold testing comes from companies who profit from
          finding a problem for them to fix. Since we have no remediation business on the
          other side, our results are just the results — an honest, unbiased answer instead of
          a sales pitch.
        </p>
      </div>
    </div>
  );
}
