import type { Foul, GameEvent } from '@crazy/engine';
import { SYM, label } from './components/Cards';

export type Tone = 'info' | 'bad' | 'good';
export interface Described {
  text: string;
  tone: Tone;
  /** Big stamp in the middle of the screen. */
  flash?: { title: string; sub: string; tone: Tone };
  /** This event hurts me → vibrate. */
  mine?: boolean;
}

const FOUL_TEXT: Record<Foul, string> = {
  wrong_match: 'wrong card',
  wild_on_wild: 'changed suit twice in a row',
  ignored_penalty: 'dodged a penalty',
  bad_combo: 'bad combo',
  opening_combo: 'combo on an empty table',
  pass_without_draw: 'passed without drawing',
};

export function describe(e: GameEvent, name: (id: string) => string, me: string): Described | null {
  /** "you" in the middle of a sentence, a name otherwise. */
  const obj = (id: string) => (id === me ? 'you' : name(id));
  switch (e.type) {
    case 'played': {
      const who = name(e.playerId);
      if (e.cards.length > 1) return { text: `${who} dropped a combo: ${e.cards.map(label).join(' ')}`, tone: 'info' };
      const c = e.cards[0];
      if (e.chosenSuit) return { text: `${who} played ${label(c)} → calls ${SYM[e.chosenSuit]}`, tone: 'info' };
      return { text: `${who} played ${label(c)}`, tone: 'info' };
    }
    case 'drew': {
      const who = name(e.playerId);
      const mine = e.playerId === me;
      switch (e.reason) {
        case 'draw':
          return { text: `${who} drew a card`, tone: 'info' };
        case 'penalty':
          return { text: `${who} took +${e.count}`, tone: 'bad', mine };
        case 'out_of_turn':
          return {
            text: `${who} +${e.count} — played out of turn`,
            tone: 'bad',
            mine,
            flash: { title: 'OUT OF TURN', sub: `${who} +${e.count}`, tone: 'bad' },
          };
        case 'dodged_penalty':
          return {
            text: `${who} +${e.count} — no dodging a penalty`,
            tone: 'bad',
            mine,
            flash: { title: 'CRAZY!', sub: `${who} +${e.count} — no dodging`, tone: 'bad' },
          };
        // These follow a Crazy / SNAP event that already says it all.
        case 'crazy':
        case 'false_call':
        case 'snap_caught':
        case 'false_snap':
          return mine ? { text: '', tone: 'bad', mine } : null;
      }
      return null;
    }
    case 'passed':
      return { text: `${name(e.playerId)} passed`, tone: 'info' };
    case 'crazy': {
      const caller = name(e.callerId);
      if (!e.correct) {
        return {
          text: `${caller} called Crazy on a good card — +4`,
          tone: 'bad',
          flash: { title: 'WRONG CALL', sub: `${caller} +4`, tone: 'bad' },
        };
      }
      const why = FOUL_TEXT[e.foul!];
      return {
        text: `${caller} caught ${obj(e.targetId)}: ${why} — +4`,
        tone: 'bad',
        flash: { title: 'CRAZY!', sub: `${caller} caught ${obj(e.targetId)} · ${why} · +4`, tone: 'bad' },
      };
    }
    case 'snap': {
      const by = name(e.byId);
      const target = name(e.targetId);
      if (e.outcome === 'safe') {
        const isMe = e.targetId === me;
        return {
          text: `${target} called LAST!`,
          tone: 'good',
          flash: { title: 'LAST CARD', sub: isMe ? "You're on your last card" : `${target} is on the last card`, tone: 'good' },
        };
      }
      if (e.outcome === 'caught') {
        return {
          text: `${by} caught ${obj(e.targetId)} not calling LAST! — +4`,
          tone: 'bad',
          flash: { title: 'CAUGHT!', sub: `${by} caught ${obj(e.targetId)} on the last card · +4`, tone: 'bad' },
        };
      }
      if (e.outcome === 'false') {
        return {
          text: `${by} called LAST! too early — +4`,
          tone: 'bad',
          flash: { title: 'TOO EARLY', sub: `${by} +4`, tone: 'bad' },
        };
      }
      return null;
    }
    case 'removed':
      return { text: `${e.name} was removed by the host`, tone: 'info' };
    case 'reshuffled':
      return { text: 'Played cards shuffled back in', tone: 'info' };
    default:
      return null;
  }
}
