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
    <main className={page.tooling}>
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

      {results.isPending && props.query.trim() !== '' ? <Note>Searching…</Note> : null}

      {results.data === undefined ? null : (
        <Results data={results.data} onPathOnly={onPathOnly} onWiden={setOnPathOnly} />
      )}
    </main>
  );
}

function Results(props: {
  data: SearchResults;
  onPathOnly: boolean;
  onWiden: (value: boolean) => void;
}): JSX.Element {
  const turns = props.onPathOnly ? props.data.turns.filter((hit) => hit.onPath) : props.data.turns;
  const offPath = props.data.turns.filter((hit) => !hit.onPath).length;
  const total = turns.length + props.data.objects.length + props.data.entries.length;

  if (total === 0 && offPath === 0) return <Note>Nothing matched.</Note>;

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2" aria-labelledby="hits-turns">
        <h3 id="hits-turns" className="text-sm font-medium text-ink-muted">
          In your stories
        </h3>
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
        <h3 id="hits-objects" className="text-sm font-medium text-ink-muted">
          In your library
        </h3>
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
        <h3 id="hits-entries" className="text-sm font-medium text-ink-muted">
          In your lorebooks
        </h3>
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

function branchesLine(count: number): string {
  return count === 1
    ? 'Also show 1 hit on a branch you left'
    : `Also show ${String(count)} hits on branches you left`;
}

function entryLine(book: string, entry: string | null): string {
  return entry === null || entry === '' ? book : `${book} — ${entry}`;
}
