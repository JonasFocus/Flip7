import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Flip 7 · Family Game Night",
    short_name: "Flip 7",
    description: "Play Flip 7 with the family.",
    start_url: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#0c0d1d",
    theme_color: "#0c0d1d",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}
