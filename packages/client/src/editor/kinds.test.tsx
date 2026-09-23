// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  newPackage,
  newSetup,
  newTreatment,
  TREATMENT_SCHEMA,
  type PlotHook,
} from '@storyengine/shared';

import type { Account, LibraryKind, LibraryObject } from '../api.js';
import type { Draft } from './book-form.js';
import { newHook } from './hook-form.js';
import { descriptorFor, type SimpleKind } from './SimpleEditorPage.js';

/**
 * ***Where a hook can be written*** —
 * [03 §4.1](../../../../docs/design/03-data-model.md),
 * [10 §10.1](../../../../docs/design/10-ui-surfaces.md),
 * [P11.2](../../../../docs/design/workplan/28-p11-implementation.md).
 *
 * [kinds.tsx](./kinds.tsx) is a file of declarations and
 * [SimpleEditorPage](./SimpleEditorPage.tsx) is the page they declare against,
 * so the flag and the merge the flag turns on are one change and are asserted
 * together here rather than split across two files by which module the line
 * happens to sit in.
 *
 * **What is actually being defended.** Until this landed, a treatment's `hooks`
 * reached the generic renderer's opaque fallback and were printed as JSON under
 * a note saying so — *"Hooks are authored in the session's hook panel. Shown
 * here as stored."* — which made a running session the only surface in the
 * application that could write a hook. The falsifying mutation is small and
 * silent in both directions: a flag left off puts the list back in a `<pre>`,
 * and a merge that never learned about `hooks` drops one side of them whole on
 * the first save conflict, inside a dialog whose entire offer is *reapply my
 * edits*.
 *
 * *The package editor is here for the same reason the six-kind loop in
 * [contract.test.tsx](./contract.test.tsx) is*: a claim about which kinds have
 * an affordance is worth nothing without a kind that must not have it.
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

const WAR = newHook('The Flower Kingdom declares war');

/**
 * Four objects, from the shared factories so each form's own guard passes for a
 * real reason, and addressed by **fixed** ids for `ActorEditorPage.test.tsx`'s:
 * the router is a module singleton, so the URL one test leaves is the URL the
 * next one mounts.
 */
const TREATMENT_ID = '01a008de-7e08-70d0-899c-0000000000a0';
const BARE_TREATMENT_ID = '01a008de-7e08-70d0-899c-0000000000a1';
const SETUP_ID = '01a008de-7e08-70d0-899c-0000000000a2';
const PACKAGE_ID = '01a008de-7e08-70d0-899c-0000000000a3';
const BROKEN_HOOKS_ID = '01a008de-7e08-70d0-899c-0000000000a4';
const IDLESS_HOOK_ID = '01a008de-7e08-70d0-899c-0000000000a5';
const HOOKED_PACKAGE_ID = '01a008de-7e08-70d0-899c-0000000000a6';

const OBJECTS: Record<string, Record<string, unknown>> = {
  [TREATMENT_ID]: {
    ...(newTreatment('Rain City') as unknown as Record<string, unknown>),
    id: TREATMENT_ID,
    hooks: [WAR],
  },
  // The empty case, which is the one a reader would expect to render as
  // nothing: a carrier whose `hooks` is `[]` still owes the create control, or
  // the first hook on a treatment could never be written.
  [BARE_TREATMENT_ID]: {
    ...(newTreatment('Harbour') as unknown as Record<string, unknown>),
    id: BARE_TREATMENT_ID,
  },
  [SETUP_ID]: {
    ...(newSetup('A night at the docks') as unknown as Record<string, unknown>),
    id: SETUP_ID,
  },
  [PACKAGE_ID]: {
    ...(newPackage('The harbour set') as unknown as Record<string, unknown>),
    id: PACKAGE_ID,
  },
  /**
   * ***Three hand-edited files, because the storage thesis invites them.***
   * `hooks` holding something that is not a list of hooks is what a text editor
   * and a bad merge both produce, and the list component dereferences all three
   * of these: `.map` on the first, `hook.id` as a React key on the second,
   * `hook.title` in every control's accessible name on the third.
   */
  [BROKEN_HOOKS_ID]: {
    ...(newTreatment('Broken') as unknown as Record<string, unknown>),
    id: BROKEN_HOOKS_ID,
    hooks: 'none',
  },
  [IDLESS_HOOK_ID]: {
    ...(newTreatment('Idless') as unknown as Record<string, unknown>),
    id: IDLESS_HOOK_ID,
    hooks: [{ title: 'No id at all' }],
  },
  [HOOKED_PACKAGE_ID]: {
    ...(newPackage('The harbour set') as unknown as Record<string, unknown>),
    id: HOOKED_PACKAGE_ID,
    hooks: 'none',
  },
};

function envelopeFor(id: string): LibraryObject {
  const object = OBJECTS[id] ?? {};
  return {
    id,
    schema: object['schema'] as string,
    name: object['name'] as string,
    slug: 'fixture',
    source: 'user',
    contentHash: 'sha256:fixture',
    shadowed: false,
    object: structuredClone(object),
  };
}

/** What a save carried — the half of every claim below that a rendering cannot see. */
let saved: Record<string, unknown>[] = [];

vi.mock('../api.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api.js')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      authState: () => Promise.resolve({ setupRequired: false, account: ACCOUNT }),
      // `HookList` fetches its own actor options, and an empty library is
      // enough here: what the pickers offer is `HookList.test.tsx`'s claim.
      listLibrary: () => Promise.resolve({ objects: [] }),
      readPrefs: () => Promise.resolve({ prefs: {} }),
      patchPrefs: (patch: Record<string, unknown>) => Promise.resolve({ prefs: patch }),
      listTags: () => Promise.resolve({ tags: [] }),
      readObject: (_kind: unknown, id: unknown) => Promise.resolve(envelopeFor(id as string)),
      updateObject: (_kind: unknown, _id: unknown, object: Record<string, unknown>) => {
        saved.push(structuredClone(object));
        return Promise.resolve({ contentHash: 'sha256:fixture-2', object });
      },
    },
  };
});

const { router } = await import('../router.js');

function renderApp(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

async function openEditor(kind: LibraryKind, id: string): Promise<void> {
  await act(async () => {
    await router.navigate({ to: `/library/${kind}/$id/edit`, params: { id } });
  });
  await screen.findByRole('textbox', { name: 'Name' });
}

beforeEach(() => {
  saved = [];
});

/**
 * ***A hand-edited `hooks` refuses the editor rather than the application*** —
 * [10 §2.1], and `lorebookShape`'s own sentence: *a hand edit is the storage
 * thesis working, and a white screen is the one answer this surface may not give
 * it.*
 *
 * **Why this arrived with the hook editor rather than before it.** The page's
 * guard checked `name` alone, and its docstring said why — everything else went
 * through `SchemaFields`, which reads a value of any shape and draws what it
 * finds. `HookList` does not: it **walks a keyed list**, so a `hooks` that is
 * not one throws, and there is no error boundary anywhere in this package, which
 * makes that throw the whole application rather than the section. The server
 * half of the same change pinned the identical cases one package over
 * (`links.test.ts`'s *survives hooks that are absent, or not hooks at all*); this
 * is the client's.
 *
 * *The refusal is the existing one*, naming the problem and pointing at the
 * file, because a person whose file is wrong needs to know which file and what
 * about it.
 */
describe('a carrier whose hooks a hand edit broke', () => {
  async function openBroken(kind: LibraryKind, id: string): Promise<HTMLElement> {
    await act(async () => {
      await router.navigate({ to: `/library/${kind}/$id/edit`, params: { id } });
    });
    return screen.findByRole('alert');
  }

  it('refuses to open a treatment whose hooks is not a list', async () => {
    renderApp();

    const alert = await openBroken('treatments', BROKEN_HOOKS_ID);

    expect(alert.textContent).toContain('its "hooks" is not a list');
    expect(screen.queryByRole('region', { name: 'Plot hooks' })).toBeNull();
  });

  /**
   * The id check is `editableBookShape`'s argument one field over: every edit
   * here addresses a hook by id and the 412 merge keys on it, so two hooks
   * whose ids are not strings collapse to one under any of them — an edit to
   * one silently editing or deleting the other.
   */
  it('refuses to open a treatment carrying a hook with no id', async () => {
    renderApp();

    const alert = await openBroken('treatments', IDLESS_HOOK_ID);

    expect(alert.textContent).toContain('a hook has no "id" string');
  });

  /**
   * ***And the guard is about what this page dereferences, not about what the
   * schema permits.*** A package does not author hooks, so a `hooks` a hand edit
   * left on one still goes through the opaque fallback and still renders — and a
   * guard that refused it would be inventing a validity rule for a kind that has
   * no such field.
   */
  it('opens a package with a stray hooks field, because nothing draws it', async () => {
    renderApp();
    await openEditor('packages', HOOKED_PACKAGE_ID);

    expect(screen.queryByRole('region', { name: 'Plot hooks' })).toBeNull();
  });
});

describe('the carriers that author their own hooks', () => {
  /**
   * ***The list is drawn, and the opaque fallback has let go of it.***
   *
   * Both halves, because either alone passes a mutation that matters. `hooks`
   * left out of `handled` renders the array twice — once as JSON under
   * *Shown as stored*, once as the editor — and a reader would believe the
   * second while the first sat above it contradicting it.
   *
   * `Hooks` against `Plot hooks` is what tells the two apart: the fallback
   * labels a field by its key (`labelFor('hooks')`), and the section this
   * change adds is headed by what the thing is called.
   */
  for (const [kind, id] of [
    ['treatments', TREATMENT_ID],
    ['setups', SETUP_ID],
  ] as const) {
    it(`gives a ${kind.slice(0, -1)} a hook editor and not a JSON dump`, async () => {
      renderApp();
      await openEditor(kind, id);

      expect(screen.getByRole('region', { name: 'Plot hooks' })).toBeDefined();
      expect(screen.queryByText('Hooks')).toBeNull();
      // An empty array reads as an array of strings, so the fallback would give
      // it a textarea rather than a `<pre>` — neither is a hook editor.
      expect(screen.queryByLabelText('Hooks')).toBeNull();
    });
  }

  /**
   * The round trip, which is the claim the rendering above only sets up: a hook
   * edited on the treatment page reaches the object that gets written.
   *
   * The id is asserted alongside the title because it is the field
   * [15 §5.1](../../../../docs/design/15-world.md) says must survive every copy
   * of a hook — and an editor that rebuilt the hook it was patching would pass
   * on the title alone.
   */
  it('writes a hook edited on the treatment page into the saved object', async () => {
    renderApp();
    await openEditor('treatments', TREATMENT_ID);

    await userEvent.type(await screen.findByLabelText('Title'), '!');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(saved).toHaveLength(1);
    });
    const hooks = saved[0]?.['hooks'] as PlotHook[];
    expect(hooks).toHaveLength(1);
    expect(hooks[0]?.title).toBe('The Flower Kingdom declares war!');
    expect(hooks[0]?.id).toBe(WAR.id);
    // And nothing else about the hook moved, which is `hook-form.ts`'s own
    // guarantee read through the page that calls it.
    expect(JSON.stringify(hooks[0])).toBe(JSON.stringify({ ...WAR, title: hooks[0]?.title }));
  });

  /** An empty list is a list, and the control that ends it being empty is the point. */
  it('offers the create control on a treatment with no hooks yet', async () => {
    renderApp();
    await openEditor('treatments', BARE_TREATMENT_ID);

    expect(screen.getByRole('region', { name: 'Plot hooks' })).toBeDefined();
    expect(screen.getByText('None here yet.')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Add a hook' })).toBeDefined();
  });

  /**
   * ***The kind that must not have one.*** A Package carries the objects that
   * hold hooks and holds none itself ([03 §4.1]), so a hook list here would be
   * the fifth source that section declines by name — and an assertion that only
   * ever looked at the two kinds with the flag would not notice a flag set on
   * all three.
   */
  it('gives a package no hook editor at all', async () => {
    renderApp();
    await openEditor('packages', PACKAGE_ID);

    expect(screen.queryByRole('region', { name: 'Plot hooks' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add a hook' })).toBeNull();
  });
});

/**
 * ***The 412 merge, hook by hook*** —
 * [09 §4.4](../../../../docs/design/09-server-multiuser-deployment.md).
 *
 * Driven through `descriptorFor` rather than through the dialog, because what
 * is under test is the resolution and not the button: `ConflictDialog.test.tsx`
 * already holds the offer, and a test that had to lose a save race to assert on
 * a merge would be two tests wearing one name.
 *
 * *A declaration built here rather than one imported from `kinds.tsx`*, since
 * the only difference between them is the sentences — and a merge test that
 * depended on a treatment's blurb would fail the day somebody reworded it.
 */
function kindWith(hooks: boolean): SimpleKind {
  return {
    kind: 'treatments',
    schemaId: TREATMENT_SCHEMA,
    blurb: '',
    backLabel: '',
    unsavedHeading: '',
    conflictTitle: '',
    storedCaption: '',
    nameRefusal: '',
    notFound: '',
    unopenable: () => '',
    untitled: { draft: '', saved: '' },
    editorRoute: '/library/treatments/$id/edit',
    ...(hooks ? { hooks: true as const } : {}),
  };
}

function reapply(pristine: Draft, mine: Draft, fresh: Draft): Draft {
  return descriptorFor(kindWith(true)).reapply(pristine, mine, fresh);
}

function titles(draft: Draft): string[] {
  return (draft['hooks'] as PlotHook[]).map((hook) => hook.title);
}

describe('reapplying my edits onto a newer carrier', () => {
  const WEDDING = newHook('The marriage is announced');
  const PRISTINE: Draft = { name: 'Rain City', framing: 'Wet.', hooks: [WAR, WEDDING] };

  /**
   * The failure this whole stage exists to prevent, stated as a test: two
   * people each added a hook, and both hooks survive.
   *
   * Before the merge learned about `hooks` this took one side's list whole —
   * mine if I had touched any hook at all, theirs if I had not — and said
   * nothing about the other's.
   */
  it('keeps a hook added on each side', () => {
    const ofMine = newHook('The bridge collapses');
    const ofTheirs = newHook('The fixer calls in a favour');

    const merged = reapply(
      PRISTINE,
      { ...PRISTINE, hooks: [WAR, WEDDING, ofMine] },
      { ...PRISTINE, hooks: [WAR, WEDDING, ofTheirs] },
    );

    expect(titles(merged)).toEqual([
      'The Flower Kingdom declares war',
      'The marriage is announced',
      'The fixer calls in a favour',
      'The bridge collapses',
    ]);
  });

  /** Edited on one side only: that side's version, and the untouched one is theirs. */
  it('takes each hook from whichever of us changed it', () => {
    const merged = reapply(
      PRISTINE,
      { ...PRISTINE, hooks: [{ ...WAR, premise: 'Over some damned island.' }, WEDDING] },
      { ...PRISTINE, hooks: [WAR, { ...WEDDING, weight: 5 }] },
    );

    const hooks = merged['hooks'] as PlotHook[];
    expect(hooks[0]?.premise).toBe('Over some damned island.');
    expect(hooks[1]?.weight).toBe(5);
  });

  /**
   * A hook I removed stays removed, and one they removed stays removed unless I
   * had been editing it — `pristine` is the only thing that can tell a removal
   * from a concurrent addition, and without it a merge either resurrects every
   * delete or eats every new hook.
   */
  it('honours a removal from either side, and rescues one I had edited', () => {
    expect(
      titles(reapply(PRISTINE, { ...PRISTINE, hooks: [WEDDING] }, { ...PRISTINE, hooks: [WAR] })),
    ).toEqual([]);

    expect(
      titles(
        reapply(
          PRISTINE,
          { ...PRISTINE, hooks: [WAR, { ...WEDDING, premise: 'At the harbour.' }] },
          { ...PRISTINE, hooks: [WAR] },
        ),
      ),
    ).toEqual(['The Flower Kingdom declares war', 'The marriage is announced']);
  });

  /** The field rule the rest of the object keeps, unchanged by any of this. */
  it('still merges everything outside hooks field by field', () => {
    const merged = reapply(
      PRISTINE,
      { ...PRISTINE, name: 'Rain City, later' },
      { ...PRISTINE, framing: 'Wet, and cold.' },
    );

    expect(merged['name']).toBe('Rain City, later');
    expect(merged['framing']).toBe('Wet, and cold.');
  });

  /**
   * ***And a kind without the flag is left exactly as it was.*** A package's
   * draft has no `hooks`, and a merge that wrote one would be inventing a key
   * out of a page that never showed the field — which no schema would then
   * accept.
   */
  it('invents no hooks on a kind that does not author them', () => {
    const bare: Draft = { name: 'The harbour set', contents: [] };
    const merged = descriptorFor(kindWith(false)).reapply(bare, { ...bare, name: 'Renamed' }, bare);

    expect(Object.hasOwn(merged, 'hooks')).toBe(false);
    expect(merged['name']).toBe('Renamed');
  });
});
