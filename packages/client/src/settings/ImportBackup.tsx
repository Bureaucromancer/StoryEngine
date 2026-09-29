// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type JSX } from 'react';

import {
  backupApi,
  errorCode,
  type BackupImportOptions,
  type BackupImportResult,
  type BackupManifest,
  type BackupRecord,
} from '../api.js';
import { formatTimestamp } from '../format.js';
import { DISPOSITION_HELP, DISPOSITION_LABELS } from '../library/ImportPanel.js';
import { sentence } from '../library/note-labels.js';
import { Button } from '../ui/Button.js';
import { CheckboxField, SelectField } from '../ui/Field.js';
import { Panel } from '../ui/Panel.js';
import { Fine, Note, SubsectionTitle } from '../ui/Text.js';

/**
 * ***Bringing an archive's content back into a running account*** —
 * [P12.10](../../../../docs/design/workplan/29-p12-implementation.md).
 *
 * ***The whole surface exists to keep two verbs apart.*** *Import* merges an
 * archive's content into a server that is running; *restore* ([P12.11]) puts an
 * archive back **as** the install and cannot happen while it is. They differ in
 * what they touch and what they can break, so they are two controls with two
 * names rather than one control with a mode — the failure being somebody who
 * clicked *restore* meaning *import* and lost a week.
 *
 * ***One component for both halves, because the difference is two fields.***
 * The admin's import says **which account in the archive** — an install archive
 * holds several, and there is no *all of them*: a handle with no account here
 * would have to be created to receive a library, and an account created from an
 * archive has no password. It also offers the fourth checkbox, settings, which
 * is install-scope by definition. Everything else is the same flow over the
 * same routes, and a second copy of it would be a second place for the
 * defaults-are-off rule to stop being true.
 *
 * ***It reads the manifest before it offers anything***, which is what stands
 * in for the per-object preview the plan asked for. [P4 §1.4] settled that
 * question for every import: a **sweep** commits and reports, because a staging
 * area for three hundred objects is a second library, and `import/preview.ts`
 * is the other case — one hand-picked file. So what a person sees first is the
 * archive's own account of itself: when it was taken, whose accounts are in it
 * and whether it carries credentials. That is what the controls turn on.
 */

/** Whole sentences, one per state, as the sentence-assembly rule requires. */
function archiveLabel(record: BackupRecord): string {
  const when = formatTimestamp(new Date(record.takenAt).toISOString());
  const what = record.contents === 'full' ? 'everything' : 'work only';
  return record.handle === null ? `${when} — the install, ${what}` : `${when} — ${what}`;
}

function takenLine(manifest: BackupManifest): string {
  const by =
    manifest.takenBy.version === null
      ? 'a build that did not record its version'
      : `version ${manifest.takenBy.version}`;
  return `Taken ${formatTimestamp(manifest.takenBy.at)} by ${by}.`;
}

function holdsLine(manifest: BackupManifest): string {
  const files = `${String(manifest.files)} files`;
  if (manifest.handles.length === 0) return `It holds ${files} and no account's work.`;
  if (manifest.handles.length === 1) {
    return `It holds ${files}, all of them ${manifest.handles[0] ?? ''}’s.`;
  }
  return `It holds ${files} belonging to ${String(manifest.handles.length)} accounts.`;
}

function credentialsLine(manifest: BackupManifest): string {
  return manifest.contents === 'full'
    ? 'It carries provider keys. Nothing is taken from it unless you tick the box below.'
    : 'It carries no provider keys, so there are none to bring across.';
}

/**
 * ***Why `skip` is first and is the default.***
 *
 * `sweep` defaults to `replace`, because a re-imported foreign file *is* the
 * object that file produced. A backup meeting a live account is the past
 * meeting the present, and the present is usually the part somebody wants to
 * keep — *bring in what I do not have* is what people mean when they reach for
 * this. All three are offered, because the other two are real answers.
 */
const CONFLICT_OPTIONS: readonly (readonly [string, string])[] = [
  ['skip', 'Leave what is here, and bring in only what is missing'],
  ['keep-both', 'Bring everything in, keeping both copies of anything that clashes'],
  ['replace', 'Let the backup win, and keep what is here in its history'],
];

function conflictHint(policy: string): string {
  if (policy === 'skip') return 'Nothing already in your library is touched.';
  if (policy === 'keep-both') return 'Anything that clashes arrives beside what is here, renamed.';
  return 'The version here is written to the object’s history first, so nothing is lost.';
}

function resultLine(result: BackupImportResult): string {
  const objects = result.report.items.length;
  const sessions = result.sessions.imported;
  return `${String(objects)} library objects and ${String(sessions)} sessions were read.`;
}

/**
 * Why an import did not run.
 *
 * ***By class*** (2026-09-27). This searched the server's English, and two
 * refusals the route sends with their own reason fell through to *could not
 * be run*: an archive that does not hold the account asked for
 * (`unreadable-root`), and one past what an import reads at once
 * (`too-large`), which was reported as unreadable when it is only big. The
 * sweep's refusals of the tree inside (`live-install`, `unknown-format`,
 * `ambiguous-root`) read as the archive not being readable, which is what the
 * route says of them too.
 */
function failureLine(error: unknown): string {
  switch (errorCode(error)) {
    case 'no-such-account':
      return 'This install has no account with that handle, and an import does not create one.';
    case 'unreadable-root':
      return 'That archive does not hold the account you asked for.';
    case 'too-large':
      return 'That archive holds more than an import reads in one go.';
    case 'unreadable':
    case 'unsafe-path':
    case 'live-install':
    case 'unknown-format':
    case 'ambiguous-root':
      return 'That archive could not be read.';
    default:
      return 'That import could not be run.';
  }
}

export function ImportBackup(props: {
  scope: 'account' | 'install';
  rows: readonly BackupRecord[];
}): JSX.Element | null {
  const client = useQueryClient();
  const install = props.scope === 'install';
  const [chosen, setChosen] = useState<string>('');
  const [handle, setHandle] = useState<string>('');
  const [policy, setPolicy] = useState<string>('skip');
  const [options, setOptions] = useState<BackupImportOptions>({});
  const [confirming, setConfirming] = useState(false);

  const manifest = useQuery({
    queryKey: ['backups', props.scope, chosen, 'manifest'],
    queryFn: () =>
      install ? backupApi.readInstallManifest(chosen) : backupApi.readMineManifest(chosen),
    enabled: chosen !== '',
  });

  const run = useMutation({
    mutationFn: () =>
      install
        ? backupApi.importInstall({
            id: chosen,
            handle,
            onConflict: policy as 'skip' | 'replace' | 'keep-both',
            options,
          })
        : backupApi.importMine({
            id: chosen,
            onConflict: policy as 'skip' | 'replace' | 'keep-both',
            options,
          }),
    onSuccess: () => {
      setConfirming(false);
      /**
       * ***The library is stale the moment this returns***, and so is the
       * import ledger — the objects arrived through `sweep`, so they are in the
       * same list every other import writes to. Invalidating broadly is right
       * here: an import touches more of the cache than it is worth enumerating,
       * and it happens once.
       */
      void client.invalidateQueries();
    },
  });

  /**
   * ***Absent when there is nothing to import, rather than disabled.*** An
   * account with no archives has no question to answer, and a control that
   * cannot do anything is a control somebody has to work out the reason for.
   */
  if (props.rows.length === 0) return null;

  const held = manifest.data?.manifest;
  const handles = held?.handles ?? [];
  const ready = chosen !== '' && held !== undefined && (!install || handle !== '');

  return (
    <section className="mt-4 flex flex-col gap-3 border-t border-line pt-4">
      <SubsectionTitle as="h4">Import from a backup</SubsectionTitle>
      <Fine>
        This brings a backup’s library, sessions and tags into this server alongside what is already
        here. It is not a restore: nothing is replaced wholesale, and accounts, sign-ins and the
        search index are untouched.
      </Fine>

      <SelectField
        label="Which backup"
        value={chosen}
        options={[
          ['', 'Choose one…'],
          ...props.rows.map((row) => [row.id, archiveLabel(row)] as const),
        ]}
        onChange={(value) => {
          setChosen(value);
          setHandle('');
          setConfirming(false);
          run.reset();
        }}
      />

      {chosen === '' ? null : manifest.isPending ? (
        <Note>Reading that archive…</Note>
      ) : manifest.isError || held === undefined ? (
        <p role="alert" className="text-danger-ink">
          That archive could not be read.
        </p>
      ) : (
        <Panel variant="inset">
          <div className="flex flex-col gap-1">
            <Fine>{takenLine(held)}</Fine>
            <Fine>{holdsLine(held)}</Fine>
            <Fine>{credentialsLine(held)}</Fine>
            {/*
             * What the archive says it left out, in the shared note vocabulary
             * rather than prose ([25 A2d]) — the same sentences the review
             * below renders, from the same table.
             */}
            {held.omitted.map((note, index) => (
              <Fine key={`${note.key}:${String(index)}`}>{sentence(note)}</Fine>
            ))}
          </div>
        </Panel>
      )}

      {held === undefined ? null : (
        <>
          {/**
           * ***The admin says which account, and the list is the archive's.***
           * Offering this install's accounts instead would offer handles the
           * archive has nothing for; offering a text box would make a typo
           * indistinguishable from an account that is not in there.
           */}
          {install ? (
            <SelectField
              label="Whose work in the backup"
              value={handle}
              options={[
                ['', 'Choose an account…'],
                ...handles.map((name) => [name, name] as const),
              ]}
              onChange={setHandle}
              hint="It lands in the account of the same name on this install. An account is never created from an archive — one has no password."
            />
          ) : null}

          <SelectField
            label="When something is already here"
            value={policy}
            options={CONFLICT_OPTIONS}
            onChange={(value) => {
              setPolicy(value);
              setConfirming(false);
            }}
            hint={conflictHint(policy)}
          />

          {/**
           * ***Work and tags always; the rest is a box somebody ticked.***
           * Library objects and sessions are what a person means by *my stuff*,
           * and tags travel with them because objects reference tags by id —
           * an import without them would leave every imported object pointing
           * at names that resolve to nothing. The rest are off by default
           * because an archive is a file somebody may have been handed.
           */}
          <fieldset className="border-0 p-0">
            <legend className="text-xs font-medium tracking-wide text-ink-faint uppercase">
              Also bring across
            </legend>
            <div className="mt-2 flex flex-col gap-2">
              <CheckboxField
                label="Provider connections"
                checked={options.connections === true}
                disabled={held.contents !== 'full'}
                onChange={(checked) => {
                  setOptions((was) => ({ ...was, connections: checked }));
                  setConfirming(false);
                }}
                hint={
                  held.contents === 'full'
                    ? 'A connection already set up here is kept, never pointed somewhere else.'
                    : 'This backup carries none.'
                }
              />
              <CheckboxField
                label="Preferences"
                checked={options.prefs === true}
                onChange={(checked) => {
                  setOptions((was) => ({ ...was, prefs: checked }));
                  setConfirming(false);
                }}
                hint="Merged one key at a time, and a preference already set here wins."
              />
              {install ? (
                <CheckboxField
                  label="Install settings"
                  checked={options.config === true}
                  onChange={(checked) => {
                    setOptions((was) => ({ ...was, config: checked }));
                    setConfirming(false);
                  }}
                  hint="The data directory and the client folder are refused by name: both are paths on the machine the archive came from."
                />
              ) : null}
            </div>
          </fieldset>

          {/**
           * ***Two steps, on `DeleteObject.tsx`'s pattern, because this writes
           * to a live account.*** It is not destructive under `skip` and it is
           * recoverable under `replace` — history keeps what was here — but
           * *recoverable* is not *unremarkable*, and the second sentence is
           * where a person reads which of the three they picked.
           */}
          <div className="flex flex-wrap items-center gap-3">
            {confirming ? (
              <>
                <Button
                  type="button"
                  variant="primary"
                  disabled={run.isPending}
                  onClick={() => {
                    run.mutate();
                  }}
                >
                  Import it
                </Button>
                <Button
                  type="button"
                  onClick={() => {
                    setConfirming(false);
                  }}
                >
                  Cancel
                </Button>
                <Fine>{conflictHint(policy)}</Fine>
              </>
            ) : (
              <Button
                type="button"
                disabled={!ready || run.isPending}
                onClick={() => {
                  setConfirming(true);
                }}
              >
                Import from this backup
              </Button>
            )}
          </div>
        </>
      )}

      {run.isError ? (
        <p role="alert" className="text-danger-ink">
          {failureLine(run.error)}
        </p>
      ) : null}

      {run.data === undefined ? null : <Review result={run.data} />}
    </section>
  );
}

/**
 * What the import did, in the vocabulary every other import already uses.
 *
 * ***The notes are rendered from `note-labels.ts` rather than from prose the
 * server sent***, which is [25 A2d] and not a style preference: a report stored
 * as English is a bug that surfaces the day somebody changes language. The
 * groups that were **not** taken are in this list too — *my keys did not come
 * across* is a question with an answer rather than a bug report.
 */
function Review(props: { result: BackupImportResult }): JSX.Element {
  const counts = Object.entries(props.result.report.counts).filter(([, value]) => value > 0);

  return (
    <section aria-label="What the import did" className="flex flex-col gap-2">
      <SubsectionTitle as="h4">What the import did</SubsectionTitle>
      <Fine>{resultLine(props.result)}</Fine>
      <ul className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-ink-subtle">
        {counts.map(([disposition, count]) => (
          <li key={disposition} title={DISPOSITION_HELP[disposition] ?? ''}>
            <strong className="text-ink">{count}</strong>{' '}
            {DISPOSITION_LABELS[disposition] ?? disposition}
          </li>
        ))}
      </ul>
      <ul className="flex flex-col gap-1 text-sm text-ink-muted">
        {props.result.notes.map((note, index) => (
          <li key={`${note.key}:${String(index)}`}>{sentence(note)}</li>
        ))}
      </ul>
    </section>
  );
}
