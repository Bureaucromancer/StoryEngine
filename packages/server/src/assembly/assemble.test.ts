// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import { capabilitiesFor } from '../providers/capabilities.js';
import { FakeProvider } from '../providers/fake.js';
import { AdvisoryLeakError, assemble, estimateTokens } from './assemble.js';
import { render } from './render.js';
import type { Candidate } from './types.js';

/**
 * Assembly — [06 §5](../../../../docs/design/06-modes-and-turn-pipeline.md),
 * [22 §1.1, §1.5, §2](../../../../docs/design/22-internal-contracts.md).
 *
 * The golden-file suite starts here and is CI from now on: the fake provider
 * records every request, so the last test in this file snapshots the rendered
 * block table as it actually arrived at a provider.
 */

/** A preset that positions a block *inside* the history run — [06 §5]. */
function candidates(): Candidate[] {
  return [
    {
      id: 'persona',
      source: { kind: 'persona', actorId: null, contentHash: null },
      reason: 'always',
      role: 'system',
      text: 'You are Vera Solano, a fixer in Rain City.',
      priority: 90,
    },
    {
      id: 'framing',
      source: { kind: 'treatment', part: 'framing' },
      reason: 'always',
      role: 'system',
      text: 'Neon, rain, and debts that do not forgive.',
      priority: 80,
    },
    {
      id: 'lore-cathedral',
      source: { kind: 'lore', entryId: 'entry-1', phase: 'before' },
      // A product feature, not a debug string.
      reason: "keyword match: 'cathedral'",
      role: 'system',
      text: 'The cathedral has been closed since the fire.',
      priority: 30,
    },
    {
      id: 'history-old',
      source: { kind: 'history', turnId: 't2', range: [0, 2], part: 'output' },
      reason: 'history',
      role: 'user',
      text: 'Earlier: they met on the bridge. And then: the deal went wrong.',
      priority: 20,
    },
    // The strongest instructions, four messages from the newest — which is how
    // most modern presets carry them, and why history is splittable.
    {
      id: 'preset-jailbreak',
      source: { kind: 'preset', blockId: 'block-7' },
      reason: 'authored prose, in-history placement',
      role: 'system',
      text: 'Write in close third person. Never break character.',
      priority: 95,
    },
    {
      id: 'history-recent',
      source: { kind: 'history', turnId: 't4', range: [3, 4], part: 'output' },
      reason: 'history',
      role: 'user',
      text: 'She asks what you want.',
      priority: 70,
    },
    {
      id: 'guidance',
      source: { kind: 'step', stepId: 'guidance' },
      reason: 'the guidance box',
      role: 'system',
      text: 'Keep this short.',
      advisory: true,
      priority: 60,
    },
  ];
}

const GENEROUS = {
  limit: { tokens: 4000, ceiling: 4000, source: 'provider' as const },
  reserved: 512,
};

describe('collect and annotate', () => {
  it('keeps the order the preset positioned, including a block inside history', () => {
    // The expensive consequence [06 §5] names: history is a splittable source,
    // not an atomic block, because a preset may place a block four messages
    // from the newest. Refusing that would mean importing the existing corpus
    // of presets into something that runs but behaves differently.
    const { blocks } = assemble({ candidates: candidates(), policy: GENEROUS });

    expect(blocks.map((block) => block.id)).toEqual([
      'persona',
      'framing',
      'lore-cathedral',
      'history-old',
      'preset-jailbreak',
      'history-recent',
      'guidance',
    ]);
  });

  it('carries the source with its identifier, so provenance is clickable', () => {
    const { blocks } = assemble({ candidates: candidates(), policy: GENEROUS });
    const lore = blocks.find((block) => block.id === 'lore-cathedral');

    // *Which* lore entry, not "a lore entry".
    expect(lore?.source).toEqual({ kind: 'lore', entryId: 'entry-1', phase: 'before' });
    expect(lore?.reason).toBe("keyword match: 'cathedral'");
  });
});

describe('the budget verdict', () => {
  it('lists every block, not only the drops', () => {
    // A verdict listing only drops cannot answer "what falls out next".
    const { verdict } = assemble({ candidates: candidates(), policy: GENEROUS });

    expect(verdict.decisions).toHaveLength(candidates().length);
    expect(verdict.decisions.every((decision) => decision.included)).toBe(true);
  });

  it('says what would go next, before it goes', () => {
    const { verdict } = assemble({ candidates: candidates(), policy: GENEROUS });

    // Lowest priority among the droppable. Answerable *before* it happens,
    // which is the promise that requires computing it.
    expect(verdict.nextToDrop).toEqual(['history-old']);
  });

  it('drops lowest priority first, and names the rule that did it', () => {
    const tight = { limit: { tokens: 60, ceiling: 60, source: 'preset' as const }, reserved: 10 };
    const { blocks, verdict } = assemble({ candidates: candidates(), policy: tight });

    const dropped = blocks.filter((block) => !block.included);
    expect(dropped.map((block) => block.id)).toContain('history-old');
    expect(dropped[0]?.droppedBy).toMatch(/over budget/);

    // And the survivors still fit what was left after the reservation.
    expect(verdict.spent).toBeLessThanOrEqual(tight.limit.tokens - tight.reserved);
  });

  it('records where the limit came from, because a 4k ceiling must not apply at 200k', () => {
    const { verdict } = assemble({
      candidates: candidates(),
      policy: { limit: { tokens: 4096, ceiling: 4096, source: 'preset' }, reserved: 256 },
    });

    expect(verdict.limit).toEqual({ tokens: 4096, ceiling: 4096, source: 'preset' });
  });

  it('never drops a required block', () => {
    const required: Candidate[] = [
      {
        id: 'the-message',
        source: { kind: 'history', turnId: 't9', range: [9, 9], part: 'output' },
        reason: 'the user just said it',
        role: 'user',
        text: 'A'.repeat(4000),
        required: true,
      },
      ...candidates(),
    ];
    const { blocks } = assemble({
      candidates: required,
      policy: { limit: { tokens: 100, ceiling: 100, source: 'provider' }, reserved: 10 },
    });

    expect(blocks.find((block) => block.id === 'the-message')?.included).toBe(true);
  });
});

describe('guidance is advisory, and the assembler enforces it', () => {
  it('admits it to a prose call', () => {
    const { blocks } = assemble({
      candidates: candidates(),
      policy: GENEROUS,
      purpose: 'prose',
    });
    expect(blocks.find((block) => block.id === 'guidance')?.included).toBe(true);
  });

  it('refuses it to a call that decides something', () => {
    // The sharp case: a fuzzy rule condition *is* a model call, and "the player
    // has clearly betrayed her by now" typed into the guidance box would
    // otherwise trip a rule — talking past a mechanic without touching it.
    for (const purpose of ['effects', 'verdict'] as const) {
      expect(() => assemble({ candidates: candidates(), policy: GENEROUS, purpose })).toThrow(
        AdvisoryLeakError,
      );
    }
  });

  it('throws rather than quietly filtering', () => {
    // A context that silently lost its guidance and one that never had it are
    // indistinguishable afterwards, and only one of them is a caller bug.
    try {
      assemble({ candidates: candidates(), policy: GENEROUS, purpose: 'effects' });
      expect.unreachable('should have refused');
    } catch (error) {
      expect((error as Error).message).toContain('guidance');
      expect((error as Error).message).toContain('§5.2');
    }
  });

  /**
   * [P3.0]: the flag reaches the record. `admit()` read `Candidate.advisory`
   * and then the block was built without it, which is what reduced
   * [testing §1]'s invariant to a source-kind proxy an author-declared
   * advisory block slips past. The falsifying mutation is deleting the spread
   * in `assemble()`'s block literal — the exact line that was missing.
   */
  it('carries advisory onto the assembled block, and only where it was declared', () => {
    const { blocks } = assemble({
      candidates: candidates(),
      policy: GENEROUS,
      purpose: 'prose',
    });

    expect(blocks.find((block) => block.id === 'guidance')?.advisory).toBe(true);
    // And nowhere else: an `advisory: undefined` key on every row would be
    // noise the record never wrote before, and `false` would be a third state.
    for (const block of blocks) {
      if (block.id !== 'guidance') expect('advisory' in block).toBe(false);
    }
  });
});

describe('render', () => {
  const merged = { capabilities: capabilitiesFor('anthropic') };
  const unmerged = { capabilities: { mergeSameRole: 'never' as const } };

  it('merges adjacent same-role blocks where the provider wants that', () => {
    const { blocks } = assemble({ candidates: candidates(), policy: GENEROUS });
    const messages = render(blocks, merged);

    expect(messages.map((message) => message.role)).toEqual([
      'system',
      'user',
      'system',
      'user',
      'system',
    ]);
  });

  it('keeps fromBlocks through a merge, or the workbench loses its mapping', () => {
    const { blocks } = assemble({ candidates: candidates(), policy: GENEROUS });
    const messages = render(blocks, merged);

    // Two system blocks became one message, and the message still says which
    // two — in order.
    expect(messages[0]?.fromBlocks).toEqual(['persona', 'framing', 'lore-cathedral']);
    expect(messages[0]?.content).toContain('Vera Solano');
    expect(messages[0]?.content).toContain('cathedral');
  });

  it('leaves them apart where the provider does not', () => {
    const { blocks } = assemble({ candidates: candidates(), policy: GENEROUS });
    const messages = render(blocks, unmerged);

    expect(messages).toHaveLength(7);
    expect(messages.every((message) => message.fromBlocks.length === 1)).toBe(true);
  });

  it('renders only what the budget included', () => {
    const tight = { limit: { tokens: 60, ceiling: 60, source: 'provider' as const }, reserved: 10 };
    const { blocks } = assemble({ candidates: candidates(), policy: tight });
    const messages = render(blocks, unmerged);

    const droppedIds = blocks.filter((block) => !block.included).map((block) => block.id);
    const sent = messages.flatMap((message) => message.fromBlocks);
    expect(droppedIds.length).toBeGreaterThan(0);
    expect(sent.filter((id) => droppedIds.includes(id))).toEqual([]);
  });
});

describe('the golden file', () => {
  it('snapshots the block table as it reached the provider', async () => {
    // [testing §3.1]: fixture in, assemble, snapshot the rendered table. The
    // fake records every request, so what is snapshotted is what was *sent*
    // rather than what this test thinks was sent.
    const { blocks, verdict } = assemble({ candidates: candidates(), policy: GENEROUS });
    const provider = new FakeProvider();

    await provider.generate({
      modelId: 'fake-hi',
      messages: render(blocks, merged()),
      params: { temperature: 0.7 },
    });

    const sent = provider.requests[0];
    /**
     * **The content, not its length.**
     *
     * This snapshotted `chars` until an audit measured what that could catch:
     * reversing the concatenation order of merged same-role blocks — persona
     * after lore, the instruction after the scene — left every count identical
     * and the whole suite green. [testing §3.1] makes this the flagship suite
     * and names *block ordering* and *prompt drift* among the regressions it is
     * supposed to surface as a reviewable diff. A character count is not a
     * diff anybody can review.
     */
    const table = sent?.messages.map((message) => ({
      role: message.role,
      fromBlocks: message.fromBlocks,
      content: message.content,
    }));

    expect(table).toMatchInlineSnapshot(`
      [
        {
          "content": "You are Vera Solano, a fixer in Rain City.

      Neon, rain, and debts that do not forgive.

      The cathedral has been closed since the fire.",
          "fromBlocks": [
            "persona",
            "framing",
            "lore-cathedral",
          ],
          "role": "system",
        },
        {
          "content": "Earlier: they met on the bridge. And then: the deal went wrong.",
          "fromBlocks": [
            "history-old",
          ],
          "role": "user",
        },
        {
          "content": "Write in close third person. Never break character.",
          "fromBlocks": [
            "preset-jailbreak",
          ],
          "role": "system",
        },
        {
          "content": "She asks what you want.",
          "fromBlocks": [
            "history-recent",
          ],
          "role": "user",
        },
        {
          "content": "Keep this short.",
          "fromBlocks": [
            "guidance",
          ],
          "role": "system",
        },
      ]
    `);

    // And the verdict beside it, which is the half the workbench reads.
    expect(verdict.decisions.map((decision) => [decision.blockId, decision.included])).toEqual([
      ['persona', true],
      ['framing', true],
      ['lore-cathedral', true],
      ['history-old', true],
      ['preset-jailbreak', true],
      ['history-recent', true],
      ['guidance', true],
    ]);
  });

  function merged() {
    return { capabilities: capabilitiesFor('anthropic') };
  }
});

describe('the token estimate', () => {
  it('is an estimate, and the record carries the measured number instead', () => {
    // Not a tokenizer: bundled tokenizers are discarded, the provider reports
    // the real figure, and the budgeter's margin covers the gap.
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2);
  });
});

describe('where a writing sample sits in the order of sacrifice', () => {
  /**
   * [04 §3.1] and the Scene preset's `se.samples`, which is priority 20.
   *
   * The number is not arbitrary and it is not obvious: history blocks are
   * emitted at `priority + index` across the window, so Scene's history spans
   * 10..29 rather than sitting at 10. A sample at 20 therefore drops *after*
   * the oldest turns and *before* the newest, and before lore at 25 — which is
   * the intended reading of "a nicety that improves voice": losing it costs
   * tone, never continuity or facts.
   *
   * This is the test that would catch somebody re-tuning the constant without
   * meaning to change what falls out of a full context first.
   */
  function trio(): Candidate[] {
    const text = 'x'.repeat(40); // 10 tokens each, so the arithmetic is legible
    return [
      {
        id: 'history-oldest',
        source: { kind: 'history', turnId: 't1', range: [0, 0], part: 'output' },
        reason: 'history',
        role: 'user',
        text,
        priority: 10,
      },
      {
        id: 'sample',
        source: {
          kind: 'samples',
          owner: { kind: 'actor', id: 'a1', contentHash: 'h' },
          sampleId: 's0',
        },
        reason: 'writing samples',
        role: 'system',
        text,
        priority: 20,
      },
      {
        id: 'lore',
        source: { kind: 'lore', entryId: 'e1', phase: 'before' },
        reason: "keyword match: 'cathedral'",
        role: 'system',
        text,
        priority: 25,
      },
    ];
  }

  it('drops the oldest history first, then the sample, and keeps lore', () => {
    // 30 tokens of content into 12 means two must go. Mutation: flip the
    // comparator in `assemble`'s `sacrificial` sort and lore drops instead of
    // surviving; change `se.samples` to outrank lore and the sample survives.
    const { blocks, verdict } = assemble({
      candidates: trio(),
      policy: { limit: { tokens: 12, ceiling: 12, source: 'user' }, reserved: 0 },
    });

    const included = blocks.filter((block) => block.included).map((block) => block.id);
    expect(included).toEqual(['lore']);

    const dropped = blocks.filter((block) => !block.included).map((block) => block.id);
    expect(dropped).toEqual(['history-oldest', 'sample']);
    expect(verdict.spent).toBe(10);
  });

  it('sacrifices the sample before lore but after the oldest turn', () => {
    // The ordering claim on its own, at a pressure where exactly one block
    // goes: the sample must outlive nothing but history. Mutation: give the
    // sample priority 30 and `history-oldest` stops being the first to go.
    const { blocks } = assemble({
      candidates: trio(),
      policy: { limit: { tokens: 22, ceiling: 22, source: 'user' }, reserved: 0 },
    });

    expect(blocks.filter((block) => !block.included).map((block) => block.id)).toEqual([
      'history-oldest',
    ]);
  });

  it('names the sample as what goes next while it is still included', () => {
    // The panel promises "what is about to fall out" is answerable before it
    // happens. With only history gone, the sample is the next survivor in
    // sacrifice order. Mutation: return the last dropped id from `nextToDrop`
    // instead of the next survivor and this reads 'history-oldest'.
    const { verdict } = assemble({
      candidates: trio(),
      policy: { limit: { tokens: 22, ceiling: 22, source: 'user' }, reserved: 0 },
    });

    expect(verdict.nextToDrop).toEqual(['sample']);
  });
});

/**
 * The two-tier budget meeting at one arbiter — [P5.6], [P5 §1.3].
 *
 * A producer's own refusals have to appear in the verdict, or *four lore
 * entries matched and their book had no room* is a fact the record does not
 * contain — and it has a different repair from *the turn was too long*.
 */
describe('what a producer refused before the cut', () => {
  const refused = [{ blockId: 'lore.a.1', tokens: 40, rule: "over the book's token budget" }];

  it('lands in the verdict as a decision that was not included', () => {
    const { verdict } = assemble({
      candidates: candidates(),
      policy: GENEROUS,
      refused,
    });

    const row = verdict.decisions.find((one) => one.blockId === 'lore.a.1');
    expect(row).toEqual({
      blockId: 'lore.a.1',
      tokens: 40,
      included: false,
      rule: "over the book's token budget",
    });
  });

  /**
   * Before the blocks, because it was decided before them. Putting the inner
   * tier after the outer one would show the two budgets in the wrong order in
   * the one list somebody reads to reconstruct what happened.
   */
  it('comes before the blocks that reached the chat-wide cut', () => {
    const { verdict } = assemble({
      candidates: candidates(),
      policy: GENEROUS,
      refused,
    });

    expect(verdict.decisions[0]?.blockId).toBe('lore.a.1');
  });

  /** It never reached the prompt, so it never cost anything. */
  it('does not count against what the turn spent', () => {
    const without = assemble({
      candidates: candidates(),
      policy: GENEROUS,
    });
    const with_ = assemble({
      candidates: candidates(),
      policy: GENEROUS,
      refused,
    });

    expect(with_.verdict.spent).toBe(without.verdict.spent);
    expect(with_.blocks).toEqual(without.blocks);
  });

  it('leaves the verdict alone when a producer refused nothing', () => {
    const { verdict } = assemble({
      candidates: candidates(),
      policy: GENEROUS,
      refused: [],
    });

    expect(verdict.decisions.every((one) => one.blockId !== 'lore.a.1')).toBe(true);
  });
});
