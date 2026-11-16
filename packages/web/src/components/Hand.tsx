import { useLayoutEffect, useRef, useState, type MutableRefObject } from 'react';
import type { Card } from '@crazy/engine';
import { CardFace, spoken } from './Cards';

interface Props {
  cards: Card[];
  selected: string[];
  onTap: (c: Card) => void;
  /** Card id → its element, so a played card can fly from where it was. */
  refs: MutableRefObject<Map<string, HTMLElement>>;
  meId: string;
  dim: boolean;
  /** Not your turn: slightly dimmed (cards still work). */
  waiting?: boolean;
}

export function Hand({ cards, selected, onTap, refs, meId, dim, waiting }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(360);

  useLayoutEffect(() => {
    const el = box.current!;
    setW(el.clientWidth);
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const n = cards.length;
  // Fit both narrow and short phones (e.g. iPhone SE).
  const cw = Math.round(Math.max(48, Math.min(74, w * 0.175, window.innerHeight * 0.082)));
  const ch = cw * 1.45;
  const fan = n <= 12;
  // Tilted edge cards swing outward; keep room for that on both sides.
  const side = fan ? cw * 0.4 : 10;
  const minStep = cw * 0.38;
  let step = n > 1 ? Math.min(cw * 0.7, (w - 2 * side - cw) / (n - 1)) : 0;
  const scroll = step < minStep;
  if (scroll) step = minStep;
  const total = step * (n - 1) + cw;
  const start = scroll ? 10 : (w - total) / 2;
  const lift = Math.round(cw * 0.32);
  const arcK = fan ? Math.min(1.6, 14 / Math.max(n, 1)) : 0;
  const maxD = (n - 1) / 2;
  // Room above for a lifted card, below for the deepest point of the fan.
  const top0 = lift + 6;
  const boxH = Math.ceil(top0 + maxD * maxD * arcK + ch + 10);

  return (
    <div
      ref={box}
      className={`hand${scroll ? ' scroll' : ''}${dim ? ' dim' : ''}${waiting ? ' waiting' : ''}`}
      data-seat={meId}
      style={{ height: boxH }}
    >
      <div className="hand-inner" style={{ width: scroll ? total + 20 : '100%', height: boxH }}>
        {cards.map((c, i) => {
          const d = i - (n - 1) / 2;
          const picked = selected.includes(c.id);
          const rot = fan ? d * Math.min(4, 24 / Math.max(n, 1)) : 0;
          const arc = d * d * arcK;
          return (
            <button
              key={c.id}
              ref={(el) => {
                if (el) refs.current.set(c.id, el);
                else refs.current.delete(c.id);
              }}
              className={`hand-card${picked ? ' picked' : ''}`}
              data-card-id={c.id}
              aria-label={spoken(c)}
              aria-pressed={picked}
              onClick={() => onTap(c)}
              style={{
                left: start + i * step,
                top: top0 + arc - (picked ? lift : 0),
                transform: `rotate(${rot}deg)`,
                width: cw,
                height: ch,
                zIndex: i + 1,
                ['--cw' as string]: `${cw}px`,
              }}
            >
              <CardFace card={c} />
            </button>
          );
        })}
      </div>
    </div>
  );
}
