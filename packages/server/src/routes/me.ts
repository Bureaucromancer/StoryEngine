// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';

import { requireAccount } from '../app.js';
import type { AppServices } from '../app.js';
import { refuseShortPassword } from '../auth/password-policy.js';
import { deleteAvatar, writeAvatar } from '../auth/avatars.js';
import { PrefsError } from '../auth/prefs.js';
import { readOnePart } from './import.js';
import {
  pickBindings,
  readSystemBindings,
  userBindingsState,
  writeBindings,
} from '../providers/bindings.js';
import {
  presentConnection,
  presentUsableConnections,
  resolveConnections,
} from '../providers/connections.js';
import { presentRoleRow, roleTable } from '../providers/roles.js';
import { ASSIST_ROLES, readTaskRoles, writeTaskRoles } from '../providers/task-roles.js';
import { ingestFile } from '../index-db/ingest.js';
import { reindexSession, withSessionLock } from '../sessions/store.js';
import { userOwner } from '../storage/layout.js';
import { listTrash, restoreFromTrash, TrashAddressError } from '../storage/trash.js';

/**
 * What a signed-in person may change about themselves — [10 §15.1](../../../../docs/design/10-ui-surfaces.md).
 *
 * The user half of the settings surface, and the smaller half by design: a
 * display name, a locale, a password, and a bag of client preferences. Roles,
 * enabled flags and capabilities are somebody else's business and live under
 * `/api/admin` ([P2A §2.4](../../../../docs/design/workplan/09-p2a-configuration-surface.md)).
 *
 * ***And **model** roles are this surface's, which is a word collision rather
 * than an exception — [P7.3], 2026-09-12.*** The sentence above means an
 * account's role: admin or not, somebody else's decision. A `ModelRole` is one
 * of the eight jobs a turn hands to a model, and binding one is
 * [19 §5.1](../../../../docs/design/19-tech-stack.md)'s *"anyone who wants their
 * own key overrides a role without the admin's involvement"* — the opposite
 * kind of thing. [10 §15.1] puts the bindings editor here by name.
 *
 * **`requireAccount` per handler rather than a prefix hook**, which is the
 * opposite of what the admin half does and deliberately so. Here the account
 * object is the thing every handler *wants* — it is the subject of the request,
 * not a gate in front of it — so a hook that only proved one existed would leave
 * every handler fetching it again anyway.
 */

/**
 * **`additionalProperties: false` is the refusal**, and it is the whole reason
 * this schema is written out rather than derived from the store's patch type.
 *
 * A `role` in the body answers 400 naming the field. Ignoring it — stripping it
 * and carrying on with a 200 — would be worse than either accepting or
 * refusing, because it teaches a client that the request worked. The next
 * version of that client sends the field on purpose.
 *
 * `locale` is nullable: null is *no preference*, which is a different state from
 * a locale of `""` and the one a user picks when they want the browser's.
 */
const ProfilePatch = Type.Object(
  {
    displayName: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
    locale: Type.Optional(Type.Union([Type.String({ maxLength: 35 }), Type.Null()])),
    /**
     * *Shown on the sign-in screen* — [12 §4], [10 §15.1], [P10.4].
     *
     * ***In the *You* form and not in Preferences***, which is the same line
     * `ui.theme` is on the other side of: what only your own browser reads is a
     * preference, and what **other people and the server** read is an account
     * field. A gallery is built by the server for a reader who is nobody yet.
     */
    hiddenFromGallery: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

const PasswordChange = Type.Object(
  {
    // No minimum on either. `currentPassword` has none because an account whose
    // password is empty must be able to change it — a floor here would refuse
    // them at the schema, before `authenticate` ran, with no way out. The
    // minimum for `newPassword` is `auth.minPasswordLength`, checked below.
    currentPassword: Type.String({ maxLength: 512 }),
    newPassword: Type.String({ maxLength: 512 }),
  },
  { additionalProperties: false },
);

/**
 * Preferences are **not** validated beyond their shape — [25 B13](../../../../docs/design/25-open-questions.md).
 *
 * `additionalProperties: true` here is the point rather than a shortcut: the
 * server does not know what a preference means, and a newer client must be able
 * to store one an older server has never heard of. The bounds that do exist —
 * a key pattern and a document size cap — live in the store, which is where the
 * comment explaining that they are bounds and not validation lives too.
 */
const PrefsPatch = Type.Object({}, { additionalProperties: true });
/** `kind/slug-uuid`, bounded so a malformed one is refused by the validator. */
const TrashAddress = Type.Object({ id: Type.String({ minLength: 3, maxLength: 300 }) });

/**
 * A binding is a connection and one of its models — [19 §5.1], and **nothing
 * else, spelled at the schema.**
 *
 * *Stricter than `PUT /api/admin/bindings`, which takes an open object and
 * leans on `pickBindings` to narrow it — and the asymmetry is the point rather
 * than an inconsistency.* That route is behind the admin prefix; this one is
 * outside it, by a named exemption in `routes/connections.test.ts` whose whole
 * argument is that the route carries ids and no credential. A narrowing that
 * happens on the way to disk is a true statement about the file and not about
 * the *request*, and the request is what the exemption is about. Measured, not
 * assumed: the open shape accepted `{ prose: { …, apiKey } }` and answered 412
 * on the hash rather than 400 on the field, which is the guard's probe failing
 * to bite.
 */
const BindingBody = Type.Object(
  { connectionId: Type.String({ maxLength: 200 }), modelId: Type.String({ maxLength: 400 }) },
  { additionalProperties: false },
);

/**
 * The bindings document, under the hash of the bytes it was read from.
 *
 * **The same shape the system writer takes**, spelled out again rather than
 * imported from `routes/connections.ts`: that module is registered inside the
 * `/api/admin` plugin and a shared constant would be the one thing tying this
 * surface to it.
 *
 * **The key is any string and the value is exact**, which is the split that
 * matters: a newer client naming a role this build has not got is dropped by
 * `pickBindings` rather than answered 400 — it is not an error to run an older
 * server — while a field a binding has no business carrying never gets past
 * the schema.
 */
const BindingsBody = Type.Object(
  {
    bindings: Type.Record(Type.String(), BindingBody),
    contentHash: Type.String({ minLength: 1, maxLength: 200 }),
  },
  { additionalProperties: false },
);

/**
 * Which role field assist asks for — `providers/task-roles.ts`, and the closed
 * list it may name. *Closed here and not dropped like an unknown role in a
 * binding*, because this is one control's value rather than a document a newer
 * client might extend: a role outside the list is a mistake to be told about.
 */
const TaskRolesBody = Type.Object(
  { assist: Type.Union(ASSIST_ROLES.map((role) => Type.Literal(role))) },
  { additionalProperties: false },
);

export function registerMeRoutes(app: FastifyInstance, services: AppServices): void {
  app.get('/me', async (request, reply) => {
    const account = await requireAccount(request, reply);
    if (!account) return;
    return reply.send({ account });
  });

  app.patch('/me', { schema: { body: ProfilePatch } }, async (request, reply) => {
    const account = await requireAccount(request, reply);
    if (!account) return;

    const body = request.body as {
      displayName?: string;
      locale?: string | null;
      hiddenFromGallery?: boolean;
    };
    const updated = await services.accounts.updateSelf(account.handle, body);
    return reply.send({ account: updated });
  });

  /**
   * Changing your own password, which requires knowing it.
   *
   * **The current password is verified through `authenticate`**, not through a
   * check written here. That is *the* password check in this codebase, and a
   * second one beside it is how two drift into disagreeing about disabled
   * accounts or about timing. It also makes the admin reset — no current
   * password to know — the same store method with one fewer step rather than a
   * separate code path.
   *
   * 401 rather than 403: the fact being reported is that a credential did not
   * check out, which is what 401 means. And `invalid-credentials` is the same
   * class login sends, because it is the same event.
   *
   * **Sessions elsewhere survive this**, and [the API doc](../../../../docs/api.md) says
   * so. Sessions are signed stateless cookies with no denylist, so nothing here
   * can revoke one; pretending otherwise would be the lie. The honest upgrade
   * is the one `auth/session.ts` already names, and it is not this phase's.
   */
  app.post('/me/password', { schema: { body: PasswordChange } }, async (request, reply) => {
    const account = await requireAccount(request, reply);
    if (!account) return;

    const body = request.body as { currentPassword: string; newPassword: string };

    // Before `authenticate`, which is where the schema used to run: a wrong
    // current password *and* a short new one answers 400 rather than 401, and
    // that precedence is today's rather than a new choice.
    const refusal = refuseShortPassword('newPassword', body.newPassword, services.config);
    if (refusal) return reply.code(400).send(refusal);

    const verified = await services.accounts.authenticate(account.handle, body.currentPassword);
    if (!verified) {
      return reply.code(401).send({
        error: 'invalid-credentials',
        message: 'That is not your current password.',
      });
    }

    /**
     * `changePassword` rather than `resetPassword`, and the reason is
     * defensive rather than currently load-bearing — which is worth saying
     * plainly, because a comment claiming a live consequence that cannot happen
     * is how the next reader decides the choice was arbitrary.
     *
     * `resetPassword` re-enables, which is right for break-glass and wrong for
     * a self-service form. **Today that difference is unobservable here**: the
     * identity hook refuses a disabled account, so nobody who could be
     * re-enabled can reach this handler. The claim is proved where it is
     * reachable, in `auth/accounts.test.ts`, and named here so that relaxing
     * the hook — or reusing this handler for an admin-initiated change — does
     * not quietly turn a password form into a way to undo a disablement.
     */
    await services.accounts.changePassword(account.handle, body.newPassword);
    return reply.code(204).send();
  });

  /**
   * Your face — [12 §5.2](../../../../docs/design/12-account-gallery.md), [P10.4].
   *
   * ***Self-service only, and that is the line rather than an omission.*** *"The
   * face is the account holder's to set, the way the display name is; admins get
   * the hide flag, not somebody else's portrait."* There is no
   * `PUT /api/admin/accounts/:handle/avatar` and there should not be.
   *
   * **Three obligations, and two of them are `readOnePart`'s**: bound the size
   * by `limits.maxUploadMb` — 413 with the number in it — and take the bytes as
   * received. The third is this route's own: ***sniff the bytes, never trust the
   * extension*** ([10 §4.4]), because a route that believed a filename would
   * store an HTML document as `avatar.png` and serve it back with a content type
   * somebody else chose.
   *
   * ***And a fixed cap below the config's***, which [12 §5.2] asks for in as
   * many words: *"plus a fixed sanity cap in the handler, because an avatar that
   * large is a mistake whatever the config says. No new config key: nobody tunes
   * avatar sizes, and not everything is a setting."* `maxUploadMb` defaults to
   * 64 and exists for a library import; a 64 MB portrait is a misdirected file.
   */
  app.post('/me/avatar', async (request, reply) => {
    const account = await requireAccount(request, reply);
    if (!account) return;

    const part = await readOnePart(request, reply, services);
    if (part === null) return;

    const stored = await writeAvatar(services.layout, account.handle, part.bytes, {
      maxBytes: Math.min(services.config.limits.maxUploadMb * MEGABYTE, AVATAR_CAP_BYTES),
    });

    if ('refused' in stored) {
      return stored.refused === 'too-large'
        ? await reply.code(413).send({
            error: 'too-large',
            message: `An avatar has to be under ${String(AVATAR_CAP_MB)} MB.`,
          })
        : await reply.code(415).send({
            error: 'not-an-image',
            message: 'That is not a PNG, JPEG or WebP image.',
          });
    }

    // The token, so a client can compose the URL it will now be served from —
    // which is how the cache-busting in [12 §5.3] reaches the browser.
    return await reply.send({ avatar: stored.digest });
  });

  /** Removing it goes back to the drawn tile, which every account always has. */
  app.delete('/me/avatar', async (request, reply) => {
    const account = await requireAccount(request, reply);
    if (!account) return;

    await deleteAvatar(services.layout, account.handle);
    return await reply.code(204).send();
  });

  /**
   * ***What is in your trash, and how long it has*** —
   * [03 §10.2](../../../../docs/design/03-data-model.md),
   * [P11.7](../../../../docs/design/workplan/28-p11-implementation.md).
   *
   * **Under `/me` rather than `/library`**, because the trash holds sessions as
   * well as library objects — [03 §10.3] puts `trash/sessions/` beside the
   * kinds — and a route under `/library` would have had to answer about
   * something that is not a library object, which is how a surface acquires a
   * special case it never sheds.
   *
   * *Per account and never cross-account*: the trash is inside the user's own
   * root, so this route cannot answer about anybody else's without being asked
   * to, and it is not.
   */
  app.get('/me/trash', async (request, reply) => {
    const account = await requireAccount(request, reply);
    if (!account) return;

    const entries = await listTrash(
      services.layout,
      account.handle,
      services.config.trash.retentionDays,
    );
    return reply.send({ entries, retentionDays: services.config.trash.retentionDays });
  });

  /**
   * ***Put it back*** — [03 §10.2]'s other half, and the reason delete is a
   * move at all.
   *
   * **`POST` with the address in the body**, because a trash id is
   * `kind/slug-uuid` and a path segment carrying a slash is a fight with every
   * router and proxy between here and the browser for no gain.
   */
  app.post('/me/trash/restore', { schema: { body: TrashAddress } }, async (request, reply) => {
    const account = await requireAccount(request, reply);
    if (!account) return;

    const { id } = request.body as { id: string };
    let restored;
    try {
      restored = await restoreFromTrash(services.layout, account.handle, id);
    } catch (error) {
      // An address that is not one is a malformed request rather than a
      // server fault. ***Only that*** (2026-09-27): anything else, a rename
      // the disk refused, is the 500 it is, and is logged.
      if (!(error instanceof TrashAddressError)) throw error;
      return reply.code(400).send({ error: 'invalid', message: error.message });
    }

    if (!restored.ok) {
      return reply.code(restored.reason === 'not-found' ? 404 : 409).send({
        error: restored.reason,
        message:
          restored.reason === 'not-found'
            ? 'That is no longer in the trash.'
            : 'Something with that name is already there.',
      });
    }
    /**
     * ***What came back is indexed here, before the answer*** (2026-09-27).
     *
     * *Corrected 2026-09-27.* ~~The index catches up by itself, and this says
     * why nothing is done here. A restore is a move into the library tree,
     * which the watcher sees; an install with the watcher off gets it at the
     * next rebuild. Making this route ingest the folder would be a second
     * producer for the one thing [P1]'s gate holds to a single answer.~~ A
     * session is not in the library tree: the watcher ignores everything under
     * `sessions/`, and a delete had removed its rows, so a restored session
     * was listed (the list reads the disk) and never matched a search again,
     * nor counted in any *used by*. And a library object is the server's own
     * write, which [03 §5.1.1] indexes synchronously — a page opened straight
     * after *Restore* could miss it. Neither is a second producer: a session
     * goes through the rebuild's own derivation, an object through the
     * `ingestFile` every write calls.
     *
     * **The files are back whatever happens here**, so a failure to index is
     * logged and the restore still answers as the restore it was: the watcher
     * or the next rebuild is the fallback, as before.
     */
    try {
      const back = restored.restored;
      if (back.kind === 'session') {
        await withSessionLock(back.sessionId, () =>
          reindexSession(services.sessions, account.handle, back.sessionId),
        );
      } else {
        await ingestFile(
          services.index.db,
          services.layout,
          services.layout.objectFile(userOwner(account.handle), back.schemaId, back.slug),
        );
      }
    } catch (error) {
      request.log.warn(
        {
          event: 'trash.reindexFailed',
          message: error instanceof Error ? error.message : String(error),
        },
        'Restored from the trash, and not yet indexed',
      );
    }
    return reply.send({ restored: true });
  });

  app.get('/me/prefs', async (request, reply) => {
    const account = await requireAccount(request, reply);
    if (!account) return;

    const prefs = await services.prefs.read(account.handle);
    return reply.send({ prefs });
  });

  /**
   * A shallow merge, answering with the whole document.
   *
   * The response is the map afterwards rather than an acknowledgement, so a
   * client lands on the truth rather than on its own guess about what its patch
   * did — which is what makes the client's one optimistic mutation safe to be
   * optimistic about.
   */
  app.patch('/me/prefs', { schema: { body: PrefsPatch } }, async (request, reply) => {
    const account = await requireAccount(request, reply);
    if (!account) return;

    try {
      const prefs = await services.prefs.patch(
        account.handle,
        request.body as Record<string, unknown>,
      );
      return await reply.send({ prefs });
    } catch (error) {
      if (error instanceof PrefsError) {
        // The store's bounds, reported in the vocabulary the rest of the API
        // uses. `too-large` is 413 because that is the fact; `invalid` is 400.
        return await reply
          .code(error.code === 'too-large' ? 413 : 400)
          .send({ error: error.code, message: error.message });
      }
      throw error;
    }
  });

  /**
   * What this account's turns will actually do — [10 §15.1], [P7.3].
   *
   * **The caller's answer, where `/api/admin/roles` gives the install's.** That
   * route resolves the system bindings against the system connections and
   * passes no personal layer, because the question it asks is *what has the
   * install got*. This one asks *what will my turns do*, so it resolves the
   * account's own file over the install defaults against the connections the
   * account may actually use — which is [19 §5.1]'s order, and the `via` field
   * is the whole point of asking a server rather than a browser.
   *
   * **One request for the whole pane.** The editor needs the resolved table
   * (what happens now), the raw bindings (what to edit), a hash (to write
   * safely) and the connections with their models (what may be chosen); four
   * round trips for one pane would be four chances to render a pane assembled
   * from two different moments.
   */
  app.get('/me/roles', async (request, reply) => {
    const account = await requireAccount(request, reply);
    if (!account) return;

    const { usable, disabled, shadowing } = await resolveConnections(
      services.layout,
      account.handle,
      account.capabilities,
    );
    const state = await userBindingsState(services.layout, account.handle);
    const rows = roleTable({
      bindings: state.bindings,
      defaults: await readSystemBindings(services.layout),
      usable,
    });

    return reply.send({
      roles: rows.map(presentRoleRow),
      bindings: state.bindings,
      contentHash: state.contentHash,
      // `presentConnection`, so this carries a label, a provider and the model
      // list a binding picks from — and no `apiKey` and no `baseUrl`, which is
      // the rule that lets this route live outside the admin prefix at all.
      //
      // *Through `presentUsableConnections` since 2026-10-04* ([polish §26]),
      // which is `presentConnection` plus `shadowedBy` on an install
      // connection one of this account's own hides: the label of the personal
      // connection that answers in its place, so the picker stops offering a
      // choice that saves and then reaches a different file, and so Settings
      // can say why — on this pane, and on the install's row for an
      // administrator whose own file hides it.
      connections: presentUsableConnections({ usable, shadowing }),
      /**
       * Personal connections on disk that were ignored for want of
       * `privateConnections` — [09 §4.5] wants the user *told* rather than left
       * wondering why a model call started failing, and this is the surface
       * where that sentence finally has somewhere to land.
       */
      disabled: disabled.map(presentConnection),
      /**
       * Which of these rows the calls outside a session use — today only field
       * assist, which asks for `prose` unless its owner chose otherwise
       * ([25 C15]'s stopgap, `providers/task-roles.ts`). On this response
       * because it is read against the table above it: the choice is a role,
       * and the row for that role is where its model is.
       */
      tasks: await readTaskRoles(services.layout, account.handle),
    });
  });

  /**
   * Chooses which role field assist asks for.
   *
   * **No hash guard, unlike the bindings writer**, because there is no document
   * to lose: the file is one value, the request carries all of it, and a hand
   * edit between a read and this write is overwritten by exactly the choice the
   * person just made on screen — which is what they asked for.
   */
  app.put('/me/task-roles', { schema: { body: TaskRolesBody } }, async (request, reply) => {
    const account = await requireAccount(request, reply);
    if (!account) return;

    const body = request.body as { assist: (typeof ASSIST_ROLES)[number] };
    await writeTaskRoles(services.layout, account.handle, { assist: body.assist });
    return reply.send({ tasks: await readTaskRoles(services.layout, account.handle) });
  });

  /**
   * The personal half of the binding writer — `users/<handle>/bindings.json`.
   *
   * **The file it writes has had a reader since P2.5 and no writer**, which
   * `providers/bindings.ts` records as deliberate: [P2B §2.7] drew the line at
   * the system scope, and [10 §15.5] gates the personal surface on the
   * `privateConnections` check being real so it is not *"the trivial bypass
   * [09 §4.5] warns about, wearing a UI"*. It has been real since P3.
   *
   * **Nothing here checks a capability, and that is the design rather than an
   * omission.** A binding is two ids. `resolveRole` looks the `connectionId` up
   * in the capability-filtered `usable` list, so a binding naming a connection
   * this account may not use cannot be access — and it is not even destructive:
   * [P2B §1.2] made the resolver take *the first layer that **resolves**, not
   * the first that exists*, so it drops through to the install default and the
   * turn keeps working. `dangling` is the answer only when no layer bound
   * anything usable at all. Which means the route is safe for an account with no personal
   * connections at all, and useful to them: re-pointing `summarize` at a cheaper
   * model on a *system* connection is exactly
   * [R2 / F-01](../../../../docs/design/workplan/21-playable-log.md)'s *use a
   * second model*, and it needs no key of your own.
   *
   * **Whole document, under a hash** — the same shape and the same 412 as the
   * system writer, and for a sharper reason here: [10 §4] says editing this file
   * by hand works, so a hand edit between the read and the write is a case that
   * will happen rather than a race to be theoretical about.
   */
  app.put('/me/bindings', { schema: { body: BindingsBody } }, async (request, reply) => {
    const account = await requireAccount(request, reply);
    if (!account) return;

    const body = request.body as { bindings: Record<string, unknown>; contentHash: string };
    const current = await userBindingsState(services.layout, account.handle);

    if (body.contentHash !== current.contentHash) {
      return reply.code(412).send({
        error: 'stale',
        message: 'Your bindings file has changed since this page read it.',
        current: current.bindings,
      });
    }

    // Picked before the write, so a role this build does not know never reaches
    // disk — and picked *here* rather than inside the writer, so the answer
    // below is what was written rather than a second guess at it.
    const picked = pickBindings(body.bindings);
    await writeBindings(services.layout, account.handle, picked);
    return reply.send(await userBindingsState(services.layout, account.handle));
  });
}

/** A megabyte, so the arithmetic above says what it means. */
const MEGABYTE = 1024 * 1024;

/**
 * The fixed cap [12 §5.2] asks for, above whatever `maxUploadMb` says.
 *
 * **Two megabytes**, because a portrait rendered at a few hundred pixels is
 * tens of kilobytes and anything past this is a photograph somebody dropped on
 * the wrong control. *Not a config key*: nobody tunes avatar sizes, and
 * [work plan §2.3]'s standing line is that not everything is a setting.
 */
const AVATAR_CAP_MB = 2;
const AVATAR_CAP_BYTES = AVATAR_CAP_MB * MEGABYTE;
