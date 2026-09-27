// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { useRef, useState, type JSX } from 'react';

import type { AssembledBlock, TurnAttachment } from '@storyengine/shared';

import { ApiError, pictureUrl } from '../api.js';
import { labels } from '../i18n/catalogue.js';
import { Button } from '../ui/Button.js';
import { Field } from '../ui/Field.js';
import { Fine } from '../ui/Text.js';
import { PictureRefused } from './preparePicture.js';

/**
 * ***Pictures on a move, in Play*** — [25 E15](../../../../docs/design/25-open-questions.md), R1.
 *
 * Two surfaces and one promise. The composer lets a player attach pictures and
 * say what each is; the transcript shows them on the move they were part of.
 * The promise is the one the design turns on: **a picture never depends on the
 * model being able to see it.** The caption is the player's words about the
 * picture, and it is what any model that cannot see pictures is given instead —
 * so the control that asks for it says so, rather than leaving a player to
 * discover that a picture with no caption reached their text-only narrator as
 * *a picture, not described*.
 *
 * *A file input behind a button, not a drop zone*, for `ImportSession`'s reason:
 * it is the smaller thing that works everywhere, a phone included.
 */

const WORDS: Readonly<Record<string, string>> = labels('play.pictures', {
  attach: 'Attach a picture',
  attaching: 'Preparing…',
  remove: 'Remove',
  'remove-named': 'Remove picture {n}',
  caption: 'What it shows',
  'caption-named': 'What picture {n} shows',
  'picture-named': 'Picture {n} on this move',
  undescribed: 'A picture, not described',
  'will-see': 'The model will see this picture.',
  'will-read': 'The model will get your caption instead: {reason}.',
  'model-text-only': 'the model answering is not marked as seeing pictures',
  'missing-bytes': 'the picture is not on this server',
  'not-user-role': 'this pack puts the move where a picture cannot go',
  'unknown-kind': 'this build does not send this kind of attachment',
  'outside-window': 'only the move being made sends pictures',
  budget: 'the budget left it out',
  'caption-hint':
    'Your words about the picture. A model that cannot see pictures gets these instead.',
  full: 'Four pictures is the most one move can carry.',
  unreadable: 'That picture could not be read.',
  unencodable: 'This browser could not prepare that picture, so it was not sent.',
  'not-an-image': 'That file is not a PNG, JPEG or WebP picture.',
  'too-large': 'That picture is too large.',
  failed: 'That picture could not be attached.',
  missing: 'This picture is not on this server — only its description travelled here.',
});

/** The most pictures one move can carry — the server's limit, said here too. */
export const MAX_PICTURES = 4;

/** The longest caption the server records — `AttachmentsField`'s limit. */
export const MAX_CAPTION = 2000;

function numbered(key: string, n: number): string {
  return (WORDS[key] ?? '').replace('{n}', String(n));
}

/** A picture in the composer, attached and not yet sent. */
export interface ComposerPicture {
  digest: string;
  /** A local URL for the prepared bytes, so the thumbnail costs no request. */
  preview: string;
  caption: string;
}

/**
 * ***Will the model see it*** — [25 E15]'s *"Play marks each attachment sent
 * as a picture or sent as its description"*, answered **before** the move is
 * sent rather than after, which is when the answer is worth having.
 *
 * Read from the preview's block for the picture, which the server decided with
 * the same rule, the same model and the same bytes the turn will use — so this
 * is the turn's answer, not a guess the composer makes. Null until the preview
 * has a block for the picture (just attached, or nothing is bound).
 */
export function pictureOutlook(
  blocks: readonly AssembledBlock[] | undefined,
  digest: string,
): string | null {
  const block = blocks?.find(
    (one) =>
      one.source.kind === 'input' &&
      one.source.part === 'attachment' &&
      one.image?.digest === digest,
  );
  const image = block?.image;
  if (image === undefined) return null;
  if (image.sent) return WORDS['will-see'] ?? null;
  const reason = WORDS[image.withheld ?? 'missing-bytes'] ?? image.withheld ?? '';
  return (WORDS['will-read'] ?? '').replace('{reason}', reason);
}

/** Why an attach failed, in the composer's words. */
export function attachProblem(error: unknown): string {
  if (error instanceof PictureRefused) return WORDS[error.reason] ?? WORDS['failed'] ?? '';
  if (error instanceof ApiError) return WORDS[error.code] ?? WORDS['failed'] ?? '';
  return WORDS['failed'] ?? '';
}

/**
 * The attach control and the pictures waiting to go.
 *
 * Each picture carries a caption field, because the caption is not decoration:
 * it is the picture for every model that cannot see it, and for the summary a
 * later turn will read.
 */
export function ComposerPictures(props: {
  pictures: readonly ComposerPicture[];
  /** The preview's blocks, for each picture's {@link pictureOutlook}. */
  previewBlocks?: readonly AssembledBlock[] | undefined;
  busy: boolean;
  problem: string | null;
  disabled: boolean;
  onAttach: (files: readonly File[]) => void;
  onCaption: (digest: string, caption: string) => void;
  onRemove: (digest: string) => void;
}): JSX.Element {
  const picker = useRef<HTMLInputElement | null>(null);
  const full = props.pictures.length >= MAX_PICTURES;

  return (
    <div className="flex flex-col gap-2">
      <input
        ref={picker}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple
        aria-hidden="true"
        tabIndex={-1}
        className="sr-only"
        onChange={(event) => {
          const files = [...(event.target.files ?? [])];
          // Reset so choosing the same file again is still a change.
          event.target.value = '';
          if (files.length > 0) props.onAttach(files);
        }}
      />
      {props.pictures.length === 0 ? null : (
        <ul className="flex flex-wrap gap-3" aria-label="Pictures on this move">
          {props.pictures.map((picture, index) => (
            <li
              key={picture.digest}
              className="flex w-44 flex-col gap-1"
              /**
               * ***Enter in a caption is not Send.*** The caption is a
               * one-line field inside the composer's form, so a bare Enter
               * there submitted the move — with the next picture still
               * uncaptioned, which is the one thing the caption exists to stop.
               * Caught here, where it bubbles, because the field is the shared
               * `Field`; a composition in progress (an IME) is left alone.
               */
              onKeyDown={(event) => {
                if (
                  event.key === 'Enter' &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing &&
                  event.target instanceof HTMLInputElement
                ) {
                  event.preventDefault();
                }
              }}
            >
              {/* *Numbered*, so a reader that cannot see the thumbnails can tell
                  which caption and which Remove belong to which picture. */}
              <img
                src={picture.preview}
                alt={numbered('picture-named', index + 1)}
                className="aspect-square w-full rounded-control border border-line object-cover"
              />
              <Field
                label={
                  props.pictures.length === 1
                    ? (WORDS['caption'] ?? '')
                    : numbered('caption-named', index + 1)
                }
                value={picture.caption}
                maxLength={MAX_CAPTION}
                onChange={(value) => {
                  props.onCaption(picture.digest, value);
                }}
              />
              <PictureOutlook text={pictureOutlook(props.previewBlocks, picture.digest)} />
              <Button
                type="button"
                size="compact"
                disabled={props.disabled}
                aria-label={numbered('remove-named', index + 1)}
                onClick={() => {
                  props.onRemove(picture.digest);
                }}
              >
                {WORDS['remove']}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {props.pictures.length === 0 ? null : <Fine>{WORDS['caption-hint']}</Fine>}
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="compact"
          disabled={props.disabled || props.busy || full}
          onClick={() => picker.current?.click()}
        >
          {props.busy ? WORDS['attaching'] : WORDS['attach']}
        </Button>
        {full ? <Fine>{WORDS['full']}</Fine> : null}
      </div>
      {props.problem === null ? null : (
        <p role="alert" className="text-sm text-warn-ink">
          {props.problem}
        </p>
      )}
    </div>
  );
}

/** The outlook line, or nothing — polite, so a change is read out without taking focus. */
function PictureOutlook(props: { text: string | null }): JSX.Element | null {
  if (props.text === null) return null;
  return (
    <div aria-live="polite">
      <Fine>{props.text}</Fine>
    </div>
  );
}

/**
 * A move's pictures, where the move is shown.
 *
 * ***A picture whose bytes are not here is a placeholder, not a broken
 * image*** — the rendition's `asset: null` rule. After an import from an
 * export the record arrives and the pixels do not, and what a person is owed is
 * the caption and a sentence saying why there is no picture above it.
 */
export function MovePictures(props: {
  sessionId: string;
  pictures: readonly TurnAttachment[];
}): JSX.Element | null {
  if (props.pictures.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-3" aria-label="Pictures on this move">
      {props.pictures.map((picture) => (
        <li key={picture.id} className="flex w-44 flex-col gap-1">
          <MovePicture sessionId={props.sessionId} picture={picture} />
          {picture.caption === undefined ? null : <Fine>{picture.caption}</Fine>}
        </li>
      ))}
    </ul>
  );
}

function MovePicture(props: { sessionId: string; picture: TurnAttachment }): JSX.Element {
  const [broken, setBroken] = useState(false);
  const digest = props.picture.digest;
  if (digest === undefined || broken) {
    return (
      <div className="flex aspect-square w-full items-center rounded-control border border-dashed border-line p-2">
        <Fine>{WORDS['missing']}</Fine>
      </div>
    );
  }
  return (
    <img
      src={pictureUrl(props.sessionId, digest)}
      // Never empty: an empty alt marks an image decorative, and a move that
      // was only a picture would then be announced as nothing.
      alt={props.picture.caption ?? WORDS['undescribed'] ?? ''}
      className="aspect-square w-full rounded-control border border-line object-cover"
      onError={() => {
        setBroken(true);
      }}
    />
  );
}
