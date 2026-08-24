import Link from "next/link";
import AuthHashRedirect from "@/components/AuthHashRedirect";
import MarketingNav from "@/components/marketing/MarketingNav";
import MarketingFooter from "@/components/marketing/MarketingFooter";
import PricingCalculator from "@/components/marketing/PricingCalculator";
import Credentials from "@/components/shared/Credentials";
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
    href: "/services/mold",
    title: "Mold Air Sampling",
    caption: "Air quality testing to find out whether mold spore counts in your home are elevated.",
    image: "/marketing/mold-sample.jpg",
    imageAlt: "Mold growth on framing material",
  },
  {
    href: "/services/asbestos",
    title: "Asbestos Inspections",
    caption: "Limited asbestos (PLM bulk sample) inspections for renovation, demolition and permits.",
    image: "/marketing/hero-bathroom-vanity.jpg",
    imageAlt: "Bathroom vanity prepared for sampling during a renovation",
  },
  {
    href: "/services/lead",
    title: "Lead Paint Sampling",
    caption: "Lead bulk sampling of painted surfaces for renovation and demolition compliance.",
    image: "/marketing/lead-sample.jpg",
    imageAlt: "Framing and insulation during a renovation",
  },
];

export default function HomePage() {
  const latestPosts = blogPosts.slice(0, 3);

  return (
    <div className="min-h-screen bg-white">
      <AuthHashRedirect />
      <MarketingNav />

      <section className="relative mt-4 flex min-h-[60vh] flex-col items-center justify-center overflow-hidden py-6 text-center sm:mt-10 sm:min-h-[85vh] sm:py-12">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/marketing/boston-skyline.jpg"
          alt=""
          className="absolute inset-0 h-full w-full object-cover opacity-15"
        />
        <div className="relative mx-auto flex w-full max-w-4xl items-center justify-center gap-6 px-4 sm:gap-10">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/marketing/massachusetts-outline.png" alt="" className="h-16 w-auto shrink-0 sm:h-40" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="Commonwealth Inspection Services" className="h-32 w-32 max-w-none shrink-0 rounded-full sm:h-72 sm:w-72" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/marketing/massachusetts-outline.png" alt="" className="h-16 w-auto shrink-0 sm:h-40" />
        </div>
        <div className="relative mx-auto max-w-3xl px-4">
        <p className="relative mt-6 whitespace-nowrap text-[13px] font-bold uppercase text-brand-700 sm:mt-10 sm:text-2xl">
          Serving Boston + all of Massachusetts
        </p>
        <div className="relative mt-6 flex justify-center gap-3 sm:mt-10 sm:gap-4">
          <Link
            href="/portal"
            className="inline-flex items-center border-[3px] border-emerald-600 bg-emerald-600 px-3 py-1.5 text-xs font-extrabold uppercase leading-none text-white hover:bg-emerald-700 sm:px-5 sm:py-2.5 sm:text-sm"
          >
            Book an Inspection
          </Link>
          <Link
            href="/portal/login"
            className="inline-flex items-center border-[3px] border-brand-700 bg-brand-50 px-3 py-1.5 text-xs font-extrabold uppercase leading-none text-brand-700 hover:bg-yellow-100 sm:px-5 sm:py-2.5 sm:text-sm"
          >
            Client Portal
          </Link>
        </div>
        </div>
      </section>

      <section className="relative bg-white pt-4 sm:pt-10">
        <div className="mx-auto grid max-w-4xl grid-cols-1 gap-4 px-4 sm:grid-cols-3">
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
                className="h-24 w-full object-cover transition group-hover:opacity-90 sm:h-64"
              />
              <div className="p-4 text-center">
                <p className="text-[13px] font-bold uppercase text-brand-700 sm:text-base">{service.title}</p>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section className="bg-white px-4 pt-16">
        <Credentials />
      </section>

      <section className="bg-white px-4 py-16">
        <div className="mx-auto max-w-4xl">
          <h2 className="text-center text-xl font-black uppercase text-brand-700">
            Inspections across<br className="sm:hidden" /> all of Massachusetts
          </h2>
          <ul className="mx-auto mt-4 grid max-w-4xl grid-cols-3 gap-4">
            {SERVICE_AREAS.map((area) => (
              <li
                key={area}
                className="flex min-w-0 items-center justify-center overflow-hidden rounded-lg bg-slate-100 px-2 py-5 text-center shadow-sm [container-type:inline-size]"
              >
                {area === "Martha's Vineyard + Nantucket" ? (
                  <>
                    <span className="font-bold uppercase text-brand-700 text-[clamp(0.6rem,4.2cqw,1rem)] sm:hidden">
                      Vineyard +<br />Nantucket
                    </span>
                    <span className="hidden line-clamp-2 font-bold uppercase text-brand-700 text-[clamp(0.6rem,4.2cqw,1rem)] sm:block">
                      {area}
                    </span>
                  </>
                ) : (
                  <span className="line-clamp-2 font-bold uppercase text-brand-700 text-[clamp(0.6rem,4.2cqw,1rem)]">
                    {area}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="px-4">
        <h2 className="text-center text-xl font-black uppercase text-brand-700">
          Pricing Estimator
        </h2>
        <div className="mt-6">
          <PricingCalculator />
        </div>
      </section>

      {latestPosts.length > 0 && (
        <section className="bg-white px-4 pt-16">
          <div className="mx-auto max-w-4xl">
            <div className="flex items-baseline justify-center gap-3">
              <h2 className="text-xl font-black uppercase text-brand-700">Blog</h2>
              <Link href="/blog" className="text-sm font-bold text-brand-600 hover:underline">
                View all posts
              </Link>
            </div>
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
              {latestPosts.map((post) => (
                <Link
                  key={post.slug}
                  href={`/blog/${post.slug}`}
                  className="group block overflow-hidden rounded-lg border border-slate-200 hover:border-brand-400"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={post.image}
                    alt=""
                    className="h-40 w-full bg-white object-contain p-4 transition group-hover:opacity-90"
                  />
                  <div className="p-4">
                    <div className="font-semibold text-brand-700 group-hover:underline">{post.title}</div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      <div className="mx-auto flex max-w-4xl justify-start px-4 pt-10">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/marketing/icon-inspector-ppe.png" alt="" className="h-40 w-auto" />
      </div>

      <MarketingFooter />
    </div>
  );
}
