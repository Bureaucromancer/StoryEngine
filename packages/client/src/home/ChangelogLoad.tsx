// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { Component, lazy, type JSX, type LazyExoticComponent, type ReactNode } from 'react';

import { AlertNote } from '../ui/Alert.js';

/**
 * ***The changelog is fetched with the surfaces that read it, not with every
 * first load*** — [21 §7.3](../../../../docs/design/21-client-loading.md),
 * 2026-10-07.
 *
 * Until this date `CHANGELOG.md` and the renderer that draws it were on the
 * common entry: paid for by a first load of the sign-in page, the library and
 * Settings alike, for a document read once per upgrade. And the text grows with
 * every tag — alpha 5's notes alone were 3.51 kB of
 * `tools/entry-budget.test.ts`'s ceiling — so the entry was set to meet that
 * ceiling on a schedule rather than by accident. The two surfaces that read it
 * are now `lazy()`: home's release ([HomeRelease](./HomeRelease.tsx), which
 * carries the renderer) and the workbench's list of releases
 * (`workbench/home/ReleaseSubject.tsx`), both through [readers.ts](./readers.ts)
 * and so one chunk, with [log.ts](./log.ts) in it. **One parse still**, which is
 * the guarantee `log.ts` exists for, and the reason this is a split at the
 * readers rather than an `import()` of the text in each.
 *
 * This file is what the two boundaries share, and it is on the entry on
 * purpose: it imports nothing that reads the changelog. *[21 §7.2]'s shape*,
 * the setup wizard's — a sentence while the chunk is on its way, and a local
 * boundary that tells only a failed load to reload — without the wizard's
 * *Dismiss*, because nothing here was opened by a button and nothing here
 * could be closed.
 */

/**
 * ***A chunk the changelog's readers needed did not arrive*** — the one failure
 * a reload answers, told apart from every other by its type rather than by its
 * message, which is the browser's and differs between them.
 */
export class ChangelogChunkError extends Error {
  constructor(cause: unknown) {
    super('The changelog’s code could not be loaded.', { cause });
    this.name = 'ChangelogChunkError';
  }
}

/**
 * `lazy()`, with the load's rejection wrapped — the setup wizard's factory, for
 * a component that is one of the changelog's readers. Wrapped here, the one
 * place that knows the failure is a *load*, so {@link ChangelogLoad} can say
 * *reload* to the failure a reload fixes and something plainer to a bug, which a
 * reload would only repeat.
 *
 * Declared at module scope by the callers, as `lazy` requires: a declaration
 * made during render would be a new component on every render, and its state
 * would be thrown away each time.
 */
export function lazyChangelogReader<P extends object>(
  load: () => Promise<(props: P) => JSX.Element>,
): LazyExoticComponent<(props: P) => JSX.Element> {
  return lazy(() =>
    load().then(
      (component) => ({ default: component }),
      (cause: unknown) => {
        throw new ChangelogChunkError(cause);
      },
    ),
  );
}

/**
 * ***What a reader of the changelog shows if its chunk never arrives, or fails
 * once it has.*** Local, so the page beside it stands:
 * [21 §5](../../../../docs/design/21-client-loading.md)'s *"a failed inspector
 * should leave the page beside it usable"* — on home that is the title and the
 * line under it, and in the workbench it is the dock's frame and its *Close*.
 * Without it the nearest boundary is the router's `RouteErrorCard`, which would
 * replace the whole page over one document.
 *
 * **It guards the render as well as the load, and says which.** The likelier
 * failure on a self-hosted install is the one 21 §5 names — an upgrade replaced
 * the server while this tab was open, and the chunk the tab knows by name is
 * gone — and only that one is told to reload. *No Try again*, for the wizard's
 * reason: `lazy` caches a rejection as it caches a success, so a retry through
 * the same declaration fails without asking the network.
 *
 * *Resetting it is the caller's job*, by a `key`: home keys it on the release
 * the address names, so a document that failed to draw does not hold the next
 * one hostage; the workbench unmounts it whenever the subject leaves `/`.
 */
export class ChangelogLoad extends Component<
  { children: ReactNode; className?: string },
  { failed: 'chunk' | 'render' | null }
> {
  override state: { failed: 'chunk' | 'render' | null } = { failed: null };

  static getDerivedStateFromError(error: unknown): { failed: 'chunk' | 'render' } {
    return { failed: error instanceof ChangelogChunkError ? 'chunk' : 'render' };
  }

  override render(): ReactNode {
    if (this.state.failed === null) return this.props.children;
    return (
      <AlertNote
        role="alert"
        {...(this.props.className === undefined ? {} : { className: this.props.className })}
      >
        {this.state.failed === 'chunk'
          ? 'This build’s changelog could not be loaded. If StoryEngine was updated since this page was opened, reload the page to fetch the new version.'
          : 'The changelog stopped with an error. The rest of the page is unaffected.'}
      </AlertNote>
    );
  }
}
