// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type JSX } from 'react';

import { backupApi, type BackupRecord } from '../api.js';
import { formatTimestamp } from '../format.js';
import { Button } from '../ui/Button.js';
import { SelectField } from '../ui/Field.js';
import { link } from '../ui/classes.js';
import { Fine, Note } from '../ui/Text.js';
import { megabytes } from './Backups.js';
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

      {take.isError ? (
        <p role="alert" className="text-danger-ink">
          That backup could not be taken.
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
    </section>
  );
}
