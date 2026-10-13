// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, type JSX } from 'react';

import {
  fileSet,
  type NodeKey,
  type PublishPreview,
  type PublishStart,
  suggestedPublishName,
} from '@storyengine/shared';

import { api, ApiError } from '../../api.js';
import { Alert, AlertNote } from '../../ui/Alert.js';
import { Note } from '../../ui/Text.js';
import { ClosureList } from './ClosureList.js';
import { HistoryChoice, KeepChoice } from './FileChoices.js';
import { FileNeeds } from './FileNeeds.js';
import { keepKnown, totalsOf, travelling } from './model.js';
import { keptByRefusal, PublishActions } from './PublishActions.js';
import { PublishDiff } from './PublishDiff.js';
import { JustTheObject, PublishHeader, type SavedFile } from './PublishHeader.js';
import { SessionChoices } from './SessionChoices.js';
import { REFUSAL_WORDS, WORDS } from './words.js';

/**
 * ***The review, which is the surface*** — [16 §5](../../../../../docs/design/16-publish.md),
 * [P16.3g](../../../../../docs/design/workplan/34-p16-world.md).
 *
 * **One column, phone first, no stepper and no modal** ([16 §5]: *it renders
 * in the panel, not a modal … No stepper*): what is being published, *just the
 * object* when it is, every level of the closure with every reason, the
 * sessions, history, what opening the file needs, what is kept, and the strip
 * the decision is made from. *"In the panel"* is read as **the library page's
 * own column** ([P16.3]'s plan, D-doc2), because this is the library's export
 * path given a name ([16 §6]) and a page of its own is where its address can
 * carry the start.
 *
 * ***A World published before opens on what changed*** (2026-10-11,
 * [P16.3h]): the diff against the ledger's last record for it is drawn
 * first, under the title and above everything else the review says —
 * [16 §5]'s *re-publishing opens on the diff* — and follows the ticks, since
 * it is worked out from the same `fileSet` the rows are. Its *Choose as last
 * time* sets the ticks and history here; the defaults stay the table's.
 *
 * ***The rule for what is in the file is not here.*** `fileSet` is shared:
 * this page calls it on every tick, and the confirm calls it again over a
 * fresh walk with the ticks this page sends — so a ticked box is a thing the
 * file holds, by construction rather than by care.
 *
 * **The preview is held as long as the page and no longer**: `staleTime:
 * Infinity` and no refetch on focus or reconnect, because a review that
 * redrew itself under the person — a row vanishing as they reached for it —
 * would be worse than one a little out of date, and the confirm reports drift
 * anyway ([16 §5]: *the honest failure rather than a prevented one*);
 * `gcTime: 0`, because a review left and come back to should be drawn from the
 * library as it is then, not from a closure an hour old. *Look again* is the
 * one refetch, and it is the person's.
 */
export function PublishPage(props: {
  start: PublishStart;
  /** The reader's, for a session's last-played date ([20 §12.6]). */
  locale: string | undefined;
  /**
   * ***Hands the file to the browser*** — `save-file.ts`'s `saveFile`, passed
   * in by the route rather than imported here, so that module stays on the
   * entry with the detail page that also uses it instead of becoming a file of
   * its own the first load fetches (`Tick.tsx` says what that costs).
   */
  onFile: (file: SavedFile) => void;
}): JSX.Element {
  const preview = useQuery({
    queryKey: ['publish', 'preview', props.start],
    queryFn: () => api.previewPublish(props.start),
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  });

  if (preview.isPending) return <Note role="status">{WORDS.loading}</Note>;
  if (preview.isError) {
    return <AlertNote role="alert">{previewFailure(preview.error)}</AlertNote>;
  }
  return (
    <Review
      preview={preview.data}
      start={props.start}
      locale={props.locale}
      onFile={props.onFile}
      looking={preview.isFetching}
      onLookAgain={() => {
        void preview.refetch();
      }}
    />
  );
}

function previewFailure(failure: Error): string {
  if (!(failure instanceof ApiError)) return REFUSAL_WORDS.unreachable;
  if (failure.code === 'not-found') return REFUSAL_WORDS.notFound;
  if (failure.code === 'world-in-selection') return REFUSAL_WORDS.worldInSelection;
  return REFUSAL_WORDS.previewFailed;
}

/**
 * ***The review over one preview*** — the ticks, history, the keep choice and
 * the name are this component's, and nothing else holds them: [16 §5]'s *the
 * review stages nothing*, read from the client's side.
 */
function Review(props: {
  preview: PublishPreview;
  start: PublishStart;
  locale: string | undefined;
  onFile: (file: SavedFile) => void;
  looking: boolean;
  onLookAgain: () => void;
}): JSX.Element {
  const { preview } = props;
  const closure = preview.closure;
  const locale = props.locale;
  const queryClient = useQueryClient();

  const [ticked, setTicked] = useState<Record<NodeKey, boolean>>({});
  const [history, setHistory] = useState(false);
  const [keep, setKeep] = useState<'world' | 'snapshot'>('world');
  /**
   * ***The name the person typed, once they have*** — until then the name is
   * the suggestion over what is ticked now (2026-10-11, the [P16 audit],
   * privacy finding 4). ~~`useState(preview.suggestedName)`~~ held the
   * preview's names of every starting point, so unticking *Act III twist*
   * left it in the file's name and in a kept World's name in the file. The
   * suggestion follows the ticks; a name the person wrote is theirs and does
   * not move.
   */
  const [typed, setTyped] = useState<string | null>(null);
  /**
   * ***A kept World, once there is one*** — by this page's publish or named by
   * a refusal after the keep. **For a selection it stops Publish**: a second
   * press would keep a second World of the same set, which [16 §3]'s *two files
   * and one object* rules out and which nothing on the server guards (no
   * idempotency key — risk 14). The line under it sends the person to the
   * World's own page, where publishing keeps nothing. *An interpretation beside
   * the plan's pending-disable, which guards only the double click.*
   */
  const [kept, setKept] = useState<{ id: string; name: string } | null>(null);
  /**
   * ***The preview a publish from this page was answered over*** — the diff
   * stops calling its record *the last file* (2026-10-11, the P16.3h review):
   * the file just made is the last one now, and its ledger line is what the
   * next look reads. A new preview (*Look again*) is not this one, so the
   * diff comes back against that line by itself.
   */
  const [publishedOver, setPublishedOver] = useState<PublishPreview | null>(null);

  /**
   * ***Look again keeps the ticks whose keys it still holds*** — adjusted while
   * rendering, when a new preview arrives, rather than in an effect: React's
   * own pattern for state that follows a prop, and one render rather than two.
   */
  const [drawnFrom, setDrawnFrom] = useState(preview);
  if (drawnFrom !== preview) {
    setDrawnFrom(preview);
    setTicked((current) => keepKnown(current, preview.closure));
  }

  const set = useMemo(() => fileSet(closure, { ticked, history }), [closure, ticked, history]);
  const name = typed ?? suggestedPublishName(closure, set);

  const publish = useMutation({
    mutationFn: () =>
      api.publish(
        props.start,
        {
          ticked,
          history,
          keep,
          // The name is the kept World's, and a snapshot's file's stem; only a
          // selection has one to give (a World and an object are named already).
          ...(closure.origin === 'selection' ? { name: name.trim() } : {}),
        },
        preview.reviewed,
      ),
    onSuccess: (file) => {
      props.onFile(file);
      setPublishedOver(preview);
      if (file.world !== null) {
        setKept({ id: file.world, name: name.trim() });
        void queryClient.invalidateQueries({ queryKey: ['library'] });
      }
      if (closure.origin === 'world' && closure.world !== null) {
        void queryClient.invalidateQueries({ queryKey: ['publish-records', closure.world.id] });
      }
    },
    onError: (failure) => {
      const world = keptByRefusal(failure);
      if (world === null) return;
      // A file that did not arrive names the World by id alone; the name is
      // the one this page sent (2026-10-11, the P16.3g review).
      setKept({ id: world.id, name: world.name ?? name.trim() });
      void queryClient.invalidateQueries({ queryKey: ['library'] });
    },
  });

  const tick = (key: NodeKey, on: boolean): void => {
    setTicked((current) => ({ ...current, [key]: on }));
  };
  const leaveOut = (keys: readonly NodeKey[]): void => {
    setTicked((current) => ({
      ...current,
      ...Object.fromEntries(keys.map((key) => [key, false])),
    }));
  };

  const only = set.notes.some((note) => note.key === 'publish.closure.justTheObject')
    ? set.objects[0]
    : undefined;
  /**
   * ***A file of nothing, said for every start*** — AA13's sentence was the
   * World start's alone, and the P16.3g review found the other two reaching
   * it unsaid: a book play wrote chosen on its own (an object start whose one
   * root stays home), and a selection with every row unticked. *Empty* is
   * what the file will hold — {@link travelling}, so an object too large to
   * be one file counts as the nothing it will be.
   *
   * - **Where something is kept** — a World start, or a selection kept as a
   *   World — the file holds the World's name, and AA13's sentence is true:
   *   said, and Publish still goes, as it always has for a World.
   * - **Where nothing is** — one object, or a selection's snapshot — the file
   *   would hold nothing at all, and the server would write it and record it
   *   in the ledger. So the review says so and **Publish does not go**: no
   *   person wants that file, and a ledger row for it would be a publish that
   *   sent nothing.
   */
  const empty = travelling(set).length === 0 && set.sessions.length === 0;
  const keepsWorld =
    closure.origin === 'world' || (closure.origin === 'selection' && keep === 'world');
  const nameOnly = empty && keepsWorld;
  const nothingAtAll = empty && !keepsWorld;
  /** The kept World holds the chosen things that are there — `selectedEnvelopes` skips the rest. */
  const found = closure.roots.filter((key) =>
    closure.nodes.some((node) => node.key === key && node.state === 'found'),
  ).length;

  return (
    <div className="flex min-w-0 flex-col">
      <PublishHeader preview={preview} />
      {/*
        ***First, for a World published before*** ([P16.3h]): the server
        answers `previous` for a World start alone, and the origin is checked
        here too, so a record somehow handed to another start draws nothing —
        one object or a snapshot is never a re-publish of anything.
      */}
      {closure.origin === 'world' && preview.previous !== null ? (
        <PublishDiff
          previous={preview.previous}
          closure={closure}
          set={set}
          ticked={ticked}
          history={history}
          locale={locale}
          justPublished={publishedOver === preview}
          onChooseAsLastTime={(last) => {
            setTicked(last.ticked);
            setHistory(last.history);
          }}
        />
      ) : null}
      {only === undefined ? null : <JustTheObject node={only} onFile={props.onFile} />}
      <ClosureList
        closure={closure}
        set={set}
        ticked={ticked}
        onTick={tick}
        onLeaveOut={leaveOut}
      />
      <SessionChoices closure={closure} set={set} ticked={ticked} locale={locale} onTick={tick} />
      {/*
        ***AA13's case, said*** — the standing list's row for a World holding
        only sessions, none ticked ([P16 §3.2]): the file would hold the World's
        name and nothing else,
        and the person should read that before the file exists rather than
        open it and find out. Whatever empties it — no sessions ticked, every
        member unticked, an empty World — the sentence is the same and true.
      */}
      {nameOnly || nothingAtAll ? (
        <Alert tone="warning" role="status" className="mb-8">
          {nameOnly ? WORDS.nameOnly : WORDS.nothingAtAll}
        </Alert>
      ) : null}
      <HistoryChoice set={set} history={history} onChange={setHistory} />
      <FileNeeds set={set} history={history} modeVersions={preview.modeVersions} />
      <KeepChoice
        origin={closure.origin}
        count={found}
        keep={keep}
        name={name}
        onKeep={setKeep}
        onName={setTyped}
      />
      <PublishActions
        set={set}
        totals={totalsOf(set)}
        publishing={publish.isPending}
        blocked={
          nothingAtAll || (closure.origin === 'selection' && keep === 'world' && name.trim() === '')
        }
        looking={props.looking}
        kept={kept}
        keptHere={closure.origin === 'selection' && kept !== null}
        result={publish.data}
        failure={publish.error}
        onPublish={() => {
          if (publish.isPending) return;
          publish.mutate();
        }}
        onLookAgain={props.onLookAgain}
      />
    </div>
  );
}
