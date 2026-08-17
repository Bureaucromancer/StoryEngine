// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

/* eslint-disable @typescript-eslint/require-await -- the stub transports below
   are `fetch` implementations: async is their signature, not a choice. */

import { FakeProvider } from './fake.js';
import { ProviderError, type GenerationRequest, type RenderedMessage } from './types.js';

/**
 * The scripted provider, and the degradation paths it exists to make testable —
 * [testing §4.1], [P2 §2.8].
 *
 * These tests are about the tool rather than about the engine: if the fake
 * cannot reproduce a mid-stream disconnection or a provider that reports no
 * usage, then every later test that relies on it is asserting against a world
 * that is more forgiving than the real one.
 */

const messages: RenderedMessage[] = [
  { role: 'system', content: 'You are a narrator.', fromBlocks: ['b1'] },
  { role: 'user', content: 'It is raining.', fromBlocks: ['b2'] },
];

function ask(overrides: Partial<GenerationRequest> = {}): GenerationRequest {
  return { modelId: 'fake-hi', messages, params: { temperature: 0.7 }, ...overrides };
}

async function drain(
  stream: AsyncGenerator<{ text: string }, unknown>,
): Promise<{ chunks: string[]; result: unknown }> {
  const chunks: string[] = [];
  let next = await stream.next();
  while (next.done !== true) {
    chunks.push(next.value.text);
    next = await stream.next();
  }
  return { chunks, result: next.value };
}

describe('recording', () => {
  it('keeps every request, which is what makes it the golden-file harness', async () => {
    const provider = new FakeProvider();

    await provider.generate(ask());
    await provider.generate(ask({ modelId: 'fake-lo', params: { temperature: 0 } }));

    expect(provider.requests).toHaveLength(2);
    expect(provider.requests[0]?.modelId).toBe('fake-hi');
    // The messages as they arrived, `fromBlocks` and all — the provenance a
    // golden file snapshots and the workbench later renders.
    expect(provider.requests[0]?.messages[0]?.fromBlocks).toEqual(['b1']);
    expect(provider.requests[1]?.params.temperature).toBe(0);
  });

  it('records whether the call was streamed, because they are different paths', async () => {
    const provider = new FakeProvider();

    await provider.generate(ask());
    await drain(provider.stream(ask()));

    expect(provider.requests.map((request) => request.streamed)).toEqual([false, true]);
  });
});

describe('scripted replies', () => {
  it('answers in order and then repeats the last, so a loop cannot run dry', async () => {
    const provider = new FakeProvider({ script: [{ text: 'first' }, { text: 'second' }] });

    expect((await provider.generate(ask())).text).toBe('first');
    expect((await provider.generate(ask())).text).toBe('second');
    expect((await provider.generate(ask())).text).toBe('second');
  });

  it('streams text in pieces that reassemble exactly', async () => {
    const provider = new FakeProvider({
      script: [{ text: 'the rain had not stopped', chunks: 4 }],
    });

    const { chunks, result } = await drain(provider.stream(ask()));

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join('')).toBe('the rain had not stopped');
    expect((result as { text: string }).text).toBe('the rain had not stopped');
  });
});

describe('the failures that are hard to arrange for real', () => {
  it('fails with a class the UI can act on rather than a provider string', async () => {
    const provider = new FakeProvider({
      script: [{ error: { class: 'retryable', message: 'Rate limited.' } }],
    });

    await expect(provider.generate(ask())).rejects.toBeInstanceOf(ProviderError);
    await expect(provider.generate(ask())).rejects.toMatchObject({ class: 'retryable' });
  });

  it('disconnects mid-stream, after the caller already has text', async () => {
    // The one that matters most for P2.5: a partial answer plus a failure, not
    // a failure instead of an answer. Everything downstream has to cope with
    // having been handed something.
    const provider = new FakeProvider({
      script: [{ text: 'the rain had not', chunks: 4, failAfterChunks: 2 }],
    });

    const stream = provider.stream(ask());
    const received: string[] = [];

    await expect(
      (async () => {
        for await (const chunk of stream) received.push(chunk.text);
      })(),
    ).rejects.toMatchObject({ class: 'transient' });

    expect(received).toHaveLength(2);
    expect(received.join('')).not.toBe('');
  });

  it('hands back malformed structured output, for the re-ask loop to catch', async () => {
    // The bounded re-ask loop is P2.4's; what this proves is that the fake can
    // *produce* the input it needs — an object that is not what was asked for.
    const provider = new FakeProvider({
      script: [{ object: { wrong: 'shape' } }, { object: { verdict: 'ok' } }],
    });

    const first = await provider.generate(ask({ schema: { type: 'object' } }));
    const second = await provider.generate(ask({ schema: { type: 'object' } }));

    expect(first.object).toEqual({ wrong: 'shape' });
    expect(second.object).toEqual({ verdict: 'ok' });
  });
});

describe('degradation', () => {
  it('reports no usage when it says it reports no usage', async () => {
    // The budgeter's margin is the only signal in that world, and a fake that
    // helpfully reported usage anyway would hide the case entirely.
    const provider = new FakeProvider({ capabilities: { reportsUsage: false } });

    const result = await provider.generate(ask());

    expect(provider.capabilities.reportsUsage).toBe(false);
    expect(result.usage).toBeNull();
  });

  it('can be a provider without structured output, so the caller must degrade', async () => {
    const provider = new FakeProvider({
      capabilities: { supportsStructuredOutput: false, supportsTools: false },
    });

    // Two lines of setup rather than a hypothetical to reason about: the
    // caller checks capabilities and falls back to prompted JSON.
    expect(provider.capabilities.supportsStructuredOutput).toBe(false);
    expect(provider.capabilities.supportsTools).toBe(false);
  });

  it('can be a provider that wants same-role messages merged', async () => {
    const provider = new FakeProvider({ capabilities: { mergeSameRole: 'required' } });
    expect(provider.capabilities.mergeSameRole).toBe('required');
  });
});
