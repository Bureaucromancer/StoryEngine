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
  type Treatment,
  type WritingSample,
} from '@storyengine/shared';

import { TEST_PRESET } from '../test-mode.js';
import { installBuiltIns } from '../mode-loader.js';
import { registerChannel, SE_CLOCK, SE_LORE_TIMING } from '../sessions/channels.js';
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
