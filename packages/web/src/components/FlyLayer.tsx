import { useLayoutEffect, useRef } from 'react';
import type { Card } from '@crazy/engine';
import { CardBack, CardFace } from './Cards';

export interface Flight {
  id: number;
  card?: Card;
  from: { x: number; y: number };
  to: { x: number; y: number };
  w: number;
  r0: number;
  r1: number;
  delay: number;
  /** Stays at the destination until removed (waiting for the server). */
  hold?: boolean;
}

export function FlyLayer({ flights, onDone }: { flights: Flight[]; onDone: (id: number) => void }) {
  return (
    <div className="fly-layer" aria-hidden="true">
      {flights.map((f) => (
        <FlyItem key={f.id} f={f} onDone={onDone} />
      ))}
    </div>
  );
}

function FlyItem({ f, onDone }: { f: Flight; onDone: (id: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current!;
    const h = f.w * 1.45;
    const at = (p: { x: number; y: number }, r: number, s = 1) =>
      `translate(${p.x - f.w / 2}px, ${p.y - h / 2}px) rotate(${r}deg) scale(${s})`;
    const anim = el.animate(
      [
        { transform: at(f.from, f.r0, 0.9), opacity: 0.95 },
        { transform: at(f.to, f.r1), opacity: 1 },
      ],
      { duration: 340, delay: f.delay, easing: 'cubic-bezier(.2,.8,.25,1)', fill: 'both' },
    );
    anim.onfinish = () => onDone(f.id);
    return () => anim.cancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div ref={ref} className="fly" style={{ width: f.w, height: f.w * 1.45, ['--cw' as string]: `${f.w}px` }}>
      {f.card ? <CardFace card={f.card} /> : <CardBack />}
    </div>
  );
}
