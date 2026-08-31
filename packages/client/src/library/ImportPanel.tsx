// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { useQueryClient } from '@tanstack/react-query';
import { useState, type ChangeEvent, type JSX } from 'react';

import { api, type ImportItem, type ImportReport } from '../api.js';

/**
 * The way in — [P4 §1.4](../../../../docs/design/05-ui-surfaces.md)'s review
 * step, rendered.
 *
 * **Import commits immediately and the review reports loudly**, which is the
 * decision §1.4 made against [05 §5]'s original *"let the user fix it before
 * committing"*. A staging area is a second library to maintain; dangling
 * references are survivable, visible and non-blocking by stance; and a
 * three-hundred-object sweep gated per-object on a human is not a review, it is
 * a chore. So this shows what happened rather than asking what should.
 *
 * **The sentences are composed here, from classes and params.** The server sends
 * `{ key, params, level }` and never prose ([06 A2d]) — a report stored as
 * English is a bug that only surfaces when somebody changes language. There is
 * no ICU catalogue yet ([P11 §1.3] owns that), so these are the same open-keyed
 * label maps every other class-to-word surface here uses, with the raw key as
 * the fallback: a newer build's class must render as itself rather than as a
 * blank.
 */

const DISPOSITION_LABELS: Record<string, string> = {
  converted: 'Imported',
  unchanged: 'Already here',
  credential: 'Credential removed',
  recorded: 'Recorded, not imported',
  'by-position': 'Not importable',
  skipped: 'Skipped',
  unrecognised: 'Not recognised',
};

/** What each class means, in the one place a person can read it. */
const DISPOSITION_HELP: Record<string, string> = {
  converted: 'Now in your library.',
  unchanged: 'Identical to what is already here, so nothing was written.',
  credential: 'A connection or password. Removed and never stored.',
  recorded: 'Read and named, but this build has nowhere to put it yet.',
  'by-position': 'There is nothing here for it to become, and there will not be.',
  skipped: 'Deliberately not taken.',
  unrecognised: 'Could not be identified.',
};

const NOTE_LABELS: Record<string, string> = {
  'import.preset.credentialsRemoved': 'Removed connection fields: {fields}.',
  'import.preset.contextCeilingWasAbsolute':
    'The context limit ({tokens}) was an absolute number in the source, and is a ceiling here.',
  'import.preset.perCharacterOrdersDropped':
    'Per-character prompt orders were dropped: {characters}.',
  'import.preset.samplerRatio': 'Sampler settings: {carried} of {total} fields carried over.',
  'import.preset.markerNeedsLaterMachinery': 'The “{marker}” block needs machinery from {when}.',
  'import.macro.unrecognised': 'Unrecognised macro {macro} in “{block}” — left as written.',
  'import.card.personalityAsTraits': 'Personality read as {count} traits.',
  'import.card.personalityAsProse': 'Personality read as prose, and kept in the summary.',
  'import.card.wantsPromptOverride': 'This card wants to override prompts ({fields}); review.',
  'import.card.portraitUnreadable': 'The portrait could not be read, so the card has none.',
  'import.lore.positionCollapsed': '“{entry}” sat at {original}, which has no equivalent here.',
  'import.lore.entryLimitClamped': 'Entry limit reduced from {from} to {to}.',
  'import.lore.chatScopeDropped': '“{book}” was scoped to one chat; it is global here.',
  'import.object.unchanged': 'Unchanged.',
  'import.object.replaced': 'Replaced what was here; the previous version is in its history.',
  'import.object.keptBoth': 'Kept alongside the existing one.',
  'import.object.differsAndKept': 'Differs from what is here, and was not written.',

  /**
   * **The twenty-four the map was missing**, found by the P4 completeness audit
   * ([P4 §7.1]) and added with it.
   *
   * The first eighteen were written from the design's expected vocabulary
   * rather than harvested from the converters, so the map drifted the moment a
   * converter learned a new note — and the fallback at `sentence()` is silent
   * about it by design: an unlabelled key renders as itself, which is right for
   * a newer build's class and wrong as a permanent state.
   *
   * `import.card.bookExtracted` is the sharpest case. It fires on **every** card
   * that carries a lorebook, which is most of them, so the most common note in
   * the most common import was rendering as a dotted machine string. Five of
   * these reach the single-file upload for the first time in this change, which
   * is why closing the gap belongs to it rather than to a later tidy.
   *
   * Harvested with a grep for the emitted keys and diffed against this map, so
   * the list is the code's rather than a guess at it.
   */
  'import.card.bookExtracted': 'Carried a lorebook, imported separately as “{book}”.',
  'import.card.bookRefused': 'The lorebook inside this card could not be read ({refusal}).',
  'import.card.treatmentCreated':
    'Its scenario became the treatment “{treatment}”, shared by {actors}.',
  'import.file.notACard': '{file} is not a character card.',
  'import.file.pictureWithoutACard': '{file} is a picture with no character in it.',
  'import.file.notJson': '{file} is not readable as JSON.',
  'import.file.unrecognised': 'Nothing here recognised {file}.',
  'import.file.unreadable': '{file} could not be read, so nothing looked inside it.',
  'import.file.refused': '{file} could not be read ({refusal}).',
  'import.file.notStored': '“{object}” could not be saved ({reason}).',
  'import.file.notYetConvertible':
    'Read and named, but this build has nowhere to put a {kind} yet.',
  'import.row.unreadable': 'A row in {table} could not be read and was skipped.',
  'import.lore.stateDropped': '“{entry}” had a {field} setting that does not exist here.',
  'import.lore.unknownPosition': '“{entry}” sat at position {code}, which has no meaning here.',
  'import.lore.logicNarrowed':
    '“{entry}” used {original} matching, narrowed to what this supports.',
  'import.lore.characterLinksDangle':
    'Was linked to {count} characters that were not imported with it.',
  'import.macro.refused': 'The macro {macro} in “{block}” was left as written — {because}.',
  'import.preset.paramsCarried': '{count} sampler settings carried over.',
  'import.preset.groupOrderUsed': 'Prompt order taken from the preset’s own group.',
  'import.preset.groupOrderDropped': 'The preset’s group ordering could not be used.',
  'import.preset.unknownMarker': 'The “{identifier}” block is not one this understands.',
  'import.preset.modePromptConverted': 'Its {field} became a block.',
  'import.preset.variablesInert': '{count} variables were kept but do nothing yet.',
  'import.preset.noBlocksInSamplerPreset': 'A sampler panel only — it carries no prompt blocks.',
  'import.preset.postHistoryIsAfterNotAtDepth':
    'Its post-history instructions go after the conversation rather than at a depth.',
};

/** `{name}` substitution, which is all the catalogue needs until ICU arrives. */
function sentence(note: ImportItem['notes'][number]): string {
  const template = NOTE_LABELS[note.key];
  if (template === undefined) return note.key;
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => {
    const value = note.params[key];
    return value === undefined ? whole : String(value);
  });
}

export function ImportPanel(): JSX.Element {
  const queryClient = useQueryClient();
  const [report, setReport] = useState<ImportReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [root, setRoot] = useState('');

  /**
   * Everything the library shows is now different, and which queries is not
   * worth enumerating — a sweep can write six kinds. `resetQueries` rather than
   * `removeQueries`, because a destroyed entry does not notify its observers
   * and the list would sit on what it was already holding ([P3.5]).
   */
  const refresh = async (): Promise<void> => {
    await queryClient.resetQueries({ queryKey: ['library'] });
  };

  const onFile = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0];
    if (file === undefined) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.importFile(file);
      setReport({
        jobId: 'file',
        source: file.name,
        items: [result.item],
        counts: { [result.item.disposition]: 1 },
      });
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The import failed.');
    } finally {
      setBusy(false);
      event.target.value = '';
    }
  };

  const onSweep = async (): Promise<void> => {
    if (root.trim().length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.importSweep(root.trim());
      setReport(result.report);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The import failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mb-6 rounded border border-line p-4">
      <h2 className="mb-1 text-body font-medium text-ink">Import</h2>
      <p className="mb-3 text-sm text-ink-subtle">
        Cards, lorebooks and presets from SillyTavern or Marinara. Nothing is staged: what imports
        lands in your library, and everything that did not is listed below.
      </p>

      <div className="flex flex-wrap items-end gap-4">
        <label className="text-sm text-ink-subtle">
          <span className="mb-1 block">One file</span>
          <input type="file" onChange={(event) => void onFile(event)} disabled={busy} />
        </label>

        <label className="text-sm text-ink-subtle">
          <span className="mb-1 block">Or a folder on this machine</span>
          <input
            type="text"
            value={root}
            onChange={(event) => {
              setRoot(event.target.value);
            }}
            placeholder="The full path to a SillyTavern or Marinara data folder"
            className="w-80 rounded border border-line px-2 py-1 text-ink"
            disabled={busy}
          />
        </label>
        <button
          type="button"
          onClick={() => void onSweep()}
          disabled={busy || root.trim().length === 0}
          className="rounded border border-line px-3 py-1 text-sm text-ink"
        >
          {busy ? 'Reading…' : 'Import folder'}
        </button>
      </div>

      {error !== null && (
        <p role="alert" className="mt-3 text-sm text-ink">
          {error}
        </p>
      )}

      {report !== null && <Report report={report} />}
    </section>
  );
}

function Report(props: { report: ImportReport }): JSX.Element {
  const counts = Object.entries(props.report.counts).filter(([, value]) => value > 0);

  return (
    <div className="mt-4">
      <h3 className="mb-2 text-sm font-medium text-ink">What happened</h3>
      <ul className="mb-3 flex flex-wrap gap-3 text-sm text-ink-subtle">
        {counts.map(([disposition, count]) => (
          <li key={disposition} title={DISPOSITION_HELP[disposition] ?? ''}>
            <strong className="text-ink">{count}</strong>{' '}
            {DISPOSITION_LABELS[disposition] ?? disposition}
          </li>
        ))}
      </ul>

      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-line-strong text-ink-subtle">
            <th scope="col" className="py-1 pe-4 text-start font-medium">
              File
            </th>
            <th scope="col" className="py-1 pe-4 text-start font-medium">
              What happened
            </th>
            <th scope="col" className="py-1 text-start font-medium">
              Notes
            </th>
          </tr>
        </thead>
        <tbody>
          {props.report.items.map((item) => (
            <tr key={item.source} className="border-b border-line align-top">
              {/* Relative to the folder that was swept, never absolute ([13 §4.1.1]). */}
              <td className="py-1 pe-4 text-ink">{item.source}</td>
              <td className="py-1 pe-4 text-ink-subtle">
                {DISPOSITION_LABELS[item.disposition] ?? item.disposition}
              </td>
              <td className="py-1 text-ink-subtle">
                {item.notes.map((note, index) => (
                  <p key={index} className={note.level === 'warn' ? 'text-ink' : undefined}>
                    {sentence(note)}
                  </p>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
