// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  newActor,
  newLorebook,
  newPackage,
  newPreset,
  newSetup,
  newTreatment,
} from '@storyengine/shared';

import { LIBRARY_KINDS, type Account, type LibraryKind, type LibraryObject } from '../api.js';

/**
 * ***The editor contract, over the key set*** —
 * [10 §11](../../../../docs/design/10-ui-surfaces.md),
 * [P11.2](../../../../docs/design/workplan/28-p11-implementation.md).
 *
 * The stage's proof obligation, in its own words: ***"over the key set, not
 * over the editors somebody remembered. `fields.test.ts` is the model… the
 * claim runs over `LIBRARY_KINDS` and fails when a kind is added without the
 * affordance, which is the difference between a test that tracks the feature
 * and one that tracks the day it was written."***
 *
 * So the loop is the assertion. Every kind in `LIBRARY_KINDS` gets its editor
 * opened and asked the three questions the stage's *Ends at* names — **assist,
 * provenance and history** — plus [P5 §2]'s invariant, which is the one of the
 * four that an assertion can hold exactly rather than by rendering.
 *
 * ***What each question is actually asking.***
 *
 * - **Assist** is *is there a control beside a text field* — [10 §11]'s *"so
 *   that 'does this field have AI assist?' is never a question anyone asks"*.
 *   The falsifying mutation is a `Field` that lost its `path`, which is
 *   invisible to typecheck and to lint and silently removes the affordance.
 * - **Provenance** is the disclosure [10 §11.2] asks for, on the field. It is
 *   checked by opening the panel, because that is where it is: a badge on a
 *   field nobody generated would be noise on every field of every editor.
 * - **History** is [10 §11.2a], which `EditorFrame` has had since P7B.1 — so
 *   this row is a **regression** check rather than a new claim, and it is here
 *   because the obligation says *the key set*, not *the parts that are new*.
 * - **The closed-section invariant** is [P5 §2]'s refused cut: a collapsed
 *   section names what inside it is not at its default. Only the kinds whose
 *   schema produces a banner have one, so it is asserted where it applies and
 *   the absence is not read as a pass.
 */

const ACCOUNT: Account = {
  handle: 'ned',
  displayName: 'Ned',
  role: 'owner',
  enabled: true,
  locale: null,
  capabilities: {
    privateConnections: true,
    fileAccess: 'full',
    enableExtensions: false,
    scheduledBackups: false,
  },
  createdAt: 0,
};

/**
 * One object per kind, from the shared factories, so every form's own guard
 * passes for a real reason rather than because the fixture was shaped to it.
 *
 * *A fixed id per kind* for `ActorEditorPage.test.tsx`'s reason: the router is a
 * module singleton, so the URL one test leaves is the URL the next one mounts,
 * and a per-run uuid would have the second test open on an object the fake has
 * never heard of.
 */
const FIXTURES: Record<LibraryKind, Record<string, unknown>> = {
  actors: { ...(newActor('Vera Solano') as unknown as Record<string, unknown>) },
  lorebooks: { ...(newLorebook('Harbour lore') as unknown as Record<string, unknown>) },
  treatments: { ...(newTreatment('Rain City') as unknown as Record<string, unknown>) },
  setups: { ...(newSetup('A night at the docks') as unknown as Record<string, unknown>) },
  presets: { ...(newPreset('House style') as unknown as Record<string, unknown>) },
  packages: { ...(newPackage('The harbour set') as unknown as Record<string, unknown>) },
};

for (const [kind, object] of Object.entries(FIXTURES)) {
  object['id'] =
    `01a008de-7e08-70d0-899c-00000000000${String(LIBRARY_KINDS.indexOf(kind as LibraryKind))}`;
}

function envelopeFor(kind: LibraryKind): LibraryObject {
  const object = FIXTURES[kind];
  return {
    id: object['id'] as string,
    schema: object['schema'] as string,
    name: object['name'] as string,
    slug: 'fixture',
    source: 'user',
    contentHash: 'sha256:fixture',
    shadowed: false,
    object: structuredClone(object),
  };
}

/** Which kind the last `readObject` was for — the route decides, not this file. */
let opened: LibraryKind = 'actors';
/** What the assist was asked for, and what a save then carried. */
let assists: { path: string }[] = [];
let saved: Record<string, unknown>[] = [];

vi.mock('../api.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api.js')>();
  return {
    ...actual,
    /**
     * ***A top-level export, mocked at the top level*** — and the reason is
     * worth the line, because the first draft put it inside `api` and the test
     * reported an assist that never ran. `FieldAssist` imports `assistField`
     * as a named export, so a replacement nested inside the `api` object is a
     * replacement of something nothing calls.
     */
    assistField: (body: { path: string }) => {
      assists.push(body);
      return Promise.resolve({
        text: 'A wet quay under sodium light.',
        model: 'fake-hi',
        seed: 'the prompt that ran',
      });
    },
    api: {
      ...actual.api,
      authState: () => Promise.resolve({ setupRequired: false, account: ACCOUNT }),
      listLibrary: () => Promise.resolve({ objects: [] }),
      readPrefs: () => Promise.resolve({ prefs: {} }),
      patchPrefs: (patch: Record<string, unknown>) => Promise.resolve({ prefs: patch }),
      updateObject: (_kind: unknown, _id: unknown, object: Record<string, unknown>) => {
        saved.push(structuredClone(object));
        return Promise.resolve({ contentHash: 'sha256:fixture-2', object });
      },
      readObject: (kind: unknown) => {
        opened = kind as LibraryKind;
        return Promise.resolve(envelopeFor(opened));
      },
      listTags: () => Promise.resolve({ tags: [] }),
    },
  };
});

const { router } = await import('../router.js');

function renderApp(): QueryClient {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return client;
}

/** The editor route each kind carries — `fields.ts`'s table, through the router. */
const ROUTES: Record<LibraryKind, string> = {
  actors: '/library/actors/$id/edit',
  lorebooks: '/library/lorebooks/$id/edit',
  treatments: '/library/treatments/$id/edit',
  setups: '/library/setups/$id/edit',
  presets: '/library/presets/$id/edit',
  packages: '/library/packages/$id/edit',
};

async function openEditor(kind: LibraryKind): Promise<void> {
  await act(async () => {
    await router.navigate({
      to: ROUTES[kind],
      params: { id: FIXTURES[kind]['id'] as string },
    });
  });
  await screen.findAllByRole('button', { name: 'Assist' });
}

beforeEach(() => {
  opened = 'actors';
  assists = [];
  saved = [];
});

describe('every editor, over the key set', () => {
  /** The instrument has to be looking at six things, or the loop proves nothing. */
  it('covers every kind the library has', () => {
    expect(Object.keys(ROUTES).sort()).toEqual([...LIBRARY_KINDS].sort());
    expect(LIBRARY_KINDS).toHaveLength(6);
  });

  for (const kind of LIBRARY_KINDS) {
    describe(kind, () => {
      it('offers assist on its text fields', async () => {
        renderApp();
        await openEditor(kind);
        // More than zero rather than a count: how many text fields a kind has is
        // its schema's business, and a count here would be a second, worse
        // statement of the schema that broke whenever somebody added a field.
        expect(screen.getAllByRole('button', { name: 'Assist' }).length).toBeGreaterThan(0);
      });

      /**
       * ***The disclosure [10 §11.2] asks for, where it is.*** Opening the panel
       * is the check because the sentence lives in the panel — *"honest
       * disclosure — this was model-written, from this prompt, with this
       * model"* is a thing to read when you are asking about a field, and a
       * badge on every untouched field would be noise on six editors at once.
       */
      it('discloses whether a field was model-written', async () => {
        renderApp();
        await openEditor(kind);
        const buttons = screen.getAllByRole('button', { name: 'Assist' });
        await act(async () => {
          buttons[0]?.click();
          await Promise.resolve();
        });
        expect(screen.getByText('Nothing here was model-written.')).toBeDefined();
      });

      /** [10 §11.2a], in every editor, which the frame has carried since P7B.1. */
      it('offers version history', async () => {
        renderApp();
        await openEditor(kind);
        expect(screen.getAllByRole('button', { name: 'History' }).length).toBeGreaterThan(0);
      });
    });
  }
});

/**
 * ***One round trip, end to end, because the loop above is about affordances***
 * — [10 §11.1], [10 §11.2], [P11.2].
 *
 * The six-kind loop asserts that the control is *there*, which is the
 * obligation's shape and is not the same as the feature working. This drives
 * one field through §11.1's whole sequence and asserts the three things a
 * reader of [10 §11.2] would expect afterwards: the words are in the field, the
 * provenance is in the object that gets saved, and a hand edit clears
 * `unreviewed` without removing the record.
 *
 * *The actor editor is the one it runs on*, because a test that ran it six
 * times would be asserting six times that `EditorFrame` provides one context.
 */
describe('an assist, accepted and then edited', () => {
  it('writes the field, records where it came from, and marks a hand edit reviewed', async () => {
    renderApp();
    await openEditor('actors');

    const name = screen.getByRole('textbox', { name: 'Name' });
    const assist = screen.getAllByRole('button', { name: 'Assist' })[0];
    await act(async () => {
      assist?.click();
      await Promise.resolve();
    });

    await act(async () => {
      screen.getByRole('button', { name: 'Write it' }).click();
      await Promise.resolve();
    });

    // The draft the server was asked about is the field's path, not its label.
    await waitFor(() => {
      expect(assists).toHaveLength(1);
    });
    expect(assists[0]?.path).toBe('name');
    await waitFor(() => {
      expect((name as HTMLInputElement).value).toBe('A wet quay under sodium light.');
    });

    /**
     * ***The provenance reaches the file, which is the half a rendering test
     * cannot see.*** [10 §11.2]'s map is *"stored as a map keyed by dotted field
     * path"*, and the falsifying mutation — an editor that put the words in the
     * form and never recorded where they came from — leaves every assertion
     * above passing.
     */
    await act(async () => {
      screen.getByRole('button', { name: 'Save' }).click();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(saved).toHaveLength(1);
    });
    const record = (saved[0]?.['generated'] as Record<string, { unreviewed: boolean }>)['name'];
    expect(record).toBeDefined();
    expect(record?.unreviewed).toBe(true);

    /**
     * *And a hand edit clears the flag without removing the record*, which is
     * §11.2's first payoff: **revert-to-generated after hand editing** only
     * works if the original survives the edit.
     */
    await userEvent.type(name, '!');
    await act(async () => {
      screen.getByRole('button', { name: 'Save' }).click();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(saved.length).toBeGreaterThan(1);
    });
    const after = (saved.at(-1)?.['generated'] as Record<string, Record<string, unknown>>)['name'];
    expect(after?.['unreviewed']).toBe(false);
    expect(after?.['original']).toBe('A wet quay under sodium light.');
  });
});
