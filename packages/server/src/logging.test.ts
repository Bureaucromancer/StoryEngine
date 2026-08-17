// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';

import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { applyLiveConfig, type AppServices, buildServices, disposeServices } from './app.js';
import { type Config, DEFAULT_CONFIG } from './config.js';

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
