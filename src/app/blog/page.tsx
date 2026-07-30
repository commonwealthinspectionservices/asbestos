import Link from "next/link";
import MarketingNav from "@/components/marketing/MarketingNav";
import MarketingFooter from "@/components/marketing/MarketingFooter";
import { blogPosts } from "@/lib/blog-posts";

export default function BlogIndexPage() {
  return (
    <div className="min-h-screen bg-white">
      <MarketingNav />
      <div className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-2xl font-bold text-brand-700">Blog</h1>
        <div className="mt-6 space-y-4">
          {blogPosts.map((post) => (
            <Link
              key={post.slug}
              href={`/blog/${post.slug}`}
              className="block rounded-lg border border-slate-200 p-4 hover:border-brand-400"
            >
              <div className="text-xs text-slate-400">{post.date}</div>
              <div className="mt-1 font-semibold text-slate-800">{post.title}</div>
              <div className="mt-1 text-sm text-slate-500">{post.excerpt}</div>
            </Link>
          ))}
        </div>
      </div>
      <MarketingFooter />
    </div>
  );
}
