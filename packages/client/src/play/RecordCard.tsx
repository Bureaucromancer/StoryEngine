// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { useIsMutating, useQueryClient } from '@tanstack/react-query';
import { useState, type JSX } from 'react';

import type { ModeSurface, RecordField } from '../api.js';
import { labels } from '../i18n/catalogue.js';
import { channelWriteKey, useWriteChannel } from '../queries.js';
import { AlertNote } from '../ui/Alert.js';
import { Button } from '../ui/Button.js';
import { CheckboxField, Field, NumberField } from '../ui/Field.js';
import { Note } from '../ui/Text.js';
import { disclosure } from '../ui/classes.js';

/**
 * ***A structured value, read and edited field by field*** — the `record`
 * widget arm, [P14 §1.9.2](../../../../docs/design/workplan/31-p14-scene-and-session-import.md),
 * built at [P14.5a]. Scene's tracker cards are its first consumers; it knows
 * none of them.
 *
 * ***It reads a declaration, not a schema.*** Each field names a property and
 * how it is shown, from `RecordField`'s closed set, and a `show` this build does
 * not know is skipped — the additive posture `ModeRegion` takes toward an arm.
 * There is no `if (channelId === …)` here, for `ModeRegion`'s reason: the day a
 * tracker needs special handling in this file is the day the vocabulary was too
 * narrow, and 10 §8.1's answer is to widen it.
 *
 * ***Every write is the ordinary channel write.*** An edit sends the whole
 * value, changed where the person changed it, through `PUT /sessions/:id/
 * channels/:key` — an engine turn with a `user` effect, which is what makes a
 * correction branch-correct and undoable, and what makes *Marinara's manual
 * override simply the latest effect* ([P14 §1.9.2]). A lock or a hide is the
 * same write to the set the widget names. So the card gains no authority: the
 * channel's schema and `update` policy still decide, and a refused value is
 * said beside the card rather than swallowed.
 *
 * **Held locally while editing, written on Save**, as the author's note is:
 * a tracker is several fields of one value, and a write per keystroke would be
 * an engine turn per keystroke, each undoable on its own. *A checkbox on an
 * objective writes at once* — ticking a box is the whole edit, and [P14 §1.9.2]
 * asks for *"quests with checkable objectives"*, not for a form around them.
 *
 * ***Hidden is the reader's, not the narrator's*** (`se.track.hidden`'s
 * meaning): a hidden field is left off the card until the person asks to see
 * it, and is still in every prompt.
 *
 * ***Locks and hides reach a named row, not only a field*** (2026-09-29, the
 * review): a stat, an item, a custom field, a quest objective — the grain the
 * step writes back and the Marinara import writes. A card that could only lock
 * whole fields showed an imported row lock nowhere and could not clear it. A
 * path in either set that this card still cannot place is listed under it with
 * a control to clear it, so nothing in the set is invisible.
 *
 * ***Writes wait for each other*** (same review): every channel write shares
 * one mutation key, the lock and hide controls on every card wait while any is
 * in flight, a toggle builds the next set from the freshest cached read, and
 * Save sends the current value with only the fields the person edited
 * changed — so a second quick write, or a model update that landed while the
 * card was open, is not silently undone.
 */
const WORDS = labels('play.record', {
  edit: 'Edit',
  save: 'Save',
  cancel: 'Cancel',
  lock: 'Lock',
  lockHint: 'The model cannot change a locked field.',
  hide: 'Hide',
  hideHint: 'Hidden from this card, not from the story.',
  showHidden: 'Show {count} hidden',
  hideHidden: 'Hide them again',
  locked: 'locked',
  empty: 'Nothing yet.',
  name: 'Name',
  value: 'Value',
  qty: 'How many',
  max: 'Out of',
  stage: 'Stage',
  done: 'Done',
  objective: 'Objective',
  addRow: 'Add a row',
  addObjective: 'Add an objective',
  addQuest: 'Add a quest',
  remove: 'Remove',
  refused: 'That was not accepted: {reason}',
  failed: 'That could not be saved.',
  unplaced: 'Also held for this card:',
  lockedAt: '{path} — locked',
  hiddenAt: '{path} — hidden',
  whole: 'the whole card',
  clear: 'Clear',
});

/** The `show`s whose value is a set of named rows, each lockable and hideable. */
const ROWED = new Set(['pairs', 'map', 'items', 'meters']);

/** Every `show` this build can draw. Anything else is skipped. */
const KNOWN = new Set([
  'line',
  'number',
  'flag',
  'lines',
  'pairs',
  'map',
  'items',
  'meters',
  'checklists',
]);

type Json = Record<string, unknown>;

/** A field path segment, escaped as JSON Pointer escapes one — `trackerPath`'s grammar. */
function segment(text: string): string {
  return text.replaceAll('~', '~0').replaceAll('/', '~1');
}

function rowsOf(value: unknown): Json[] {
  return Array.isArray(value)
    ? value.filter((row): row is Json => typeof row === 'object' && row !== null)
    : [];
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';
}

/** A custom field's value as text — it may be a string, a number or a boolean. */
function scalarText(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? String(value)
    : '';
}

function fieldValue(value: unknown, field: RecordField): unknown {
  if (field.key === '') return value;
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Json)[field.key]
    : undefined;
}

function withField(value: unknown, field: RecordField, next: unknown): unknown {
  if (field.key === '') return next;
  const base = typeof value === 'object' && value !== null && !Array.isArray(value) ? value : {};
  return { ...(base as Json), [field.key]: next };
}

/**
 * One lockable, hideable thing on the card: a field of an object value, a
 * named row under one (a stat, an item, a custom field), a row of a value that
 * is itself a list — the quests, the custom tracker — or an objective of such a
 * quest. A row is named by its `name`, never its index, for the reason the
 * lock grammar gives: the model reorders lists.
 */
function pathOf(key: string, field: RecordField, rowName?: string, objective?: string): string {
  let path = field.key === '' ? `${key}/${segment(rowName ?? '')}` : `${key}/${segment(field.key)}`;
  if (field.key !== '' && rowName !== undefined) path += `/${segment(rowName)}`;
  if (objective !== undefined) path += `/objectives/${segment(objective)}`;
  return path;
}

/** The names of a field's rows — a `map`'s keys, or the other rowed shows' `name`s. */
function rowNames(show: string, value: unknown): string[] {
  if (show === 'map') {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? Object.keys(value)
      : [];
  }
  return rowsOf(value)
    .map((row) => str(row['name']))
    .filter((name) => name !== '');
}

/** A rowed field's value with only the rows `keep` keeps. */
function keptRows(show: string, value: unknown, keep: (name: string) => boolean): unknown {
  if (show === 'map') {
    return Object.fromEntries(
      Object.entries(typeof value === 'object' && value !== null ? value : {}).filter(([name]) =>
        keep(name),
      ),
    );
  }
  return rowsOf(value).filter((row) => keep(str(row['name'])));
}

/** Every path this card draws a control or a mark for, over the current value. */
function placeable(key: string, fields: readonly RecordField[], value: unknown): Set<string> {
  const out = new Set<string>();
  for (const field of fields) {
    const at = fieldValue(value, field);
    if (field.key === '') {
      for (const row of rowsOf(at)) {
        const name = str(row['name']);
        out.add(pathOf(key, field, name));
        for (const objective of rowsOf(row['objectives'])) {
          out.add(pathOf(key, field, name, str(objective['text'])));
        }
      }
      continue;
    }
    out.add(pathOf(key, field));
    if (ROWED.has(field.show)) {
      for (const name of rowNames(field.show, at)) out.add(pathOf(key, field, name));
    }
  }
  return out;
}

/** A path under the card, for reading: its segments after the key, unescaped. */
function spoken(key: string, path: string): string {
  if (path === key) return WORDS.whole;
  return path
    .slice(key.length + 1)
    .split('/')
    .map((one) => one.replaceAll('~1', '/').replaceAll('~0', '~'))
    .join(' › ');
}

export function RecordCard(props: {
  surface: ModeSurface;
  sessionId: string;
  /** The card's heading: the widget's label, and the member it is about. */
  heading: string;
}): JSX.Element | null {
  const record = props.surface.record;
  const write = useWriteChannel(props.sessionId);
  const client = useQueryClient();
  // Any channel write for this session, from any card — see the file's note.
  const writing = useIsMutating({ mutationKey: channelWriteKey(props.sessionId) }) > 0;
  const [draft, setDraft] = useState<unknown>(null);
  // The fields the person changed in the draft, by `key` — only these are sent.
  const [edited, setEdited] = useState<ReadonlySet<string>>(new Set());
  const [revealed, setRevealed] = useState(false);
  if (record === undefined) return null;

  const editing = draft !== null;
  const fields = record.fields.filter((field) => KNOWN.has(field.show));
  const locks = new Set(record.locks?.paths ?? []);
  const hidden = new Set(record.hidden?.paths ?? []);
  const key = props.surface.key;

  /**
   * The set as the freshest session read holds it — not this card's props,
   * which may be a render behind a write another card just made to the same set.
   */
  const freshest = (set: { key: string; paths: string[] }): string[] => {
    const cached = client.getQueryData<{ surfaces?: ModeSurface[] }>(['session', props.sessionId]);
    for (const one of cached?.surfaces ?? []) {
      for (const held of [one.record?.locks, one.record?.hidden]) {
        if (held?.key === set.key) return held.paths;
      }
    }
    return set.paths;
  };

  const toggleIn = (set: { key: string; paths: string[] } | null, path: string): void => {
    if (set === null) return;
    const paths = freshest(set);
    const next = paths.includes(path) ? paths.filter((one) => one !== path) : [...paths, path];
    write.mutate({ key: set.key, value: next });
  };

  /** Lock and hide for one path — only where the widget named the sets. */
  const affordances = (path: string): JSX.Element | null =>
    record.locks === null && record.hidden === null ? null : (
      <div className="flex flex-wrap gap-3">
        {record.locks === null ? null : (
          <CheckboxField
            label={WORDS.lock}
            hint={WORDS.lockHint}
            checked={locks.has(path)}
            disabled={writing}
            onChange={() => {
              toggleIn(record.locks, path);
            }}
          />
        )}
        {record.hidden === null ? null : (
          <CheckboxField
            label={WORDS.hide}
            hint={WORDS.hideHint}
            checked={hidden.has(path)}
            disabled={writing}
            onChange={() => {
              toggleIn(record.hidden, path);
            }}
          />
        )}
      </div>
    );

  // What the card leaves off, counted so the person knows it is there.
  let hiddenCount = 0;
  const visible = (path: string): boolean => {
    if (!hidden.has(path) || revealed) return true;
    hiddenCount += 1;
    return false;
  };

  const readRows = fields.map((field) => {
    const value = fieldValue(record.value, field);
    if (field.key === '') {
      const rows = rowsOf(value).filter((row) => visible(pathOf(key, field, str(row['name']))));
      return (
        <div key={`field-${field.label}`} className="flex flex-col gap-1">
          {rows.length === 0 ? (
            <Note>{WORDS.empty}</Note>
          ) : (
            rows.map((row) => (
              <ReadRow
                key={str(row['name'])}
                label={null}
                locked={locks.has(pathOf(key, field, str(row['name'])))}
              >
                {field.show === 'checklists' ? (
                  <Checklist
                    // Hidden objectives filtered here, in this render, so
                    // they are counted before the count is read.
                    quest={{
                      ...row,
                      objectives: rowsOf(row['objectives']).filter((objective) =>
                        visible(pathOf(key, field, str(row['name']), str(objective['text']))),
                      ),
                    }}
                    busy={writing}
                    locked={(objective) =>
                      locks.has(pathOf(key, field, str(row['name']), objective))
                    }
                    onTick={(objective) => {
                      write.mutate({
                        key,
                        value: tickObjective(record.value, str(row['name']), objective),
                      });
                    }}
                  />
                ) : (
                  <span>
                    <span className="text-ink-faint">{str(row['name'])}</span>{' '}
                    {scalarText(row['value'])}
                  </span>
                )}
              </ReadRow>
            ))
          )}
        </div>
      );
    }
    const path = pathOf(key, field);
    if (!visible(path) || isBlank(value)) return null;
    // A rowed field's hidden rows are left off, and counted, as a field is.
    const shown = ROWED.has(field.show)
      ? keptRows(field.show, value, (name) => visible(pathOf(key, field, name)))
      : value;
    if (isBlank(shown)) return null;
    return (
      <ReadRow key={field.key} label={field.label} locked={locks.has(path)}>
        <ReadValue
          field={field}
          value={shown}
          locked={(name) => locks.has(pathOf(key, field, name))}
        />
      </ReadRow>
    );
  });

  /**
   * ***What the sets hold for this card that it draws no control for*** — a
   * path from an import, or a row the value no longer has. Listed with a way to
   * clear it, because a lock nobody can see is a tracker that will not move
   * for no reason anybody can find.
   */
  const places = placeable(key, fields, record.value);
  const under = (path: string): boolean =>
    (path === key || path.startsWith(`${key}/`)) && !places.has(path);
  const unplaced = [
    ...[...locks].filter(under).map((path) => ({ path, set: record.locks, words: WORDS.lockedAt })),
    ...[...hidden]
      .filter(under)
      .map((path) => ({ path, set: record.hidden, words: WORDS.hiddenAt })),
  ];

  // A refusal is an answer, not an error: the write went through and the
  // channel's own policy said no, with a reason worth showing.
  const effect = (
    write.data as { effect?: { applied: boolean; rejectedReason: string | null } } | undefined
  )?.effect;
  const refused =
    effect !== undefined && !effect.applied
      ? WORDS.refused.replace('{reason}', effect.rejectedReason ?? '')
      : null;

  return (
    <details open className="rounded-control border border-line bg-surface px-3 py-2">
      <summary className={`${disclosure.titled} text-sm font-medium`}>{props.heading}</summary>
      <div className="mt-2 flex flex-col gap-2">
        {editing ? (
          <div className="flex flex-col gap-3">
            {fields.map((field) => (
              <FieldEditor
                key={`edit-${field.key}-${field.label}`}
                field={field}
                value={fieldValue(draft, field)}
                onChange={(next) => {
                  setDraft(withField(draft, field, next));
                  setEdited(new Set([...edited, field.key]));
                }}
                affordances={(rowName, objective) =>
                  affordances(pathOf(key, field, rowName, objective))
                }
              />
            ))}
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="compact"
                disabled={writing}
                onClick={() => {
                  // Only what the person edited, onto the value as it is now.
                  const changed = fields.filter((field) => edited.has(field.key));
                  if (changed.length === 0) {
                    setDraft(null);
                    return;
                  }
                  const next = settled(draft, record.value, changed);
                  let value = record.value;
                  for (const field of changed) {
                    value = withField(value, field, fieldValue(next, field));
                  }
                  write.mutate(
                    { key, value },
                    {
                      onSuccess: () => {
                        setDraft(null);
                        setEdited(new Set());
                      },
                    },
                  );
                }}
              >
                {WORDS.save}
              </Button>
              <Button
                type="button"
                size="compact"
                variant="quiet"
                onClick={() => {
                  setDraft(null);
                  setEdited(new Set());
                }}
              >
                {WORDS.cancel}
              </Button>
            </div>
          </div>
        ) : (
          <>
            <dl className="flex flex-col gap-1 text-sm text-ink">{readRows}</dl>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                size="tiny"
                onClick={() => {
                  setDraft(JSON.parse(JSON.stringify(record.value ?? null)) as unknown);
                }}
              >
                {WORDS.edit}
              </Button>
              {hiddenCount > 0 || revealed ? (
                <Button
                  type="button"
                  size="tiny"
                  variant="quiet"
                  onClick={() => {
                    setRevealed(!revealed);
                  }}
                >
                  {revealed
                    ? WORDS.hideHidden
                    : WORDS.showHidden.replace('{count}', String(hiddenCount))}
                </Button>
              ) : null}
            </div>
          </>
        )}
        {unplaced.length === 0 ? null : (
          <div className="flex flex-col gap-1 text-sm">
            <Note>{WORDS.unplaced}</Note>
            <ul className="flex flex-col gap-1">
              {unplaced.map((one) => (
                <li key={`${one.words}-${one.path}`} className="flex flex-wrap items-center gap-2">
                  <span className="text-ink-muted">
                    {one.words.replace('{path}', spoken(key, one.path))}
                  </span>
                  <Button
                    type="button"
                    size="tiny"
                    variant="quiet"
                    disabled={writing}
                    onClick={() => {
                      toggleIn(one.set, one.path);
                    }}
                  >
                    {WORDS.clear}
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {refused === null ? null : <AlertNote role="alert">{refused}</AlertNote>}
        {write.isError ? <AlertNote role="alert">{WORDS.failed}</AlertNote> : null}
      </div>
    </details>
  );
}

function isBlank(value: unknown): boolean {
  if (value === undefined || value === null || value === '') return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value).length === 0;
  return false;
}

function ReadRow(props: {
  label: string | null;
  locked: boolean;
  children: JSX.Element;
}): JSX.Element {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2">
      {props.label === null ? null : <dt className="text-ink-faint">{props.label}</dt>}
      <dd className="min-w-0 flex-1">{props.children}</dd>
      {props.locked ? <span className="text-xs text-ink-faint">{WORDS.locked}</span> : null}
    </div>
  );
}

/** One field, read — each `show` as the person would say it aloud. */
function ReadValue(props: {
  field: RecordField;
  value: unknown;
  /** Whether a named row of a rowed field is locked. */
  locked: (name: string) => boolean;
}): JSX.Element {
  const { value } = props;
  const mark = (name: string, text: string): string =>
    props.locked(name) ? `${text} (${WORDS.locked})` : text;
  switch (props.field.show) {
    case 'flag':
      return <span>{value === true ? '✓' : '—'}</span>;
    case 'lines':
      return <span>{(Array.isArray(value) ? value : []).map(str).join('; ')}</span>;
    case 'map':
      return (
        <span>
          {Object.entries(typeof value === 'object' && value !== null ? value : {})
            .map(([name, text]) => mark(name, `${name}: ${str(text)}`))
            .join('; ')}
        </span>
      );
    case 'pairs':
      return (
        <span>
          {rowsOf(value)
            .map((row) =>
              mark(str(row['name']), `${str(row['name'])}: ${scalarText(row['value'])}`),
            )
            .join('; ')}
        </span>
      );
    case 'items':
      return (
        <span>
          {rowsOf(value)
            .map((row) =>
              mark(
                str(row['name']),
                typeof row['qty'] === 'number' && row['qty'] !== 1
                  ? `${str(row['name'])} ×${String(row['qty'])}`
                  : str(row['name']),
              ),
            )
            .join(', ')}
        </span>
      );
    case 'meters':
      return (
        <span className="flex flex-col gap-1">
          {rowsOf(value).map((row) => (
            <Meter
              key={str(row['name'])}
              label={mark(str(row['name']), str(row['name']))}
              value={Number(row['value'])}
              min={0}
              max={Number(row['max'])}
            />
          ))}
        </span>
      );
    default:
      return <span>{str(value)}</span>;
  }
}

/**
 * ***A stat bar*** — the `meter` arm, and every `meters` row. The platform's
 * own `<meter>`, so its value and range are announced without a line of ARIA,
 * with the numbers beside it because a bar alone says *about half*.
 */
export function Meter(props: {
  label: string;
  value: number;
  min: number;
  max: number;
}): JSX.Element | null {
  if (!Number.isFinite(props.value) || !Number.isFinite(props.max) || props.max <= props.min) {
    return null;
  }
  return (
    <span className="flex items-center gap-2 text-sm">
      <span className="text-ink-faint">{props.label}</span>
      <meter
        className="h-2 min-w-16 flex-1"
        min={props.min}
        max={props.max}
        value={props.value}
        aria-label={props.label}
      />
      <span className="tabular-nums text-ink-muted">
        {props.value}/{props.max}
      </span>
    </span>
  );
}

/** A quest's objectives, each a box that writes when ticked. */
function Checklist(props: {
  quest: Json;
  busy: boolean;
  locked: (objective: string) => boolean;
  onTick: (objective: string) => void;
}): JSX.Element {
  const stage = str(props.quest['stage']);
  return (
    <div className="flex flex-col gap-1">
      <span className={props.quest['completed'] === true ? 'text-ink-muted line-through' : ''}>
        {str(props.quest['name'])}
        {stage === '' ? null : <span className="text-ink-faint"> — {stage}</span>}
      </span>
      <ul className="flex flex-col gap-0.5 ps-4">
        {rowsOf(props.quest['objectives']).map((objective) => (
          <li key={str(objective['text'])}>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={objective['completed'] === true}
                disabled={props.busy}
                onChange={() => {
                  props.onTick(str(objective['text']));
                }}
              />
              <span>{str(objective['text'])}</span>
              {props.locked(str(objective['text'])) ? (
                <span className="text-xs text-ink-faint">{WORDS.locked}</span>
              ) : null}
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The whole value with one objective of one quest ticked or unticked. */
function tickObjective(value: unknown, quest: string, objective: string): unknown {
  return rowsOf(value).map((row) =>
    str(row['name']) !== quest
      ? row
      : {
          ...row,
          objectives: rowsOf(row['objectives']).map((one) =>
            str(one['text']) === objective ? { ...one, completed: one['completed'] !== true } : one,
          ),
        },
  );
}

// ---------------------------------------------------------------------------
// Editing
// ---------------------------------------------------------------------------

/**
 * ***One field, as an editor.*** Numbers are held as the text typed until
 * Save, which is {@link NumberField}'s own reason: `0.` is a state a person
 * passes through. {@link settled} makes them numbers again.
 */
function FieldEditor(props: {
  field: RecordField;
  value: unknown;
  onChange: (next: unknown) => void;
  /** Lock and hide for the field, a named row of it, or a quest's objective. */
  affordances: (rowName?: string, objective?: string) => JSX.Element | null;
}): JSX.Element {
  const { field, value, onChange } = props;
  const whole = field.key !== '';
  const shell = (control: JSX.Element): JSX.Element => (
    <fieldset className="flex flex-col gap-1 border-t border-line pt-2">
      <legend className="text-sm font-medium text-ink-muted">{field.label}</legend>
      {control}
      {whole ? props.affordances() : null}
    </fieldset>
  );

  switch (field.show) {
    case 'line':
      return shell(<Field label={field.label} value={str(value)} onChange={onChange} />);
    case 'number':
      return shell(<NumberField label={field.label} value={str(value)} onChange={onChange} />);
    case 'flag':
      return shell(
        <CheckboxField label={field.label} checked={value === true} onChange={onChange} />,
      );
    case 'lines':
      return shell(
        <Field
          label={field.label}
          multiline
          rows={3}
          value={(Array.isArray(value) ? value : []).map(str).join('\n')}
          onChange={(text) => {
            onChange(text.split('\n'));
          }}
        />,
      );
    case 'map':
      return shell(
        <Rows
          rows={Object.entries(typeof value === 'object' && value !== null ? value : {}).map(
            ([name, text]) => ({ name, value: str(text) }),
          )}
          columns={['value']}
          onChange={(rows) => {
            onChange(Object.fromEntries(rows.map((row) => [str(row['name']), row['value'] ?? ''])));
          }}
          perRow={props.affordances}
        />,
      );
    case 'pairs':
      return shell(
        <Rows
          rows={rowsOf(value).map((row) => ({ ...row, value: scalarText(row['value']) }))}
          columns={['value']}
          onChange={onChange}
          perRow={props.affordances}
        />,
      );
    case 'items':
      return shell(
        <Rows
          rows={rowsOf(value)}
          columns={['qty']}
          onChange={onChange}
          perRow={props.affordances}
        />,
      );
    case 'meters':
      return shell(
        <Rows
          rows={rowsOf(value)}
          columns={['value', 'max']}
          onChange={onChange}
          perRow={props.affordances}
        />,
      );
    case 'checklists':
      return shell(
        <Quests quests={rowsOf(value)} onChange={onChange} perRow={props.affordances} />,
      );
    default:
      return <></>;
  }
}

const COLUMN_WORDS: Readonly<Record<string, string>> = {
  value: WORDS.value,
  qty: WORDS.qty,
  max: WORDS.max,
};

/**
 * Named rows — a name and one or two more columns — with add and remove.
 * *Which names exist is the person's to say*, which is the custom tracker's
 * whole contract ([P14 §1.9.2]: *"whose names a person defines"*).
 */
function Rows(props: {
  rows: Json[];
  columns: readonly string[];
  onChange: (rows: Json[]) => void;
  perRow?: (rowName: string) => JSX.Element | null;
}): JSX.Element {
  const set = (at: number, column: string, text: string): void => {
    props.onChange(props.rows.map((row, i) => (i === at ? { ...row, [column]: text } : row)));
  };
  return (
    <div className="flex flex-col gap-2">
      {props.rows.map((row, at) => (
        // Index as the key: a row's name is what is being edited, so it
        // cannot also be what keeps the row's inputs mounted while it changes.
        <div key={at} className="flex flex-col gap-1">
          <div className="flex flex-wrap items-end gap-2">
            <Field
              label={WORDS.name}
              value={str(row['name'])}
              onChange={(text) => {
                set(at, 'name', text);
              }}
            />
            {props.columns.map((column) => (
              <Field
                key={column}
                label={COLUMN_WORDS[column] ?? column}
                value={str(row[column])}
                onChange={(text) => {
                  set(at, column, text);
                }}
              />
            ))}
            <Button
              type="button"
              size="tiny"
              variant="quiet"
              onClick={() => {
                props.onChange(props.rows.filter((_, i) => i !== at));
              }}
            >
              {WORDS.remove}
            </Button>
          </div>
          {props.perRow === undefined || str(row['name']) === ''
            ? null
            : props.perRow(str(row['name']))}
        </div>
      ))}
      <Button
        type="button"
        size="tiny"
        onClick={() => {
          props.onChange([...props.rows, { name: '' }]);
        }}
      >
        {WORDS.addRow}
      </Button>
    </div>
  );
}

/** Quests: a name, a stage, whether done, and the objectives under it. */
function Quests(props: {
  quests: Json[];
  onChange: (quests: Json[]) => void;
  /** Lock and hide for a quest, or — with an objective's text — for that objective. */
  perRow?: (rowName: string, objective?: string) => JSX.Element | null;
}): JSX.Element {
  const set = (at: number, next: Json): void => {
    props.onChange(props.quests.map((quest, i) => (i === at ? next : quest)));
  };
  return (
    <div className="flex flex-col gap-3">
      {props.quests.map((quest, at) => {
        const objectives = rowsOf(quest['objectives']);
        return (
          <div key={at} className="flex flex-col gap-1 border-s border-line ps-2">
            <Field
              label={WORDS.name}
              value={str(quest['name'])}
              onChange={(name) => {
                set(at, { ...quest, name });
              }}
            />
            <Field
              label={WORDS.stage}
              value={str(quest['stage'])}
              onChange={(stage) => {
                set(at, { ...quest, stage });
              }}
            />
            <CheckboxField
              label={WORDS.done}
              checked={quest['completed'] === true}
              onChange={(completed) => {
                set(at, { ...quest, completed });
              }}
            />
            {objectives.map((objective, index) => (
              <div key={index} className="flex flex-wrap items-end gap-2 ps-2">
                <input
                  type="checkbox"
                  aria-label={WORDS.done}
                  className="mb-3"
                  checked={objective['completed'] === true}
                  onChange={(event) => {
                    set(at, {
                      ...quest,
                      objectives: objectives.map((one, i) =>
                        i === index ? { ...one, completed: event.target.checked } : one,
                      ),
                    });
                  }}
                />
                <Field
                  label={WORDS.objective}
                  value={str(objective['text'])}
                  onChange={(text) => {
                    set(at, {
                      ...quest,
                      objectives: objectives.map((one, i) =>
                        i === index ? { ...one, text } : one,
                      ),
                    });
                  }}
                />
                <Button
                  type="button"
                  size="tiny"
                  variant="quiet"
                  onClick={() => {
                    set(at, { ...quest, objectives: objectives.filter((_, i) => i !== index) });
                  }}
                >
                  {WORDS.remove}
                </Button>
                {props.perRow === undefined ||
                str(quest['name']) === '' ||
                str(objective['text']) === ''
                  ? null
                  : props.perRow(str(quest['name']), str(objective['text']))}
              </div>
            ))}
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="tiny"
                onClick={() => {
                  set(at, {
                    ...quest,
                    objectives: [...objectives, { text: '', completed: false }],
                  });
                }}
              >
                {WORDS.addObjective}
              </Button>
              <Button
                type="button"
                size="tiny"
                variant="quiet"
                onClick={() => {
                  props.onChange(props.quests.filter((_, i) => i !== at));
                }}
              >
                {WORDS.remove}
              </Button>
            </div>
            {props.perRow === undefined || str(quest['name']) === ''
              ? null
              : props.perRow(str(quest['name']))}
          </div>
        );
      })}
      <Button
        type="button"
        size="tiny"
        onClick={() => {
          props.onChange([...props.quests, { name: '', objectives: [], completed: false }]);
        }}
      >
        {WORDS.addQuest}
      </Button>
    </div>
  );
}

/**
 * ***The draft, made a value the schema can take*** — at Save, not before.
 *
 * - Numbers typed as text become numbers again; one that does not parse keeps
 *   what was there, rather than writing a string the schema refuses.
 * - A row with no name is dropped, and so is an objective with no text: a
 *   name is what a row is matched and locked by, and an empty one is a row
 *   the person started and did not finish.
 * - A `pairs` value keeps the type it had, where the text still reads as it —
 *   the custom tracker takes a number or a boolean as well as a string — and a
 *   new row is text.
 * - Blank lines of a `lines` field go.
 */
function settled(draft: unknown, was: unknown, fields: readonly RecordField[]): unknown {
  let out = draft;
  for (const field of fields) {
    const value = fieldValue(draft, field);
    const before = fieldValue(was, field);
    out = withField(out, field, settleField(field.show, value, before));
  }
  return out;
}

function settleField(show: string, value: unknown, before: unknown): unknown {
  const named = rowsOf(value).filter((row) => str(row['name']).trim() !== '');
  const number = (text: unknown, fallback: unknown): unknown => {
    const parsed = typeof text === 'number' ? text : Number(str(text).trim());
    return str(text).trim() !== '' && Number.isFinite(parsed) ? parsed : fallback;
  };
  switch (show) {
    case 'number':
      return number(value, before);
    case 'lines':
      return (Array.isArray(value) ? value : []).map(str).filter((line) => line.trim() !== '');
    case 'map':
      return Object.fromEntries(
        Object.entries(typeof value === 'object' && value !== null ? value : {}).filter(
          ([name]) => name.trim() !== '',
        ),
      );
    case 'items':
      return named.map((row) => {
        const qty = number(row['qty'], undefined);
        return qty === undefined ? { name: row['name'] } : { name: row['name'], qty };
      });
    case 'meters':
      return named.map((row) => ({
        ...row,
        value: number(row['value'], 0),
        max: number(row['max'], 0),
      }));
    case 'pairs': {
      const had = new Map(rowsOf(before).map((row) => [str(row['name']), row['value']]));
      return named.map((row) => {
        const old = had.get(str(row['name']));
        const text = str(row['value']);
        if (typeof old === 'number') return { name: row['name'], value: number(text, text) };
        if (typeof old === 'boolean' && (text === 'true' || text === 'false')) {
          return { name: row['name'], value: text === 'true' };
        }
        return { name: row['name'], value: text };
      });
    }
    case 'checklists':
      return named.map((quest) => {
        const stage = str(quest['stage']).trim();
        // A blank stage is no stage — the schema's `stage` is optional, and an
        // empty string would render as a dash after the quest's name.
        const rest = Object.fromEntries(Object.entries(quest).filter(([name]) => name !== 'stage'));
        return {
          ...rest,
          ...(stage === '' ? {} : { stage }),
          completed: quest['completed'] === true,
          objectives: rowsOf(quest['objectives'])
            .filter((one) => str(one['text']).trim() !== '')
            .map((one) => ({ text: str(one['text']), completed: one['completed'] === true })),
        };
      });
    default:
      return value;
  }
}
