// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { useRef, type JSX, type KeyboardEvent } from 'react';

import { labels } from '../i18n/catalogue.js';

/**
 * What kind of thing the player is about to do —
 * [06 §1](../../../../docs/design/06-modes-and-turn-pipeline.md),
 * [13 §8.3](../../../../docs/design/13-write-mode.md), built at
 * [P7.9](../../../../docs/design/workplan/23-p7-implementation.md).
 *
 * ***The surface `ModeDefinition.inputs` has been waiting for since P2.***
 * [P7 §0.1a] lists this among four instances of *declared configuration with no
 * surface*, which [work plan §2.3] says no phase may exit with — and this is the
 * phase that owns it. The declaration existed, the wire field existed, the route
 * defaulted it to `do`, and nothing could set it.
 *
 * ***Nothing for a mode with one kind, and that is not an empty state.*** Scene
 * declares `inputs: ['do']`: there is no choice to make, and a selector offering
 * one option would be a control that cannot do anything. The kinds are the
 * *mode's*, so whether this renders is a fact about the session rather than a
 * layout preference.
 *
 * **Buttons rather than a select, because the choice is part of composing.** A
 * player deciding between *say* and *do* is deciding what they are writing, not
 * configuring the session — and a select hides the alternatives behind a click
 * at the moment they are the question. Four fit on a phone at this size; a mode
 * that declares more gets a row that wraps, which is the same trade the hook
 * panel's controls make.
 *
 * *The labels are the client's and the ids are the mode's*, which is [01 §2]'s
 * line — English the **server** sends is a key, English a **browser** renders is
 * a translation. A kind this build has no word for renders as its id, because a
 * mode may declare one and a client that hid it would hide a capability.
 */

/**
 * ***Flat and dotted, where every other table in the sweep is one word per
 * class*** — [P11.8], and this is the one map that had to change shape to join
 * the catalogue.
 *
 * A kind carries **three** strings, so the obvious literal is
 * `Record<string, { label, hint, placeholder }>` — which is what this was. A
 * catalogue of nested objects is a worse thing to hand a translator than a
 * catalogue of strings: the file they edit stops being key-to-sentence, the
 * fallback stops being per *key* and becomes per *kind* (translate `do.label`
 * and you have silently un-translated `do.hint`), and the build-time check that
 * a namespace's keys and its English agree has to learn a second shape.
 * [20 §12.2]'s *explicit hierarchical keys* is exactly this: the hierarchy goes
 * in the key, not in the value.
 *
 * *So `do.label` rather than `do: { label }`*, and the three readers below spell
 * the suffix. The mode-agnostic fallbacks stay in the table too — a placeholder
 * shown when the mode declares no kind is still a sentence a browser renders.
 */
const WORDS: Readonly<Record<string, string>> = labels('play.input-kind', {
  'do.label': 'Do',
  'do.hint': 'Act',
  'do.placeholder': 'What do you do?',
  'say.label': 'Say',
  'say.hint': 'Speak aloud',
  'say.placeholder': 'What do you say?',
  // *Nobody heard that* is the whole content of the kind, and it is the one
  // a player is most likely to get wrong by assuming it is the same as `say`.
  'think.label': 'Think',
  'think.hint': 'Nobody hears this',
  'think.placeholder': 'What do you think?',
  'story.label': 'Story',
  'story.hint': 'Write it yourself',
  'story.placeholder': 'What happens?',
  'choice.label': 'Choose',
  'choice.hint': 'Pick an offered action',
  'choice.placeholder': 'Which one?',
  fallback: 'What do you do?',
});

/** The placeholder that belongs to a kind, or the mode-agnostic one. */
export function promptFor(kind: string | undefined): string {
  const named = kind === undefined ? undefined : WORDS[`${kind}.placeholder`];
  /**
   * *The last `??` is unreachable and is written anyway.* `fallback` is in the
   * table two lines up, but the table is typed open — a mode may declare a kind
   * this build has no word for, which is the whole reason the lookup takes an
   * arbitrary string — and `noUncheckedIndexedAccess` cannot know which of an
   * open record's keys are really there. The alternative is a non-null
   * assertion, which is the thing eslint forbids here and rightly: an assertion
   * says *trust me* about a table somebody will edit.
   */
  return named ?? WORDS['fallback'] ?? 'What do you do?';
}

/**
 * ***A radio group moves on its arrows*** (2026-10-01, polish 11).
 *
 * `role="radio"` promises the keyboard a radio group answers to, and this one
 * answered to none of it: every kind was its own Tab stop — five presses to get
 * past the row to the box it labels — and the arrows did nothing. Now the group
 * is one stop, the chosen kind (the first, before one is chosen), and the
 * arrows move the choice through it, wrapping at the ends, with Home and End
 * for the ends themselves — the pattern a native radio group has and a
 * screen reader announces this one as.
 *
 * *Choosing as it moves*, as native radios do: what a kind changes is the
 * composer's placeholder and the move's kind, nothing sent, so there is
 * nothing for an arrow to commit early.
 */
const NEXT: Readonly<Record<string, 1 | -1>> = {
  ArrowRight: 1,
  ArrowDown: 1,
  ArrowLeft: -1,
  ArrowUp: -1,
};

export function InputKind(props: {
  kinds: readonly string[];
  value: string | undefined;
  disabled?: boolean;
  onChange: (kind: string) => void;
}): JSX.Element | null {
  const group = useRef<HTMLDivElement>(null);
  if (props.kinds.length < 2) return null;

  const chosen = props.kinds.indexOf(props.value ?? '');
  /** The group's one Tab stop: the chosen kind, or the first before one is. */
  const stop = chosen === -1 ? 0 : chosen;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (props.disabled === true) return;
    const count = props.kinds.length;
    const step = NEXT[event.key];
    const to =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? count - 1
          : step === undefined
            ? null
            : (stop + step + count) % count;
    if (to === null) return;
    event.preventDefault();
    const kind = props.kinds[to];
    if (kind === undefined) return;
    props.onChange(kind);
    group.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[to]?.focus();
  };

  return (
    <div
      ref={group}
      className="flex flex-wrap gap-1"
      role="radiogroup"
      aria-label="What kind of turn"
      onKeyDown={onKeyDown}
    >
      {props.kinds.map((kind, index) => {
        const hint = WORDS[`${kind}.hint`];
        const label = WORDS[`${kind}.label`];
        const selected = kind === props.value;
        return (
          <button
            key={kind}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={index === stop ? 0 : -1}
            disabled={props.disabled ?? false}
            title={hint ?? kind}
            className={[
              'rounded-control border px-2 py-1 text-sm',
              selected ? 'border-line bg-accent text-on-accent' : 'border-line text-ink-muted',
            ].join(' ')}
            onClick={() => {
              props.onChange(kind);
            }}
          >
            {label ?? kind}
          </button>
        );
      })}
    </div>
  );
}
