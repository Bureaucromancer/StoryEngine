// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import {
  createCaptureRecorder,
  redactHeaders,
  redactText,
  responseFromCassette,
  type Cassette,
  type CaptureSink,
} from './capture.js';
import type { Connection } from './connections.js';
import { OpenAICompatibleProvider } from './openai-compatible.js';
import type { GenerationResult, ProviderError, RenderedMessage } from './types.js';

/**
 * **Record through the real adapter, replay through the real adapter, compare**
 * — the round trip is the whole claim. A recorder tested against synthetic
 * chunks would be the stub agreeing with itself again, one layer down; this
 * drives `OpenAICompatibleProvider` through a recording fetch wrapped around a
 * stub transport, then feeds the cassette back through a second adapter and
 * asserts the two runs saw the same thing.
 *
 * The fixture streams are deliberately hostile in the ways the readiness
 * survey validated the adapter against: seven-byte chunks that split JSON
 * mid-object, CRLF framing, a key echoed inside an error body. The corpus
 * exists to preserve exactly those shapes, so the tests assert byte equality
 * per chunk, not string similarity.
 */

const KEY = 'sk-test-0123456789abcdef';

const messages: RenderedMessage[] = [
  { role: 'system', content: 'You are a narrator.', fromBlocks: ['b1'] },
  { role: 'user', content: 'It is raining.', fromBlocks: ['b2'] },
];

function connectionWith(overrides: Partial<Connection> = {}): Connection {
  return {
    id: 'conn-0192b7c0-cassette',
    label: 'Recorded',
    provider: 'openai-compatible',
    scope: 'user',
    models: ['llama-local'],
    baseUrl: 'http://localhost:11434/v1',
    apiKey: KEY,
    ...overrides,
  };
}

/** An in-memory sink, plus a way to wait for the pump's asynchronous flush. */
function memorySink(): {
  sink: CaptureSink;
  written: Map<string, string>;
  next: () => Promise<Cassette>;
} {
  const written = new Map<string, string>();
  let settle: ((cassette: Cassette) => void) | null = null;
  const pending: Cassette[] = [];

  return {
    written,
    sink: {
      write(fileName, json): Promise<void> {
        written.set(fileName, json);
        const cassette = JSON.parse(json) as Cassette;
        if (settle !== null) {
          settle(cassette);
          settle = null;
        } else {
          pending.push(cassette);
        }
        return Promise.resolve();
      },
    },
    next: (): Promise<Cassette> => {
      const queued = pending.shift();
      if (queued !== undefined) return Promise.resolve(queued);
      return new Promise((resolve) => {
        settle = resolve;
      });
    },
  };
}

/** An SSE body chopped into `size`-byte pieces, CRLF-framed — the hostile shape. */
function choppedSse(events: unknown[], size: number): { chunks: Uint8Array[]; body: string } {
  const body = `${events.map((event) => `data: ${JSON.stringify(event)}`).join('\r\n\r\n')}\r\n\r\ndata: [DONE]\r\n\r\n`;
  const bytes = new TextEncoder().encode(body);
  const chunks: Uint8Array[] = [];
  for (let at = 0; at < bytes.length; at += size) {
    chunks.push(bytes.subarray(at, at + size));
  }
  return { chunks, body };
}

function streamOf(
  chunks: readonly Uint8Array[],
  options: { cut?: boolean } = {},
): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller): void {
      for (const chunk of chunks) controller.enqueue(chunk);
      if (options.cut === true) {
        setTimeout(() => {
          controller.error(new Error('terminated'));
        }, 0);
        return;
      }
      controller.close();
    },
  });
}

function delta(content: string, finish?: string): unknown {
  return {
    id: 'chatcmpl-1',
    object: 'chat.completion.chunk',
    created: 0,
    model: 'llama-local',
    choices: [
      { index: 0, delta: { content }, ...(finish === undefined ? {} : { finish_reason: finish }) },
    ],
  };
}

async function collect(provider: OpenAICompatibleProvider): Promise<{
  text: string;
  error: ProviderError | null;
  result: GenerationResult | null;
}> {
  let text = '';
  try {
    const stream = provider.stream({ modelId: 'llama-local', messages, params: {} });
    let next = await stream.next();
    while (next.done !== true) {
      text += next.value.text;
      next = await stream.next();
    }
    return { text, error: null, result: next.value };
  } catch (error) {
    return { text, error: error as ProviderError, result: null };
  }
}

describe('recording a streamed exchange', () => {
  it('round-trips through the real adapter, byte for byte, with no secret on the tape', async () => {
    const { chunks } = choppedSse([delta('The rain '), delta('had not stopped.', 'stop')], 7);
    const { sink, next } = memorySink();
    const recorder = createCaptureRecorder({ sink, now: () => new Date('2026-08-26T00:00:00Z') });

    const recording = new OpenAICompatibleProvider({
      connection: connectionWith(),
      fetch: recorder.wrapFetch(
        () =>
          Promise.resolve(
            new Response(streamOf(chunks), {
              status: 200,
              headers: { 'content-type': 'text/event-stream' },
            }),
          ),
        connectionWith(),
      ),
    });

    const first = await collect(recording);
    const cassette = await next();

    // The adapter behind the recorder behaved exactly as it does without one.
    expect(first.error).toBeNull();
    expect(first.text).toBe('The rain had not stopped.');

    // Byte fidelity: same chunk count, same bytes per chunk — the boundaries
    // are part of the recording, because seven-byte splits mid-JSON are the
    // case the corpus exists to preserve. (No secret appears in this stream,
    // so no boundary was dissolved.)
    expect(cassette.meta).toMatchObject({ streaming: true, complete: true });
    const replayedBytes = cassette.response?.chunks.map((chunk) => Buffer.from(chunk, 'base64'));
    expect(replayedBytes?.length).toBe(chunks.length);
    for (const [index, chunk] of chunks.entries()) {
      expect(Buffer.compare(replayedBytes?.[index] ?? Buffer.alloc(0), Buffer.from(chunk))).toBe(0);
    }

    // The key is nowhere on the tape — not in headers, not in the serialised
    // whole, not hiding inside the base64.
    const serialised = JSON.stringify(cassette);
    expect(serialised).not.toContain(KEY);
    expect(replayedBytes?.some((chunk) => chunk.toString('utf8').includes(KEY))).toBe(false);
    // And the host is gone: the URL's path survives, the endpoint does not.
    expect(serialised).not.toContain('localhost:11434');
    expect(cassette.request.path).toBe('/v1/chat/completions');

    // Replay: a second, recorder-less adapter fed the cassette produces the
    // identical result — the format has one authority and no drift.
    const replaying = new OpenAICompatibleProvider({
      connection: connectionWith(),
      fetch: () => Promise.resolve(responseFromCassette(cassette)),
    });
    const second = await collect(replaying);
    expect(second.error).toBeNull();
    expect(second.text).toBe(first.text);
    expect(second.result?.finishReason).toBe(first.result?.finishReason);
  });

  it('files a partial cassette when the stream is cut, and the cut replays as a cut', async () => {
    const { chunks } = choppedSse([delta('Half a sen')], 7);
    // Drop [DONE]: the cut arrives before the stream ever finished.
    const partial = chunks.slice(0, Math.floor(chunks.length / 2));
    const { sink, next } = memorySink();
    const recorder = createCaptureRecorder({ sink });

    const recording = new OpenAICompatibleProvider({
      connection: connectionWith(),
      fetch: recorder.wrapFetch(
        () =>
          Promise.resolve(
            new Response(streamOf(partial, { cut: true }), {
              status: 200,
              headers: { 'content-type': 'text/event-stream' },
            }),
          ),
        connectionWith(),
      ),
    });

    const live = await collect(recording);
    const cassette = await next();

    // The live call failed the way a cut stream fails; the recording says so
    // rather than pretending the stream closed cleanly.
    expect(live.error).not.toBeNull();
    expect(cassette.meta.complete).toBe(false);
    expect(cassette.meta.truncated).toBe('stream-error');
    expect(cassette.response?.chunks.length).toBe(partial.length);

    // And the replay errors the same way — a cut that replayed as a clean end
    // would be the double lying again, with extra steps.
    const replaying = new OpenAICompatibleProvider({
      connection: connectionWith(),
      fetch: () => Promise.resolve(responseFromCassette(cassette)),
    });
    const replayed = await collect(replaying);
    expect(replayed.error).not.toBeNull();
  });

  it('redacts a key that arrives split across chunk boundaries', async () => {
    // The key inside an error body, chopped so fine every chunk holds a
    // fragment — a per-chunk scan sees nothing.
    const body = JSON.stringify({ error: { message: `Incorrect API key provided: ${KEY}` } });
    const bytes = new TextEncoder().encode(body);
    const chunks: Uint8Array[] = [];
    for (let at = 0; at < bytes.length; at += 5) chunks.push(bytes.subarray(at, at + 5));
    const { sink, next } = memorySink();
    const recorder = createCaptureRecorder({ sink });

    const wrapped = recorder.wrapFetch(
      () =>
        Promise.resolve(
          new Response(streamOf(chunks), {
            status: 401,
            headers: { 'content-type': 'application/json' },
          }),
        ),
      connectionWith(),
    );
    const response = await wrapped('http://localhost:11434/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${KEY}` },
      body: '{}',
    });
    // The caller still gets the untouched live body — redaction is for the tape.
    expect(await response.text()).toContain(KEY);

    const cassette = await next();
    const tape = JSON.stringify(cassette);
    expect(tape).not.toContain(KEY);
    const joined = (cassette.response?.chunks ?? [])
      .map((chunk) => Buffer.from(chunk, 'base64').toString('utf8'))
      .join('');
    expect(joined).toContain('[REDACTED-KEY]');
    // Boundaries survive except where the secret crossed them: fewer chunks
    // than arrived is allowed, one giant chunk is not.
    expect(cassette.response?.chunks.length).toBeGreaterThan(1);
  });
});

describe('recording the other shapes', () => {
  it('records a non-streaming error response without starving the failure reader', async () => {
    const { sink, next } = memorySink();
    const recorder = createCaptureRecorder({ sink });

    const provider = new OpenAICompatibleProvider({
      connection: connectionWith(),
      fetch: recorder.wrapFetch(
        () =>
          Promise.resolve(
            new Response(
              JSON.stringify({ error: { message: `Incorrect API key provided: ${KEY}` } }),
              {
                status: 401,
                headers: { 'content-type': 'application/json' },
              },
            ),
          ),
        connectionWith(),
      ),
    });

    // The SDK's failure handler reads the body too — a recorder that consumed
    // it would turn every classified failure into a parse error.
    await expect(
      provider.generate({ modelId: 'llama-local', messages, params: {} }),
    ).rejects.toMatchObject({ class: 'terminal' });

    const cassette = await next();
    expect(cassette.response?.status).toBe(401);
    expect(JSON.stringify(cassette)).not.toContain(KEY);
  });

  it('records a transport failure and rethrows it untouched', async () => {
    const { sink, next } = memorySink();
    const recorder = createCaptureRecorder({ sink });
    const boom = new TypeError(`connect ECONNREFUSED with ${KEY} in the message somehow`);

    const wrapped = recorder.wrapFetch(() => Promise.reject(boom), connectionWith());

    await expect(wrapped('http://localhost:11434/v1/models')).rejects.toBe(boom);

    const cassette = await next();
    expect(cassette.response).toBeNull();
    expect(cassette.transportError).toContain('[REDACTED-KEY]');
    expect(JSON.stringify(cassette)).not.toContain(KEY);
  });

  it('passes the abort signal through by identity', async () => {
    // The idle timeout and the Stop button compose a signal per attempt above
    // this seam; a recorder that substituted its own would break both.
    const { sink } = memorySink();
    const recorder = createCaptureRecorder({ sink });
    const controller = new AbortController();
    let seen: AbortSignal | null | undefined;

    const wrapped = recorder.wrapFetch((_input, init) => {
      seen = init?.signal;
      return Promise.resolve(new Response('{}', { status: 200 }));
    }, connectionWith());

    await wrapped('http://localhost:11434/v1/models', { signal: controller.signal });
    expect(seen).toBe(controller.signal);
  });

  it('records the same exchange to the same bytes, twice', async () => {
    const record = async (): Promise<string> => {
      const { sink, next, written } = memorySink();
      const recorder = createCaptureRecorder({
        sink,
        now: () => new Date('2026-08-26T00:00:00Z'),
      });
      const wrapped = recorder.wrapFetch(
        () => Promise.resolve(new Response('{"ok":true}', { status: 200 })),
        connectionWith(),
      );
      await (await wrapped('http://localhost:11434/v1/models')).text();
      await next();
      return [...written.entries()].map(([name, json]) => `${name}:${json}`).join('|');
    };

    // Determinism is what makes a re-record of an unchanged exchange an
    // unchanged file — without it every re-record is a spurious diff.
    expect(await record()).toBe(await record());
  });
});

describe('the redaction primitives', () => {
  it('replaces every occurrence with one fixed string', () => {
    expect(redactText(`a ${KEY} b ${KEY}`, [KEY])).toBe('a [REDACTED-KEY] b [REDACTED-KEY]');
  });

  it('keeps header names and drops every value not allowlisted', () => {
    const out = redactHeaders(
      {
        authorization: `Bearer ${KEY}`,
        'content-type': 'application/json',
        'openai-organization': 'org-1',
      },
      [KEY],
    );
    expect(out['content-type']).toBe('application/json');
    expect(out['authorization']).toBe('[redacted]');
    expect(out['openai-organization']).toBe('[redacted]');
  });
});
