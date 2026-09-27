// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { Type } from '@sinclair/typebox';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import type { BackupSettings } from '@storyengine/shared';

import { requireAccount, type AppServices } from '../app.js';
import { announceRestartPending } from '../notifications/notices.js';
import {
  BackupSpaceError,
  backupContextOf,
  findBackup,
  listBackups,
  readArchiveManifest,
  removeBackup,
  takeBackup,
  type BackupOwner,
  type BackupRecord,
} from '../backup/archive.js';
import { DEFAULT_BACKUP_CONFLICT, importBackup } from '../backup/import.js';
import { BACKUP_IMPORT_LIMITS, BackupFileSource, importedBy } from '../import/backup-source.js';
import { recordImport } from '../import/jobs.js';
import { openFileRead } from '../storage/files.js';
import { prepareRestore, type RestoreRefusal } from '../backup/restore.js';
import { beginRestart, type RestartRefusal } from '../restart.js';
import { unlinkFile } from '../storage/files.js';
import { NOT_IMPORTABLE, applyConfigDocument } from './config.js';

/**
 * Which archive to become, and whether somebody meant the redacted one.
 *
 * **Stored by id, like the import** — an archive to restore from is one this
 * install is already holding, and an upload of one would be a multipart body
 * the size of the whole install arriving over a connection that has to survive
 * it.
 */
const RestoreBody = Type.Object(
  {
    id: Type.String({
      pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
    }),
    /** Says out loud that an install nobody can sign into is what was meant. */
    acceptRedacted: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

/** One sentence per refusal, naming what to do about it. */
function restoreMessage(refusal: RestoreRefusal): string {
  switch (refusal) {
    case 'wrong-scope':
      return 'That is one account’s archive, not a whole install. Restoring it would leave this install holding that account and nothing else.';
    case 'needs-confirmation':
      return 'That archive carries no accounts, no connections and no session key, so nobody would be able to sign in afterwards. Confirm to restore it anyway.';
    case 'no-space':
      return 'There is not enough free space to unpack that archive. The directory being replaced is kept rather than deleted, so a restore needs room for both.';
    case 'unsafe-path':
      return 'That archive names a file outside the data directory, so it will not be unpacked.';
    default:
      return 'That archive could not be read from end to end, so it will not be restored.';
  }
}

function restartMessage(refusal: RestartRefusal): string {
  if (refusal === 'already-restarting') return 'This server is already restarting.';
  if (refusal === 'unavailable') return 'This build cannot restart itself.';
  return 'Nothing would start this server again.';
}

/**
 * ***Taking a backup, and getting it off the machine*** —
 * [25 E6](../../../../docs/design/25-open-questions.md),
 * [P12.3](../../../../docs/design/workplan/29-p12-implementation.md).
 *
 * **Two registrars from one file, because the halves differ in one word.** The
 * user half answers for the account that asked; the admin half answers for the
 * install and is called from `registerAdminRoutes`, so it sits behind
 * `adminOnly` on the `/api/admin` prefix with no second spelling of the guard —
 * which is the commitment `admin.ts` makes and the reason its route-table test
 * enumerates Fastify rather than a list somebody maintains.
 *
 * ***Taking one is never gated by a capability, and that is the whole shape of
 * the control.*** `scheduledBackups` ([P12.4]) governs whether the **server**
 * takes backups for somebody on a timer, because a misconfigured schedule is
 * how a data directory fills up while nobody is looking. A person pressing a
 * button is not that: they are asking for their own work, the queue serialises
 * them, and refusing would be refusing somebody a copy of what they wrote.
 */

/**
 * A backup id, and nothing else.
 *
 * ***Half of the traversal defence, and deliberately not the whole of it.*** A
 * uuidv7 cannot contain a separator, so a name that is one cannot escape a
 * directory. But a schema is a thing somebody widens in a hurry, so
 * `findBackup` also refuses to build a path from this at all — it resolves the
 * id against the listing and uses the name that was already on disk. Either
 * check alone is the one that gets edited away.
 */
const BackupParams = Type.Object(
  {
    id: Type.String({
      pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
    }),
  },
  { additionalProperties: false },
);

/**
 * `full` or `redacted`, and the client has to say which.
 *
 * **No default**, because the two produce genuinely different files and the
 * difference is a person's to make: one restores to a working install and
 * carries their provider keys, the other does not and does not. A default here
 * would be this file deciding on their behalf which risk they were taking.
 */
const TakeBackup = Type.Object(
  { contents: Type.Union([Type.Literal('full'), Type.Literal('redacted')]) },
  { additionalProperties: false },
);

/**
 * A whole schedule, every field required.
 *
 * ***No partial, deliberately.*** Three fields arrive together from one form,
 * and a patch would let a client that knew about two of them leave the third at
 * whatever it was — where the failure is a schedule somebody believes they
 * turned off. Closed to unknown keys like every other body here, so a client
 * learns it was wrong rather than learning that it worked.
 */
const WriteSettings = Type.Object(
  {
    frequency: Type.Union([Type.Literal('off'), Type.Literal('daily'), Type.Literal('weekly')]),
    onStart: Type.Boolean(),
    contents: Type.Union([Type.Literal('full'), Type.Literal('redacted')]),
  },
  { additionalProperties: false },
);

/**
 * What an import is asked to do.
 *
 * ***The archive is named by id rather than uploaded***, which is a scoping
 * decision worth stating: a person's backups are already on this server,
 * because that is where they land. Moving one **between** installs is the
 * upload case, and it is a door
 * [P12](../../../../docs/design/workplan/29-p12-implementation.md) names rather
 * than builds — an archive dropped into `data/backups/` by hand is listed and
 * importable today, which is the same capability with the file transfer done by
 * whatever already moves files onto that machine.
 */
const ImportBody = Type.Object(
  {
    id: Type.String({
      pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
    }),
    /** Whose subtree of the archive. An install archive holds several. */
    handle: Type.Optional(Type.String({ minLength: 1, maxLength: 63 })),
    onConflict: Type.Optional(
      Type.Union([Type.Literal('skip'), Type.Literal('replace'), Type.Literal('keep-both')]),
    ),
    /**
     * ***Each off by default, and each reported whether taken or not.***
     * A person should be able to read what an import did **and** what it
     * declined to do, because *my keys did not come across* is a question with
     * an answer rather than a bug report.
     */
    options: Type.Optional(
      Type.Object(
        {
          connections: Type.Optional(Type.Boolean()),
          prefs: Type.Optional(Type.Boolean()),
          /** Admin and install-scope only; refused elsewhere. */
          config: Type.Optional(Type.Boolean()),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);

interface Listing {
  backups: BackupRecord[];
  /**
   * What the stored archives weigh, together.
   *
   * ***A number with an action behind it***, which is the test
   * [10 §15.4](../../../../docs/design/10-ui-surfaces.md) sets for anything on
   * these surfaces: the action is *delete some*. Retention is deferred
   * ([P12](../../../../docs/design/workplan/29-p12-implementation.md)), so this
   * is the only thing standing between an install with a schedule and a person
   * finding out about it when the disk is full.
   */
  totalBytes: number;
}

function listingOf(backups: BackupRecord[]): Listing {
  return { backups, totalBytes: backups.reduce((sum, row) => sum + row.bytes, 0) };
}

/**
 * Runs one import and records it, for whichever half asked.
 *
 * ***The job ledger is not optional here***, and that is `routes/import.ts`'s
 * position rather than a new one: *why did my import not happen* is a question
 * with an answer, and it should live where every other answer lives rather than
 * in a toast somebody dismissed. A backup import lands in the same ledger, the
 * same review surface and the same vocabulary as a SillyTavern folder — which
 * is the whole return on routing it through `sweep`.
 */
async function runImport(
  app: FastifyInstance,
  services: AppServices,
  owner: BackupOwner,
  intoHandle: string,
  body: {
    id: string;
    handle?: string;
    onConflict?: 'skip' | 'replace' | 'keep-both';
    options?: { connections?: boolean; prefs?: boolean; config?: boolean };
  },
  reply: FastifyReply,
): Promise<FastifyReply> {
  /**
   * ***Refused before anything is written*** (2026-09-27). This check used to
   * come after the import, so a person asking to bring settings across from
   * their own backup got a 403 for it, over a library, tags and sessions that
   * had already been written.
   */
  if (body.options?.config === true && owner.kind !== 'install') {
    return reply.code(403).send({
      error: 'not-install-scope',
      message: 'Only an administrator importing an install backup may bring settings across.',
    });
  }

  const found = await findBackup(backupContextOf(services), owner, body.id);
  if (found === null) {
    return reply.code(404).send({ error: 'not-found', message: 'There is no such backup.' });
  }

  /**
   * ***Whose subtree, and the default is the person asking.*** An install
   * archive holds several accounts, so an admin says which; a person importing
   * their own backup means their own, and requiring them to say so would be
   * asking a question with one answer.
   */
  const fromHandle = body.handle ?? intoHandle;

  /**
   * ***Only what the import reads is held, and only that is counted*** — see
   * `BACKUP_IMPORT_LIMITS`. The whole archive used to be read into memory and
   * held to an upload's limits, so an ordinary account was refused as
   * unreadable.
   */
  const opened = await BackupFileSource.open(
    found.path,
    BACKUP_IMPORT_LIMITS,
    importedBy(fromHandle, { config: body.options?.config === true }),
  );
  if (!opened.ok) {
    return reply.code(422).send({
      error: opened.refusal,
      message:
        opened.refusal === 'too-large'
          ? 'That archive holds more than an import reads in one go.'
          : 'That archive could not be read.',
    });
  }

  const outcome = await importBackup(
    {
      layout: services.layout,
      library: services.library,
      sessions: services.sessions,
      tags: services.tags,
      prefs: services.prefs,
    },
    {
      files: opened.source,
      fromHandle,
      handle: intoHandle,
      onConflict: body.onConflict ?? DEFAULT_BACKUP_CONFLICT,
      ...(body.options === undefined ? {} : { options: body.options }),
    },
  );

  if (!outcome.ok) {
    return reply.code(422).send({
      error: outcome.refusal,
      message:
        outcome.refusal === 'unreadable-root'
          ? 'That archive does not hold the account you asked for.'
          : 'That archive could not be read as a backup.',
    });
  }

  const notes = [...outcome.result.notes];

  /**
   * ***Configuration is install-scope and admin-only, and `dataDir` and
   * `server.clientRoot` are refused by name.*** Both are filesystem paths on
   * the machine the archive came from: one would point a running server at a
   * directory that may be somebody else's, the other would make it serve a 404
   * where the built client used to be. Everything else in a config is a fact
   * about how an install behaves and travels.
   */
  if (body.options?.config === true) {
    const document = await readArchivedConfig(opened.source);
    if (document === null) {
      notes.push({ key: 'import.backup.configMissing', params: {}, level: 'warn' });
    } else {
      const applied = await applyConfigDocument(app, services, document, NOT_IMPORTABLE);
      if (!applied.ok) {
        notes.push({
          key: 'import.backup.configRefused',
          params: { message: applied.message },
          level: 'warn',
        });
      } else {
        notes.push({
          key: 'import.backup.configTaken',
          params: {
            pending: applied.pendingRestart.join(' '),
            count: applied.pendingRestart.length,
          },
          level: 'info',
        });
        await announceRestartPending(
          { accounts: services.accounts, notify: services.notify },
          applied.pendingRestart,
        );
      }
    }
  } else if (owner.kind === 'install') {
    notes.push({ key: 'import.backup.configNotTaken', params: {}, level: 'info' });
  }

  const jobId = recordImport(services.state.db, {
    account: intoHandle,
    root: found.name,
    source: 'storyengine-backup',
    items: outcome.result.report.items,
    at: Date.now(),
  });

  return reply.send({
    report: { ...outcome.result.report, jobId },
    sessions: outcome.result.sessions,
    tags: outcome.result.tags,
    notes,
  });
}

/** `config.json` out of an archive, or null when it carries none. */
async function readArchivedConfig(files: BackupFileSource): Promise<unknown> {
  const bytes = await files.read('config.json');
  if (bytes === null) return null;
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

/** The four routes, once, for whichever owner the caller turned out to be. */
function register(
  app: FastifyInstance,
  services: AppServices,
  prefix: string,
  ownerOf: (request: FastifyRequest, reply: FastifyReply) => Promise<BackupOwner | null>,
): void {
  app.post(prefix, { schema: { body: TakeBackup } }, async (request, reply) => {
    const owner = await ownerOf(request, reply);
    if (!owner) return;

    const { contents } = request.body as { contents: 'full' | 'redacted' };
    /**
     * ***No refusal for a file the format cannot name.*** An earlier draft
     * answered 409 for one, and the scheduler's tests settled it the other way:
     * all-or-nothing is the right failure for a *restore*, and for a backup it
     * means one pathological path in one library leaves an install with no
     * archive at all. `takeBackup` skips it and names it in the manifest's
     * `omitted` instead, so the file exists and says what it could not carry.
     */
    try {
      const backup = await takeBackup(backupContextOf(services), {
        owner,
        contents,
        reason: 'manual',
      });
      return await reply.code(201).send({ backup });
    } catch (error) {
      /**
       * ***No room is a state of the disk, not a server fault*** — `507`, and a
       * code the surface can say something useful about. It used to be the
       * error handler's bare 500, so the panel's *not enough room on the disk*
       * sentence could never be reached. `ENOSPC` is the same answer arrived at
       * late: something else filled the disk while the archive was written.
       */
      if (error instanceof BackupSpaceError || (error as NodeJS.ErrnoException).code === 'ENOSPC') {
        return await reply.code(507).send({
          error: 'no-space',
          message:
            error instanceof BackupSpaceError
              ? error.message
              : 'There is not enough free space on the disk for this backup.',
        });
      }
      throw error;
    }
  });

  app.get(prefix, async (request, reply) => {
    const owner = await ownerOf(request, reply);
    if (!owner) return;
    return reply.send(listingOf(await listBackups(backupContextOf(services), owner)));
  });

  app.get(
    `${prefix}/:id/download`,
    { schema: { params: BackupParams } },
    async (request, reply) => {
      const owner = await ownerOf(request, reply);
      if (!owner) return;

      const { id } = request.params as { id: string };
      const found = await findBackup(backupContextOf(services), owner, id);
      /**
       * **404 rather than 403 for somebody else's archive**, which is the
       * library's posture and for its reason: whether an id exists elsewhere is
       * worth hiding. `findBackup` reads one directory, so an id from another
       * account is simply not there and this needs no separate check.
       */
      if (found === null) {
        return reply.code(404).send({ error: 'not-found', message: 'There is no such backup.' });
      }

      /**
       * ***The body is the file*** — the rule the export routes already follow.
       * The name was minted by `fileNameFor` out of a handle, a literal, a date
       * and a uuid, so it is ASCII by construction and needs none of the
       * transliteration `sessions.ts` does for a name a person typed.
       */
      return reply
        .header('content-type', 'application/gzip')
        .header('content-length', String(found.record.bytes))
        .header('content-disposition', `attachment; filename="${found.name}"`)
        .send(openFileRead(found.path));
    },
  );

  /**
   * ***What is in that archive, before anything is done with it*** —
   * [P12.10](../../../../docs/design/workplan/29-p12-implementation.md).
   *
   * ***The look that stands in for a preview, and it is a better fit than the
   * one the plan named.*** `import/preview.ts` predicts what **one hand-picked
   * file** would become, and [P4 §1.4] is explicit that the other case works
   * differently — *"a sweep still commits first and reports"* — because a
   * staging area for three hundred objects is a second library. A backup import
   * is a sweep. So what a person gets before they commit is not a per-object
   * prediction but the archive's own account of itself: whose accounts it
   * holds, whether it carries credentials, when it was taken and by which
   * build. That is the question the controls actually turn on — *which handle*
   * and *is this the one I meant* — and it costs one gzip block, because
   * `takeBackup` writes the manifest first.
   *
   * **404 for an archive this owner does not have; 422 for one that will not
   * read.** The second is not a server error: an archive is a file that
   * survived, from a disk that may have had a bad week.
   */
  app.get(
    `${prefix}/:id/manifest`,
    { schema: { params: BackupParams } },
    async (request, reply) => {
      const owner = await ownerOf(request, reply);
      if (!owner) return;

      const { id } = request.params as { id: string };
      const found = await findBackup(backupContextOf(services), owner, id);
      if (found === null) {
        return reply.code(404).send({ error: 'not-found', message: 'There is no such backup.' });
      }

      const manifest = await readArchiveManifest(found.path);
      if (manifest === null) {
        return reply.code(422).send({
          error: 'unreadable',
          message: 'That archive could not be read.',
        });
      }
      return reply.send({ manifest });
    },
  );

  app.delete(`${prefix}/:id`, { schema: { params: BackupParams } }, async (request, reply) => {
    const owner = await ownerOf(request, reply);
    if (!owner) return;

    const { id } = request.params as { id: string };
    const removed = await removeBackup(backupContextOf(services), owner, id);
    if (!removed) {
      return reply.code(404).send({ error: 'not-found', message: 'There is no such backup.' });
    }
    return reply.code(204).send();
  });
}

export function registerBackupRoutes(app: FastifyInstance, services: AppServices): void {
  register(app, services, '/me/backups', async (request, reply) => {
    const account = await requireAccount(request, reply);
    return account === null ? null : { kind: 'account', handle: account.handle };
  });

  app.post('/me/backups/import', { schema: { body: ImportBody } }, async (request, reply) => {
    const account = await requireAccount(request, reply);
    if (!account) return;

    const body = request.body as Parameters<typeof runImport>[4];
    /**
     * ***A person may only read their own subtree of their own archive.***
     * `handle` exists for the admin half; accepting it here would be a way to
     * ask for somebody else's library out of an install archive they happened
     * to be able to list, which they cannot — but the refusal is written down
     * rather than left to that.
     */
    if (body.handle !== undefined && body.handle !== account.handle) {
      return reply.code(403).send({
        error: 'forbidden',
        message: 'You can only import your own part of a backup.',
      });
    }

    return runImport(
      app,
      services,
      { kind: 'account', handle: account.handle },
      account.handle,
      { ...body, handle: account.handle },
      reply,
    );
  });

  app.get('/me/backups/settings', async (request, reply) => {
    const account = await requireAccount(request, reply);
    if (!account) return;

    /**
     * ***Readable without the capability, and there is no `capable` flag in the
     * body.*** The client gates the form on `account.capabilities` from
     * `auth/state`, exactly as `SettingsPage.tsx` gates `<MyConnections />` on
     * `privateConnections` — *absent is implemented as absent*, so a person
     * without it issues no request to be refused. A second copy of that fact
     * here would be a second thing to keep true.
     */
    return reply.send({ settings: await services.backupSettings.read(account.handle) });
  });

  app.put('/me/backups/settings', { schema: { body: WriteSettings } }, async (request, reply) => {
    const account = await requireAccount(request, reply);
    if (!account) return;

    /**
     * ***The boundary, and the UI is never it.*** [09 §4.5] calls a UI-level
     * check a trivial bypass, and `routes/import.ts` refuses `fileAccess:
     * 'none'` at the route for the same reason. **403 rather than 404**: the
     * route's existence is not a secret and a client needs to tell *you may
     * not* from *there is no such thing*.
     */
    if (!account.capabilities.scheduledBackups) {
      return reply.code(403).send({
        error: 'no-scheduled-backups',
        message: 'An administrator has not enabled scheduled backups for this account.',
      });
    }

    const settings = request.body as BackupSettings;
    return reply.send({ settings: await services.backupSettings.write(account.handle, settings) });
  });
}

/**
 * The install's own, from inside `registerAdminRoutes` — so `adminOnly` has
 * already run and there is no per-handler check here to be forgotten.
 */
export function registerAdminBackupRoutes(app: FastifyInstance, services: AppServices): void {
  register(app, services, '/backups', () => Promise.resolve({ kind: 'install' }));

  /**
   * ***Putting an archive back as the install*** —
   * [P12.11](../../../../docs/design/workplan/29-p12-implementation.md).
   *
   * ***Every precondition is checked here, while the process is still
   * answering***, because a refusal after it has exited is one nobody can read.
   * `prepareRestore` reads the archive end to end, checks its scope, confirms a
   * redacted one and measures the disk — and only then writes the marker. The
   * drain is the last thing that happens, and it happens after the response.
   *
   * **409 rather than 403 throughout.** The caller is permitted — they are an
   * administrator and the prefix let them through — and what is wrong is the
   * state of the install or of the file. `forbidden` would send them looking
   * for a permission nobody can grant, which is `POST /api/admin/restart`'s own
   * argument.
   *
   * ***Supervision is checked twice and neither check is redundant.*** This one
   * refuses before the marker is written, because a marker written into a
   * process that will never come back is a restore that happens whenever
   * somebody next starts the server by hand — possibly months later, possibly
   * not knowing it was pending. `beginRestart` checks again because *a route
   * that trusts its own earlier check is a route that check has not met*.
   */
  app.post('/restore', { schema: { body: RestoreBody } }, async (request, reply) => {
    const body = request.body as { id: string; acceptRedacted?: boolean };

    if (!services.supervision.supervised) {
      return reply.code(409).send({
        error: 'unsupervised',
        message:
          'Nothing would start this server again after a restore, so it will not stop itself. Restore from a shell with `pnpm backup restore <archive> <data directory>` instead.',
      });
    }

    /**
     * ***Everything that would make the drain refuse is checked before the
     * marker exists***, and the reservation is taken before the first `await`
     * (see `AppServices.restoring`). A second request used to get as far as
     * overwriting the first one's marker, find the drain begun, and delete the
     * marker on its way out, so the server restarted without restoring.
     */
    if (services.exit === null) {
      return reply.code(409).send({ error: 'unavailable', message: restartMessage('unavailable') });
    }
    if (services.draining || services.restoring) {
      return reply
        .code(409)
        .send({ error: 'already-restarting', message: restartMessage('already-restarting') });
    }
    services.restoring = true;
    try {
      const found = await findBackup(backupContextOf(services), { kind: 'install' }, body.id);
      if (found === null) {
        return await reply
          .code(404)
          .send({ error: 'not-found', message: 'There is no such backup.' });
      }

      const prepared = await prepareRestore(services.layout, {
        path: found.path,
        requestedBy: request.account?.handle ?? '',
        ...(body.acceptRedacted === undefined ? {} : { acceptRedacted: body.acceptRedacted }),
      });
      if (!prepared.ok) {
        return await reply
          .code(prepared.refusal === 'no-space' ? 507 : 409)
          .send({ error: prepared.refusal, message: restoreMessage(prepared.refusal) });
      }

      const begun = beginRestart(services, 'restore');
      if (!begun.ok) {
        /**
         * ***The marker is removed again, and this is the only place it is
         * ever deleted.*** The drain did not start, so the process is staying
         * up — and a marker left behind by a refused restart would fire on the
         * next ordinary restart instead, which is a restore nobody asked for at
         * a moment nobody chose. The reservation makes it this request's own.
         */
        await unlinkFile(services.layout.restorePendingFile).catch(() => undefined);
        return await reply.code(409).send({ error: begun.why, message: restartMessage(begun.why) });
      }

      request.log.warn(
        {
          event: 'restore.requested',
          account: request.account?.handle,
          archive: prepared.plan.archive,
          files: prepared.plan.manifest.files,
        },
        'Restore requested from the admin surface; draining and restoring on the next start',
      );
      return await reply.code(202).send({ draining: true, plan: prepared.plan });
    } finally {
      // Accepted or not, `draining` now says whatever needs saying.
      services.restoring = false;
    }
  });

  /**
   * ***Calling one off, which is the half a marker with no deletion needs*** —
   * [P12.12](../../../../docs/design/workplan/29-p12-implementation.md).
   *
   * A restore that **fails** to unpack keeps its marker deliberately: the
   * failure has to survive into the next boot to be refused there, and deleting
   * it would turn *this did not work* into *nobody ever asked*. But a marker
   * nothing will act on and nobody can remove is a trap on exactly the install
   * this feature was built for — [25 E6]'s operator has a shell and
   * `docs/deploy.md`'s household one has a web page and nothing else.
   *
   * So: one route, and it is the only door for the state the boot refuses.
   * `204` whether or not there was one, because *there is no pending restore*
   * is what the caller wanted either way.
   */
  app.delete('/restore', async (_request, reply) => {
    await unlinkFile(services.layout.restorePendingFile);
    return reply.code(204).send();
  });

  app.post('/backups/import', { schema: { body: ImportBody } }, async (request, reply) => {
    const body = request.body as Parameters<typeof runImport>[4];
    /**
     * ***An install archive holds several accounts and the admin says which.***
     * There is no *all of them* here, deliberately: a handle in the archive
     * with no account on this install would have to be created to receive its
     * library, and **an account created from an archive has no password** —
     * who may sign in is not a thing an archive gets to decide. So the plan is
     * per handle, and one that does not exist is reported rather than made.
     */
    if (body.handle === undefined) {
      return reply.code(400).send({
        error: 'invalid',
        message: 'Say which account in the backup to import.',
      });
    }
    if ((await services.accounts.find(body.handle)) === null) {
      return reply.code(404).send({
        error: 'no-such-account',
        message: 'This install has no account with that handle.',
      });
    }

    return runImport(app, services, { kind: 'install' }, body.handle, body, reply);
  });
}
