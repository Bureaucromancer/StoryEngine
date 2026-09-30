// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import { newActor, type OutputMessage, type Turn } from '@storyengine/shared';
import type { ParticipantPolicy } from '@storyengine/sdk';

import { Rng } from '../rng/rng.js';
import { channelKey } from '../sessions/channels.js';
import { SE_PRESENCE, SE_STATUS } from '../sessions/cast.js';

import type { CastMember } from './cast.js';
import {
  activationText,
  chatSoFar,
  forceRefusal,
  lastSpeakerOf,
  saysSomething,
  selectSpeakers,
  selectsSpeakers,
  talkativenessOf,
  TALKATIVENESS_DEFAULT,
  turnSelection,
  wordsOf,
  type SpeakerDraws,
  type SpeakerInputs,
  type SpeakerSelection,
} from './speakers.js';

/**
 * Who talks this turn — [06 §7.2]'s taxonomy, [P7.3], and **each arm against
 * a table transcribed from SillyTavern's `public/scripts/group-chats.js`** at
 * the pinned commit — [P14 §1.3], [P14.1]'s first proof obligation.
 *
 * ***Why tables, and why the rolls are scripted.*** P7.3's arms carried ST's
 * names and did something else ([P14 §0.7]), and nothing caught it because the
 * tests asserted what the code did rather than what the source does. So each
 * row below names the lines of `group-chats.js` it transcribes, and the tape is
 * replaced by a script that says what every roll and every pick comes out as —
 * which is the only way a row can say *Vera rolled 0.4 and spoke, Lund rolled
 * 0.6 and did not* rather than *somebody spoke*. The real tape is used where
 * the claim is about the tape: that a replay picks the same speakers.
 *
 * Names rather than ids throughout, so a row reads as the scene it describes.
 */

const CAST = ['Vera', 'Lund', 'Abel'] as const;

function member(name: string): CastMember {
  return { actor: newActor(name), contentHash: `sha256:${name}` };
}

const PLAYER = member('You');

/**
 * Everybody any row names: the three-member cast most rows play, the player,
 * and the few actors only some rows need — the shared-word and Unicode cases.
 */
const ACTORS = new Map<string, CastMember>(
  [...CAST, 'Mara Holt', 'Jon Holt', 'Zoë', 'Анна'].map((name) => [name, member(name)]),
);
ACTORS.set('You', PLAYER);

function actorCalled(name: string): CastMember {
  const found = ACTORS.get(name);
  if (found === undefined) throw new Error(`no actor called ${name}`);
  return found;
}

function idOf(name: string): string {
  return actorCalled(name).actor.id;
}

function nameOf(id: string): string {
  for (const [name, one] of ACTORS) if (one.actor.id === id) return name;
  return id;
}

/**
 * What the tape comes out as, for one row. **Everything unsaid fails or comes
 * first**: a roll nobody scripted is 0.99, which the default talkativeness of
 * 0.5 does not beat, and a pick nobody scripted is the first candidate — so a
 * row only has to say what matters to it.
 */
interface Script {
  /** Each member's talkativeness roll, by name. */
  rolls?: Record<string, number>;
  /** The shuffle `natural` rolls in, by name. */
  order?: readonly string[];
  /** Who a uniform pick lands on, by name. */
  pick?: string;
}

/** One draw the selector made, recorded with names so a row can assert on it. */
interface Drawn {
  purpose: string;
  kind: 'float' | 'weightedPick';
  among?: string[];
}

function scripted(script: Script): { draw: SpeakerInputs['draw']; drawn: Drawn[] } {
  const drawn: Drawn[] = [];
  const order = (script.order ?? []).map(idOf);
  const pick = script.pick === undefined ? undefined : idOf(script.pick);
  const rolls = new Map(Object.entries(script.rolls ?? {}).map(([name, v]) => [idOf(name), v]));

  const draw = (purpose: string): SpeakerDraws => ({
    float(): number {
      drawn.push({ purpose, kind: 'float' });
      return rolls.get(purpose.slice('talkativeness:'.length)) ?? 0.99;
    },
    weightedPick<T>(items: readonly { id: string; value: T; weight: number }[]): T {
      drawn.push({ purpose, kind: 'weightedPick', among: items.map((item) => nameOf(item.id)) });
      const preferred =
        purpose === 'order' ? order.find((id) => items.some((item) => item.id === id)) : pick;
      const chosen = items.find((item) => item.id === preferred) ?? items[0];
      if (chosen === undefined) throw new RangeError('weightedPick() with nothing to pick');
      return chosen.value;
    },
  });
  return { draw, drawn };
}

/** A row's scene, in names. Present, alive and chatty-by-default unless said. */
interface Scene extends Script {
  cast?: readonly string[];
  /** Presence `false` — muted under `castIsPresent`. */
  muted?: readonly string[];
  dead?: readonly string[];
  departed?: readonly string[];
  /** The old reading: present only when presence says `true`. */
  presentOnly?: readonly string[];
  hasInput?: boolean;
  activation?: string;
  lastSpeaker?: string;
  spokenSinceInput?: readonly string[];
  allowSelfResponses?: boolean;
  talkativeness?: Record<string, number>;
  forced?: readonly string[];
  persona?: boolean;
}

function inputsFor(
  policy: ParticipantPolicy['select'],
  scene: Scene = {},
): {
  inputs: SpeakerInputs;
  drawn: Drawn[];
} {
  const actors = (scene.cast ?? CAST).map(actorCalled);
  const channels: Record<string, { value: unknown }> = {};
  for (const name of scene.muted ?? [])
    channels[channelKey(SE_PRESENCE, idOf(name))] = { value: false };
  for (const name of scene.presentOnly ?? []) {
    channels[channelKey(SE_PRESENCE, idOf(name))] = { value: true };
  }
  for (const name of scene.dead ?? [])
    channels[channelKey(SE_STATUS, idOf(name))] = { value: 'dead' };
  for (const name of scene.departed ?? []) {
    channels[channelKey(SE_STATUS, idOf(name))] = { value: 'departed' };
  }
  const { draw, drawn } = scripted(scene);

  return {
    inputs: {
      policy,
      castIsPresent: scene.presentOnly === undefined,
      allowSelfResponses: scene.allowSelfResponses ?? false,
      actors: scene.persona === true ? [...actors, PLAYER] : actors,
      persona: scene.persona === true ? PLAYER.actor.id : null,
      channels,
      ...(scene.forced === undefined ? {} : { forced: scene.forced.map(idOf) }),
      hasInput: scene.hasInput ?? true,
      activation: scene.activation ?? '',
      lastSpeaker: scene.lastSpeaker === undefined ? null : idOf(scene.lastSpeaker),
      spokenSinceInput: (scene.spokenSinceInput ?? []).map(idOf),
      talkativeness: Object.fromEntries(
        Object.entries(scene.talkativeness ?? {}).map(([name, value]) => [idOf(name), value]),
      ),
      draw,
    },
    drawn,
  };
}

function select(
  policy: ParticipantPolicy['select'],
  scene: Scene = {},
): { speakers: string[]; ask: SpeakerSelection['ask']; drawn: Drawn[] } {
  const { inputs, drawn } = inputsFor(policy, scene);
  const selection = selectSpeakers(inputs);
  return {
    speakers: selection.speakers.map(nameOf),
    ask: selection.ask === undefined ? undefined : { eligible: selection.ask.eligible.map(nameOf) },
    drawn,
  };
}

/** One transcribed row: the source lines, the scene, and who ST activates. */
interface Row {
  source: string;
  name: string;
  scene: Scene;
  speaks: readonly string[];
}

describe('who is eligible to be chosen', () => {
  /**
   * **`castIsPresent`: a cast member with no presence value is present, and
   * presence `false` is muted** — [P14 §1.3]. ST's `disabled_members`, and the
   * reason a chat is not an empty room: nothing in the build writes presence,
   * so under the old reading nobody was ever eligible.
   */
  it('counts a cast member nobody has said anything about as present, under castIsPresent', () => {
    expect(select('list').speakers).toEqual(['Vera', 'Lund', 'Abel']);
  });

  it('leaves out a muted member', () => {
    expect(select('list', { muted: ['Lund'] }).speakers).toEqual(['Vera', 'Abel']);
  });

  it('keeps the old reading for a mode that does not declare it: present is presence true', () => {
    // Freeform's reading, and every mode's before [P14.1] — absent is absent.
    expect(select('list', { presentOnly: ['Abel'] }).speakers).toEqual(['Abel']);
    expect(select('list', { presentOnly: [] }).speakers).toEqual([]);
  });

  it('leaves out anyone the story has written out, dead or departed', () => {
    // Both terminal statuses, because a character written out as `departed` is
    // assembled around identically to one wrongly killed ([06 §8.1]).
    expect(select('list', { dead: ['Lund'] }).speakers).toEqual(['Vera', 'Abel']);
    expect(select('list', { departed: ['Abel'] }).speakers).toEqual(['Vera', 'Lund']);
  });

  /**
   * **The persona is never a candidate.** They submitted the input, so it is
   * their turn by construction — and a policy that could decline to let the
   * player speak would be a policy that can refuse a turn.
   */
  it('never selects the player', () => {
    for (const policy of ['fixed', 'list', 'natural', 'pooled', 'manual', 'smart'] as const) {
      const { speakers } = select(policy, {
        persona: true,
        hasInput: false,
        activation: 'You there.',
        talkativeness: { Vera: 1, Lund: 1, Abel: 1 },
      });
      expect(speakers, policy).not.toContain('You');
    }
  });

  it('is empty, and draws nothing, when the room is', () => {
    const empty = { presentOnly: [] as string[], hasInput: false };
    for (const policy of ['list', 'natural', 'pooled', 'manual', 'smart'] as const) {
      const { speakers, drawn } = select(policy, empty);
      expect(speakers, policy).toEqual([]);
      expect(drawn, policy).toEqual([]);
    }
  });
});

describe('fixed', () => {
  it('makes no selection, so nothing about a shipped mode changes', () => {
    // Every eligible actor, which is the behaviour every mode had before the
    // taxonomy existed: a merged call names nobody regardless.
    expect(select('fixed').speakers).toEqual(['Vera', 'Lund', 'Abel']);
    expect(selectsSpeakers('fixed')).toBe(false);
  });

  it('is the one arm the runner does not call at all', () => {
    // A mode that declares no strategy must reach its steps as *absent* rather
    // than as a list it did not choose.
    for (const policy of ['natural', 'list', 'pooled', 'manual', 'smart'] as const) {
      expect(selectsSpeakers(policy), policy).toBe(true);
    }
  });
});

/**
 * **NATURAL** — `activateNaturalOrder`, `group-chats.js:1242-1316`. Mentions in
 * word order; then a roll for every member not banned, in shuffled order; then
 * one member at random if nobody; de-duplicated.
 */
describe('natural', () => {
  const ROWS: readonly Row[] = [
    {
      source: ':1253-1268',
      name: 'a member named in the input speaks',
      scene: { activation: 'Vera, what do you think?' },
      speaks: ['Vera'],
    },
    {
      source: ':1253-1268',
      name: 'mentions speak in the order the words appear, not cast order',
      scene: { activation: 'Abel, go and ask Vera.' },
      speaks: ['Abel', 'Vera'],
    },
    {
      source: ':1257-1266',
      name: 'a word two names share goes to the first in the cast (`break`)',
      scene: { cast: ['Mara Holt', 'Jon Holt'], activation: 'Holt!' },
      speaks: ['Mara Holt'],
    },
    {
      source: ':1257-1266',
      name: 'any word of a name is enough, since names are split into words',
      scene: { cast: ['Mara Holt', 'Jon Holt'], activation: 'Jon?' },
      speaks: ['Jon Holt'],
    },
    {
      source: 'utils.js:1357',
      name: 'words and not substrings — a veranda is not Vera',
      scene: { activation: 'Out on the veranda.', pick: 'Abel' },
      speaks: ['Abel'],
    },
    {
      source: 'utils.js:1366',
      name: 'case does not matter',
      scene: { activation: 'and then LUND stood up' },
      speaks: ['Lund'],
    },
    {
      source: ':1270-1293',
      name: 'nobody named: whoever beats their roll speaks, in shuffled order',
      scene: {
        activation: 'The rain did not let up.',
        rolls: { Vera: 0.4, Lund: 0.6, Abel: 0.2 },
        order: ['Abel', 'Lund', 'Vera'],
      },
      speaks: ['Abel', 'Vera'],
    },
    {
      source: ':1288',
      name: 'a roll equal to talkativeness speaks (`talkativeness >= rollValue`)',
      scene: { rolls: { Lund: 0.5 } },
      speaks: ['Lund'],
    },
    {
      source: ':1270-1293, :1309',
      name: 'a named member rolls too, and is de-duplicated where first found',
      scene: {
        activation: 'Lund?',
        rolls: { Vera: 0.1, Lund: 0.1 },
        order: ['Vera', 'Lund', 'Abel'],
      },
      speaks: ['Lund', 'Vera'],
    },
    {
      source: ':1285-1288',
      name: 'talkativeness 1 always speaks',
      scene: { talkativeness: { Abel: 1 }, rolls: { Abel: 0.999 } },
      speaks: ['Abel'],
    },
    {
      source: ':1285-1288',
      name: 'talkativeness 0 never beats a roll',
      scene: {
        talkativeness: { Vera: 0, Lund: 0, Abel: 1 },
        rolls: { Vera: 0.001, Lund: 0.001, Abel: 0.5 },
      },
      speaks: ['Abel'],
    },
    {
      source: ':1295-1307',
      name: 'nobody activated: one at random among those with talkativeness above zero',
      scene: { talkativeness: { Vera: 0, Lund: 0.3, Abel: 0 }, pick: 'Vera' },
      speaks: ['Lund'],
    },
    {
      source: ':1296',
      name: 'nobody activated and nobody chatty: one at random among everybody',
      scene: { talkativeness: { Vera: 0, Lund: 0, Abel: 0 }, pick: 'Abel' },
      speaks: ['Abel'],
    },
    {
      source: ':1246',
      name: 'no input: the last speaker is not named, even when the last message names them',
      scene: {
        hasInput: false,
        lastSpeaker: 'Vera',
        activation: 'Vera looked at Lund.',
      },
      speaks: ['Lund'],
    },
    {
      source: ':1246',
      name: 'an input lifts the ban: the player speaking is the break in the run',
      scene: { hasInput: true, lastSpeaker: 'Vera', activation: 'Vera, go on.' },
      speaks: ['Vera'],
    },
    {
      source: ':1249-1251',
      name: 'allowSelfResponses lifts the ban on a turn with no input too',
      scene: {
        hasInput: false,
        lastSpeaker: 'Vera',
        allowSelfResponses: true,
        activation: 'Vera smiled.',
      },
      speaks: ['Vera'],
    },
    {
      source: ':1296',
      name: 'the banned member is still in the last-resort pool — a room of one answers',
      scene: { cast: ['Vera'], hasInput: false, lastSpeaker: 'Vera', activation: 'Vera smiled.' },
      speaks: ['Vera'],
    },
  ];

  it.each(ROWS)('$source — $name', ({ scene, speaks }) => {
    expect(select('natural', scene).speakers).toEqual(speaks);
  });

  it('rolls for every member who is not banned, and never for the one who is', () => {
    const { drawn } = select('natural', {
      hasInput: false,
      lastSpeaker: 'Vera',
      activation: 'Lund?',
    });

    // Lund was named and rolls anyway; Vera is banned and rolls not at all.
    const rolled = drawn.filter((one) => one.kind === 'float').map((one) => one.purpose);
    expect(rolled.sort()).toEqual(
      [`talkativeness:${idOf('Lund')}`, `talkativeness:${idOf('Abel')}`].sort(),
    );
  });

  it('keys each roll by the member it is for, so a replay cannot hand it to somebody else', () => {
    const { drawn } = select('natural');
    const purposes = drawn.filter((one) => one.kind === 'float').map((one) => one.purpose);

    expect(purposes.sort()).toEqual(CAST.map((name) => `talkativeness:${idOf(name)}`).sort());
  });

  it('draws the last resort only when nobody else spoke', () => {
    const quiet = select('natural', { activation: 'Vera?' });
    expect(quiet.drawn.some((one) => one.purpose === 'speaker')).toBe(false);

    const chatty = select('natural', { talkativeness: { Vera: 0, Lund: 0.3, Abel: 0 } });
    expect(chatty.drawn.find((one) => one.purpose === 'speaker')?.among).toEqual(['Lund']);
  });

  /**
   * **Unicode letters where ST has ASCII `\w` — a deliberate difference**,
   * [P14 §1.3]. ST's `extractAllWords` matches `\b\w+\b` without the `u` flag,
   * so a word stops at its first letter outside ASCII: *Zoë* is the word *zo*,
   * found by *Zo* and *Zoé* as well as by her name, and a name in Cyrillic has
   * no words at all and is never found. (§1.3's *"Zoë never matches"* is the
   * second half of that and not the first — measured, and said so in
   * `speakers.ts`.)
   */
  it('finds a name with letters outside ASCII, where the source would not', () => {
    expect(wordsOf('Zoë, come here')).toEqual(['zoë', 'come', 'here']);
    expect(
      select('natural', { cast: ['Zoë', 'Vera'], activation: 'Zoë, come here' }).speakers,
    ).toEqual(['Zoë']);
    expect(select('natural', { cast: ['Анна', 'Vera'], activation: 'Анна?' }).speakers).toEqual([
      'Анна',
    ]);
  });

  it('does not find a name by the ASCII stub the source cuts it down to', () => {
    // Nobody named, so the last resort answers — and it is Vera because the
    // script says so, not because *Zo* or *Zoé* found Zoë.
    for (const activation of ['Zo?', 'Zoé?']) {
      expect(
        select('natural', { cast: ['Zoë', 'Vera'], activation, pick: 'Vera' }).speakers,
        activation,
      ).toEqual(['Vera']);
    }
  });

  it('treats a composed and a decomposed letter as the same letter', () => {
    // `e` + U+0308 COMBINING DIAERESIS, which is how some keyboards and most
    // macOS filenames spell it — NFC makes it the one code point a card has.
    expect(select('natural', { cast: ['Zoë', 'Vera'], activation: 'Zoë?' }).speakers).toEqual([
      'Zoë',
    ]);
  });
});

/** **LIST** — `activateListOrder`, `group-chats.js:1180-1188`. */
describe('list', () => {
  const ROWS: readonly Row[] = [
    {
      source: ':1180-1188',
      name: 'everybody eligible, once each, in cast order',
      scene: {},
      speaks: ['Vera', 'Lund', 'Abel'],
    },
    {
      source: ':1180-1188',
      name: 'nobody is banned, not even the one who just spoke',
      scene: { hasInput: false, lastSpeaker: 'Vera' },
      speaks: ['Vera', 'Lund', 'Abel'],
    },
    {
      source: ':1003',
      name: 'over the enabled members — a muted one is skipped',
      scene: { muted: ['Vera'] },
      speaks: ['Lund', 'Abel'],
    },
  ];

  it.each(ROWS)('$source — $name', ({ scene, speaks }) => {
    const { speakers, drawn } = select('list', scene);
    expect(speakers).toEqual(speaks);
    // A list is not a draw, so it puts nothing on the tape.
    expect(drawn).toEqual([]);
  });
});

/** **POOLED** — `activatePooledOrder`, `group-chats.js:1197-1231`. */
describe('pooled', () => {
  const ROWS: readonly (Row & { among: readonly string[] })[] = [
    {
      source: ':1204',
      name: 'after an input, anyone — the scan back stops at once',
      scene: { hasInput: true, spokenSinceInput: ['Vera', 'Lund'], pick: 'Lund' },
      among: ['Vera', 'Lund', 'Abel'],
      speaks: ['Lund'],
    },
    {
      source: ':1203-1221',
      name: 'no input: one who has not spoken since the last input',
      scene: { hasInput: false, spokenSinceInput: ['Vera'], lastSpeaker: 'Vera', pick: 'Abel' },
      among: ['Lund', 'Abel'],
      speaks: ['Abel'],
    },
    {
      source: ':1223-1227',
      name: 'no input and everybody has spoken: anyone but the last speaker',
      scene: {
        hasInput: false,
        spokenSinceInput: ['Lund', 'Abel', 'Vera'],
        lastSpeaker: 'Lund',
        pick: 'Vera',
      },
      among: ['Vera', 'Abel'],
      speaks: ['Vera'],
    },
    {
      source: ':1224',
      name: 'a room of one: the last speaker again (`members.length > 1`)',
      scene: { cast: ['Vera'], hasInput: false, spokenSinceInput: ['Vera'], lastSpeaker: 'Vera' },
      among: ['Vera'],
      speaks: ['Vera'],
    },
    {
      source: ':1224-1225',
      name: 'a last speaker who is muted takes nobody out of the pool',
      scene: {
        hasInput: false,
        muted: ['Abel'],
        spokenSinceInput: ['Vera', 'Lund', 'Abel'],
        lastSpeaker: 'Abel',
      },
      among: ['Vera', 'Lund'],
      speaks: ['Vera'],
    },
  ];

  it.each(ROWS)('$source — $name', ({ scene, speaks, among }) => {
    const { speakers, drawn } = select('pooled', scene);
    expect(speakers).toEqual(speaks);
    expect(drawn).toEqual([{ purpose: 'speaker', kind: 'weightedPick', among }]);
  });

  /**
   * **A replay is the same scene**, which is the whole reason the draw goes
   * through the turn's tape rather than through `Math.random`. And it is
   * `weightedPick` rather than `pick` for the reason `random.ts` names: a `pick`
   * records a *position*, so a replay against a pool of the same length hands
   * back a different actor — and a pool whose membership moves is the ordinary
   * case here.
   */
  it('replays to the same speaker, and says it replayed', () => {
    const first = new Rng();
    const chosen = onTape('pooled', first);

    const again = new Rng({ replay: first.tape });
    expect(onTape('pooled', again)).toEqual(chosen);
    expect(again.tape.every((draw) => draw.replayed)).toBe(true);
  });

  it('redraws rather than replaying a speaker who is no longer eligible', () => {
    const first = new Rng();
    const [chosen] = onTape('pooled', first);

    // The recorded winner has died between the original and the replay. The
    // tape names an id, so it can tell — where a position could not.
    const again = new Rng({ replay: first.tape });
    const second = onTape('pooled', again, { dead: [chosen ?? ''] });

    expect(second).toHaveLength(1);
    expect(second[0]).not.toBe(chosen);
    // **And it says it redrew**, which is the assertion that is not vacuous: the
    // one above would hold for any implementation that merely ignored the tape,
    // and [07 §5]'s promise is that *a rewrite that partly diverged says so*.
    expect(again.tape.at(-1)?.replayed).toBe(false);
  });
});

/**
 * **MANUAL** — `group-chats.js:1029-1031` for a turn with no input, and the
 * empty `activatedMembers` of `:1033-1041` for one with.
 */
describe('manual', () => {
  it('replies to an input with nobody, and draws nothing', () => {
    // `activationStrategy === MANUAL && !isUserInput` — with input the arm is
    // not entered at all, and the player's message is sent as it is.
    const { speakers, drawn } = select('manual', { hasInput: true, activation: 'Vera?' });
    expect(speakers).toEqual([]);
    expect(drawn).toEqual([]);
  });

  it('gives a turn with no input one member at random', () => {
    // `shuffle(enabledMembers).slice(0, 1)` — one, uniformly, over whoever is
    // enabled, with nobody banned.
    const { speakers, drawn } = select('manual', {
      hasInput: false,
      lastSpeaker: 'Lund',
      muted: ['Abel'],
      pick: 'Lund',
    });
    expect(speakers).toEqual(['Lund']);
    expect(drawn).toEqual([{ purpose: 'speaker', kind: 'weightedPick', among: ['Vera', 'Lund'] }]);
  });
});

/**
 * **Smart order's rules-first pre-pass** — [P14 §1.3a]'s first table. The call
 * itself is `se.speakers.smart`, tested in `smart-speakers.test.ts` and through
 * the runner; what this arm owes is that the rules decide without asking
 * whenever they can, and that when they cannot the fallback is already drawn.
 */
describe('smart', () => {
  it('answers a mention without asking, in order of mention', () => {
    const { speakers, ask, drawn } = select('smart', { activation: 'Abel, then Vera.' });
    expect(speakers).toEqual(['Abel', 'Vera']);
    expect(ask).toBeUndefined();
    // Mentions are natural's step 1 alone: no rolls, no picks.
    expect(drawn).toEqual([]);
  });

  it('answers a room of one without asking', () => {
    const { speakers, ask } = select('smart', { cast: ['Vera'], activation: 'Hello?' });
    expect(speakers).toEqual(['Vera']);
    expect(ask).toBeUndefined();
  });

  it('asks otherwise, with natural’s pick already drawn as the fallback', () => {
    const { speakers, ask, drawn } = select('smart', {
      activation: 'The rain did not let up.',
      rolls: { Lund: 0.1 },
    });
    expect(ask).toEqual({ eligible: ['Vera', 'Lund', 'Abel'] });
    expect(speakers).toEqual(['Lund']);
    // On the tape before any call, which is what makes the fallback replayable.
    expect(drawn.filter((one) => one.kind === 'float')).toHaveLength(3);
  });

  it('bans the last speaker from a mention on a turn with no input, as natural does', () => {
    const { speakers, ask } = select('smart', {
      hasInput: false,
      lastSpeaker: 'Vera',
      activation: 'Vera nodded.',
    });
    expect(ask).toEqual({ eligible: ['Vera', 'Lund', 'Abel'] });
    expect(speakers).not.toContain('Vera');
  });
});

/**
 * **Force-talk** — `group-chats.js:1006`, where `force_chid` is read before the
 * strategy is: ST's member *speak* button, `/trigger`, and Marinara's
 * `forCharacterId`.
 */
describe('force-talk', () => {
  it('overrides every policy, fixed included', () => {
    for (const policy of ['fixed', 'natural', 'list', 'pooled', 'manual', 'smart'] as const) {
      const { speakers, ask, drawn } = select(policy, {
        forced: ['Abel'],
        activation: 'Vera?',
      });
      expect(speakers, policy).toEqual(['Abel']);
      expect(ask, policy).toBeUndefined();
      expect(drawn, policy).toEqual([]);
    }
  });

  it('reaches a muted member, as force_chid bypasses disabled_members', () => {
    expect(select('manual', { forced: ['Lund'], muted: ['Lund'] }).speakers).toEqual(['Lund']);
  });

  it('reaches somebody absent under the old reading too, since presence is not consulted', () => {
    expect(select('list', { forced: ['Lund'], presentOnly: [] }).speakers).toEqual(['Lund']);
  });

  it('never reaches the dead, the departed or the player, and keeps the order asked', () => {
    const { speakers } = select('list', {
      persona: true,
      dead: ['Vera'],
      departed: ['Lund'],
      forced: ['Abel', 'Vera', 'You', 'Lund', 'Abel'],
    });
    expect(speakers).toEqual(['Abel']);
  });

  it('answers nobody, rather than the policy, when everybody named was refused', () => {
    // Somebody who asked for Vera and got Lund was answered by somebody they
    // did not ask for.
    expect(select('list', { dead: ['Vera'], forced: ['Vera'] }).speakers).toEqual([]);
  });

  it('says why a name is refused, in the three classes the route answers with', () => {
    const scene = {
      cast: new Set([idOf('Vera'), idOf('Lund')]),
      persona: PLAYER.actor.id,
      channels: {
        [channelKey(SE_STATUS, idOf('Lund'))]: { value: 'departed' },
        [channelKey(SE_PRESENCE, idOf('Vera'))]: { value: false },
      },
    };
    expect(forceRefusal(idOf('Vera'), scene)).toBeNull();
    expect(forceRefusal(PLAYER.actor.id, scene)).toBe('persona');
    expect(forceRefusal(idOf('Abel'), scene)).toBe('not-in-cast');
    expect(forceRefusal(idOf('Lund'), scene)).toBe('written-out');
  });
});

describe('talkativeness', () => {
  const MODE = 'storyengine.test.ensemble';

  it('is read from the card’s data for the session’s mode', () => {
    const card = { ...newActor('Vera'), modeData: { [MODE]: { talkativeness: 0.8 } } };
    expect(talkativenessOf(card, MODE)).toBe(0.8);
  });

  it('is ST’s default, 0.5, for a card that says nothing — or says it for another mode', () => {
    expect(TALKATIVENESS_DEFAULT).toBe(0.5);
    expect(talkativenessOf(newActor('Vera'), MODE)).toBe(0.5);
    const elsewhere = {
      ...newActor('Vera'),
      modeData: { 'some.other.mode': { talkativeness: 1 } },
    };
    expect(talkativenessOf(elsewhere, MODE)).toBe(0.5);
  });

  it('never throws on a value a hand edit put there, and clamps to [0, 1]', () => {
    const card = (value: unknown): Parameters<typeof talkativenessOf>[0] => ({
      ...newActor('Vera'),
      modeData: { [MODE]: { talkativeness: value } },
    });
    expect(talkativenessOf(card('high'), MODE)).toBe(0.5);
    expect(talkativenessOf(card(Number.NaN), MODE)).toBe(0.5);
    expect(talkativenessOf(card(1.5), MODE)).toBe(1);
    expect(talkativenessOf(card(-1), MODE)).toBe(0);
    expect(talkativenessOf({ ...newActor('Vera'), modeData: { [MODE]: 7 } }, MODE)).toBe(0.5);
  });
});

/**
 * **The chat as the arms read it** — what `group-chats.js` reads off `chat`
 * before activating anybody (`:988-1000`, `:1203-1216`), from our path.
 */
describe('the chat so far', () => {
  let turnNo = 0;
  function turn(over: Partial<Turn>): Turn {
    turnNo += 1;
    return {
      id: `t-${String(turnNo)}`,
      sessionId: 's',
      parentTurnId: null,
      createdAt: '2026-09-29T00:00:00.000Z',
      status: 'complete',
      tape: [],
      ...over,
    } as Turn;
  }
  function said(...messages: [string | null, string][]): NonNullable<Turn['output']> {
    const list: OutputMessage[] = messages.map(([speaker, text]) => ({
      speaker: speaker === null ? null : { id: idOf(speaker), name: speaker },
      text,
    }));
    return { text: list.map((one) => one.text).join('\n\n'), messages: list };
  }
  const input = (text: string): NonNullable<Turn['input']> => ({
    actorId: null,
    kind: 'do',
    text,
    raw: text,
  });

  it('takes the last message on the path, and who said it', () => {
    const path = [turn({ input: input('Well?'), output: said(['Vera', 'No.'], ['Lund', 'Yes.']) })];
    const soFar = chatSoFar(path, {});

    expect(soFar.last).toEqual({
      speaker: idOf('Lund'),
      byPlayer: false,
      text: 'Yes.',
      hidden: false,
    });
    expect(lastSpeakerOf(soFar)).toBe(idOf('Lund'));
    expect(soFar.spokenSinceInput).toEqual([idOf('Lund'), idOf('Vera')]);
  });

  it('reads a legacy output as the narrator, who is nobody to ban', () => {
    const path = [turn({ input: input('Well?'), output: { text: 'Rain.' } })];
    const soFar = chatSoFar(path, {});

    expect(soFar.last?.text).toBe('Rain.');
    expect(lastSpeakerOf(soFar)).toBeNull();
    expect(soFar.spokenSinceInput).toEqual([]);
  });

  it('walks past a turn that said nothing, since bookkeeping is not a message', () => {
    // A hand edit, an undo and a quarantine all write turns with effects and no
    // output ([03 §8.1]) — so the last *turn* and the last *message* differ.
    const path = [
      turn({ output: said(['Abel', 'Hm.']) }),
      turn({ effects: [] }),
      turn({ output: { text: '' } }),
    ];
    expect(chatSoFar(path, {}).last?.speaker).toBe(idOf('Abel'));
  });

  it('counts who spoke since the last input, across turns with none', () => {
    const path = [
      turn({ input: input('Go on.'), output: said(['Vera', 'A.']) }),
      turn({ output: said(['Lund', 'B.']) }),
      turn({ input: input(''), output: said(['Abel', 'C.']) }),
    ];
    // The empty input is *let them talk*, not the player speaking.
    expect(chatSoFar(path, {}).spokenSinceInput).toEqual([
      idOf('Abel'),
      idOf('Lund'),
      idOf('Vera'),
    ]);
  });

  /**
   * **Hidden, as ST reads `is_system` in each place it reads it** — a hidden
   * last message is still the last message (`:989`), its text is withheld from
   * activation (`:997`), it does not count as having spoken (`:1208`), and a
   * hidden input still ends the scan back (`:1204` checks `is_user` first).
   */
  it('treats a hidden message as ST treats a system one', () => {
    const last = turn({ output: said(['Vera', 'A.'], ['Lund', 'B.']) });
    const soFar = chatSoFar([last], { [last.id]: [1] });

    expect(soFar.last).toEqual({
      speaker: idOf('Lund'),
      byPlayer: false,
      text: 'B.',
      hidden: true,
    });
    expect(lastSpeakerOf(soFar)).toBe(idOf('Lund'));
    expect(soFar.spokenSinceInput).toEqual([idOf('Vera')]);
    expect(activationText(undefined, soFar)).toBe('');
  });

  it('stops at a hidden input as at any other', () => {
    const asked = turn({ input: input('Who?'), output: said(['Vera', 'Me.']) });
    const after = turn({ output: said(['Lund', 'Not me.']) });
    const soFar = chatSoFar([turn({ output: said(['Abel', 'Old.']) }), asked, after], {
      [asked.id]: true,
    });

    expect(soFar.spokenSinceInput).toEqual([idOf('Lund')]);
  });

  it('takes the player’s message as the last one when nobody answered it', () => {
    const soFar = chatSoFar([turn({ input: input('Vera?'), output: said() })], {});

    expect(soFar.last).toEqual({ speaker: null, byPlayer: true, text: 'Vera?', hidden: false });
    expect(lastSpeakerOf(soFar)).toBeNull();
  });

  it('is nothing before anything is said', () => {
    expect(chatSoFar([], {})).toEqual({ last: null, spokenSinceInput: [] });
  });
});

describe('the activation text', () => {
  const soFar = {
    last: { speaker: 'x', byPlayer: false, text: 'Lund set down the glass.', hidden: false },
    spokenSinceInput: [],
  };

  it('is the input when there is one (`:993-995`)', () => {
    const move = { text: 'Vera?', attachments: [] };
    expect(activationText(move, soFar)).toBe('Vera?');
    expect(saysSomething(move)).toBe(true);
  });

  it('is the last message when there is no input, or an empty one (`:996-999`)', () => {
    expect(activationText(undefined, soFar)).toBe('Lund set down the glass.');
    expect(activationText({ text: '' }, soFar)).toBe('Lund set down the glass.');
    expect(saysSomething({ text: '' })).toBe(false);
  });

  it('counts a caption, since naming somebody under a picture addresses them', () => {
    const move = { text: '', attachments: [{ caption: 'Vera at the door' }] };
    expect(saysSomething(move)).toBe(true);
    expect(activationText(move, soFar)).toBe('Vera at the door');
  });
});

/**
 * **A replay picks the same speakers** — [P14.1]'s proof obligation, on the
 * real tape rather than a script, because the claim is about the tape.
 */
describe('on the tape', () => {
  it('replays natural to the same speakers, every draw taken off the tape', () => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const first = new Rng();
      const chosen = onTape('natural', first);
      expect(first.tape.length).toBeGreaterThan(0);

      const again = new Rng({ replay: first.tape });
      expect(onTape('natural', again)).toEqual(chosen);
      expect(again.tape.every((draw) => draw.replayed)).toBe(true);
    }
  });

  it('keeps a remaining member’s roll when somebody else has left the room', () => {
    const first = new Rng();
    onTape('natural', first);

    const again = new Rng({ replay: first.tape });
    onTape('natural', again, { muted: ['Vera'] });

    // Lund's and Abel's rolls are theirs by key, so they replay; a positional
    // run of rolls would have handed Vera's to whoever came next.
    const rolls = again.tape.filter((draw) => draw.purpose.startsWith('talkativeness:'));
    expect(rolls.map((draw) => draw.purpose).sort()).toEqual(
      [`talkativeness:${idOf('Lund')}`, `talkativeness:${idOf('Abel')}`].sort(),
    );
    expect(rolls.every((draw) => draw.replayed)).toBe(true);
    for (const roll of rolls) {
      expect(roll.value).toBe(first.tape.find((draw) => draw.key === roll.key)?.value);
    }
  });
});

/** Runs one arm on a real tape, at the site the runner uses. */
function onTape(policy: ParticipantPolicy['select'], rng: Rng, scene: Scene = {}): string[] {
  const { inputs } = inputsFor(policy, { hasInput: false, ...scene });
  return selectSpeakers({
    ...inputs,
    draw: (purpose) => rng.at('se.participants', purpose),
  }).speakers.map(nameOf);
}

/**
 * ***No selection, or a selection*** — `turnSelection`, [P14.3]: the runner's
 * question asked in one place so the preview asks it the same way, and the
 * rule that a room nobody has been cast in is narrated rather than silent.
 */
describe('whether a turn selects at all', () => {
  const policy = (select: ParticipantPolicy['select']) => ({
    policy: select,
    allowSelfResponses: false,
    namesInHistory: 'groups' as const,
    maxPerRound: 3,
  });
  const ask = (
    select: ParticipantPolicy['select'],
    actors: CastMember[],
    forced?: readonly string[],
  ) => {
    const rng = new Rng();
    return turnSelection({
      policy: policy(select),
      castIsPresent: true,
      cast: { persona: PLAYER, actors },
      channels: {},
      history: [],
      hidden: {},
      input: { text: 'Hello, Vera.' },
      forced,
      talkativeness: {},
      draw: (purpose) => rng.at('se.participants', purpose),
    });
  };

  it('selects over a cast with somebody in it', () => {
    expect(ask('natural', [actorCalled('Vera'), actorCalled('Lund')])?.speakers[0]).toBe(
      idOf('Vera'),
    );
  });

  it('makes no selection in a room nobody but the persona is in', () => {
    expect(ask('natural', [])).toBeUndefined();
    expect(ask('natural', [PLAYER])).toBeUndefined();
  });

  it('makes no selection under fixed, and one when somebody is forced', () => {
    expect(ask('fixed', [actorCalled('Vera')])).toBeUndefined();
    expect(ask('fixed', [actorCalled('Vera')], [idOf('Vera')])?.speakers).toEqual([idOf('Vera')]);
  });
});
