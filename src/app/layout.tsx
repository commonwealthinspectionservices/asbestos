import type { Metadata } from "next";
import { League_Spartan } from "next/font/google";
import { Analytics } from "@vercel/analytics/react";
import LocalBusinessSchema from "@/components/marketing/LocalBusinessSchema";
import "./globals.css";

const leagueSpartan = League_Spartan({ subsets: ["latin"], variable: "--font-league-spartan" });

export const metadata: Metadata = {
  title: "Commonwealth Inspection Services, LLC.",
  description:
    "Independent mold air sampling and asbestos testing across Massachusetts — no remediation, no conflict of interest. Book online, no card required.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={leagueSpartan.variable}>
      <body className="min-h-screen bg-slate-50 antialiased font-sans">
        <LocalBusinessSchema />
        {children}
        <Analytics />
      </body>
    </html>
  );
}
