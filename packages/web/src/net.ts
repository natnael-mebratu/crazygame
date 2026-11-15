import { io, type Socket } from 'socket.io-client';
import type { AckResult, ClientToServerEvents, ServerToClientEvents, Session } from '@crazy/engine';

export const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io({
  transports: ['websocket', 'polling'],
  reconnectionDelay: 400,
  reconnectionDelayMax: 3000,
});

type Events = ClientToServerEvents;
type ArgsOf<E extends keyof Events> = Parameters<Events[E]> extends [...infer A, infer _Ack] ? A : never;
type ResultOf<E extends keyof Events> = Parameters<Events[E]> extends [...unknown[], (r: infer R) => void] ? R : never;

/** Emit with an ack, as a promise. Never rejects. */
export function send<E extends keyof Events>(event: E, ...args: ArgsOf<E>): Promise<ResultOf<E>> {
  return new Promise((resolve) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (socket.timeout(8000) as any).emit(event, ...args, (err: unknown, res: AckResult) => {
      resolve((err ? { ok: false, error: 'Connection problem — try again' } : res) as ResultOf<E>);
    });
  });
}

const KEY = 'crazy.session';
const NAME_KEY = 'crazy.name';

export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}
export function saveSession(s: Session) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* private mode */
  }
}
export function clearSession() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
export function loadName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}
export function saveName(n: string) {
  try {
    localStorage.setItem(NAME_KEY, n);
  } catch {
    /* ignore */
  }
}

export function buzz(pattern: number | number[]) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* unsupported */
  }
}
