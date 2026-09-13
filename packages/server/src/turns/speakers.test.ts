// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import { newActor } from '@storyengine/shared';
import type { ParticipantPolicy } from '@storyengine/sdk';

import { Rng } from '../rng/rng.js';
import { channelKey } from '../sessions/channels.js';
import { SE_PRESENCE, SE_STATUS } from '../sessions/cast.js';

import type { CastMember } from './cast.js';
import { lastProse, selectSpeakers, selectsSpeakers } from './speakers.js';

/**
 * Who talks this turn — [06 §7.2]'s taxonomy, [P7.3].
 *
 * **The eligibility rule is what most of these are about**, because it is the
 * half that is the same for every arm and the half that makes the taxonomy mean
 * anything: a selector over a cast with no notion of who is present picks from
 * everyone the session has ever named, which is what P7.2's channels exist to
 * stop. Each arm then gets the one or two assertions that say what *it* decides.
 */

const VERA = actor('Vera');
const LUND = actor('Lund');
const ABEL = actor('Abel');
const PLAYER = actor('You');

function actor(name: string): CastMember {
  const made = newActor(name);
  return { actor: made, contentHash: `sha256:${name}` };
}

/** Present and alive unless said otherwise, which is what a scene normally is. */
function channels(
  over: Record<string, unknown> = {},
  present: readonly CastMember[] = [VERA, LUND, ABEL],
): Record<string, { value: unknown }> {
  const map: Record<string, { value: unknown }> = {};
  for (const member of present) map[channelKey(SE_PRESENCE, member.actor.id)] = { value: true };
  for (const [key, value] of Object.entries(over)) map[key] = { value };
  return map;
}

function policy(select: ParticipantPolicy['select']): ParticipantPolicy {
  return { select, maxActors: 4 };
}

function pick(
  select: ParticipantPolicy['select'],
  over: Parameters<typeof selectSpeakers>[0] extends infer T
    ? Partial<Omit<T & object, 'policy'>>
    : never = {},
): string[] {
  return selectSpeakers({
    policy: policy(select),
    actors: [VERA, LUND, ABEL],
    persona: null,
    channels: channels(),
    depth: 0,
    ...over,
  });
}

describe('who is eligible to be chosen', () => {
  it('leaves out anyone the scene says is not here', () => {
    const only = channels({}, [VERA, ABEL]);

    expect(pick('fixed', { channels: only })).toEqual([VERA.actor.id, ABEL.actor.id]);
  });

  it('leaves out anyone the story has written out of it', () => {
    const dead = channels({ [channelKey(SE_STATUS, LUND.actor.id)]: 'dead' });

    expect(pick('fixed', { channels: dead })).toEqual([VERA.actor.id, ABEL.actor.id]);
  });

  it('leaves out somebody departed as well as somebody dead', () => {
    // Both terminal statuses, because a character written out as `departed` is
    // assembled around identically to one wrongly killed ([06 §8.1]).
    const gone = channels({ [channelKey(SE_STATUS, ABEL.actor.id)]: 'departed' });

    expect(pick('fixed', { channels: gone })).toEqual([VERA.actor.id, LUND.actor.id]);
  });

  /**
   * **The persona is never a candidate.** They submitted the input, so it is
   * their turn by construction — and a policy that could decline to let the
   * player speak would be a policy that can refuse a turn.
   */
  it('never selects the player', () => {
    const withPlayer = channels({}, [VERA, PLAYER]);

    expect(
      selectSpeakers({
        policy: policy('fixed'),
        actors: [VERA, PLAYER],
        persona: PLAYER.actor.id,
        channels: withPlayer,
        depth: 0,
      }),
    ).toEqual([VERA.actor.id]);
  });

  it('is empty rather than everybody when the room is', () => {
    expect(pick('list', { channels: channels({}, []) })).toEqual([]);
    expect(pick('pooled', { channels: channels({}, []) })).toEqual([]);
    expect(pick('natural', { channels: channels({}, []) })).toEqual([]);
  });
});

describe('fixed', () => {
  it('makes no selection, so nothing about a shipped mode changes', () => {
    // Every eligible actor, which is the behaviour every mode had before the
    // taxonomy existed: a merged call names nobody regardless.
    expect(pick('fixed')).toEqual([VERA.actor.id, LUND.actor.id, ABEL.actor.id]);
    expect(selectsSpeakers(policy('fixed'))).toBe(false);
  });

  it('is the one arm the runner does not call at all', () => {
    // A mode that declares no strategy must reach its steps as *absent* rather
    // than as a list it did not choose.
    for (const select of ['natural', 'list', 'pooled', 'manual'] as const) {
      expect(selectsSpeakers(policy(select)), select).toBe(true);
    }
  });
});

describe('manual', () => {
  it('takes whoever the player named', () => {
    expect(pick('manual', { input: { actorId: LUND.actor.id, text: '' } })).toEqual([
      LUND.actor.id,
    ]);
  });

  it('answers nobody when nobody was named, which is a real answer', () => {
    expect(pick('manual', { input: { actorId: null, text: 'She waited.' } })).toEqual([]);
    expect(pick('manual')).toEqual([]);
  });

  it('refuses somebody the scene says is not eligible', () => {
    // Naming a dead character is a stale UI or a hand-written request, and
    // honouring it would voice somebody the story has written out.
    const dead = channels({ [channelKey(SE_STATUS, LUND.actor.id)]: 'dead' });

    expect(pick('manual', { channels: dead, input: { actorId: LUND.actor.id, text: '' } })).toEqual(
      [],
    );
  });
});

describe('list', () => {
  it('rotates on the path, one speaker at a time', () => {
    expect(pick('list', { depth: 0 })).toEqual([VERA.actor.id]);
    expect(pick('list', { depth: 1 })).toEqual([LUND.actor.id]);
    expect(pick('list', { depth: 2 })).toEqual([ABEL.actor.id]);
    expect(pick('list', { depth: 3 })).toEqual([VERA.actor.id]);
  });

  /**
   * **The rotation is a function of the node, which is what branching needs.**
   * [07 §3] refuses `(branch, index)` addressing because a turn's position is a
   * fact about a *path*; the path to a node is exactly what `depth` is, so two
   * branches diverging at the same turn rotate independently from there.
   */
  it('rotates over who is eligible rather than over the roster', () => {
    const only = channels({}, [VERA, ABEL]);

    expect(pick('list', { depth: 0, channels: only })).toEqual([VERA.actor.id]);
    expect(pick('list', { depth: 1, channels: only })).toEqual([ABEL.actor.id]);
    expect(pick('list', { depth: 2, channels: only })).toEqual([VERA.actor.id]);
  });
});

describe('pooled', () => {
  it('draws one, and the draw is on the tape', () => {
    const rng = new Rng();
    const chosen = pick('pooled', { draw: rng.at('se.participants', 'speaker') });

    expect(chosen).toHaveLength(1);
    expect([VERA.actor.id, LUND.actor.id, ABEL.actor.id]).toContain(chosen[0]);
    expect(rng.tape.length).toBe(1);
  });

  /**
   * **A replay is the same scene**, which is the whole reason the draw goes
   * through the turn's tape rather than through `Math.random`. And it is
   * `weightedPick` rather than `pick` for the reason `random.ts` names: a `pick`
   * records a *position*, so a replay against a pool of the same length hands
   * back a different actor — and a pool whose membership moves is the ordinary
   * case here.
   */
  it('replays to the same speaker', () => {
    const first = new Rng();
    const chosen = pick('pooled', { draw: first.at('se.participants', 'speaker') });

    const again = new Rng({ replay: first.tape });
    expect(pick('pooled', { draw: again.at('se.participants', 'speaker') })).toEqual(chosen);
  });

  it('redraws rather than replaying a speaker who is no longer eligible', () => {
    const first = new Rng();
    const chosen = pick('pooled', { draw: first.at('se.participants', 'speaker') })[0]!;

    // The recorded winner has died between the original and the replay. The
    // tape names an id, so it can tell — where a position could not.
    const without = channels({ [channelKey(SE_STATUS, chosen)]: 'dead' });
    const again = new Rng({ replay: first.tape });
    const second = pick('pooled', {
      channels: without,
      draw: again.at('se.participants', 'speaker'),
    });

    expect(second).toHaveLength(1);
    expect(second[0]).not.toBe(chosen);
    // **And it says it redrew**, which is the assertion that is not vacuous: the
    // one above would hold for any implementation that merely ignored the tape,
    // and [07 §5]'s promise is that *a rewrite that partly diverged says so*.
    expect(again.tape.at(-1)?.replayed).toBe(false);
  });

  it('marks a replayed draw as replayed, so the flag above means something', () => {
    const first = new Rng();
    pick('pooled', { draw: first.at('se.participants', 'speaker') });

    const again = new Rng({ replay: first.tape });
    pick('pooled', { draw: again.at('se.participants', 'speaker') });

    expect(again.tape.at(-1)?.replayed).toBe(true);
  });
});

describe('natural', () => {
  it('answers whoever the player addressed', () => {
    expect(pick('natural', { input: { actorId: null, text: 'Vera, what do you think?' } })).toEqual(
      [VERA.actor.id],
    );
  });

  it('reads the prose the scene last produced', () => {
    expect(pick('natural', { lastProse: 'Lund set down the glass.' })).toEqual([LUND.actor.id]);
  });

  it('puts the input ahead of the prose, because addressing is more recent', () => {
    expect(
      pick('natural', {
        input: { actorId: null, text: 'Abel?' },
        lastProse: 'Lund set down the glass.',
      }),
    ).toEqual([ABEL.actor.id, LUND.actor.id]);
  });

  it('orders by where each name first appears', () => {
    expect(pick('natural', { lastProse: 'Lund looked at Vera. Abel said nothing.' })).toEqual([
      LUND.actor.id,
      VERA.actor.id,
      ABEL.actor.id,
    ]);
  });

  it('matches without regard to case, because prose is prose', () => {
    expect(pick('natural', { lastProse: 'and then VERA stood up' })).toEqual([VERA.actor.id]);
  });

  /**
   * **Nobody found is nobody**, deliberately rather than falling back to the
   * pool: a turn that addresses no one is a turn the narrator answers, and a
   * fallback would make `natural` indistinguishable from `fixed` in exactly the
   * case a mode most wants to tell apart.
   */
  it('answers nobody when nobody was named', () => {
    expect(pick('natural', { lastProse: 'The rain did not let up.' })).toEqual([]);
  });

  it('does not name somebody the scene says has left', () => {
    const only = channels({}, [VERA, ABEL]);

    expect(pick('natural', { channels: only, lastProse: 'Lund set down the glass.' })).toEqual([]);
  });
});

describe('what the scene last said', () => {
  it('walks back past a turn that wrote no prose', () => {
    // A hand edit, an undo and a quarantine all write turns with effects and no
    // output ([03 §8.1]) — so the last *turn* and the last thing the scene said
    // are routinely different, and `natural` wants the second.
    const turns = [
      { output: { text: 'Lund set down the glass.' } },
      { effects: [] },
    ] as unknown as Parameters<typeof lastProse>[0];

    expect(lastProse(turns)).toBe('Lund set down the glass.');
  });

  it('is undefined when nothing has been said yet', () => {
    expect(lastProse([])).toBeUndefined();
  });
});
