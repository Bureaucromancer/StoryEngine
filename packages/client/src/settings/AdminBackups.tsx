// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type JSX } from 'react';

import { backupApi, errorCode, type BackupManifest, type BackupRecord } from '../api.js';
import { formatTimestamp } from '../format.js';
import { useNotices } from '../queries.js';
import { Button } from '../ui/Button.js';
import { Dialog } from '../ui/Dialog.js';
import { Field, SelectField } from '../ui/Field.js';
import { link } from '../ui/classes.js';
import { Fine, Note } from '../ui/Text.js';
import { megabytes, takeFailure } from './Backups.js';
import { ImportBackup } from './ImportBackup.js';

/**
 * ***The install's own backup*** —
 * [25 E6](../../../../docs/design/25-open-questions.md),
 * [P12.6](../../../../docs/design/workplan/29-p12-implementation.md).
 *
 * ***A list and two buttons, and no schedule form.*** The install's schedule is
 * `backup.frequency`, `backup.onStart` and `backup.contents` in `config.json`,
 * and the settings form below derives its controls from the schema — so the
 * schedule ships with the keys and a second copy of it here would be a second
 * thing to keep true.
 *
 * ***It is not a dashboard.*** [10 §15.4](../../../../docs/design/10-ui-surfaces.md)
 * sets the bar for a panel here: an administrator has an *action*. There are
 * three — take one, take it away, delete one — and the only number shown is the
 * one the third acts on.
 *
 * **A separate panel from the user's rather than a mode of it**, because the
 * warning is different in kind: an install archive carries everybody's work,
 * everybody's password hashes and the key that validates every session.
 */

function whenLine(record: BackupRecord): string {
  return `Taken ${formatTimestamp(new Date(record.takenAt).toISOString())}.`;
}

/**
 * ***What is in it, said before an administrator puts it on a NAS.***
 *
 * The user's panel names provider keys. This one has to name the hashes and the
 * session key as well, because they are other people's and the person choosing
 * where the file goes is not the person whose password is in it.
 */
function contentsLine(contents: 'full' | 'redacted'): string {
  return contents === 'full'
    ? 'Everything: every account’s work, their password hashes and the session key.'
    : 'Every account’s work, without accounts, connections or the session key.';
}

function storedLine(count: number, bytes: number): string {
  if (count === 1) return `One archive, taking ${megabytes(bytes)}.`;
  return `${String(count)} archives, taking ${megabytes(bytes)} between them.`;
}

export function AdminBackups(): JSX.Element {
  const client = useQueryClient();
  const listing = useQuery({ queryKey: ['admin', 'backups'], queryFn: backupApi.readInstall });
  const [contents, setContents] = useState<'full' | 'redacted'>('full');
  const [confirming, setConfirming] = useState<string | null>(null);

  const take = useMutation({
    mutationFn: () => backupApi.takeInstall(contents),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['admin', 'backups'] });
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => backupApi.deleteInstall(id),
    onSuccess: () => {
      setConfirming(null);
      void client.invalidateQueries({ queryKey: ['admin', 'backups'] });
    },
  });

  const rows = listing.data?.backups ?? [];

  return (
    <section className="flex flex-col gap-3" aria-labelledby="install-backups">
      <h3 id="install-backups" className="text-subsection text-ink">
        Backups
      </h3>
      <Fine>
        One file holding the whole data directory — every account, the settings and the operational
        store, but not the search index, which is rebuilt on the next start. Copy it off this
        machine for it to be a real backup.
      </Fine>

      <div className="flex flex-wrap items-end gap-3">
        <SelectField
          label="What to include"
          value={contents}
          options={[
            ['full', 'Everything, including accounts and keys'],
            ['redacted', 'Work only, no accounts or keys'],
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

      <Fine>
        A backup taken while the server is running is consistent: the operational store is
        snapshotted, and every other write is atomic. A session being written at that moment may
        lose its last, incomplete turn.
      </Fine>

      {/* The same line as the account half, full disk included (2026-09-27):
          the admin take reaches the same route code and had no sentence for
          it at all. */}
      {take.isError ? (
        <p role="alert" className="text-danger-ink">
          {takeFailure(take.error)}
        </p>
      ) : null}
      {remove.isError ? (
        <p role="alert" className="text-danger-ink">
          That archive could not be deleted.
        </p>
      ) : null}

      {listing.isPending ? <Note>Loading…</Note> : null}
      {listing.isError ? <p role="alert">The backups could not be read.</p> : null}
      {!listing.isPending && rows.length === 0 ? (
        <Note>This install has no backups yet.</Note>
      ) : null}

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
                  href={`/api/admin/backups/${row.id}/download`}
                  className={`${link.inline} ms-auto`}
                  download
                >
                  Download
                </a>
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

      {/**
       * ***The install's import, which says whose work as well as which
       * archive.*** An install archive holds every account, and there is no
       * *all of them* arm: a handle with no account here would have to be
       * created to receive a library, and **an account created from an archive
       * has no password** — who may sign in is not a thing an archive gets to
       * decide.
       */}
      <ImportBackup scope="install" rows={rows} />

      {/**
       * ***Last, and inside its own border.*** Import is above because it is
       * the one people reach for; restore is below because it replaces
       * everything, and the order on the page is the order of how much they
       * cost to get wrong.
       */}
      <Restore rows={rows} />
    </section>
  );
}

/**
 * ***Putting this install back as an archive*** —
 * [P12.13](../../../../docs/design/workplan/29-p12-implementation.md).
 *
 * ***Visually apart from the list above, and that is the design rather than
 * layout.*** Everything above this line adds to what is on the disk; this
 * replaces it. A control that sat in the same row as *Download* would be a
 * destructive act wearing the clothes of a routine one — which is the whole
 * reason [P12] insisted the two verbs have two names.
 *
 * ***Absent where nothing would restart the process***, with a sentence giving
 * the shell command instead. That is `SettingsPage.tsx`'s own mechanism and
 * [09 §6.4]'s trap avoided in the same breath: *a bare `node server.js` will
 * simply exit and the admin who clicked the button now has no server*. The
 * route refuses it too — the surface is never the boundary — but a person who
 * has done nothing wrong should not have to read an error to find that out.
 *
 * ***Typing the words is the confirmation***, on `AdminAccounts.tsx`'s
 * `RemoveDialog` pattern and for its stated reason: *a destructive control
 * whose confirmation is a second button is a control people click twice*. This
 * is the most destructive control in the build, so it takes the strongest
 * confirmation the build has.
 */
function Restore(props: { rows: readonly BackupRecord[] }): JSX.Element | null {
  const notices = useNotices(true);
  const [chosen, setChosen] = useState<string>('');
  const [confirming, setConfirming] = useState(false);

  const supervision = notices.data?.supervision ?? 'none';
  const canRestart = notices.data?.canRestart === true;

  const manifest = useQuery({
    queryKey: ['admin', 'backups', chosen, 'manifest'],
    queryFn: () => backupApi.readInstallManifest(chosen),
    enabled: chosen !== '',
  });

  const restore = useMutation({
    mutationFn: (acceptRedacted: boolean) => backupApi.restoreInstall(chosen, acceptRedacted),
  });

  const client = useQueryClient();
  const cancel = useMutation({
    mutationFn: () => backupApi.cancelRestore(),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['admin', 'notices'] });
    },
  });

  /**
   * ***Stopping, until a new process answers*** (2026-09-28). `restore.isSuccess`
   * outlived the restart it reported, so on the tab that asked, a restore that
   * failed as it started kept saying *The server is stopping* and hid *Call it
   * off* — the one control that state needs, on an install whose premise is
   * that nobody has a shell. It holds until the server has answered since the
   * press, and while that answer says it is still draining: the old process
   * wrote the marker before it began to drain, so it reports the restore as
   * pending too, and that is not yet a failure to call off.
   */
  const stopping =
    restore.isSuccess &&
    (notices.dataUpdatedAt <= restore.submittedAt || notices.data?.draining === true);

  if (props.rows.length === 0) return null;

  const held = manifest.data?.manifest;

  return (
    <section
      className="mt-6 flex flex-col gap-3 rounded-panel border border-danger-line p-4"
      aria-labelledby="restore-install"
    >
      <h4 id="restore-install" className="text-subsection text-danger-ink">
        Restore this install
      </h4>
      <Fine>
        This replaces the whole data directory with an archive — every account, every library, the
        settings and the operational store. It is not an import: nothing is merged, and what is here
        now is set aside rather than blended with what arrives.
      </Fine>
      <Fine>
        The server stops, and restores as it starts again. What is here now is kept in the data
        directory’s <code>.restore</code> folder and never deleted, which is how a restore is
        undone. The stored backups stay where they are.
      </Fine>

      {/**
       * ***A marker the next start will act on, or has refused to.***
       *
       * A restore that **worked** leaves none — the marker lived in the
       * directory the swap moved aside — so seeing this after a restart always
       * means something went wrong, and the notice that says what went wrong
       * arrives in the same breath. This is the control that notice implies:
       * without it, a failed restore is a state a person can read about and
       * cannot leave, on an install whose whole premise is that nobody has a
       * shell.
       */}
      {notices.data?.restorePending === true && !stopping ? (
        <div className="flex flex-wrap items-center gap-3 rounded-panel bg-warn-surface p-3">
          <p className="text-sm text-warn-ink">
            A restore is waiting for the next start. If it has already been tried and failed, it
            will not be tried again.
          </p>
          <Button
            type="button"
            size="compact"
            className="ms-auto"
            disabled={cancel.isPending}
            onClick={() => {
              cancel.mutate();
            }}
          >
            Call it off
          </Button>
        </div>
      ) : null}

      {/**
       * ***The absent control, and the sentence that replaces it.*** Not a
       * disabled button: a person without a supervisor has a real way to do
       * this and it is a shell command, so the surface says what it is rather
       * than showing them a control that would refuse.
       */}
      {!canRestart ? (
        <p className="text-sm text-warn-ink">{unsupervisedLine(supervision)}</p>
      ) : (
        <>
          <SelectField
            label="Which archive to become"
            value={chosen}
            options={[
              ['', 'Choose one…'],
              ...props.rows.map((row) => [row.id, restoreLabel(row)] as const),
            ]}
            onChange={(value) => {
              setChosen(value);
              setConfirming(false);
              restore.reset();
            }}
          />
          {held === undefined ? null : <Fine>{archiveLine(held)}</Fine>}
          {held?.contents === 'redacted' ? (
            <p className="text-sm text-warn-ink">
              This archive carries no accounts, no connections and no session key. Restoring it
              leaves an install nobody can sign into, which has to be set up from scratch.
            </p>
          ) : null}
          <div>
            <Button
              type="button"
              variant="dangerOutline"
              disabled={chosen === '' || held === undefined || restore.isPending || stopping}
              onClick={() => {
                setConfirming(true);
              }}
            >
              Restore this install…
            </Button>
          </div>
        </>
      )}

      {restore.isError ? (
        <p role="alert" className="text-danger-ink">
          {restoreFailure(restore.error)}
        </p>
      ) : null}
      {stopping ? (
        <p role="status" className="text-warn-ink">
          The server is stopping. It will restore this archive as it starts again, and the page will
          come back on its own.
        </p>
      ) : null}

      {confirming && held !== undefined ? (
        <Dialog
          role="alertdialog"
          labelledBy="confirm-restore"
          size="wide"
          onDismiss={() => {
            setConfirming(false);
          }}
        >
          <h4 id="confirm-restore" className="text-subsection text-ink">
            Replace everything with this archive?
          </h4>
          <p className="text-sm text-ink-muted">{replacesLine(held)}</p>
          <p className="text-sm text-ink-muted">
            What is here now is moved aside on the server and kept. StoryEngine will not delete it —
            remove that folder yourself when you are sure.
          </p>
          <ConfirmByTyping
            onConfirm={() => {
              restore.mutate(held.contents === 'redacted');
              setConfirming(false);
            }}
            onCancel={() => {
              setConfirming(false);
            }}
          />
        </Dialog>
      ) : null}
    </section>
  );
}

/**
 * The word, typed back.
 *
 * ***Its own component so the dialog above reads as the decision rather than as
 * the mechanics of taking it***, and because the confirmed word is state that
 * has to be thrown away when the dialog closes — which a local `useState` in
 * the parent would not do.
 */
function ConfirmByTyping(props: { onConfirm: () => void; onCancel: () => void }): JSX.Element {
  const [typed, setTyped] = useState('');
  return (
    <>
      <Field label="Type restore to confirm" value={typed} onChange={setTyped} />
      <div className="flex justify-end gap-2">
        <Button type="button" size="compact" onClick={props.onCancel}>
          Cancel
        </Button>
        <Button
          type="button"
          variant="danger"
          size="compact"
          disabled={typed.trim().toLowerCase() !== 'restore'}
          onClick={props.onConfirm}
        >
          Stop the server and restore
        </Button>
      </div>
    </>
  );
}

/** Whole sentences, one per state, as the sentence-assembly rule requires. */
function unsupervisedLine(supervision: 'systemd' | 'declared' | 'none'): string {
  if (supervision !== 'none') {
    return 'This server cannot stop itself from here. Restore from a shell with `pnpm backup restore <archive> <data directory>`.';
  }
  return 'Nothing would start this server again if it stopped, so it will not restore itself. Stop it, run `pnpm backup restore <archive> <data directory>`, and start it again.';
}

function restoreLabel(record: BackupRecord): string {
  const when = formatTimestamp(new Date(record.takenAt).toISOString());
  return record.contents === 'full'
    ? `${when} — everything, ${megabytes(record.bytes)}`
    : `${when} — work only, ${megabytes(record.bytes)}`;
}

function archiveLine(manifest: BackupManifest): string {
  const by =
    manifest.takenBy.version === null
      ? 'a build that did not record its version'
      : `version ${manifest.takenBy.version}`;
  return `Taken ${formatTimestamp(manifest.takenBy.at)} by ${by}, holding ${String(manifest.files)} files.`;
}

function replacesLine(manifest: BackupManifest): string {
  const people =
    manifest.handles.length === 1 ? 'one account' : `${String(manifest.handles.length)} accounts`;
  return `Everything on this server is replaced by ${String(manifest.files)} files belonging to ${people}, taken ${formatTimestamp(manifest.takenBy.at)}.`;
}

/**
 * Why a restore did not start.
 *
 * ***By class*** (2026-09-27). This searched the server's English for
 * `free space`, `end to end` and `start this server again`: right today, and
 * wrong the first time any of those sentences is reworded, with nothing to say
 * so. The classes are `RestoreRefusal`'s and `RestartRefusal`'s.
 */
function restoreFailure(error: unknown): string {
  switch (errorCode(error)) {
    case 'no-space':
      return 'There is not enough free space to unpack that archive. Delete some archives and try again.';
    case 'unreadable':
      return 'That archive could not be read from end to end, so nothing was changed.';
    case 'unsupervised':
      return 'Nothing would start this server again, so it will not stop itself.';
    default:
      return 'That restore could not be started, and nothing was changed.';
  }
}
