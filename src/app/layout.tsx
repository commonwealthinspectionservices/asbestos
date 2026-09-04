import type { Metadata } from "next";
import { League_Spartan } from "next/font/google";
import { Analytics } from "@vercel/analytics/react";
import Script from "next/script";
import LocalBusinessSchema from "@/components/marketing/LocalBusinessSchema";
import "./globals.css";

// Google Ads conversion tracking tag — this ID is meant to be public (it's
// embedded in every page's HTML by design, same as any gtag.js setup), so
// no env var needed. Added 2026-09-04 while Tim was setting up his first
// Google Ads campaign.
const GOOGLE_ADS_TAG_ID = "G-L2V4F0SC2X";

const leagueSpartan = League_Spartan({ subsets: ["latin"], variable: "--font-league-spartan" });

const SITE_TITLE = "Commonwealth Inspection Services, LLC.";
const SITE_DESCRIPTION =
  "Independent mold air sampling and asbestos testing across Massachusetts — no remediation, no conflict of interest. Book online, no card required.";

// Open Graph/Twitter tags — without these, sharing a link (a text, a
// Facebook group post, Nextdoor) shows a blank preview instead of the logo
// + description. A per-page metadata export (e.g. /careers) overrides
// title/description here but still inherits this same image via Next's
// metadata merging, since it only sets its own openGraph.images when it
// wants a different one.
export const metadata: Metadata = {
  metadataBase: new URL("https://www.commonwealthinspectionservices.com"),
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  openGraph: {
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    url: "https://www.commonwealthinspectionservices.com",
    siteName: SITE_TITLE,
    images: ["/logo.png"],
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    images: ["/logo.png"],
  },
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
        <Script src={`https://www.googletagmanager.com/gtag/js?id=${GOOGLE_ADS_TAG_ID}`} strategy="afterInteractive" />
        <Script id="google-ads-tag" strategy="afterInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', '${GOOGLE_ADS_TAG_ID}');
          `}
        </Script>
      </body>
    </html>
  );
}
