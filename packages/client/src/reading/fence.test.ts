// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * ***The fence, asserted rather than intended*** —
 * [10 §12.1](../../../../docs/design/10-ui-surfaces.md),
 * [P11 §1.4](../../../../docs/design/workplan/28-p11-implementation.md),
 * [P11.1](../../../../docs/design/workplan/28-p11-implementation.md).
 *
 * §12.1 makes the claim in a sentence: *"the workbench answers **why did the
 * engine do that**; the reading view answers **what happened in the story**.
 * They read the same turn records and share nothing else, and neither should
 * drift toward the other."* And §1.4 says why that sentence needs a test rather
 * than a reviewer: **the drift is always helpful.** Nobody adds a token count to
 * a reading view on purpose; somebody adds it because they were looking at a
 * turn record, the number was right there, and it seemed useful.
 *
 * **A source-text assertion, which is the cheap form and the durable one.** The
 * alternative — a component test rendering a session and checking no cost
 * appears — asserts about one fixture, passes for a surface that would show a
 * cost if the fixture had one, and says nothing at all about a file added next
 * year. This reads the directory.
 *
 * ***What it cannot catch***, stated so nobody trusts it further than it goes: a
 * field reached indirectly, through a variable named something else. The names
 * below are the ones a person writes when they are doing the thing this forbids,
 * which is the case that actually occurs.
 */

const HERE = import.meta.dirname;

/** The forbidden vocabulary, each with the §12.1 clause it comes from. */
const MACHINERY: { pattern: RegExp; what: string }[] = [
  { pattern: /\bcost\b/, what: 'no costs' },
  { pattern: /promptTokens|completionTokens|\btokens\b/, what: 'no token counts' },
  { pattern: /\bmodelId\b|\bmodel\b\s*[:.]/, what: 'no model ids' },
  { pattern: /AssembledBlock|\bassembled\b|blockTable/, what: 'no block table' },
  { pattern: /\bwallMs\b|stepId|StepOutcome/, what: 'no step timings' },
  { pattern: /\bchannels\b|ChannelState|ChannelEffect/, what: 'no channel state' },
  { pattern: /\bbudget\b|BudgetVerdict/, what: 'no budgets' },
];

function sources(): { path: string; code: string }[] {
  return readdirSync(HERE)
    .filter((name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name))
    .map((name) => ({ path: name, code: readFileSync(join(HERE, name), 'utf8') }));
}

/**
 * Comments are prose about the fence and would trip it.
 *
 * *This is not a loophole*: what §12.1 forbids is rendering the machinery, and a
 * docstring explaining that the machinery is not rendered is the opposite of
 * the defect. `tailwind-utilities.test.ts` strips comments for the same reason
 * and says so in the same words — prose reads enough like code to fool a grep.
 */
function withoutComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('the reading view renders the story and not the machinery', () => {
  it('finds the directory, so an empty scan cannot pass', () => {
    expect(sources().length).toBeGreaterThan(1);
  });

  it.each(MACHINERY)('holds the fence: $what', ({ pattern, what }) => {
    const breaches = sources()
      .filter((file) => pattern.test(withoutComments(file.code)))
      .map((file) => `${file.path} — ${what}`);

    // One string rather than two joined: the sentence-assembly rule is on
    // every file in this package, and a test message is still a sentence.
    const complaint = `${String(breaches.length)} file(s) reach for the workbench's subject — [10 §12.1]: the reading view answers what happened in the story.`;
    expect(breaches, complaint).toEqual([]);
  });
});
