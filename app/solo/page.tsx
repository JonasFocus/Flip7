"use client";

import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { Lobby } from "@/components/lobby/Lobby";
import { NameGate } from "@/components/lobby/Screens";
import { Table } from "@/components/table/Table";
import { useLocalGame } from "@/lib/client/useLocalGame";

export default function SoloPage() {
  return <NameGate>{(name) => <SoloGame name={name} />}</NameGate>;
}

function SoloGame({ name }: { name: string }) {
  const raw = useLocalGame(name, 2);
  const router = useRouter();
  const conn = useMemo(() => ({ ...raw, leave: () => (raw.leave(), router.replace("/")) }), [raw, router]);
  return conn.game.phase === "lobby" ? <Lobby conn={conn} /> : <Table conn={conn} />;
}
