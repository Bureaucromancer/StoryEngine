// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { CaptureSink } from '../providers/capture.js';

/**
 * The filesystem half of the cassette recorder — here and not beside the
 * recorder, because this directory is the one place in the package allowed to
 * touch `node:fs` at request time, and a capture *is* written at request time.
 * The recorder itself stays pure and unit-testable with an in-memory sink.
 *
 * **Deliberately not `writeJsonAtomic`.** No watcher observes this directory,
 * no reader races the write, and a torn file on process death is an acceptable
 * loss for a dev recording — the atomic dance buys nothing here and its rename
 * is one more thing to fail on Windows.
 *
 * `wx`, so a collision refuses instead of overwriting: two writes claiming one
 * name means the recorder's sequence counter broke, and the second exchange
 * silently replacing the first is precisely the kind of loss a corpus must not
 * absorb quietly.
 */
export function createCaptureStore(dir: string): CaptureSink {
  let made = false;

  return {
    async write(fileName: string, json: string): Promise<void> {
      if (!made) {
        await mkdir(dir, { recursive: true });
        made = true;
      }
      await writeFile(join(dir, fileName), json, { flag: 'wx' });
    },
  };
}
