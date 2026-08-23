// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';

import { applyLiveConfig, type AppServices } from '../app.js';
import {
  type Config,
  CONFIG_TIERS,
  ConfigError,
  configBounds,
  configKeys,
  LIVE_APPLIERS,
  loadConfig,
  pendingRestart,
  validateConfigDocument,
} from '../config.js';
import { contentHashOf } from '../index-db/ingest.js';
import { writeJsonAtomic } from '../storage/atomic.js';

/**
 * The install's settings — [05 §15.3](../../../../docs/design/05-ui-surfaces.md),
 * [P2A §2.5](../../../../docs/design/workplan/13-p2a-configuration-surface.md).
 *
 * Registered inside the `/api/admin` plugin, so the guard is the prefix's and
 * nothing here checks a role.
 *
 * **The tier table travels as data.** The client may not import from the server
 * package, and a duplicated copy of `CONFIG_TIERS` would falsify
 * [13 §4](../../../../docs/design/13-internal-contracts.md)'s claim that the
 * annotation *is* the source. Sending it means a key a newer build adds renders
 * with the right badge without a client release — and `LIVE_APPLIERS` travels
 * beside it, because a control that says *live* and is not read yet is the
 * placeholder [01 §2.2] forbids.
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
function pickKnown(body: unknown): Record<string, unknown> {
  const picked: Record<string, unknown> = {};
  for (const key of configKeys()) {
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
      pendingRestart: pendingRestart(services.bootConfig, services.config),
    });
  });

  /**
   * The restart banner's data, on its own route.
   *
   * Separate from `GET /config` because [04 §6.3](../../../../docs/design/04-server-multiuser-deployment.md)
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
  app.get('/notices', async (_request, reply) => {
    return reply.send({
      pendingRestart: pendingRestart(services.bootConfig, services.config),
      /**
       * **The server does not restart itself**, and the banner says so in one
       * sentence rather than listing pending changes and offering nothing.
       * [04 §6.4] is explicit that under no supervisor a restart control leaves
       * the admin with no server and possibly no shell, so it needs supervisor
       * detection and a drain — neither of which exists. A notice that invites
       * *"so how do I restart it?"* is a worse answer than one that says.
       */
      canRestart: false,
    });
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
      onDisk = await loadConfig(services.configPath);
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

    const merged = mergeDocument(onDisk?.document ?? {}, pickKnown(body.config));

    /**
     * **Validated by the code that boots on it**, not by a second copy.
     *
     * `validateConfigDocument` is the half of `loadConfig` that fills defaults
     * and checks the schema, extracted for exactly this call — so a file this
     * write produces is a file the process can start on, by construction. A
     * validator written here could drift from the loader, and the drift would
     * show up as a server that will not start after a settings save.
     */
    let next: Config;
    try {
      next = validateConfigDocument(merged, services.configPath);
    } catch (error) {
      if (!(error instanceof ConfigError)) throw error;
      return await reply
        .code(400)
        .send({ error: 'invalid', message: error.message, issues: error.issues });
    }

    await writeJsonAtomic(services.configPath, merged);
    // The file this process has now seen. Without this the *next* save compares
    // against the document read at boot and refuses its own predecessor's work.
    services.configDocument = merged;
    const pending = applyLiveConfig(app, services, next);

    return await reply.send({
      config: services.config,
      pendingRestart: pending,
    });
  });
}
