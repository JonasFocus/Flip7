import { appIcon } from "@/lib/appIcon";

const ICONS = new Map([
  ["192.png", { px: 192, maskable: false }],
  ["512.png", { px: 512, maskable: false }],
  ["maskable-512.png", { px: 512, maskable: true }],
]);

export const dynamicParams = false;

export function generateStaticParams() {
  return [...ICONS.keys()].map((name) => ({ name }));
}

export async function GET(_req: Request, { params }: { params: Promise<{ name: string }> }) {
  const icon = ICONS.get((await params).name);
  if (!icon) return new Response("not found", { status: 404 });
  return appIcon(icon.px, icon.maskable);
}
