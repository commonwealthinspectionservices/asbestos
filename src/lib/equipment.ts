// The equipment pages, 2026-09-08 — per Tim: an extensive page on each
// real piece of equipment used for mold inspections, both to advertise
// the mold service and to make the site look "legit" rather than
// generic (a real, named instrument beats a stock photo). Same
// markdown-lite body grammar as blog-posts.ts (renderLiteMarkdown).
// image is left null until Tim uploads his own photos of the actual
// equipment — deliberately not using manufacturer/marketplace product
// photography here (not his to use commercially), see EquipmentPage's
// own placeholder treatment for a null image.
export interface Equipment {
  slug: string;
  name: string;
  manufacturer: string;
  tagline: string;
  /** null until Tim uploads a real photo of his own unit. */
  image: string | null;
  specs: string[];
  body: string;
}

export const equipment: Equipment[] = [
  {
    slug: "tramex-moisture-encounter-me5",
    name: "Tramex Moisture Encounter ME5",
    manufacturer: "Tramex",
    tagline: "A non-invasive moisture meter that scans for hidden moisture without cutting into anything.",
    image: null,
    specs: [
      "Non-invasive (pinless) — no holes, no damage to the surface being tested",
      "Reads relative moisture on a 0-100 comparative scale across drywall, plaster, wood, and other common building materials",
      "Scans a wide area quickly instead of testing one small spot at a time",
    ],
    body: `A mold problem almost always starts with moisture somewhere it shouldn't be — a slow leak behind a wall, a damp spot under a window, water that got into a floor and never fully dried. The problem is that moisture is usually hidden. By the time it's visible as staining or actual mold growth, it's often been there for a while.

The Moisture Encounter ME5 solves that without cutting into anything. It's a pinless meter — I run it across a wall, ceiling, or floor and it reads relative moisture through the surface using electronic impedance, no holes or damage required. That means I can scan an entire room, or a whole section of a building, quickly and non-invasively, comparing readings across the surface to find where moisture levels are actually elevated instead of guessing based on a smell or a stain.

## How it helps on a mold inspection

Before any air or bulk sample gets taken, it helps to know where to actually look. A quick scan with the ME5 across suspect walls, ceilings, and floors tells me where moisture is elevated relative to the rest of the surface — which is often the difference between sampling the right spot the first time and having to come back. It's also useful for confirming a moisture source has actually dried out after a repair, before mold sampling or clearance testing.

This isn't a replacement for lab-tested sampling — a moisture reading tells you where to look, not what's actually growing. But it's a fast, non-destructive first step that makes the rest of the inspection more targeted.`,
  },
  {
    slug: "foxwell-rt280-thermal-imaging-camera",
    name: "FOXWELL RT280 Thermal Imaging Camera",
    manufacturer: "FOXWELL",
    tagline: "A handheld thermal camera that shows temperature differences across a whole wall or ceiling at once.",
    image: null,
    specs: [
      "320 x 240 thermal resolution with a 2.8\" LCD display",
      "240 x 180 TISR (thermal image super resolution)",
      "Built-in laser pointer for marking the exact spot a temperature difference shows up",
    ],
    body: `A moisture meter tells me what's happening at the specific spot I point it at. A thermal camera tells me where to point it in the first place. Wet building materials cool as moisture evaporates, and that shows up as a visible temperature difference on a thermal image — even through drywall or plaster, before anything is visibly wet or stained.

I use the RT280 to scan a wall, ceiling, or floor and immediately see cold spots that don't match the surrounding surface — the kind of pattern a leak, a moisture-trapping gap in insulation, or water intrusion typically leaves behind. Instead of scanning an entire room inch by inch with a moisture meter, I can see the whole surface at once and go straight to the areas that actually look different.

## How it helps on a mold inspection

Mold needs a moisture source, and moisture sources aren't always obvious. A thermal scan across a suspect area — around a window, along an exterior wall, under a bathroom, near a roof penetration — often reveals a temperature pattern that lines up with hidden water intrusion long before it's visible any other way. That pattern is what tells me exactly where to follow up with the moisture meter and where sampling actually needs to happen, rather than sampling a room broadly and hoping I picked the right spot.

Like the moisture meter, a thermal camera doesn't identify mold by itself — it's a way of finding where moisture is, fast and non-invasively, so the actual lab-tested sampling ends up in the right place.`,
  },
  {
    slug: "zefon-biopump-iaq-lite",
    name: "Zefon Bio-Pump IAQ Lite (Pro Kit Plus)",
    manufacturer: "Zefon International",
    tagline: "The calibrated air sampling pump that actually collects a mold air sample.",
    image: null,
    specs: [
      "Calibrated flow rate for accurate, repeatable air sampling",
      "Pro Kit Plus includes tripod and accessories for a clean, hands-off sample collection setup",
      "Quiet, compact operation — sits in the room without disrupting anything",
    ],
    body: `This is the pump behind every mold air sample this office collects. Mold air sampling works by pulling a precisely measured volume of air through a cassette over a set period of time — the Bio-Pump IAQ Lite is what does that pulling, at a calibrated, repeatable flow rate that makes the results actually comparable from sample to sample and job to job.

It's set up on a tripod at roughly breathing height in the room or area being tested, runs quietly for a few minutes per sample, and doesn't require touching or disturbing anything else in the space. One sample per area being evaluated, plus an outdoor baseline taken the same way — that comparison is what turns a raw spore count into a meaningful answer.

## How it helps on a mold inspection

This is the actual instrument behind the "Mold Air Sampling" service — every air sample result on a report traces back to a calibrated run on this pump. Accuracy matters here specifically because the flow rate has to be right for the lab to calculate spore concentration correctly; an uncalibrated or inconsistent pump would make the whole comparison (indoor vs. outdoor baseline) unreliable. Keeping this pump properly calibrated is part of what makes the results something you can actually rely on.`,
  },
  {
    slug: "zefon-air-o-cell-cassette",
    name: "Zefon Air-O-Cell Cassette",
    manufacturer: "Zefon International",
    tagline: "The sampling cassette that actually captures what's in the air — the part the lab reads under a microscope.",
    image: null,
    specs: [
      "Industry-standard spore trap cassette, used across the environmental testing industry",
      "Captures mold spores and other airborne particulate on an adhesive-coated slide as air is drawn through it",
      "One cassette per sample — indoor areas and the outdoor baseline each get their own",
    ],
    body: `The Bio-Pump does the pulling, but the Air-O-Cell cassette is what actually captures the sample. Air drawn through the pump passes through the cassette, and airborne particles — including mold spores — get trapped on an adhesive-coated slide inside it. That slide is what goes to the lab.

Air-O-Cell is the industry-standard cassette for this kind of sampling, which matters for consistency: it's the same collection method labs are set up to read and compare against established reference data, rather than a less common cassette type that might introduce its own variability into the results.

## How it helps on a mold inspection

Every mold air sample — each indoor area and the outdoor baseline it's compared against — gets its own sealed cassette, labeled and sent to an accredited lab under chain of custody. Under a microscope, the lab identifies and counts what's actually on the slide: spore types and concentrations, which is what the report is built from. This is the physical link between "a pump ran for a few minutes in this room" and an actual, lab-verified answer about what was in the air.`,
  },
];
