// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

/**
 * A field-level diff between two versions of an object — the answer to *"what
 * actually changed between these"*, which a list of timestamps cannot give
 * ([10 §11.2a](../../../docs/design/10-ui-surfaces.md)).
 *
 * Paths are dotted, arrays by index (`profile.sections[0].body`), matching the
 * convention `GeneratedFieldProvenance` keys use. The comparison is structural:
 * a leaf is reported once, and an object is only descended into — so the diff
 * shows the changed field, and only the changed field.
 */

export interface FieldChange {
  path: string;
  before: unknown;
  after: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function diffObjects(before: unknown, after: unknown): FieldChange[] {
  const changes: FieldChange[] = [];
  walk('', before, after, changes);
  return changes;
}

function walk(path: string, before: unknown, after: unknown, changes: FieldChange[]): void {
  if (Object.is(before, after)) return;

  if (isRecord(before) && isRecord(after)) {
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      walk(path === '' ? key : `${path}.${key}`, before[key], after[key], changes);
    }
    return;
  }

  if (Array.isArray(before) && Array.isArray(after)) {
    const length = Math.max(before.length, after.length);
    for (let index = 0; index < length; index += 1) {
      walk(`${path}[${String(index)}]`, before[index], after[index], changes);
    }
    return;
  }

  // Two leaves (or a leaf against a container). Deep-equal composites that
  // reach here — e.g. an array replaced by an identical copy — are not changes.
  if (JSON.stringify(before) === JSON.stringify(after)) return;

  changes.push({ path, before, after });
}
