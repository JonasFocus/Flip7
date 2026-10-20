import type { TxPlayer } from "./types.ts";

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

// What showdown actually contested: every chip paid out of the pots, so an uncalled bet returned to its owner is not counted.
export const potWon = (players: readonly TxPlayer[]): number => players.reduce((n, p) => n + (p.result?.won ?? 0), 0);
