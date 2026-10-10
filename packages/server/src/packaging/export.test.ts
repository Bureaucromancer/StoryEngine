// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { newActor, newLorebook, newWorld, PACKAGE_EXPORT_SCHEMA } from '@storyengine/shared';

import { exportPackage } from './export.js';
import { makeTestServer, setUpAdmin, type TestServer } from '../test-server.js';

/**
 * ***A bundle that travels*** — [04 §9](../../../../docs/design/04-schemas.md),
 * [P11 §1.9](../../../../docs/design/workplan/28-p11-implementation.md),
 * [P11.10](../../../../docs/design/workplan/28-p11-implementation.md).
 *
 * §1.9's *Ends at* is one line beside the session's: **a bundle exported from
 * one install opens on another**. What that needs is that the objects travel
 * rather than their ids — a `.sepack` naming twelve ids is useless on the
 * install it was sent to — and that is the whole assertion.
 *
 * *The stale-reference case is the second one*, and it is the one with a
 * judgement in it: a package outlives an object it names, and both of the
 * obvious answers are worse than reporting it.
 *
 * ***A World from [P16.0]***, the kind renamed; **the envelope is not**, and
 * the `PACKAGE_EXPORT_SCHEMA` assertion below is the pin that the stage left it
 * alone — [P16.3] defines the World's own format and reads this one beside it.
 */

let server: TestServer;

beforeEach(async () => {
  server = await makeTestServer();
  await setUpAdmin(server, 'ned');
});

afterEach(async () => {
  await server.dispose();
});

async function create(kind: string, payload: unknown): Promise<void> {
  const response = await server.request({ method: 'POST', url: `/api/library/${kind}`, payload });
  expect(response.status).toBe(201);
}

describe('exporting a World, in the envelope P16.3 replaces', () => {
  it('carries the objects it names rather than their ids', async () => {
    const vera = newActor('Vera');
    const book = newLorebook('Harbour lore');
    await create('actors', vera);
    await create('lorebooks', book);

    const bundle = {
      ...newWorld('A night at the docks'),
      contents: [
        { schema: vera.schema, id: vera.id, name: 'Vera' },
        { schema: book.schema, id: book.id, name: 'Harbour lore' },
      ],
    };
    await create('worlds', bundle);

    const result = exportPackage(
      { library: server.services.library, build: null },
      'ned',
      bundle.id,
    );

    expect(result?.exported.schema).toBe(PACKAGE_EXPORT_SCHEMA);
    expect(result?.missing).toEqual([]);
    // The manifest says what is inside, by name — the decision a person makes
    // before importing is *do I want these*, and a count cannot answer it.
    expect(result?.exported.manifest.contents.map((one) => one.name).sort()).toEqual([
      'Harbour lore',
      'Vera',
    ]);
    // And the objects themselves travel, which is what makes it a bundle rather
    // than a bookmark.
    expect(result?.exported.objects).toHaveLength(2);
    expect(JSON.stringify(result?.exported.objects)).toContain('Vera');
  });

  /**
   * ***A package outlives an object it names.*** Dropping it exports a package
   * that quietly is not the one somebody made; refusing makes a stale reference
   * unfixable except by hand-editing a file. Reporting it is the third answer
   * and the only one that leaves the person able to act.
   */
  it('reports an id the library no longer has, and exports the rest', async () => {
    const vera = newActor('Vera');
    await create('actors', vera);

    const bundle = {
      ...newWorld('A night at the docks'),
      contents: [
        { schema: vera.schema, id: vera.id, name: 'Vera' },
        { schema: vera.schema, id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a99', name: 'Gone' },
      ],
    };
    await create('worlds', bundle);

    const result = exportPackage(
      { library: server.services.library, build: null },
      'ned',
      bundle.id,
    );

    expect(result?.missing).toEqual(['0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a99']);
    expect(result?.exported.objects).toHaveLength(1);
  });

  it('answers null for a package that is not there', () => {
    expect(
      exportPackage({ library: server.services.library, build: null }, 'ned', 'no-such-package'),
    ).toBeNull();
  });
});
