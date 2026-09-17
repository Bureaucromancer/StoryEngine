// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import { entryGate, validate } from '@storyengine/shared';

import { DOCS_LOREBOOK, DOCS_LOREBOOK_ID } from './docs-lorebook.js';

/**
 * ***The assistant's docs lorebook*** —
 * [06 §7.4](../../../docs/design/06-modes-and-turn-pipeline.md),
 * [P11.3](../../../docs/design/workplan/28-p11-implementation.md).
 *
 * ***A corpus is the one thing here a type cannot check***, so what these
 * assertions are for is the small set of ways a corpus can be wrong that a
 * reader would not notice: an entry with no keys, which can never fire; two
 * entries claiming the same key, where one of them is dead weight; an entry
 * filed in a folder that does not exist, which arrives at the root; and a book
 * whose own gates are shut, which would make the whole thing invisible while
 * looking fine in a diff.
 *
 * **And one that is not about the corpus at all**: the bytes have to be the same
 * on every start, because `materialiseModePresets` compares them and writes only
 * on a difference. A timestamp from `now()` in a factory would turn a shipped
 * object into a write on every boot, which is the failure the assistant card's
 * fixed `STAMP` already exists to prevent.
 */

describe('the shipped help book', () => {
  it('is a valid lorebook', () => {
    const verdict = validate(DOCS_LOREBOOK);
    expect(verdict.valid, JSON.stringify('issues' in verdict ? verdict.issues : [])).toBe(true);
  });

  it('keeps its id, because a session names it', () => {
    // The id the assistant session attaches. An id that moved would leave every
    // assistant session pointing at a book that no longer exists.
    expect(DOCS_LOREBOOK.id).toBe('0199c000-0000-7000-8000-00000000d0c5');
    expect(DOCS_LOREBOOK_ID).toBe(DOCS_LOREBOOK.id);
  });

  it('is byte-identical across two reads, so a restart writes nothing', () => {
    // The module is a constant rather than a factory, which is what makes this
    // trivially true — and trivially false the moment somebody reaches for
    // `newLorebook()` or a `new Date()` inside it.
    expect(JSON.stringify(DOCS_LOREBOOK)).toBe(JSON.stringify(DOCS_LOREBOOK));
    expect(DOCS_LOREBOOK.provenance.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(DOCS_LOREBOOK.provenance.updatedAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('has entries, and every one of them can fire', () => {
    expect(DOCS_LOREBOOK.entries.length).toBeGreaterThanOrEqual(20);
    for (const entry of DOCS_LOREBOOK.entries) {
      // Keyed rather than constant: twenty-five constant entries would be the
      // whole budget spent on documentation nobody asked about.
      expect(entry.constant, `${entry.name} is constant`).toBe(false);
      expect(entry.keys.length, `${entry.name} has no keys`).toBeGreaterThan(0);
      expect(entry.content.trim(), `${entry.name} is empty`).not.toBe('');
      // Read by a knowledge router to judge relevance, and never injected — an
      // entry with none is one that reader cannot rank.
      expect(entry.description.trim(), `${entry.name} has no description`).not.toBe('');
      expect(entryGate(DOCS_LOREBOOK, entry).active, `${entry.name} is gated off`).toBe(true);
    }
  });

  it('files every entry in a folder that exists', () => {
    const folders = new Set(DOCS_LOREBOOK.folders.map((one) => one.id));
    for (const entry of DOCS_LOREBOOK.entries) {
      expect(folders.has(entry.folderId ?? ''), `${entry.name} → ${entry.folderId ?? 'root'}`).toBe(
        true,
      );
    }
    // And no folder is empty, which would be a heading over nothing.
    for (const folder of DOCS_LOREBOOK.folders) {
      const held = DOCS_LOREBOOK.entries.filter((one) => one.folderId === folder.id);
      expect(held.length, `${folder.name} holds nothing`).toBeGreaterThan(0);
    }
  });

  it('gives no two entries the same key', () => {
    /**
     * **The one corpus defect that is invisible and expensive.** Two entries
     * keyed on `budget` both fire on the same question, and the budgeter then
     * drops one — so the answer a person gets depends on a priority nobody set
     * deliberately, and the entry that loses is dead weight in every prompt it
     * was ever going to appear in.
     */
    const owner = new Map<string, string>();
    const clashes: string[] = [];
    for (const entry of DOCS_LOREBOOK.entries) {
      for (const raw of entry.keys) {
        const key = raw.toLowerCase();
        const held = owner.get(key);
        if (held !== undefined) clashes.push(`"${key}": ${held} and ${entry.name}`);
        else owner.set(key, entry.name);
      }
    }
    expect(clashes).toEqual([]);
  });

  it('gives every entry a distinct id and name', () => {
    const ids = new Set(DOCS_LOREBOOK.entries.map((one) => one.id));
    const names = new Set(DOCS_LOREBOOK.entries.map((one) => one.name));
    expect(ids.size).toBe(DOCS_LOREBOOK.entries.length);
    expect(names.size).toBe(DOCS_LOREBOOK.entries.length);
  });

  it('leaves itself retrievable rather than always-on', () => {
    // §7.4's claim is that *keyword activation plus the budgeter already do the
    // work*, and these three numbers are what that sentence costs: a scan deep
    // enough for a follow-up question, and caps that stop documentation eating
    // the conversation it is supposed to be helping with.
    expect(DOCS_LOREBOOK.scanDepth).toBeGreaterThan(2);
    expect(DOCS_LOREBOOK.tokenBudget).toBeGreaterThan(0);
    expect(DOCS_LOREBOOK.entryLimit).toBeLessThan(DOCS_LOREBOOK.entries.length);
    expect(DOCS_LOREBOOK.recursiveScanning).toBe(false);
  });
});
