// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type ChangeEvent, type JSX, type ReactNode } from 'react';

import type { NearMissOffer } from '@storyengine/shared';

import { api, type ImportItem, type ImportReport } from '../api.js';
import { useAuthState, usePatchPrefs, usePrefs } from '../queries.js';
import { Alert } from '../ui/Alert.js';
import { Button } from '../ui/Button.js';
import { control } from '../ui/classes.js';
import { Note, SubsectionTitle } from '../ui/Text.js';

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

  /**
   * **What the folder is, when it is not the folder to point at.** These come
   * from `import/near-miss.ts` rather than from a converter, and they are the
   * first notes here that are about the *request* instead of about an object —
   * which is why they read as advice rather than as a record.
   *
   * They are deliberately in the same map. The alternative was a second
   * vocabulary with its own renderer, and the note class is already the thing
   * this review composes prose from; a near miss being a different kind of fact
   * does not make it a different kind of sentence.
   */
  'import.root.sillytavernBelow':
    'This looks like SillyTavern’s program folder rather than its library. The library is in {path} — point at that instead.',
  'import.root.sillytavernDataFolder':
    'This is SillyTavern’s data folder. One person’s library is in {path} — point at that instead.',
  'import.root.sillytavernOldLayout':
    'This SillyTavern is older than the 1.12 layout change, so its library is still in {path}.',
  'import.root.sillytavernUserFolders':
    'This is SillyTavern’s data folder, which holds one folder per person. Point at the one named for you.',
  'import.root.sillytavernProgramFolder':
    'This is SillyTavern’s program folder, not its library. Where the library lives is set by dataRoot in config.yaml; unless that was changed, it is data/default-user.',
  'import.root.sillytavernAbove':
    'This is one folder out of a SillyTavern library. Point at the folder above it to bring in the lorebooks, presets and personas too.',
  'import.root.marinaraBelow': 'A Marinara data folder is in {path} — point at that instead.',
  'import.root.marinaraTwoDataFolders':
    'There are Marinara data folders in both {first} and {second}, which a version change used to leave behind. Marinara’s own notes say to check which is newer rather than assume.',
  'import.root.marinaraUpdateBackup':
    'This looks like a copy the Marinara launcher made before an update, rather than the folder it is using now.',
  'import.root.marinaraProgramFolder':
    'This is Marinara’s program folder rather than its data folder. Either nothing has been saved yet, or its data folder has been moved elsewhere.',
  'import.root.marinaraStorageFolder':
    'This is the storage folder inside a Marinara data folder. Point at the folder above it, which holds the pictures as well.',
  'import.root.marinaraAbove':
    'This is one folder out of a Marinara data folder. Point at the folder above it.',
  'import.root.marinaraTablesFolder':
    'This is inside a Marinara storage folder. Point two folders up, at the data folder itself.',
  'import.root.marinaraTooOld':
    'This is a Marinara data folder from before version 1.5.7, which kept everything in one database file. This build reads only the newer file storage.',
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

/** What the verdict is called, for somebody who did not write the probe table. */
const VERDICT_LABELS: Record<string, string> = {
  sillytavern: 'A SillyTavern library. Ready to import.',
  marinara: 'A Marinara data folder. Ready to import.',
  'marinara-archive': 'A Marinara profile archive. Ready to import.',
  'marinara-envelope': 'A Marinara export file. Ready to import.',
  'loose-files':
    'Not a SillyTavern or Marinara folder. Anything importable in it will be taken one file at a time.',
};

export const IMPORT_OPEN_KEY = 'ui.import-open';

/**
 * **Open is the absence of the preference here**, which inverts what `AsStored`
 * and the dock itself do — and the inversion is the point rather than a slip.
 * Those two fold away detail from a surface that is useful without it; this
 * panel *is* the controls, and greeting somebody with a closed fold labelled
 * *Add to your library* would be a surface whose whole content is hidden by
 * default. So `false` is stored and `true` is the absence, and the never-set
 * case still cannot drift from the default because there is still nothing to
 * drift.
 */
export function importOpenFromPrefs(prefs: Record<string, unknown> | undefined): boolean {
  return prefs?.[IMPORT_OPEN_KEY] !== false;
}

/** The patch that records a toggle. `null` deletes, which is what open is. */
export function importOpenPatch(open: boolean): Record<string, unknown> {
  return { [IMPORT_OPEN_KEY]: open ? null : false };
}

export function ImportPanel(): JSX.Element {
  const queryClient = useQueryClient();
  const prefs = usePrefs();
  const patchPrefs = usePatchPrefs();
  const open = importOpenFromPrefs(prefs.data?.prefs);

  /**
   * Whether to offer the folder half at all.
   *
   * **Permissive when the answer is not in yet**, and that asymmetry is the
   * point: the server is the real gate, so showing the controls to somebody who
   * turns out not to hold the grant costs one clear refusal, while hiding them
   * from somebody who does hold it costs them the feature with no way to tell
   * why. Only a positive `none` hides anything.
   */
  const auth = useAuthState();
  const mayReadFolders = auth.data?.account?.capabilities.fileAccess !== 'none';
  const fileInput = useRef<HTMLInputElement | null>(null);
  const folderInput = useRef<HTMLInputElement | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [root, setRoot] = useState('');

  /**
   * What the server said about the folder in the box, if it has been asked.
   *
   * **Asked on blur rather than on each keystroke.** A check is up to
   * thirty-six `stat` calls on somebody else's filesystem, and a half-typed path
   * is not a question worth answering. Cleared as soon as the text changes,
   * because advice about a path that is no longer in the box is worse than none.
   */
  const [checked, setChecked] = useState<
    | { ok: true; verdict: string; suggestions: NearMissOffer[] }
    | { ok: false; message: string }
    | null
  >(null);
  const [checking, setChecking] = useState(false);

  /**
   * Which look is still the current one.
   *
   * **Clicking *Import folder* blurs the path box**, so every sweep is preceded
   * by a look at the same path, and the two are in flight together. Without this
   * the slower one wins: a look that resolves after the sweep replaces the
   * sweep's own advice with an answer about the folder as it was before anything
   * was imported. Bumped by the sweep as well as by each look, so a sweep
   * discards whatever look was in the air when it started.
   */
  const latest = useRef(0);

  /**
   * **A look never writes `error`.** Clicking *Import folder* blurs the path
   * box, so a check always fires just before the sweep does — and if the two
   * shared one error slot, a refusal from the look would land on top of whatever
   * the import had to say, or after it. They are separate questions with
   * separate answers, so they get separate places to put them.
   *
   * A refusal here is itself an answer about the folder rather than a failure of
   * the app: *inside this install's own data* and *not an absolute path* are both
   * worth reading before an import instead of after one.
   */
  const check = async (path: string): Promise<void> => {
    if (path.length === 0) return;
    const mine = ++latest.current;
    setChecking(true);
    try {
      const answer = await api.importInspect(path);
      if (latest.current === mine) setChecked({ ok: true, ...answer });
    } catch (cause) {
      if (latest.current === mine) {
        setChecked({
          ok: false,
          message: cause instanceof Error ? cause.message : 'That folder could not be read.',
        });
      }
    } finally {
      if (latest.current === mine) setChecking(false);
    }
  };

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
    // The input is out of sight, so the name it holds has to be said somewhere:
    // a picker whose choice leaves no trace is one you cannot check before
    // committing to it.
    setChosen(file.name);
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

  /**
   * A folder picked in the browser rather than named on the server
   * ([P4 §7.13]).
   *
   * **Two round trips, and the first one carries no bytes.** The plan step
   * classifies the folder from its names and answers with the files the reader
   * will actually open; only those are uploaded. A SillyTavern tree is mostly
   * chats and backups the importer never opens, so sending all of it to be told
   * so would move gigabytes to learn what a list of names already says.
   *
   * `webkitRelativePath` leads with the picked folder's own name — the browser's
   * way of saying which folder this is — and the importer's paths are relative
   * *inside* the root, the way `settings.json` and `characters/` are. So the
   * first segment comes off, and what is left is exactly what a server-path
   * sweep of the same folder would have walked.
   */
  const onFolder = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const picked = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (picked.length === 0) return;

    const inside = picked.map((file) => ({
      file,
      path: file.webkitRelativePath.split('/').slice(1).join('/'),
    }));

    latest.current += 1;
    setBusy(true);
    setError(null);
    try {
      const plan = await api.importDirectoryPlan(
        inside.map(({ file, path }) => ({ path, bytes: file.size })),
      );
      setChecked({ ok: true, verdict: plan.verdict, suggestions: plan.suggestions });

      const wanted = new Set(plan.wanted);
      const result = await api.importDirectory(
        inside.map(({ path }) => path),
        inside.filter(({ path }) => wanted.has(path)),
      );
      setReport(result.report);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The import failed.');
    } finally {
      setBusy(false);
    }
  };

  const onSweep = async (): Promise<void> => {
    if (root.trim().length === 0) return;
    // Any look still in the air is about to be out of date.
    latest.current += 1;
    setBusy(true);
    setError(null);
    try {
      const result = await api.importSweep(root.trim());
      setReport(result.report);
      // A sweep of the wrong folder succeeds, so the advice matters *more* after
      // one than before: nothing in the report itself says the wrong folder was
      // named.
      setChecked({ ok: true, verdict: result.report.source, suggestions: result.suggestions });
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The import failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    // A plain column, not a landmark: the host supplies the heading and the
    // region, and two nested `Import` regions would make the panel harder to
    // navigate by assistive technology rather than easier.
    <div className="flex flex-col gap-3">
      <Note>
        Cards, lorebooks and presets from SillyTavern or Marinara. Nothing is staged: what imports
        lands in your library, and everything that did not is listed below.
      </Note>

      {/*
        **The controls fold; the review does not.** Collapsing is worth having
        exactly because the report below outlives the form that produced it — a
        three-hundred-row review is what you came back to read, and the path box
        that made it is in the way by then. The report therefore sits outside the
        fold, and closing this leaves it.
      */}
      <details
        open={open}
        onToggle={(event) => {
          // The same guard `AsStored` needs, and for the same reason: React
          // applying the stored preference at mount fires `toggle`, and writing
          // that back would be the panel patching its own state on every render
          // of the page. Only a change of heart patches.
          if (event.currentTarget.open !== open) {
            patchPrefs.mutate(importOpenPatch(event.currentTarget.open));
          }
        }}
      >
        <summary className="cursor-pointer text-sm text-ink-muted hover:text-ink">
          Add to your library
        </summary>

        {/*
          One column, not a row. The dock is 280–640px ([P3.1a]'s bounds), so
          the three controls that sat side by side on the Library page have
          nowhere to sit; `control` is `w-full` and fills whatever width the
          panel has been dragged to.
        */}
        <div className="mt-3 flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <FieldLabel>One file</FieldLabel>
            {/*
              **A real button, and the input behind it.** `<input type="file">`
              renders as the user agent's own widget — a grey control that
              matches nothing else here and reads as text rather than as
              something to press. The input stays for the file dialog and the
              accessible name; `sr-only` hides it from sight but not from
              assistive technology, and the label's `htmlFor` is what makes the
              button's click reach it.
            */}
            <input
              ref={fileInput}
              id="import-file"
              type="file"
              accept=".png,.json,.charx,.seactor"
              onChange={(event) => void onFile(event)}
              disabled={busy}
              className="sr-only"
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="compact"
                disabled={busy}
                onClick={() => fileInput.current?.click()}
              >
                Choose a file…
              </Button>
              {chosen === null ? <Note>No file chosen.</Note> : <Note>{chosen}</Note>}
            </div>
          </div>

          {/*
            **A whole folder, through the browser** — the transport P4 cut and
            [P4 §7.13] restored. It exists beside the server path rather than
            instead of it, because the two serve different people: the sweep is
            for somebody whose browser is on the machine the server runs on and
            who holds an admin-only grant, and this is for everybody else.

            `webkitdirectory` is not in React's attribute types — it is a
            long-standing de-facto standard rather than a specified one — so it
            is spread in. Chrome, Edge, Safari and Firefox all honour it.
          */}
          <div className="flex flex-col gap-2">
            <FieldLabel>Or a folder from this browser</FieldLabel>
            <input
              ref={folderInput}
              id="import-folder"
              type="file"
              multiple
              {...{ webkitdirectory: '' }}
              onChange={(event) => void onFolder(event)}
              disabled={busy}
              className="sr-only"
            />
            <Button
              type="button"
              size="compact"
              className="self-start"
              disabled={busy}
              onClick={() => folderInput.current?.click()}
            >
              Choose a folder…
            </Button>
            <Note>
              Everything in the folder is named, and only the files the importer reads are sent.
            </Note>
          </div>

          {/*
            **The folder half is behind a permission, so it says so rather than
            answering 403.** [05 §4.2.2] gates the sweep on `fileAccess`, which
            defaults to `none` — so for most accounts every control below was a
            form that could only fail, and the failure arrived as a red string
            after the request. [01 §2.2] forbids a control that does nothing;
            offering one that is *guaranteed* to refuse is the same fault with an
            extra round trip. What it cannot do is explain the grant in the
            grantee's own words, because they cannot make it: only an
            administrator can, which is what the sentence says.
          */}
          {mayReadFolders ? null : (
            <Alert tone="neutral">
              Importing from a folder needs a permission this account does not have. An
              administrator can grant it in Settings.
            </Alert>
          )}

          <div className="flex flex-col gap-2" hidden={!mayReadFolders}>
            <FieldLabel htmlFor="import-root">Or a folder on this machine</FieldLabel>
            <input
              id="import-root"
              type="text"
              value={root}
              onChange={(event) => {
                setRoot(event.target.value);
                setChecked(null);
              }}
              onBlur={(event) => void check(event.target.value.trim())}
              placeholder="The full path to a SillyTavern or Marinara data folder"
              className={control}
              disabled={busy}
            />

            {/*
              Where the two applications keep their libraries, described by the
              marks the server actually probes for rather than by an install path
              we would be guessing at. Neither project pins its data directory to
              a fixed place on any operating system, so naming one would be
              inventing it.
            */}
            <Note>
              A SillyTavern folder is the one holding settings.json beside characters/ and worlds/ —
              usually data/default-user inside the SillyTavern directory.
            </Note>
            <Note>A Marinara data folder is the one holding storage/tables/.</Note>

            <Button
              type="button"
              size="compact"
              className="self-start"
              onClick={() => void onSweep()}
              disabled={busy || root.trim().length === 0}
            >
              {busy ? 'Reading…' : 'Import folder'}
            </Button>
          </div>
        </div>
      </details>

      {checking ? <Note role="status">Looking…</Note> : null}

      {checked?.ok === false ? (
        <Alert tone="warning" role="status">
          {checked.message}
        </Alert>
      ) : null}

      {checked?.ok === true ? (
        <div className="flex flex-col gap-2">
          <Note>{VERDICT_LABELS[checked.verdict] ?? checked.verdict}</Note>
          {checked.suggestions.map((offer) => {
            // Bound once rather than asserted twice: a finding with no path is
            // an ordinary answer here, not an impossible one.
            const target = offer.root;
            return (
              <Alert key={offer.situation} tone="warning">
                <p>{sentence(offer.note)}</p>
                {target !== null && (
                  <Button
                    type="button"
                    size="tiny"
                    className="mt-2"
                    disabled={busy}
                    onClick={() => {
                      setRoot(target);
                      void check(target);
                    }}
                  >
                    Use that folder
                  </Button>
                )}
              </Alert>
            );
          })}
        </div>
      ) : null}

      {error !== null ? (
        <Alert tone="error" role="alert">
          {error}
        </Alert>
      ) : null}

      {report !== null && <Report report={report} />}
    </div>
  );
}

/**
 * A control's label, at the one size the dock uses.
 *
 * Not `ui/Field`, which owns its own `<input>` — the file control here is an
 * input the button drives rather than one the field renders, and the path box
 * needs a `blur` handler `Field` does not pass through. So the label is spelled
 * once here instead of the recipe being widened for two callers.
 */
function FieldLabel({ children, htmlFor }: { children: ReactNode; htmlFor?: string }): JSX.Element {
  return (
    <label htmlFor={htmlFor} className="text-sm font-medium text-ink">
      {children}
    </label>
  );
}

/**
 * The review, in a column narrow enough for the dock.
 *
 * **A list rather than the three-column table this was.** File, what happened
 * and the notes do not fit side by side at 280px, and the widest of the three is
 * prose — so at the dock's narrowest the table degenerated into three columns of
 * one word wrapped six times each. The material was never a grid anyway: it is
 * one record per file, which is what a list is for. Nothing numeric lines up
 * across rows, so nothing is lost by stacking.
 *
 * The counts stay a row, because they *are* comparable across entries and there
 * are at most seven of them.
 */
function Report(props: { report: ImportReport }): JSX.Element {
  const counts = Object.entries(props.report.counts).filter(([, value]) => value > 0);

  return (
    <section aria-label="What happened" className="flex flex-col gap-2">
      <SubsectionTitle as="h4">What happened</SubsectionTitle>
      <ul className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-ink-subtle">
        {counts.map(([disposition, count]) => (
          <li key={disposition} title={DISPOSITION_HELP[disposition] ?? ''}>
            <strong className="text-ink">{count}</strong>{' '}
            {DISPOSITION_LABELS[disposition] ?? disposition}
          </li>
        ))}
      </ul>

      <ul className="flex flex-col gap-2 text-sm">
        {props.report.items.map((item) => (
          <li key={item.source} className="border-t border-line pt-2">
            {/* Relative to the folder that was swept, never absolute ([13 §4.1.1]). */}
            <code className="block break-all text-xs text-ink">{item.source}</code>
            <p className="text-ink-subtle">
              {DISPOSITION_LABELS[item.disposition] ?? item.disposition}
            </p>
            {item.notes.map((note, index) => (
              <p key={index} className={note.level === 'warn' ? 'text-ink' : 'text-ink-subtle'}>
                {sentence(note)}
              </p>
            ))}
          </li>
        ))}
      </ul>
    </section>
  );
}
