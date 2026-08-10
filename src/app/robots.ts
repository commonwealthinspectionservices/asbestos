import type { MetadataRoute } from "next";

const BASE_URL = "https://www.commonwealthinspectionservices.com";

// /admin and /portal require auth and redirect anonymous visitors to a
// login page — nothing there is real content to index. /api is data
// endpoints, not pages.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/admin", "/portal", "/api"],
    },
    sitemap: `${BASE_URL}/sitemap.xml`,
  };
}
