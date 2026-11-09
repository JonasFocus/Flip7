import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Game Time · Family Game Night",
    short_name: "Game Time",
    description: "Play Flip online or keep score with physical cards.",
    id: "/",
    start_url: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#080a18",
    theme_color: "#080a18",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icons/192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
