// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import type { StepHost, StepInput } from '@storyengine/sdk';

import { randomOver } from '../rng/random.js';
import { Rng } from '../rng/rng.js';
import { extractMentions, MENTIONS_STEP, type ExtractReport } from './extract.js';
import type { Mentionable } from './mentions.js';

/**
 * ***Gate step 8's second clause, which nothing asserted*** — [06 §8.2],
 * [10 §13.1], [13 §13], [P7 §3] row 8, written at [P7.9].
 *
 * The step: *"Mentions highlight what the lorebook scanner matched, and **an
 * unresolved name offers rather than creates**."* The first clause is covered by
 * `mentions.test.ts` at length. The second was **true by construction and
 * asserted nowhere** — the extract step takes no library handle, so it *cannot*
 * create an actor — and §3.1's own note says the clause that compounds is the
 * structural one rather than the behaviour.
 *
 * ***True-by-construction is the strongest kind of true and the easiest kind to
 * lose.*** Nothing stops a later stage handing this step a library context for
 * some other good reason, at which point the property becomes a thing somebody
 * has to remember. These are the tests that would notice: the step produces
 * **spans and a hook verdict, and nothing else** — no effects, no message, no
 * write of any kind — and a name it does not know produces no span rather than a
 * span pointing at somebody new.
 *
 * *The `offers` half of the clause is the surface `proposed` spans would carry,
 * and [P7.7] deferred it in its own Done cell with its reason: a `proposed` span
 * asserts somebody the session does not have, and **auto-materialising on first
 * mention is precisely the failure the feature exists to make visible**. So the
 * gate and the stage disagree about the word `offers`, and the half that
 * compounds — never creates — is the half that shipped.*
 */

const VERA: Mentionable = { actorId: 'a-vera', name: 'Vera Kohl', terms: ['Vera Kohl', 'Vera'] };

function input(over: Partial<StepInput> = {}): StepInput {
  return {
    turnId: 't-new',
    sessionId: 's',
    parentTurnId: null,
    channels: {},
    history: [],
    ...over,
  };
}

function host(): StepHost {
  return {
    call: () => {
      throw new Error('the extract step must not call a model');
    },
    random: randomOver(new Rng()),
    signal: new AbortController().signal,
  };
}

async function extract(
  text: string,
  cast: readonly Mentionable[] = [VERA],
): Promise<{ report: ExtractReport; result: unknown }> {
  const held: { report: ExtractReport | null } = { report: null };
  const { run } = extractMentions({
    subjects: () => ({ cast, introducing: null, pending: [] }),
    report: (given) => {
      held.report = given;
    },
  });
  const result = await run(input({ output: { text } }), host());
  const { report } = held;
  if (report === null) throw new Error('the extract step reported nothing');
  return { report, result };
}

describe('an unresolved name', () => {
  /**
   * ***The property, stated as what it produces rather than as what it does
   * not.*** A name nobody in the session answers to is text, and text is what
   * the narrator wrote — so the overlay has nothing to say about it and says
   * nothing.
   */
  it('produces no span, rather than a span pointing at somebody new', async () => {
    const { report } = await extract('A man called Lund came in behind her.');

    expect(report.spans).toEqual([]);
  });

  it('leaves the names it does know alone in the same sentence', async () => {
    const { report } = await extract('Lund came in behind Vera.');

    expect(report.spans.map((span) => span.target.ref.id)).toEqual(['a-vera']);
  });

  /**
   * ***The structural half: this step writes nothing.*** No effects, no message,
   * no channel — which is what makes *never creates* a property of the step's
   * shape rather than of its current body. A `writes` entry appearing here would
   * also cost the `prose` purpose everywhere it matters ([06 §5.2]).
   */
  it('produces no effect of any kind, which is what makes never-creates structural', async () => {
    const { result } = await extract('A man called Lund came in behind her.');

    expect(result).toEqual({});
    /**
     * ***`writes` names `se.hook` and only `se.hook`***, which looks like a
     * counter-example and is the assertion doing its job. Confirming an
     * introduction is what this step *decides*, so declaring it is the honest
     * statement of purpose — and the write itself still goes through the runner,
     * because `se.hook` is `engine-computed` and refuses a step. **What matters
     * for this property is that no cast channel is in the list**: nothing here
     * claims the right to say a person exists, is present, or is in the party.
     */
    expect(MENTIONS_STEP.writes).toEqual(['se.hook']);
    // No `contributes`: the step adds nothing to the prompt or the message, so
    // there is no route by which a name it saw could reach the story as a fact.
    expect(MENTIONS_STEP.contributes).toBeUndefined();
  });

  /**
   * *And it asks nobody*, which is the other half of taking no handle: a step
   * that called a model could be told to invent the person it could not find.
   * The host above throws on `call`, so this passing is the assertion.
   */
  it('makes no model call', async () => {
    await expect(extract('Somebody nobody has met walked in.')).resolves.toBeDefined();
  });
});
