// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useState, type JSX } from 'react';

import { kindOfSchema, searchEverything, type SearchResults } from '../api.js';
import { sessionLabel } from '../play/session-label.js';
import { Button } from '../ui/Button.js';
import { link, page } from '../ui/classes.js';
import { Note, PageTitle } from '../ui/Text.js';

/**
 * ***Find the moment*** — [10 §14](../../../../docs/design/10-ui-surfaces.md),
 * [P11.1](../../../../docs/design/workplan/28-p11-implementation.md).
 *
 * **The route has served this since P2 and nothing called it.**
 * `route-callers.test.ts` has carried `GET /api/search` in its `OWED` map since
 * that map existed, with the reason written beside it: search and the reading
 * view *"are read-surfaces over the same data and share a print story"*. This is
 * the caller, and the entry in that map goes with it — **discharged by building
 * the surface rather than by editing the map**, which is the only way a debt in
 * it is meant to leave.
 *
 * ***One surface, three kinds of hit*** — §14.5. Objects, turns and lore
 * entries, from one query, because *"there is one search surface rather than
 * two"* and §5 already names the failure to avoid: a search box per kind.
 *
 * ***Branch hits are shown and labelled*** — §14.2, which is the one genuinely
 * tricky part and whose answer follows an existing rule rather than a new one.
 * [07 §6] makes a discarded line permanently recoverable and [07 §7] is equally
 * clear that it must not surface as though it were current. So a hit off the
 * path is returned, visually distinguished, and says where it lives: **hiding
 * them loses real answers, and showing them undifferentiated produces the worse
 * failure of somebody acting on something that never happened in their story.**
 */
export function SearchPage(props: { query: string }): JSX.Element {
  const [typed, setTyped] = useState(props.query);
  const [onPathOnly, setOnPathOnly] = useState(true);
  const navigate = useNavigate();

  const results = useQuery({
    queryKey: ['search', props.query],
    queryFn: () => searchEverything(props.query),
    enabled: props.query.trim() !== '',
  });

  return (
    // ***A `div`, not a landmark*** (2026-10-01, polish 11) — the shell owns
    // the routed app's one `<main>`, and this was a second one inside it, the
    // nesting [P3.−1] took out of Play, Sessions and Settings. Nothing caught
    // it because `shell-layout.test.tsx` never visited this page; it does now.
    <div className={page.tooling}>
      <PageTitle id="search">Search</PageTitle>
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void navigate({ to: '/search', search: { q: typed } });
        }}
      >
        <input
          type="search"
          aria-label="Search your library and your stories"
          value={typed}
          onChange={(event) => {
            setTyped(event.target.value);
          }}
          className="min-w-0 flex-1 rounded-control border border-line bg-surface px-3 py-2"
        />
        <Button type="submit">Search</Button>
      </form>

      {results.isError ? (
        <p role="alert" className="text-danger-ink">
          That search could not be run. Try different words.
        </p>
      ) : null}

      {props.query.trim() === '' ? (
        <Note>
          Type a word you remember. Names, places, a phrase — this searches your library and every
          turn of every story you own.
        </Note>
      ) : null}

      {/* ***Said, as well as shown*** (2026-10-01, polish 11). *Searching…*
          appeared and the hits replaced it, and neither reached a screen
          reader: a person who pressed Search heard nothing, then nothing, and
          had to go looking for whether anything had come back. One line, kept
          mounted so it is a live region before it has anything to say — one
          inserted already holding its words is one most screen readers never
          read (`ui/TwoStep.tsx` has the longer argument) — says the search's
          progress and then its answer, and says it again when the branch
          filter changes what is shown. Empty while there is nothing to say,
          which is also why it is not a `Note` with a margin of its own. */}
      <p role="status" className="text-sm text-ink-subtle">
        {statusLine(props.query, results.isError ? undefined : results.data, onPathOnly)}
      </p>

      {results.data === undefined ? null : (
        <Results data={results.data} onPathOnly={onPathOnly} onWiden={setOnPathOnly} />
      )}
    </div>
  );
}

function Results(props: {
  data: SearchResults;
  onPathOnly: boolean;
  onWiden: (value: boolean) => void;
}): JSX.Element | null {
  const { turns, total, offPath } = shown(props.data, props.onPathOnly);

  // Nothing to list, and the status line above has said so.
  if (total === 0 && offPath === 0) return null;

  return (
    <div className="flex flex-col gap-6">
      {/* `h2`s under the page's `h1` (2026-10-01, polish 11): they were `h3`s,
          so a screen reader's list of headings went from *Search* straight to
          a third level with no second, the outline of a page missing a part.
          The look is the class's and did not change. */}
      <section className="flex flex-col gap-2" aria-labelledby="hits-turns">
        <h2 id="hits-turns" className="text-sm font-medium text-ink-muted">
          In your stories
        </h2>
        {/*
          ***The default is the current path and one click widens*** — §14.2.
          The count is on the control because the control is otherwise a
          promise about nothing: *show branches too* with no number beside it
          cannot be told from a filter that would change nothing.
        */}
        {offPath === 0 ? null : (
          <label className="flex items-center gap-2 text-sm text-ink-muted">
            <input
              type="checkbox"
              checked={!props.onPathOnly}
              onChange={(event) => {
                props.onWiden(!event.target.checked);
              }}
            />
            <span>{branchesLine(offPath)}</span>
          </label>
        )}
        {turns.length === 0 ? (
          <Note>No turns matched.</Note>
        ) : (
          <ul className="flex flex-col gap-2">
            {turns.map((hit) => (
              <li key={hit.turnId} className="rounded-panel border border-line p-3">
                <a
                  className={link.object}
                  href={`/read/${hit.sessionId}?from=${encodeURIComponent(hit.turnId)}`}
                >
                  {/* An unnamed session is *Untitled session* here as
                      everywhere (2026-09-27): a blank link is nothing to
                      click and has no name to announce. */}
                  {sessionLabel(hit.sessionName)}
                </a>
                <p className="whitespace-pre-wrap text-sm text-ink-muted">{hit.snippet}</p>
                {hit.onPath ? null : <p className="text-sm text-warn-ink">{OFF_PATH}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2" aria-labelledby="hits-objects">
        <h2 id="hits-objects" className="text-sm font-medium text-ink-muted">
          In your library
        </h2>
        {props.data.objects.length === 0 ? (
          <Note>Nothing in the library matched.</Note>
        ) : (
          <ul className="flex flex-col gap-2">
            {props.data.objects.map((hit) => {
              /**
               * ***The kind from the schema, not the schema with an `s`***
               * (2026-09-27). The hit carries `storyengine.actor/1`, so every
               * link was `/library/storyengine.actor/1s/<id>`: four segments,
               * no route, and not one library hit on this page opened.
               *
               * *And the copy the search found*, by its address: two files can
               * hold one id (F19), each is its own hit, and an id alone would
               * open the winner from either row. The key is per file for the
               * same reason.
               */
              const kind = kindOfSchema(hit.schema);
              return (
                <li key={`${hit.source}/${hit.slug}/${hit.id}`}>
                  {kind === null ? (
                    <span>{hit.name}</span>
                  ) : (
                    <a
                      className={link.object}
                      href={
                        `/library/${kind}/${encodeURIComponent(hit.id)}` +
                        `?source=${hit.source}&slug=${encodeURIComponent(hit.slug)}`
                      }
                    >
                      {hit.name}
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2" aria-labelledby="hits-entries">
        <h2 id="hits-entries" className="text-sm font-medium text-ink-muted">
          In your lorebooks
        </h2>
        {props.data.entries.length === 0 ? (
          <Note>No lore entries matched.</Note>
        ) : (
          <ul className="flex flex-col gap-2">
            {props.data.entries.map((hit) => (
              <li
                key={`${hit.objectId}:${hit.entryId}`}
                className="rounded-panel border border-line p-3"
              >
                <a
                  className={link.object}
                  href={`/library/lorebooks/${hit.objectId}?entry=${encodeURIComponent(hit.entryId)}`}
                >
                  {entryLine(hit.objectName, hit.entryName)}
                </a>
                <p className="whitespace-pre-wrap text-sm text-ink-muted">{hit.snippet}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/**
 * Whole sentences in one string apiece, which the sentence-assembly lint rule
 * requires and [P11.8] will want: a phrase built out of JSX children is one no
 * catalogue can hold.
 */
const OFF_PATH = 'On a branch you left.';

/** What the results show under the branch filter, and what it holds back. */
function shown(
  data: SearchResults,
  onPathOnly: boolean,
): { turns: SearchResults['turns']; total: number; offPath: number } {
  const turns = onPathOnly ? data.turns.filter((hit) => hit.onPath) : data.turns;
  const offPath = data.turns.filter((hit) => !hit.onPath).length;
  return { turns, total: turns.length + data.objects.length + data.entries.length, offPath };
}

const SEARCHING = 'Searching…';
const NOTHING = 'Nothing matched.';
/** Hits only on lines you left, held back by the filter that offers them. */
const NOTHING_ON_PATH = 'Nothing matched on the line you are on.';

/**
 * The status line's words: nothing before a search and after a failure (the
 * alert says that one), *Searching…* while it runs, then what came back.
 */
function statusLine(query: string, data: SearchResults | undefined, onPathOnly: boolean): string {
  if (query.trim() === '') return '';
  if (data === undefined) return SEARCHING;
  const { total, offPath } = shown(data, onPathOnly);
  if (total > 0) return total === 1 ? '1 match.' : `${String(total)} matches.`;
  return offPath === 0 ? NOTHING : NOTHING_ON_PATH;
}

function branchesLine(count: number): string {
  return count === 1
    ? 'Also show 1 hit on a branch you left'
    : `Also show ${String(count)} hits on branches you left`;
}

function entryLine(book: string, entry: string | null): string {
  return entry === null || entry === '' ? book : `${book} — ${entry}`;
}
