// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { beforeEach, describe, expect, it } from 'vitest';

import {
  newActor,
  newLorebook,
  newTreatment,
  type Actor,
  type Lorebook,
  type Preset,
  type PresetBlock,
  type OutputMessage,
  type Treatment,
  type WritingSample,
} from '@storyengine/shared';

import { DIALS_PRESET, TEST_PRESET } from '../test-mode.js';
import { resolveLevel } from '../sessions/dials.js';
import { installBuiltIns } from '../mode-loader.js';
import { DEFAULT_MODE_ID, modeById } from '../mode-registry.js';
import {
  channelKey,
  registerChannel,
  SE_CLOCK,
  SE_LORE_TIMING,
  type ChannelDefinition,
} from '../sessions/channels.js';
import type { SummaryLink } from '../sessions/summary-chain.js';
import type { Turn } from '../sessions/types.js';
import { assemble, type BudgetPolicy } from './assemble.js';
import type { LoreBlock } from '../retrieval/blocks.js';
import { collectCandidates, type CollectContext, type SampleCarriers } from './collect.js';

/**
 * Step 1 of [06 §5] — collect, the preset-to-prompt mapping.
 *
 * This file exists because an audit measured its absence: five of the
 * collector's guards could each be deleted with the entire suite green, and the
 * worst of them is the one the collector's own commit argues *is* [06 §5.2]'s
 * structural firewall. Every test below is written to fail when its mechanism is
 * removed — which for the advisory rule means testing it with a preset that does
 * **not** declare the flag, since the shipped one satisfies both halves of the
 * union and therefore falsifies neither.
 */

const GENEROUS: BudgetPolicy = {
  limit: { tokens: 100_000, ceiling: 100_000, source: 'user' },
  reserved: 0,
};

function block(over: Partial<PresetBlock> & Pick<PresetBlock, 'kind'>): PresetBlock {
  return {
    id: 'se.test',
    label: 'test',
    role: 'system',
    enabled: true,
    placement: { at: 'sequence' },
    priority: 50,
    appliesTo: [],
    advisory: false,
    omitWhenEmpty: true,
    ...(over.kind === 'text' ? { template: '' } : { source: { of: 'history' } }),
    ...over,
  } as PresetBlock;
}

function preset(blocks: PresetBlock[]): Preset {
  return { ...TEST_PRESET, blocks };
}

function context(over: Partial<CollectContext> = {}): CollectContext {
  return {
    preset: preset([]),
    callKind: 'narrate',
    history: [],
    persona: null,
    actors: [],
    channels: {},
    modeId: DEFAULT_MODE_ID,
    ...over,
  };
}

function actorWith(name: string, body: string): Actor {
  const actor = newActor(name);
  return {
    ...actor,
    profile: {
      ...actor.profile,
      traits: ['watchful'],
      sections: actor.profile.sections.map((section) =>
        section.id === 'se.summary' ? { ...section, body } : section,
      ),
    },
  };
}

describe('the previous attempt is the second advisory slot', () => {
  // [06 §5.1]: a guided redo shows the model the attempt it is redoing. Tested
  // under the same rule as guidance — a preset declaring `advisory: false` —
  // because the shipped preset sets it true and would falsify nothing.
  const ATTEMPT = { turnId: 't-first', text: 'He did not look up.' };

  it('fills the text, applies the wrapper, and names the turn it came from', () => {
    const { candidates } = collectCandidates(
      context({
        preset: preset([
          block({
            kind: 'slot',
            id: 'se.attempt',
            source: { of: 'attempt' },
            wrapper: 'Previously:\n\n{{content}}',
          }),
        ]),
        attempt: ATTEMPT,
      }),
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.text).toBe('Previously:\n\nHe did not look up.');
    // The id is what makes *which attempt* answerable from the record; the
    // falsifying mutation is stamping null unconditionally, or reading the
    // guidance text into this slot.
    expect(candidates[0]?.source).toEqual({ kind: 'attempt', turnId: 't-first' });
  });

  it('marks it advisory even when the preset says not to, and the effects call refuses it', () => {
    const { candidates } = collectCandidates(
      context({
        preset: preset([
          block({ kind: 'slot', id: 'se.attempt', source: { of: 'attempt' }, advisory: false }),
        ]),
        attempt: ATTEMPT,
      }),
    );

    expect(candidates[0]?.advisory).toBe(true);
    // Dropping `'attempt'` from `emit()`'s forced union is the mutation: the
    // block would then walk the model's own discarded reply into an extractor.
    expect(() => assemble({ candidates, policy: GENEROUS, purpose: 'effects' })).toThrow(
      /Advisory block/,
    );
  });

  it('records an empty slot as empty-source when there is no attempt to show', () => {
    const { candidates, notFilled } = collectCandidates(
      context({
        preset: preset([block({ kind: 'slot', id: 'se.attempt', source: { of: 'attempt' } })]),
      }),
    );

    expect(candidates).toHaveLength(0);
    // `unknown-slot` is what a missing `emptyReason` arm reads — which would
    // tell an author their preset names a slot this build has not heard of.
    expect(notFilled).toEqual([
      { blockId: 'se.attempt', source: 'attempt', reason: 'empty-source' },
    ]);
  });

  it('records null for the turn when a preset emits the slot over nothing', () => {
    // The persona claim, one slot over: the author asked for the block, and
    // there was no attempt.
    const { candidates } = collectCandidates(
      context({
        preset: preset([
          block({
            kind: 'slot',
            id: 'se.attempt',
            source: { of: 'attempt' },
            omitWhenEmpty: false,
          }),
        ]),
      }),
    );
    expect(candidates[0]?.source).toEqual({ kind: 'attempt', turnId: null });
  });
});

/**
 * ***One slot, several producers*** — [06 §5.1], with the second one at last
 * ([06 §6.1], [P7.5]).
 *
 * That section names the user's box, an authored rule's `giveGuidance` and a
 * step such as a Narrative Director push; the plot-hook selector is the fourth,
 * and the first to arrive. **[P7 §1.5] read this as blocked** — *"the guidance
 * slot cannot position a step's block"* — and the half that was true is that a
 * step's own candidate arrives at the end of the prompt. The slot was never the
 * obstacle: it had one producer, and it was always specified to take several.
 */
describe('the guidance slot takes more than one producer', () => {
  it('emits a fired hook beside the user’s own words, in the slot’s place', () => {
    const { candidates } = collectCandidates(
      context({
        preset: preset([block({ kind: 'slot', id: 'se.guidance', source: { of: 'guidance' } })]),
        guidance: 'keep this short',
        hookGuidance: 'Weave this in: the Flower Kingdom declares war.',
      }),
    );

    expect(candidates.map((candidate) => candidate.source)).toEqual([
      { kind: 'guidance', producer: 'user' },
      { kind: 'guidance', producer: 'step' },
    ]);
    // Distinct ids, because two candidates at one slot cannot share one — and it
    // is the new arm that takes the suffix: the user's block has carried the
    // bare block id since P2 and it is in records already written.
    expect(candidates.map((candidate) => candidate.id)).toEqual([
      'se.guidance',
      'se.guidance.hook',
    ]);
    // Advisory is forced for both, and forcing keys on the *slot* rather than on
    // the producer — which is what makes a hook's guidance guidance ([06 §5.2]).
    expect(candidates.every((candidate) => candidate.advisory === true)).toBe(true);
  });

  it('wraps the hook’s words the way it wraps the box’s', () => {
    const { candidates } = collectCandidates(
      context({
        preset: preset([
          block({
            kind: 'slot',
            id: 'se.guidance',
            source: { of: 'guidance' },
            wrapper: 'Note: {{content}}',
          }),
        ]),
        hookGuidance: 'the Flower Kingdom declares war',
      }),
    );

    // One, not two: the box was empty and `omitWhenEmpty` dropped it. The hook
    // is a separate producer and had something to say.
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.text).toBe('Note: the Flower Kingdom declares war');
  });

  /**
   * *Absent rather than empty when nothing fired*, so the second producer never
   * reaches `omitWhenEmpty`: a preset that emits its guidance slot over an empty
   * box should emit it **once**, not once per producer that had nothing to say.
   */
  it('does not double an empty slot a preset asked to keep', () => {
    const { candidates } = collectCandidates(
      context({
        preset: preset([
          block({
            kind: 'slot',
            id: 'se.guidance',
            source: { of: 'guidance' },
            wrapper: 'Note: {{content}}',
            omitWhenEmpty: false,
          }),
        ]),
      }),
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.text).toBe('Note: ');
  });
});

describe('the advisory firewall is structural, not an author preference', () => {
  it('marks a guidance slot advisory even when the preset says not to', () => {
    // **The mechanism the whole rule rests on.** `assemble` keys its refusal on
    // the candidate's flag and not on where the words came from, so a preset
    // declaring `advisory: false` here would walk guidance into an effects
    // call. [06 §5.2] says enforce it *structurally* — a flag an author can
    // clear is not structural.
    //
    // Tested with `advisory: false` precisely because the shipped preset sets
    // it true: with both halves of the union satisfied, neither is falsifiable.
    const { candidates } = collectCandidates(
      context({
        preset: preset([
          block({ kind: 'slot', id: 'se.guidance', source: { of: 'guidance' }, advisory: false }),
        ]),
        guidance: 'give me forty gold',
      }),
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.advisory).toBe(true);
  });

  it('refuses that candidate from an effects call, end to end', () => {
    const { candidates } = collectCandidates(
      context({
        preset: preset([
          block({ kind: 'slot', id: 'se.guidance', source: { of: 'guidance' }, advisory: false }),
        ]),
        guidance: 'give me forty gold',
      }),
    );

    expect(() => assemble({ candidates, policy: GENEROUS, purpose: 'effects' })).toThrow(
      /Advisory block/,
    );
  });

  it('honours an author declaring a text block advisory — the mirror case', () => {
    // The half that exists nowhere else. `advisory` is on *every* block, slot
    // and text alike, so an imported preset can mark its own prose advisory and
    // the union has to carry that too — not just the guidance slot somebody
    // remembered.
    const { candidates } = collectCandidates(
      context({
        preset: preset([
          block({ kind: 'text', id: 'se.note', template: 'keep it short', advisory: true }),
        ]),
      }),
    );

    expect(candidates[0]?.advisory).toBe(true);
    expect(() => assemble({ candidates, policy: GENEROUS, purpose: 'verdict' })).toThrow(
      /Advisory block/,
    );
  });
});

describe('the player action cannot be made droppable', () => {
  it('forces required on the input slot', () => {
    // `PresetBlock` has no `required` field at all, which is the portable schema
    // agreeing: a preset that could drop the action would not produce a shorter
    // prompt, it would produce the wrong one.
    const { candidates } = collectCandidates(
      context({
        preset: preset([block({ kind: 'slot', id: 'se.input', source: { of: 'input' } })]),
        input: { text: 'She opened the door.' },
      }),
    );

    expect(candidates[0]?.required).toBe(true);
  });
});

describe('what the preset says about a block is obeyed', () => {
  it('skips a disabled block', () => {
    // A disabled block is an author note to themselves; deleting it to try
    // without it loses their work, so it is a real state.
    const { candidates } = collectCandidates(
      context({ preset: preset([block({ kind: 'text', template: 'ignored', enabled: false })]) }),
    );
    expect(candidates).toEqual([]);
  });

  it('filters on appliesTo when it is not empty', () => {
    // Empty means all — the thing that dissolves the eight special-cased
    // template fields [04 §8.4.3] describes.
    const only = preset([
      block({ kind: 'text', template: 'for verdicts', appliesTo: ['verdict'] }),
    ]);

    expect(collectCandidates(context({ preset: only, callKind: 'narrate' })).candidates).toEqual(
      [],
    );
    expect(
      collectCandidates(context({ preset: only, callKind: 'verdict' })).candidates,
    ).toHaveLength(1);
  });

  it('drops an empty slot when omitWhenEmpty, and keeps it when not', () => {
    // Read literally: drop the block rather than emit a heading with nothing
    // under it. False is an author explicit choice and occasionally right.
    const dropped = preset([
      block({ kind: 'slot', source: { of: 'guidance' }, wrapper: 'Note: {{content}}' }),
    ]);
    const kept = preset([
      block({
        kind: 'slot',
        source: { of: 'guidance' },
        wrapper: 'Note: {{content}}',
        omitWhenEmpty: false,
      }),
    ]);

    expect(collectCandidates(context({ preset: dropped })).candidates).toEqual([]);
    expect(collectCandidates(context({ preset: kept })).candidates[0]?.text).toBe('Note: ');
  });

  it('substitutes the wrapper around filled content', () => {
    const { candidates } = collectCandidates(
      context({
        preset: preset([
          block({ kind: 'slot', source: { of: 'input' }, wrapper: 'Action: {{content}}' }),
        ]),
        input: { text: 'She waited.' },
      }),
    );
    expect(candidates[0]?.text).toBe('Action: She waited.');
  });

  /**
   * Both halves of the P4.0 wrapper fix, and each is a silent-failure class the
   * imported corpus is the first thing likely to produce.
   *
   * A wrapper naming `{{content}}` twice is legal — ST's `scenario_format` and
   * `wi_format` are format strings and nothing stops one repeating the
   * placeholder — and the first-occurrence-only substitution left the second
   * pair of braces in the prompt.
   */
  it('fills every occurrence of the placeholder, not only the first', () => {
    const { candidates } = collectCandidates(
      context({
        preset: preset([
          block({ kind: 'slot', source: { of: 'input' }, wrapper: '{{content}} — {{content}}' }),
        ]),
        input: { text: 'She waited.' },
      }),
    );
    expect(candidates[0]?.text).toBe('She waited. — She waited.');
  });

  /**
   * The one that bites hardest, because the corrupted output still looks like
   * prose. `$&` in a *string* replacement means "the matched substring", so
   * imported text containing it used to splice `{{content}}` back into the
   * result. The filled value is data and must be inserted literally, whatever
   * characters an author happened to type.
   */
  it('inserts filled text literally, even when it contains replacement patterns', () => {
    const { candidates } = collectCandidates(
      context({
        preset: preset([
          block({ kind: 'slot', source: { of: 'input' }, wrapper: 'Action: {{content}}' }),
        ]),
        input: { text: "Cost: $& and $1 and $` and $'" },
      }),
    );
    expect(candidates[0]?.text).toBe("Action: Cost: $& and $1 and $` and $'");
  });

  it('carries the author-facing label through as the reason', () => {
    // [06 §5]: the reason is a product feature, not a debug string — it is what
    // the workbench shows when somebody asks why a block is in the prompt.
    const { candidates } = collectCandidates(
      context({
        preset: preset([block({ kind: 'text', template: 'x', label: 'the narrator brief' })]),
      }),
    );
    expect(candidates[0]?.reason).toBe('the narrator brief');
  });
});

describe('the cast fills the slots that were unreachable', () => {
  const persona = {
    actor: actorWith('Ned', 'Ned keeps the rain off other people.'),
    contentHash: 'sha256:ned-1',
  };
  const vera = {
    actor: actorWith('Vera', 'Vera runs the night desk.'),
    contentHash: 'sha256:vera-1',
  };
  const marlow = {
    actor: actorWith('Marlow', 'Marlow owes somebody money.'),
    contentHash: 'sha256:marlow-1',
  };

  it('joins the persona sections that are always shown, and says which actor they were', () => {
    const { candidates } = collectCandidates(
      context({ preset: preset([block({ kind: 'slot', source: { of: 'persona' } })]), persona }),
    );
    expect(candidates[0]?.text).toContain('Ned keeps the rain off other people.');
    // The enriched source since [P3.0]: the persona is an actor too, and the
    // hash addresses the bytes that were used. The falsifying mutation is
    // stamping the nulls unconditionally in the collector's persona arm.
    expect(candidates[0]?.source).toEqual({
      kind: 'persona',
      actorId: persona.actor.id,
      contentHash: 'sha256:ned-1',
    });
  });

  it('records null for a session with no persona, which is data and not an omission', () => {
    const { candidates } = collectCandidates(
      context({
        preset: preset([block({ kind: 'slot', source: { of: 'persona' }, omitWhenEmpty: false })]),
        persona: null,
      }),
    );
    expect(candidates[0]?.source).toEqual({ kind: 'persona', actorId: null, contentHash: null });
  });

  it('emits one candidate per actor, so the budgeter can drop one and keep another', () => {
    const { candidates } = collectCandidates(
      context({
        preset: preset([
          block({ kind: 'slot', id: 'se.a', source: { of: 'actor', sectionId: 'se.summary' } }),
        ]),
        actors: [vera, marlow],
      }),
    );

    expect(candidates).toHaveLength(2);
    expect(candidates.map((each) => each.id)).toEqual([
      `se.a.${vera.actor.id}`,
      `se.a.${marlow.actor.id}`,
    ]);
    expect(candidates[0]?.source).toMatchObject({
      kind: 'actor',
      actorId: vera.actor.id,
      contentHash: 'sha256:vera-1',
    });
  });

  it('renders traits and refuses to invent a rendering for visual', () => {
    // `visual` is structured data for an image pipeline ([04 §4]) with no prose
    // renderer specified — emitting something would be inventing a format.
    const { candidates: traits } = collectCandidates(
      context({
        preset: preset([block({ kind: 'slot', source: { of: 'actor', field: 'traits' } })]),
        actors: [vera],
      }),
    );
    const { candidates: visual } = collectCandidates(
      context({
        preset: preset([block({ kind: 'slot', source: { of: 'actor', field: 'visual' } })]),
        actors: [vera],
      }),
    );

    expect(traits[0]?.text).toBe('watchful');
    expect(visual).toEqual([]);
  });
});

describe('history is splittable from the start', () => {
  const turn = (n: number): Turn => ({
    id: `t${String(n)}`,
    sessionId: 's',
    parentTurnId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    status: 'complete',
    input: { actorId: null, kind: 'do', text: `in ${String(n)}`, raw: '' },
    output: { text: `out ${String(n)}` },
    effects: [],
    tape: [],
  });

  /**
   * **Two candidates per turn, and the roles are the point** — F36.
   *
   * A completed turn used to be one block labelled `assistant` holding the
   * input and the output joined by a newline, so **every message the player had
   * ever typed was attributed to the model** and a provider saw one long
   * assistant monologue. Invisible on screen; visible only on the wire.
   */
  it('emits the player’s words and the model’s as separate messages', () => {
    const { candidates } = collectCandidates(
      context({
        preset: preset([
          block({ kind: 'slot', id: 'se.h', source: { of: 'history' }, priority: 10 }),
        ]),
        history: [turn(1), turn(2)],
      }),
    );

    expect(candidates.map((candidate) => [candidate.role, candidate.text])).toEqual([
      ['user', 'in 1'],
      ['assistant', 'out 1'],
      ['user', 'in 2'],
      ['assistant', 'out 2'],
    ]);
  });

  it('keeps a turn together in the budgeter’s ordering, oldest cheapest', () => {
    const { candidates } = collectCandidates(
      context({
        preset: preset([
          block({ kind: 'slot', id: 'se.h', source: { of: 'history' }, priority: 10 }),
        ]),
        history: [turn(1), turn(2), turn(3)],
      }),
    );

    // One priority per turn, not per message: a turn is one unit to drop, and
    // the sort's tie-break — later-listed first — then takes the *reply* before
    // the prompt it answered, which leaves two user messages in a row rather
    // than an assistant message with nothing before it.
    expect(candidates[0]?.priority).toBe(candidates[1]?.priority);
    expect(candidates[0]?.priority).toBeLessThan(candidates[2]?.priority ?? 0);
  });

  it('leaves out a half that is not there', () => {
    // Built without the key rather than with an undefined one, which
    // `exactOptionalPropertyTypes` correctly refuses.
    const pending: Turn = turn(1);
    delete pending.output;
    const { candidates } = collectCandidates(
      context({
        preset: preset([block({ kind: 'slot', id: 'se.h', source: { of: 'history' } })]),
        history: [pending],
      }),
    );

    // A turn still running has an input and no output, and an empty assistant
    // message is not a thing to send.
    expect(candidates.map((candidate) => candidate.role)).toEqual(['user']);
  });

  /**
   * [P3.0]: the identity is the turn, not the window position. A block id
   * keyed by the window index names a different turn every twenty turns,
   * which is what made any block-keyed comparison wrong from turn twenty-one
   * onward. The falsifying mutation is restoring `${index}` in the id and the
   * range-only source.
   */
  it('keys a history block by the turn, wherever the window put it', () => {
    const seventh = turn(7);
    const slot = preset([block({ kind: 'slot', id: 'se.h', source: { of: 'history' } })]);
    const { candidates: wide } = collectCandidates(
      context({ preset: slot, history: [turn(1), seventh] }),
    );
    const { candidates: narrow } = collectCandidates(context({ preset: slot, history: [seventh] }));

    const inWide = wide.find((candidate) => candidate.text === 'in 7');
    const inNarrow = narrow.find((candidate) => candidate.text === 'in 7');
    expect(inWide?.id).toBe('se.h.t7.input');
    expect(inNarrow?.id).toBe('se.h.t7.input');
    // The source carries the identity beside the window position, so a reader
    // can say *which turn* and *where it sat* without conflating the two.
    expect(inWide?.source).toMatchObject({ kind: 'history', turnId: 't7', range: [1, 1] });
    expect(inNarrow?.source).toMatchObject({ kind: 'history', turnId: 't7', range: [0, 0] });
  });
});

describe('a slot that collected nothing is on the record', () => {
  /**
   * [P3.0]'s §7.5 decision, one case per reason class. On the only real turn
   * measured before this existed, ten of twelve blocks left no row and the
   * panel could not answer *why is there no lore in this prompt*. Each case's
   * falsifying mutation is deleting the recording line in its branch of
   * `collectCandidates` (or the class arm in `emptyReason`).
   */
  it('records disabled, not-applicable, no-producer, empty-source and unknown-slot', () => {
    const { candidates, notFilled } = collectCandidates(
      context({
        preset: preset([
          block({ kind: 'text', id: 'se.off', template: 'x', enabled: false }),
          block({ kind: 'text', id: 'se.elsewhere', template: 'x', appliesTo: ['verdict'] }),
          block({ kind: 'slot', id: 'se.lore', source: { of: 'lore', phase: 'before' } }),
          block({ kind: 'slot', id: 'se.guidance', source: { of: 'guidance' } }),
          block({
            kind: 'slot',
            id: 'se.weather',
            source: { of: 'weather' } as unknown as { of: 'history' },
          }),
          block({ kind: 'text', id: 'se.kept', template: 'still here' }),
        ]),
      }),
    );

    expect(candidates.map((candidate) => candidate.id)).toEqual(['se.kept']);
    expect(notFilled).toEqual([
      { blockId: 'se.off', source: 'preset', reason: 'disabled' },
      { blockId: 'se.elsewhere', source: 'preset', reason: 'not-applicable' },
      { blockId: 'se.lore', source: 'lore', reason: 'no-producer' },
      { blockId: 'se.guidance', source: 'guidance', reason: 'empty-source' },
      { blockId: 'se.weather', source: 'weather', reason: 'unknown-slot' },
    ]);
  });

  it('does not list a slot that filled', () => {
    const { notFilled } = collectCandidates(
      context({
        preset: preset([block({ kind: 'slot', id: 'se.input', source: { of: 'input' } })]),
        input: { text: 'She waited.' },
      }),
    );
    expect(notFilled).toEqual([]);
  });
});

describe('a preset from a newer build', () => {
  it('ignores a slot kind this build does not know, rather than throwing', () => {
    // The shared Ajv preserves unknown fields, so a preset written against a
    // later schema validates and arrives here. Refusing it would make one
    // unknown slot cost somebody their whole session.
    const { candidates } = collectCandidates(
      context({
        preset: preset([
          block({ kind: 'slot', source: { of: 'weather' } as unknown as { of: 'history' } }),
          block({ kind: 'text', id: 'se.after', template: 'still here' }),
        ]),
      }),
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.text).toBe('still here');
  });
});

describe('in-history placement, which is the one that is not list order', () => {
  const turn = (n: number): Turn => ({
    id: `t${String(n)}`,
    sessionId: 's',
    parentTurnId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    status: 'complete',
    input: { actorId: null, kind: 'do', text: `in ${String(n)}`, raw: '' },
    output: { text: `out ${String(n)}` },
    effects: [],
    tape: [],
  });

  // Two turns, four messages — enough to place a note between them and short
  // enough that the expectation reads as a conversation.
  const history = [turn(1), turn(2)];

  function ids(depth: number, tiebreak?: number): string[] {
    return collectCandidates(
      context({
        preset: preset([
          block({ kind: 'slot', id: 'se.h', source: { of: 'history' } }),
          block({
            kind: 'text',
            id: 'se.note',
            template: 'a note',
            placement:
              tiebreak === undefined
                ? { at: 'in-history', fromEnd: depth }
                : { at: 'in-history', fromEnd: depth, tiebreak },
          }),
        ]),
        history,
      }),
    ).candidates.map((candidate) => candidate.id);
  }

  /**
   * **Depth counts messages, and after F36 it finally does.**
   *
   * SillyTavern's depth injection is exactly this and its files carry the
   * depths, so an imported preset depends on the reading being right — and its
   * depths are in *messages*. While a completed turn was one block, a depth of
   * four landed four **turns** back, which is eight messages: every imported
   * preset's author notes were placed twice as deep as written.
   *
   * Splitting history by speaker fixed that as a side effect, and these
   * expectations move with it. The ids now name the half as well as the turn.
   */
  it('puts a depth-zero block after the newest message', () => {
    expect(ids(0)).toEqual([
      'se.h.t1.input',
      'se.h.t1.output',
      'se.h.t2.input',
      'se.h.t2.output',
      'se.note',
    ]);
  });

  it('puts a depth-two block two messages from the end', () => {
    // Which is the case that was silently flattened: with `placement` unread,
    // this landed at the end regardless of the depth the author wrote — and
    // then, once read, at twice the depth.
    expect(ids(2)).toEqual([
      'se.h.t1.input',
      'se.h.t1.output',
      'se.note',
      'se.h.t2.input',
      'se.h.t2.output',
    ]);
  });

  it('clamps a depth deeper than the history it has', () => {
    // A preset written for a longer transcript means "as early as possible",
    // not "outside the run".
    expect(ids(99)).toEqual([
      'se.note',
      'se.h.t1.input',
      'se.h.t1.output',
      'se.h.t2.input',
      'se.h.t2.output',
    ]);
  });

  it('breaks a tie by the number the author wrote, then by declaration order', () => {
    const both = collectCandidates(
      context({
        preset: preset([
          block({ kind: 'slot', id: 'se.h', source: { of: 'history' } }),
          block({
            kind: 'text',
            id: 'se.second',
            template: 'b',
            placement: { at: 'in-history', fromEnd: 1, tiebreak: 20 },
          }),
          block({
            kind: 'text',
            id: 'se.first',
            template: 'a',
            placement: { at: 'in-history', fromEnd: 1, tiebreak: 10 },
          }),
        ]),
        history,
      }),
    ).candidates.map((candidate) => candidate.id);

    // Declared second but numbered lower, so it goes first — dropping the
    // number would reorder somebody's prompt with nothing to show for it.
    expect(both.indexOf('se.first')).toBeLessThan(both.indexOf('se.second'));
  });

  /**
   * ***Two depths, each where it was asked for*** (2026-09-27). Every test
   * above places one block, which is the one case the bug could not show. The
   * deeper run went in first, at an earlier index, and pushed the history
   * after it along; the shallower run's index was counted against the history
   * as it had been, so it landed as many messages too deep as the deeper run
   * was long. Three and one came out as three and two — an imported preset's
   * author's note and its jailbreak, say, each quietly one message off. The
   * falsifying mutation is dropping the running offset.
   */
  function placed(...depths: { id: string; fromEnd: number }[]): string[] {
    return collectCandidates(
      context({
        preset: preset([
          block({ kind: 'slot', id: 'se.h', source: { of: 'history' } }),
          ...depths.map(({ id, fromEnd }) =>
            block({ kind: 'text', id, template: id, placement: { at: 'in-history', fromEnd } }),
          ),
        ]),
        history,
      }),
    ).candidates.map((candidate) => candidate.id);
  }

  it('places two depths each at its own depth', () => {
    expect(placed({ id: 'se.shallow', fromEnd: 1 }, { id: 'se.deep', fromEnd: 3 })).toEqual([
      'se.h.t1.input',
      'se.deep',
      'se.h.t1.output',
      'se.h.t2.input',
      'se.shallow',
      'se.h.t2.output',
    ]);
  });

  it('keeps the deeper first when both are clamped to the start', () => {
    // Both are past the start of a four-message history, so both mean *as
    // early as possible* — and the one written deeper is still the earlier.
    // Before the offset the second insertion went in ahead of the first, and
    // the pair came out reversed.
    expect(placed({ id: 'se.shallow', fromEnd: 5 }, { id: 'se.deep', fromEnd: 99 })).toEqual([
      'se.deep',
      'se.shallow',
      'se.h.t1.input',
      'se.h.t1.output',
      'se.h.t2.input',
      'se.h.t2.output',
    ]);
  });

  it('appends the deeper first when there is no history to be inside', () => {
    // Why the runs still go in deepest first, when an offset would let them go
    // in any order: with nothing to splice into they are appended, and there
    // the order of going in is the order they come out.
    const appended = collectCandidates(
      context({
        preset: preset([
          block({ kind: 'slot', id: 'se.input', source: { of: 'input' } }),
          block({
            kind: 'text',
            id: 'se.shallow',
            template: 'b',
            placement: { at: 'in-history', fromEnd: 1 },
          }),
          block({
            kind: 'text',
            id: 'se.deep',
            template: 'a',
            placement: { at: 'in-history', fromEnd: 3 },
          }),
        ]),
        input: { text: 'She waited.' },
      }),
    ).candidates.map((candidate) => candidate.id);

    expect(appended).toEqual(['se.input', 'se.deep', 'se.shallow']);
  });

  it('falls to the end when there is no history to be inside', () => {
    const none = collectCandidates(
      context({
        preset: preset([
          block({ kind: 'slot', id: 'se.input', source: { of: 'input' } }),
          block({
            kind: 'text',
            id: 'se.note',
            template: 'a note',
            placement: { at: 'in-history', fromEnd: 2 },
          }),
        ]),
        input: { text: 'She waited.' },
      }),
    ).candidates.map((candidate) => candidate.id);

    expect(none).toEqual(['se.input', 'se.note']);
  });
});

describe('writing samples, which are shown rather than described', () => {
  function withSamples(name: string, samples: Partial<WritingSample>[]): Actor {
    const actor = newActor(name);
    return {
      ...actor,
      writingSamples: samples.map((over, index) => ({
        id: `s${String(index)}`,
        title: `sample ${String(index)}`,
        body: `prose ${String(index)}`,
        enabled: true,
        note: '',
        ...over,
      })),
    };
  }

  function samplesBlock(over: Partial<PresetBlock> = {}): PresetBlock {
    return block({
      kind: 'slot',
      id: 'se.samples',
      label: 'writing samples',
      priority: 20,
      source: { of: 'samples' },
      ...over,
    });
  }

  const cast = (...actors: Actor[]): CollectContext['actors'] =>
    actors.map((actor) => ({ actor, contentHash: `hash-${actor.name}` }));

  it('emits one candidate per sample rather than one per actor', () => {
    // **The choice that makes a per-sample priority mean anything.** One block
    // for all of an actor's samples would leave the budgeter with a single
    // move — drop every sample — and a person who pasted three would rather
    // lose one. Mutation: join the bodies into a single `emit` and the length
    // falls to 1.
    const { candidates } = collectCandidates(
      context({
        preset: preset([samplesBlock()]),
        actors: cast(withSamples('Vera', [{}, {}, {}])),
      }),
    );

    expect(candidates).toHaveLength(3);
    expect(candidates.map((candidate) => candidate.text)).toEqual([
      'prose 0',
      'prose 1',
      'prose 2',
    ]);
    // Ids stay addressable per sample, so a block survives a reorder.
    expect(candidates.map((candidate) => candidate.id)).toEqual([
      expect.stringContaining('.s0'),
      expect.stringContaining('.s1'),
      expect.stringContaining('.s2'),
    ]);
  });

  it('skips a disabled sample entirely rather than budgeting it away', () => {
    // `enabled: false` is a draft the author is still deciding about, not a
    // budget casualty: it must cost nothing and appear nowhere, including in
    // the block table. Mutation: drop the `.filter` and the length becomes 2.
    const { candidates } = collectCandidates(
      context({
        preset: preset([samplesBlock()]),
        actors: cast(withSamples('Vera', [{ enabled: false }, { body: 'kept' }])),
      }),
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.text).toBe('kept');
  });

  it("lets a sample's own priority override the block's", () => {
    // The author's lever for ranking samples against each other, and the whole
    // reason `priority` is on the sample rather than only on the slot.
    // Mutation: pass `block` unmodified to `emit` and both come back 20.
    const { candidates } = collectCandidates(
      context({
        preset: preset([samplesBlock({ priority: 20 })]),
        actors: cast(withSamples('Vera', [{ priority: 75 }, {}])),
      }),
    );

    expect(candidates.map((candidate) => candidate.priority)).toEqual([75, 20]);
  });

  it('records which object and which sample the prose came from', () => {
    // [P3.0]: the carrier is a *link* read fresh every turn, so the id alone
    // resolves to whatever that object is now — the hash is what the gate
    // clicks through to the sample as it was actually sent. Mutation: drop
    // `contentHash` from the source and this fails.
    const actor = withSamples('Vera', [{}]);
    const { candidates } = collectCandidates(
      context({ preset: preset([samplesBlock()]), actors: cast(actor) }),
    );

    expect(candidates[0]?.source).toEqual({
      kind: 'samples',
      owner: { kind: 'actor', id: actor.id, contentHash: 'hash-Vera' },
      sampleId: 's0',
    });
  });

  it('fills only the carrier named by `from`', () => {
    // Treatment and Lorebook have no producer yet, so naming one must yield
    // nothing even when the cast is full of samples — otherwise a preset
    // asking for the setting's voice would silently get a character's.
    // Mutation: delete the early return and the actor's samples leak in.
    const actors = cast(withSamples('Vera', [{}, {}]));

    for (const from of ['treatment', 'lore'] as const) {
      const { candidates } = collectCandidates(
        context({ preset: preset([samplesBlock({ source: { of: 'samples', from } })]), actors }),
      );
      expect(candidates).toHaveLength(0);
    }

    const { candidates } = collectCandidates(
      context({
        preset: preset([samplesBlock({ source: { of: 'samples', from: 'actor' } })]),
        actors,
      }),
    );
    expect(candidates).toHaveLength(2);
  });

  /**
   * ~~separates a slot waiting on the engine from one waiting on the author~~
   *
   * **The split closed at [P5.9], and this is the test the stage said would
   * have to change deliberately.** It pinned a real distinction while the three
   * carriers were landing at different times: *waiting on the engine* and
   * *waiting on you* have different repairs, and telling an author their preset
   * is blocked on a phase when it is blocked on them writing a sample is the
   * mistake `no-producer` existed to prevent.
   *
   * All three carriers are live now. So an empty samples slot means the same
   * thing whichever one it names — write a sample, or link an object that has
   * one — and keeping the discrimination would leave `no-producer` claiming an
   * outstanding phase that does not exist. Changed here rather than repaired by
   * whoever finds the build red, on [P5 §1.10]'s rule for the fixture-pair
   * gate: a test that changes meaning is changed by the change that alters it.
   */
  it('says the same thing about an empty samples slot whichever carrier it names', () => {
    const noTreatment = collectCandidates(
      context({
        preset: preset([samplesBlock({ source: { of: 'samples', from: 'treatment' } })]),
        actors: cast(withSamples('Vera', [{}])),
        carriers: { treatment: null, books: [] },
      }),
    );
    expect(noTreatment.notFilled).toEqual([
      { blockId: 'se.samples', source: 'samples', reason: 'empty-source' },
    ]);

    const noSamples = collectCandidates(
      context({
        preset: preset([samplesBlock()]),
        actors: cast(newActor('Vera')),
      }),
    );
    expect(noSamples.notFilled).toEqual([
      { blockId: 'se.samples', source: 'samples', reason: 'empty-source' },
    ]);
  });

  it('tolerates an actor written before the field existed', () => {
    // The additive-change claim where it actually bites: a card on disk from
    // before this field validates with `writingSamples` absent, and the
    // collector must read that as no samples rather than throwing.
    // Mutation: drop the `?? []` and this throws.
    const stripped: Actor = { ...newActor('Vera') };
    delete (stripped as { writingSamples?: unknown }).writingSamples;

    const { candidates, notFilled } = collectCandidates(
      context({
        preset: preset([samplesBlock()]),
        actors: [{ actor: stripped, contentHash: 'h' }],
      }),
    );

    expect(candidates).toHaveLength(0);
    expect(notFilled[0]?.reason).toBe('empty-source');
  });
});

/**
 * The lore arm — [P5.6].
 *
 * **The one slot whose blocks are not all in one place.** `position` lives on
 * the entry, so a single lore slot emits blocks belonging in four places, and
 * every test below is about the collector routing them rather than about the
 * retriever choosing them: which slot takes which, and where `at_depth` lands.
 */
describe('the lore slot', () => {
  function loreBlock(over: Partial<LoreBlock['candidate']> & { text: string }): LoreBlock {
    return {
      placement: { at: 'before' },
      candidate: {
        id: `lore.${over.text}`,
        source: { kind: 'lore', entryId: 'e', phase: 'before' },
        reason: 'keyword match',
        role: 'system',
        priority: 25,
        ...over,
      },
    };
  }

  const loreSlot = (over: Partial<PresetBlock> = {}, phase: 'before' | 'after' = 'before') =>
    block({ kind: 'slot', id: `se.lore.${phase}`, source: { of: 'lore', phase }, ...over });

  it('fills a lore slot from the retriever', () => {
    const { candidates } = collectCandidates(
      context({
        preset: preset([loreSlot()]),
        lore: [loreBlock({ text: 'The docks run on paperwork.' })],
      }),
    );

    expect(candidates.map((one) => one.text)).toEqual(['The docks run on paperwork.']);
  });

  it("keeps the entry's own role and reason rather than the slot's", () => {
    const { candidates } = collectCandidates(
      context({
        preset: preset([loreSlot({ role: 'system' })]),
        lore: [loreBlock({ text: 'Spoken.', role: 'assistant', reason: 'keyword match: “docks”' })],
      }),
    );

    expect(candidates[0]?.role).toBe('assistant');
    expect(candidates[0]?.reason).toBe('keyword match: “docks”');
  });

  /**
   * The phase is what separates the two ordinary slots. A collector that
   * ignored it would put every entry in both, which doubles the world in the
   * prompt and is invisible until somebody counts.
   */
  it('sends an entry to the slot for its phase and not the other', () => {
    const { candidates } = collectCandidates(
      context({
        preset: preset([loreSlot({}, 'before'), loreSlot({}, 'after')]),
        lore: [
          { ...loreBlock({ text: 'Early.' }), placement: { at: 'before' } },
          { ...loreBlock({ text: 'Late.' }), placement: { at: 'after' } },
        ],
      }),
    );

    expect(candidates.map((one) => one.text)).toEqual(['Early.', 'Late.']);
  });

  describe('outlets', () => {
    const outletSlot = block({
      kind: 'slot',
      id: 'se.lore.rules',
      source: { of: 'lore', phase: 'before', outlet: 'rules' },
    });

    it('gives an outlet slot only the entries addressed to it', () => {
      const { candidates } = collectCandidates(
        context({
          preset: preset([outletSlot]),
          lore: [
            { ...loreBlock({ text: 'Rules.' }), placement: { at: 'outlet', name: 'rules' } },
            { ...loreBlock({ text: 'Ordinary.' }), placement: { at: 'before' } },
          ],
        }),
      );

      expect(candidates.map((one) => one.text)).toEqual(['Rules.']);
    });

    /**
     * And the ordinary slot does **not** sweep up outlet entries as a
     * courtesy. An entry saying `outlet: rules` is asking not to land in the
     * before-run; letting it land there anyway undoes both halves of what an
     * outlet decouples, and does it silently.
     */
    it('does not let an unnamed slot take an outlet entry', () => {
      const { candidates, notFilled } = collectCandidates(
        context({
          preset: preset([loreSlot()]),
          lore: [{ ...loreBlock({ text: 'Rules.' }), placement: { at: 'outlet', name: 'rules' } }],
        }),
      );

      expect(candidates).toEqual([]);
      expect(notFilled[0]?.reason).toBe('empty-source');
    });
  });

  /**
   * `at_depth` is the placement that cannot be a plain sequence push: it
   * belongs in the history splice, which the loop has already decided this
   * block is not part of.
   */
  describe('at_depth', () => {
    const historySlot = block({ kind: 'slot', id: 'se.history', source: { of: 'history' } });

    function twoTurns(): Turn[] {
      return [
        { id: 'a', input: { text: 'one' }, output: { text: 'two' } },
        { id: 'b', input: { text: 'three' }, output: { text: 'four' } },
      ] as unknown as Turn[];
    }

    it('splices a depth entry into the history rather than appending it', () => {
      const { candidates } = collectCandidates(
        context({
          preset: preset([historySlot, loreSlot()]),
          history: twoTurns(),
          lore: [
            { ...loreBlock({ text: 'Injected.' }), placement: { at: 'in-history', fromEnd: 1 } },
          ],
        }),
      );

      const at = candidates.findIndex((one) => one.text === 'Injected.');
      expect(at).toBeGreaterThan(0);
      expect(at).toBeLessThan(candidates.length - 1);
    });

    it('puts a depth-four entry and a depth-zero note each where it was asked', () => {
      // The pairing the 2026-09-27 audit simulated: four is SillyTavern's
      // default depth for a lorebook entry, and a note at the very bottom is
      // the commonest thing beside it. Before the running offset the note went
      // in one message early, above the newest message it was meant to follow.
      const threeTurns = [
        ...twoTurns(),
        { id: 'c', input: { text: 'five' }, output: { text: 'six' } },
      ] as unknown as Turn[];
      const { candidates } = collectCandidates(
        context({
          preset: preset([
            historySlot,
            loreSlot(),
            block({
              kind: 'text',
              id: 'se.note',
              template: 'Note.',
              placement: { at: 'in-history', fromEnd: 0 },
            }),
          ]),
          history: threeTurns,
          lore: [
            { ...loreBlock({ text: 'Injected.' }), placement: { at: 'in-history', fromEnd: 4 } },
          ],
        }),
      );

      expect(candidates.map((one) => one.text)).toEqual([
        'one',
        'two',
        'Injected.',
        'three',
        'four',
        'five',
        'six',
        'Note.',
      ]);
    });

    it('leaves the entries that are not at a depth where the slot is', () => {
      const { candidates } = collectCandidates(
        context({
          preset: preset([historySlot, loreSlot()]),
          history: twoTurns(),
          lore: [
            { ...loreBlock({ text: 'Injected.' }), placement: { at: 'in-history', fromEnd: 1 } },
            { ...loreBlock({ text: 'Ordinary.' }), placement: { at: 'before' } },
          ],
        }),
      );

      expect(candidates.at(-1)?.text).toBe('Ordinary.');
    });
  });

  /**
   * The distinction [P5 §1.10] asked to change **in P5.6's own commit**: lore
   * has a producer now, so an empty lore slot means the retriever came up
   * empty. `no-producer` survives only for a caller that ran no retriever at
   * all.
   */
  describe('why a lore slot is empty', () => {
    it('reads empty-source when the retriever ran and found nothing', () => {
      const { notFilled } = collectCandidates(context({ preset: preset([loreSlot()]), lore: [] }));

      expect(notFilled[0]?.reason).toBe('empty-source');
    });

    it('reads no-producer when no retriever ran at all', () => {
      const { notFilled } = collectCandidates(context({ preset: preset([loreSlot()]) }));

      expect(notFilled[0]?.reason).toBe('no-producer');
    });
  });
});

/**
 * The other two carriers — [P5.9], [14 §7].
 *
 * [14 §7] shipped this slot with only its actor arm live and said the other two
 * would arrive when a session could reach a Treatment and its books. [P5.6]
 * made that true, and this is the wiring change §7 promised it would be.
 */
describe('samples from a treatment and from a book', () => {
  // Local copies of the actor block's helpers: they live inside that describe,
  // and hoisting them to the file would put two suites' fixtures in one place
  // where a change for one silently retunes the other.
  const samplesBlock = (over: Partial<PresetBlock> = {}): PresetBlock =>
    block({
      kind: 'slot',
      id: 'se.samples',
      label: 'writing samples',
      priority: 20,
      source: { of: 'samples' },
      ...over,
    });

  const cast = (...actors: Actor[]): CollectContext['actors'] =>
    actors.map((actor) => ({ actor, contentHash: `hash-${actor.name}` }));

  const withSamples = (name: string, bodies: string[]): Actor => ({
    ...newActor(name),
    writingSamples: bodies.map((body, at) => ({
      id: `a${String(at)}`,
      title: body,
      body,
      enabled: true,
      note: '',
    })),
  });

  function samplesOn<T extends { writingSamples?: WritingSample[] }>(
    object: T,
    bodies: string[],
  ): T {
    return {
      ...object,
      writingSamples: bodies.map((body, at) => ({
        id: `s${String(at)}`,
        title: body,
        body,
        enabled: true,
        note: '',
      })),
    };
  }

  const carriersOf = (over: Partial<SampleCarriers> = {}): SampleCarriers => ({
    treatment: null,
    books: [],
    ...over,
  });

  const treatmentWith = (bodies: string[]) => ({
    treatment: samplesOn(newTreatment('Noir'), bodies),
    id: 't1',
    contentHash: 'sha256:t',
  });

  const bookWith = (bodies: string[], id = 'b1') => ({
    book: samplesOn(newLorebook('Rain City'), bodies),
    id,
    contentHash: 'sha256:b',
  });

  it('fills from a treatment’s samples', () => {
    const { candidates } = collectCandidates(
      context({
        preset: preset([samplesBlock({ source: { of: 'samples', from: 'treatment' } })]),
        carriers: carriersOf({ treatment: treatmentWith(['The rain never lets up.']) }),
      }),
    );

    expect(candidates.map((one) => one.text)).toEqual(['The rain never lets up.']);
    expect(candidates[0]?.source).toEqual({
      kind: 'samples',
      owner: { kind: 'treatment', id: 't1', contentHash: 'sha256:t' },
      sampleId: 's0',
    });
  });

  it('fills from a book’s samples', () => {
    const { candidates } = collectCandidates(
      context({
        preset: preset([samplesBlock({ source: { of: 'samples', from: 'lore' } })]),
        carriers: carriersOf({ books: [bookWith(['Nobody hurries here.'])] }),
      }),
    );

    expect(candidates[0]?.source).toMatchObject({
      owner: { kind: 'lore', id: 'b1', contentHash: 'sha256:b' },
    });
  });

  it('reads every book in play, not only the first', () => {
    const { candidates } = collectCandidates(
      context({
        preset: preset([samplesBlock({ source: { of: 'samples', from: 'lore' } })]),
        carriers: carriersOf({
          books: [bookWith(['One.'], 'b1'), bookWith(['Two.'], 'b2')],
        }),
      }),
    );

    expect(candidates.map((one) => one.text)).toEqual(['One.', 'Two.']);
  });

  /**
   * **The order [04 §3.1] fixes**: the stance on the material, then the world,
   * then the person, which is the order they narrow in. A preset that declines
   * to name a `from` is relying on it.
   */
  it('takes all three in the declared order when the slot names none', () => {
    const { candidates } = collectCandidates(
      context({
        preset: preset([samplesBlock()]),
        actors: cast(withSamples('Vera', ['from the actor'])),
        carriers: carriersOf({
          treatment: treatmentWith(['from the treatment']),
          books: [bookWith(['from the book'])],
        }),
      }),
    );

    expect(candidates.map((one) => one.text)).toEqual([
      'from the treatment',
      'from the book',
      'from the actor',
    ]);
  });

  /**
   * One candidate per sample, as the actor arm already does: the budgeter's
   * only move against a single block is to drop all of it, and somebody who
   * pasted three samples would rather lose one.
   */
  it('emits one candidate per sample, each addressable', () => {
    const { candidates } = collectCandidates(
      context({
        preset: preset([samplesBlock({ source: { of: 'samples', from: 'treatment' } })]),
        carriers: carriersOf({ treatment: treatmentWith(['One.', 'Two.']) }),
      }),
    );

    expect(candidates).toHaveLength(2);
    expect(new Set(candidates.map((one) => one.id)).size).toBe(2);
  });

  it('skips a disabled sample without spending anything on it', () => {
    const carrier = treatmentWith(['Kept.', 'Dropped.']);
    const samples = carrier.treatment.writingSamples ?? [];
    if (samples[1] !== undefined) samples[1].enabled = false;

    const { candidates } = collectCandidates(
      context({
        preset: preset([samplesBlock({ source: { of: 'samples', from: 'treatment' } })]),
        carriers: carriersOf({ treatment: carrier }),
      }),
    );

    expect(candidates.map((one) => one.text)).toEqual(['Kept.']);
  });

  it('lets a sample’s own priority override the slot’s', () => {
    const carrier = treatmentWith(['Ranked.']);
    const samples = carrier.treatment.writingSamples ?? [];
    if (samples[0] !== undefined) samples[0].priority = 99;

    const { candidates } = collectCandidates(
      context({
        preset: preset([samplesBlock({ source: { of: 'samples', from: 'treatment' } })]),
        carriers: carriersOf({ treatment: carrier }),
      }),
    );

    expect(candidates[0]?.priority).toBe(99);
  });

  /**
   * **A sample rides with its carrier, never with activation** — which is what
   * keeps this a slot rather than a feature of the retriever. The book's prose
   * is offered because the book is in play; nothing here consults what matched.
   */
  it('offers a book’s samples with no entry having fired', () => {
    const { candidates } = collectCandidates(
      context({
        preset: preset([samplesBlock({ source: { of: 'samples', from: 'lore' } })]),
        carriers: carriersOf({ books: [bookWith(['Still offered.'])] }),
        lore: [],
      }),
    );

    expect(candidates.map((one) => one.text)).toEqual(['Still offered.']);
  });

  /** A caller that supplies no carriers at all simply has none to read. */
  it('reads nothing from carriers nobody supplied', () => {
    const { notFilled } = collectCandidates(
      context({ preset: preset([samplesBlock({ source: { of: 'samples', from: 'lore' } })]) }),
    );

    expect(notFilled[0]?.reason).toBe('empty-source');
  });

  /**
   * The same additive-change tolerance the actor arm has, on the other two.
   *
   * **The field has to be genuinely absent**, which the first version of this
   * missed: the factories all set `writingSamples: []`, so an object built from
   * one exercises no fallback at all and the mutation that removes it survives.
   * A file written before the field existed has no key, and that is what is
   * built here.
   */
  it('tolerates a treatment or a book written before the field existed', () => {
    const bareTreatment = { ...newTreatment('Noir') } as Record<string, unknown>;
    const bareBook = { ...newLorebook('Rain City') } as Record<string, unknown>;
    delete bareTreatment['writingSamples'];
    delete bareBook['writingSamples'];

    const { notFilled } = collectCandidates(
      context({
        preset: preset([samplesBlock()]),
        carriers: carriersOf({
          treatment: {
            treatment: bareTreatment as unknown as Treatment,
            id: 't1',
            contentHash: 'sha256:t',
          },
          books: [{ book: bareBook as unknown as Lorebook, id: 'b1', contentHash: 'sha256:b' }],
        }),
      }),
    );

    expect(notFilled[0]?.reason).toBe('empty-source');
  });
});

/**
 * **A preset that names a channel stops producing silence** — [06 §4], [P7.1].
 *
 * `{ of: 'channel', channelId }` has been a legal preset slot since P2 and the
 * collector returned `[]` for it, with a comment saying why: *"a channel value
 * is an object with no channel-to-text renderer specified — which is also why
 * the clock's budget is null."* Both halves of that expired together, so these
 * are about the four different ways the answer can still be nothing, each of
 * which is a different statement rather than a shrug.
 */
describe('a channel slot', () => {
  beforeEach(async () => {
    await installBuiltIns();
  });

  const slot = block({
    kind: 'slot',
    id: 'se.clock',
    source: { of: 'channel', channelId: SE_CLOCK },
  });

  it('renders the value through the template the mode declared', () => {
    // The engine cannot know that `{day, hour, minute}` is a time of day, let
    // alone that `8` reads as `08`. Scene says so, in Liquid, as data.
    const { candidates } = collectCandidates(
      context({
        preset: preset([slot]),
        channels: { [SE_CLOCK]: { version: 1, value: { day: 3, hour: 9, minute: 5 } } },
      }),
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.text).toBe('Day 3, 09:05');
    expect(candidates[0]?.source).toEqual({ kind: 'channel', channelId: SE_CLOCK });
  });

  it('falls back to the declared init, so an untouched session still has a clock', () => {
    // The same read-time default `readClock` uses. A slot that rendered nothing
    // until the first effect would make the prompt disagree with the panel.
    const { candidates } = collectCandidates(context({ preset: preset([slot]), channels: {} }));

    expect(candidates[0]?.text).toBe('Day 1, 08:00');
  });

  it('says nothing for a channel nobody declared', () => {
    // An uninstalled mode leaves its slots behind. [00 §3.3]: survivable,
    // visible, non-blocking — and a slot with `omitWhenEmpty` disappears.
    const { candidates } = collectCandidates(
      context({
        preset: preset([
          block({ kind: 'slot', id: 'se.x', source: { of: 'channel', channelId: 'example.gone' } }),
        ]),
      }),
    );

    expect(candidates).toHaveLength(0);
  });

  it('says nothing for a channel with no template, which is a real answer', () => {
    // Lore timing is the shipped example: `sticky`, `cooldown` and `fired` are
    // bookkeeping, and a player asking why an entry fired gets a reason from the
    // workbench rather than from the prompt.
    const { candidates } = collectCandidates(
      context({
        preset: preset([
          block({
            kind: 'slot',
            id: 'se.x',
            source: { of: 'channel', channelId: SE_LORE_TIMING },
          }),
        ]),
        channels: { [SE_LORE_TIMING]: { version: 1, value: { sticky: 1, cooldown: 0, fired: 2 } } },
      }),
    );

    expect(candidates).toHaveLength(0);
  });

  it('says nothing when the budget is null, which is 06 §4’s spelling of never injected', () => {
    registerChannel({
      id: 'example.quiet',
      owner: 'example.mode',
      version: 1,
      scope: 'session',
      update: 'model-proposed',
      visibility: 'player',
      budget: null,
      render: 'this would have been rendered',
      schema: { type: 'object' },
      init: { kind: 'literal', value: {} },
    });

    const { candidates } = collectCandidates(
      context({
        preset: preset([
          block({
            kind: 'slot',
            id: 'se.x',
            source: { of: 'channel', channelId: 'example.quiet' },
          }),
        ]),
      }),
    );

    expect(candidates).toHaveLength(0);
  });

  it('truncates to the declared budget rather than dropping the block', () => {
    // **`budget` acquires a reader here, which is the other half of what was
    // missing.** A channel over its allowance is more useful cut short than
    // absent, and dropping would hand the budgeter a decision the declaration
    // has already made.
    registerChannel({
      id: 'example.long',
      owner: 'example.mode',
      version: 1,
      scope: 'session',
      update: 'model-proposed',
      visibility: 'player',
      budget: 2,
      render: '{{ value }}',
      schema: { type: 'string' },
      init: { kind: 'literal', value: '' },
    });

    const long = 'a '.repeat(200).trim();
    const { candidates } = collectCandidates(
      context({
        preset: preset([
          block({ kind: 'slot', id: 'se.x', source: { of: 'channel', channelId: 'example.long' } }),
        ]),
        channels: { 'example.long': { version: 1, value: long } },
      }),
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.text.length).toBeLessThan(long.length);
    expect(long.startsWith(candidates[0]?.text ?? '')).toBe(true);
  });

  /**
   * ***Switched off is silent*** — `ChannelDefinition.enabledBy`, [P14.5b]: a
   * secret plot a person switched off stops reaching the narrator, whatever
   * its value, and the record says a person did it.
   */
  it('says nothing while the channel’s switch is off, and calls that disabled', () => {
    registerChannel({
      id: 'example.switch',
      owner: 'example.mode',
      version: 1,
      scope: 'session',
      update: 'user-only',
      visibility: 'player',
      budget: null,
      schema: { type: 'boolean' },
      init: { kind: 'literal', value: false },
    });
    registerChannel({
      id: 'example.secret',
      owner: 'example.mode',
      version: 1,
      scope: 'session',
      update: 'model-proposed',
      visibility: 'hidden',
      budget: 20,
      render: '{{ value }}',
      schema: { type: 'string' },
      init: { kind: 'literal', value: '' },
      enabledBy: 'example.switch',
    });
    const slotted = preset([
      block({ kind: 'slot', id: 'se.x', source: { of: 'channel', channelId: 'example.secret' } }),
    ]);
    const held = { 'example.secret': { version: 1, value: 'the vault is empty' } };

    const off = collectCandidates(context({ preset: slotted, channels: held }));
    expect(off.candidates).toHaveLength(0);
    expect(off.notFilled).toEqual([
      expect.objectContaining({ blockId: 'se.x', reason: 'disabled' }),
    ]);

    const on = collectCandidates(
      context({
        preset: slotted,
        channels: { ...held, 'example.switch': { version: 1, value: true } },
      }),
    );
    expect(on.candidates[0]?.text).toBe('the vault is empty');
  });

  /**
   * ***A rendered channel with nothing in it yet is an empty source***
   * (2026-09-30). The slot said `no-producer` for every empty channel, so the
   * secret plot read *nothing produces this yet* before the plot step's first
   * pass — about a slot that step fills. `no-producer` is left to a channel
   * nothing could ever render, and the switch still outranks both.
   */
  it('reads empty-source for a rendered channel with no value yet', () => {
    const channel = (id: string, over: Partial<ChannelDefinition> = {}): void => {
      registerChannel({
        id,
        owner: 'example.mode',
        version: 1,
        scope: 'session',
        update: 'model-proposed',
        visibility: 'hidden',
        budget: 20,
        schema: { type: 'string' },
        init: { kind: 'literal', value: '' },
        ...over,
      });
    };
    channel('example.switch', {
      update: 'user-only',
      budget: null,
      schema: { type: 'boolean' },
      init: { kind: 'literal', value: true },
    });
    channel('example.secret', { render: '{{ value }}', enabledBy: 'example.switch' });
    channel('example.unrendered');
    channel('example.unbudgeted', { render: '{{ value }}', budget: null });
    const slot = (id: string, channelId: string) =>
      block({ kind: 'slot', id, source: { of: 'channel', channelId } });
    const slotted = preset([
      slot('se.secret', 'example.secret'),
      slot('se.unrendered', 'example.unrendered'),
      slot('se.unbudgeted', 'example.unbudgeted'),
      slot('se.nobody', 'example.nobody'),
    ]);

    const young = collectCandidates(context({ preset: slotted, channels: {} }));
    expect(young.notFilled.map((row) => [row.blockId, row.reason])).toEqual([
      ['se.secret', 'empty-source'],
      // Nothing could ever put these three into a prompt.
      ['se.unrendered', 'no-producer'],
      ['se.unbudgeted', 'no-producer'],
      ['se.nobody', 'no-producer'],
    ]);

    const off = collectCandidates(
      context({ preset: slotted, channels: { 'example.switch': { version: 1, value: false } } }),
    );
    expect(off.notFilled[0]).toEqual(
      expect.objectContaining({ blockId: 'se.secret', reason: 'disabled' }),
    );
  });

  it('says nothing for a template that will not compile, rather than taking the turn down', () => {
    // A refusal is a value, the same way `renderTemplate`'s caller treats one: a
    // preset is somebody else's authored file and so is a mode's declaration.
    registerChannel({
      id: 'example.broken-template',
      owner: 'example.mode',
      version: 1,
      scope: 'session',
      update: 'model-proposed',
      visibility: 'player',
      budget: 10,
      render: '{% if %}',
      schema: { type: 'object' },
      init: { kind: 'literal', value: {} },
    });

    const { candidates } = collectCandidates(
      context({
        preset: preset([
          block({
            kind: 'slot',
            id: 'se.x',
            source: { of: 'channel', channelId: 'example.broken-template' },
          }),
        ]),
      }),
    );

    expect(candidates).toHaveLength(0);
  });
});

/**
 * ***What the story has established*** — [P14 §1.9.2], [P14.5a]'s `{ of:
 * 'state' }`.
 *
 * Over Scene's real trackers, installed as a session gets them, because the
 * claims are about declarations the engine never names: **every tracker that
 * is on, scoped values included, as one block**, each under its heading and a
 * character's under their name; **off says nothing**, whatever the value; and
 * the record names the keys it carried.
 */
describe('the state slot', () => {
  beforeEach(async () => {
    await installBuiltIns();
  });

  const slot = block({ kind: 'slot', id: 'se.state', source: { of: 'state' } });
  const vera = actorWith('Vera', 'A fence.');
  const on = (id: string) => ({ [`${id}.on`]: { version: 1, value: true } });

  it('renders every tracker that is on, a character’s under their name, in one block', () => {
    const { candidates } = collectCandidates(
      context({
        preset: preset([slot]),
        actors: [{ actor: vera, contentHash: 'h' }],
        channels: {
          ...on('se.track.world'),
          ...on('se.track.character'),
          ...on('se.track.inventory'),
          ...on('se.track.quests'),
          'se.track.world': {
            version: 1,
            value: {
              date: '',
              time: 'dusk',
              location: 'the docks',
              weather: '',
              temperature: '',
              fields: [{ name: 'Tide', value: 'turning' }],
              recent: ['the ledger burned'],
            },
          },
          [`se.track.character#${vera.id}`]: {
            version: 1,
            value: {
              mood: 'wary',
              appearance: '',
              outfit: '',
              thoughts: '',
              fields: { holding: 'a lantern' },
              stats: [{ name: 'Nerve', value: 3, max: 5 }],
            },
          },
          'se.track.inventory': {
            version: 1,
            value: {
              currencies: [{ name: 'crowns', qty: 12 }],
              equipped: [],
              inventory: [{ name: 'iron key' }, { name: 'rope', qty: 2 }],
            },
          },
          'se.track.quests': {
            version: 1,
            value: [
              {
                name: 'The vault',
                stage: 'find the door',
                objectives: [
                  { text: 'Get the key', completed: true },
                  { text: 'Open it', completed: false },
                ],
                completed: false,
              },
            ],
          },
        },
      }),
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.text).toBe(
      [
        'The world:',
        'Time: dusk',
        'Location: the docks',
        'Tide: turning',
        'Recently: the ledger burned',
        '',
        'Character — Vera:',
        'Mood: wary',
        'holding: a lantern',
        'Nerve: 3/5',
        '',
        'Quests:',
        'The vault — find the door',
        '- [x] Get the key',
        '- [ ] Open it',
        '',
        'Inventory:',
        'Money: crowns ×12',
        'Carrying: iron key, rope ×2',
      ].join('\n'),
    );
    expect(candidates[0]?.source).toEqual({
      kind: 'state',
      keys: [
        'se.track.world',
        `se.track.character#${vera.id}`,
        'se.track.quests',
        'se.track.inventory',
      ],
    });
  });

  it('says nothing for a tracker that is off, whatever it holds', () => {
    const { candidates, notFilled } = collectCandidates(
      context({
        preset: preset([slot]),
        channels: {
          'se.track.custom': { version: 1, value: [{ name: 'Suspicion', value: 'high' }] },
        },
      }),
    );
    expect(candidates).toHaveLength(0);
    expect(notFilled).toEqual([{ blockId: 'se.state', source: 'state', reason: 'empty-source' }]);
  });

  it('leaves out a character the cast no longer has', () => {
    const { candidates } = collectCandidates(
      context({
        preset: preset([slot]),
        channels: {
          ...on('se.track.character'),
          'se.track.character#gone': {
            version: 1,
            value: { mood: 'x', appearance: '', outfit: '', thoughts: '', fields: {}, stats: [] },
          },
        },
      }),
    );
    expect(candidates).toHaveLength(0);
  });
});

/**
 * ***The two dials' fragments*** — [06 §7.3.1], [06 §7.3.2], [P7.8].
 *
 * This is where [P7.8]'s *ends at* is checkable in the only form a stage can
 * produce: *"two levels of difficulty producing visibly different friction
 * against the same goal, with the level's prose coming from the pack and the
 * scheduling from engine code."* Same preset, same goal, two levels, and the
 * blocks differ — by content, which is the pack's, and not by count of
 * anything the engine decided.
 */
describe('the difficulty and directedness slots', () => {
  const DIALS = preset([
    block({ kind: 'slot', id: 'se.difficulty', source: { of: 'difficulty' }, priority: 85 }),
  ]);

  function withLevel(levelId: string): CollectContext {
    const level = resolveLevel(DIALS_PRESET, 'difficulty', levelId);
    return context({
      preset: { ...DIALS, difficultyLevels: DIALS_PRESET.difficultyLevels ?? [] },
      ...(level === null ? {} : { dials: { difficulty: { level } } }),
    });
  }

  /**
   * ***One candidate per fragment, which is the arm's reason for existing.***
   * [04 §8] ranks them so [20 §5.3]'s cap can *"drop the lowest-ranked rather
   * than cutting mid-sentence"*; a slot that joined them into one string would
   * have thrown that away where it was built.
   */
  it('fans one slot out into one candidate per fragment', () => {
    const collected = collectCandidates(withLevel('harsh'));

    expect(collected.candidates).toHaveLength(3);
    expect(new Set(collected.candidates.map((one) => one.id)).size).toBe(3);
  });

  /** Highest priority first, so what the cap drops is what the pack ranked last. */
  it('orders them so the cap drops what the pack ranked lowest', () => {
    const texts = collectCandidates(withLevel('harsh')).candidates.map((one) => one.text);

    expect(texts.at(0)).toContain('Concede little');
    expect(texts.at(-1)).toBe('Nothing volunteers help.');
  });

  /**
   * ***Two levels, visibly different friction — the stage's exit line.*** The
   * difference is entirely in text that came off the pack: nothing about the
   * engine's behaviour changed between these two calls.
   */
  it('produces different prose at two levels of the same pack', () => {
    const gentle = collectCandidates(withLevel('gentle')).candidates.map((one) => one.text);
    const harsh = collectCandidates(withLevel('harsh')).candidates.map((one) => one.text);

    expect(gentle).not.toEqual(harsh);
    expect(gentle.join(' ')).toContain('let it work');
    expect(harsh.join(' ')).toContain('Concede little');
  });

  /**
   * **The block says which level and which fragment**, which is what makes
   * [04 §8]'s claim true — *"someone who dislikes how 'hard' behaves can read
   * the fragment that caused it and change it"*. A block carrying only the text
   * would leave a reader the sentence and no way back to the file.
   */
  it('records the level and the fragment’s place in it', () => {
    const sources = collectCandidates(withLevel('harsh')).candidates.map((one) => one.source);

    expect(sources).toContainEqual({
      kind: 'difficulty',
      axis: 'difficulty',
      levelId: 'harsh',
      fragmentIndex: 2,
    });
  });

  /**
   * *A mode with no difficulty is [04 §7]'s explicit case*, not a
   * misconfiguration — so the slot reports `empty-source`, which is the sentence
   * with the repair in it, rather than `no-producer`, which would say a phase is
   * outstanding.
   */
  it('says the source is empty rather than that a phase is missing', () => {
    const collected = collectCandidates(context({ preset: DIALS }));

    expect(collected.candidates).toHaveLength(0);
    expect(collected.notFilled).toContainEqual(
      expect.objectContaining({ blockId: 'se.difficulty', reason: 'empty-source' }),
    );
  });

  /**
   * ***The two axes do not share a slot, and a preset that positions one does
   * not get the other.*** [06 §7.3.2]'s conflation expressed as layout is the
   * failure this prevents: an author who wants them adjacent writes two blocks
   * and has said so.
   */
  it('fills only the axis the slot names', () => {
    const level = resolveLevel(DIALS_PRESET, 'directedness', 'steering');
    const collected = collectCandidates(
      context({
        preset: DIALS,
        ...(level === null ? {} : { dials: { directedness: { level } } }),
      }),
    );

    expect(collected.candidates).toHaveLength(0);
  });
});

/**
 * The summary slot — [07 §5.1](../../../../docs/design/07-branching.md), [P8.1].
 *
 * The integration lives in `routes/p8-gate.test.ts`, which plays a real turn
 * over a forty-five-turn path. What is here is the two claims the collector owns
 * on its own and a gate test could only observe indirectly: **what an empty slot
 * says**, and **which link the budgeter sacrifices first**.
 */
describe('the story above the window', () => {
  const link = (key: string, from: number, to: number): SummaryLink => ({
    schema: 'storyengine.summary/1',
    key,
    summariser: 's',
    previousKey: null,
    unitKeys: [],
    turnIds: [],
    from,
    to,
    text: `what happened between ${String(from)} and ${String(to)}`,
  });

  const slot = block({ kind: 'slot', id: 'se.summary', source: { of: 'summary' }, priority: 8 });

  it('emits one candidate per link, oldest first', () => {
    const { candidates } = collectCandidates(
      context({ preset: preset([slot]), summary: [link('a', 0, 19), link('b', 20, 24)] }),
    );

    expect(candidates.map((one) => one.id)).toEqual(['se.summary.a', 'se.summary.b']);
    expect(candidates.map((one) => one.source)).toEqual([
      { kind: 'summary', linkKey: 'a', range: [0, 19] },
      { kind: 'summary', linkKey: 'b', range: [20, 24] },
    ]);
  });

  /**
   * ***`priority + index`, which is `history`'s arithmetic and has to be.***
   * `assemble` drops *lowest priority first*, and within one priority it drops
   * *later-listed* first — so a chain at one shared number would give up the
   * **newest** link and keep the oldest, which is the trade backwards. Offsetting
   * by position makes the distant past go before the recent past.
   */
  it('ranks a later link above an earlier one, so the distant past goes first', () => {
    const { candidates } = collectCandidates(
      context({
        preset: preset([slot]),
        summary: [link('a', 0, 19), link('b', 20, 39), link('c', 40, 44)],
      }),
    );

    expect(candidates.map((one) => one.priority)).toEqual([8, 9, 10]);
  });

  /**
   * **Lore's distinction, for lore's reason, and it matters more here.** A caller
   * that computed no chain is *waiting on the engine*; a chain that was computed
   * and is empty says **this session is not yet longer than its window**, which
   * is a state twenty more turns fixes. Collapsing them would send an author
   * looking for a missing phase.
   */
  it('tells a session with no chain from one that is not long enough to have one', () => {
    const none = collectCandidates(context({ preset: preset([slot]) }));
    expect(none.notFilled).toEqual([
      { blockId: 'se.summary', source: 'summary', reason: 'no-producer' },
    ]);

    const empty = collectCandidates(context({ preset: preset([slot]), summary: [] }));
    expect(empty.notFilled).toEqual([
      { blockId: 'se.summary', source: 'summary', reason: 'empty-source' },
    ]);
  });

  /**
   * ***The root is link zero*** — [04 §7.2](../../../../docs/design/04-schemas.md),
   * [P15.2](../../../../docs/design/workplan/33-p15-setup-from-a-turn.md).
   *
   * Three claims. It is emitted **with no chain at all**, which is what makes a
   * session started from a Setup made from a turn know its own past on turn one
   * rather than on turn twenty-one. It is **oldest, so lowest**, and the links
   * after it move up by one so the budgeter's order is unchanged. And its
   * provenance says **the Setup**, not a range of turns nobody's summariser
   * covered.
   *
   * *The second claim was re-argued at the merge* (2026-10-03): once the chain
   * went into stretches no link restates the root, so first-to-go now costs
   * what it says. It stays first for the slot's own trade, the distant past
   * before the recent — the root arm's comment has the argument, and the
   * priorities below are what pin it.
   */
  it('emits the story so far first, before any chain exists, and says where it came from', () => {
    const summaryRoot = { text: 'The ledger was lost at the docks.', setupId: 'setup-1' };

    const alone = collectCandidates(context({ preset: preset([slot]), summaryRoot }));
    expect(alone.candidates.map((one) => [one.id, one.text, one.priority])).toEqual([
      ['se.summary.root', 'The ledger was lost at the docks.', 8],
    ]);
    expect(alone.candidates[0]?.source).toEqual({ kind: 'story-so-far', setupId: 'setup-1' });
    expect(alone.notFilled).toEqual([]);

    const chained = collectCandidates(
      context({
        preset: preset([slot]),
        summaryRoot,
        summary: [link('a', 0, 19), link('b', 20, 24)],
      }),
    );
    expect(chained.candidates.map((one) => [one.id, one.priority])).toEqual([
      ['se.summary.root', 8],
      ['se.summary.a', 9],
      ['se.summary.b', 10],
    ]);
  });

  /** And a session without one is exactly what it was. */
  it('changes nothing for a session with no root', () => {
    const { candidates } = collectCandidates(
      context({ preset: preset([slot]), summary: [link('a', 0, 19)] }),
    );
    expect(candidates.map((one) => [one.id, one.priority])).toEqual([['se.summary.a', 8]]);
  });
});

/**
 * ***A treatment's framing, in the prompt at last*** (2026-09-27) — [04 §3.1],
 * [P7B §3.2] row 7.
 *
 * The slot has been in every shipped pack since P2 and the treatment has been
 * in the gather since [P5.6], as a carrier for its samples; the arm between
 * them returned nothing, so the one piece of a treatment written to be read
 * every turn never was. P7B's gate row for exactly this was answered *yes*,
 * citing tests that never looked. These do, and each empty case says which
 * kind of nothing it is.
 */
describe('the treatment slot', () => {
  const framingSlot = block({
    kind: 'slot',
    id: 'se.treatment',
    source: { of: 'treatment', part: 'framing' },
  });

  const carrying = (framing: string): SampleCarriers => ({
    treatment: {
      treatment: { ...newTreatment('Noir'), framing },
      id: 't1',
      contentHash: 'sha256:t',
    },
    books: [],
  });

  it('fills the framing from the treatment in play', () => {
    const { candidates, notFilled } = collectCandidates(
      context({
        preset: preset([framingSlot]),
        carriers: carrying('Rain, always. Nobody here tells the whole truth.'),
      }),
    );

    expect(candidates.map((candidate) => [candidate.id, candidate.text])).toEqual([
      ['se.treatment', 'Rain, always. Nobody here tells the whole truth.'],
    ]);
    expect(candidates[0]?.source).toEqual({ kind: 'treatment', part: 'framing' });
    expect(notFilled).toEqual([]);
  });

  it('says the source is empty with no treatment, or a treatment with no framing', () => {
    for (const carriers of [{ treatment: null, books: [] }, carrying('')]) {
      const { candidates, notFilled } = collectCandidates(
        context({ preset: preset([framingSlot]), carriers }),
      );
      expect(candidates).toEqual([]);
      expect(notFilled).toEqual([
        { blockId: 'se.treatment', source: 'treatment', reason: 'empty-source' },
      ]);
    }
  });

  it('says there is no producer when the caller gathered no carriers', () => {
    const { notFilled } = collectCandidates(context({ preset: preset([framingSlot]) }));
    expect(notFilled).toEqual([
      { blockId: 'se.treatment', source: 'treatment', reason: 'no-producer' },
    ]);
  });

  it('leaves tone alone, which has no sentence designed for it', () => {
    const { candidates, notFilled } = collectCandidates(
      context({
        preset: preset([
          block({ kind: 'slot', id: 'se.tone', source: { of: 'treatment', part: 'tone' } }),
        ]),
        carriers: carrying('Rain, always.'),
      }),
    );
    expect(candidates).toEqual([]);
    expect(notFilled).toEqual([{ blockId: 'se.tone', source: 'treatment', reason: 'no-producer' }]);
  });
});

/**
 * ***A past input keeps the kind it was*** (2026-09-27) — [13 §8.3], [P7.9].
 *
 * Freeform's pack says what a *think* is through the input slot for a think:
 * *the player's character thinks: …*, beside an instruction that nobody heard
 * it. That held for one turn. The history arm read the words and not the
 * kind, so from the next turn on the same thought sat in the transcript as a
 * bare line the player might as well have said aloud — and the instruction
 * that it was private had gone with the turn it was attached to.
 */
describe('a past input as the pack framed it', () => {
  beforeEach(async () => {
    await installBuiltIns();
  });

  const said = (n: number, kind: string, text: string): Turn => ({
    id: `t${String(n)}`,
    sessionId: 's',
    parentTurnId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    status: 'complete',
    input: { actorId: null, kind, text, raw: '' },
    output: { text: `out ${String(n)}` },
    effects: [],
    tape: [],
  });

  const history = [
    said(1, 'think', 'She is lying.'),
    said(2, 'say', 'Where were you last night?'),
    said(3, 'do', 'I open the door.'),
  ];

  function pastInputs(pack: Preset): string[] {
    return collectCandidates(
      context({ preset: pack, callKind: 'do', history, input: { text: 'I wait.' } }),
    )
      .candidates.filter((candidate) => candidate.source.kind === 'history')
      .filter((candidate) => candidate.role === 'user')
      .map((candidate) => candidate.text);
  }

  function shipped(modeId: string): Preset {
    const pack = modeById(modeId)?.definition.assembly.defaultPreset;
    if (pack === undefined) throw new Error(`${modeId} is a built-in`);
    return pack;
  }

  it('keeps a thought a thought, and a line a line, in Freeform’s own pack', () => {
    expect(pastInputs(shipped('storyengine.freeform'))).toEqual([
      'The player’s character thinks: She is lying.',
      'The player’s character says: “Where were you last night?”',
      // A do has no wrapper in the pack, so it reads as it always did.
      'I open the door.',
    ]);
  });

  it('changes nothing in a pack whose input slot wraps nothing', () => {
    // Scene's case, and the assistant's: one input slot for every kind, bare.
    expect(pastInputs(shipped('storyengine.scene'))).toEqual([
      'She is lying.',
      'Where were you last night?',
      'I open the door.',
    ]);
  });

  it('falls back to the slot for every kind, and never to one switched off', () => {
    const transcript = block({ kind: 'slot', id: 'se.h', source: { of: 'history' } });
    const anyKind = block({
      kind: 'slot',
      id: 'se.input',
      role: 'user',
      source: { of: 'input' },
      wrapper: 'The player: {{content}}',
    });
    const offThink = block({
      kind: 'slot',
      id: 'se.input.think',
      role: 'user',
      enabled: false,
      appliesTo: ['think'],
      source: { of: 'input' },
      wrapper: 'Thought: {{content}}',
    });

    expect(pastInputs(preset([transcript, offThink, anyKind]))).toEqual([
      'The player: She is lying.',
      'The player: Where were you last night?',
      'The player: I open the door.',
    ]);
  });
});

/**
 * ***Whose block is whose*** (2026-09-27) — a wrapper is a template over the
 * participants' names, and the content inside it never is.
 *
 * The shipped packs' persona and actor blocks went to the model as bodies with
 * no names on them, so with two characters in a scene the narrator had two
 * descriptions, two appearances and two voices, and nothing to say which was
 * which — and the persona's name was in no prompt at all.
 */
/**
 * ***When and where the scene is, told to whoever writes it*** (2026-09-30).
 *
 * The clock the engine advances every turn and the place the stager reads
 * from the prose reached no call: the belief that a channel's `render` puts it
 * in the prompt by itself was false, and nothing positioned either. Scene's
 * pack slots both now — for the narration, a suggestion and a drafted move —
 * and stands them aside while the world tracker keeps its own date, time and
 * place, which the state block already carries.
 */
describe('the time and the place', () => {
  beforeEach(async () => {
    await installBuiltIns();
  });

  function scene(): Preset {
    const pack = modeById('storyengine.scene')?.definition.assembly.defaultPreset;
    if (pack === undefined) throw new Error('Scene is a built-in');
    return pack;
  }

  const channels = {
    'se.clock': { version: 1, value: { day: 3, hour: 9, minute: 5 } },
    'se.location': { version: 1, value: 'the harbourmaster’s office' },
  };

  const said = (callKind: string, held: CollectContext['channels'] = channels) => {
    const { candidates } = collectCandidates(
      context({ preset: scene(), callKind, channels: held }),
    );
    return ['se.clock', 'se.location'].map(
      (id) => candidates.find((candidate) => candidate.id === id)?.text,
    );
  };

  it.each(['narrate', 'suggest', 'impersonate'])('are told to a %s call', (callKind) => {
    expect(said(callKind)).toEqual([
      'When this is happening: Day 3, 09:05',
      'Where this is happening: the harbourmaster’s office',
    ]);
  });

  it('are told to no judge', () => {
    expect(said('goal-judge')).toEqual([undefined, undefined]);
  });

  it('stand aside while the world tracker keeps its own', () => {
    const tracked = { ...channels, 'se.track.world.on': { version: 1, value: true } };
    expect(said('narrate', tracked)).toEqual([undefined, undefined]);

    const { notFilled } = collectCandidates(context({ preset: scene(), channels: tracked }));
    expect(
      notFilled
        .filter((row) => row.blockId === 'se.clock' || row.blockId === 'se.location')
        .map((row) => row.reason),
    ).toEqual(['disabled', 'disabled']);
  });

  it('say nothing of a place nobody has named yet', () => {
    const clockOnly = { 'se.clock': channels['se.clock'] };
    expect(said('narrate', clockOnly)).toEqual(['When this is happening: Day 3, 09:05', undefined]);
  });
});

/**
 * ***Only the channels the session's mode plays*** (2026-09-30) — `modeId`,
 * read through `channelInPlay`, the rule the HUD and the channel write kept.
 * The registry holds every mode's declarations and the collector walked all of
 * it: a Freeform session with Scene's world tracker switched on had Scene's
 * state in its prompt, and a pack slotting Scene's clock read a clock only a
 * session playing Scene advances.
 */
/**
 * ***A setup answer, slotted by the field it answers*** (2026-09-30) — the
 * `setup` slot. Freeform's wizard requires a premise, and no prompt carried it:
 * the answers were a record field no slot could name.
 */
describe('a setup answer', () => {
  const slot = block({
    kind: 'slot',
    id: 'se.premise',
    source: { of: 'setup', field: 'premise' },
    wrapper: 'What this story is about: {{content}}',
  });

  it('fills the slot with the answer it names, framed, and says whose it is', () => {
    const { candidates } = collectCandidates(
      context({
        preset: preset([slot]),
        setup: { premise: 'A smuggler owes the wrong people.', difficulty: 'even' },
      }),
    );

    expect(candidates.map(({ text, source }) => ({ text, source }))).toEqual([
      {
        text: 'What this story is about: A smuggler owes the wrong people.',
        source: { kind: 'setup', field: 'premise' },
      },
    ]);
  });

  it('says why it is empty: an unanswered field, or no answers gathered at all', () => {
    const unanswered = collectCandidates(
      context({ preset: preset([slot]), setup: { difficulty: 'even' } }),
    );
    const ungathered = collectCandidates(context({ preset: preset([slot]) }));

    expect(unanswered.candidates).toEqual([]);
    expect(unanswered.notFilled.map((row) => row.reason)).toEqual(['empty-source']);
    expect(ungathered.notFilled.map((row) => row.reason)).toEqual(['no-producer']);
  });
});

/**
 * ***The assistant says what it can see*** (2026-09-30) — the real pack, and
 * the channel the assistant panel writes.
 *
 * The context channel had a budget and no `render`, and `renderWithin` gives
 * such a channel no words, so the slot the pack positions was empty on every
 * turn: the panel's *"You can see what they have open"* was true of no
 * prompt, and the mode's own test, which checked the budget, could not see it.
 */
describe('the assistant’s view of the screen', () => {
  beforeEach(async () => {
    await installBuiltIns();
  });

  const ASSISTANT = 'storyengine.assistant';

  function collectWith(value: unknown) {
    const pack = modeById(ASSISTANT)?.definition.assembly.defaultPreset;
    if (pack === undefined) throw new Error('the assistant is a built-in');
    return collectCandidates(
      context({
        modeId: ASSISTANT,
        preset: pack,
        channels: { 'se.assistant.context': { version: 1, value } },
      }),
    );
  }

  const said = (value: unknown) =>
    collectWith(value).candidates.find((candidate) => candidate.id === 'se.assistant.context')
      ?.text;

  it('tells it what the person has open, in the library’s words', () => {
    expect(said({ kind: 'actors', id: 'a-1', name: 'Vera', where: 'the library' })).toBe(
      'What they have open, in the library: the actor “Vera” (id a-1).',
    );
    expect(said({ kind: 'session', id: 's-1', where: 'a session' })).toBe(
      'What they have open, in a session: the session (id s-1).',
    );
  });

  it('names a kind it has no word for as it was written', () => {
    expect(said({ kind: 'widgets', id: 'w-1', where: 'the library' })).toBe(
      'What they have open, in the library: widgets (id w-1).',
    );
  });

  it('says nothing when nothing is open, and says why', () => {
    const { candidates, notFilled } = collectWith(null);

    expect(candidates.find((candidate) => candidate.id === 'se.assistant.context')).toBeUndefined();
    // A channel that renders is a producer, so its empty is its source's.
    expect(notFilled.find((row) => row.blockId === 'se.assistant.context')?.reason).toBe(
      'empty-source',
    );
  });
});

describe('a session on another mode', () => {
  beforeEach(async () => {
    await installBuiltIns();
  });

  const FREEFORM = 'storyengine.freeform';
  const world = {
    'se.track.world.on': { version: 1, value: true },
    'se.track.world': {
      version: 1,
      value: {
        date: '',
        time: 'dusk',
        location: 'the docks',
        weather: '',
        temperature: '',
        fields: [],
        recent: [],
      },
    },
  };

  it('is told of no tracker its mode does not keep', () => {
    const slot = block({ kind: 'slot', id: 'se.state', source: { of: 'state' } });
    const said = (modeId: string) =>
      collectCandidates(
        context({ modeId, preset: preset([slot]), channels: world }),
      ).candidates.find((candidate) => candidate.id === 'se.state')?.text;

    expect(said(DEFAULT_MODE_ID)).toContain('the docks');
    expect(said(FREEFORM)).toBeUndefined();
  });

  it('hears nothing from a slot naming a channel its mode does not play', () => {
    const slot = block({
      kind: 'slot',
      id: 'se.clock',
      source: { of: 'channel', channelId: SE_CLOCK },
    });
    const channels = { [SE_CLOCK]: { version: 1, value: { day: 3, hour: 9, minute: 5 } } };
    const scene = collectCandidates(context({ preset: preset([slot]), channels }));
    const freeform = collectCandidates(
      context({ modeId: FREEFORM, preset: preset([slot]), channels }),
    );

    expect(scene.candidates.map((candidate) => candidate.id)).toEqual(['se.clock']);
    expect(freeform.candidates).toEqual([]);
    // The reason a channel nobody declares gets — from this session's side,
    // there is no such channel.
    expect(freeform.notFilled.find((row) => row.blockId === 'se.clock')?.reason).toBe(
      'no-producer',
    );
  });

  it('stands a slot aside only for a tracker its mode keeps', () => {
    // A tracker claiming the clock, kept by Freeform and switched on in a
    // session playing Scene — which has no such tracker to say the time. Its
    // switch is set here only, so the registry this file shares is left with a
    // tracker nothing switches on.
    registerChannel({
      id: 'example.elsewhere',
      owner: FREEFORM,
      version: 1,
      scope: 'session',
      update: 'model-proposed',
      visibility: 'player',
      budget: 100,
      render: '{{ value }}',
      schema: { type: 'string' },
      init: { kind: 'literal', value: 'noon' },
      enabledBy: 'example.elsewhere.on',
      state: { label: 'Elsewhere', supersedes: [SE_CLOCK] },
    });
    const slot = block({
      kind: 'slot',
      id: 'se.clock',
      source: { of: 'channel', channelId: SE_CLOCK },
    });
    const channels = {
      [SE_CLOCK]: { version: 1, value: { day: 3, hour: 9, minute: 5 } },
      'example.elsewhere.on': { version: 1, value: true },
    };

    const { candidates } = collectCandidates(context({ preset: preset([slot]), channels }));

    expect(candidates.map((candidate) => candidate.id)).toEqual(['se.clock']);
  });
});

describe('a wrapper names who its block is about', () => {
  beforeEach(async () => {
    await installBuiltIns();
  });

  const persona = {
    actor: actorWith('Ned', 'Ned keeps the rain off other people.'),
    contentHash: 'sha256:ned-1',
  };
  const vera = {
    actor: actorWith('Vera', 'Vera runs the night desk.'),
    contentHash: 'sha256:vera-1',
  };
  const marlow = {
    actor: actorWith('Marlow', 'Marlow owes somebody money.'),
    contentHash: 'sha256:marlow-1',
  };

  function scene(): Preset {
    const pack = modeById('storyengine.scene')?.definition.assembly.defaultPreset;
    if (pack === undefined) throw new Error('Scene is a built-in');
    return pack;
  }

  it('says whose block is whose in the shipped Scene pack', () => {
    const { candidates } = collectCandidates(
      context({ preset: scene(), persona, actors: [vera, marlow] }),
    );
    const text = (id: string): string | undefined =>
      candidates.find((candidate) => candidate.id === id)?.text;

    expect(text('se.persona')).toBe(
      "The player's character, Ned:\nNed keeps the rain off other people.",
    );
    // Each actor's block by that actor's name, not the first of the cast's.
    expect(text(`se.actor.summary.${vera.actor.id}`)).toBe('Vera:\nVera runs the night desk.');
    expect(text(`se.actor.summary.${marlow.actor.id}`)).toBe(
      'Marlow:\nMarlow owes somebody money.',
    );
    expect(text(`se.actor.traits.${marlow.actor.id}`)).toBe("Marlow's traits: watchful");
  });

  it('renders the names and never the content', () => {
    // A card's prose is somebody else's, and a `{{` in it is prose.
    const { candidates } = collectCandidates(
      context({
        preset: preset([
          block({
            kind: 'slot',
            source: { of: 'actor', sectionId: 'se.summary' },
            wrapper: 'About {{ char }}, for {{ user }}: {{content}}',
          }),
        ]),
        persona,
        actors: [
          {
            actor: actorWith('Vera', 'She signs as {{ char }} and means {{user}}.'),
            contentHash: 'h',
          },
        ],
      }),
    );

    expect(candidates[0]?.text).toBe(
      'About Vera, for Ned: She signs as {{ char }} and means {{user}}.',
    );
  });

  it('keeps a wrapper’s words as written when it will not render', () => {
    const { candidates } = collectCandidates(
      context({
        preset: preset([
          block({
            kind: 'slot',
            source: { of: 'persona' },
            wrapper: '{% if user %}Played by {{ user }}: {{content}}',
          }),
        ]),
        persona,
      }),
    );

    // An unclosed tag: the wrapper stays as it was, content still in place.
    expect(candidates[0]?.text).toBe(
      '{% if user %}Played by {{ user }}: Ned keeps the rain off other people.',
    );
  });

  it('names the player in a past input’s wrapper too', () => {
    const turn: Turn = {
      id: 't1',
      sessionId: 's',
      parentTurnId: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      status: 'complete',
      input: { actorId: null, kind: 'say', text: 'Evening.', raw: '' },
      output: { text: 'She nods.' },
      effects: [],
      tape: [],
    };
    const { candidates } = collectCandidates(
      context({
        preset: preset([
          block({ kind: 'slot', id: 'se.h', source: { of: 'history' } }),
          block({
            kind: 'slot',
            id: 'se.input',
            role: 'user',
            source: { of: 'input' },
            wrapper: '{{ user }} says: {{content}}',
          }),
        ]),
        persona,
        history: [turn],
        input: { text: 'Goodnight.' },
      }),
    );

    expect(candidates.map((candidate) => candidate.text)).toEqual([
      'Ned says: Evening.',
      'She nods.',
      'Ned says: Goodnight.',
    ]);
  });
});

/**
 * ***Pictures on a move*** — [26 E15], R1. Four claims the collector alone
 * decides, each written to fail when its line is removed:
 *
 * - a picture on the move being made is **required**, as the move's words are —
 *   a budget that could drop it would drop the part of the move being shown;
 * - it is **never framed by the move's kind** — a picture is not speech — and
 *   in history wears the history slot's wrapper as every history block does, so
 *   the same picture reads the same before and after its turn;
 * - in history it follows its turn's words and precedes the reply, and is
 *   **never current**, so R1 never sends an old picture as pixels;
 * - a move that was only a picture still has its picture in history, where an
 *   empty half would otherwise have been dropped with nothing in its place.
 */
describe('pictures on a move', () => {
  const PICTURE = {
    id: '0',
    kind: 'image',
    digest: `sha256:${'c'.repeat(64)}`,
    mime: 'image/png',
    caption: 'a lantern',
  };

  it('makes the move’s picture a required candidate, in its own words both ways', () => {
    const { candidates } = collectCandidates(
      context({
        preset: preset([
          block({
            kind: 'slot',
            id: 'se.input',
            role: 'user',
            source: { of: 'input' },
            wrapper: 'You say: “{{content}}”',
          }),
        ]),
        input: { text: 'Look.', attachments: [PICTURE] },
      }),
    );

    const words = candidates.find((one) => one.id === 'se.input');
    expect(words?.text).toBe('You say: “Look.”');
    const picture = candidates.find((one) => one.image !== undefined);
    expect(picture?.id).toBe('se.input.attachment.0');
    expect(picture?.required).toBe(true);
    // Not *you say: "[Picture…]"* — a picture is not a line of speech.
    expect(picture?.text).toBe('[Picture — not shown: a lantern]');
    expect(picture?.image).toMatchObject({
      current: true,
      digest: PICTURE.digest,
      sentText: '[Picture: a lantern]',
    });
    expect(picture?.source).toEqual({ kind: 'input', part: 'attachment', attachmentId: '0' });
  });

  /**
   * ***The same picture, before and after its turn*** — the drift main's
   * `asItWasSaid` removed for a move's words, which pictures reached from the
   * other side: framed as speech while current, bare a turn later. Pack-shaped:
   * a `say` slot that quotes, a history slot with a wrapper of its own.
   */
  it('reads the same as the move being made and in history, but for the history slot’s own frame', () => {
    const say = block({
      kind: 'slot',
      id: 'se.input.say',
      role: 'user',
      source: { of: 'input' },
      appliesTo: ['say'],
      wrapper: 'The player’s character says: “{{content}}”',
    });
    const history = block({
      kind: 'slot',
      id: 'se.history',
      source: { of: 'history' },
      wrapper: '(earlier) {{content}}',
    });
    const now = collectCandidates(
      context({
        preset: preset([history, say]),
        inputKind: 'say',
        input: { text: 'Look.', attachments: [PICTURE] },
      }),
    ).candidates.find((one) => one.image !== undefined);
    const later = collectCandidates(
      context({
        preset: preset([history, say]),
        history: [
          {
            id: 'turn-1',
            input: {
              actorId: null,
              kind: 'say',
              text: 'Look.',
              raw: 'Look.',
              attachments: [PICTURE],
            },
            output: { text: 'A lantern, lit.' },
          } as Turn,
        ],
      }),
    ).candidates.find((one) => one.image !== undefined);

    expect(now?.image?.sentText).toBe('[Picture: a lantern]');
    expect(later?.text).toBe('(earlier) [Picture — not shown: a lantern]');
    expect(later?.image?.sentText).toBe('(earlier) [Picture: a lantern]');
  });

  it('places an old picture after its words and before the reply, never as current', () => {
    const turn = {
      id: 'turn-1',
      input: { actorId: null, kind: 'do', text: 'Look.', raw: 'Look.', attachments: [PICTURE] },
      output: { text: 'A lantern, lit.' },
    } as Turn;
    const { candidates } = collectCandidates(
      context({
        preset: preset([block({ kind: 'slot', id: 'se.history', source: { of: 'history' } })]),
        history: [turn],
      }),
    );

    expect(candidates.map((one) => one.id)).toEqual([
      'se.history.turn-1.input',
      'se.history.turn-1.attachment.0',
      'se.history.turn-1.output',
    ]);
    expect(candidates[1]?.image?.current).toBe(false);
    expect(candidates[1]?.required).toBeUndefined();
  });

  it('keeps a move that was only a picture', () => {
    const turn = {
      id: 'turn-1',
      input: {
        actorId: null,
        kind: 'do',
        text: '',
        raw: '',
        attachments: [{ id: '0', kind: 'image' }],
      },
      output: { text: 'Hm.' },
    } as Turn;
    const { candidates } = collectCandidates(
      context({
        preset: preset([block({ kind: 'slot', id: 'se.history', source: { of: 'history' } })]),
        history: [turn],
      }),
    );

    const picture = candidates.find((one) => one.image !== undefined);
    expect(picture?.text).toBe('[Picture — not shown, and not described]');
    expect(picture?.image?.digest).toBeNull();
  });
});

/**
 * ***A call that speaks for somebody*** — [P14 §1.4](../../../../docs/design/workplan/31-p14-scene-and-session-import.md),
 * [P14.2].
 */
describe('a call that speaks for somebody', () => {
  beforeEach(async () => {
    await installBuiltIns();
  });

  function sampleOf(id: string, body: string): WritingSample {
    return { id, title: id, body, enabled: true, note: '' };
  }

  const persona = {
    actor: actorWith('Ned', 'Ned keeps the rain off other people.'),
    contentHash: 'sha256:ned-1',
  };
  const vera = {
    actor: {
      ...actorWith('Vera', 'Vera runs the night desk.'),
      writingSamples: [sampleOf('v-1', 'Vera says less than she knows.')],
    },
    contentHash: 'sha256:vera-1',
  };
  const marlow = {
    actor: actorWith('Marlow', 'Marlow owes somebody money.'),
    contentHash: 'sha256:marlow-1',
  };
  const lund = {
    actor: actorWith('Lund', 'Lund keeps the harbour.'),
    contentHash: 'sha256:lund-1',
  };

  function scene(): Preset {
    const pack = modeById('storyengine.scene')?.definition.assembly.defaultPreset;
    if (pack === undefined) throw new Error('Scene is a built-in');
    return pack;
  }

  const past = {
    id: 'turn-1',
    input: { actorId: null, kind: 'do', text: 'I knock.', raw: 'I knock.' },
    output: { text: 'The door gave.' },
  } as Turn;

  /**
   * ***A call that names nobody collects exactly what it collected before
   * P14.2*** — the snapshot was written against the build without speaking
   * calls, over the stock Scene pack with a persona, three cast members, a
   * sample and a turn of history, so every slot that pack positions has
   * something to say. Actor ids are replaced by names so the record reads.
   *
   * *A narrator's call, said since [P14.3]*: the stock pack keys its two
   * instructions to the call's voice, and a call that writes the turn and
   * names nobody is the narrator's (`CollectContext.voice`). The snapshot did
   * not move — which is the claim: the narrated setting is byte-identical.
   *
   * ***It moved once, on purpose*** (2026-09-30): the pack slots the time and
   * the place since, so the narrator is told the clock — this session has no
   * place yet, so that slot says nothing. Everything else is as it was.
   */
  it('collects, for a call that names nobody, what it collected before', () => {
    const { candidates } = collectCandidates(
      context({
        preset: scene(),
        persona,
        actors: [vera, marlow, lund],
        history: [past],
        input: { text: 'I wait.' },
        voice: 'narrator',
      }),
    );
    const named = (text: string): string =>
      [vera, marlow, lund].reduce(
        (out, member) => out.replaceAll(member.actor.id, member.actor.name),
        text,
      );
    expect(
      candidates.map((one) => ({
        id: named(one.id),
        role: one.role,
        priority: one.priority,
        text: one.text,
      })),
    ).toMatchInlineSnapshot(`
      [
        {
          "id": "se.instruction",
          "priority": 90,
          "role": "system",
          "text": "You are the narrator of a scene. Write what happens next in third person, past tense. Describe only what the player could perceive. Never write the player's own dialogue, thoughts or decisions, and never end by asking what they do.",
        },
        {
          "id": "se.persona",
          "priority": 70,
          "role": "system",
          "text": "The player's character, Ned:
      Ned keeps the rain off other people.",
        },
        {
          "id": "se.actor.summary.Vera",
          "priority": 70,
          "role": "system",
          "text": "Vera:
      Vera runs the night desk.",
        },
        {
          "id": "se.actor.summary.Marlow",
          "priority": 70,
          "role": "system",
          "text": "Marlow:
      Marlow owes somebody money.",
        },
        {
          "id": "se.actor.summary.Lund",
          "priority": 70,
          "role": "system",
          "text": "Lund:
      Lund keeps the harbour.",
        },
        {
          "id": "se.actor.traits.Vera",
          "priority": 35,
          "role": "system",
          "text": "Vera's traits: watchful",
        },
        {
          "id": "se.actor.traits.Marlow",
          "priority": 35,
          "role": "system",
          "text": "Marlow's traits: watchful",
        },
        {
          "id": "se.actor.traits.Lund",
          "priority": 35,
          "role": "system",
          "text": "Lund's traits: watchful",
        },
        {
          "id": "se.samples.Vera.v-1",
          "priority": 20,
          "role": "system",
          "text": "Vera says less than she knows.",
        },
        {
          "id": "se.clock",
          "priority": 50,
          "role": "system",
          "text": "When this is happening: Day 1, 08:00",
        },
        {
          "id": "se.history.turn-1.input",
          "priority": 10,
          "role": "user",
          "text": "I knock.",
        },
        {
          "id": "se.history.turn-1.output",
          "priority": 10,
          "role": "assistant",
          "text": "The door gave.",
        },
        {
          "id": "se.input",
          "priority": 100,
          "role": "user",
          "text": "I wait.",
        },
      ]
    `);
  });

  /** Every name the namespace holds, in one line a test can read. */
  const NAMES = block({
    kind: 'text',
    id: 'se.names',
    template:
      'char={{ char }}|group={{ group }}|charIfNotGroup={{ charIfNotGroup }}|notChar={{ notChar }}|user={{ user }}',
  });

  function namesIn(over: Partial<CollectContext>): string | undefined {
    return collectCandidates(context({ preset: preset([NAMES]), ...over })).candidates[0]?.text;
  }

  describe('the namespace, re-scoped to the speaker', () => {
    /**
     * ST's meanings, at the pin: `{{group}}` is every member, muted included
     * (`MacroEnvBuilder.js:135`, `includeMuted: true`); `{{charIfNotGroup}}` is
     * an alias of it (`env-macros.js:31`); `{{notChar}}` is documented as *all
     * participants except the current speaker* (`env-macros.js:45-50`). Ours
     * keeps the persona in `notChar`, which ST's group branch drops — see
     * `RenderContext.notChar`.
     */
    it('names the speaker as char, the whole cast as the group, and everyone else as notChar', () => {
      expect(namesIn({ persona, actors: [vera, marlow, lund], speaker: marlow.actor.id })).toBe(
        'char=Marlow|group=Vera, Marlow, Lund|charIfNotGroup=Vera, Marlow, Lund|' +
          'notChar=Ned, Vera, Lund|user=Ned',
      );
    });

    it('reads as before for a call that speaks for nobody: char is the first of the cast', () => {
      // `{{char}}` has meant the first cast member since P4.1, and a merged
      // call still means it — the mutation is re-scoping without a speaker.
      // `notChar` is the persona alone there (2026-09-29, the [P14.2] review):
      // nobody is speaking, so there is no member to count the others from.
      expect(namesIn({ persona, actors: [vera, marlow, lund] })).toBe(
        'char=Vera|group=Vera, Marlow, Lund|charIfNotGroup=Vera, Marlow, Lund|' +
          'notChar=Ned|user=Ned',
      );
    });

    /**
     * ***An imported pack's `{{notChar}}` on a narrator's call*** — the importer
     * keeps it as written, and before P14.2 it rendered empty. Counted from
     * `actors[0]` it would have told the narrator never to write for the
     * persona and every member but the first; it names the persona, the one
     * person a narrator must never write for.
     */
    it("gives a narrator's call SillyTavern's solo-chat notChar: the persona", () => {
      const { candidates } = collectCandidates(
        context({
          preset: preset([
            block({ kind: 'text', id: 'se.never', template: 'Never write for {{notChar}}.' }),
          ]),
          persona,
          actors: [vera, marlow],
        }),
      );
      expect(candidates.map((one) => one.text)).toMatchInlineSnapshot(`
        [
          "Never write for Ned.",
        ]
      `);
    });

    it('says the one name, not a group, when the cast has one member', () => {
      expect(namesIn({ persona, actors: [lund], speaker: lund.actor.id })).toBe(
        'char=Lund|group=Lund|charIfNotGroup=Lund|notChar=Ned|user=Ned',
      );
    });

    it('keeps a muted member in the group and in notChar', () => {
      // The collector reads no presence at all, and that is the claim: a muted
      // member is in the room and is somebody a reply must not speak as.
      expect(
        namesIn({
          persona,
          actors: [vera, marlow, lund],
          speaker: vera.actor.id,
          channels: { [`se.presence#${lund.actor.id}`]: { version: 1, value: false } },
        }),
      ).toBe(
        'char=Vera|group=Vera, Marlow, Lund|charIfNotGroup=Vera, Marlow, Lund|' +
          'notChar=Ned, Marlow, Lund|user=Ned',
      );
    });

    it('puts the player in notChar by the word it uses for them when there is no persona', () => {
      expect(namesIn({ persona: null, actors: [vera, marlow], speaker: marlow.actor.id })).toBe(
        'char=Marlow|group=Vera, Marlow|charIfNotGroup=Vera, Marlow|' +
          'notChar=the player, Vera|user=the player',
      );
    });

    it('reads a speaker the cast does not hold as nobody', () => {
      expect(namesIn({ persona, actors: [vera, marlow], speaker: 'somebody-else' })).toBe(
        'char=Vera|group=Vera, Marlow|charIfNotGroup=Vera, Marlow|notChar=Ned|user=Ned',
      );
    });

    it("renders each actor block's wrapper about its own actor, notChar included", () => {
      const { candidates } = collectCandidates(
        context({
          preset: preset([
            block({
              kind: 'slot',
              id: 'se.a',
              source: { of: 'actor', sectionId: 'se.summary' },
              wrapper: '{{ char }}, not {{ notChar }}: {{content}}',
            }),
          ]),
          persona,
          actors: [vera, marlow],
          speaker: marlow.actor.id,
        }),
      );
      expect(candidates.map((one) => one.text)).toEqual([
        'Marlow, not Ned, Vera: Marlow owes somebody money.',
        'Vera, not Ned, Marlow: Vera runs the night desk.',
      ]);
    });
  });

  describe('whose cards, in what order', () => {
    const summary = (scope?: 'speaker' | 'others'): PresetBlock =>
      block({
        kind: 'slot',
        id: 'se.a',
        source:
          scope === undefined
            ? { of: 'actor', sectionId: 'se.summary' }
            : { of: 'actor', sectionId: 'se.summary', scope },
      });

    const whose = (over: Partial<CollectContext>): string[] =>
      collectCandidates(context({ actors: [vera, marlow, lund], ...over })).candidates.map(
        (one) => one.text.split('\n')[0] ?? '',
      );

    it("puts the speaker's card first and keeps every other card", () => {
      expect(whose({ preset: preset([summary()]), speaker: lund.actor.id })).toEqual([
        'Lund keeps the harbour.',
        'Vera runs the night desk.',
        'Marlow owes somebody money.',
      ]);
    });

    it('keeps cast order for a call that speaks for nobody', () => {
      expect(whose({ preset: preset([summary()]) })).toEqual([
        'Vera runs the night desk.',
        'Marlow owes somebody money.',
        'Lund keeps the harbour.',
      ]);
    });

    it('narrows a block scoped to the speaker, and one scoped to the others', () => {
      expect(whose({ preset: preset([summary('speaker')]), speaker: marlow.actor.id })).toEqual([
        'Marlow owes somebody money.',
      ]);
      expect(whose({ preset: preset([summary('others')]), speaker: marlow.actor.id })).toEqual([
        'Vera runs the night desk.',
        'Lund keeps the harbour.',
      ]);
    });

    it('partitions the cast on a call that speaks for nobody: speaker is nobody, others everyone', () => {
      const { candidates, notFilled } = collectCandidates(
        context({ preset: preset([summary('speaker')]), actors: [vera, marlow, lund] }),
      );
      expect(candidates).toEqual([]);
      // Not `empty-source`: the cast has cards, and the block was not for any
      // of them on this call.
      expect(notFilled).toEqual([{ blockId: 'se.a', source: 'actor', reason: 'not-applicable' }]);
      expect(whose({ preset: preset([summary('others')]) })).toHaveLength(3);
    });

    it('says a scoped block over an empty cast is empty, as an unscoped one is', () => {
      const { notFilled } = collectCandidates(
        context({ preset: preset([summary('speaker')]), actors: [] }),
      );
      expect(notFilled[0]?.reason).toBe('empty-source');
    });

    it("scopes the actor carrier's samples and leaves the treatment's alone", () => {
      const noir = newTreatment('Rain City Noir');
      noir.writingSamples = [sampleOf('t-1', 'The rain never lets up.')];
      const marlowWithSample = {
        ...marlow,
        actor: { ...marlow.actor, writingSamples: [sampleOf('m-1', 'Marlow counts twice.')] },
      };
      const samples = (scope?: 'speaker' | 'others'): string[] =>
        collectCandidates(
          context({
            preset: preset([
              block({
                kind: 'slot',
                id: 'se.samples',
                source: scope === undefined ? { of: 'samples' } : { of: 'samples', scope },
              }),
            ]),
            actors: [vera, marlowWithSample],
            carriers: { treatment: { treatment: noir, id: noir.id, contentHash: 'h' }, books: [] },
            speaker: marlow.actor.id,
          }),
        ).candidates.map((one) => one.text);

      expect(samples()).toEqual([
        'The rain never lets up.',
        'Marlow counts twice.',
        'Vera says less than she knows.',
      ]);
      expect(samples('speaker')).toEqual(['The rain never lets up.', 'Marlow counts twice.']);
      expect(samples('others')).toEqual([
        'The rain never lets up.',
        'Vera says less than she knows.',
      ]);
    });
  });

  describe('the round so far', () => {
    const said = (member: { actor: Actor }, text: string): OutputMessage => ({
      speaker: { id: member.actor.id, name: member.actor.name },
      text,
    });

    const INPUT = block({
      kind: 'slot',
      id: 'se.input',
      role: 'user',
      priority: 100,
      source: { of: 'input' },
    });
    const AFTER = block({ kind: 'text', id: 'se.after', template: 'Stay in the scene.' });

    it('follows the input, in order, as the model’s own lines', () => {
      const { candidates } = collectCandidates(
        context({
          preset: preset([
            block({ kind: 'slot', id: 'se.history', source: { of: 'history' } }),
            INPUT,
            AFTER,
          ]),
          history: [past],
          input: { text: 'Well?' },
          actors: [vera, marlow, lund],
          speaker: lund.actor.id,
          round: [said(vera, '"You came."'), said(marlow, '"I owe you nothing."')],
        }),
      );

      expect(candidates.map((one) => [one.id, one.role, one.text])).toEqual([
        ['se.history.turn-1.input', 'user', 'I knock.'],
        ['se.history.turn-1.output', 'assistant', 'The door gave.'],
        ['se.input', 'user', 'Well?'],
        // Named since [P14.3]: two speakers are in the window with the round,
        // so `groups` names each line ([P14 §1.5]).
        ['se.round.0', 'assistant', 'Vera: "You came."'],
        ['se.round.1', 'assistant', 'Marlow: "I owe you nothing."'],
        ['se.after', 'system', 'Stay in the scene.'],
      ]);
      // Its own source, saying which message and whose, and priced as the
      // history's ramp continued — the history slot's 50, past its one turn —
      // oldest cheapest, never required.
      expect(candidates[3]?.source).toEqual({ kind: 'round', message: 0, actorId: vera.actor.id });
      expect(candidates[4]?.source).toEqual({
        kind: 'round',
        message: 1,
        actorId: marlow.actor.id,
      });
      expect(candidates.slice(3, 5).map((one) => [one.priority, one.required])).toEqual([
        [51, undefined],
        [52, undefined],
      ]);
    });

    /**
     * ***Chat goes before card fields*** (2026-09-29, the [P14.2] review) —
     * priced from the input slot, the round outranked every block in the pack,
     * and a tight budget took the speaker's own card before an earlier reply.
     */
    it('is dropped before a card when the budget is tight', () => {
      const { candidates } = collectCandidates(
        context({
          preset: preset([
            block({ kind: 'slot', id: 'se.history', source: { of: 'history' } }),
            block({
              kind: 'slot',
              id: 'se.card',
              priority: 60,
              source: { of: 'actor', sectionId: 'se.summary', scope: 'speaker' },
            }),
            INPUT,
            block({ kind: 'text', id: 'se.after', priority: 90, template: 'Stay in the scene.' }),
          ]),
          input: { text: 'Well?' },
          actors: [vera, marlow],
          speaker: marlow.actor.id,
          round: [said(vera, '"You came."')],
        }),
      );
      const whole = assemble({ candidates, policy: GENEROUS });
      const total = whole.blocks.reduce((sum, one) => sum + one.tokens, 0);
      const tight = assemble({
        candidates,
        policy: { limit: { tokens: total - 1, ceiling: total - 1, source: 'user' }, reserved: 0 },
      });
      const included = (id: string): boolean | undefined =>
        tight.blocks.find((one) => one.id === id)?.included;
      expect(included('se.round.0')).toBe(false);
      expect(included(`se.card.${marlow.actor.id}`)).toBe(true);
    });

    /**
     * ***After the input the turn carried, not the pack's first*** (2026-09-29,
     * the [P14.2] review) — Freeform's shape: a slot per input kind, each
     * followed by its instruction. On a `say` turn the `do` slot is skipped, and
     * a round placed after it came before the move it answers.
     */
    describe('in a pack with a slot per input kind', () => {
      const pack = preset([
        block({
          kind: 'slot',
          id: 'se.input.do',
          role: 'user',
          appliesTo: ['do'],
          source: { of: 'input' },
        }),
        block({ kind: 'text', id: 'se.do.after', appliesTo: ['do'], template: 'Narrate it.' }),
        block({
          kind: 'slot',
          id: 'se.input.say',
          role: 'user',
          appliesTo: ['say'],
          source: { of: 'input' },
        }),
        block({ kind: 'text', id: 'se.say.after', appliesTo: ['say'], template: 'Answer it.' }),
      ]);

      it('follows the slot that applied', () => {
        const { candidates } = collectCandidates(
          context({
            preset: pack,
            inputKind: 'say',
            input: { text: 'Well?' },
            actors: [vera, marlow],
            speaker: marlow.actor.id,
            round: [said(vera, '"You came."')],
          }),
        );
        expect(candidates.map((one) => one.id)).toEqual([
          'se.input.say',
          'se.round.0',
          'se.say.after',
        ]);
      });

      it('follows the first input slot on a turn with no input', () => {
        const { candidates } = collectCandidates(
          context({
            preset: preset([
              block({
                kind: 'slot',
                id: 'se.input.do',
                role: 'user',
                appliesTo: ['do'],
                source: { of: 'input' },
              }),
              AFTER,
              block({
                kind: 'slot',
                id: 'se.input.say',
                role: 'user',
                appliesTo: ['say'],
                source: { of: 'input' },
              }),
            ]),
            actors: [vera, marlow],
            speaker: marlow.actor.id,
            round: [said(vera, '"You came."')],
          }),
        );
        expect(candidates.map((one) => one.id)).toEqual(['se.round.0', 'se.after']);
      });
    });

    it('stands where the input would have been on a turn with no input', () => {
      const { candidates } = collectCandidates(
        context({
          preset: preset([INPUT, AFTER]),
          actors: [vera, marlow],
          speaker: marlow.actor.id,
          round: [said(vera, '"You came."')],
        }),
      );
      expect(candidates.map((one) => one.id)).toEqual(['se.round.0', 'se.after']);
    });

    it('goes last in a pack with no input slot, and skips a message cleanup emptied', () => {
      const { candidates } = collectCandidates(
        context({
          preset: preset([AFTER]),
          actors: [vera, marlow, lund],
          speaker: lund.actor.id,
          round: [said(vera, ''), said(marlow, '"Later."')],
        }),
      );
      expect(candidates.map((one) => [one.id, one.priority])).toEqual([
        ['se.after', 50],
        ['se.round.1', 101],
      ]);
    });

    it('is nothing at all when the call is the first of its round', () => {
      const { candidates } = collectCandidates(
        context({ preset: preset([INPUT, AFTER]), input: { text: 'Well?' }, round: [] }),
      );
      expect(candidates.map((one) => one.id)).toEqual(['se.input', 'se.after']);
    });
  });
});

/**
 * ***A chat, as [P14.3] assembles it*** — [P14 §1.5]'s pack, the card's own
 * prompts, names in history, the author's note and the hidden filter, over the
 * Scene pack that ships (read through the registry, so it is the pack a real
 * session copies).
 */
describe('a chat, assembled', () => {
  beforeEach(async () => {
    await installBuiltIns();
  });

  function scene(): Preset {
    const pack = modeById('storyengine.scene')?.definition.assembly.defaultPreset;
    if (pack === undefined) throw new Error('Scene is a built-in');
    return pack;
  }

  function carded(
    name: string,
    prompts: { system?: string; post?: string; depth?: [string, number, 'system' | 'user'] },
  ): { actor: Actor; contentHash: string } {
    const actor = actorWith(name, `${name} is in the room.`);
    const extra = [
      ...(prompts.system === undefined
        ? []
        : [
            {
              id: 'se.card.system',
              title: 's',
              body: prompts.system,
              disposition: 'always' as const,
            },
          ]),
      ...(prompts.post === undefined
        ? []
        : [
            {
              id: 'se.card.post-history',
              title: 'p',
              body: prompts.post,
              disposition: 'always' as const,
            },
          ]),
      ...(prompts.depth === undefined
        ? []
        : [
            {
              id: 'se.card.depth',
              title: 'd',
              body: prompts.depth[0],
              disposition: 'always' as const,
              placement: { fromEnd: prompts.depth[1], role: prompts.depth[2] },
            },
          ]),
    ];
    return {
      actor: {
        ...actor,
        profile: { ...actor.profile, sections: [...actor.profile.sections, ...extra] },
      },
      contentHash: `sha256:${name}`,
    };
  }

  const persona = { actor: actorWith('Ned', 'Ned is the player.'), contentHash: 'sha256:ned' };
  const vera = carded('Vera', {
    system: 'You are Vera. Answer in short sentences.',
    post: 'Vera never apologises.',
    depth: ['Vera is tired.', 1, 'user'],
  });
  const lund = carded('Lund', { system: 'You are Lund.', post: 'Lund speaks slowly.' });

  const CHAT = {
    dispatch: 'per-actor',
    castIsPresent: true,
    namesInHistory: 'groups',
    hidden: {},
    prompts: { instruction: true, cards: {} },
    note: null,
  } satisfies NonNullable<CollectContext['chat']>;

  const turn = (id: string, input: string, messages?: OutputMessage[], text?: string): Turn =>
    ({
      id,
      input: { actorId: null, kind: 'do', text: input, raw: input },
      output:
        messages === undefined
          ? { text: text ?? '' }
          : { text: messages.map((m) => m.text).join('\n\n'), messages },
    }) as Turn;
  const line = (who: { actor: Actor } | null, text: string): OutputMessage => ({
    speaker: who === null ? null : { id: who.actor.id, name: who.actor.name },
    text,
  });

  /** `nobody` drops the speaker and the voice, for a call that names neither. */
  function speaking(
    over: Partial<CollectContext> = {},
    nobody = false,
  ): { id: string; role: string; text: string }[] {
    return collectCandidates(
      context({
        preset: scene(),
        persona,
        actors: [vera, lund],
        input: { text: 'Well?' },
        ...(nobody ? {} : { speaker: lund.actor.id, voice: 'embodied' as const }),
        chat: CHAT,
        ...over,
      }),
    ).candidates.map((one) => ({
      id: one.id.replaceAll(vera.actor.id, 'vera').replaceAll(lund.actor.id, 'lund'),
      role: one.role,
      text: one.text,
    }));
  }
  const ids = (rows: { id: string }[]) => rows.map((row) => row.id);

  describe('the pack, by voice', () => {
    it('names the speaker as the one to write, with the group nudge in a group', () => {
      const rows = speaking();
      const instruction = rows.find((row) => row.id === 'se.instruction.embodied')?.text;

      expect(instruction).toContain(
        "Write Lund's next reply in a fictional chat between Vera, Lund and Ned.",
      );
      expect(instruction).toContain(
        'write only as Lund, and leave Ned, Vera to speak for themselves.',
      );
      // The narrator's instruction is the other voice's.
      expect(ids(rows)).not.toContain('se.instruction');
    });

    /**
     * ***Not under `merged`*** (2026-09-29, the [P14.3] review): the one call
     * writes for the whole room ([P14 §1.4]), and telling it to write only as
     * its first speaker contradicted what the dispatch is for.
     */
    it('leaves the group nudge out of a merged call, which may voice every member', () => {
      const rows = speaking({ chat: { ...CHAT, dispatch: 'merged' } });
      const instruction = rows.find((row) => row.id === 'se.instruction.embodied')?.text;

      expect(instruction).toContain(
        "Write Lund's next reply in a fictional chat between Vera, Lund and Ned.",
      );
      expect(instruction).not.toContain('group chat');
      expect(instruction).not.toContain('write only as');
    });

    it('leaves the group nudge out of a chat with one character', () => {
      const rows = speaking({ actors: [lund] });
      const instruction = rows.find((row) => row.id === 'se.instruction.embodied')?.text;

      expect(instruction).toContain('between Lund and Ned.');
      expect(instruction).not.toContain('group');
    });

    it('narrates a call that speaks for nobody, with no card prompt in it', () => {
      const rows = speaking({ voice: 'narrator' }, true);

      expect(ids(rows)).toContain('se.instruction');
      expect(
        ids(rows).some((id) => id.startsWith('se.card.') || id === 'se.instruction.embodied'),
      ).toBe(false);
    });

    it('sends neither instruction to a call that does not write the turn', () => {
      const rows = speaking({ callKind: 'impersonate' }, true);

      expect(ids(rows).filter((id) => id.startsWith('se.instruction'))).toEqual([]);
    });
  });

  describe('the card’s own prompts', () => {
    it('stacks the speaker’s system prompt after the instruction, and its post-history last', () => {
      const rows = speaking({
        round: [line(vera, 'Vera speaks first.')],
      });
      const at = (id: string) => ids(rows).indexOf(id);

      expect(at('se.card.system.lund')).toBe(at('se.instruction.embodied') + 1);
      expect(rows[at('se.card.system.lund')]?.text).toBe('You are Lund.');
      // After the move and the round so far, as the user: the last thing sent.
      expect(rows.at(-1)).toEqual({
        id: 'se.card.post-history.lund',
        role: 'user',
        text: 'Lund speaks slowly.',
      });
      expect(at('se.round.0')).toBeGreaterThan(at('se.input'));
      expect(at('se.card.post-history.lund')).toBeGreaterThan(at('se.round.0'));
      // Per-actor: only the speaker's — another member's system prompt would
      // tell the model to be two people.
      expect(ids(rows)).not.toContain('se.card.system.vera');
      expect(ids(rows)).not.toContain('se.card.post-history.vera');
    });

    it('stacks every present card’s prompts under merged dispatch, each its own block', () => {
      const rows = speaking({ chat: { ...CHAT, dispatch: 'merged' } });

      expect(ids(rows).filter((id) => id.startsWith('se.card.system.'))).toEqual([
        'se.card.system.lund',
        'se.card.system.vera',
      ]);
      expect(ids(rows).filter((id) => id.startsWith('se.card.post-history.'))).toEqual([
        'se.card.post-history.lund',
        'se.card.post-history.vera',
      ]);
    });

    it('places a depth prompt at its own depth and in its own role', () => {
      const rows = speaking({
        speaker: vera.actor.id,
        history: [
          turn('t1', 'One.', undefined, 'First.'),
          turn('t2', 'Two.', undefined, 'Second.'),
        ],
      });

      // Depth 1: before the newest chat entry — the player's move — as the user
      // it asked to be. ~~Before the newest history entry~~: counted over the
      // whole chat since 2026-09-29, the [P14.3] review, as ST counts it.
      const at = ids(rows).indexOf('se.card.depth.vera');
      expect(ids(rows)[at - 1]).toBe('se.history.t2.output');
      expect(ids(rows)[at + 1]).toBe('se.input');
      expect(rows[at]?.role).toBe('user');
    });

    it('sends only the card’s prompt when the chat switches the instruction off', () => {
      const rows = speaking({ chat: { ...CHAT, prompts: { instruction: false, cards: {} } } });

      expect(ids(rows)).not.toContain('se.instruction.embodied');
      expect(ids(rows)).toContain('se.card.system.lund');
    });

    it('skips a card’s prompts the chat switched off, all of them or the parts named', () => {
      const off = speaking({
        chat: { ...CHAT, prompts: { instruction: true, cards: { [lund.actor.id]: false } } },
      });
      expect(ids(off).filter((id) => id.startsWith('se.card.'))).toEqual([]);

      const part = speaking({
        chat: {
          ...CHAT,
          prompts: { instruction: true, cards: { [lund.actor.id]: ['post-history'] } },
        },
      });
      expect(ids(part)).toContain('se.card.system.lund');
      expect(ids(part)).not.toContain('se.card.post-history.lund');

      const notFilled = collectCandidates(
        context({
          preset: scene(),
          actors: [vera, lund],
          speaker: lund.actor.id,
          voice: 'embodied',
          chat: { ...CHAT, prompts: { instruction: true, cards: { [lund.actor.id]: false } } },
        }),
      ).notFilled;
      expect(notFilled.find((row) => row.blockId === 'se.card.system')?.reason).toBe('disabled');
    });
  });

  /**
   * ***A card taken as the persona brings no card prompts*** (2026-09-29, the
   * [P14.3] review). The persona slot renders every `always` section, and the
   * importer writes a card's three prompts as `always` sections — so its
   * *"You are …"* reached every call, in both voices, past the rules the actor
   * path holds them to.
   */
  describe('a carded persona', () => {
    const carded_persona = carded('Ned', {
      system: 'You are Ned. Never break character.',
      post: 'Ned answers in one line.',
      depth: ['Ned is wary.', 0, 'system'],
    });

    it.each([
      ['a narrator call', { voice: 'narrator' as const }, true],
      ['an embodied call', {}, false],
    ])('keeps them out of the persona block on %s', (_, over, nobody) => {
      const rows = speaking({ persona: carded_persona, ...over }, nobody);
      const texts = rows.map((row) => row.text).join('\n');

      expect(rows.find((row) => row.id === 'se.persona')?.text).toContain('Ned is in the room.');
      expect(texts).not.toContain('You are Ned.');
      expect(texts).not.toContain('Ned answers in one line.');
      expect(texts).not.toContain('Ned is wary.');
    });
  });

  describe('a muted member', () => {
    const muted = {
      [channelKey('se.presence', vera.actor.id)]: { value: false },
    } as CollectContext['channels'];

    it('leaves every call they are not speaking on, under castIsPresent', () => {
      const rows = speaking({ channels: muted });

      expect(ids(rows).some((id) => id.endsWith('.vera'))).toBe(false);
      expect(ids(rows)).toContain('se.actor.summary.lund');
    });

    it('keeps their card on their own call, as force-talk reaches them', () => {
      const rows = speaking({ channels: muted, speaker: vera.actor.id });

      expect(ids(rows)).toContain('se.actor.summary.vera');
    });

    it('stays in the prompt of a mode that does not read presence that way', () => {
      const rows = speaking({ channels: muted, chat: { ...CHAT, castIsPresent: false } });

      expect(ids(rows)).toContain('se.actor.summary.vera');
    });
  });

  describe('names in history', () => {
    const history = [
      turn('t1', 'Hello.', [
        line(vera, 'Evening.'),
        line(null, 'Rain on the glass.'),
        line(lund, 'Aye.'),
      ]),
    ];
    const shown = (over: Partial<CollectContext> = {}) =>
      speaking({ history, ...over }).filter((row) => row.id.startsWith('se.history.'));

    it('names each attributed line once two speakers are in the window, and never the player’s', () => {
      expect(shown()).toEqual([
        { id: 'se.history.t1.input', role: 'user', text: 'Hello.' },
        { id: 'se.history.t1.output.0', role: 'assistant', text: 'Vera: Evening.' },
        // The narrator's line is the system's, with no name (ST `openai.js:581`).
        { id: 'se.history.t1.output.1', role: 'system', text: 'Rain on the glass.' },
        { id: 'se.history.t1.output.2', role: 'assistant', text: 'Lund: Aye.' },
      ]);
    });

    it('names nobody while one speaker is all the window holds, unless told to always', () => {
      const solo = [turn('t1', 'Hello.', [line(lund, 'Aye.')])];

      expect(
        speaking({ history: solo }).find((row) => row.id === 'se.history.t1.output.0')?.text,
      ).toBe('Aye.');
      expect(
        speaking({ history: solo, chat: { ...CHAT, namesInHistory: 'always' } }).find(
          (row) => row.id === 'se.history.t1.output.0',
        )?.text,
      ).toBe('Lund: Aye.');
      expect(
        shown({ chat: { ...CHAT, namesInHistory: 'never' } }).find(
          (row) => row.id === 'se.history.t1.output.0',
        )?.text,
      ).toBe('Evening.');
    });

    it('names the round as it names the past', () => {
      const rows = speaking({ history, round: [line(vera, 'Well then.')] });

      expect(rows.find((row) => row.id === 'se.round.0')?.text).toBe('Vera: Well then.');
    });

    it('keeps a turn with only text one unnamed reply, as it always was', () => {
      const rows = speaking({ history: [turn('t0', 'Hi.', undefined, 'The door gave.')] });

      expect(rows.find((row) => row.id === 'se.history.t0.output')).toEqual({
        id: 'se.history.t0.output',
        role: 'assistant',
        text: 'The door gave.',
      });
    });
  });

  describe('the hidden filter', () => {
    const history = [
      turn('t1', 'Hidden move.', [line(vera, 'Hidden reply.')]),
      turn('t2', 'Kept move.', [line(vera, 'Kept.'), line(lund, 'Hidden line.')]),
    ];

    it('skips a hidden turn whole, and a hidden message by its index', () => {
      const rows = speaking({ history, chat: { ...CHAT, hidden: { t1: true, t2: [1] } } });
      const texts = rows.filter((row) => row.id.startsWith('se.history.')).map((row) => row.text);

      expect(texts).toEqual(['Kept move.', 'Kept.']);
    });
  });

  describe('the author’s note', () => {
    it('sits at its depth in the history, as the system', () => {
      const rows = speaking({
        history: [
          turn('t1', 'One.', undefined, 'First.'),
          turn('t2', 'Two.', undefined, 'Second.'),
        ],
        chat: { ...CHAT, note: { text: 'Keep it tense.', depth: 2 } },
      });
      const at = ids(rows).indexOf('se.note');

      expect(rows[at]).toEqual({ id: 'se.note', role: 'system', text: 'Keep it tense.' });
      // Two entries from the end of the chat, the move counted: before the
      // newest reply. ~~Before `t2.input`~~, counted from the history's end,
      // until 2026-09-29.
      expect(ids(rows)[at + 1]).toBe('se.history.t2.output');
    });

    /**
     * ***Depths count the move and the round, as SillyTavern's do*** (2026-09-29,
     * the [P14.3] review). Its chat holds the player's newest message and each
     * earlier member's reply before the next member assembles, so on a later
     * speaker's call depth 0 is after the round and depth 1 before its last
     * line. Counted from the history's end, both sat before the player's move —
     * 1 + the round's length deeper than ST's.
     */
    it('counts its depth, and a depth prompt’s, over the move and the round', () => {
      const rows = speaking({
        speaker: vera.actor.id,
        history: [turn('t1', 'One.', undefined, 'First.')],
        round: [line(lund, 'Lund first.'), line(vera, 'Vera once.')],
        chat: { ...CHAT, note: { text: 'Keep it tense.', depth: 0 } },
      });
      const chat = ids(rows).filter(
        (id) =>
          id.startsWith('se.history.') ||
          id === 'se.input' ||
          id.startsWith('se.round.') ||
          id === 'se.note' ||
          id === 'se.card.depth.vera',
      );

      expect(chat).toEqual([
        'se.history.t1.input',
        'se.history.t1.output',
        'se.input',
        'se.round.0',
        'se.card.depth.vera',
        'se.round.1',
        'se.note',
      ]);
      // Post-history is still last: it is placed after the chat, not in it.
      expect(ids(rows).at(-1)).toBe('se.card.post-history.vera');
    });

    /**
     * ***A continue ends on the message it continues, then the nudge*** —
     * [P14.4], corrected at its review (2026-09-29). ST takes the continued
     * message out of the chat *after* depth injection (`openai.js:908`), so a
     * depth-0 run sits before it, and depth 1 is still counted over the chat
     * including it. Pushed after the splice alone, the note sat between the
     * continued message and the nudge.
     */
    it('puts a depth-0 note before a continued message, which the nudge follows', () => {
      const rows = speaking({
        speaker: vera.actor.id,
        history: [turn('t1', 'One.', undefined, 'First.')],
        round: [line(lund, 'Lund first.'), line(vera, 'Vera once.')],
        continuing: true,
        chat: { ...CHAT, note: { text: 'Keep it tense.', depth: 0 } },
      });
      const chat = ids(rows).filter(
        (id) =>
          id.startsWith('se.history.') ||
          id === 'se.input' ||
          id.startsWith('se.round.') ||
          id === 'se.note' ||
          id === 'se.card.depth.vera' ||
          id === 'se.continue',
      );

      expect(chat).toEqual([
        'se.history.t1.input',
        'se.history.t1.output',
        'se.input',
        'se.round.0',
        'se.card.depth.vera',
        'se.note',
        'se.round.1',
        'se.continue',
      ]);
      expect(ids(rows).slice(-2)).toEqual(['se.round.1', 'se.continue']);
    });

    it('is absent when this call was not due one', () => {
      expect(ids(speaking())).not.toContain('se.note');
    });
  });
});
