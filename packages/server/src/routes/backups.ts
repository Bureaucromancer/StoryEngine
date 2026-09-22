// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { Type } from '@sinclair/typebox';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import type { BackupSettings } from '@storyengine/shared';

import { requireAccount, type AppServices } from '../app.js';
import {
  backupContextOf,
  findBackup,
  listBackups,
  removeBackup,
  takeBackup,
  type BackupOwner,
  type BackupRecord,
} from '../backup/archive.js';
import { openFileRead } from '../storage/files.js';
import { TarNameError } from '../storage/tar.js';

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
 * The refusals taking a backup can produce, in the API's vocabulary.
 *
 * `TarNameError` is **409**: the request is well formed and the caller is
 * permitted, and what refuses it is a file in their own library whose path the
 * archive format cannot express. 400 would say the body was wrong, which it was
 * not, and 500 would say this is nobody's to fix — it is, and the message names
 * the file.
 */
async function respond(error: unknown, reply: FastifyReply): Promise<FastifyReply> {
  if (error instanceof TarNameError) {
    return reply.code(409).send({
      error: 'unarchivable-path',
      message: 'A file in this library has a path too long for an archive to carry.',
      path: error.memberName,
    });
  }
  throw error;
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
    try {
      const backup = await takeBackup(backupContextOf(services), {
        owner,
        contents,
        reason: 'manual',
      });
      return await reply.code(201).send({ backup });
    } catch (error) {
      return await respond(error, reply);
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
        .header(
          'content-disposition',
          `attachment; filename="${found.path.split('/').pop() ?? ''}"`,
        )
        .send(openFileRead(found.path));
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
}
