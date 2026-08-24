// Structured data (schema.org JSON-LD) so search engines understand exactly
// what this business is, what it does, and where it operates — helps local
// search ("mold testing near me") and can surface richer results than plain
// HTML alone. No street address on purpose — Tim's explicit call on the
// Licensed & Certified section applies here too; areaServed (region-level)
// covers the "where" without publishing a specific address.
const SCHEMA = {
  "@context": "https://schema.org",
  "@type": "HomeAndConstructionBusiness",
  name: "Commonwealth Inspection Services, LLC",
  url: "https://www.commonwealthinspectionservices.com",
  telephone: "+1-617-390-4778",
  email: "tim@commonwealthinspectionservices.com",
  areaServed: {
    "@type": "State",
    name: "Massachusetts",
  },
  address: {
    "@type": "PostalAddress",
    addressRegion: "MA",
    addressCountry: "US",
  },
  makesOffer: [
    {
      "@type": "Offer",
      itemOffered: {
        "@type": "Service",
        name: "Mold Air Sampling",
        description:
          "Air quality testing to determine whether indoor mold spore counts are elevated compared to an outdoor baseline.",
      },
    },
    {
      "@type": "Offer",
      itemOffered: {
        "@type": "Service",
        name: "Mold Bulk Sampling",
        description: "Lab testing of a physical material sample to identify visible mold growth.",
      },
    },
    {
      "@type": "Offer",
      itemOffered: {
        "@type": "Service",
        name: "Asbestos Inspection",
        description: "Limited, pre-renovation, and pre-demolition asbestos inspections for permits and compliance.",
      },
    },
    {
      "@type": "Offer",
      itemOffered: {
        "@type": "Service",
        name: "Lead Paint Sampling",
        description: "Lead paint sampling of painted surfaces for renovation and demolition compliance.",
      },
    },
  ],
};

export default function LocalBusinessSchema() {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(SCHEMA) }}
    />
  );
}
