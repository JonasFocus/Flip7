import type { Metadata } from "next";
import { RoomScreen } from "./RoomScreen";

export async function generateMetadata({ params }: PageProps<"/room/[code]">): Promise<Metadata> {
  const { code } = await params;
  const title = `Join table ${code}`;
  // openGraph from a segment replaces the layout's wholesale, so the image is repeated here.
  return { title, openGraph: { title: `${title} · Flip 7`, description: "Pull up a seat for a game of Flip 7.", images: ["/icons/512.png"] } };
}

export default async function RoomPage({ params }: PageProps<"/room/[code]">) {
  const { code } = await params;
  return <RoomScreen code={code} />;
}
