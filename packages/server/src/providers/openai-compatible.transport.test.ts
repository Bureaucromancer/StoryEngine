// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it, vi } from 'vitest';

import { OpenAICompatibleProvider } from './openai-compatible.js';

/**
 * ***A connection with no transport of its own goes through the patient one***
 * (2026-09-27).
 *
 * The adapter handed the SDK a `fetch` only when a test supplied one, so every
 * real call went through Node's global `fetch` and its five-minute limits.
 * What is pinned is the default: the module is replaced here so the call can
 * be seen reaching it, which no request against a real endpoint could show.
 * A file of its own because a module mock covers the whole file.
 */

const through = vi.hoisted(() => ({ calls: 0 }));

vi.mock('./patient-fetch.js', () => ({
  PATIENT_DISPATCH: { headersTimeout: 0, bodyTimeout: 0 },
  patientFetch: () => {
    through.calls += 1;
    return Promise.resolve(
      new Response(
        JSON.stringify({
          id: 'chatcmpl-1',
          object: 'chat.completion',
          created: 0,
          model: 'llama-local',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'Through the patient one.' },
              finish_reason: 'stop',
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
  },
}));

describe('the transport a connection gets by default', () => {
  it('is the patient fetch, not the global one', async () => {
    const provider = new OpenAICompatibleProvider({
      connection: {
        id: 'local',
        label: 'My laptop',
        provider: 'openai-compatible',
        scope: 'user',
        models: ['llama-local'],
        baseUrl: 'http://127.0.0.1:1/v1',
      },
    });

    const result = await provider.generate({
      modelId: 'llama-local',
      messages: [{ role: 'user', content: 'It is raining.', fromBlocks: ['b1'] }],
      params: {},
    });

    expect(through.calls).toBe(1);
    expect(result.text).toBe('Through the patient one.');
  });
});
