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
        case 'crazy':
          return { text: `${who} +${e.count} — caught!`, tone: 'bad', mine };
        case 'out_of_turn':
          return {
            text: `${who} +${e.count} — out of turn`,
            tone: 'bad',
            mine,
            flash: { title: 'OUT OF TURN', sub: `${who} +${e.count}`, tone: 'bad' },
          };
        case 'dodged_penalty':
          return {
            text: `${who} +${e.count} — no dodging`,
            tone: 'bad',
            mine,
            flash: { title: 'CRAZY!', sub: `${who} +${e.count} — no dodging`, tone: 'bad' },
          };
        case 'false_call':
          return { text: `${who} +${e.count} — wrong call`, tone: 'bad', mine };
        case 'snap_caught':
          return { text: `${who} +${e.count} — snapped`, tone: 'bad', mine };
        case 'false_snap':
          return {
            text: `${who} +${e.count} — false snap`,
            tone: 'bad',
            mine,
            flash: { title: 'FALSE SNAP', sub: `${who} +${e.count}`, tone: 'bad' },
          };
      }
      return null;
    }
    case 'passed':
      return { text: `${name(e.playerId)} passed`, tone: 'info' };
    case 'crazy': {
      const caller = name(e.callerId);
      const target = name(e.targetId);
      return e.correct
        ? {
            text: `${caller} caught ${target}: ${FOUL_TEXT[e.foul!]}`,
            tone: 'bad',
            flash: { title: 'CRAZY!', sub: `${caller} caught ${target} — ${FOUL_TEXT[e.foul!]}`, tone: 'bad' },
          }
        : {
            text: `${caller} called Crazy — wrong!`,
            tone: 'bad',
            flash: { title: 'WRONG CALL', sub: `${caller} +4`, tone: 'bad' },
          };
    }
    case 'snap':
      if (e.outcome === 'safe')
        return {
          text: `${name(e.targetId)} snapped — safe`,
          tone: 'good',
          flash: { title: 'SNAP!', sub: `${name(e.targetId)} is on the last card`, tone: 'good' },
        };
      if (e.outcome === 'caught')
        return {
          text: `${name(e.byId)} snapped ${name(e.targetId)}!`,
          tone: 'bad',
          flash: { title: 'SNAP!', sub: `${name(e.byId)} caught ${name(e.targetId)}`, tone: 'bad' },
        };
      return null;
    case 'reshuffled':
      return { text: 'Played cards shuffled back in', tone: 'info' };
    default:
      return null;
  }
}
