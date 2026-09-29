// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type JSX } from 'react';

import { backupApi, errorCode, type BackupRecord, type BackupSettings } from '../api.js';
import { formatTimestamp } from '../format.js';
import { Button } from '../ui/Button.js';
import { CheckboxField, SelectField } from '../ui/Field.js';
import { link } from '../ui/classes.js';
import { Fine, Note, SectionTitle } from '../ui/Text.js';
import { ImportBackup } from './ImportBackup.js';

/**
 * ***A copy of your work you can take away*** —
 * [25 E6](../../../../docs/design/25-open-questions.md),
 * [P12.6](../../../../docs/design/workplan/29-p12-implementation.md).
 *
 * ***In Settings beside the trash, and for the trash's reason***: it holds
 * sessions as well as library objects, so a drawer inside the library would be
 * a library surface answering about something that is not a library object.
 * *And nobody comes here to browse* — they come because they want one file.
 *
 * ***The schedule form is absent without the capability rather than
 * disabled***, which is `SettingsPage.tsx`'s own mechanism: the hook never
 * mounts, so that browser issues no request to be refused, and nobody who has
 * done nothing wrong reads an error. **Taking one is never gated** — it is a
 * person asking for a copy of what they wrote — so the button above is there
 * for everybody.
 */

/** Whole sentences, one per state, as the sentence-assembly rule requires. */
function emptyLine(): string {
  return 'You have not taken a backup yet.';
}

function storedLine(count: number, bytes: number): string {
  if (count === 1) return `One backup, taking ${megabytes(bytes)}.`;
  return `${String(count)} backups, taking ${megabytes(bytes)} between them.`;
}

export function megabytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * ***What is in the file, said before somebody puts it somewhere else.***
 *
 * A full archive carries the provider keys this account has configured. That is
 * what makes it restorable, and it is also the sentence that makes `redacted`
 * worth offering — a person choosing where to keep a backup is choosing what
 * they are handing over with it.
 */
function contentsLine(contents: 'full' | 'redacted'): string {
  return contents === 'full'
    ? 'Everything, including your provider keys.'
    : 'Your work, without your provider keys.';
}

function whenLine(record: BackupRecord): string {
  return `Taken ${formatTimestamp(new Date(record.takenAt).toISOString())}.`;
}

function scheduleHint(settings: BackupSettings): string {
  if (settings.frequency === 'off' && !settings.onStart) {
    return 'The server takes no backups for you. You can still take one yourself above.';
  }
  if (settings.frequency === 'off') {
    return 'The server takes one each time it starts, and at no other time.';
  }
  const every = settings.frequency === 'daily' ? 'each day' : 'each week';
  return settings.onStart
    ? `The server takes one ${every}, and again each time it starts.`
    : `The server takes one ${every}. If the machine is off when it is due, it is taken next time the server runs.`;
}

/**
 * Why a backup was not taken, for either half — the admin panel shows the same
 * line.
 *
 * ***The class, not the words*** (2026-09-27). This looked for `space` in the
 * message, and the take route had no refusal that said it: a full disk was the
 * error handler's bare 500, *The request failed.*, so the sentence below could
 * never be reached. The route answers `507 no-space` now, and the class is what
 * is read, so rewording the server's sentence cannot move this one.
 */
export function takeFailure(error: unknown): string {
  return errorCode(error) === 'no-space'
    ? 'There was not enough room on the disk for that backup.'
    : 'That backup could not be taken.';
}

export function Backups(props: { capable: boolean }): JSX.Element {
  const client = useQueryClient();
  const listing = useQuery({ queryKey: ['backups', 'me'], queryFn: backupApi.readMine });
  const [contents, setContents] = useState<'full' | 'redacted'>('full');
  const [confirming, setConfirming] = useState<string | null>(null);

  const take = useMutation({
    mutationFn: () => backupApi.takeMine(contents),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['backups', 'me'] });
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => backupApi.deleteMine(id),
    onSuccess: () => {
      setConfirming(null);
      void client.invalidateQueries({ queryKey: ['backups', 'me'] });
    },
  });

  const rows = listing.data?.backups ?? [];

  return (
    <section className="flex flex-col gap-3" aria-labelledby="backups">
      <SectionTitle id="backups">Backups</SectionTitle>
      <Fine>
        A backup is one file holding your library and your sessions. It is kept on this server —
        copy it somewhere else for it to be a real backup.
      </Fine>

      <div className="flex flex-wrap items-end gap-3">
        <SelectField
          label="What to include"
          value={contents}
          options={[
            ['full', 'Everything, including my provider keys'],
            ['redacted', 'My work, without my provider keys'],
          ]}
          onChange={(value) => {
            setContents(value as 'full' | 'redacted');
          }}
        />
        <Button
          type="button"
          variant="primary"
          disabled={take.isPending}
          onClick={() => {
            take.mutate();
          }}
        >
          Back up now
        </Button>
      </div>

      {take.isError ? (
        <p role="alert" className="text-danger-ink">
          {takeFailure(take.error)}
        </p>
      ) : null}
      {remove.isError ? (
        <p role="alert" className="text-danger-ink">
          That backup could not be deleted.
        </p>
      ) : null}

      {listing.isPending ? <Note>Loading…</Note> : null}
      {listing.isError ? <p role="alert">Your backups could not be read.</p> : null}
      {!listing.isPending && rows.length === 0 ? <Note>{emptyLine()}</Note> : null}

      {rows.length === 0 ? null : (
        <>
          <Fine>{storedLine(rows.length, listing.data?.totalBytes ?? 0)}</Fine>
          <ul className="flex flex-col gap-2">
            {rows.map((row) => (
              <li
                key={row.id}
                className="flex flex-wrap items-center gap-3 rounded-panel border border-line p-3"
              >
                <span className="text-ink">{whenLine(row)}</span>
                <Fine>{contentsLine(row.contents)}</Fine>
                <Fine>{megabytes(row.bytes)}</Fine>
                <a
                  href={`/api/me/backups/${row.id}/download`}
                  className={`${link.inline} ms-auto`}
                  download
                >
                  Download
                </a>
                {/**
                 * ***Two steps rather than a modal***, on `DeleteObject.tsx`'s
                 * pattern — and **Delete first, Cancel last**, so the button
                 * that answers the question is not the pixels the question was
                 * asked from. A second click that arrives before the eye has
                 * caught up lands on the harmless answer.
                 *
                 * *And unlike an object, this one does not go to the trash.*
                 * The sentence says so, because *delete* reads as *recoverable*
                 * everywhere else in this build.
                 */}
                {confirming === row.id ? (
                  <>
                    <Button
                      type="button"
                      variant="danger"
                      size="compact"
                      disabled={remove.isPending}
                      onClick={() => {
                        remove.mutate(row.id);
                      }}
                    >
                      Delete this file
                    </Button>
                    <Button
                      type="button"
                      size="compact"
                      onClick={() => {
                        setConfirming(null);
                      }}
                    >
                      Cancel
                    </Button>
                  </>
                ) : (
                  <Button
                    type="button"
                    variant="dangerOutline"
                    size="compact"
                    onClick={() => {
                      setConfirming(row.id);
                    }}
                  >
                    Delete
                  </Button>
                )}
              </li>
            ))}
          </ul>
          {confirming === null ? null : (
            <Fine>This one does not go to the trash. The file is removed from the server.</Fine>
          )}
        </>
      )}

      {props.capable ? <Schedule /> : null}

      {/**
       * ***After the schedule, because it is the rarer act.*** Taking one is
       * something somebody does deliberately and often; importing one is what
       * they do after something went wrong, and burying the everyday controls
       * under a flow for a bad day is the wrong way round. It renders nothing
       * at all when there is nothing to import from.
       */}
      <ImportBackup scope="account" rows={rows} />
    </section>
  );
}

/**
 * ***Only rendered for an account an administrator has enabled it for.***
 *
 * The guard is the parent's, and it is not the security boundary — that is the
 * route, which refuses with `no-scheduled-backups`. What this buys is that a
 * person without the capability sees no control and their browser makes no
 * request: [09 §4.5]'s argument, and `SettingsPage.tsx`'s own mechanism.
 */
function Schedule(): JSX.Element {
  const client = useQueryClient();
  const stored = useQuery({
    queryKey: ['backups', 'me', 'settings'],
    queryFn: backupApi.readSettings,
  });
  const save = useMutation({
    mutationFn: (settings: BackupSettings) => backupApi.writeSettings(settings),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['backups', 'me', 'settings'] });
    },
  });

  const settings = stored.data?.settings;
  if (settings === undefined) return <Note>Loading…</Note>;

  const change = (patch: Partial<BackupSettings>): void => {
    save.mutate({ ...settings, ...patch });
  };

  return (
    <fieldset className="mt-2 border-0 p-0">
      <legend className="text-xs font-medium tracking-wide text-ink-faint uppercase">
        Automatically
      </legend>
      <div className="mt-2 flex flex-col gap-3">
        <SelectField
          label="How often"
          value={settings.frequency}
          options={[
            ['off', 'Never'],
            ['daily', 'Every day'],
            ['weekly', 'Every week'],
          ]}
          onChange={(value) => {
            change({ frequency: value as BackupSettings['frequency'] });
          }}
        />
        {/**
         * ***Independent of the frequency rather than a value in it*** — [P12]
         * §1.4. A machine that is only on for an hour at a time may never meet
         * a fixed frequency; one that is usually on but occasionally rebooted
         * wants both, and a single list cannot say so.
         */}
        <CheckboxField
          label="Also whenever the server starts"
          checked={settings.onStart}
          onChange={(checked) => {
            change({ onStart: checked });
          }}
          hint="For a machine that is not on all the time. One is skipped if your newest backup is under an hour old."
        />
        <SelectField
          label="What to include"
          value={settings.contents}
          options={[
            ['full', 'Everything, including my provider keys'],
            ['redacted', 'My work, without my provider keys'],
          ]}
          onChange={(value) => {
            change({ contents: value as BackupSettings['contents'] });
          }}
        />
        <Fine>{scheduleHint(settings)}</Fine>
        <Fine>
          Nothing removes old backups yet. They are listed above, and deleting them is yours to do.
        </Fine>
        {save.isError ? (
          <p role="alert" className="text-danger-ink">
            That schedule could not be saved.
          </p>
        ) : null}
      </div>
    </fieldset>
  );
}
