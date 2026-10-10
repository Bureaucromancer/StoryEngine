// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { newActor, newWorld } from '@storyengine/shared';

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
    // A World's export resolves references and can come up short; an object is
    // itself. (*A package* until P16.0 renamed the kind.)
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

/**
 * ***A World, exported, at the kind's new address and only there*** —
 * [P16 §1.1](../../../../docs/design/workplan/35-p16-world.md),
 * [P16.0](../../../../docs/design/workplan/35-p16-world.md).
 *
 * Two halves of one decision, and each is checked because each could regress
 * without the other noticing. **The old paths are not kept**: the only caller of
 * `/library/packages/*` was the client that ships with this server, which moved
 * in the same change, so the generic `:kind` routes answer the old name as any
 * folder they do not know — `unknown-kind`, listing the kinds they do, which is
 * what [the API reference](../../../../docs/api.md) now says of it. An alias left
 * behind by accident would be a second door that reference denies exists.
 *
 * **And the file the new address writes is the old file**: §1.1 leaves
 * `storyengine.package-export/1` and its `.sepack.json` name exactly as P11.10
 * made them, because [P16.3](../../../../docs/design/workplan/35-p16-world.md)
 * defines the World's format once and reads this one beside it. Renaming the envelope with the route would be the first of two
 * formats written inside one phase, so a World's export still says *package*
 * in its schema id and its extension, and this pins that it does — until P16.3
 * changes it on purpose and changes this with it.
 */
describe('exporting a World', () => {
  it('no longer answers at the Package’s address', async () => {
    const listed = await server.request({ method: 'GET', url: '/api/library/packages' });
    expect(listed.status).toBe(404);
    expect(listed.body).toMatchObject({ error: 'unknown-kind' });
    // The refusal names the kind that replaced it, so a stale caller is told where to go.
    expect((listed.body as { message: string }).message).toContain('worlds');

    // The export route was the one non-generic path, and it moved rather than forked.
    const world = newWorld('Rain City');
    await server.request({ method: 'POST', url: '/api/library/worlds', payload: world });
    const old = await server.request({
      method: 'GET',
      url: `/api/library/packages/${world.id}/export`,
    });
    expect(old.status).toBe(404);
  });

  /**
   * ***Only a World leaves by this door*** (2026-10-10). The writer reads its
   * id with no kind, so an actor's id here exported the actor as a bundle of
   * nothing — the route now asks first.
   */
  it('answers 404 for an id that is not a World', async () => {
    const actor = newActor('Vera');
    await server.request({ method: 'POST', url: '/api/library/actors', payload: actor });
    const response = await server.request({
      method: 'GET',
      url: `/api/library/worlds/${actor.id}/export`,
    });
    expect(response.status).toBe(404);
  });

  it('writes the unchanged .sepack envelope for a World made through the API', async () => {
    const actor = newActor('Vera');
    await server.request({ method: 'POST', url: '/api/library/actors', payload: actor });
    const world = {
      ...newWorld('Rain City'),
      contents: [{ schema: 'storyengine.actor/1', id: actor.id, name: 'Vera' }],
    };
    const created = await server.request({
      method: 'POST',
      url: '/api/library/worlds',
      payload: world,
    });
    expect(created.status).toBe(201);

    const response = await server.request({
      method: 'GET',
      url: `/api/library/worlds/${world.id}/export`,
    });

    expect(response.status).toBe(200);
    expect(response.headers['content-disposition']).toContain('Rain-City.sepack.json');
    expect(response.headers['x-storyengine-missing']).toBe('0');
    expect(response.body).toMatchObject({
      schema: 'storyengine.package-export/1',
      manifest: {
        id: world.id,
        name: 'Rain City',
        contents: [{ id: actor.id, schema: 'storyengine.actor/1', name: 'Vera' }],
      },
    });
    // Resolved rather than referenced, which is what makes it a bundle.
    expect((response.body as { objects: { id: string }[] }).objects.map((one) => one.id)).toEqual([
      actor.id,
    ]);
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
