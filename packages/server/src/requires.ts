// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import {
  MODEL_ROLES,
  type ModelRole,
  type UnmetRequirement,
  type World,
} from '@storyengine/shared';

import { compareVersions } from './build-info.js';
import { modeById } from './mode-registry.js';

/**
 * ***`requires`, checked*** — [04 §9](../../../docs/design/04-schemas.md),
 * [03 §7.2](../../../docs/design/03-data-model.md), built on **the owner's
 * answer of 2026-10-13** to the open question [P16](../../../docs/design/workplan/34-p16-world.md)'s
 * final audit recorded: *"Build the promise, or narrow the notes"* — build it.
 * 03 §7.2's promise is *"this wants Campaign ≥ 2 and an image connection; you
 * have neither"* rather than a broken session later, and a warning with a
 * degraded-start option rather than a hard block where possible.
 *
 * **One reading for three readers** — the World file's import (its notes,
 * `import/world/landing.ts`), the look before it (`import/world/preview.ts`),
 * and `POST /api/sessions` (its `422 unmet-requirements`, and the session
 * started anyway). Each asked *is this met* on its own before, and only the
 * first two asked at all; three spellings of the question is how the preview
 * says *met* and the dialog *missing* about one requirement.
 *
 * ***What each kind is checked against*** — the lead's decisions of
 * 2026-10-13, recorded in 04 §9 and open to the owner's reversal:
 *
 * | Kind | Met when | Otherwise |
 * |---|---|---|
 * | mode | `modeById(id)` is installed, at `minVersion` or later | absent, or older — and an unparseable `minVersion` is never met |
 * | capability | it is a model role (`MODEL_ROLES`) **and** that role resolves for the account | a role that does not resolve; **any other string cannot be checked**, and is not known to be met |
 * | extension | — | ***never***: this build loads no extensions, so none a World names is here — said as exactly that |
 *
 * **Why the roles are the vocabulary.** Nothing defined one: the only
 * capability strings ever written were test fixtures (`images`, `audio`,
 * `cap.x`), the publish side derives none (`packaging/confirm.ts`), and no
 * editor writes an authored `requires`. The roles are the one enumerated set
 * of *what this install can do* that already exists, and the only one a person
 * can change — Settings → *Your models* binds them — so a requirement named in
 * them is one a person can meet. 03 §7.2's *"an image connection"* is the
 * `image` role. An extension's own manifest `capabilities` (`"model:fast"`,
 * `"storage"`, [23 §4]) are a different vocabulary — what an extension asks
 * the host for — and are not read here.
 */

/**
 * ***`requires`, kept to its shape, with a count of what that kept out*** —
 * moved here from the World file's reader (2026-10-13), where it dropped a
 * malformed entry **without a word**: the reason 04 §9's *with the warning*
 * was struck. The count is what the import says now
 * (`import.world.requiresDropped`), and the struck words are back, by a dated
 * note there.
 *
 * **Dropped**: an entry of `modes` or `extensions` that is not a record, or
 * whose `id` or `minVersion` is not a string; a capability that is not a
 * string; and — new with the count — **an empty id or capability**, which
 * requires nothing anybody could have. *Not dropped*: a version that does not
 * parse, which is a requirement this build cannot meet rather than no
 * requirement at all (`modeIsHere` says so).
 *
 * ***Each id once.*** A requirement named twice is one requirement, and a list
 * that said it twice made the import say it twice (the reader's warning was
 * one per entry). A mode or extension keeps **the strictest version asked**
 * (`stricter`), so a file asking for a mode at 1.0 and at 2.0 is checked
 * against 2.0. Duplicates are not counted as dropped: nothing was malformed.
 *
 * *Typed `unknown`*, because a World's `requires` is read from a stored
 * `world.json` as well as from a manifest, and both are hand-editable: a list
 * that is not a list is an empty one, and an absent `requires` is the empty
 * one every World is made with.
 */
export function wellFormedRequires(raw: unknown): {
  requires: World['requires'];
  dropped: number;
} {
  const record = isRecord(raw) ? raw : {};
  let dropped = 0;
  const versioned = (list: unknown): { id: string; minVersion: string }[] => {
    const kept = new Map<string, { id: string; minVersion: string }>();
    for (const one of Array.isArray(list) ? (list as unknown[]) : []) {
      const id = isRecord(one) ? one['id'] : undefined;
      const minVersion = isRecord(one) ? one['minVersion'] : undefined;
      if (typeof id !== 'string' || id === '' || typeof minVersion !== 'string') {
        dropped += 1;
        continue;
      }
      const held = kept.get(id);
      kept.set(id, held === undefined ? { id, minVersion } : stricter(held, { id, minVersion }));
    }
    return [...kept.values()];
  };
  const modes = versioned(record['modes']);
  const extensions = versioned(record['extensions']);
  const capabilities = new Set<string>();
  for (const one of Array.isArray(record['capabilities'])
    ? (record['capabilities'] as unknown[])
    : []) {
    if (typeof one !== 'string' || one === '') {
      dropped += 1;
      continue;
    }
    capabilities.add(one);
  }
  return { requires: { modes, extensions, capabilities: [...capabilities] }, dropped };
}

/**
 * ***The stricter of two asks for one id*** — the later version; and **a
 * version that does not parse over one that does**, since it can never be met
 * (`modeIsHere`) and keeping the parseable one would let a file pass a check
 * one of its own entries fails. Of two that do not parse, the first stays.
 */
function stricter(
  held: { id: string; minVersion: string },
  next: { id: string; minVersion: string },
): { id: string; minVersion: string } {
  const heldParses = compareVersions(held.minVersion, held.minVersion) !== null;
  const nextParses = compareVersions(next.minVersion, next.minVersion) !== null;
  if (!heldParses) return held;
  if (!nextParses) return next;
  return (compareVersions(next.minVersion, held.minVersion) ?? 0) > 0 ? next : held;
}

/** The installed version of a mode, or `null` when this install does not have it. */
export function installedVersion(mode: string): string | null {
  return modeById(mode)?.definition.version ?? null;
}

/**
 * Whether this install has a mode, at this version or later — the import's
 * warning, its preview, and the start's refusal all ask this, so the look
 * before an import, the row after it and the dialog in front of a session
 * cannot disagree about a requirement. *Moved here from `landing.ts`*
 * (2026-10-13), which exported it for the preview alone.
 */
export function modeIsHere(mode: string, minVersion: string): boolean {
  const have = installedVersion(mode);
  return have !== null && (compareVersions(have, minVersion) ?? -1) >= 0;
}

const ROLES: ReadonlySet<string> = new Set(MODEL_ROLES);

/** Whether a capability string is one this build can check: a model role. */
export function isModelRole(capability: string): capability is ModelRole {
  return ROLES.has(capability);
}

/**
 * ***A capability, answered*** — `true` met, `false` a role that does not
 * resolve, **`null` when it cannot be checked**: not a role, or no roles were
 * handed in (a caller that did not ask the account, which no route is).
 */
export function capabilityHere(
  capability: string,
  roles: ReadonlySet<ModelRole> | null,
): boolean | null {
  if (!isModelRole(capability) || roles === null) return null;
  return roles.has(capability);
}

/**
 * ***What is unmet, in the shape both sides read*** (`UnmetRequirement`) —
 * modes, then capabilities, then extensions, each in the order asked, each id
 * once. `requires` should already be `wellFormedRequires`' answer; this
 * dedupes again regardless, since the start adds a Setup's mode to a World's
 * list and the two may name one mode.
 *
 * **`roles` is `null` when nobody asked the account**, and then every
 * capability is unmet and uncheckable — the honest answer of a caller that
 * cannot say, never a pass.
 */
export function unmetRequirements(
  requires: World['requires'],
  roles: ReadonlySet<ModelRole> | null,
): UnmetRequirement[] {
  const out: UnmetRequirement[] = [];
  const modes = new Map<string, { id: string; minVersion: string }>();
  for (const one of requires.modes) {
    const held = modes.get(one.id);
    modes.set(one.id, held === undefined ? one : stricter(held, one));
  }
  for (const { id, minVersion } of modes.values()) {
    if (modeIsHere(id, minVersion)) continue;
    out.push({ kind: 'mode', id, minVersion, installed: installedVersion(id) });
  }
  for (const id of new Set(requires.capabilities)) {
    const here = capabilityHere(id, roles);
    if (here === true) continue;
    out.push({ kind: 'capability', id, checkable: here === false });
  }
  const extensions = new Map<string, { id: string; minVersion: string }>();
  for (const one of requires.extensions) {
    const held = extensions.get(one.id);
    extensions.set(one.id, held === undefined ? one : stricter(held, one));
  }
  for (const { id, minVersion } of extensions.values()) {
    out.push({ kind: 'extension', id, minVersion });
  }
  return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
