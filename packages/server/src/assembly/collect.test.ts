// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import { newActor, type Actor, type Preset, type PresetBlock } from '@storyengine/shared';

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

const GENEROUS: BudgetPolicy = { limit: { tokens: 100_000, source: 'user' }, reserved: 0 };

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
    const candidates = collectCandidates(
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
    const candidates = collectCandidates(
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
    const candidates = collectCandidates(
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
    const candidates = collectCandidates(
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
    const candidates = collectCandidates(
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

    expect(collectCandidates(context({ preset: only, callKind: 'narrate' }))).toEqual([]);
    expect(collectCandidates(context({ preset: only, callKind: 'verdict' }))).toHaveLength(1);
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

    expect(collectCandidates(context({ preset: dropped }))).toEqual([]);
    expect(collectCandidates(context({ preset: kept }))[0]?.text).toBe('Note: ');
  });

  it('substitutes the wrapper around filled content', () => {
    const candidates = collectCandidates(
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
    const candidates = collectCandidates(
      context({
        preset: preset([block({ kind: 'text', template: 'x', label: 'the narrator brief' })]),
      }),
    );
    expect(candidates[0]?.reason).toBe('the narrator brief');
  });
});

describe('the cast fills the slots that were unreachable', () => {
  const persona = actorWith('Ned', 'Ned keeps the rain off other people.');
  const vera = actorWith('Vera', 'Vera runs the night desk.');
  const marlow = actorWith('Marlow', 'Marlow owes somebody money.');

  it('joins the persona sections that are always shown', () => {
    const candidates = collectCandidates(
      context({ preset: preset([block({ kind: 'slot', source: { of: 'persona' } })]), persona }),
    );
    expect(candidates[0]?.text).toContain('Ned keeps the rain off other people.');
    expect(candidates[0]?.source).toEqual({ kind: 'persona' });
  });

  it('emits one candidate per actor, so the budgeter can drop one and keep another', () => {
    const candidates = collectCandidates(
      context({
        preset: preset([
          block({ kind: 'slot', id: 'se.a', source: { of: 'actor', sectionId: 'se.summary' } }),
        ]),
        actors: [vera, marlow],
      }),
    );

    expect(candidates).toHaveLength(2);
    expect(candidates.map((each) => each.id)).toEqual([`se.a.${vera.id}`, `se.a.${marlow.id}`]);
    expect(candidates[0]?.source).toMatchObject({ kind: 'actor', actorId: vera.id });
  });

  it('renders traits and refuses to invent a rendering for visual', () => {
    // `visual` is structured data for an image pipeline ([10 §4]) with no prose
    // renderer specified — emitting something would be inventing a format.
    const traits = collectCandidates(
      context({
        preset: preset([block({ kind: 'slot', source: { of: 'actor', field: 'traits' } })]),
        actors: [vera],
      }),
    );
    const visual = collectCandidates(
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
    const candidates = collectCandidates(
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
    const candidates = collectCandidates(
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
    const candidates = collectCandidates(
      context({
        preset: preset([block({ kind: 'slot', id: 'se.h', source: { of: 'history' } })]),
        history: [pending],
      }),
    );

    // A turn still running has an input and no output, and an empty assistant
    // message is not a thing to send.
    expect(candidates.map((candidate) => candidate.role)).toEqual(['user']);
  });
});

describe('a preset from a newer build', () => {
  it('ignores a slot kind this build does not know, rather than throwing', () => {
    // The shared Ajv preserves unknown fields, so a preset written against a
    // later schema validates and arrives here. Refusing it would make one
    // unknown slot cost somebody their whole session.
    const candidates = collectCandidates(
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
    ).map((candidate) => candidate.id);
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
      'se.h.0.input',
      'se.h.0.output',
      'se.h.1.input',
      'se.h.1.output',
      'se.note',
    ]);
  });

  it('puts a depth-two block two messages from the end', () => {
    // Which is the case that was silently flattened: with `placement` unread,
    // this landed at the end regardless of the depth the author wrote — and
    // then, once read, at twice the depth.
    expect(ids(2)).toEqual([
      'se.h.0.input',
      'se.h.0.output',
      'se.note',
      'se.h.1.input',
      'se.h.1.output',
    ]);
  });

  it('clamps a depth deeper than the history it has', () => {
    // A preset written for a longer transcript means "as early as possible",
    // not "outside the run".
    expect(ids(99)).toEqual([
      'se.note',
      'se.h.0.input',
      'se.h.0.output',
      'se.h.1.input',
      'se.h.1.output',
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
    ).map((candidate) => candidate.id);

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
    ).map((candidate) => candidate.id);

    expect(none).toEqual(['se.input', 'se.note']);
  });
});
