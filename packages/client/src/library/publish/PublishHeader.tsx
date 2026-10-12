// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { useMutation } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { JSX, MouseEvent } from 'react';

import type { FoundNode, PublishPreview } from '@storyengine/shared';

import { api, ApiError, kindOfSchema } from '../../api.js';
import { Alert, AlertNote } from '../../ui/Alert.js';
import { link } from '../../ui/classes.js';
import { Note, PageTitle } from '../../ui/Text.js';
import { kindWord } from './kind-words.js';
import { REFUSAL_WORDS, WORDS } from './words.js';

/**
 * ***What is being published, said first*** — [P16.3g](../../../../../docs/design/workplan/34-p16-world.md):
 * *Rain City — a world* / *5 things you chose*.
 *
 * **The heading is the thing's own name**, the World's or the object's, and a
 * count for a selection, which has none yet — the line under it says which of
 * the three starts this is, because what is *kept* follows from it ([16 §2],
 * [16 §3]) and the person should not have to work that out from the choices
 * further down.
 *
 * ***A selection that matches a World already kept says so*** (`sameAs`):
 * [16 §3]'s *publishing the same World twice produces two files and one
 * object* — and a selection published twice would produce two. The link goes
 * to that World's own review, which keeps nothing new.
 */
export function PublishHeader(props: { preview: PublishPreview }): JSX.Element {
  const { closure, sameAs } = props.preview;
  const root = closure.nodes.find((node) => node.key === closure.roots[0]);
  const title =
    closure.origin === 'selection'
      ? WORDS.selectionTitle.replace('{count}', String(closure.roots.length))
      : closure.origin === 'world'
        ? (closure.world?.name ?? props.preview.suggestedName)
        : props.preview.suggestedName;
  const lead =
    closure.origin === 'world'
      ? WORDS.worldLead
      : closure.origin === 'selection'
        ? WORDS.selectionLead
        : WORDS.objectLead.replace(
            '{kind}',
            root?.state === 'found' ? kindWord(root.schema) : kindWord(''),
          );
  return (
    <header className="mb-6 flex flex-col gap-2">
      <Note>{WORDS.title}</Note>
      <PageTitle className="break-words">{title}</PageTitle>
      <Note>{lead}</Note>
      {sameAs.map((world) => (
        <Alert key={world.id} tone="neutral">
          <Link to="/library/publish" search={{ world: world.id }} className={link.inline}>
            {WORDS.sameAs.replace('{name}', () => world.name)}
          </Link>
        </Alert>
      ))}
    </header>
  );
}

/** A file the page hands to the browser to save — `save-file.ts`'s shape, passed in by the route. */
export interface SavedFile {
  blob: Blob;
  fileName: string | null;
}

/**
 * ***Just the object*** — [16 §2]: *"When an object's closure turns out to be
 * the object alone, the review says so and offers Download beside it, because
 * nothing more than the object would leave."*
 *
 * **Download is the primary button here** ([P16.3]'s plan), and Publish stays
 * below as it is: a person may still want the World file — a reader who only
 * opens those — and the review does not take the choice away, only says which
 * door one object on its own is for. *Live*, from `fileSet`'s own note rather
 * than the preview's `justTheObject`, which is the server's answer at the
 * defaults: tick a built-in preset beside the actor and the file is no longer
 * the actor alone, so this goes.
 *
 * ***Unless Download would leave its pictures behind*** (2026-10-11, the P16.3g
 * review). An actor downloads as its card, which carries every picture; every
 * other kind downloads as its JSON, which names its pictures and leaves their
 * bytes in the folder — gap round A5.5's sentence on the detail page — while
 * the World file this review would write carries them beside it. So for a
 * book, a treatment or a setup with pictures the sentence says what each door
 * hands over, and Download is offered as a plain link rather than pressed on
 * the person as *what one object on its own is for*.
 *
 * ***A plain click is fetched***, the detail page's arrangement since gap round
 * A5.4 — ~~a plain anchor, the detail page's arrangement for a file~~, which
 * it had not been since 2026-09-28: a link hands the answer to the browser,
 * and a refusal (the object gone since the review was drawn, a sign-in that
 * ended) is a JSON body the browser saves as the file. So the address stays on
 * the element, a modified click stays the browser's, and a plain one goes
 * through `api.takeFile`, is saved with the route's `saveFile`, and a refusal
 * is said under the link.
 */
export function JustTheObject(props: {
  node: FoundNode;
  onFile: (file: SavedFile) => void;
}): JSX.Element | null {
  const take = useMutation({
    mutationFn: (href: string) => api.takeFile(href),
    onSuccess: props.onFile,
  });
  const kind = kindOfSchema(props.node.schema);
  if (kind === null) return null;
  const pictures = kind === 'actors' ? 0 : (props.node.facts?.pictures.count ?? 0);
  const words = kindWord(props.node.schema);
  const follow = (event: MouseEvent<HTMLAnchorElement>): void => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    if (take.isPending) return;
    take.mutate(event.currentTarget.getAttribute('href') ?? '');
  };
  return (
    <Alert tone="neutral" className="mb-6">
      <p className="mb-3">
        {pictures === 0
          ? WORDS.just.replace('{name}', () => props.node.name).replace('{kind}', words)
          : WORDS.justPictures
              .replace('{name}', () => props.node.name)
              .replace('{kind}', words)
              .replace('{count}', String(pictures))}
      </p>
      <a
        href={`/api/library/${kind}/${encodeURIComponent(props.node.id)}/download`}
        className={pictures === 0 ? link.action : link.inline}
        onClick={follow}
        download
      >
        {WORDS.download.replace('{kind}', words)}
      </a>
      {take.isPending ? (
        <Note role="status">{WORDS.downloading}</Note>
      ) : take.error === null ? null : (
        <AlertNote role="alert" className="mt-2">
          {downloadFailure(take.error)}
        </AlertNote>
      )}
    </Alert>
  );
}

/** By the class the server sends, as the detail page says it (`takeFailureLine`). */
function downloadFailure(failure: Error): string {
  if (!(failure instanceof ApiError)) return REFUSAL_WORDS.downloadUnreachable;
  if (failure.code === 'not-found') return REFUSAL_WORDS.downloadGone;
  return REFUSAL_WORDS.downloadFailed;
}
