// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { newPreset } from '@storyengine/shared';

/**
 * ***The editor six phase documents deferred*** — [P7B.1].
 *
 * The claim worth testing is not that a form renders. It is that **the two
 * things nothing could reach before are reachable now**: the sentence in a text
 * block's `template`, and `source.outlet` on a slot — which
 * [P5 §3](../../../../docs/design/workplan/17-p5-implementation.md) recorded as
 * *"set by no shipped preset"* with its only repair being to hand-write JSON.
 * Both assertions read the object the client actually sent, because a control
 * that updates its own state and posts something else is the failure a
 * render-only test cannot see.
 *
 * The third is [P7B §1.3]'s: **a new preset starts from a shipped pack**, not a
 * blank. A blank block list is a session that assembles nothing, and the person
 * who made one would find out at their first turn.
 */

const PRESET_ID = '01a008de-7e08-70d0-899c-f6869d6b9abc';
const SYSTEM_ID = '0199c000-0000-7000-8000-00000000e5e7';

/** A pack with one of each block kind — which is the whole of §8.1. */
function pack(id: string, name: string): Record<string, unknown> {
  return {
    ...newPreset(name),
    id,
    blocks: [
      {
        id: 'se.instruction',
        label: 'Instruction',
        role: 'system',
        enabled: true,
        priority: 100,
        template: 'You are the narrator of a scene.',
      },
      {
        id: 'se.lore',
        label: 'Lore',
        role: 'system',
        enabled: true,
        priority: 50,
        source: { kind: 'lore' },
      },
    ],
  };
}

const readObject = vi.fn();
const listLibrary = vi.fn();
const updateObject = vi.fn();
const createObject = vi.fn();
const authState = vi.fn();
const navigate = vi.fn();

let params: { id: string } = { id: PRESET_ID };

vi.mock('../api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.js')>()),
  api: {
    readObject: (...a: unknown[]) => readObject(...a) as unknown,
    listLibrary: (...a: unknown[]) => listLibrary(...a) as unknown,
    updateObject: (...a: unknown[]) => updateObject(...a) as unknown,
    createObject: (...a: unknown[]) => createObject(...a) as unknown,
    authState: (...a: unknown[]) => authState(...a) as unknown,
  },
}));

vi.mock('@tanstack/react-router', () => ({
  getRouteApi: () => ({ useParams: () => params }),
  useNavigate: () => navigate,
  useBlocker: () => ({ status: 'idle' }),
  Link: ({ children }: { children: React.ReactNode }) => <a href="#">{children}</a>,
}));

const { PresetEditorPage, NewPresetPage } = await import('./PresetEditorPage.js');

function stored(object: Record<string, unknown>, source: 'user' | 'system' = 'user') {
  return {
    id: object['id'] as string,
    schema: 'storyengine.preset/0',
    name: object['name'] as string,
    slug: 'harbour',
    source,
    contentHash: 'sha256:one',
    shadowed: false,
    object,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  params = { id: PRESET_ID };
  readObject.mockResolvedValue(stored(pack(PRESET_ID, 'Harbour')));
  listLibrary.mockResolvedValue({ objects: [stored(pack(SYSTEM_ID, 'Scene'), 'system')] });
  updateObject.mockResolvedValue({
    object: pack(PRESET_ID, 'Harbour'),
    contentHash: 'sha256:two',
  });
  createObject.mockResolvedValue({ id: 'made', slug: 'made', contentHash: 'sha256:new' });
  authState.mockResolvedValue({ account: { handle: 'ned', locale: null } });
});

function renderEditor(page: 'edit' | 'new' = 'edit'): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      {page === 'edit' ? <PresetEditorPage /> : <NewPresetPage />}
    </QueryClientProvider>,
  );
}

describe('editing the sentence that makes a mode a narrator', () => {
  it('shows a text block as prose and a slot as a position', async () => {
    renderEditor();

    expect(await screen.findByRole('heading', { name: 'Harbour' })).toBeTruthy();
    // The text block's template is a control; the slot's source is a sentence.
    expect(screen.getByLabelText('Template')).toBeTruthy();
    expect(screen.getByText(/Positions lore/)).toBeTruthy();
  });

  it('sends the edited template, not just the typed one', async () => {
    renderEditor();
    const user = userEvent.setup();

    const template = await screen.findByLabelText('Template');
    await user.clear(template);
    await user.type(template, 'You are a weary harbourmaster.');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(updateObject).toHaveBeenCalledTimes(1);
    const [, , object] = updateObject.mock.calls[0] as [string, string, Record<string, unknown>];
    const blocks = object['blocks'] as { id: string; template?: string }[];
    expect(blocks.find((b) => b.id === 'se.instruction')?.template).toBe(
      'You are a weary harbourmaster.',
    );
  });

  /**
   * [P5 §3]'s standing defect, retired. An outlet has been settable by nothing
   * since P5 and repairable only by hand-writing preset JSON; the assertion is
   * on the sent object because that is what would have had to be hand-written.
   */
  it('sets a slot block’s outlet, which nothing could do before', async () => {
    renderEditor();
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Outlet'), 'harbour-notes');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    const [, , object] = updateObject.mock.calls[0] as [string, string, Record<string, unknown>];
    const blocks = object['blocks'] as { id: string; source?: { outlet?: string } }[];
    expect(blocks.find((b) => b.id === 'se.lore')?.source?.outlet).toBe('harbour-notes');
  });

  it('reorders blocks, and the order is what the file carries', async () => {
    renderEditor();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Move se.lore up' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    const [, , object] = updateObject.mock.calls[0] as [string, string, Record<string, unknown>];
    expect((object['blocks'] as { id: string }[]).map((b) => b.id)).toEqual([
      'se.lore',
      'se.instruction',
    ]);
  });

  it('refuses to open a shipped pack, and says what to do instead', async () => {
    readObject.mockResolvedValue(stored(pack(SYSTEM_ID, 'Scene'), 'system'));
    renderEditor();

    expect(await screen.findByText(/read-only/)).toBeTruthy();
    expect(screen.queryByLabelText('Template')).toBeNull();
  });
});

describe('a new preset', () => {
  /**
   * [P7B §1.3]. The blank-page dead end [P4.5] refused for actors is worse
   * here, because an empty block list produces no error — it produces a turn
   * that narrates nothing, discovered at play time.
   */
  it('starts from a shipped pack rather than an empty block list', async () => {
    renderEditor('new');

    expect(await screen.findByLabelText('Template')).toBeTruthy();
    expect(screen.getByText(/Positions lore/)).toBeTruthy();
  });

  it('is a copy, so the shipped pack keeps its own id', async () => {
    renderEditor('new');
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText(/^Name/), 'Mine');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(createObject).toHaveBeenCalledTimes(1);
    const [, object] = createObject.mock.calls[0] as [string, Record<string, unknown>];
    expect(object['id']).not.toBe(SYSTEM_ID);
    expect(object['name']).toBe('Mine');
  });
});
