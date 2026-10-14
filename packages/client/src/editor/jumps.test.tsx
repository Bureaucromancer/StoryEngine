// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { JSX } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import {
  newActor,
  newLoreEntry,
  newLorebook,
  newPreset,
  newSetup,
  newTreatment,
  newWorld,
  type EmbeddedMedia,
} from '@storyengine/shared';

import { LIBRARY_KINDS, type Account, type LibraryKind, type LibraryObject } from '../api.js';
import { KIND_WORDS } from '../library/labels.js';
import { fieldsOf, groupsOf, loreEntrySchema } from '../library/fields.js';
import { JumpChips, JumpRegistry, JumpSection, useJumpRegistry } from './jumps.js';

/**
 * ***Section jumps and the identity header, over the key set*** —
 * [P12A](../../../../docs/design/workplan/35-p12a-the-look.md) P12A.7, under
 * its §0.4.
 *
 * The stage's four claims, each held where it can fail:
 *
 * - **A chip for every section, and a section for every chip.** Held twice:
 *   on a bare registry, where a section can be drawn late, drawn out of turn,
 *   renamed and removed at will; and over every editor the library has, the
 *   loop `contract.test.tsx` uses for the same reason — a claim about *the
 *   editors* that runs over the editors somebody remembered is a claim about
 *   the day it was written.
 * - **A jump into a shut fold opens it** and gives its heading the keyboard —
 *   on a lore entry's banner groups, which start shut, and the book's hook
 *   fold, which does.
 * - **The header says kind, name and picture for all six kinds**, with the
 *   fallback each kind gives when there is no picture or it will not load.
 * - **No tabs.** Not in any editor drawn, and not in the client's source.
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

function picture(id: string): EmbeddedMedia {
  return {
    id,
    role: 'reference',
    mime: 'image/png',
    digest: `sha256:${id}`,
    bytes: 4,
    ref: `media/${id}.png`,
    tags: [],
  };
}

const HARBOUR = '01a008de-7e08-70d0-899c-00000000a001';
const BRIDGE = '01a008de-7e08-70d0-899c-00000000a002';

/**
 * One object per kind, from the shared factories, each with the pictures that
 * make its header's answer worth asking: **the lorebook's cover is its second
 * picture**, so a header that took the first would be caught; the treatment
 * and the World carry one; the setup carries none, so its header is the kind
 * and the name alone; the preset has no `media` at all.
 */
function fixtures(): Record<LibraryKind, Record<string, unknown>> {
  const book = newLorebook('Harbour lore') as unknown as Record<string, unknown>;
  const harbour = { ...newLoreEntry('Harbour'), id: HARBOUR };
  const bridge = { ...newLoreEntry('Bridge'), id: BRIDGE };
  return {
    actors: { ...(newActor('Vera Solano') as unknown as Record<string, unknown>) },
    lorebooks: {
      ...book,
      entries: [harbour, bridge],
      media: [picture('map'), picture('cover')],
      primaryMediaId: 'cover',
    },
    treatments: {
      ...(newTreatment('Rain City') as unknown as Record<string, unknown>),
      media: [picture('skyline')],
    },
    setups: { ...(newSetup('A night at the docks') as unknown as Record<string, unknown>) },
    presets: { ...(newPreset('House style') as unknown as Record<string, unknown>) },
    worlds: {
      ...(newWorld('The harbour set') as unknown as Record<string, unknown>),
      media: [picture('chart')],
    },
  };
}

let FIXTURES = fixtures();

/** A fixed id per kind: the router is a module singleton, as `contract.test.tsx` says. */
function idOf(kind: LibraryKind): string {
  return `01a008de-7e08-70d0-899c-00000000000${String(LIBRARY_KINDS.indexOf(kind))}`;
}

function envelopeFor(kind: LibraryKind): LibraryObject {
  const object: Record<string, unknown> = { ...FIXTURES[kind], id: idOf(kind) };
  return {
    id: idOf(kind),
    schema: object['schema'] as string,
    name: object['name'] as string,
    slug: 'fixture',
    source: 'user',
    contentHash: 'sha256:fixture',
    shadowed: false,
    object: structuredClone(object),
  };
}

vi.mock('../api.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api.js')>();
  return {
    ...actual,
    listSessions: () => Promise.resolve({ sessions: [] }),
    api: {
      ...actual.api,
      authState: () => Promise.resolve({ setupRequired: false, account: ACCOUNT }),
      listLibrary: () => Promise.resolve({ objects: [] }),
      readPrefs: () => Promise.resolve({ prefs: {} }),
      patchPrefs: (patch: Record<string, unknown>) => Promise.resolve({ prefs: patch }),
      readObject: (kind: unknown) => Promise.resolve(envelopeFor(kind as LibraryKind)),
      listTags: () => Promise.resolve({ tags: [] }),
    },
  };
});

const { router } = await import('../router.js');
const { api } = await import('../api.js');

function renderApp(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

const ROUTES: Record<LibraryKind, string> = {
  actors: '/library/actors/$id/edit',
  lorebooks: '/library/lorebooks/$id/edit',
  treatments: '/library/treatments/$id/edit',
  setups: '/library/setups/$id/edit',
  presets: '/library/presets/$id/edit',
  worlds: '/library/worlds/$id/edit',
};

async function openEditor(kind: LibraryKind, entry?: string): Promise<void> {
  await act(async () => {
    await router.navigate({
      to: ROUTES[kind],
      params: { id: idOf(kind) },
      ...(kind === 'lorebooks' ? { search: entry === undefined ? {} : { entry } } : {}),
    });
  });
  await screen.findByRole('heading', { level: 1, name: FIXTURES[kind]['name'] as string });
  // The chips arrive a render after the sections, which register as they mount.
  await screen.findByRole('navigation', { name: 'Jump to a section' });
}

function chips(): HTMLElement[] {
  return within(screen.getByRole('navigation', { name: 'Jump to a section' })).getAllByRole(
    'button',
  );
}

function chip(name: string): HTMLElement {
  return within(screen.getByRole('navigation', { name: 'Jump to a section' })).getByRole('button', {
    name,
  });
}

function chipNames(): string[] {
  return chips().map((chip) => chip.textContent);
}

function form(): HTMLElement {
  const found = screen.getByRole('button', { name: 'Save' }).closest('form');
  if (found === null) throw new Error('no form');
  return found;
}

function header(): HTMLElement {
  const found = screen.getByRole('heading', { level: 1 }).closest('header');
  if (found === null) throw new Error('no header');
  return found;
}

/** What a chip took the reader to: the heading that has the keyboard. */
function landedOn(chip: HTMLElement): HTMLElement {
  fireEvent.click(chip);
  const at = document.activeElement;
  if (!(at instanceof HTMLElement) || !/^H[1-6]$/.test(at.tagName)) {
    throw new Error(`${chip.textContent} took the keyboard nowhere a heading is`);
  }
  return at;
}

/** The setup file's stub, watched — `SettingsPage.test.tsx`'s way of asking whether a jump scrolled. */
let scrolled: MockInstance<Element['scrollIntoView']>;

beforeEach(() => {
  FIXTURES = fixtures();
  scrolled = vi.spyOn(Element.prototype, 'scrollIntoView');
});

afterEach(() => {
  scrolled.mockRestore();
  document.documentElement.style.removeProperty('--transition-duration-arrive');
});

/**
 * ***The registry on its own***, where every way a section can come and go is
 * in a test's hands. A section drawn late is drawn here between two that were
 * there first, which is the case the page's order exists for.
 */
function Sections(props: { middle: boolean; last: string }): JSX.Element {
  const { jumps, register } = useJumpRegistry();
  return (
    <JumpRegistry value={register}>
      <JumpChips jumps={jumps} />
      <JumpSection title="First">
        <p>one</p>
      </JumpSection>
      {props.middle ? (
        <JumpSection title="Middle">
          <p>two</p>
        </JumpSection>
      ) : null}
      <details>
        <summary>Shut</summary>
        <JumpSection title={props.last}>
          <p>three</p>
        </JumpSection>
      </details>
    </JumpRegistry>
  );
}

describe('a chip for every section, and a section for every chip', () => {
  it('draws one chip per section, in the order the page has them', async () => {
    const { rerender } = render(<Sections middle={false} last="Last" />);
    await waitFor(() => {
      expect(chipNames()).toEqual(['First', 'Last']);
    });

    // Drawn after the others mounted, and above one of them.
    rerender(<Sections middle last="Last" />);
    await waitFor(() => {
      expect(chipNames()).toEqual(['First', 'Middle', 'Last']);
    });
  });

  it('takes the chip away with its section, and renames it with its heading', async () => {
    const { rerender } = render(<Sections middle last="Last" />);
    await waitFor(() => {
      expect(chipNames()).toEqual(['First', 'Middle', 'Last']);
    });

    rerender(<Sections middle={false} last="Last" />);
    await waitFor(() => {
      expect(chipNames()).toEqual(['First', 'Last']);
    });

    rerender(<Sections middle={false} last="Renamed" />);
    await waitFor(() => {
      expect(chipNames()).toEqual(['First', 'Renamed']);
    });
  });

  it('draws no row of chips for a page with no sections', () => {
    function Empty(): JSX.Element {
      const { jumps } = useJumpRegistry();
      return <JumpChips jumps={jumps} />;
    }
    render(<Empty />);
    expect(screen.queryByRole('navigation')).toBeNull();
  });

  for (const kind of LIBRARY_KINDS) {
    /**
     * ***Every editor, the claim both ways.*** Every region in the form as the
     * fixture draws it — every `JumpSection`, which is what each `<section>`
     * and `SectionTitle` pair in an editor now is — has exactly one chip. The
     * one other region the form can hold, the import review `EntryTravel`
     * draws after a file is read, is a passing report beside the button that
     * asked for it, with a subsection heading. It is deliberately not a
     * section with a chip, and the fixture never imports. And every chip
     * lands on a heading in the form that says what the chip says. The
     * headings a chip reaches outside a region (an actor's sections, a lore
     * entry's groups) are counted by the second half: no two chips land on
     * one heading. *And every section heading in the form is one a chip
     * reaches* — a level-two heading is a section of the editor in all four,
     * so a `<section>` and `SectionTitle` pair left unconverted, which no
     * region check would see, is a heading no chip lands on.
     */
    it(`holds in the ${kind} editor`, async () => {
      renderApp();
      await openEditor(kind, kind === 'lorebooks' ? HARBOUR : undefined);

      const names = chipNames();
      expect(names.length).toBeGreaterThan(0);
      for (const region of within(form()).getAllByRole('region')) {
        const name = region.getAttribute('aria-labelledby');
        const heading = name === null ? null : document.getElementById(name);
        expect(heading, 'a region named by its heading').not.toBeNull();
        expect(names.filter((chip) => chip === heading?.textContent)).toHaveLength(1);
      }

      const reached = new Set<HTMLElement>();
      for (const chip of chips()) {
        const heading = landedOn(chip);
        expect(form().contains(heading)).toBe(true);
        expect(heading.textContent.startsWith(chip.textContent)).toBe(true);
        reached.add(heading);
      }
      expect(reached.size).toBe(names.length);
      for (const heading of within(form()).getAllByRole('heading', { level: 2, hidden: true })) {
        expect(reached.has(heading), `${heading.textContent} has a chip`).toBe(true);
      }
    });
  }

  /**
   * ***A section that is there only while an entry is selected*** — the
   * entry's own, named by the entry, and the seven groups its schema's
   * banners make, each a chip in the schema's words.
   */
  it('registers the selected entry and its groups, and lets them go with the selection', async () => {
    renderApp();
    await openEditor('lorebooks', HARBOUR);

    const groups = groupsOf(fieldsOf(loreEntrySchema(), newLoreEntry('Harbour')))
      .map((group) => group.title)
      .filter((title): title is string => title !== null);
    expect(groups.length).toBeGreaterThan(0);
    const names = chipNames();
    expect(names).toContain('Harbour');
    for (const title of groups) expect(names).toContain(title);
    // In the page's order: the book's sections, the entry and its groups,
    // and the hook fold last, where it stands on the page.
    expect(names.indexOf('Entries')).toBeLessThan(names.indexOf('Harbour'));
    expect(names.indexOf('Harbour')).toBeLessThan(names.indexOf(groups[0] ?? ''));
    expect(names.at(-1)).toBe('Plot hooks');

    await openEditor('lorebooks', BRIDGE);
    await waitFor(() => {
      expect(chipNames()).toContain('Bridge');
    });
    expect(chipNames()).not.toContain('Harbour');

    await openEditor('lorebooks');
    await waitFor(() => {
      expect(chipNames()).not.toContain('Bridge');
    });
    for (const title of groups) expect(chipNames()).not.toContain(title);
    expect(chipNames()).toContain('Entries');
  });

  it('follows an entry renamed in the form', async () => {
    renderApp();
    await openEditor('lorebooks', HARBOUR);

    const name = screen.getByRole('textbox', { name: 'Name' });
    await userEvent.clear(name);
    await userEvent.type(name, 'Quay');
    await waitFor(() => {
      expect(chipNames()).toContain('Quay');
    });
    expect(chipNames()).not.toContain('Harbour');
  });
});

describe('a jump into a shut fold', () => {
  it('opens a lore entry’s group and gives its heading the keyboard', async () => {
    renderApp();
    await openEditor('lorebooks', HARBOUR);

    const heading = screen
      .getAllByRole('heading', { level: 4 })
      .find((one) => one.textContent.startsWith('Timing'));
    const fold = heading?.closest('details');
    if (fold === undefined || fold === null) throw new Error('no Timing fold');
    expect(fold.open).toBe(false);

    fireEvent.click(chip('Timing'));
    expect(fold.open).toBe(true);
    expect(document.activeElement).toBe(heading);
    expect(scrolled).toHaveBeenCalled();
  });

  it('opens the book’s hook fold, whose heading is inside it', async () => {
    renderApp();
    await openEditor('lorebooks');

    const heading = screen.getByRole('heading', { name: 'Plot hooks', hidden: true });
    const fold = heading.closest('details');
    if (fold === null) throw new Error('no hook fold');
    expect(fold.open).toBe(false);

    fireEvent.click(chip('Plot hooks'));
    expect(fold.open).toBe(true);
    expect(document.activeElement).toBe(heading);
  });

  it('opens every fold around a heading, not only the nearest', async () => {
    render(
      <details>
        <summary>Outer</summary>
        <details>
          <summary>Inner</summary>
          <Sections middle={false} last="Deep" />
        </details>
      </details>,
    );
    const chip = await screen.findByRole('button', { name: 'Deep' });
    fireEvent.click(chip);
    for (const fold of document.querySelectorAll('details')) expect(fold.open).toBe(true);
    expect(document.activeElement?.textContent).toBe('Deep');
  });
});

/**
 * ***The scroll moves only if motion is wanted***, read from the token the
 * reduced-motion block zeroes. jsdom reads no stylesheet, so each case writes
 * the token on the root as `index.css` would leave it.
 */
describe('how a jump moves the page', () => {
  async function jumpWith(token: string | null): Promise<unknown> {
    if (token !== null) {
      document.documentElement.style.setProperty('--transition-duration-arrive', token);
    }
    render(<Sections middle={false} last="Last" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Last' }));
    return scrolled.mock.calls.at(-1)?.[0];
  }

  it('scrolls smoothly when the arrival token has a length', async () => {
    expect(await jumpWith('300ms')).toEqual({ block: 'start', behavior: 'smooth' });
  });

  it('is simply there when reduced motion has zeroed it', async () => {
    expect(await jumpWith('0s')).toEqual({ block: 'start', behavior: 'auto' });
  });

  it('is simply there when the token cannot be read at all', async () => {
    expect(await jumpWith(null)).toEqual({ block: 'start', behavior: 'auto' });
  });
});

describe('the identity header, for every kind', () => {
  /** What each kind's header should draw in the picture's place. */
  const EXPECTED: Record<LibraryKind, string | null> = {
    actors: api.avatarUrl(idOf('actors'), 'sha256:fixture'),
    lorebooks: api.mediaUrl('lorebooks', idOf('lorebooks'), 'cover', 'sha256:cover'),
    treatments: api.mediaUrl('treatments', idOf('treatments'), 'skyline', 'sha256:skyline'),
    setups: null,
    presets: null,
    worlds: api.mediaUrl('worlds', idOf('worlds'), 'chart', 'sha256:chart'),
  };

  for (const kind of LIBRARY_KINDS) {
    it(`says the ${kind} editor's kind, name and picture`, async () => {
      renderApp();
      await openEditor(kind);

      const head = header();
      expect(within(head).getByText(KIND_WORDS[kind])).toBeTruthy();
      expect(within(head).getByRole('heading', { level: 1 }).textContent).toBe(
        FIXTURES[kind]['name'],
      );
      const expected = EXPECTED[kind];
      const image = head.querySelector('img');
      if (expected === null) {
        // None is an answer: no picture, and nothing drawn in its place.
        expect(image).toBeNull();
        expect(head.querySelector('[aria-hidden="true"]')).toBeNull();
      } else {
        expect(image?.getAttribute('src')).toBe(expected);
      }
    });
  }

  it('draws an actor’s tile when the card will not load', async () => {
    renderApp();
    await openEditor('actors');
    const image = header().querySelector('img');
    if (image === null) throw new Error('no card drawn');
    fireEvent.error(image);
    expect(header().querySelector('img')).toBeNull();
    expect(header().querySelector('[aria-hidden="true"]')?.textContent).toBe('VS');
  });

  it('draws nothing for a cover that will not load, rather than a broken picture', async () => {
    renderApp();
    await openEditor('lorebooks');
    const image = header().querySelector('img');
    if (image === null) throw new Error('no cover drawn');
    fireEvent.error(image);
    expect(header().querySelector('img')).toBeNull();
    expect(header().querySelector('[aria-hidden="true"]')).toBeNull();
  });

  it('shows no picture for a book that has chosen no cover, even when it has pictures', async () => {
    FIXTURES.lorebooks['primaryMediaId'] = null;
    renderApp();
    await openEditor('lorebooks');
    expect(header().querySelector('img')).toBeNull();
  });

  /**
   * *A picture is an image*: `media` may carry other bytes — nothing in the
   * schema says otherwise — and the first row a header could take is not a
   * picture if the browser cannot draw it.
   */
  it('passes over media that is not a picture to the first that is', async () => {
    FIXTURES.treatments['media'] = [{ ...picture('theme'), mime: 'audio/ogg' }, picture('skyline')];
    renderApp();
    await openEditor('treatments');
    expect(header().querySelector('img')?.getAttribute('src')).toBe(
      api.mediaUrl('treatments', idOf('treatments'), 'skyline', 'sha256:skyline'),
    );
  });

  it('draws a new actor as its tile, without asking for a card that does not exist', async () => {
    renderApp();
    await act(async () => {
      await router.navigate({ to: '/library/actors/new' });
    });
    await screen.findByRole('heading', { level: 1, name: 'New actor' });
    expect(within(header()).getByText(KIND_WORDS.actors)).toBeTruthy();
    expect(header().querySelector('img')).toBeNull();
    expect(header().querySelector('[aria-hidden="true"]')).not.toBeNull();
  });

  it('keeps the actor’s note that the card travels with the file', async () => {
    renderApp();
    await openEditor('actors');
    expect(
      within(header()).getByText(
        'The card image travels with the file; this editor shows it and does not replace it.',
      ),
    ).toBeTruthy();
  });
});

describe('never tabs', () => {
  for (const kind of LIBRARY_KINDS) {
    it(`draws no tab in the ${kind} editor`, async () => {
      renderApp();
      await openEditor(kind, kind === 'lorebooks' ? HARBOUR : undefined);
      expect(
        document.querySelectorAll('[role="tab"], [role="tablist"], [role="tabpanel"]'),
      ).toHaveLength(0);
    });
  }

  /**
   * ***And nowhere in the client's source*** — [10 §1.3]'s *tabs would break
   * both* is a rule about every surface, and a tab widget added anywhere would
   * be one an editor could reach for next. Read as text, so a role spelled in
   * an object literal is found as well as one in markup.
   */
  it('has no tab role in the client at all', () => {
    const root = join(import.meta.dirname, '..');
    const sources = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) return sources(path);
        return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
      });
    const files = sources(root);
    expect(files.length).toBeGreaterThan(100);
    const offenders = files.filter((path) =>
      /role\s*[=:]\s*\{?\s*['"]tab(?:list|panel)?['"]/.test(readFileSync(path, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });
});
