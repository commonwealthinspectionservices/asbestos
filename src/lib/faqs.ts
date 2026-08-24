// Migrated from the retired asbestosinspectornearme.com Wix FAQ page.
export interface Faq {
  question: string;
  answer: string;
  /** Untagged = asbestos (the original migrated set). Used to pull just the
   * mold ones onto the /mold-testing/[town] local landing pages. */
  category?: "mold";
}

export const faqs: Faq[] = [
  {
    question: "What is an asbestos inspection?",
    answer:
      "An asbestos inspection (also called an asbestos survey) is a professional evaluation performed by a licensed Asbestos Inspector. The inspector identifies materials that may contain asbestos, collects samples if necessary and documents the findings in a written report.",
  },
  {
    question: "What is asbestos and why is it a concern in Massachusetts?",
    answer:
      "Asbestos is a naturally occurring mineral that was widely used in construction materials for its heat resistance and durability. In Massachusetts, asbestos is especially common because many residential and commercial buildings were built or renovated before regulations limited its use. When asbestos-containing materials are disturbed, microscopic fibers can become airborne and inhaled, which is why the state requires asbestos inspections before renovation or demolition activities.",
  },
  {
    question: "How do I know if my home or building has asbestos?",
    answer:
      "You cannot reliably identify asbestos by sight alone. Many asbestos-containing materials look identical to non-asbestos materials. The only way to know for sure is through a professional asbestos inspection that includes sampling and laboratory testing by an accredited asbestos testing lab.",
  },
  {
    question: "What types of projects require an asbestos inspection?",
    answer:
      "Asbestos inspections are commonly required for:\n- Interior renovations\n- Building demolition\n- Kitchen and bathroom remodels\n- Boiler and heating system replacement\n- Floor removal\n- Ceiling or wall removal\n- Commercial tenant fit-outs\n\nEven small projects can trigger inspection requirements if asbestos-containing materials may be disturbed.",
  },
  {
    question: "What materials commonly contain asbestos?",
    answer:
      "Common asbestos-containing materials found during inspections include:\n- Pipe insulation and thermal system insulation\n- Boiler and furnace insulation\n- Vinyl floor tiles and sheet flooring\n- Floor tile adhesive and mastic\n- Ceiling tiles and popcorn ceilings\n- Joint compound, plaster, and wallboard\n- Cement siding and shingles (transite)\n- Roofing materials and flashing\n- Window putty and caulking\n- Duct insulation, gaskets, and electrical components",
  },
  {
    question: "How long does an asbestos inspection take?",
    answer:
      "The duration depends on the size of the inspection area, the scope of work and how many areas need to be evaluated.",
  },
  {
    question: "Can I stay in my home during the asbestos inspection?",
    answer:
      "Yes, you can remain in the home during the inspection. Sampling is performed using controlled methods designed to minimize disturbance. If certain areas need to be accessed, the inspector will explain what is happening and answer questions along the way.",
  },
  {
    question: "Do I have to remove asbestos if it's found?",
    answer:
      "Not always. If asbestos-containing materials are in good condition and will not be disturbed, they can sometimes be left in place and managed. Removal is typically required when asbestos will be impacted by construction activities or is already damaged or deteriorating.",
  },
  {
    question: "Can I test for asbestos myself using a DIY kit?",
    answer:
      "DIY asbestos testing kits exist, but they are generally not recommended for regulatory compliance. Improper sampling can release fibers into the air and lab results from DIY kits may not be accepted for permits or official documentation. Professional asbestos inspections ensure safe sampling and valid results.",
  },
  {
    question: "How much does an asbestos inspection cost?",
    answer:
      "The cost of an asbestos inspection depends on several factors, including:\n- Property size\n- Number of samples required\n- Accessibility of materials\n- Turnaround time for lab results",
  },
  {
    question: "Is asbestos inspection covered by insurance?",
    answer:
      "Coverage varies by insurance policy. Some insurers may cover asbestos inspections related to damage or claims, while others do not. It's best to check directly with your insurance provider.",
  },
  {
    question: "What does the asbestos inspection report include?",
    answer:
      "A professional asbestos inspection report typically includes:\n- Property information\n- Scope of inspection\n- Locations of suspect materials\n- Laboratory results\n- Material quantities and conditions\n- Regulatory compliance documentation\n\nThis report is often required for permitting and project approval.",
  },
  {
    question: "What is mold air sampling?",
    answer:
      "Mold air sampling pulls a measured volume of air through a small cassette in a specific room or area, then compares the spore count and types in a lab against an outdoor baseline sample taken at the same time. That comparison is what actually shows whether indoor mold levels are elevated — some mold spores in outdoor air is completely normal, so testing indoor air alone wouldn't tell you much on its own.",
    category: "mold",
  },
  {
    question: "How is mold air sampling different from mold bulk or swab sampling?",
    answer:
      "Air sampling tests the air itself, and is the right call when there's a musty smell or general air-quality concern but nothing visibly growing on a surface. Bulk sampling collects a physical piece of an affected material — drywall, insulation, subfloor — to identify what's growing on something you can already see. Swab sampling is a quick swab taken directly from a stained or suspicious surface to confirm whether it's actually mold. It's common to need more than one type in the same visit.",
    category: "mold",
  },
  {
    question: "When should I get a mold air quality test?",
    answer:
      "The most common reasons are a musty smell with no visible source, recent water damage or a past leak (even one that's already been fixed), ongoing allergy-like symptoms that seem tied to being in the house, or wanting a clear answer before buying a home. None of these prove mold is present on their own — that's exactly what the test is for.",
    category: "mold",
  },
  {
    question: "How much does mold air sampling cost in Massachusetts?",
    answer:
      "Most mold air sampling runs between $700 and $900, depending on how many areas of the home are tested and whether an outdoor baseline sample is included. Pricing breaks down into a base visit fee plus a per-sample lab cost, similar to how asbestos testing is priced.",
    category: "mold",
  },
  {
    question: "Is mold testing worth it before buying a house?",
    answer:
      "It's a common step for buyers, especially with a finished basement or any history of water issues — a pre-purchase air test gives you a clear, lab-backed answer before you're committed, rather than finding out about a musty smell after closing.",
    category: "mold",
  },
  {
    question: "Should I be cautious of free or discounted mold testing?",
    answer:
      "Yes. \"Free\" or heavily discounted mold testing is often offered by companies that also sell mold remediation — which creates a financial incentive to find a problem for them to fix. An inspector who only tests, and doesn't also perform remediation, has no reason to tell you anything other than what the lab results actually show.",
    category: "mold",
  },
  {
    question: "How long does mold air sampling take?",
    answer:
      "The site visit itself is usually quick — collecting an air sample per area plus an outdoor baseline typically takes well under an hour. Lab results are normally back within 24 to 48 hours, faster with rush turnaround.",
    category: "mold",
  },
];
