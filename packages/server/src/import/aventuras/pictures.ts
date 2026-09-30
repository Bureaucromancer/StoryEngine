// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { createHash } from 'node:crypto';

import {
  RENDITION_SCHEMA,
  type AssembledPrompt,
  type ImportNote,
  type Rendition,
  type RenditionPurpose,
} from '@storyengine/shared';

import { sniff } from '../../auth/avatars.js';
import { renditionIdFor } from '../../renditions/store.js';
import { digest } from '../../sessions/digest.js';
import { anchorBefore, isPicTag, stripPicTags } from './pic-tags.js';
import type { StoryPlacement } from './story.js';
import type {
  AventurasBackground,
  AventurasIllustration,
  AventurasPicture,
  AventurasStoryRows,
  PictureRead,
} from './story-rows.js';

/**
 * ***An Aventuras story's pictures, as renditions*** —
 * [P13.13](../../../../../docs/design/workplan/30-p13-aventuras-import.md),
 * [06 §10](../../../../../docs/design/06-modes-and-turn-pipeline.md).
 *
 * `embedded_images` become `illustration`s and `background_images`
 * `background`s (`shared/src/rendition.ts`), each **a finished record**: `ready`,
 * with its pixels, written by the one reader beside the turns it hangs off and
 * never dispatched — there is no job for a picture that already exists, and
 * the worker only ever runs a record some job names (`renditions/worker.ts`).
 *
 * ## Two halves, and why the bytes cross in the second
 *
 * {@link planPictures} is pure, like `story.ts` and `world.ts`: rows and the
 * placement in, records and notes out. {@link carryPictures} reads the bytes,
 * one picture at a time, through the row source's bounded reader — and does
 * not write them. **The format carries records, not pixels**
 * (`session-export.ts`), and the session a record belongs in does not exist
 * until `importSession` has minted its id, refused or not, and written its
 * turns. So the bytes go across through the reader's own `pixels` hook — the
 * road a backup's pictures take — which writes each one into the new
 * session's `assets/` (`renditions/store.ts`' `sessionAssetsRoot`) *after*
 * the session and its turns are on disk:
 *
 * - **A refusal writes no bytes.** `broken-tree`, `already-here` and
 *   `missing-links` are all answered before the session folder exists, so
 *   the hook is never asked and no picture is left anywhere without its
 *   session. A producer that wrote the bytes first would have had to guess a
 *   session id, and then clean up after every refusal.
 * - **A picture that cannot be written costs its pixels and nothing else.**
 *   The reader keeps the record and clears its asset — the recipe and a retry,
 *   which is what an evicted rendition is ([25 E3]) — and this hook never
 *   throws, so a database that goes bad between the two reads costs the
 *   pictures it still owed and not a half-written session.
 *
 * ***Read twice rather than held.*** The first read is here, to know what the
 * bytes *are* — sniffed, never taken from Aventuras' data URL, which labels
 * whatever its image providers return `image/png` — and how many and what
 * digest, which the record must state before the document is handed over.
 * The second is the hook's, for the write. Holding the bytes between would
 * hold a story's whole gallery at once, which is what Aventuras itself was
 * rewritten not to do (`getEmbeddedImageMetaForStory`); decoding twice is the
 * cheaper price. The second read is checked against the first's digest, so
 * the record never describes bytes other than the ones written.
 *
 * ## Which turn
 *
 * - **An illustration hangs off the turn that holds its entry** —
 *   `StoryPlacement.turnOf`, which looks an entry up on the line it was
 *   written on. That is every branch's: the whole tree is in the session, so
 *   a picture on a branch the person was not on is on that branch's turn, and
 *   no picture is left behind for being off the head's lineage. An entry no
 *   turn holds — a kind this build does not know, one on a branch with no
 *   row, or an entry that is gone, which Aventuras' own clean-up
 *   (`cleanupOrphanedEmbeddedImages`) deletes the pictures of on its next
 *   start — has no turn to hang a picture off, and is counted
 *   (`picturesUnplaced`).
 * - **A background hangs off the turn its line ends on.** Aventuras keeps one
 *   current backdrop per branch and shows it for the whole branch; a record
 *   here names one turn, and the turn a line ends on is where that backdrop
 *   was showing when the person left it. Only the newest row per branch, as
 *   `getBackgroundForBranch` reads it (`ORDER BY created_at DESC LIMIT 1`); an
 *   older one Aventuras never shows is not carried either.
 * - **A checkpoint's background stays with the checkpoint**, which this phase
 *   does not carry ("deliberately not in this phase"), and is counted
 *   (`checkpointBackgrounds`).
 *
 * ***A background is carried and not selected.*** Which backdrop is showing is
 * the `se.backdrop` channel ([06 §10.1a], `renditions/backdrop.ts`), written
 * by an engine turn of its own and declared by the mode that stages one — and
 * an imported story names no mode (`story.ts`). A selection written here would
 * be an effect on a channel the session's mode may not declare, which
 * reconstruction would have to explain. So the record is on its turn, served
 * by the asset route, and chosen by hand in a mode that shows a backdrop,
 * which is a person's choice this import has no business making for them.
 *
 * ## What a record says
 *
 * - **The recipe is Aventuras'.** `prompt` is its *"full generation prompt"*
 *   as the one fragment, required and ranked first, with no budget — so
 *   `capPrompt(fragments, budget, separator).text === text` holds, as it must
 *   for every rendition. A background has no prompt in Aventuras and gets the
 *   empty one.
 * - **The provenance claims no request.** `binding` is `null` — no connection
 *   of this install drew it, and naming Aventuras' model there would fabricate
 *   one, which is [18 §3]'s first consequence for a turn and the same here —
 *   `seed` is `null` because Aventuras kept none, and `workflow` is empty
 *   because it is re-sent on a retry, where Aventuras' style id would mean
 *   nothing to this install's endpoint. `at` is when Aventuras made it. The
 *   model and style are said on the review (`pictureModels`) rather than put
 *   in a field that would claim more.
 * - **`foreign`** is `{ source: 'aventuras', id }` — the row's id, as a turn
 *   carries its entry's.
 * - **The anchor is Aventuras' `source_text`**, which is already what an
 *   anchor is: a quote of the entry, matched without case (Aventuras'
 *   matcher, and `anchorOffset`'s). ~~For a picture the model asked for inline
 *   it is the whole `<pic …>` tag, which is in the imported text verbatim.~~
 *   *Since P13.14* the tags are taken out of the text (`pic-tags.ts`), so a
 *   picture the model asked for inline — whose `source_text` is the whole
 *   `<pic …>` tag — is anchored on the sentence the tag followed, which puts it
 *   where Aventuras drew it ({@link anchorOf}). `anchorResolved: false` when
 *   the quote is not in the entry at all.
 * - **The id is the turn's and an ordinal** (`renditionIdFor`) — the scheme
 *   every rendition has, so a later *Illustrate* of the same turn takes the
 *   next number and adds rather than overwrites. The turn id is derived
 *   (`producedTurnId`) and the ordinals come in a fixed order, so the ids are
 *   the same on every run — though a story already here is found by its key
 *   before any of this runs, and nothing is written for it.
 * - **The digest** is the recipe's, under a domain of its own and with no
 *   binding in it: `reusableBackdrop` compares a new recipe's digest, which
 *   always carries this install's binding, so an imported backdrop is never
 *   silently reused for a place a mode here asks for — it is shown when
 *   somebody chooses it.
 *
 * ***What is not carried, and said:*** a picture Aventuras never finished —
 * `pending`, `generating` or `failed`, with no pixels (`picturesUnfinished`);
 * one past the bound, measured and never loaded, as a portrait is
 * (`pictureTooLarge`); and one whose bytes are not a PNG, JPEG or WebP, or not
 * base64 at all (`pictureUnreadable`). **Each costs itself and the story
 * still imports.**
 */

/** One picture, planned: the row it came from and its record, before the bytes. */
export interface PlannedPicture {
  source: AventurasPicture;
  rendition: Rendition;
}

export interface PicturePlan {
  planned: PlannedPicture[];
  /** What was not planned, and why — said on the story's row. */
  notes: ImportNote[];
}

/** The only fragment an imported recipe has: Aventuras' prompt, whole. */
const PROMPT_FRAGMENT = 'aventuras.prompt';

/** What `capPrompt` would join with — nothing is joined, but the record states one. */
const SEPARATOR = ', ';

/** How many model names the review lists before it stops. */
const MODELS_LISTED = 5;

/**
 * ***The records a story's pictures become***, before any bytes are read.
 * Pure: the rows, where the producer placed each entry, and the story's title
 * for the notes.
 */
export function planPictures(
  rows: AventurasStoryRows,
  placement: StoryPlacement,
  story: string,
): PicturePlan {
  const contentOf = new Map(rows.entries.map((entry) => [entry.id, entry.content]));
  const onTurn = new Map<string, { source: AventurasPicture; purpose: RenditionPurpose }[]>();
  const hang = (turnId: string, source: AventurasPicture, purpose: RenditionPurpose): void => {
    const held = onTurn.get(turnId);
    if (held === undefined) onTurn.set(turnId, [{ source, purpose }]);
    else held.push({ source, purpose });
  };

  let unfinished = 0;
  let unplaced = 0;
  for (const picture of rows.pictures.illustrations) {
    if (picture.status !== 'complete' || picture.octets === null || picture.octets === 0) {
      unfinished += 1;
      continue;
    }
    const turnId = placement.turnOf.get(picture.entryId);
    if (turnId === undefined) unplaced += 1;
    else hang(turnId, picture, 'illustration');
  }

  // The newest per line, as Aventuras reads it; checkpoints' counted apart.
  let checkpoints = 0;
  const current = new Map<string | null, AventurasBackground>();
  for (const background of rows.pictures.backgrounds) {
    if (background.octets === null || background.octets === 0) continue;
    if (background.checkpointId !== null) {
      checkpoints += 1;
      continue;
    }
    const held = current.get(background.branchId);
    if (held === undefined || newer(background, held)) current.set(background.branchId, background);
  }
  for (const [line, background] of current) {
    const turnId = placement.headOf.get(line);
    if (turnId === undefined) unplaced += 1;
    else hang(turnId, background, 'background');
  }

  const planned: PlannedPicture[] = [];
  for (const [turnId, held] of onTurn) {
    /**
     * *Illustrations first, then the backdrop, each in time order*, so the
     * ordinals — and so the ids — are fixed by the rows alone. Rows arrive
     * in time order already (`story-rows.ts`); the sort is stable.
     */
    held.sort((a, b) => rank(a.purpose) - rank(b.purpose));
    held.forEach(({ source, purpose }, ordinal) => {
      planned.push({
        source,
        rendition: recordOf(rows.story.id, turnId, ordinal, source, purpose, contentOf),
      });
    });
  }

  const notes: ImportNote[] = [];
  if (unfinished > 0) {
    notes.push({
      key: 'import.aventuras.picturesUnfinished',
      params: { story, count: unfinished },
      level: 'info',
    });
  }
  if (unplaced > 0) {
    notes.push({
      key: 'import.aventuras.picturesUnplaced',
      params: { story, count: unplaced },
      level: 'warn',
    });
  }
  if (checkpoints > 0) {
    notes.push({
      key: 'import.aventuras.checkpointBackgrounds',
      params: { story, count: checkpoints },
      level: 'info',
    });
  }
  return { planned, notes };
}

/** What {@link carryPictures} hands the Writer. */
export interface CarriedPictures {
  /** The records whose bytes were read and are what they say — for the document's `renditions`. */
  renditions: Rendition[];
  illustrations: number;
  backgrounds: number;
  /** What was read and not carried, and the models that drew what was — said on the row. */
  notes: ImportNote[];
  /**
   * ***`SessionImportOptions.pixels`*** — the bytes for a record's
   * `asset.path`, read again now that the session exists. Never throws: a
   * read that fails, or bytes that are not the ones first read, answer
   * `null`, and the reader writes the record without them.
   */
  pixels: (path: string) => Promise<Uint8Array | null>;
  /** How many records the hook could not give pixels to — see {@link pixels}. */
  lost: () => number;
}

/**
 * ***Each planned picture's bytes, read, measured and sniffed*** — and the
 * record completed with its asset, or left out with a count.
 *
 * `read` is the row source's ({@link AventurasPictures.read}), and is the
 * only thing here that touches the database; anything it throws costs that
 * picture, as an unreadable one.
 */
export function carryPictures(
  plan: PicturePlan,
  read: (picture: AventurasPicture) => PictureRead,
  maxBytes: number,
  story: string,
): CarriedPictures {
  const reading = (picture: AventurasPicture): PictureRead => {
    try {
      return read(picture);
    } catch {
      return 'unreadable';
    }
  };

  const renditions: Rendition[] = [];
  const byPath = new Map<string, { source: AventurasPicture; digest: string }>();
  const models = new Set<string>();
  let illustrations = 0;
  let backgrounds = 0;
  let tooLarge = 0;
  let unreadable = 0;
  for (const { source, rendition } of plan.planned) {
    const bytes = reading(source);
    if (bytes === 'too-large') {
      tooLarge += 1;
      continue;
    }
    // `absent` too: the listing measured a picture there, so a read that
    // finds none is a value that went bad between the two.
    if (!(bytes instanceof Uint8Array)) {
      unreadable += 1;
      continue;
    }
    const kind = sniff(bytes);
    if (kind === null) {
      unreadable += 1;
      continue;
    }
    const path = `${rendition.id}.${kind.extension}`;
    const digest = digestOf(bytes);
    renditions.push({
      ...rendition,
      asset: { path, mime: kind.mime, bytes: bytes.byteLength, digest },
    });
    byPath.set(path, { source, digest });
    if (rendition.purpose === 'illustration') {
      illustrations += 1;
      if (source.table === 'embedded_images' && source.model !== null) models.add(source.model);
    } else {
      backgrounds += 1;
    }
  }

  const notes: ImportNote[] = [];
  if (tooLarge > 0) {
    notes.push({
      key: 'import.aventuras.pictureTooLarge',
      params: { story, count: tooLarge, limit: Math.round(maxBytes / (1024 * 1024)) },
      level: 'warn',
    });
  }
  if (unreadable > 0) {
    notes.push({
      key: 'import.aventuras.pictureUnreadable',
      params: { story, count: unreadable },
      level: 'warn',
    });
  }
  if (models.size > 0) {
    // Aventuras' words on their way into the ledger, so clamped and few.
    const named = [...models].sort().map((model) => model.slice(0, 64));
    const listed = named.slice(0, MODELS_LISTED).join(', ');
    notes.push({
      key: 'import.aventuras.pictureModels',
      params: {
        story,
        models: named.length > MODELS_LISTED ? `${listed}, …` : listed,
      },
      level: 'info',
    });
  }

  let lost = 0;
  const pixels = (path: string): Promise<Uint8Array | null> => {
    const held = byPath.get(path);
    if (held === undefined) return Promise.resolve(null);
    const again = reading(held.source);
    if (again instanceof Uint8Array && digestOf(again) === held.digest) {
      return Promise.resolve(again);
    }
    lost += 1;
    return Promise.resolve(null);
  };

  return { renditions, illustrations, backgrounds, notes, pixels, lost: () => lost };
}

/** One finished record, before its asset. */
function recordOf(
  sessionId: string,
  turnId: string,
  ordinal: number,
  source: AventurasPicture,
  purpose: RenditionPurpose,
  contentOf: ReadonlyMap<string, string>,
): Rendition {
  const illustration: AventurasIllustration | null =
    source.table === 'embedded_images' ? source : null;
  const prompt = recipeOf(illustration?.prompt ?? '');
  const { anchor, resolved } = anchorOf(
    illustration?.sourceText ?? '',
    illustration === null ? '' : (contentOf.get(illustration.entryId) ?? ''),
  );
  const at = isoOf(source.createdAt);

  return {
    schema: RENDITION_SCHEMA,
    id: renditionIdFor(turnId, ordinal),
    // The reader stamps its own; this is the document's.
    sessionId,
    turnId,
    createdAt: at,
    kind: 'image',
    purpose,
    scope: anchor === '' ? null : { anchor },
    state: 'ready',
    prompt,
    asset: null,
    provenance: { at, binding: null, answeredAs: null, seed: null, workflow: {} },
    error: null,
    digest: digest([
      // A domain of its own — see the header's last bullet on the digest.
      'aventuras.rendition',
      purpose,
      illustration?.model ?? '',
      illustration?.styleId ?? '',
      prompt.separator,
      ...prompt.fragments.map((fragment) => fragment.text),
    ]),
    ordering: 0,
    ...(resolved ? {} : { anchorResolved: false as const }),
    foreign: { source: 'aventuras', id: source.id },
  };
}

/**
 * ***Where a picture sits in its turn's text*** — the anchor, and whether it
 * is in the text at all. `content` is the entry as Aventuras stored it; the
 * turn holds it with its `<pic …>` tags taken out (`story.ts`'s `proseOf`),
 * and every anchor is checked against that, the text a reader resolves it in.
 *
 * - **A quote** — Aventuras' analysed pictures — is kept as written, matched
 *   without case, and a miss is `anchorResolved: false`, as at P13.13.
 * - **A tag** — a picture the model asked for inline, whose `source_text` is
 *   the whole `<pic …>` — is anchored on the sentence before the place the tag
 *   stood (`pic-tags.ts`'s `anchorBefore`, which says why), so the picture is
 *   drawn where Aventuras drew it. A tag first in its entry has nothing before
 *   it and is left unanchored, under the text, and resolved — there is no quote
 *   to have missed. A tag the entry does not hold is a miss like any quote's,
 *   and keeps the tag as its anchor, so the record still says what Aventuras
 *   had.
 */
function anchorOf(sourceText: string, content: string): { anchor: string; resolved: boolean } {
  const quote = sourceText.trim();
  const stripped = stripPicTags(content);
  if (quote === '') return { anchor: '', resolved: true };

  if (isPicTag(quote)) {
    // Aventuras finds a tag's record by the exact tag (`buildInlineImageMap`),
    // so the exact tag first; its own matching is case-blind elsewhere, so a
    // tag differing only in case is the same tag after that.
    const site =
      stripped.sites.find((one) => one.tag === quote) ??
      stripped.sites.find((one) => one.tag.toLowerCase() === quote.toLowerCase());
    if (site === undefined) return { anchor: quote, resolved: false };
    return { anchor: anchorBefore(stripped.text, site.at) ?? '', resolved: true };
  }

  return {
    anchor: quote,
    resolved: stripped.text.toLowerCase().includes(quote.toLowerCase()),
  };
}

/**
 * Aventuras' prompt as a recipe: one required fragment, no budget, nothing
 * dropped — so re-capping it gives back exactly the text, which is the
 * property every stored recipe holds (`AssembledPrompt`). An empty prompt is
 * no fragments at all, rather than a fragment of nothing.
 */
function recipeOf(text: string): AssembledPrompt {
  if (text === '') {
    return {
      fragments: [],
      separator: SEPARATOR,
      budget: { maxChars: null, usefulChars: null },
      text: '',
      kept: [],
      dropped: [],
      overCap: false,
    };
  }
  return {
    fragments: [{ id: PROMPT_FRAGMENT, text, rank: 0, required: true }],
    separator: SEPARATOR,
    budget: { maxChars: null, usefulChars: null },
    text,
    kept: [PROMPT_FRAGMENT],
    dropped: [],
    overCap: false,
  };
}

function rank(purpose: RenditionPurpose): number {
  return purpose === 'illustration' ? 0 : 1;
}

/** `getBackgroundForBranch`'s order: newest first, and the id to break a tie. */
function newer(a: AventurasBackground, b: AventurasBackground): boolean {
  return a.createdAt > b.createdAt || (a.createdAt === b.createdAt && a.id > b.id);
}

/** `sha256:<hex>`, as every asset's digest is, and as the reader recomputes it. */
function digestOf(bytes: Uint8Array): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

/** Aventuras' milliseconds as ISO, with a time no `Date` can hold read as the epoch. */
function isoOf(ms: number): string {
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
}
