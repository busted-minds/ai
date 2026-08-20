import type { MetadataRoute } from "next";

const siteUrl = "https://ai.bustedminds.org";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: `${siteUrl}/`,
      changeFrequency: "weekly",
      priority: 1,
    },
  ];
}
