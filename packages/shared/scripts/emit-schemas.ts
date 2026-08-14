// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// From `dist`, not `src`: the artefact should be emitted by the same code that
// ships, and `tsc -b` has already run by the time this does.
import { PORTABLE_SCHEMAS } from '../dist/index.js';

/**
 * Emits the JSON Schema artefacts.
 *
 * **JSON Schema is the artefact, TypeScript types are the derivative**
 * (docs/design/07-tech-stack.md §4). The direction matters: a third-party tool
 * validating a `.sepack` has to be able to fetch a schema file, not compile
 * against our types. That is the whole reason the project authors in TypeBox
 * rather than Zod.
 *
 * Each file is **standalone** — the shared substructures from §3 are inlined
 * rather than `$ref`-ed across files, so a consumer needs no resolver and no
 * second download. That costs some duplication in the emitted bytes and buys a
 * schema anyone can drop into any validator.
 *
 * This script is exempt from the no-direct-`fs` rule, and the exemption is
 * argued in eslint.config.js: the rule keeps one audited path resolver the only
 * door to *user data*, reached from a request. A build script emitting artefacts
 * into the repository has no user root to be contained within.
 */

const here = dirname(fileURLToPath(import.meta.url));
const outputDir = join(here, '..', 'schemas');

/** `storyengine.actor/1` → `storyengine.actor.1.json` — `/` is not a filename. */
function filenameFor(schemaId: string): string {
  return `${schemaId.replace('/', '.')}.json`;
}

function emit(): void {
  mkdirSync(outputDir, { recursive: true });

  // Clear stale artefacts, so a renamed or removed kind does not leave a file
  // behind that consumers keep validating against.
  for (const existing of readdirSync(outputDir)) {
    if (existing.endsWith('.json')) {
      rmSync(join(outputDir, existing));
    }
  }

  const written: string[] = [];

  for (const [schemaId, schema] of Object.entries(PORTABLE_SCHEMAS)) {
    const document = {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      ...schema,
    };
    const filename = filenameFor(schemaId);
    writeFileSync(join(outputDir, filename), `${JSON.stringify(document, null, 2)}\n`, 'utf8');
    written.push(filename);
  }

  console.log(`Emitted ${String(written.length)} schemas to packages/shared/schemas/`);
  for (const filename of written.sort()) {
    console.log(`  ${filename}`);
  }
}

emit();
