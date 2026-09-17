// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { createContext, useContext, type JSX, type ReactNode } from 'react';

/**
 * ***The assist slot, filled*** —
 * [10 §11](../../../../docs/design/10-ui-surfaces.md),
 * [P11.2](../../../../docs/design/workplan/28-p11-implementation.md).
 *
 * `Field` has carried an empty slot since P1, with its own docstring saying
 * why: *"What P1 commits to is this component boundary, not the assist
 * mechanism."* This is the mechanism arriving, and the boundary is what makes
 * it one edit rather than thirty.
 *
 * ***A context rather than a prop, and that is [10 §11]'s sentence read
 * literally.*** The section's whole argument is that assist must be *"a
 * primitive the editors are built from, so that 'does this field have AI
 * assist?' is never a question anyone asks"* — and a prop is exactly that
 * question, asked once per call site, answered by whoever was typing. A context
 * inverts it: **a field inside an editor has assist; a field outside one does
 * not**, and neither fact is a decision anybody makes per field.
 *
 * *The counterpart is that a field has to say what it is.* {@link FieldProps}'s
 * `path` is the dotted key the provenance map is keyed by ([10 §11.2]), and a
 * field with no path gets no assist — which is the right default for the two
 * kinds of field that should never have one: a password, and a control whose
 * value is not the author's prose.
 *
 * ***Declared here rather than in `editor/`, and it is not filing.*** `Field`
 * lives in `ui/` and may not import from `editor/` — that is the dependency
 * direction the whole component layer rests on. So the **shape** of the slot is
 * a `ui` concern and the **control** that fills it is the editor's, which is
 * also the honest description: a text field knows that something may be offered
 * beside its label, and knows nothing about models.
 */
export interface AssistSubject {
  /** The dotted path, which is the key in the object's `generated` map. */
  path: string;
  /** What the field is called, in the author's language. */
  label: string;
  value: string;
  onChange: (next: string) => void;
  /** Whether the control is a textarea, which decides how much to ask for. */
  multiline: boolean;
}

/** What an editor provides: a renderer for one field's assist control. */
export type AssistSlot = (subject: AssistSubject) => ReactNode;

export interface AssistContract {
  slot: AssistSlot;
  /**
   * ***A person typed in this field*** — [10 §11.2], [P11.2].
   *
   * The provenance record's `unreviewed` flag is what makes *"which of these
   * characters did I actually write?"* answerable, and it can only be cleared
   * by the one event that means somebody looked: an edit. **It cannot be a
   * form-wide diff**, because a diff cannot tell a hand edit from a restore, a
   * reapply or a revert — all three of which change the value and none of which
   * is a person reviewing the words.
   *
   * *So it rides with the slot rather than beside it*: the same context that
   * knows a field has a path is the one that can be told the path changed.
   */
  onEdited: (path: string) => void;
}

const Contract = createContext<AssistContract | null>(null);

export function AssistProvider(props: {
  contract: AssistContract;
  children: ReactNode;
}): JSX.Element {
  return <Contract.Provider value={props.contract}>{props.children}</Contract.Provider>;
}

/** What an editor offers a field, or null outside one. */
export function useAssistContract(): AssistContract | null {
  return useContext(Contract);
}
