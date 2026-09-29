// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { beforeEach, describe, expect, it } from 'vitest';

import {
  actorsWithState,
  castRows,
  introducedOn,
  isTerminal,
  readParty,
  readPresence,
  readStatus,
  SE_PARTY,
  SE_PRESENCE,
  SE_STATUS,
} from './cast.js';
import { readFile } from 'node:fs/promises';

import { channelDefinition, channelKey, quarantineEffects } from './channels.js';
import { applyEffects } from './store.js';
import { installBuiltIns } from '../mode-loader.js';
import { acceptEffect } from '../turns/effects.js';
import type { ChannelEffect, ChannelState, Turn } from './types.js';

/**
 * Presence, status, and *introduced* — [06 §8.1], [10 §13.2], [P7.2].
 *
 * **`scope: 'actor'` gets its first writer here**, which P7.2's own cell names:
 * the scoped-key machinery P5.5 built and P6 property-tested has been proved by
 * `scope: 'entry'` alone, so the arm stops being a declaration the moment two
 * actors hold different values without overwriting each other.
 */

function turn(effects: Partial<ChannelEffect>[]): Turn {
  return {
    id: 't',
    sessionId: 's',
    parentTurnId: null,
    createdAt: '2026-09-11T00:00:00.000Z',
    status: 'complete',
    tape: [],
    effects: effects.map((over, index) => ({
      id: `e${String(index)}`,
      turnId: 't',
      channelId: SE_PRESENCE,
      scopeKey: null,
      op: { type: 'set', path: '/' },
      before: null,
      after: true,
      proposedBy: { kind: 'model', callId: 'c1' },
      applied: true,
      rejectedReason: null,
      supersedes: null,
      channelVersion: 1,
      scope: 'session',
      ...over,
    })),
  };
}

describe('the two axes', () => {
  beforeEach(async () => {
    await installBuiltIns();
  });

  it('registers both, per actor, owned by a package rather than a mode', () => {
    // Every mode with a cast wants these and none of them is Scene's in
    // particular. [06 §4.1] admits a package id as an `owner` for exactly this,
    // and `se.lore.timing` is the precedent.
    expect(channelDefinition(SE_PRESENCE)?.scope).toBe('actor');
    expect(channelDefinition(SE_STATUS)?.scope).toBe('actor');
    expect(channelDefinition(SE_PRESENCE)?.owner).toBe('storyengine.cast');
  });

  it('keeps two actors apart, which is what `scope: "actor"` had never proved', () => {
    const channels: Record<string, ChannelState> = {
      [channelKey(SE_PRESENCE, 'vera')]: { version: 1, value: true },
      [channelKey(SE_PRESENCE, 'ned')]: { version: 1, value: false },
      [channelKey(SE_STATUS, 'vera')]: { version: 1, value: 'dead' },
    };

    expect(readPresence(channels, 'vera')).toBe(true);
    expect(readPresence(channels, 'ned')).toBe(false);
    expect(readStatus(channels, 'vera')).toBe('dead');
    // Ned's status was never written, and the declaration's init is what a
    // reader falls back to — the same read-time default `readClock` uses.
    expect(readStatus(channels, 'ned')).toBe('alive');
  });

  it('says dead-but-present, which one enum cannot', () => {
    // The body in the room, the ghost, the open casket — [10 §13.2]'s reason for
    // splitting the axes, as an assertion rather than a sentence.
    const channels: Record<string, ChannelState> = {
      [channelKey(SE_PRESENCE, 'vera')]: { version: 1, value: true },
      [channelKey(SE_STATUS, 'vera')]: { version: 1, value: 'dead' },
    };

    expect(readPresence(channels, 'vera')).toBe(true);
    expect(readStatus(channels, 'vera')).toBe('dead');
  });

  it('treats absent as absent, so the cast is not in every room', () => {
    expect(readPresence({}, 'vera')).toBe(false);
  });

  it('names the statuses a story does not come back from', () => {
    // *"Must carry no terminal status"* — [06 §6.1]'s hook filter, which has
    // been spending the word since it was written.
    expect(isTerminal('dead')).toBe(true);
    expect(isTerminal('departed')).toBe(true);
    expect(isTerminal('alive')).toBe(false);
    expect(isTerminal(undefined)).toBe(false);
  });

  it('collects every actor the channels say anything about', () => {
    expect(
      [
        ...actorsWithState({
          [channelKey(SE_PRESENCE, 'vera')]: { value: true },
          [channelKey(SE_STATUS, 'ned')]: { value: 'alive' },
          'se.clock': { value: {} },
        }),
      ].sort(),
    ).toEqual(['ned', 'vera']);
  });
});

describe('a model may not kill somebody on its own', () => {
  beforeEach(async () => {
    await installBuiltIns();
  });

  const proposal = (after: unknown, by: ChannelEffect['proposedBy']) => ({
    channelId: SE_STATUS,
    scopeKey: 'vera',
    op: { type: 'set' as const, path: '/' },
    after,
    proposedBy: by,
  });

  it('refuses a terminal status from the model, and records the attempt', () => {
    // **The asymmetry** — [06 §8.1], [25 C12]. A missed death is corrected in a
    // click; a false one silently removes somebody from every subsequent
    // assembly. So the model is under-fired and the attempt stays in the record.
    const effect = acceptEffect('t1', proposal('dead', { kind: 'model', callId: 'c1' }), {});

    expect(effect.applied).toBe(false);
    expect(effect.rejectedReason).toBe('needs-confirmation');
  });

  it('refuses `departed` too, because the harm is identical', () => {
    // A character wrongly written out is assembled around the same way as one
    // wrongly killed, and the click that corrects it is the same click.
    const effect = acceptEffect('t1', proposal('departed', { kind: 'step', stepId: 's' }), {});

    expect(effect.rejectedReason).toBe('needs-confirmation');
  });

  it('lets the model say somebody is alive, so it is not a wall', () => {
    const effect = acceptEffect('t1', proposal('alive', { kind: 'model', callId: 'c1' }), {});

    expect(effect.applied).toBe(true);
  });

  it('lets a person do it, which is the always-available manual path', () => {
    // 25 C12: *"Under-firing plus always-available manual completion is the
    // position regardless."* The channel write route is that path.
    const effect = acceptEffect('t1', proposal('dead', { kind: 'user' }), {});

    expect(effect.applied).toBe(true);
    expect(effect.rejectedReason).toBeNull();
  });

  it('answers needs-confirmation before schema, because it is the useful sentence', () => {
    // A proposal that is both loaded and malformed is more usefully answered as
    // the first: *this one needs a person* has a next step, and `schema` on a
    // value the model was never going to be allowed to set sends somebody
    // looking for a typo.
    const effect = acceptEffect('t1', proposal('dead', { kind: 'model', callId: 'c1' }), {});
    const malformed = acceptEffect('t1', proposal('vanished', { kind: 'model', callId: 'c1' }), {});

    expect(effect.rejectedReason).toBe('needs-confirmation');
    // Not in `confirm`, so the schema is what refuses it.
    expect(malformed.rejectedReason).toBe('schema');
  });
});

describe('introduced', () => {
  it('is acquired by a presence effect and never lost along the path', () => {
    // *"This actor has been the subject of a presence or party effect at some
    // point on the path to this node"* — monotone, so it can only be acquired.
    const path = [
      turn([{ scopeKey: 'vera', after: true }]),
      turn([{ scopeKey: 'vera', after: false }]),
    ];

    expect([...introducedOn(path)]).toEqual(['vera']);
  });

  it('is not presence, which is the distinction the definition exists for', () => {
    // A character introduced in chapter one and absent since reads `false` for
    // presence and is emphatically not *never introduced*.
    const path = [turn([{ scopeKey: 'vera', after: false }])];

    expect(introducedOn(path).has('vera')).toBe(true);
    expect(readPresence({}, 'vera')).toBe(false);
  });

  it('un-introduces on a rewind, for free', () => {
    // The property 8.1 calls out: *"rewind past a character's arrival and they
    // are un-introduced again, which is what anyone would expect and would
    // otherwise have had to be built."* A shorter path is the whole mechanism.
    const arrival = turn([{ scopeKey: 'vera', after: true }]);

    expect(introducedOn([arrival]).has('vera')).toBe(true);
    expect(introducedOn([]).has('vera')).toBe(false);
  });

  it('is not acquired by a refused proposal', () => {
    // A character is not introduced by something that did not happen.
    const path = [turn([{ scopeKey: 'vera', applied: false, rejectedReason: 'schema' }])];

    expect(introducedOn(path).has('vera')).toBe(false);
  });

  it('ignores effects on other channels', () => {
    const path = [turn([{ channelId: 'se.clock', scopeKey: null, after: { day: 1 } }])];

    expect([...introducedOn(path)]).toEqual([]);
  });

  it('counts a party effect, which is named before the channel exists', () => {
    // The definition says *presence or party*, and a list that omitted the
    // second would be a definition quietly narrowed to what happened to be
    // built. `se.party` waits on P7.3's policy; this does not.
    const path = [turn([{ channelId: 'se.party', scopeKey: 'ned', after: {} }])];

    expect([...introducedOn(path)]).toEqual(['ned']);
  });
});

/**
 * ***The tripwire on P7.2's deferral*** — [P7 §1.6], written 2026-09-11.
 *
 * P7.2 shipped presence and status and deliberately did not ship `se.party`,
 * because `ParticipantPolicy.select: 'fixed'` is *"the declaration that the cast
 * cannot change as an outcome of a turn, which is what licenses a plain `cast`
 * field on the session instead of an `se.party` channel"*. A party channel
 * declared against that policy is the placeholder shape [P2 §2.7] rejected by
 * name.
 *
 * **The licence expires the moment `select` gains a second arm, and until this
 * test the only thing that would have noticed was somebody remembering.** This
 * document's own §0.1a is the evidence for how that goes: *"a deferral routed to
 * a phase is checked once, by whoever routes it, and then travels on its
 * label"*, and two of the three surface-shaped deferrals handed to P7 turned out
 * to be already done. So the deferral is held by a check instead.
 *
 * **It fails from the inside of P7.3 rather than after it.** Widening
 * `PARTICIPANT_SELECTORS` is the first thing that stage does, and this goes red
 * on that commit — which is the point, since P7.3's own *Ends at* is *"a mode
 * whose `select` is not `fixed` running without the session's `cast` field"*.
 *
 * ***One of the three clauses was withdrawn when the tripwire was answered —
 * 2026-09-12, [P7.3].*** The deferral asked P7.3 to remove `cast.actors`, on
 * [P7 §1.6]'s reading that the field is *"presence-shaped"*. Measured against
 * what P7.2 actually shipped, it is not: `se.presence` declares
 * `init: { literal: false }`, so **a roster read off presence cannot separate
 * *in the cast and elsewhere* from *not in the cast at all*** — `readPresence`
 * returns `false` for both, and the only thing that distinguishes them is
 * whether a key exists, which an undo of an arrival legitimately deletes
 * (`inverseOf`). A roster cannot live in a channel whose default collapses the
 * distinction it exists to draw.
 *
 * So the field stays and the third assertion below is now that it **does**, in
 * both branches. What §1.6 was right about is that two sources of truth is a
 * bug; where it lived was the assembler, which read the roster while the panel
 * read the union, and `turns/cast.test.ts` holds that fixed. The workplan's
 * P7.3 cell carries the decision and §1.6 carries the correction.
 */
/**
 * Who is travelling with you — [06 §8], [P7.3].
 *
 * **The party is a third question, not a rival to the first two.** Presence says
 * who is in the room and status says who is alive; this says who is *with you*,
 * and 06 §8's six design rules are what these assert against. The first rule is
 * the one with a shape consequence: *"the party always exists and always
 * contains the persona… a solo game is a party of one"*, which has to be a
 * read-time invariant because a session is created before its first turn and an
 * invariant that needs an effect written is not one.
 */
describe('the party', () => {
  function withParty(actorId: string, control: unknown): Record<string, ChannelState> {
    return { [channelKey(SE_PARTY, actorId)]: { version: 1, value: control } };
  }

  it('is empty for somebody nothing has said anything about', () => {
    expect(readParty({}, 'vera')).toBeNull();
  });

  it('carries the control, because membership and authorship arrive together', () => {
    // 06 §8's second rule makes them one fact: a member with no control would be
    // a state the design does not describe.
    expect(readParty(withParty('vera', 'companion'), 'vera')).toBe('companion');
    expect(readParty(withParty('vera', 'auto'), 'vera')).toBe('auto');
  });

  it("always contains the persona, which is the reader's invariant", () => {
    // Rule 1, answered here rather than by an effect nobody could have written:
    // a session is created before its first turn.
    expect(readParty({}, 'ned', 'ned')).toBe('player');
  });

  it('lets the story say something else about the persona', () => {
    // `companion` is a coherent thing to narrate about a character you were
    // writing. What the channel cannot express is removing them, because absence
    // means absent and rule 1 forbids the persona being absent.
    expect(readParty(withParty('ned', 'companion'), 'ned', 'ned')).toBe('companion');
  });

  it('reads a control it does not know as no membership', () => {
    // The schema refuses one on the way in; a hand-edited file is the path that
    // gets past it, and `null` is the answer that makes the panel say nothing
    // rather than invent a word for it.
    expect(readParty(withParty('vera', 'regent'), 'vera')).toBeNull();
    expect(readParty(withParty('vera', 7), 'vera')).toBeNull();
  });

  it('puts somebody in the panel on a party effect alone', () => {
    // `actorsWithState` matches on the key, so a character the story has only
    // ever said a party thing about is still one this story is about.
    expect([...actorsWithState(withParty('vera', 'companion'))]).toEqual(['vera']);
  });

  it('marks the row, and marks most rows with nothing', () => {
    const rows = castRows(
      { persona: 'ned', actors: ['vera', 'lund'] },
      withParty('vera', 'companion'),
      [],
    );

    expect(rows.map((row) => [row.actorId, row.party])).toEqual([
      ['lund', null],
      ['ned', 'player'],
      ['vera', 'companion'],
    ]);
  });
});

/**
 * ***Presence as the mode reads it*** — [P13.3], closing what [P13.1] flagged:
 * the panel read presence as `true`-only while the speaker policy read it
 * through `castIsPresent`, so a Scene member nobody had muted spoke every turn
 * and showed on the panel as absent.
 */
describe('the cast panel under castIsPresent', () => {
  const muted = { [channelKey(SE_PRESENCE, 'lund')]: { value: false } };

  it('shows a member nobody has said anything about as present, and a muted one as not', () => {
    const rows = castRows({ persona: null, actors: ['vera', 'lund'] }, muted, [], true);

    expect(rows.map((row) => [row.actorId, row.presence])).toEqual([
      ['lund', false],
      ['vera', true],
    ]);
  });

  /**
   * ***The quarantine's reset is not a mute*** (2026-09-29, the [P13.3]
   * review). It writes the channel's `init: false`, which under this reading
   * is *muted* — so a member whose presence a hand edit had mangled left every
   * call, a decision nobody made. The `degraded` marker the reset carries is
   * how the reader tells it from a person's `false`.
   */
  describe('a quarantined value', () => {
    beforeEach(async () => {
      await installBuiltIns();
    });

    const key = channelKey(SE_PRESENCE, 'lund');
    const reset = () => {
      const mangled = { [key]: { version: 1, value: 'yes' } };
      return applyEffects(mangled, quarantineEffects('t-1', mangled));
    };

    it('reads as nobody-said-anything under castIsPresent: present', () => {
      const after = reset();

      expect(after[key]?.value).toBe(false);
      expect(after[key]?.degraded).toBeDefined();
      expect(readPresence(after, 'lund', true)).toBe(true);
    });

    it('reads as the reset it is where absent is absent', () => {
      expect(readPresence(reset(), 'lund')).toBe(false);
    });

    it('leaves a person’s own false muted', () => {
      expect(readPresence(muted, 'lund', true)).toBe(false);
    });
  });

  it('reads presence as it always did for a mode that does not declare it', () => {
    const rows = castRows({ persona: null, actors: ['vera', 'lund'] }, muted, []);

    expect(rows.map((row) => [row.actorId, row.presence])).toEqual([
      ['lund', false],
      ['vera', false],
    ]);
  });
});

describe('the party deferral', () => {
  beforeEach(async () => {
    await installBuiltIns();
  });

  it('holds only while `select` has one arm, and says what to do when it does not', async () => {
    const { PARTICIPANT_SELECTORS } = await import('@storyengine/sdk');
    /**
     * **Widened on purpose, and the lint rule objecting is the point.**
     * `no-unnecessary-condition` is right that `PARTICIPANT_SELECTORS[0] ===
     * 'fixed'` is statically true *today* — which is exactly the state this
     * test exists to notice changing. Reading it as `readonly string[]` asks the
     * question at run time, where the answer is allowed to differ from the one
     * the type system has already decided.
     */
    const selectors: readonly string[] = PARTICIPANT_SELECTORS;
    const licensed = selectors.length === 1 && selectors[0] === 'fixed';

    const party = channelDefinition('se.party');
    const sessionTypes = await readFile(new URL('./types.ts', import.meta.url), 'utf8');
    // The field the licence pays for, read from the declaration rather than
    // inferred: `ci-shape.test.ts`'s argument for scanning text applies here
    // too — a TypeScript field is not visible at run time, and the alternative
    // is no check at all.
    const castActors = /cast\?:\s*\{[^}]*actors/.test(sessionTypes);

    /**
     * **The roster stays, in both branches** — [P7.3], 2026-09-12, and this is
     * the clause that changed direction. It used to read `toBe(false)` on the
     * expired side. The header says why; the short form is that `se.presence`'s
     * `init: false` makes *elsewhere* and *not in this story* the same value, so
     * there is no channel for a roster to move into. Asserted rather than
     * deleted, because the withdrawn obligation is still written down in §1.6's
     * original sentence and this is what stops somebody acting on it.
     */
    expect(
      castActors,
      '`cast.actors` is the roster and stays a field — [P7.3] over [P7 §1.6]. ' +
        'It is a link like `treatment` and `lore`; what is story state (who is ' +
        'here, who is alive) moved to channels at [P7.2] and branches. The one ' +
        'source of truth is `resolveCast` reading both — see turns/cast.test.ts.',
    ).toBe(true);

    if (licensed) {
      expect(
        party,
        'se.party is registered while `select` is still `fixed` — which is the ' +
          'placeholder-shaped channel [P2 §2.7] rejected. Either widen ' +
          '`PARTICIPANT_SELECTORS` or drop the channel.',
      ).toBeNull();
      return;
    }

    /**
     * **The licence has expired and two things come due together** — [P7 §1.6]
     * and [10 §13.2]. Named in one message because they are one change: a party
     * channel to say who is travelling with you, and the panel marking those
     * members rather than keeping a second list. *Party membership is a subset
     * of the roster, not a rival to it — [06 §8.1] spends a paragraph refusing
     * that conflation, and 10 §13.2's "introduces no parallel membership
     * concept" is satisfied by marking a subset.*
     */
    expect(
      party,
      '`select` has gained a second arm, so the `fixed` licence has expired and ' +
        '`se.party` is now owed: declare it in sessions/cast.ts beside presence ' +
        'and status, keyed by TurnId per [06 §8] and never by ordinal.',
    ).not.toBeNull();
    expect(
      Object.keys(castRows(undefined, {}, [])[0] ?? { party: undefined }),
      'CastRow must carry `party` so the panel can mark members distinctly ' +
        'rather than keeping a second list — [10 §13.2].',
    ).toContain('party');
  });
});
