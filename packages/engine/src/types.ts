/** H = Hearts, C = Clubs ("flower"), S = Spades ("spear"), D = Diamonds */
export type Suit = 'H' | 'C' | 'S' | 'D';
export type Rank = 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K';

export interface Card {
  /** Unique across all decks in play, e.g. "7H#0". */
  id: string;
  suit: Suit;
  rank: Rank;
}

/** Rule breaks that other players can catch with "Crazy!". */
export type Foul =
  | 'wrong_match' // card matches neither the active suit nor the top rank
  | 'wild_on_wild' // 8/J changed the suit right after another 8/J changed it
  | 'ignored_penalty' // (auto-caught) didn't stack or take a pending 2 / A♠ penalty
  | 'bad_combo' // multi-card drop that isn't a 7 + cards of the same suit
  | 'opening_combo' // combo used to open on an empty table
  | 'pass_without_draw'; // passed without drawing 1 first

export type DrawReason =
  | 'draw' // normal draw-1
  | 'penalty' // took a pending 2 / A♠ stack
  | 'crazy' // caught by a correct Crazy call
  | 'out_of_turn' // auto-penalty from the system
  | 'dodged_penalty' // auto: tried to skip a pending 2 / A♠ — owed + 4
  | 'false_call' // called Crazy on a legal move
  | 'snap_caught' // someone snapped you before you did
  | 'false_snap'; // snapped someone who doesn't have exactly 1 card

export type SnapStatus = 'open' | 'safe';

export interface PlayerState {
  id: string;
  name: string;
  hand: Card[];
}

/** What a Crazy call rewinds. */
export interface MoveUndo {
  activeSuit: Suit | null;
  direction: 1 | -1;
  turn: number;
  pendingPenalty: number;
  wildCooldown: boolean;
  hasDrawn: boolean;
  suitCalledBy: string | null;
}

export interface LastMove {
  id: number;
  playerId: string;
  kind: 'play' | 'pass';
  at: number;
  /** Server-only. Never sent to clients. */
  foul: Foul | null;
  cards: Card[];
  undo: MoveUndo;
  /** The player emptied their hand; they win when the Crazy window closes. */
  winnerPending: boolean;
}

export interface RecentPlay {
  playerId: string;
  cards: Card[];
  chosenSuit?: Suit;
}

export interface GameConfig {
  /** null = open until the next move. */
  crazyWindowMs: number | null;
  finalCardWindowMs: number;
  penalty: number;
}

export interface GameState {
  config: GameConfig;
  players: PlayerState[];
  drawPile: Card[];
  /** Played cards; the last element is the top of the pile. */
  discard: Card[];
  activeSuit: Suit | null;
  direction: 1 | -1;
  /** Index into players of whose turn it is. */
  turn: number;
  /** Cards the current player must take (or stack on). 0 = none. */
  pendingPenalty: number;
  /** A live wild was just played; another wild right now is a foul. */
  wildCooldown: boolean;
  /** The current player already drew their 1 card this turn. */
  hasDrawn: boolean;
  /** The move that can currently be called Crazy on, if its window is open. */
  lastMove: LastMove | null;
  moveSeq: number;
  /** Who called the current suit with an 8 / J (null if it wasn't called). */
  suitCalledBy: string | null;
  /** The last few plays, oldest first. */
  recent: RecentPlay[];
  /** Players currently on 1 card and whether they've snapped. */
  snap: Record<string, SnapStatus>;
  status: 'playing' | 'finished';
  winner: string | null;
}

export type GameEvent =
  | { type: 'played'; playerId: string; cards: Card[]; chosenSuit?: Suit }
  | { type: 'drew'; playerId: string; count: number; reason: DrawReason }
  | { type: 'passed'; playerId: string }
  | { type: 'crazy'; callerId: string; targetId: string; correct: boolean; foul?: Foul }
  | { type: 'snap'; byId: string; targetId: string; outcome: 'safe' | 'caught' | 'false' | 'late' }
  | { type: 'reshuffled' }
  | { type: 'turn'; playerId: string }
  | { type: 'won'; playerId: string }
  | { type: 'removed'; playerId: string; name: string };

/** What one player is allowed to see. */
export interface PlayerView {
  you: { id: string; hand: Card[] };
  players: { id: string; name: string; cardCount: number; snap: SnapStatus | null }[];
  top: Card | null;
  discardCount: number;
  drawCount: number;
  activeSuit: Suit | null;
  direction: 1 | -1;
  turnPlayerId: string;
  pendingPenalty: number;
  wildCooldown: boolean;
  hasDrawn: boolean;
  /** closesAt null = open until the next move. */
  crazyWindow: { moveId: number; playerId: string; kind: 'play' | 'pass'; closesAt: number | null } | null;
  suitCalledBy: string | null;
  recent: RecentPlay[];
  status: 'playing' | 'finished';
  winner: string | null;
}
