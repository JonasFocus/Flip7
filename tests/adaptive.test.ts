import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addPlayer, applyIntent, balanceOdds, chooseBotIntent, createGame, redactGame, removePlayer } from '../server/flip7.ts';

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
  const s = setup(); s.balance!.a!.consecutiveBusts = 1;
  assert.equal(move(s, 'a', {type: 'hit'}, 0.649).players[0]!.status, 'active');
  assert.equal(move(s, 'a', {type: 'hit'}, 0.65).players[0]!.status, 'busted');
  s.balance!.a!.consecutiveBusts = 2;
  assert.equal(move(s, 'a', {type: 'hit'}, 0.999).players[0]!.status, 'active');
  s.balance!.a!.consecutiveBusts = 0;
  assert.equal(move(s, 'a', {type: 'hit'}).players[0]!.status, 'busted');
  s.balance!.a!.consecutiveLowRounds = 3; s.players[1]!.total = 30;
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
  assert.deepEqual(redactGame(s).recap?.a, {gameWins:1,bestWinStreak:1,bestRoundScore:5});
  s = move(s, 'a', {type:'playAgain'});
  assert.equal(s.balance!.a!.gameWins, 1); assert.equal(s.balance!.a!.currentWinStreak, 1);
  assert.equal(s.recap, undefined);
  s.phase = 'playing';
  s = move(s, 'a', {type:'restart'});
  assert.equal(s.balance!.a!.currentWinStreak, 1); assert.equal(s.balance!.a!.gameWins, 1);
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
  const busted = move(s, 'a', {type:'hit'}, 0.9);
  assert.equal(busted.phase, 'roundOver');
  assert.equal(busted.balance!.a!.consecutiveBusts, 2);
  assert.equal(busted.balance!.a!.consecutiveLowRounds, 1);
  busted.phase = 'playing'; busted.round++;
  busted.players[0]!.status = 'active'; busted.players[0]!.hand = [number('next', 4)];
  busted.players[1]!.status = 'stayed'; busted.players[1]!.hand = [number('rival', 3)];
  busted.turnIndex = 0;
  const banked = move(busted, 'a', {type:'stay'});
  assert.equal(banked.balance!.a!.consecutiveBusts, 0);
  assert.equal(banked.balance!.a!.consecutiveLowRounds, 2);
  assert.equal(banked.balance!.a!.currentWinStreak, 1);
});

test('relief does not protect a leader or a late attempt at Flip 7', () => {
  const leader = setup();
  leader.players[0]!.total = 90;
  leader.players[1]!.total = 60;
  leader.balance!.a!.consecutiveBusts = 2;
  assert.equal(move(leader, 'a', { type: 'hit' }).players[0]!.status, 'busted');

  const late = setup();
  late.players[0]!.hand = [1, 2, 3, 4, 5, 6].map((value) => number(`held-${value}`, value));
  late.deck = [number('seventh', 7), number('duplicate', 6)];
  late.balance!.a!.consecutiveBusts = 2;
  assert.equal(move(late, 'a', { type: 'hit' }).players[0]!.status, 'busted');
});

test('meaningful banked points clear poor-round history without requiring first place', () => {
  const s = setup();
  s.balance!.a!.consecutiveLowRounds = 3;
  s.players[0]!.hand = [number('six', 6), number('nine', 9)];
  s.players[1]!.hand = [number('ten', 10), number('eleven', 11)];
  s.players[1]!.status = 'stayed';
  const ended = move(s, 'a', { type: 'stay' });
  assert.equal(ended.balance!.a!.consecutiveLowRounds, 0);
  assert.equal(ended.balance!.a!.roundsWon, 0);
});

test('restart preserves the same completed-round history as replay', () => {
  const s = setup();
  s.balance!.a!.consecutiveBusts = 2;
  s.balance!.a!.currentWinStreak = 1;
  const restarted = move(s, 'a', { type: 'restart' });
  assert.equal(restarted.balance!.a!.consecutiveBusts, 2);
  assert.equal(restarted.balance!.a!.currentWinStreak, 1);
  assert.equal(restarted.balance!.a!.assistedThisRound, false);
});

test('a player without a win still gets an honest personal-best recap', () => {
  const s = setup();
  s.goal = 20;
  s.players[0]!.hand = [number('six', 6), number('nine', 9)];
  s.players[1]!.hand = [number('ten', 10), number('eleven', 11)];
  s.players[1]!.status = 'stayed';
  const ended = move(s, 'a', { type: 'stay' });
  assert.equal(ended.balance!.a!.gameWins, 0);
  assert.equal(redactGame(ended).recap?.a?.bestRoundScore, 15);
});

test('bot decisions use the adjusted next-draw risk', () => {
  const s = setup();
  s.balance!.a!.consecutiveBusts = 2;
  assert.equal(balanceOdds.nextDraw(s, 'a'), 0);
  assert.equal(chooseBotIntent(s, 'a', () => 0)?.type, 'hit');
  s.balance!.a!.assistedThisRound = true;
  assert.equal(balanceOdds.nextDraw(s, 'a'), 0.5);
  assert.equal(chooseBotIntent(s, 'a', () => 0)?.type, 'stay');
  s.balance!.a!.assistedThisRound = false;
  s.deck = [number('duplicate', 5)];
  assert.equal(balanceOdds.nextDraw(s, 'a'), 1);
  s.players[0]!.hand.push({ id: 'shield', kind: 'secondChance' });
  assert.equal(balanceOdds.nextDraw(s, 'a'), 0);
});

test('target advice agrees with the bot without exposing private history', () => {
  const s = setup();
  s.balance!.a!.consecutiveBusts = 2;
  s.players[1]!.total = 30;
  s.players[0]!.hand.push({ id: 'double', kind: 'x2' }, { id: 'ten', kind: 'plus', value: 10 }, { id: 'eight', kind: 'plus', value: 8 });
  s.pending = { type: 'chooseTarget', playerId: 'a', card: { id: 'freeze', kind: 'freeze' }, options: ['a', 'b'] };
  const visible = redactGame(s);
  assert.equal(visible.suggestedTargetId, 'b');
  assert.deepEqual(chooseBotIntent(s, 'a'), { type: 'chooseTarget', targetId: 'b' });
  assert.doesNotMatch(JSON.stringify(visible), /balance|assistedThisRound|consecutiveLowRounds|consecutiveBusts/);
  assert.equal(s.suggestedTargetId, undefined);
});

test('a real rescue cannot happen twice in one round or add a revealing event', () => {
  const s = setup();
  s.players[1]!.status = 'stayed';
  s.balance!.a!.consecutiveBusts = 2;
  s.deck = [number('nine', 9), number('eight', 8), number('duplicate', 5)];
  const draws = [0, 0.9];
  const first = applyIntent(s, 'a', { type: 'hit' }, { isHost: true, rng: () => draws.shift() ?? 0 });
  assert.ok(first.ok);
  assert.equal(first.state.balance!.a!.assistedThisRound, true);
  assert.equal(s.balance!.a!.assistedThisRound, false);
  assert.deepEqual(first.events.map((event) => event.type), ['draw']);
  assert.equal(move(first.state, 'a', { type: 'hit' }).players[0]!.status, 'busted');
});

test('after two busts a third-number hand gets one rescue, but a fourth-number hand does not', () => {
  const s = setup();
  s.players[1]!.status = 'stayed';
  s.players[0]!.hand = [number('five', 5), number('six', 6), number('seven', 7)];
  s.balance!.a!.consecutiveBusts = 1;
  assert.equal(move(s, 'a', { type: 'hit' }).players[0]!.status, 'busted');
  for (const streak of [2, 3, 5]) {
    s.balance!.a!.consecutiveBusts = streak;
    const saved = move(s, 'a', { type: 'hit' }, 0.999);
    assert.equal(saved.players[0]!.status, 'active');
    assert.equal(saved.balance!.a!.assistedThisRound, true);
    assert.equal(balanceOdds.nextDraw(saved, 'a'), 1);
    assert.equal(move(saved, 'a', { type: 'hit' }).players[0]!.status, 'busted');
  }
  s.players[0]!.hand.push(number('nine', 9));
  assert.equal(move(s, 'a', { type: 'hit' }).players[0]!.status, 'busted');
});

test('rescues leave Freeze and Flip Three in the deck and select only a helpful card', () => {
  const s = setup();
  s.balance!.a!.consecutiveBusts = 2;
  const actions: Card[] = [{ id: 'freeze', kind: 'freeze' }, { id: 'three', kind: 'flipThree' }];
  for (const safe of [number('eight', 8), { id: 'plus', kind: 'plus', value: 2 }, { id: 'double', kind: 'x2' }, { id: 'shield', kind: 'secondChance' }] satisfies Card[]) {
    s.deck = [...actions, safe, number('dup', 5)];
    s.deckCount = s.deck.length;
    const saved = move(s, 'a', { type: 'hit' });
    assert.equal(saved.players[0]!.hand.at(-1)?.id, safe.id);
    assert.equal(saved.pending, null);
    assert.deepEqual(saved.deck.slice(0, 2), actions);
    assert.deepEqual([...saved.deck, ...saved.players[0]!.hand].map((c) => c.id).sort(), ['dup', 'freeze', 'held', safe.id, 'three'].sort());
  }
  s.deck = [...actions, number('dup', 5)];
  s.deckCount = s.deck.length;
  assert.equal(balanceOdds.nextDraw(s, 'a'), 1 / 3);
  const noRescue = move(s, 'a', { type: 'hit' });
  assert.equal(noRescue.players[0]!.status, 'busted');
  assert.equal(noRescue.balance!.a!.assistedThisRound, false);
});

test('a positive bank breaks the streak and the next round restores the one-rescue budget', () => {
  const s = setup();
  s.balance!.a!.consecutiveBusts = 2;
  s.players[1]!.status = 'stayed';
  const saved = move(s, 'a', { type: 'hit' });
  assert.equal(saved.balance!.a!.assistedThisRound, true);
  const banked = move(saved, 'a', { type: 'stay' });
  assert.equal(banked.balance!.a!.consecutiveBusts, 0);
  const next = move(banked, 'a', { type: 'nextRound' });
  assert.equal(next.balance!.a!.assistedThisRound, false);
  assert.equal(next.balance!.a!.consecutiveBusts, 0);
});
