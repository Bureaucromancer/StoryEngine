// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import {
  newActor,
  type Actor,
  type Preset,
  type PresetBlock,
  type WritingSample,
} from '@storyengine/shared';

import { SCENE_PRESET } from '../modes/scene/preset.js';
import type { Turn } from '../sessions/types.js';
import { assemble, type BudgetPolicy } from './assemble.js';
import { collectCandidates, type CollectContext } from './collect.js';

/**
 * Step 1 of [03 §5] — collect, the preset-to-prompt mapping.
 *
 * This file exists because an audit measured its absence: five of the
 * collector's guards could each be deleted with the entire suite green, and the
 * worst of them is the one the collector's own commit argues *is* [03 §5.2]'s
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
  return { ...SCENE_PRESET, blocks };
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

describe('the advisory firewall is structural, not an author preference', () => {
  it('marks a guidance slot advisory even when the preset says not to', () => {
    // **The mechanism the whole rule rests on.** `assemble` keys its refusal on
    // the candidate's flag and not on where the words came from, so a preset
    // declaring `advisory: false` here would walk guidance into an effects
    // call. [03 §5.2] says enforce it *structurally* — a flag an author can
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
    // template fields [10 §8.4.3] describes.
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

  it('carries the author-facing label through as the reason', () => {
    // [03 §5]: the reason is a product feature, not a debug string — it is what
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
    // `visual` is structured data for an image pipeline ([10 §4]) with no prose
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

  it('separates a slot waiting on the engine from one waiting on the author', () => {
    // **The reason `emptyReason` discriminates on `from`.** Collapsing both to
    // `no-producer` would tell an author their preset is blocked on P5 when it
    // is blocked on them having written a sample. Mutation: return a single
    // constant from the `samples` arm and one of these two flips.
    const waitingOnEngine = collectCandidates(
      context({
        preset: preset([samplesBlock({ source: { of: 'samples', from: 'treatment' } })]),
        actors: cast(withSamples('Vera', [{}])),
      }),
    );
    expect(waitingOnEngine.notFilled).toEqual([
      { blockId: 'se.samples', source: 'samples', reason: 'no-producer' },
    ]);

    const waitingOnAuthor = collectCandidates(
      context({
        preset: preset([samplesBlock()]),
        actors: cast(newActor('Vera')),
      }),
    );
    expect(waitingOnAuthor.notFilled).toEqual([
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
