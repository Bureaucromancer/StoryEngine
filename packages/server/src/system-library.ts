// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { DatabaseSync } from 'node:sqlite';

import { PRESET_SCHEMA, slugify } from '@storyengine/shared';

import { ingestFile } from './index-db/ingest.js';
import { encodeObject } from './library.js';
import { registeredModes } from './mode-registry.js';
import { readFileBytes } from './storage/files.js';
import { writeAtomic } from './storage/atomic.js';
import { SYSTEM_OWNER, type Layout } from './storage/layout.js';

/**
 * **The system library stops being shipped empty** — [P7B.0].
 *
 * `storage/layout.ts` has described `system/library/` as *"shipped, read-only,
 * loaded for everyone"* since P1, and until this nothing had ever written to
 * it: the merge was built, the index walked the scope, `library.ts` refused
 * edits and deletes against objects that did not exist, and
 * [10 §5](../../../docs/design/10-ui-surfaces.md)'s *Copy to my library* had
 * nothing to copy. **A read-only scope with nothing in it is indistinguishable
 * from a scope that does not work**, which is why it went six phases without
 * anyone noticing it had never been exercised.
 *
 * What lands here is the smallest thing that changes that and the thing
 * [P7B §1.2](../../../docs/design/workplan/28-p7b-presets-and-prompts.md) argues
 * for: **each loaded mode's default prompt pack, written into the system scope
 * at boot.** After this the Scene pack has a folder, an index row, a detail
 * route and a link from the workbench — and a session created without naming a
 * preset can record *which* pack it copied, which is the back-reference §1.1
 * says the copy has always been missing.
 *
 * ---
 *
 * **Why materialise rather than serve a virtual object.** §1.2 weighed the two
 * and the argument is about scopes rather than effort. A virtual `source:
 * 'mode'` would be a third origin that every list endpoint, every badge, every
 * filter and [polish §4](../../../docs/design/workplan/06-polish.md)'s panels
 * have to learn, for one object per mode. A file is a file: the watcher sees an
 * ordinary write, the index ingests an ordinary row, and the read-only refusals
 * that already guard the system scope apply without being told about modes.
 *
 * **Four things the boot write has to get right**, all of them from §1.2 and
 * each of them load-bearing:
 *
 * 1. **The id is the mode's and is stable across restarts.** `SCENE_PRESET.id`
 *    is a fixed uuid rather than a generated one, written that way for exactly
 *    this. A pack whose id moved would orphan every session that named it.
 * 2. **The write is atomic**, like every other write in this repository.
 * 3. **A mode that stops being loaded leaves its folder behind** rather than
 *    having it swept, because a session may still name it and a dangling ref is
 *    a visible non-blocking state ([00 §3.3](../../../docs/design/00-stance.md))
 *    where a missing file is a broken session.
 * 4. **A restart that changes nothing writes nothing.** This is the no-op rule
 *    ([03 §11.1](../../../docs/design/03-data-model.md)) and here it is not a
 *    nicety: `encodeObject` is shared with the request path precisely so that
 *    the bytes compare equal, and without the comparison every start would
 *    stamp a new `updatedAt`, wake the watcher and add a history version to an
 *    object nobody edited.
 *
 * **Hand edits are overwritten, and that is what *shipped* means.** Somebody
 * who wants a changed pack copies it to their own library — the action
 * [09 §4.3](../../../docs/design/09-server-multiuser-deployment.md) calls the
 * pinning mechanism. Editing the shipped one is already refused through the
 * routes; this is the same rule applied to the file underneath them.
 */

/** What one materialised object did, so the caller can say so and a test can assert it. */
export interface MaterialisedObject {
  /** The mode whose pack this is. */
  modeId: string;
  /** The object's own id, which is the mode's declared one. */
  id: string;
  slug: string;
  path: string;
  /**
   * False when the bytes on disk already matched.
   *
   * **The interesting value is the false one.** A second start that reports
   * every pack unwritten is the no-op rule working; a second start that reports
   * them all written means the encoding is not deterministic, and that is a
   * defect this field exists to make visible rather than a detail.
   */
  written: boolean;
}

/**
 * Write every loaded mode's default pack into the system library.
 *
 * **Where this runs is part of the design and not a detail.** It has to be
 * *after* the index is open and after any rebuild — a rebuild walks the system
 * root and would index the previous start's files, so writing first and
 * rebuilding second would leave the fresh bytes unindexed on the one start
 * where it matters most. And *before* the watcher starts, so the watcher never
 * sees its own boot write as an external change. `app.ts` holds that ordering
 * and says so there too.
 *
 * Failures are the caller's to decide about: a mode whose pack will not encode
 * is a broken build rather than a bad file, so this throws rather than
 * collecting errors, and `assertModesRunnable` is the precedent — the boot path
 * refuses early rather than serving a half-working install.
 */
export async function materialiseModePresets(
  db: DatabaseSync,
  layout: Layout,
): Promise<MaterialisedObject[]> {
  const done: MaterialisedObject[] = [];

  for (const mode of registeredModes()) {
    const preset = mode.definition.assembly.defaultPreset;

    // The mode's id, not the pack's name. A name is editable in principle and
    // this folder must not move; the id is the thing declared to be stable.
    const slug = slugify(mode.definition.id);

    const { path, bytes } = await encodeObject(layout, SYSTEM_OWNER, PRESET_SCHEMA, slug, preset);

    // Read-then-compare rather than write-then-hope: see §4 of the header.
    // `readFileBytes` answers null for absent, which is the first-start case.
    const existing = await readFileBytes(path);
    const unchanged = existing !== null && Buffer.from(existing).equals(Buffer.from(bytes));

    if (!unchanged) {
      await writeAtomic(path, bytes);
      await ingestFile(db, layout, path);
    }

    done.push({ modeId: mode.definition.id, id: preset.id, slug, path, written: !unchanged });
  }

  return done;
}
