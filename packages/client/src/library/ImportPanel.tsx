// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type ChangeEvent, type JSX, type ReactNode } from 'react';

import type {
  ImportDestination,
  ImportPreview,
  ImportPreviewBlock,
  ImportPreviewScenario,
  NearMissOffer,
} from '@storyengine/shared';

import { api, type ImportReport } from '../api.js';
import { useAuthState, usePatchPrefs, usePrefs } from '../queries.js';
import { Alert } from '../ui/Alert.js';
import { Button } from '../ui/Button.js';
import { control, disclosure } from '../ui/classes.js';
import { Note, SubsectionTitle } from '../ui/Text.js';
import { sentence } from './note-labels.js';
import { labels } from '../i18n/catalogue.js';

/**
 * The way in — [P4 §1.4](../../../../docs/design/workplan/16-p4-implementation.md)'s review
 * step, rendered.
 *
 * **~~Import commits immediately and the review reports loudly~~ — and which of
 * the two depends on how the file arrived.** §1.4's decision, made against
 * [10 §5]'s original *"let the user fix it before committing"*, rested on three
 * arguments: a staging area is a second library to maintain; dangling references
 * are survivable, visible and non-blocking by stance; and a three-hundred-object
 * sweep gated per-object on a human is not a review, it is a chore.
 *
 * *Narrowed rather than reversed.* All three are arguments about **scale and
 * staging**, and none of them reaches one file somebody just picked out of a
 * dialog. So a **sweep** still commits first and reports — `onFolder` and
 * `onSweep` go straight to `Report` — and **one hand-picked file** reports first
 * and commits on a word. No staging area appears either way: the preview writes
 * nothing and holds nothing, the bytes stay in the browser's own file handle,
 * and the confirm sends them again.
 *
 * The preview renders **outside the fold, where the review renders**, for the
 * reason the fold's own comment gives below: a pending decision that vanishes
 * when somebody collapses the form is worse than one that does not fold.
 *
 * **The sentences are composed here, from classes and params.** The server sends
 * `{ key, params, level }` and never prose ([25 A2d]) — a report stored as
 * English is a bug that only surfaces when somebody changes language. There is
 * no ICU catalogue yet ([P11 §1.3] owns that), so these are the same open-keyed
 * label maps every other class-to-word surface here uses, with the raw key as
 * the fallback: a newer build's class must render as itself rather than as a
 * blank.
 */

/**
 * ***Exported, because a second surface renders the same counts*** —
 * [P12.10](../../../../docs/design/workplan/29-p12-implementation.md).
 *
 * `settings/ImportBackup.tsx` shows the disposition counts of a backup import,
 * and a backup import **is** a sweep — same engine, same vocabulary, same
 * ledger. A copy of this table there would let the two surfaces disagree about
 * what an import did, which is the worst possible thing for them to disagree
 * about; `ImportNotes.tsx` makes exactly that argument about `note-labels.ts`.
 */
export const DISPOSITION_LABELS: Record<string, string> = labels('import.disposition', {
  converted: 'Imported',
  unchanged: 'Already here',
  credential: 'Credential removed',
  recorded: 'Recorded, not imported',
  'by-position': 'Not importable',
  skipped: 'Skipped',
  unrecognised: 'Not recognised',
});

/** What each class means, in the one place a person can read it. */
export const DISPOSITION_HELP: Record<string, string> = labels('import.disposition.help', {
  converted: 'Now in your library.',
  unchanged: 'Identical to what is already here, so nothing was written.',
  credential: 'A connection or password. Removed and never stored.',
  recorded: 'Read and named, but this build has nowhere to put it yet.',
  'by-position': 'There is nothing here for it to become, and there will not be.',
  skipped: 'Deliberately not taken.',
  unrecognised: 'Could not be identified.',
});

/** What the verdict is called, for somebody who did not write the probe table. */
const VERDICT_LABELS: Record<string, string> = labels('import.verdict', {
  sillytavern: 'A SillyTavern library. Ready to import.',
  marinara: 'A Marinara data folder. Ready to import.',
  'marinara-archive': 'A Marinara profile archive. Ready to import.',
  'marinara-envelope': 'A Marinara export file. Ready to import.',
  'loose-files':
    'Not a SillyTavern or Marinara folder. Anything importable in it will be taken one file at a time.',
});

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

/**
 * What a re-import should do about the object already here.
 *
 * **Two choices, not three.** `skip` is a policy the sweep needs, because a
 * three-hundred-object walk has to be able to leave one alone. Offered here it
 * would do nothing Cancel does not, except write a ledger row saying you
 * declined — and [work plan §2.2] forbids a control that does nothing.
 */
type PreviewPolicy = 'replace' | 'keep-both';

/**
 * A pending decision, a finished review, or neither.
 *
 * The union is what makes *the two paths coexist* a fact the types carry: only
 * a hand-picked file can produce the `preview` arm, and a sweep can only
 * produce `report`. Two independent slots would make *both on screen at once* a
 * state somebody could reach by accident.
 */
type Outcome =
  | {
      kind: 'preview';
      file: File;
      preview: ImportPreview;
      onConflict: PreviewPolicy;
      /**
       * What the preview on screen was computed for, or `null` when this file
       * poses no such question.
       *
       * **`null` rather than a default, so nothing is sent for a file with no
       * choice in it.** Every format but one ignores the field, and putting
       * `treatment` on the wire beside a preset would be telling the server an
       * answer to a question it never asked — the sort of noise that later reads
       * as meaning something.
       *
       * Held beside the preview rather than read out of it, because the two go
       * out of step for one render: changing the control re-asks the server, and
       * the answer that comes back is what settles the question.
       */
      destination: ImportDestination | null;
    }
  | { kind: 'report'; report: ImportReport }
  | null;

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
  /**
   * A pending decision, a finished review, or neither — never both.
   *
   * **One union rather than two pieces of state**, because *the two paths
   * coexist* has to be a fact the types carry rather than a convention. A folder
   * sweep can only ever set the `report` arm; a hand-picked file sets `preview`
   * first and `report` after the word is given. Two independent slots would make
   * *a preview and a report on screen together* a state somebody could reach.
   */
  const [outcome, setOutcome] = useState<Outcome>(null);
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
  /**
   * Whether a picker may start something new.
   *
   * **Disabled, not hidden**, while a decision is pending — [10 §1.1] rejects
   * hiding a control to make a screen calmer, and a person who has just been
   * asked a question should be able to see the thing that asked it. What this
   * stops is a second import starting on top of an unanswered one, which would
   * leave the preview on screen describing a file nobody is looking at.
   */
  const pending = busy || outcome?.kind === 'preview';

  const refresh = async (): Promise<void> => {
    await queryClient.resetQueries({ queryKey: ['library'] });
    await queryClient.invalidateQueries({ queryKey: ['import-jobs'] });
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
      /**
       * **A look, not an import** ([10 §5], as amended). The file stays in the
       * browser's own handle and is sent again on confirm; nothing is held here
       * and nothing is written there, which is what keeps this short of the
       * staging area [P4 §1.4] refused.
       */
      const { preview } = await api.importFilePreview(file);
      setOutcome({
        kind: 'preview',
        file,
        preview,
        onConflict: 'replace',
        destination: destinationOf(preview),
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That file could not be read.');
    } finally {
      setBusy(false);
      event.target.value = '';
    }
  };

  /**
   * The same bytes, asked about again under the other reading.
   *
   * **A round trip rather than a local recomputation**, and that is the same
   * claim the preview makes in the first place: the converter is on the server
   * and a client that predicted the answer would be a second implementation of
   * it, drifting. The file is still in the browser's own handle, so this costs a
   * few kilobytes and buys the property that **what the screen says is what the
   * converter says**.
   */
  const reask = async (destination: ImportDestination): Promise<void> => {
    if (outcome?.kind !== 'preview') return;
    setBusy(true);
    setError(null);
    try {
      const { preview } = await api.importFilePreview(outcome.file, destination);
      setOutcome({ ...outcome, preview, destination });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That file could not be read.');
    } finally {
      setBusy(false);
    }
  };

  /** The word, given. The bytes go a second time, and this one writes. */
  const commit = async (): Promise<void> => {
    if (outcome?.kind !== 'preview') return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.importFile(
        outcome.file,
        outcome.onConflict,
        outcome.destination ?? undefined,
      );
      setOutcome({
        kind: 'report',
        report: {
          jobId: 'file',
          source: outcome.file.name,
          items: [result.item],
          counts: { [result.item.disposition]: 1 },
        },
      });
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The import failed.');
    } finally {
      setBusy(false);
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
      setOutcome({ kind: 'report', report: result.report });
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
      setOutcome({ kind: 'report', report: result.report });
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
        <summary className={`${disclosure.quiet} text-sm`}>Add to your library</summary>

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
              disabled={pending}
              className="sr-only"
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="compact"
                disabled={pending}
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
              disabled={pending}
              className="sr-only"
            />
            <Button
              type="button"
              size="compact"
              className="self-start"
              disabled={pending}
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
            answering 403.** [10 §4.2.2] gates the sweep on `fileAccess`, which
            defaults to `none` — so for most accounts every control below was a
            form that could only fail, and the failure arrived as a red string
            after the request. [work plan §2.2] forbids a control that does nothing;
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
              disabled={pending}
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
              disabled={pending || root.trim().length === 0}
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
                    disabled={pending}
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

      {outcome?.kind === 'preview' ? (
        <Preview
          preview={outcome.preview}
          onConflict={outcome.onConflict}
          busy={busy}
          onPolicy={(onConflict) => {
            setOutcome({ ...outcome, onConflict });
          }}
          onDestination={(destination) => void reask(destination)}
          onImport={() => void commit()}
          onCancel={() => {
            setOutcome(null);
            setChosen(null);
          }}
        />
      ) : null}

      {outcome?.kind === 'report' ? <Report report={outcome.report} /> : null}
      <PastImports
        onOpen={(report) => {
          setOutcome({ kind: 'report', report });
        }}
      />
    </div>
  );
}

/**
 * The reviews this account has already seen — [P4 §7.4]'s repair, at the surface.
 *
 * **A report you cannot re-open answered once.** §1.4 asked for the review to be
 * *post-hoc, addressable, structured*; P4.4 shipped the first and third and cut
 * the second, so a three-hundred-object sweep's report lived in this component's
 * state and ended with the page. The server keeps them now, and this is the
 * thing that makes that worth having: the question *what did that import
 * actually do* is asked days later, not while the panel is still open.
 *
 * Rendered as a plain list rather than a route because the report it opens is
 * the one already below it — the same `Report`, so there is one renderer for a
 * review and no second surface to keep in step.
 */
function PastImports(props: { onOpen: (report: ImportReport) => void }): JSX.Element | null {
  const jobs = useQuery({ queryKey: ['import-jobs'], queryFn: () => api.importJobs() });
  const rows = jobs.data?.jobs ?? [];
  if (rows.length === 0) return null;

  return (
    <div className="mt-6 border-t border-line pt-4">
      <h3 className="mb-2 text-sm font-medium text-ink">Earlier imports</h3>
      <ul className="flex flex-col gap-1 text-sm">
        {rows.map((job) => (
          <li key={job.id} className="flex flex-wrap items-baseline gap-2">
            <button
              type="button"
              className="text-ink underline"
              onClick={() => {
                void api.importJob(job.id).then((result) => {
                  props.onOpen(result.report);
                });
              }}
            >
              {job.root}
            </button>
            <span className="text-ink-subtle">
              {job.status === 'refused'
                ? // The refusal class travels in `source` for a refused job, and
                  // it is a class rather than prose — so it goes through the same
                  // label map everything else does.
                  (REFUSAL_LABELS[job.source] ?? job.source)
                : summarise(job.counts)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Why a root was turned away, in words. Open-keyed, like every other map here. */
const REFUSAL_LABELS: Record<string, string> = labels('import.refusal', {
  'live-install': 'That application was running.',
  'unknown-format': 'Written by a newer version than this understands.',
  'ambiguous-root': 'Looked like two applications at once.',
  'unreadable-root': 'Nothing readable there.',
  'inside-data-root': 'Inside this install’s own data directory.',
  'not-absolute': 'Not a full path.',
});

/** “4 imported, 2 already here” — the counts that are not zero, in order. */
function summarise(counts: Record<string, number>): string {
  const parts = Object.entries(counts)
    .filter(([, value]) => value > 0)
    .map(
      ([disposition, value]) =>
        `${String(value)} ${DISPOSITION_LABELS[disposition] ?? disposition}`,
    );
  return parts.length === 0 ? 'Nothing found' : parts.join(', ');
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
            {/* Relative to the folder that was swept, never absolute ([21 §4.1.1]). */}
            <code className="block break-all text-xs text-ink">{item.source}</code>
            <Note>{DISPOSITION_LABELS[item.disposition] ?? item.disposition}</Note>
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

/**
 * What that file would become, before it becomes it.
 *
 * **One dense block rather than a stepper**, which is [10 §1.1]'s rule on the
 * tooling side of the split — *progressive disclosure as a reflex* and
 * *infinite layers of click-through* are both rejected there, and import lives
 * in the dense column by name. The stronger reason is that the steps would be
 * empty: the decisions here are *keep it or not* and, only on a re-import,
 * *replace or keep both*. Everything between is a slideshow of the server's
 * progress, and disclosure has to be earned.
 *
 * **Not a `Dialog`** either. [10 §5] names the failure mode — *a review step,
 * not a modal that dumps* — and a modal would buy nothing mechanically:
 * `size="wide"` is `max-w-lg`, narrower than the dock's own 640px maximum, so
 * it would be a layer that covers the panel with something smaller than the
 * panel.
 *
 * **The 280px problem**, which `Report`'s own docstring solved once and this
 * inherits: at the dock's narrow end a three-column table degenerates, so the
 * blocks are a *list* with the label on its own line. The params stay a table
 * because they are two short columns of comparable values and there are at most
 * eleven of them.
 */
function Preview(props: {
  preview: ImportPreview;
  onConflict: PreviewPolicy;
  busy: boolean;
  onPolicy: (policy: PreviewPolicy) => void;
  onDestination: (destination: ImportDestination) => void;
  onImport: () => void;
  onCancel: () => void;
}): JSX.Element {
  const { preview } = props;
  const object = preview.object;
  const preset = object !== null && object.kind === 'preset' ? object : null;
  const scenario = object !== null && object.kind === 'scenario' ? object : null;

  return (
    <section aria-label="What this would import" className="flex flex-col gap-3">
      <SubsectionTitle as="h4">Before it lands</SubsectionTitle>

      <div className="flex flex-col gap-1 text-sm">
        <code className="block break-all text-xs text-ink">{preview.source}</code>
        <Note>{summary(preview)}</Note>
      </div>

      {scenario !== null ? (
        <div className="flex flex-col gap-2">
          {scenario.cast.length > 0 ? (
            <div className="flex flex-col gap-1">
              <h5 className="text-sm font-medium text-ink">
                {castCountLabel(scenario.cast.length)}
              </h5>
              <Note>{scenario.cast.join(', ')}</Note>
            </div>
          ) : null}

          {/*
            **The control this preview exists for** — [04 §6]'s conflated object,
            offered as the two readings it can be given. Structurally the twin of
            the conflict select below, and deliberately so: the panel already
            teaches *a look, then a word*, and a second shape of question inside
            the same look would be a second thing to learn.

            Changing it re-asks the server rather than recomputing here, so what
            is on screen is always the converter's answer.
          */}
          <div className="flex flex-col gap-1">
            <FieldLabel htmlFor="import-destination">What this should become</FieldLabel>
            <select
              id="import-destination"
              className={control}
              value={scenario.destination}
              disabled={props.busy}
              onChange={(event) => {
                props.onDestination(event.target.value === 'lorebook' ? 'lorebook' : 'treatment');
              }}
            >
              {scenario.alternatives.map((destination) => (
                <option key={destination} value={destination}>
                  {destinationLabel(destination)}
                </option>
              ))}
            </select>
            <Note>{destinationNote(scenario.destination)}</Note>
          </div>
        </div>
      ) : null}

      {preset !== null && preset.blocks.length > 0 ? (
        <div className="flex flex-col gap-1">
          <h5 className="text-sm font-medium text-ink">{blockCountLabel(preset.blocks.length)}</h5>
          <ul className="flex flex-col text-sm">
            {preset.blocks.map((block) => (
              <li key={block.id} className="border-t border-line py-1">
                <span className="text-ink">{block.label}</span>
                <span className="block text-xs text-ink-subtle">{blockLine(block)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {preset !== null && preset.params.length > 0 ? (
        <div className="flex flex-col gap-1">
          <h5 className="text-sm font-medium text-ink">Sampler settings</h5>
          <table className="w-full text-sm">
            <tbody>
              {preset.params.map((param) => (
                <tr key={param.name} className="border-t border-line">
                  <td className="py-1 pe-2 text-ink">{param.name}</td>
                  <td className="py-1 pe-2 text-ink-subtle">{param.value}</td>
                  {/*
                    A word and not a colour. Somebody reading this in greyscale,
                    or not distinguishing the two, still has to be told that a
                    setting they can see does nothing.
                  */}
                  <td className="py-1 text-xs text-ink-subtle">
                    {param.reaches ? '' : 'not sent'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {/*
        Names, never values. A screen that showed what was in the file would show
        a proxy password to whoever was handed the file ([04 §8.4.4]).
      */}
      {preset !== null && preset.compatKeys.length > 0 ? (
        <Note>{compatLabel(preset.compatKeys)}</Note>
      ) : null}

      {preview.notes.length > 0 || preview.advisories.length > 0 ? (
        <ul className="flex flex-col gap-1 text-sm">
          {[...preview.notes, ...preview.advisories].map((note, index) => (
            <li key={index} className={note.level === 'warn' ? 'text-ink' : 'text-ink-subtle'}>
              {sentence(note)}
            </li>
          ))}
        </ul>
      ) : null}

      {preview.reimport === 'changed' ? (
        <div className="flex flex-col gap-1">
          <Alert tone="warning">
            This file has been imported before, and it has changed since.
          </Alert>
          <FieldLabel htmlFor="import-on-conflict">What to do with the one already here</FieldLabel>
          <select
            id="import-on-conflict"
            className={control}
            value={props.onConflict}
            onChange={(event) => {
              props.onPolicy(event.target.value === 'keep-both' ? 'keep-both' : 'replace');
            }}
          >
            <option value="replace">Replace it — the old state stays in its history</option>
            <option value="keep-both">Keep both</option>
          </select>
        </div>
      ) : null}

      {preview.reimport === 'unchanged' ? (
        <Note>This is identical to what is already here, so importing writes nothing.</Note>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="compact"
          onClick={props.onImport}
          disabled={props.busy || preview.object === null}
        >
          Import
        </Button>
        <Button type="button" variant="secondary" size="compact" onClick={props.onCancel}>
          Cancel
        </Button>
      </div>
    </section>
  );
}

/** The one line that says what the file is and what would come of it. */
function summary(preview: ImportPreview): string {
  const object = preview.object;
  if (object === null) return 'Nothing would be imported from this file.';
  if (object.kind === 'sweep') return 'Everything inside would be imported.';
  if (object.kind === 'opaque') return `It would be imported as “${object.name}”.`;
  if (object.kind === 'scenario') return scenarioSummary(object);
  return `It would become a preset called “${object.name}”.`;
}

/**
 * Whole sentences per destination rather than one assembled from parts, on the
 * `userFacing` rule the two label helpers below already state: word order
 * differs between languages, so a sentence built out of fragments is the half
 * of i18n that cannot be retrofitted.
 */
function scenarioSummary(scenario: ImportPreviewScenario): string {
  return scenario.destination === 'lorebook'
    ? `It would become a lorebook called “${scenario.name}”, with its setting and cast as entries.`
    : `It would become a treatment called “${scenario.name}”, with ${String(scenario.cast.length)} of its characters imported beside it.`;
}

/**
 * What the server computed this preview for, or `null` when it had no choice.
 *
 * **Read off the answer rather than assumed**, so the control opens on whatever
 * the converter actually did rather than on what this file guesses it did.
 */
function destinationOf(preview: ImportPreview): ImportDestination | null {
  return preview.object !== null && preview.object.kind === 'scenario'
    ? preview.object.destination
    : null;
}

function castCountLabel(count: number): string {
  return `${String(count)} characters would be imported too`;
}

function destinationLabel(destination: ImportDestination): string {
  return destination === 'lorebook'
    ? 'A lorebook — the setting, to read and to draw on'
    : 'A treatment — how this world is played here';
}

/**
 * What each reading costs, said before the commit rather than in the report.
 *
 * The treatment line names the invariant it bends ([04 §6] — *a Treatment
 * contains no world facts*) because the converter emits a note saying the same
 * thing, and a person meeting that note *after* the import has already had the
 * decision made for them.
 */
function destinationNote(destination: ImportDestination): string {
  return destination === 'lorebook'
    ? 'The opening messages are not carried: a lorebook has nowhere to put them.'
    : 'The setting prose becomes the framing injected every turn. You can move it into a lorebook later.';
}

/** A block's placement and what it fills, in the width a narrow dock has. */
function blockLine(block: ImportPreviewBlock): string {
  const parts: string[] = [block.kind === 'slot' ? `fills ${block.fills ?? 'nothing'}` : 'text'];
  parts.push(block.role);
  parts.push(
    block.at === 'in-history' ? `${String(block.fromEnd ?? 0)} messages back` : 'in sequence',
  );
  if (!block.enabled) parts.push('off');
  if (block.appliesTo.length > 0) parts.push(`only for ${block.appliesTo.join(', ')}`);
  return parts.join(' · ');
}

/**
 * Whole sentences, because half a sentence cannot be translated.
 *
 * Both of these were JSX with the value sitting between two runs of text, which
 * the `userFacing` rule refuses for the reason [work plan §2] gives: word order
 * differs between languages, so a sentence assembled from fragments is the part
 * of i18n that cannot be retrofitted. The value is substituted into one string
 * instead, and the helper owns the whole phrase rather than half of it.
 */
function blockCountLabel(count: number): string {
  return `${String(count)} blocks, in this order`;
}

function compatLabel(keys: readonly string[]): string {
  return `${String(keys.length)} fields this build does not read are kept as they were: ${keys.join(', ')}.`;
}
