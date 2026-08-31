// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { NearMiss, NearMissSituation } from '@storyengine/shared';

import { probeMarks } from './detect.js';
import type { FileSource, ImportSourceKind } from './source.js';

/**
 * What the folder somebody picked is, when it is not the folder the importer
 * wants ([P4 §7.11](../../../../docs/design/workplan/06-p4-implementation.md)).
 *
 * **`classifyRoot` never fails on a folder that is merely wrong.** Every
 * directory matching no probe — including an empty one — comes back
 * `loose-files`, the sweep succeeds, and the person gets a report with nothing
 * anywhere saying *you meant the folder one level down*. Since the loose walker
 * learned to ask every file what it is, pointing at a SillyTavern install root
 * is no longer a quiet nothing: it walks the whole checkout, converts whatever
 * self-identifies — the shipped sample content in `default/content/` included —
 * and still misses the personas, because those are a join between
 * `settings.json` and `User Avatars/` that only the positional reader knows how
 * to make. A successful-looking import of the wrong things is worse than an
 * empty one, and it is exactly the indistinguishability `detect.ts`'s own header
 * says the verdict exists to expose.
 *
 * **The invariant, which is what makes the false-positive question answerable:**
 * a finding marked `verified` names a folder at which *the same marks
 * `classifyRoot` uses* were all found. Following it therefore produces a root
 * the classifier calls that kind, not `loose-files`. Two things follow, and both
 * are load-bearing:
 *
 * 1. **The marks are never re-declared here.** `detect.ts` owns them and this
 *    module asks it to evaluate them under a prefix ({@link probeMarks}). Two
 *    copies of a probe table is one copy that eventually stops matching.
 * 2. **A suggestion is advice, not a gate.** Acting on one sends a fresh
 *    absolute path back through `openLocalSource` then `classifyRoot` then
 *    `survey()`, which are the real gates and are untouched. So the bar for
 *    speaking is *would not embarrass us*, not *safe to import* — which is why
 *    an inferred `../..` is acceptable and a guessed `characters/` is not. The
 *    first costs a wrong hint; the second tells somebody a lie about their own
 *    machine.
 *
 * **No `list()`, no `read()`, and no filesystem at all.** Only `exists()`, over
 * paths that are literals in the table below. `node:fs` is confined to
 * `server/src/storage` by lint, and this module does not reach for `node:path`
 * either — which *is* legal, and would still be wrong, because a `FileSource`
 * path is `/`-separated on every platform and `node:path` on Windows would put a
 * backslash in one. Absolute paths are the edge's business.
 */

/**
 * `exists()` asked at most once per path.
 *
 * The promise is cached rather than its result, so two rules racing on the same
 * path coalesce into one `stat` instead of two. It also makes the work bound a
 * fact a test can assert with a counting double rather than a claim in a
 * comment.
 */
class Probes {
  readonly #source: Pick<FileSource, 'exists'>;
  readonly #asked = new Map<string, Promise<boolean>>();

  constructor(source: Pick<FileSource, 'exists'>) {
    this.#source = source;
  }

  exists(path: string): Promise<boolean> {
    const held = this.#asked.get(path);
    if (held !== undefined) return held;
    const asking = this.#source.exists(path);
    this.#asked.set(path, asking);
    return asking;
  }
}

/** Nothing at all, for a request that supplied no parent. */
const NO_PARENT: Pick<FileSource, 'exists'> = { exists: () => Promise.resolve(false) };

/**
 * What a rule may ask. Deliberately four questions rather than a `FileSource`:
 * a rule that could `list()` would grow to, and the bound is the feature.
 */
interface Ground {
  /** Does this relative path exist in the folder the person picked? */
  at(path: string): Promise<boolean>;
  /** Are all of this kind's marks present under this prefix of the picked folder? */
  marks(kind: ImportSourceKind, prefix: string): Promise<boolean>;
  /** Does this relative path exist in the folder above? `false` without one. */
  above(path: string): Promise<boolean>;
  /** Are all of this kind's marks present at the folder above? `false` without one. */
  aboveMarks(kind: ImportSourceKind): Promise<boolean>;
}

interface Rule extends NearMiss {
  /** Skipped when any of these already fired — a stronger answer is already out. */
  after?: readonly NearMissSituation[];
  /** Skipped unless all of these fired — this rule is a statement about them. */
  needs?: readonly NearMissSituation[];
  holds(ground: Ground): Promise<boolean>;
}

/**
 * The table, in the order it fires and in the order the findings come back.
 *
 * Every row is evidenced against the two applications' own source, and the
 * evidence is worth keeping beside the row because none of it is guessable:
 * these are other people's layouts and they change without telling us.
 */
const RULES: readonly Rule[] = [
  /**
   * The install root, post-1.12. `DATA_ROOT` defaults to `<install>/data`
   * (`default/config.yaml:3`, `src/command-line.js:56`) and `default-user` is
   * the seeded handle that cannot be deleted (`src/constants.js:55`,
   * `src/users.js:565-569`), so on any current install this has something to
   * find.
   *
   * **Deliberately not gated on install markers.** A Docker host directory has
   * `config/`, `data/`, `plugins/`, `extensions/` and no `package.json`, no
   * `server.js`, no `public/` — while `data/default-user` under it is perfectly
   * valid. A rule demanding `server.js` before descending would reject that
   * whole population. The descent justifies itself: the *suggestion* carries the
   * full mark set, so no separate is-this-an-install test is needed.
   */
  {
    situation: 'sillytavern-install-root',
    holds: (ground) => ground.marks('sillytavern', 'data/default-user'),
    suggest: 'data/default-user',
    leadsTo: 'sillytavern',
    confidence: 'verified',
    note: {
      key: 'import.root.sillytavernBelow',
      params: { path: 'data/default-user' },
      level: 'warn',
    },
  },
  /**
   * Before 1.12 the library sat in `public/`. 1.11.8's `src/constants.js` puts
   * `public/characters` and `public/worlds` exactly where the marks look, and
   * the third mark is one file over, at
   * `src/endpoints/settings.js:11`'s `SETTINGS_FILE = './public/settings.json'`
   * — checked after review, which found this comment attributing all three to
   * `constants.js`. SillyTavern's own migration triggers on `public/characters`
   * (`src/users.js:233-238`).
   */
  {
    situation: 'sillytavern-old-layout',
    holds: (ground) => ground.marks('sillytavern', 'public'),
    suggest: 'public',
    leadsTo: 'sillytavern',
    confidence: 'verified',
    note: { key: 'import.root.sillytavernOldLayout', params: { path: 'public' }, level: 'warn' },
  },
  /** The person who read `dataRoot: ./data` and picked `data`. */
  {
    situation: 'sillytavern-data-root',
    holds: (ground) => ground.marks('sillytavern', 'default-user'),
    suggest: 'default-user',
    leadsTo: 'sillytavern',
    confidence: 'verified',
    // A key of its own, and not the install root's. Sharing one made the
    // sentence say *this is the program folder* about a folder that is
    // SillyTavern's data folder — true for the situation above and false here,
    // which is the failure mode a shared class always has when the two things
    // it names are not the same thing.
    note: {
      key: 'import.root.sillytavernDataFolder',
      params: { path: 'default-user' },
      level: 'warn',
    },
  },
  /**
   * The data folder of a multi-user install, or one where `default-user`'s
   * directory was never created. `_storage` is node-persist's directory at
   * `DATA_ROOT` (`src/users.js:559`), `cookie-secret.txt` is written beside it
   * (`:42`, `:574-597`), `_uploads` is `UPLOADS_DIRECTORY`
   * (`src/constants.js:219`).
   *
   * **Safe because a handle can never begin with an underscore**, and the
   * mechanism is worth stating exactly, because the obvious version of it is
   * wrong. `slugify` (`src/endpoints/users-admin.js:33`) does not strip
   * characters outside `[a-z0-9]` — it *replaces* runs of them with a hyphen,
   * which is why `default-user` has one. What guarantees the property is the
   * second replace: `_storage` becomes `-storage` and then loses its leading
   * hyphen to `/^-+|-+$/g`. Delete that second call and every minted handle
   * would begin with a hyphen while this paragraph read unchanged. Slugify is
   * the only path that mints one (`:180` feeding `:205`), the sole other writer
   * being the literal `default-user` seed at `src/users.js:568`.
   *
   * Two of the three marks are required so a stray `_storage` cannot carry the
   * verdict alone.
   *
   * No path, because there is no name to guess: `getAllUserHandles()` reads
   * node-persist keys rather than directories (`src/users.js:672-676`), and
   * finding one would need `list()`.
   */
  {
    situation: 'sillytavern-user-folders',
    after: ['sillytavern-data-root'],
    holds: async (ground) =>
      (await ground.at('_storage')) &&
      ((await ground.at('cookie-secret.txt')) || (await ground.at('_uploads'))),
    suggest: null,
    leadsTo: null,
    confidence: 'inferred',
    note: { key: 'import.root.sillytavernUserFolders', params: {}, level: 'warn' },
  },
  /**
   * The program folder with its library relocated — `--dataRoot`,
   * `SILLYTAVERN_DATAROOT` or `dataRoot:` in `config.yaml`
   * (`src/command-line.js:212-216`, `src/util.js:88-98`). The one SillyTavern
   * case where we know what the folder is and genuinely cannot say where the
   * library went.
   *
   * Three *files*, so both `FileSource` adapters agree exactly on all of them.
   * Any Node project has a `server.js`; the conjunction with a shipped
   * `default/config.yaml` and a served `public/script.js` does not happen by
   * accident. Reading `config.yaml` for its `dataRoot` would answer properly and
   * needs `read()` plus a YAML parser this module has no business owning — the
   * highest-value extension here, and a decision about whether an importer may
   * read a foreign application's configuration.
   */
  {
    situation: 'sillytavern-program-folder',
    after: ['sillytavern-install-root', 'sillytavern-old-layout', 'sillytavern-data-root'],
    holds: async (ground) =>
      (await ground.at('server.js')) &&
      (await ground.at('default/config.yaml')) &&
      (await ground.at('public/script.js')),
    suggest: null,
    leadsTo: null,
    confidence: 'inferred',
    note: { key: 'import.root.sillytavernProgramFolder', params: {}, level: 'warn' },
  },
  /**
   * The person who picked `characters/`, or `worlds/`, or `User Avatars/`.
   * Since the loose walker converts cards found that way this is not a failure —
   * it is the note saying the lorebooks, presets and personas are one level up
   * and did not come. Emitting it even when conversions happened is the point.
   */
  {
    situation: 'sillytavern-above',
    holds: (ground) => ground.aboveMarks('sillytavern'),
    suggest: '..',
    leadsTo: 'sillytavern',
    confidence: 'verified',
    note: { key: 'import.root.sillytavernAbove', params: {}, level: 'warn' },
  },
  /**
   * Marinara's data root is `<install>/packages/server/data`
   * (`runtime-config.ts:10`, `:16`, `:255-258` — a relative `DATA_DIR=./data`
   * resolves against `packages/server`, so the ubiquitous `.env` line still
   * lands there). The mark is `storage/tables`, recreated on every flush
   * (`file-backed-store.ts:2983-2984`), and Marinara's own existence probe at
   * `:1195-1197` is byte-identical to ours.
   *
   * This is the likeliest wrong pick of all, because the installer names the
   * folder `Marinara-Engine` (`win/installer/installer.nsi:22`).
   */
  {
    situation: 'marinara-install-root',
    holds: (ground) => ground.marks('marinara', 'packages/server/data'),
    suggest: 'packages/server/data',
    leadsTo: 'marinara',
    confidence: 'verified',
    note: {
      key: 'import.root.marinaraBelow',
      params: { path: 'packages/server/data' },
      level: 'warn',
    },
  },
  /**
   * One probe, two real situations: `<install>/packages/server` picked directly,
   * and an **older install whose data sits at `<install>/data`**.
   *
   * Marinara itself treats that second folder as live and current. Its installer
   * warns *"back up `packages\server\data`, or the root data folder for older
   * installs"* (`win/installer/installer.nsi:76`) and probes both on every
   * upgrade (`:132`, `:135`); its `.env.example` tells people, in as many words,
   * to check `storage/manifest.json` in **both** `packages/server/data/` and
   * `data/` and not to delete either until recovery is confirmed.
   *
   * *Corrected after review.* This comment used to pin the second case to a
   * "v1.4.6 root-data era" introduced by `a3b6988ea` and reverted "a day later".
   * All three parts were wrong: the earliest tag containing that commit is
   * v1.5.0, the revert landed about six hours later the same day, and the commit
   * actually produced `<install>/packages/data` rather than `<install>/data`.
   * The rule is well founded; the archaeology behind it was not, so it is
   * replaced with the evidence that is still true.
   */
  {
    situation: 'marinara-sibling-data',
    holds: (ground) => ground.marks('marinara', 'data'),
    suggest: 'data',
    leadsTo: 'marinara',
    confidence: 'verified',
    note: { key: 'import.root.marinaraBelow', params: { path: 'data' }, level: 'warn' },
  },
  /** `<install>/packages`, which holds exactly `client/`, `server/` and `shared/`. */
  {
    situation: 'marinara-packages-root',
    holds: (ground) => ground.marks('marinara', 'server/data'),
    suggest: 'server/data',
    leadsTo: 'marinara',
    confidence: 'verified',
    note: { key: 'import.root.marinaraBelow', params: { path: 'server/data' }, level: 'warn' },
  },
  /**
   * Both data folders present, which is the leftover of that version change.
   * **The source does not settle which is live, so neither do we**:
   * `.env.example:35-37` tells users in as many words to check
   * `storage/manifest.json` in both and not to delete either until recovery is
   * confirmed. Both suggestions stand, in declaration order, plus this record
   * explaining why there are two. Deliberately not resolved by reading the
   * manifests' `savedAt` — that needs `read()`, a parse, and trust in a
   * timestamp, and Marinara's own documentation declines to decide.
   */
  {
    situation: 'marinara-two-data-folders',
    needs: ['marinara-install-root', 'marinara-sibling-data'],
    holds: () => Promise.resolve(true),
    suggest: null,
    leadsTo: null,
    confidence: 'inferred',
    note: {
      key: 'import.root.marinaraTwoDataFolders',
      params: { first: 'packages/server/data', second: 'data' },
      level: 'warn',
    },
  },
  /**
   * A launcher update snapshot rather than the live folder. The launcher copies
   * the data directory recursively — `storage/tables/` included — and puts its
   * *own* `manifest.json`, shaped `{createdAt, dataDir}`, at the snapshot root
   * (`scripts/protect-launcher-data.mjs:448-499`, `:485-489`). That is a wholly
   * different file from `storage/manifest.json`, and position is what tells them
   * apart: a data root has nothing at its own top level by that name.
   *
   * The suggestion from the previous rule still stands — importing from a backup
   * is legitimate — but the person is told which one they are looking at.
   */
  {
    situation: 'marinara-update-backup',
    needs: ['marinara-sibling-data'],
    holds: (ground) => ground.at('manifest.json'),
    suggest: null,
    leadsTo: null,
    confidence: 'inferred',
    note: { key: 'import.root.marinaraUpdateBackup', params: {}, level: 'warn' },
  },
  /**
   * The program folder of a Marinara that has never been launched, or whose
   * data directory points elsewhere. `storage-format.json` at the install root
   * is a **build-time source constant**, never storage data — which is a trap
   * until it is a marker. Paired with `pnpm-workspace.yaml` it is unambiguous;
   * `pnpm-workspace.yaml` alone would match this repository.
   */
  {
    situation: 'marinara-program-folder',
    after: ['marinara-install-root', 'marinara-sibling-data', 'marinara-packages-root'],
    holds: async (ground) =>
      (await ground.at('storage-format.json')) && (await ground.at('pnpm-workspace.yaml')),
    suggest: null,
    leadsTo: null,
    confidence: 'inferred',
    note: { key: 'import.root.marinaraProgramFolder', params: {}, level: 'warn' },
  },
  /** An asset folder — `avatars/`, `sprites/` — inside a data root. */
  {
    situation: 'marinara-above',
    holds: (ground) => ground.aboveMarks('marinara'),
    suggest: '..',
    leadsTo: 'marinara',
    confidence: 'verified',
    note: { key: 'import.root.marinaraAbove', params: {}, level: 'warn' },
  },
  /**
   * The person who read that `storage/` holds the work and picked it. Detected
   * without leaving the root: a storage directory holds `tables/`
   * (`file-backed-store.ts:981-983`) and `manifest.json` (`:1033-1035`), and the
   * gate above has already established that `storage/tables` is absent here, so
   * a real data root cannot match.
   *
   * Declared after `marinara-above` on purpose, and suppressed by nothing: both
   * rules offer `..` for a picked `storage/`, so the dedupe at the end keeps the
   * one declared first, which is the one that actually looked. An explicit
   * `after` here would say the same thing twice — and worse, it would hide the
   * dedupe from its own test by making the second rule never fire.
   *
   * The residual risk — a loose folder holding both a `tables/` directory and a
   * `manifest.json` — costs a wrong `..` hint, and following it re-classifies.
   */
  {
    situation: 'marinara-storage-folder',
    holds: async (ground) => (await ground.at('tables')) && (await ground.at('manifest.json')),
    suggest: '..',
    leadsTo: null,
    confidence: 'inferred',
    note: { key: 'import.root.marinaraStorageFolder', params: {}, level: 'warn' },
  },
  /**
   * Inside a storage folder — `tables/` itself, most likely. No basename is
   * needed: if the *parent* is a storage directory then the picked folder is a
   * child of one, and `../..` is right either way. `inferred` because the
   * grandparent was never opened, which is exactly what that field exempts.
   */
  {
    situation: 'marinara-tables-folder',
    after: ['marinara-storage-folder'],
    holds: async (ground) =>
      (await ground.above('tables')) && (await ground.above('manifest.json')),
    suggest: '../..',
    leadsTo: null,
    confidence: 'inferred',
    note: { key: 'import.root.marinaraTablesFolder', params: {}, level: 'warn' },
  },
  /**
   * The right folder and the wrong version: a pre-1.5.7 Marinara kept everything
   * in SQLite at `marinara-engine.db` beside the same asset folders, with no
   * `storage/` at all. The Windows installer still warns about the three files
   * (`win/installer/installer.nsi:194`).
   *
   * **Saying "wrong folder" here would send somebody hunting for a folder that
   * does not exist**, which is why this is a diagnosis with no path rather than
   * a suggestion.
   */
  {
    situation: 'marinara-too-old',
    holds: (ground) => ground.at('marinara-engine.db'),
    suggest: null,
    leadsTo: null,
    confidence: 'inferred',
    note: { key: 'import.root.marinaraTooOld', params: {}, level: 'warn' },
  },
];

/**
 * Every path any rule can probe on the picked folder.
 *
 * Exported so a test can assert the two things a reader cannot see by looking:
 * that no path carries the leading or trailing slash the two adapters disagree
 * about, and that a run never probes outside this set. A list that were only
 * decorative would drift; this one is checked against a counting double.
 */
export const NEAR_MISS_PROBE_PATHS: readonly string[] = [
  'settings.json',
  'characters',
  'worlds',
  'storage/tables',
  'data/default-user/settings.json',
  'data/default-user/characters',
  'data/default-user/worlds',
  'public/settings.json',
  'public/characters',
  'public/worlds',
  'default-user/settings.json',
  'default-user/characters',
  'default-user/worlds',
  '_storage',
  'cookie-secret.txt',
  '_uploads',
  'server.js',
  'default/config.yaml',
  'public/script.js',
  'packages/server/data/storage/tables',
  'data/storage/tables',
  'server/data/storage/tables',
  'manifest.json',
  'storage-format.json',
  'pnpm-workspace.yaml',
  'tables',
  'marinara-engine.db',
];

/** What a near-miss reading needs: the folder picked, and optionally the one above. */
export interface NearMissRequest {
  /** The folder the person picked, already opened. */
  files: Pick<FileSource, 'exists'>;
  /**
   * The folder above it, opened by the caller. **Every ascending rule is silent
   * without it**, because `DirectorySource` refuses to resolve `..` outside its
   * own root and `MemoryFileSource` has no `..` resolution at all — which is the
   * seam's contract working, not a limitation to route around.
   */
  parent?: Pick<FileSource, 'exists'> | undefined;
}

/**
 * What the picked folder is, when it is not the one the importer wants.
 *
 * Empty for a folder that already classifies as a source — there is nothing to
 * say — for a folder with no marks at all, and whenever the evidence runs out.
 * Never throws.
 */
export async function nearMiss(request: NearMissRequest): Promise<readonly NearMiss[]> {
  const picked = new Probes(request.files);
  const above = new Probes(request.parent ?? NO_PARENT);

  // The folder is already right. Checked here rather than left to the caller so
  // the module is correct standing alone: a precondition documented in two
  // places is one that rots in one of them.
  if ((await probeMarks(picked, 'sillytavern')) || (await probeMarks(picked, 'marinara'))) {
    return [];
  }

  const ground: Ground = {
    at: (path) => picked.exists(path),
    marks: (kind, prefix) => probeMarks(picked, kind, prefix),
    above: (path) => (request.parent === undefined ? Promise.resolve(false) : above.exists(path)),
    aboveMarks: (kind) =>
      request.parent === undefined ? Promise.resolve(false) : probeMarks(above, kind),
  };

  const fired = new Set<NearMissSituation>();
  const found: NearMiss[] = [];
  for (const rule of RULES) {
    if (rule.after?.some((situation) => fired.has(situation)) === true) continue;
    if (rule.needs?.every((situation) => fired.has(situation)) === false) continue;
    if (!(await rule.holds(ground))) continue;
    fired.add(rule.situation);
    found.push({
      situation: rule.situation,
      suggest: rule.suggest,
      leadsTo: rule.leadsTo,
      confidence: rule.confidence,
      note: rule.note,
    });
  }

  // One finding per suggestion, first wins. This only bites when a parent probes
  // as both sources at once — `ambiguous-root` territory, and vanishingly rare —
  // and offering the same folder twice would read as a bug either way.
  const offered = new Set<string>();
  return found.filter((miss) => {
    if (miss.suggest === null) return true;
    if (offered.has(miss.suggest)) return false;
    offered.add(miss.suggest);
    return true;
  });
}
