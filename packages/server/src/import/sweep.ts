// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import {
  ACTOR_SCHEMA,
  LOREBOOK_SCHEMA,
  newTreatment,
  PRESET_SCHEMA,
  TREATMENT_SCHEMA,
  uuidv7,
  type ImportDisposition,
  type PortableSchemaId,
  type Provenance,
  type ImportDestination,
  type ImportItemReport,
  type ImportNote,
  type ImportReport,
  type Actor,
  type EmbeddedMedia,
  type Lorebook,
  type Ref,
  type Treatment,
  isKnownSchema,
  schemaIdOf,
  validate,
} from '@storyengine/shared';

import { convertCharacter } from './aventuras/character.js';
import { importChats, type ChatPass } from './chat-sessions.js';
import { convertAventurasLorebook, type ConvertedAventurasLorebook } from './aventuras/lorebook.js';
import { AVT_FORMAT, type AvtStory } from './aventuras/avt.js';
import { AVENTURAS_DATABASE, AventurasReader } from './aventuras/reader.js';
import { convertScenario, type ConvertedScenario } from './aventuras/scenario.js';
import { carryPictures, planPictures, type CarriedPictures } from './aventuras/pictures.js';
import { produceStory, STORY_FORMAT } from './aventuras/story.js';
import type { AventurasStoryRows } from './aventuras/story-rows.js';
import { produceWorld, type WorldProduction } from './aventuras/world.js';
import { isRecord, linkedLorebookId } from './aventuras/shapes.js';
import { VAULT_CHARACTER_FORMAT } from './aventuras/vault-character.js';
import {
  convertVaultLorebook,
  LOREBOOK_TABLE,
  VAULT_LOREBOOK_FORMAT,
} from './aventuras/vault-lorebook.js';
import { UNTITLED_SCENARIO, VAULT_SCENARIO_FORMAT } from './aventuras/vault-scenario.js';
import { VAULT_TAG_FORMAT, VaultTagMerge } from './aventuras/vault-tag.js';
import {
  DEFAULT_BACKUP_CONFLICT,
  identify,
  identifyNative,
  priorImportId,
  priorImportRef,
  scenarioStamp,
  stableId,
  stampImported,
  type ConflictPolicy,
} from './identity.js';
import { blankCardPixels, create, read, update, type LibraryContext } from '../library.js';
import { contentHashOf } from '../index-db/ingest.js';
import { codecFor } from '../storage/card/index.js';
import { fileExists, writeFileBytes } from '../storage/files.js';
import { userOwner } from '../storage/layout.js';
import { resolveWithin } from '../storage/paths.js';
import type { BlobStore } from '../storage/card/envelope.js';
import { sniff } from '../auth/avatars.js';
import type { Logger } from '../state/commit.js';
import { importSession, priorSessionImport } from '../sessions/import.js';
import { readSession, type SessionContext } from '../sessions/store.js';
import type { SessionFile } from '../sessions/types.js';
import type { TagStore } from '../tags/store.js';
import { classifyRoot } from './detect.js';
import { MARINARA_CHATS_FORMAT } from './marinara/chat.js';
import { convertLorebook as convertMarinaraLorebook } from './marinara/lorebook.js';
import { convertPreset as convertMarinaraPreset } from './marinara/preset.js';
import { BackupReader } from './storyengine/reader.js';
import { CharxReader } from './charx/reader.js';
import { MarinaraReader } from './marinara/reader.js';
import type { ParseOutcome } from './parse.js';
import { nameOf, PRESET_CONVERTERS, type PresetConverter } from './preset-converters.js';
import { convertCard } from './sillytavern/card.js';
import { SILLYTAVERN_CHAT_FORMAT, SILLYTAVERN_GROUP_FORMAT } from './sillytavern/chat.js';
import { convertLorebook } from './sillytavern/lorebook.js';
import { SillyTavernReader } from './sillytavern/reader.js';
import type { FileSource, ImportCandidate, SourceReader, SourceRefusal } from './source.js';

/**
 * Reads a root, writes what it finds, and returns the review
 * ([P4 §1.3](../../../../docs/design/workplan/16-p4-implementation.md)).
 *
 * **The pre-flight survey is separate from the reading, and that ordering is the
 * whole safety property**: a refusal after the first object is written is a
 * half-import, which is worse than none. So the root is classified and surveyed
 * before anything is created, and a refusal returns with the library untouched.
 *
 * **Import commits immediately and the review reports loudly** (§1.4). There is
 * no staging area — a second library to maintain — and dangling references are
 * survivable, visible and non-blocking by stance ([00 §3.3]), so nothing has to
 * be fixed before commit for the library to be safe.
 */

export class ImportNotImplementedError extends Error {
  constructor(what: string) {
    super(`${what} is not read by this build yet.`);
    this.name = 'ImportNotImplementedError';
  }
}

export interface SweepRequest {
  library: LibraryContext;
  /** Whose library the objects land in. */
  handle: string;
  /**
   * ***The account's tag registry*** —
   * [P13.6](../../../../docs/design/workplan/30-p13-aventuras-import.md).
   *
   * **Only one source writes to it**: an Aventuras database, whose
   * `vault_tags` rows are merged into the registry of `handle` (§1.8). Every
   * other source leaves it alone — a backup's tags are merged *around* the
   * sweep, by `backup/import.ts`, from the archive's own `tags.json`.
   *
   * ***Required, though one source in six reads it***, which is the opposite
   * of the optional fields below, and deliberately. Those are answers to a
   * question only one source asks, and absent has a right default. Here
   * absent has none: a sweep of a database without the store would have to
   * report its tags as converted when nothing was written, or say
   * `recorded` for a table the registry calls `converted`, and a caller that
   * forgot the field would find out from a person asking where their colours
   * went. The type checker finds it instead, at every door that sweeps.
   */
  tags: TagStore;
  /** The root, already opened as a source. Transport is the caller's business. */
  files: FileSource;
  /** Identifies the review; the sweep job's id in a real run. */
  jobId?: string;
  /**
   * What a re-import does when the file has changed ([P4 §1.3]).
   *
   * `replace` is the default because it is the safe one: the write goes through
   * `update()` and history snapshots the state it replaced, so a person's own
   * edits become a version rather than a loss. `keep-both` doubles deliberately
   * and says so; `skip` writes nothing and reports the difference.
   */
  onConflict?: ConflictPolicy;
  /**
   * Which account's subtree a backup root is read for —
   * [P12.8](../../../../docs/design/workplan/29-p12-implementation.md).
   *
   * **Only one source reads it**, exactly as `asKind` below is read by one.
   * An install archive holds several accounts and *which of them are you
   * importing* is a fact about the request rather than about the archive, so
   * the reader is told. Absent means `handle` — a person importing their own.
   */
  fromHandle?: string;
  /**
   * Which kind a source with a genuine choice should become.
   *
   * **Optional, and only one format reads it.** Aventuras' `VaultScenario` is
   * the conflated object [04 §6] names, and unconflating it is a reading of the
   * file rather than a fact about it — so the reading is the caller's to make
   * and `treatment` is what it defaults to. Every other format ignores this:
   * a card is an Actor and a world file is a Lorebook, and a request that
   * carried an answer for them would be carrying an answer to no question.
   *
   * Absent on a folder sweep, which is the right shape rather than an omission:
   * §1.4 commits a sweep first and reports after, so there is nobody to ask, and
   * the default is the one a person would have picked.
   */
  destination?: ImportDestination;
  /**
   * ***The name the root arrived under***, when it arrived as one file: an
   * uploaded archive's filename, never a path ([21 §4.1.1]). A CHARX is
   * identified by it (see `CharxReader`); every other source ignores it.
   */
  rootName?: string;
  /**
   * ***How much the disk has free*** — `AppServices.freeBytes`, passed by the
   * routes — [P13.2](../../../../docs/design/workplan/30-p13-aventuras-import.md).
   *
   * **Only one reader asks**: the Aventuras reader, whose snapshot checks for
   * room before it copies somebody's whole database into scratch. Absent
   * means the storage layer's own `freeBytes`. On the request rather than
   * found by the reader because the services already hold the one seam a
   * test uses to answer *full* — the backup's room check reads it — and an
   * import copy that asked the disk by another road would be the one room
   * check that seam could not reach. *Found at the P13.2 review*, which found
   * the route test mocking the storage module to get there.
   */
  freeBytes?: (path: string) => Promise<number | null>;
  /**
   * ***Where the sweep says what it could not put in the report*** —
   * [P13.3](../../../../docs/design/workplan/30-p13-aventuras-import.md).
   *
   * One thing today: a reader whose `close()` failed after a reading that
   * succeeded (see {@link sweep}). The routes pass the request's own logger,
   * so the line carries the request id beside everything else that request
   * did. Absent — a test, or a caller with no request — the failure is not
   * heard, and the boot sweep of the scratch root is still the backstop for
   * what it left.
   */
  log?: Pick<Logger, 'warn'>;
  /**
   * ***Bring the stories across as sessions, into these*** —
   * [P13.11](../../../../docs/design/workplan/30-p13-aventuras-import.md).
   *
   * **Only one source reads it**, an Aventuras database, whose every story
   * becomes a session (`aventuras/story.ts`, handed to `importSession`) when
   * this is present, and stays the `recorded` row it was at P13.2 when it is
   * absent.
   *
   * ***Absent is the default, and a person asks.*** Nothing in [P13] or
   * [18] says whether a library sweep brings stories, so the choice is this
   * stage's, and it takes the conservative one on three counts:
   *
   * - **Scale, and where it lands.** A person pointing the panel at their
   *   Aventuras folder to bring their characters across would find two
   *   hundred sessions in their session list beside the three they play —
   *   the library is a list they curate, and a session list is where they
   *   work. A sweep that writes into the second should be one they chose.
   * - **No undo that matches the gesture.** Every library object a sweep
   *   writes is versioned and replaced in place by the next sweep; a session
   *   is never replaced ([P12.8]'s rule, `backup/import.ts`), so a sweep that
   *   made two hundred sessions by accident is two hundred deletions to take
   *   back, one at a time.
   * - **Part 1 stays what it was.** Every sweep before P13.11 wrote no
   *   session, and every client, test and API caller that sweeps without
   *   asking still gets that — including a re-sweep for a library's new
   *   characters, which is the commonest reason to sweep again.
   *
   * **The context rather than a flag**, which is `tags`' argument made
   * optional: a flag that said *yes* with no session store to write into
   * would have to report stories as imported while writing nothing, so the
   * one field is both the question and what answering it needs, and the type
   * checker keeps them together. Every door that sweeps passes it when its
   * request says `stories`.
   */
  stories?: {
    sessions: SessionContext;
    /**
     * The largest story picture carried, decoded ([P13.13]) — the Aventuras
     * reader's `maxPictureBytes`, sixty-four megabytes when absent. On the
     * story context because only a story reads it, and there so a test can
     * meet the bound through the Writer without a sixty-four-megabyte
     * fixture; no door sets it.
     */
    maxPictureBytes?: number;
  };
  /**
   * ***Where a chat's session is written*** —
   * [P14.8](../../../../docs/design/workplan/31-p14-scene-and-session-import.md).
   *
   * A sweep writes library objects through `library` and, since P14.8, sessions
   * through this: a SillyTavern tree's chats become sessions in the same pass
   * that brings in the cards they are with ([P14 §2.1]). **Every route passes
   * it.** Absent is a sweep asked for library objects only — the backup
   * import, whose sessions travel their own way, and the tests of the library
   * half — and there each chat is reported `recorded` with a note that says
   * this import does not take chats, so leaving it out is never silent.
   *
   * ***Beside `stories`, not folded into it*** — the two arrived on two
   * branches at once (P13.11 and P14.8) and answer different questions with
   * the same store. A chat is taken unless the person said not to; an
   * Aventuras story only when they asked, for the reasons `stories` gives. So
   * a door passes this always and `stories` when its request says so, and
   * one field could not say both.
   */
  sessions?: SessionContext;
  /**
   * ***Whether chats were asked for*** — [P14.8]'s opt-in. Absent is yes,
   * which is a server-path sweep and a zip: the person pointed at a folder and
   * everything in it that converts, converts. The browser folder upload says
   * `false` when the person did not choose chats, because then they were named
   * and never sent, and each is reported `skipped` — deliberately not taken —
   * rather than *could not be read*.
   */
  chats?: boolean;
  /**
   * ***Chats the person chose that the upload could not carry*** — [P14.8].
   * The browser folder upload plans chats after the library, so when chats
   * were chosen and some did not fit under `limits.maxUploadMb`, those were
   * named and not sent. Each is reported `skipped` over the limit, which is
   * why, rather than *could not be read*, which is what a named file with no
   * bytes otherwise reads as. `uploadLimitMb` is the limit, for the sentence.
   */
  notCarried?: ReadonlySet<string>;
  uploadLimitMb?: number;
}

export type SweepOutcome =
  | { ok: true; report: ImportReport }
  /** Refused before anything was written, which is the only safe way to refuse. */
  | { ok: false; refusal: SourceRefusal };

export async function sweep(request: SweepRequest): Promise<SweepOutcome> {
  const classification = await classifyRoot(request.files);
  if (!classification.ok) {
    return { ok: false, refusal: classification.refusal };
  }

  const reader = readerFor(classification.kind, request);
  if (reader === null) {
    throw new ImportNotImplementedError(`a ${classification.kind} root`);
  }

  /**
   * ***The reader is let go of however the reading ends*** —
   * [P13.2](../../../../docs/design/workplan/30-p13-aventuras-import.md).
   * The Aventuras reader is the first to hold anything (`SourceReader.close`):
   * a copy of somebody's whole install in our scratch, and a handle on it. A
   * survey that refused, items read to the end and items that threw half way
   * all pass through here.
   *
   * *A `finally` in effect, with the first cause kept.* When the reading
   * threw, a `close()` that also throws must not replace the error that
   * explains what happened — `ScratchSpace.dispose`'s own advice — so it is
   * caught on that path, and the boot sweep of the scratch root is the
   * backstop for what it leaves.
   *
   * ***When the reading succeeded, a `close()` that throws is logged, and the
   * report still returns*** — P13.3, weighing again what P13.2 left it to.
   * P13.2 threw it, on the argument that a handle this process forgot would
   * otherwise show only in a directory nobody looks in, and that was cheap
   * while the reader wrote nothing. From P13.3 the reader's candidates are
   * written before `close()` runs, so a throw here would answer a request
   * whose characters are already in the library with a 500 and no review of
   * them — every object there, and nothing saying so, and no ledger row to
   * find it by. The report is the more important of the two, so it wins; the
   * forgotten handle is a `warn` line on the request's own log
   * (`SweepRequest.log`), and the boot sweep collects the copy it held.
   */
  let outcome: SweepOutcome;
  try {
    outcome = await readThrough(reader, classification.kind, request);
  } catch (error) {
    await reader.close?.().catch(() => undefined);
    throw error;
  }
  try {
    await reader.close?.();
  } catch (error) {
    request.log?.warn(
      {
        // Kebab, as the boot sweep's `import.scratch-swept` is: a log event,
        // not a review note, and spelled so the notes' vocabulary check
        // (`note-labels.test.ts`) does not ask the client for a sentence.
        event: 'import.reader-close-failed',
        kind: classification.kind,
        type: error instanceof Error ? error.name : typeof error,
        message: error instanceof Error ? error.message : String(error),
      },
      'An import reader could not let go of what it held; the report was returned, and the next start clears its scratch.',
    );
  }
  return outcome;
}

/** The survey, then every item: the half of {@link sweep} that runs while the reader is held. */
async function readThrough(
  reader: SourceReader,
  kind: string,
  request: SweepRequest,
): Promise<SweepOutcome> {
  const survey = await reader.survey();
  if (!survey.ok) return { ok: false, refusal: survey.refusal };

  const items: ImportItemReport[] = [];
  /**
   * ***A backup nobody chose a policy for is `skip`***, whichever door it came
   * through — `DEFAULT_BACKUP_CONFLICT`'s reasoning. The backups route has
   * always said so; a folder upload or a server path reaches here with no
   * policy, and `replace` reverted a live account's edits to the archive's.
   */
  const writer = new Writer(
    kind === 'storyengine-backup' && request.onConflict === undefined
      ? { ...request, onConflict: DEFAULT_BACKUP_CONFLICT }
      : request,
  );
  /** Chat files and group files, held back for the session pass below. */
  const chats: ImportCandidate[] = [];

  for await (const item of reader.items()) {
    if (item.outcome === 'observed') {
      items.push(item.report);
      continue;
    }
    if (isChat(item.candidate)) {
      chats.push(item.candidate);
      continue;
    }
    items.push(await writer.write(item.candidate));
  }

  // Treatments are created *after* the cards that named them, because
  // deduplication needs to have seen them all first (§1.10).
  items.push(...(await writer.flushTreatments()));

  /**
   * ***The session pass, after everything the chats could name*** —
   * [P14.8](../../../../docs/design/workplan/31-p14-scene-and-session-import.md).
   *
   * A chat names its speakers by the card files beside it, and resolution
   * finds a card through the import stamp its own write left
   * (`chat/resolve.ts`). So the order is the whole of the design: in one walk,
   * a chat met before its card would resolve against a library that did not
   * have the card yet, and a tree of cards and chats — the ordinary shape of a
   * SillyTavern folder — would import every conversation with its characters
   * missing. After the library loop, and after the treatments, the library is
   * as complete as this sweep will make it.
   *
   * *Candidates held, not bytes*: each chat is read when the pass reaches it
   * (`chat-sessions.ts`), so waiting for the cards costs a list of paths.
   *
   * *One family, one session* ([P14.9]): the pass groups a character's chats
   * by `main_chat` into families and reads the `groups/` files beside them,
   * which is why it is handed the whole list at once rather than one
   * candidate at a time: a family is a question about more than one file.
   */
  items.push(...(await importChats(chatPassOf(request), chats)));

  return {
    ok: true,
    report: {
      jobId: request.jobId ?? 'unsaved',
      source: kind,
      items,
      counts: countBy(items),
    },
  };
}

/**
 * The sweep's engine, at the scale of one file
 * ([P4 §7.1](../../../../docs/design/workplan/16-p4-implementation.md)).
 *
 * **Exported so the upload route has no converter of its own.** It had one for
 * three stages — three preset shapes and nothing else — and the cost was two
 * arms of the same feature disagreeing about what a lorebook is. Everything the
 * sweep gives an object comes with this: the note vocabulary, re-import
 * identity, the version-history `import` attribution, scenario deduplication and
 * the portrait.
 *
 * `flushTreatments` is called here rather than left to the caller, because a
 * card that names a scenario produces **two** objects and forgetting the second
 * is a silent loss rather than an error. One candidate is therefore a list of
 * reports and not a single one — the shape tells the caller that.
 */
export async function convertOne(
  request: SweepRequest,
  candidate: ImportCandidate,
): Promise<ImportItemReport[]> {
  /**
   * ***A chat is one file too*** — [P14.8]'s *"one file"* door. Handed to the
   * same session pass a sweep ends with, over the request's one-file source, so
   * an uploaded `.jsonl` becomes a session by exactly the path a swept one
   * does, and the upload route learns nothing about chats but to pass
   * `sessions`.
   */
  if (isChat(candidate)) return importChats(chatPassOf(request), [candidate]);
  const writer = new Writer(request);
  const first = await writer.write(candidate);
  return [first, ...(await writer.flushTreatments())];
}

/**
 * A candidate for the session pass rather than the library writer — a chat file
 * or a group's file, however the reader found it: by position in a tree
 * (`sillytavern/reader.ts`), or by its lines in a loose folder (`upload.ts`);
 * or, since [P14.10], a Marinara store's chat tables (`marinara/reader.ts`),
 * which name their speakers by the character rows this sweep writes first.
 */
function isChat(candidate: ImportCandidate): boolean {
  return (
    candidate.format === SILLYTAVERN_CHAT_FORMAT ||
    candidate.format === SILLYTAVERN_GROUP_FORMAT ||
    candidate.format === MARINARA_CHATS_FORMAT
  );
}

/** What the session pass needs from a sweep request. */
function chatPassOf(request: SweepRequest): ChatPass {
  return {
    door:
      request.sessions === undefined
        ? undefined
        : { library: request.library, sessions: request.sessions, handle: request.handle },
    files: request.files,
    take: request.chats ?? true,
    ...(request.notCarried === undefined ? {} : { notCarried: request.notCarried }),
    ...(request.uploadLimitMb === undefined ? {} : { limitMb: request.uploadLimitMb }),
  };
}

function readerFor(kind: string, request: SweepRequest): SourceReader | null {
  const { files, rootName } = request;
  const forHandle = request.fromHandle ?? request.handle;
  // `loose-files` is swept by the same walker: a folder of cards somebody
  // assembled by hand is the ST tree with most of it missing, and the walker
  // already reports what it does not recognise.
  if (kind === 'sillytavern') return new SillyTavernReader(files);
  // Told which root it is on, so its `default:` arm can ask the file rather
  // than the folder — see the constructor ([P4 §7.8]).
  if (kind === 'loose-files') return new SillyTavernReader(files, 'loose-files');
  if (kind === 'marinara') return new MarinaraReader(files);
  // A card in a zip rather than in a PNG chunk ([P4 §7.5]). One entry, one
  // candidate, and the same converter on the other side of it.
  if (kind === 'charx') return new CharxReader(files, rootName);
  // One of ours — [P12.8]. Told whose subtree to read, because an install
  // archive holds several and the archive does not know which was asked for.
  if (kind === 'storyengine-backup') return new BackupReader(files, forHandle);
  // A whole Aventuras install — [P13.2]. Given the library's own layout,
  // because the copy it reads is taken into that layout's scratch (§1.3), and
  // the services' free-space seam, because that copy is what needs the room.
  if (kind === 'aventuras') {
    const { freeBytes } = request;
    return new AventurasReader(files, request.library.layout, {
      ...(freeBytes === undefined ? {} : { seams: { freeBytes } }),
      // Told whether it was asked for stories, and nothing else about them:
      // the sessions are the Writer's to write.
      stories: request.stories !== undefined,
      ...(request.stories?.maxPictureBytes === undefined
        ? {}
        : { maxPictureBytes: request.stories.maxPictureBytes }),
    });
  }
  return null;
}

/**
 * Turns candidates into library objects.
 *
 * A class rather than a function because scenario deduplication is state that
 * spans the whole sweep — *one treatment per distinct scenario text* is not a
 * property any single card can enforce.
 */
class Writer {
  readonly #request: SweepRequest;
  /** Scenario text → the treatment it produced, and the actors that named it. */
  readonly #scenarios = new Map<
    string,
    { treatment: Treatment; actorIds: string[]; lore: string[] }
  >();
  /**
   * ***A vault lorebook's Aventuras id → the book it is in this library*** —
   * [P13 §1.7](../../../../docs/design/workplan/30-p13-aventuras-import.md).
   *
   * `metadata.linkedLorebookId` on a `character_vault` or `scenario_vault` row
   * names a `lorebook_vault` row by *its* id, which means nothing here; what
   * it should become is the id of the book that row made. The reader emits the
   * books first (its `CONVERTED_TABLES` order), so by the time a character or
   * a scenario asks, every book this sweep will write is written, and this is
   * where each says what it became.
   *
   * ***Every book `store()` settled, not only those it wrote.*** A book
   * `unchanged` since the last sweep, or one a `skip` left alone, is still the
   * book the link means, under the id `identify` re-pointed it to — so a
   * re-sweep and a `skip` resolve exactly as a first sweep does, and a link
   * resolved twice is the same link, which is what lets a character or a
   * scenario compare `unchanged` the second time. Under `keep-both` it is the
   * copy this sweep made, which is the one written beside the copy linking to
   * it. A book that `failed` is not here, and is the one case a link falls
   * through to the library (`#linkedLorebook`).
   */
  readonly #vaultLorebooks = new Map<string, Ref>();
  /**
   * ***`vault_tags` rows, into the registry*** — [P13.6]. Per Writer, which is
   * per sweep, because which tags *this* sweep minted is state that spans it:
   * it is what reports the second kind's row of a shared name `converted` on
   * a first import and `unchanged` on the next (`vault-tag.ts`).
   */
  readonly #vaultTags: VaultTagMerge;

  constructor(request: SweepRequest) {
    this.#request = request;
    this.#vaultTags = new VaultTagMerge(request.tags, request.handle);
  }

  /**
   * One candidate, into the library, as one row of the review.
   *
   * ***The reader's own notes come first*** (P13.3, `ImportCandidate.notes`):
   * what it read around before any converter saw the object — a column that
   * would not parse, a portrait too large to carry. Merged here rather than in
   * the arm that reads them, so no arm can be the one that drops them.
   */
  async write(candidate: ImportCandidate): Promise<ImportItemReport> {
    const report = await this.#convert(candidate);
    if (candidate.notes === undefined || candidate.notes.length === 0) return report;
    return { ...report, notes: [...candidate.notes, ...report.notes] };
  }

  async #convert(candidate: ImportCandidate): Promise<ImportItemReport> {
    /**
     * The preset formats come from a table rather than from case labels, so the
     * preview can make the same three-way choice without reaching a method whose
     * every arm ends in a store (`preset-converters.ts`). Asked before the
     * switch, not inside it, because a `case` per table key would leave the
     * table and the labels as two lists to keep in step.
     */
    const preset = PRESET_CONVERTERS[candidate.format];
    if (preset !== undefined) return this.#preset(candidate, preset);

    switch (candidate.format) {
      case 'sillytavern.card':
        return this.#card(candidate);
      case 'sillytavern.persona':
        return this.#persona(candidate);
      case 'sillytavern.lorebook':
        return this.#lorebook(candidate);

      // Marinara's are redirections rather than a second conversion: a Marinara
      // card is a V2 card, and its preset is the same prompt-manager lineage
      // [04 §8.4] was written against ([P4 §1.5]).
      case 'marinara.character':
        return this.#card(candidate);
      case 'marinara.persona':
        return this.#marinaraPersona(candidate);
      case 'marinara.lorebook':
        return this.#marinaraLorebook(candidate);
      case 'marinara.preset':
        return this.#marinaraPreset(candidate);

      // Aventuras' three single-file vault exports ([P4 §1.5]). Its *fourth*
      // path — lorebooks written as SillyTavern files — needs no arm, and has
      // not since P4.2: it arrives above, as `sillytavern.lorebook`.
      case 'aventuras.scenario':
        return this.#aventurasScenario(candidate);
      case 'aventuras.character':
        return this.#aventurasCharacter(candidate);
      case 'aventuras.lorebook':
        return this.#aventurasLorebook(candidate);
      // A `lorebook_vault` row rather than a file (P13.4): a second format and
      // not the file's, because a row carries the book's own name, description
      // and tags, and its entries in the vault's flat shape.
      case VAULT_LOREBOOK_FORMAT:
        return this.#aventurasVaultLorebook(candidate);
      // A `character_vault` and a `scenario_vault` row (P13.5): the file's own
      // converters, and a link to a vault book resolved beside them, which is
      // what a row can do and a file cannot (§1.7).
      case VAULT_CHARACTER_FORMAT:
        return this.#aventurasVaultCharacter(candidate);
      case VAULT_SCENARIO_FORMAT:
        return this.#aventurasVaultScenario(candidate);
      /**
       * ***A `vault_tags` row (P13.6), and the one arm that does not end in
       * `store()`.*** A tag is a registry entry, not a library object: it has
       * no provenance for `identify()` to key a re-import on, no slug and no
       * history, and the name *is* its identity (`sameTag`). So it is merged
       * rather than stored, and `onConflict` is not consulted — a merge never
       * overwrites, so `replace` must not recolour either; the reasons are at
       * `VaultTagMerge.write`.
       */
      case VAULT_TAG_FORMAT:
        return this.#vaultTags.write(candidate);
      /**
       * ***An Aventuras story (P13.11), and the one arm that ends in a
       * session rather than a library object.*** The producer makes a
       * document and `importSession` writes it, so this arm is the hand-over
       * and the review row and nothing more — see `#aventurasStory`.
       */
      case STORY_FORMAT:
        return this.#aventurasStory(candidate);
      /**
       * ***The same story, from its `.avt` (P13.15)*** — the same arm under
       * another row source, so the same producer makes the same session and
       * the same key finds it again. See `#aventurasAvt`.
       */
      case AVT_FORMAT:
        return this.#aventurasAvt(candidate);

      /**
       * ***One of ours, which needs no conversion and therefore needs a
       * check*** — [P12.8]. Every other arm above turns somebody else's format
       * into one of our objects; this one is handed one and has to decide
       * whether to believe it.
       */
      case 'storyengine.object':
        return this.#native(candidate);

      default:
        return { source: candidate.source, disposition: 'unrecognised', notes: [] };
    }
  }

  /**
   * ***A story, into a session*** —
   * [P13.11](../../../../docs/design/workplan/30-p13-aventuras-import.md).
   *
   * **The producer makes the document and the reader writes it**
   * (`aventuras/story.ts`, `sessions/import.ts`): this arm writes no session
   * itself, which is [P13 §0.3]'s whole promise about Part 2's shape. It
   * passes the story's key as `originalFilename`, so a second sweep is
   * refused `already-here` naming the session the first made; and
   * `requireLinks`, because a producer writes whatever its session links to
   * before it writes the session — so a link that resolves to nothing is the
   * producer's own defect.
   *
   * ***And since P13.12, what it links to*** — the story's world, resolved
   * for the branch the session opens on (`aventuras/world.ts`, pure), written
   * here as the story's cast and its lorebook through the same `store()` and
   * `#createActor` every other import takes, and only then linked from the
   * document as `cast` and `lore`. See {@link Writer.#storyWorld}.
   *
   * ***Already here is `unchanged`, whatever `onConflict` says*** — the
   * backup's rule for a session, for the backup's reason: a session is an
   * append-only log somebody may have played on since, so *replace* would be
   * a delete and an import wearing one word, and *keep both* would be a
   * second session holding the same turn ids, which the reader refuses. A
   * story changed in Aventuras since it was brought across is therefore not
   * brought across again, and the note says so.
   *
   * ***The world follows the session*** (P13.12), and so it is asked first.
   * The cast and the book are written before the session because the session
   * must link to things that exist — which, for a story already here, would
   * mean writing a world for a session that is not going to be written: under
   * `replace` a character rewritten beside turns that never met the rewrite,
   * and a character new in Aventuras since made an actor nobody's cast names.
   * The note already promises that nothing written in Aventuras since comes
   * across; the world keeping that promise is what makes it true. So a story
   * already here is found by its key before anything is produced
   * (`priorSessionImport`), nothing of its world is written, and the row names
   * what the session here already links to — the actors and the book an
   * earlier sweep made, unchanged because untouched.
   */
  async #aventurasStory(candidate: ImportCandidate): Promise<ImportItemReport> {
    const { source } = candidate;
    const stories = this.#request.stories;
    // The reader emits a story as a candidate only when the sweep asked, so
    // this is a caller that built a candidate by hand: say what it is, and
    // write nothing, as the reader would have.
    if (stories === undefined) return { source, disposition: 'recorded', notes: [] };
    return this.#story(stories, source, source, candidate.payload as AventurasStoryRows);
  }

  /**
   * ***A story from its `.avt`*** —
   * [P13.15](../../../../docs/design/workplan/30-p13-aventuras-import.md).
   *
   * **The row is the file's and the key is the story's.** The review names
   * the file a person handed over — `stories/the-lantern-fork.avt`, or the
   * upload's own name — while the session, its cast and its book are keyed
   * `aventura.db/stories/<id>`, from the story's id in the file, which is the
   * database's key for the same story (`aventuras/avt.ts` says why that id
   * survives). So this arm and the database's are one arm under two row
   * sources, and a story brought across by either is `already-here` by the
   * other.
   *
   * ***Unasked, it is the database's `recorded` row***, with the same
   * counts: a folder of `.avt` files swept for its cards is a library sweep
   * as much as a database is, and `SweepRequest.stories`' reasons hold for
   * it. The file door asks for a hand-picked one — see `importOneFile`.
   */
  async #aventurasAvt(candidate: ImportCandidate): Promise<ImportItemReport> {
    const { source } = candidate;
    const file = candidate.payload as AvtStory;
    const stories = this.#request.stories;
    if (stories === undefined) {
      return {
        source,
        disposition: 'recorded',
        notes: [
          {
            key: 'import.aventuras.storyRecorded',
            params: { story: file.title, ...file.tally },
            level: 'info',
          },
          ...file.notes,
        ],
      };
    }

    const rows =
      stories.maxPictureBytes === undefined
        ? file.rows
        : file.withPictureBound(stories.maxPictureBytes);
    // What stays behind, as the database reader says it on the candidate.
    const { chapters, checkpoints } = file.tally;
    const behind: ImportNote[] =
      chapters + checkpoints === 0
        ? []
        : [
            {
              key: 'import.aventuras.storyWorldRecorded',
              params: { story: file.title, chapters, checkpoints },
              level: 'info',
            },
          ];
    const report = await this.#story(stories, source, file.key, rows);
    return { ...report, notes: [...behind, ...file.notes, ...report.notes] };
  }

  /**
   * ***One story, into one session*** — the body of both story arms. `source`
   * is the review row's name; `key` is the story's, which the session, its
   * turns and its world are keyed by — the same thing for a database's row,
   * and not for a file.
   */
  async #story(
    stories: NonNullable<SweepRequest['stories']>,
    source: string,
    key: string,
    rows: AventurasStoryRows,
  ): Promise<ImportItemReport> {
    const { handle } = this.#request;
    const story = rows.story.title;
    const alreadyHere: ImportNote = {
      key: 'import.aventuras.storyAlreadyHere',
      params: { story },
      level: 'info',
    };

    const prior = priorSessionImport(stories, handle, key);
    if (prior !== null) {
      const here = await readSession(stories.sessions, handle, prior.sessionId);
      const linked = here === null ? [] : linksOf(here);
      return {
        source,
        disposition: 'unchanged',
        objectId: prior.sessionId,
        ...(linked.length === 0 ? {} : { alsoProduced: linked }),
        notes: [alreadyHere],
      };
    }

    const produced = produceStory(rows, { handle, origin: key });
    if (!produced.ok) {
      // No session, so no world either: a cast and a book with nothing
      // linking to them would be objects this import made for nobody.
      return {
        source,
        disposition: 'skipped',
        notes: [
          { key: 'import.aventuras.storyEmpty', params: { story }, level: 'info' },
          ...produced.notes,
        ],
      };
    }

    const world = produceWorld(rows, key);
    const stored: ImportNote[] = [];
    const links = await this.#storyWorld(rows, world, stored);
    const { session } = produced.document;
    if (links.persona !== null || links.actors.length > 0) {
      session['cast'] = { persona: links.persona, actors: links.actors };
    }
    if (links.lore !== null) session['lore'] = [links.lore];
    const alsoProduced = links.written;

    /**
     * ***And its pictures*** (P13.13) — records beside the turns, their bytes
     * read now to say what they are and read again by `importSession` as it
     * writes them into the session it has just made (`pixels`). Nothing is
     * written here: a refusal below leaves no picture anywhere, because the
     * reader refuses before the session's folder exists.
     */
    const plan = planPictures(rows, produced.placement, story);
    const pictures = carryPictures(plan, rows.pictures.read, rows.pictures.maxBytes, story);
    produced.document.renditions = pictures.renditions;
    const said = [...produced.notes, ...world.notes, ...plan.notes, ...pictures.notes, ...stored];

    const result = await importSession(stories, handle, produced.document, {
      originalFilename: key,
      requireLinks: true,
      pixels: pictures.pixels,
    });
    if (result.ok) {
      // Aventuras' word on its way into the ledger, so clamped; at the pin it
      // is one of two short ones.
      const mode = produced.mode.slice(0, 64);
      // `appended` only on the chat doors' `extend` arm, which a producer
      // never asks for; read so the type says so.
      const turns = result.extended === true ? result.appended : result.turns;
      return {
        source,
        disposition: 'converted',
        objectId: result.sessionId,
        ...(alsoProduced.length === 0 ? {} : { alsoProduced }),
        notes: [
          {
            key: 'import.aventuras.storyImported',
            params: { story, turns, branches: produced.branches, mode },
            level: 'info',
          },
          ...worldSaid(story, world, links),
          ...picturesSaid(story, pictures),
          ...said,
        ],
      };
    }
    if (result.reason === 'already-here') {
      return {
        source,
        disposition: 'unchanged',
        // The session an earlier sweep made, when the key found it — which is
        // the answer a person can act on: it is here, and this is where.
        ...('prior' in result ? { objectId: result.prior.sessionId } : {}),
        ...(alsoProduced.length === 0 ? {} : { alsoProduced }),
        notes: [alreadyHere, ...stored],
      };
    }
    return {
      source,
      disposition: 'unrecognised',
      // Written before the refusal and still in the library, so still named:
      // a person looking for them finds the row that made them.
      ...(alsoProduced.length === 0 ? {} : { alsoProduced }),
      notes: [
        {
          key: 'import.aventuras.storyRefused',
          params: { story, reason: result.reason },
          level: 'warn',
        },
        ...said,
      ],
    };
  }

  /**
   * ***A story's world, into the library, before the session that links to
   * it*** — [P13.12](../../../../docs/design/workplan/30-p13-aventuras-import.md).
   *
   * **Each object is an import of its own**, keyed under the story's
   * ([§1.5]): an actor `aventura.db/stories/<id>/characters/<canonical id>`,
   * the book `aventura.db/stories/<id>/lorebook`. So a story swept again after
   * its session was deleted finds the actors and the book it made, and
   * `identify` settles them as it settles every other import — `unchanged`
   * when nothing moved, and under the request's policy when something did.
   *
   * ***The vault's roads, not a second one.*** A character goes through
   * `#createActor`, as a vault character does, so its portrait — read from the
   * database one character at a time, now that its actor is about to be
   * stored, and bounded as P13.3 bounds a vault portrait — becomes the card
   * when it is a PNG and rides beside it when it is not. The book goes through
   * `store()`, as a vault book does.
   *
   * ***One that fails costs itself.*** A character or a book the library will
   * not take is left out of the links, with the note `store()` wrote, and the
   * session is imported without it: [21 §4.1.1]'s poisoned-file rule one
   * level down, and the same rule `#createActor` keeps for a portrait. The
   * link that remains resolves, so `requireLinks` still holds.
   */
  async #storyWorld(
    rows: AventurasStoryRows,
    world: WorldProduction,
    notes: ImportNote[],
  ): Promise<StoryLinks> {
    const links: StoryLinks = { persona: null, actors: [], lore: null, written: [] };

    for (const member of world.cast) {
      const { actor } = member;
      stampImported(actor, member.source);
      // Beneath the actor's own key, as a vault character's is beneath its
      // row's: a path no file in the root can have.
      const key = `${member.source}/portrait`;
      const portrait = member.hasPortrait
        ? rows.world.portrait(member.rowId, actor.name, key, notes)
        : null;
      const outcome = await this.#createActor(
        {
          source: member.source,
          format: STORY_FORMAT,
          payload: null,
          ...(portrait === null ? {} : { assets: [key], inline: new Map([[key, portrait]]) }),
        },
        actor,
        notes,
      );
      if (outcome === 'failed') continue;
      links.written.push(actor.id);
      if (member.protagonist) links.persona = actor.id;
      else links.actors.push(actor.id);
    }

    const { lorebook } = world;
    if (lorebook !== null) {
      stampImported(lorebook, world.lorebookSource);
      const outcome = await this.store(lorebook, LOREBOOK_SCHEMA, notes);
      if (outcome !== 'failed') {
        links.lore = lorebook.id;
        links.written.push(lorebook.id);
      }
    }
    return links;
  }

  /**
   * ***An object of ours, out of a backup*** — [P12.8].
   *
   * ***It validates rather than converts, and the difference is the whole
   * arm.*** A stored object arrives as `unknown` because the library is a
   * folder somebody may hand-edit ([10 §2.1]) and an archive is a file that
   * survived a disk that may have had a bad week — so *typed* and *conformant*
   * are different claims about it, which is the distinction
   * `export/writers.ts` makes going the other way. Below the guard, every field
   * is one the schema guarantees.
   *
   * ***It is deliberately not stamped as imported, and the first run of the
   * test is what settled that.***
   *
   * Every other arm calls `stampImported`, because a foreign file has no
   * provenance of its own and `originalFilename` is the only identity it will
   * ever have. A backup's contents already carry theirs — **this object was not
   * imported from anywhere, it is the one that was backed up** — and stamping
   * would rewrite two fields on the way in, so the re-encoded object would
   * never compare equal to the stored one.
   *
   * The consequence is the whole point: **importing a backup over a library it
   * came from reports `unchanged` and writes nothing**, where stamping made it
   * report `replaced` for every object and push a version into every history.
   * The first test written against this said `unchanged` and got `replaced`,
   * which is how the decision arrived.
   *
   * *Nothing is lost by not stamping*: the review row carries the archive path
   * as its `source`, and the import ledger records the job — so *where did this
   * come from* is answered by the things that exist to answer it.
   */
  async #native(candidate: ImportCandidate): Promise<ImportItemReport> {
    const checked = validate(candidate.payload);
    if (!checked.valid) return refusedItem(candidate, 'does-not-validate');

    const schemaId = schemaIdOf(candidate.payload);
    if (schemaId === null || !isKnownSchema(schemaId)) {
      return refusedItem(candidate, 'unknown-schema');
    }

    const object = candidate.payload as { id: string; name: string; provenance: Provenance };

    /**
     * ***An actor is created on the card it was archived as*** (2026-09-27).
     * The card is the portrait and carries the expressions and every embedded
     * picture as its own chunks, and the archive holds it whole; this passed
     * no pixels, so an actor brought back from a backup was written on the
     * blank 1×1 card with every `media` row naming bytes it did not have.
     * A `replace` keeps the portrait that is here and gains the archived
     * card's pictures, so the rows it writes resolve (see `update`'s
     * `extraBlobs` for why the portrait is not swapped).
     */
    let pixels: Uint8Array | null = null;
    if (schemaId === ACTOR_SCHEMA) {
      const card = await this.#request.files.read(candidate.source);
      pixels = card !== null && codecFor(card) !== null ? card : null;
    }

    const notes: ImportNote[] = [];
    const outcome = await this.store(object, schemaId, notes, pixels, undefined, true);
    if (outcome !== 'skipped' && outcome !== 'failed') {
      await this.#carryAssets(candidate, object.id, schemaId, notes);
    }
    return {
      source: candidate.source,
      disposition: Writer.dispositionOf(outcome),
      notes,
    };
  }

  /**
   * ***The object's pictures, into its folder*** — what `candidate.assets`
   * holds for a backup's folder kinds (see `BackupReader`).
   *
   * **By the name they had**, which is their digest, so the object's `media`
   * rows resolve exactly as they did, and a file already there is the same
   * bytes and is left alone. After an `unchanged` as well as a write: the
   * object matching the archive does not mean its files survived. Never after
   * a `skip`, where the object here differs and its rows may name other
   * pictures, so these would be orphans.
   */
  async #carryAssets(
    candidate: ImportCandidate,
    id: string,
    schemaId: PortableSchemaId,
    notes: ImportNote[],
  ): Promise<void> {
    if (candidate.assets === undefined || candidate.assets.length === 0) return;
    const { library, handle } = this.#request;
    try {
      const row = read(library, handle, id, schemaId);
      const root = library.layout.assetsRoot(userOwner(handle), schemaId, row.slug);
      for (const path of candidate.assets) {
        // Within the object's own folder whatever the archive calls it: the
        // source refused `..` already, and this is the door that would not
        // need it to have.
        const to = resolveWithin(root, path.slice(path.lastIndexOf('/') + 1));
        if (to === root || (await fileExists(to))) continue;
        const bytes = await this.#request.files.read(path);
        if (bytes === null) continue;
        await writeFileBytes(to, bytes);
      }
    } catch (error) {
      notes.push({
        key: 'import.file.notStored',
        params: {
          object: candidate.source,
          reason: error instanceof Error ? error.name : 'unknown',
        },
        level: 'warn',
      });
    }
  }

  async #card(candidate: ImportCandidate): Promise<ImportItemReport> {
    const converted = convertCard(candidate.payload, nameOf(candidate.source));
    if (!converted.ok) return refusedItem(candidate, converted.refusal);

    const { actor, lorebook, scenario, notes } = converted.value;

    if (lorebook !== null) {
      /**
       * ***Both ids settled before either names the other*** (2026-09-27).
       *
       * The book is scoped to the card's actor and the actor links back to
       * the book, and the converter wrote both links with ids it had just
       * minted. `identify` re-points each object to the id its earlier import
       * has here, but only as that object is stored, so on every re-import
       * the book named an actor that did not exist and the actor linked a
       * book that was never stored. Neither could compare `unchanged`, and
       * every re-sweep added two history versions per such card.
       */
      const { library, handle } = this.#request;
      const bookSource = `${candidate.source}#character_book`;
      actor.id = priorImportId(library, handle, ACTOR_SCHEMA, candidate.source) ?? actor.id;
      lorebook.id = priorImportId(library, handle, LOREBOOK_SCHEMA, bookSource) ?? lorebook.id;
      lorebook.scope = { kind: 'linked', actorIds: [actor.id] };

      // The book travelled inside the card, so its identity is the card file.
      stampImported(lorebook, bookSource);
      const stored = await this.#store(lorebook, notes);
      if (!stored) return { source: candidate.source, disposition: 'unrecognised', notes };
      // Under the id it was stored with, which *keep both* makes a new one.
      actor.lore = [{ id: lorebook.id, name: lorebook.name }];
    }

    stampImported(actor, candidate.source);
    const outcome = await this.#createActor(candidate, actor, notes);
    if (outcome === 'failed') {
      return { source: candidate.source, disposition: 'unrecognised', notes };
    }

    if (scenario !== null) this.#rememberScenario(scenario, actor.id, lorebook?.id);

    return {
      source: candidate.source,
      disposition: Writer.dispositionOf(outcome),
      objectId: actor.id,
      // The book the card carried is a second object from one file, and its
      // notes are in this same array — so it has to be findable by its own id
      // or [P5 §1.8]'s question comes back empty for the commonest kind of
      // book there is.
      ...(lorebook === null ? {} : { alsoProduced: [lorebook.id] }),
      notes,
    };
  }

  async #persona(candidate: ImportCandidate): Promise<ImportItemReport> {
    const payload = candidate.payload as { name?: unknown; description?: unknown };
    if (typeof payload.name !== 'string') return refusedItem(candidate, 'missing-field');

    // A persona is an actor — the unified card exists because two of three
    // sources regret the split ([survey §4]).
    const converted = convertCard(
      { name: payload.name, description: payload.description ?? '' },
      payload.name,
    );
    if (!converted.ok) return refusedItem(candidate, converted.refusal);

    const actor = converted.value.actor;
    actor.roles = ['persona'];

    const notes: ImportNote[] = [];
    stampImported(actor, candidate.source);
    const outcome = await this.#createActor(candidate, actor, notes);
    return {
      source: candidate.source,
      disposition: Writer.dispositionOf(outcome),
      objectId: actor.id,
      notes,
    };
  }

  /**
   * Writes an actor, with its portrait if there is a usable one.
   *
   * **A portrait that will not read costs the portrait, not the actor.** The
   * fixture corpus caught this: an avatar file that is not an image made
   * `create()` refuse the whole card, so a character was lost over its picture.
   * That is the poisoned-file rule violated one level down — one bad asset never
   * costs the object it belongs to, exactly as one bad file never aborts a
   * sweep ([21 §4.1.1]).
   */
  async #createActor(
    candidate: ImportCandidate,
    actor: Actor,
    notes: ImportNote[],
  ): Promise<string> {
    const asset = candidate.assets?.[0];
    /**
     * ***Bytes the reader already holds come first*** —
     * [P13 §1.6](../../../../docs/design/workplan/30-p13-aventuras-import.md).
     * An Aventuras portrait is a column, not a file, so its reader decodes it
     * and hands the bytes over under the name it put in `assets`; every other
     * reader names a file, and the file source is asked as it always was.
     */
    const inline = asset === undefined ? undefined : candidate.inline?.get(asset);
    let pixels = asset === undefined ? null : (inline ?? (await this.#request.files.read(asset)));

    /**
     * ***A portrait that will not read costs the portrait, and only that***
     * (2026-09-27). This returned here, before the expressions were read, so a
     * CHARX whose first image is a JPEG or a WebP (common from RisuAI) lost
     * every expression with it and no note said so. The actor is now written
     * on the blank card, which is what an actor without a portrait always is,
     * and the expressions go into it as they would into any other.
     *
     * *And "will not read" means will not read, not only will not sniff*
     * (P13.3). A PNG signature over a body that does not parse — a truncated
     * portrait, which a data URL cut short in somebody's database is — passed
     * the sniff, and then `create()` threw on it and the actor was lost with
     * `notStored`. `readsAsCard` asks the codec the question `create()` will.
     */
    let portraitless = false;
    let portraitSource: { row: EmbeddedMedia; bytes: Uint8Array } | null = null;
    if (pixels !== null && !readsAsCard(pixels)) {
      /**
       * ***A portrait that is a picture and not a PNG rides beside the card***
       * — [P13 §1.6]. A card is a PNG (`codecFor` knows no other container),
       * and Aventuras keeps JPEG and WebP portraits too; dropping them would
       * make the full import lose faces the file import never had. So the
       * picture is kept as the card's `portrait-source` — [03 §5.2]'s *"the
       * uncropped original behind the card's own pixels"*, which is what it is
       * — on the blank card, and a person can crop a card from it later.
       *
       * **Only for bytes a reader handed over inline**, which today means a
       * portrait out of an Aventuras row, where the column says the picture
       * *is* the portrait. A file's first asset keeps its old answer
       * (`archives.test.ts` holds the CHARX case): whether a JPEG that happens
       * to lead a CHARX is a portrait is a separate question from this stage.
       *
       * *Sniffed, never taken from the name or the data URL*: `sniff` is the
       * one the account avatar and the library's own media upload use, so
       * this door accepts exactly the pictures those do.
       */
      const kind = inline === undefined ? null : sniff(pixels);
      if (kind !== null && kind.mime !== 'image/png') {
        const digest = contentHashOf(pixels);
        portraitSource = {
          row: {
            // From the key and the bytes, never the clock — the expressions'
            // reasoning below: a re-import of the same row must compare
            // `unchanged`, and a changed picture must be a new blob.
            id: stableId('portrait-source', asset ?? ''),
            role: 'portrait-source',
            mime: kind.mime,
            digest,
            bytes: pixels.byteLength,
            ref: stableId('portrait-source-ref', asset ?? '', digest),
            tags: [],
          },
          bytes: pixels,
        };
        notes.push({
          key: 'import.card.portraitAsSource',
          params: { actor: actor.name, format: IMAGE_FORMAT_NAMES[kind.mime] ?? kind.extension },
          level: 'info',
        });
      } else {
        notes.push({
          key: 'import.card.portraitUnreadable',
          params: { file: asset ?? '', actor: actor.name },
          level: 'warn',
        });
      }
      pixels = null;
      portraitless = true;
    }

    /**
     * ***Every other asset is an expression*** — [03 §5.2.2], [06 §7.2],
     * [P7.10].
     *
     * **`assets[0]` was the portrait and the rest were dropped**, which is why
     * no actor in any install could carry a sprite: a CHARX collects every
     * non-`card.json` entry ([import/charx/reader.ts]), and it arrived here and
     * went in the bin. (Marinara's `sprites/` do not reach here at all: its
     * reader carries only the avatar, and reports the sprites as waiting.)
     * [06 §7.2] has asked for sprites since the first draft and P9 declines
     * them in as many words — *"a sprite is not a rendition at 1.0… the backdrop
     * is here because it has no source anywhere else; sprites have one"*. This
     * is that source.
     *
     * ***`role: 'expression'`, and the filename stem is the `label`.***
     * [03 §5.2.2] fixes the role vocabulary and calls the embedded set *"the
     * character's visual identity — portrait source, references, a curated
     * expression set"*, which is what a `sprites/` folder is. The **name** is
     * the part with a choice in it: `EmbeddedMedia` carries both `label` and
     * `tags`, and [04 §3] draws the line — *"role — closed union. The engine
     * reads it and acts on it. tags — open. **Nothing in the engine branches on
     * them.**"* Expression selection is the engine branching on a name, so the
     * name is a `label`.
     *
     * *Counted in the review rather than done silently.* An import that
     * quietly grew a character eight pictures is a surprise; one that says it
     * did is a feature.
     */
    const rest = (candidate.assets ?? []).slice(1);
    const expressions: EmbeddedMedia[] = [];
    const blobs: BlobStore = new Map();
    if (portraitSource !== null) blobs.set(portraitSource.row.ref, portraitSource.bytes);

    for (const path of rest) {
      const bytes = await this.#request.files.read(path);
      // Unreadable or not an image: skipped, never fatal. One bad asset must
      // not cost the character it belongs to — the same rule the portrait above
      // follows, one level down again.
      const mime = mimeOf(path);
      if (bytes === null || mime === null) continue;

      /**
       * ***Ids from the file, not from the clock*** (2026-09-27), which is
       * what `identity.ts`'s `stableId` is for. They were minted fresh on every
       * conversion, so a re-upload of the same card could never compare
       * `unchanged`, and its replace wrote rows naming blobs the card on disk
       * had never held. The id comes from the path, so what points at an
       * expression survives a changed picture; the blob key comes from the
       * path and the bytes, so a changed picture is a new blob.
       */
      const digest = contentHashOf(bytes);
      const ref = stableId('expression-ref', path, digest);
      expressions.push({
        id: stableId('expression', path),
        role: 'expression',
        mime,
        digest,
        bytes: bytes.byteLength,
        ref,
        label: stemOf(path),
        tags: [],
      });
      blobs.set(ref, bytes);
    }

    if (expressions.length > 0) {
      notes.push({
        key: 'import.card.expressions',
        params: { actor: actor.name, count: String(expressions.length) },
        level: 'info',
      });
    }

    const media = portraitSource === null ? expressions : [portraitSource.row, ...expressions];
    const withMedia = media.length === 0 ? actor : { ...actor, media: [...actor.media, ...media] };

    // The blank card, only when there are pictures to carry on it: with none,
    // no canvas at all is the same file and the path every other actor takes.
    // A portrait source is one such picture — [P13 §1.6]'s *"on a blank card"*
    // is this line, which the expressions already needed, and not a second one.
    const canvas = portraitless && blobs.size > 0 ? blankCardPixels() : pixels;
    const outcome = await this.#write(
      withMedia,
      notes,
      canvas,
      blobs.size === 0 ? undefined : blobs,
    );
    /**
     * ***The id the object was stored under, back on the caller's actor*** —
     * found at P13.3. `store()` settles an object's id by writing to the one it
     * is handed — `identify` re-points a re-import to the id it already has
     * here, and *keep both* mints a fresh one — and an actor carrying media is
     * handed over as a copy. So every caller that then read `actor.id` for the
     * review's `objectId`, or for the treatment a card's scenario names, read
     * the converter's fresh uuid: an object that was never stored. It showed
     * first as a JPEG portrait whose second sweep said `unchanged` and named
     * the wrong id; a CHARX with expressions had done the same since P7.10.
     */
    actor.id = withMedia.id;
    return outcome;
  }

  async #write(
    actor: Actor,
    notes: ImportNote[],
    pixels: Uint8Array | null,
    media?: BlobStore,
  ): Promise<string> {
    return this.store(actor, ACTOR_SCHEMA, notes, pixels, media);
  }

  /**
   * Writes one converted object, through the re-import rule
   * ([P4 §1.3](../../../../docs/design/workplan/16-p4-implementation.md)).
   *
   * **Every object goes through here**, which is the point: a rule applied at
   * some call sites is a rule that doubles the library at the others. Before
   * this, the sweep wrote through `create()` alone, so a second run over the
   * same directory either collided on the global id check or quietly produced a
   * second copy of everything.
   */
  async store(
    object: { id: string; name: string; provenance: Provenance },
    schemaId: PortableSchemaId,
    notes: ImportNote[],
    pixels: Uint8Array | null = null,
    /** Media that arrived beside the card — [P7.10]. Keyed by `EmbeddedMedia.ref`. */
    media?: BlobStore,
    /**
     * ***Identified by its own id***, for an object this project wrote
     * (2026-09-27): `#native`'s, whether it came from a backup or was
     * downloaded and uploaded again. Its id is the better answer than a
     * filename, which is `identifyNative`'s whole argument.
     */
    native = this.#request.fromHandle !== undefined,
  ): Promise<'created' | 'unchanged' | 'replaced' | 'kept-both' | 'skipped' | 'failed'> {
    const { library, handle } = this.#request;
    /**
     * ***Which identity rule applies is a property of the source.***
     * `identify` keys on `Provenance.originalFilename` *"because foreign files
     * have no id we could key on"*; a backup's contents are our own objects and
     * do have one, so keying on a filename there would be throwing away the
     * better answer and keeping the workaround — and would double a library
     * whose slugs happen to differ. [P12.8].
     */
    const identity = native
      ? await identifyNative(library, handle, schemaId, object)
      : await identify(library, handle, schemaId, object);

    if (identity.kind === 'unchanged') {
      notes.push({
        key: 'import.object.unchanged',
        params: { object: object.name },
        level: 'info',
      });
      return 'unchanged';
    }

    if (identity.kind === 'changed') {
      switch (this.#request.onConflict ?? 'replace') {
        case 'skip':
          notes.push({
            key: 'import.object.differsAndKept',
            params: { object: object.name },
            level: 'warn',
          });
          return 'skipped';
        case 'keep-both':
          // A fresh id and a slug the write path suffixes for us, both named.
          object.id = uuidv7();
          notes.push({
            key: 'import.object.keptBoth',
            params: { object: object.name },
            level: 'warn',
          });
          break;
        case 'replace': {
          try {
            await update(
              library,
              handle,
              identity.id,
              object,
              identity.contentHash,
              {
                // **The `{ kind: 'import' }` attribution's first writer**, three
                // phases after the type declared it with "no writers until their
                // phases". History snapshots the replaced state, so the person's
                // own edits survive as a version rather than being destroyed.
                source: { kind: 'import', from: object.provenance.originalFilename ?? '' },
                reason: 'Replaced by a re-import',
              },
              undefined,
              schemaId === ACTOR_SCHEMA ? blobsOf(pixels, media) : undefined,
            );
            notes.push({
              key: 'import.object.replaced',
              params: { object: object.name },
              level: 'info',
            });
            return 'replaced';
          } catch (error) {
            notes.push({
              key: 'import.file.notStored',
              params: {
                object: object.name,
                reason: error instanceof Error ? error.name : 'unknown',
              },
              level: 'warn',
            });
            return 'failed';
          }
        }
      }
    }

    try {
      await create(
        library,
        handle,
        object,
        undefined,
        pixels === null
          ? undefined
          : { cardPixels: pixels, ...(media === undefined ? {} : { media }) },
      );
      return identity.kind === 'changed' ? 'kept-both' : 'created';
    } catch (error) {
      notes.push({
        key: 'import.file.notStored',
        params: { object: object.name, reason: error instanceof Error ? error.name : 'unknown' },
        level: 'warn',
      });
      return 'failed';
    }
  }

  /**
   * ***A persona's own columns, as a card*** (2026-09-27). The row carries its
   * name, description and personality as a card does, plus an appearance and
   * a backstory a card has no field for; those join the description, each its
   * own paragraph, so everything the persona says still reaches its slot.
   */
  async #marinaraPersona(candidate: ImportCandidate): Promise<ImportItemReport> {
    const row = candidate.payload;
    if (typeof row !== 'object' || row === null || Array.isArray(row)) {
      return this.#card(candidate);
    }
    const field = (key: string): string => {
      const value = (row as Record<string, unknown>)[key];
      return typeof value === 'string' ? value.trim() : '';
    };
    // A card-shaped payload (an older export, or a hand-made file) goes as it is.
    if ('data' in row || 'spec' in row) return this.#card(candidate);
    return this.#card({
      ...candidate,
      payload: {
        name: field('name'),
        description: [field('description'), field('appearance'), field('backstory')]
          .filter((part) => part.length > 0)
          .join('\n\n'),
        personality: field('personality'),
      },
    });
  }

  async #marinaraLorebook(candidate: ImportCandidate): Promise<ImportItemReport> {
    const payload = candidate.payload as {
      book: unknown;
      entries: unknown[];
      folders: unknown[];
      actorIds: string[];
    };
    const converted = convertMarinaraLorebook(payload.book, payload.entries, payload.folders);
    if (!converted.ok) return refusedItem(candidate, converted.refusal);

    const { lorebook, notes } = converted.value;
    // Links resolve or dangle like any other reference ([00 §3.3]); the ids are
    // Marinara's and ours are minted fresh, so these are expected to dangle
    // until §1.3's identity work gives them somewhere to point.
    if (payload.actorIds.length > 0) {
      notes.push({
        key: 'import.lore.characterLinksDangle',
        params: { count: payload.actorIds.length },
        level: 'info',
      });
    }

    stampImported(lorebook, candidate.source);
    const outcome = await this.store(lorebook, LOREBOOK_SCHEMA, notes);
    return {
      source: candidate.source,
      disposition: Writer.dispositionOf(outcome),
      objectId: lorebook.id,
      notes,
    };
  }

  async #marinaraPreset(candidate: ImportCandidate): Promise<ImportItemReport> {
    const payload = candidate.payload as {
      preset: unknown;
      sections: unknown[];
      choiceBlocks: unknown[];
      groups?: unknown[];
    };
    const converted = convertMarinaraPreset(
      payload.preset,
      payload.sections,
      payload.choiceBlocks,
      payload.groups ?? [],
    );
    if (!converted.ok) return refusedItem(candidate, converted.refusal);

    const { preset, notes } = converted.value;
    stampImported(preset, candidate.source);
    const outcome = await this.store(preset, PRESET_SCHEMA, notes);
    return {
      source: candidate.source,
      disposition: Writer.dispositionOf(outcome),
      objectId: preset.id,
      notes,
    };
  }

  async #lorebook(candidate: ImportCandidate): Promise<ImportItemReport> {
    const converted = convertLorebook(candidate.payload, nameOf(candidate.source));
    if (!converted.ok) return refusedItem(candidate, converted.refusal);

    const { lorebook, notes } = converted.value;
    stampImported(lorebook, candidate.source);
    const outcome = await this.store(lorebook, LOREBOOK_SCHEMA, notes);
    return {
      source: candidate.source,
      disposition: Writer.dispositionOf(outcome),
      objectId: lorebook.id,
      notes,
    };
  }

  /**
   * **One file, up to four objects, and the order is the whole of the method.**
   *
   * The cast has to be stored *before* the treatment, because `identify()`
   * re-points a re-imported object to the id it already had here — so an actor's
   * id is not settled until it has been through `store()`, and a cast built from
   * the pre-store ids would point at objects that do not exist on the second
   * import. `#card` and `flushTreatments` take the same order for the same
   * reason; this one just has both halves in one method, because a scenario
   * names its own cast and a card's loose `scenario` string does not.
   */
  async #aventurasScenario(candidate: ImportCandidate): Promise<ImportItemReport> {
    const converted = convertScenario(
      candidate.payload,
      nameOf(candidate.source),
      this.#request.destination,
    );
    if (!converted.ok) return refusedItem(candidate, converted.refusal);
    return this.#storeScenario(candidate, converted.value, null);
  }

  /**
   * ***A `scenario_vault` row*** — [P13.5](../../../../docs/design/workplan/30-p13-aventuras-import.md).
   *
   * The file's converter, told the link is this Writer's to resolve — so it
   * does not say *missing* about a book stored three rows ago — and named from
   * the row's own name, or a constant, never the source's stem, which for a
   * row is a uuid. Then the link, then the file's own storing, cast first.
   */
  async #aventurasVaultScenario(candidate: ImportCandidate): Promise<ImportItemReport> {
    const converted = convertScenario(
      candidate.payload,
      UNTITLED_SCENARIO,
      this.#request.destination,
      { resolvesLinks: true },
    );
    if (!converted.ok) return refusedItem(candidate, converted.refusal);
    const lore = this.#linkedLorebook(candidate.payload, converted.value.notes);
    return this.#storeScenario(candidate, converted.value, lore);
  }

  /**
   * The storing half of both: the cast, then the treatment that bills it.
   *
   * `lore` is the vault book a row's link resolved to, or `null` — always
   * `null` for a file, which cannot resolve one. **Unused under the `lorebook`
   * destination**, where the scenario is itself a book and a book has no field
   * to link another from; the row's `metadata` still carries the Aventuras id
   * verbatim, as it would from a file.
   */
  async #storeScenario(
    candidate: ImportCandidate,
    converted: ConvertedScenario,
    lore: Ref | null,
  ): Promise<ImportItemReport> {
    const { treatment, lorebook, cast, notes } = converted;

    if (lorebook !== null) {
      stampImported(lorebook, candidate.source);
      const outcome = await this.store(lorebook, LOREBOOK_SCHEMA, notes);
      return {
        source: candidate.source,
        disposition: Writer.dispositionOf(outcome),
        objectId: lorebook.id,
        notes,
      };
    }
    if (treatment === null) return refusedItem(candidate, 'wrong-shape');

    const alsoProduced: string[] = [];
    const seen = new Map<string, number>();
    let repeated = 0;
    for (const member of cast) {
      /**
       * **Each actor's identity is the scenario file plus their name.**
       *
       * They have no file of their own — they were rows inside one — so
       * `originalFilename` has to be something re-import will produce again from
       * the same bytes. `flushTreatments` solves the same problem for a
       * synthesised treatment by stamping the scenario text; this is the
       * `#character_book` suffix from `#card`, which is the closer precedent
       * because the object really did travel inside the file.
       */
      /**
       * ***A repeated name gets a key of its own*** —
       * [P13 §0.5](../../../../docs/design/workplan/30-p13-aventuras-import.md).
       * Keyed on the name alone, the second of two npcs named alike `identify`d
       * as the first and replaced it, and the cast named one actor twice. The
       * first keeps the key it always had, so an existing import re-imports
       * `unchanged`; a repeat takes `#npc-repeat:`, a key space no name can
       * reach — `distinctIds`' reasoning, for a provenance key.
       */
      const occurrence = (seen.get(member.actor.name) ?? 0) + 1;
      seen.set(member.actor.name, occurrence);
      if (occurrence > 1) repeated += 1;
      stampImported(
        member.actor,
        occurrence === 1
          ? `${candidate.source}#npc:${member.actor.name}`
          : `${candidate.source}#npc-repeat:${String(occurrence)}:${member.actor.name}`,
      );
      const outcome = await this.store(member.actor, ACTOR_SCHEMA, notes);
      if (outcome !== 'failed') alsoProduced.push(member.actor.id);
    }

    if (repeated > 0) {
      notes.push({
        key: 'import.aventuras.repeatedNpcNames',
        params: { count: repeated },
        level: 'warn',
      });
    }

    treatment.cast = cast
      .filter((member) => alsoProduced.includes(member.actor.id))
      .map((member) => ({
        ref: { id: member.actor.id, name: member.actor.name },
        // `npc` and not required, on `flushTreatments`' reasoning: the file said
        // these people are in this scenario and nothing more, and billing one a
        // persona option would be inventing intent the source did not express.
        billing: 'npc' as const,
        note: member.note,
      }));

    /**
     * ***The linked book is where this treatment's world lives*** — [§1.7] —
     * and it is linked, never required. `required` makes a consumer warn loudly
     * when the book cannot be found, which is a claim that the scenario is
     * *missing its world* without it; Aventuras made this book from a card's
     * embedded `character_book`, and said nothing about how much the scenario
     * leans on it. `flushTreatments` declines to invent the same intent for a
     * card's scenario, for the same reason.
     */
    if (lore !== null) treatment.lore = [{ ref: lore, required: false }];

    stampImported(treatment, candidate.source);
    const outcome = await this.store(treatment, TREATMENT_SCHEMA, notes);
    return {
      source: candidate.source,
      disposition: Writer.dispositionOf(outcome),
      objectId: treatment.id,
      ...(alsoProduced.length === 0 ? {} : { alsoProduced }),
      notes,
    };
  }

  async #aventurasCharacter(candidate: ImportCandidate): Promise<ImportItemReport> {
    const converted = convertCharacter(candidate.payload, nameOf(candidate.source));
    if (!converted.ok) return refusedItem(candidate, converted.refusal);
    return this.#storeAventurasCharacter(candidate, converted.value.actor, converted.value.notes);
  }

  /**
   * ***A `character_vault` row*** — P13.3's, with P13.5's link: a row's
   * `linkedLorebookId` becomes the actor's `lore` (§1.7), a list of plain
   * `Ref`s, since an actor's lore link has no strength to set.
   */
  async #aventurasVaultCharacter(candidate: ImportCandidate): Promise<ImportItemReport> {
    const converted = convertCharacter(candidate.payload, nameOf(candidate.source));
    if (!converted.ok) return refusedItem(candidate, converted.refusal);

    const { actor, notes } = converted.value;
    const lore = this.#linkedLorebook(candidate.payload, notes);
    if (lore !== null) actor.lore = [lore];
    return this.#storeAventurasCharacter(candidate, actor, notes);
  }

  async #storeAventurasCharacter(
    candidate: ImportCandidate,
    actor: Actor,
    notes: ImportNote[],
  ): Promise<ImportItemReport> {
    stampImported(actor, candidate.source);
    // Through `#createActor` rather than `store` directly, so a vault character
    // gets the same portrait handling a card does. A vault *file* carries none;
    // a `character_vault` row carries its decoded portrait inline (P13.3), and
    // this is the path that turned out to need it — a PNG becomes the card, a
    // JPEG or WebP its source, and anything else a note.
    const outcome = await this.#createActor(candidate, actor, notes);
    if (outcome === 'failed') {
      return { source: candidate.source, disposition: 'unrecognised', notes };
    }
    return {
      source: candidate.source,
      disposition: Writer.dispositionOf(outcome),
      objectId: actor.id,
      notes,
    };
  }

  async #aventurasLorebook(candidate: ImportCandidate): Promise<ImportItemReport> {
    return this.#storeAventurasLorebook(
      candidate,
      convertAventurasLorebook(candidate.payload, nameOf(candidate.source)),
    );
  }

  /**
   * ***A `lorebook_vault` row*** — [P13.4](../../../../docs/design/workplan/30-p13-aventuras-import.md).
   * Converted from the row's own name rather than the source's stem, which for
   * a row is a uuid: the name is what the book is called and what its entry
   * ids are derived from (`vault-lorebook.ts`).
   */
  async #aventurasVaultLorebook(candidate: ImportCandidate): Promise<ImportItemReport> {
    const rowId = isRecord(candidate.payload) ? candidate.payload['id'] : undefined;
    return this.#storeAventurasLorebook(
      candidate,
      convertVaultLorebook(candidate.payload),
      typeof rowId === 'string' ? rowId : undefined,
    );
  }

  /**
   * `rowId` is a vault book's own Aventuras id, for {@link Writer.#vaultLorebooks}:
   * given, the book is remembered under it once `store()` has settled which
   * book here it is. A file has none, and is remembered by nothing.
   */
  async #storeAventurasLorebook(
    candidate: ImportCandidate,
    converted: ParseOutcome<ConvertedAventurasLorebook>,
    rowId?: string,
  ): Promise<ImportItemReport> {
    if (!converted.ok) return refusedItem(candidate, converted.refusal);

    const { lorebook, notes } = converted.value;
    stampImported(lorebook, candidate.source);
    const outcome = await this.store(lorebook, LOREBOOK_SCHEMA, notes);
    if (rowId !== undefined && outcome !== 'failed') {
      this.#vaultLorebooks.set(rowId, { id: lorebook.id, name: lorebook.name });
    }
    return {
      source: candidate.source,
      disposition: Writer.dispositionOf(outcome),
      objectId: lorebook.id,
      notes,
    };
  }

  /**
   * ***A row's `linkedLorebookId`, as a link to a book here*** — or `null`
   * for a row that links to none, or to one that is not to be had —
   * [P13 §1.7](../../../../docs/design/workplan/30-p13-aventuras-import.md).
   *
   * Asked in two places, in order:
   *
   * 1. **The books this sweep settled** ({@link Writer.#vaultLorebooks}) —
   *    every row of `lorebook_vault` the database holds and this build could
   *    read, since they were all emitted first.
   * 2. **The book an earlier sweep made of that row**, found by its identity
   *    (§1.5). This is the case P13.4's refusal makes: a book whose `entries`
   *    have gone bad since is refused and not written, *so that the good copy
   *    here is left as it was* — and a link to it that then resolved to
   *    nothing would, under the default `replace`, unlink every character
   *    and scenario from that same good copy, which is the loss the refusal
   *    was there to prevent, one object over. The same step finds a book
   *    whose row has since been deleted from Aventuras while the book stays
   *    here; import never deletes, and a link to the book this library holds
   *    for that row is still the link the row made.
   *
   * ***`import.aventuras.linkedLorebookMissing` only when both come back
   * empty***: the link names a row that is not in this database, or one that
   * was refused, and no earlier import of it is here. A link that resolved
   * says nothing — it is not news that a link works. The note is the file
   * path's, and says the same thing: the book the link means did not come.
   */
  #linkedLorebook(payload: unknown, notes: ImportNote[]): Ref | null {
    const linked = linkedLorebookId(isRecord(payload) ? payload['metadata'] : undefined);
    if (linked === null) return null;

    const settled = this.#vaultLorebooks.get(linked);
    if (settled !== undefined) return { ...settled };

    const { library, handle } = this.#request;
    const earlier = priorImportRef(
      library,
      handle,
      LOREBOOK_SCHEMA,
      `${AVENTURAS_DATABASE}/${LOREBOOK_TABLE}/${linked}`,
    );
    if (earlier !== null) return earlier;

    notes.push({ key: 'import.aventuras.linkedLorebookMissing', params: {}, level: 'warn' });
    return null;
  }

  async #preset(candidate: ImportCandidate, convert: PresetConverter): Promise<ImportItemReport> {
    const converted = convert(candidate.payload, nameOf(candidate.source));
    if (!converted.ok) return refusedItem(candidate, converted.refusal);

    const preset = stampImported(converted.value.preset, candidate.source);
    const outcome = await this.store(preset, PRESET_SCHEMA, converted.value.notes);
    return {
      source: candidate.source,
      disposition: Writer.dispositionOf(outcome),
      objectId: preset.id,
      notes: converted.value.notes,
    };
  }

  /**
   * **A Treatment per distinct scenario text, created eagerly** ([P4 §1.10]).
   *
   * *"Offered as a new Treatment draft"* ([03 §2.7]) becomes *created and
   * reported* under §1.4's post-hoc posture: there is no staging area to offer
   * anything into, and a three-hundred-card sweep gated per-card on a human is
   * not a review, it is a chore.
   *
   * Identical text dedupes, which is the only thing that makes this bearable —
   * a pack of twelve cards sharing one premise produces one treatment with
   * twelve actors in its cast, not twelve treatments saying the same thing.
   */
  #rememberScenario(scenario: string, actorId: string, loreId: string | undefined): void {
    const held = this.#scenarios.get(scenario);
    if (held !== undefined) {
      held.actorIds.push(actorId);
      if (loreId !== undefined) held.lore.push(loreId);
      return;
    }

    const treatment = newTreatment(`Scenario: ${scenario.slice(0, 60)}`);
    treatment.framing = scenario;
    this.#scenarios.set(scenario, {
      treatment,
      actorIds: [actorId],
      lore: loreId === undefined ? [] : [loreId],
    });
  }

  async flushTreatments(): Promise<ImportItemReport[]> {
    const reports: ImportItemReport[] = [];
    for (const [, held] of this.#scenarios) {
      const { treatment, actorIds, lore } = held;
      // `npc` and not required: the card said this character appears in this
      // scenario, and nothing more. Billing them as a persona option or making
      // the lore required would be inventing intent the source did not express.
      treatment.cast = actorIds.map((id) => ({
        ref: { id, name: '' },
        billing: 'npc' as const,
        note: '',
      }));
      treatment.lore = lore.map((id) => ({ ref: { id, name: '' }, required: false }));

      const notes: ImportNote[] = [
        {
          key: 'import.card.treatmentCreated',
          params: { treatment: treatment.name, actors: actorIds.length },
          level: 'info',
        },
      ];

      // A treatment has no source file of its own — it is synthesised from the
      // scenario text several cards shared — so its `originalFilename` is that
      // text's identity rather than a path. Which makes re-import work for it
      // too: the same scenario on a second sweep finds the treatment it made.
      // ~~The first 120 characters~~ — the whole text, as a digest
      // (2026-09-27; see `scenarioStamp`).
      const { library, handle } = this.#request;
      stampImported(treatment, scenarioStamp(library, handle, TREATMENT_SCHEMA, treatment.framing));
      const outcome = await this.store(treatment, TREATMENT_SCHEMA, notes);
      reports.push({
        source: treatment.name,
        disposition: Writer.dispositionOf(outcome),
        objectId: treatment.id,
        notes,
      });
    }
    return reports;
  }

  async #store(lorebook: Lorebook, notes: ImportNote[]): Promise<boolean> {
    return (await this.store(lorebook, LOREBOOK_SCHEMA, notes)) !== 'failed';
  }

  /** `created` and `unchanged` are different rows in the review, so map them. */
  static dispositionOf(outcome: string): ImportItemReport['disposition'] {
    if (outcome === 'unchanged' || outcome === 'skipped') return 'unchanged';
    return outcome === 'failed' ? 'unrecognised' : 'converted';
  }
}

/**
 * ***What a story's session links to, once its world is written*** — the
 * ids `store()` settled, which are the ones the library holds (a re-import's
 * are the earlier import's, `keep-both`'s a fresh copy's).
 */
interface StoryLinks {
  /** The protagonist's actor: the session's persona. */
  persona: string | null;
  /** Everyone else in the cast. */
  actors: string[];
  /** The story's own lorebook. */
  lore: string | null;
  /** Every object written or settled, for the row's `alsoProduced`. */
  written: string[];
}

/**
 * ***What a session here already links to*** — its persona, its cast and its
 * lore — for the row of a story found already here, which names the objects
 * an earlier sweep made for it rather than making them again.
 */
function linksOf(session: SessionFile): string[] {
  const ids = [
    session.cast?.persona ?? null,
    ...(session.cast?.actors ?? []),
    ...(session.lore ?? []),
  ];
  return ids.filter((id): id is string => typeof id === 'string' && id !== '');
}

/**
 * ***The pictures that came with a story, said on its row*** — [P13.13].
 * How many of each purpose, and — rarely — how many lost their pixels between
 * the two reads (`aventuras/pictures.ts`), which arrive as their recipes.
 */
function picturesSaid(story: string, pictures: CarriedPictures): ImportNote[] {
  const notes: ImportNote[] = [];
  const { illustrations, backgrounds } = pictures;
  if (illustrations + backgrounds > 0) {
    notes.push({
      key: 'import.aventuras.storyPictures',
      params: { story, illustrations, backgrounds },
      level: 'info',
    });
  }
  const lost = pictures.lost();
  if (lost > 0) {
    notes.push({
      key: 'import.aventuras.picturesWithoutPixels',
      params: { story, count: lost },
      level: 'warn',
    });
  }
  return notes;
}

/**
 * ***What came with the story, said once on its row*** — how many of the
 * cast and of each kind of entry were linked, which is what the session has
 * and not what Aventuras held (a character the library refused is not
 * counted, and is named by `store()`'s own note). The persona gets a sentence
 * of its own, because it is the one character a person plays rather than
 * meets, and the one a person will look for.
 */
function worldSaid(story: string, world: WorldProduction, links: StoryLinks): ImportNote[] {
  const notes: ImportNote[] = [];
  const characters = (links.persona === null ? 0 : 1) + links.actors.length;
  const { lore, locations, items, beats } =
    links.lore === null ? { lore: 0, locations: 0, items: 0, beats: 0 } : world.counts;
  if (characters + lore + locations + items + beats > 0) {
    notes.push({
      key: 'import.aventuras.storyWorld',
      params: { story, characters, lore, locations, items, beats },
      level: 'info',
    });
  }
  const protagonist = world.cast.find((member) => member.protagonist);
  if (links.persona !== null && protagonist !== undefined) {
    notes.push({
      key: 'import.aventuras.storyPersona',
      params: { story, actor: protagonist.actor.name },
      level: 'info',
    });
  }
  return notes;
}

/**
 * Every picture an incoming card brings: the ones inside it, then the ones
 * that arrived beside it over them, the order `encodeObject` merges in.
 *
 * A card this build cannot read contributes nothing rather than failing the
 * write. It is the portrait the replace keeps from disk anyway, and the rows
 * that named its blobs are the only loss, which is the loss there was before.
 */
function blobsOf(pixels: Uint8Array | null, media: BlobStore | undefined): BlobStore | undefined {
  let inside: BlobStore | undefined;
  if (pixels !== null) {
    try {
      inside = codecFor(pixels)?.read(pixels).blobs;
    } catch {
      inside = undefined;
    }
  }
  if (inside === undefined) return media;
  if (media === undefined) return inside;
  return new Map([...inside, ...media]);
}

/**
 * ***Whether these bytes will survive being a card*** — the question
 * `create()` asks, asked first (P13.3).
 *
 * `codecFor` sniffs eight bytes, and `encodeObject` then reads the whole file
 * through the codec: so a PNG signature over a body that does not parse
 * passed the one and threw out of the other, and the actor was lost with it.
 * Asking the codec to read it here is what makes *a portrait that will not
 * read costs the portrait* true of a truncated portrait as well as a JPEG.
 */
function readsAsCard(bytes: Uint8Array): boolean {
  const codec = codecFor(bytes);
  if (codec === null) return false;
  try {
    codec.read(bytes);
    return true;
  } catch {
    return false;
  }
}

/** What a person calls each picture `sniff` knows that a card cannot be, for the review. */
const IMAGE_FORMAT_NAMES: Readonly<Record<string, string>> = {
  'image/jpeg': 'JPEG',
  'image/webp': 'WebP',
};

function refusedItem(candidate: ImportCandidate, refusal: string): ImportItemReport {
  return {
    source: candidate.source,
    disposition: 'unrecognised',
    notes: [
      {
        key: 'import.file.refused',
        params: { file: candidate.source, refusal },
        level: 'warn',
      },
    ],
  };
}

export function countBy(items: readonly ImportItemReport[]): Record<ImportDisposition, number> {
  const counts: Record<ImportDisposition, number> = {
    converted: 0,
    credential: 0,
    recorded: 0,
    'by-position': 0,
    skipped: 0,
    unchanged: 0,
    unrecognised: 0,
  };
  for (const item of items) counts[item.disposition] += 1;
  return counts;
}

/**
 * An image's media type from its extension — [P7.10].
 *
 * **Extension and not magic**, which is the opposite of `codecFor` above it and
 * is right for this: the portrait has to be a *card*, so what it really is
 * decides; an expression is just a picture the browser will render, and what it
 * is called is what the `content-type` header has to say. **A file this list
 * does not know is skipped** rather than guessed at — an unnamed type in a
 * `content-type` is a download prompt where a face should be.
 */
function mimeOf(path: string): string | null {
  const dot = path.lastIndexOf('.');
  const extension = dot === -1 ? '' : path.slice(dot + 1).toLowerCase();
  switch (extension) {
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'webp':
      return 'image/webp';
    case 'gif':
      return 'image/gif';
    default:
      return null;
  }
}

/**
 * The filename without its directory or extension — `sprites/neutral.png` reads
 * as `neutral`.
 *
 * *This is the expression's name*, and it comes from the filename because that
 * is where both source programs put it: [03 §5.2]'s own layout sketch is
 * `sprites/{neutral,angry,…}.png`. A person who wants a different word renames
 * the file, which is the affordance the format already has.
 */
function stemOf(path: string): string {
  const name = path.split('/').at(-1) ?? path;
  const dot = name.lastIndexOf('.');
  return dot === -1 ? name : name.slice(0, dot);
}
