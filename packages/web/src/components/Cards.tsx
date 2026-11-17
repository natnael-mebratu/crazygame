import type { CSSProperties } from 'react';
import type { Card, Suit } from '@crazy/engine';

export const SYM: Record<Suit, string> = { H: '♥', D: '♦', S: '♠', C: '♣' };
export const SUIT_NAME: Record<Suit, string> = { H: 'Hearts', D: 'Diamonds', S: 'Spades', C: 'Clubs' };
export const isRed = (s: Suit) => s === 'H' || s === 'D';
export const label = (c: Card) => `${c.rank}${SYM[c.suit]}`;
export const spoken = (c: Card) => {
  const r = { A: 'Ace', J: 'Jack', Q: 'Queen', K: 'King' }[c.rank as 'A'] ?? c.rank;
  return `${r} of ${SUIT_NAME[c.suit].toLowerCase()}`;
};

const RANK_ORDER = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SUIT_ORDER: Suit[] = ['S', 'H', 'C', 'D'];
export type SortMode = 'suit' | 'number';
/** By suit (alternating colors) then number, or by number then suit. */
export const sortHand = (cards: Card[], mode: SortMode = 'suit') =>
  [...cards].sort((a, b) => {
    const bySuit = SUIT_ORDER.indexOf(a.suit) - SUIT_ORDER.indexOf(b.suit);
    const byRank = RANK_ORDER.indexOf(a.rank) - RANK_ORDER.indexOf(b.rank);
    return mode === 'suit' ? bySuit || byRank : byRank || bySuit;
  });

export function CardFace({ card, style, className = '' }: { card: Card; style?: CSSProperties; className?: string }) {
  const face = card.rank === 'J' || card.rank === 'Q' || card.rank === 'K';
  const bigAce = card.rank === 'A' && card.suit === 'S';
  const color = isRed(card.suit) ? 'var(--red)' : 'var(--ink)';
  return (
    <div className={`card ${className}`} style={{ color, ...style }}>
      <span className="idx">
        <b>{card.rank}</b>
        <i>{SYM[card.suit]}</i>
      </span>
      <span className={`pip${face ? ' pip-face' : ''}${bigAce ? ' pip-ace' : ''}`}>
        {face ? (
          <>
            {card.rank}
            <small>{SYM[card.suit]}</small>
          </>
        ) : (
          SYM[card.suit]
        )}
      </span>
      <span className="idx idx-br">
        <b>{card.rank}</b>
        <i>{SYM[card.suit]}</i>
      </span>
    </div>
  );
}

export function CardBack({ style, className = '' }: { style?: CSSProperties; className?: string }) {
  return (
    <div className={`back ${className}`} style={style}>
      <div className="back-inner" />
    </div>
  );
}

/** Deterministic small tilt from a card id. */
export function tilt(id: string, max = 14) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return ((Math.abs(h) % 1000) / 1000) * 2 * max - max;
}
