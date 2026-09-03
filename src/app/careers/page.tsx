import type { Metadata } from "next";
import MarketingNav from "@/components/marketing/MarketingNav";
import MarketingFooter from "@/components/marketing/MarketingFooter";
import CareerInterestForm from "@/components/marketing/CareerInterestForm";

const TITLE = "Join Our Talent Pool | Commonwealth Inspection Services, LLC.";
const DESCRIPTION =
  "Interested in fieldwork with Commonwealth Inspection Services? Learn what asbestos and mold inspections actually involve, what a day in the field looks like, and let us know you're interested.";

// Root layout's own openGraph/twitter blocks don't merge FIELD BY FIELD
// with this page's — Next replaces the whole nested object wholesale once
// a route declares its own (confirmed live: declaring just title/
// description here dropped the image/url/siteName entirely) — so
// url/siteName/images/type/card need repeating here too, not just the
// title/description this page actually wants to override.
export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: "https://www.commonwealthinspectionservices.com/careers",
    siteName: "Commonwealth Inspection Services, LLC.",
    images: ["/logo.png"],
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: TITLE,
    description: DESCRIPTION,
    images: ["/logo.png"],
  },
};

export default function CareersPage() {
  return (
    <div className="min-h-screen bg-white">
      <MarketingNav />
      <div className="mx-auto max-w-2xl px-4 py-10">
        <h1 className="text-2xl font-bold uppercase text-brand-700">Join Our Talent Pool</h1>
        <p className="mt-3 text-slate-700">
          Commonwealth Inspection Services is a Massachusetts-based independent testing
          company — asbestos and mold inspections, plus moisture mapping.
        </p>
        <p className="mt-3 text-slate-700">
          We&apos;re building a talent pool of people we can call on for fieldwork — on-site
          sample collection, documentation, and getting samples to the lab. It&apos;s a
          particularly good fit for firefighters: you&apos;re already comfortable working in
          occupied buildings, moving carefully around an active site, and following a strict
          procedure exactly — and it works well alongside a shift-based schedule, since jobs
          are typically a few hours, scheduled ahead of time. Below is what each service
          involves and what a typical day looks like, so you know what you&apos;d actually be
          doing before you tell us you&apos;re interested.
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
            <p className="mt-2 text-slate-700">
              This side of the work does require a license — asbestos inspection is
              EPA-regulated. Getting there means a 3-day (24-hour) &ldquo;Asbestos
              Inspector&rdquo; course — we use the{" "}
              <a
                href="https://ieetraining.com/CLASSES_at_the_Institute.php"
                target="_blank"
                rel="noopener noreferrer"
                className="text-brand-600 underline hover:text-brand-700"
              >
                Institute for Environmental Education (IEE)
              </a>{" "}
              in Wilmington, MA — covering building records review, visual inspection
              procedures, bulk sampling protocols, PPE, and report writing, followed by a
              short annual refresher to keep the credential current. We can talk through
              timing and cost as part of getting you started.
            </p>
          </div>

          <div className="rounded-lg border border-slate-200 p-4">
            <h3 className="font-bold text-brand-700">Mold Inspections</h3>
            <p className="mt-1 text-slate-700">
              No license required for this one in Massachusetts — it&apos;s a more
              accessible starting point than asbestos.
            </p>
            <p className="mt-2 text-slate-700">There are three ways we sample for mold, and a job might use one or all three:</p>
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
            <p className="mt-2 text-slate-700">
              A lot of this work is real, everyday homeowner situations — a basement floods,
              a pipe bursts, or there&apos;s water/smoke damage after a fire, and mold shows
              up in the aftermath. The final report isn&apos;t just paperwork: it&apos;s what
              insurance companies require to process a claim, and often what the town
              building department requires before repair or renovation work can move
              forward.
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
            <p className="mt-2 text-slate-700">
              This is usually the same kind of call as mold — a flooded basement or a burst
              pipe — just earlier in the process, right after the water event. Same deal on
              the report: it&apos;s what insurance and the building department end up
              relying on.
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
              contractor, property manager, or homeowner who requested it. That whole
              process — collection through report — is what a field technician here is
              actually responsible for.
            </p>
          </div>

          <div className="rounded-lg border border-slate-200 p-4">
            <h3 className="font-bold text-brand-700">What a Day in the Field Looks Like</h3>
            <p className="mt-1 text-slate-700">
              Jobs are scheduled ahead of time, usually a few hours each, so it fits around a
              rotating schedule. A typical day might look like:
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-slate-700">
              <li>
                Arrive at the property, check in with the owner or contractor, and walk the
                space to see what&apos;s actually there before touching anything.
              </li>
              <li>
                Collect samples per the job&apos;s scope — cutting a small piece of material,
                running an air pump, wiping a swab, or reading a moisture meter, depending on
                the service.
              </li>
              <li>
                Log everything on the chain of custody form as you go — field code, location,
                time — not from memory afterward.
              </li>
              <li>
                Bag, seal, and label each sample, then get it to the lab (or shipped) the same
                day or next, along with the signed COC form.
              </li>
              <li>
                Move on to the next site, or wrap for the day — no on-call nights, no
                emergency response.
              </li>
            </ul>
          </div>

          <div className="rounded-lg border border-slate-200 p-4">
            <h3 className="font-bold text-brand-700">Training &amp; Getting You Up to Speed</h3>
            <p className="mt-1 text-slate-700">
              You won&apos;t be dropped into a job cold. We&apos;ll put in real training time
              on sampling technique, chain of custody, and how to move through a site — plus
              walk through actual past reports together so you can see exactly what the
              finished product looks like and what it takes to get there before you&apos;re
              out on your own.
            </p>
          </div>

          <div className="rounded-lg border border-slate-200 p-4">
            <h3 className="font-bold text-brand-700">Useful Links</h3>
            <p className="mt-1 text-slate-700">
              Some background if you want to read more before you join:
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-slate-700">
              <li>
                <a href="/services/asbestos" className="text-brand-600 underline hover:text-brand-700">
                  Our Asbestos Inspection services
                </a>
              </li>
              <li>
                <a href="/services/mold" className="text-brand-600 underline hover:text-brand-700">
                  Our Mold Inspection services
                </a>
              </li>
              <li>
                <a
                  href="https://ieetraining.com/CLASSES_at_the_Institute.php"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-brand-600 underline hover:text-brand-700"
                >
                  IEE — Asbestos Inspector course (Wilmington, MA)
                </a>
              </li>
              <li>
                <a
                  href="https://www.mass.gov/asbestos-safety-program"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-brand-600 underline hover:text-brand-700"
                >
                  Massachusetts Asbestos Safety Program (mass.gov)
                </a>
              </li>
              <li>
                <a
                  href="https://www.osha.gov/asbestos/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-brand-600 underline hover:text-brand-700"
                >
                  OSHA — Asbestos overview
                </a>
              </li>
              <li>
                <a
                  href="https://www.epa.gov/mold/learn-about-mold"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-brand-600 underline hover:text-brand-700"
                >
                  EPA — Learn About Mold
                </a>
              </li>
            </ul>
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
