// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { createSession, listSessions } from '../api.js';
import { useLibrary } from '../queries.js';
import { AlertNote } from '../ui/Alert.js';
import { Button } from '../ui/Button.js';
import { CheckboxField, SelectField } from '../ui/Field.js';
import { link, page } from '../ui/classes.js';
import { Fine } from '../ui/Text.js';

/**
 * The list of sessions, and the control that makes a new one.
 *
 * ~~Deliberately the smallest thing that gets somebody to the play surface: no
 * cast picker, no mode picker, no preset picker.~~ **Half of that survived
 * [P6B.0] and half of it was the reason PLAYABLE could not run.**
 *
 * The reasoning was right about the cast — that surface is
 * [P7.2](../../../../docs/design/workplan/18-p7-implementation.md)'s and P7
 * turns `cast` into a channel — and wrong about everything a session
 * *retrieves* from. `POST /api/sessions` has accepted `treatment`, `lore` and
 * `preset` since P5.6; this form sent `name` alone, so no session made in the
 * browser ever resolved a lorebook, and the retrieval half of P5 was
 * unreachable from the product
 * ([P5 §0.5](../../../../docs/design/workplan/07-p5-implementation.md),
 * [P6B §0.1](../../../../docs/design/workplan/24-p6b-playable.md)).
 *
 * **The preset belongs here specifically**, because it is the one field with no
 * route to change it afterwards: a session copies its preset at creation
 * ([P4 §1.9](../../../../docs/design/workplan/06-p4-implementation.md)), so a
 * session started without one is permanently on the built-in default and an
 * imported preset is unplayable. Lore is changeable mid-session
 * (`LorePanel`); this is not.
 *
 * **Behind a disclosure**, so the fast path — a name and Start — is still one
 * line, and the summary says what the session will be given so the choice is
 * not silently skipped.
 */
export function SessionsPage(): React.JSX.Element {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [treatment, setTreatment] = useState('');
  const [preset, setPreset] = useState('');
  const [lore, setLore] = useState<string[]>([]);

  const sessions = useQuery({ queryKey: ['sessions'], queryFn: listSessions });
  const books = useLibrary('lorebooks');
  const treatments = useLibrary('treatments');
  const presets = useLibrary('presets');

  const create = useMutation({
    mutationFn: () =>
      createSession({
        name,
        ...(treatment === '' ? {} : { treatment }),
        ...(preset === '' ? {} : { preset }),
        ...(lore.length === 0 ? {} : { lore }),
      }),
    onSuccess: () => {
      setName('');
      setTreatment('');
      setPreset('');
      setLore([]);
      void queryClient.invalidateQueries({ queryKey: ['sessions'] });
    },
  });

  return (
    // A `div`, not a landmark — the shell owns the routed app's one `<main>`
    // ([P3.−1]); this page declared a second one inside it. The column is
    // `page.tooling`, not the reading measure it used to borrow: a
    // list-plus-form management page is tooling, and the reading measure is
    // the story column's ([05 §1.2]).
    <div className={`${page.tooling} flex flex-col gap-4`}>
      <h1 className="text-section text-ink">Sessions</h1>

      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim().length > 0) create.mutate();
        }}
      >
        <div className="flex gap-2">
          <label className="flex-1">
            <span className="sr-only">Name for the new session</span>
            <input
              className="w-full rounded-control border border-line-strong bg-surface p-2 text-ink placeholder:text-ink-faint focus-visible:outline-2 focus-visible:outline-focus"
              value={name}
              placeholder="A new session"
              onChange={(event) => {
                setName(event.target.value);
              }}
            />
          </label>
          <Button type="submit" variant="primary" disabled={create.isPending}>
            Start
          </Button>
        </div>

        <details className="rounded-control border border-line bg-surface px-3 py-2">
          <summary className="cursor-pointer text-sm text-ink-subtle">
            {setupLine(lore.length, treatment !== '', preset !== '')}
          </summary>

          <div className="mt-3 flex flex-col gap-3">
            <SelectField
              label="Treatment"
              value={treatment}
              options={[
                ['', 'None'],
                ...(treatments.data?.objects ?? []).map(
                  (one) => [one.id, one.name] as [string, string],
                ),
              ]}
              onChange={setTreatment}
              hint="A treatment brings its own lorebooks and its own framing."
            />

            <SelectField
              label="Preset"
              value={preset}
              options={[
                ['', "The mode's own"],
                ...(presets.data?.objects ?? []).map(
                  (one) => [one.id, one.name] as [string, string],
                ),
              ]}
              onChange={setPreset}
              hint="Copied into the session at creation, and not changeable afterwards."
            />

            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm font-medium text-ink-muted">Lorebooks</legend>
              {(books.data?.objects ?? []).map((book) => (
                <CheckboxField
                  key={book.id}
                  label={book.name}
                  checked={lore.includes(book.id)}
                  onChange={(checked) => {
                    setLore(checked ? [...lore, book.id] : lore.filter((id) => id !== book.id));
                  }}
                />
              ))}
            </fieldset>

            <Fine>These can be changed from the session itself, except the preset.</Fine>
          </div>
        </details>

        {create.isError ? <AlertNote role="alert">{create.error.message}</AlertNote> : null}
      </form>

      <ul className="flex flex-col gap-2" aria-label="Sessions">
        {(sessions.data?.sessions ?? []).map((session) => (
          <li key={session.id}>
            <Link to="/play/$sessionId" params={{ sessionId: session.id }} className={link.object}>
              {session.name}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * What the closed disclosure says the session will be given.
 *
 * One string rather than a sentence assembled around values in JSX, which is
 * the shape [07 §12.6a] forbids — and it is closed by default, so this line is
 * the only thing standing between somebody and a session that retrieves
 * nothing, which is the state every session was in before [P6B.0].
 */
export function setupLine(books: number, treatment: boolean, preset: boolean): string {
  const parts: string[] = [];
  if (treatment) parts.push('a treatment');
  if (books === 1) parts.push('one lorebook');
  if (books > 1) parts.push(`${String(books)} lorebooks`);
  if (preset) parts.push('a preset');
  if (parts.length === 0) return 'Nothing chosen yet — the mode default, and no lorebooks';
  return `With ${parts.join(', ')}`;
}
