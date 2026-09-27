"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Imposter } from "@/components/imposter/Imposter";
import { Lobby } from "@/components/lobby/Lobby";
import { LoadingScreen, NameGate, NoticeScreen, ReconnectBanner } from "@/components/lobby/Screens";
import { Scorekeeper } from "@/components/scorekeeper/Scorekeeper";
import { Table } from "@/components/table/Table";
import { useRoom } from "@/lib/client/useRoom";
import { KICKED_MESSAGE, MAX_PLAYERS, REPLACED_MESSAGE } from "@/lib/protocol";

const CODE_RE = /^\d{6}$/;

export function RoomScreen({ code }: { code: string }) {
  if (!CODE_RE.test(code)) {
    return <NoticeScreen title="Not a room code" message="Room codes are 6 digits. Check the invite and try again." />;
  }
  return <NameGate context={`Joining table ${code}`}>{(name) => <LiveRoom code={code} name={name} />}</NameGate>;
}

// Remounting with a new key reconnects from scratch, e.g. to take the seat back from another tab.
function LiveRoom({ code, name }: { code: string; name: string }) {
  const [session, setSession] = useState(0);
  return <RoomView key={session} code={code} name={name} onPlayHere={() => setSession((n) => n + 1)} />;
}

function RoomView({ code, name, onPlayHere }: { code: string; name: string; onPlayHere: () => void }) {
  const room = useRoom(code, name);
  const router = useRouter();
  const { table: rawTable, score: rawScore, imposter: rawImposter, leave: rawLeave } = room;

  // Leaving from any screen goes home.
  const table = useMemo(
    () => rawTable && { ...rawTable, leave: () => (rawLeave(), router.replace("/")) },
    [rawTable, rawLeave, router],
  );
  const score = useMemo(
    () => rawScore && { ...rawScore, leave: () => (rawLeave(), router.replace("/")) },
    [rawScore, rawLeave, router],
  );
  const imposter = useMemo(
    () => rawImposter && { ...rawImposter, leave: () => (rawLeave(), router.replace("/")) },
    [rawImposter, rawLeave, router],
  );

  // The in-game header shows its own reconnect state in the same spot.
  const banner = room.status === "reconnecting" && !(table && table.game.phase !== "lobby") && <ReconnectBanner />;

  const seated = table ?? imposter;
  if (room.error === KICKED_MESSAGE || (seated && seated.game.players.length > 0 && !seated.game.players.some((p) => p.id === seated.you))) {
    return <NoticeScreen title="Removed" message="The host removed you from this room." />;
  }
  // Also covers a rejoin that fails later, e.g. the room expired or the server restarted.
  if (room.status === "closed" && room.error) {
    if (room.error === REPLACED_MESSAGE) {
      return (
        <NoticeScreen
          title="Open in another tab"
          message="This room is open in another tab or window."
          action={{ label: "Play here", onClick: onPlayHere }}
        />
      );
    }
    return <JoinFailed code={code} message={room.error} hadRoom={room.hadRoom} />;
  }
  if (table) {
    return (
      <>
        {banner}
        {table.game.phase === "lobby" ? <Lobby conn={table} /> : <Table conn={table} />}
      </>
    );
  }
  if (imposter) {
    return (
      <>
        {banner}
        <Imposter conn={imposter} />
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
      <LoadingScreen
        hint={
          room.unreachable === "offline"
            ? "You're offline. Still trying…"
            : room.unreachable === "server"
              ? "Can't reach the game server. Still trying…"
              : undefined
        }
      />
    </>
  );
}

function JoinFailed({ code, message, hadRoom }: { code: string; message: string; hadRoom: boolean }) {
  const router = useRouter();
  if (message === "Room not found" && hadRoom) {
    return <NoticeScreen title="Table closed" message="This table closed while you were away. Start a new one from home." />;
  }
  if (message === "Room not found") {
    return (
      <NoticeScreen
        title="Room not found"
        message="That table closed or the code is wrong. Check the code or start a new one from home."
        action={{ label: "Try another code", onClick: () => router.replace(`/?code=${code}`) }}
      />
    );
  }
  if (message === "Game already started") {
    return <NoticeScreen title="Already playing" message="This game started without you. Ask them to play again, or start your own." />;
  }
  if (message === "Room is full") {
    return <NoticeScreen title="Table's full" message={`This table already has ${MAX_PLAYERS} players. Start your own from home.`} />;
  }
  if (message === "Game is over") {
    return <NoticeScreen title="Game over" message="That scorekeeper game already finished." />;
  }
  return <NoticeScreen title="Couldn't join" message={message} />;
}
