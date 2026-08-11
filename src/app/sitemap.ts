import type { MetadataRoute } from "next";

const siteUrl = "https://ai.bustedminds.us.kg";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: `${siteUrl}/`,
      changeFrequency: "weekly",
      priority: 1,
    },
  ];
}
