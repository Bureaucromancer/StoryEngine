// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

/**
 * `write-file-atomic@8` ships no types, and the DefinitelyTyped package is
 * pinned to v4 — its signatures no longer match. Hand-written rather than
 * installed, because a stale declaration that compiles is worse than none.
 *
 * Only the surface we call is declared. If something else is needed, declare it
 * here after checking the implementation rather than guessing.
 */
declare module 'write-file-atomic' {
  interface Options {
    /** File mode for the temp file. Defaults to the existing file's mode. */
    mode?: number | undefined;
    chown?: { uid: number; gid: number } | false | undefined;
    encoding?: BufferEncoding | undefined;
    /** Defaults to true. Turning it off trades durability for speed. */
    fsync?: boolean | undefined;
    tmpfileCreated?: ((tmpfile: string) => void) | undefined;
  }

  function writeFileAtomic(
    filename: string,
    data: string | NodeJS.ArrayBufferView,
    options?: Options,
  ): Promise<void>;

  namespace writeFileAtomic {
    function sync(filename: string, data: string | NodeJS.ArrayBufferView, options?: Options): void;
  }

  export = writeFileAtomic;
}
