import MarketingNav from "@/components/marketing/MarketingNav";
import MarketingFooter from "@/components/marketing/MarketingFooter";
import { getSettings } from "@/lib/settings";

export const metadata = {
  title: "Service Descriptions | Commonwealth Inspection Services, LLC.",
  description: "What each inspection and sampling service covers.",
};

// Mirrors the "(Descriptions)" reference opened from the booking form
// (PortalBookingForm.tsx) — same category grouping and short blurbs, kept
// here as its own page (rather than the in-page modal it used to be) so it
// opens in a new tab without touching the booking flow underneath it.
const CATEGORY_LABELS: Record<string, string> = {
  asbestos: "Asbestos Inspection",
  mold: "Mold Inspection",
  lead: "Lead Paint Sampling",
};

function categoryKeyOf(serviceTypeKey: string): string {
  return serviceTypeKey.split("_")[0];
}

function categoryLabelOf(categoryKeyValue: string): string {
  return CATEGORY_LABELS[categoryKeyValue] ?? categoryKeyValue;
}

function serviceTypeSubtext(key: string): string | null {
  if (key === "asbestos_bulk") return "Sampling of specific area(s) as determined by the client";
  if (key === "mold_air") return "Sampling of indoor air quality";
  if (key === "mold_bulk") return "Sampling physical building materials";
  if (key === "mold_swab") return "Sampling of surfaces";
  return null;
}

export default async function ServiceDescriptionsPage() {
  const settings = await getSettings();
  const serviceTypes = settings.service_types;
  const categories = Array.from(new Set(serviceTypes.map((s) => categoryKeyOf(s.key))));

  return (
    <div className="min-h-screen bg-white">
      <MarketingNav />
      <div className="mx-auto max-w-2xl px-4 py-10">
        <h1 className="text-2xl font-bold uppercase text-brand-700">Service Descriptions</h1>
        <div className="mt-6 space-y-6">
          {categories.map((c) => (
            <div key={c}>
              <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">{categoryLabelOf(c)}</h2>
              <div className="mt-2 space-y-3">
                {serviceTypes.filter((s) => categoryKeyOf(s.key) === c).map((s) => (
                  <div key={s.key} className="rounded-lg border border-slate-200 p-4">
                    <h3 className="font-bold text-brand-700">{s.label}</h3>
                    {serviceTypeSubtext(s.key) && (
                      <p className="mt-1 text-slate-700">{serviceTypeSubtext(s.key)}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
      <MarketingFooter />
    </div>
  );
}
