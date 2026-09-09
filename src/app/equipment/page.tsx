import Link from "next/link";
import MarketingNav from "@/components/marketing/MarketingNav";
import MarketingFooter from "@/components/marketing/MarketingFooter";
import { equipment } from "@/lib/equipment";

export const metadata = {
  title: "Equipment | Commonwealth Inspection Services, LLC.",
  description: "The instruments actually used for mold inspections and air sampling — what each one does and why it's part of a thorough mold investigation.",
};

export default function EquipmentIndexPage() {
  return (
    <div className="min-h-screen bg-white">
      <MarketingNav />
      <div className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-2xl font-black uppercase text-brand-700">Equipment</h1>
        <p className="mt-2 text-brand-700">
          The real instruments used on every mold inspection — from finding hidden moisture to
          collecting the air sample that goes to the lab.
        </p>
        <div className="mt-6 space-y-4">
          {equipment.map((item) => (
            <Link
              key={item.slug}
              href={`/equipment/${item.slug}`}
              className="group block rounded-lg border border-slate-200 p-4 hover:border-brand-400"
            >
              <div className="font-semibold text-brand-700 group-hover:underline">{item.name}</div>
              <div className="mt-1 text-sm text-brand-700">{item.tagline}</div>
            </Link>
          ))}
        </div>
      </div>
      <MarketingFooter />
    </div>
  );
}
