import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "謎解き周遊ビンゴ",
    short_name: "ツアービンゴ",
    description: "みんなで協力して楽しむ、謎解き周遊ビンゴ",
    start_url: "/",
    display: "standalone",
    background_color: "#f5f8ff",
    theme_color: "#1d5fbf",
    lang: "ja",
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  };
}