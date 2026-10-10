// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { TSchema } from '@sinclair/typebox';
import { Ajv, type ValidateFunction } from 'ajv';

/**
 * The two Ajv types a caller of the factories below needs to hold one.
 *
 * **Re-exported rather than left to be imported from `ajv` directly**, because
 * this package is the only one that declares Ajv as a dependency and it should
 * stay that way: a consumer that imported `ajv` for a type would acquire a
 * runtime dependency on it to satisfy a compile-time need, and would be free to
 * construct its own instance with its own options — which is precisely the
 * decision `AJV_OPTIONS` exists to make once.
 */
export type { Ajv, ValidateFunction };

import {
  Actor,
  ACTOR_SCHEMA,
  CARD_PROMPT_SECTION_IDS,
  CONVENTIONAL_SECTION_IDS,
  RESERVED_SECTION_PREFIX,
} from './actor.js';
import { Lorebook, LOREBOOK_SCHEMA } from './lorebook.js';
import { Preset, PRESET_SCHEMA } from './preset.js';
import { Treatment, TREATMENT_SCHEMA } from './treatment.js';
import { Setup, SETUP_SCHEMA } from './setup.js';
import { World, WORLD_SCHEMA } from './world.js';

/**
 * The registry — docs/design/04-schemas.md §9.
 *
 * **Every portable object self-describes with a `schema` field, so containers
 * never enumerate kinds** ([work plan §2](../../../../docs/design/workplan/01-work-plan.md)). This maps that
 * string to a validator, which is the whole mechanism: a World walks its
 * contents, asks the registry about each entry's `schema`, validates what it
 * recognises and carries the rest through untouched. (A Package did, until the
 * kind was renamed at [P16.0].)
 *
 * It is also why the library routes at P1.5 are one handler set rather than six.
 */

/**
 * **`removeAdditional` is off, and it is the single most important line here.**
 *
 * [04 §2](../../../../docs/design/04-schemas.md) requires readers to *preserve* unknown
 * fields — the one rule that lets the format evolve without stranding anyone.
 * Ajv's `removeAdditional` does the exact opposite, and it is precisely the sort
 * of option switched on for tidiness by someone who has not read that section.
 * Silently stripping a field written by a newer version is invisible until
 * somebody downgrades, and by then their data is gone.
 *
 * `useDefaults` is off for the same reason: materialising a default is a write
 * the author did not make, and it turns "absent" into "present with a value" —
 * a distinction [04 §2](../../../../docs/design/04-schemas.md) makes deliberate meaning of.
 *
 * `coerceTypes` is off because a string that looks like a number is a bug in the
 * writer, not something to paper over on read.
 */
export const AJV_OPTIONS = {
  removeAdditional: false,
  useDefaults: false,
  coerceTypes: false,
  allErrors: true,
  // TypeBox emits keywords Ajv's strict mode complains about (`examples`
  // alongside `enum`, unevaluated siblings on unions). The schemas are the
  // artefact and are correct JSON Schema; strict mode is a lint pass we do not
  // want failing a load.
  strict: false,
} as const;

/**
 * RFC 3339 date-time, which is the profile of ISO 8601 that
 * [04 §3](../../../../docs/design/04-schemas.md) means by "ISO 8601. Never epoch ms."
 *
 * Written out rather than pulled from `ajv-formats`, because `date-time` is the
 * only format any portable schema uses and this package is supposed to carry as
 * close to no runtime dependencies as the job allows
 * ([20 §10](../../../../docs/design/20-tech-stack.md)). A regex plus a parse is cheaper than
 * a dependency and says exactly what it accepts.
 */
const RFC3339 = /^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:\d{2})$/;

export function isTimestamp(value: string): boolean {
  return RFC3339.test(value) && !Number.isNaN(Date.parse(value));
}

export function createValidator(): Ajv {
  const ajv = new Ajv(AJV_OPTIONS);
  // Without this, Ajv treats an unknown format as unconstrained and would
  // quietly accept "yesterday" in a `createdAt`.
  ajv.addFormat('date-time', { type: 'string', validate: isTimestamp });
  return ajv;
}

/** The six portable kinds, keyed by the string each one carries in `schema`. */
export const PORTABLE_SCHEMAS = {
  [ACTOR_SCHEMA]: Actor,
  [LOREBOOK_SCHEMA]: Lorebook,
  [TREATMENT_SCHEMA]: Treatment,
  [SETUP_SCHEMA]: Setup,
  [PRESET_SCHEMA]: Preset,
  [WORLD_SCHEMA]: World,
} as const satisfies Record<string, TSchema>;

export type PortableSchemaId = keyof typeof PORTABLE_SCHEMAS;

/**
 * The folder each kind lives in, per [03 §5.1](../../../../docs/design/03-data-model.md).
 * Plural, matching the storage layout.
 *
 * World is here too, in `worlds/` — the folder Package had as `packages/`
 * until [P16.0] renamed the kind. It is a set rather than something you play
 * with, but §5.1 gives it a folder in the library like any other kind — a set
 * somebody named is a thing they keep, and the layout treats it as one. The old
 * folder is still read: {@link LEGACY_LIBRARY_DIRECTORIES}.
 */
export const LIBRARY_DIRECTORIES = {
  [ACTOR_SCHEMA]: 'actors',
  [LOREBOOK_SCHEMA]: 'lorebooks',
  [TREATMENT_SCHEMA]: 'treatments',
  [SETUP_SCHEMA]: 'setups',
  [PRESET_SCHEMA]: 'presets',
  [WORLD_SCHEMA]: 'worlds',
} as const;

/**
 * ***Folders a kind used to live in, and is still read from*** — [P16 §1.1].
 *
 * `packages` is the World's folder before the rename, and it is read for as
 * long as anything might hold it, which is indefinitely: installs made before
 * P16.0 have one, and the backups they took carry it. **Nothing writes here**:
 * every write of a World writes `worlds/`, and the first write to an object
 * found in `packages/` moves its folder there (`library.ts`). An object nobody
 * writes stays where it is and is read as a World every time, which is correct
 * rather than a backlog.
 *
 * **A separate table rather than a second entry in `LIBRARY_DIRECTORIES`**,
 * because that one is a bijection everything else relies on — the routes read
 * a folder name as a kind, the registry test holds its keys to
 * `PORTABLE_SCHEMAS`, and a kind with two folders would be a kind with two URLs.
 * Every reader that has to see the old folder — the layout's path parser, the
 * index's rebuild and reconcile, the backup reader, the trash — asks this table
 * by name, so the legacy read is greppable and so is its removal, if one day
 * there is one.
 */
export const LEGACY_LIBRARY_DIRECTORIES: Readonly<Record<string, PortableSchemaId>> = {
  packages: WORLD_SCHEMA,
};

/**
 * The kind a library folder name holds, current or legacy, or null.
 *
 * One function so the two tables are read in one order everywhere: the current
 * name first, and the legacy one only when it is not a current one.
 */
export function kindOfDirectory(directory: string): PortableSchemaId | null {
  for (const [schemaId, current] of Object.entries(LIBRARY_DIRECTORIES)) {
    if (current === directory) return schemaId as PortableSchemaId;
  }
  return Object.hasOwn(LEGACY_LIBRARY_DIRECTORIES, directory)
    ? (LEGACY_LIBRARY_DIRECTORIES[directory] ?? null)
    : null;
}

export interface ValidationIssue {
  path: string;
  message: string;
}

export type ValidationResult = { valid: true } | { valid: false; issues: ValidationIssue[] };

const ajv = createValidator();
const compiled = new Map<string, ValidateFunction>();

function validatorFor(schemaId: string): ValidateFunction | null {
  const cached = compiled.get(schemaId);
  if (cached) return cached;

  /**
   * ***An own key, or no schema*** (2026-09-30). Indexed bare, the table
   * answered for its prototype too: a kind named `constructor`, `toString` or
   * `valueOf` handed Ajv a function, which throws *"schema must be object or
   * boolean"* — so a file naming such a kind threw out of `validate` instead of
   * being an unknown kind, which [04 §2] says is never a failure. The SDK
   * re-exports this, so an extension validating what it was handed met it.
   */
  if (!isKnownSchema(schemaId)) return null;
  const schema = PORTABLE_SCHEMAS[schemaId] as TSchema;

  const validate = ajv.compile(schema);
  compiled.set(schemaId, validate);
  return validate;
}

/** True when this build knows how to validate the given `schema` string. */
export function isKnownSchema(schemaId: string): schemaId is PortableSchemaId {
  return Object.hasOwn(PORTABLE_SCHEMAS, schemaId);
}

/**
 * Reads the `schema` field off a candidate object.
 *
 * Returns null rather than throwing for anything that is not a self-describing
 * object, because that is a normal thing to encounter in a container and not an
 * error the caller should have to catch.
 */
export function schemaIdOf(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return null;
  const schema: unknown = (value as { schema?: unknown }).schema;
  return typeof schema === 'string' ? schema : null;
}

/**
 * Validates a self-describing object against whichever schema it names.
 *
 * **An unknown `schema` string is not a failure.** A package may legitimately
 * contain a kind this build has never heard of, and rejecting it is the
 * stranding [04 §2](../../../../docs/design/04-schemas.md) forbids. Callers that need to
 * distinguish "valid" from "not checked" ask `isKnownSchema` first.
 */
export function validate(value: unknown): ValidationResult {
  const schemaId = schemaIdOf(value);
  if (schemaId === null) {
    return {
      valid: false,
      issues: [{ path: '', message: 'Not a self-describing object: no `schema` string.' }],
    };
  }

  const validator = validatorFor(schemaId);
  if (!validator) {
    // Unrecognised kind. Nothing to check it against, and nothing wrong with it.
    return { valid: true };
  }

  if (validator(value)) {
    const reserved = reservedNamespaceIssues(value);
    return reserved.length === 0 ? { valid: true } : { valid: false, issues: reserved };
  }

  return {
    valid: false,
    issues: (validator.errors ?? []).map((error) => ({
      path: error.instancePath,
      message: error.message ?? 'invalid',
    })),
  };
}

/**
 * The `se.` namespace is the engine's — [work plan §2](../../../../docs/design/workplan/01-work-plan.md).
 *
 * Reserved since P1.0 and enforced nowhere until now (F18), which is the state
 * a reservation cannot stay in for long: the four conventional sections are
 * `se.*`, P2 adds `se.clock`, and every phase after this one adds more. An
 * author who has already shipped a card with an `se.mine` section is a
 * compatibility problem that grows with the corpus.
 *
 * Checked here rather than in a route, because it is a property of the object:
 * the same rule then covers an API write, an import, and a hand-edited file
 * picked up by the watcher, without three places remembering it.
 *
 * **Expressed as a check rather than as schema**, because JSON Schema can say
 * "matches this pattern" and cannot say "matches it unless it is one of these
 * four" without a `not`/`anyOf` construction that would report as
 * `must match a schema in anyOf` — and a reader of an emitted artefact deserves
 * better than that.
 */
function reservedNamespaceIssues(value: unknown): ValidationIssue[] {
  const sections = (value as { profile?: { sections?: unknown } }).profile?.sections;
  if (!Array.isArray(sections)) return [];

  // The card's own prompt sections are the engine's too ([P14.3]): the
  // SillyTavern importer writes them and the Scene pack places them.
  const conventional = new Set<string>([
    ...Object.values(CONVENTIONAL_SECTION_IDS),
    ...Object.values(CARD_PROMPT_SECTION_IDS),
  ]);

  return sections.flatMap((section, index) => {
    const id = (section as { id?: unknown }).id;
    if (typeof id !== 'string') return [];
    if (!id.startsWith(RESERVED_SECTION_PREFIX) || conventional.has(id)) return [];

    return [
      {
        path: `/profile/sections/${String(index)}/id`,
        message:
          `the ${RESERVED_SECTION_PREFIX} namespace is reserved for the engine — ` +
          'rename this section, or use one of the conventional ids',
      },
    ];
  });
}
