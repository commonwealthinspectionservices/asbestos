import React from "react";

// Renders the tiny markdown-lite grammar used by src/lib/blog-posts.ts and
// src/lib/faqs.ts: blank-line-separated paragraphs, "## " headings, and
// consecutive "- " lines grouped into a bullet list. Deliberately not a full
// markdown parser — this is the exact shape that content migrated from the
// old Wix site's rich-text blocks was normalized into, nothing more.
export function renderLiteMarkdown(text: string): React.ReactNode {
  const blocks = text.split("\n");

  const nodes: React.ReactNode[] = [];
  let listBuffer: string[] = [];

  function flushList(key: string) {
    if (listBuffer.length === 0) return;
    nodes.push(
      <ul key={key} className="list-disc space-y-1 pl-6">
        {listBuffer.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    );
    listBuffer = [];
  }

  blocks.forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    if (line.startsWith("- ")) {
      listBuffer.push(line.slice(2));
      return;
    }
    flushList(`ul-${i}`);
    if (line.startsWith("## ")) {
      nodes.push(
        <h2 key={i} className="mt-6 text-lg font-bold text-slate-800 first:mt-0">
          {line.slice(3)}
        </h2>
      );
    } else {
      nodes.push(
        <p key={i} className="text-slate-700">
          {line}
        </p>
      );
    }
  });
  flushList("ul-end");

  return <div className="space-y-3">{nodes}</div>;
}
