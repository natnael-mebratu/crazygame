import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isWild, type AckResult, type Card, type ClientView, type RoomState, type Suit } from '@crazy/engine';
import type { EventBatch } from '../App';
import { buzz, send } from '../net';
import { describe, type Tone } from '../describe';

interface Stamp {
  id: number;
  title: string;
  sub: string;
  tone: Tone;
}
import { CardBack, SUIT_NAME, SYM, isRed, label, sortHand, tilt } from './Cards';
import { DiscardPile } from './DiscardPile';
import { FlyLayer, type Flight } from './FlyLayer';
import { Hand } from './Hand';
import { Avatar, Seat } from './Seat';
import { SuitPicker } from './SuitPicker';

interface Props {
  room: RoomState;
  view: ClientView;
  batch: EventBatch;
  onLeave: () => void;
}

const center = (el: Element | null | undefined) => {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
};
const seatEl = (id: string) => document.querySelector(`[data-seat="${id}"]`);
const pileEl = (kind: 'draw' | 'discard') => document.querySelector(`[data-pile="${kind}"]`);

export function Table({ room, view, batch, onLeave }: Props) {
  const me = view.you.id;
  const players = view.players;
  const nameOf = useCallback(
    (id: string) => (id === me ? 'You' : players.find((p) => p.id === id)?.name ?? 'Someone'),
    [me, players],
  );
  const isAway = (id: string) => room.players.find((p) => p.id === id)?.connected === false;

  // Cards you just dropped leave your hand at once, before the server answers.
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const hand = useMemo(() => sortHand(view.you.hand).filter((c) => !hidden.has(c.id)), [view.you.hand, hidden]);
  const byId = (id: string) => hand.find((c) => c.id === id);
  const myTurn = view.turnPlayerId === me && view.status === 'playing';
  const pending = view.pendingPenalty;
  const meIdx = players.findIndex((p) => p.id === me);
  const opponents = [...players.slice(meIdx + 1), ...players.slice(0, meIdx)];

  const [sel, setSel] = useState<string[]>([]);
  const [picker, setPicker] = useState<string[] | null>(null);
  const [feed, setFeed] = useState<{ id: number; text: string; tone: Tone }[]>([]);
  // Big stamps play one after another, never on top of each other.
  const [stamps, setStamps] = useState<Stamp[]>([]);
  const pushStamp = (st: Omit<Stamp, 'id'>) => setStamps((q) => [...q.slice(-2), { id: ++seq.current, ...st }]);
  const flash = stamps[0] ?? null;
  const [flights, setFlights] = useState<Flight[]>([]);
  const [error, setError] = useState<{ id: number; text: string } | null>(null);
  const [lastPlayer, setLastPlayer] = useState<string | null>(null);
  const cardEls = useRef(new Map<string, HTMLElement>());
  /** Card ids already flown to the pile locally (no second flight when the server confirms). */
  const flown = useRef(new Set<string>());
  /** Draw flights already shown locally. */
  const drawFlown = useRef(0);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);

  // Drop selected cards that are no longer in hand.
  useEffect(() => {
    setSel((s) => {
      const keep = s.filter((id) => view.you.hand.some((c) => c.id === id));
      return keep.length === s.length ? s : keep;
    });
  }, [view.you.hand]);

  // Buzz when it becomes your turn.
  const prevTurn = useRef(view.turnPlayerId);
  useEffect(() => {
    if (view.turnPlayerId === me && prevTurn.current !== me) buzz(30);
    prevTurn.current = view.turnPlayerId;
  }, [view.turnPlayerId, me]);

  // New game (first open, or a rematch): clean feed and announce who starts.
  const prevDiscard = useRef<number | null>(null);
  useEffect(() => {
    const fresh = view.discardCount === 0 && view.status === 'playing';
    if (fresh && (prevDiscard.current === null || prevDiscard.current > 0)) {
      setFeed([]);
      setLastPlayer(null);
      setSel([]);
      const starter = view.turnPlayerId;
      const first = nameOf(starter).split(' ')[0];
      pushStamp({
        title: starter === me ? 'You start!' : `${first} starts`,
        sub: starter === me ? 'Play any card' : 'Wait for the first card',
        tone: 'good',
      });
      if (starter === me) buzz(30);
    }
    prevDiscard.current = view.discardCount;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.discardCount]);

  // Turn server events into feed lines, stamps and flying cards.
  // Only events that arrive while this table is open — never ones from an earlier game.
  const seenSeq = useRef(batch.seq);
  useEffect(() => {
    if (batch.seq === seenSeq.current || !batch.events.length) return;
    seenSeq.current = batch.seq;
    const lines: { id: number; text: string; tone: Tone }[] = [];
    const fl: Flight[] = [];
    const newStamps: Omit<Stamp, 'id'>[] = [];
    const pileW = (pileEl('discard') as HTMLElement | null)?.offsetWidth ?? 64;

    for (const e of batch.events) {
      const d = describe(e, nameOf, me);
      if (d) {
        if (d.text) lines.push({ id: ++seq.current, text: d.text, tone: d.tone });
        if (d.flash) newStamps.push(d.flash);
        if (d.mine) buzz([70, 40, 70]);
      }
      if (e.type === 'played') {
        setLastPlayer(e.playerId);
        const to = center(pileEl('discard'));
        e.cards.forEach((c, i) => {
          if (flown.current.has(c.id)) return; // already flew when you tapped
          const from = center(seatEl(e.playerId));
          if (from && to) {
            fl.push({ id: ++seq.current, card: c, from, to, w: pileW, r0: tilt(c.id, 25), r1: tilt(c.id, 5), delay: i * 90 });
          }
        });
      }
      if (e.type === 'drew' && e.count > 0) {
        if (e.playerId === me && (e.reason === 'draw' || e.reason === 'penalty') && drawFlown.current > 0) {
          drawFlown.current = 0;
          continue;
        }
        const from = center(pileEl('draw'));
        const to = center(seatEl(e.playerId));
        if (from && to) {
          for (let i = 0; i < Math.min(e.count, 6); i++) {
            const mine = e.playerId === me;
            fl.push({ id: ++seq.current, from, to: mine ? handTarget() ?? to : to, w: mine ? pileW * 0.8 : 32, r0: 0, r1: tilt(String(i), 12), delay: i * 70, fade: mine });
          }
        }
      }
    }
    if (lines.length) setFeed((f) => [...lines.reverse(), ...f].slice(0, 3));
    newStamps.forEach(pushStamp);
    if (fl.length) setFlights((f) => [...f, ...fl]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batch.seq]);

  useEffect(() => {
    if (!flash) return;
    // Shorter when another stamp is waiting, so the table never falls behind.
    const t = setTimeout(() => setStamps((q) => q.slice(1)), stamps.length > 1 ? 1100 : 1700);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flash?.id]);

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 2200);
    return () => clearTimeout(t);
  }, [error?.id]);

  const act = async (p: Promise<AckResult>) => {
    const r = await p;
    if (!r.ok) setError({ id: ++seq.current, text: r.error });
    return r;
  };

  /** Cards drawn by you fly into the top of your hand (not over the buttons). */
  const handTarget = () => {
    const el = seatEl(me);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height * 0.55 };
  };

  const pileW = () => (pileEl('discard') as HTMLElement | null)?.offsetWidth ?? 64;

  /** Drop cards: they fly at once; the server confirms (or they come back). */
  const playIds = async (ids: string[], suit?: Suit) => {
    const t0 = Date.now();
    const to = center(pileEl('discard'));
    const w = pileW();
    const fl: Flight[] = [];
    ids.forEach((id, i) => {
      const c = byId(id);
      const from = center(cardEls.current.get(id));
      flown.current.add(id);
      if (c && from && to) {
        fl.push({ id: ++seq.current, card: c, from, to, w, r0: tilt(c.id, 25), r1: tilt(c.id, 5), delay: i * 90, hold: true });
      }
    });
    setSel([]);
    setPicker(null);
    setHidden((h) => new Set([...h, ...ids]));
    setFlights((f) => [...f, ...fl]);

    await act(send('game:play', { cardIds: ids, suit }));

    // Let the flight finish, then hand back anything the server didn't take.
    const wait = 340 + (ids.length - 1) * 90 - (Date.now() - t0);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    setFlights((f) => f.filter((x) => !fl.some((y) => y.id === x.id)));
    setHidden((h) => {
      const n = new Set(h);
      ids.forEach((id) => n.delete(id));
      return n;
    });
    setTimeout(() => ids.forEach((id) => flown.current.delete(id)), 1500);
  };

  const draw = async () => {
    if (busy) return;
    if (myTurn && (pending > 0 || !view.hasDrawn)) {
      const n = Math.min(pending > 0 ? pending : 1, 6);
      const from = center(pileEl('draw'));
      const to = handTarget();
      if (from && to) {
        const w = pileW() * 0.8;
        setFlights((f) => [
          ...f,
          ...Array.from({ length: n }, (_, i) => ({ id: ++seq.current, from, to, w, r0: 0, r1: tilt(String(i), 12), delay: i * 70, fade: true })),
        ]);
        drawFlown.current = n;
      }
    }
    setBusy(true);
    await act(send('game:draw'));
    setBusy(false);
    setTimeout(() => (drawFlown.current = 0), 1500);
  };

  const pass = async () => {
    if (busy) return;
    setBusy(true);
    await act(send('game:pass'));
    setBusy(false);
  };

  const drop = (ids: string[]) => {
    const lead = byId(ids[0]);
    if (!lead) return;
    if (ids.length === 1 && isWild(lead) && view.discardCount > 0) setPicker(ids);
    else playIds(ids);
  };

  const tap = (c: Card) => {
    if (sel.includes(c.id)) {
      if (c.id === sel[0]) drop(sel);
      else setSel(sel.filter((x) => x !== c.id));
      return;
    }
    const lead = sel.length ? byId(sel[0]) : null;
    setSel(lead?.rank === '7' ? [...sel, c.id] : [c.id]);
  };

  // SNAP goes to whoever is racing on their last card — you first.
  const meView = players.find((p) => p.id === me);
  const iAmOpen = hand.length === 1 && meView?.snap === 'open';
  const openOther = players.find((p) => p.id !== me && p.snap === 'open');
  const snapTarget = iAmOpen ? me : openOther?.id ?? me;
  const snapHot = iAmOpen || !!openOther;

  const win = view.crazyWindow;
  const canCall = !!win && win.playerId !== me;
  const turnName = nameOf(view.turnPlayerId);

  let status: string;
  if (myTurn) {
    if (pending) status = `Your turn — stack or take +${pending}`;
    else if (view.hasDrawn) status = 'Your turn — play or pass';
    else status = 'Your turn';
  } else {
    status = `${turnName}'s turn — wait`;
  }

  const selCards = sel.map(byId).filter(Boolean) as Card[];
  const sameSuitRest = selCards.length ? hand.filter((c) => c.suit === selCards[0].suit && !sel.includes(c.id)) : [];

  // Seats: a band across the top of the table, in turn order from your left.
  const k = opponents.length;
  const compact = k >= 4;
  const zigzag = k >= 6;
  const seatPos = opponents.map((_, i) => {
    if (k === 1) return { x: 50, y: 50 };
    const t = i / (k - 1);
    if (compact) {
      const th = ((160 - t * 140) * Math.PI) / 180;
      return { x: 9 + 82 * t, y: 36 + (1 - Math.sin(th)) * 26 + (zigzag && i % 2 ? 46 : 0) };
    }
    const spread = Math.min(140, 50 * (k - 1));
    const th = ((90 + spread / 2 - t * spread) * Math.PI) / 180;
    return { x: 50 + 38 * Math.cos(th), y: 50 + (1 - Math.sin(th)) * 44 };
  });
  const seatBand = Math.max(...seatPos.map((p) => p.y), 0) + (compact ? 38 : 50);

  return (
    <main className="game">
      <header className="topbar">
        <span className="wordmark">CRAZY</span>
        <div className="topbar-mid">
          <span className="chip outline">Room {room.code}</span>
          <span className="muted small">{players.length} players</span>
        </div>
        <button
          className="link-btn"
          onClick={() => {
            if (view.status !== 'playing' || confirm('Leave this game?')) onLeave();
          }}
        >
          Leave
        </button>
      </header>

      <section className="table-area">
        <div className="felt">
          <div className="felt-line" />
        </div>

        <div className="seats" style={{ height: seatBand }}>
          {opponents.map((p, i) => (
            <Seat
              key={p.id}
              id={p.id}
              name={p.name}
              count={p.cardCount}
              snap={p.snap}
              active={view.turnPlayerId === p.id}
              away={isAway(p.id)}
              compact={compact}
              justPlayed={lastPlayer === p.id && !!win && win.playerId === p.id}
              style={{ left: `${seatPos[i].x}%`, top: seatPos[i].y }}
            />
          ))}
        </div>

        <div className="table-center">
          <div className="piles-row">
            <div className="pile-col">
              <button
                className={`draw-pile${myTurn && (!view.hasDrawn || pending) ? ' ready' : ''}`}
                data-pile="draw"
                aria-label={pending && myTurn ? `Take ${pending} cards` : 'Draw a card'}
                onClick={draw}
              >
                <CardBack className="pile-card" style={{ transform: 'translate(4px,4px)' }} />
                <CardBack className="pile-card" style={{ transform: 'translate(2px,2px)' }} />
                <CardBack className="pile-card" />
              </button>
              <span className="pile-label">{view.drawCount} left</span>
            </div>
            <div className="pile-col">
              <DiscardPile top={view.top} window={win} instant={flown} />
              <span className="pile-label">{view.discardCount ? `${view.discardCount} played` : 'Start here'}</span>
            </div>
          </div>

          <div className="chips">
            {view.activeSuit && (
              <span className={`chip suit${isRed(view.activeSuit) ? ' red' : ''}`}>
                <b>{SYM[view.activeSuit]}</b> {SUIT_NAME[view.activeSuit]}
              </span>
            )}
            <span className="chip outline">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ transform: view.direction === -1 ? 'scaleX(-1)' : undefined }}>
                <path d="M20 12a8 8 0 1 1-2.34-5.66" />
                <path d="M20 4v5h-5" />
              </svg>
              {view.direction === 1 ? 'Clockwise' : 'Reversed'}
            </span>
            {pending > 0 && <span className="chip danger">+{pending} pending</span>}
          </div>

          <div className="feed" aria-live="polite">
            {feed.slice(0, 2).map((l, i) => (
              <div key={l.id} className={`feed-line ${l.tone}${i === 0 ? ' latest' : ''}`}>
                {l.text}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="me-row">
        <div className="me-status">
          <Avatar id={me} name={meView?.name ?? 'Y'} size={30} ring={myTurn ? 'var(--gold)' : undefined} />
          <span className={myTurn ? 'turn-text mine' : 'turn-text'}>{status}</span>
        </div>
        <span className="muted small">
          {hand.length} card{hand.length === 1 ? '' : 's'}
        </span>
      </section>

      <section className="actions">
        <button className="btn outline act" disabled={!myTurn || busy || (view.hasDrawn && !pending)} onClick={draw}>
          {pending && myTurn ? `Take +${pending}` : 'Draw'}
        </button>
        <button className="btn outline act" disabled={!myTurn || busy} onClick={pass}>
          Pass
        </button>
        <button className="btn crazy act" disabled={!canCall} onClick={() => act(send('game:crazy'))}>
          CRAZY!
        </button>
        <button
          className={`btn snap act${snapHot ? ' hot' : ''}`}
          onClick={() => act(send('game:snap', { targetId: snapTarget }))}
        >
          SNAP
        </button>
      </section>

      <div className="sel-bar">
        {selCards.length > 0 ? (
          <>
            <span>
              {selCards.length > 1 ? `Combo: ${selCards.map(label).join(' ')}` : `Tap ${label(selCards[0])} again to drop`}
            </span>
            {selCards[0].rank === '7' && sameSuitRest.length > 0 && (
              <button className="mini-btn" onClick={() => setSel([...sel, ...sameSuitRest.map((c) => c.id)])}>
                + all {SYM[selCards[0].suit]}
              </button>
            )}
            <button className="mini-btn gold" onClick={() => drop(sel)}>
              Drop{selCards.length > 1 ? ` ${selCards.length}` : ''}
            </button>
            <button className="mini-btn" aria-label="Clear selection" onClick={() => setSel([])}>
              ✕
            </button>
          </>
        ) : (
          <span className="muted">{myTurn ? 'Tap a card to pick it' : ' '}</span>
        )}
      </div>

      <Hand cards={hand} selected={sel} onTap={tap} refs={cardEls} meId={me} dim={view.status !== 'playing'} waiting={!myTurn} />

      <FlyLayer flights={flights} onDone={(id) => setFlights((f) => f.filter((x) => x.id !== id || x.hold))} />

      {flash && (
        <div key={flash.id} className={`stamp ${flash.tone}`} role="status">
          <strong>{flash.title}</strong>
          <span>{flash.sub}</span>
        </div>
      )}

      {error && (
        <div key={error.id} className="toast" role="alert">
          {error.text}
        </div>
      )}

      {picker && (
        <SuitPicker current={view.activeSuit} onPick={(s) => playIds(picker, s)} onCancel={() => setPicker(null)} />
      )}

      {view.status === 'finished' && view.winner && (
        <WinOverlay winner={nameOf(view.winner)} isMe={view.winner === me} isHost={room.hostId === me} onLeave={onLeave} />
      )}
    </main>
  );
}

function WinOverlay({ winner, isMe, isHost, onLeave }: { winner: string; isMe: boolean; isHost: boolean; onLeave: () => void }) {
  const [error, setError] = useState('');
  return (
    <div className="sheet-backdrop">
      <div className="sheet win">
        <div className="win-cards" aria-hidden="true">♠ ♥ ♣ ♦</div>
        <h2>{isMe ? 'You win!' : `${winner} wins!`}</h2>
        <p className="muted">{isMe ? 'Every card gone. Respect.' : 'Better luck next round.'}</p>
        {isHost ? (
          <button
            className="btn gold"
            onClick={async () => {
              const r = await send('room:start');
              if (!r.ok) setError(r.error);
            }}
          >
            Play again
          </button>
        ) : (
          <p className="waiting">Waiting for the host to deal again…</p>
        )}
        <button className="btn ghost" onClick={onLeave}>
          Leave
        </button>
        {error && <p className="error">{error}</p>}
      </div>
    </div>
  );
}
