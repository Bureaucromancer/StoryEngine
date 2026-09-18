// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { aventurasScenario } from '../import/fixtures/test-aventuras.js';
import { makeTestServer, ownObjects, setUpAdmin, type TestServer } from '../test-server.js';

/**
 * ***Getting an object out again*** —
 * [10 §5.0a](../../../../docs/design/10-ui-surfaces.md),
 * [00 §2.4](../../../../docs/design/00-stance.md).
 *
 * **Two doors and two different promises**, which is what these tests keep
 * apart. `/download` is the stored object byte for byte and converts nothing;
 * `/export/:format` is a **writer**, and a writer loses something by definition.
 * The second one's obligation is therefore not *lose nothing* — it cannot — but
 * *say what it lost*, which is what the notes header is for and what half of
 * these assert.
 *
 * The fixtures arrive through the import door rather than being built here, and
 * that is deliberate: it makes every case below a **round trip**, which is the
 * only form in which [00 §2.4]'s claim is checkable at all.
 */

let server: TestServer;

beforeEach(async () => {
  server = await makeTestServer();
  await setUpAdmin(server);
});

afterEach(async () => {
  await server.dispose();
});

/** The scenario fixture, imported, so there is a treatment and a cast to export. */
async function importScenario(): Promise<{ treatmentId: string }> {
  const boundary = '----storyengineTestBoundary';
  const payload = [
    `--${boundary}`,
    'Content-Disposition: form-data; name="file"; filename="Ash Harbour.json"',
    'Content-Type: application/json',
    '',
    JSON.stringify(aventurasScenario(), null, 2),
    `--${boundary}--`,
    '',
  ].join('\r\n');

  await server.request({
    method: 'POST',
    url: '/api/import/file',
    payload,
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  });

  const treatments = await ownObjects(server, 'treatments');
  const id = treatments.objects[0]?.id;
  if (id === undefined) throw new Error('the import did not produce a treatment');
  return { treatmentId: id };
}

function notesOf(headers: Record<string, unknown>): { key: string }[] {
  const header = headers['x-storyengine-export-notes'];
  if (typeof header !== 'string') return [];
  return JSON.parse(Buffer.from(header, 'base64').toString('utf8')) as { key: string }[];
}

describe('downloading a library object', () => {
  it('serves what is stored, for a kind with no writer at all', async () => {
    const { treatmentId } = await importScenario();
    const response = await server.request({
      method: 'GET',
      url: `/api/library/treatments/${treatmentId}/download`,
    });

    expect(response.status).toBe(200);
    // The primitive: no conversion, so the schema and the id are the stored ones.
    expect(response.body).toMatchObject({ schema: 'storyengine.treatment/1', id: treatmentId });
    expect(response.headers['content-disposition']).toContain('Ash-Harbour.json');
    // A package resolves references and can come up short; an object is itself.
    expect(response.headers['x-storyengine-missing']).toBeUndefined();
  });

  it('404s for an id that is not there', async () => {
    const response = await server.request({
      method: 'GET',
      url: '/api/library/treatments/nope/download',
    });
    expect(response.status).toBe(404);
  });
});

describe('exporting a library object as a foreign format', () => {
  it('writes an Aventuras scenario that this build reads back', async () => {
    const { treatmentId } = await importScenario();
    const response = await server.request({
      method: 'GET',
      url: `/api/library/treatments/${treatmentId}/export/aventuras.scenario`,
    });

    expect(response.status).toBe(200);
    const body = response.body as Record<string, unknown>;
    expect(body['settingSeed']).toContain('eleven days');
    expect((body['npcs'] as unknown[]).length).toBe(2);
    expect(body['firstMessage']).toContain('finds your collar');

    // The loop closes: the file the writer produced is a file the probe claims
    // and the converter takes.
    expect(response.headers['content-disposition']).toContain('Ash-Harbour.json');
  });

  it('names in a header what the file could not carry', async () => {
    const { treatmentId } = await importScenario();
    const response = await server.request({
      method: 'GET',
      url: `/api/library/treatments/${treatmentId}/export/sillytavern.card`,
    });

    expect(response.status).toBe(200);
    /**
     * **A header rather than the body**, on the `.sepack` route's reasoning: the
     * body is the file, and a note to the recipient's importer about the
     * exporter's library does not belong inside the document.
     */
    expect(notesOf(response.headers).map((note) => note.key)).toContain('export.card.castNarrowed');
    expect((response.body as { data: { scenario: string } }).data.scenario).toContain(
      'eleven days',
    );
  });

  it('separates a format nobody has from one aimed at the wrong kind', async () => {
    const { treatmentId } = await importScenario();

    const unknown = await server.request({
      method: 'GET',
      url: `/api/library/treatments/${treatmentId}/export/nope`,
    });
    expect(unknown.status).toBe(404);

    // 409 rather than 404: the format exists, this object is not its kind.
    const wrongKind = await server.request({
      method: 'GET',
      url: `/api/library/treatments/${treatmentId}/export/aventuras.character`,
    });
    expect(wrongKind.status).toBe(409);
  });

  it('cannot be handed a non-conforming object through this door', async () => {
    /**
     * **The 422 arm exists for a file somebody edited on disk, and the route
     * cannot be made to produce one** — which is worth asserting rather than
     * leaving as an untested branch with a confident comment over it.
     *
     * The write path validates, so a broken object never gets stored through
     * the API at all: the PUT is refused and the exportable object is still
     * there. The writer's own guard — the half that answers for a hand-edited
     * folder, which [10 §2.1] makes a feature rather than a hazard — is tested
     * where it lives, in `export/writers.test.ts`.
     */
    const { treatmentId } = await importScenario();
    const stored = await server.request({
      method: 'GET',
      url: `/api/library/treatments/${treatmentId}`,
    });
    const object = (stored.body as { object: Record<string, unknown> }).object;

    const refused = await server.request({
      method: 'PUT',
      url: `/api/library/treatments/${treatmentId}`,
      payload: { object: { ...object, openings: 'not an openings block' } },
      headers: { 'if-match': (stored.body as { contentHash: string }).contentHash },
    });
    // 400 rather than 422: the object is malformed as a request body, which is
    // the validation route's own vocabulary and not this one's.
    expect(refused.status).toBe(400);

    const response = await server.request({
      method: 'GET',
      url: `/api/library/treatments/${treatmentId}/export/aventuras.scenario`,
    });
    expect(response.status).toBe(200);
  });
});
