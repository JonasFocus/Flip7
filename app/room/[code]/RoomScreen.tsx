"use client";

import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { Lobby } from "@/components/lobby/Lobby";
import { LoadingScreen, NameGate, NoticeScreen, ReconnectBanner } from "@/components/lobby/Screens";
import { Scorekeeper } from "@/components/scorekeeper/Scorekeeper";
import { Table } from "@/components/table/Table";
import { useRoom } from "@/lib/client/useRoom";

const CODE_RE = /^\d{6}$/;
const KICKED = "You were removed from the room";

export function RoomScreen({ code }: { code: string }) {
  if (!CODE_RE.test(code)) {
    return <NoticeScreen title="Not a room code" message="Room codes are 6 digits. Check the invite and try again." />;
  }
  return <NameGate>{(name) => <LiveRoom code={code} name={name} />}</NameGate>;
}

function LiveRoom({ code, name }: { code: string; name: string }) {
  const room = useRoom(code, name);
  const router = useRouter();
  const { table: rawTable, score: rawScore, leave: rawLeave } = room;

  // Leaving from any screen goes home.
  const table = useMemo(
    () => rawTable && { ...rawTable, leave: () => (rawLeave(), router.push("/")) },
    [rawTable, rawLeave, router],
  );
  const score = useMemo(
    () => rawScore && { ...rawScore, leave: () => (rawLeave(), router.push("/")) },
    [rawScore, rawLeave, router],
  );

  const banner = room.status === "reconnecting" && <ReconnectBanner />;

  if (room.error === KICKED || (table && table.game.players.length > 0 && !table.game.players.some((p) => p.id === table.you))) {
    return <NoticeScreen title="Removed" message="The host removed you from this room." />;
  }
  // Also covers a rejoin that fails later, e.g. the server restarted and the room is gone.
  if (room.status === "closed" && room.error) return <JoinFailed message={room.error} />;
  if (table) {
    return (
      <>
        {banner}
        {table.game.phase === "lobby" ? <Lobby conn={table} /> : <Table conn={table} />}
      </>
    );
  }
  if (score) {
    return (
      <>
        {banner}
        <Scorekeeper conn={score} />
      </>
    );
  }
  return (
    <>
      {banner}
      <LoadingScreen />
    </>
  );
}

function JoinFailed({ message }: { message: string }) {
  if (message === "Room not found") {
    return <NoticeScreen title="Room not found" message="That table closed or the code is wrong. Start a new one from home." />;
  }
  if (message === "Game already started") {
    return <NoticeScreen title="Already playing" message="This game started without you. Ask them to play again, or start your own." />;
  }
  return <NoticeScreen title="Couldn't join" message={message} />;
}
