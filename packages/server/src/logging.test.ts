// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';

import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LOREBOOK_SCHEMA, newLorebook } from '@storyengine/shared';

import { applyLiveConfig, type AppServices, buildServices, disposeServices } from './app.js';
import { type Config, DEFAULT_CONFIG, pendingRestart } from './config.js';
import { listObjects } from './index-db/query.js';
import { create as createObject } from './library.js';
import { listVersions, readVersionPayload } from './storage/history.js';
import { userOwner } from './storage/layout.js';

/**
 * The logger, and the first key that is genuinely live — F8.
 *
 * P1 ran Fastify with `logger: false` and `console.log` in the entry point,
 * while `log.level` and `log.format` sat in the config as annotations nothing
 * read. That made a resumable overnight job undebuggable by construction, which
 * is exactly what P2 is about to build ([P2 §2.2]).
 *
 * The level is asserted against a captured stream rather than a spy: what
 * matters is whether a line *reaches the destination*, and a mock of the logger
 * would assert that we called it.
 */

/** A destination that keeps every line, so a test can ask what was written. */
function captureStream(): { lines: () => Record<string, unknown>[]; stream: Writable } {
  const written: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, done) {
      written.push(chunk.toString());
      done();
    },
  });
  return {
    stream,
    lines: () =>
      written
        .join('')
        .split('\n')
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}

/**
 * Writes a lorebook through the library module, and says where it landed.
 *
 * Through `createObject` rather than `writeFile`, because the point of the test
 * below is that the *application's* write path and the watcher's read the same
 * retention cap — so the first version on disk has to come from the real one.
 */
async function create(
  target: AppServices,
  book: ReturnType<typeof newLorebook>,
): Promise<{ file: string; root: string }> {
  const created = await createObject(target.library, 'ned', book, LOREBOOK_SCHEMA);
  const root = target.layout.objectRoot(userOwner('ned'), LOREBOOK_SCHEMA, created.slug);
  return { file: target.layout.objectFile(userOwner('ned'), LOREBOOK_SCHEMA, created.slug), root };
}

/** Filesystem events are not synchronous; poll rather than guess a delay. */
async function eventually(check: () => Promise<boolean>, timeoutMs = 8000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((tick) => setTimeout(tick, 50));
  }
  expect(await check(), 'condition never held before the timeout').toBe(true);
}

let dataDir: string;
let services: AppServices;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'se-log-'));
  services = await buildServices({
    config: { ...DEFAULT_CONFIG, dataDir },
    watch: false,
  });
});

afterEach(async () => {
  await disposeServices(services);
  await rm(dataDir, { recursive: true, force: true });
});

/**
 * The app under test, logging into a stream this file can read.
 *
 * `services.config` is moved with it, because that record is what the running
 * app was built from and `applyLiveConfig` reads it to work out what changed.
 */
function appLoggingTo(capture: Writable, level: Config['log']['level'] = 'info') {
  services.config = { ...services.config, log: { ...services.config.log, level } };
  return Fastify({ logger: { level, stream: capture } });
}

describe('the log record', () => {
  it('is one JSON object per line', async () => {
    const capture = captureStream();
    const app = appLoggingTo(capture.stream);

    app.log.info({ jobId: 'job-1' }, 'a thing happened');
    await app.close();

    const [line] = capture.lines();
    expect(line).toBeDefined();
    // Parsing succeeded, which is the assertion: `pretty` would not parse, and
    // it is why the format union has one value ([13 §4.1]).
    expect(line?.['msg']).toBe('a thing happened');
    expect(line?.['level']).toBe(30);
    // Bindings are fields, not phrases inside the message — this is what makes
    // "filter by job id" a lifecycle rather than a grep over prose.
    expect(line?.['jobId']).toBe('job-1');
    expect(line?.['time']).toBeTypeOf('number');
  });

  it('honours the configured level', async () => {
    const capture = captureStream();
    const app = appLoggingTo(capture.stream, 'warn');

    app.log.info('not this one');
    app.log.warn('this one');
    await app.close();

    expect(capture.lines().map((line) => line['msg'])).toEqual(['this one']);
  });

  it('writes nothing at all when silent', async () => {
    // The level the test suite runs at. If this ever stops working, every
    // route suite starts printing a request log per assertion.
    const capture = captureStream();
    const app = appLoggingTo(capture.stream, 'silent');

    app.log.error('not even this');
    await app.close();

    expect(capture.lines()).toEqual([]);
  });
});

describe('the live tier, with its first real consumer', () => {
  it('changes the level on a running app, without a restart', async () => {
    const capture = captureStream();
    const app = appLoggingTo(capture.stream, 'warn');

    app.log.info('before');
    const pending = applyLiveConfig(app, services, {
      ...services.config,
      log: { ...services.config.log, level: 'debug' },
    });
    app.log.info('after');
    await app.close();

    expect(capture.lines().map((line) => line['msg'])).toEqual(['after']);
    // A live key changing is not a restart-required notice.
    expect(pending).toEqual([]);
    // And the services carry the new config, so anything reading it at the
    // point of use sees the change too.
    expect(services.config.log.level).toBe('debug');
  });

  it('reaches a child logger, which is what a request or a job gets', async () => {
    // The bindings that matter are on children — a request logger, and from
    // P2.5 a job logger. pino resolves a child's level through its prototype,
    // so one assignment reaches them; if that ever stopped being true, a live
    // level would silently apply to nothing anyone actually logs through.
    const capture = captureStream();
    const app = appLoggingTo(capture.stream, 'warn');
    const child = app.log.child({ jobId: 'job-7' });

    applyLiveConfig(app, services, {
      ...services.config,
      log: { ...services.config.log, level: 'info' },
    });
    child.info('from the child');
    await app.close();

    const [line] = capture.lines();
    expect(line?.['msg']).toBe('from the child');
    expect(line?.['jobId']).toBe('job-7');
  });

  /**
   * **The repair the rest of the stage rests on** — [P2A §2.5].
   *
   * `applyLiveConfig` used to end with `services.config = next`, and that one
   * line is why six keys the tier table calls `live` could not change on a
   * running server. The runner captures `config` when it is constructed, the
   * budgeter reads through the runner's copy, and `LibraryContext` holds
   * another — so rebinding the field left all three reading a record the server
   * had stopped using, while `services.config` reported the new value and every
   * test that asked *it* passed.
   *
   * So the assertion is deliberately made through a reference taken *before*
   * the call, which is the position every one of those holders is in. Asserting
   * `services.config.…` afterwards cannot distinguish the two implementations
   * and is what let the bug live.
   */
  it('assigns into the running config, so a holder of the reference sees it', async () => {
    const capture = captureStream();
    const app = appLoggingTo(capture.stream);
    // Exactly what `new TurnRunner({ config })` does with it.
    const captured = services.config;

    applyLiveConfig(app, services, {
      ...services.config,
      sessions: { ...services.config.sessions, streamCoalesceMs: 999 },
      limits: { ...services.config.limits, contextTokens: 4242 },
    });
    await app.close();

    expect(captured.sessions.streamCoalesceMs).toBe(999);
    expect(captured.limits.contextTokens).toBe(4242);
    // And the identity is preserved, which is the mechanism rather than the
    // symptom: a nested object replaced wholesale would satisfy the two
    // assertions above only because `captured` is the top-level object.
    expect(services.config).toBe(captured);
  });

  /**
   * **The notice is derived, so undoing a change clears it** — [P2A §2.5].
   *
   * Computed against `bootConfig` rather than against the running record. The
   * previous version measured the delta from `services.config` and then moved
   * it, so the answer was right exactly once: after one save the baseline had
   * gone somewhere the listener had never been, and a second save reported the
   * difference between two states the process was never in.
   *
   * Change it back and the banner should empty, because what is pending is the
   * difference between the port this process bound and the port on disk — a
   * property of the process. A stored pending-set would accumulate, and
   * [13 §4] argues against a second source of truth for a derived value at
   * length.
   */
  /**
   * **The one `live` key an in-place assign cannot reach** — [P2A §2.5].
   *
   * `LibraryContext` carries `keepHistoryPerObject` as its own field, copied
   * once at assembly, because the library module knows nothing about config.
   * So `history.keepPerObject` is tiered `live` and was, until this stage,
   * fixed for the life of the process on *both* write paths — the routes'
   * through this context and the watcher's, which used to copy the number a
   * second time into a private field of its own.
   *
   * Asserted on the context rather than on `services.config`, because the
   * config is not what `snapshotReplaced` is handed.
   */
  it('reaches the library context, which holds its own copy of the retention cap', async () => {
    const capture = captureStream();
    const app = appLoggingTo(capture.stream);

    applyLiveConfig(app, services, {
      ...services.config,
      history: { keepPerObject: 3 },
    });
    await app.close();

    expect(services.library.keepHistoryPerObject).toBe(3);
    // A live key changing is not a restart-required notice.
    expect(pendingRestart(services.bootConfig, services.config)).toEqual([]);
  });

  it('clears the pending notice when a change is undone', async () => {
    const capture = captureStream();
    const app = appLoggingTo(capture.stream);
    const bootPort = services.bootConfig.server.port;

    const moved = applyLiveConfig(app, services, {
      ...services.config,
      server: { ...services.config.server, port: 9999 },
    });
    const back = applyLiveConfig(app, services, {
      ...services.config,
      server: { ...services.config.server, port: bootPort },
    });
    await app.close();

    expect(moved).toEqual(['server.port']);
    // Not `['server.port']` again, and not `[]` by accident either — the second
    // call's baseline is the boot config, so it compares 8080 with 8080.
    expect(back).toEqual([]);
  });

  /**
   * **The join** — that the object `applyLiveConfig` fans out into is the object
   * the *watcher* holds, and not a copy of it.
   *
   * The two halves are proved separately and cheaply: `watcher.test.ts` shows
   * the watcher reads its retention cap at the point of use, and the test above
   * shows the fan-out reaches `services.library`. Neither notices if
   * `assembleWithState` hands the watcher `{ ...library }` — a spread that
   * typechecks, reads as tidying, and quietly restores the bug this stage
   * exists to remove, because the routes' write path and the watcher's would
   * again be trimming one object's history to two different depths.
   *
   * So this one is behavioural and pays for a real watcher: change the cap on a
   * running server, then edit a file on disk three times and count what
   * survives.
   */
  it('reaches the watcher, which is the other path into an object history', async () => {
    const watched = await buildServices({
      config: { ...DEFAULT_CONFIG, dataDir: await mkdtemp(join(tmpdir(), 'se-live-')) },
      watch: true,
    });
    const capture = captureStream();
    const app = appLoggingTo(capture.stream);

    try {
      const book = newLorebook('Rain City');
      const created = await create(watched, book);
      applyLiveConfig(app, watched, { ...watched.config, history: { keepPerObject: 1 } });

      // Waited for by NAME, one edit at a time. Polling for "some version
      // exists" is satisfied by the first edit and then races the other two —
      // which is how the first draft of this test passed against a watcher that
      // had never seen the new cap.
      for (const suffix of ['after the fire', 'after the rain', 'after the bells']) {
        const name = `Rain City, ${suffix}`;
        await writeFile(created.file, JSON.stringify({ ...book, name }));
        await eventually(async () =>
          Promise.resolve(
            listObjects(watched.index.db, { owners: [userOwner('ned')] })[0]?.name === name,
          ),
        );
      }

      /**
       * **Settled on by content, not asserted on a count the moment the index
       * moves.**
       *
       * `handle()` calls `ingestFile` *before* `snapshotReplaced`, so the
       * instant an edit's name is queryable its history entry is still being
       * written — the loop above proves each edit was seen, not that its
       * snapshot has landed. Asserting here directly saw two versions on a
       * loaded machine.
       *
       * Waiting for `length === 1` alone would be worse than racy, it would be
       * vacuous: one version is also what an *ignored* cap leaves after the
       * first edit. What is true only when the third snapshot has landed and
       * the cap was honoured is the pair — one surviving version, and its
       * payload being the state the third edit replaced. With the cap ignored
       * there are three and the count never reaches one.
       */
      await eventually(async () => {
        const versions = await listVersions(created.root);
        if (versions.length !== 1) return false;
        const kept = (await readVersionPayload(created.root, versions[0]!.digest)) as {
          name: string;
        };
        return kept.name === 'Rain City, after the rain';
      });
    } finally {
      await app.close();
      await disposeServices(watched);
    }
  }, 20_000);

  it('names the restart-tier changes it could not apply', async () => {
    const capture = captureStream();
    const app = appLoggingTo(capture.stream);

    const pending = applyLiveConfig(app, services, {
      ...services.config,
      server: { ...services.config.server, port: 9999 },
      history: { keepPerObject: 5 },
    });
    await app.close();

    // The specific keys, because a bare "restart required" invites people to
    // restart and hope ([04 §6.3]). `history.keepPerObject` is live and so is
    // not in the list.
    expect(pending).toEqual(['server.port']);
  });
});
