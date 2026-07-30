import Link from "next/link";
import MarketingNav from "@/components/marketing/MarketingNav";
import MarketingFooter from "@/components/marketing/MarketingFooter";
import { blogPosts } from "@/lib/blog-posts";

const SERVICE_AREAS = [
  "Boston",
  "Greater Boston",
  "North Shore",
  "South Shore",
  "MetroWest",
  "Central Massachusetts",
  "Cape Cod, Martha's Vineyard, Nantucket",
  "Western Massachusetts",
];

const AUDIENCES = [
  "Homeowners",
  "General contractors",
  "Demolition contractors",
  "Restoration companies",
  "Asbestos abatement companies",
  "Real estate investors",
  "Property managers",
];

export default function HomePage() {
  const latestPosts = blogPosts.slice(0, 3);

  return (
    <div className="min-h-screen bg-white">
      <MarketingNav />

      <section className="mx-auto max-w-3xl px-4 py-12 text-center">
        <h1 className="text-3xl font-bold text-brand-700 sm:text-4xl">
          Licensed, Independent MA Asbestos Inspectors
        </h1>
        <p className="mt-3 text-slate-600">Serving Boston and all of Massachusetts</p>
        <p className="mt-1 text-lg font-semibold text-slate-800">
          <a href="tel:617-390-4778" className="hover:text-brand-600">617-390-4778</a>
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <Link
            href="/portal"
            className="rounded-lg bg-brand-600 px-5 py-3 text-sm font-bold text-white hover:bg-brand-700"
          >
            Client Portal
          </Link>
          <Link
            href="/contact"
            className="rounded-lg border border-slate-300 px-5 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50"
          >
            Contact Us
          </Link>
        </div>
        <p className="mt-6 text-sm font-medium text-brand-700">
          Fully Independent — No Abatement, No Conflict of Interest
        </p>
      </section>

      <section className="bg-slate-50 px-4 py-10">
        <div className="mx-auto max-w-3xl">
          <h2 className="text-center text-xl font-bold text-slate-800">
            We coordinate asbestos inspections across all of Massachusetts
          </h2>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {SERVICE_AREAS.map((area) => (
              <span key={area} className="rounded-full bg-white px-3 py-1.5 text-sm text-slate-600 shadow-sm">
                {area}
              </span>
            ))}
          </div>
        </div>
      </section>

      <section className="px-4 py-10">
        <div className="mx-auto max-w-3xl">
          <h2 className="text-center text-xl font-bold text-slate-800">
            We coordinate asbestos inspections in Massachusetts for
          </h2>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {AUDIENCES.map((a) => (
              <span key={a} className="rounded-full bg-brand-50 px-3 py-1.5 text-sm text-brand-700">
                {a}
              </span>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-slate-50 px-4 py-10">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-slate-700">
            Inspection reports are formatted to meet requirements of Massachusetts DEP, DLS and
            local building department requirements for building permits and compliance.
          </p>
        </div>
      </section>

      <section className="px-4 py-10">
        <div className="mx-auto max-w-2xl space-y-4 text-slate-700">
          <p>
            Asbestos was commonly used in residential building materials for decades, particularly
            in homes built before 1980. It is often found in insulation around pipes, boilers and
            furnaces. Other common spots include vinyl floor tiles and flooring adhesives. Ceiling
            tiles, textured ceilings are hot spots as well as joint compound materials and
            roofing/siding materials. An asbestos inspection helps identify these materials before
            renovation or demolition work begins.
          </p>
          <p>
            Commonwealth Inspection Services specializes exclusively in asbestos inspection and
            testing and does not do asbestos removal. Independence guarantees unbiased findings and
            transparent recommendations.
          </p>
        </div>
      </section>

      {latestPosts.length > 0 && (
        <section className="bg-slate-50 px-4 py-10">
          <div className="mx-auto max-w-3xl">
            <h2 className="text-center text-xl font-bold text-slate-800">From the blog</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              {latestPosts.map((post) => (
                <Link
                  key={post.slug}
                  href={`/blog/${post.slug}`}
                  className="rounded-lg border border-slate-200 bg-white p-4 hover:border-brand-400"
                >
                  <div className="text-xs text-slate-400">{post.date}</div>
                  <div className="mt-1 font-semibold text-slate-800">{post.title}</div>
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

      <MarketingFooter />
    </div>
  );
}
