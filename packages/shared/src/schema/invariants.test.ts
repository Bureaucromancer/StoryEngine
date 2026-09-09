// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { TSchema } from '@sinclair/typebox';
import { describe, expect, it } from 'vitest';

import { PORTABLE_SCHEMAS } from './registry.js';

/** The emitted artefacts, beside the sources they came from. */
const SCHEMA_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'schemas');

/**
 * The invariants from docs/design/workplan/03-testing.md §1 that are properties of the
 * schemas rather than of any instance.
 *
 * These are the tests that "fail loudly when a refactor breaks the design rather
 * than the code".
 */

interface FoundProperty {
  kind: string;
  path: string;
  name: string;
}

/**
 * Walks every property name a schema declares, at every depth.
 *
 * Used on both the TypeBox objects and the emitted JSON, which is why it takes
 * `unknown` rather than a `TSchema`. The source walk catches a violation before
 * it reaches an artefact; the artefact walk is the one that has anything to say
 * about `emit-schemas` itself, which was previously the untested link between
 * the two (F18).
 */
function declaredProperties(kind: string, schema: unknown, path = ''): FoundProperty[] {
  if (typeof schema !== 'object' || schema === null) return [];

  const found: FoundProperty[] = [];
  const node = schema as Record<string, unknown>;

  const properties = node['properties'];
  if (typeof properties === 'object' && properties !== null) {
    for (const [name, child] of Object.entries(properties)) {
      found.push({ kind, path: `${path}/${name}`, name });
      found.push(...declaredProperties(kind, child, `${path}/${name}`));
    }
  }

  for (const key of ['items', 'additionalProperties', 'not', 'if', 'then', 'else']) {
    found.push(...declaredProperties(kind, node[key], `${path}/${key}`));
  }

  for (const key of ['anyOf', 'oneOf', 'allOf', 'prefixItems']) {
    const branch = node[key];
    if (Array.isArray(branch)) {
      branch.forEach((child, index) => {
        found.push(...declaredProperties(kind, child, `${path}/${key}[${String(index)}]`));
      });
    }
  }

  const patternProperties = node['patternProperties'];
  if (typeof patternProperties === 'object' && patternProperties !== null) {
    for (const [pattern, child] of Object.entries(patternProperties)) {
      found.push(...declaredProperties(kind, child, `${path}/{${pattern}}`));
    }
  }

  return found;
}

/**
 * The connection and credential denylist.
 *
 * Half of it is ST's own `sensitiveFields` list, quoted in
 * [04 §8.4.4](../../../../docs/design/04-schemas.md) — *"presets circulating in the wild can
 * and do contain a working proxy password"*. The other half is the general
 * shape, so a field named `apiKey` or `endpointUrl` fails this test even though
 * ST never had one.
 */
const DENIED_EXACT = [
  'reverse_proxy',
  'proxy_password',
  'custom_url',
  'custom_include_headers',
  'custom_include_body',
  'custom_exclude_body',
  'azure_base_url',
  'azure_deployment_name',
  'vertexai_express_project_id',
  'workers_ai_account_id',
];

const DENIED_PATTERNS = [
  /api[-_]?key/i,
  /\bsecret/i,
  /password/i,
  /credential/i,
  /\btoken\b/i,
  /bearer/i,
  /\bproxy/i,
  /base[-_]?url/i,
  /endpoint/i,
  /connection(id|string)?$/i,
];

function isDenied(name: string): boolean {
  if (DENIED_EXACT.includes(name)) return true;
  return DENIED_PATTERNS.some((pattern) => pattern.test(name));
}

describe('no portable schema carries a connection or a credential', () => {
  // docs/design/00-stance.md §3.2 — "the single most important boundary in the
  // data model", and the one decision this project enforces structurally rather
  // than with a check: the shareable types have no fields for that material, so
  // violating it requires changing a type.
  //
  // Which is exactly why it needs a test. "There is nowhere to put them" is only
  // true for as long as nobody adds somewhere, and the person who does will be
  // adding a field that looks perfectly reasonable in isolation.

  const everything = Object.entries(PORTABLE_SCHEMAS).flatMap(([kind, schema]) =>
    declaredProperties(kind, schema as TSchema),
  );

  /**
   * The same walk over the **emitted** files — the artefact, not its source.
   *
   * Walking the TypeBox objects catches a violation one step earlier, which is
   * why both are here, but it leaves `emit-schemas` untested (F18): the
   * artefact is what a third party fetches and validates against
   * ([19 §4](../../../../docs/design/19-tech-stack.md)), and an emitter that
   * dropped, renamed or added a property would sail past a walk over the input.
   *
   * Read synchronously and deliberately: this package has no business touching
   * a filesystem at runtime, and this is a test rather than runtime.
   */
  const emitted = readdirSync(SCHEMA_DIR)
    .filter((file) => file.endsWith('.json'))
    .flatMap((file) =>
      declaredProperties(file, JSON.parse(readFileSync(join(SCHEMA_DIR, file), 'utf8'))),
    );

  it('finds properties to check, so a broken walker cannot pass vacuously', () => {
    expect(everything.length).toBeGreaterThan(100);
    expect(everything.some((p) => p.name === 'preferredModelIds')).toBe(true);
  });

  it('finds them in the emitted files too, so a missing artefact cannot pass either', () => {
    // The emitted set is not merely non-empty: it is the *same size* as the
    // source walk. A build that emitted five of six kinds would otherwise look
    // like a clean run.
    expect(emitted.length).toBe(everything.length);
  });

  it('declares no denied property, at any depth, in any kind', () => {
    const violations = everything.filter((property) => isDenied(property.name));

    expect(
      violations.map((v) => `${v.kind}${v.path}`),
      'A portable object must never carry production settings. If this field is ' +
        'genuinely needed, it belongs on a Connection — which is private, local ' +
        'and never exported (docs/design/04-schemas.md §10).',
    ).toEqual([]);
  });

  it('emits no denied property either — the artefact is what strangers read', () => {
    const violations = emitted.filter((property) => isDenied(property.name));
    expect(violations.map((v) => `${v.kind}${v.path}`)).toEqual([]);
  });

  it('catches a denied property if one is added — the walker works', () => {
    // Guards the guard. A walk that silently returned nothing would make the
    // test above pass forever.
    const sabotaged = {
      type: 'object',
      properties: {
        blocks: { type: 'array', items: { type: 'object', properties: { proxy_password: {} } } },
      },
    };
    const found = declaredProperties('sabotaged', sabotaged).filter((p) => isDenied(p.name));
    expect(found).toHaveLength(1);
  });
});

describe('the emitted artefact is the document its $id names', () => {
  // F18: the `$id` said `…/schemas/storyengine.actor/1.json` and the file was
  // `storyengine.actor.1.json`, so the URL a consumer resolves was a 404 —
  // in an artefact whose entire reason for being committed is that a stranger
  // can fetch one without building anything.
  it('ends each $id with the filename it is written to', () => {
    const files = readdirSync(SCHEMA_DIR).filter((file) => file.endsWith('.json'));
    expect(files.length).toBe(Object.keys(PORTABLE_SCHEMAS).length);

    for (const file of files) {
      const document = JSON.parse(readFileSync(join(SCHEMA_DIR, file), 'utf8')) as {
        $id?: unknown;
      };
      expect(typeof document.$id, file).toBe('string');
      expect(String(document.$id).endsWith(`/${file}`), `${String(document.$id)} vs ${file}`).toBe(
        true,
      );
    }
  });
});

describe('every portable schema preserves unknown fields', () => {
  it('never sets additionalProperties to false, at any depth', () => {
    // The single rule that lets the format evolve without stranding anyone
    // ([04 §2](../../../../docs/design/04-schemas.md)). A `false` anywhere in here would
    // reject a file from a newer build, and would do it invisibly.
    const closed: string[] = [];

    function walk(kind: string, schema: unknown, path: string): void {
      if (typeof schema !== 'object' || schema === null) return;
      const node = schema as Record<string, unknown>;

      if (node['additionalProperties'] === false) {
        closed.push(`${kind}${path}`);
      }

      for (const [key, child] of Object.entries(node)) {
        if (Array.isArray(child)) {
          child.forEach((item, index) => {
            walk(kind, item, `${path}/${key}[${String(index)}]`);
          });
        } else if (typeof child === 'object' && child !== null) {
          walk(kind, child, `${path}/${key}`);
        }
      }
    }

    for (const [kind, schema] of Object.entries(PORTABLE_SCHEMAS)) {
      walk(kind, schema, '');
    }

    expect(closed).toEqual([]);
  });
});

describe('the two unions that must stay open (docs/design/04-schemas.md §8.2)', () => {
  // "In TypeScript the comment was aspirational; in the emitted JSON Schema it
  // was a hard enum, which would have rejected a perfectly good file from a
  // newer build."
  it('ActorRole is a documented string, not an enum', () => {
    const actor = PORTABLE_SCHEMAS['storyengine.actor/1'] as unknown as {
      properties: { roles: { items: Record<string, unknown> } };
    };
    const role = actor.properties.roles.items;

    expect(role['type']).toBe('string');
    expect(role['enum']).toBeUndefined();
    expect(role['anyOf']).toBeUndefined();
    expect(role['examples']).toContain('persona');
  });

  it('CallKind is a documented string, not an enum', () => {
    const preset = PORTABLE_SCHEMAS['storyengine.preset/0'] as unknown as {
      properties: { blocks: { items: { anyOf: { properties: Record<string, never> }[] } } };
    };
    const firstBlock = preset.properties.blocks.items.anyOf[0]!;
    const appliesTo = firstBlock.properties['appliesTo'] as unknown as {
      items: Record<string, unknown>;
    };

    expect(appliesTo.items['type']).toBe('string');
    expect(appliesTo.items['enum']).toBeUndefined();
    expect(appliesTo.items['examples']).toContain('narrate');
  });
});
