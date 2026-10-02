// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { createServer } from 'node:http';

/**
 * ***An OpenAI-compatible endpoint that is not a model*** —
 * [testing §3.5](../docs/design/workplan/03-testing.md),
 * [testing §4.1](../docs/design/workplan/03-testing.md),
 * [P11 §3](../docs/design/workplan/28-p11-implementation.md)'s row 8.
 *
 * §3.5: *"Run against the fake provider (§4) so it is deterministic and free.
 * E2E that calls a real model is slow, flaky and expensive, and tests the model
 * rather than the app."*
 *
 * ***An HTTP double rather than an injected one, and that is the decision this
 * file is.*** The suite's `FakeProvider` is injected into a server the test
 * constructs; an end-to-end run has **no such seam and must not grow one** — a
 * shipped build that could be told to fake its own provider is a footgun in
 * every install, bought so a test could avoid writing forty lines of HTTP. So
 * the double sits where a real endpoint would, the server reaches it through the
 * adapter it always uses, and **nothing in `packages/server` knows this file
 * exists**.
 *
 * *What that buys beyond safety*: the journeys exercise the real
 * `openai-compatible` adapter — its request shape, its streaming reader, its
 * finish-reason mapping — which an injected double replaces wholesale.
 */

const PORT = Number(process.env['FAKE_PORT'] ?? 4599);

/** What it says when asked to narrate. Fixed, because a journey asserts it. */
const PROSE =
  'The rain had not stopped. Vera pushed the ledger across the desk and waited for an answer.';

/**
 * ***And every reply after the first says one thing more*** (2026-10-01).
 *
 * The journey branches with Redo and then steps between the two answers. Since
 * [P14.5](../docs/design/workplan/31-p14-scene-and-session-import.md) a chat
 * counts alternatives **by what they say** — two siblings with the same words
 * are one reply, and its counter shows nothing — so a double that answered a
 * Redo word for word had made the branch invisible, and the step that looks
 * for *2 of 2* could never pass. The asserted sentence stays in every reply;
 * what follows it is the call's number, so no two replies are the same.
 */
let replies = 0;
function prose() {
  replies += 1;
  return replies === 1 ? PROSE : `${PROSE} She had asked ${String(replies)} times now.`;
}

function chunk(text) {
  return `data: ${JSON.stringify({
    id: 'chatcmpl-fake',
    object: 'chat.completion.chunk',
    created: 0,
    model: 'fake-hi',
    choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
  })}\n\n`;
}

const server = createServer((request, response) => {
  if (request.url?.endsWith('/models') === true) {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ data: [{ id: 'fake-hi' }] }));
    return;
  }

  let body = '';
  request.on('data', (piece) => {
    body += String(piece);
  });
  request.on('end', () => {
    const wantsStream = body.includes('"stream":true');

    if (!wantsStream) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          id: 'chatcmpl-fake',
          object: 'chat.completion',
          created: 0,
          model: 'fake-hi',
          choices: [
            { index: 0, message: { role: 'assistant', content: PROSE }, finish_reason: 'stop' },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
        }),
      );
      return;
    }

    // **Two chunks and a terminator**, so the client's streaming reader is
    // exercised rather than bypassed: a single chunk would pass against a reader
    // that only ever handled the first one.
    response.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    const text = prose();
    const half = Math.ceil(text.length / 2);
    response.write(chunk(text.slice(0, half)));
    response.write(chunk(text.slice(half)));
    response.write(
      `data: ${JSON.stringify({
        id: 'chatcmpl-fake',
        object: 'chat.completion.chunk',
        created: 0,
        model: 'fake-hi',
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
      })}\n\n`,
    );
    response.end('data: [DONE]\n\n');
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`fake endpoint on http://127.0.0.1:${String(PORT)}/v1`);
});
