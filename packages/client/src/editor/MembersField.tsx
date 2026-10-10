// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { useQuery } from '@tanstack/react-query';
import { useId, useState, type JSX } from 'react';

import { LIBRARY_KINDS, listSessions } from '../api.js';
import { labels } from '../i18n/catalogue.js';
import { KIND_LABELS, KIND_WORDS } from '../library/labels.js';
import { sessionLabel } from '../play/session-label.js';
import { useLibrary } from '../queries.js';
import { Badge } from '../ui/Badge.js';
import { Button } from '../ui/Button.js';
import { Field, SelectField } from '../ui/Field.js';
import { Panel } from '../ui/Panel.js';
import { Fine, Note, SectionTitle, SubsectionTitle } from '../ui/Text.js';
import { useFocusOnReveal } from '../ui/useFocusOnReveal.js';
import {
  addMember,
  candidateLabel,
  candidateMatches,
  candidatesFor,
  memberKindOf,
  removeMemberAt,
  resolveMember,
  type Candidate,
  type Member,
  type MemberKind,
  type Resolution,
} from './members-form.js';

/**
 * ***A World's members, written rather than shown*** —
 * [P16.1](../../../../docs/design/workplan/35-p16-world.md),
 * [15 §3.1](../../../../docs/design/15-world.md),
 * [manual testing §10](../../../../docs/design/workplan/05-manual-testing.md).
 *
 * **What `SchemaFields` drew here until now was the list as stored, under
 * *this editor does not write this field yet*** — the editor manual testing
 * §10 placed for the old kind and [P7B.6] built without one. So a World could
 * be made and named and could hold nothing, unless somebody wrote envelopes into
 * its JSON by hand; P16.1's *a person can create a World, add and remove members
 * of every kind including sessions* is this component.
 *
 * **Two halves, and only the first is always on screen.** The list is the
 * World; the picker is a way to change it, and over a real library it is long
 * (AA11: hundreds of objects), so it opens on a press — the shelf's *Search*
 * arrangement, for the shelf's reason.
 *
 * ***A missing member stays where it is.*** [15 §3.1]: *the reference
 * dangles, visibly and without blocking anything*. It is drawn in its place in
 * the order, under the name the World last knew it by, with a badge saying
 * what happened — and it is never removed by this field on anybody's behalf: a
 * member that comes back (a restore from trash, an import that finally brings
 * it) resolves again on the next poll, and an auto-remove would have lost it.
 * The person removes it, here, if they no longer want it.
 *
 * **Everything this writes is draft**, saved by the editor's Save like every
 * other field, and merged member by member on a 412 (`mergedMembers`). The one
 * write that does not wait for Save is *Add to a world* on a session's page,
 * which is a different door for a different holder (`api.addWorldMembers`).
 */

/** How many matches the picker draws before it asks to be narrowed. */
const SHOWN = 50;

const WORDS = labels('editor.world-members', {
  session: 'session',
  sessions: 'Sessions',
  missing: 'Missing',
  missingObject:
    'Not in your library any more — it was deleted or never arrived. The world keeps naming it; remove it here if you no longer want it.',
  missingSession:
    'Not among your sessions any more — it was deleted or never arrived. The world keeps naming it; remove it here if you no longer want it.',
  missingNote:
    'A member marked Missing is not in your library or among your sessions any more. The world keeps naming it and nothing is blocked by it; remove it here if you no longer want it.',
  unknownKind: 'Unknown kind',
  unknownKindTitle:
    'A kind this version does not know. The world keeps it exactly as it is and carries it with the rest.',
});

export function MembersField(props: {
  members: Member[];
  /**
   * ***A change to the list, never the list*** — `HookList`'s rule, kept for
   * its reason even though nothing on this field is slow: every write on the
   * page is an updater (`object-editor.ts`'s `patch`), and one that was not
   * would be the first to build the object from a stale render.
   */
  onChange: (update: (members: Member[]) => Member[]) => void;
}): JSX.Element {
  /**
   * ***Both lists, read where they are used*** — `HookList`'s actor options,
   * for its reason: the page that mounts this should not have to learn what a
   * member is.
   *
   * **The whole library rather than one kind at a time**, because a World's
   * members are every kind and a name has to be found for each; the key is the
   * unfiltered shelf's, so a person who came from it pays for nothing.
   * **Sessions with the archived ones**, under `ObjectDetailPage`'s key: an
   * archived session is still a session, and reading the live list alone would
   * mark every archived member *Missing*.
   */
  const library = useLibrary();
  const sessions = useQuery({
    queryKey: ['sessions', 'with-archived'],
    queryFn: () => listSessions({ archived: true }),
  });
  const objects = library.data?.objects;
  const played = sessions.data?.sessions;

  const pickerId = useId();
  const [picking, setPicking] = useState(false);
  const [announced, setAnnounced] = useState('');
  /** Into the name box when the picker opens — polish 10's `useFocusOnReveal`. */
  const picker = useFocusOnReveal<HTMLDivElement>(picking);

  const rows = props.members.map((member) => ({
    member,
    kind: memberKindOf(member),
    resolution: resolveMember(member, objects, played),
  }));

  return (
    <section className="flex flex-col gap-4" aria-label="Members">
      <div>
        <SectionTitle as="h2">Members</SectionTitle>
        <Note>
          What this world holds: references to objects in your library and to your sessions, not
          copies. An edit to a member shows here; a member that is deleted stays named here, marked
          missing.
        </Note>
      </div>

      {rows.length === 0 ? (
        <Fine>Nothing here yet.</Fine>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((row, at) => (
            <MemberRow
              // Id and position: a hand edit can name one id twice, and two rows
              // under one key would be React reusing one for the other.
              key={`${row.member.id}:${String(at)}`}
              member={row.member}
              kind={row.kind}
              resolution={row.resolution}
              onRemove={() => {
                props.onChange((members) => removeMemberAt(members, at));
                setAnnounced(`Removed ${shownName(row.member, row.kind, row.resolution)}.`);
              }}
            />
          ))}
        </ul>
      )}

      {rows.some((row) => row.resolution.state === 'missing') ? (
        <Fine>{WORDS.missingNote}</Fine>
      ) : null}

      {/* Announced rather than only shown: an add moves a row from one list to
          another below the fold, and a remove takes one out from under the
          pointer — both are the change the DOM does not report. */}
      <p role="status" className="sr-only">
        {announced}
      </p>

      <div>
        <Button
          type="button"
          aria-expanded={picking}
          aria-controls={pickerId}
          onClick={() => {
            setPicking((open) => !open);
          }}
        >
          {picking ? 'Done adding' : 'Add members'}
        </Button>
      </div>

      {picking ? (
        <div id={pickerId} ref={picker}>
          <Picker
            held={new Set(props.members.map((member) => member.id))}
            candidates={
              objects === undefined || played === undefined
                ? undefined
                : candidatesFor(objects, played)
            }
            // Only a list that never arrived: the library polls, and a poll that
            // fails after an answer keeps the answer, which is still offerable.
            failed={
              (objects === undefined && library.isError) ||
              (played === undefined && sessions.isError)
            }
            onAdd={(candidate) => {
              props.onChange((members) => addMember(members, candidate.member));
              setAnnounced(`Added ${candidateLabel(candidate)}.`);
            }}
          />
        </div>
      ) : null}
    </section>
  );
}

/** One member, in its place: what kind, what it is called now, and whether it is still there. */
function MemberRow(props: {
  member: Member;
  kind: MemberKind | null;
  resolution: Resolution;
  onRemove: () => void;
}): JSX.Element {
  const name = shownName(props.member, props.kind, props.resolution);
  return (
    <li className="flex flex-wrap items-center gap-2 rounded-control border border-line px-3 py-2">
      <span className="text-xs text-ink-subtle">{kindWord(props.kind, props.member)}</span>
      <span className="min-w-0 text-sm text-ink">{name}</span>
      {/*
       * ***Danger's colour, `ShadowedBadge`'s arrangement*** — a state that
       * warns and never blocks. Not neutral, as `Off` and `Memories` are on the
       * shelf, because those are states somebody chose and this is one that
       * happened to the set: the World will export without it (the export
       * counts it in `x-storyengine-missing`), and the row is the only place
       * that says so before the file does. The word carries it; the colour is
       * the second channel.
       */}
      {props.resolution.state === 'missing' ? (
        <Badge
          title={props.kind === 'session' ? WORDS.missingSession : WORDS.missingObject}
          tone="danger"
        >
          {WORDS.missing}
        </Badge>
      ) : null}
      {props.resolution.state === 'unknown-kind' ? (
        <Badge title={WORDS.unknownKindTitle}>{WORDS.unknownKind}</Badge>
      ) : null}
      <Button
        type="button"
        variant="quiet"
        size="tiny"
        className="ms-auto"
        // A column of *Remove* buttons is a list nobody can choose from by
        // name — `RenameSession`'s reason for carrying the session in its own.
        aria-label={`Remove ${name}`}
        onClick={props.onRemove}
      >
        Remove
      </Button>
    </li>
  );
}

/**
 * The picker over everything you own — [P16.1]'s *a picker over the objects
 * you own, every kind and sessions*.
 *
 * **Narrowed by name and by kind, and capped.** A real library is hundreds of
 * objects (AA11), so the list is filtered as it is typed and draws the first
 * {@link SHOWN} matches, saying how many more there are — a picker that drew
 * all four hundred buttons would be a page nobody could find anything on, and
 * one that silently drew fifty would be one where the fifty-first could not be
 * found at all.
 *
 * **Held members are shown as held**, in their place in the list rather than
 * hidden from it: a person looking for the lorebook they meant to add should
 * find it and be told it is already in, not conclude it does not exist.
 */
function Picker(props: {
  held: ReadonlySet<string>;
  /** Undefined until both lists have answered. */
  candidates: Candidate[] | undefined;
  failed: boolean;
  onAdd: (candidate: Candidate) => void;
}): JSX.Element {
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('');

  const matching = (props.candidates ?? []).filter((candidate) =>
    candidateMatches(candidate, kind, query),
  );
  const shown = matching.slice(0, SHOWN);
  const groups = groupByKind(shown);

  return (
    <Panel className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-4">
        {/*
         * ***Enter filters; it does not save*** (2026-10-10). The picker sits
         * inside the editor's form like every field there, so Enter in this box
         * was the form's implicit submit — a person narrowing the list by name
         * saved the World instead. A keydown stopped here, before the form's
         * default action, keeps Enter what it means in a search box.
         */}
        <div
          className="min-w-48 flex-1"
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.preventDefault();
          }}
        >
          <Field
            label="Find by name"
            value={query}
            onChange={setQuery}
            hint="Only what you own: the system's shipped objects are not offered, and a world does not hold another world."
          />
        </div>
        <div className="min-w-40">
          <SelectField
            label="Kind"
            value={kind}
            options={[
              ['', 'Every kind'],
              // Every library kind but worlds — a World does not hold a World
              // ([15 §3.1]; `candidatesFor` has the argument).
              ...LIBRARY_KINDS.filter((one) => one !== 'worlds').map(
                (one) => [one, KIND_LABELS[one]] as const,
              ),
              ['session', WORDS.sessions],
            ]}
            onChange={setKind}
          />
        </div>
      </div>

      {props.failed ? (
        <Note>Your library or your sessions could not be read. Try reloading the page.</Note>
      ) : props.candidates === undefined ? (
        <Note>Reading your library and your sessions…</Note>
      ) : shown.length === 0 ? (
        <Note>
          {props.candidates.length === 0
            ? 'You own nothing that can be added yet — make or import something first.'
            : 'Nothing of yours matches.'}
        </Note>
      ) : (
        groups.map((group) => (
          <div key={group.kind} className="flex flex-col gap-2">
            <SubsectionTitle as="h3">{groupLabel(group.kind)}</SubsectionTitle>
            <ul className="flex flex-col gap-1">
              {group.candidates.map((candidate) => (
                <li
                  key={`${candidate.kind}:${candidate.member.id}`}
                  className="flex flex-wrap items-center gap-2"
                >
                  <span className="min-w-0 text-sm text-ink">{candidateLabel(candidate)}</span>
                  {candidate.archived ? <Fine>Archived</Fine> : null}
                  {props.held.has(candidate.member.id) ? (
                    <Fine className="ms-auto">In this world</Fine>
                  ) : (
                    <Button
                      type="button"
                      size="tiny"
                      className="ms-auto"
                      aria-label={`Add ${candidateLabel(candidate)}`}
                      onClick={() => {
                        props.onAdd(candidate);
                      }}
                    >
                      Add
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))
      )}

      {matching.length > shown.length ? (
        <Fine>{`${String(matching.length - shown.length)} more — narrow by name or kind to see them.`}</Fine>
      ) : null}
    </Panel>
  );
}

/** Consecutive runs of one kind — the candidates arrive sorted by kind already. */
function groupByKind(candidates: Candidate[]): { kind: MemberKind; candidates: Candidate[] }[] {
  const groups: { kind: MemberKind; candidates: Candidate[] }[] = [];
  for (const candidate of candidates) {
    const last = groups.at(-1);
    if (last?.kind === candidate.kind) last.candidates.push(candidate);
    else groups.push({ kind: candidate.kind, candidates: [candidate] });
  }
  return groups;
}

function groupLabel(kind: MemberKind): string {
  return kind === 'session' ? WORDS.sessions : KIND_LABELS[kind];
}

/** A kind in the singular, for the row — or the schema itself, for one this build does not know. */
function kindWord(kind: MemberKind | null, member: Member): string {
  if (kind === null) return member.schema;
  return kind === 'session' ? WORDS.session : KIND_WORDS[kind];
}

/**
 * The name a member row shows.
 *
 * **Its current name when it resolves** — the point of holding a reference
 * ([15 §3.1]) — and otherwise **the name the envelope was written with**,
 * which is the World's last knowledge of it and the only thing that can tell a
 * person which of their deleted lorebooks this was. An envelope with no name
 * at all falls back to its id rather than to nothing, because a row with no
 * words in it is a row nobody can decide about.
 */
function shownName(member: Member, kind: MemberKind | null, resolution: Resolution): string {
  if (resolution.state === 'found') {
    return kind === 'session' ? sessionLabel(resolution.name) : resolution.name;
  }
  const stored = member.name?.trim() ?? '';
  return stored === '' ? member.id : stored;
}
