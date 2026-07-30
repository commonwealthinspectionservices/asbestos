import Link from "next/link";
import MarketingNav from "@/components/marketing/MarketingNav";
import MarketingFooter from "@/components/marketing/MarketingFooter";
import PricingCalculator from "@/components/marketing/PricingCalculator";
import { blogPosts } from "@/lib/blog-posts";

const SERVICE_AREAS = [
  "Greater Boston",
  "Boston",
  "North Shore",
  "South Shore",
  "Martha's Vineyard + Nantucket",
  "MetroWest",
  "Central Massachusetts",
  "Cape Cod",
  "Western Massachusetts",
];

const SERVICES = [
  {
    href: "/services/asbestos",
    title: "Asbestos Inspections",
    caption: "Limited asbestos (PLM bulk sample) inspections for renovation, demolition and permits.",
    image: "/marketing/hero-inspection-notes.jpg",
    imageAlt: "Inspector recording findings on-site",
  },
  {
    href: "/services/mold",
    title: "Mold Inspections",
    caption: "Visual assessment and lab sampling to identify and clear mold before renovation.",
    image: "/marketing/mold-sample.jpg",
    imageAlt: "Mold growth on framing material",
  },
  {
    href: "/services/lead",
    title: "Lead Inspections",
    caption: "Lead bulk sampling of painted surfaces for renovation and demolition compliance.",
    image: "/marketing/lead-sample.jpg",
    imageAlt: "Framing and insulation during a renovation",
  },
];

export default function HomePage() {
  const latestPosts = blogPosts.slice(0, 3);

  return (
    <div className="min-h-screen bg-white">
      <MarketingNav />

      <section className="relative mt-10 overflow-hidden py-12 text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/marketing/hero-bathroom-prep.jpg"
          alt=""
          className="absolute inset-0 h-full w-full object-cover opacity-15"
        />
        <div className="relative mx-auto max-w-3xl px-4">
        <div className="relative flex items-center justify-center gap-4 sm:gap-8">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/marketing/massachusetts-outline.png" alt="" className="h-16 w-auto shrink-0 sm:h-32" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="Commonwealth Inspection Services" className="h-48 w-48 shrink-0 rounded-full sm:h-56 sm:w-56" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/marketing/massachusetts-outline.png" alt="" className="h-16 w-auto shrink-0 sm:h-32" />
        </div>
        <p className="relative mt-8 text-xs font-black uppercase text-brand-700 sm:text-xl">
          Serving Boston + all of Massachusetts
        </p>
        <div className="relative mt-8 flex justify-center gap-3">
          <Link
            href="/portal"
            className="inline-flex h-[22px] sm:h-[29px] items-center border-[3px] border-brand-700 bg-brand-50 px-4 text-sm font-extrabold uppercase leading-none text-brand-700 hover:bg-yellow-100"
          >
            Book an Inspection
          </Link>
          <Link
            href="/contact"
            className="inline-flex h-[22px] sm:h-[29px] items-center border-[3px] border-brand-700 bg-brand-50 px-4 text-sm font-extrabold uppercase leading-none text-brand-700 hover:bg-yellow-100"
          >
            Contact Us
          </Link>
        </div>
        </div>
      </section>

      <section className="relative bg-white pt-10">
        <div className="mx-auto grid max-w-4xl grid-cols-3 gap-4 px-4">
          {SERVICES.map((service) => (
            <Link
              key={service.href}
              href={service.href}
              className="group block overflow-hidden rounded-lg border border-slate-200 hover:border-brand-400"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={service.image}
                alt={service.imageAlt}
                className="h-48 w-full object-cover transition group-hover:opacity-90 sm:h-64"
              />
              <div className="p-4 text-center">
                <p className="font-bold uppercase text-brand-700">{service.title}</p>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section className="bg-white px-4 pt-10">
        <div className="mx-auto max-w-4xl">
          <h2 className="text-center text-xl font-black uppercase text-brand-700">
            Inspections across all of Massachusetts
          </h2>
          <ul className="mx-auto mt-4 grid max-w-4xl grid-cols-3 gap-4">
            {SERVICE_AREAS.map((area) => (
              <li
                key={area}
                className="flex items-center justify-center overflow-hidden rounded-lg bg-slate-100 px-2 py-5 text-center shadow-sm [container-type:inline-size]"
              >
                <span className="whitespace-nowrap font-bold uppercase text-brand-700 text-[clamp(0.6rem,4.2cqw,1rem)]">
                  {area}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="px-4 pt-10">
        <h2 className="text-center text-xl font-black uppercase text-brand-700">
          Pricing Calculator
        </h2>
        <div className="mt-6">
          <PricingCalculator />
        </div>
      </section>

      {latestPosts.length > 0 && (
        <section className="bg-white px-4 pt-10">
          <div className="mx-auto max-w-4xl">
            <h2 className="text-center text-xl font-black uppercase text-brand-700">Blog</h2>
            <div className="mt-4 grid grid-cols-3 gap-4">
              {latestPosts.map((post) => (
                <Link
                  key={post.slug}
                  href={`/blog/${post.slug}`}
                  className="rounded-lg border border-slate-200 bg-white p-4 hover:border-brand-400"
                >
                  <div className="text-xs text-slate-400">{post.date}</div>
                  <div className="mt-1 font-semibold text-brand-700">{post.title}</div>
                </Link>
              ))}
            </div>
            <div className="mt-4 text-center">
              <Link href="/blog" className="text-sm font-bold text-brand-600 underline">
                View all posts
              </Link>
            </div>
          </div>
        </section>
      )}

      <div className="flex justify-start px-4 pt-10">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/marketing/icon-inspector-ppe.png" alt="" className="h-40 w-auto" />
      </div>

      <MarketingFooter />
    </div>
  );
}
