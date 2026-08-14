// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { TSchema } from '@sinclair/typebox';
import { Ajv, type ValidateFunction } from 'ajv';

import { Actor, ACTOR_SCHEMA } from './actor.js';
import { Lorebook, LOREBOOK_SCHEMA } from './lorebook.js';
import { Package, PACKAGE_SCHEMA } from './package.js';
import { Preset, PRESET_SCHEMA } from './preset.js';
import { Setting, SETTING_SCHEMA } from './setting.js';
import { Setup, SETUP_SCHEMA } from './setup.js';

/**
 * The registry — docs/design/13-schemas.md §9.
 *
 * **Every portable object self-describes with a `schema` field, so containers
 * never enumerate kinds** ([15 §2](docs/design/15-work-plan.md)). This maps that
 * string to a validator, which is the whole mechanism: a Package walks its
 * contents, asks the registry about each entry's `schema`, validates what it
 * recognises and carries the rest through untouched.
 *
 * It is also why the library routes at P1.5 are one handler set rather than six.
 */

/**
 * **`removeAdditional` is off, and it is the single most important line here.**
 *
 * [13 §2](docs/design/13-schemas.md) requires readers to *preserve* unknown
 * fields — the one rule that lets the format evolve without stranding anyone.
 * Ajv's `removeAdditional` does the exact opposite, and it is precisely the sort
 * of option switched on for tidiness by someone who has not read that section.
 * Silently stripping a field written by a newer version is invisible until
 * somebody downgrades, and by then their data is gone.
 *
 * `useDefaults` is off for the same reason: materialising a default is a write
 * the author did not make, and it turns "absent" into "present with a value" —
 * a distinction [13 §2](docs/design/13-schemas.md) makes deliberate meaning of.
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
 * [13 §3](docs/design/13-schemas.md) means by "ISO 8601. Never epoch ms."
 *
 * Written out rather than pulled from `ajv-formats`, because `date-time` is the
 * only format any portable schema uses and this package is supposed to carry as
 * close to no runtime dependencies as the job allows
 * ([07 §10](docs/design/07-tech-stack.md)). A regex plus a parse is cheaper than
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
  [SETTING_SCHEMA]: Setting,
  [SETUP_SCHEMA]: Setup,
  [PRESET_SCHEMA]: Preset,
  [PACKAGE_SCHEMA]: Package,
} as const satisfies Record<string, TSchema>;

export type PortableSchemaId = keyof typeof PORTABLE_SCHEMAS;

/**
 * The library kinds — everything a user can hold in a library, which is the six
 * minus Package. Package is a transport container, not a library object.
 */
export const LIBRARY_SCHEMAS = {
  [ACTOR_SCHEMA]: Actor,
  [LOREBOOK_SCHEMA]: Lorebook,
  [SETTING_SCHEMA]: Setting,
  [SETUP_SCHEMA]: Setup,
  [PRESET_SCHEMA]: Preset,
} as const satisfies Record<string, TSchema>;

/**
 * The folder each library kind lives in, per
 * [02 §5.1](docs/design/02-data-model.md). Plural, matching the storage layout.
 */
export const LIBRARY_DIRECTORIES = {
  [ACTOR_SCHEMA]: 'actors',
  [LOREBOOK_SCHEMA]: 'lorebooks',
  [SETTING_SCHEMA]: 'settings',
  [SETUP_SCHEMA]: 'setups',
  [PRESET_SCHEMA]: 'presets',
} as const;

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

  const schema = PORTABLE_SCHEMAS[schemaId as PortableSchemaId] as TSchema | undefined;
  if (!schema) return null;

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
 * stranding [13 §2](docs/design/13-schemas.md) forbids. Callers that need to
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

  if (validator(value)) return { valid: true };

  return {
    valid: false,
    issues: (validator.errors ?? []).map((error) => ({
      path: error.instancePath,
      message: error.message ?? 'invalid',
    })),
  };
}
