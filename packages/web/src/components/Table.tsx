import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isWild, type AckResult, type Card, type ClientView, type RoomState, type Suit } from '@crazy/engine';
import type { EventBatch } from '../App';
import { buzz, send } from '../net';
import { describe, type Tone } from '../describe';
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

  const hand = useMemo(() => sortHand(view.you.hand), [view.you.hand]);
  const byId = (id: string) => hand.find((c) => c.id === id);
  const myTurn = view.turnPlayerId === me && view.status === 'playing';
  const meIdx = players.findIndex((p) => p.id === me);
  const opponents = [...players.slice(meIdx + 1), ...players.slice(0, meIdx)];

  const [sel, setSel] = useState<string[]>([]);
  const [picker, setPicker] = useState<string[] | null>(null);
  const [feed, setFeed] = useState<{ id: number; text: string; tone: Tone }[]>([]);
  const [flash, setFlash] = useState<{ id: number; title: string; sub: string; tone: Tone } | null>(null);
  const [flights, setFlights] = useState<Flight[]>([]);
  const [error, setError] = useState<{ id: number; text: string } | null>(null);
  const [lastPlayer, setLastPlayer] = useState<string | null>(null);
  const cardEls = useRef(new Map<string, HTMLElement>());
  const tapPoints = useRef(new Map<string, { x: number; y: number }>());
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

  // A new game (rematch) starts with an empty table: clear the old feed.
  const prevDiscard = useRef(view.discardCount);
  useEffect(() => {
    if (view.discardCount === 0 && prevDiscard.current > 0) {
      setFeed([]);
      setLastPlayer(null);
      setSel([]);
    }
    prevDiscard.current = view.discardCount;
  }, [view.discardCount]);

  // Turn server events into feed lines, stamps and flying cards.
  // Only events that arrive while this table is open — never ones from an earlier game.
  const seenSeq = useRef(batch.seq);
  useEffect(() => {
    if (batch.seq === seenSeq.current || !batch.events.length) return;
    seenSeq.current = batch.seq;
    const lines: { id: number; text: string; tone: Tone }[] = [];
    const fl: Flight[] = [];
    let stamp: typeof flash = null;
    const pileW = (pileEl('discard') as HTMLElement | null)?.offsetWidth ?? 64;

    for (const e of batch.events) {
      const d = describe(e, nameOf, me);
      if (d) {
        lines.push({ id: ++seq.current, text: d.text, tone: d.tone });
        if (d.flash) stamp = { id: seq.current, ...d.flash };
        if (d.mine) buzz([70, 40, 70]);
      }
      if (e.type === 'played') {
        setLastPlayer(e.playerId);
        const to = center(pileEl('discard'));
        e.cards.forEach((c, i) => {
          const from = (e.playerId === me && tapPoints.current.get(c.id)) || center(seatEl(e.playerId));
          tapPoints.current.delete(c.id);
          if (from && to) {
            fl.push({ id: ++seq.current, card: c, from, to, w: pileW, r0: tilt(c.id, 25), r1: tilt(c.id, 5), delay: i * 90 });
          }
        });
      }
      if (e.type === 'drew' && e.count > 0) {
        const from = center(pileEl('draw'));
        const to = center(seatEl(e.playerId));
        if (from && to) {
          for (let i = 0; i < Math.min(e.count, 6); i++) {
            fl.push({ id: ++seq.current, from, to, w: e.playerId === me ? pileW : 32, r0: 0, r1: tilt(String(i), 12), delay: i * 70 });
          }
        }
      }
    }
    if (lines.length) setFeed((f) => [...lines.reverse(), ...f].slice(0, 3));
    if (stamp) setFlash(stamp);
    if (fl.length) setFlights((f) => [...f, ...fl]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batch.seq]);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 1600);
    return () => clearTimeout(t);
  }, [flash?.id]);

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 2200);
    return () => clearTimeout(t);
  }, [error?.id]);

  const act = async (p: Promise<AckResult>) => {
    const r = await p;
    if (!r.ok) setError({ id: ++seq.current, text: r.error });
  };

  const playIds = (ids: string[], suit?: Suit) => {
    for (const id of ids) {
      const c = center(cardEls.current.get(id));
      if (c) tapPoints.current.set(id, c);
    }
    setSel([]);
    setPicker(null);
    act(send('game:play', { cardIds: ids, suit }));
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
  const pending = view.pendingPenalty;
  const turnName = nameOf(view.turnPlayerId);

  let status: string;
  if (myTurn) {
    if (pending) status = `Your turn — stack or take +${pending}`;
    else if (view.hasDrawn) status = 'Your turn — play or pass';
    else status = 'Your turn';
  } else {
    status = `${turnName}'s turn`;
  }

  const selCards = sel.map(byId).filter(Boolean) as Card[];

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
                onClick={() => act(send('game:draw'))}
              >
                <CardBack className="pile-card" style={{ transform: 'translate(4px,4px)' }} />
                <CardBack className="pile-card" style={{ transform: 'translate(2px,2px)' }} />
                <CardBack className="pile-card" />
              </button>
              <span className="pile-label">{view.drawCount} left</span>
            </div>
            <div className="pile-col">
              <DiscardPile top={view.top} window={win} />
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
        <button className="btn outline act" disabled={!myTurn || (view.hasDrawn && !pending)} onClick={() => act(send('game:draw'))}>
          {pending && myTurn ? `Take +${pending}` : 'Draw'}
        </button>
        <button className="btn outline act" disabled={!myTurn} onClick={() => act(send('game:pass'))}>
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

      <Hand cards={hand} selected={sel} onTap={tap} refs={cardEls} meId={me} dim={view.status !== 'playing'} />

      <FlyLayer flights={flights} onDone={(id) => setFlights((f) => f.filter((x) => x.id !== id))} />

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
