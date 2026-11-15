import { useEffect, useRef, useState } from 'react';
import type { Card, ClientView } from '@crazy/engine';
import { CardFace, tilt } from './Cards';

/** Matches the fly-in animation so the new top card appears as it lands. */
export const LAND_MS = 340;

export function DiscardPile({ top, window: win }: { top: Card | null; window: ClientView['crazyWindow'] }) {
  const [shown, setShown] = useState<Card | null>(top);
  const [under, setUnder] = useState<Card[]>([]);
  const shownRef = useRef(shown);
  shownRef.current = shown;

  useEffect(() => {
    if (top?.id === shownRef.current?.id) return;
    const t = setTimeout(() => {
      const prev = shownRef.current;
      setUnder((u) => {
        // A caught card is taken back: drop it instead of burying it.
        if (top && u.some((c) => c.id === top.id)) return u.filter((c) => c.id !== top.id);
        return prev ? [...u, prev].slice(-2) : u;
      });
      setShown(top);
    }, LAND_MS);
    return () => clearTimeout(t);
  }, [top?.id]);

  return (
    <div className="discard" data-pile="discard">
      {under.map((c) => (
        <CardFace key={c.id} card={c} className="pile-card under" style={{ transform: `rotate(${tilt(c.id)}deg)` }} />
      ))}
      {shown ? (
        <CardFace key={shown.id} card={shown} className="pile-card top land" style={{ transform: `rotate(${tilt(shown.id, 5)}deg)` }} />
      ) : (
        <div className="pile-empty">Empty table</div>
      )}
      {win && <Countdown key={win.moveId} remainingMs={win.remainingMs} totalMs={win.totalMs} />}
    </div>
  );
}

function Countdown({ remainingMs, totalMs }: { remainingMs: number; totalMs: number }) {
  const [deadline] = useState(() => Date.now() + remainingMs);
  const [left, setLeft] = useState(remainingMs);
  useEffect(() => {
    const id = setInterval(() => setLeft(Math.max(0, deadline - Date.now())), 100);
    return () => clearInterval(id);
  }, [deadline]);
  if (left <= 0) return null;
  const C = 88;
  return (
    <div className="countdown" aria-label={`${Math.ceil(left / 1000)} seconds to call Crazy`}>
      <svg width="34" height="34" viewBox="0 0 34 34" aria-hidden="true">
        <circle cx="17" cy="17" r="14" className="cd-track" />
        <circle
          cx="17"
          cy="17"
          r="14"
          className="cd-bar"
          strokeDasharray={C}
          strokeDashoffset={C * (1 - left / totalMs)}
          transform="rotate(-90 17 17)"
        />
      </svg>
      <span>{Math.ceil(left / 1000)}s</span>
    </div>
  );
}
