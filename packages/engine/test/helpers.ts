import { CrazyGame, cardLabel, mulberry32 } from '../src';
import type { Card, Rank, Suit } from '../src';

let seq = 0;

/** "10H" → a fresh 10 of Hearts. */
export function card(label: string): Card {
  const suit = label.slice(-1) as Suit;
  const rank = label.slice(0, -1) as Rank;
  return { id: `${label}~${seq++}`, suit, rank };
}

export interface Setup {
  /** Hands by player, e.g. [['2H','9S'], ['KD']] → players p0, p1. */
  hands: string[][];
  /** Top of the played pile. Omit for an empty table. */
  top?: string;
  active?: Suit;
  turn?: number;
  drawPile?: string[];
  pending?: number;
  wildCooldown?: boolean;
}

export const WINDOW = 4000;

/** A game with rigged hands/table, starting at time 0. */
export function setup(o: Setup): CrazyGame {
  const g = new CrazyGame(
    o.hands.map((_, i) => ({ id: `p${i}`, name: `P${i}` })),
    { rng: mulberry32(7), starterIndex: 0, crazyWindowMs: WINDOW },
  );
  const s = g.state;
  s.players.forEach((p, i) => (p.hand = o.hands[i].map(card)));
  s.discard = o.top ? [card(o.top)] : [];
  s.activeSuit = o.top ? (o.active ?? (o.top.slice(-1) as Suit)) : null;
  s.turn = o.turn ?? 0;
  if (o.drawPile) s.drawPile = o.drawPile.map(card);
  s.pendingPenalty = o.pending ?? 0;
  s.wildCooldown = o.wildCooldown ?? false;
  return g;
}

/** Card ids in a player's hand by label (first match each). */
export function ids(g: CrazyGame, pid: string, labels: string[]): string[] {
  const hand = [...g.state.players.find((p) => p.id === pid)!.hand];
  return labels.map((l) => {
    const i = hand.findIndex((c) => cardLabel(c) === l);
    if (i < 0) throw new Error(`${pid} has no ${l}`);
    return hand.splice(i, 1)[0].id;
  });
}

export const hand = (g: CrazyGame, pid: string) =>
  g.state.players.find((p) => p.id === pid)!.hand.map(cardLabel);

export const count = (g: CrazyGame, pid: string) => hand(g, pid).length;

export const turnOf = (g: CrazyGame) => g.current.id;

export const top = (g: CrazyGame) => {
  const t = g.state.discard.at(-1);
  return t ? cardLabel(t) : null;
};

/** Play by labels. */
export const play = (g: CrazyGame, pid: string, labels: string[], suit?: Suit, now = 0) =>
  g.play(pid, ids(g, pid, labels), suit, now);
