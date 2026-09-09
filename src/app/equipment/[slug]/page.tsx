import Link from "next/link";
import { notFound } from "next/navigation";
import MarketingNav from "@/components/marketing/MarketingNav";
import MarketingFooter from "@/components/marketing/MarketingFooter";
import { equipment } from "@/lib/equipment";
import { renderLiteMarkdown } from "@/lib/markdown-lite";

export function generateStaticParams() {
  return equipment.map((item) => ({ slug: item.slug }));
}

export function generateMetadata({ params }: { params: { slug: string } }) {
  const item = equipment.find((e) => e.slug === params.slug);
  if (!item) return {};
  return {
    title: `${item.name} | Commonwealth Inspection Services, LLC.`,
    description: item.tagline,
  };
}

export default function EquipmentPage({ params }: { params: { slug: string } }) {
  const item = equipment.find((e) => e.slug === params.slug);
  if (!item) notFound();

  return (
    <div className="min-h-screen bg-white">
      <MarketingNav />
      <article className="mx-auto max-w-2xl px-4 py-10">
        <Link href="/equipment" className="text-sm text-brand-600 underline">← All equipment</Link>

        <h1 className="mt-3 text-2xl font-bold text-brand-700">{item.name}</h1>
        <p className="mt-1 text-sm uppercase tracking-wide text-slate-500">{item.manufacturer}</p>
        <p className="mt-3 text-brand-700">{item.tagline}</p>

        {/* Placeholder until Tim uploads his own photo of the actual unit —
            deliberately not a manufacturer/marketplace product photo, see
            equipment.ts's own comment on why. */}
        {item.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.image} alt={item.name} className="mt-6 w-full rounded-lg border border-slate-200" />
        ) : (
          <div className="mt-6 flex h-48 items-center justify-center rounded-lg border-2 border-dashed border-slate-300 text-sm text-slate-400">
            Photo coming soon
          </div>
        )}

        {item.specs.length > 0 && (
          <div className="mt-6 rounded-lg border border-slate-200 p-4">
            <h3 className="font-bold uppercase text-brand-700">Specs</h3>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">
              {item.specs.map((spec, i) => (
                <li key={i}>{spec}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-6">{renderLiteMarkdown(item.body)}</div>

        <div className="mt-10 flex flex-wrap gap-3">
          <Link href="/services/mold" className="inline-flex h-[29px] items-center border-[3px] border-brand-700 bg-brand-50 px-4 pt-0.5 text-sm font-extrabold uppercase leading-none text-brand-700 hover:bg-yellow-100">
            Mold Inspection Services
          </Link>
          <Link href="/portal" className="inline-flex h-[29px] items-center border-[3px] border-brand-700 bg-brand-50 px-4 pt-0.5 text-sm font-extrabold uppercase leading-none text-brand-700 hover:bg-yellow-100">
            Book a Project
          </Link>
        </div>
      </article>
      <MarketingFooter />
    </div>
  );
}
