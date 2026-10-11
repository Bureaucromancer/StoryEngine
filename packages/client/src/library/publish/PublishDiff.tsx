// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { useId, useMemo, type JSX } from 'react';

import {
  type Closure,
  type FileSet,
  type NodeKey,
  type PublishDiff as Diff,
  publishDiff,
  type PublishDiffWhy,
  type PublishRecord,
} from '@storyengine/shared';

import { formatTimestamp } from '../../format.js';
import { Button } from '../../ui/Button.js';
import { Note, SectionTitle } from '../../ui/Text.js';
import { kindWord } from './kind-words.js';
import { asLastTime, sameTicks } from './model.js';
import { countPhrase, DIFF_WORDS } from './words.js';

/**
 * ***Re-publishing opens on the diff*** — [16 §5](../../../../../docs/design/16-publish.md):
 * *"what changed since the last file, so 'send them 1.2' is a decision made
 * against what 1.2 actually is."* [16 §3](../../../../../docs/design/16-publish.md)
 * is why there is a last file to compare with — a World re-resolves, so the
 * file is the frozen image and the World is not — and
 * [P16.3h](../../../../../docs/design/workplan/35-p16-world.md) builds it.
 *
 * **Drawn first, and only for a World start that has been published before**
 * (`PublishPage` decides both): the preview's `previous` is the ledger's newest
 * record for this World, and one object or a snapshot keeps nothing a later
 * file could be a re-publish *of*. *First* is read as the first thing under
 * the page's own title — before *just the object*, the rows and the sessions —
 * because the heading that names what is being published is what a person, and
 * a screen reader's heading list, meet first on every review; the diff is the
 * first thing the review then says about it.
 *
 * ***Live, and computed here rather than asked for.*** `publishDiff` is shared
 * and pure, and the page hands it the same `FileSet` the rows are drawn from,
 * on every tick — so untick a row and it moves from *as it was* to *was in
 * the last file, and what is ticked now leaves it out* as the box clears, and
 * the diff and the rows cannot disagree about what this file holds. The server
 * holds nothing between the preview and the confirm ([16 §5]'s *stages
 * nothing*); the one thing it was asked for is the record.
 *
 * ***Choose as last time is a button, never the default*** ([P16.3h]'s rule:
 * *defaults stay the table's*). The review opens on 04 §9.1's defaults —
 * sessions off — because a session must never come back ticked by itself
 * ([16 §5]: *"a thing to choose rather than a thing to discover you did"*).
 * The button puts back the record's own overrides and its history flag over
 * the ticks as they are (`asLastTime` says how, why it can never tick a
 * session the record did not, and why — since 2026-10-11 — it leaves what is
 * new since as the person has it), and a status line under it says, live,
 * whether pressing it would change anything — derived from the ticks, so it is
 * never a stale *done* after the person has moved on.
 *
 * ***The World first*** (2026-10-11, the P16.3h review): its version, its
 * name and its own page are said before its members, because [16 §5]'s *send
 * them 1.2* is a decision about the World, and a diff of members alone drew
 * *nothing has changed* over a World renamed and re-versioned.
 *
 * ***Just published*** (2026-10-11, the P16.3h review): once a publish from
 * this page has been answered, the record it was drawn from is no longer the
 * last file — the ledger's line for the new one is written as its download
 * finishes — so the diff says so and offers *Look again*, which reads that
 * line, rather than go on comparing with a file that is now two back and
 * offering its choices as *last time*'s.
 *
 * *[16 §8]'s watches are not this component's to count*: the ledger records
 * what left and what was overridden, whoever pressed what — pressing this is
 * not recorded as itself, and the next line reads the same either way.
 */
export function PublishDiff(props: {
  previous: PublishRecord;
  closure: Closure;
  set: FileSet;
  ticked: Readonly<Record<NodeKey, boolean>>;
  history: boolean;
  locale: string | undefined;
  /** A publish from this page has been answered since this record was read. */
  justPublished: boolean;
  onChooseAsLastTime: (choices: { ticked: Record<NodeKey, boolean>; history: boolean }) => void;
}): JSX.Element {
  const { previous, closure, set, history } = props;
  const hint = useId();
  const diff = useMemo(
    () => publishDiff(previous, set, closure, history),
    [previous, set, closure, history],
  );
  const last = useMemo(
    () => asLastTime(previous, closure, props.ticked),
    [previous, closure, props.ticked],
  );
  const same = history === last.history && sameTicks(closure, props.ticked, last.ticked);
  const lines = linesOf(diff);
  const date = formatTimestamp(diff.since.at, props.locale);

  if (props.justPublished) {
    return (
      <section aria-labelledby="publish-diff" className="mb-8 flex min-w-0 flex-col gap-3">
        <SectionTitle as="h2" id="publish-diff">
          {DIFF_WORDS.title}
        </SectionTitle>
        <p className="break-words text-sm text-ink">{DIFF_WORDS.justPublished}</p>
      </section>
    );
  }

  return (
    <section aria-labelledby="publish-diff" className="mb-8 flex min-w-0 flex-col gap-3">
      <SectionTitle as="h2" id="publish-diff">
        {DIFF_WORDS.title}
      </SectionTitle>
      <Note className="break-words">
        {diff.since.fileName === ''
          ? fill(DIFF_WORDS.sinceNoName, { date })
          : fill(DIFF_WORDS.since, { file: diff.since.fileName, date })}
      </Note>
      {lines.length === 0 ? (
        <p className="text-sm text-ink">{DIFF_WORDS.nothing}</p>
      ) : (
        <ul className="flex flex-col gap-1.5 text-sm text-ink">
          {lines.map((line) => (
            <li key={line.key} className="break-words">
              {line.text}
              {line.was === undefined ? null : (
                <> {fill(DIFF_WORDS.renamedFrom, { was: line.was })}</>
              )}
            </li>
          ))}
        </ul>
      )}
      {diff.unchanged === 0 && diff.sessions.unchanged === 0 ? null : (
        <ul className="flex flex-col gap-0.5 text-sm text-ink-subtle">
          {diff.unchanged === 0 ? null : (
            <li>
              {countPhrase(DIFF_WORDS.unchangedOne, DIFF_WORDS.unchangedMany, diff.unchanged)}
            </li>
          )}
          {diff.sessions.unchanged === 0 ? null : (
            <li>
              {countPhrase(
                DIFF_WORDS.sessionsUnchangedOne,
                DIFF_WORDS.sessionsUnchangedMany,
                diff.sessions.unchanged,
              )}
            </li>
          )}
        </ul>
      )}
      <div className="flex min-w-0 flex-col items-start gap-1">
        <Button
          type="button"
          aria-describedby={hint}
          onClick={() => {
            props.onChooseAsLastTime(last);
          }}
        >
          {DIFF_WORDS.asLastTime}
        </Button>
        {/* `Note`'s classes on a plain paragraph: the button names it by id, and
            `Note` takes none. */}
        <p id={hint} className="break-words text-sm text-ink-subtle">
          {DIFF_WORDS.asLastTimeHint}
        </p>
        {/* Always mounted, so the change is what a screen reader hears
            (`PublishActions`' outcome line has the argument). */}
        <p role="status" className="text-sm text-ink">
          {same ? DIFF_WORDS.asLastTimeSame : ''}
        </p>
      </div>
    </section>
  );
}

/** One change, as its sentence — and, for a rename, what it was called, said after. */
interface Line {
  key: string;
  text: string;
  was?: string;
}

/**
 * ***Every change as text***, in the order a person deciding *send them 1.2*
 * reads it: the World itself (its version, its name, its own page), what the
 * file gains, what changed, what it loses and why, then the sessions, then
 * history. The counts of what did not move are said apart, below, so a long
 * World's *as it was* does not bury its three changes.
 */
function linesOf(diff: Diff): Line[] {
  const thing = (entry: { name: string; schema: string }) => ({
    name: entry.name,
    kind: kindWord(entry.schema),
  });
  const lines: Line[] = [];
  const version = diff.world.version;
  if (version !== undefined) {
    // A version cleared, or set where there was none, has no number to quote.
    lines.push({
      key: 'world-version',
      text:
        version.then === '' || version.now === ''
          ? DIFF_WORDS.worldVersionBlank
          : fill(DIFF_WORDS.worldVersion, version),
    });
  }
  if (diff.world.renamedFrom !== undefined) {
    lines.push({
      key: 'world-name',
      text: fill(DIFF_WORDS.worldRenamed, { was: diff.world.renamedFrom }),
    });
  }
  if (diff.world.changed) lines.push({ key: 'world-own', text: DIFF_WORDS.worldChanged });
  for (const entry of diff.added) {
    lines.push({ key: `added:${entry.id}`, text: fill(DIFF_WORDS.added, thing(entry)) });
  }
  for (const entry of diff.changed) {
    lines.push({
      key: `changed:${entry.id}`,
      text: fill(DIFF_WORDS.changed, thing(entry)),
      ...(entry.renamedFrom === undefined ? {} : { was: entry.renamedFrom }),
    });
  }
  for (const entry of diff.removed) {
    lines.push({
      key: `removed:${entry.id}`,
      text: fill(removedSentence(entry.why), thing(entry)),
    });
  }
  for (const entry of diff.sessions.nowTicked) {
    lines.push({
      key: `session-now:${entry.id}`,
      text: fill(DIFF_WORDS.sessionNowTicked, { name: entry.name }),
    });
  }
  for (const entry of diff.sessions.playedOn) {
    lines.push({
      key: `session-played:${entry.id}`,
      text: fill(countPhrase(DIFF_WORDS.playedOnOne, DIFF_WORDS.playedOnMany, entry.turnsSince), {
        name: entry.name,
      }),
      ...(entry.renamedFrom === undefined ? {} : { was: entry.renamedFrom }),
    });
  }
  for (const entry of diff.sessions.changed) {
    lines.push({
      key: `session-changed:${entry.id}`,
      text: fill(DIFF_WORDS.sessionChanged, { name: entry.name }),
      ...(entry.renamedFrom === undefined ? {} : { was: entry.renamedFrom }),
    });
  }
  for (const entry of diff.sessions.noLongerTicked) {
    lines.push({
      key: `session-gone:${entry.id}`,
      text: fill(sessionRemovedSentence(entry.why), { name: entry.name }),
    });
  }
  if (diff.history.then !== diff.history.now) {
    lines.push({
      key: 'history',
      text: diff.history.now ? DIFF_WORDS.historyOn : DIFF_WORDS.historyOff,
    });
  }
  return lines;
}

/**
 * ***One sentence per reason***, read from the table when the line is drawn —
 * the table follows the active locale, where a copy taken as this module loads
 * would stay in whatever language was active then. A `switch` whose every arm
 * returns, so a reason added to the shared union without a sentence here is a
 * compile error (*not all code paths return a value*) rather than a line that
 * says nothing — the job `reasons.ts`'s `Record` does for closure rules, done
 * without a second string table for the catalogue's sweep to ask about.
 */
function removedSentence(why: PublishDiffWhy): string {
  switch (why) {
    case 'gone':
      return DIFF_WORDS.removedGone;
    case 'left-out':
      return DIFF_WORDS.removedLeftOut;
    case 'no-longer-reached':
      return DIFF_WORDS.removedNotReached;
    case 'too-large':
      return DIFF_WORDS.removedTooLarge;
  }
}

/** The same, for a session no longer in the file — which is never too large to travel. */
function sessionRemovedSentence(why: Exclude<PublishDiffWhy, 'too-large'>): string {
  switch (why) {
    case 'gone':
      return DIFF_WORDS.sessionGone;
    case 'left-out':
      return DIFF_WORDS.sessionLeftOut;
    case 'no-longer-reached':
      return DIFF_WORDS.sessionNotReached;
  }
}

/**
 * Each `{key}` by its value, replaced as a function so a `$` in a name is a
 * `$` — the review's `.replace('{name}', () => …)` habit, for any number of
 * keys. A key with no value stays as written, which a test would see.
 */
function fill(template: string, params: Readonly<Record<string, string>>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => params[key] ?? whole);
}
