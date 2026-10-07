import type { Metadata } from "next";
import { RoomScreen } from "./RoomScreen";

export async function generateMetadata({ params }: PageProps<"/room/[code]">): Promise<Metadata> {
  const { code } = await params;
  const title = `Join table ${code}`;
  // openGraph from a segment replaces the layout's wholesale, so the image is repeated here.
  return { title, openGraph: { title: `${title} · Game Time`, description: "Pull up a seat at the table.", images: [{ url: "/og", width: 1200, height: 630, alt: "Game Time!" }] } };
}

export default async function RoomPage({ params }: PageProps<"/room/[code]">) {
  const { code } = await params;
  return <RoomScreen code={code} />;
}
