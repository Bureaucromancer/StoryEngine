// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { Link } from '@tanstack/react-router';
import type { JSX } from 'react';

import type { LoreEntry } from '@storyengine/shared';

import { formatTimestamp } from '../format.js';
import { Fine } from '../ui/Text.js';

/**
 * ***Where a memory came from*** — [08 §2](../../../../docs/design/08-cross-session-memory.md),
 * [P8 §1.4], [P8 §1.7], [P8.5].
 *
 * 08 §2: *"Entries are extracted from sessions; each carries a ref to its origin
 * session and a timestamp."* [P8 §1.4] says why that is not decoration —
 * **five memories are five things that can be retrieved independently,
 * attributed separately, and deleted individually when one turns out to be
 * wrong** — and attribution is the half a surface has to supply.
 *
 * ---
 *
 * ***A missing origin renders as an absence, not as a field*** — [P8 §1.7]'s
 * second item, and the reason it is not a field is the interesting part.
 *
 * That section found the question was **not open**: [03 §10.3] had already
 * decided it and [08 §8] did not know. *"It does not reach into other sessions
 * to remove what this one wrote. A session that promoted an actor to the
 * library, or wrote a cross-session memory, leaves those behind."* **Not
 * ask — tell.** And `deleteSession` already implements it.
 *
 * So what was left was the rendering, and the shape matters: deleting a session
 * drops its index rows, so the origin link resolves to nothing — and a *written*
 * marking saying *this session is gone* **would become a lie the moment the
 * folder came back from trash**, because a delete is a move ([03 §10.2]) until
 * the retention window closes. A rendering of an absence survives a restore for
 * free. The same posture `turns/lore.ts`'s `MissingLink` takes, and
 * [00 §3.3]'s: *resolve what you can, show what you cannot.*
 */
export function MemoryOrigin(props: {
  entry: LoreEntry;
  /**
   * The account's sessions, **passed in rather than fetched**.
   *
   * `LorebookView` and everything under it are pure components with no query
   * client — their tests render them directly, which is what makes them cheap to
   * test at all — and a `useQuery` in here took forty-three of those tests down
   * at once. The page above holds the list; this reads it.
   *
   * *Undefined is a real state and not an error*: a caller with no list renders
   * the origin without a name rather than claiming the session is gone, which is
   * the difference between *not resolved* and *resolved to nothing*.
   */
  sessions: readonly { id: string; name: string }[] | undefined;
  locale: string | undefined;
}): JSX.Element | null {
  const origin = originOf(props.entry);
  if (origin === null) return null;

  // Archived sessions are in this list — asked for since 2026-09-27; before,
  // they were not, and an archived origin read as deleted — and a deleted one
  // is not, which is exactly the distinction being rendered.
  const found = props.sessions?.find((one) => one.id === origin.sessionId);

  return (
    <Fine>
      {'Remembered from '}
      {props.sessions === undefined ? (
        <span className="text-ink-muted">an earlier session</span>
      ) : found === undefined ? (
        <span className="text-ink-muted">a session you have deleted</span>
      ) : (
        <Link
          to="/play/$sessionId"
          params={{ sessionId: found.id }}
          className="text-ink underline decoration-line-strong hover:decoration-ink-subtle"
        >
          {found.name}
        </Link>
      )}
      {origin.at === null ? '' : `, ${formatTimestamp(origin.at, props.locale)}`}
      {props.entry.locked ? ' · left alone by automatic extraction' : ''}
    </Fine>
  );
}

/**
 * The origin ref, from the open record [P8 §1.4] puts it in.
 *
 * `metadata` rather than a field, because
 * [11 §4](../../../../docs/design/11-lorebooks-as-a-format.md) refuses new
 * lorebook fields by name — so this is read defensively, the way every reader of
 * an open record has to be.
 */
function originOf(entry: LoreEntry): { sessionId: string; at: string | null } | null {
  /**
   * **Read through `unknown` rather than through the declared type**, which is
   * `readSummary`'s rule for the same reason: `metadata` is *required* by the
   * schema, so the compiler believes it is always there — and it is absent from
   * plenty of hand-built objects, a fixture and a hand-edited file among them
   * ([03 §5.1] supports getting data in that way). A declared type here would
   * make the checks below look redundant while they do the only work that
   * matters.
   */
  const metadata = (entry as { metadata?: unknown }).metadata;
  if (typeof metadata !== 'object' || metadata === null) return null;
  const held = (metadata as Record<string, unknown>)['se.memory'];
  if (typeof held !== 'object' || held === null) return null;
  const record = held as { sessionId?: unknown; at?: unknown };
  if (typeof record.sessionId !== 'string' || record.sessionId === '') return null;
  return {
    sessionId: record.sessionId,
    at: typeof record.at === 'string' ? record.at : null,
  };
}
