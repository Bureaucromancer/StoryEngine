// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { useRef, useState, type JSX } from 'react';

import { uuidv7, type EmbeddedMedia, type MediaRole, type SourceRect } from '@storyengine/shared';

import { api, errorCode, type LibraryKind } from '../api.js';
import { labels } from '../i18n/catalogue.js';
import { Button } from '../ui/Button.js';
import { TwoStep } from '../ui/TwoStep.js';
import { Field } from '../ui/Field.js';
import { Fine, Note } from '../ui/Text.js';
import { CommaField } from './ListField.js';

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
  'replace-named': 'Replace picture {n}',
  remove: 'Remove',
  'remove-named': 'Remove picture {n}',
  'remove-question': 'Remove this picture? Nothing is written until you save.',
  cover: 'Use as the cover',
  'cover-named': 'Use picture {n} as the cover',
  isCover: 'The cover',
  role: 'Role',
  label: 'Label',
  tags: 'Tags',
  'tags-hint': 'Comma-separated, and yours: nothing in the engine reads them.',
  empty: 'No pictures yet.',
  'not-an-image': 'That file is not a PNG, JPEG or WebP image.',
  'too-large': 'That file is larger than this install allows.',
  failed: 'That picture could not be added.',
  'save-first': 'Pictures are stored beside the saved book. Save it once, then add them here.',
  /**
   * §11.2b's own sentence, and the reason it is here rather than in a tooltip:
   * a reader who does not see it will assume the opposite, which the schema
   * warns is the natural assumption and the expensive one.
   */
  unused: 'Pictures are stored with the book and are never sent to a model.',
});

/**
 * ***A picture's buttons say which picture*** (2026-10-01, polish 11). Every
 * picture in the strip has a *Replace*, a *Remove* and a *Use as the cover*,
 * so four pictures were twelve buttons a screen reader's list of buttons
 * showed as three names four times — a list nobody can choose from. By number,
 * as the composer's pictures already are: a label is the author's and may be
 * blank or shared, and the number is the order on the screen.
 */
function numbered(key: string, n: number): string {
  return (WORDS[key] ?? '').replace('{n}', String(n));
}

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
 * ***The crop, as a rectangle on the row*** — §11's *"uploaded, cropped and
 * replaced"*, and [10 §11.3]'s *"cropping never costs you the original."*
 *
 * **A centred square rather than a rubber band**, and that is the honest version
 * of this control at 1.0: a strip renders square thumbnails, so what a crop is
 * *for* here is stopping a wide photograph from being letterboxed into one. A
 * drag-to-choose rectangle is a better tool and is a surface of its own; what it
 * would add over this is choosing *which* square, which is worth having and is
 * not worth blocking the feature on.
 *
 * ***~~It re-encodes to PNG~~ — corrected 2026-10-12: it re-encodes nothing.***
 * This drew the square through a canvas and uploaded only that, which made the
 * crop the one destructive edit §11.3 rules out — for *"lorebook entry art"* by
 * name — and left `EmbeddedMedia.crop` written by nothing. The redraw cost more
 * than the edges: a fresh PNG carries none of the source's text chunks,
 * metadata or colour profile, so a picture whose maker had written its recipe
 * into the file ([26 B20](../../../../docs/design/26-open-questions.md)) lost
 * it — and only when it was not already square, so whether a picture kept its
 * history depended on its shape. Now the bytes go up as they were picked, and
 * this only measures them.
 *
 * **Normalised against the upright picture**, the frame every renderer draws in
 * — so `from-image`, as `preparePicture` asks for it, and a phone photograph
 * stored on its side squares the way it is seen.
 *
 * Null when the picture is already square, and when it cannot be measured:
 * **a crop that fails is a picture with no crop**, never a picture that fails to
 * upload — and now never a picture that loses anything either.
 */
export async function centredSquare(file: Blob): Promise<SourceRect | null> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const { width, height } = bitmap;
    bitmap.close();
    return squareOf(width, height);
  } catch {
    return null;
  }
}

/** The centred square of a `width` × `height` picture, or null when it is one. */
export function squareOf(width: number, height: number): SourceRect | null {
  if (!(width > 0 && height > 0) || width === height) return null;
  const side = Math.min(width, height);
  return {
    x: (width - side) / 2 / width,
    y: (height - side) / 2 / height,
    width: side / width,
    height: side / height,
  };
}

/**
 * ***Replace keeps the row, and not what described the old bytes.*** Its id,
 * role, label and tags are the author's decisions about a slot; its crop and
 * size were measurements of a picture that is no longer there, and a rectangle
 * kept across a replace would frame the new picture by the old one's shape.
 *
 * ***And its recipe goes with them*** (2026-10-13, [26 B20]). A recipe says
 * what made *these* bytes — a seed, a model, a prompt — so one left on a
 * replaced row would tell the next tool that the new picture can be re-created
 * from the old one's recipe, which is a false claim in exactly the field that
 * exists to be trusted. The superseded `generated` goes for the same reason.
 */
function reframed(
  row: EmbeddedMedia,
  asset: Pick<EmbeddedMedia, 'ref' | 'digest' | 'bytes' | 'mime'>,
  crop: SourceRect | null,
): EmbeddedMedia {
  const next: EmbeddedMedia = { ...row, ...asset };
  delete next.crop;
  delete next.width;
  delete next.height;
  delete next.recipe;
  delete next.generated;
  if (crop !== null) next.crop = crop;
  return next;
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
  /**
   * Whether a fresh picture's row records its centred square as `crop`. The
   * bytes are sent as picked either way.
   */
  crop?: boolean;
  /**
   * ***A book that has never been saved has nowhere to put the bytes***
   * (2026-09-27). An upload is stored beside the object on disk, and a draft
   * has no folder yet — every picture added to a new book was refused, as a
   * 404 read as *could not be added*. Creating the object on upload is ruled
   * out ([polish §10]: the folder's name is frozen when it is made), so the
   * strip says to save first, and offers neither Add nor Replace until then.
   * The rows themselves stay editable: an entry imported into a new book
   * still carries its own.
   */
  unsaved?: boolean;
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
      const crop = props.crop === false ? null : await centredSquare(file);
      const { asset } = await api.uploadAsset(props.kind, props.objectId, file, file.name);
      const target = replacing;
      if (target === null) {
        // The row is made out here and only appended inside: React runs an
        // updater twice under StrictMode, and a uuid minted inside one would
        // name a different row each time.
        const row: EmbeddedMedia = {
          id: uuidv7(),
          role: 'gallery',
          tags: [],
          ...asset,
          ...(crop === null ? {} : { crop }),
        };
        props.onChange((media) => [...media, row]);
      } else {
        // **Replace keeps the row** — the bytes are what is being swapped, and
        // re-deriving the rest would make *replace* a *remove and add*. See
        // `reframed` for the part of it that does not survive.
        props.onChange((media) =>
          media.map((one) => (one.id === target ? reframed(one, asset, crop) : one)),
        );
      }
    } catch (failure: unknown) {
      /**
       * ***Read from the class, and only the two this strip has words for***
       * (2026-09-27). This read `failure.body.error`, which `ApiError` has
       * never had, so every refusal said the picture *could not be added*.
       * And it is an allow-list rather than a lookup in `WORDS`, because that
       * table also holds this strip's own labels: a class the server sent
       * that shared a name with one of them would have shown the label as the
       * reason.
       */
      const code = errorCode(failure);
      setProblem(
        code === 'not-an-image' || code === 'too-large'
          ? (WORDS[code] ?? '')
          : (WORDS['failed'] ?? ''),
      );
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
          {props.media.map((one, index) => (
            <li key={one.id} className="flex w-44 flex-col gap-1">
              {/* `object-cover` in a square slot draws exactly the centred
                  square, which is the only rectangle this strip writes — so the
                  thumbnail frames a stored crop without reading it. A rectangle
                  from anywhere else is drawn centred, and the drag-to-choose
                  control that would write one brings the renderer with it. */}
              <img
                src={`/api/library/${props.kind}/${props.objectId}/media/${one.id}`}
                alt={one.label ?? ''}
                className="aspect-square w-full rounded-media border border-line object-cover"
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
              {/* Buffered (2026-09-27): split and re-joined on every
                  keystroke, a comma was deleted the moment it was typed, so no
                  picture could be given a second tag. */}
              <CommaField
                label={WORDS['tags'] ?? 'Tags'}
                value={one.tags}
                hint={WORDS['tags-hint'] ?? ''}
                onChange={(tags) => {
                  patch(one.id, { tags });
                }}
              />
              <div className="flex flex-wrap gap-1">
                {props.unsaved === true ? null : (
                  <Button
                    type="button"
                    disabled={busy}
                    aria-label={numbered('replace-named', index + 1)}
                    onClick={() => {
                      setReplacing(one.id);
                      picker.current?.click();
                    }}
                  >
                    {WORDS['replace']}
                  </Button>
                )}
                <TwoStep
                  label={WORDS['remove'] ?? ''}
                  name={numbered('remove-named', index + 1)}
                  question={WORDS['remove-question'] ?? ''}
                  variant="quiet"
                  onConfirm={() => {
                    props.onChange((media) => media.filter((row) => row.id !== one.id));
                    // A cover that has been removed is no cover — the schema
                    // tolerates a dangling id and nothing is served by leaving
                    // one behind. A second write, applied after the first rather
                    // than over it: see `onChange`.
                    if (props.coverId === one.id) props.onCover?.(null);
                  }}
                />
                {props.onCover === undefined ? null : props.coverId === one.id ? (
                  <Fine>{WORDS['isCover']}</Fine>
                ) : (
                  <Button
                    type="button"
                    variant="quiet"
                    aria-label={numbered('cover-named', index + 1)}
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
        {props.unsaved === true ? (
          <Note>{WORDS['save-first']}</Note>
        ) : (
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
        )}
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
