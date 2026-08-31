// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { base64TextChunk, makePng, withChunks } from '../storage/card/test-png.js';
import { makeZip } from '../storage/test-zip.js';
import { makeTestServer, setUpAdmin, type TestServer } from '../test-server.js';
import { marinaraFixture } from './fixtures/test-marinara.js';
import { sillyTavernFixture } from './fixtures/test-sillytavern.js';

/**
 * Archives, end to end
 * ([P4 §7.5](../../../../docs/design/workplan/06-p4-implementation.md)).
 *
 * **One reader, three things closed.** §1.3 always said *an archive is a root
 * read through a different file source*, and until now that was a claim with one
 * half-example behind it. With `ZipFileSource` it is literal: a CHARX, the
 * Marinara profile archive P4.3 deferred, and a zip somebody made of their cards
 * folder are all roots, classified by the same probes and walked by the same
 * readers. None of the converters learns that an archive was involved.
 *
 * Asserted through the upload route rather than against the reader, deliberately:
 * what §7.5 recorded as missing was not a parser, it was *cards arriving*. The
 * unit-level refusals live in `storage/zip.test.ts`.
 */

let server: TestServer;

beforeEach(async () => {
  server = await makeTestServer();
  await setUpAdmin(server);
});

afterEach(async () => {
  await server.dispose();
});

const V3_CARD = {
  spec: 'chara_card_v3',
  spec_version: '3.0',
  data: {
    name: 'Vera Solano',
    description: 'A harbourmaster who has read every manifest twice.',
    first_mes: 'You are late.',
    mes_example: '<START>\n{{user}}: Morning.\n{{char}}: It is afternoon.',
  },
};

async function upload(filename: string, bytes: Uint8Array) {
  const boundary = '----storyengineTestBoundary';
  const head = Buffer.from(
    [
      `--${boundary}`,
      `Content-Disposition: form-data; name="file"; filename="${filename}"`,
      'Content-Type: application/octet-stream',
      '',
      '',
    ].join('\r\n'),
    'utf8',
  );
  const payload = Buffer.concat([
    head,
    Buffer.from(bytes),
    Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8'),
  ]);

  return server.request({
    method: 'POST',
    url: '/api/import/file',
    payload,
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  });
}

const count = async (kind: string): Promise<number> => {
  const listed = await server.request({ method: 'GET', url: `/api/library/${kind}` });
  return (listed.body.objects as unknown[]).length;
};

describe('a CHARX', () => {
  it('imports the card inside it', async () => {
    // The finding in one assertion: §1.3 and §1.10 both said this worked and it
    // did not exist.
    const charx = makeZip([
      { name: 'card.json', body: JSON.stringify(V3_CARD) },
      { name: 'assets/avatar.png', body: makePng() },
    ]);

    const response = await upload('Vera.charx', charx);

    expect(response.status).toBe(201);
    expect(response.body.item.disposition).toBe('converted');

    const listed = await server.request({ method: 'GET', url: '/api/library/actors' });
    expect(listed.body.objects.map((row: { name: string }) => row.name)).toContain('Vera Solano');
  });

  it('keeps the portrait that travelled with it', async () => {
    const charx = makeZip([
      { name: 'card.json', body: JSON.stringify(V3_CARD) },
      { name: 'assets/avatar.png', body: makePng() },
    ]);
    await upload('Vera.charx', charx);

    const listed = await server.request({ method: 'GET', url: '/api/library/actors' });
    const id = (listed.body.objects as { id: string }[])[0]?.id ?? '';
    const actor = await server.request({ method: 'GET', url: `/api/library/actors/${id}` });

    // The pixels ride along as they do off a card PNG — the point of carrying
    // `assets` rather than only the card body.
    expect(JSON.stringify(actor.body)).toContain('portrait');
  });

  it('imports a card with no assets at all, which the spec allows', async () => {
    // The probe requires `card.json` and deliberately not `assets/`: requiring
    // the directory would refuse the simplest valid archive.
    const response = await upload(
      'Bare.charx',
      makeZip([{ name: 'card.json', body: JSON.stringify(V3_CARD) }]),
    );

    expect(response.status).toBe(201);
    expect(await count('actors')).toBe(1);
  });

  it('says so when the card inside is not readable', async () => {
    const response = await upload(
      'Broken.charx',
      makeZip([{ name: 'card.json', body: 'not json at all' }]),
    );

    expect(response.body.item.disposition).not.toBe('converted');
    expect(response.body.notes.map((n: { key: string }) => n.key)).toContain('import.file.notJson');
  });
});

describe('a zipped folder', () => {
  it('sweeps a Marinara data root, which is the archive form P4.3 deferred', async () => {
    // "The zip form of the profile archive, which needs a zip reader plus §1.3's
    // bounds" — recorded as deferred at P4.3, and free once the reader exists.
    const tree = marinaraFixture();
    const zip = makeZip(Object.entries(tree).map(([name, body]) => ({ name, body })));

    const response = await upload('marinara-backup.zip', zip);

    expect(response.status).toBe(201);
    expect(await count('actors')).toBeGreaterThan(0);
  });

  it('sweeps a SillyTavern tree somebody zipped', async () => {
    const zip = makeZip(
      Object.entries(sillyTavernFixture()).map(([name, body]) => ({ name, body })),
    );

    await upload('sillytavern.zip', zip);

    expect(await count('actors')).toBeGreaterThan(0);
    expect(await count('presets')).toBeGreaterThan(0);
  });

  it('sweeps a bag of cards with no arrangement at all', async () => {
    // `loose-files` through an archive — [§7.8]'s repair and this one meeting,
    // which neither was written for and both get for nothing.
    const card = withChunks(makePng(), [
      base64TextChunk('chara', {
        name: 'Ilse Brandt',
        description: 'A cartographer.',
        first_mes: 'Hm.',
      }),
    ]);
    const zip = makeZip([{ name: 'downloads/Ilse.png', body: card }]);

    await upload('cards.zip', zip);

    const listed = await server.request({ method: 'GET', url: '/api/library/actors' });
    expect(listed.body.objects.map((row: { name: string }) => row.name)).toContain('Ilse Brandt');
  });
});

describe('an archive this build will not open', () => {
  it('is refused with the reason, not accepted half way', async () => {
    // §1.3's *refused before anything is written*, at the archive layer: the
    // traversing entry is caught reading the central directory, so nothing in
    // the archive is ever inflated.
    const response = await upload(
      'nasty.zip',
      makeZip([
        { name: 'card.json', body: JSON.stringify(V3_CARD) },
        { name: '../../escape.json', body: '{}' },
      ]),
    );

    expect(response.body.item.disposition).toBe('unrecognised');
    expect(response.body.notes[0].key).toBe('import.file.badArchive');
    expect(response.body.notes[0].params.refusal).toBe('unsafe-path');
    expect(await count('actors')).toBe(0);
  });
});
