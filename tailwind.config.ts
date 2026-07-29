import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eef4ff",
          100: "#dbe6fe",
          500: "#2952a3",
          600: "#1f3f80",
          700: "#193466",
        },
      },
    },
  },
  plugins: [],
};

export default config;
