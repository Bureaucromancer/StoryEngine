// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { SESSION_EXPORT_SCHEMA, uuidv7, type SessionExport, type Turn } from '@storyengine/shared';

/**
 * ***A session export with words in it*** — the fixture
 * [P13.0](../../../../docs/design/workplan/30-p13-aventuras-import.md)'s
 * reproduction needed and `import.test.ts`'s `branched()` could not be.
 *
 * The routes a person uses to make a session without a model write **channel
 * turns**, which carry no `input` and no `output` — so nothing in them is ever
 * indexed for search, and search is the one surface where two sessions sharing
 * turn ids showed. Every read of a turn by route either walks the segments or
 * checks the id on the line it read back, so the collision was invisible from
 * the turn routes and visible from search, delete and rebuild. A fixture whose
 * turns say something is what makes the defect observable at all.
 *
 * ***A fork, not a chain.*** The fourth turn is a sibling of the third, so a
 * test that counts what arrived is counting a tree rather than a walk — the
 * property [P11.10] spent its format decision on.
 */
export interface SpokenEnvelope {
  document: SessionExport;
  /** The source's own ids, in creation order: root, middle, the head, its sibling. */
  turnIds: string[];
  /** The source's own session id. */
  sessionId: string;
}

export function spokenEnvelope(phrase: string, name = 'Rain City'): SpokenEnvelope {
  const sessionId = uuidv7();
  const ids = [uuidv7(), uuidv7(), uuidv7(), uuidv7()] as const;
  const at = (minute: number): string => new Date(Date.UTC(2026, 8, 1, 12, minute)).toISOString();

  const turn = (index: number, parent: string | null, said: string): Turn => ({
    id: ids[index]!,
    sessionId,
    parentTurnId: parent,
    createdAt: at(index),
    status: 'complete',
    input: { actorId: null, kind: 'say', text: 'And then?', raw: 'And then?' },
    output: { text: said },
    effects: [],
    tape: [],
  });

  const turns = [
    turn(0, null, `The ${phrase} stood at the end of the quay.`),
    turn(1, ids[0], 'Nobody on the harbour would say who had raised it.'),
    turn(2, ids[1], 'She walked out to it before the tide turned.'),
    turn(3, ids[1], 'She waited for the tide instead.'),
  ];

  return {
    sessionId,
    turnIds: [...ids],
    document: {
      schema: SESSION_EXPORT_SCHEMA,
      exportedBy: { version: null, at: at(10) },
      session: {
        id: sessionId,
        name,
        createdAt: at(0),
        updatedAt: at(3),
        headTurnId: ids[2],
        channels: {},
      },
      turns,
      renditions: [],
    },
  };
}
