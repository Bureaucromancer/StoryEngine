// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { useState, type JSX } from 'react';

import { useLibrary, useSession, useSetSessionLore } from '../queries.js';
import { AlertNote } from '../ui/Alert.js';
import { Button } from '../ui/Button.js';
import { CheckboxField, SelectField } from '../ui/Field.js';
import { Fine, Note } from '../ui/Text.js';

/**
 * What this session retrieves from, and the control that changes it —
 * [P6B.0], [P6B §1.1](../../../../docs/design/workplan/20-p6b-playable.md).
 *
 * **The gap this closes is the one that kept PLAYABLE from running.**
 * `POST /api/sessions` has accepted a treatment and a book list since P5.6 and
 * `PUT /api/sessions/:id/lore` has always written them, and nothing in the
 * client called either — so every session ever made in the browser resolved
 * zero books, and the whole retrieval half of P5 was unreachable from the
 * product ([P5 §0.5](../../../../docs/design/workplan/17-p5-implementation.md)).
 *
 * **Here rather than only on the create form**, because the realisation *this
 * book should have been attached* arrives in the middle of a session and
 * starting again costs the thread. The create form is where a session is set
 * up; this is where it is corrected.
 *
 * **A disclosure rather than a panel**, because the story column is the
 * surface and a permanent settings block above the transcript would make every
 * session look like a form. Closed, it still says how many books are attached,
 * which is the one fact worth having without opening.
 *
 * **Not the cast**, deliberately: [P7.2](../../../../docs/design/workplan/23-p7-implementation.md)
 * owns that surface and [P7 §1.6] turns `cast` from a field into a channel, so
 * a cast control built here would be built against a shape P7 replaces.
 */
export function LorePanel(props: { sessionId: string }): JSX.Element {
  const session = useSession(props.sessionId);
  // Same key PlayPage already holds, so opening this issues no new request.
  const books = useLibrary('lorebooks');
  const treatments = useLibrary('treatments');
  const save = useSetSessionLore(props.sessionId);

  const saved = {
    treatment: session.data?.session.treatment ?? null,
    lore: session.data?.session.lore ?? [],
  };

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<{ treatment: string | null; lore: string[] }>(saved);

  /**
   * **Seeded on open rather than by an effect**, which is what keeps a
   * half-made selection from being wiped underneath somebody. PlayPage
   * invalidates the session entry after every turn, so an effect syncing the
   * draft to the query would discard an in-progress edit each time a turn
   * finished — and the moment somebody is most likely to be editing this is
   * the moment they are also taking turns.
   */
  const toggle = (next: boolean): void => {
    if (next) setDraft(saved);
    setOpen(next);
  };

  const changed =
    draft.treatment !== saved.treatment ||
    draft.lore.length !== saved.lore.length ||
    draft.lore.some((id) => !saved.lore.includes(id));

  return (
    <details
      open={open}
      onToggle={(event) => {
        toggle(event.currentTarget.open);
      }}
      className="rounded-control border border-line bg-surface px-3 py-2"
    >
      <summary className="cursor-pointer text-sm text-ink-subtle">
        {attachedLine(saved.lore.length, saved.treatment !== null)}
      </summary>

      <div className="mt-3 flex flex-col gap-3">
        <SelectField
          label="Treatment"
          value={draft.treatment ?? ''}
          options={[
            ['', 'None'],
            ...(treatments.data?.objects ?? []).map(
              (one) => [one.id, one.name] as [string, string],
            ),
          ]}
          onChange={(value) => {
            setDraft({ ...draft, treatment: value === '' ? null : value });
          }}
          hint="A treatment brings its own lorebooks, before the ones chosen below."
        />

        <fieldset className="flex flex-col gap-2">
          <legend className={LEGEND}>Lorebooks</legend>
          {(books.data?.objects ?? []).length === 0 ? (
            <Note>
              There are no lorebooks in the library yet. Import one, or make one from the library
              page.
            </Note>
          ) : (
            (books.data?.objects ?? []).map((book) => (
              <CheckboxField
                key={book.id}
                label={book.name}
                checked={draft.lore.includes(book.id)}
                onChange={(checked) => {
                  setDraft({
                    ...draft,
                    lore: checked
                      ? [...draft.lore, book.id]
                      : draft.lore.filter((id) => id !== book.id),
                  });
                }}
              />
            ))
          )}
        </fieldset>

        <Fine>
          Which entries actually fired, and whether a book was scanned because of the treatment or
          because it was chosen here, is in the workbench.
        </Fine>

        {save.isError ? <AlertNote role="alert">{save.error.message}</AlertNote> : null}

        <div className="flex gap-2">
          {/* **Not bare "Save"**, which is what it said first: the play page
              already has one, on the form that names a line, and two controls
              with one label on one surface is ambiguous to a screen reader and
              to a person who has just opened this. Caught by the naming test
              rather than by review, which is the argument for the tests being
              written against roles and names. */}
          <Button
            type="button"
            variant="primary"
            disabled={!changed || save.isPending}
            onClick={() => {
              save.mutate(draft);
            }}
          >
            Save selection
          </Button>
        </div>
      </div>
    </details>
  );
}

const LEGEND = 'text-sm font-medium text-ink-muted';

/**
 * What the closed disclosure says.
 *
 * One string from a template literal rather than a sentence assembled around a
 * value in JSX, which is the shape [19 §12.6a] forbids — and the count is worth
 * having closed, because *no books attached* is the state that made every
 * session before [P6B.0] silent about lore.
 */
export function attachedLine(books: number, treatment: boolean): string {
  const shelf =
    books === 0 ? 'no lorebooks' : books === 1 ? 'one lorebook' : `${String(books)} lorebooks`;
  return treatment ? `Retrieving from a treatment, and ${shelf}` : `Retrieving from ${shelf}`;
}
