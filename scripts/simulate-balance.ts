import assert from "node:assert/strict";
import * as ordinary from "../lib/engine/index.ts";
import * as balanced from "../server/flip7.ts";
import type { GameState, Intent } from "../lib/engine/types.ts";

function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function checkDeck(game: GameState) {
  const cards = [
    ...game.deck,
    ...game.discard,
    ...game.players.flatMap((p) => p.hand),
    ...game.actionQueue.map((action) => action.card),
    ...(game.pending?.type === "chooseTarget" ? [game.pending.card] : game.pending?.type === "flipThree" ? game.pending.queued : []),
  ];
  assert.equal(cards.length, 94);
  assert.equal(new Set(cards.map((card) => card.id)).size, 94);
}

function play(seed: number, adaptive: boolean, players: number) {
  const rng = seeded(seed);
  const engine = adaptive ? balanced : ordinary;
  let game = engine.createGame();
  for (let i = 0; i < players; i++) game = engine.addPlayer(game, { id: String(i), name: `Bot ${i}`, isBot: true });
  const streaks = Array<number>(players).fill(0);
  const longest = Array<number>(players).fill(0);
  const wins = Array<number>(players).fill(0);
  let rounds = 0, busts = 0, earlyBusts = 0, repeatBusts = 0, actions = 0;

  function act(id: string, intent: Intent) {
    const result = engine.applyIntent(game, id, intent, { isHost: id === "0", rng });
    if (!result.ok) throw new Error(result.error);
    game = result.state;
    checkDeck(game);
    if (result.events.some((event) => event.type === "roundEnd")) {
      rounds++;
      game.players.forEach((player, i) => {
        if (player.status === "busted") {
          busts++;
          if (ordinary.uniqueNumbers(player.hand) <= 2) earlyBusts++;
          if (streaks[i]! > 0) repeatBusts++;
          streaks[i]!++;
        } else streaks[i] = 0;
        longest[i] = Math.max(longest[i]!, streaks[i]!);
      });
    }
  }

  act("0", { type: "start" });
  while (game.phase !== "gameOver" && actions++ < 3000) {
    if (game.phase === "roundOver") {
      act("0", { type: "nextRound" });
      continue;
    }
    const id = ordinary.awaitingPlayerId(game);
    if (!id) throw new Error("Missing actor");
    const intent = engine.chooseBotIntent(game, id, rng);
    if (!intent) throw new Error("Missing intent");
    act(id, intent);
  }
  assert.equal(game.phase, "gameOver", "Game did not finish");
  const top = Math.max(...game.players.map((p) => p.total));
  game.players.forEach((p, i) => { if (p.total === top) wins[i]!++; });
  return { rounds, busts, earlyBusts, repeatBusts, tripleBustPlayers: longest.filter((streak) => streak >= 3).length, wins };
}

const games = Number(process.argv[2] ?? 1000);
if (!Number.isSafeInteger(games) || games <= 0) throw new Error("Game count must be a positive integer");
for (const players of [2, 4, 8]) for (const adaptive of [false, true]) {
  const total = { rounds: 0, busts: 0, earlyBusts: 0, repeatBusts: 0, tripleBustPlayers: 0, wins: Array<number>(players).fill(0) };
  for (let seed = 1; seed <= games; seed++) {
    const result = play(seed, adaptive, players);
    total.rounds += result.rounds;
    total.busts += result.busts;
    total.earlyBusts += result.earlyBusts;
    total.repeatBusts += result.repeatBusts;
    total.tripleBustPlayers += result.tripleBustPlayers;
    result.wins.forEach((wins, i) => { total.wins[i]! += wins; });
  }
  console.log(JSON.stringify({
    adaptive, players, games, ...total,
    roundsPerGame: total.rounds / games,
    bustRate: total.busts / (total.rounds * players),
    earlyBustRate: total.earlyBusts / (total.rounds * players),
    repeatBustsPerGame: total.repeatBusts / games,
    tripleBustPlayerRate: total.tripleBustPlayers / (games * players),
  }));
}
