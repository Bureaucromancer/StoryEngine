// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SelfWriteRegistry, writeAtomic, writeJsonAtomic } from './atomic.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'se-atomic-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('writeAtomic', () => {
  it('writes the file and creates its directory', async () => {
    const path = join(dir, 'actors', 'vera-solano', 'card.png');
    await writeAtomic(path, 'bytes');
    await expect(readFile(path, 'utf8')).resolves.toBe('bytes');
  });

  it('replaces existing content', async () => {
    const path = join(dir, 'lorebook.json');
    await writeAtomic(path, 'first');
    await writeAtomic(path, 'second');
    await expect(readFile(path, 'utf8')).resolves.toBe('second');
  });

  it('leaves no temp files behind', async () => {
    const path = join(dir, 'lorebook.json');
    await writeAtomic(path, 'content');
    await expect(readdir(dir)).resolves.toEqual(['lorebook.json']);
  });

  it('returns a token describing the file the watcher will see', async () => {
    const path = join(dir, 'lorebook.json');
    const token = await writeAtomic(path, 'content');
    const stats = await stat(path);

    // Stat'd after the rename, not before: the temp file's mtime is not the
    // one the watcher reports, and a token built from it would never match.
    expect(token).toEqual({ path, mtimeMs: stats.mtimeMs, size: stats.size });
  });
});

describe('writeJsonAtomic', () => {
  it('formats for humans, because the store is meant to be readable', async () => {
    // [02 §5.4](../../../../docs/design/02-data-model.md): diffable, greppable, git-able.
    // A single-line blob would make keeping a library in git useless.
    const path = join(dir, 'lorebook.json');
    await writeJsonAtomic(path, { name: 'Rain City', entries: [] });

    await expect(readFile(path, 'utf8')).resolves.toBe(
      '{\n  "name": "Rain City",\n  "entries": []\n}\n',
    );
  });
});

describe('the self-write registry', () => {
  it('claims a token that matches path, mtime and size', async () => {
    const registry = new SelfWriteRegistry();
    const path = join(dir, 'lorebook.json');
    const token = await writeAtomic(path, 'content', { registry });

    expect(registry.claim(token)).toBe(true);
  });

  it('consumes the token, so a second event on the same file is foreign', async () => {
    // The failure this prevents is subtle: if a token were merely *matched* and
    // left in place, a hand edit landing on the same file with the same size
    // would be swallowed and the row would go stale.
    const registry = new SelfWriteRegistry();
    const path = join(dir, 'lorebook.json');
    const token = await writeAtomic(path, 'content', { registry });

    expect(registry.claim(token)).toBe(true);
    expect(registry.claim(token)).toBe(false);
  });

  it('does not claim a foreign write to a file we also wrote', async () => {
    // This is why the token is (path, mtime, size) rather than just the path.
    const registry = new SelfWriteRegistry();
    const path = join(dir, 'lorebook.json');
    await writeAtomic(path, 'ours', { registry });

    await writeFile(path, 'theirs, and a different length entirely');
    const stats = await stat(path);

    expect(registry.claim({ path, mtimeMs: stats.mtimeMs, size: stats.size })).toBe(false);
  });

  it('does not claim anything for a file we never wrote', () => {
    const registry = new SelfWriteRegistry();
    expect(registry.claim({ path: join(dir, 'other.json'), mtimeMs: 1, size: 1 })).toBe(false);
  });

  it('expires tokens, so a later foreign write is not suppressed', async () => {
    const registry = new SelfWriteRegistry(10);
    const path = join(dir, 'lorebook.json');
    const token = await writeAtomic(path, 'content', { registry });

    await new Promise((resolve) => setTimeout(resolve, 40));

    expect(registry.claim(token)).toBe(false);
    expect(registry.size).toBe(0);
  });

  it('keeps distinct tokens for repeated writes to one path', async () => {
    const registry = new SelfWriteRegistry();
    const path = join(dir, 'lorebook.json');
    const first = await writeAtomic(path, 'a'.repeat(10), { registry });
    const second = await writeAtomic(path, 'b'.repeat(200), { registry });

    expect(registry.claim(second)).toBe(true);
    expect(registry.claim(first)).toBe(true);
  });

  it('can be opted out of', async () => {
    const registry = new SelfWriteRegistry();
    const path = join(dir, 'lorebook.json');
    const token = await writeAtomic(path, 'content', { registry, suppressWatcher: false });

    expect(registry.claim(token)).toBe(false);
  });
});

describe('a write killed mid-flight', () => {
  /**
   * The failure this whole module exists to prevent: a crash partway through a
   * direct write leaves a file that is neither the old actor nor the new one —
   * and `card.png` is the only copy of that actor
   * ([02 §5.2](../../../../docs/design/02-data-model.md)).
   *
   * The same harness run against a plain `fs.writeFile` produces exactly that,
   * which is what makes this test mean something: truncations at 1 MB and 36 MB
   * of a 40 MB write, depending on when the kill lands. Under `writeAtomic` the
   * target is only ever the old content or the new, because the rename is the
   * only thing that touches it.
   */
  const ORIGINAL = 'the original actor';
  const SIZE = 40 * 1024 * 1024;

  interface KillResult {
    content: string;
    stderr: string;
    code: number | null;
    signal: NodeJS.Signals | null;
  }

  async function writeAndKill(path: string, afterMs: number): Promise<KillResult> {
    // Resolved here and passed in: the child runs with `-e`, so it has no
    // module context of its own. Getting this wrong is how the first version of
    // this test passed for the wrong reason — the child died on an unresolved
    // require, never touched the file, and "unchanged" looked like success.
    const module = createRequire(import.meta.url).resolve('write-file-atomic');

    const script = [
      `const write = require(${JSON.stringify(module)});`,
      `const big = 'x'.repeat(${String(SIZE)});`,
      `process.stdout.write('started\\n');`,
      `write(${JSON.stringify(path)}, big).then(() => {});`,
    ].join('\n');

    const child = spawn(process.execPath, ['-e', script], { stdio: 'pipe' });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    // Attached now, not after the kill. At the longer delays the child finishes
    // the write and exits on its own, and an `exit` listener attached after
    // that has already happened never fires — which showed up as a 30-second
    // timeout roughly one run in four rather than as a failure.
    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((settle) => {
      child.once('exit', (code, signal) => {
        settle({ code, signal });
      });
    });

    await new Promise<void>((started) => {
      child.stdout.once('data', () => {
        started();
      });
    });
    await new Promise((tick) => setTimeout(tick, afterMs));

    // SIGKILL rather than SIGTERM: the point is a process that gets no chance
    // to clean up, which is what a power cut or an OOM kill looks like. A
    // no-op if it already finished.
    child.kill('SIGKILL');

    const { code, signal } = await exited;
    return { content: await readFile(path, 'utf8'), stderr, code, signal };
  }

  // Several delays, because whether the write is actually in flight when the
  // kill lands is a race — and the interesting window is a few milliseconds
  // wide.
  it.each([0, 2, 5, 15, 40])(
    'killed %ims in, the card is whole — old or new, never half',
    async (afterMs) => {
      const path = join(dir, 'card.png');
      await writeFile(path, ORIGINAL);

      const { content, stderr, code, signal } = await writeAndKill(path, afterMs);

      // Guards against the vacuous pass. If the child died on a bad `require`
      // it never touched the file, and "unchanged" would prove nothing — which
      // is exactly how the first version of this test passed for the wrong
      // reason. Two legitimate endings remain: we killed it mid-write, or it
      // finished first (which the longer delays are expected to produce).
      expect(stderr).toBe('');
      expect(signal === 'SIGKILL' || code === 0).toBe(true);

      const state =
        content === ORIGINAL
          ? 'original'
          : content === 'x'.repeat(SIZE)
            ? 'fully replaced'
            : `PARTIAL (${String(content.length)} of ${String(SIZE)} bytes)`;

      expect(state).not.toContain('PARTIAL');
    },
    30_000,
  );
});

/**
 * **The Windows `EPERM` retry is ours, and it has to be proven** — the
 * docstring above the writer credited `write-file-atomic` with this retry for
 * months, and the library's only `EPERM` branch guards *chown*, not the
 * rename. The receipt was the history trim failing one full-suite run in
 * three on Windows: a poll held `index.jsonl` open while the trim renamed
 * over it, and the bare `EPERM` escaped as an unhandled rejection.
 *
 * The lock is real on Windows — Node opens files without `FILE_SHARE_DELETE`,
 * which is the same mechanism `reset-data.test.ts` uses to hold a directory —
 * and a no-op on POSIX, where rename-over-open succeeds immediately. So on
 * Windows this test fails without the retry and passes with it, and on ubuntu
 * it passes either way; the platform-split is the same one the teardown tests
 * already carry, for the same reason.
 */
describe('a destination somebody is holding open', () => {
  it('outwaits a short hold instead of surfacing EPERM', async () => {
    const path = join(dir, 'history', 'index.jsonl');
    await writeAtomic(path, 'first\n');

    const { open } = await import('node:fs/promises');
    const held = await open(path, 'r');
    // Released while the retry ladder still has rungs: 10+50+100 ms in, the
    // writer should still be trying rather than have given up.
    const release = setTimeout(() => {
      void held.close();
    }, 120);

    try {
      await writeAtomic(path, 'second\n');
      expect(await readFile(path, 'utf8')).toBe('second\n');
    } finally {
      clearTimeout(release);
      await held.close().catch(() => undefined);
    }
  });
});
