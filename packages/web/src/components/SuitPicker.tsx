import type { Suit } from '@crazy/engine';
import { SUIT_NAME, SYM, isRed } from './Cards';

const ORDER: Suit[] = ['S', 'H', 'C', 'D'];

export function SuitPicker({
  current,
  onPick,
  onCancel,
}: {
  current: Suit | null;
  onPick: (s: Suit) => void;
  onCancel: () => void;
}) {
  return (
    <div className="sheet-backdrop" onClick={onCancel}>
      <div className="sheet" role="dialog" aria-label="Choose a suit" onClick={(e) => e.stopPropagation()}>
        <h3>Call a suit</h3>
        <div className="suit-grid">
          {ORDER.map((s) => (
            <button key={s} className={`suit-btn${isRed(s) ? ' red' : ''}`} onClick={() => onPick(s)}>
              <span className="suit-sym">{SYM[s]}</span>
              <span>{SUIT_NAME[s]}</span>
              {current === s && <em>current</em>}
            </button>
          ))}
        </div>
        <button className="btn ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
