// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { useState, type JSX } from 'react';

import { isLibraryKind, type LibraryKind, type TurnRecord } from '../api.js';
import { labels } from '../i18n/catalogue.js';
import { useLibraryObject, useSaveObject, useTranscript } from '../queries.js';
import { Button } from '../ui/Button.js';
import { Fine, Note } from '../ui/Text.js';

/**
 * ***Propose, then apply*** —
 * [06 §7.4](../../../../docs/design/06-modes-and-turn-pipeline.md),
 * [10 §7](../../../../docs/design/10-ui-surfaces.md),
 * [P11.3](../../../../docs/design/workplan/28-p11-implementation.md).
 *
 * *"Every mutation is a reviewable diff, not a silent write… an assistant
 * quietly rewriting your own work is the fastest way to stop trusting it."*
 * [10 §7] says the same from the surface's side: *"Proposed changes render as
 * diffs, reviewed and applied explicitly, never written silently."*
 *
 * ***The proposal is read out of the turn record, which is where it already
 * is.*** The mode's `post` step writes `se.assistant.proposal` as an ordinary
 * channel effect, so it is on the turn, in the workbench, reversible by
 * branching and visible in the block table — and this panel reads the transcript
 * it was already reading. **No route, no store, no second copy of the
 * proposal**, which is the same argument the rest of this stage makes one layer
 * down.
 *
 * ***Applying is an ordinary library write made by the person.*** The diff is
 * rendered against the object **as it stands now** rather than against whatever
 * the model was shown, because minutes may have passed and the honest question
 * is *do you want this change to the file you have*. The write carries
 * `GeneratedFieldProvenance` ([10 §11.2]) exactly as a field assist's does —
 * §7.4 asks for that in as many words: *"so 'the assistant wrote this bit' stays
 * answerable later."*
 */

const WORDS = labels('assistant.proposal', {
  heading: 'A change it suggests',
  apply: 'Apply it',
  applying: 'Applying…',
  dismiss: 'No thanks',
  before: 'Now',
  after: 'Proposed',
  gone: 'That object is not in your library any more.',
  failed: 'The change could not be applied.',
  applied: 'Applied. The object carries a note saying the assistant wrote it.',
});

interface Change {
  kind: LibraryKind;
  id: string;
  changes: Record<string, string>;
  why?: string;
}

/**
 * The newest proposal on the path, or null.
 *
 * ***`applied` is checked rather than assumed.*** `acceptEffect` refuses a
 * proposal whose channel policy does not admit the proposer, and it records the
 * refusal rather than dropping it — so a rejected effect is on the turn and must
 * not be rendered as an offer. That is the one place this reading could go
 * quietly wrong.
 */
export function latestProposal(turns: readonly TurnRecord[]): Change | null {
  for (let at = turns.length - 1; at >= 0; at -= 1) {
    for (const effect of turns[at]?.effects ?? []) {
      if (effect.channelId !== 'se.assistant.proposal' || !effect.applied) continue;
      const value = effect.after;
      /**
       * ***A withdrawn offer is the newest word*** (2026-09-30). The step
       * writes `null` when an answer proposes nothing and an offer stood, so
       * the walk stops there — it skipped past it, and a proposal made three
       * questions ago was offered again under every answer since.
       */
      if (value === null) return null;
      if (typeof value !== 'object') continue;
      const row = value as { kind?: unknown; id?: unknown; changes?: unknown; why?: unknown };
      if (!isLibraryKind(row.kind) || typeof row.id !== 'string') continue;
      if (typeof row.changes !== 'object' || row.changes === null) continue;

      const changes: Record<string, string> = {};
      for (const [path, next] of Object.entries(row.changes as Record<string, unknown>)) {
        if (typeof next === 'string') changes[path] = next;
      }
      if (Object.keys(changes).length === 0) continue;
      return {
        kind: row.kind,
        id: row.id,
        changes,
        ...(typeof row.why === 'string' ? { why: row.why } : {}),
      };
    }
  }
  return null;
}

/**
 * ***The text at a dotted path, or null where the object holds none***
 * (2026-09-30) — the *before* half of the diff, and the test of whether a
 * change can be offered at all.
 *
 * ~~`valueAt` answered `''` for a path that was not there and JSON for one that
 * was not text~~, so a proposal for a field the object lacks rendered as
 * *Now: —* and looked like an empty field waiting to be filled. A model shown
 * no object guesses paths — `summary` on an actor, whose summary is a section
 * — and *Apply* then wrote a dead top-level field and said it had worked.
 * *A path through the prototype is nobody's text either*: it reaches a
 * function, never a string, and the walk stops at anything not an object.
 */
export function heldText(object: Record<string, unknown>, path: string): string | null {
  let held: unknown = object;
  for (const step of path.split('.')) {
    if (typeof held !== 'object' || held === null) return null;
    held = (held as Record<string, unknown>)[step];
  }
  return typeof held === 'string' ? held : null;
}

/**
 * Writes a dotted path, creating nothing — a path into nowhere is left alone,
 * ***its last step included*** (2026-09-30): the walk below refused a missing
 * intermediate and then set the leaf whatever it was, so a top-level path the
 * object did not have was created. Only text the object already holds is
 * replaced ({@link heldText}).
 */
export function withValueAt(
  object: Record<string, unknown>,
  path: string,
  next: string,
): Record<string, unknown> {
  if (heldText(object, path) === null) return object;
  const steps = path.split('.');
  const last = steps.pop();
  if (last === undefined) return object;

  const out = structuredClone(object);
  let held: Record<string, unknown> = out;
  for (const step of steps) {
    const inner = held[step];
    /**
     * ***A path the object does not have is not created.*** A proposal is a
     * model's reading of a document, and inventing `profile.sections.7` because
     * it said so would let a suggestion add structure nobody reviewed — which is
     * the *silent write* this whole section exists to refuse, arriving through
     * the one door that stayed open.
     */
    if (typeof inner !== 'object' || inner === null) return out;
    held = inner as Record<string, unknown>;
  }
  held[last] = next;
  return out;
}

/**
 * The latest proposal in a session, if there is one nobody has answered.
 *
 * ***Two components, so the object is read only while there is an offer***
 * (2026-09-27). This was one, and the read ran whether or not there was
 * anything to read: `useLibraryObject('actors', '')` whenever the panel was
 * open with no proposal, so `GET /api/library/actors/` answered 404 and the
 * poll asked again every two seconds; and a dismissed or applied proposal's
 * object went on being polled behind a panel that showed nothing. The offer
 * now mounts for one proposal, keyed by it, so a failure notice from the last
 * one does not carry over to the next either.
 */
export function Proposal(props: { sessionId: string }): JSX.Element | null {
  const transcript = useTranscript(props.sessionId);
  const [dismissed, setDismissed] = useState<string | null>(null);

  const change = transcript.data ? latestProposal(transcript.data.turns) : null;
  if (change === null) return null;
  const key = `${change.kind}:${change.id}:${Object.keys(change.changes).join(',')}`;
  if (key === dismissed) return null;
  return (
    <Offer
      key={key}
      change={change}
      onDone={() => {
        setDismissed(key);
      }}
    />
  );
}

function Offer(props: { change: Change; onDone: () => void }): JSX.Element | null {
  const { change, onDone } = props;
  const [notice, setNotice] = useState<string | null>(null);
  const save = useSaveObject();
  const object = useLibraryObject(change.kind, change.id);

  if (object.isError) return <Note>{WORDS.gone}</Note>;
  if (!object.data) return null;
  const held = object.data;
  /**
   * ***Only what the object holds as text*** (2026-09-30) — a change to a path
   * it does not have is dropped before it is shown, so what the person reviews
   * is what *Apply* writes. An offer with nothing left is no offer.
   */
  const changes = Object.entries(change.changes).filter(
    ([path]) => heldText(held.object, path) !== null,
  );
  if (changes.length === 0) return null;

  return (
    <section className="rounded-panel border border-line p-3" aria-label={WORDS.heading}>
      <h3 className="text-sm font-medium text-ink">{WORDS.heading}</h3>
      {change.why === undefined ? null : <Fine>{change.why}</Fine>}

      <dl className="mt-2 flex flex-col gap-3">
        {changes.map(([path, next]) => {
          // Every path shown holds text, so this is only ever an empty field —
          // and an empty field says so rather than nothing.
          const now = heldText(held.object, path) ?? '';
          return (
            <div key={path}>
              <dt className="text-xs text-ink-faint">{path}</dt>
              <dd className="mt-1 flex flex-col gap-1 text-sm">
                {/* **Both halves, labelled.** A diff that showed only the new text
                    would be asking somebody to approve a replacement without
                    showing them what it replaces. */}
                <span className="text-ink-subtle">
                  {WORDS.before}: {now.trim() === '' ? '—' : now}
                </span>
                <span className="text-ink">
                  {WORDS.after}: {next}
                </span>
              </dd>
            </div>
          );
        })}
      </dl>

      {notice === null ? null : (
        <p role="status" className="mt-2 text-sm text-ink-subtle">
          {notice}
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          type="button"
          size="compact"
          variant="primary"
          disabled={save.isPending}
          onClick={() => {
            let next = held.object;
            const generated = { ...((next['generated'] as Record<string, unknown> | null) ?? {}) };
            for (const [path, value] of changes) {
              next = withValueAt(next, path, value);
              /**
               * ***The same record a field assist writes*** — [10 §11.2], and
               * §7.4 asks for it by name: *"applied changes carry
               * `GeneratedFieldProvenance` like any other machine-written
               * content."* `unreviewed` is **false** here where an assist's is
               * true, and the difference is real: a person read this diff and
               * pressed a button, which is exactly what *reviewed* means.
               */
              generated[path] = {
                original: value,
                at: new Date().toISOString(),
                model: null,
                seed: change.why ?? null,
                unreviewed: false,
              };
            }
            save.mutate(
              {
                kind: change.kind,
                id: change.id,
                object: { ...next, generated },
                contentHash: held.contentHash,
              },
              {
                onSuccess: () => {
                  setNotice(WORDS.applied);
                  onDone();
                },
                onError: () => {
                  setNotice(WORDS.failed);
                },
              },
            );
          }}
        >
          {save.isPending ? WORDS.applying : WORDS.apply}
        </Button>
        <Button type="button" size="compact" onClick={onDone}>
          {WORDS.dismiss}
        </Button>
      </div>
    </section>
  );
}
