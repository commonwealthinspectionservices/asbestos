import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    // pdf-parse's bundled pdf.js (lib/pdf.js/v1.10.100/build/pdf.js) isn't
    // safe to instantiate from two test files running concurrently in
    // Vitest's default threaded pool — confirmed live 2026-09-14, once a
    // second file (invoice-pdf.test.ts) started using it alongside
    // report-pdf.test.ts's existing 36 pdf-parse calls: real, non-Xref-
    // corrupt PDFs intermittently failed to parse ("bad XRef entry") only
    // under a full `vitest run`, never in isolation or in a smaller subset.
    // Whole suite runs in ~2s either way, so serializing files entirely is
    // cheap insurance against this instead of chasing a real fix inside a
    // third-party bundled parser.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  esbuild: {
    // tsconfig.json sets jsx: "preserve" for Next.js's own compiler, which
    // esbuild doesn't understand on its own — without this, .tsx files
    // (e.g. src/lib/report-pdf.tsx) fail under Vitest with "React is not
    // defined". This matches Next's actual runtime behavior (automatic
    // JSX runtime), rather than requiring a manual `import React` that
    // Next's compiler doesn't need.
    jsx: "automatic",
  },
});
