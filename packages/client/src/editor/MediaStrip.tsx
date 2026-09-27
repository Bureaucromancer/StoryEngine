// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { useRef, useState, type JSX } from 'react';

import { uuidv7, type EmbeddedMedia, type MediaRole } from '@storyengine/shared';

import { api, type LibraryKind } from '../api.js';
import { labels } from '../i18n/catalogue.js';
import { Button } from '../ui/Button.js';
import { Field } from '../ui/Field.js';
import { Fine, Note } from '../ui/Text.js';

/**
 * ***Image slots, uploaded, cropped and replaced*** —
 * [10 §11.2b](../../../../docs/design/10-ui-surfaces.md),
 * [10 §11](../../../../docs/design/10-ui-surfaces.md)'s second capability,
 * [P11](../../../../docs/design/workplan/28-p11-implementation.md).
 *
 * ***One component for both places***, because §11.2b describes one thing twice:
 * *"the book gets a gallery"* and *"each entry gets its own strip, small and
 * inline with the entry rather than behind a tab — the point is seeing the place
 * while writing about it, and a gallery you have to navigate to is one you
 * forget is there."* The difference between them is a cover control and a size,
 * which are props.
 *
 * ***`role` and `tags` read as different kinds of thing, deliberately.***
 * §11.2b: *"role is a short pick-list the software understands, tags are free
 * text the author organises by. Getting this wrong in the UI produces tag soup
 * in the role field."* So role is a `select` over the closed union and tags is a
 * text field, and they do not look alike.
 *
 * ***And nothing here suggests the images are used.*** §11.2b is explicit: *"they
 * are not sent, and an editor implying otherwise would be making a promise the
 * engine does not keep — which matters more than usual here, because it is
 * exactly the assumption the schema warns against."* The line under the strip is
 * that sentence, said once and kept short.
 */

const WORDS: Readonly<Record<string, string>> = labels('editor.media', {
  add: 'Add a picture',
  adding: 'Adding…',
  replace: 'Replace',
  remove: 'Remove',
  cover: 'Use as the cover',
  isCover: 'The cover',
  role: 'Role',
  label: 'Label',
  tags: 'Tags',
  'tags-hint': 'Comma-separated, and yours: nothing in the engine reads them.',
  empty: 'No pictures yet.',
  'not-an-image': 'That file is not a PNG, JPEG or WebP image.',
  'too-large': 'That file is larger than this install allows.',
  failed: 'That picture could not be added.',
  /**
   * §11.2b's own sentence, and the reason it is here rather than in a tooltip:
   * a reader who does not see it will assume the opposite, which the schema
   * warns is the natural assumption and the expensive one.
   */
  unused: 'Pictures are stored with the book and are never sent to a model.',
});

const ROLES: readonly MediaRole[] = [
  'reference',
  'gallery',
  'map',
  'background',
  'style',
  'pose',
  'expression',
  'portrait-source',
];

const ROLE_WORDS: Readonly<Record<string, string>> = labels('editor.media-role', {
  reference: 'Reference — the canonical likeness',
  gallery: 'Gallery — one of many',
  map: 'Map',
  background: 'Background',
  style: 'Style reference',
  pose: 'Pose',
  expression: 'Expression',
  'portrait-source': 'Portrait source',
});

/**
 * ***The crop, in the browser*** — §11's *"uploaded, cropped and replaced"*.
 *
 * **A centred square rather than a rubber band**, and that is the honest version
 * of this control at 1.0: a strip renders square thumbnails, so what a crop is
 * *for* here is stopping a wide photograph from being letterboxed into one. A
 * drag-to-choose rectangle is a better tool and is a surface of its own; what it
 * would add over this is choosing *which* square, which is worth having and is
 * not worth blocking the feature on.
 *
 * ***It re-encodes to PNG*** — lossless, so a crop of a crop does not decay, and
 * one output type means the sniffer on the far side has one less case. The cost
 * is size on a photograph, which a person who wants the original keeps by not
 * cropping.
 *
 * Returns the original bytes unchanged when the image is already square, when
 * the canvas is unavailable, or when anything throws: **a crop that fails is a
 * picture that uploads uncropped**, never a picture that fails to upload.
 */
export async function squareCrop(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const side = Math.min(bitmap.width, bitmap.height);
    if (bitmap.width === bitmap.height) {
      bitmap.close();
      return file;
    }
    const canvas = document.createElement('canvas');
    canvas.width = side;
    canvas.height = side;
    const context = canvas.getContext('2d');
    if (context === null) {
      bitmap.close();
      return file;
    }
    context.drawImage(
      bitmap,
      Math.round((bitmap.width - side) / 2),
      Math.round((bitmap.height - side) / 2),
      side,
      side,
      0,
      0,
      side,
      side,
    );
    bitmap.close();
    const cropped = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/png');
    });
    return cropped ?? file;
  } catch {
    return file;
  }
}

export function MediaStrip(props: {
  kind: LibraryKind;
  /** The object the bytes are stored beside — always the book, even for an entry's strip. */
  objectId: string;
  media: readonly EmbeddedMedia[];
  /**
   * ***A change to the list, never the list*** (2026-09-27).
   *
   * An upload lands after an `await`, and the list this component had when it
   * started is the list as it was then: appending to `props.media` wrote back a
   * strip without whatever was labelled, retagged or removed while the picture
   * was on its way. So every change here is an updater, and the page applies it
   * to the list as the form holds it when the change arrives.
   *
   * *The cover is the synchronous case of the same bug.* Removing the picture
   * that is the cover is two writes — the row, then `onCover(null)` — and when
   * both were whole books built from one render, the second restored the first:
   * the cover was unset and the picture stayed. Two updaters apply in order.
   */
  onChange: (update: (media: readonly EmbeddedMedia[]) => EmbeddedMedia[]) => void;
  /** The book's gallery designates one; an entry's strip does not. */
  coverId?: string | null;
  onCover?: (mediaId: string | null) => void;
  /** Whether a fresh picture should be cropped square before it is sent. */
  crop?: boolean;
}): JSX.Element {
  const picker = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  /** The row being replaced, or null when the picker is adding a new one. */
  const [replacing, setReplacing] = useState<string | null>(null);

  function patch(id: string, over: Partial<EmbeddedMedia>): void {
    props.onChange((media) => media.map((one) => (one.id === id ? { ...one, ...over } : one)));
  }

  async function take(file: File): Promise<void> {
    setBusy(true);
    setProblem(null);
    try {
      const blob = props.crop === false ? file : await squareCrop(file);
      const { asset } = await api.uploadAsset(props.kind, props.objectId, blob, file.name);
      const target = replacing;
      if (target === null) {
        // The row is made out here and only appended inside: React runs an
        // updater twice under StrictMode, and a uuid minted inside one would
        // name a different row each time.
        const row: EmbeddedMedia = { id: uuidv7(), role: 'gallery', tags: [], ...asset };
        props.onChange((media) => [...media, row]);
      } else {
        // **Replace keeps the row.** Its id, role, label and tags are the
        // author's decisions about a slot; the bytes are what is being swapped,
        // and re-deriving the rest would make *replace* a *remove and add*.
        patch(target, asset);
      }
    } catch (failure: unknown) {
      const code = (failure as { body?: { error?: string } }).body?.error;
      setProblem(WORDS[code ?? ''] ?? WORDS['failed'] ?? '');
    } finally {
      setBusy(false);
      setReplacing(null);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <input
        ref={picker}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        aria-hidden="true"
        tabIndex={-1}
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file === undefined) return;
          void take(file);
        }}
      />

      {props.media.length === 0 ? (
        <Note>{WORDS['empty']}</Note>
      ) : (
        <ul className="flex flex-wrap gap-3">
          {props.media.map((one) => (
            <li key={one.id} className="flex w-44 flex-col gap-1">
              <img
                src={`/api/library/${props.kind}/${props.objectId}/media/${one.id}`}
                alt={one.label ?? ''}
                className="aspect-square w-full rounded-control border border-line object-cover"
              />
              <Field
                label={WORDS['label'] ?? 'Label'}
                value={one.label ?? ''}
                onChange={(label) => {
                  patch(one.id, { label });
                }}
              />
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-ink-subtle">{WORDS['role']}</span>
                <select
                  className="rounded-control border border-line-strong bg-surface p-1 text-ink"
                  value={one.role}
                  onChange={(event) => {
                    patch(one.id, { role: event.target.value as MediaRole });
                  }}
                >
                  {ROLES.map((role) => (
                    <option key={role} value={role}>
                      {ROLE_WORDS[role] ?? role}
                    </option>
                  ))}
                </select>
              </label>
              <Field
                label={WORDS['tags'] ?? 'Tags'}
                value={one.tags.join(', ')}
                hint={WORDS['tags-hint'] ?? ''}
                onChange={(text) => {
                  patch(one.id, {
                    tags: text
                      .split(',')
                      .map((tag) => tag.trim())
                      .filter((tag) => tag !== ''),
                  });
                }}
              />
              <div className="flex flex-wrap gap-1">
                <Button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setReplacing(one.id);
                    picker.current?.click();
                  }}
                >
                  {WORDS['replace']}
                </Button>
                <Button
                  type="button"
                  variant="quiet"
                  onClick={() => {
                    props.onChange((media) => media.filter((row) => row.id !== one.id));
                    // A cover that has been removed is no cover — the schema
                    // tolerates a dangling id and nothing is served by leaving
                    // one behind. A second write, applied after the first rather
                    // than over it: see `onChange`.
                    if (props.coverId === one.id) props.onCover?.(null);
                  }}
                >
                  {WORDS['remove']}
                </Button>
                {props.onCover === undefined ? null : props.coverId === one.id ? (
                  <Fine>{WORDS['isCover']}</Fine>
                ) : (
                  <Button
                    type="button"
                    variant="quiet"
                    onClick={() => {
                      props.onCover?.(one.id);
                    }}
                  >
                    {WORDS['cover']}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center gap-2">
        <Button
          type="button"
          disabled={busy}
          onClick={() => {
            setReplacing(null);
            picker.current?.click();
          }}
        >
          {busy ? WORDS['adding'] : WORDS['add']}
        </Button>
        {problem === null ? (
          <Fine>{WORDS['unused']}</Fine>
        ) : (
          <p role="alert" className="text-sm text-danger-ink">
            {problem}
          </p>
        )}
      </div>
    </div>
  );
}
