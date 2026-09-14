// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { JSX } from 'react';

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

const WORDS: Record<string, { label: string; hint: string; placeholder: string }> = {
  do: { label: 'Do', hint: 'Act', placeholder: 'What do you do?' },
  say: { label: 'Say', hint: 'Speak aloud', placeholder: 'What do you say?' },
  // *Nobody heard that* is the whole content of the kind, and it is the one
  // a player is most likely to get wrong by assuming it is the same as `say`.
  think: { label: 'Think', hint: 'Nobody hears this', placeholder: 'What do you think?' },
  story: { label: 'Story', hint: 'Write it yourself', placeholder: 'What happens?' },
  choice: { label: 'Choose', hint: 'Pick an offered action', placeholder: 'Which one?' },
};

/** The placeholder that belongs to a kind, or the mode-agnostic one. */
export function promptFor(kind: string | undefined): string {
  return (kind === undefined ? undefined : WORDS[kind]?.placeholder) ?? 'What do you do?';
}

export function InputKind(props: {
  kinds: readonly string[];
  value: string | undefined;
  disabled?: boolean;
  onChange: (kind: string) => void;
}): JSX.Element | null {
  if (props.kinds.length < 2) return null;

  return (
    <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="What kind of turn">
      {props.kinds.map((kind) => {
        const words = WORDS[kind];
        const selected = kind === props.value;
        return (
          <button
            key={kind}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={props.disabled ?? false}
            title={words?.hint ?? kind}
            className={[
              'rounded-control border px-2 py-1 text-sm',
              selected ? 'border-line bg-accent text-on-accent' : 'border-line text-ink-muted',
            ].join(' ')}
            onClick={() => {
              props.onChange(kind);
            }}
          >
            {words?.label ?? kind}
          </button>
        );
      })}
    </div>
  );
}
