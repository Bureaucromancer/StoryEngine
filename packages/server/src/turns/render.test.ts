// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { beforeEach, describe, expect, it } from 'vitest';

import type { StepCallRequest, StepCallResult, StepHost, StepInput } from '@storyengine/sdk';

import { capabilitiesFor } from '../providers/capabilities.js';
import { render, type RenderContext, type RenderReport } from './render.js';

/**
 * The rendition step — [06 §10.3], [P9.1].
 *
 * ***Every assertion here is about a call that was or was not made***, which is
 * the shape [P9 §3.1] gives this phase's automatable rows: *"thirteen of fifteen
 * rows are about **mechanism** — a dispatch, a digest, a diff, a call log — and
 * mechanism is what tests are for."* A picture is what a person has to look at;
 * whether one was paid for is not.
 *
 * Two of them are the ones an implementation gets wrong in the direction that
 * still looks right: **a backdrop makes no `fast` call at all** (§10.3's *a
 * place has no moment*), and **a place already rendered asks for nothing**
 * (§1.7's money row). Both pass on screen either way.
 */

const CAPS = capabilitiesFor('fake', { maxPromptChars: 400, usefulPromptChars: 250 });

/** A host that records what it was asked and answers from a script. */
function recordingHost(answer: { subject: string; anchor?: string }): {
  host: StepHost;
  calls: StepCallRequest[];
} {
  const calls: StepCallRequest[] = [];
  const host: StepHost = {
    call: async (request: StepCallRequest): Promise<StepCallResult> => {
      calls.push(request);
      return Promise.resolve({
        callId: `call-${String(calls.length)}`,
        text: '',
        object: answer,
      } as StepCallResult);
    },
    /**
     * ***The seed comes from here***, which is [19 §14]'s rule and the reason
     * the step draws it rather than the worker: *"every random draw comes from
     * the single RNG service and is recorded."* A fixed draw makes the digest
     * and the request assertions below deterministic, which is the same thing
     * the tape buys a real turn.
     */
    random: {
      at: () => ({
        int: (min: number) => Promise.resolve(min),
        float: () => Promise.resolve(0.5),
        bool: () => Promise.resolve(false),
        chance: () => Promise.resolve(false),
        pick: <T>(items: readonly T[]) => Promise.resolve(items[0]),
        shuffle: <T>(items: readonly T[]) => Promise.resolve([...items]),
      }),
    } as unknown as StepHost['random'],
    signal: new AbortController().signal,
  };
  return { host, calls };
}

function context(over: Partial<RenderContext> = {}): RenderContext {
  return {
    illustration: 'each-turn',
    backdrop: false,
    image: {
      binding: { connectionId: 'c-1', modelId: 'sdxl' },
      capabilities: CAPS,
    },
    tone: 'cold and salt-bitten',
    channels: () => [
      { id: 'se.location', text: 'the harbour steps' },
      { id: 'se.clock', text: 'just before dawn' },
    ],
    workflow: {},
    reusable: () => null,
    report: () => undefined,
    ...over,
  };
}

function payload(over: Partial<StepInput> = {}): StepInput {
  return {
    turnId: 't-1',
    sessionId: 's-1',
    parentTurnId: null,
    channels: {},
    output: { text: 'The lantern guttered. Rain came off the water in sheets.' },
    cast: [
      {
        actorId: 'a-1',
        name: 'Elena',
        kind: 'actors',
        media: [],
        visual: { hair: 'cropped grey hair' },
      },
    ],
    ...over,
  };
}

let reported: RenderReport | null;

beforeEach(() => {
  reported = null;
});

function capture(): (report: RenderReport) => void {
  return (report) => {
    reported = report;
  };
}

describe('the illustration branch', () => {
  it('makes exactly one call and asks for a moment', async () => {
    const { host, calls } = recordingHost({
      subject: 'a guttering lantern on a wet quay',
      anchor: 'The lantern guttered',
    });
    const step = render(context({ report: capture() }));

    await step.run(payload(), host);

    // One call. §10.3's *the moment is written, not extracted* — and the image
    // call is a job, which is the whole of [06 §10.2].
    expect(calls).toHaveLength(1);
    expect(calls[0]?.schema).toBeDefined();
    expect(reported?.requests).toHaveLength(1);
  });

  it('puts the moment in the prompt and the anchor on the scope', async () => {
    const { host } = recordingHost({
      subject: 'a guttering lantern on a wet quay',
      anchor: 'The lantern guttered',
    });
    const step = render(context({ report: capture() }));

    await step.run(payload(), host);
    const request = reported?.requests[0];

    expect(request?.purpose).toBe('illustration');
    expect(request?.prompt.text).toContain('a guttering lantern on a wet quay');
    // [06 §10.4a]: a verbatim quote, not a span. Resolved at render time against
    // whatever the text then says, which is why a miss has to be ordinary.
    expect(request?.scope).toEqual({ anchor: 'The lantern guttered' });
  });

  it('describes the cast by appearance and never by name', async () => {
    const { host } = recordingHost({ subject: 'a figure on the quay' });
    const step = render(context({ report: capture() }));

    await step.run(payload(), host);

    expect(reported?.requests[0]?.prompt.text).toContain('cropped grey hair');
    expect(reported?.requests[0]?.prompt.text).not.toContain('Elena');
  });

  /**
   * ***Nor by a name the model or a tracker wrote*** (2026-09-30). The test above
   * could not fail: its moment named nobody. The moment call is asked not to,
   * and a model describing a picture names the person in it anyway — so every
   * name in the cast becomes *someone*, in the moment and in the channels.
   */
  it('never sends a name the model or a tracker wrote', async () => {
    const { host } = recordingHost({ subject: 'Elena on the quay, watching ELENA’s boat' });
    const step = render(
      context({
        report: capture(),
        channels: () => [
          { id: 'se.location', text: 'the harbour steps' },
          { id: 'se.track.character', text: 'Elena is waiting for news' },
        ],
      }),
    );

    await step.run(payload(), host);

    const text = reported?.requests[0]?.prompt.text ?? '';
    expect(text).not.toMatch(/elena/i);
    expect(text).toContain('someone on the quay, watching someone’s boat');
    expect(text).toContain('someone is waiting for news');
  });

  /**
   * ***Only who is in the room*** (2026-09-30) — [06 §8.1]. The host marks a
   * member muted, dead or departed as out of it (`StepCastMember.present`); the
   * whole cast was drawn.
   */
  it('does not draw somebody who is out of the room', async () => {
    const { host } = recordingHost({ subject: 'a figure on the quay' });
    const step = render(context({ report: capture() }));

    await step.run(
      payload({
        cast: [
          {
            actorId: 'a-1',
            name: 'Elena',
            kind: 'actors',
            media: [],
            visual: { hair: 'cropped grey hair' },
          },
          {
            actorId: 'a-2',
            name: 'Marlow',
            kind: 'actors',
            media: [],
            visual: { hair: 'a shaved head' },
            present: false,
          },
        ],
      }),
      host,
    );

    const text = reported?.requests[0]?.prompt.text ?? '';
    expect(text).toContain('cropped grey hair');
    expect(text).not.toContain('a shaved head');
  });

  /**
   * ***The moment is told the room the rest leaves it*** (2026-09-30). Told the
   * whole budget, a moment that used it was all the capper could keep: it is
   * required, and everything else went. Here the budget is 250, and the
   * descriptor, the tone, the place and the clock take 78 of it with their
   * separators.
   */
  it('leaves room for the rest of the recipe', async () => {
    const { host, calls } = recordingHost({ subject: 'a figure on the quay' });
    const step = render(context({ report: capture() }));

    await step.run(payload(), host);

    const told = (calls[0]?.candidates ?? []).find((one) => one.id === 'se.render.task')?.text;
    expect(told).toContain('Keep it under 172 characters');
  });

  it('carries no anchor rather than an empty one when the model gave none', async () => {
    const { host } = recordingHost({ subject: 'a figure on the quay' });
    const step = render(context({ report: capture() }));

    await step.run(payload(), host);

    // Absent rather than blank: an empty anchor would resolve against every
    // message and place the picture at the first character of each.
    expect(reported?.requests[0]?.scope).toBeNull();
  });

  it('asks for nothing when the model says nothing is worth a picture', async () => {
    /**
     * **The empty list is a real answer** — [06 §10.4]. A model declining is a
     * judgement this phase accepts even though the judgement that would make a
     * habit of it is [P9 §4]'s deferral, and `held` is what keeps it
     * distinguishable from the step never having run.
     */
    const { host, calls } = recordingHost({ subject: '' });
    const step = render(context({ report: capture() }));

    await step.run(payload(), host);

    expect(calls).toHaveLength(1);
    expect(reported?.requests).toEqual([]);
    expect(reported?.held).toBe('no-moment');
  });

  it('costs no call at all on a turn that narrated nothing', async () => {
    // The cheap gate, before the call — `suggest.ts`'s shape: a toggle and a
    // turn with no prose answer the same way and neither is worth a request.
    const { host, calls } = recordingHost({ subject: 'unused' });
    const step = render(context({ report: capture() }));

    await step.run(payload({ output: { text: '   ' } }), host);

    expect(calls).toEqual([]);
    expect(reported?.held).toBe('no-moment');
  });

  it('costs no call when the session is on-demand only', async () => {
    /**
     * [06 §10.6]'s middle setting, and the one somebody paying per image
     * actually wants: **the manual Illustrate action works and nothing runs on
     * its own.** The step is still in the plan because the backdrop may want it;
     * what `on-demand` buys is that the per-turn branch never fires.
     */
    const { host, calls } = recordingHost({ subject: 'unused' });
    const step = render(context({ illustration: 'on-demand', report: capture() }));

    await step.run(payload(), host);

    expect(calls).toEqual([]);
    expect(reported?.requests).toEqual([]);
  });
});

describe('the backdrop branch', () => {
  it('makes no call at all', async () => {
    /**
     * ***§10.3's sharpened sentence, asserted on the call log***: *"one branch
     * makes a call the other does not… because a backdrop is a place and a place
     * has no moment."*
     *
     * This is the assertion an implementation passes by accident and then loses
     * silently: asking a `fast` model *what is this place* produces a perfectly
     * good fragment and a bill, and nothing on screen would ever say so.
     */
    const { host, calls } = recordingHost({ subject: 'never asked for' });
    const step = render(context({ illustration: 'off', backdrop: true, report: capture() }));

    await step.run(payload(), host);

    expect(calls).toEqual([]);
    expect(reported?.requests).toHaveLength(1);
    expect(reported?.requests[0]?.purpose).toBe('background');
  });

  it('takes the place and the tone and not the prose', async () => {
    const { host } = recordingHost({ subject: 'never asked for' });
    const step = render(context({ illustration: 'off', backdrop: true, report: capture() }));

    await step.run(payload(), host);
    const prompt = reported?.requests[0]?.prompt;

    expect(prompt?.text).toContain('the harbour steps');
    expect(prompt?.text).toContain('cold and salt-bitten');
    // Without the turn's output text and without the actors' descriptors —
    // §10.3's background subset, and the two absences that make a backdrop a
    // place rather than a scene.
    expect(prompt?.text).not.toContain('lantern');
    expect(prompt?.text).not.toContain('cropped grey hair');
  });

  it('asks for nothing when the place is already rendered', async () => {
    /**
     * ***[P9 §1.7]'s money row, at the level it is decided.*** *"Returning to a
     * place you have been costs nothing, and it returns the backdrop you
     * **chose** for that place."* Asserted on the request list rather than on
     * the pixels, because a reuse that quietly regenerates is identical on
     * screen and shows up only on a bill.
     */
    const { host } = recordingHost({ subject: 'never asked for' });
    const step = render(
      context({
        illustration: 'off',
        backdrop: true,
        reusable: (digest) => ({ renditionId: `already-${digest.slice(0, 4)}` }),
        report: capture(),
      }),
    );

    await step.run(payload(), host);

    expect(reported?.requests).toEqual([]);
    expect(reported?.reused?.renditionId).toMatch(/^already-/);
    expect(reported?.held).toBe('place-unchanged');
  });

  /**
   * ***Nor while the place's backdrop is being made*** (2026-09-30). Only a
   * ready one answered, so a turn taken while the first was being drawn asked
   * for a second of the same place — and that one made the first give way.
   */
  it('asks for nothing while the place’s backdrop is still being made', async () => {
    const { host } = recordingHost({ subject: 'never asked for' });
    const step = render(
      context({
        illustration: 'off',
        backdrop: true,
        reusable: () => 'in-flight',
        report: capture(),
      }),
    );

    await step.run(payload(), host);

    expect(reported?.requests).toEqual([]);
    // Nothing to show yet: the worker selects it when it lands.
    expect(reported?.reused).toBeUndefined();
    expect(reported?.held).toBe('place-unchanged');
  });

  /**
   * ***A backdrop with no place is held rather than paid for*** (2026-09-30).
   * Its recipe is the place and the tone, and with no place it was the tone
   * alone: a picture of a mood, which every later turn then reused, since the
   * recipe never changed.
   */
  it('holds a backdrop with no place rather than paying for a mood', async () => {
    const asked: string[] = [];
    const { host } = recordingHost({ subject: 'never asked for' });
    const step = render(
      context({
        illustration: 'off',
        backdrop: true,
        channels: () => [{ id: 'se.clock', text: 'just before dawn' }],
        reusable: (digest) => {
          asked.push(digest);
          return null;
        },
        report: capture(),
      }),
    );

    await step.run(payload(), host);

    expect(reported?.requests).toEqual([]);
    expect(reported?.held).toBe('no-place');
    // Not even looked up: there is no recipe worth keying.
    expect(asked).toEqual([]);
  });

  /**
   * ***The place this turn moved to, not the one it left*** (2026-09-30). The
   * channels were rendered when the plan was built, before the stager wrote
   * the place, so every move reached the backdrop a turn late. Read when the
   * step runs.
   */
  it('reads the channels when it runs, not when it was planned', async () => {
    let place = 'the office';
    const { host } = recordingHost({ subject: 'never asked for' });
    const step = render(
      context({
        illustration: 'off',
        backdrop: true,
        channels: () => [{ id: 'se.location', text: place }],
        report: capture(),
      }),
    );

    // The stager moves the scene after the plan was built, before this runs.
    place = 'the quay';
    await step.run(payload(), host);

    expect(reported?.requests[0]?.prompt.text).toContain('the quay');
  });

  it('asks the reuse question with the digest it would have dispatched', async () => {
    // The lookup and the dispatch have to be keyed on the same string, or the
    // reuse check is a lookup for a picture nobody would have made.
    const asked: string[] = [];
    const { host } = recordingHost({ subject: 'never asked for' });
    const step = render(
      context({
        illustration: 'off',
        backdrop: true,
        reusable: (digest) => {
          asked.push(digest);
          return null;
        },
        report: capture(),
      }),
    );

    await step.run(payload(), host);

    expect(asked).toHaveLength(1);
    expect(reported?.requests[0]?.digest).toBe(asked[0]);
  });
});

describe('both purposes, one step', () => {
  it('produces two requests from one turn and one call', async () => {
    /**
     * [P9 §1.7]: *"not a second assembly path — the same step under the same
     * cap."* One call, because only the illustration branch has a moment; two
     * requests, because a turn can be both a picture and a place.
     */
    const { host, calls } = recordingHost({
      subject: 'a guttering lantern',
      anchor: 'The lantern guttered',
    });
    const step = render(context({ backdrop: true, report: capture() }));

    await step.run(payload(), host);

    expect(calls).toHaveLength(1);
    expect(reported?.requests.map((one) => one.purpose)).toEqual(['background', 'illustration']);
  });

  it('gives the two requests different digests', async () => {
    // They describe different things from one turn, so a shared digest would
    // make the backdrop reuse an illustration and vice versa.
    const { host } = recordingHost({ subject: 'a guttering lantern' });
    const step = render(context({ backdrop: true, report: capture() }));

    await step.run(payload(), host);
    const [background, illustration] = reported?.requests ?? [];

    expect(background?.digest).not.toBe(illustration?.digest);
  });

  it('emits a list from the first commit, with ordering on every element', async () => {
    // [P9 §4]'s first of the three things that keep the count judgement's
    // deferral cheap. The later phase widens this producer, not the type.
    const { host } = recordingHost({ subject: 'a guttering lantern' });
    const step = render(context({ backdrop: true, report: capture() }));

    await step.run(payload(), host);

    expect(Array.isArray(reported?.requests)).toBe(true);
    expect(reported?.requests.every((one) => one.ordering === 0)).toBe(true);
  });
});
