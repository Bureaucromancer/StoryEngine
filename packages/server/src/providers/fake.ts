// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { capabilitiesFor } from './capabilities.js';
import {
  ProviderError,
  type ErrorClass,
  type FinishReason,
  type GenerationChunk,
  type GenerationRequest,
  type GenerationResult,
  type Provider,
  type ProviderCapabilities,
} from './types.js';

/**
 * The scripted provider — [testing §4.1](../../../../docs/design/workplan/10-testing.md),
 * [P2 §2.8](../../../../docs/design/workplan/04-p2-implementation.md).
 *
 * **Built beside the first real adapter, not after it.** It is three things at
 * once: the golden-file harness (because it records every request), the E2E
 * backend, and the only way to test deterministically the paths that are
 * hardest to trigger for real —
 *
 * - malformed structured output and the bounded re-ask loop;
 * - provider errors, rate limits, timeouts, **mid-stream disconnection**;
 * - a step failing without failing the turn;
 * - and, from P2.5, reattaching to a turn whose stream is still running.
 *
 * The capabilities are settable, which is what makes *degradation* testable:
 * a provider with `supportsStructuredOutput: false` is not a hypothetical to
 * reason about, it is two lines of setup.
 */

/** One scripted reply. Whatever is not set falls back to the defaults below. */
export interface ScriptedReply {
  /** The text to answer with, streamed in `chunks` pieces if streaming. */
  text?: string;
  /** Structured output, when the caller asked for it. */
  object?: unknown;
  usage?: { promptTokens: number; completionTokens: number } | null;
  cost?: { amount: number; currency: string } | null;
  /**
   * Fail instead of answering.
   *
   * `detail` is the endpoint's own words, which a real provider carries and a
   * double that could not would let the log-shape tests pass over a system that
   * drops them.
   */
  error?: { class: ErrorClass; message: string; detail?: string };
  /** The model the endpoint says answered, when it is not the one asked for. */
  answeredAs?: string;
  /** Why generation stopped. Defaults to a clean `stop`. */
  finishReason?: FinishReason;
  /**
   * Fail *after* streaming this many chunks — mid-stream disconnection, which
   * is otherwise the hardest real failure to reproduce on purpose.
   */
  failAfterChunks?: number;
  /** How many pieces to stream the text in. One means a single chunk. */
  chunks?: number;
  /**
   * Milliseconds to wait between chunks — **the seam that makes "mid-stream"
   * mean anything.**
   *
   * Without it this generator has no `await` between `yield`s, so the entire
   * stream drains inside one macrotask: measured, forty chunks in under a
   * millisecond, before a `setTimeout(…, 0)` scheduled beforehand ever ran. That
   * is not a fast double, it is a double with no *time* in it — a test that
   * cancels "mid-stream", or asserts that a coalescing window fired, or kills a
   * server "mid-generation", has no window in which to act and passes or fails
   * for reasons unrelated to what it claims.
   *
   * Left at zero by default so existing tests keep their timing.
   */
  chunkDelayMs?: number;
  /**
   * Distinguishes *the provider reported nothing* from *this script says
   * nothing about usage*.
   *
   * `usage: null` and an absent `usage` are different claims — the first is what
   * a provider that does not report tokens actually returns, and the record is
   * required to keep it as null rather than synthesise a number ([13 §1.4]).
   * Optional-with-a-null-member cannot express that on its own, so this says it.
   */
  reportsNoUsage?: true;
}

export interface FakeProviderOptions {
  /** Replies, consumed in order. The last one repeats once they run out. */
  script?: ScriptedReply[];
  capabilities?: Partial<ProviderCapabilities>;
}

/** A request exactly as it arrived, for a golden file to snapshot. */
export interface RecordedRequest {
  modelId: string;
  messages: GenerationRequest['messages'];
  params: GenerationRequest['params'];
  schema: object | undefined;
  streamed: boolean;
}

const DEFAULT_REPLY: Required<Pick<ScriptedReply, 'text' | 'chunks'>> = {
  text: 'The rain had not stopped for three days.',
  chunks: 1,
};

export class FakeProvider implements Provider {
  readonly kind = 'fake';
  readonly capabilities: ProviderCapabilities;

  /**
   * Every request this provider received, in order.
   *
   * Public and deliberately not a copy: a golden-file test snapshots this
   * directly, and a test that has to ask for its own recording through a getter
   * is one indirection away from asserting nothing.
   */
  readonly requests: RecordedRequest[] = [];

  #script: ScriptedReply[];
  #calls = 0;

  constructor(options: FakeProviderOptions = {}) {
    this.capabilities = capabilitiesFor('fake', options.capabilities ?? {});
    this.#script = options.script ?? [];
  }

  /** Replaces the script mid-test — a retry that succeeds after a failure. */
  setScript(script: ScriptedReply[]): void {
    this.#script = script;
    this.#calls = 0;
  }

  /*
   * eslint-disable-next-line @typescript-eslint/require-await -- async by
   * interface: a real provider awaits a network call, and the double must have
   * the same shape, or every caller's timing changes under test.
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  async generate(request: GenerationRequest): Promise<GenerationResult> {
    const reply = this.#next(request, false);
    if (reply.error) {
      throw new ProviderError(reply.error.class, reply.error.message, reply.error.detail);
    }
    return this.#result(reply, request);
  }

  async *stream(
    request: GenerationRequest,
  ): AsyncGenerator<GenerationChunk, GenerationResult, undefined> {
    const reply = this.#next(request, true);
    if (reply.error && reply.failAfterChunks === undefined) {
      throw new ProviderError(reply.error.class, reply.error.message, reply.error.detail);
    }

    const text = reply.text ?? DEFAULT_REPLY.text;
    const pieces = splitInto(text, reply.chunks ?? DEFAULT_REPLY.chunks);

    for (const [index, piece] of pieces.entries()) {
      // **The signal is honoured here, not only by the caller.** A real adapter
      // passes it to `fetch` and the request dies at the socket; a double that
      // ignored it would leave the whole abort path — the one a user's Stop
      // button rides on — shipped and never exercised.
      if (request.signal?.aborted === true) {
        throw new ProviderError('transient', 'The request was aborted.');
      }
      if (reply.chunkDelayMs !== undefined && reply.chunkDelayMs > 0 && index > 0) {
        await new Promise((tick) => setTimeout(tick, reply.chunkDelayMs));
      }
      if (reply.failAfterChunks !== undefined && index >= reply.failAfterChunks) {
        // Mid-stream disconnection: the caller has already been handed text,
        // and now the stream ends without a result. Everything downstream has
        // to cope with a partial answer rather than with nothing.
        throw new ProviderError(
          reply.error?.class ?? 'transient',
          reply.error?.message ?? 'The stream ended early.',
        );
      }
      yield { text: piece };
    }

    return this.#result(reply, request);
  }

  #next(request: GenerationRequest, streamed: boolean): ScriptedReply {
    this.requests.push({
      modelId: request.modelId,
      messages: request.messages,
      params: request.params,
      schema: request.schema,
      streamed,
    });

    const index = Math.min(this.#calls, Math.max(this.#script.length - 1, 0));
    this.#calls += 1;
    return this.#script[index] ?? {};
  }

  #result(reply: ScriptedReply, request: GenerationRequest): GenerationResult {
    return {
      text: reply.text ?? DEFAULT_REPLY.text,
      // Honest about the capability: a provider that says it does not report
      // usage must not report it, or the budgeter is tested against a world
      // that does not exist.
      usage:
        this.capabilities.reportsUsage && reply.reportsNoUsage !== true
          ? (reply.usage ?? { promptTokens: 0, completionTokens: 0 })
          : null,
      cost: reply.cost ?? null,
      /**
       * **The fake answers as the model it was asked for**, and a script can say
       * otherwise. The real adapter reads what the endpoint reported, so a fake
       * that always echoed the request would agree with a bug rather than with
       * a provider — which is the failure mode a double exists to avoid.
       */
      modelId: reply.answeredAs ?? request.modelId,
      finishReason: reply.finishReason ?? 'stop',
      ...(reply.object === undefined ? {} : { object: reply.object }),
    };
  }
}

/** Splits text into `count` pieces without losing or reordering a character. */
function splitInto(text: string, count: number): string[] {
  if (count <= 1 || text.length === 0) return [text];

  const size = Math.ceil(text.length / count);
  const pieces: string[] = [];
  for (let at = 0; at < text.length; at += size) {
    pieces.push(text.slice(at, at + size));
  }
  return pieces;
}
