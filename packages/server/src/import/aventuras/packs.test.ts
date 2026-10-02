// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { DatabaseSync } from 'node:sqlite';

import { afterEach, describe, expect, it } from 'vitest';

import type { ImportItemReport } from '@storyengine/shared';

import {
  buildAventurasDatabase,
  PACK_IDS,
  PRESET_PACKS,
  type AventurasDbOptions,
} from '../fixtures/test-aventuras-db.js';
import type { SourceItem } from '../source.js';
import { AVENTURAS_TEMPLATE_DEFAULTS, packRows, templateDiffers, templateHash } from './packs.js';
import { tablesIn } from './schema.js';

/**
 * ***Prompt packs, recorded*** —
 * [P13.9](../../../../../docs/design/workplan/30-p13-aventuras-import.md).
 *
 * The stage closed `recorded` (`packs.ts` says why), so what is tested is that
 * the review says truthfully what a pack held and which of its templates are
 * somebody's: the hash is Aventuras' own, the vendored table is the pin's, and
 * the three ways a template can be somebody's — edited in Aventuras' editor,
 * arrived in a pack somebody shared, or an id the pin never shipped — are all
 * counted, where §1.10's `content_hash` test would have found one of them.
 * That nothing is written for a pack is the reader's sweep test's.
 */

let open: DatabaseSync[] = [];

afterEach(() => {
  for (const db of open) if (db.isOpen) db.close();
  open = [];
});

/** The fixture's database, in memory, at the version the options say. */
function database(options: AventurasDbOptions = {}): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  open.push(db);
  buildAventurasDatabase(db, options);
  return db;
}

function rows(db: DatabaseSync): ImportItemReport[] {
  return [...packRows(db, { database: 'aventura.db', tables: tablesIn(db) })].map(
    (item: SourceItem) => {
      if (item.outcome !== 'observed') throw new Error('a pack is never a candidate');
      return item.report;
    },
  );
}

describe('the pin’s defaults, and Aventuras’ hash', () => {
  it('hashes as Aventuras does: trimmed, CRLF made LF, SHA-256 in hex', () => {
    // The two shortest defaults at the pin are one variable each, which makes
    // them the only ones a test can state without copying somebody's prose —
    // and enough to hold the vendored table and the hash to each other.
    expect(templateHash('{{ content }}')).toBe(
      AVENTURAS_TEMPLATE_DEFAULTS['translate-narration-user'],
    );
    expect(templateHash('{{ elementsJson }}')).toBe(
      AVENTURAS_TEMPLATE_DEFAULTS['translate-ui-user'],
    );
    expect(templateHash('\n  {{ content }}\r\n')).toBe(templateHash('{{ content }}'));
    // Only the ends are trimmed, and only CRLF becomes LF.
    expect(templateHash('{{  content }}')).not.toBe(templateHash('{{ content }}'));
  });

  it('holds the pin’s forty-three ids, thirty-eight of them with a user half', () => {
    const ids = Object.keys(AVENTURAS_TEMPLATE_DEFAULTS);
    const halves = ids.filter((id) => id.endsWith('-user'));
    const bases = ids.filter((id) => !id.endsWith('-user'));

    expect(ids).toHaveLength(81);
    expect(bases).toHaveLength(43);
    expect(halves).toHaveLength(38);
    // Every user half is the half of an id the pin ships, as `pack-service.ts`
    // names them: `<id>-user`.
    expect(halves.filter((half) => !bases.includes(half.slice(0, -'-user'.length)))).toEqual([]);
    for (const hash of Object.values(AVENTURAS_TEMPLATE_DEFAULTS)) {
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('calls a template somebody’s when it is not the pin’s text, or the pin has no text for it', () => {
    expect(templateDiffers('translate-narration-user', '{{ content }}')).toBe(false);
    expect(templateDiffers('translate-narration-user', '{{ content }} Be literal.')).toBe(true);
    // A newer Aventuras's template, or one another tool wrote: no default to be.
    expect(templateDiffers('rain-weather', '{{ content }}')).toBe(true);
    // Content that is not text is not a default either.
    expect(templateDiffers('translate-narration-user', null)).toBe(true);
    // Own keys only: an id spelled like a property of every object is no id.
    expect(templateDiffers('constructor', '{{ content }}')).toBe(true);
  });
});

describe('a pack is a recorded row that says what it held', () => {
  it('names the templates that differ, however they came to', () => {
    expect(rows(database())).toEqual([
      // The default pack first. One template as shipped, one edited in
      // Aventuras' own editor: the default pack's edits are real ones.
      {
        source: `aventura.db/preset_packs/${PACK_IDS.default}`,
        disposition: 'recorded',
        notes: [
          {
            key: 'import.aventuras.packRecorded',
            params: { pack: 'Default', templates: 2, differ: 1, variables: 0, tracked: 0 },
            level: 'info',
          },
          {
            key: 'import.aventuras.packTemplatesDiffer',
            params: { pack: 'Default', templates: 'adventure' },
            level: 'warn',
          },
        ],
      },
      // An imported pack: its rewritten narrator has its content for its
      // baseline, so Aventuras' edit flag says untouched and this says
      // somebody's; its whitespace-padded default is still the default; and
      // an id the pin never shipped is somebody's too.
      {
        source: `aventura.db/preset_packs/${PACK_IDS.rain}`,
        disposition: 'recorded',
        notes: [
          {
            key: 'import.aventuras.packRecorded',
            params: { pack: 'Rain', templates: 3, differ: 2, variables: 1, tracked: 1 },
            level: 'info',
          },
          {
            key: 'import.aventuras.packTemplatesDiffer',
            params: { pack: 'Rain', templates: 'adventure, rain-weather' },
            level: 'warn',
          },
        ],
      },
    ]);
  });

  it('says nothing for a database from before packs, and counts no tracked variables before them', () => {
    // 029 has no packs at all; 031 has packs and no runtime variables (032).
    expect(rows(database({ version: 29 }))).toEqual([]);

    const before = rows(database({ version: 31 }));
    expect(before).toHaveLength(PRESET_PACKS.length);
    expect(before.map((row) => row.notes[0]?.params['tracked'])).toEqual([0, 0]);
  });

  it('counts past the limit rather than naming, and clamps what it names', () => {
    const db = database();
    const insert = db.prepare(
      'insert into pack_templates (id, pack_id, template_id, content, content_hash, created_at, updated_at, baseline_hash)' +
        " values (?, ?, ?, 'x', 'h', 0, 0, 'h')",
    );
    // Somebody else's tool, writing ninety ids of its own and a long one.
    for (let n = 0; n < 90; n += 1) {
      insert.run(`extra-${String(n)}`, PACK_IDS.default, `zz-${String(n).padStart(3, '0')}`);
    }
    insert.run('extra-long', PACK_IDS.default, `a-${'long-'.repeat(40)}`);
    db.prepare("update preset_packs set name = ? where id = 'default-pack'").run('D'.repeat(500));

    const [first] = rows(db);
    const notes = first?.notes ?? [];
    const recorded = notes[0]?.params;
    const named = String(notes[1]?.params['templates']).split(', ');

    expect(recorded?.['differ']).toBe(92);
    expect(String(recorded?.['pack'])).toHaveLength(200);
    expect(named).toHaveLength(81);
    expect(Math.max(...named.map((id) => id.length))).toBe(64);
    expect(notes[2]).toEqual({
      key: 'import.aventuras.packTemplatesUnlisted',
      params: { pack: 'D'.repeat(200), count: 11 },
      level: 'warn',
    });
  });
});
