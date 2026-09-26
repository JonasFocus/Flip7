import type { Metadata, Viewport } from "next";
import { Bungee, Outfit } from "next/font/google";
import "./globals.css";

const bungee = Bungee({ variable: "--font-bungee", weight: "400", subsets: ["latin"] });
const outfit = Outfit({ variable: "--font-outfit", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Flip 7 · Family Game Night",
  description: "Play Flip 7 with the family: online rooms, solo vs bots, or keep score for real cards.",
  applicationName: "Flip 7",
  appleWebApp: { capable: true, title: "Flip 7", statusBarStyle: "black-translucent" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0c0d1d",
  colorScheme: "dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${bungee.variable} ${outfit.variable} antialiased`}>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
