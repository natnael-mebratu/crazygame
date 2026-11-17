import { useState } from 'react';
import type { RoomState } from '@crazy/engine';
import { send } from '../net';
import { Avatar } from './Seat';

export function Lobby({ room, onLeave }: { room: RoomState; onLeave: () => void }) {
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const isHost = room.youId === room.hostId;
  const online = room.players.filter((p) => p.connected).length;
  const link = `${location.origin}/?room=${room.code}`;

  const share = async () => {
    const text = `Join my Crazy game! Room ${room.code}`;
    try {
      if (navigator.share) return await navigator.share({ title: 'Crazy', text, url: link });
    } catch {
      return;
    }
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setError(link);
    }
  };

  const start = async () => {
    setError('');
    const r = await send('room:start');
    if (!r.ok) setError(r.error);
  };

  return (
    <main className="lobby">
      <header className="topbar">
        <span className="wordmark">CRAZY</span>
        <button className="link-btn" onClick={onLeave}>
          Leave
        </button>
      </header>

      <section className="room-code">
        <span className="muted">Room code</span>
        <div className="code-tiles">
          {room.code.split('').map((ch, i) => (
            <span key={i}>{ch}</span>
          ))}
        </div>
        <button className="btn outline small" onClick={share}>
          {copied ? 'Link copied!' : 'Invite friends'}
        </button>
      </section>

      <section className="panel">
        <h2 className="panel-title">
          Players <span className="muted">{room.players.length}/8</span>
        </h2>
        <ul className="player-list">
          {room.players.map((p) => (
            <li key={p.id} className={p.connected ? '' : 'away'}>
              <Avatar id={p.id} name={p.name} size={36} />
              <span className="pl-name">
                {p.name}
                {p.id === room.youId && <em> (you)</em>}
              </span>
              {p.isHost && <span className="chip">Host</span>}
              {!p.connected && <span className="chip dim">Away</span>}
              {isHost && p.id !== room.youId && (
                <button
                  className="mini-btn"
                  onClick={async () => {
                    if (!confirm(`Remove ${p.name} from the room?`)) return;
                    const r = await send('room:remove', { playerId: p.id });
                    if (!r.ok) setError(r.error);
                  }}
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>

      <div className="lobby-actions">
        {isHost ? (
          <button className="btn gold" disabled={online < 2} onClick={start}>
            {online < 2 ? 'Waiting for players…' : `Deal cards (${online} players)`}
          </button>
        ) : (
          <p className="waiting">Waiting for the host to deal…</p>
        )}
        {error && <p className="error">{error}</p>}
      </div>

      <details className="rules">
        <summary>How to play</summary>
        <ul>
          <li>Match the suit or the number. 6 cards each — the starter gets 7.</li>
          <li><b>2</b> → next draws 2 (stacks). <b>A♠</b> → draws 5, can go on 2♠.</li>
          <li><b>5</b> skips. <b>7</b> reverses. <b>7 + same suit</b> → drop them all together.</li>
          <li><b>8 / J</b> change the suit — not twice in a row.</li>
          <li>Can't play? Draw 1, then play or pass.</li>
          <li>Catch a mistake → hit <b>CRAZY!</b> (+4 to them). Wrong call → +4 to you.</li>
          <li>One card left? Hit <b>LAST!</b> before anyone else does — if they beat you, +4.</li>
        </ul>
      </details>
    </main>
  );
}
