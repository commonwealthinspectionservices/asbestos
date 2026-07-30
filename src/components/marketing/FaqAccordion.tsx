"use client";

import type { Faq } from "@/lib/faqs";
import { renderLiteMarkdown } from "@/lib/markdown-lite";

export default function FaqAccordion({ faqs }: { faqs: Faq[] }) {
  return (
    <div className="space-y-2">
      {faqs.map((faq, i) => (
        <details key={i} className="group rounded-lg border border-slate-200 bg-white p-4 open:bg-brand-50/40">
          <summary className="cursor-pointer list-none font-semibold text-slate-800 marker:content-none">
            <span className="flex items-center justify-between gap-2">
              {faq.question}
              <span className="shrink-0 text-slate-400 transition-transform group-open:rotate-45">+</span>
            </span>
          </summary>
          <div className="mt-3 text-sm">{renderLiteMarkdown(faq.answer)}</div>
        </details>
      ))}
    </div>
  );
}
