// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { Link } from '@tanstack/react-router';
import { useState, type JSX } from 'react';

import type { MemoryConfig } from '../api.js';
import { useMemoryPanel, useSetMemoryConfig } from '../queries.js';
import { Fine, Note } from '../ui/Text.js';
import { disclosure } from '../ui/classes.js';
import { WriteFailed } from './WriteFailed.js';

/**
 * ***The UI, as the requirement describes it*** —
 * [08 §7](../../../../docs/design/08-cross-session-memory.md), [P8.4].
 *
 * *Per session, in settings:* **two switches** — *Share memories from this
 * session* and *Use memories from these characters* — **a list of the account's
 * other sessions involving the same actors**, each tri-state, and **a link to
 * the memory book itself, opening the ordinary lorebook editor.**
 *
 * ***A section of the Session panel rather than a panel of its own***, which is
 * [P8 §0.3]'s second item and a debt as much as a placement. That panel's own
 * docstring records what [P7B §1.4] asked for and did not get: **one** Session
 * panel with lore, the axes, the pack and the verbs as sections, on the grounds
 * that *"three disclosures in a column is the shape [10 §1.1] warns against"*.
 * It was written when there were three; P7.5, P7.6 and P7.8 made six and P7B.2
 * made seven. **Adding an eighth disclosure would be how a column becomes a
 * list**, so this is a section inside the seventh — and the consolidation the
 * column needs is still owed, now more than before.
 *
 * ---
 *
 * ***Sessions the toggles already include show as auto-on rather than being
 * hidden***, which 08 §7 asks for by name — *"so the effective result is visible
 * rather than inferred"*. Each row shows **both** what was chosen and what it
 * comes to, because a list showing only the choice would make *intake is off*
 * invisible on every auto row, and one showing only the result would make a
 * tri-state look like a boolean.
 */
export function MemorySection(props: { sessionId: string }): JSX.Element {
  const [open, setOpen] = useState(false);
  const panel = useMemoryPanel(props.sessionId, open);
  const save = useSetMemoryConfig(props.sessionId);

  const held = panel.data;
  const config = held?.config;
  const write = (next: Partial<MemoryConfig>): void => {
    if (config === undefined) return;
    save.mutate({ ...config, ...next });
  };

  return (
    <details
      className="rounded-panel border border-line"
      onToggle={(event) => {
        setOpen(event.currentTarget.open);
      }}
    >
      <summary className={`${disclosure.titled} px-3 py-2 text-sm`}>Memories</summary>

      <div className="flex flex-col gap-4 border-t border-line p-3">
        {panel.isPending && open ? <Fine>Loading…</Fine> : null}
        {config === undefined || held === undefined ? null : (
          <>
            <Note>
              Memories are kept per character and per persona, in an ordinary lorebook you can open
              and edit.
            </Note>

            {/* The two switches — [08 §4]. Both default on, and all four
                combinations are meaningful, which is why they are two controls
                rather than one. */}
            <Switch
              label="Share memories from this session"
              hint="New memories go into the characters’ books. Off makes this a session that reads history without adding to it."
              checked={config.share}
              disabled={save.isPending}
              onChange={(share) => {
                write({ share });
              }}
            />
            <Switch
              label="Use memories from these characters"
              hint="Earlier sessions with the same characters can reach this one. Off makes it a fresh start that still becomes canon going forward."
              checked={config.intake}
              disabled={save.isPending}
              onChange={(intake) => {
                write({ intake });
              }}
            />
            {/* [08 §3]: persona scope is *a default, not a law*. */}
            <Switch
              label="Remember across all my personas"
              hint="Off by default: talking to a different persona is talking to a different person, and she should know a different history."
              checked={config.acrossPersonas}
              disabled={save.isPending}
              onChange={(acrossPersonas) => {
                write({ acrossPersonas });
              }}
            />

            {/* ***The link [08 §7] asks for***, and what [P8 §1.1]'s storage
                decision bought: a memory book has a library address, so *"that
                is where individual memories are read, corrected and deleted, and
                it needs no bespoke UI"*. */}
            {held.books.length === 0 ? null : (
              <div className="flex flex-col gap-1">
                <span className="text-sm text-ink-subtle">Books</span>
                {held.books.map((book) =>
                  book.bookId === null ? (
                    <Fine key={book.actorId}>{`${book.actorName} — nothing remembered yet.`}</Fine>
                  ) : (
                    <Link
                      key={book.actorId}
                      to="/library/$kind/$id"
                      params={{ kind: 'lorebooks', id: book.bookId }}
                      className="text-sm text-ink underline decoration-line-strong hover:decoration-ink-subtle"
                    >
                      {`${book.actorName} — ${String(book.entries)} ${book.entries === 1 ? 'memory' : 'memories'}`}
                    </Link>
                  ),
                )}
              </div>
            )}

            {/* The tri-state list — [08 §4]'s *auto, always, never*. A plain
                boolean cannot express *exclude this one session despite intake
                being on*, which is precisely the control the requirement asks
                for. */}
            {held.others.length === 0 ? null : (
              <div className="flex flex-col gap-2">
                <span className="text-sm text-ink-subtle">
                  Other sessions with these characters
                </span>
                {held.others.map((row) => (
                  <div key={row.sessionId} className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="flex-1 text-ink">{row.name}</span>
                    <Fine>{row.effective ? 'in use' : 'not used'}</Fine>
                    <select
                      className="rounded-control border border-line bg-surface px-2 py-1 text-ink"
                      aria-label={`Memories from ${row.name}`}
                      value={row.association}
                      disabled={save.isPending}
                      onChange={(event) => {
                        const choice = event.target.value;
                        // `auto` is the absence of a choice and is stored as
                        // one, so the map holds only what somebody decided —
                        // rebuilt by filtering rather than by deleting a
                        // computed key, which the lint rules refuse and which
                        // would mutate the object the query cache is holding.
                        const kept = Object.entries(config.associations).filter(
                          ([sessionId]) => sessionId !== row.sessionId,
                        );
                        const associations = Object.fromEntries(
                          choice === 'auto'
                            ? kept
                            : [...kept, [row.sessionId, choice === 'always' ? 'always' : 'never']],
                        ) as MemoryConfig['associations'];
                        write({ associations });
                      }}
                    >
                      <option value="auto">Auto</option>
                      <option value="always">Always</option>
                      <option value="never">Never</option>
                    </select>
                  </div>
                ))}
              </div>
            )}

            {/* The reason kept (2026-10-01, polish 9): *That did not save* was
                the sentence for a turn in flight as much as for a fault. */}
            <WriteFailed error={save.error} otherwise="That did not save." />
          </>
        )}
      </div>
    </details>
  );
}

/**
 * A labelled switch with its reason under it.
 *
 * A checkbox rather than a styled toggle: the two states have to be legible to
 * a screen reader and to somebody who is not looking at colour, which is what
 * [work plan §2.1]'s day-one accessible markup means in a control this small.
 */
function Switch(props: {
  label: string;
  hint: string;
  checked: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
}): JSX.Element {
  return (
    <label className="flex gap-2 text-sm">
      <input
        type="checkbox"
        className="mt-1"
        checked={props.checked}
        disabled={props.disabled}
        onChange={(event) => {
          props.onChange(event.target.checked);
        }}
      />
      <span className="flex flex-col gap-0.5">
        <span className="text-ink">{props.label}</span>
        <Fine>{props.hint}</Fine>
      </span>
    </label>
  );
}
