// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { useRef, useState, type ReactNode } from 'react';

import { assistField } from '../api.js';
import type { AssistContract, AssistSubject } from '../ui/assist.js';
import { assistFailure, FieldAssist, supersededSentence } from './FieldAssist.js';
import type { EditorKind, ObjectEditor } from './object-editor.js';

/**
 * ***The slot every field in an editor gets*** —
 * [10 §11](../../../../docs/design/10-ui-surfaces.md),
 * [P11.2](../../../../docs/design/workplan/28-p11-implementation.md).
 *
 * This is the join: `ui/assist.tsx` says what a slot is, `FieldAssist` is the
 * control, `useObjectEditor` holds the provenance, and one call here hands the
 * frame a renderer that closes over all three. **Every editor gets assist by
 * being an editor** — which is §11's *"so that 'does this field have AI assist?'
 * is never a question anyone asks"*, and the reason this stage is one edit in
 * the frame rather than thirty at the fields.
 *
 * ***`before` is remembered here and never saved***, and the asymmetry with the
 * provenance map is the point. *Back to what the model wrote* has to survive a
 * reload, because it is about the field's history; *undo the assist* is about
 * the last thirty seconds and would be meaningless a day later — a button
 * offering to restore a value from a previous session is offering to lose work.
 * So one lives in the file and the other lives in a ref.
 *
 * *A ref rather than state*, because nothing renders from it: the panel reads
 * it at click time, and a `useState` here would re-render every field in the
 * form each time an assist ran on one of them.
 *
 * ***And the assist itself lives here too, per path*** (2026-09-27). It used to
 * live in `FieldAssist`, one mounted control, and a control is the wrong owner:
 * the lorebook editor reuses one control for every entry's field, so a running
 * assist showed *Writing…* on whichever entry was opened next, and a control
 * keyed by its path to stop that takes the running request's state away with
 * it. Here it outlives every field. Whether one is running and why one failed
 * are state, because the panel draws them — two renders of the form per assist,
 * which is the price of a *Writing…* that stays with its field.
 *
 * ***What an answer replaces is what the field held when it lands***, not what
 * it held at the click. *Undo the assist* returns to that — so what was typed
 * into the field while the model was writing is one click away, where it used
 * to be gone.
 */
export function useAssistFor<F>(
  descriptor: EditorKind<F>,
  editor: ObjectEditor<F>,
  /** What the object is, in the sentence the server builds — *actor*, *preset*. */
  kindWord: string,
): AssistContract {
  const before = useRef<Record<string, string>>({});
  /** What each field showed when it was last drawn, by path — see `FieldAssist`'s `onShown`. */
  const shown = useRef<Record<string, string>>({});
  const [running, setRunning] = useState<ReadonlySet<string>>(() => new Set());
  const [failures, setFailures] = useState<ReadonlyMap<string, string>>(() => new Map());

  function run(subject: AssistSubject, guidance: string): void {
    const { path } = subject;
    const startedAt = editor.replacements();
    setRunning((was) => new Set(was).add(path));
    setFailures((was) => withoutKey(was, path));
    assistField({
      subject: kindWord,
      path,
      label: subject.label,
      /**
       * ***Read at click time, not captured.*** The draft is what the person is
       * looking at, and [10 §11.1] is emphatic that context is what makes the
       * difference between assist and slop — a value closed over when the slot
       * was built would be the form as it was when the field first rendered,
       * which on a long form is several minutes of typing ago.
       */
      draft: descriptor.apply(editor.base.object, editor.form),
      ...(guidance.trim() === '' ? {} : { guidance, current: subject.value }),
    }).then(
      (result) => {
        setRunning((was) => withoutMember(was, path));
        // Written for a form a restore has since replaced, so not put in: see
        // `ObjectEditor.replacements`.
        if (editor.replacements() !== startedAt) {
          setFailures((was) => new Map(was).set(path, supersededSentence()));
          return;
        }
        const wasBefore = shown.current[path] ?? subject.value;
        subject.onChange(result.text);
        before.current = { ...before.current, [path]: wasBefore };
        editor.recordGenerated(path, {
          original: result.text,
          at: new Date().toISOString(),
          model: result.model,
          seed: result.seed,
          // **True until somebody looks at it**, which is the whole of what the
          // flag is for: [10 §11.2]'s *"a library-wide view of what is authored
          // and what is machine-written"* is only worth having if *machine-
          // written and unread* is distinguishable from *machine-written and
          // kept on purpose*.
          unreviewed: true,
        });
      },
      (failure: unknown) => {
        setRunning((was) => withoutMember(was, path));
        /**
         * **A class into a sentence, on this side rather than on the wire** —
         * [22 §1.4], and the same split [P11.6] made for a failed turn: the
         * server sends `not-bound`, the client owns the words, and the remedy
         * is the one thing a person can act on.
         */
        setFailures((was) => new Map(was).set(path, assistFailure(failure)));
      },
    );
  }

  const slot = (subject: AssistSubject): ReactNode => (
    <FieldAssist
      // One control per field, never one moved from field to field: see the
      // docstring above.
      key={subject.path}
      subject={subject}
      busy={running.has(subject.path)}
      error={failures.get(subject.path) ?? null}
      history={{
        before: before.current[subject.path] ?? null,
        generated: editor.generatedAt(subject.path)?.original ?? null,
      }}
      onRun={(guidance) => {
        run(subject, guidance);
      }}
      onReverted={(to: string) => {
        subject.onChange(to);
      }}
      onShown={(value) => {
        shown.current[subject.path] = value;
      }}
    />
  );

  return { slot, onEdited: editor.markReviewed };
}

function withoutMember(set: ReadonlySet<string>, member: string): ReadonlySet<string> {
  const next = new Set(set);
  next.delete(member);
  return next;
}

function withoutKey(map: ReadonlyMap<string, string>, key: string): ReadonlyMap<string, string> {
  if (!map.has(key)) return map;
  const next = new Map(map);
  next.delete(key);
  return next;
}
