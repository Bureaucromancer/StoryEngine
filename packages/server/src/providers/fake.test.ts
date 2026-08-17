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

describe('the double has time in it, and honours a stop', () => {
  it('leaves a window between chunks that a caller can act in', async () => {
    // Without `chunkDelayMs` this generator has no `await` between yields, so
    // the whole stream drains inside one macrotask — measured, forty chunks in
    // under a millisecond, before a `setTimeout(…, 0)` scheduled first ever
    // ran. Every test that claims to do something "mid-stream" would be acting
    // after the stream had already finished.
    const provider = new FakeProvider({ script: [{ text: 'abcdef', chunks: 3, chunkDelayMs: 5 }] });

    let ticked = false;
    setTimeout(() => (ticked = true), 0);

    const seen: string[] = [];
    for await (const chunk of provider.stream(ask())) {
      seen.push(chunk.text);
    }

    expect(seen.join('')).toBe('abcdef');
    expect(ticked, 'the stream never yielded to the event loop').toBe(true);
  });

  it('stops when the request is aborted, the way a socket would', async () => {
    // A real adapter hands the signal to `fetch` and the request dies at the
    // socket. A double that ignored it would leave the abort path — the one a
    // user's Stop button rides on — shipped and never exercised.
    const provider = new FakeProvider({ script: [{ text: 'abcdef', chunks: 6, chunkDelayMs: 2 }] });
    const controller = new AbortController();

    const seen: string[] = [];
    const consume = async (): Promise<void> => {
      for await (const chunk of provider.stream({ ...ask(), signal: controller.signal })) {
        seen.push(chunk.text);
        if (seen.length === 2) controller.abort();
      }
    };

    await expect(consume()).rejects.toThrow(/aborted/i);
    expect(seen).toHaveLength(2);
  });

  it('can report no usage at all, distinctly from reporting zero', async () => {
    // `usage: null` and an absent `usage` are different claims, and [13 §1.4]
    // requires the record to keep the first as null rather than synthesise a
    // number.
    const provider = new FakeProvider({ script: [{ text: 'x', reportsNoUsage: true }] });

    expect((await provider.generate(ask())).usage).toBeNull();
    expect((await new FakeProvider({ script: [{ text: 'x' }] }).generate(ask())).usage).toEqual({
      promptTokens: 0,
      completionTokens: 0,
    });
  });
});
