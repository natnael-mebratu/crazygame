import type { CSSProperties } from 'react';
import type { SnapStatus } from '@crazy/engine';
import { CardBack } from './Cards';

const COLORS = ['#6B3FA0', '#1F6F8B', '#A0522D', '#2E7D4F', '#8B2F5B', '#3D5A99', '#7A6A1F', '#2F7F7A'];

export function colorFor(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return COLORS[Math.abs(h) % COLORS.length];
}

export function Avatar({ id, name, size = 40, ring }: { id: string; name: string; size?: number; ring?: string }) {
  return (
    <span
      className="avatar"
      aria-hidden="true"
      style={{ width: size, height: size, fontSize: size * 0.4, background: colorFor(id), borderColor: ring }}
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

export interface SeatProps {
  id: string;
  name: string;
  count: number;
  snap: SnapStatus | null;
  active: boolean;
  away: boolean;
  justPlayed: boolean;
  /** Many players: avatar + name + count badge, no fan. */
  compact?: boolean;
  /** Host only, for players who left: take them out of the game. */
  onRemove?: () => void;
  style: CSSProperties;
}

export function Seat({ id, name, count, snap, active, away, justPlayed, compact, onRemove, style }: SeatProps) {
  const removeBtn = onRemove && (
    <button
      className="seat-remove"
      onClick={(e) => {
        e.stopPropagation();
        onRemove();
      }}
    >
      Remove
    </button>
  );
  if (compact) {
    const last = count === 1;
    return (
      <div
        className={`seat compact${active ? ' active' : ''}${away ? ' away' : ''}${last && snap === 'open' ? ' racing' : ''}`}
        style={style}
        data-seat={id}
      >
        <div className="seat-av">
          <Avatar id={id} name={name} size={34} />
          <span className={`badge${last ? (snap === 'safe' ? ' safe' : ' last') : ''}`}>{count}</span>
        </div>
        <span className="seat-name">{away ? `${name} · away` : name}</span>
        {removeBtn}
        {justPlayed && <span className="seat-ping" />}
      </div>
    );
  }
  const shown = Math.min(count, 8);
  const spread = shown > 1 ? Math.min(9, 44 / (shown - 1)) : 0;
  const width = 26 + spread * (shown - 1);
  return (
    <div className={`seat${active ? ' active' : ''}${away ? ' away' : ''}`} style={style} data-seat={id}>
      <div className="seat-head">
        <Avatar id={id} name={name} size={38} />
        <div className="seat-meta">
          <span className="seat-name">{name}</span>
          {count === 1 ? (
            <span className={`pill last${snap === 'safe' ? ' safe' : ''}`}>{snap === 'safe' ? '1 · SAFE' : '1 CARD'}</span>
          ) : (
            <span className="seat-count">{away ? 'away' : `${count} cards`}</span>
          )}
        </div>
      </div>
      <div className={`seat-fan${count === 1 && snap === 'open' ? ' glow' : ''}`} style={{ width, height: 38 }}>
        {Array.from({ length: shown }, (_, i) => (
          <CardBack
            key={i}
            className="mini"
            style={{ left: i * spread, transform: `rotate(${(i - (shown - 1) / 2) * 4}deg)` }}
          />
        ))}
      </div>
      {removeBtn}
      {justPlayed && <span className="seat-ping" />}
    </div>
  );
}
