import type { Card, Rank, Suit } from './types';

export const SUITS: readonly Suit[] = ['H', 'C', 'S', 'D'];
export const RANKS: readonly Rank[] = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 8;

/** 2–3 players: 1 deck · 4–6: 2 decks · 7–8: 3 decks. */
export function decksForPlayers(players: number): number {
  if (players < MIN_PLAYERS || players > MAX_PLAYERS) {
    throw new RangeError(`Crazy needs ${MIN_PLAYERS}–${MAX_PLAYERS} players, got ${players}`);
  }
  if (players <= 3) return 1;
  if (players <= 6) return 2;
  return 3;
}

/** Standard 52-card decks, no Jokers. */
export function createDeck(copies = 1): Card[] {
  const cards: Card[] = [];
  for (let d = 0; d < copies; d++) {
    for (const suit of SUITS) {
      for (const rank of RANKS) cards.push({ id: `${rank}${suit}#${d}`, suit, rank });
    }
  }
  return cards;
}

/** Fisher–Yates, in place. */
export function shuffle<T>(items: T[], rng: () => number): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

/** Small seeded RNG for reproducible games and tests. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const isWild = (c: Card) => c.rank === '8' || c.rank === 'J';
export const isAceOfSpades = (c: Card) => c.rank === 'A' && c.suit === 'S';

/** "7H", "10S", "AS" … */
export const cardLabel = (c: Card) => `${c.rank}${c.suit}`;
