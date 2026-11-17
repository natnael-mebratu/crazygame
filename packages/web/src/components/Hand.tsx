import { useLayoutEffect, useRef, useState, type MutableRefObject } from 'react';
import type { Card } from '@crazy/engine';
import { CardFace, spoken } from './Cards';

interface Props {
  cards: Card[];
  selected: string[];
  onTap: (c: Card) => void;
  /** Flicked upward: drop it (or the combo it leads). */
  onSwipe: (c: Card) => void;
  /** Card id → its element, so a played card can fly from where it was. */
  refs: MutableRefObject<Map<string, HTMLElement>>;
  meId: string;
  dim: boolean;
  /** Not your turn: slightly dimmed (cards still work). */
  waiting?: boolean;
  /** Just drawn: glow for a moment so you can find them. */
  fresh: Set<string>;
}

/** Above this many cards the hand splits into two rows instead of one long fan. */
const TWO_ROWS_FROM = 13;
const SWIPE_PX = 34;

export function Hand({ cards, selected, onTap, onSwipe, refs, meId, dim, waiting, fresh }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(360);
  const gesture = useRef<{ id: string; x: number; y: number; swiped: boolean } | null>(null);

  useLayoutEffect(() => {
    const el = box.current!;
    setW(el.clientWidth);
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const n = cards.length;
  const twoRows = n >= TWO_ROWS_FROM;
  // Fit both narrow and short phones (e.g. iPhone SE).
  const cw = Math.round(Math.max(48, Math.min(74, w * 0.175, window.innerHeight * (twoRows ? 0.068 : 0.082))));
  const ch = cw * 1.45;
  const lift = Math.round(cw * 0.32);
  const top0 = lift + 6;

  // Rows: one fanned row, or two flat rows (top row shows its upper half).
  const rows: Card[][] = twoRows ? [cards.slice(0, Math.ceil(n / 2)), cards.slice(Math.ceil(n / 2))] : [cards];
  const rowGap = Math.round(ch * 0.5);
  const fan = !twoRows;

  type Placed = { c: Card; left: number; top: number; rot: number; z: number };
  const placed: Placed[] = [];
  let innerW = w;
  let scroll = false;
  let deepest = 0;
  rows.forEach((row, r) => {
    const m = row.length;
    const side = fan ? cw * 0.4 : 10;
    const minStep = cw * 0.38;
    let step = m > 1 ? Math.min(cw * 0.7, (w - 2 * side - cw) / (m - 1)) : 0;
    if (step < minStep) {
      step = minStep;
      scroll = true;
    }
    const total = step * (m - 1) + cw;
    innerW = Math.max(innerW, total + 20);
    const start = total + 20 > w ? 10 : (w - total) / 2;
    const arcK = fan ? Math.min(1.6, 14 / Math.max(m, 1)) : 0;
    row.forEach((c, i) => {
      const d = i - (m - 1) / 2;
      const arc = d * d * arcK;
      deepest = Math.max(deepest, arc);
      placed.push({
        c,
        left: start + i * step,
        top: top0 + r * rowGap + arc,
        rot: fan ? d * Math.min(4, 24 / Math.max(m, 1)) : 0,
        z: r * 100 + i + 1,
      });
    });
  });
  const boxH = Math.ceil(top0 + (rows.length - 1) * rowGap + deepest + ch + 10);

  return (
    <div
      ref={box}
      className={`hand${scroll ? ' scroll' : ''}${dim ? ' dim' : ''}${waiting ? ' waiting' : ''}`}
      data-seat={meId}
      style={{ height: boxH }}
    >
      <div className="hand-inner" style={{ width: scroll ? innerW : '100%', height: boxH }}>
        {placed.map(({ c, left, top, rot, z }) => {
          const picked = selected.includes(c.id);
          return (
            <button
              key={c.id}
              ref={(el) => {
                if (el) refs.current.set(c.id, el);
                else refs.current.delete(c.id);
              }}
              className={`hand-card${picked ? ' picked' : ''}${fresh.has(c.id) ? ' fresh' : ''}`}
              data-card-id={c.id}
              aria-label={spoken(c)}
              aria-pressed={picked}
              onPointerDown={(e) => {
                gesture.current = { id: c.id, x: e.clientX, y: e.clientY, swiped: false };
              }}
              onPointerMove={(e) => {
                const g = gesture.current;
                if (!g || g.id !== c.id || g.swiped) return;
                if (g.y - e.clientY > SWIPE_PX && Math.abs(e.clientX - g.x) < SWIPE_PX * 1.4) {
                  g.swiped = true;
                  onSwipe(c);
                }
              }}
              onClick={() => {
                // A swipe already dropped it; don't also treat it as a tap.
                if (gesture.current?.swiped && gesture.current.id === c.id) {
                  gesture.current = null;
                  return;
                }
                gesture.current = null;
                onTap(c);
              }}
              style={{
                left,
                top: top - (picked ? lift : 0),
                transform: `rotate(${rot}deg)`,
                width: cw,
                height: ch,
                zIndex: z,
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
