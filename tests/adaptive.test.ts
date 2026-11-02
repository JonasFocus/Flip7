import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addPlayer, applyIntent, createGame } from '../lib/engine/index.ts';

test('a struggling player can avoid a duplicate while preserving the shared deck', () => {
  const game = addPlayer(addPlayer(createGame(), { id: 'a', name: 'A', isBot: false }), { id: 'b', name: 'B', isBot: true });
  game.phase = 'playing';
  game.round = 3;
  game.players[0]!.status = 'active';
  game.players[1]!.status = 'active';
  game.players[0]!.hand = [{ id: 'held', kind: 'number', value: 5 }];
  game.deck = [{ id: 'safe', kind: 'number', value: 8 }, { id: 'duplicate', kind: 'number', value: 5 }];
  game.deckCount = 2;
  game.balance!.a!.consecutiveBusts = 2;
  const result = applyIntent(game, 'a', { type: 'hit' }, { isHost: true, rng: () => 0 });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.state.players[0]!.status, 'active');
  assert.equal(result.state.players[0]!.hand.at(-1)?.id, 'safe');
  assert.equal(result.state.deck[0]?.id, 'duplicate');
});

import { redactGame, removePlayer } from '../lib/engine/index.ts';
import type { Card, GameState, Intent } from '../lib/engine/types.ts';

const number = (id: string, value: number): Card => ({ id, kind: 'number', value });
function setup(): GameState {
  const s = addPlayer(addPlayer(createGame(), { id: 'a', name: 'A', isBot: false }), { id: 'b', name: 'B', isBot: true });
  s.phase = 'playing'; s.round = 3; s.turnIndex = 0;
  s.players[0]!.status = 'active'; s.players[1]!.status = 'active';
  s.players[0]!.hand = [number('held', 5)];
  s.deck = [number('safe', 8), number('dup', 5)]; s.deckCount = 2;
  return s;
}
function move(s: GameState, actor: string, intent: Intent, random = 0): GameState {
  const r = applyIntent(s, actor, intent, { isHost: true, rng: () => random });
  assert.ok(r.ok, r.ok ? '' : r.error);
  return r.state;
}

test('probability boundary, eligibility, and once per round', () => {
  const s = setup(); s.balance!.a!.consecutiveBusts = 2;
  assert.equal(move(s, 'a', {type: 'hit'}, 0.799).players[0]!.status, 'active');
  assert.equal(move(s, 'a', {type: 'hit'}, 0.8).players[0]!.status, 'busted');
  s.balance!.a!.consecutiveBusts = 0;
  assert.equal(move(s, 'a', {type: 'hit'}).players[0]!.status, 'busted');
  s.balance!.a!.roundsWithoutWin = 3; s.players[1]!.total = 30;
  assert.equal(move(s, 'a', {type: 'hit'}, 0.649).players[0]!.status, 'active');
  assert.equal(move(s, 'a', {type: 'hit'}, 0.65).players[0]!.status, 'busted');
  s.balance!.a!.assistedThisRound = true;
  assert.equal(move(s, 'a', {type: 'hit'}).players[0]!.status, 'busted');
});

test('only an unprotected duplicate can trigger help and all cards remain accounted for', () => {
  const s = setup(); s.balance!.a!.consecutiveBusts = 2;
  s.players[0]!.hand.push({id:'shield',kind:'secondChance'});
  const shielded = move(s, 'a', {type:'hit'});
  assert.equal(shielded.balance!.a!.assistedThisRound, false);
  assert.ok(shielded.discard.some(c => c.id === 'dup'));
  const noSafe = setup(); noSafe.balance!.a!.consecutiveBusts = 2; noSafe.deck = [number('another',5), number('dup',5)];
  assert.equal(move(noSafe, 'a', {type:'hit'}).players[0]!.status, 'busted');
  const flip = setup(); flip.balance!.a!.consecutiveBusts = 2;
  flip.pending = { type:'flipThree', sourceId:'b', targetId:'a', remaining:3, queued:[] };
  const saved = move(flip, 'a', {type:'hit'});
  assert.equal(saved.players[0]!.hand.at(-1)?.id, 'safe');
  assert.equal(saved.pending?.type, 'flipThree');
  assert.deepEqual([...saved.players.flatMap(p => p.hand.map(c => c.id)), ...saved.deck.map(c => c.id), ...saved.discard.map(c => c.id)].sort(), ['dup','held','safe']);
});

test('round ties, zero scores, normal game wins, replay, restart, and redaction', () => {
  let s = setup(); s.goal = 5;
  s.players[1]!.hand = [number('other',5)]; s.players[1]!.status = 'stayed';
  s = move(s, 'a', {type:'stay'});
  assert.equal(s.phase, 'gameOver');
  assert.equal(s.balance!.a!.gameWins, 1); assert.equal(s.balance!.b!.gameWins, 1);
  assert.equal(s.balance!.a!.roundsWon, 1); assert.equal(s.balance!.b!.roundsWon, 1);
  assert.equal(redactGame(s).balance, undefined);
  assert.deepEqual(redactGame(s).recap?.a, {gameWins:1,bestWinStreak:1});
  s = move(s, 'a', {type:'playAgain'});
  assert.equal(s.balance!.a!.gameWins, 1); assert.equal(s.balance!.a!.currentWinStreak, 1);
  assert.equal(s.recap, undefined);
  s.phase = 'playing';
  s = move(s, 'a', {type:'restart'});
  assert.equal(s.balance!.a!.currentWinStreak, 0); assert.equal(s.balance!.a!.gameWins, 1);
  assert.equal(removePlayer(s, 'b').balance?.b, undefined);
  const zero = setup(); zero.players[0]!.hand = []; zero.players[1]!.hand = []; zero.players[1]!.status = 'stayed';
  const ended = move(zero, 'a', {type:'stay'});
  assert.equal(ended.balance!.a!.roundsWon, 0); assert.equal(ended.balance!.b!.roundsWon, 0);
  const early = setup(); const endedEarly = move(early, 'a', {type:'endGame'});
  assert.equal(endedEarly.balance!.a!.gameWins, 0);
});

test('completed busts increment and a banked round clears the bust streak', () => {
  const s = setup();
  s.players[1]!.status = 'stayed';
  s.balance!.a!.consecutiveBusts = 1;
  const busted = move(s, 'a', {type:'hit'});
  assert.equal(busted.phase, 'roundOver');
  assert.equal(busted.balance!.a!.consecutiveBusts, 2);
  assert.equal(busted.balance!.a!.roundsWithoutWin, 1);
  busted.phase = 'playing'; busted.round++;
  busted.players[0]!.status = 'active'; busted.players[0]!.hand = [number('next', 4)];
  busted.players[1]!.status = 'stayed'; busted.players[1]!.hand = [number('rival', 3)];
  busted.turnIndex = 0;
  const banked = move(busted, 'a', {type:'stay'});
  assert.equal(banked.balance!.a!.consecutiveBusts, 0);
  assert.equal(banked.balance!.a!.roundsWithoutWin, 0);
  assert.equal(banked.balance!.a!.currentWinStreak, 1);
});
