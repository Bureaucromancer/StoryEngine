// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { Connection } from './connections.js';

/**
 * Records every provider exchange as a cassette — [P2C §2.2], and the machinery
 * gate step 6 depends on.
 *
 * **A manual phase whose output is a document is a phase that has to be run
 * again. The output that outlasts it is bytes** — and until this existed there
 * was nothing to capture the bytes *with*, so the first real exchanges this
 * project ever has would have evaporated as they happened. The adapter is
 * tested against hand-written stubs, and a stub agrees with whatever
 * understanding wrote it ([manual gate §4.1](../../../../docs/design/workplan/11-p2-manual-gate.md));
 * a cassette is the one artefact the double cannot invent.
 *
 * ## HTTP nouns, never domain nouns
 *
 * A cassette records what a provider **sent** — method, path, headers, status,
 * chunks. `FakeProvider`'s `ScriptedReply` describes what a provider *means*,
 * and reusing its vocabulary here would re-import exactly the confusion this
 * tier exists to end: the double defining the truth.
 *
 * ## Where it sits
 *
 * Below the SDK, at the adapter's own `fetch` seam — the same seam every
 * adapter test injects a stub through, which is what makes record and replay
 * two ends of one interface. Everything above (retry, classification, the
 * idle timeout) sees the live response untouched.
 *
 * ## What never reaches disk
 *
 * The connection's `apiKey`, anywhere it appears: the `Authorization` header
 * the SDK adds, the request body, and the *response* body — providers echo the
 * key they are refusing ("Incorrect API key provided: sk-…"), and a wrong-key
 * breakage is precisely one of the exchanges the phase wants recorded. The
 * URL's host and query go too: `baseUrl` may carry a token or name a private
 * host, and replay never needs it. Redaction is by exact-secret substitution
 * with fixed replacement strings — deterministic, so re-recording an unchanged
 * exchange produces an unchanged file.
 */

/** One exchange, verbatim minus secrets. `1` is the format's version. */
export interface Cassette {
  cassette: 1;
  meta: {
    recordedAt: string;
    provider: string;
    connectionId: string;
    /** By the response's own content type, not by what the caller wanted. */
    streaming: boolean;
    /** False when the stream ended without closing cleanly. */
    complete: boolean;
    truncated?: 'abort' | 'stream-error';
    /**
     * Written by a person at curation, never by the recorder — the assertions
     * the replay test makes about this exchange (finish reason, error class,
     * usage). A cassette without one replays; it just proves less.
     */
    expect?: unknown;
  };
  request: {
    method: string;
    /** Pathname only. The host is somebody's, and replay does not need it. */
    path: string;
    headers: Record<string, string>;
    body: string | null;
  };
  /** Null when the transport itself failed and nothing answered. */
  response: {
    status: number;
    statusText: string;
    headers: Record<string, string>;
    /**
     * Base64, one entry per chunk **as received** — the boundaries are part of
     * the recording. The adapter was validated against a response chopped into
     * seven-byte pieces that split JSON mid-object, and a cassette that merged
     * chunks could never reproduce the case. Base64 also keeps CRLF framing
     * out of git's `text=auto` normalisation without any `.gitattributes` rule.
     */
    chunks: string[];
  } | null;
  transportError?: string;
}

/** Where finished cassettes go. The fs half lives in `storage/captures.ts`. */
export interface CaptureSink {
  write(fileName: string, json: string): Promise<void>;
}

export interface CaptureRecorder {
  wrapFetch: (inner: typeof globalThis.fetch, connection: Connection) => typeof globalThis.fetch;
  /** Late-bound for the same reason the runner's is: services build before any logger exists. */
  setLogger: (log: { warn: (obj: object, msg: string) => void }) => void;
}

const REDACTED_KEY = '[REDACTED-KEY]';
const REDACTED_VALUE = '[redacted]';

/** Header values kept verbatim; everything else keeps its name and loses its value. */
const HEADER_ALLOWLIST = new Set(['content-type', 'accept', 'content-length']);

export function createCaptureRecorder(options: {
  sink: CaptureSink;
  now?: () => Date;
}): CaptureRecorder {
  const now = options.now ?? ((): Date => new Date());
  let log: { warn: (obj: object, msg: string) => void } | undefined;
  let sequence = 0;

  /**
   * Flush exactly once per exchange, and never throw: a recording failure must
   * not take the turn with it, but a silent one is missing cassettes
   * discovered at gate time — so it is a `warn`, the level the librarian's own
   * failures use.
   */
  const flush = (name: string, cassette: Cassette): void => {
    void options.sink
      .write(name, `${JSON.stringify(cassette, null, 2)}\n`)
      .catch((error: unknown) => {
        log?.warn(
          { event: 'capture.failed', file: name, message: messageOf(error) },
          'A provider exchange could not be recorded',
        );
      });
  };

  const wrapFetch = (
    inner: typeof globalThis.fetch,
    connection: Connection,
  ): typeof globalThis.fetch => {
    const secrets = connection.apiKey === undefined ? [] : [connection.apiKey];

    return async (input, init) => {
      const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
      const seq = String(sequence++).padStart(3, '0');
      const stamp = now().toISOString().replace(/[:.]/g, '-').replace(/Z$/, '');

      const request: Cassette['request'] = {
        method: init?.method ?? 'GET',
        path: url.pathname,
        headers: redactHeaders(init?.headers, secrets),
        body: typeof init?.body === 'string' ? redactText(init.body, secrets) : null,
      };

      const base: Omit<Cassette, 'response'> = {
        cassette: 1,
        meta: {
          recordedAt: now().toISOString(),
          provider: connection.provider,
          connectionId: connection.id,
          streaming: false,
          complete: false,
        },
        request,
      };

      const name = (suffix: string): string =>
        `${stamp}-${seq}-${connection.id.slice(-8)}-${suffix}.json`;

      let response: Response;
      try {
        response = await inner(input, init);
      } catch (error) {
        // The transport itself failed — half of gate step 4's breakages land
        // here. Recorded, and the original error propagates untouched.
        flush(name('transport'), {
          ...base,
          response: null,
          transportError: redactText(messageOf(error), secrets),
        });
        throw error;
      }

      const streaming = (response.headers.get('content-type') ?? '').includes('text/event-stream');
      const responseMeta = {
        status: response.status,
        statusText: response.statusText,
        headers: redactHeaders(response.headers, secrets),
      };

      if (response.body === null) {
        flush(name(String(response.status)), {
          ...base,
          meta: { ...base.meta, streaming, complete: true },
          response: { ...responseMeta, chunks: [] },
        });
        return response;
      }

      /**
       * **Teed, and the recorder's branch pumped eagerly.** The SDK consumes
       * its branch exactly once; the pump below starts before this function
       * returns and is never awaited, because `tee()` buffers for the slower
       * reader and a recorder that waited for the SDK to finish would hold the
       * whole response in memory — or, worse, never drain and stall the SDK's
       * branch through backpressure.
       *
       * Cancellation needs no forwarding: when the caller aborts, the fetch
       * signal tears down the source, both branches' reads reject, and the
       * pump's catch files a **partial** cassette. The mid-stream cut is one
       * of the five breakages the phase deliberately performs, and a partial
       * cassette is its recording — not a failure of the recorder.
       */
      const [toCaller, toRecorder] = response.body.tee();

      void (async (): Promise<void> => {
        const chunks: Uint8Array[] = [];
        let truncated: 'abort' | 'stream-error' | undefined;
        const reader = toRecorder.getReader();
        try {
          for (;;) {
            const next = await reader.read();
            if (next.done) break;
            chunks.push(next.value as Uint8Array);
          }
        } catch (error) {
          truncated = isAbort(error) ? 'abort' : 'stream-error';
        }

        flush(name(`${String(response.status)}${truncated === undefined ? '' : '-partial'}`), {
          ...base,
          meta: {
            ...base.meta,
            streaming,
            complete: truncated === undefined,
            ...(truncated === undefined ? {} : { truncated }),
          },
          response: { ...responseMeta, chunks: encodeChunks(chunks, secrets) },
        });
      })();

      return new Response(toCaller, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    };
  };

  return {
    wrapFetch,
    setLogger(next): void {
      log = next;
    },
  };
}

/**
 * The player — in the same module as the recorder so one file owns the format
 * from both directions, and drift between them is a merge conflict rather
 * than a mystery at replay time.
 *
 * One decoded chunk per recorded chunk, boundaries intact: replaying a stream
 * that arrived in seven-byte pieces means *erroring the same way it did*, and
 * an incomplete cassette errors instead of closing — a cut stream that
 * replayed as a clean end would be the double lying again, with extra steps.
 */
export function responseFromCassette(cassette: Cassette): Response {
  if (cassette.response === null) {
    throw new Error('This cassette recorded a transport failure; throw, do not respond.');
  }
  const recorded = cassette.response;

  const body = new ReadableStream<Uint8Array>({
    start(controller): void {
      for (const chunk of recorded.chunks) {
        controller.enqueue(Uint8Array.from(Buffer.from(chunk, 'base64')));
      }
      if (cassette.meta.complete) {
        controller.close();
      } else {
        controller.error(new Error('terminated'));
      }
    },
  });

  return new Response(body, {
    status: recorded.status,
    statusText: recorded.statusText,
    headers: recorded.headers,
  });
}

/**
 * Exact-secret substitution, not pattern guessing. The wrapper holds the
 * connection's real key, so there is nothing to guess: every occurrence
 * becomes one fixed string, and a re-record of an unchanged exchange is an
 * unchanged file.
 */
export function redactText(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const secret of secrets) {
    if (secret.length === 0) continue;
    out = out.split(secret).join(REDACTED_KEY);
  }
  return out;
}

/**
 * Names kept, values dropped unless allowlisted — the *shape* of the exchange
 * survives (which headers travelled) without any value that could identify a
 * person or an account. `authorization` would be caught by the exact-secret
 * pass anyway; dropping every non-allowlisted value also covers the ones
 * nobody thought of: `openai-organization`, `set-cookie`, rate-limit state.
 */
export function redactHeaders(
  headers: RequestInit['headers'] | Headers | undefined,
  secrets: readonly string[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [rawName, value] of new Headers(headers ?? {})) {
    const lower = rawName.toLowerCase();
    out[lower] = HEADER_ALLOWLIST.has(lower) ? redactText(value, secrets) : REDACTED_VALUE;
  }
  return out;
}

/**
 * Redaction and encoding happen **on bytes, not strings** — two invariants
 * force it. A chunk boundary can split a multi-byte UTF-8 codepoint, and a
 * per-chunk decode would replace both halves with U+FFFD and quietly corrupt
 * the recording of every emoji a model streams. And a key can arrive split
 * across chunks, invisible to any per-chunk scan.
 *
 * So: concatenate, find every secret occurrence in the whole byte stream,
 * dissolve only the boundaries that fall *inside* a match, splice the
 * replacement bytes, and re-slice at the surviving boundaries. **Boundaries
 * are preserved except where a secret crossed one** — the invariant, stated
 * once. Everything a secret did not touch round-trips byte for byte.
 */
function encodeChunks(chunks: readonly Uint8Array[], secrets: readonly string[]): string[] {
  if (chunks.length === 0) return [];
  const total = Buffer.concat(chunks);

  // Original boundary positions, exclusive of 0 and the end.
  const boundaries: number[] = [];
  let offset = 0;
  for (const chunk of chunks.slice(0, -1)) {
    offset += chunk.length;
    boundaries.push(offset);
  }

  // Every occurrence of every secret, as byte ranges in the concatenation.
  const matches: { start: number; end: number }[] = [];
  for (const secret of secrets) {
    if (secret.length === 0) continue;
    const needle = Buffer.from(secret, 'utf8');
    let from = 0;
    for (;;) {
      const at = total.indexOf(needle, from);
      if (at === -1) break;
      matches.push({ start: at, end: at + needle.length });
      from = at + 1;
    }
  }
  matches.sort((a, b) => a.start - b.start);

  const replacement = Buffer.from(REDACTED_KEY, 'utf8');
  const kept = boundaries.filter(
    (at) => !matches.some((match) => at > match.start && at < match.end),
  );

  // Splice the replacements, mapping each surviving boundary to its new
  // position as the lengths shift.
  const pieces: Buffer[] = [];
  const moved: number[] = [];
  let read = 0;
  let delta = 0;
  let next = 0;
  for (const match of matches) {
    if (match.start < read) continue; // overlapping occurrence, already gone
    for (;;) {
      const boundary = kept[next];
      if (boundary === undefined || boundary > match.start) break;
      moved.push(boundary + delta);
      next += 1;
    }
    pieces.push(total.subarray(read, match.start), replacement);
    delta += replacement.length - (match.end - match.start);
    read = match.end;
  }
  for (const boundary of kept.slice(next)) {
    moved.push(boundary + delta);
  }
  pieces.push(total.subarray(read));
  const redacted = Buffer.concat(pieces);

  const out: string[] = [];
  let start = 0;
  for (const at of moved) {
    out.push(redacted.subarray(start, at).toString('base64'));
    start = at;
  }
  out.push(redacted.subarray(start).toString('base64'));
  return out;
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || /abort/i.test(error.message));
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
