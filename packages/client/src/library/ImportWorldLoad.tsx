// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { Component, lazy, Suspense, type JSX, type ReactNode } from 'react';

import type { ImportedWorld, ImportPreviewWorld } from '@storyengine/shared';

import { labels } from '../i18n/catalogue.js';
import { AlertNote } from '../ui/Alert.js';
import { Note } from '../ui/Text.js';

/**
 * ***The look at a World's file, fetched when one is picked*** —
 * [P16.3f](../../../../docs/design/workplan/35-p16-world.md),
 * [21 §7.2](../../../../docs/design/21-client-loading.md).
 *
 * **Measured, then moved.** The entry measured **308.10 kB** before the
 * stage (`tools/entry-budget.test.ts`'s ceiling is 312) and **310.86** with
 * this preview and the head-slicer imported statically — past the 310 the
 * stage was told to keep under, for a panel nobody sees until they pick a
 * World's file and a line nobody sees until one has landed. Both come through
 * `lazy()` from here, from one chunk, in the setup wizard's and the changelog
 * readers' shape: a sentence while the chunk is on its way, and a boundary of
 * its own that tells only a failed load to reload, so the import panel beside
 * it stands. *That alone measured 310.23*: the modules the chunk shares with
 * the entry are split by the bundler into files of their own, and the gzip of
 * several files is more than the gzip of one. So the slicer went off the entry
 * too (`world-head.ts`, fetched when a zip is picked) — 310.01 while it still
 * imported `shared`, **309.64** once it imported nothing. Static preview with
 * the slicer off measured 310.57, so the preview stays lazy. *+1.54 kB* in all.
 *
 * *What stays on the entry* is this file: the panel's one summary line for a
 * World's file (`summary()` is synchronous, and it is a sentence), the two
 * `lazy` declarations, and the boundary — none of which imports the preview.
 */

/** A chunk the World's look needed did not arrive — the one failure a reload answers. */
export class WorldChunkError extends Error {
  constructor(cause: unknown) {
    super('The world preview’s code could not be loaded.', { cause });
    this.name = 'WorldChunkError';
  }
}

const chunk = (): Promise<typeof import('./ImportWorldPreview.js')> =>
  import('./ImportWorldPreview.js').catch((cause: unknown) => {
    throw new WorldChunkError(cause);
  });

const LazyPreview = lazy(() => chunk().then((module) => ({ default: module.ImportWorldPreview })));
const LazyLanded = lazy(() => chunk().then((module) => ({ default: module.WorldLanded })));

const WORDS = labels('import.world-load', {
  loading: 'Reading what is in this world…',
  chunk:
    'What is in this world could not be shown. If StoryEngine was updated since this page was opened, reload the page; the file can still be imported.',
  render: 'What is in this world could not be shown. The file can still be imported.',
});

/** The look, through its boundary. */
export function ImportWorldPreview(props: {
  world: ImportPreviewWorld;
  onConflict: 'replace' | 'keep-both';
  busy: boolean;
  onPolicy: (policy: 'replace' | 'keep-both') => void;
}): JSX.Element {
  return (
    <WorldLoad>
      <Suspense fallback={<Note role="status">{WORDS.loading}</Note>}>
        <LazyPreview {...props} />
      </Suspense>
    </WorldLoad>
  );
}

/** The line the review leads with after a World landed, through its boundary. */
export function WorldLanded(props: { world: ImportedWorld }): JSX.Element {
  return (
    <WorldLoad>
      <Suspense fallback={null}>
        <LazyLanded {...props} />
      </Suspense>
    </WorldLoad>
  );
}

/**
 * ***If the chunk never arrives, or fails once it has*** — local, so the
 * import panel stands: its Import and Cancel do not depend on the look, and a
 * file whose look failed can still be imported, which the sentence says.
 */
class WorldLoad extends Component<{ children: ReactNode }, { failed: 'chunk' | 'render' | null }> {
  override state: { failed: 'chunk' | 'render' | null } = { failed: null };

  static getDerivedStateFromError(error: unknown): { failed: 'chunk' | 'render' } {
    return { failed: error instanceof WorldChunkError ? 'chunk' : 'render' };
  }

  override render(): ReactNode {
    if (this.state.failed === null) return this.props.children;
    return (
      <AlertNote role="alert">
        {this.state.failed === 'chunk' ? WORDS.chunk : WORDS.render}
      </AlertNote>
    );
  }
}

/** The one line the panel's summary gives a World's file — on the entry, as `summary()` is. */
export function worldSummary(world: ImportPreviewWorld): string {
  const counted = SUMMARY.counts
    .replace(
      '{objects}',
      countPhrase(SUMMARY.objectsOne, SUMMARY.objectsMany, world.objects.length),
    )
    .replace(
      '{sessions}',
      countPhrase(SUMMARY.sessionsOne, SUMMARY.sessionsMany, world.sessions.length),
    );
  return world.world === null
    ? SUMMARY.loose.replace('{counts}', counted)
    : SUMMARY.world.replace('{name}', () => world.world?.name ?? '').replace('{counts}', counted);
}

const SUMMARY = labels('import.world-summary', {
  world: 'It would land as a world called “{name}”, with {counts}.',
  loose: 'It would land as {counts}, with no world around them.',
  counts: '{objects} and {sessions}',
  objectsOne: '1 object',
  objectsMany: '{count} objects',
  sessionsOne: '1 session',
  sessionsMany: '{count} sessions',
});

/** A count as its phrase — the one and the many are whole phrases, for a catalogue to word. */
function countPhrase(one: string, many: string, count: number): string {
  return count === 1 ? one : many.replace('{count}', String(count));
}
