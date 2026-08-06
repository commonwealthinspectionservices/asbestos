import type { Metadata } from "next";
import { League_Spartan } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

const leagueSpartan = League_Spartan({ subsets: ["latin"], variable: "--font-league-spartan" });

export const metadata: Metadata = {
  title: "Commonwealth Inspection Services, LLC.",
  description:
    "Asbestos and mold inspections in metro Boston. Book online, no card required — invoiced after the project.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={leagueSpartan.variable}>
      <body className="min-h-screen bg-slate-50 antialiased font-sans">
        {children}
        <Analytics />
      </body>
    </html>
  );
}
