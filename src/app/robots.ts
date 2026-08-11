import type { MetadataRoute } from "next";

const siteUrl = "https://ai.bustedminds.us.kg";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/" },
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
