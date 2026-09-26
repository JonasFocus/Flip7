import { RoomScreen } from "./RoomScreen";

export default async function RoomPage({ params }: PageProps<"/room/[code]">) {
  const { code } = await params;
  return <RoomScreen code={code} />;
}
