// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { PACKAGE_EXPORT_SCHEMA, type ManifestEntry, type PackageExport } from '@storyengine/shared';

import type { BuildInfo } from '../build-info.js';
import { LibraryError, read, type LibraryContext } from '../library.js';

/**
 * ***A package, with the objects it names*** —
 * [04 §9](../../../../docs/design/04-schemas.md),
 * [P11 §1.9](../../../../docs/design/workplan/28-p11-implementation.md),
 * [P11.10](../../../../docs/design/workplan/28-p11-implementation.md).
 *
 * **The contents are resolved rather than carried by reference**, which is the
 * whole of what makes this a bundle rather than a bookmark: a `.sepack` naming
 * twelve ids would be useless on the install it was sent to, where none of them
 * exists. [04 §9] describes a package as a bundle, and a bundle whose contents
 * are elsewhere is a shopping list.
 *
 * ***An id that resolves to nothing is reported, not dropped.*** A package can
 * outlive an object it names — somebody deletes an actor and the package still
 * lists it — and both wrong answers are worse than saying so: dropping it
 * exports a package that quietly is not the one somebody made, and refusing
 * makes a stale reference unfixable except by hand-editing a file.
 *
 * ***Replaced by the walker, 2026-10-10 ([P16.3a]).*** This resolves exactly
 * one level — the `contents[]` a World already declares — which is why
 * [04 §9.1](../../../../docs/design/04-schemas.md) could say *"the only reason
 * that has cost nothing is that the walker does not exist either."* That is no
 * longer true: `packaging/closure.ts` walks the whole table, every level, and is
 * what [P16.3](../../../../docs/design/workplan/35-p16-world.md)'s World file
 * will be built from. **This module and its route stay as they are** until
 * P16.3g, where the client's *Export this package* gives way to Publish and the
 * stage's plan removes the old export; until then a `.sepack.json` is still
 * this envelope and still one level deep, and the walker does not call it.
 * *(2026-10-10, [P16.3c]: and the World file is now built from the walk —
 * `world-file.ts` plans and writes the `.seworld` from a closure; nothing it
 * does calls this module either, which still answers the old route alone.)*
 */

export interface PackageExportContext {
  library: LibraryContext;
  build: BuildInfo | null;
}

export interface PackageExportResult {
  exported: PackageExport;
  /** Ids the package names and the library does not have. */
  missing: string[];
}

export function exportPackage(
  context: PackageExportContext,
  handle: string,
  packageId: string,
): PackageExportResult | null {
  let bundle;
  try {
    bundle = read(context.library, handle, packageId);
  } catch (error) {
    if (error instanceof LibraryError && error.code === 'not-found') return null;
    throw error;
  }

  const held = bundle.body as {
    id: string;
    name: string;
    version: string;
    contents?: { id?: unknown }[];
  };

  const manifest: ManifestEntry[] = [];
  const objects: unknown[] = [];
  const missing: string[] = [];

  for (const entry of held.contents ?? []) {
    const id = typeof entry.id === 'string' ? entry.id : null;
    if (id === null) continue;
    try {
      const row = read(context.library, handle, id);
      manifest.push({ id, schema: row.schemaId, name: row.name });
      objects.push(row.body);
    } catch (error) {
      if (error instanceof LibraryError && error.code === 'not-found') {
        missing.push(id);
        continue;
      }
      throw error;
    }
  }

  return {
    exported: {
      schema: PACKAGE_EXPORT_SCHEMA,
      exportedBy: { version: context.build?.version ?? null, at: new Date().toISOString() },
      manifest: { id: held.id, name: held.name, version: held.version, contents: manifest },
      objects,
    },
    missing,
  };
}
