"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Blackjack } from "@/components/blackjack/Blackjack";
import { BlackjackDuel } from "@/components/bjduel/BlackjackDuel";
import { Baccarat } from "@/components/baccarat/Baccarat";
import { Roulette } from "@/components/roulette/Roulette";
import { TexasHoldem } from "@/components/texasholdem/TexasHoldem";
import { HotPotato } from "@/components/hotpotato/HotPotato";
import { Imposter } from "@/components/imposter/Imposter";
import { LiarsDice } from "@/components/liarsdice/LiarsDice";
import { Lobby } from "@/components/lobby/Lobby";
import { LoadingScreen, NameGate, NoticeScreen, ReconnectBanner } from "@/components/lobby/Screens";
import { Scorekeeper } from "@/components/scorekeeper/Scorekeeper";
import { Spyfall } from "@/components/spyfall/Spyfall";
import { Table } from "@/components/table/Table";
import { useRoom } from "@/lib/client/useRoom";
import { KICKED_MESSAGE, REPLACED_MESSAGE } from "@/lib/protocol";

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
  const { table: rawTable, score: rawScore, imposter: rawImposter, dice: rawDice, potato: rawPotato, spy: rawSpy, bj: rawBj, duel: rawDuel, bac: rawBac, rl: rawRl, tx: rawTx, leave: rawLeave } = room;

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
  const dice = useMemo(() => rawDice && { ...rawDice, leave: () => (rawLeave(), router.replace("/")) }, [rawDice, rawLeave, router]);
  const potato = useMemo(() => rawPotato && { ...rawPotato, leave: () => (rawLeave(), router.replace("/")) }, [rawPotato, rawLeave, router]);
  const spy = useMemo(() => rawSpy && { ...rawSpy, leave: () => (rawLeave(), router.replace("/")) }, [rawSpy, rawLeave, router]);
  const bj = useMemo(() => rawBj && { ...rawBj, leave: () => (rawLeave(), router.replace("/")) }, [rawBj, rawLeave, router]);
  const duel = useMemo(() => rawDuel && { ...rawDuel, leave: () => (rawLeave(), router.replace("/")) }, [rawDuel, rawLeave, router]);
  const bac = useMemo(() => rawBac && { ...rawBac, leave: () => (rawLeave(), router.replace("/")) }, [rawBac, rawLeave, router]);
  const rl = useMemo(() => rawRl && { ...rawRl, leave: () => (rawLeave(), router.replace("/")) }, [rawRl, rawLeave, router]);
  const tx = useMemo(() => rawTx && { ...rawTx, leave: () => (rawLeave(), router.replace("/")) }, [rawTx, rawLeave, router]);

  // The in-game header shows its own reconnect state in the same spot.
  const banner = room.status === "reconnecting" && !(table && table.game.phase !== "lobby") && <ReconnectBanner />;

  const seated = table ?? imposter ?? dice ?? potato ?? spy ?? bj ?? duel ?? bac ?? rl ?? tx;
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
  if (bj) {
    return (
      <>
        {banner}
        <Blackjack conn={bj} />
      </>
    );
  }
  if (duel) {
    return (
      <>
        {banner}
        <BlackjackDuel conn={duel} />
      </>
    );
  }
  if (bac || rl || tx) {
    return (
      <>
        {banner}
        {bac && <Baccarat conn={bac} />}
        {rl && <Roulette conn={rl} />}
        {tx && <TexasHoldem conn={tx} />}
      </>
    );
  }
  if (dice || potato || spy) {
    return (
      <>
        {banner}
        {dice && <LiarsDice conn={dice} />}
        {potato && <HotPotato conn={potato} />}
        {spy && <Spyfall conn={spy} />}
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
    return <NoticeScreen title="Table's full" message="This table has no seats left. Start your own from home." />;
  }
  if (message === "Game is over") {
    return <NoticeScreen title="Game over" message="That scorekeeper game already finished." />;
  }
  return <NoticeScreen title="Couldn't join" message={message} />;
}
