import type { Metadata } from "next";
import "./globals.css";

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
    <html lang="en">
      <body className="min-h-screen bg-slate-50 antialiased">{children}</body>
    </html>
  );
}
