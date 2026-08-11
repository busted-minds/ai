import type { MetadataRoute } from "next";

const siteUrl = "https://ai.bustedminds.us.kg";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: "/api/" },
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
