// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { JSX } from 'react';

import type { FieldWidget, ModeSetup, SetupField } from '../api.js';
import { AlertNote } from '../ui/Alert.js';
import { CheckboxField, Field, SelectField } from '../ui/Field.js';

/**
 * A mode's wizard, rendered from its declaration and from nothing else —
 * [06 §7.3](../../../../docs/design/06-modes-and-turn-pipeline.md),
 * [10 §8](../../../../docs/design/10-ui-surfaces.md), built at
 * [P7.4](../../../../docs/design/workplan/23-p7-implementation.md).
 *
 * **The whole point is what this component does not know.** It has never heard
 * of Scene, or of difficulty, or of any field any mode declares; it knows three
 * widget kinds and a loop. [06 §2] says a mode needing a back door means the
 * contract is wrong and gets fixed rather than bypassed, and a setup form is
 * where that is most tempting — every engine grows a mode-specific screen
 * eventually. This is the stage's exit line as a component: *a wizard for a mode
 * the engine has no knowledge of, rendered from its declaration alone*.
 *
 * **Declared, never shipped** ([10 §8]). A mode hands over a vocabulary term and
 * the host draws the control, which buys three things that section names: an
 * extension cannot break the app's rendering, the frontend framework stays a
 * reversible decision, and a mode written today still works after a framework
 * upgrade. The paired commitment is that the vocabulary keeps growing — *"when
 * an extension cannot express something, the first response is to ask what
 * widget would let it… and add that"* — and that there is never an
 * `html: string` field, which 10 §8 calls *"how this decision would be undone by
 * accident rather than on purpose"*.
 *
 * **It validates nothing.** The server checks the answers against a schema
 * derived from the same declaration, and a second check written here would be a
 * second description of the same rule — which is exactly what carrying no
 * per-field schema was meant to avoid. What this does is *ask*; the refusal, and
 * the words for it, come back from the route.
 *
 * *No `disabled` while the form submits, which matches the rest of the form it
 * sits in: what stops a double submit is the Start button, and disabling the
 * inputs as well would be a second guard that has to be remembered per field.
 * An earlier draft passed `readOnly` to `Field`, which has no such prop and
 * silently dropped it — a no-op that reads as a guard.*
 */
export function SetupFields(props: {
  setup: ModeSetup;
  answers: Record<string, unknown>;
  onChange: (answers: Record<string, unknown>) => void;
}): JSX.Element | null {
  if (props.setup.kind !== 'declared') return null;
  const fields = (props.setup as { fields?: SetupField[] }).fields ?? [];
  if (fields.length === 0) return null;

  function set(id: string, value: unknown): void {
    /**
     * **A cleared field is removed, not set to `""`.** The derived schema has no
     * `minLength`, so an empty string satisfies a required field — and a person
     * who typed and then deleted has answered nothing, which is what the absent
     * key says. It is also what makes *required* refuse at the route rather than
     * pass with a blank.
     *
     * *Rebuilt rather than deleted from, because `delete` on a computed key is a
     * lint error here — and filtering says the same thing more plainly: the
     * document is every field this person has answered.*
     */
    const kept = Object.entries(props.answers).filter(([each]) => each !== id);
    props.onChange(
      value === undefined || value === ''
        ? Object.fromEntries(kept)
        : Object.fromEntries([...kept, [id, value]]),
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {fields.map((field) => (
        <SetupControl
          key={field.id}
          field={field}
          value={props.answers[field.id]}
          onChange={(value) => {
            set(field.id, value);
          }}
        />
      ))}
    </div>
  );
}

function SetupControl(props: {
  field: SetupField;
  value: unknown;
  onChange: (value: unknown) => void;
}): JSX.Element {
  const { widget } = props.field;
  const required = props.field.required === true;

  switch (widget.kind) {
    case 'text':
      return (
        <Field
          label={widget.label}
          value={typeof props.value === 'string' ? props.value : ''}
          onChange={props.onChange}
          required={required}
          // `lines` is the declaration's, and more than one of them is what
          // makes this a textarea. Presentation, and legitimately so: a form
          // declaration is presentation by definition, where a *portable*
          // schema may not carry a rendering hint ([11 §4]).
          {...(linesOf(widget) > 1 ? { multiline: true, rows: linesOf(widget) } : {})}
          {...(widget.hint === undefined ? {} : { hint: widget.hint })}
        />
      );

    case 'choice':
      return (
        <SelectField
          label={widget.label}
          value={typeof props.value === 'string' ? props.value : ''}
          /**
           * **An empty first option, and only when the field is optional.** A
           * select with no empty option has already answered for the person the
           * moment it renders, which for a *required* field is what you want —
           * there is no *unanswered* state to represent — and for an optional
           * one is a value nobody chose.
           */
          options={[
            ...(required ? [] : ([['', 'Not set']] as [string, string][])),
            ...optionsOf(widget).map((option) => [option.value, option.label] as [string, string]),
          ]}
          onChange={props.onChange}
          {...(widget.hint === undefined ? {} : { hint: widget.hint })}
        />
      );

    case 'toggle':
      return (
        <CheckboxField
          label={widget.label}
          checked={props.value === true}
          onChange={props.onChange}
          {...(widget.hint === undefined ? {} : { hint: widget.hint })}
        />
      );

    default:
      /**
       * **A widget this build has never heard of** — said out loud rather than
       * skipped.
       *
       * The vocabulary is additive: *"a declaration naming a `kind` the host
       * does not know is one the host can ignore rather than one that breaks
       * it"*. Ignoring it silently is the wrong half of that, though — if the
       * field is required, the form can never be completed and the route's
       * refusal would name a field nobody was shown. Naming it turns an
       * unexplainable failure into *this install is older than this mode*.
       */
      return (
        <AlertNote tone="warning">
          {`This version cannot ask for "${widget.label}". Update StoryEngine, or start this session without it.`}
        </AlertNote>
      );
  }
}

/** Absent means one line, which is the single-line input. */
function linesOf(widget: FieldWidget): number {
  return 'lines' in widget && typeof widget.lines === 'number' ? widget.lines : 1;
}

function optionsOf(widget: FieldWidget): { value: string; label: string }[] {
  return 'options' in widget && Array.isArray(widget.options) ? widget.options : [];
}
