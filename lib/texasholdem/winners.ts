import type { TxPlayer, TxState } from "./types.ts";

export interface WinLine {
  key: string;
  text: string;
  hand: string | null;
}

// One line per payee. "Split" only when another payee made the same hand from the same ranks; a main pot and a side pot won with different hands are separate wins.
export function winLines(payees: readonly TxPlayer[], you: string): WinLine[] {
  const signature = (p: TxPlayer) => (p.result?.hand ? `${p.result.hand}|${p.result.best.map((c) => c.rank).join()}` : null);
  return payees.map((p) => {
    const sig = signature(p);
    const tied = sig !== null && payees.some((o) => o.id !== p.id && signature(o) === sig);
    const me = p.id === you;
    const verb = tied ? (me ? "split" : "splits") : me ? "win" : "wins";
    return { key: p.id, text: `${me ? "You" : p.name} ${verb} ${(p.result?.won ?? 0).toLocaleString()}`, hand: p.result?.hand ?? null };
  });
}

// Everything showdown paid into the stack: pot winnings plus an uncalled bet returned to its owner.
export const paidOut = (p: TxPlayer): number => (p.result ? p.result.net + p.total : 0);

export interface Standing {
  id: string;
  name: string;
  buyIn: number;
  net: number;
}

// Net winnings tonight, best first: what you hold minus every buy-in. Chips in a live pot still count as yours until the hand is paid, so a bet never reads as a loss.
export function standings(s: TxState): Standing[] {
  return s.players
    .map((p) => {
      const buyIn = s.buyIns[p.id] ?? 0;
      const held = p.chips + (s.phase === "showdown" ? 0 : p.total);
      return { id: p.id, name: p.name, buyIn, net: held - buyIn };
    })
    .sort((a, b) => b.net - a.net);
}
