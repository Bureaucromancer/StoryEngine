// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { useRef, type ReactNode } from 'react';

import type { AssistFieldResult } from '../api.js';
import type { AssistContract, AssistSubject } from '../ui/assist.js';
import { FieldAssist } from './FieldAssist.js';
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
 */
export function useAssistFor<F>(
  descriptor: EditorKind<F>,
  editor: ObjectEditor<F>,
  /** What the object is, in the sentence the server builds — *actor*, *preset*. */
  kindWord: string,
): AssistContract {
  const before = useRef<Record<string, string>>({});

  const slot = (subject: AssistSubject): ReactNode => (
    <FieldAssist
      subject={subject}
      kindWord={kindWord}
      /**
       * ***Read at click time, not captured.*** The draft is what the person is
       * looking at, and [10 §11.1] is emphatic that context is what makes the
       * difference between assist and slop — a value closed over when the slot
       * was built would be the form as it was when the field first rendered,
       * which on a long form is several minutes of typing ago.
       */
      draftOf={() => descriptor.apply(editor.base.object, editor.form)}
      history={{
        before: before.current[subject.path] ?? null,
        generated: editor.generatedAt(subject.path)?.original ?? null,
      }}
      onAccepted={(result: AssistFieldResult, wasBefore: string) => {
        before.current = { ...before.current, [subject.path]: wasBefore };
        editor.recordGenerated(subject.path, {
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
      }}
      onReverted={(to: string) => {
        subject.onChange(to);
      }}
    />
  );

  return { slot, onEdited: editor.markReviewed };
}
