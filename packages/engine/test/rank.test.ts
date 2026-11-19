import { describe, expect, it } from 'vitest';
import { play, setup, turnOf } from './helpers';

const PLAIN = ['3C', '4C', '9D', 'KS'];

describe('same number on a different suit', () => {
  it('6♣ on 6♥: legal, and the game becomes clubs', () => {
    const g = setup({ hands: [['6C', ...PLAIN], PLAIN], top: '6H' });
    play(g, 'p0', ['6C']);
    expect(g.state.lastMove?.foul).toBeNull();
    expect(g.state.activeSuit).toBe('C');
  });

  it('Q♥ on Q♦: legal, and the game becomes hearts', () => {
    const g = setup({ hands: [['QH', ...PLAIN], PLAIN], top: 'QD' });
    play(g, 'p0', ['QH']);
    expect(g.state.lastMove?.foul).toBeNull();
    expect(g.state.activeSuit).toBe('H');
  });

  it('7 alone with 2 players: direction flips, the other player is still next', () => {
    const g = setup({ hands: [['7H', ...PLAIN], PLAIN], top: '9H' });
    play(g, 'p0', ['7H']);
    expect(g.state.direction).toBe(-1);
    expect(turnOf(g)).toBe('p1');
  });
});
