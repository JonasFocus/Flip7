import type { Metadata } from "next";

export const metadata: Metadata = { title: "Solo vs bots" };

export default function SoloLayout({ children }: { children: React.ReactNode }) {
  return children;
}
