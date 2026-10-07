import type { Metadata, Viewport } from "next";
import { Bungee, Outfit } from "next/font/google";
import "./globals.css";

const bungee = Bungee({ variable: "--font-bungee", weight: "400", subsets: ["latin"] });
const outfit = Outfit({ variable: "--font-outfit", subsets: ["latin"] });

const description = "Game night on your phones: Flip 7, Blackjack, Hold'em, Roulette, Imposter and more.";
const productionHost = process.env.VERCEL_PROJECT_PRODUCTION_URL;

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? (productionHost ? `https://${productionHost}` : "http://localhost:3000"),
  ),
  title: { default: "Game Time · Family Game Night", template: "%s · Game Time" },
  description,
  openGraph: { title: "Game Time", description, siteName: "Game Time", type: "website", images: [{ url: "/og", width: 1200, height: 630, alt: "Game Time!" }] },
  twitter: { card: "summary_large_image", title: "Game Time", description, images: ["/og"] },
  applicationName: "Game Time",
  appleWebApp: { capable: true, title: "Game Time", statusBarStyle: "black-translucent" },
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
