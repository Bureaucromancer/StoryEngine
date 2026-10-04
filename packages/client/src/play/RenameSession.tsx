// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { useEffect, useRef, useState } from 'react';

import { useRenameSession } from '../queries.js';
import { AlertNote } from '../ui/Alert.js';
import { Button } from '../ui/Button.js';
import { Field } from '../ui/Field.js';
import { sessionLabel } from './session-label.js';
import { useFocusOnReveal } from '../ui/useFocusOnReveal.js';

/**
 * Naming a session, wherever one is shown — [03 §8](../../../../docs/design/03-data-model.md).
 *
 * **One control rendered twice, rather than two rename forms.** It belongs in
 * the list, which is where a column of *Untitled session* is actually noticed
 * and where somebody triaging several of them is looking; and it belongs beside
 * the play heading, because the moment you know what a session should be called
 * is right after playing the session you did not name. Two bespoke half-forms
 * would also start to be the session-settings surface that
 * [P6B §4](../../../../docs/design/workplan/20-p6b-playable.md) puts inside P7.2's scope,
 * and one shared control deliberately is not.
 *
 * **The box opens on the stored name, not on the displayed label.** For an
 * unnamed session the stored name is `''`, so the field opens empty. Seeding it
 * with *Untitled session* would be how a placeholder becomes somebody's actual
 * session name the first time they press Save without reading it.
 *
 * Not required, and an empty name is not refused: clearing a name puts a
 * session back in the state it may have started in, and a rule that let you
 * never name a session but never un-name one would be arbitrary in a way
 * somebody would have to discover.
 */
export function RenameSession(props: { sessionId: string; name: string }): React.JSX.Element {
  const [draft, setDraft] = useState<string | null>(null);
  const rename = useRenameSession(props.sessionId);
  /**
   * ***The keyboard goes with the prompt, and comes back*** (2026-10-01,
   * polish 10). *Rename* is replaced by the prompt it opens, so focus fell to
   * the page twice: when the prompt opened, and when Save or Cancel closed it
   * and took the focused button with it.
   */
  const form = useFocusOnReveal<HTMLFormElement>(draft !== null);
  const button = useRef<HTMLButtonElement>(null);
  const returning = useRef(false);
  useEffect(() => {
    if (draft !== null || !returning.current) return;
    returning.current = false;
    button.current?.focus();
  }, [draft]);
  const close = (): void => {
    returning.current = true;
    setDraft(null);
  };

  if (draft === null) {
    return (
      <Button
        ref={button}
        type="button"
        variant="quiet"
        size="tiny"
        aria-label={renameLabel(props.name)}
        onClick={() => {
          setDraft(props.name);
        }}
      >
        Rename
      </Button>
    );
  }

  return (
    <form
      ref={form}
      className="flex items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        rename.mutate(draft.trim(), {
          onSuccess: close,
        });
      }}
    >
      <Field label="Session name" value={draft} onChange={setDraft} />
      <Button type="submit" variant="primary" size="tiny" disabled={rename.isPending}>
        Save
      </Button>
      <Button type="button" variant="quiet" size="tiny" onClick={close}>
        Cancel
      </Button>
      {rename.isError ? <AlertNote role="alert">{rename.error.message}</AlertNote> : null}
    </form>
  );
}

/**
 * The button's whole accessible name, built here rather than in the JSX — a
 * sentence assembled from children is the shape [20 §12.6a] forbids.
 *
 * A list of *Rename* buttons that all say *Rename* is a list nobody can
 * navigate by name, so each one carries the session it acts on. Several unnamed
 * sessions do still collide, and that is the honest answer rather than a gap:
 * the buttons are as distinguishable as the rows they sit in, which is the most
 * a label can promise when the underlying things genuinely have no names yet.
 */
export function renameLabel(name: string): string {
  return `Rename ${sessionLabel(name)}`;
}
