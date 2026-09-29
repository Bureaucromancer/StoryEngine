// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { base64TextChunk, makePng, withChunks } from '../storage/card/test-png.js';
import { makeTestServer, ownObjects, setUpAdmin, type TestServer } from '../test-server.js';
import { MemoryFileSource } from './memory-source.js';
import { PRESET_CONVERTERS } from './preset-converters.js';
import { convertChatCompletionPreset } from './sillytavern/preset.js';
import { sweep } from './sweep.js';

/**
 * ***A converter answers, whatever it was handed*** (2026-09-27) — the table
 * the sweep and the preview both reach the preset converters through.
 *
 * The converters are written to `parse.ts`'s rule, *a status, never a throw*,
 * and a prompt whose `content` was a number showed the rule is kept by care.
 * The sweep has no catch per file, so one throw took the folder import with
 * it. The converter is wrapped here so it can be made to throw the way that one
 * did, whatever the next missed field turns out to be.
 */
vi.mock('./sillytavern/preset.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./sillytavern/preset.js')>();
  return { ...actual, convertChatCompletionPreset: vi.fn(actual.convertChatCompletionPreset) };
});

let server: TestServer;

beforeEach(async () => {
  server = await makeTestServer();
  await setUpAdmin(server);
  vi.mocked(convertChatCompletionPreset).mockImplementationOnce(() => {
    throw new TypeError('template.replace is not a function');
  });
});

afterEach(async () => {
  vi.mocked(convertChatCompletionPreset).mockReset();
  await server.dispose();
});

const CHAT_PRESET = { prompts: [{ identifier: 'main', name: 'Main', content: 'You are.' }] };

describe('a converter that throws', () => {
  it('is a refusal of that file', () => {
    expect(PRESET_CONVERTERS['sillytavern.preset.chat']?.(CHAT_PRESET, 'Harbour')).toEqual({
      ok: false,
      refusal: 'wrong-shape',
    });
  });

  it('costs the sweep that one file, and the card beside it still lands', async () => {
    const card = withChunks(makePng(), [
      base64TextChunk('chara', { spec: 'chara_card_v2', data: { name: 'Vera Solano' } }),
    ]);
    const outcome = await sweep({
      library: server.services.library,
      handle: 'ned',
      tags: server.services.tags,
      files: new MemoryFileSource({ 'A.json': JSON.stringify(CHAT_PRESET), 'B.png': card }),
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const row = (source: string) => outcome.report.items.find((item) => item.source === source);
    // A refused conversion is a file this could not read as the thing it
    // claimed to be, and the note says which refusal.
    expect(row('A.json')).toMatchObject({
      disposition: 'unrecognised',
      notes: [{ key: 'import.file.refused', params: { refusal: 'wrong-shape' } }],
    });
    expect(row('B.png')?.disposition).toBe('converted');
    expect((await ownObjects(server, 'actors')).objects).toHaveLength(1);
  });
});
