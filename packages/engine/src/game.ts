import { createDeck, decksForPlayers, isAceOfSpades, isWild, MAX_PLAYERS, MIN_PLAYERS, shuffle } from './cards';
import type {
  Card,
  DrawReason,
  Foul,
  GameEvent,
  GameState,
  MoveUndo,
  PlayerState,
  PlayerView,
  Suit,
} from './types';

/** A request that can't happen at all (bad card id, game over…). Not a foul. */
export class GameError extends Error {}

export interface GameOptions {
  rng?: () => number;
  /** Index of the player who starts (gets 7 cards). Random if omitted. */
  starterIndex?: number;
  /** How long after a move players can call Crazy on it. Default 4000ms. */
  crazyWindowMs?: number;
  /** Cards drawn for a foul. Default 4. */
  penalty?: number;
}

/**
 * The authoritative Crazy game. Runs on the server; clients only ever
 * see `viewFor(playerId)` and the returned events.
 *
 * Philosophy: moves are never blocked for being illegal. They are recorded
 * with their foul (if any) and only punished if another player calls Crazy
 * before the window closes. The one exception is playing out of turn, which
 * the system catches instantly.
 */
export class CrazyGame {
  state: GameState;
  private rng: () => number;

  constructor(players: { id: string; name: string }[], opts: GameOptions = {}) {
    if (players.length < MIN_PLAYERS || players.length > MAX_PLAYERS) {
      throw new GameError(`Crazy needs ${MIN_PLAYERS}–${MAX_PLAYERS} players`);
    }
    if (new Set(players.map((p) => p.id)).size !== players.length) {
      throw new GameError('Player ids must be unique');
    }
    this.rng = opts.rng ?? Math.random;
    const starter = opts.starterIndex ?? Math.floor(this.rng() * players.length);
    const deck = shuffle(createDeck(decksForPlayers(players.length)), this.rng);
    const dealt: PlayerState[] = players.map((p, i) => ({
      id: p.id,
      name: p.name,
      hand: deck.splice(0, i === starter ? 7 : 6),
    }));

    this.state = {
      config: { crazyWindowMs: opts.crazyWindowMs ?? 4000, penalty: opts.penalty ?? 4 },
      players: dealt,
      drawPile: deck,
      discard: [],
      activeSuit: null,
      direction: 1,
      turn: starter,
      pendingPenalty: 0,
      wildCooldown: false,
      hasDrawn: false,
      lastMove: null,
      moveSeq: 0,
      snap: {},
      status: 'playing',
      winner: null,
    };
  }

  // ───────────────────────────── actions ─────────────────────────────

  /**
   * Drop one card, or a 7-combo (7 first, then same-suit cards).
   * `chosenSuit` is the suit called with an 8 / J.
   */
  play(playerId: string, cardIds: string[], chosenSuit?: Suit, now = Date.now()): GameEvent[] {
    const ev: GameEvent[] = [];
    this.tick(now, ev);
    this.ensurePlaying();
    const s = this.state;
    const p = this.player(playerId);
    if (cardIds.length === 0) throw new GameError('Play at least one card');
    if (new Set(cardIds).size !== cardIds.length) throw new GameError('Duplicate card');
    const cards = cardIds.map((id) => {
      const card = p.hand.find((c) => c.id === id);
      if (!card) throw new GameError(`You don't hold ${id}`);
      return card;
    });

    // Out of turn: caught by the system. The card never hits the table;
    // others only learn that this player took +4.
    if (this.current.id !== playerId) {
      this.give(p, s.config.penalty, 'out_of_turn', ev);
      return ev;
    }

    // Dodging a pending 2 / A♠: also caught by the system. Card stays in
    // hand, you take what you owed + 4, then you still play your turn.
    if (s.pendingPenalty > 0 && this.evaluatePlay(cards, chosenSuit) !== null) {
      this.dodgedPenalty(p, ev);
      return ev;
    }

    this.closeWindow(ev);
    if (s.status === 'finished') return ev;

    const opening = s.discard.length === 0;
    const foul = this.evaluatePlay(cards, chosenSuit, opening);
    const undo = this.snapshot();

    const played = new Set(cardIds);
    p.hand = p.hand.filter((c) => !played.has(c.id));
    s.discard.push(...cards);

    const liveWild = !opening && cards.length === 1 && isWild(cards[0]);
    ev.push({
      type: 'played',
      playerId,
      cards,
      ...(liveWild ? { chosenSuit: chosenSuit ?? cards[0].suit } : {}),
    });
    this.applyEffects(cards, chosenSuit, opening);

    s.lastMove = {
      id: ++s.moveSeq,
      playerId,
      kind: 'play',
      at: now,
      foul,
      cards,
      undo,
      winnerPending: p.hand.length === 0,
    };
    this.syncSnap(p);
    ev.push({ type: 'turn', playerId: this.current.id });
    return ev;
  }

  /**
   * With a pending penalty: take all of it, then carry on with a normal turn.
   * Otherwise: draw your 1 card (once per turn).
   */
  draw(playerId: string, now = Date.now()): GameEvent[] {
    const ev: GameEvent[] = [];
    this.tick(now, ev);
    this.ensurePlaying();
    const s = this.state;
    const p = this.player(playerId);
    if (this.current.id !== playerId) throw new GameError('Not your turn');
    if (s.pendingPenalty === 0 && s.hasDrawn) throw new GameError('You already drew this turn');

    this.closeWindow(ev);
    if (s.status === 'finished') return ev;

    if (s.pendingPenalty > 0) {
      const owed = s.pendingPenalty;
      s.pendingPenalty = 0;
      this.give(p, owed, 'penalty', ev);
      s.hasDrawn = false;
    } else {
      this.give(p, 1, 'draw', ev);
      s.hasDrawn = true;
    }
    return ev;
  }

  /** End your turn without playing. Legal only after drawing 1. */
  pass(playerId: string, now = Date.now()): GameEvent[] {
    const ev: GameEvent[] = [];
    this.tick(now, ev);
    this.ensurePlaying();
    const s = this.state;
    if (this.current.id !== playerId) throw new GameError('Not your turn');
    if (s.pendingPenalty > 0) {
      this.dodgedPenalty(this.player(playerId), ev);
      return ev;
    }

    this.closeWindow(ev);
    if (s.status === 'finished') return ev;

    const foul: Foul | null = !s.hasDrawn ? 'pass_without_draw' : null;
    const undo = this.snapshot();

    s.pendingPenalty = 0;
    s.hasDrawn = false;
    this.advance(1);
    s.lastMove = { id: ++s.moveSeq, playerId, kind: 'pass', at: now, foul, cards: [], undo, winnerPending: false };
    ev.push({ type: 'passed', playerId }, { type: 'turn', playerId: this.current.id });
    return ev;
  }

  /**
   * Call Crazy on the last move. Right call: the move is undone, the
   * offender takes +4 (plus any penalty they dodged) and loses their turn.
   * Wrong call: the caller takes +4.
   */
  callCrazy(callerId: string, now = Date.now()): GameEvent[] {
    const ev: GameEvent[] = [];
    this.tick(now, ev);
    this.ensurePlaying();
    const s = this.state;
    const caller = this.player(callerId);
    const m = s.lastMove;
    if (!m) throw new GameError('Nothing to call');
    if (m.playerId === callerId) throw new GameError("You can't call Crazy on yourself");

    if (!m.foul) {
      ev.push({ type: 'crazy', callerId, targetId: m.playerId, correct: false });
      this.give(caller, s.config.penalty, 'false_call', ev);
      return ev;
    }

    const offender = this.player(m.playerId);
    const ids = new Set(m.cards.map((c) => c.id));
    s.discard = s.discard.filter((c) => !ids.has(c.id));
    offender.hand.push(...m.cards);
    Object.assign(s, m.undo);
    s.lastMove = null;
    ev.push({ type: 'crazy', callerId, targetId: m.playerId, correct: true, foul: m.foul });

    this.give(offender, s.config.penalty, 'crazy', ev);

    s.hasDrawn = false;
    s.turn = this.indexOf(offender.id);
    this.advance(1);
    ev.push({ type: 'turn', playerId: this.current.id });
    return ev;
  }

  /**
   * The last-card race. When someone is down to 1 card, everyone races to
   * hit SNAP on them. If they hit it first they're safe; if anyone else does,
   * they take +4. Snapping someone without exactly 1 card costs you +4.
   */
  snap(byId: string, targetId: string, now = Date.now()): GameEvent[] {
    const ev: GameEvent[] = [];
    this.tick(now, ev);
    this.ensurePlaying();
    const s = this.state;
    const by = this.player(byId);
    const target = this.player(targetId);

    if (target.hand.length !== 1) {
      ev.push({ type: 'snap', byId, targetId, outcome: 'false' });
      this.give(by, s.config.penalty, 'false_snap', ev);
      return ev;
    }
    if (s.snap[targetId] !== 'open') {
      ev.push({ type: 'snap', byId, targetId, outcome: 'late' });
      return ev;
    }
    if (byId === targetId) {
      s.snap[targetId] = 'safe';
      ev.push({ type: 'snap', byId, targetId, outcome: 'safe' });
    } else {
      ev.push({ type: 'snap', byId, targetId, outcome: 'caught' });
      this.give(target, s.config.penalty, 'snap_caught', ev);
    }
    return ev;
  }

  /** Call from a server timer so the Crazy window (and a pending win) closes on time. */
  tick(now = Date.now(), ev: GameEvent[] = []): GameEvent[] {
    const m = this.state.lastMove;
    if (m && now - m.at >= this.state.config.crazyWindowMs) this.closeWindow(ev);
    return ev;
  }

  // ───────────────────────────── views ─────────────────────────────

  viewFor(playerId: string): PlayerView {
    const s = this.state;
    const me = this.player(playerId);
    const m = s.lastMove;
    return {
      you: { id: me.id, hand: [...me.hand] },
      players: s.players.map((p) => ({
        id: p.id,
        name: p.name,
        cardCount: p.hand.length,
        snap: s.snap[p.id] ?? null,
      })),
      top: s.discard.at(-1) ?? null,
      discardCount: s.discard.length,
      drawCount: s.drawPile.length,
      activeSuit: s.activeSuit,
      direction: s.direction,
      turnPlayerId: this.current.id,
      pendingPenalty: s.pendingPenalty,
      wildCooldown: s.wildCooldown,
      hasDrawn: s.hasDrawn,
      crazyWindow: m ? { moveId: m.id, playerId: m.playerId, closesAt: m.at + s.config.crazyWindowMs } : null,
      status: s.status,
      winner: s.winner,
    };
  }

  get current(): PlayerState {
    return this.state.players[this.state.turn];
  }

  // ───────────────────────────── rules ─────────────────────────────

  /** Is this drop legal? Returns the foul, or null. Never throws. */
  evaluatePlay(
    cards: Card[],
    chosenSuit?: Suit,
    opening = this.state.discard.length === 0,
  ): Foul | null {
    const s = this.state;
    const lead = cards[0];
    const combo = cards.length > 1;

    if (combo) {
      if (opening) return 'opening_combo';
      if (lead.rank !== '7' || cards.some((c) => c.suit !== lead.suit)) return 'bad_combo';
    }
    // Any single card may open; specials just have no power.
    if (opening) return null;

    const top = s.discard[s.discard.length - 1];
    if (s.pendingPenalty > 0) {
      if (combo) return 'ignored_penalty';
      const stacks2 = lead.rank === '2' && top.rank === '2';
      const aceOn2Spade = isAceOfSpades(lead) && top.rank === '2' && top.suit === 'S';
      return stacks2 || aceOn2Spade ? null : 'ignored_penalty';
    }
    const matches = lead.suit === s.activeSuit || lead.rank === top.rank;
    if (!combo && isWild(lead)) {
      if (!s.wildCooldown) return null;
      // Right after a wild: an 8/J may drop as a plain card, but can't change the suit.
      if (this.changesSuit(chosenSuit)) return 'wild_on_wild';
      return matches ? null : 'wrong_match';
    }
    return matches ? null : 'wrong_match';
  }

  private changesSuit(chosenSuit?: Suit) {
    return chosenSuit !== undefined && chosenSuit !== this.state.activeSuit;
  }

  /** Auto-caught: card stays in hand, take what you owed + 4, keep your turn. */
  private dodgedPenalty(p: PlayerState, ev: GameEvent[]) {
    const s = this.state;
    const owed = s.pendingPenalty;
    s.pendingPenalty = 0;
    s.hasDrawn = false;
    this.give(p, owed + s.config.penalty, 'dodged_penalty', ev);
  }

  private applyEffects(cards: Card[], chosenSuit: Suit | undefined, opening: boolean) {
    const s = this.state;
    const lead = cards[0];
    const last = cards[cards.length - 1];
    s.hasDrawn = false;

    // Opening card or 7-combo: no powers at all.
    if (opening || cards.length > 1) {
      s.activeSuit = last.suit;
      s.pendingPenalty = 0;
      s.wildCooldown = false;
      this.advance(1);
      return;
    }

    if (lead.rank === '2') s.pendingPenalty += 2;
    else if (isAceOfSpades(lead)) s.pendingPenalty += 5;
    else s.pendingPenalty = 0;

    if (isWild(lead) && s.wildCooldown && !this.changesSuit(chosenSuit)) {
      // Dead wild: suit stays, counts as the normal play in between.
      s.wildCooldown = false;
    } else if (isWild(lead)) {
      s.activeSuit = chosenSuit ?? lead.suit;
      s.wildCooldown = true;
    } else {
      s.activeSuit = lead.suit;
      s.wildCooldown = false;
    }

    if (lead.rank === '5') {
      this.advance(2);
    } else if (lead.rank === '7') {
      s.direction = s.direction === 1 ? -1 : 1;
      this.advance(1);
    } else {
      this.advance(1);
    }
  }

  // ───────────────────────────── helpers ─────────────────────────────

  private closeWindow(ev: GameEvent[]) {
    const s = this.state;
    const m = s.lastMove;
    s.lastMove = null;
    if (m?.winnerPending) {
      s.status = 'finished';
      s.winner = m.playerId;
      ev.push({ type: 'won', playerId: m.playerId });
    }
  }

  private give(p: PlayerState, count: number, reason: DrawReason, ev: GameEvent[]) {
    const s = this.state;
    let drawn = 0;
    for (let i = 0; i < count; i++) {
      if (s.drawPile.length === 0 && !this.reshuffle(ev)) break;
      p.hand.push(s.drawPile.pop()!);
      drawn++;
    }
    ev.push({ type: 'drew', playerId: p.id, count: drawn, reason });
    this.syncSnap(p);
  }

  /** Keep the top card (plus any cards a Crazy call might still return), shuffle the rest in. */
  private reshuffle(ev: GameEvent[]): boolean {
    const s = this.state;
    const keep = Math.max(1, (s.lastMove?.cards.length ?? 0) + 1);
    if (s.discard.length <= keep) return false;
    s.drawPile = shuffle(s.discard.splice(0, s.discard.length - keep), this.rng);
    ev.push({ type: 'reshuffled' });
    return true;
  }

  private syncSnap(p: PlayerState) {
    if (p.hand.length === 1) {
      if (!(p.id in this.state.snap)) this.state.snap[p.id] = 'open';
    } else {
      delete this.state.snap[p.id];
    }
  }

  private snapshot(): MoveUndo {
    const { activeSuit, direction, turn, pendingPenalty, wildCooldown, hasDrawn } = this.state;
    return { activeSuit, direction, turn, pendingPenalty, wildCooldown, hasDrawn };
  }

  private advance(steps: number) {
    const s = this.state;
    const n = s.players.length;
    s.turn = (((s.turn + s.direction * steps) % n) + n) % n;
  }

  private player(id: string): PlayerState {
    const p = this.state.players.find((x) => x.id === id);
    if (!p) throw new GameError(`Unknown player ${id}`);
    return p;
  }

  private indexOf(id: string): number {
    return this.state.players.findIndex((x) => x.id === id);
  }

  private ensurePlaying() {
    if (this.state.status !== 'playing') throw new GameError('The game is over');
  }
}
