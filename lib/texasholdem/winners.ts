import type { TxHandResult, TxPlayer, TxState } from "./types.ts";

export interface WinLine {
  key: string;
  text: string;
  hand: string | null;
}

// One line per payee. "Split" only when another payee made the same hand from the same ranks; a main pot and a side pot won with different hands are separate wins.
export function winLines(payees: readonly TxPlayer[], you: string): WinLine[] {
  const ranks = (hand: string, best: readonly { rank: string }[]) => `${hand}|${best.map((c) => c.rank).join()}`;
  const signature = (p: TxPlayer) => (p.result?.hand ? ranks(p.result.hand, p.result.best) + (p.result.second?.hand ? `|${ranks(p.result.second.hand, p.result.second.best)}` : "") : null);
  return payees.map((p) => {
    const sig = signature(p);
    const tied = sig !== null && payees.some((o) => o.id !== p.id && signature(o) === sig);
    const me = p.id === you;
    const verb = tied ? (me ? "split" : "splits") : me ? "win" : "wins";
    return { key: p.id, text: `${me ? "You" : p.name} ${verb} ${(p.result?.won ?? 0).toLocaleString()}`, hand: handLabel(p.result) };
  });
}

// The hand to name for a player: the board they won on, or both hands when it ran twice and they won on both or neither.
export function handLabel(r: TxHandResult | null): string | null {
  if (!r?.second) return r?.hand ?? null;
  if (r.second.won > 0 && r.second.won === r.won) return r.second.hand;
  if (r.second.won === 0 && r.won > 0) return r.hand;
  return r.hand === r.second.hand ? r.hand : [r.hand, r.second.hand].filter(Boolean).join(" / ");
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

// The stack as the table shows it before the winner is called: at showdown the payout is already in `chips`.
export const stackBeforeAward = (p: TxPlayer, phase: TxState["phase"]): number => (phase === "showdown" ? p.chips - paidOut(p) : p.chips);

// What showdown actually contested: every chip paid out of the pots, so an uncalled bet returned to its owner is not counted.
export const potWon = (players: readonly TxPlayer[]): number => players.reduce((n, p) => n + (p.result?.won ?? 0), 0);
