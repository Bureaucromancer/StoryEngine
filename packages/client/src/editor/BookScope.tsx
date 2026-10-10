// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { useState, type JSX, type ReactNode } from 'react';

import { ACTOR_SCHEMA, WORLD_SCHEMA } from '@storyengine/shared';

import type { LibraryObject } from '../api.js';
import { labels } from '../i18n/catalogue.js';
import { ownWorlds } from '../play/world-start.js';
import { useLibrary } from '../queries.js';
import { Badge } from '../ui/Badge.js';
import { SelectField } from '../ui/Field.js';
import { Fine, SectionTitle } from '../ui/Text.js';
import { TokenField, type TokenOption } from '../ui/TokenField.js';
import {
  pickableIds,
  scopeChoiceOf,
  scopeChoicesFor,
  scopeFor,
  scopeIdsOf,
  scopeKindOf,
  withScopeIds,
  type ScopeChoice,
} from './scope-form.js';

/**
 * ***A book's scope, written rather than only stored*** —
 * [P16.2](../../../../docs/design/workplan/35-p16-world.md),
 * [P16 §1.3](../../../../docs/design/workplan/35-p16-world.md),
 * [15 §5.3](../../../../docs/design/15-world.md),
 * [26 B16](../../../../docs/design/26-open-questions.md).
 *
 * P16 §1.3: *"A book's scope gets a surface with the arm, because a field that
 * is read and can only be changed in As stored is a field nobody sets."* This is
 * the surface. `scope-form.ts` holds the rules; this is the select, the two
 * pickers, and the sentences that say what each choice does — which matter
 * more than the controls, because the trap [P5.7] sprang is believing a scope
 * *admits* a book to sessions. **One arm does one thing, once**: a session
 * started in a World a book names gets the book ticked in its lorebooks at the
 * start. Every other choice is a record of intent that nothing reads, and the
 * hints say so in as many words rather than leaving a person to infer a
 * behaviour from the option's wording — 15 §5.3's *it describes a shape*.
 *
 * ***The select's value is held here, not only derived from the scope.***
 * *For particular characters* with nobody picked yet stores exactly what *Not
 * tied to anything* stores — `{ kind: 'linked', actorIds: [] }` — so a select
 * that re-read the scope after every write would snap back to *Not tied to
 * anything* the moment the option was chosen, and again when the last character
 * was removed, taking the picker away mid-edit. So the choice is remembered
 * with the scope it wrote, and re-derived only when the scope changes under it
 * — a version restored, a newer version reloaded and reapplied — which is
 * `NumberRow`'s *re-seeded on inequality* rule for a value that has two
 * spellings of one state rather than a half-typed number.
 */

const WORDS = labels('editor.lorebook-scope', {
  title: 'Scope',
  about:
    'Where this book says it belongs. A book reaches a session only by being chosen — ticked when the session is started, added to its lorebooks later, or brought by its treatment — and scope is never read on a turn.',
  label: 'This book is',
  nobody: 'Not tied to anything',
  actors: 'For particular characters',
  worlds: 'For sessions started in particular worlds',
  global: 'Global (from an older book)',
  unknown: 'Of a kind this version does not know ({kind})',
  nobodyHint: 'Nothing reads this. The book reaches a session when somebody chooses it there.',
  actorsHint:
    'Who this book is about. Nothing reads it: the book reaches a session only when somebody chooses it, whoever is in the story.',
  worldsHint:
    'A session started in one of these worlds gets this book in its lorebooks at the start — ticked on the new-session form, for you to untick — and nothing else does: not a session already running, and not one started anywhere else.',
  globalHint:
    'What older books say. Nothing reads it: a global book reaches a session only when somebody chooses it, like any other.',
  unknownHint:
    'This book’s scope is of a kind this version does not know ({kind}); it is kept as it is.',
  characters: 'Characters',
  worldsLabel: 'Worlds',
  noCharacters: 'No character chosen yet. Saved like this, the book is not tied to anything.',
  noWorlds: 'No world chosen yet. Saved like this, the book reaches no session through its scope.',
  noOwnWorlds: 'You have no worlds of your own to choose from yet. Make one in the library first.',
  unread: 'Your library could not be read, so nothing can be added here. Try reloading the page.',
  missing: 'Missing',
  missingCharacter:
    'Not in your library any more — deleted, or never on this install. The book keeps naming it; remove it here if you no longer want it.',
  missingWorld:
    'Not among your worlds any more — deleted, or never on this install. The book keeps naming it and it reaches nothing; remove it here if you no longer want it.',
});

/** The select's own label for each choice. */
function choiceLabel(choice: ScopeChoice, kind: string): string {
  switch (choice) {
    case 'nobody':
      return WORDS.nobody;
    case 'actors':
      return WORDS.actors;
    case 'worlds':
      return WORDS.worlds;
    case 'global':
      return WORDS.global;
    case 'unknown':
      return WORDS.unknown.replace('{kind}', () => kind);
  }
}

/** What the chosen option does — the sentence under the select. */
function choiceHint(choice: ScopeChoice, kind: string): string {
  switch (choice) {
    case 'nobody':
      return WORDS.nobodyHint;
    case 'actors':
      return WORDS.actorsHint;
    case 'worlds':
      return WORDS.worldsHint;
    case 'global':
      return WORDS.globalHint;
    case 'unknown':
      return WORDS.unknownHint.replace('{kind}', () => kind);
  }
}

export function BookScope(props: {
  /** The draft's scope — whatever the file says, read as `unknown`. */
  scope: unknown;
  /** The saved book's, which a choice restores when it is the choice the file made. */
  saved: unknown;
  onSet: (scope: Record<string, unknown>) => void;
}): JSX.Element {
  // `?? null` because a book with no scope at all is one a hand edit can make,
  // and `JSON.stringify(undefined)` is not a string whatever its type says.
  const now = JSON.stringify(props.scope ?? null);
  const [held, setHeld] = useState<{ choice: ScopeChoice; from: string }>(() => ({
    choice: scopeChoiceOf(props.scope),
    from: now,
  }));
  // The scope moved under the control — a restore, a reload-and-reapply — so
  // what it says now is the choice, React's *adjusting state when a prop
  // changes*, which renders once more rather than once wrong.
  if (now !== held.from) setHeld({ choice: scopeChoiceOf(props.scope), from: now });
  const choice = now === held.from ? held.choice : scopeChoiceOf(props.scope);

  /**
   * The kind to name for the unknown option: the draft's when it holds one,
   * otherwise the saved book's — the option is offered while either does.
   */
  const unknownKind =
    (scopeChoiceOf(props.scope) === 'unknown' ? scopeKindOf(props.scope) : null) ??
    scopeKindOf(props.saved) ??
    '';

  function write(next: Record<string, unknown>, as: ScopeChoice): void {
    setHeld({ choice: as, from: JSON.stringify(next) });
    props.onSet(next);
  }

  return (
    <section className="flex flex-col gap-3">
      <div>
        <SectionTitle as="h2" className="mb-2">
          {WORDS.title}
        </SectionTitle>
        <Fine>{WORDS.about}</Fine>
      </div>

      {/*
       * ***The only control that can change the scope***, so a kind this build
       * does not know is safe by construction: it is one of the options while
       * the book says it, nothing here writes the scope until somebody picks
       * another, and picking it back puts the original back byte for byte
       * ([26 B16]: *open the unions* — kept and ignored, never failed or
       * rewritten).
       */}
      <SelectField
        label={WORDS.label}
        value={choice}
        options={scopeChoicesFor(props.saved, props.scope).map(
          (one) => [one, choiceLabel(one, unknownKind)] as const,
        )}
        onChange={(value) => {
          const next = value as ScopeChoice;
          write(scopeFor(next, props.saved), next);
        }}
        hint={choiceHint(choice, unknownKind)}
      />

      {choice === 'actors' || choice === 'worlds' ? (
        <ScopeIds
          // Keyed by the arm: the two pickers are two fields, and a term typed
          // into one must not be standing in the other after a switch.
          key={choice}
          choice={choice}
          scope={props.scope}
          onIds={(ids) => {
            write(withScopeIds(props.scope, choice, ids), choice);
          }}
        />
      ) : null}
    </section>
  );
}

/** One row of a picker: an id, and the name it is offered under. */
interface Pickable {
  id: string;
  name: string;
}

/**
 * The characters or the Worlds a scope names — **picked by name, stored by
 * id**, `ActorRefs`' arrangement: a name is what anybody can choose from, and
 * an id is what survives a rename.
 *
 * ***What is offered, and what is only named.*** Characters: every actor the
 * library lists, the system's included, because a book can be about a shipped
 * character. Worlds: **your own**, `ownWorlds` — the set the new-session form
 * offers to start in, since a scope naming a World nobody here can start a
 * session in is a choice that does nothing on this install. *Names* are read
 * wider than offers, from every row of the kind, so a held id that is not
 * offered — a system World a file arrived naming — shows its name rather than
 * *Missing*.
 *
 * ***A held id that resolves to nothing stays, under its id, marked Missing***
 * — `MembersField`'s rule for a World's members ([15 §3.1]: *the reference
 * dangles, visibly and without blocking anything*). A World deleted, or one a
 * book was scoped to on another install, is exactly the case: dropping the id
 * would rewrite the author's statement on the reader's behalf, and the World
 * may yet arrive. *Only once the list has answered*, or every id would read as
 * missing while it loads.
 */
function ScopeIds(props: {
  choice: 'actors' | 'worlds';
  scope: unknown;
  onIds: (ids: string[]) => void;
}): JSX.Element {
  const isActors = props.choice === 'actors';
  const shelf = useLibrary(isActors ? 'actors' : 'worlds');
  const rows = shelf.data?.objects;
  const schema = isActors ? ACTOR_SCHEMA : WORLD_SCHEMA;

  const named = new Map<string, string>();
  for (const row of rows ?? []) {
    // The winner's name over a shadowed copy's, whichever arrives first.
    if (row.schema === schema && (!named.has(row.id) || !row.shadowed)) named.set(row.id, row.name);
  }
  const offered: Pickable[] = (
    isActors
      ? (rows ?? []).filter((row) => row.schema === schema && !row.shadowed)
      : ownWorlds(rows)
  ).map((row: LibraryObject) => ({ id: row.id, name: row.name }));
  const offeredIds = new Set(offered.map((one) => one.id));

  const held = scopeIdsOf(props.scope, props.choice);
  const answered = rows !== undefined;

  function optionsFor(term: string): TokenOption[] {
    const wanted = term.trim().toLowerCase();
    return offered
      .filter((one) => !held.includes(one.id))
      .filter((one) => wanted === '' || one.name.toLowerCase().includes(wanted))
      .map((one) => ({ value: one.id, label: one.name }));
  }

  function token(id: string): ReactNode {
    const name = named.get(id);
    if (name !== undefined || !answered) return name ?? id;
    return (
      <span className="inline-flex items-center gap-1">
        <span className="text-sm text-ink">{id}</span>
        <Badge tone="danger" title={isActors ? WORDS.missingCharacter : WORDS.missingWorld}>
          {WORDS.missing}
        </Badge>
      </span>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <TokenField
        label={isActors ? WORDS.characters : WORDS.worldsLabel}
        values={held}
        strict
        nameOf={(id) => named.get(id) ?? id}
        onChange={(ids) => {
          props.onIds(pickableIds(ids, held, offeredIds));
        }}
        optionsFor={optionsFor}
        renderToken={token}
      />
      {held.length === 0 ? <Fine>{isActors ? WORDS.noCharacters : WORDS.noWorlds}</Fine> : null}
      {!isActors && answered && offered.length === 0 ? <Fine>{WORDS.noOwnWorlds}</Fine> : null}
      {!answered && shelf.isError ? <Fine>{WORDS.unread}</Fine> : null}
    </div>
  );
}
