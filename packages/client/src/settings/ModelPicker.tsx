// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { useId, useMemo, useState, type JSX } from 'react';

import type { ModelModalities } from '../api.js';
import { Button } from '../ui/Button.js';
import { CheckboxField } from '../ui/Field.js';
import { control, fieldLabel } from '../ui/classes.js';
import { Fine } from '../ui/Text.js';
import {
  NO_FILTER,
  filterOffered,
  hiddenUnknown,
  isFiltering,
  modalityLabel,
  modalityWords,
  type ModelFilter,
} from './modelFilter.js';

/**
 * ***What the endpoint offers, as a list you can find things in*** — the
 * connection form's picker, refined 2026-10-25 for the providers that made the
 * flat list unusable.
 *
 * [R2](../../../../docs/design/workplan/22-walkthrough-refinements.md) turned
 * one-at-a-time buttons into a checkbox per model with an all-or-none pair, which
 * is right for a local runtime serving nine models and hopeless for an
 * aggregator serving four hundred: the one model somebody wants is a long scroll
 * down a single alphabetical column, and *Use all of them* provisions a list no
 * role picker can be used with either. So, in order of how often each is the
 * thing that helps:
 *
 * - **A search box**, every word in any order, because an aggregator's ids are
 *   `vendor/family-size-variant` and people remember two of the pieces.
 * - **Modality filters, only when the endpoint said anything** — *what goes in*
 *   and *what comes back*, built from the words the endpoint used. OpenAI's own
 *   `/models` carries nothing but ids, and a row of boxes that can only ever
 *   empty the list would be a control that lies about what it knows.
 * - ***Ticked only***, because reviewing a selection of thirty out of four
 *   hundred is otherwise the same scroll.
 * - **The all-or-none pair acts on what is shown** once anything narrows the
 *   list — *tick these twelve* is the gesture a search sets up, and *use all of
 *   them* sitting under a filtered list would read as *all of these* and then
 *   take four hundred.
 *
 * **The text field stays the value** ([P2B §2.6]), so nothing here keeps a
 * second list: `chosen` is read from the field and every change goes back
 * through `onChoose`. A model typed by hand that the endpoint does not list is
 * never touched by a filtered tick or untick, because it is never shown.
 *
 * *Filter state is this component's own and is not saved.* It is how somebody
 * looks at a list on one visit, not a fact about the connection.
 */
export function ModelPicker({
  offered,
  modalities,
  chosen,
  onChoose,
}: {
  offered: readonly string[];
  modalities: readonly ModelModalities[] | undefined;
  chosen: readonly string[];
  onChoose: (models: string[]) => void;
}): JSX.Element {
  const searchId = useId();
  const [filter, setFilter] = useState<ModelFilter>(NO_FILTER);

  const known = useMemo(
    () => new Map((modalities ?? []).map((each) => [each.id, each] as const)),
    [modalities],
  );
  const words = useMemo(() => modalityWords(known.values()), [known]);
  const shown = filterOffered(offered, known, chosen, filter);
  const unknownHidden = hiddenUnknown(offered, known, chosen, filter);
  const filtering = isFiltering(filter);
  const tickedHere = offered.filter((model) => chosen.includes(model)).length;

  function toggleWord(row: 'takes' | 'gives', word: string, on: boolean): void {
    setFilter((held) => ({
      ...held,
      [row]: on
        ? [...held[row].filter((each) => each !== word), word]
        : held[row].filter((each) => each !== word),
    }));
  }

  return (
    <div className="flex flex-col gap-2">
      <Fine>{offeredCount(offered.length)}</Fine>

      <div>
        <label htmlFor={searchId} className={fieldLabel}>
          Find a model
        </label>
        <input
          id={searchId}
          type="search"
          className={control}
          value={filter.query}
          placeholder="Part of a name — llama 70b, claude, vision"
          onChange={(event) => {
            const query = event.target.value;
            setFilter((held) => ({ ...held, query }));
          }}
          onKeyDown={(event) => {
            // Enter in a search box means *search*, and this one searches as it
            // is typed — inside the connection form, Enter would otherwise be
            // Save, which is the last thing somebody narrowing a list meant.
            if (event.key === 'Enter') event.preventDefault();
          }}
        />
      </div>

      {words.input.length === 0 && words.output.length === 0 ? null : (
        <div className="flex flex-col gap-2">
          <ModalityRow
            legend="Takes in"
            suffix="in"
            words={words.input}
            held={filter.takes}
            onToggle={(word, on) => {
              toggleWord('takes', word, on);
            }}
          />
          <ModalityRow
            legend="Gives back"
            suffix="out"
            words={words.output}
            held={filter.gives}
            onToggle={(word, on) => {
              toggleWord('gives', word, on);
            }}
          />
        </div>
      )}

      <CheckboxField
        label={`Only the ticked ones (${String(tickedHere)})`}
        checked={filter.tickedOnly}
        onChange={(on) => {
          setFilter((held) => ({ ...held, tickedOnly: on }));
        }}
      />

      {filtering ? (
        <p role="status" className="text-sm text-ink-subtle">
          {shownLine(shown.length, offered.length)}
          {unknownHidden === 0 ? null : ` ${unknownLine(unknownHidden)}`}
        </p>
      ) : null}

      {/*
       * **Held to a height and scrolled inside**, because a list of four
       * hundred pushed the rest of the form — the capabilities and the Save
       * strip — a long way below everything a person was deciding about.
       */}
      {shown.length === 0 ? null : (
        <ul className="flex max-h-80 flex-col gap-1 overflow-y-auto rounded-control border border-line p-2">
          {shown.map((model) => (
            <li key={model}>
              <CheckboxField
                label={model}
                checked={chosen.includes(model)}
                onChange={(on) => {
                  onChoose(
                    on
                      ? chosen.includes(model)
                        ? [...chosen]
                        : [...chosen, model]
                      : chosen.filter((each) => each !== model),
                  );
                }}
              />
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap gap-2">
        {filtering ? (
          <>
            <Button
              type="button"
              size="compact"
              disabled={shown.length === 0}
              onClick={() => {
                onChoose([...chosen, ...shown.filter((model) => !chosen.includes(model))]);
              }}
            >
              {tickShownLabel(shown.length)}
            </Button>
            <Button
              type="button"
              size="compact"
              disabled={shown.length === 0}
              onClick={() => {
                const visible = new Set(shown);
                onChoose(chosen.filter((model) => !visible.has(model)));
              }}
            >
              {untickShownLabel(shown.length)}
            </Button>
            <Button
              type="button"
              size="compact"
              onClick={() => {
                setFilter(NO_FILTER);
              }}
            >
              Clear the filters
            </Button>
          </>
        ) : (
          <>
            <Button
              type="button"
              size="compact"
              onClick={() => {
                onChoose([...offered]);
              }}
            >
              Use all of them
            </Button>
            <Button
              type="button"
              size="compact"
              onClick={() => {
                onChoose([]);
              }}
            >
              Use none of them
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * One row of modality boxes. *The legend says the direction and the label says
 * it again*, because a checkbox's accessible name does not include its
 * fieldset's legend in every reader, and *Pictures* alone is two different
 * questions in the two rows.
 */
function ModalityRow({
  legend,
  suffix,
  words,
  held,
  onToggle,
}: {
  legend: string;
  suffix: string;
  words: readonly string[];
  held: readonly string[];
  onToggle: (word: string, on: boolean) => void;
}): JSX.Element | null {
  if (words.length === 0) return null;
  return (
    <fieldset className="flex flex-wrap items-center gap-x-4 gap-y-1">
      <legend className="mb-1 text-sm text-ink">{legend}</legend>
      {words.map((word) => (
        <CheckboxField
          key={word}
          label={`${modalityLabel(word)} ${suffix}`}
          checked={held.includes(word)}
          onChange={(on) => {
            onToggle(word, on);
          }}
        />
      ))}
    </fieldset>
  );
}

function offeredCount(count: number): string {
  return count === 1
    ? 'This endpoint offers 1 model. Tick the ones this install should use.'
    : `This endpoint offers ${String(count)} models. Tick the ones this install should use.`;
}

function shownLine(shown: number, of: number): string {
  return shown === 0 ? 'No model matches.' : `Showing ${String(shown)} of ${String(of)}.`;
}

function unknownLine(count: number): string {
  return count === 1
    ? '1 more says nothing about what it takes or gives, so these filters hide it.'
    : `${String(count)} more say nothing about what they take or give, so these filters hide them.`;
}

function tickShownLabel(count: number): string {
  return count === 1 ? 'Tick the 1 shown' : `Tick the ${String(count)} shown`;
}

function untickShownLabel(count: number): string {
  return count === 1 ? 'Untick the 1 shown' : `Untick the ${String(count)} shown`;
}
