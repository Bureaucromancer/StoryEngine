// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import { createCaptureRecorder } from './capture.js';
import type { Connection } from './connections.js';
import { OpenAICompatibleProvider } from './openai-compatible.js';
import type { FinishReason, RenderedMessage } from './types.js';
import { createCaptureStore } from '../storage/captures.js';

/**
 * The real adapter against a real endpoint — the other half of
 * `openai-compatible.test.ts`, which drives it against stub transports.
 *
 * **Gated on the environment, not on a flag.** `STORYENGINE_LIVE_BASE_URL` and
 * `STORYENGINE_LIVE_MODEL` name an OpenAI-compatible endpoint (see
 * `.env.example` at the repo root; `pnpm test:live` loads `.env`). When either
 * is missing the suite skips — a fresh clone and CI stay green, and a
 * developer with a local model gets a real exchange for the cost of two lines
 * of config. That keeps the per-commit suite deterministic while making the
 * one boundary that is not ours ([P2C](../../../../docs/design/workplan/12-p2c-first-real-run.md))
 * crossable on demand.
 *
 * **The assertions are structural, deliberately.** A live model's words are
 * nobody's contract: what is asserted is the half the adapter promises
 * whatever the endpoint says — text arrived, the finish reason is in our
 * vocabulary rather than the provider's, usage is numbers or null and never an
 * estimate. Content assertions belong on cassettes, where the bytes hold still.
 *
 * **Every run records.** The exchanges go through the capture recorder into
 * `captures/live-tests/` (gitignored), so a live run leaves the artefact
 * [P2C §2.2] wants: bytes that can be curated into
 * `providers/fixtures/` rather than a green checkmark that evaporates.
 */

const baseUrl = process.env['STORYENGINE_LIVE_BASE_URL'] ?? '';
const modelId = process.env['STORYENGINE_LIVE_MODEL'] ?? '';
const apiKey = process.env['STORYENGINE_LIVE_API_KEY'] ?? '';
const configured = baseUrl.length > 0 && modelId.length > 0;

const FINISH_REASONS: FinishReason[] = ['stop', 'length', 'filtered', 'tool', 'unknown'];

const messages: RenderedMessage[] = [
  { role: 'system', content: 'You answer in as few words as possible.', fromBlocks: ['live-b1'] },
  { role: 'user', content: 'Reply with the single word: ok', fromBlocks: ['live-b2'] },
];

/** Small and cold: the point is the exchange, not the prose. */
const params = { temperature: 0, maxTokens: 64 };

function liveProvider(capabilities?: Connection['capabilities']): OpenAICompatibleProvider {
  const connection: Connection = {
    id: 'live-env',
    label: 'Live endpoint (.env)',
    provider: 'openai-compatible',
    scope: 'user',
    models: [modelId],
    baseUrl,
    ...(apiKey.length > 0 ? { apiKey } : {}),
    ...(capabilities === undefined ? {} : { capabilities }),
  };
  const recorder = createCaptureRecorder({
    sink: createCaptureStore('captures/live-tests'),
  });
  return new OpenAICompatibleProvider({
    connection,
    fetch: recorder.wrapFetch(globalThis.fetch, connection),
  });
}

describe.skipIf(!configured)('the adapter against a live endpoint', () => {
  it('completes a generate call and classifies what came back', async () => {
    const result = await liveProvider().generate({ modelId, messages, params });

    expect(result.text.length).toBeGreaterThan(0);
    expect(FINISH_REASONS).toContain(result.finishReason);
    expect(result.modelId.length).toBeGreaterThan(0);
    // Numbers the endpoint sent, or null — never an estimate filling a gap.
    if (result.usage !== null) {
      expect(result.usage.promptTokens).toBeGreaterThan(0);
      expect(result.usage.completionTokens).toBeGreaterThan(0);
    }
  });

  it('streams chunks and resolves the same result generate would have', async () => {
    const generation = liveProvider().stream({ modelId, messages, params });
    let streamed = '';
    let next = await generation.next();
    while (next.done !== true) {
      streamed += next.value.text;
      next = await generation.next();
    }
    const result = next.value;

    expect(streamed.length).toBeGreaterThan(0);
    expect(result.text).toBe(streamed);
    expect(FINISH_REASONS).toContain(result.finishReason);
  });
});

/**
 * Structured output against a real endpoint — [P7.4].
 *
 * **The one thing a stub transport cannot answer**: whether the endpoint
 * *honours* `response_format`. `openai-compatible.test.ts` proves the schema
 * reaches the wire and that the SDK parses what comes back; only a real model
 * can say whether it writes the shape it was shown. Every local runtime this
 * project targets claims JSON mode, and they do not all mean the same thing by
 * it.
 *
 * **Structural, like everything else here.** What is asserted is that an object
 * came back and that the adapter's own division held — never the model's
 * choice of value, which is not a contract. The one content assertion is the
 * key's presence, because *asked for a shape and got one* is precisely the claim
 * under test.
 *
 * *Both capability arms are run, because they send different bytes and a local
 * runtime can honour one and not the other. A miss is reported rather than
 * failed on the permissive arm: an endpoint asked for bare JSON and told nothing
 * about the shape is entitled to write prose, and that is the gap the caller's
 * degrade exists to fill rather than a broken adapter.*
 */
describe.skipIf(!configured)('structured output against a live endpoint', () => {
  const SCHEMA = {
    type: 'object',
    properties: { colour: { type: 'string' } },
    required: ['colour'],
    additionalProperties: false,
  };

  const asking: RenderedMessage[] = [
    {
      role: 'user',
      content: 'Name one colour. Reply with JSON: {"colour": "..."}',
      fromBlocks: ['live-b3'],
    },
  ];

  it('gets an object back when the endpoint is told the shape', async () => {
    const result = await liveProvider({ supportsStructuredOutput: true }).generate({
      modelId,
      messages: asking,
      params,
      schema: SCHEMA,
    });

    // The text is always the model's words, object or no object — which is what
    // makes a miss diagnosable rather than a blank.
    expect(result.text.length).toBeGreaterThan(0);
    expect(FINISH_REASONS).toContain(result.finishReason);
    // `object` is present as a key whenever a schema was asked for, and holds
    // `undefined` when the reply would not parse.
    expect('object' in result).toBe(true);
    expect(result.object).toMatchObject({ colour: expect.any(String) });
  });

  it('asks for bare JSON without the schema, and says what came back either way', async () => {
    const result = await liveProvider().generate({
      modelId,
      messages: asking,
      params,
      schema: SCHEMA,
    });

    expect(result.text.length).toBeGreaterThan(0);
    expect('object' in result).toBe(true);
    // Not asserted as present: the endpoint was asked for JSON and told nothing
    // about its shape, so an unparseable reply is the endpoint being honest
    // about what it was asked. What is asserted is that the adapter reports the
    // difference rather than inventing an object.
    expect(result.object === undefined || typeof result.object === 'object').toBe(true);
  });
});
