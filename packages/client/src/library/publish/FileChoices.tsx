// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { useId, type JSX } from 'react';

import type { FileSet, PublishOrigin } from '@storyengine/shared';

import { megabytes } from '../../format.js';
import { control } from '../../ui/classes.js';
import { Note } from '../../ui/Text.js';
import { historyAdds } from './model.js';
import { Tick } from './Tick.js';
import { countPhrase, WORDS } from './words.js';

/**
 * ***History is opt-in, and the review says which it is doing*** —
 * [16 §5](../../../../../docs/design/16-publish.md),
 * [03 §11.6](../../../../../docs/design/03-data-model.md): the toggle carries
 * §11.6's own sentence, *a working record — the false starts, the abandoned
 * phrasings — that people do not necessarily intend to publish*, and what it
 * would add, measured over what is ticked now (the preview measures history as
 * though asked for, so this moves with the ticks).
 */
export function HistoryChoice(props: {
  set: FileSet;
  history: boolean;
  onChange: (history: boolean) => void;
}): JSX.Element {
  const adds = historyAdds(props.set);
  const line =
    adds.versions === 0
      ? WORDS.historyNone
      : countPhrase(WORDS.historyOne, WORDS.historyMany, adds.versions).replace(
          '{size}',
          megabytes(adds.bytes),
        );
  return (
    <div className="mb-6 flex flex-col gap-1">
      <Tick
        label={WORDS.historyLabel}
        hint={WORDS.historyHint}
        checked={props.history}
        onChange={props.onChange}
      />
      <Note className="ms-6">{line}</Note>
    </div>
  );
}

/**
 * ***What publishing keeps*** — [16 §3](../../../../../docs/design/16-publish.md),
 * [16 §2](../../../../../docs/design/16-publish.md), [P16.3g].
 *
 * **Said for every start, and chosen for one.** A selection of two or more is
 * kept as a World unless the person takes the snapshot — *"offered as a choice
 * in the review rather than inferred"*, and keeping is the default, because a
 * World nobody opens again is cheap and §8's first test says whether that was
 * right. *What you leave out above leaves the file, not the world*: the kept
 * World holds the selection, unticked rows included ([P16.3]'s plan, §3), so
 * the World is the set and the file is this one sending of it.
 *
 * A World start keeps nothing new — *publishing again makes a new file; the
 * world stays one world* — and one object keeps nothing ([16 §2]). Both are
 * said rather than left out, so nobody looks for the choice and wonders.
 */
export function KeepChoice(props: {
  origin: PublishOrigin;
  /**
   * The chosen things that are there — what the kept World will hold
   * (`selectedEnvelopes` skips an id that resolved to nothing). *2026-10-11,
   * the P16.3g review*: ~~the selection's roots~~, which counted a deleted one.
   */
  count: number;
  keep: 'world' | 'snapshot';
  name: string;
  onKeep: (keep: 'world' | 'snapshot') => void;
  onName: (name: string) => void;
}): JSX.Element {
  const group = useId();
  if (props.origin === 'world') return <Note className="mb-6">{WORDS.keepWorldStart}</Note>;
  if (props.origin === 'object') return <Note className="mb-6">{WORDS.keepObject}</Note>;
  return (
    <fieldset className="mb-6 flex min-w-0 flex-col gap-2">
      <legend className="mb-1 text-sm font-medium text-ink-muted">{WORDS.keepLegend}</legend>
      <label className="flex min-w-0 flex-wrap items-center gap-2 text-sm text-ink">
        <input
          type="radio"
          name={group}
          checked={props.keep === 'world'}
          onChange={() => {
            props.onKeep('world');
          }}
        />
        <span>{countPhrase(WORDS.keepWorldOne, WORDS.keepWorld, props.count)}</span>
      </label>
      {/* Padded rather than margined: the control is `w-full`, and a margin
          beside a full width is the sideways scroll AA14 refuses at 280 px. */}
      <div className="ps-6">
        <input
          type="text"
          aria-label={WORDS.keepName}
          className={control}
          value={props.name}
          maxLength={200}
          disabled={props.keep !== 'world'}
          onChange={(event) => {
            props.onName(event.target.value);
          }}
        />
      </div>
      {props.keep === 'world' && props.name.trim() === '' ? (
        <Note className="ms-6">{WORDS.nameNeeded}</Note>
      ) : null}
      <label className="flex items-center gap-2 text-sm text-ink">
        <input
          type="radio"
          name={group}
          checked={props.keep === 'snapshot'}
          onChange={() => {
            props.onKeep('snapshot');
          }}
        />
        <span>{WORDS.keepSnapshot}</span>
      </label>
      <Note>{WORDS.keepHint}</Note>
    </fieldset>
  );
}
