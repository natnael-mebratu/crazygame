import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isWild, type AckResult, type Card, type ClientView, type RoomState, type Suit } from '@crazy/engine';
import type { EventBatch } from '../App';
import { buzz, send } from '../net';
import { describe, type Tone } from '../describe';
import { CardBack, SUIT_NAME, SYM, isRed, label, sortHand, tilt, type SortMode } from './Cards';
import { DiscardPile } from './DiscardPile';
import { FlyLayer, type Flight } from './FlyLayer';
import { Hand } from './Hand';
import { Avatar, Seat } from './Seat';

interface Stamp {
  id: number;
  title: string;
  sub: string;
  tone: Tone;
}

const SUITS: Suit[] = ['S', 'H', 'C', 'D'];

function loadSort(): SortMode {
  try {
    return localStorage.getItem('crazy.sort') === 'number' ? 'number' : 'suit';
  } catch {
    return 'suit';
  }
}

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
  const [sortMode, setSortMode] = useState<SortMode>(loadSort);
  const hand = useMemo(
    () => sortHand(view.you.hand, sortMode).filter((c) => !hidden.has(c.id)),
    [view.you.hand, hidden, sortMode],
  );
  const toggleSort = () => {
    const next: SortMode = sortMode === 'suit' ? 'number' : 'suit';
    setSortMode(next);
    try {
      localStorage.setItem('crazy.sort', next);
    } catch {
      /* ignore */
    }
  };
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
  const [showRecent, setShowRecent] = useState(false);
  /** Cards that just arrived in your hand glow for a moment. */
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const prevHand = useRef<Set<string> | null>(null);
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

  // Mark newly drawn cards (not the opening deal).
  useEffect(() => {
    const ids = new Set(view.you.hand.map((c) => c.id));
    const before = prevHand.current;
    prevHand.current = ids;
    if (!before || view.discardCount === 0) return;
    const added = [...ids].filter((id) => !before.has(id));
    if (!added.length) return;
    setFresh(new Set(added));
    const t = setTimeout(() => setFresh(new Set()), 2600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    if (ids.length === 1 && isWild(lead) && view.discardCount > 0) {
      setSel(ids);
      setPicker(ids);
    } else playIds(ids);
  };

  const tap = (c: Card) => {
    setPicker(null);
    if (sel.includes(c.id)) {
      if (c.id === sel[0]) drop(sel);
      else setSel(sel.filter((x) => x !== c.id));
      return;
    }
    const lead = sel.length ? byId(sel[0]) : null;
    setSel(lead?.rank === '7' ? [...sel, c.id] : [c.id]);
  };

  /** Flick a card up: drop it — or the whole combo if it's part of one. */
  const swipe = (c: Card) => {
    setPicker(null);
    if (sel.length > 1 && sel.includes(c.id)) drop(sel);
    else drop([c.id]);
  };

  /** Tap anywhere off your cards: put lifted cards back down. */
  const clearSel = () => {
    if (sel.length || picker) {
      setSel([]);
      setPicker(null);
    }
  };

  const removePlayer = async (id: string) => {
    if (!confirm(`Remove ${nameOf(id)} from the game? Their cards go back into the deck.`)) return;
    await act(send('room:remove', { playerId: id }));
  };

  // LAST! goes to whoever is racing on their last card — you first.
  const meView = players.find((p) => p.id === me);
  const iAmOpen = hand.length === 1 && meView?.snap === 'open';
  const openOther = players.find((p) => p.id !== me && p.snap === 'open');
  const snapTarget = iAmOpen ? me : openOther?.id ?? me;
  const snapHot = iAmOpen || !!openOther;

  const win = view.crazyWindow;
  const canCall = !!win && win.playerId !== me;
  // What CRAZY! would be calling on.
  let callTarget = '';
  if (canCall && win) {
    const who = nameOf(win.playerId).split(' ')[0];
    const lastPlay = view.recent[view.recent.length - 1];
    if (win.kind === 'pass') callTarget = `${who}'s pass`;
    else if (lastPlay && lastPlay.playerId === win.playerId)
      callTarget = lastPlay.cards.length > 1 ? `${who}'s combo` : `${who} · ${label(lastPlay.cards[0])}`;
    else callTarget = who;
  }
  const isHost = room.hostId === me;
  const suitCounts = Object.fromEntries(SUITS.map((st) => [st, hand.filter((c) => c.suit === st).length])) as Record<Suit, number>;
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

      <section className="table-area" onClick={clearSel}>
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
              onRemove={isHost && isAway(p.id) && view.status === 'playing' ? () => removePlayer(p.id) : undefined}
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
            <button
              className="pile-col pile-btn"
              aria-label="Show the last cards played"
              disabled={!view.recent.length}
              onClick={(e) => {
                e.stopPropagation();
                setShowRecent((v) => !v);
              }}
            >
              <DiscardPile top={view.top} window={win} instant={flown} />
              <span className="pile-label">
                {view.discardCount ? `${view.discardCount} played · tap` : 'Start here'}
              </span>
            </button>
          </div>

          <div className="chips">
            {view.activeSuit && (
              <span className={`chip suit${isRed(view.activeSuit) ? ' red' : ''}`}>
                <b>{SYM[view.activeSuit]}</b> {SUIT_NAME[view.activeSuit]}
                {view.suitCalledBy && (
                  <em className="called-by">· called by {view.suitCalledBy === me ? 'you' : nameOf(view.suitCalledBy).split(' ')[0]}</em>
                )}
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

          {showRecent && (
            <div className="recent" role="dialog" aria-label="Last cards played" onClick={() => setShowRecent(false)}>
              <div className="recent-title">Last plays</div>
              {[...view.recent].reverse().map((r, i) => (
                <div key={i} className="recent-row">
                  <span className="recent-name">{nameOf(r.playerId).split(' ')[0]}</span>
                  <span className="recent-cards">
                    {r.cards.map((c) => (
                      <span key={c.id} className={`mini-chip${isRed(c.suit) ? ' red' : ''}`}>
                        {label(c)}
                      </span>
                    ))}
                  </span>
                  {r.chosenSuit && <span className={`recent-call${isRed(r.chosenSuit) ? ' red' : ''}`}>→ {SYM[r.chosenSuit]}</span>}
                </div>
              ))}
            </div>
          )}

          <div className="feed" aria-live="polite">
            {feed.slice(0, 2).map((l, i) => (
              <div key={l.id} className={`feed-line ${l.tone}${i === 0 ? ' latest' : ''}`}>
                {l.text}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="me-row" onClick={clearSel}>
        <div className="me-status">
          <Avatar id={me} name={meView?.name ?? 'Y'} size={30} ring={myTurn ? 'var(--gold)' : undefined} />
          <span className={myTurn ? 'turn-text mine' : 'turn-text'}>{status}</span>
        </div>
        <div className="me-right">
          <button className="mini-btn sort-btn" onClick={toggleSort} aria-label={`Sorted by ${sortMode}. Change sorting`}>
            {sortMode === 'suit' ? '♠♥ by suit' : '1–K by number'}
          </button>
          <span className="muted small">
            {hand.length} card{hand.length === 1 ? '' : 's'}
          </span>
        </div>
      </section>

      <section className="actions">
        <button className="btn outline act" disabled={!myTurn || busy || (view.hasDrawn && !pending)} onClick={draw}>
          {pending && myTurn ? `Take +${pending}` : 'Draw'}
        </button>
        <button
          className={`btn outline act${myTurn && view.hasDrawn && !pending ? ' nudge' : ''}`}
          disabled={!myTurn || busy}
          onClick={pass}
        >
          Pass
        </button>
        <button className="btn crazy act two-line" disabled={!canCall} onClick={() => act(send('game:crazy'))}>
          <span>CRAZY!</span>
          {callTarget && <small>on {callTarget}</small>}
        </button>
        <button
          className={`btn snap act${snapHot ? ' hot' : ''}`}
          onClick={() => act(send('game:snap', { targetId: snapTarget }))}
        >
          LAST!
        </button>
      </section>

      <div className="sel-bar">
        {picker ? (
          <div className="suit-bar" role="group" aria-label="Call a suit">
            <span className="suit-bar-label">Call:</span>
            {SUITS.map((st) => (
              <button
                key={st}
                className={`suit-chip${isRed(st) ? ' red' : ''}${view.activeSuit === st ? ' current' : ''}`}
                onClick={() => playIds(picker, st)}
                aria-label={`${SUIT_NAME[st]}, you hold ${suitCounts[st]}`}
              >
                <b>{SYM[st]}</b>
                <span>{suitCounts[st]}</span>
              </button>
            ))}
            <button className="mini-btn" aria-label="Cancel" onClick={() => { setPicker(null); setSel([]); }}>
              ✕
            </button>
          </div>
        ) : selCards.length > 0 ? (
          <>
            <span className="sel-text">
              {selCards.length > 1
                ? `Combo ${label(selCards[0])} +${selCards.length - 1} · ${label(selCards[selCards.length - 1])} on top`
                : `Tap again or swipe up to drop ${label(selCards[0])}`}
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
          <span className="muted">{myTurn ? 'Tap a card to pick it — or swipe it up' : ' '}</span>
        )}
      </div>

      <Hand
        cards={hand}
        selected={sel}
        onTap={tap}
        onSwipe={swipe}
        refs={cardEls}
        meId={me}
        dim={view.status !== 'playing'}
        waiting={!myTurn}
        fresh={fresh}
      />

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
