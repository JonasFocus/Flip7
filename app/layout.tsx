import type { Metadata, Viewport } from "next";
import { Bungee, Outfit } from "next/font/google";
import "./globals.css";

const bungee = Bungee({ variable: "--font-bungee", weight: "400", subsets: ["latin"] });
const outfit = Outfit({ variable: "--font-outfit", subsets: ["latin"] });

const description = "Play Flip 7 online with the family, plus party games like Imposter.";
const productionHost = process.env.VERCEL_PROJECT_PRODUCTION_URL;

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? (productionHost ? `https://${productionHost}` : "http://localhost:3000"),
  ),
  title: { default: "Flip 7 · Family Game Night", template: "%s · Flip 7" },
  description,
  openGraph: { title: "Flip 7", description, siteName: "Flip 7", type: "website", images: [{ url: "/og", width: 1200, height: 630, alt: "Game Time!" }] },
  twitter: { card: "summary_large_image", title: "Flip 7", description, images: ["/og"] },
  applicationName: "Flip 7",
  appleWebApp: { capable: true, title: "Flip 7", statusBarStyle: "black-translucent" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#080a18",
  colorScheme: "dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${bungee.variable} ${outfit.variable} antialiased`}>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
