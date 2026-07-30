import Link from "next/link";
import { notFound } from "next/navigation";
import MarketingNav from "@/components/marketing/MarketingNav";
import MarketingFooter from "@/components/marketing/MarketingFooter";
import { blogPosts } from "@/lib/blog-posts";
import { renderLiteMarkdown } from "@/lib/markdown-lite";

export function generateStaticParams() {
  return blogPosts.map((post) => ({ slug: post.slug }));
}

export default function BlogPostPage({ params }: { params: { slug: string } }) {
  const post = blogPosts.find((p) => p.slug === params.slug);
  if (!post) notFound();

  return (
    <div className="min-h-screen bg-white">
      <MarketingNav />
      <article className="mx-auto max-w-2xl px-4 py-10">
        <Link href="/blog" className="text-sm text-brand-600 underline">← All posts</Link>
        <h1 className="mt-3 text-2xl font-bold text-brand-700">{post.title}</h1>
        <div className="mt-1 text-xs text-slate-400">{post.date}</div>
        <div className="mt-6">{renderLiteMarkdown(post.body)}</div>
      </article>
      <MarketingFooter />
    </div>
  );
}
