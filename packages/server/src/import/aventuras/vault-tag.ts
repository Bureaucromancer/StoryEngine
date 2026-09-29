// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { DatabaseSync, SQLOutputValue } from 'node:sqlite';

import {
  findTag,
  normaliseTagName,
  TAG_SWATCHES,
  uuidv7,
  type ImportItemReport,
  type ImportNote,
  type TagEntry,
  type TagSwatch,
} from '@storyengine/shared';

import { MAX_TAG_NAME_LENGTH, MAX_TAGS, type TagStore } from '../../tags/store.js';
import type { ImportCandidate, SourceItem } from '../source.js';
import { AVENTURAS_REQUIRED, quoted } from './schema.js';
import { isRecord } from './shapes.js';
import { columnUnreadable, stringOr, vaultRows } from './vault-row.js';

/**
 * ***A `vault_tags` row, merged into the tag registry*** —
 * [P13.6](../../../../../docs/design/workplan/30-p13-aventuras-import.md),
 * on [§1.8](../../../../../docs/design/workplan/30-p13-aventuras-import.md#18-tags-merge-and-are-never-adopted).
 *
 * The fourth vault table, and the one that is not a library object: a row is a
 * name, a kind and a colour, and what it becomes is a row of the account's tag
 * registry (`tags/store.ts`, [05 §4](../../../../../docs/design/05-tagging.md)).
 * So this file is the reader's half — rows to candidates, as the other three
 * vault tables do it — and the Writer's half, {@link VaultTagMerge}, which the
 * sweep's Writer hands a tag candidate to instead of to `store()`, since a
 * registry entry has no provenance, no slug and no history for `identify()` to
 * key a re-import on.
 *
 * ***A merge, never an overwrite.*** A name the registry does not hold, by
 * `sameTag`, is minted; a name it does hold is left entirely alone — never
 * recoloured, never renamed, never re-cased. The registry is the person's
 * decoration of their own names ([05 §2]), and a tag already here is one they
 * are looking at; an import that repainted it because another program once
 * picked a different colour would be the import deciding how their library
 * looks. The conflict policy is therefore not consulted at all — see
 * {@link VaultTagMerge.write}.
 *
 * ***The `type` column has nowhere to go.*** Aventuras keeps a tag list per
 * kind — `character`, `lorebook`, `scenario`, `UNIQUE(name, type)` — and ours
 * is one list, deliberately unscoped ([05 §2]). One name used by two kinds is
 * one tag here, minted by whichever row comes first (the rows are walked by
 * name, then id, so that is the same row every time); a later row whose colour
 * would have been a different swatch says so, and nothing else about it is
 * lost, because a colour is all a registry row adds to a name.
 *
 * ***The imported objects are not stamped with `tagIds`*** (§1.8). The
 * converters set each object's `tags` from its row's names, as they always
 * have, and nothing here connects them to the registry: `tags/adopt.ts`'s
 * header makes adoption a thing somebody asks for, and a bulk import is the
 * least explicit act there is. A minted tag decorates those names at once
 * anyway — a registry entry colours every object carrying its name, adopted or
 * not ([05 §3]) — so the colours arrive without the adoption.
 */

/** The table, and the middle of every candidate's `source` (§1.5). */
export const TAG_TABLE = 'vault_tags';

/** What the reader recognised: the format the Writer hands to {@link VaultTagMerge}. */
export const VAULT_TAG_FORMAT = 'aventuras.vault-tag';

/**
 * ***What a colour in a review may be***, and a kind: somebody else's text on
 * its way into the ledger, clamped as the reader clamps `metadata.json`'s
 * facts. A real one is `rose-500`, or at most `#rrggbbaa`.
 */
const FACT_LENGTH = 32;

/** A row, as the mapper would make it — `VaultTag` at the pin, less `createdAt`, which nothing reads. */
export interface MappedVaultTag {
  id: string;
  name: string;
  /** `character`, `lorebook` or `scenario` at the pin; read as text, since it goes nowhere. */
  type: string;
  color: string;
}

export interface TagReadOptions {
  /** The database's own name (`AVENTURAS_DATABASE`); see `VaultTable.database`. */
  database: string;
}

/**
 * ***Every `vault_tags` row, one item each*** — a candidate, or, for a row
 * with no id, the `unrecognised` row `vault-row.ts` makes of it. The table has
 * no row of its own in the review since this stage; these are its count.
 */
export function* vaultTagItems(db: DatabaseSync, options: TagReadOptions): Generator<SourceItem> {
  const columns = AVENTURAS_REQUIRED[TAG_TABLE]?.columns ?? [];
  // The columns the gate checked, and not one more (`schema.ts`).
  const byId = db.prepare(
    `select ${columns.map(quoted).join(', ')} from ${quoted(TAG_TABLE)} where id = ?`,
  );
  byId.setReadBigInts(true);
  yield* vaultRows(
    db,
    { database: options.database, table: TAG_TABLE },
    (id) => byId.get(id),
    (row, id, source) => ({
      outcome: 'candidate',
      candidate: { source, format: VAULT_TAG_FORMAT, payload: mapVaultTag(row, id) },
    }),
  );
}

/**
 * ***`mapVaultTag`, ported*** — the three columns that say anything, as text.
 * A column that is not text reads as empty, which for `name` refuses the row
 * ({@link VaultTagMerge.write}) and for `color` is an unreadable colour.
 */
export function mapVaultTag(
  row: Readonly<Record<string, SQLOutputValue | undefined>>,
  id: string,
): MappedVaultTag {
  return {
    id,
    name: stringOr(row['name'], ''),
    type: stringOr(row['type'], ''),
    color: stringOr(row['color'], ''),
  };
}

// ── The colour ──────────────────────────────────────────────────────────────

/**
 * ***Tailwind's 500 shades, which is what Aventuras' colours name*** — found
 * at P13.6, and not what §1.8 expected. §1.8 says *free hex colours*; the pin
 * stores a Tailwind token instead, `red-500`, drawn **at random** from a fixed
 * list of seventeen when a tag is made (`stores/tags.svelte.ts`'s `add`, and
 * the same list in `database.ts`'s `ensureTagsMigrated`), and changeable only
 * to another of those seventeen (`TagManager.svelte`). `TagBadge` builds its
 * classes from it, which is why it is a token rather than a colour.
 *
 * So the token's family is looked up here and turned into the colour
 * Tailwind gives it (v3's 500, which v4's `oklch` palette keeps within a few
 * degrees of hue), and that colour goes through the same nearest-swatch rule
 * as a hex would. The shade is ignored: a swatch here is rendered at the
 * palette's own fixed lightness, so how light the source was is not something
 * a chip could show. The grey families are here so that a hand-edited
 * `slate-500` lands on `stone` by the saturation rule rather than failing to
 * parse; `surface` is Aventuras' own neutral — Skeleton's, and `getColor`'s
 * fallback for a tag it cannot find — and is stone's colour by fiat, since it
 * is a theme's grey rather than a hue.
 *
 * **Hex is read as well**, because §1.8 was written expecting it and a
 * database somebody else's tool wrote could hold one: `#rgb`, `#rgba`,
 * `#rrggbb` or `#rrggbbaa`, the alpha ignored.
 */
const TAILWIND_500 = {
  slate: '#64748b',
  gray: '#6b7280',
  zinc: '#71717a',
  neutral: '#737373',
  stone: '#78716c',
  red: '#ef4444',
  orange: '#f97316',
  amber: '#f59e0b',
  yellow: '#eab308',
  lime: '#84cc16',
  green: '#22c55e',
  emerald: '#10b981',
  teal: '#14b8a6',
  cyan: '#06b6d4',
  sky: '#0ea5e9',
  blue: '#3b82f6',
  indigo: '#6366f1',
  violet: '#8b5cf6',
  purple: '#a855f7',
  fuchsia: '#d946ef',
  pink: '#ec4899',
  rose: '#f43f5e',
  surface: '#78716c',
} as const;

/**
 * ***Each swatch's own colour*** — the Tailwind family it is named after,
 * which is what the client draws it from (`index.css`'s `--color-tag-*`
 * tokens resolve to that family's 100 and 900). Keyed by {@link TagSwatch},
 * so a swatch added to the palette is a type error here until somebody says
 * what colour it is — a swatch with no reference hue would never be chosen,
 * silently.
 */
const SWATCH_COLOURS: Readonly<Record<TagSwatch, string>> = {
  rose: TAILWIND_500.rose,
  amber: TAILWIND_500.amber,
  lime: TAILWIND_500.lime,
  teal: TAILWIND_500.teal,
  sky: TAILWIND_500.sky,
  violet: TAILWIND_500.violet,
  fuchsia: TAILWIND_500.fuchsia,
  stone: TAILWIND_500.stone,
};

/** Channels in `0..1`. */
interface Rgb {
  r: number;
  g: number;
  b: number;
}

/**
 * ***Below either of these a colour is grey, and grey is `stone`*** (§1.8's
 * *low saturation to `stone`*).
 *
 * Two measures because HSL saturation alone is wrong at the ends: it divides
 * by how far the lightness is from the middle, so a near-white tint such as
 * `#fef2f2` — a hue nobody could name on a chip — reads as 85 % saturated.
 * Chroma (the channels' spread) catches those; saturation catches the
 * mid-grey families, whose spread is small but not tiny (`slate-500` is 0.15
 * chroma and 0.16 saturation, and is a grey by any reading). The numbers are
 * a judgement, and the tests pin what they decide for every family Aventuras
 * can store.
 */
const GREY_SATURATION = 0.2;
const GREY_CHROMA = 0.08;

/**
 * ***The swatch nearest to an Aventuras colour***, or `null` for one that
 * does not read as a colour at all.
 *
 * ***Nearest by hue, on the colour wheel, and by nothing else*** — which is a
 * decision, not an economy. Every swatch is drawn at the same two lightnesses
 * (the palette's 100 as the chip, its 900 as the ink), so of a source colour's
 * hue, saturation and lightness only the hue survives into what a person
 * sees. A distance that weighed lightness or saturation too — Euclidean RGB,
 * or a perceptual space's — would choose a swatch for a property the chip then
 * throws away, and would send a dark red to whichever swatch's reference
 * happens to be darkest. HSL's hue is not perceptually even, and between seven
 * hues spread around the wheel that unevenness moves a boundary by a few
 * degrees and nothing more; the complete Aventuras palette's answers are
 * pinned in the tests, where they can be read and argued with.
 *
 * Ties go to the swatch first in {@link TAG_SWATCHES}, so the answer never
 * depends on iteration luck.
 */
export function swatchForColour(colour: string): TagSwatch | null {
  const rgb = parseColour(colour);
  return rgb === null ? null : nearestSwatch(rgb);
}

/** {@link swatchForColour} after parsing: a grey is `stone`, anything else the nearest hue. */
function nearestSwatch(rgb: Rgb): TagSwatch {
  const { hue, saturation, chroma } = hsl(rgb);
  if (saturation < GREY_SATURATION || chroma < GREY_CHROMA) return 'stone';

  let best: TagSwatch = 'stone';
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const swatch of TAG_SWATCHES) {
    if (swatch === 'stone') continue;
    const reference = parseHex(SWATCH_COLOURS[swatch]);
    if (reference === null) continue;
    const distance = hueDistance(hue, hsl(reference).hue);
    if (distance < bestDistance) {
      best = swatch;
      bestDistance = distance;
    }
  }
  return best;
}

/** A Tailwind token (`red-500`, `bg-red-500`, `red`) or a hex colour, or `null`. */
function parseColour(colour: string): Rgb | null {
  const text = colour.trim().toLowerCase();
  const token = /^(?:bg-)?([a-z]+)(?:-(?:50|[1-9]00|950))?$/.exec(text);
  if (token !== null) {
    const family = token[1] ?? '';
    const hex = Object.hasOwn(TAILWIND_500, family)
      ? TAILWIND_500[family as keyof typeof TAILWIND_500]
      : undefined;
    return hex === undefined ? null : parseHex(hex);
  }
  return parseHex(text);
}

function parseHex(text: string): Rgb | null {
  const match = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(text);
  const digits = match?.[1];
  if (digits === undefined) return null;
  // `#rgb` and `#rgba` are shorthand for each digit doubled; alpha is dropped.
  const long =
    digits.length <= 4 ? digits.replace(/^(.)(.)(.).?$/, '$1$1$2$2$3$3') : digits.slice(0, 6);
  const channel = (at: number): number => Number.parseInt(long.slice(at, at + 2), 16) / 255;
  return { r: channel(0), g: channel(2), b: channel(4) };
}

/** Hue in degrees `[0, 360)`, and saturation and chroma in `0..1`. */
function hsl({ r, g, b }: Rgb): { hue: number; saturation: number; chroma: number } {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const chroma = max - min;
  const lightness = (max + min) / 2;
  const saturation = chroma === 0 ? 0 : chroma / (1 - Math.abs(2 * lightness - 1));
  let hue = 0;
  if (chroma !== 0) {
    if (max === r) hue = 60 * (((g - b) / chroma) % 6);
    else if (max === g) hue = 60 * ((b - r) / chroma + 2);
    else hue = 60 * ((r - g) / chroma + 4);
  }
  return { hue: hue < 0 ? hue + 360 : hue, saturation, chroma };
}

/** The shorter way round the wheel. */
function hueDistance(a: number, b: number): number {
  const apart = Math.abs(a - b) % 360;
  return apart > 180 ? 360 - apart : apart;
}

// ── The merge ───────────────────────────────────────────────────────────────

/**
 * ***The Writer's half*** — one tag candidate into the registry, as one row
 * of the review.
 *
 * One per sweep, like the Writer that holds it, because one fact spans the
 * sweep: which tags *this* sweep minted. That is what tells the second row of
 * a name used by two kinds — which joins a tag that did not exist before this
 * import — from a row whose name was here already.
 *
 * ***How a row is reported***, in the vocabulary every other vault row uses:
 *
 * | The name | Disposition | Note |
 * |---|---|---|
 * | not here — minted | `converted` | `tagMinted`, or `tagColourUnreadable` when the colour did not read |
 * | minted by an earlier row of this sweep | `converted` | `tagShared` |
 * | here before this sweep | `unchanged` | `tagKept` |
 * | refused — no name, too long, a full registry | `unrecognised` | why |
 *
 * — and `tagColourDiffers` beside either of the middle two when the row's
 * colour would have been another swatch than the tag has. So a first sweep
 * reports every row `converted`, and a second, which mints nothing and writes
 * nothing, every row `unchanged` — the shape a re-sweep of characters or books
 * has. *No `objectId`*: that field names a library object, and the ledger and
 * the book page look one up by it; a registry entry is not one.
 */
export class VaultTagMerge {
  readonly #tags: TagStore;
  readonly #handle: string;
  /** Ids of the entries this sweep minted. */
  readonly #minted = new Set<string>();

  constructor(tags: TagStore, handle: string) {
    this.#tags = tags;
    this.#handle = handle;
  }

  /**
   * ***The conflict policy is not asked, and that is the policy honoured
   * rather than ignored.*** Each of the three is about an object that differs
   * from the one already here, and a merge that never overwrites has no such
   * case to decide: `skip` would leave the tag here alone, which is what
   * happens anyway; `replace` would recolour it, which §1.8 forbids in as many
   * words, and `replace` exists to keep a person's edits as a history version
   * — a registry has no history, so a recolour would simply be their choice
   * gone; and `keep-both` would be a second tag of the same name, which the
   * store refuses (`sameTag`) because a registry cannot hold two.
   *
   * ***Read, then written only to mint.*** A row whose name is here costs one
   * read of a small file and no write, so a re-sweep writes nothing. A mint
   * goes through `mutate`, and asks again inside it: a tag made in another tab
   * between the read and the write is joined, not duplicated.
   */
  async write(candidate: ImportCandidate): Promise<ImportItemReport> {
    const { source } = candidate;
    const row = asMapped(candidate.payload);
    if (row === null) {
      return {
        source,
        disposition: 'unrecognised',
        notes: [
          {
            key: 'import.file.refused',
            params: { file: source, refusal: 'wrong-shape' },
            level: 'warn',
          },
        ],
      };
    }

    const name = normaliseTagName(row.name);
    const kind = row.type.slice(0, FACT_LENGTH);
    const colour = row.color.slice(0, FACT_LENGTH);
    // `NOT NULL` does not mean not empty; a tag with no name is not a tag.
    if (name === '') {
      return { source, disposition: 'unrecognised', notes: [columnUnreadable('name')] };
    }
    // What the store would refuse, refused here with a reason rather than
    // thrown at. The objects carrying the name keep it as written: tags are
    // open, and a name with no registry entry renders, filters and gates lore
    // as one with an entry does ([05 §2]) — it just has no colour.
    if (name.length > MAX_TAG_NAME_LENGTH) {
      return {
        source,
        disposition: 'unrecognised',
        notes: [
          {
            key: 'import.aventuras.tagNameTooLong',
            params: { tag: `${name.slice(0, MAX_TAG_NAME_LENGTH)}…`, limit: MAX_TAG_NAME_LENGTH },
            level: 'warn',
          },
        ],
      };
    }

    const swatch = swatchForColour(row.color);
    let tag = findTag(await this.#tags.read(this.#handle), name);
    let minted = false;

    if (tag === null) {
      const entry: TagEntry = {
        id: uuidv7(),
        name,
        swatch,
        sortOrder: 0,
        folder: 'none',
        hidden: false,
        createdAt: new Date().toISOString(),
      };
      let after: TagEntry[];
      try {
        after = (
          await this.#tags.mutate(this.#handle, (current) => {
            if (findTag(current, name) !== null) return current.tags;
            // Full: written back as it was, and reported below by the name's
            // absence from what came back.
            if (current.tags.length >= MAX_TAGS) return current.tags;
            // Last, as the backup merge and adoption place what they mint: the
            // person's own order stays as it was, and the import's follow it.
            return [...current.tags, { ...entry, sortOrder: current.tags.length }];
          })
        ).tags;
      } catch (error) {
        return {
          source,
          disposition: 'unrecognised',
          notes: [
            {
              key: 'import.file.notStored',
              params: { object: name, reason: error instanceof Error ? error.name : 'unknown' },
              level: 'warn',
            },
          ],
        };
      }
      tag = findTag({ tags: after }, name);
      minted = tag?.id === entry.id;
      if (tag === null && after.length >= MAX_TAGS) {
        return {
          source,
          disposition: 'unrecognised',
          notes: [
            {
              key: 'import.aventuras.tagsFull',
              params: { tag: name, limit: MAX_TAGS },
              level: 'warn',
            },
          ],
        };
      }
    }
    // Only a store that wrote something other than it was asked to could land
    // here; said as a failure to store rather than assumed away.
    if (tag === null) {
      return {
        source,
        disposition: 'unrecognised',
        notes: [
          {
            key: 'import.file.notStored',
            params: { object: name, reason: 'not-in-registry' },
            level: 'warn',
          },
        ],
      };
    }

    if (minted) {
      this.#minted.add(tag.id);
      const note: ImportNote =
        swatch === null
          ? {
              key: 'import.aventuras.tagColourUnreadable',
              params: { tag: tag.name, kind, colour },
              level: 'info',
            }
          : {
              key: 'import.aventuras.tagMinted',
              params: { tag: tag.name, kind, colour, swatch },
              level: 'info',
            };
      return { source, disposition: 'converted', notes: [note] };
    }

    const mintedHere = this.#minted.has(tag.id);
    const notes: ImportNote[] = [
      mintedHere
        ? { key: 'import.aventuras.tagShared', params: { tag: tag.name, kind }, level: 'info' }
        : { key: 'import.aventuras.tagKept', params: { tag: tag.name }, level: 'info' },
    ];
    /**
     * ***Compared as swatches, not as Aventuras' colours.*** Two kinds whose
     * colours differ in Aventuras and land on one swatch here look exactly as
     * they did — nothing a person chose is lost at the resolution this palette
     * has — and a note about it would be about a difference nobody can see.
     * And only when both sides have one: a tag here with no swatch is neutral
     * because somebody left it so, or adoption minted it plain, and a colour
     * that did not read has nothing to differ with.
     */
    if (swatch !== null && tag.swatch !== null && tag.swatch !== swatch) {
      notes.push({
        key: 'import.aventuras.tagColourDiffers',
        params: { tag: tag.name, kind, swatch, kept: tag.swatch },
        level: 'info',
      });
    }
    return { source, disposition: mintedHere ? 'converted' : 'unchanged', notes };
  }
}

/** A candidate's payload as {@link mapVaultTag} made it, or `null` for anything else. */
function asMapped(payload: unknown): MappedVaultTag | null {
  if (!isRecord(payload)) return null;
  const { id, name, type, color } = payload;
  if (typeof id !== 'string' || typeof name !== 'string') return null;
  return {
    id,
    name,
    type: typeof type === 'string' ? type : '',
    color: typeof color === 'string' ? color : '',
  };
}
