// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ImportPreview, ImportPreviewPreset } from '@storyengine/shared';

import { FORWARDED_SAMPLER_PARAMS } from '../providers/forwarded-params.js';
import { makeTestServer, setUpAdmin, type TestServer } from '../test-server.js';

import { malformedInputs } from './parse.js';
import { previewOne } from './preview.js';
import { readUpload } from './upload.js';

/**
 * What a commit would do, worked out without doing it
 * ([10 §5](../../../../docs/design/10-ui-surfaces.md), as amended).
 *
 * **The first describe is the whole feature and the rest is presentation.**
 * Everything about a preview that a person can see — the block list, the params,
 * the losses — is worth having only if the negative claim holds, and the
 * negative claim is exactly what a later convenience costs without anybody
 * noticing. So it is asserted first, loudest, and over the library, the job
 * ledger and the index rather than over a return value.
 */

let server: TestServer;

beforeEach(async () => {
  server = await makeTestServer();
  await setUpAdmin(server);
});

afterEach(async () => {
  await server.dispose();
});

const FORWARDED: ReadonlySet<string> = new Set<string>(FORWARDED_SAMPLER_PARAMS);

/** The fixture's own preset, near enough — a marker, a text block, a depth. */
const PRESET = {
  // Unconsumed by the converter, so it is what `compat` ends up holding — which
  // is what makes the names-never-values case below assert something.
  chat_completion_source: 'openai',
  openai_model: 'gpt-4',
  openai_max_context: 8192,
  openai_max_tokens: 512,
  temperature: 0.9,
  frequency_penalty: 0.1,
  reverse_proxy: 'https://example.invalid/v1',
  proxy_password: 'this must never reach disk',
  prompts: [
    { identifier: 'main', name: 'Main Prompt', role: 'system', content: 'Write the scene.' },
    { identifier: 'charDescription', name: 'Char Description', marker: true },
    { identifier: 'chatHistory', name: 'Chat History', marker: true },
    {
      identifier: 'atDepth4',
      name: 'A note four messages back',
      role: 'system',
      content: 'Keep the rain in frame.',
      injection_position: 1,
      injection_depth: 4,
      injection_order: 100,
    },
  ],
  prompt_order: [
    {
      character_id: 100000,
      order: [
        { identifier: 'main', enabled: true },
        { identifier: 'charDescription', enabled: true },
        { identifier: 'chatHistory', enabled: true },
        { identifier: 'atDepth4', enabled: false },
      ],
    },
  ],
};

async function preview(body: unknown, filename = 'Harbour.json'): Promise<ImportPreview> {
  const bytes = new TextEncoder().encode(JSON.stringify(body));
  const read = readUpload(filename, bytes);
  if (read.outcome !== 'candidate') throw new Error('not a candidate');

  return previewOne({
    library: server.services.library,
    handle: 'ned',
    filename,
    candidate: read.candidate,
    forwarded: FORWARDED,
  });
}

/** Narrows to the preset arm, so a case does not have to keep re-checking. */
function presetOf(answer: ImportPreview): ImportPreviewPreset {
  if (answer.object?.kind !== 'preset') {
    throw new Error(`expected a preset summary, got ${String(answer.object?.kind)}`);
  }
  return answer.object;
}

async function presets(): Promise<unknown[]> {
  const listed = await server.request({ method: 'GET', url: '/api/library/presets' });
  return listed.body.objects as unknown[];
}

async function jobs(): Promise<unknown[]> {
  const listed = await server.request({ method: 'GET', url: '/api/import/jobs' });
  return listed.body.jobs as unknown[];
}

describe('a preview writes nothing', () => {
  it('leaves the library, the ledger and the index exactly as they were', async () => {
    expect(await presets()).toHaveLength(0);

    const answer = await preview(PRESET);

    // It answered — this is not passing because nothing happened at all.
    expect(presetOf(answer).name).toBe('Harbour');
    expect(await presets()).toHaveLength(0);
    expect(await jobs()).toHaveLength(0);
  });

  it('writes nothing for a file it refuses either', async () => {
    await preview({ prompts: [], content: 'x' }).catch(() => null);

    expect(await presets()).toHaveLength(0);
  });

  it('can be asked twice and still writes nothing', async () => {
    // The re-import question reads the index and compares encodings. A version
    // of `identify` that stored what it compared would pass every assertion
    // above and fail this one.
    await preview(PRESET);
    await preview(PRESET);

    expect(await presets()).toHaveLength(0);
  });
});

describe('what the preview says about a preset', () => {
  it('names it after the file, which is what the import will call it', async () => {
    expect(presetOf(await preview(PRESET, 'Harbour.json')).name).toBe('Harbour');
    expect(presetOf(await preview(PRESET, 'nested/Deep Sea.json')).name).toBe('Deep Sea');
  });

  it('lists the blocks in the order the prompt order gives them', async () => {
    const { blocks } = presetOf(await preview(PRESET));

    expect(blocks.map((block) => block.id)).toEqual([
      'st.main',
      'st.charDescription',
      'st.chatHistory',
      'st.atDepth4',
    ]);
  });

  it('says what each slot fills, and what a text block is', async () => {
    const blocks = presetOf(await preview(PRESET)).blocks;
    const byId = new Map(blocks.map((block) => [block.id, block]));

    expect(byId.get('st.main')?.kind).toBe('text');
    expect(byId.get('st.main')?.fills).toBeUndefined();
    // The `of` and nothing more: a person deciding whether to keep a preset is
    // asking what goes in the hole, not which section id fills it.
    expect(byId.get('st.charDescription')?.fills).toBe('actor');
    expect(byId.get('st.chatHistory')?.fills).toBe('history');
  });

  it('keeps a depth-injected block at its depth, in messages', async () => {
    const depth = presetOf(await preview(PRESET)).blocks.find((b) => b.id === 'st.atDepth4');

    expect(depth?.at).toBe('in-history');
    expect(depth?.fromEnd).toBe(4);
  });

  it('carries a disabled block through as disabled rather than dropping it', async () => {
    // The preview has to show what the import will store, and a block the source
    // turned off is stored turned off. Hiding it would make the block count
    // disagree with the object.
    const depth = presetOf(await preview(PRESET)).blocks.find((b) => b.id === 'st.atDepth4');

    expect(depth?.enabled).toBe(false);
  });

  it('reports the context ceiling and the model wish', async () => {
    const summary = presetOf(await preview(PRESET));

    expect(summary.maxContextTokens).toBe(8192);
    expect(summary.preferredModelIds).toEqual(['gpt-4']);
  });

  it('passes every note the converter emitted through unchanged', async () => {
    const keys = (await preview(PRESET)).notes.map((note) => note.key);

    expect(keys).toContain('import.preset.credentialsRemoved');
    expect(keys).toContain('import.preset.paramsCarried');
  });
});

describe('the preview never shows what was in the file', () => {
  /**
   * **The rule that keeps this from being the *"import as-is"* affordance
   * [04 §8.4.4] refuses to have anywhere.** A screen that showed the file's
   * contents would show a proxy password to whoever was handed the file.
   */
  it('names the compat fields and carries none of their values', async () => {
    const answer = await preview(PRESET);
    const summary = presetOf(answer);

    expect(summary.compatKeys).toContain('chat_completion_source');
    // Asserted over the whole serialised answer rather than field by field: the
    // claim is that no route carries the value, not that one named field does
    // not.
    expect(JSON.stringify(answer)).not.toContain('this must never reach disk');
    expect(JSON.stringify(answer)).not.toContain('example.invalid');
    expect(summary.compatKeys).not.toContain('proxy_password');
    expect(summary.compatKeys).not.toContain('reverse_proxy');
  });

  it('says the credential was removed, by name', async () => {
    const removed = (await preview(PRESET)).notes.find(
      (note) => note.key === 'import.preset.credentialsRemoved',
    );

    expect(removed?.params['fields']).toBe('reverse_proxy, proxy_password');
  });
});

describe('which sampler settings would reach a model', () => {
  it('marks the ones this build forwards', async () => {
    const params = presetOf(await preview(PRESET)).params;
    const byName = new Map(params.map((param) => [param.name, param]));

    expect(byName.get('temperature')).toEqual({
      name: 'temperature',
      value: 0.9,
      reaches: true,
    });
    expect(byName.get('maxTokens')?.reaches).toBe(true);
  });

  it('marks the ones it does not, and says so once, naming them', async () => {
    const answer = await preview({ ...PRESET, top_a: 0.1, min_p: 0.05, top_k: 40 });
    const byName = new Map(presetOf(answer).params.map((param) => [param.name, param]));

    expect(byName.get('topA')?.reaches).toBe(false);
    expect(byName.get('minP')?.reaches).toBe(false);
    // The nastiest of the five: `toSdkParams` passes `topK` and the SDK drops it.
    expect(byName.get('topK')?.reaches).toBe(false);

    const advisory = answer.advisories.find(
      (note) => note.key === 'import.preset.samplerNotForwarded',
    );
    expect(advisory?.level).toBe('warn');
    expect(advisory?.params['count']).toBe(3);
    expect(String(advisory?.params['fields'])).toContain('minP');
  });

  it('says nothing when everything carried reaches a model', async () => {
    // A note that fires on every import is a note people stop reading.
    expect((await preview(PRESET)).advisories).toEqual([]);
  });

  it('keeps the advisory out of the notes, because the two have different lifetimes', async () => {
    const answer = await preview({ ...PRESET, min_p: 0.05 });

    // A note is about the file and stays true. An advisory is about this build
    // and would start lying on an upgrade, so it must never reach a stored
    // report — which it cannot if it is never in `notes`.
    expect(answer.notes.map((note) => note.key)).not.toContain('import.preset.samplerNotForwarded');
  });
});

describe('whether this file has been here before', () => {
  /** The real commit, through the real route, because that is what it will be. */
  async function commit(body: unknown, filename = 'Harbour.json'): Promise<void> {
    const boundary = '----storyenginePreviewBoundary';
    const payload = [
      `--${boundary}`,
      `Content-Disposition: form-data; name="file"; filename="${filename}"`,
      'Content-Type: application/json',
      '',
      JSON.stringify(body),
      `--${boundary}--`,
      '',
    ].join('\r\n');

    const response = await server.request({
      method: 'POST',
      url: '/api/import/file',
      payload,
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    });
    if (response.status >= 400) throw new Error(`import failed: ${String(response.status)}`);
  }

  it('is new before anything has been imported', async () => {
    expect((await preview(PRESET)).reimport).toBe('new');
  });

  it('is unchanged when the same file has already landed', async () => {
    await commit(PRESET);

    const answer = await preview(PRESET);

    expect(answer.reimport).toBe('unchanged');
    // And the disposition predicts what the commit would report, rather than
    // claiming a fresh import.
    expect(answer.disposition).toBe('unchanged');
  });

  it('is changed when the file has moved on', async () => {
    await commit(PRESET);

    const answer = await preview({ ...PRESET, temperature: 0.4 });

    expect(answer.reimport).toBe('changed');
    expect(answer.disposition).toBe('converted');
  });

  it('is new again under a different filename, because identity is the filename', async () => {
    await commit(PRESET);

    expect((await preview(PRESET, 'Elsewhere.json')).reimport).toBe('new');
  });
});

describe('a file the preview cannot summarise', () => {
  it('answers for a card without pretending to know the rest', async () => {
    // Cards convert and have no summary shape yet. The flow is the same — a
    // look, then a word — and `unknown` is an answer rather than a guess.
    const answer = await preview({ name: 'Vera', first_mes: 'Hello.' }, 'Vera.json');

    expect(answer.object).toEqual({ kind: 'opaque', name: 'Vera' });
    expect(answer.reimport).toBe('unknown');
  });
});

describe('a status, never a throw', () => {
  /**
   * `parse.ts`'s rule, extended to the new door. The preview is a second entry
   * onto the same converters, so every shape they survive it must survive too —
   * and a preview that throws is a 500 on a screen whose whole purpose is to be
   * safe to press.
   */
  for (const { label, input } of malformedInputs(PRESET, ['prompts'])) {
    it(`answers for ${label}`, async () => {
      const bytes = new TextEncoder().encode(JSON.stringify(input));
      const read = readUpload('Harbour.json', bytes);
      if (read.outcome !== 'candidate') return;

      const answer = await previewOne({
        library: server.services.library,
        handle: 'ned',
        filename: 'Harbour.json',
        candidate: read.candidate,
        forwarded: FORWARDED,
      });

      expect(answer.source).toBe('Harbour.json');
      expect(await presets()).toHaveLength(0);
    });
  }
});
