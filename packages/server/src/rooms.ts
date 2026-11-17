import { randomBytes } from 'node:crypto';
import type { Server, Socket } from 'socket.io';

interface Rig {
  hands?: string[][];
  top?: string | null;
  active?: Suit;
  turn?: number;
  pending?: number;
}
import {
  CrazyGame,
  GameError,
  SUITS,
  type AckResult,
  type Card,
  type ClientToServerEvents,
  type ClientView,
  type GameEvent,
  type RoomState,
  type ServerToClientEvents,
  type Suit,
} from '@crazy/engine';

type IO = Server<ClientToServerEvents, ServerToClientEvents>;
type Sock = Socket<ClientToServerEvents, ServerToClientEvents>;
interface SockData {
  code?: string;
  memberId?: string;
}

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_PLAYERS = 8;
/** A disconnected player's turn is auto-played (draw + pass) after this. */
const AFK_MS = 15_000;
/** Rooms with nobody connected are deleted after this. */
const EMPTY_ROOM_MS = 15 * 60_000;

const randomId = (bytes: number) => randomBytes(bytes).toString('hex');

function cleanName(raw: unknown): string {
  const name = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim().slice(0, 16) : '';
  if (!name) throw new GameError('Enter your name');
  return name;
}

interface Member {
  id: string;
  name: string;
  token: string;
  socket: Sock | null;
}

class Room {
  members: Member[] = [];
  hostId = '';
  status: RoomState['status'] = 'lobby';
  game: CrazyGame | null = null;
  emptySince: number | null = null;
  private windowTimer?: NodeJS.Timeout;
  private afkTimer?: NodeJS.Timeout;

  constructor(readonly code: string) {}

  join(name: string): Member {
    if (this.status !== 'lobby') throw new GameError('That game already started');
    if (this.members.length >= MAX_PLAYERS) throw new GameError('Room is full (8 players)');
    if (this.members.some((m) => m.name.toLowerCase() === name.toLowerCase())) {
      throw new GameError('Someone in the room already has that name');
    }
    const m: Member = { id: randomId(4), name, token: randomId(16), socket: null };
    this.members.push(m);
    if (!this.hostId) this.hostId = m.id;
    return m;
  }

  attach(m: Member, socket: Sock) {
    if (m.socket && m.socket.id !== socket.id) {
      (m.socket.data as SockData) = {};
      m.socket.disconnect(true);
    }
    m.socket = socket;
    (socket.data as SockData) = { code: this.code, memberId: m.id };
    this.emptySince = null;
  }

  detach(socket: Sock) {
    const m = this.members.find((x) => x.socket?.id === socket.id);
    if (!m) return;
    m.socket = null;
    if (!this.members.some((x) => x.socket)) this.emptySince = Date.now();
    this.sync([]);
  }

  /** Host removes a player: anyone in the lobby, only away players during a game. */
  remove(byId: string, targetId: string) {
    if (byId !== this.hostId) throw new GameError('Only the host can remove players');
    if (byId === targetId) throw new GameError("You can't remove yourself — use Leave");
    const m = this.members.find((x) => x.id === targetId);
    if (!m) throw new GameError('That player already left');
    const inGame = this.status === 'playing' && this.game?.state.players.some((p) => p.id === targetId);
    if (inGame && m.socket) throw new GameError(`${m.name} is still here — you can only remove players who left`);
    if (m.socket) {
      m.socket.emit('room:removed');
      (m.socket.data as SockData) = {};
      m.socket = null;
    }
    this.members = this.members.filter((x) => x !== m);
    if (inGame) {
      this.act((g) => g.removePlayer(targetId));
    } else {
      this.sync([]);
    }
  }

  leave(m: Member) {
    if (m.socket) (m.socket.data as SockData) = {};
    m.socket = null;
    if (this.status === 'lobby' || !this.game) {
      this.members = this.members.filter((x) => x !== m);
    }
    if (this.hostId === m.id) {
      this.hostId = (this.members.find((x) => x.socket && x !== m) ?? this.members.find((x) => x !== m))?.id ?? '';
    }
    if (!this.members.some((x) => x.socket)) this.emptySince = Date.now();
    this.sync([]);
  }

  start(byId: string) {
    if (byId !== this.hostId) throw new GameError('Only the host can start');
    if (this.status === 'playing') throw new GameError('Game already running');
    // Players who dropped out of the lobby / last game don't get dealt in.
    this.members = this.members.filter((m) => m.socket);
    if (this.members.length < 2) throw new GameError('Need at least 2 players');
    this.game = new CrazyGame(this.members.map((m) => ({ id: m.id, name: m.name })));
    this.status = 'playing';
    this.after([]);
  }

  act(fn: (g: CrazyGame, now: number) => GameEvent[]) {
    if (!this.game || this.status !== 'playing') throw new GameError('No game running');
    this.after(fn(this.game, Date.now()));
  }

  private after(events: GameEvent[]) {
    if (this.game?.state.status === 'finished') this.status = 'finished';
    this.sync(events);
    this.schedule();
  }

  /** Close the Crazy window on time; auto-play for a disconnected current player. */
  private schedule() {
    clearTimeout(this.windowTimer);
    clearTimeout(this.afkTimer);
    const g = this.game;
    if (!g || this.status !== 'playing') return;

    const closesAt = g.windowClosesAt();
    if (closesAt !== null) {
      const wait = Math.max(0, closesAt - Date.now()) + 15;
      this.windowTimer = setTimeout(() => this.after(g.tick(Date.now())), wait);
    }
    const cur = this.members.find((x) => x.id === g.current.id);
    if (cur && !cur.socket) {
      this.afkTimer = setTimeout(() => this.autoMove(cur.id), AFK_MS);
    }
  }

  private autoMove(id: string) {
    const g = this.game;
    if (!g || this.status !== 'playing' || g.current.id !== id) return;
    try {
      const now = Date.now();
      const ev: GameEvent[] = [];
      if (g.state.pendingPenalty > 0) ev.push(...g.draw(id, now));
      if (!g.state.hasDrawn) ev.push(...g.draw(id, now));
      ev.push(...g.pass(id, now));
      this.after(ev);
    } catch (e) {
      console.error('auto-move failed', e);
    }
  }

  sync(events: GameEvent[]) {
    for (const m of this.members) {
      if (!m.socket) continue;
      m.socket.emit('room:state', this.roomState(m.id));
      if (this.game && this.game.state.players.some((p) => p.id === m.id)) {
        m.socket.emit('game:update', { view: this.clientView(m.id), events });
      }
    }
  }

  roomState(youId: string): RoomState {
    return {
      code: this.code,
      status: this.status,
      youId,
      hostId: this.hostId,
      players: this.members.map((m) => ({
        id: m.id,
        name: m.name,
        connected: !!m.socket,
        isHost: m.id === this.hostId,
      })),
    };
  }

  private clientView(id: string): ClientView {
    const g = this.game!;
    const v = g.viewFor(id);
    const w = v.crazyWindow;
    return {
      ...v,
      crazyWindow: w
        ? {
            moveId: w.moveId,
            kind: w.kind,
            playerId: w.playerId,
            remainingMs: w.closesAt === null ? null : Math.max(0, w.closesAt - Date.now()),
            totalMs: w.closesAt === null ? null : g.state.config.finalCardWindowMs,
          }
        : null,
    };
  }

  /** Test-only (CRAZY_DEBUG=1): set hands by seat, top card, whose turn, pending penalty. */
  rig(a: Rig) {
    const g = this.game;
    if (!g) throw new GameError('No game');
    let n = 0;
    const mk = (l: string) => ({ id: `${l}~rig${n++}`, suit: l.slice(-1) as Suit, rank: l.slice(0, -1) as Card['rank'] });
    const st = g.state;
    a.hands?.forEach((h, i) => {
      if (st.players[i]) st.players[i].hand = h.map(mk);
    });
    if (a.top !== undefined) {
      st.discard = a.top ? [mk(a.top)] : [];
      st.activeSuit = a.top ? (a.active ?? (a.top.slice(-1) as Suit)) : null;
    }
    if (a.turn !== undefined) st.turn = a.turn;
    st.pendingPenalty = a.pending ?? 0;
    st.wildCooldown = false;
    st.hasDrawn = false;
    st.lastMove = null;
    st.recent = [];
    st.suitCalledBy = null;
    st.snap = {};
    for (const p of st.players) if (p.hand.length === 1) st.snap[p.id] = 'open';
    this.after([]);
  }

  dispose() {
    clearTimeout(this.windowTimer);
    clearTimeout(this.afkTimer);
  }
}

export class RoomManager {
  private rooms = new Map<string, Room>();

  constructor(private io: IO) {}

  listen() {
    this.io.on('connection', (s) => this.bind(s));
    setInterval(() => this.cleanup(), 60_000).unref();
  }

  private newCode(): string {
    for (;;) {
      let code = '';
      for (let i = 0; i < 4; i++) code += CODE_CHARS[randomBytes(1)[0] % CODE_CHARS.length];
      if (!this.rooms.has(code)) return code;
    }
  }

  private cleanup() {
    const now = Date.now();
    for (const [code, room] of this.rooms) {
      if (room.emptySince && now - room.emptySince > EMPTY_ROOM_MS) {
        room.dispose();
        this.rooms.delete(code);
      }
    }
  }

  private bind(sock: Sock) {
    const ctx = () => {
      const d = sock.data as SockData;
      const room = d.code ? this.rooms.get(d.code) : undefined;
      const m = room?.members.find((x) => x.id === d.memberId);
      if (!room || !m) throw new GameError('You are not in a room');
      return { room, m };
    };

    const handle = <T extends object>(ack: unknown, fn: () => T | void) => {
      let res: AckResult<T>;
      try {
        res = { ok: true, ...((fn() ?? {}) as T) };
      } catch (e) {
        if (!(e instanceof GameError)) console.error(e);
        res = { ok: false, error: e instanceof GameError ? e.message : 'Something went wrong' };
      }
      if (typeof ack === 'function') ack(res);
    };

    const leaveCurrent = () => {
      const d = sock.data as SockData;
      const room = d.code ? this.rooms.get(d.code) : undefined;
      room?.detach(sock);
      (sock.data as SockData) = {};
    };

    const session = (room: Room, m: Member) => ({ session: { code: room.code, playerId: m.id, token: m.token } });

    sock.on('room:create', (a, ack) =>
      handle(ack, () => {
        const name = cleanName(a?.name);
        leaveCurrent();
        const room = new Room(this.newCode());
        this.rooms.set(room.code, room);
        const m = room.join(name);
        room.attach(m, sock);
        room.sync([]);
        return session(room, m);
      }),
    );

    sock.on('room:join', (a, ack) =>
      handle(ack, () => {
        const name = cleanName(a?.name);
        const code = String(a?.code ?? '').trim().toUpperCase();
        const room = this.rooms.get(code);
        if (!room) throw new GameError(`No room with code ${code || '—'}`);
        leaveCurrent();
        const m = room.join(name);
        room.attach(m, sock);
        room.sync([]);
        return session(room, m);
      }),
    );

    sock.on('room:resume', (a, ack) =>
      handle(ack, () => {
        const room = this.rooms.get(String(a?.code ?? '').toUpperCase());
        const m = room?.members.find((x) => x.token === a?.token);
        if (!room || !m) throw new GameError('That game is gone');
        room.attach(m, sock);
        room.sync([]);
        return session(room, m);
      }),
    );

    sock.on('room:leave', (ack) =>
      handle(ack, () => {
        const { room, m } = ctx();
        room.leave(m);
      }),
    );

    sock.on('room:remove', (a, ack) =>
      handle(ack, () => {
        const { room, m } = ctx();
        room.remove(m.id, String(a?.playerId ?? ''));
      }),
    );

    sock.on('room:start', (ack) =>
      handle(ack, () => {
        const { room, m } = ctx();
        room.start(m.id);
      }),
    );

    sock.on('game:play', (a, ack) =>
      handle(ack, () => {
        const { room, m } = ctx();
        const ids = a?.cardIds;
        if (!Array.isArray(ids) || ids.length === 0 || ids.length > 60 || !ids.every((x) => typeof x === 'string')) {
          throw new GameError('Bad cards');
        }
        const suit = a?.suit;
        if (suit !== undefined && !SUITS.includes(suit as Suit)) throw new GameError('Bad suit');
        room.act((g, now) => g.play(m.id, ids, suit, now));
      }),
    );

    sock.on('game:draw', (ack) => handle(ack, () => { const { room, m } = ctx(); room.act((g, now) => g.draw(m.id, now)); }));
    sock.on('game:pass', (ack) => handle(ack, () => { const { room, m } = ctx(); room.act((g, now) => g.pass(m.id, now)); }));
    sock.on('game:crazy', (ack) => handle(ack, () => { const { room, m } = ctx(); room.act((g, now) => g.callCrazy(m.id, now)); }));
    sock.on('game:snap', (a, ack) =>
      handle(ack, () => {
        const { room, m } = ctx();
        room.act((g, now) => g.snap(m.id, String(a?.targetId ?? ''), now));
      }),
    );

    // Test-only: rig hands/table to reach specific situations. Off unless CRAZY_DEBUG=1.
    if (process.env.CRAZY_DEBUG === '1') {
      (sock as unknown as Socket).on('debug:rig', (a: Rig, ack: unknown) =>
        handle(ack, () => {
          const { room } = ctx();
          room.rig(a);
        }),
      );
    }

    sock.on('disconnect', () => {
      const d = sock.data as SockData;
      if (d.code) this.rooms.get(d.code)?.detach(sock);
    });
  }
}
