// Shared between the public marketing service pages (src/app/services/*)
// and the portal's own copies (src/app/portal/services/*) — same
// descriptions, just wrapped in a different nav/footer per surface so a
// logged-in client clicking "Services" never leaves the portal shell.

export function AsbestosServiceInfo() {
  return (
    <>
      <h1 className="text-2xl font-bold uppercase text-brand-700">Asbestos Inspection Services</h1>

      <div className="mt-6 space-y-4">
        <div className="rounded-lg border border-slate-200 p-4">
          <h3 className="font-bold text-brand-700">Limited Asbestos Inspection</h3>
          <p className="mt-1 text-slate-700">
            Our standard inspection for most residential and light commercial projects. We
            evaluate and sample the specific materials tied to your renovation scope — the
            flooring, plaster, or drywall in one room, for example — rather than surveying the
            whole building. It&apos;s the right choice for most bathroom and kitchen remodels,
            flooring replacements, and general renovation work where only part of the property
            is being disturbed.
          </p>
        </div>
        <div className="rounded-lg border border-slate-200 p-4">
          <h3 className="font-bold text-brand-700">Pre-Renovation Asbestos Inspection</h3>
          <p className="mt-1 text-slate-700">
            Priced and scoped the same as a limited inspection, but tied specifically to
            renovation work that&apos;s about to begin. Sampling focuses on the materials your
            contractor is actually going to cut, sand, or remove, so the report lines up
            directly with the project and supports your permit application. Best for
            homeowners and contractors who already have a renovation scope defined and need
            documentation before work starts.
          </p>
        </div>
        <div className="rounded-lg border border-slate-200 p-4">
          <h3 className="font-bold text-brand-700">Pre-Demolition Asbestos Inspection</h3>
          <p className="mt-1 text-slate-700">
            A more comprehensive survey covering the entire structure rather than one area,
            required before full or partial demolition in Massachusetts. Because demolition
            affects the whole building instead of a single room, this inspection evaluates all
            accessible materials throughout the property, which is why it carries a higher base
            fee than a limited or pre-renovation inspection. Best for full-property demolition,
            tear-downs, and whole-house gut renovations.
          </p>
        </div>
      </div>
    </>
  );
}

export function MoldServiceInfo() {
  return (
    <>
      <h1 className="text-2xl font-bold uppercase text-brand-700">Mold Inspection Services</h1>

      <div className="mt-6 space-y-4">
        <div className="rounded-lg border border-slate-200 p-4">
          <h3 className="font-bold text-brand-700">Mold Air Sampling</h3>
          <p className="mt-1 text-slate-700">
            A sample of the air in a specific room or area, tested and compared against an
            outdoor baseline to see whether indoor mold spore counts are elevated — one sample
            per area. This is the right test when there&apos;s a musty smell, health symptoms,
            or a general air-quality concern, but nothing visibly growing on a surface.
          </p>
        </div>
        <div className="rounded-lg border border-slate-200 p-4">
          <h3 className="font-bold text-brand-700">Mold Bulk Sampling</h3>
          <p className="mt-1 text-slate-700">
            A physical piece of an affected material — a section of drywall, insulation, or
            subfloor — is collected and sent to the lab to identify what&apos;s growing and how
            extensive it is, one sample per material. Best for when mold is visible on a
            specific material and you need to know exactly what you&apos;re dealing with before
            remediation.
          </p>
        </div>
        <div className="rounded-lg border border-slate-200 p-4">
          <h3 className="font-bold text-brand-700">Mold Swab Sampling</h3>
          <p className="mt-1 text-slate-700">
            A swab taken directly from a surface with visible growth or staining, used to
            quickly confirm whether it&apos;s actually mold — one sample per material or
            surface. Often the fastest way to get a clear answer on a suspicious stain on a
            wall, ceiling, or other surface before deciding on next steps.
          </p>
        </div>
      </div>
    </>
  );
}

export function LeadServiceInfo() {
  return (
    <>
      <h1 className="text-2xl font-bold uppercase text-brand-700">Lead Services</h1>

      <div className="mt-6 rounded-lg border border-slate-200 p-4">
        <h3 className="font-bold text-brand-700">Lead Paint Sampling</h3>
        <p className="mt-1 text-slate-700">
          We collect paint chip samples from the specific surfaces your project will disturb —
          walls, trim, windows, siding, and similar — and send them to an accredited lab for
          analysis. Because lead paint is typically layered under newer coats, each surface is
          sampled in a pair to get a reliable read through all of the paint layers present.
          This is the right test before sanding, scraping, cutting, or demolishing painted
          surfaces in a home built before 1978, and it&apos;s often part of the permitting
          process for renovation or demolition work on older properties.
        </p>
      </div>
    </>
  );
}
