// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { ImportItemReport, ImportNote } from '@storyengine/shared';

import type { ImportCandidate, SourceItem } from '../source.js';
import { isRecord } from './shapes.js';
import {
  decodePortrait,
  DEFAULT_MAX_PORTRAIT_BYTES,
  repairVisualDescriptors,
  textLimit,
} from './vault-character.js';

/**
 * ***Aventuras' exchange envelope — the vault's export since v0.7.12*** —
 * [P13.16](../../../../../docs/design/workplan/30-p13-aventuras-import.md).
 *
 * **What changed under us.** [P4 §1.5] wrote the three vault converters
 * against `JSON.stringify(entity, null, 2)` — the record and nothing else —
 * and `shapes.ts` recognises a file by that record's own fields. Two days
 * after P13's survey pin (`c43da108`, 2026-09-25), Aventuras #539 (*Import
 * Aventuras exports literally, without AI*) wrapped all three exports in a
 * marked, versioned document, because its own import was mistaking its own
 * bare character for a V1 card. From v0.7.12 a character the vault exports
 * is
 *
 *     { "format": "aventuras-exchange", "formatVersion": "1.0.0",
 *       "entity": "character", "exportedAt": 1730000000000, "data": { … } }
 *
 * and every probe this build had walked past it: `isVaultCharacter` looks at
 * the top level, where there is no `visualDescriptors`, and `looksLikeCard`
 * unwraps `data` and finds no card field in it. *Nothing here recognised this
 * file* — about the one file an Aventuras user is now most likely to bring.
 * Lorebooks and scenarios went the same way at the same commit, so this
 * reads all three; the person noticed it on characters.
 *
 * ***An envelope, not a fourth conversion.*** Each `data` is, by Aventuras'
 * own construction (`services/exchange/convert.ts`), the vault record minus
 * its identity, provenance and derived counters — so each is handed to the
 * converter that already takes that record:
 *
 * | `entity` | becomes | through |
 * |---|---|---|
 * | `character` | `aventuras.character` | `convertCharacter`, portrait carried |
 * | `scenario` | `aventuras.scenario` | `convertScenario`, preview included |
 * | `lorebook` | {@link EXCHANGE_LOREBOOK_FORMAT} | `convertVaultLorebook` |
 *
 * The lorebook is the one with a format of its own, because its payload is a
 * `lorebook_vault` row's shape — a book with a name, tags and flat entries —
 * and not the bare `Entry[]` the `aventuras.lorebook` arm takes; and it is not
 * `aventuras.vault-lorebook`, whose arm remembers the book under its row id
 * for the links a database resolves, and a file has no row id.
 *
 * ***Identified by the marker, and only by the marker*** — Aventuras' own rule
 * (`docs/architecture/exchange-format.md`: *"The marker is the only thing
 * that decides whether a file is ours"*). `format: "aventuras-exchange"` is a
 * claim nothing else writes, so it is answered at any confidence, a folder
 * sweep included, as a card's `spec` or our own `storyengine.` schema id is.
 * And **a marked file never falls through**: a version this build will not
 * read, an entity it does not know or a `data` that is not an object is
 * refused, `unrecognised` with the reason, and is never offered to the card
 * probe below it. That is the same terminal answer Aventuras gives — an
 * `invalid` result *"is never reinterpreted as a card"* — and the reason is
 * the one [P13 §1.4] gives for the `.avt` gate: a best-effort read of a
 * shape we have not seen is a plausible, wrong object.
 *
 * ***The version is gated as `.avt`'s is*** (`avt.ts`), and as Aventuras'
 * `checkFormatVersion` gates it: `X.Y.Z` exactly; major 1 reads, a newer
 * minor with `import.aventuras.exchangeNewerFormat` — a minor version there
 * is *"fields this version does not know were ignored"*, which is what the
 * converters already do with a field they do not read — and any other major,
 * or a string that is not a version, is refused. Aventuras reads an older
 * major silently; there has never been a 0.x, and a refusal names it if one
 * appears.
 *
 * ***Aventuras' defaults, where its schema has them.*** Every field but a
 * name has a default in `services/exchange/schemas.ts` — so a hand-edited
 * file with `traits` left out is a valid character there. The converters
 * were written against records the app always fills, and two of their guards
 * (`isVaultCharacter`, `isVaultScenario`) refuse a missing list as
 * `wrong-shape`. So the lists and objects the guards look at, and the three
 * entry fields `vaultEntryToEntryLike` moves into `injection`, are defaulted
 * here, exactly as Aventuras defaults them, and nothing else is. *A scenario
 * with an empty `settingSeed`* is valid there and is still refused here
 * (`missing-field`), as it is from a `scenario_vault` row: a treatment with
 * no framing is not something this build has decided to make.
 *
 * ***The portrait is carried*** — which the bare file's never was
 * (`character.ts`, `portraitNotCarried`), and which [P13 §1.6] does for a
 * `character_vault` row. The envelope exists partly so that *"portraits
 * travel"*, and it travels as the same data URL a row holds, so it is read
 * the same way — `decodePortrait`, bounded by the same ceiling, the length
 * checked before anything is decoded — and handed to the Writer beside the
 * payload (`ImportCandidate.inline`), which sniffs it as it sniffs any
 * portrait. A link is never fetched, and says so.
 *
 * ***Identity is the file***, as it was for the bare export: the envelope
 * carries no id by design (*"fresh local identity"*), so a re-upload of the
 * same file is `unchanged` and the same character exported twice is two
 * files. A character that also arrives from the database is keyed by its row
 * and is a second actor — as a bare vault file always was, and for the same
 * reason: nothing in the file names the row.
 *
 * Snapshot provenance:
 *   source  aventuras/src/lib/services/exchange/{types,schemas,convert,parse,version}.ts
 *           and docs/architecture/exchange-format.md
 *   commit  b07fbc2b9e02cd44bb4d0fedcfc808b0eee04d1f (v0.7.12+28, `EXCHANGE_FORMAT_VERSION = '1.0.0'`)
 *   taken   2026-10-25
 */

/** The marker: `EXCHANGE_FORMAT` in `services/exchange/types.ts`. */
export const EXCHANGE_MARKER = 'aventuras-exchange';

/** `EXCHANGE_FORMAT_VERSION` at the snapshot: the newest envelope this build was written against. */
export const EXCHANGE_KNOWN_VERSION = '1.0.0';

/**
 * The format an exchange lorebook is emitted as — a book, with its own name,
 * description and tags, and the vault's flat entries. See the file header for
 * why it is neither of the two lorebook formats already here.
 */
export const EXCHANGE_LOREBOOK_FORMAT = 'aventuras.exchange-lorebook';

/** How long a version or entity string may be when a note names it. */
const NAMED_LENGTH = 32;

/** Aventuras' own `SEMVER`: three parts and nothing else. */
const SEMVER = /^(\d{1,6})\.(\d{1,6})\.(\d{1,6})$/;

export interface ExchangeReadOptions {
  /** The largest portrait carried, decoded. Defaults to the bound every card road has. */
  maxPortraitBytes?: number;
}

/**
 * Whether a parsed document claims to be an exchange file — Aventuras'
 * `hasExchangeMarker`. The claim, not its validity: {@link readExchange} decides
 * that, and a marked file is answered there whether it reads or not.
 *
 * `boolean` rather than a type predicate, for the reason `shapes.ts` gives
 * for its record guards: `readUpload` asks this of a record it goes on
 * reading when the answer is no, and a predicate would narrow that branch too.
 */
export function hasExchangeMarker(value: unknown): boolean {
  return isRecord(value) && value['format'] === EXCHANGE_MARKER;
}

/**
 * ***One marked file, as one item*** — a candidate for the converter its
 * `entity` names, or the refusal that says why not. Call only on a document
 * {@link hasExchangeMarker} accepted.
 */
export function readExchange(
  filename: string,
  body: Readonly<Record<string, unknown>>,
  options: ExchangeReadOptions = {},
): SourceItem {
  const rawVersion = typeof body['formatVersion'] === 'string' ? body['formatVersion'] : '';
  const version = rawVersion.slice(0, NAMED_LENGTH);
  const match = SEMVER.exec(rawVersion);
  if (match === null || Number(match[1]) !== 1) {
    return refusedExchange(filename, 'import.aventuras.exchangeUnknownFormat', {
      file: filename,
      version: version === '' ? '—' : version,
      known: EXCHANGE_KNOWN_VERSION,
    });
  }

  const entity = typeof body['entity'] === 'string' ? body['entity'] : '';
  const data = body['data'];
  if (entity !== 'character' && entity !== 'lorebook' && entity !== 'scenario') {
    return refusedExchange(filename, 'import.aventuras.exchangeUnknownEntity', {
      file: filename,
      entity: entity === '' ? '—' : entity.slice(0, NAMED_LENGTH),
    });
  }
  if (!isRecord(data)) {
    return refusedExchange(filename, 'import.aventuras.exchangeUnreadable', {
      file: filename,
      entity,
    });
  }

  const notes: ImportNote[] = [];
  const [, , knownMinor] = SEMVER.exec(EXCHANGE_KNOWN_VERSION) ?? [];
  if (Number(match[2]) > Number(knownMinor)) {
    notes.push({
      key: 'import.aventuras.exchangeNewerFormat',
      params: { file: filename, version, known: EXCHANGE_KNOWN_VERSION },
      level: 'warn',
    });
  }

  switch (entity) {
    case 'character':
      return characterItem(filename, data, notes, options);
    case 'scenario':
      return candidate({
        source: filename,
        format: 'aventuras.scenario',
        payload: scenarioPayload(data),
        ...withNotes(notes),
      });
    case 'lorebook':
      return candidate({
        source: filename,
        format: EXCHANGE_LOREBOOK_FORMAT,
        payload: lorebookPayload(data),
        ...withNotes(notes),
      });
  }
}

/**
 * ***A character, with its portrait beside it rather than in it*** — so the
 * converter, which reports any portrait it finds in a payload as not carried,
 * finds none, and the Writer finds the bytes under `assets`, as it does for a
 * `character_vault` row. Keyed beneath the file's own name, which no file in
 * any root can also be.
 */
function characterItem(
  filename: string,
  data: Readonly<Record<string, unknown>>,
  notes: ImportNote[],
  options: ExchangeReadOptions,
): SourceItem {
  const { portrait, ...rest } = data;
  const payload: Record<string, unknown> = {
    ...rest,
    traits: Array.isArray(rest['traits']) ? rest['traits'] : [],
    // `repairVisualDescriptors` rather than a bare default: Aventuras' schema
    // defaults a missing record to `{}`, and the legacy string-array form a
    // hand-copied record might still carry lands where the row path lands it.
    visualDescriptors: repairVisualDescriptors(rest['visualDescriptors']),
  };

  const actor = typeof rest['name'] === 'string' ? rest['name'] : filename;
  const key = `${filename}/portrait`;
  const bytes = portraitBytes(portrait, actor, filename, notes, options);

  return candidate({
    source: filename,
    format: 'aventuras.character',
    payload,
    ...(bytes === null ? {} : { assets: [key], inline: new Map([[key, bytes]]) }),
    ...withNotes(notes),
  });
}

/**
 * The portrait's bytes, or `null` with the reason noted — `portraitOf`'s
 * rules for a row (`vault-character.ts`), against a string already in memory
 * rather than a column: the length is checked before the decode, so a
 * portrait past the bound is never decoded at all.
 */
function portraitBytes(
  value: unknown,
  actor: string,
  filename: string,
  notes: ImportNote[],
  options: ExchangeReadOptions,
): Uint8Array | null {
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  const max = options.maxPortraitBytes ?? DEFAULT_MAX_PORTRAIT_BYTES;
  const tooLarge = (): null => {
    notes.push({
      key: 'import.aventuras.portraitTooLarge',
      params: { actor, limit: Math.round(max / (1024 * 1024)) },
      level: 'warn',
    });
    return null;
  };
  if (value.length > textLimit(max)) return tooLarge();

  const bytes = decodePortrait(value);
  if (bytes === null) {
    // A link — which Aventuras would load and this never fetches — or a data
    // URL that is not base64: the sentence a row's unreadable portrait gets.
    notes.push({
      key: 'import.card.portraitUnreadable',
      params: { file: filename, actor },
      level: 'warn',
    });
    return null;
  }
  return bytes.byteLength > max ? tooLarge() : bytes;
}

/** `npcs` and `settingSeed` are what `isVaultScenario` asks for; both default in Aventuras. */
function scenarioPayload(data: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return {
    ...data,
    settingSeed: typeof data['settingSeed'] === 'string' ? data['settingSeed'] : '',
    npcs: Array.isArray(data['npcs']) ? data['npcs'] : [],
  };
}

/**
 * The book, with Aventuras' entry defaults filled in where an entry left them
 * out — `injectionMode: 'keyword'` and `priority: 100` above all, since
 * `vaultEntryToEntryLike` moves both into `injection` as given and an absent
 * mode would otherwise convert as something Aventuras never meant.
 */
function lorebookPayload(data: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const entries = Array.isArray(data['entries']) ? data['entries'] : [];
  return {
    ...data,
    entries: entries.map((entry: unknown) =>
      isRecord(entry)
        ? {
            ...entry,
            description: typeof entry['description'] === 'string' ? entry['description'] : '',
            keywords: Array.isArray(entry['keywords']) ? entry['keywords'] : [],
            aliases: Array.isArray(entry['aliases']) ? entry['aliases'] : [],
            injectionMode:
              typeof entry['injectionMode'] === 'string' ? entry['injectionMode'] : 'keyword',
            priority: typeof entry['priority'] === 'number' ? entry['priority'] : 100,
          }
        : entry,
    ),
  };
}

function withNotes(notes: ImportNote[]): { notes?: ImportNote[] } {
  return notes.length === 0 ? {} : { notes };
}

function candidate(value: ImportCandidate): SourceItem {
  return { outcome: 'candidate', candidate: value };
}

function refusedExchange(filename: string, key: string, params: ImportNote['params']): SourceItem {
  const report: ImportItemReport = {
    source: filename,
    disposition: 'unrecognised',
    notes: [{ key, params, level: 'warn' }],
  };
  return { outcome: 'observed', report };
}
