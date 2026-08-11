import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Busted Minds AI",
    short_name: "BM AI",
    description:
      "Chat with Busted Minds AI for sharp answers, clearer thinking, coding help, research, and honest feedback.",
    start_url: "/",
    display: "standalone",
    background_color: "#0b0b0d",
    theme_color: "#0b0b0d",
    icons: [
      {
        src: "/brand/bmai-logo-light.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
