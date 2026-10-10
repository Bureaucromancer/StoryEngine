// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The detail page's first test file. P4.4 built the delete control and shipped
 * it uncovered; this is the cover, and it was written by walking the component
 * rather than the phase document — which is how both of the things it fixes
 * were found.
 *
 * **The case worth the file is the shadowed one.** Two files can hold one id;
 * `?source=&slug=` lets this page open either; and every write route resolves
 * an id to the *winner* regardless. So the Delete that P4.4 gated on `source`
 * alone would, on the losing copy, move a folder other than the one on screen —
 * F19's original bug with the stakes raised from showing the wrong object to
 * removing it. Nothing on the server can catch that, because from the server's
 * side the request is perfectly well-formed. It is caught here or not at all.
 *
 * **The second is that a refused delete used to say nothing.** The error was
 * rendered by the confirming row and the failure path collapsed that row, so a
 * 412 looked exactly like a click that had not registered.
 */

const readObject = vi.fn();
const deleteObject = vi.fn();
const takeFile = vi.fn();
const libraryErrors = vi.fn();
const createObject = vi.fn();
const authState = vi.fn();
const createSession = vi.fn();
const listSessions = vi.fn();
const navigate = vi.fn();

const ACTOR_ID = '01a008de-7e08-70d0-899c-f6869d6b9aeb';
/** What the stubbed create returns, so the navigation assertion has a target. */
const COPY_ID = '01a008de-7e08-70d0-899c-f6869d6b9abc';

let params: { kind: string; id: string } = { kind: 'actors', id: ACTOR_ID };
let search: { slug?: string; source?: 'user' | 'system' } = {};

vi.mock('../api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.js')>()),
  createSession: (...a: unknown[]) => createSession(...a) as unknown,
  listSessions: (...a: unknown[]) => listSessions(...a) as unknown,
  api: {
    readObject: (...a: unknown[]) => readObject(...a) as unknown,
    deleteObject: (...a: unknown[]) => deleteObject(...a) as unknown,
    createObject: (...a: unknown[]) => createObject(...a) as unknown,
    authState: (...a: unknown[]) => authState(...a) as unknown,
    takeFile: (...a: unknown[]) => takeFile(...a) as unknown,
    libraryErrors: (...a: unknown[]) => libraryErrors(...a) as unknown,
  },
}));

vi.mock('@tanstack/react-router', () => ({
  getRouteApi: () => ({ useParams: () => params, useSearch: () => search }),
  useNavigate: () => navigate,
  /**
   * **The stub carries the search prop**, because an entry link that dropped
   * the copy discriminator is F19 one level down — a reader of the shadowed
   * copy sent to the winner — and a stub that renders only children cannot
   * see that happen. Serialised rather than rendered as a query string so the
   * assertion reads the value the component passed rather than a formatting of
   * it.
   */
  // `data-to` as well as `data-search` since [P5.1]: the book page now carries
  // two links per entry — the name, into the read address, and Edit, into the
  // editor — and a stub that dropped the destination could not tell them apart.
  Link: ({
    children,
    to,
    search,
  }: {
    children: React.ReactNode;
    to?: string;
    search?: Record<string, unknown>;
  }) => (
    <a href="#" data-to={to ?? ''} data-search={JSON.stringify(search ?? {})}>
      {children}
    </a>
  ),
}));

const { ApiError } = await import('../api.js');
const { ObjectDetailPage } = await import('./ObjectDetailPage.js');

function actor(overrides: Record<string, unknown> = {}) {
  return {
    id: ACTOR_ID,
    schema: 'storyengine.actor/1',
    name: 'Vera Kohl',
    slug: 'vera-kohl',
    source: 'user' as const,
    contentHash: 'sha256:abc',
    shadowed: false,
    object: { schema: 'storyengine.actor/1', id: ACTOR_ID, name: 'Vera Kohl' },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  params = { kind: 'actors', id: ACTOR_ID };
  search = {};
  readObject.mockResolvedValue(actor());
  deleteObject.mockResolvedValue(undefined);
  createObject.mockResolvedValue({ id: COPY_ID, slug: 'vera-kohl-2', contentHash: 'sha256:def' });
  authState.mockResolvedValue({ account: { handle: 'ned', locale: null } });
  listSessions.mockResolvedValue({ sessions: [] });
  libraryErrors.mockResolvedValue({ errors: [] });
});

function renderPage(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ObjectDetailPage />
    </QueryClientProvider>,
  );
}

/** The control is two-step: Delete opens the question, Delete answers it. */
async function askToDelete(): Promise<ReturnType<typeof userEvent.setup>> {
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Delete' }));
  return user;
}

/**
 * ***A Setup's page is somewhere to start from*** — [P15.4](../../../../docs/design/workplan/33-p15-setup-from-a-turn.md).
 *
 * The route has taken a Setup since [P7.4]; this is the first place in the
 * browser that sends one, and it goes straight into the session it made.
 */
describe('starting a session from a setup', () => {
  const SETUP_ID = '01a008de-7e08-70d0-899c-f6869d6b9ae0';

  it('starts one from the setup and goes to it', async () => {
    params = { kind: 'setups', id: SETUP_ID };
    readObject.mockResolvedValue({
      ...actor(),
      id: SETUP_ID,
      schema: 'storyengine.setup/1',
      name: 'The Ledger, Lost',
      object: { schema: 'storyengine.setup/1', id: SETUP_ID, name: 'The Ledger, Lost' },
    });
    createSession.mockResolvedValue({ session: { id: 'session-new' } });
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Start a session' }));

    expect(createSession).toHaveBeenCalledWith({ setup: SETUP_ID });
    await vi.waitFor(() => {
      expect(navigate).toHaveBeenCalledWith({
        to: '/play/$sessionId',
        params: { sessionId: 'session-new' },
      });
    });
  });

  it('is not offered on anything that is not a setup', async () => {
    renderPage();
    await screen.findByRole('button', { name: 'Delete' });

    expect(screen.queryByRole('button', { name: 'Start a session' })).toBeNull();
  });
});

describe('deleting a library object', () => {
  it('offers Delete on something the user owns', async () => {
    renderPage();

    expect(await screen.findByRole('button', { name: 'Delete' })).toBeTruthy();
  });

  it('does not offer Delete on a system object', async () => {
    readObject.mockResolvedValue(actor({ source: 'system' }));
    renderPage();

    // The heading proves the page rendered rather than the query still pending,
    // which is what would otherwise make this pass for the wrong reason.
    expect(await screen.findByRole('heading', { name: 'Vera Kohl' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
  });

  /**
   * The reason this file exists — see the header. Reddened by dropping
   * `!object.shadowed` from `mutable`, which is what P4.4 shipped.
   */
  it('does not offer Delete on a shadowed copy, whose id resolves elsewhere', async () => {
    search = { source: 'user', slug: 'vera-kohl-2' };
    readObject.mockResolvedValue(actor({ shadowed: true, slug: 'vera-kohl-2' }));
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Vera Kohl' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
  });

  it('asks before it deletes, and sends the hash the page read', async () => {
    renderPage();
    const user = await askToDelete();

    expect(screen.getByText('Move to trash?')).toBeTruthy();
    expect(deleteObject).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Delete' }));

    expect(deleteObject).toHaveBeenCalledWith('actors', ACTOR_ID, 'sha256:abc');
  });

  it('sends nothing when the question is cancelled', async () => {
    renderPage();
    const user = await askToDelete();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByText('Move to trash?')).toBeNull();
    expect(deleteObject).not.toHaveBeenCalled();
  });

  /**
   * The destination and nothing more. The control is shared with the editors
   * since it moved into the critical-controls strip, and it carries
   * `ignoreBlocker` for their sake — an unsaved-changes guard has nothing to
   * defend once the object is in the trash. This page mounts no blocker, so
   * the flag's effect is proved where one exists (`ActorEditorPage.test.tsx`)
   * and not pinned here, where it would be a claim about nothing.
   */
  it('goes back to the library once it is gone', async () => {
    renderPage();
    const user = await askToDelete();

    await user.click(screen.getByRole('button', { name: 'Delete' }));

    await vi.waitFor(() => {
      expect(navigate).toHaveBeenCalledWith(expect.objectContaining({ to: '/library' }));
    });
  });

  /**
   * A 412 is the whole reason the hash is sent, and it used to be invisible:
   * the failure path collapses the confirming row and the message was rendered
   * only by that row. Reddened by moving the message back inside it.
   */
  it('says so when the file changed underneath, instead of looking like nothing happened', async () => {
    deleteObject.mockRejectedValue(
      new ApiError(412, 'stale', 'The object has changed since it was read.'),
    );
    renderPage();
    const user = await askToDelete();

    await user.click(screen.getByRole('button', { name: 'Delete' }));

    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'The object has changed since it was read.',
    );
    expect(navigate).not.toHaveBeenCalled();
  });

  /**
   * ***It leaves first, and does not read again what it deleted*** —
   * 2026-09-27. The refresh ran before the navigation and reset the entry this
   * page was watching, so the object just deleted was read again — a `404`,
   * retried a second later — and the page showed *Loading…* for it until the
   * navigation finally ran. Reddened by putting the reset back.
   */
  it('leaves for the library without re-reading what it deleted', async () => {
    renderPage();
    const user = await askToDelete();

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await vi.waitFor(() => {
      expect(navigate).toHaveBeenCalled();
    });
    // TanStack starts a refetch on a timer, so its absence needs one to pass.
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(readObject).toHaveBeenCalledTimes(1);
  });

  /**
   * **And the shelf it lands on is read fresh**, not shown from a cached list
   * that still holds the row just deleted. Reddened by dropping the
   * inactive-entry removal.
   */
  it('does not hand the shelf a cached list with the deleted object in it', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(['library', 'actors'], { objects: [actor()] });
    render(
      <QueryClientProvider client={client}>
        <ObjectDetailPage />
      </QueryClientProvider>,
    );
    const user = await askToDelete();

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await vi.waitFor(() => {
      expect(navigate).toHaveBeenCalled();
    });

    expect(client.getQueryData(['library', 'actors'])).toBeUndefined();
  });
});

/**
 * ***The file a copy's page hands over is that copy*** (2026-09-27).
 *
 * An id resolves to the winner, and these are plain anchors to routes keyed by
 * id — so on the page of a shadowed copy, which is reached through
 * `?source=&slug=` and shows the right file, *Download* and *Export* handed over
 * the other one under this one's heading. The address travels now, and only
 * where it changes the answer.
 */
describe('taking an object with you', () => {
  const SHADOWED = `?source=user&slug=vera-kohl-2`;

  function hrefOf(name: string): string | null {
    return screen.getByRole('link', { name }).getAttribute('href');
  }

  it('downloads and exports the shadowed copy on screen, not the winner', async () => {
    search = { source: 'user', slug: 'vera-kohl-2' };
    readObject.mockResolvedValue(actor({ shadowed: true, slug: 'vera-kohl-2' }));
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Vera Kohl' })).toBeTruthy();
    expect(hrefOf('Download this actor')).toBe(
      `/api/library/actors/${ACTOR_ID}/download${SHADOWED}`,
    );
    expect(hrefOf('Export as Aventuras character')).toBe(
      `/api/library/actors/${ACTOR_ID}/export/aventuras.character${SHADOWED}`,
    );
  });

  it('names the id alone when the copy on screen is the one it resolves to', async () => {
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Vera Kohl' })).toBeTruthy();
    expect(hrefOf('Download this actor')).toBe(`/api/library/actors/${ACTOR_ID}/download`);
  });

  /**
   * The World's export route takes an id and nothing narrower, so from a
   * shadowed copy it would bundle the winner — offered nowhere rather than
   * wrongly. (The package's, until [P16.0] renamed the kind and its route.)
   */
  it('offers a world bundle only on the copy its id resolves to', async () => {
    params = { kind: 'worlds', id: ACTOR_ID };
    const world = {
      schema: 'storyengine.world/1',
      name: 'Harbour set',
      slug: 'harbour-set',
      object: { schema: 'storyengine.world/1', id: ACTOR_ID, name: 'Harbour set' },
    };
    readObject.mockResolvedValue(actor(world));
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Harbour set' })).toBeTruthy();
    expect(hrefOf('Export this world')).toBe(`/api/library/worlds/${ACTOR_ID}/export`);
    // ***Still the Package's file*** ([P16 §1.1]: the envelope is not touched
    // at P16.0), and the page says so rather than letting the kind's new name
    // imply a new format.
    expect(
      screen.getByText('A .sepack.json file, the same format a package exported to.'),
    ).toBeTruthy();
  });

  it('withholds the world bundle on a shadowed copy', async () => {
    params = { kind: 'worlds', id: ACTOR_ID };
    search = { source: 'user', slug: 'harbour-set-2' };
    readObject.mockResolvedValue(
      actor({
        schema: 'storyengine.world/1',
        name: 'Harbour set',
        slug: 'harbour-set-2',
        shadowed: true,
        object: { schema: 'storyengine.world/1', id: ACTOR_ID, name: 'Harbour set' },
      }),
    );
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Harbour set' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Export this world' })).toBeNull();
    // The object itself still downloads, as that copy.
    expect(hrefOf('Download this world')).toBe(
      `/api/library/worlds/${ACTOR_ID}/download?source=user&slug=harbour-set-2`,
    );
  });
});

/**
 * ***A file that broke after it was read, said where it is opened***
 * (2026-09-28) — gap round A5.8.
 *
 * The index keeps the last good version of an object whose file stops reading,
 * so this page showed it as current, offered Edit, and said nothing; the panel
 * over the list was the only place that knew. The row is matched by where the
 * file is, which is all a broken file still has.
 */
describe('an object whose file could not be read', () => {
  function brokenRow(over: Record<string, unknown> = {}) {
    return {
      path: 'users/ned/library/actors/vera-kohl/card.png',
      source: 'user',
      kind: 'storyengine.actor/1',
      slug: 'vera-kohl',
      reason: 'schema',
      detail: '/name must be string',
      seenAt: 0,
      ...over,
    };
  }

  it('says so where it is opened, withholds Edit, and keeps Delete', async () => {
    libraryErrors.mockResolvedValue({ errors: [brokenRow()] });
    renderPage();

    expect(
      await screen.findByText(/The file on disk could not be read, so this is the last version/),
    ).toBeTruthy();
    expect(
      screen.getByText(
        'It is this kind of object with something missing, or something of the wrong type.',
      ),
    ).toBeTruthy();
    expect(screen.getByText('/name must be string')).toBeTruthy();
    expect(screen.getByText('users/ned/library/actors/vera-kohl/card.png')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Edit' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeTruthy();
  });
});

/**
 * ***What the answer said, said*** (2026-09-28) — gap round A5.4 and A5.5.
 *
 * These were plain links, so the answer went to the browser: an export's notes
 * and a package's missing count (a World's, since [P16.0]) were headers
 * nothing read, and a refused download was a JSON body saved as the file. A
 * plain click is fetched now, and each test here is one thing the page could
 * not say before.
 */
describe('what a download or an export says', () => {
  /** jsdom has no object URLs and no real downloads, so both are captured. */
  function captureSaves(): string[] {
    const names: string[] = [];
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:fake');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      names.push(this.download);
    });
    return names;
  }

  function taken(over: Record<string, unknown> = {}) {
    return { blob: new Blob(['{}']), fileName: 'Vera-Kohl.json', notes: [], missing: 0, ...over };
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('says what an export left out, under the link it came from', async () => {
    const saved = captureSaves();
    takeFile.mockResolvedValue(
      taken({
        notes: [
          { key: 'export.aventuras.sectionsFolded', params: { count: 2, sections: 'Voice, Past' } },
        ],
      }),
    );
    renderPage();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('link', { name: 'Export as Aventuras character' }));

    expect(takeFile).toHaveBeenCalledWith(
      `/api/library/actors/${ACTOR_ID}/export/aventuras.character`,
    );
    expect((await screen.findByRole('status')).textContent).toBe(
      '2 sections were folded into one description: Voice, Past.',
    );
    expect(saved).toEqual(['Vera-Kohl.json']);
  });

  it('says how many objects a world export could not include', async () => {
    captureSaves();
    params = { kind: 'worlds', id: ACTOR_ID };
    readObject.mockResolvedValue(
      actor({
        schema: 'storyengine.world/1',
        name: 'Harbour set',
        slug: 'harbour-set',
        object: { schema: 'storyengine.world/1', id: ACTOR_ID, name: 'Harbour set' },
      }),
    );
    takeFile.mockResolvedValue(taken({ fileName: 'Harbour-set.sepack.json', missing: 2 }));
    renderPage();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('link', { name: 'Export this world' }));

    expect(takeFile).toHaveBeenCalledWith(`/api/library/worlds/${ACTOR_ID}/export`);
    expect((await screen.findByRole('status')).textContent).toBe(
      '2 objects this world names are not in your library, so the file does not carry them.',
    );
  });

  it('says why a download failed, and saves nothing', async () => {
    const saved = captureSaves();
    takeFile.mockRejectedValue(new ApiError(404, 'not-found', 'That object is not there.'));
    renderPage();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('link', { name: 'Download this actor' }));

    expect((await screen.findByRole('alert')).textContent).toBe(
      'That is not here any more, so there was nothing to download.',
    );
    expect(saved).toEqual([]);
  });

  it('leaves a modified click to the browser', async () => {
    captureSaves();
    takeFile.mockResolvedValue(taken());
    renderPage();
    const link = await screen.findByRole('link', { name: 'Download this actor' });
    // jsdom would try to follow the link, which it cannot; the page's own
    // handler has run by the time this one does.
    const stay = (event: Event): void => {
      event.preventDefault();
    };
    document.addEventListener('click', stay);
    fireEvent.click(link, { ctrlKey: true });
    document.removeEventListener('click', stay);
    // A mutation runs its function a tick after it is asked, so *not called*
    // straight after the click would pass either way. A plain click after it
    // is fetched; had the first been taken, it would be the only call.
    fireEvent.click(screen.getByRole('link', { name: 'Export as Aventuras character' }));

    await vi.waitFor(() => {
      expect(takeFile).toHaveBeenCalled();
    });
    expect(takeFile.mock.calls).toEqual([
      [`/api/library/actors/${ACTOR_ID}/export/aventuras.character`],
    ]);
  });

  it("says a lorebook's pictures stay behind, counting its entries' too", async () => {
    params = { kind: 'lorebooks', id: ACTOR_ID };
    const row = (id: string) => ({
      id,
      role: 'map',
      mime: 'image/png',
      digest: 'sha256:00',
      bytes: 4,
      ref: `assets/${id}.png`,
      tags: [],
    });
    readObject.mockResolvedValue(
      actor({
        schema: 'storyengine.lorebook/1',
        name: 'Ardent',
        object: {
          schema: 'storyengine.lorebook/1',
          id: ACTOR_ID,
          name: 'Ardent',
          description: '',
          enabled: true,
          scanDepth: 2,
          tokenBudget: 2048,
          entryLimit: 100,
          recursiveScanning: false,
          maxRecursionDepth: 3,
          tags: [],
          folders: [],
          media: [row('m1')],
          entries: [
            {
              id: 'e1',
              name: 'Harbour',
              content: 'Cranes.',
              keys: [],
              enabled: true,
              media: [row('m2')],
            },
          ],
        },
      }),
    );
    renderPage();

    expect(
      await screen.findByText(
        'Its 2 pictures stay behind: the file names them and does not carry them.',
      ),
    ).toBeTruthy();
  });

  it("says nothing of an actor's pictures, which its card carries", async () => {
    readObject.mockResolvedValue(
      actor({
        object: {
          schema: 'storyengine.actor/1',
          id: ACTOR_ID,
          name: 'Vera Kohl',
          media: [{ id: 'x', ref: 'blob:1' }],
        },
      }),
    );
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Vera Kohl' })).toBeTruthy();
    expect(screen.queryByText(/stays? behind/)).toBeNull();
  });
});

/**
 * The critical controls moved from the header to a strip held at the foot of
 * the page ([10 §11.6](../../../../docs/design/10-ui-surfaces.md)), and the way
 * back went with them — which turned it from the thing the page opened with
 * into a thing every branch of the loader has to render on its own. The
 * branch most likely to lose it is the one nobody walks on purpose: the object
 * that is not there. Reddened by dropping `<Controls />` from the error branch.
 */
describe('the way back', () => {
  it('is offered even when there is no object to show', async () => {
    readObject.mockRejectedValue(new ApiError(404, 'not-found', 'No such object.'));
    renderPage();

    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'There is no such object in your library.',
    );
    expect(screen.getByRole('link', { name: 'Back to the library' })).toBeTruthy();
  });
});

/**
 * [P5.−1] — [polish §1](../../../../docs/design/workplan/06-polish.md)'s stage,
 * and its *ends at* stated as a test: an actor's greeting is readable on its
 * detail page without opening the editor.
 *
 * The page's own share of that item is small — the field rendering is
 * [ByField](./ByField.tsx)'s and is covered there — so what is asserted here is
 * the wiring and the two decisions the page makes: that the fields come before
 * the storage block rather than after it, and that the Edit gate now asks one
 * question instead of naming a kind twice.
 */
describe('reading an object without opening the editor', () => {
  const GREETING = 'She looks up.\n\n"You came."';

  function withGreeting() {
    return actor({
      object: {
        schema: 'storyengine.actor/1',
        id: ACTOR_ID,
        name: 'Vera Kohl',
        openings: {
          written: [{ id: 'op-1', label: 'At the door', text: GREETING }],
          seeds: [],
          primaryWrittenId: 'op-1',
          primarySeedId: null,
        },
      },
    });
  }

  it('shows the greeting on the page, with its paragraphs', async () => {
    readObject.mockResolvedValue(withGreeting());
    renderPage();

    await screen.findByRole('heading', { name: 'Vera Kohl' });

    const shown = [...document.querySelectorAll('p')].find((node) => node.textContent === GREETING);
    expect(shown).toBeTruthy();
  });

  /**
   * Order is the item's argument, not decoration: its complaint is that this
   * page answers *where is this file* when the question was *what does it say*,
   * and seven rows of path and hash above the prose would answer in the old
   * order with a new component underneath.
   */
  it('puts the fields above the storage block, which keeps its own heading', async () => {
    readObject.mockResolvedValue(withGreeting());
    renderPage();

    const storage = await screen.findByRole('heading', { name: 'Storage', level: 2 });
    const greeting = [...document.querySelectorAll('p')].find(
      (node) => node.textContent === GREETING,
    );

    expect(greeting).toBeTruthy();
    expect(
      greeting!.compareDocumentPosition(storage) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('offers Edit on a kind that has an editor', async () => {
    renderPage();

    expect(await screen.findByRole('link', { name: 'Edit' })).toBeTruthy();
  });

  /**
   * ~~Four kinds have no editor to land in~~ ***none do, from [P7B.6]*** — so
   * the case this asserted is gone and the claim is the other one: a kind that
   * *does* have an editor offers Edit, and treatments were the exemplar of the
   * absence precisely because they were the most obviously missing.
   */
  it('offers Edit on a treatment too, which had none until P7B', async () => {
    params = { kind: 'treatments', id: ACTOR_ID };
    readObject.mockResolvedValue(actor({ schema: 'storyengine.treatment/1' }));
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Vera Kohl' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Edit' })).toBeTruthy();
  });
});

/**
 * [P5.0] — the detail route renders a lorebook as a book, and renders a file
 * that is not one as whatever it actually is.
 *
 * **The second is the one worth the test.** A hand-edited card is the storage
 * thesis working ([00 §3.4]), so a book page that threw on a file whose
 * `entries` is a string would be answering the invited input with a white
 * screen. Found by mutation: dropping the shape guard left every other
 * assertion green, because no test reached the page with a broken book.
 */
describe('a lorebook on the detail route', () => {
  function lorebook(over: Record<string, unknown>) {
    const { shadowed, ...body } = over;
    return actor({
      schema: 'storyengine.lorebook/1',
      name: 'Ardent',
      ...(shadowed === undefined ? {} : { shadowed }),
      object: {
        schema: 'storyengine.lorebook/1',
        id: ACTOR_ID,
        name: 'Ardent',
        description: '',
        enabled: true,
        scanDepth: 2,
        tokenBudget: 2048,
        entryLimit: 100,
        recursiveScanning: false,
        maxRecursionDepth: 3,
        tags: [],
        folders: [],
        entries: [],
        ...body,
      },
    });
  }

  it('reads as a book rather than as a field list', async () => {
    params = { kind: 'lorebooks', id: ACTOR_ID };
    readObject.mockResolvedValue(
      lorebook({
        entries: [{ id: 'e1', name: 'Harbour', content: 'Cranes.', keys: [], enabled: true }],
      }),
    );
    renderPage();

    await screen.findByRole('heading', { name: 'Ardent' });
    expect(screen.getByRole('heading', { name: 'Harbour', level: 3 })).toBeTruthy();
    expect(screen.getByText('Cranes.')).toBeTruthy();
  });

  /**
   * **F19, one level down.** Two files can hold one id, this page can be
   * addressed at either through `?source=` and `?slug=`, and an entry link that
   * dropped them would send a reader of the shadowed copy to the winner — the
   * same bug the row link was fixed for, wearing an entry id. The current
   * search is spread into every entry address for exactly this reason.
   */
  it('carries the copy discriminator into every entry address', async () => {
    params = { kind: 'lorebooks', id: ACTOR_ID };
    search = { source: 'user', slug: 'ardent-2' };
    readObject.mockResolvedValue(
      lorebook({
        shadowed: true,
        entries: [{ id: 'e-1', name: 'Harbour', content: 'Cranes.', keys: [], enabled: true }],
      }),
    );
    renderPage();

    await screen.findByRole('heading', { name: 'Ardent' });
    const entryLink = screen.getByRole('link', { name: 'Harbour' });

    expect(JSON.parse(entryLink.getAttribute('data-search') ?? '{}')).toEqual({
      source: 'user',
      slug: 'ardent-2',
      entry: 'e-1',
    });
  });

  /**
   * **[10 §5.3] by name**: *"the edit affordance is a link into the editor **at
   * the entry's address**."* The page header's Edit cannot be it — that link is
   * one component shared by every kind and passes no search params — so without
   * this the editor's `?entry=` would have no producer but the URL bar.
   */
  it('offers an Edit link into the editor at each entry’s own address', async () => {
    params = { kind: 'lorebooks', id: ACTOR_ID };
    readObject.mockResolvedValue(
      lorebook({
        entries: [{ id: 'e-1', name: 'Harbour', content: 'Cranes.', keys: [], enabled: true }],
      }),
    );
    renderPage();

    await screen.findByRole('heading', { name: 'Ardent' });

    /*
     * **Two of them, and the difference is the whole point.** The header's Edit
     * and the entry's Edit both go to the editor — they are the same route —
     * and only the search tells them apart: the header opens the book with
     * nothing selected, because that link is shared by every kind and carries
     * no search at all.
     */
    const addresses = screen
      .getAllByRole('link', { name: 'Edit' })
      .map((found) => [found.getAttribute('data-to'), found.getAttribute('data-search')]) as [
      string,
      string,
    ][];

    expect(addresses).toHaveLength(2);
    expect(addresses.every(([to]) => to === '/library/lorebooks/$id/edit')).toBe(true);
    expect(addresses.map(([, search]) => JSON.parse(search) as unknown)).toContainEqual({
      entry: 'e-1',
    });
  });

  /**
   * **Withheld rather than made to lie**, through the same `mutable` predicate
   * the header's Edit and Delete go through: every write resolves an id to the
   * winner, so an *Edit* on the losing copy of a duplicated id would open the
   * editor over a different file than the one on screen. The entry's *name*
   * link stays — reading the shadowed copy is exactly what this page is for.
   */
  it('withholds it on a shadowed copy, where the write would land elsewhere', async () => {
    params = { kind: 'lorebooks', id: ACTOR_ID };
    readObject.mockResolvedValue(
      lorebook({
        shadowed: true,
        entries: [{ id: 'e-1', name: 'Harbour', content: 'Cranes.', keys: [], enabled: true }],
      }),
    );
    renderPage();

    await screen.findByRole('heading', { name: 'Ardent' });
    expect(screen.getByRole('link', { name: 'Harbour' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Edit' })).toBeNull();
  });

  /**
   * ***A memory remembered from an archived session names it*** (2026-09-27).
   * The page read the live list of sessions, so an origin that had only been
   * archived — restorable, one control away on its own page — read *a session
   * you have deleted*, of a session nobody had deleted.
   */
  it('names the session a memory came from when that session is archived', async () => {
    params = { kind: 'lorebooks', id: ACTOR_ID };
    listSessions.mockImplementation((options?: { archived?: boolean }) =>
      Promise.resolve({
        sessions:
          options?.archived === true
            ? [
                {
                  id: 's-dry',
                  name: 'The dry year',
                  createdAt: '2026-09-08T00:00:00Z',
                  updatedAt: '2026-09-20T00:00:00Z',
                  headTurnId: null,
                  archivedAt: '2026-09-20T00:00:00Z',
                },
              ]
            : [],
      }),
    );
    readObject.mockResolvedValue(
      lorebook({
        provenance: { source: 'session' },
        entries: [
          {
            id: 'e-1',
            name: 'Harbour',
            content: 'Cranes.',
            keys: [],
            enabled: true,
            metadata: { 'se.memory': { sessionId: 's-dry', at: null } },
          },
        ],
      }),
    );
    renderPage();

    expect(await screen.findByRole('link', { name: 'The dry year' })).toBeTruthy();
    expect(screen.queryByText('a session you have deleted')).toBeNull();
  });

  it('falls back to the field list when the file is not a book, rather than failing', async () => {
    params = { kind: 'lorebooks', id: ACTOR_ID };
    readObject.mockResolvedValue(lorebook({ entries: 'someone hand-edited this' }));
    renderPage();

    // The page renders, and it renders what is on disk: the by-field view shows
    // the field as the string it now is, and no book page claims otherwise.
    await screen.findByRole('heading', { name: 'Ardent' });
    expect(screen.getByText('someone hand-edited this')).toBeTruthy();
    expect(screen.queryByRole('columnheader', { name: 'Gate' })).toBeNull();
  });
});

/**
 * ***Copy to my library*** — [10 §5], [09 §4.3], built at [P7B.0].
 *
 * **Specified at P1 and unbuildable until now**, because the system scope was
 * shipped empty: there was nothing anywhere in the app that could be copied, so
 * an action *in place of edit* had no object to be in place of. P7B.0 puts each
 * mode's prompt pack there and the button acquires a subject.
 *
 * The case worth the most here is the third one. A fork that silently dropped a
 * field this build does not recognise would be a lossy copy of the one thing a
 * user reached for the action to keep exactly — and it would be invisible,
 * because everything the *client* knows about would survive it.
 */
describe('copying a system object into your own library', () => {
  it('offers Copy in place of Edit, on a system object', async () => {
    readObject.mockResolvedValue(actor({ source: 'system' }));
    renderPage();

    expect(await screen.findByRole('button', { name: 'Copy to my library' })).toBeTruthy();
  });

  it('does not offer it on something the user already owns', async () => {
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Vera Kohl' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Copy to my library' })).toBeNull();
  });

  it('copies every field verbatim, changing only the id', async () => {
    readObject.mockResolvedValue(
      actor({
        source: 'system',
        object: {
          schema: 'storyengine.actor/1',
          id: ACTOR_ID,
          name: 'Vera Kohl',
          // A field this build has never heard of. [04 §2]'s rule is that a
          // reader preserves one, and a fork is a read followed by a write.
          somethingLater: { kept: true },
        },
      }),
    );
    renderPage();

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Copy to my library' }));

    expect(createObject).toHaveBeenCalledTimes(1);
    const [kind, written] = createObject.mock.calls[0] as [string, Record<string, unknown>];
    expect(kind).toBe('actors');
    expect(written['name']).toBe('Vera Kohl');
    expect(written['somethingLater']).toEqual({ kept: true });
    expect(written['id']).not.toBe(ACTOR_ID);
    expect(typeof written['id']).toBe('string');
    // Naming the shipped actor, so the copy is written into its card — the
    // portrait and expressions a JSON copy left behind (2026-09-27).
    expect(createObject.mock.calls[0]?.[2]).toBe(ACTOR_ID);
  });

  it('goes to the copy rather than leaving the reader on the original', async () => {
    readObject.mockResolvedValue(actor({ source: 'system' }));
    renderPage();

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Copy to my library' }));

    expect(navigate).toHaveBeenCalledWith({
      to: '/library/$kind/$id',
      params: { kind: 'actors', id: COPY_ID },
    });
  });

  it('says so when the write is refused, rather than looking like a dead button', async () => {
    readObject.mockResolvedValue(actor({ source: 'system' }));
    createObject.mockRejectedValue(
      new ApiError(409, 'conflict', 'An object with that id already exists.'),
    );
    renderPage();

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Copy to my library' }));

    expect(await screen.findByText(/already exists/)).toBeTruthy();
  });
});
