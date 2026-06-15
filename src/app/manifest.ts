import type { MetadataRoute } from "next";

// Web app manifest → makes the site installable ("Add to Home Screen") as a PWA.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "CFA Level 1 Study",
    short_name: "CFA L1",
    description:
      "Notes, flashcards, quizzes, mock-exam simulation, and a dynamic study plan for the CFA Level 1 exam.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0b1120",
    theme_color: "#4f46e5",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
