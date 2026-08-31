// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { openLocalSource } from '../storage/local-source.js';
import { base64TextChunk, makePng, withChunks } from '../storage/card/test-png.js';
import { makeTestServer, setUpAdmin, type TestServer } from '../test-server.js';
import { MemoryFileSource } from './memory-source.js';
import { sweep } from './sweep.js';

/**
 * **A folder of loose cards converts** — [P4 §7.8]'s repair
 * ([06 §7.8](../../../../docs/design/workplan/06-p4-implementation.md)).
 *
 * `classifyRoot` has always answered `loose-files` for a directory that matches
 * no probe, and `sweep.ts` has always handed it to the SillyTavern walker on the
 * reasoning that a folder somebody assembled by hand is the ST tree with most of
 * it missing. Nothing converted. The walker routes by top-level directory, so a
 * card at the root took the `default:` arm and came back `unrecognised` — with
 * an empty note list, so the review could not say why either.
 *
 * It went unnoticed because `detect.test.ts`'s case is named *"sweeps a folder
 * of loose cards rather than refusing it"* and asserts the classification alone.
 * A test that names a behaviour it does not check is worse than no test: it
 * spends the credibility without doing the work. This file is the behaviour.
 *
 * **The ST tree's own answers are asserted here too**, in the same file rather
 * than trusted to remain true elsewhere, because the repair works by making one
 * `switch` arm depend on which root it is walking — and the whole risk of that
 * shape is the two roots quietly converging.
 */

let server: TestServer;

beforeEach(async () => {
  server = await makeTestServer();
  await setUpAdmin(server);
});

afterEach(async () => {
  await server.dispose();
});

const VERA = {
  spec: 'chara_card_v2',
  spec_version: '2.0',
  data: {
    name: 'Vera Solano',
    description: 'A harbourmaster who has read every manifest twice.',
    first_mes: 'You are late.',
  },
};

const card = (): Uint8Array => withChunks(makePng(), [base64TextChunk('chara', VERA)]);

const BOOK = JSON.stringify({
  name: 'Harbour lore',
  entries: { '0': { uid: 0, key: ['tide'], content: 'The tide runs out at dusk.', order: 100 } },
});

async function run(tree: Record<string, Uint8Array | string>) {
  const outcome = await sweep({
    library: server.services.library,
    handle: 'ned',
    files: new MemoryFileSource(tree),
  });
  if (!outcome.ok) throw new Error(`refused: ${outcome.refusal}`);
  return outcome.report;
}

const count = async (kind: string): Promise<number> => {
  const listed = await server.request({ method: 'GET', url: `/api/library/${kind}` });
  return (listed.body.objects as unknown[]).length;
};

describe('a folder nobody arranged', () => {
  it('converts the cards in it', async () => {
    const report = await run({ 'Vera.png': card() });

    expect(report.source).toBe('loose-files');
    expect(report.items[0]?.disposition).toBe('converted');
    expect(await count('actors')).toBe(1);
  });

  it('converts a lorebook and a card sitting side by side', async () => {
    // The mixed folder is the realistic one: whatever was downloaded, in one
    // place, with no arrangement implied.
    await run({ 'Vera.png': card(), 'Harbour lore.json': BOOK });

    expect(await count('actors')).toBe(1);
    expect(await count('lorebooks')).toBe(1);
  });

  it('reaches cards in subfolders, which is how people actually file them', async () => {
    // `downloads/` is not a name the disposition table knows, so before the
    // repair this took the same silent `unrecognised` path as the root.
    await run({ 'downloads/august/Vera.png': card() });

    expect(await count('actors')).toBe(1);
  });

  it('still says why, for a file it cannot place', async () => {
    // The old behaviour's real cost was the empty note list. A folder of
    // holiday photos should come back explained, not merely refused.
    const report = await run({ 'holiday.png': makePng(), 'notes.txt': 'buy milk' });

    const picture = report.items.find((item) => item.source === 'holiday.png');
    expect(picture?.disposition).toBe('unrecognised');
    expect(picture?.notes[0]?.key).toBe('import.file.pictureWithoutACard');

    const text = report.items.find((item) => item.source === 'notes.txt');
    expect(text?.disposition).toBe('unrecognised');
    expect(text?.notes[0]?.key).toBe('import.file.unrecognised');
  });

  it('accounts for everything it saw, which is the claim that has to survive', async () => {
    // Dispositions as well as names: asserting the source list alone passes
    // unchanged against the pre-repair code, where all three were `unrecognised`
    // — which a review pointed out, and which is the failure mode this whole
    // file was written about.
    const report = await run({ 'Vera.png': card(), 'holiday.png': makePng(), 'a/b/note.txt': 'x' });

    const byName = new Map(report.items.map((item) => [item.source, item.disposition]));
    expect([...byName.keys()].sort()).toEqual(['Vera.png', 'a/b/note.txt', 'holiday.png']);
    expect(byName.get('Vera.png')).toBe('converted');
    expect(byName.get('holiday.png')).toBe('unrecognised');
    expect(byName.get('a/b/note.txt')).toBe('unrecognised');
  });

  it('does not let a SillyTavern directory name swallow a subfolder', async () => {
    /**
     * The repair's own first version contradicted its own comment: it said
     * position carries no information on a loose root, then consulted the
     * disposition table anyway. So `assets/`, `themes/`, `backgrounds/` and
     * twenty-seven other names SillyTavern happens to use silently skipped
     * everything inside them. In a folder nobody arranged they are just words.
     */
    await run({ 'backgrounds/Vera.png': card(), 'themes/Harbour lore.json': BOOK });

    expect(await count('actors')).toBe(1);
    expect(await count('lorebooks')).toBe(1);
  });

  it('reports a settings.json instead of swallowing it', async () => {
    // On a real tree the settings file is an input and deliberately not a row.
    // On a loose root it is an input to nothing, so swallowing it dropped a file
    // from the report — the one thing a sweep never does.
    const report = await run({ 'settings.json': '{"power_user":{}}' });

    expect(report.items.map((item) => item.source)).toEqual(['settings.json']);
    expect(report.items[0]?.disposition).toBe('unrecognised');
  });

  it('says why when it could not read the file at all', async () => {
    // A noteless `unrecognised` is the defect §7.8 exists to remove, and it came
    // straight back for anything the source refused to hand over — reachable now
    // that a file past `maxFileBytes` reads as null.
    const root = await mkdtemp(join(tmpdir(), 'se-unread-'));
    await writeFile(join(root, 'huge.bin'), Buffer.alloc(4096));
    const opened = await openLocalSource(root, join(tmpdir(), 'se-nowhere'), {
      maxFiles: 10,
      maxDepth: 4,
      maxFileBytes: 16,
    });
    if (!opened.ok) throw new Error('refused');

    const outcome = await sweep({
      library: server.services.library,
      handle: 'ned',
      files: opened.source,
    });
    if (!outcome.ok) throw new Error(`refused: ${outcome.refusal}`);

    expect(outcome.report.items[0]?.disposition).toBe('unrecognised');
    expect(outcome.report.items[0]?.notes[0]?.key).toBe('import.file.unreadable');
  });
});

describe('and a real SillyTavern tree is unaffected', () => {
  /**
   * The guard on the repair. `loose-files` asks the file; `sillytavern` asks the
   * table, and must keep asking it — [§1.8]'s *every name has a disposition* is
   * one checkable claim precisely because position decides it there.
   */
  const tree = (extra: Record<string, Uint8Array | string>) => ({
    'settings.json': '{}',
    'characters/Vera Solano.png': card(),
    'worlds/Harbour lore.json': BOOK,
    ...extra,
  });

  it('classifies as sillytavern and keeps converting by position', async () => {
    const report = await run(tree({}));

    expect(report.source).toBe('sillytavern');
    expect(await count('actors')).toBe(1);
    expect(await count('lorebooks')).toBe(1);
  });

  it('does not content-probe a directory the table already places', async () => {
    // `backgrounds/` is `skipped` in the registry — a wallpaper is not a thing
    // this library has a place for. A card dropped into it must
    // keep that answer rather than being imported because it happens to parse.
    const report = await run(tree({ 'backgrounds/Vera.png': card() }));

    const background = report.items.find((item) => item.source === 'backgrounds/Vera.png');
    expect(background?.disposition).toBe('skipped');
    expect(await count('actors')).toBe(1);
  });

  it('leaves an unknown directory unrecognised rather than guessing', async () => {
    // The arm the repair changed, on the root it did not change it for.
    const report = await run(tree({ 'plugins/Vera.png': card() }));

    const plugin = report.items.find((item) => item.source === 'plugins/Vera.png');
    expect(plugin?.disposition).toBe('unrecognised');
    expect(await count('actors')).toBe(1);
  });
});

describe('the hazards content-probing a loose folder opens', () => {
  /**
   * Both found by reviewing the repair rather than by writing it, and both are
   * about the same thing: on a loose root the `default:` arm decides whether a
   * file is *read*, so anything that used to be a cosmetic wrong answer there is
   * now a wrong answer with an I/O consequence.
   */

  it('does not let a name off Object.prototype skip the probe', async () => {
    // `SILLYTAVERN_DISPOSITIONS` is an object literal, so `TABLE['constructor']`
    // answers with a function. The old `?? 'unrecognised'` had the same hole and
    // it only cost a nonsense disposition; here it would also have refused to
    // read the file. `Object.hasOwn` is the whole fix.
    // A *directory* named `constructor`, not a file: `top` is the first path
    // segment, so `constructor.png` at the root never reaches the lookup. The
    // first version of this test used the file and passed against the bug.
    const report = await run({
      'constructor/Vera.png': card(),
      'toString/Harbour lore.json': BOOK,
    });

    for (const item of report.items) {
      expect(item.disposition, `${item.source} got the wrong disposition`).toBe('converted');
    }
    expect(await count('actors')).toBe(1);
    expect(await count('lorebooks')).toBe(1);
  });

  it('refuses to pull an enormous file into memory to guess at it', async () => {
    // Before the repair a walker only read files under directories it knew, all
    // of them small. A loose root has none, so the probe reads whatever is
    // there — and a folder somebody points at can hold a disc image.
    const root = await mkdtemp(join(tmpdir(), 'se-big-'));
    await writeFile(join(root, 'huge.bin'), Buffer.alloc(2048));
    await writeFile(join(root, 'small.bin'), Buffer.alloc(8));

    const opened = await openLocalSource(root, join(tmpdir(), 'se-nowhere'), {
      maxFiles: 10,
      maxDepth: 4,
      maxFileBytes: 1024,
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    expect(await opened.source.read('huge.bin')).toBeNull();
    expect(await opened.source.read('small.bin')).not.toBeNull();
    // Still listed, so the review can account for it — not read, so the server
    // survives it.
    const seen: string[] = [];
    for await (const path of opened.source.list()) seen.push(path);
    expect(seen.sort()).toEqual(['huge.bin', 'small.bin']);
  });
});

describe('a sweep does not guess the way an upload may', () => {
  /**
   * The distinction [P4 §7.8]'s review forced. Two of the probes key on a field
   * name rather than on a format — `{ content: "…" }` and
   * `{ temperature: 0.7 }` — and a review swept a folder of build config and
   * got `appsettings.json` imported as a preset whose system prompt was the
   * string it happened to have under `content`.
   */

  it('leaves ordinary config alone instead of importing it as a preset', async () => {
    const report = await run({
      'appsettings.json': JSON.stringify({
        Logging: { LogLevel: { Default: 'Information' } },
        content: 'hello',
      }),
      'readings.json': JSON.stringify({ city: 'Oslo', temperature: 21 }),
    });

    for (const item of report.items) expect(item.disposition).toBe('unrecognised');
    expect(await count('presets')).toBe(0);
  });

  it('still takes a chat preset, which names itself', async () => {
    // The three high-confidence probes are unaffected: a prompt manager, a world
    // file and a card each key on something only that format has.
    await run({
      'Harbour.json': JSON.stringify({
        prompts: [{ identifier: 'main', name: 'Main', role: 'system', content: 'You are.' }],
      }),
    });

    expect(await count('presets')).toBe(1);
  });

  it('but the upload route still takes the guessable ones', async () => {
    // The other half of the trade, asserted so that tightening the sweep does
    // not quietly tighten the upload: a person who picks a sampler panel out of
    // a file dialog gets it.
    const body = JSON.stringify({ temp: 0.7, top_p: 0.9 });
    const boundary = '----storyengineTestBoundary';
    const payload = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="sampler.json"',
      'Content-Type: application/json',
      '',
      body,
      `--${boundary}--`,
      '',
    ].join('\r\n');

    const response = await server.request({
      method: 'POST',
      url: '/api/import/file',
      payload,
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    });

    expect(response.body.item.disposition).toBe('converted');
    expect(await count('presets')).toBe(1);
  });
});
