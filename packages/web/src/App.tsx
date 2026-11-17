import { useEffect, useState } from 'react';
import type { ClientView, GameEvent, RoomState } from '@crazy/engine';
import { clearSession, loadSession, send, socket } from './net';
import { Home } from './components/Home';
import { Lobby } from './components/Lobby';
import { Table } from './components/Table';

export interface EventBatch {
  seq: number;
  events: GameEvent[];
}

export function App() {
  const [room, setRoom] = useState<RoomState | null>(null);
  const [view, setView] = useState<ClientView | null>(null);
  const [batch, setBatch] = useState<EventBatch>({ seq: 0, events: [] });
  const [online, setOnline] = useState(socket.connected);
  const [resuming, setResuming] = useState(() => !!loadSession());
  const [notice, setNotice] = useState('');

  useEffect(() => {
    const onConnect = async () => {
      setOnline(true);
      const s = loadSession();
      if (!s) return setResuming(false);
      const r = await send('room:resume', { code: s.code, token: s.token });
      if (!r.ok) {
        clearSession();
        setRoom(null);
        setView(null);
      }
      setResuming(false);
    };
    const onDisconnect = () => setOnline(false);
    const onRoom = (r: RoomState) => {
      setRoom(r);
      if (r.status === 'lobby') setView(null);
    };
    const onUpdate = ({ view, events }: { view: ClientView | null; events: GameEvent[] }) => {
      // Your own view only — used by the automated browser test.
      (window as unknown as { __crazyView?: ClientView | null }).__crazyView = view;
      setView(view);
      if (events.length) setBatch((b) => ({ seq: b.seq + 1, events }));
    };

    const onRemoved = () => {
      clearSession();
      setRoom(null);
      setView(null);
      setNotice('The host removed you from the room.');
    };

    socket.on('connect', onConnect);
    socket.on('room:removed', onRemoved);
    socket.on('disconnect', onDisconnect);
    socket.on('room:state', onRoom);
    socket.on('game:update', onUpdate);
    if (socket.connected) onConnect();
    return () => {
      socket.off('connect', onConnect);
      socket.off('room:removed', onRemoved);
      socket.off('disconnect', onDisconnect);
      socket.off('room:state', onRoom);
      socket.off('game:update', onUpdate);
    };
  }, []);

  const leave = async () => {
    await send('room:leave');
    clearSession();
    setRoom(null);
    setView(null);
  };

  let screen;
  if (!room) screen = resuming ? <div className="splash">CRAZY</div> : <Home notice={notice} />;
  else if (room.status === 'lobby' || !view) screen = <Lobby room={room} onLeave={leave} />;
  else screen = <Table room={room} view={view} batch={batch} onLeave={leave} />;

  return (
    <>
      {screen}
      {!online && !resuming && <div className="offline">Reconnecting…</div>}
    </>
  );
}
