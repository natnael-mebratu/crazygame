import type { GameEvent, PlayerView, Suit } from './types';

/** Messages between the phone app and the server. */

export interface LobbyPlayer {
  id: string;
  name: string;
  connected: boolean;
  isHost: boolean;
}

export interface RoomState {
  code: string;
  status: 'lobby' | 'playing' | 'finished';
  players: LobbyPlayer[];
  youId: string;
  hostId: string;
}

/** The engine's view, with the Crazy window as time remaining (no clock skew). */
export interface ClientView extends Omit<PlayerView, 'crazyWindow'> {
  crazyWindow: { moveId: number; playerId: string; remainingMs: number; totalMs: number } | null;
}

export interface Session {
  code: string;
  playerId: string;
  token: string;
}

export type AckResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };
export type Ack<T = object> = (r: AckResult<T>) => void;

export interface ClientToServerEvents {
  'room:create': (a: { name: string }, ack: Ack<{ session: Session }>) => void;
  'room:join': (a: { code: string; name: string }, ack: Ack<{ session: Session }>) => void;
  'room:resume': (a: { code: string; token: string }, ack: Ack<{ session: Session }>) => void;
  'room:leave': (ack: Ack) => void;
  /** Host only. Starts the first game, or a rematch. */
  'room:start': (ack: Ack) => void;
  'game:play': (a: { cardIds: string[]; suit?: Suit }, ack: Ack) => void;
  'game:draw': (ack: Ack) => void;
  'game:pass': (ack: Ack) => void;
  'game:crazy': (ack: Ack) => void;
  'game:snap': (a: { targetId: string }, ack: Ack) => void;
}

export interface ServerToClientEvents {
  'room:state': (s: RoomState) => void;
  'game:update': (u: { view: ClientView | null; events: GameEvent[] }) => void;
}
