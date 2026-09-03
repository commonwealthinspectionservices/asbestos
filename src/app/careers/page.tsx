import type { Metadata } from "next";
import MarketingNav from "@/components/marketing/MarketingNav";
import MarketingFooter from "@/components/marketing/MarketingFooter";
import CareerInterestForm from "@/components/marketing/CareerInterestForm";

export const metadata: Metadata = {
  title: "Careers | Commonwealth Inspection Services, LLC.",
  description: "Interested in working with Commonwealth Inspection Services? Learn what asbestos, mold, lead, and moisture inspections actually involve and let us know you're interested.",
};

export default function CareersPage() {
  return (
    <div className="min-h-screen bg-white">
      <MarketingNav />
      <div className="mx-auto max-w-2xl px-4 py-10">
        <h1 className="text-2xl font-bold uppercase text-brand-700">Work With Us</h1>
        <p className="mt-3 text-slate-700">
          Commonwealth Inspection Services is a Massachusetts-based independent testing
          company — asbestos, mold, and lead paint inspections, plus moisture mapping. We
          test materials and report what&apos;s actually there; we don&apos;t sell removal or
          repair work, so there&apos;s never a conflict of interest in what we find.
        </p>
        <p className="mt-3 text-slate-700">
          We&apos;re looking for people to help with fieldwork — on-site sample collection,
          documentation, and getting samples to the lab. If you&apos;re a firefighter, this
          kind of work tends to fit well: you&apos;re already comfortable in occupied
          buildings, moving carefully around a work site, and following a strict procedure
          exactly — which is most of what this job actually is. Below is what each service
          involves, so you know what you&apos;d actually be doing before you tell us
          you&apos;re interested.
        </p>

        <div className="mt-8 flex flex-col gap-4">
          <div className="rounded-lg border border-slate-200 p-4">
            <h3 className="font-bold text-brand-700">Asbestos Inspections</h3>
            <p className="mt-1 text-slate-700">
              We collect small physical pieces of a suspect material — flooring, plaster,
              siding, insulation, whatever&apos;s about to be disturbed by a renovation or
              demolition. There are a few flavors of this:
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-slate-700">
              <li>
                <strong>Limited Inspection</strong> — just the specific materials tied to a
                defined renovation scope (say, the flooring in one bathroom).
              </li>
              <li>
                <strong>Pre-Renovation Inspection</strong> — same idea, tied to a permit
                application for a planned renovation project.
              </li>
              <li>
                <strong>Pre-Demolition Inspection</strong> — a full-building survey, every
                accessible material, required in Massachusetts before a building comes
                down.
              </li>
            </ul>
            <p className="mt-2 text-slate-700">
              Each sample gets bagged, labeled with a field code, and logged on a chain of
              custody form (more on that below) before it goes to the lab, which tests it
              under a microscope for asbestos fibers.
            </p>
          </div>

          <div className="rounded-lg border border-slate-200 p-4">
            <h3 className="font-bold text-brand-700">Mold Inspections</h3>
            <p className="mt-1 text-slate-700">There are three ways we sample for mold, and a job might use one or all three:</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-slate-700">
              <li>
                <strong>Air sampling</strong> — a pump draws air through a small cassette for
                a set amount of time, in each room of concern plus an outdoor sample to
                compare against. Used when there&apos;s a musty smell or air-quality concern
                but nothing visibly growing.
              </li>
              <li>
                <strong>Bulk sampling</strong> — cutting a small physical piece of an
                affected material (drywall, insulation, subfloor) where mold is visibly
                growing on it.
              </li>
              <li>
                <strong>Swab sampling</strong> — wiping a sterile swab across a visible stain
                or suspected growth, the fastest way to just confirm what something is.
              </li>
            </ul>
            <p className="mt-2 text-slate-700">
              Same as asbestos — everything gets logged and shipped to the lab, which
              identifies and counts what&apos;s actually present under a microscope.
            </p>
          </div>

          <div className="rounded-lg border border-slate-200 p-4">
            <h3 className="font-bold text-brand-700">Lead Paint Inspections</h3>
            <p className="mt-1 text-slate-700">
              For homes built before 1978, we take paint chip samples — cutting down through
              all the layers of paint on a surface — from walls, trim, windows, or siding
              that a renovation project is about to sand, scrape, or demolish. Samples are
              logged and shipped to the lab the same way, which tests for total lead content.
              This is usually part of a permitting process before work can start.
            </p>
          </div>

          <div className="rounded-lg border border-slate-200 p-4">
            <h3 className="font-bold text-brand-700">Moisture Mapping</h3>
            <p className="mt-1 text-slate-700">
              This one&apos;s different — no samples, no lab. We use a handheld moisture
              meter, passed over walls, ceilings, and floors, starting at the wettest point
              and working outward until the reading returns to normal. We mark that boundary
              with blue painter&apos;s tape and photograph it, room by room. It&apos;s a
              same-day, non-destructive way to document how far water damage has actually
              spread.
            </p>
          </div>

          <div className="rounded-lg border border-slate-200 bg-brand-50 p-4">
            <h3 className="font-bold text-brand-700">Chain of Custody &amp; Getting Samples to the Lab</h3>
            <p className="mt-1 text-slate-700">
              This is the part that has to be done exactly right every time — it&apos;s what
              makes the lab results legally defensible. Every sample gets:
            </p>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-slate-700">
              <li>A field code written on the bag/container at the moment it&apos;s collected.</li>
              <li>
                An entry on the chain of custody (COC) form — what it is, where it came
                from, when it was taken — filled out on site, not from memory later.
              </li>
              <li>
                Sealed and kept with the COC form until it&apos;s handed off — the paper
                trail has to show the sample was never out of custody or unaccounted for.
              </li>
              <li>
                Delivered to the lab (or shipped, depending on the day) along with the COC
                form, which the lab signs to confirm receipt.
              </li>
            </ol>
            <p className="mt-2 text-slate-700">
              The lab turns results around, we write up the report, and it goes out to the
              client. That whole process — collection through report — is what a field
              technician here is actually responsible for.
            </p>
          </div>
        </div>

        <div className="mt-8">
          <CareerInterestForm />
        </div>
      </div>
      <MarketingFooter />
    </div>
  );
}
