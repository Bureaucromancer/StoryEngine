// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FakeProvider, type RecordedRequest } from '../providers/fake.js';
import { readAllTurns } from '../sessions/segments.js';
import { SE_CLOCK } from '../sessions/channels.js';
import { submitTurn } from '../state/jobs.js';
import { Layout } from '../storage/layout.js';
import { TEST_STEP } from '../test-mode.js';
import { TurnRunner } from '../turns/runner.js';
import type { StepDefinition, TurnPlan } from '../turns/steps.js';
import { makeTestServer, setUpAdmin, type TestServer } from '../test-server.js';

/**
 * **Exit-gate step 17**, verbatim from
 * [P2 §4](../../../../docs/design/workplan/08-p2-implementation.md):
 *
 * > Type guidance → it appears as an advisory block in the record, does not
 * > enter history, and the golden suite asserts no advisory block ever reaches
 * > an effect-producing call (§2.9).
 *
 * **What this file adds that the three unit halves cannot.** The firewall
 * [06 §5.2](../../../../docs/design/06-modes-and-turn-pipeline.md) demands is enforced three
 * derivations deep, and each layer already has its own test: `collect.test.ts`
 * proves `collectCandidates` forces `advisory: true` on a guidance slot even
 * when the preset says otherwise, `steps.test.ts` proves `callPurposeFor`
 * derives the purpose from the step's own declaration, and `assemble.test.ts`
 * proves `admit()` throws. What none of them asserts is the **outcome**: what a
 * provider was actually handed, what landed in the file on disk, and what the
 * route hands a client back. Three green unit tests over three layers that were
 * wired together wrongly is exactly the shape of a gate step that passes while
 * the product is broken — [P2 §4] step 17 is a sentence about the *record* and
 * the *provider*, not about three functions.
 *
 * So everything here goes through the real routes, the real preset, the real
 * runner and the real commit protocol, with `FakeProvider` as the only
 * substitution — [P2 §2.8]'s stated purpose for it, *"the golden-file harness…
 * because it records every request"*.
 *
 * **The claim this file could not assert until [P3.0], and now does.** Step 17
 * says the block appears *as an advisory block* in the record, and for the
 * whole of P2 `AssembledBlock` had no `advisory` field — `assemble()` read
 * `Candidate.advisory` in `admit()` and built the block without carrying it
 * across, so this file settled for `source.kind === 'guidance'`, deliberately
 * the weaker, true thing. That proxy was never equivalent: `PresetBlock.advisory`
 * is authorable on any block and `emit()` takes the union, so a preset can
 * mint an advisory block that is not guidance and whose advisory-ness the
 * record then lost. P3.0 carries the flag onto the block and the purpose onto
 * the call, so the assertions below are on the record's own fields — the
 * source-kind checks that remain are about *guidance* specifically (one-shot
 * behaviour), not stand-ins for *advisory*.
 */

let server: TestServer;
let provider: FakeProvider;
let sessionId: string;

/**
 * A second runner, for the one test that needs a plan the shipped mode does not
 * have. Drained before the server disposes — a detached run touching a closed
 * `DatabaseSync` is the `EBUSY`-two-layers-away failure `TurnRunner.drain`
 * exists for.
 */
let borrowedRunner: TurnRunner | null = null;

const CONNECTION_ID = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a17';
const ACCOUNT = 'ned';

/** The guidance under test. A string no other fixture in this repo contains, so
 * every `not.toContain` below is a real search rather than a coincidence. */
const GUIDANCE = 'Keep it short.';
const INPUT = 'She opened the door.';

/**
 * The canonical *"stand up a server that can take a turn"* setup —
 * `routes/sessions.test.ts`'s shape, deliberately copied rather than shared.
 *
 * The provider factory is passed at construction and never assigned afterwards:
 * `TurnRunner` captures it when it is built ([`app.ts`]'s `providers` option
 * says so in as many words), so a test that swapped `services.providers` later
 * would change something nothing reads and then quietly assert against the real
 * adapter.
 */
async function standUp(): Promise<void> {
  provider = new FakeProvider({});
  server = await makeTestServer({
    providers: () => provider,
    config: {
      sessions: {
        snapshotEveryNTurns: 10,
        streamKeepaliveMs: 15000,
        // One checkpoint per chunk, so nothing here depends on how fast the
        // machine is.
        streamCoalesceMs: 0,
      },
    },
  });
  await setUpAdmin(server, ACCOUNT);

  // A connection and a `prose` binding, because `performCall` resolves the
  // step's declared role before it assembles: without these every turn below
  // would fail as `RoleUnresolved` and never reach the assembler at all —
  // which would make the firewall assertions vacuously green.
  const root = new Layout(server.dataDir).userConnectionsRoot(ACCOUNT);
  await mkdir(root, { recursive: true });
  await writeFile(
    join(root, 'fake.json'),
    JSON.stringify({
      id: CONNECTION_ID,
      label: 'The double',
      provider: 'openai-compatible',
      models: ['fake-hi'],
    }),
  );
  await writeFile(
    join(server.dataDir, 'users', ACCOUNT, 'bindings.json'),
    JSON.stringify({ prose: { connectionId: CONNECTION_ID, modelId: 'fake-hi' } }),
  );

  const created = await server.request({
    method: 'POST',
    url: '/api/sessions',
    payload: { name: 'Rain City' },
  });
  sessionId = created.body.session.id;
}

beforeEach(async () => {
  await standUp();
});

afterEach(async () => {
  await borrowedRunner?.drain();
  borrowedRunner = null;
  await server.dispose();
});

/**
 * Submits a turn through the route and waits for it to be committed.
 *
 * `runner.settle()` rather than a poll or a sleep: it awaits the very promise
 * `TurnRunner.start` registered, and that promise resolves only after
 * `finaliseTurn` has appended the JSONL turn, applied the effects and published
 * `turn.finished` — so it is the same instant the gate's *"wait for
 * turn.finished"* names, observed from inside the process instead of over SSE.
 * The SSE frame's own ordering is bound by `routes/sessions.test.ts`; repeating
 * it here would add a timeout to every assertion for nothing.
 */
async function takeTurn(options: {
  text: string;
  guidance?: string;
  key: string;
  headTurnId: string | null;
}): Promise<void> {
  const accepted = await server.request({
    method: 'POST',
    url: `/api/sessions/${sessionId}/turns`,
    payload: {
      idempotencyKey: options.key,
      headTurnId: options.headTurnId,
      input: { text: options.text },
      ...(options.guidance === undefined ? {} : { guidance: options.guidance }),
    },
  });
  // Asserted, because a 400 from a body schema that stopped accepting
  // `guidance` would otherwise present as "the block is missing from the
  // record" — the same symptom as the firewall being broken, from the opposite
  // cause.
  expect(accepted.status).toBe(202);
  await server.services.runner.settle();
}

/** The turn record as a client reads it — through the route, not off disk. */
async function readNewestTurn(): Promise<{
  status: string;
  input?: { text: string; raw: string };
  steps: { stepId: string; state: string; failure?: string; error?: { reason: string } }[];
  request: {
    // Per call since [P3.0] — the shape's own "one per model call".
    calls: {
      stepId: string;
      purpose: string;
      blocks: {
        id: string;
        source: { kind: string; producer?: string; turnId?: string | null };
        reason: string;
        role: string;
        text: string;
        tokens: number;
        included: boolean;
        advisory?: true;
      }[];
      budget: { decisions: { blockId: string; included: boolean; rule: string }[] };
    }[];
  };
}> {
  const turns = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}/turns` });
  expect(turns.status).toBe(200);
  const newest = turns.body.turns.at(-1);
  // A precondition of the helper rather than an assertion: an empty transcript
  // means the turn never committed, and every assertion downstream would then
  // fail on `undefined` with a message about a property instead of about the
  // commit that did not happen.
  if (newest === undefined) throw new Error('the transcript route returned no turn to read');
  return newest;
}

/** Everything the provider was handed on one request, as one searchable string. */
function sentText(request: RecordedRequest | undefined): string {
  return (request?.messages ?? []).map((message) => message.content).join('\n');
}

/**
 * Whether a request carried the guidance block — **by block id, not by text**.
 *
 * `RenderedMessage.fromBlocks` is the mapping `render()` maintains precisely so
 * that a merged message can still be traced back to the blocks that produced it,
 * and it is the only place a *sent* byte is attributable. Matching on the
 * guidance string instead would be satisfied by a build that renamed the block,
 * and would be defeated by one that reworded the wrapper.
 */
function carriedGuidanceBlock(request: RecordedRequest): boolean {
  return request.messages.some((message) => message.fromBlocks.includes('se.guidance'));
}

describe('step 17 (a) — guidance appears in the turn record as its own block', () => {
  it('records one guidance-sourced block, included, with the text the player typed', async () => {
    // **The block, through the route the workbench will read.** [03 §8] makes
    // the record complete from the first turn *because everything after P2 reads
    // it*, so the assertion that matters is what `GET /turns` serves, not what
    // `collectCandidates` returns in isolation.
    await takeTurn({ text: INPUT, guidance: GUIDANCE, key: 'k1', headTurnId: null });
    const record = await readNewestTurn();

    const guidance = record.request.calls
      .flatMap((call) => call.blocks)
      .filter((block) => block.source.kind === 'guidance');
    // Exactly one. Two would mean the preset's slot and something else both
    // emitted it, and the budgeter would then be dropping one of a pair the
    // record presents as independent.
    expect(guidance).toHaveLength(1);

    const block = guidance[0];
    // `producer` is the field [06 §5.1] needs because one slot has several
    // producers — the user's box, a rule's `giveGuidance`, a Narrative Director
    // push. Asserting the kind alone would pass for a rule-authored block, which
    // is a different thing with different consequences for who is responsible
    // for the words.
    expect(block?.source).toEqual({ kind: 'guidance', producer: 'user' });
    expect(block?.id).toBe('se.guidance');
    expect(block?.included).toBe(true);
    // Exact, not `toContain`: the shipped slot declares no wrapper, so anything
    // added around the text is a change to what the player's words became, and
    // the record is the only place that is visible.
    expect(block?.text).toBe(GUIDANCE);
    // `role: 'system'` is the instruction channel. As `user` it would read to
    // the model as something the player said in character, which is the
    // confusion the separate box exists to end.
    expect(block?.role).toBe('system');
    // `reason` is a product feature rather than a debug string ([`Candidate`]),
    // so it is required to be the block's author-facing label.
    expect(block?.reason).toBe('guidance');
  });

  it('names the guidance block in the budget verdict, with the rule that kept it', async () => {
    // [21 §1.5]: *every* block appears in `decisions`, including the included
    // ones — a verdict listing only drops cannot answer "what falls out next".
    // A guidance block silently absent from the verdict would look identical to
    // one that was never considered.
    await takeTurn({ text: INPUT, guidance: GUIDANCE, key: 'k1', headTurnId: null });
    const record = await readNewestTurn();

    const decision = record.request.calls[0]?.budget.decisions.find(
      (each) => each.blockId === 'se.guidance',
    );
    expect(decision?.included).toBe(true);
    // The preset gives the guidance slot priority 80 — above history (10) and
    // below the player's action (100). Pinning the number here is what makes a
    // silent reprioritisation of somebody's instructions visible.
    expect(decision?.rule).toBe('included — priority 80');
  });

  it('carries the block into the request the provider actually received', async () => {
    // The record and the wire agreeing is the claim. A record listing the block
    // as `included: true` while `render()` dropped it would be the worst of both
    // — the workbench would show a block that never reached the model.
    await takeTurn({ text: INPUT, guidance: GUIDANCE, key: 'k1', headTurnId: null });

    expect(provider.requests).toHaveLength(1);
    expect(carriedGuidanceBlock(provider.requests[0]!)).toBe(true);
    expect(sentText(provider.requests[0])).toContain(GUIDANCE);
  });
});

describe('step 17 (b) — guidance does not enter history', () => {
  it('keeps the guidance out of the committed turn input entirely', async () => {
    // **Read off disk, not through the route.** The JSONL segment is the
    // terminal, authoritative artefact ([P2 §2.10] — *"completed turns are then
    // authoritative files"*), and it is what a later turn's history is built
    // from. A route that filtered the guidance out on the way to a client, while
    // the file held it, would satisfy every HTTP-level assertion and still poison
    // every future prompt.
    await takeTurn({ text: INPUT, guidance: GUIDANCE, key: 'k1', headTurnId: null });

    const written = await readAllTurns(
      join(server.dataDir, 'users', ACCOUNT, 'sessions', sessionId, 'turns'),
    );
    expect(written).toHaveLength(1);
    const turn = written[0]?.turn;

    // Asserted over the **serialised** input rather than field by field: [03
    // §5.1]'s objection is to guidance being *in the turn's input at all*, and a
    // field-by-field check would be silently narrowed by any field added later —
    // an `annotations`, a `meta`, a second `raw`. The serialisation cannot be
    // outgrown.
    expect(JSON.stringify(turn?.input)).not.toContain(GUIDANCE);
    // …and the input is still the whole of what the player typed, so the
    // assertion above cannot be satisfied by an input that lost everything.
    expect(turn?.input?.text).toBe(INPUT);
    // `raw` is *what the player typed before anything normalised it*, which is
    // what a rewrite replays — so it is the field a concatenating implementation
    // would most plausibly leave the guidance in.
    expect(turn?.input?.raw).toBe(INPUT);
  });

  it('is one-shot: a later turn assembles history without it', async () => {
    // **The half [06 §5.1] is actually about.** Guidance kept out of `input` but
    // folded into the previous turn's *text* would pass the test above and fail
    // here: the cost the box exists to avoid is guidance living in history
    // permanently — summarised as narrative, keyword-matched, read back as
    // dialogue, and exported.
    await takeTurn({ text: INPUT, guidance: GUIDANCE, key: 'k1', headTurnId: null });

    const read = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}` });
    await takeTurn({
      text: 'She stepped through.',
      key: 'k2',
      headTurnId: read.body.session.headTurnId,
    });

    const record = await readNewestTurn();
    // Over the serialised block table, for the same reason as above: a future
    // field on `AssembledBlock` must not be a place the string can hide.
    expect(JSON.stringify(record.request.calls.flatMap((call) => call.blocks))).not.toContain(
      GUIDANCE,
    );
    // No guidance-sourced block at all this time — `omitWhenEmpty` on the slot
    // is what makes an unused box cost nothing rather than emit a heading with
    // nothing under it.
    expect(
      record.request.calls
        .flatMap((call) => call.blocks)
        .some((block) => block.source.kind === 'guidance'),
    ).toBe(false);

    // **The guard against a vacuous pass.** Everything above would also hold if
    // the second turn assembled no history whatsoever, which is a different bug
    // wearing the same green tick. The first turn's words must be there.
    expect(
      record.request.calls
        .flatMap((call) => call.blocks)
        .some((block) => block.source.kind === 'history'),
    ).toBe(true);
    expect(JSON.stringify(record.request.calls.flatMap((call) => call.blocks))).toContain(INPUT);

    // And the same two claims on the wire: the second call carries the first
    // turn's action and not the instructions that shaped it.
    expect(provider.requests).toHaveLength(2);
    expect(sentText(provider.requests[1])).toContain(INPUT);
    expect(sentText(provider.requests[1])).not.toContain(GUIDANCE);
  });
});

/**
 * **Where this test enters the system, and why that is the strongest place
 * available.**
 *
 * The gate wants a golden assertion that *no advisory block ever reaches an
 * effect-producing call*. Scene's shipped plan cannot produce one: it declares a
 * single step, `se.narrate`, with `contributes: 'messages'` and an empty
 * `writes`, which is exactly the pair `callPurposeFor` turns into `prose` — so
 * driving the app end to end can only ever exercise the admitting half. Adding a
 * second step to the mode to make the test possible would be testing a mode
 * nobody ships, and [P2 §5] draws that line explicitly (*"a second step … belongs
 * to P7"*).
 *
 * So the entry point is `RunnerOptions.plan` — the seam the runner already
 * declares for exactly this (*"P2.6's modes supply their own"*) — over the
 * **running server's own commit context, bus, provider factory and config**, with
 * the job reserved through the same `submitTurn` the route calls and the result
 * read back through the same `GET /turns` a client uses. Everything between the
 * reservation and the record is production code: `collectCandidates` filling the
 * shipped preset, `callPurposeFor` deriving from the definition, `performCall`
 * assembling, `admit()` refusing, `classifyStep` naming it, and `finaliseTurn`
 * committing it. The plan is the only substituted value, and it is data.
 *
 * `turns/runner.test.ts` already drives a *single* refused step against a
 * hand-built context. What is new here is the pair: one turn, two calls, one of
 * each purpose, with the same collected candidates behind both — so the only
 * difference between the call that got the guidance and the call that was
 * refused is the purpose derived from the step, which is precisely the claim.
 */
describe('step 17 (c) — no advisory block reaches an effect-producing call', () => {
  /**
   * A step that writes a channel, so it may never see an advisory block.
   *
   * `callKind: 'narrate'` — the same kind `se.narrate` uses — is deliberate.
   * `PresetBlock.appliesTo` filters candidates *by call kind*, so a different
   * kind here would give the refusal a second possible explanation: the guidance
   * block might simply not have been collected. Identical kinds mean both calls
   * are offered the identical candidate list and differ in exactly one derived
   * value.
   *
   * `failure: 'warn'` rather than `'abort'` so the turn survives its own
   * refusal. That is what lets one turn hold both outcomes, and it also asserts
   * something worth asserting: the firewall is targeted, not a blast radius.
   */
  const EXTRACT: StepDefinition = {
    id: 'se.extract',
    stage: 'extract',
    reads: [],
    writes: [SE_CLOCK],
    contributes: 'effects',
    callKind: 'narrate',
    when: { when: 'cadence', everyNTurns: 1 },
    failure: 'warn',
    role: 'prose',
  };

  /** Narrate as Scene ships it, then an extractor. Order is executed as given. */
  const BOTH_KINDS: TurnPlan = {
    steps: [
      {
        definition: TEST_STEP,
        run: async (_input, host) => ({ message: { text: (await host.call({})).text } }),
      },
      {
        definition: EXTRACT,
        run: async (_input, host) => {
          await host.call({});
          return {};
        },
      },
    ],
  };

  async function runBothKinds(
    payload: { guidance?: string; attempt?: { turnId: string; text: string } } = {
      guidance: GUIDANCE,
    },
  ): Promise<void> {
    borrowedRunner = new TurnRunner({
      commit: server.services.commit,
      bus: server.services.bus,
      providers: () => provider,
      // The app's own store, so the capability this turn resolves under is the
      // one the routes would report ([P2A §2.1]).
      accounts: server.services.accounts,
      config: server.services.config,
      plan: BOTH_KINDS,
    });

    // Reserved through the production submission protocol rather than by
    // inserting a job row: [P2 §2.10]'s three-way outcome is what decides that
    // this turn may start at all, and a test that bypassed it would be running a
    // turn the server would have refused.
    const outcome = await submitTurn(server.services.jobs, {
      account: ACCOUNT,
      sessionId,
      idempotencyKey: 'k1',
      headTurnId: null,
    });
    expect(outcome.kind).toBe('created');
    if (outcome.kind !== 'created') return;

    borrowedRunner.start(outcome.job, {
      input: { actorId: null, kind: 'do', text: INPUT, raw: INPUT },
      ...payload,
    });
    await borrowedRunner.settle();
  }

  it('hands the guidance to the prose call and refuses the effects call', async () => {
    await runBothKinds();

    // **One request, not two.** The refusal happens in `assemble()`, before
    // `provider.generate` is reached, so the effects call costs nothing — which
    // matters because the alternative reading of "never reaches" is a filter,
    // and a filter would have spent a request. Both mutations are caught here:
    // a `callPurposeFor` that returned `prose` unconditionally makes this two,
    // and an `admit()` that filtered instead of throwing also makes it two.
    expect(provider.requests).toHaveLength(1);

    // The one that did happen is the prose call, and it carried the block.
    expect(carriedGuidanceBlock(provider.requests[0]!)).toBe(true);
    // Asserted over the whole corpus rather than over index 1, so that a build
    // which reordered the plan, retried, or added a call cannot slip past by
    // moving the leak somewhere this test does not look.
    expect(provider.requests.filter(carriedGuidanceBlock)).toHaveLength(1);
    expect(
      provider.requests.filter((request) => sentText(request).includes(GUIDANCE)),
    ).toHaveLength(1);
  });

  it('records the refusal as the step failure it is, and commits the turn anyway', async () => {
    await runBothKinds();
    const record = await readNewestTurn();

    // Named on the record, not merely absent from the wire. [09 §3.3] wants the
    // live view and the history view to agree about what happened, and a call
    // that was refused with nothing written down is a step that silently did
    // less than it declared.
    expect(record.steps.map((step) => `${step.stepId}:${step.state}`)).toEqual([
      'se.narrate:ok',
      'se.extract:failed',
    ]);
    // `advisory-leak` is its own `StepFailureReason` rather than `internal`,
    // which is what lets a UI say *why* — collapsing it into `internal` would
    // present a design rule being enforced as a bug in the engine.
    expect(record.steps[1]?.error?.reason).toBe('advisory-leak');
    expect(record.steps[1]?.failure).toBe('warn');

    // The turn still completes: the guidance shaped the prose it was written
    // for, and only the call that must not see it lost anything.
    expect(record.status).toBe('complete');
    // One `ModelCall` on the record, matching the one request the provider saw.
    // `AdvisoryLeakError` is not a `CallFailed`, so no call record is minted for
    // a call that never left the assembler — and a record showing two calls
    // against one request would be a record nobody could reconcile.
    expect(record.request.calls.map((call) => call.stepId)).toEqual(['se.narrate']);
  });

  /**
   * [P3.0]: the invariant over the record's own fields, replacing the proxy
   * the header apologised for. Falsifying mutations, one per half: delete the
   * advisory spread in `assemble()`'s block literal (the flag vanishes), or
   * hardcode `purpose: 'effects'` at the success literal in `performCall`
   * (the recorded call lies about what it was allowed to produce).
   */
  it('records the block as advisory and the committed call as prose — the invariant, on the record', async () => {
    await runBothKinds();
    const record = await readNewestTurn();

    // The guidance block says *advisory* now, not merely *guidance-sourced*.
    const guidance = record.request.calls
      .flatMap((call) => call.blocks)
      .find((block) => block.source.kind === 'guidance');
    expect(guidance?.advisory).toBe(true);

    // Every committed call names its purpose, and the one call that carried an
    // advisory block is a prose call — [testing §1], expressible at last. The
    // refused effects call left no ModelCall (asserted above), so over this
    // record the invariant reads: advisory blocks appear only beside calls
    // whose every member is prose.
    expect(record.request.calls.map((call) => call.purpose)).toEqual(['prose']);
  });

  /**
   * The second advisory slot, under the same pair — [06 §5.1]. Run **without
   * guidance**, because with both blocks present a refusal could be either's,
   * and this is the claim that the attempt alone is enough to be refused.
   */
  it('refuses the previous attempt from the effects call and hands it to the prose call', async () => {
    const ATTEMPT = 'She had opened the door once already.';
    await runBothKinds({ attempt: { turnId: 'the-first-try', text: ATTEMPT } });
    const record = await readNewestTurn();

    // One request: the refusal is a throw in `assemble()`, not a filter.
    expect(provider.requests).toHaveLength(1);
    expect(
      provider.requests[0]?.messages.some((message) => message.fromBlocks.includes('se.attempt')),
    ).toBe(true);
    expect(sentText(provider.requests[0])).toContain(ATTEMPT);

    // Refused by name, and the turn survived it.
    expect(record.steps[1]?.error?.reason).toBe('advisory-leak');
    expect(record.request.calls.map((call) => call.purpose)).toEqual(['prose']);

    // On the record: advisory, and naming the attempt it showed.
    const attempt = record.request.calls
      .flatMap((call) => call.blocks)
      .find((block) => block.source.kind === 'attempt');
    expect(attempt?.advisory).toBe(true);
    expect(attempt?.source).toEqual({ kind: 'attempt', turnId: 'the-first-try' });
  });
});
