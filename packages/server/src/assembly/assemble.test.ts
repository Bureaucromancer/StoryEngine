// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import { capabilitiesFor } from '../providers/capabilities.js';
import { FakeProvider } from '../providers/fake.js';
import { AdvisoryLeakError, assemble, estimateTokens } from './assemble.js';
import { render } from './render.js';
import type { Candidate } from './types.js';

/**
 * Assembly — [03 §5](../../../../docs/design/03-modes-and-turn-pipeline.md),
 * [13 §1.1, §1.5, §2](../../../../docs/design/13-internal-contracts.md).
 *
 * The golden-file suite starts here and is CI from now on: the fake provider
 * records every request, so the last test in this file snapshots the rendered
 * block table as it actually arrived at a provider.
 */

/** A preset that positions a block *inside* the history run — [03 §5]. */
function candidates(): Candidate[] {
  return [
    {
      id: 'persona',
      source: { kind: 'persona' },
      reason: 'always',
      role: 'system',
      text: 'You are Vera Solano, a fixer in Rain City.',
      priority: 90,
    },
    {
      id: 'framing',
      source: { kind: 'setting', part: 'framing' },
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
      source: { kind: 'history', range: [0, 2] },
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
      source: { kind: 'history', range: [3, 4] },
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

const GENEROUS = { limit: { tokens: 4000, source: 'provider' as const }, reserved: 512 };

describe('collect and annotate', () => {
  it('keeps the order the preset positioned, including a block inside history', () => {
    // The expensive consequence [03 §5] names: history is a splittable source,
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
    const tight = { limit: { tokens: 60, source: 'preset' as const }, reserved: 10 };
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
      policy: { limit: { tokens: 4096, source: 'preset' }, reserved: 256 },
    });

    expect(verdict.limit).toEqual({ tokens: 4096, source: 'preset' });
  });

  it('never drops a required block', () => {
    const required: Candidate[] = [
      {
        id: 'the-message',
        source: { kind: 'history', range: [9, 9] },
        reason: 'the user just said it',
        role: 'user',
        text: 'A'.repeat(4000),
        required: true,
      },
      ...candidates(),
    ];
    const { blocks } = assemble({
      candidates: required,
      policy: { limit: { tokens: 100, source: 'provider' }, reserved: 10 },
    });

    expect(blocks.find((block) => block.id === 'the-message')?.included).toBe(true);
  });
});

describe('guidance is advisory, and the assembler enforces it', () => {
  it('admits it to a prose call', () => {
    const { blocks } = assemble({
      candidates: candidates(),
      policy: GENEROUS,
      callKind: 'prose',
    });
    expect(blocks.find((block) => block.id === 'guidance')?.included).toBe(true);
  });

  it('refuses it to a call that decides something', () => {
    // The sharp case: a fuzzy rule condition *is* a model call, and "the player
    // has clearly betrayed her by now" typed into the guidance box would
    // otherwise trip a rule — talking past a mechanic without touching it.
    for (const callKind of ['effects', 'verdict'] as const) {
      expect(() => assemble({ candidates: candidates(), policy: GENEROUS, callKind })).toThrow(
        AdvisoryLeakError,
      );
    }
  });

  it('throws rather than quietly filtering', () => {
    // A context that silently lost its guidance and one that never had it are
    // indistinguishable afterwards, and only one of them is a caller bug.
    try {
      assemble({ candidates: candidates(), policy: GENEROUS, callKind: 'effects' });
      expect.unreachable('should have refused');
    } catch (error) {
      expect((error as Error).message).toContain('guidance');
      expect((error as Error).message).toContain('§5.2');
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
    const tight = { limit: { tokens: 60, source: 'provider' as const }, reserved: 10 };
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
    const table = sent?.messages.map((message) => ({
      role: message.role,
      fromBlocks: message.fromBlocks,
      chars: message.content.length,
    }));

    expect(table).toMatchInlineSnapshot(`
      [
        {
          "chars": 133,
          "fromBlocks": [
            "persona",
            "framing",
            "lore-cathedral",
          ],
          "role": "system",
        },
        {
          "chars": 63,
          "fromBlocks": [
            "history-old",
          ],
          "role": "user",
        },
        {
          "chars": 51,
          "fromBlocks": [
            "preset-jailbreak",
          ],
          "role": "system",
        },
        {
          "chars": 23,
          "fromBlocks": [
            "history-recent",
          ],
          "role": "user",
        },
        {
          "chars": 16,
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
