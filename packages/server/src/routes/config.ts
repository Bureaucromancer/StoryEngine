// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';

import { applyLiveConfig, type AppServices } from '../app.js';
import { readSystemConnections } from '../providers/connections.js';
import { beginRestart, wouldInterrupt, type RestartRefusal } from '../restart.js';
import { needsInternet } from '../updates.js';
import { announceRestartPending } from '../notifications/notices.js';
import {
  type Config,
  CONFIG_TIERS,
  ConfigError,
  configBounds,
  configChoices,
  configKeys,
  LIVE_APPLIERS,
  loadConfig,
  pendingRestart,
  resolveConfigDocument,
} from '../config.js';
import { contentHashOf } from '../index-db/ingest.js';
import { unstartable } from '../startable.js';
import { writeJsonAtomic } from '../storage/atomic.js';
import { fileExists } from '../storage/files.js';

/**
 * The install's settings — [10 §15.3](../../../../docs/design/10-ui-surfaces.md),
 * [P2A §2.5](../../../../docs/design/workplan/09-p2a-configuration-surface.md).
 *
 * Registered inside the `/api/admin` plugin, so the guard is the prefix's and
 * nothing here checks a role.
 *
 * **The tier table travels as data.** The client may not import from the server
 * package, and a duplicated copy of `CONFIG_TIERS` would falsify
 * [22 §4](../../../../docs/design/22-internal-contracts.md)'s claim that the
 * annotation *is* the source. Sending it means a key a newer build adds renders
 * with the right badge without a client release — and `LIVE_APPLIERS` travels
 * beside it, because a control that says *live* and is not read yet is the
 * placeholder [work plan §2.2] forbids.
 */

/**
 * A whole `Config`, and deliberately not a patch.
 *
 * The form holds every field, so a partial write would be the client choosing
 * which keys to mention — and two tabs would then merge in a way neither could
 * predict. The stale check is what makes a whole-document write safe, and it is
 * the same bargain the library strikes with `contentHash`.
 *
 * `additionalProperties: true` here is **not** laxity: the pick below is what
 * decides what reaches disk, and refusing a body outright because a newer
 * client sent a key this build has not heard of would make an upgrade a
 * downgrade. Unknown keys in the *body* are dropped; unknown keys in the *file*
 * are preserved. That asymmetry is the correct one — a newer build's key may
 * legitimately be on disk, and no client may invent one.
 */
const ConfigWrite = Type.Object(
  {
    config: Type.Object({}, { additionalProperties: true }),
    /**
     * The file as the client last saw it — its **acknowledgement**.
     *
     * Optional, and its absence means *I have not seen the file since the page
     * loaded*, which is the ordinary case and is checked against what this
     * process read. Present, it is the client saying *I have now seen what is on
     * disk*, whether because it loaded that content or because it chose to
     * overwrite it — and either way the save proceeds.
     *
     * **Without this the 412 was a wedge.** The refusal returned without
     * refreshing what the process had read, and that field moves only at boot
     * and after a successful write — so one hand edit made every later save 412
     * forever, including one carrying precisely what was on disk. Neither
     * recovery the form offers could complete, which is what a gate step walked
     * as a checklist found and a stage of mutation-proven tests did not: the
     * test named *allows a second save* exercised a save after a **successful**
     * save, never after a refusal.
     *
     * The same idiom the bindings write uses, deliberately — one answer to *how
     * does a client say it has seen the file* rather than two.
     */
    contentHash: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  },
  { additionalProperties: false },
);

/**
 * Picks the keys this build knows out of an arbitrary body.
 *
 * **Mirrors `toPublic()`, in the other direction**, and needs no second closed
 * copy of the schema: `configKeys()` already walks the defaults, so the set of
 * writable paths is derived from the same place the tier table is checked
 * against. A closed schema would be a second list to keep in step.
 *
 * A key the caller invents therefore does not reach disk — not because it was
 * rejected, but because nothing ever looked at it.
 */
/**
 * Keys this route refuses to write, whatever a client sends.
 *
 * **`dataDir` decides where `config.json` itself lives**, so writing it here is
 * a one-click way to appear to lose everything: the next start reads a different
 * directory and finds an empty install. [P2A §2.6] argued the field into a
 * read-only note in the form for exactly that reason — **and then enforced it in
 * the browser only.**
 *
 * The trap is not that somebody edits it. An *unedited* Save does it: the form
 * sends back the config it was given, that config carries the running
 * `dataDir` — which `--data` may have set to an absolute machine-specific path
 * — and the file gains it. Nobody has to touch the field, so no amount of asking
 * a tester not to avoids it.
 *
 * Dropped rather than rejected, on the same terms as an unknown key: the form
 * sends the whole config back every time and answering 400 to an ordinary Save
 * would be refusing the common case to prevent the rare one. `--data` is how
 * this moves, and the form's read-only note says so.
 */
const NOT_WRITABLE = new Set(['dataDir']);

/**
 * ***Keys an imported `config.json` must not carry across*** —
 * [P12.9](../../../../docs/design/workplan/29-p12-implementation.md).
 *
 * **Both are filesystem paths on the machine the archive came from**, and that
 * is the whole rule: `dataDir` would point a running server at a directory that
 * may not exist or may be somebody else's — the same disaster
 * {@link NOT_WRITABLE} exists to prevent, arriving by a new door —
 * and `server.clientRoot` would make it serve a 404 where the built client used
 * to be. Everything else in a config is a fact about how an install behaves and
 * is portable; these two are facts about a disk.
 *
 * ***And four facts about the network*** (2026-09-27). The rule is right and
 * the list was short: where a server listens and what stands in front of it
 * describe the machine as much as a path does. A laptop's `127.0.0.1` imported
 * into a container outranked `SE_HOST=0.0.0.0` at the next start and bound the
 * container's own loopback, which nothing outside it can reach; a laptop's
 * port broke the container's port mapping the same way; and `cookieSecure`
 * from an install behind HTTPS, imported into one on plain HTTP, meant nobody
 * could sign in, including to put it back. `trustProxy` goes with it, being
 * the same statement about what is in front.
 *
 * ~~Refused **by name** rather than dropped quietly, so the review says which
 * settings did not come across.~~ *Corrected 2026-09-27: nothing said so; the
 * keys were dropped without a word.* Now they are said: the write reports the
 * ones the archive carried, and the review names them.
 */
export const NOT_IMPORTABLE = new Set([
  'dataDir',
  'server.clientRoot',
  'server.host',
  'server.port',
  'server.cookieSecure',
  'server.trustProxy',
]);

/**
 * Merges a config document into the running one, writes it, and applies it.
 *
 * ***Extracted so that importing a configuration is not a second way to write
 * `config.json`.*** [P12.9] needed the same six steps the settings form does —
 * pick the keys this build knows, merge onto the document on disk, validate
 * **through the loader that boots on it**, restore the running `dataDir`, write
 * atomically, and fan the `live` half out — and a second implementation of that
 * would drift the way a second validator would: invisibly, until a server would
 * not start after somebody saved.
 *
 * *What is deliberately not in here is the stale check.* That is the settings
 * form's, and it is about two people editing one form. An import is a
 * deliberate overwrite by somebody who just ticked a box, and offering them
 * *the file changed since this page loaded* would be answering a question they
 * did not ask.
 *
 * Returns the keys that now need a restart, for the caller to announce.
 */
export async function applyConfigDocument(
  app: FastifyInstance,
  services: AppServices,
  incoming: unknown,
  options: {
    /** Keys never written from `incoming`: {@link NOT_WRITABLE} or {@link NOT_IMPORTABLE}. */
    drop?: ReadonlySet<string>;
    /** Whether the request reached this server over HTTPS. See `unstartable`. */
    secure?: boolean;
    /** Whether a proxy says it did. See `unstartable`. */
    forwardedSecure?: boolean;
  } = {},
): Promise<
  | { ok: true; pendingRestart: string[]; withheld: string[] }
  | { ok: false; message: string; issues: string[] }
> {
  const drop = options.drop ?? NOT_WRITABLE;
  const onDisk = await readDocument(services);
  const picked = pickKnown(incoming, drop);
  // The dropped keys the caller actually sent, so an import can name them.
  const withheld = [...drop].filter((key) => valueAt(incoming, key) !== undefined);
  dropEchoes(picked, onDisk, resolveConfigDocument({}, services.environment));
  const merged = mergeDocument(onDisk, picked);

  let next: Config;
  try {
    /**
     * ***Resolved as the next start will resolve it***, the environment under
     * the file (2026-09-27). Without the layer, a container's save said the
     * next start would bind `127.0.0.1:8080` when it would bind what
     * `SE_HOST` and `SE_PORT` say, and the restart notice was worked out from
     * a config nothing would run.
     */
    next = resolveConfigDocument(merged, services.environment, services.configPath);
    next.dataDir = services.config.dataDir;
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    return { ok: false, message: error.message, issues: error.issues };
  }

  /**
   * ***And asked whether it would start*** (2026-09-27) — `unstartable`. The
   * schema is one answer to *would this start?* and not the whole of it: an
   * address this machine does not have, a port something else holds, a client
   * root with no build and `Secure` cookies over plain HTTP all passed it, and
   * each was a start that failed or could not be reached, with no settings page
   * left to undo it from.
   */
  const issues = await unstartable(services.bootConfig, next, {
    secure: options.secure ?? false,
    forwardedSecure: options.forwardedSecure ?? false,
    seams: services.startable,
  });
  if (issues.length > 0) {
    return { ok: false, message: new ConfigError(services.configPath, issues).message, issues };
  }

  await writeJsonAtomic(services.configPath, merged);
  services.configDocument = merged;
  return { ok: true, pendingRestart: applyLiveConfig(app, services, next), withheld };
}

/**
 * ***A save writes what somebody chose, not what they were shown***
 * (2026-09-27).
 *
 * The form sends the whole running config back, and every key of it was
 * written. So one unedited Save copied the environment's `SE_HOST`, `SE_PORT`
 * and `SE_CLIENT_ROOT` into the file, where they outrank the environment for
 * good: changing the container's variables afterwards changed nothing, and the
 * data directory carried the container's `/app/client` to any machine it moved
 * to, which then would not start. It pinned every default the same way, so a
 * default this build changes never reached an install that had saved once.
 * {@link NOT_WRITABLE} made this argument about `dataDir` alone.
 *
 * So a key the file does not already set is dropped when its value is the one
 * the file would get without it, from the environment or the defaults. That
 * leaves the next start exactly where writing it would have, and the file
 * saying only what somebody decided. A key the file does set is written either
 * way, so *overwrite with mine* still overwrites.
 */
function dropEchoes(
  picked: Record<string, unknown>,
  onDisk: Record<string, unknown>,
  underneath: Config,
): void {
  for (const key of configKeys(picked)) {
    if (valueAt(onDisk, key) !== undefined) continue;
    if (stable(valueAt(picked, key)) === stable(valueAt(underneath, key))) deleteAt(picked, key);
  }
}

/** Removes a dotted key, and any section it leaves empty. */
function deleteAt(target: Record<string, unknown>, key: string): void {
  const [head, ...rest] = key.split('.');
  if (head === undefined) return;
  if (rest.length === 0) {
    Reflect.deleteProperty(target, head);
    return;
  }
  const child = target[head];
  if (typeof child !== 'object' || child === null) return;
  deleteAt(child as Record<string, unknown>, rest.join('.'));
  if (Object.keys(child).length === 0) Reflect.deleteProperty(target, head);
}

function pickKnown(
  body: unknown,
  drop: ReadonlySet<string> = NOT_WRITABLE,
): Record<string, unknown> {
  const picked: Record<string, unknown> = {};
  for (const key of configKeys()) {
    if (drop.has(key)) continue;
    const value = valueAt(body, key);
    if (value === undefined) continue;
    assignAt(picked, key, value);
  }
  return picked;
}

function valueAt(source: unknown, key: string): unknown {
  return key
    .split('.')
    .reduce<unknown>(
      (node, part) =>
        typeof node === 'object' && node !== null
          ? (node as Record<string, unknown>)[part]
          : undefined,
      source,
    );
}

function assignAt(target: Record<string, unknown>, key: string, value: unknown): void {
  const parts = key.split('.');
  const last = parts.pop();
  if (last === undefined) return;
  let node = target;
  for (const part of parts) {
    const existing = node[part];
    if (typeof existing !== 'object' || existing === null) node[part] = {};
    node = node[part] as Record<string, unknown>;
  }
  node[last] = value;
}

/** Deep-merges `changes` over `document`, keeping keys neither side knows. */
function mergeDocument(
  document: Record<string, unknown>,
  changes: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...document };
  for (const [key, value] of Object.entries(changes)) {
    const existing = result[key];
    if (
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value) &&
      typeof existing === 'object' &&
      existing !== null &&
      !Array.isArray(existing)
    ) {
      result[key] = mergeDocument(
        existing as Record<string, unknown>,
        value as Record<string, unknown>,
      );
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Whether two parsed documents are the same.
 *
 * Key order is normalised because it carries no meaning in JSON and a hand edit
 * that only reordered keys is not a change anybody made — refusing there would
 * be the stale check crying wolf, which is how a safety mechanism gets
 * clicked through.
 */
function sameDocument(a: unknown, b: unknown): boolean {
  return stable(a) === stable(b);
}

/** The document's identity, so a client can present what it saw. */
function documentHash(document: unknown): string {
  return contentHashOf(new TextEncoder().encode(stable(document)));
}

/** The file's parsed contents, or an empty document when it cannot be read. */
async function readDocument(services: AppServices): Promise<Record<string, unknown>> {
  try {
    return (await loadConfig(services.configPath)).document;
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    return {};
  }
}

function stable(value: unknown): string {
  // `JSON.stringify` returns undefined only for functions and symbols, which a
  // parsed document cannot contain — so this is the scalar case, spelled out.
  if (typeof value !== 'object' || value === null) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([one], [two]) =>
    one.localeCompare(two),
  );
  return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${stable(child)}`).join(',')}}`;
}

export function registerConfigRoutes(app: FastifyInstance, services: AppServices): void {
  app.get('/config', async (_request, reply) => {
    const onDisk = await readDocument(services);
    return reply.send({
      config: services.config,
      contentHash: documentHash(onDisk),
      path: services.configPath,
      tiers: CONFIG_TIERS,
      appliers: LIVE_APPLIERS,
      // Same argument as the tier table above: the constraints travel as data
      // so the form does not keep a second copy of the schema.
      bounds: configBounds(),
      // And the closed unions, for the same reason again — a hand-written list
      // of log levels is how the form came to offer one the schema refuses.
      choices: configChoices(),
      pendingRestart: pendingRestart(services.bootConfig, services.config),
    });
  });

  /**
   * The restart banner's data, on its own route.
   *
   * Separate from `GET /config` because [09 §6.3](../../../../docs/design/09-server-multiuser-deployment.md)
   * wants the banner on *every* page rather than on the settings page — so the
   * shell asks for it, and making the shell fetch the whole config on every
   * navigation to learn one array would be the wrong trade.
   *
   * **Computed per request, stored nowhere.** That is what makes it
   * self-healing: change a value, change it back, and the list empties, because
   * it is the difference between what this process started with and what it is
   * running now rather than an accumulated set. It is also why every admin sees
   * the same list — there is one process and one answer, not a per-session note.
   */
  app.get('/notices', async (request, reply) => {
    return reply.send({
      pendingRestart: pendingRestart(services.bootConfig, services.config),
      /**
       * ~~**The server does not restart itself**, and the banner says so in one
       * sentence rather than listing pending changes and offering nothing.
       * [09 §6.4] is explicit that under no supervisor a restart control leaves
       * the admin with no server and possibly no shell, so it needs supervisor
       * detection and a drain — neither of which exists.~~
       *
       * ***Both exist since [P10.3]***, and the sentence above is why this is a
       * **condition** rather than a feature flag: what §6.4 forbids is offering
       * the control where nothing will bring the process back, and that is a
       * fact about how this process was started ([`supervision.ts`](../supervision.js)).
       * Where it is false the surface still says *"so how do I restart it?"*,
       * which was the honest answer before and remains the honest answer for a
       * bare `node server.js`.
       */
      canRestart: services.supervision.supervised && services.exit !== null,
      /** How the answer above was arrived at, so the surface can say. */
      supervision: services.supervision.how,
      /**
       * What a restart would interrupt — [09 §6.4]'s *"2 other users have
       * active sessions"*. **Counts, never contents.**
       */
      interrupts: wouldInterrupt(services, request.account?.handle ?? ''),
      /** True while a restart is draining, so the surface stops offering one. */
      draining: services.draining,
      /**
       * ***Whether a restore is waiting for the next start*** —
       * [P12.13](../../../../docs/design/workplan/29-p12-implementation.md).
       *
       * **Here rather than on a route of its own**, because this is the one
       * thing the shell already polls and the answer is one `stat` — and
       * because the state it reports is the state a **boot** wrote. A client
       * cannot know whether a marker is there without asking, and the two
       * moments it appears are the two moments nobody is looking: just after a
       * restore was asked for, and just after one failed.
       *
       * *A restore that succeeded leaves none*, because the marker lived in the
       * directory the swap moved aside — so a true here after a restart always
       * means something is wrong, and there is a control for it.
       */
      restorePending: await fileExists(services.layout.restorePendingFile),
      /**
       * ***The update check, and the connectivity signal it pays for*** —
       * [09 §6.5], [P10.3].
       *
       * **Read, never run.** §6.5 is explicit — *daily, cached, never on page
       * load* — so this reads whatever the timer last wrote. A route that
       * checked on demand would turn one request a day into one per navigation
       * from every browser on the install, which is a traffic pattern that looks
       * like telemetry whatever it carries.
       *
       * ***`needsInternet` is the conditionality, and it is the half that stops
       * this nagging the wrong people.*** A fully local setup — Ollama,
       * llama.cpp, an LLM box on the LAN — is a legitimate deployment whose
       * operator chose it: *"telling them their server is broken because it
       * cannot reach a release feed would be both wrong and irritating."* So the
       * fact is reported either way and the surface only makes something of it
       * when generation is going to fail too.
       */
      updates: {
        ...services.updates,
        needsInternet: needsInternet(await readSystemConnections(services.layout)),
      },
      /**
       * **What build this is** — [P6A §1.5], and here rather than on a route of
       * its own because this is already the *state of this install* answer the
       * shell asks for on every navigation.
       *
       * `null` for a build nobody identified, which is every development run.
       * Reported as an absence rather than as `0.0.0` or `unknown`, because a
       * version string that is not a version is the thing a bug report then
       * quotes back at you.
       *
       * Rendered since alpha.2 by the footer on every page and the About block
       * at the top of Settings ([10 §15.1]), from `GET /api/auth/state`, which
       * carries the same value for everyone. This copy stays because this route
       * is the admin shell's *state of this install* answer; the About surface
       * those grow into is [P11.6]'s.
       */
      build: services.build,
    });
  });

  /**
   * *Restart now* — [09 §6.4](../../../../docs/design/09-server-multiuser-deployment.md),
   * [10 §15.2](../../../../docs/design/10-ui-surfaces.md), [P10.3].
   *
   * ***Refused where nothing would bring the process back***, which is the
   * whole of §6.4's first precondition: *"a bare `node server.js` will simply
   * exit and the admin who clicked the button now has no server and possibly no
   * shell."* The surface does not offer the control there either — `canRestart`
   * above — and this refuses it anyway, because a route that trusts its own form
   * is a route that form has not met.
   *
   * **202, and the response is the last thing this process sends.** The drain
   * runs behind it and then the process exits; a handler that awaited the drain
   * would be writing to a socket the exit is about to close. Clients reconnect
   * on their own ([20 §8]), so what a person sees is the stream's reconnecting
   * state and then the page coming back.
   */
  app.post('/restart', async (request, reply) => {
    const outcome = beginRestart(services);
    if (!outcome.ok) {
      /**
       * **409 rather than 403**, and the distinction is worth the line: the
       * caller is permitted — they are an admin, the prefix let them through —
       * and what is wrong is the **state of the install**. `forbidden` would
       * send them looking for a permission nobody can grant.
       */
      return await reply
        .code(409)
        .send({ error: outcome.why, message: refusalMessage(outcome.why) });
    }

    request.log.warn(
      { event: 'restart.requested', account: request.account?.handle },
      'Restart requested from the settings surface; draining',
    );
    return await reply.code(202).send({ draining: true });
  });

  app.put('/config', { schema: { body: ConfigWrite } }, async (request, reply) => {
    const body = request.body as { config: Record<string, unknown>; contentHash?: string };

    /**
     * **The stale check**, and it is what makes the form safe against a text
     * editor without a watcher — [P2A §2.5].
     *
     * Compared against what is *on disk right now* rather than against a hash
     * the client presented, because the writer this guards against is not
     * another tab: it is somebody with an editor open, and they leave no hash.
     * A config on disk that differs from the running one means this process has
     * not seen their edit, and overwriting it would eat a change the server
     * never read.
     *
     * **A broken file does not block a write that fixes it.** \`loadConfig\`
     * throwing means the file cannot be compared, and refusing there would trap
     * the admin inside the problem they are trying to leave — with the settings
     * form as the one tool that could repair it and the one tool that will not.
     */
    let onDisk: Awaited<ReturnType<typeof loadConfig>> | null = null;
    try {
      // With the environment under it, so the `current` a refusal hands back
      // is what a start on that file would run (2026-09-27).
      onDisk = await loadConfig(services.configPath, services.environment);
    } catch (error) {
      if (!(error instanceof ConfigError)) throw error;
    }

    /**
     * **Compared against the document, not against the running config.**
     *
     * The running config is not the file. `--data` overrides `dataDir` after
     * the load and never touches the document, and an install with no config
     * file runs entirely on defaults — so comparing the merged view reported a
     * hand edit on every container start, which is the deployment the docs
     * recommend. The question the form actually needs answered is narrower:
     * *has the file changed since we read it?*
     */
    const acknowledged =
      body.contentHash !== undefined &&
      onDisk !== null &&
      body.contentHash === documentHash(onDisk.document);

    if (
      !acknowledged &&
      onDisk !== null &&
      !sameDocument(onDisk.document, services.configDocument)
    ) {
      return await reply.code(412).send({
        error: 'stale',
        message: 'The config file has changed on disk since this server read it.',
        // The document *and* what it means, in the library's own vocabulary, so
        // a client can offer *load what is on disk* or *overwrite with mine*
        // rather than only being told no.
        current: onDisk.config,
        currentDocument: onDisk.document,
        // What to present back to say *I have seen this*. Both offers the form
        // makes — load what is on disk, or overwrite with mine — send it; the
        // difference between them is which values travel beside it, which is
        // why neither can happen by accident. A plain re-save carries the stale
        // hash and is refused again.
        contentHash: documentHash(onDisk.document),
      });
    }

    /**
     * ***The same write an import makes*** (2026-09-27). This handler had its
     * own copy of the pick, merge, validate and write, and the copy is where
     * the environment layer and the start checks would have had to be added
     * twice.
     *
     * ~~Validated by the code that boots on it, so a file this write produces is
     * a file the process can start on, by construction.~~ *Corrected
     * 2026-09-27: by the schema only.* The schema passed an address this
     * machine does not have, a port somebody else holds and a client root with
     * nothing in it, and each saved cleanly and failed at the next start. The
     * write now asks those too (`unstartable`).
     */
    const applied = await applyConfigDocument(app, services, body.config, {
      drop: NOT_WRITABLE,
      secure: request.protocol === 'https',
      forwardedSecure: forwardedProto(request.headers['x-forwarded-proto']) === 'https',
    });
    if (!applied.ok) {
      return await reply
        .code(400)
        .send({ error: 'invalid', message: applied.message, issues: applied.issues });
    }
    const pending = applied.pendingRestart;

    /**
     * ***`system.notice`'s producer, and it is the one [09 §3.4] was arguing
     * about*** — [P10.1]. That section's case for a notification table separate
     * from `event` is that *"several admin warnings are already specified with
     * nowhere to be delivered"*, and this is the first of them: the keys are
     * pending until somebody restarts, and the person who saved the setting is
     * the person who then closes this tab.
     *
     * **Awaited rather than detached**, unlike the rendition dispatch: the read
     * is the accounts file, it is already warm, and a save is not a path where
     * milliseconds matter. Detaching would trade nothing for an unhandled
     * rejection nobody would see.
     */
    await announceRestartPending({ accounts: services.accounts, notify: services.notify }, pending);

    return await reply.send({
      config: services.config,
      pendingRestart: pending,
    });
  });
}

/** The first protocol a proxy names, lowercased; the nearest proxy speaks first. */
function forwardedProto(header: string | string[] | undefined): string | null {
  const first = Array.isArray(header) ? header[0] : header;
  return first?.split(',')[0]?.trim().toLowerCase() ?? null;
}

/**
 * Why a restart was refused, in words — and **the server's own words, unusually**.
 *
 * *[22 §1.4] says a class crosses and a sentence does not*, and the class does
 * cross: `error` carries it. This is the `message` field, which every refusal in
 * this API already carries beside the class for a reader who has no catalogue —
 * and there are exactly three of these, none of which a client can compose
 * better than the server can, because two of them are facts about how the
 * process was started.
 */
function refusalMessage(why: RestartRefusal): string {
  if (why === 'unsupervised') {
    return 'Nothing would start this server again, so it will not stop itself. Restart it however you run it.';
  }
  if (why === 'already-restarting') return 'A restart is already under way.';
  return 'This build cannot restart itself.';
}
