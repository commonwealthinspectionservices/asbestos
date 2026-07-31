import Link from "next/link";
import MarketingNav from "@/components/marketing/MarketingNav";
import MarketingFooter from "@/components/marketing/MarketingFooter";
import { blogPosts } from "@/lib/blog-posts";

export default function BlogIndexPage() {
  return (
    <div className="min-h-screen bg-white">
      <MarketingNav />
      <div className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-2xl font-black uppercase text-brand-700">Blog</h1>
        <div className="mt-6 space-y-4">
          {blogPosts.map((post) => (
            <Link
              key={post.slug}
              href={`/blog/${post.slug}`}
              className="group block rounded-lg border border-slate-200 p-4 hover:border-brand-400"
            >
              <div className="font-semibold text-brand-700 group-hover:underline">{post.title}</div>
              <div className="mt-1 text-sm text-brand-700">{post.excerpt}</div>
            </Link>
          ))}
        </div>
      </div>
      <MarketingFooter />
    </div>
  );
}
