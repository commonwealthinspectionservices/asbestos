"use client";

import { useEffect, useRef, useState } from "react";

// Renders every page of a PDF url to canvas client-side via pdfjs-dist —
// shared by the admin dashboard (invoice/report previews) and the
// contractor portal's Invoice tab. `revision` is a cache-busting key (e.g.
// a JSON.stringify of whatever fields affect the PDF's content) so the
// preview re-fetches/re-renders whenever the underlying data actually
// changes, not just whenever the component happens to re-render.
export default function PdfPreview({ url, revision }: { url: string; revision: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    (async () => {
      try {
        const pdfjsLib = await import("pdfjs-dist");
        pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
        const pdf = await pdfjsLib.getDocument(url).promise;
        const container = containerRef.current;
        if (!container || cancelled) return;
        container.innerHTML = "";
        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
          const page = await pdf.getPage(pageNum);
          const unscaled = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({ scale: Math.min(700 / unscaled.width, 1.5) });
          const canvas = document.createElement("canvas");
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.className = "mx-auto mb-3 max-w-full shadow";
          const ctx = canvas.getContext("2d");
          if (!ctx || cancelled) return;
          await page.render({ canvasContext: ctx, viewport }).promise;
          if (cancelled) return;
          container.appendChild(canvas);
        }
        if (!cancelled) setStatus("ready");
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url, revision]);

  if (status === "error") {
    return (
      <p className="text-sm text-slate-500">
        Preview unavailable — make sure a job site address and customer are set.
      </p>
    );
  }
  return (
    <div className="max-h-[600px] overflow-y-auto rounded-lg border border-slate-200 bg-slate-100 p-3">
      {status === "loading" && <p className="py-10 text-center text-sm text-slate-400">Loading preview…</p>}
      <div ref={containerRef} />
    </div>
  );
}
