// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { newActor } from '@storyengine/shared';

import { ApiError, type Account, type LibraryObject } from '../api.js';

/**
 * **Exit-gate step 8** — [P2 §4](../../../../docs/design/workplan/04-p2-implementation.md):
 * *"Save in the editor, navigate away and back, save again → no conflict
 * dialog for your own change (F12)."*
 *
 * F12 is the one finding on the list that a user reported as a *lie*: the
 * editor's base sits under `['editor', kind, id]` with `staleTime: Infinity`
 * and outside the `['library']` invalidation prefix — deliberately, because
 * the object under an open form must not shift beneath it — so a save that
 * only invalidated `['library']` left that entry holding the *pre-save*
 * `contentHash`. Come back inside `gcTime` and the form loaded a hash the
 * server had already superseded, the next save presented it, and the server
 * did exactly what it is supposed to do: 412, with the dialog announcing that
 * something else had written the file. The something else was the user, ten
 * seconds earlier. `queries.ts` fixes it by invalidating the editor key too.
 *
 * Until this file, the only editor code under test was `ConflictDialog` — the
 * dialog that appears *when the bug happens*. Nothing mounted the page, so the
 * regression could return with the whole suite green: the subject is not the
 * dialog's markup but the cache entry surviving an unmount, and a cache is
 * exactly what a component test that mocks `useQuery` deletes. So the query
 * client here is **real** and the API module is mocked — the same division
 * `play/PlayPage.test.tsx` makes, for the same reason.
 *
 * The fake behind the mock **enforces the hash** (`library.ts:490`, `'The
 * object has changed since it was read.'` → 412 with the current object). That
 * enforcement is what makes "no dialog" mean anything: against a fake that
 * accepted every write, a client presenting a hash from last week would pass.
 * The second describe below is the control that proves the enforcement is
 * live — same page, same fake, a genuinely stale base, and the dialog appears.
 *
 * **The falsifying mutation**: delete the `['editor', input.kind, input.id]`
 * invalidation from `useSaveObject`'s `onSuccess` in `queries.ts`. The first
 * save still succeeds and the notice still says *Saved.*; the round trip then
 * rehydrates the form from the stale cached envelope, the second save presents
 * the hash the *first* one presented, and the conflict dialog opens on the
 * user's own change. Both of this file's step-8 assertions catch it — the
 * hashes the fake was shown, and the dialog's absence.
 */

/**
 * A fixed id, not `newActor`'s fresh uuidv7 per test.
 *
 * The router is a module singleton (`router.tsx` exports one, built at import),
 * so the URL a test leaves behind is the URL the next test's first render
 * mounts. With a stable id that is harmless — the route resolves, the fake
 * answers — where a per-test id would have the second test open the editor on
 * an object the fake has never heard of before the navigation below corrects
 * it.
 */
const ACTOR_ID = '01a008de-7e08-70d0-899c-f6869d6b9aeb';

/** The shape on disk, from the shared factory, so the form's guard passes for real reasons. */
const ACTOR: Record<string, unknown> = {
  ...(newActor('Vera Solano') as unknown as Record<string, unknown>),
  id: ACTOR_ID,
};

const ACCOUNT: Account = {
  handle: 'ned',
  displayName: 'Ned',
  role: 'owner',
  enabled: true,
  locale: null,
  capabilities: { privateConnections: true, fileAccess: 'full', enableExtensions: false },
  createdAt: 0,
};

/** One `PUT` the fake saw: the hash the client presented, and what it got back. */
interface UpdateAttempt {
  presented: string;
  /** The new hash on success; null when the fake refused the write with a 412. */
  returned: string | null;
}

/**
 * The in-memory library the mocked `api` speaks to.
 *
 * Hashes are opaque to the client — it echoes back whatever the last read or
 * write handed it — so a readable counter is a better fixture than a real
 * digest would be: an assertion that fails prints `sha256:revision-1` instead
 * of sixty-four hex characters, and *which revision the client presented* is
 * the entire subject of step 8.
 */
function makeLibrary() {
  let stored = structuredClone(ACTOR);
  let revision = 0;
  const updates: UpdateAttempt[] = [];
  const removals: { id: unknown; presented: string }[] = [];

  const hash = (): string => `sha256:revision-${String(revision)}`;

  const envelope = (): LibraryObject => ({
    id: ACTOR_ID,
    schema: stored['schema'] as string,
    name: stored['name'] as string,
    slug: 'vera-solano',
    source: 'user',
    contentHash: hash(),
    shadowed: false,
    object: structuredClone(stored),
  });

  return {
    updates,
    envelope,
    stored: (): Record<string, unknown> => structuredClone(stored),

    /**
     * A write that did not come through this client — the other tab, or the
     * text editor the storage design invites people to use. It moves the hash
     * without telling anyone, which is precisely the situation the 412 exists
     * for and the one the control test needs.
     */
    handEdit(patch: Record<string, unknown>): void {
      stored = { ...structuredClone(stored), ...patch };
      revision += 1;
    },

    readObject: (): Promise<LibraryObject> => Promise.resolve(envelope()),

    updateObject(
      _kind: unknown,
      _id: unknown,
      object: Record<string, unknown>,
      contentHash: string,
    ): Promise<{ contentHash: string; object: Record<string, unknown> }> {
      if (contentHash !== hash()) {
        updates.push({ presented: contentHash, returned: null });
        // The server's own words and the server's own status, including the
        // `current` object — the editor's `failure instanceof ApiError &&
        // status === 412 && failure.current` is a three-part condition and a
        // 412 missing any part opens nothing (F14).
        return Promise.reject(
          new ApiError(
            412,
            'stale',
            'The object has changed since it was read.',
            structuredClone(envelope()),
          ),
        );
      }
      stored = structuredClone(object);
      revision += 1;
      updates.push({ presented: contentHash, returned: hash() });
      return Promise.resolve({ contentHash: hash(), object: structuredClone(stored) });
    },

    /**
     * What the fake was asked to move to the trash, with the hash the client
     * presented — the same thing `updates` records for a write, because a
     * delete on a moved file is refused by the same rule and for the same
     * reason. Accepted without checking the hash: the refusal path is the
     * detail page's test to prove, and this file's claim is about what the
     * editor sends and where it goes afterwards.
     */
    removals,
    deleteObject(_kind: unknown, id: unknown, contentHash: string): Promise<undefined> {
      removals.push({ id, presented: contentHash });
      return Promise.resolve(undefined);
    },
  };
}

let server = makeLibrary();

/**
 * `importOriginal` rather than a bare factory, because **`ApiError` must stay
 * the real class**. The editor decides whether to open the dialog with an
 * `instanceof` check; a look-alike thrown from a hand-written mock would fail
 * it silently, and the test would then report "no dialog" for a client that
 * never even looked. Only the `api` object is replaced, and it is spread over
 * the real one so the calls no route here makes keep their real (unused)
 * implementations rather than becoming `undefined`.
 *
 * The bodies delegate through `server` rather than closing over it, so that
 * `beforeEach` can hand every test a library with no history.
 */
vi.mock('../api.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api.js')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      authState: () => Promise.resolve({ setupRequired: false, account: ACCOUNT }),
      listLibrary: () => Promise.resolve({ objects: [server.envelope()] }),
      // The as-stored fold reads and writes a preference since [P3.3]; a
      // stateless pair keeps it deterministic — every test starts folded.
      readPrefs: () => Promise.resolve({ prefs: {} }),
      patchPrefs: (patch: Record<string, unknown>) => Promise.resolve({ prefs: patch }),
      readObject: () => server.readObject(),
      updateObject: (
        kind: unknown,
        id: unknown,
        object: Record<string, unknown>,
        contentHash: string,
      ) => server.updateObject(kind, id, object, contentHash),
      deleteObject: (kind: unknown, id: unknown, contentHash: string) =>
        server.deleteObject(kind, id, contentHash),
    },
  };
});

/**
 * The **real** router, imported after the mock is registered.
 *
 * Step 8 says *navigate away and back*, and the cheap reading of that is an
 * unmount and a re-render of the same component. The real thing is available
 * for the price of one import: the editor's own "Back to the actor" link and
 * the detail page's "Edit" button make the round trip a pair of clicks, which
 * also proves the unmount is real rather than asserted. `getRouteApi`,
 * `useParams` and the `key={params.id}` remount all stay in the test instead
 * of being mocked away — and they are not incidental here, since the whole
 * failure mode is about what survives a remount.
 */
const { router } = await import('../router.js');

beforeEach(() => {
  server = makeLibrary();
});

/**
 * A fresh `QueryClient` per test — never the `queryClient` singleton from
 * `queries.ts`, which would carry one test's editor entry into the next and
 * make the F12 assertions depend on file order.
 *
 * `retry: false` only; everything else is left at TanStack's defaults on
 * purpose. **`gcTime` in particular must stay at its five minutes**: the F12
 * condition *is* an entry that is still cached when the user comes back, and a
 * test that shortened it (or ran fake timers past it) would arrange for the
 * cache miss that hides the bug.
 */
function renderApp(): QueryClient {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return client;
}

/**
 * Drives the singleton router to the editor rather than trusting jsdom's URL,
 * which is whatever the previous test navigated to. `act` because this is a
 * React state change originating outside React.
 */
async function openTheEditor(): Promise<void> {
  await act(async () => {
    await router.navigate({ to: '/library/actors/$id/edit', params: { id: ACTOR_ID } });
  });
  await screen.findByRole('textbox', { name: 'Name' });
}

/**
 * Waits for the query layer to go quiet.
 *
 * The save invalidates the editor's key, and an invalidation of an *active*
 * query starts a refetch immediately — so navigating away the instant the
 * notice appears could unmount the editor with its own refresh in flight and
 * leave the assertion depending on which promise settled first. Deliberately
 * phrased as "nothing is fetching" rather than "the editor key holds hash X":
 * the fix under test happens to be an invalidation, but a fix that wrote the
 * new envelope straight into the cache would satisfy step 8 just as well, and
 * a *waiting* helper should not be the thing that decides which is allowed.
 */
async function settled(client: QueryClient): Promise<void> {
  await waitFor(() => {
    expect(client.isFetching()).toBe(0);
  });
}

describe('a second save after leaving the editor and coming back', () => {
  /**
   * The gate step end to end, through the UI: save, leave by the link the page
   * offers, return by the one the detail page offers, save again.
   *
   * The closing assertions are one claim each, and every one of them fails
   * independently under the F12 mutation: the form came back holding the saved
   * name, the hash the second `PUT` presented is the one the *first* one
   * returned (the client adopted its own write), no dialog is on screen, and
   * the file carries both edits — the second save was not merely un-refused,
   * it landed.
   */
  it('presents the hash its own save returned, and no conflict dialog appears', async () => {
    const client = renderApp();
    await openTheEditor();

    await userEvent.type(screen.getByRole('textbox', { name: 'Name' }), ', the fixer');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('Saved.');
    await settled(client);

    // Away. The Edit link belongs to the detail page alone — the actor's
    // *name* would match on both pages, and a query that passed while the
    // editor was still mounted would test nothing at all. (The old beacon was
    // the "As stored" heading, which stopped being detail-page-only when
    // [P3.3] discharged [polish §2] and the editor gained the same fold.)
    await userEvent.click(screen.getByRole('link', { name: 'Back to the actor' }));
    await screen.findByRole('link', { name: 'Edit' });
    expect(screen.queryByRole('textbox', { name: 'Name' })).toBeNull();

    // …and back.
    await userEvent.click(screen.getByRole('link', { name: 'Edit' }));
    const name = await screen.findByRole('textbox', { name: 'Name' });

    // The form rehydrated from the cache. Under the F12 mutation this is the
    // pre-save name, which is the same staleness the hash suffers — asserted
    // because it is the half a user can see, before the half only the server
    // can.
    expect(name).toHaveProperty('value', 'Vera Solano, the fixer');

    // A different field on purpose: if the second save carried a base built
    // from the pre-save envelope, the name below would regress and the stored
    // object would say so.
    await userEvent.type(screen.getByRole('textbox', { name: 'Traits' }), 'unflappable');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('Saved.');

    // Spelled out as the whole sequence rather than as two length-and-field
    // checks: what must be true is that there were exactly two writes, that
    // neither was refused, and that the second presented what the first
    // returned. A relational assertion alone would also hold if both saves had
    // presented the same stale hash and the fake had waved both through, which
    // is the failure this file exists to notice.
    expect(server.updates).toEqual([
      { presented: 'sha256:revision-0', returned: 'sha256:revision-1' },
      { presented: 'sha256:revision-1', returned: 'sha256:revision-2' },
    ]);
    const [first, second] = server.updates;
    expect(second!.presented).toBe(first!.returned);

    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.queryByText('The actor changed while you were editing')).toBeNull();

    const onDisk = server.stored();
    expect(onDisk['name']).toBe('Vera Solano, the fixer');
    expect((onDisk['profile'] as { traits: string[] }).traits).toEqual(['unflappable']);
  });
});

describe('two saves without leaving the page', () => {
  /**
   * Step 8's other half, and the reason it is here rather than folded into the
   * test above: **adopting your own write is two mechanisms, not one.**
   *
   * The round trip exercises the cache entry (`queries.ts`); this exercises the
   * component's local `base`, which `handleSave`'s `onSuccess` replaces with
   * the envelope the `PUT` returned. They fail independently — take `setBase`
   * out and the round-trip test still passes, because the remount rebuilds the
   * base from a correctly invalidated cache and never consults the state that
   * was left behind. A user who saves twice without navigating hits this one
   * first, and would have had no test at all.
   *
   * Mutation caught: drop the `setBase` call from the save's `onSuccess` in
   * `ActorEditorPage.tsx`. The second save then presents the hash the first
   * one presented, the fake refuses it, and *Saved.* never returns.
   */
  it('presents the hash the previous save returned', async () => {
    renderApp();
    await openTheEditor();

    await userEvent.type(screen.getByRole('textbox', { name: 'Name' }), ', the fixer');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('Saved.');

    // Typing clears the notice (`patchForm`), so the second *Saved.* below is
    // the second save's own, not the first one still on screen.
    await userEvent.type(screen.getByRole('textbox', { name: 'Traits' }), 'unflappable');
    expect(screen.queryByText('Saved.')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('Saved.');

    expect(server.updates).toEqual([
      { presented: 'sha256:revision-0', returned: 'sha256:revision-1' },
      { presented: 'sha256:revision-1', returned: 'sha256:revision-2' },
    ]);
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
});

describe('a save over a change that really did arrive from elsewhere', () => {
  /**
   * The control for the test above, and the reason its silence is evidence.
   *
   * "No dialog appeared" is only a fact about the client if a dialog *can*
   * appear — a fake that accepted every write would report the same silence
   * for a client that had never adopted a hash in its life. So the same page,
   * the same fake and the same journey are run with a genuine foreign write in
   * the middle, and the dialog is required.
   *
   * It is also the one thing F12's fix must **not** break. Invalidating the
   * editor's key on save is a small step from refetching it on a timer, and
   * a base that quietly followed the file would make the 412 unreachable and
   * hand the hot-reload thesis the silent overwrite it was built to prevent
   * ([04 §4.4](../../../../docs/design/04-server-multiuser-deployment.md)).
   *
   * Mutation caught: dropping the `onError` branch in `handleSave`, or
   * loosening `useEditorBase`'s `staleTime: Infinity` into a poll.
   */
  it('opens the conflict dialog and refuses the write', async () => {
    renderApp();
    await openTheEditor();

    // A text editor writing the file while the form is open. It moves the
    // hash without the client hearing about it, which is what makes the base
    // in the form stale for a reason that is not the client's own save.
    server.handEdit({ name: 'Vera Solano, rewritten on disk' });

    await userEvent.type(screen.getByRole('textbox', { name: 'Name' }), ', the fixer');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.textContent).toContain('The actor changed while you were editing');

    // Refused, not merged: the hand edit is still what is on disk, and the
    // editor is offering the two non-destructive ways out rather than having
    // taken one.
    expect(server.stored()['name']).toBe('Vera Solano, rewritten on disk');
    expect(server.updates).toEqual([{ presented: 'sha256:revision-0', returned: null }]);
    expect(screen.queryByText('Saved.')).toBeNull();
  });
});

/**
 * Leaving with unsaved changes — [05 §11.6](../../../../docs/design/05-ui-surfaces.md).
 *
 * One test, where the lorebook editor beside this one has five. The guard is a
 * single shared component and its behaviour is proved there; what is unproved
 * anywhere else is whether **this** editor mounts it, and that is a thing two
 * editors can differ on silently. So this asserts the wiring and nothing more.
 */
describe('leaving the actor editor with unsaved changes', () => {
  it('asks first', async () => {
    renderApp();
    await openTheEditor();

    await userEvent.type(screen.getByRole('textbox', { name: 'Name' }), ', the fixer');
    await userEvent.click(screen.getByRole('link', { name: 'Back to the actor' }));

    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.textContent).toContain('This actor has unsaved changes');

    // Left where it was, so the test after this one opens on an editor rather
    // than on whatever a half-finished navigation settled into.
    await userEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });
  });
});

/**
 * Delete from the editor — the third control in the critical-controls strip
 * ([05 §11.6](../../../../docs/design/05-ui-surfaces.md)), and the one exit
 * the unsaved-changes guard must not stand in front of. The draft it would
 * offer to keep is of a file that is now in the trash; *Keep editing* would
 * keep it, in a form whose next Save the server refuses.
 *
 * The falsifying mutation is dropping `ignoreBlocker` from the navigation in
 * `library/DeleteObject.tsx`: the dialog opens over the delete, the address
 * never moves, and both closing assertions fail. The hash assertion falls to a
 * different mutation — presenting anything but the editor's base — and is here
 * because a delete on a moved file is refused by the same rule as a write.
 */
describe('deleting the actor from its editor', () => {
  it('moves it to the trash with the hash the editor holds, and leaves without asking about the draft', async () => {
    renderApp();
    await openTheEditor();

    // A draft, so that a guard which did run would have something to guard.
    await userEvent.type(screen.getByRole('textbox', { name: 'Name' }), ', the fixer');
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));

    // The question says what the trash will not hold, because the surface
    // knows there are edits nothing has written.
    expect(screen.getByText('Move to trash? Unsaved edits are not kept.')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/library');
    });
    expect(server.removals).toEqual([{ id: ACTOR_ID, presented: 'sha256:revision-0' }]);
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
});

/**
 * What a save says is said where Save is
 * ([05 §11.6](../../../../docs/design/05-ui-surfaces.md)). The notice used to
 * render above the form, which with the strip pinned halfway down a long card
 * is as far out of sight as the foot of the page. jsdom cannot see a strip
 * pin, so the claim is asserted as structure: the status stands inside the
 * form Save belongs to, which is where the strip is and where nothing above
 * the form can be. Reddened by rendering the notice above the form again.
 */
describe('what a save says', () => {
  it('says Saved. inside the strip, beside the Save that caused it', async () => {
    renderApp();
    await openTheEditor();

    await userEvent.type(screen.getByRole('textbox', { name: 'Name' }), ', the fixer');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    const status = await screen.findByText('Saved.');
    expect(status.getAttribute('role')).toBe('status');
    expect(status.closest('form')).not.toBeNull();
    expect(status.closest('form')).toBe(
      screen.getByRole('button', { name: 'Save' }).closest('form'),
    );
  });
});

/**
 * [polish §2]'s editor pane, discharged at [P3.3]: the fold shows the *saved*
 * object and says so, because showing unsaved form state as "as stored" would
 * be a lie in the one place a user came for the truth. The falsifying
 * mutation is handing the pane the form's working state instead of the base.
 */
describe("the editor's as-stored pane", () => {
  it('shows the saved object, not the form’s working state', async () => {
    renderApp();
    await openTheEditor();

    await userEvent.type(screen.getByRole('textbox', { name: 'Name' }), ', the fixer');
    await userEvent.click(screen.getByText('As stored'));

    const pane = screen.getByRole('region', { name: 'The object as stored' });
    expect(pane.textContent).toContain('"Vera Solano"');
    expect(pane.textContent).not.toContain('the fixer');
    expect(within(pane).getByText(/what a reload would find/)).toBeTruthy();
  });
});

/**
 * A save that cannot proceed is **refused, not prevented** —
 * [05 §11.1a](../../../../docs/design/05-ui-surfaces.md).
 *
 * This editor used to disable Save while the name was empty, which meant the
 * submit never fired and there was nowhere for the refusal to be said. The
 * button is live now and the write is turned away instead, which is the shape
 * [work plan §2.2](../../../../docs/design/workplan/01-work-plan.md) asks for:
 * a control that cannot work teaches nothing about why.
 *
 * Four claims, each failing on its own — the button is pressable, no write left
 * the client, the refusal stands inside the form Save belongs to (the strip,
 * which jsdom cannot see pinned), and the cursor is on the field that has to
 * answer. The last is the one a mutation removes most quietly.
 */
describe('a save with a required field empty', () => {
  it('is refused rather than prevented, and says so beside the Save that caused it', async () => {
    renderApp();
    await openTheEditor();

    const name = screen.getByRole('textbox', { name: 'Name' });
    await userEvent.clear(name);

    const save = screen.getByRole('button', { name: 'Save' });
    expect(save.hasAttribute('disabled')).toBe(false);

    await userEvent.click(save);

    // Nothing was presented to the server at all — not a rejected write, no
    // write.
    expect(server.updates).toEqual([]);

    const refusal = await screen.findByText('Name cannot be empty.');
    expect(refusal.getAttribute('role')).toBe('alert');
    expect(refusal.closest('form')).toBe(save.closest('form'));

    expect(document.activeElement).toBe(name);
  });

  it('marks the field required, and stops once it is answered', async () => {
    renderApp();
    await openTheEditor();

    const name = screen.getByRole('textbox', { name: 'Name' });
    expect(name.getAttribute('aria-required')).toBe('true');

    await userEvent.clear(name);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(server.updates).toEqual([]);

    // Typing clears the refusal rather than leaving it standing over an
    // answered field.
    await userEvent.type(name, 'Vera Kohl');
    expect(screen.queryByText('Name cannot be empty.')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('Saved.');
    expect(server.stored()['name']).toBe('Vera Kohl');
  });
});
