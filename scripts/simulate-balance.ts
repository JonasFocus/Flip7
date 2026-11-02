import { addPlayer, applyIntent, awaitingPlayerId, chooseBotIntent, createGame } from '../lib/engine/index.ts';
import type { Intent } from '../lib/engine/types.ts';

function seeded(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function play(seed: number, adaptive: boolean) {
  const rng = seeded(seed);
  let game = createGame();
  for (let i = 0; i < 4; i++) game = addPlayer(game, {id: String(i), name: `Bot ${i}`, isBot: true});
  if (!adaptive) game.balance = undefined;
  const wins = [0, 0, 0, 0], streaks = [0, 0, 0, 0];
  let busts = 0, repeatBusts = 0, rounds = 0, actions = 0;
  function act(id: string, intent: Intent) {
    const result = applyIntent(game, id, intent, {isHost: id === '0', rng});
    if (!result.ok) throw new Error(result.error);
    game = result.state;
    if (result.events.some(e => e.type === 'roundEnd')) {
      rounds++;
      game.players.forEach((p, i) => { if (p.status === 'busted') { busts++; if (streaks[i]! > 0) repeatBusts++; streaks[i]!++; } else streaks[i] = 0; });
    }
  }
  act('0', {type:'start'});
  while (game.phase !== 'gameOver' && actions++ < 3000) {
    if (game.phase === 'roundOver') { act('0', {type:'nextRound'}); continue; }
    const id = awaitingPlayerId(game);
    if (!id) throw new Error('Missing actor');
    const intent = chooseBotIntent(game, id, rng);
    if (!intent) throw new Error('Missing intent');
    act(id, intent);
  }
  if (game.phase !== 'gameOver') throw new Error('Game did not finish');
  const top = Math.max(...game.players.map(p => p.total));
  game.players.forEach((p, i) => { if (p.total === top) wins[i]!++; });
  return {rounds, busts, repeatBusts, wins};
}
const n = Number(process.argv[2] ?? 1000);
for (const adaptive of [false, true]) {
  const total = {rounds:0, busts:0, repeatBusts:0, wins:[0,0,0,0]};
  for (let i = 1; i <= n; i++) { const r = play(i, adaptive); total.rounds += r.rounds; total.busts += r.busts; total.repeatBusts += r.repeatBusts; r.wins.forEach((v,j) => total.wins[j]! += v); }
  console.log(JSON.stringify({adaptive, games:n, ...total, roundsPerGame:total.rounds/n, bustsPerGame:total.busts/n, repeatBustsPerGame:total.repeatBusts/n}));
}
