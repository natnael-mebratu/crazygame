import { describe, expect, it } from 'vitest';
import { CrazyGame, GameError, decksForPlayers, mulberry32 } from '../src';
import { WINDOW, count, hand, play, setup, top, turnOf } from './helpers';

const PLAIN = ['3C', '4C', '6C', '9C', 'QC', 'KC', '10C', '3D', '4D', '6D'];

describe('setup', () => {
  it('deals 6 each and 7 to the starter', () => {
    const g = new CrazyGame(
      [1, 2, 3, 4].map((i) => ({ id: `p${i}`, name: `P${i}` })),
      { rng: mulberry32(1), starterIndex: 2 },
    );
    expect(g.state.players.map((p) => p.hand.length)).toEqual([6, 6, 7, 6]);
    expect(g.current.id).toBe('p3');
    expect(g.state.discard).toEqual([]);
    expect(g.state.drawPile.length).toBe(104 - 25);
  });

  it('uses 1 / 2 / 3 decks by player count, max 8', () => {
    expect([2, 3, 4, 6, 7, 8].map(decksForPlayers)).toEqual([1, 1, 2, 2, 3, 3]);
    expect(() => decksForPlayers(9)).toThrow();
    expect(() => new CrazyGame([{ id: 'a', name: 'A' }])).toThrow(GameError);
  });
});

describe('opening', () => {
  it('a special card can open but loses its power', () => {
    const g = setup({ hands: [['2H', ...PLAIN], ['2C', ...PLAIN]] });
    play(g, 'p0', ['2H']);
    expect(g.state.pendingPenalty).toBe(0);
    expect(g.state.lastMove?.foul).toBeNull();
    // Next 2 only carries 2, not 4.
    play(g, 'p1', ['2C']);
    expect(g.state.pendingPenalty).toBe(2);
  });

  it('opening 5 / 7 / J do nothing', () => {
    const g = setup({ hands: [['7H', ...PLAIN], PLAIN, PLAIN] });
    play(g, 'p0', ['7H']);
    expect(g.state.direction).toBe(1);
    expect(turnOf(g)).toBe('p1');

    const g2 = setup({ hands: [['JH', ...PLAIN], PLAIN] });
    play(g2, 'p0', ['JH'], 'S');
    expect(g2.state.activeSuit).toBe('H');
    expect(g2.state.wildCooldown).toBe(false);
  });

  it('opening with a combo is a foul', () => {
    const g = setup({ hands: [['7H', '3H', ...PLAIN], PLAIN] });
    play(g, 'p0', ['7H', '3H']);
    expect(g.state.lastMove?.foul).toBe('opening_combo');
  });
});

describe('matching', () => {
  it('suit or rank is legal', () => {
    const g = setup({ hands: [['9S', ...PLAIN], ['9H', ...PLAIN]], top: '4S' });
    play(g, 'p0', ['9S']);
    expect(g.state.lastMove?.foul).toBeNull();
    play(g, 'p1', ['9H']);
    expect(g.state.lastMove?.foul).toBeNull();
    expect(g.state.activeSuit).toBe('H');
  });

  it('a mismatch goes on the table and stands if nobody calls it', () => {
    const g = setup({ hands: [['KH', ...PLAIN], PLAIN], top: '4S' });
    play(g, 'p0', ['KH'], undefined, 0);
    expect(g.state.lastMove?.foul).toBe('wrong_match');
    expect(top(g)).toBe('KH');
    g.tick(WINDOW);
    expect(g.state.lastMove).toBeNull();
    expect(() => g.callCrazy('p1', WINDOW + 1)).toThrow(GameError);
    expect(top(g)).toBe('KH');
  });

  it('the next move closes the Crazy window', () => {
    const g = setup({ hands: [['KH', ...PLAIN], ['KD', ...PLAIN]], top: '4S' });
    play(g, 'p0', ['KH'], undefined, 0);
    play(g, 'p1', ['KD'], undefined, 100);
    expect(g.state.lastMove?.playerId).toBe('p1');
  });
});

describe('Crazy window (default: until the next move)', () => {
  const live = (hands: string[][], top: string) => {
    const g = new CrazyGame(
      hands.map((_, i) => ({ id: `p${i}`, name: `P${i}` })),
      { rng: mulberry32(3), starterIndex: 0 },
    );
    const t = setup({ hands, top });
    g.state = { ...t.state, config: g.state.config };
    return g;
  };

  it('stays open however long the next player thinks', () => {
    const g = live([['QC', ...PLAIN], PLAIN], 'AS');
    play(g, 'p0', ['QC'], undefined, 0);
    g.tick(60_000);
    expect(g.viewFor('p1').crazyWindow).toEqual({ moveId: 1, playerId: 'p0', kind: 'play', closesAt: null });
    g.callCrazy('p1', 60_000);
    expect(top(g)).toBe('AS');
    expect(hand(g, 'p0')).toContain('QC');
  });

  it('A♠ → take +5 → wrong-suit card can be called (reported case)', () => {
    const g = live([['AS', ...PLAIN], ['QC', ...PLAIN]], '9S');
    play(g, 'p0', ['AS'], undefined, 0);
    g.draw('p1', 1000); // takes 5
    play(g, 'p1', ['QC'], undefined, 2000); // clubs on spades
    expect(g.state.lastMove?.foul).toBe('wrong_match');
    const ev = g.callCrazy('p0', 9000);
    expect(ev).toContainEqual({ type: 'crazy', callerId: 'p0', targetId: 'p1', correct: true, foul: 'wrong_match' });
  });

  it('a winning card only waits 5 seconds', () => {
    const g = live([['9S'], PLAIN], '4S');
    play(g, 'p0', ['9S'], undefined, 0);
    expect(g.viewFor('p1').crazyWindow?.closesAt).toBe(5000);
    g.tick(5000);
    expect(g.state.winner).toBe('p0');
  });
});

describe('Crazy calls', () => {
  it('a correct call undoes the move, gives +4 and ends the turn', () => {
    const g = setup({ hands: [['KH', ...PLAIN], PLAIN, PLAIN], top: '4S' });
    const before = count(g, 'p0');
    play(g, 'p0', ['KH']);
    const ev = g.callCrazy('p2', 1000);
    expect(ev).toContainEqual({ type: 'crazy', callerId: 'p2', targetId: 'p0', correct: true, foul: 'wrong_match' });
    expect(top(g)).toBe('4S');
    expect(g.state.activeSuit).toBe('S');
    expect(hand(g, 'p0')).toContain('KH');
    expect(count(g, 'p0')).toBe(before + 4);
    expect(turnOf(g)).toBe('p1');
  });

  it('a wrong call costs the caller +4', () => {
    const g = setup({ hands: [['9S', ...PLAIN], PLAIN], top: '4S' });
    play(g, 'p0', ['9S']);
    g.callCrazy('p1', 500);
    expect(count(g, 'p1')).toBe(PLAIN.length + 4);
    expect(top(g)).toBe('9S');
  });

  it('you cannot call on yourself', () => {
    const g = setup({ hands: [['KH', ...PLAIN], PLAIN], top: '4S' });
    play(g, 'p0', ['KH']);
    expect(() => g.callCrazy('p0', 1)).toThrow(GameError);
  });

});

describe('dodging a penalty (auto-caught)', () => {
  it('card stays in hand, take owed + 4, then you still play your turn', () => {
    const g = setup({ hands: [['KS', ...PLAIN], PLAIN, PLAIN], top: '2S', pending: 2 });
    const ev = play(g, 'p0', ['KS']);
    expect(ev).toEqual([{ type: 'drew', playerId: 'p0', count: 6, reason: 'dodged_penalty' }]);
    expect(top(g)).toBe('2S');
    expect(count(g, 'p0')).toBe(1 + PLAIN.length + 6);
    expect(g.state.pendingPenalty).toBe(0);
    expect(turnOf(g)).toBe('p0');
    play(g, 'p0', ['KS']); // now a normal, legal move
    expect(g.state.lastMove?.foul).toBeNull();
  });

  it('passing on a penalty is caught the same way', () => {
    const g = setup({ hands: [['KH'], PLAIN], top: '2S', pending: 2 });
    g.pass('p0');
    expect(count(g, 'p0')).toBe(7);
    expect(turnOf(g)).toBe('p0');
  });
});

describe('out of turn', () => {
  it('before the first card is down, SNAP / CRAZY / passing cost nothing', () => {
    const g = setup({ hands: [['9S', 'KH'], ['3C', ...PLAIN]] });
    expect(() => g.snap('p1', 'p1')).toThrow('P0 starts');
    expect(() => g.snap('p1', 'p0')).toThrow('P0 starts');
    expect(() => g.pass('p0')).toThrow('You start');
    g.draw('p0');
    g.pass('p0'); // drew first: fine
    expect(() => g.callCrazy('p1')).toThrow('starts');
    expect(count(g, 'p1')).toBe(PLAIN.length + 1);
    expect(count(g, 'p0')).toBe(3);
  });

  it('before the first card is down: no penalty, just wait for the starter', () => {
    const g = setup({ hands: [PLAIN, ['9S', ...PLAIN]] });
    expect(() => play(g, 'p1', ['9S'])).toThrow('P0 starts');
    expect(count(g, 'p1')).toBe(PLAIN.length + 1);
    expect(turnOf(g)).toBe('p0');
  });

  it('is caught instantly: +4, card stays hidden in hand', () => {
    const g = setup({ hands: [PLAIN, ['9S', ...PLAIN]], top: '4S' });
    const ev = play(g, 'p1', ['9S']);
    expect(ev).toEqual([{ type: 'drew', playerId: 'p1', count: 4, reason: 'out_of_turn' }]);
    expect(top(g)).toBe('4S');
    expect(hand(g, 'p1')).toContain('9S');
    expect(turnOf(g)).toBe('p0');
  });
});

describe('2 and A♠ penalties', () => {
  it('2s stack, then the victim takes all and plays a normal turn', () => {
    const g = setup({ hands: [['2H', ...PLAIN], ['2C', ...PLAIN], ['4H', ...PLAIN]], top: '9H' });
    play(g, 'p0', ['2H']);
    play(g, 'p1', ['2C']);
    expect(g.state.pendingPenalty).toBe(4);
    g.draw('p2', 10);
    expect(count(g, 'p2')).toBe(PLAIN.length + 1 + 4);
    expect(turnOf(g)).toBe('p2');
    expect(g.state.hasDrawn).toBe(false);
    play(g, 'p2', ['3C'], undefined, 20); // active suit is C after 2C
    expect(g.state.lastMove?.foul).toBeNull();
  });

  it('after taking a penalty with nothing to play: draw 1 then pass', () => {
    const g = setup({ hands: [['KS'], PLAIN], top: '2H', pending: 2 });
    g.draw('p0'); // takes the 2
    g.draw('p0'); // the normal draw-1
    expect(count(g, 'p0')).toBe(4);
    expect(g.state.hasDrawn).toBe(true);
    g.pass('p0');
    expect(g.state.lastMove?.foul).toBeNull();
  });

  it('A♠ alone gives 5', () => {
    const g = setup({ hands: [['AS', ...PLAIN], PLAIN], top: '9S' });
    play(g, 'p0', ['AS']);
    expect(g.state.pendingPenalty).toBe(5);
  });

  it('A♠ stacks on 2♠ for 7', () => {
    const g = setup({ hands: [['2S', ...PLAIN], ['AS', ...PLAIN], PLAIN], top: '9S' });
    play(g, 'p0', ['2S']);
    play(g, 'p1', ['AS']);
    expect(g.state.lastMove?.foul).toBeNull();
    expect(g.state.pendingPenalty).toBe(7);
  });

  it('nothing goes on A♠, and A♠ cannot go on 2 of another suit', () => {
    const g = setup({ hands: [['2S', ...PLAIN], PLAIN], top: 'AS', pending: 5 });
    play(g, 'p0', ['2S']);
    expect(count(g, 'p0')).toBe(1 + PLAIN.length + 9);
    expect(top(g)).toBe('AS');

    const g2 = setup({ hands: [['AS', ...PLAIN], PLAIN], top: '2H', pending: 2 });
    play(g2, 'p0', ['AS']);
    expect(count(g2, 'p0')).toBe(1 + PLAIN.length + 6);
  });

  it('a wild cannot dodge a penalty', () => {
    const g = setup({ hands: [['8S', ...PLAIN], PLAIN], top: '2S', pending: 2 });
    play(g, 'p0', ['8S'], 'H');
    expect(top(g)).toBe('2S');
    expect(count(g, 'p0')).toBe(1 + PLAIN.length + 6);
  });
});

describe('5 and 7', () => {
  it('5 skips the next player', () => {
    const g = setup({ hands: [['5H', ...PLAIN], PLAIN, PLAIN], top: '9H' });
    play(g, 'p0', ['5H']);
    expect(turnOf(g)).toBe('p2');
  });

  it('7 reverses, and another 7 reverses back', () => {
    const g = setup({ hands: [['7H', ...PLAIN], PLAIN, ['7C', ...PLAIN]], top: '9H' });
    play(g, 'p0', ['7H']);
    expect(g.state.direction).toBe(-1);
    expect(turnOf(g)).toBe('p2');
    play(g, 'p2', ['7C']);
    expect(g.state.direction).toBe(1);
    expect(turnOf(g)).toBe('p0');
  });

  it('7 combo drops same-suit cards, no reverse, penalties inert', () => {
    const g = setup({ hands: [['7H', '2H', 'KH', '5H', ...PLAIN], PLAIN, PLAIN], top: '9H' });
    play(g, 'p0', ['7H', '2H', 'KH', '5H']);
    expect(g.state.lastMove?.foul).toBeNull();
    expect(g.state.direction).toBe(1);
    expect(g.state.pendingPenalty).toBe(0);
    expect(turnOf(g)).toBe('p1');
    expect(top(g)).toBe('5H');
  });

  it('A♠ inside a spade combo does not penalize', () => {
    const g = setup({ hands: [['7S', 'AS', ...PLAIN], PLAIN], top: '9S' });
    play(g, 'p0', ['7S', 'AS']);
    expect(g.state.pendingPenalty).toBe(0);
  });

  it('mixed-suit combo or combo without a 7 is a foul', () => {
    const g = setup({ hands: [['7H', 'KD', ...PLAIN], PLAIN], top: '9H' });
    play(g, 'p0', ['7H', 'KD']);
    expect(g.state.lastMove?.foul).toBe('bad_combo');

    const g2 = setup({ hands: [['9H', 'KH', ...PLAIN], PLAIN], top: '4H' });
    play(g2, 'p0', ['9H', 'KH']);
    expect(g2.state.lastMove?.foul).toBe('bad_combo');
  });
});

describe('8 and J wilds', () => {
  it('play on anything and set the suit', () => {
    const g = setup({ hands: [['JD', ...PLAIN], ['3S', ...PLAIN]], top: '9H' });
    play(g, 'p0', ['JD'], 'S');
    expect(g.state.lastMove?.foul).toBeNull();
    expect(g.state.activeSuit).toBe('S');
    play(g, 'p1', ['3S']);
    expect(g.state.lastMove?.foul).toBeNull();
  });

  it('right after a wild, an 8/J can drop but cannot change the suit', () => {
    const g = setup({ hands: [['8D', ...PLAIN], ['JC', ...PLAIN]], top: '9H' });
    play(g, 'p0', ['8D'], 'C');
    play(g, 'p1', ['JC'], 'H');
    expect(g.state.lastMove?.foul).toBe('wild_on_wild');

    const ok = setup({ hands: [['JH', ...PLAIN], ['JS', ...PLAIN], ['8D', ...PLAIN]], top: '9H' });
    play(ok, 'p0', ['JH'], 'S');
    play(ok, 'p1', ['JS']); // "still spade"
    expect(ok.state.lastMove?.foul).toBeNull();
    expect(ok.state.activeSuit).toBe('S');
    play(ok, 'p2', ['8D'], 'D'); // a normal play happened in between → may change
    expect(ok.state.lastMove?.foul).toBeNull();
    expect(ok.state.activeSuit).toBe('D');

    const g2 = setup({ hands: [['8D', 'JC', ...PLAIN], ['3C', ...PLAIN]], top: '9H' });
    play(g2, 'p0', ['8D'], 'C');
    play(g2, 'p1', ['3C']);
    play(g2, 'p0', ['JC'], 'H');
    expect(g2.state.lastMove?.foul).toBeNull();
  });
});

describe('drawing and passing', () => {
  it('draw 1 then pass is legal; only one draw per turn', () => {
    const g = setup({ hands: [['KS'], PLAIN], top: '9H' });
    g.draw('p0');
    expect(() => g.draw('p0')).toThrow(GameError);
    g.pass('p0');
    expect(g.state.lastMove?.foul).toBeNull();
    expect(turnOf(g)).toBe('p1');
  });

  it('passing without drawing is a foul', () => {
    const g = setup({ hands: [['KS', 'QS'], PLAIN], top: '9H' });
    g.pass('p0');
    expect(g.state.lastMove?.foul).toBe('pass_without_draw');
    g.callCrazy('p1', 1);
    expect(count(g, 'p0')).toBe(6);
  });

  it('reshuffles the played pile (keeping the top) when the draw pile is empty', () => {
    const g = setup({ hands: [['9H', 'KS'], ['9D', ...PLAIN]], top: '4H', drawPile: [] });
    play(g, 'p0', ['9H'], undefined, 0);
    g.tick(WINDOW);
    play(g, 'p1', ['9D'], undefined, WINDOW);
    g.tick(2 * WINDOW);
    const ev = g.draw('p0', 2 * WINDOW);
    expect(ev).toContainEqual({ type: 'reshuffled' });
    expect(top(g)).toBe('9D');
    expect(count(g, 'p0')).toBe(2);
  });
});

describe('Snap (last card)', () => {
  it('snapping yourself first keeps you safe', () => {
    const g = setup({ hands: [['9H', 'KS'], PLAIN], top: '4H' });
    play(g, 'p0', ['9H']);
    expect(g.viewFor('p1').players[0].snap).toBe('open');
    g.snap('p0', 'p0', 10);
    const ev = g.snap('p1', 'p0', 20);
    expect(ev).toEqual([{ type: 'snap', byId: 'p1', targetId: 'p0', outcome: 'late' }]);
    expect(count(g, 'p0')).toBe(1);
  });

  it('someone else snapping first costs you +4', () => {
    const g = setup({ hands: [['9H', 'KS'], PLAIN], top: '4H' });
    play(g, 'p0', ['9H']);
    g.snap('p1', 'p0', 10);
    expect(count(g, 'p0')).toBe(5);
    expect(g.state.snap.p0).toBeUndefined();
  });

  it('snapping someone without exactly 1 card costs you +4', () => {
    const g = setup({ hands: [['9H', 'KS', 'QS'], PLAIN], top: '4H' });
    g.snap('p1', 'p0', 10);
    expect(count(g, 'p1')).toBe(PLAIN.length + 4);
    g.snap('p0', 'p0', 20); // announcing early
    expect(count(g, 'p0')).toBe(7);
  });
});

describe('winning', () => {
  it('wins when the Crazy window closes; the last card can be anything', () => {
    const g = setup({ hands: [['JH'], PLAIN], top: '4S' });
    play(g, 'p0', ['JH'], 'D', 0);
    expect(g.state.status).toBe('playing');
    const ev = g.tick(WINDOW);
    expect(ev).toEqual([{ type: 'won', playerId: 'p0' }]);
    expect(g.state.winner).toBe('p0');
    expect(() => g.draw('p1', WINDOW + 1)).toThrow(GameError);
  });

  it('a caught illegal last card cancels the win', () => {
    const g = setup({ hands: [['KH'], PLAIN], top: '4S' });
    play(g, 'p0', ['KH']);
    g.callCrazy('p1', 100);
    g.tick(WINDOW * 2);
    expect(g.state.status).toBe('playing');
    expect(count(g, 'p0')).toBe(5);
  });
});

describe('viewFor', () => {
  it('shows your hand, only counts for others, and never the foul', () => {
    const g = setup({ hands: [['KH', ...PLAIN], PLAIN], top: '4S' });
    play(g, 'p0', ['KH']);
    const v = g.viewFor('p1');
    expect(v.you.hand.length).toBe(PLAIN.length);
    expect(v.players[0]).toEqual({ id: 'p0', name: 'P0', cardCount: PLAIN.length, snap: null });
    expect(v.crazyWindow).toEqual({ moveId: 1, playerId: 'p0', kind: 'play', closesAt: WINDOW });
    expect(JSON.stringify(v)).not.toContain('wrong_match');
  });
});

describe('table info', () => {
  it('remembers who called the suit; a normal card clears it', () => {
    const g = setup({ hands: [['JD', ...PLAIN], ['3S', ...PLAIN]], top: '9H' });
    play(g, 'p0', ['JD'], 'S');
    expect(g.viewFor('p1').suitCalledBy).toBe('p0');
    play(g, 'p1', ['3S']);
    expect(g.viewFor('p1').suitCalledBy).toBeNull();
  });

  it('keeps the last plays, and drops a caught one', () => {
    const g = setup({ hands: [['9H', 'KS', ...PLAIN], ['9D', ...PLAIN]], top: '4H' });
    play(g, 'p0', ['9H'], undefined, 0);
    play(g, 'p1', ['9D'], undefined, 10);
    expect(g.viewFor('p0').recent.map((r) => r.playerId)).toEqual(['p0', 'p1']);
    play(g, 'p0', ['KS'], undefined, 20); // wrong suit
    expect(g.viewFor('p0').crazyWindow?.kind).toBe('play');
    g.callCrazy('p1', 30);
    expect(g.viewFor('p0').recent.length).toBe(2);
  });
});

describe('removing a player', () => {
  it('on their turn: cards go to the draw pile, the next player continues', () => {
    const g = setup({ hands: [PLAIN, ['KS', 'QS'], PLAIN], top: '4H', turn: 1, pending: 2 });
    const pile = g.state.drawPile.length;
    const ev = g.removePlayer('p1');
    expect(ev[0]).toEqual({ type: 'removed', playerId: 'p1', name: 'P1' });
    expect(g.state.players.map((p) => p.id)).toEqual(['p0', 'p2']);
    expect(g.state.drawPile.length).toBe(pile + 2);
    expect(turnOf(g)).toBe('p2');
    expect(g.state.pendingPenalty).toBe(0);
  });

  it('before the current player keeps the same player on turn', () => {
    const g = setup({ hands: [PLAIN, PLAIN, PLAIN], top: '4H', turn: 2 });
    g.removePlayer('p0');
    expect(turnOf(g)).toBe('p2');
  });

  it('down to one player: they win', () => {
    const g = setup({ hands: [PLAIN, PLAIN], top: '4H' });
    g.removePlayer('p1');
    expect(g.state.status).toBe('finished');
    expect(g.state.winner).toBe('p0');
  });
});

