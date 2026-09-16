// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { useMutation } from '@tanstack/react-query';
import { useState, type JSX } from 'react';

import { ApiError, rememberThis, type CastRow } from '../api.js';
import { useLibrary } from '../queries.js';
import { Button } from '../ui/Button.js';
import { Field } from '../ui/Field.js';
import { Fine } from '../ui/Text.js';

/**
 * ***Remember this*** — [08 §2.1](../../../../docs/design/08-cross-session-memory.md),
 * [P8 §5], [P8.3]'s cut form.
 *
 * **The one writer this phase ships, and [P8 §5] argues it is the right one to
 * keep.** That section reframes *whether extraction earns a model call at all*
 * as a question about the **extractor** rather than the summariser, and answers
 * it by naming what manual capture already is: *"nearly free, needs no model
 * call, and produces exactly the discrete facts §1.4 wants — authored by the
 * only judge who cannot be wrong about what mattered."*
 *
 * ***So the form is editable rather than confirmatory***, which is the whole
 * point rather than a nicety. A button that silently stored the message would be
 * an extractor with a human trigger, and would inherit the extractor's judgement
 * problem: [P8 §1.4]'s *facts, not summaries* is a decision somebody has to
 * make, and this is the surface where the person who was there makes it.
 *
 * **Keywords are prefilled and required.** An entry with no keys never
 * activates, so a capture that defaulted them to nothing would write a memory
 * that exists, is listed, is editable and can never reach a prompt — which is
 * the *my lorebook never fires* diagnosis arriving one surface too late.
 *
 * *The refusal is rendered rather than swallowed.* [P8.5]'s remainder is **a
 * refusal with a reason rather than a filter** — a turn a hook fired on may be
 * carrying an entrance, which is the finished prose of an arrival — and a
 * disabled button with no sentence would be that filter with better manners.
 */
export function RememberThis(props: {
  sessionId: string;
  turnId: string;
  /**
   * Whose memory it could be — **passed down rather than read here.**
   *
   * One of these is mounted per message, so a `useSession` inside would put a
   * subscription on every turn in the transcript; the page above already holds
   * the session and one read is the right number. *Caught by
   * `PlayPage.test.tsx`'s refetch guard*, which counts the session reads a
   * mounted page makes — a test written for a different bug and sensitive to
   * this one for the same underlying reason.
   */
  cast: readonly CastRow[];
  /** The turn's prose, which is what the text box opens on. */
  prose: string;
  busy: boolean;
}): JSX.Element | null {
  const actors = useLibrary('actors');
  const [open, setOpen] = useState(false);
  const [actorId, setActorId] = useState('');
  const [text, setText] = useState('');
  const [keys, setKeys] = useState('');

  const cast = props.cast;
  const nameOf = (id: string): string =>
    (actors.data?.objects ?? []).find((one) => one.id === id)?.name ?? id;

  const capture = useMutation({
    mutationFn: () =>
      rememberThis(props.sessionId, {
        turnId: props.turnId,
        actorId: actorId === '' ? (cast[0]?.actorId ?? '') : actorId,
        text,
        keys: keys
          .split(',')
          .map((key) => key.trim())
          .filter((key) => key !== ''),
      }),
    onSuccess: () => {
      setOpen(false);
      setText('');
      setKeys('');
    },
  });

  /**
   * **Nobody to remember it, no control.** A session with no cast has no memory
   * book to write into, and an offer that always refuses is worse than no offer
   * — the same judgement `suggest` makes about a step that would contribute
   * nothing.
   */
  if (cast.length === 0) return null;

  const chosen = actorId === '' ? (cast[0]?.actorId ?? '') : actorId;

  return (
    <>
      <Button
        type="button"
        disabled={props.busy}
        aria-expanded={open}
        onClick={() => {
          // Opening prefills from the message and the cast; closing forgets,
          // which is `Redo with guidance`'s rule one component over — a hidden
          // field still holding a draft is a draft nobody asked to send.
          if (!open) {
            setText(props.prose);
            setKeys(nameOf(cast[0]?.actorId ?? ''));
            setActorId(cast[0]?.actorId ?? '');
          }
          setOpen(!open);
          capture.reset();
        }}
      >
        Remember this
      </Button>

      {open ? (
        <div className="mt-2 flex w-full flex-col gap-3 rounded-control border border-line p-3">
          <Fine>
            Kept in this character’s memory book, and offered to later sessions with the same
            character and persona. Say it in your own words — what lands is what is in the box.
          </Fine>

          {cast.length > 1 ? (
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-ink-subtle">Whose memory</span>
              <select
                className="rounded-control border border-line bg-surface px-2 py-1 text-ink"
                value={chosen}
                onChange={(event) => {
                  setActorId(event.target.value);
                }}
              >
                {cast.map((row) => (
                  <option key={row.actorId} value={row.actorId}>
                    {nameOf(row.actorId)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <Field label="What to remember" value={text} onChange={setText} multiline required />
          <Field
            label="Keywords that bring it back, comma separated"
            value={keys}
            onChange={setKeys}
            required
          />

          {capture.isError ? (
            <p role="alert" className="text-sm text-warn-ink">
              {capture.error instanceof ApiError ? capture.error.message : 'That did not save.'}
            </p>
          ) : null}

          <div className="flex gap-2">
            <Button
              type="button"
              disabled={props.busy || capture.isPending || text.trim() === '' || keys.trim() === ''}
              onClick={() => {
                capture.mutate();
              }}
            >
              {capture.isPending ? 'Saving…' : 'Save to memories'}
            </Button>
            <Button
              type="button"
              onClick={() => {
                setOpen(false);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
    </>
  );
}
