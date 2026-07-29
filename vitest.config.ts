import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
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
