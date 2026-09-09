// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  isContained,
  PathEscapeError,
  type PathRejection,
  resolveWithin,
  resolveWithinReal,
} from './paths.js';

/**
 * The adversarial corpus [testing §3.2](../../../../docs/design/workplan/03-testing.md) asks for.
 *
 * *"Path resolution deserves an adversarial corpus of its own. It is the most
 * security-sensitive code in the project and it is pure, so it is cheap to
 * hammer."*
 *
 * The Windows entries are the point rather than the padding. Windows is the
 * development platform, which means its quirks are the ones most likely to be
 * exercised by accident and least likely to be probed deliberately — and every
 * one of them below is a way to write a path that a containment check reads
 * differently from the filesystem.
 */

const ROOT = resolve('/data/users/ned/library');

function rejectionFor(...segments: string[]): PathRejection | 'ACCEPTED' {
  try {
    resolveWithin(ROOT, ...segments);
    return 'ACCEPTED';
  } catch (error) {
    if (error instanceof PathEscapeError) return error.reason;
    throw error;
  }
}

describe('resolveWithin accepts ordinary paths', () => {
  it.each([
    ['actors/vera-solano/card.png'],
    ['lorebooks/rain-city/lorebook.json'],
    ['actors/vera-solano/assets/sprites/neutral.png'],
    ['./actors/vera-solano'],
    ['actors/name.with.dots/card.png'],
    ['actors/name-with-2/card.png'],
  ])('%s', (path) => {
    expect(rejectionFor(path)).toBe('ACCEPTED');
  });

  it('joins segments', () => {
    expect(resolveWithin(ROOT, 'actors', 'vera-solano', 'card.png')).toBe(
      join(ROOT, 'actors', 'vera-solano', 'card.png'),
    );
  });

  it('resolves the root itself', () => {
    expect(resolveWithin(ROOT, '.')).toBe(ROOT);
  });
});

describe('traversal, in every position', () => {
  it.each<[string, PathRejection]>([
    ['../../../etc/passwd', 'traversal'],
    ['..', 'traversal'],
    ['actors/../../secrets', 'traversal'],
    ['actors/vera/..', 'traversal'],
    // A backslash is an ordinary filename character on Linux, so a card
    // authored on Windows could smuggle `..\..` past a POSIX-only split and
    // have it resolve as traversal later.
    ['..\\..\\windows\\system32', 'traversal'],
    ['actors\\..\\..\\secrets', 'traversal'],
    // Doubled separators collapse; the traversal underneath must not.
    ['actors//../../secrets', 'traversal'],
    ['actors/./../../secrets', 'traversal'],
  ])('%s → %s', (path, reason) => {
    expect(rejectionFor(path)).toBe(reason);
  });

  it('does not reject a filename that merely begins with dots', () => {
    // `..hidden` is a legal name and not traversal. A rule that matched on a
    // `..` prefix rather than on whole segments would reject it.
    expect(rejectionFor('actors/..hidden/card.png')).toBe('ACCEPTED');
    expect(rejectionFor('actors/.hidden/card.png')).toBe('ACCEPTED');
  });
});

describe('absolute and rooted paths', () => {
  it.each<[string, PathRejection]>([
    ['/etc/passwd', 'absolute'],
    ['\\windows\\system32', 'absolute'],
    ['//server/share/file', 'unc'],
    ['\\\\server\\share\\file', 'unc'],
    // `C:foo` is NOT absolute by path.isAbsolute on win32 — it means "foo on
    // drive C's current directory", which can be anywhere. It is the one
    // traversal that looks like an ordinary relative path.
    ['C:evil', 'drive-relative'],
    ['c:evil/deeper', 'drive-relative'],
  ])('%s → %s', (path, reason) => {
    expect(rejectionFor(path)).toBe(reason);
  });

  it('rejects a fully-qualified Windows path on every platform', () => {
    // The *reason* legitimately differs: `path.isAbsolute("C:/Windows")` is
    // true on win32 and false on POSIX, so this is caught as `absolute` on one
    // and `drive-relative` on the other. Asserting the reason would make the
    // suite pass on the developer's machine and fail in a Linux container, for
    // no defect. What must hold on both is that it does not get through.
    expect(rejectionFor('C:/Windows/System32')).not.toBe('ACCEPTED');
    expect(rejectionFor('C:\\Windows\\System32')).not.toBe('ACCEPTED');
  });
});

describe('Windows filename traps', () => {
  it.each<[string, PathRejection]>([
    // NTFS alternate data streams: hidden bytes attached to a legitimate file,
    // invisible to readdir.
    ['actors/card.png:evil', 'alternate-data-stream'],
    ['actors/vera:$DATA/card.png', 'alternate-data-stream'],
    // Windows strips a trailing dot or space, so `evil.` and `evil` are one
    // file there and two everywhere else.
    ['actors/vera./card.png', 'trailing-dot-or-space'],
    ['actors/vera /card.png', 'trailing-dot-or-space'],
    // Device names still resolve with an extension.
    ['actors/con/card.png', 'reserved-device-name'],
    ['actors/CON.png', 'reserved-device-name'],
    ['actors/lpt1/card.png', 'reserved-device-name'],
    ['actors/NUL', 'reserved-device-name'],
    // Illegal on Windows, so a library authored on Linux would be unopenable.
    ['actors/what?/card.png', 'illegal-character'],
    ['actors/a<b/card.png', 'illegal-character'],
    ['actors/a|b/card.png', 'illegal-character'],
    ['actors/a*b/card.png', 'illegal-character'],
    ['actors/a"b/card.png', 'illegal-character'],
  ])('%s → %s', (path, reason) => {
    expect(rejectionFor(path)).toBe(reason);
  });

  it('does not reject a name that merely contains a device name', () => {
    expect(rejectionFor('actors/constance/card.png')).toBe('ACCEPTED');
    expect(rejectionFor('actors/auxiliary/card.png')).toBe('ACCEPTED');
  });
});

describe('control characters and null bytes', () => {
  it.each<[string, string, PathRejection]>([
    ['null byte', 'actors/vera\0.png', 'null-byte'],
    ['newline', 'actors/ve\nra/card.png', 'illegal-character'],
    ['tab', 'actors/ve\tra/card.png', 'illegal-character'],
    ['escape', 'actors/ve\u001bra/card.png', 'illegal-character'],
  ])('%s', (_label, path, reason) => {
    expect(rejectionFor(path)).toBe(reason);
  });
});

describe('isContained', () => {
  it('accepts the root itself and anything beneath it', () => {
    expect(isContained(ROOT, ROOT)).toBe(true);
    expect(isContained(ROOT, join(ROOT, 'actors'))).toBe(true);
  });

  it('rejects a sibling whose name begins with the root', () => {
    // The classic prefix bug: `/data/users/ned/library-evil` starts with
    // `/data/users/ned/library` as a *string* and is not inside it.
    expect(isContained(ROOT, `${ROOT}-evil`)).toBe(false);
    expect(isContained(ROOT, `${ROOT}-evil${sep}file`)).toBe(false);
  });

  it('rejects a parent', () => {
    expect(isContained(ROOT, resolve(ROOT, '..'))).toBe(false);
  });
});

describe('symlinks — the escape only the filesystem knows about', () => {
  let base: string;
  let root: string;
  let outside: string;
  let linkSupported = true;
  let linkFailure = '';

  beforeAll(async () => {
    base = await mkdtemp(join(tmpdir(), 'se-paths-'));
    root = join(base, 'root');
    outside = join(base, 'outside');
    await mkdir(join(root, 'actors'), { recursive: true });
    await mkdir(outside, { recursive: true });
    await writeFile(join(outside, 'secret.txt'), 'not yours');

    try {
      // A junction rather than a symlink: creating a symlink on Windows needs
      // elevation or Developer Mode, whereas a directory junction does not —
      // and `realpath` follows both, so it exercises the same code.
      await symlink(outside, join(root, 'escape'), 'junction');
    } catch (error) {
      linkSupported = false;
      linkFailure = error instanceof Error ? error.message : String(error);
    }
  });

  afterAll(async () => {
    await rm(base, { recursive: true, force: true });
  });

  // This is the assertion, not a precondition. Every interesting case below is
  // guarded on `linkSupported`, so a platform that refuses the link used to hand
  // back a green suite with the corpus never executed — and that corpus is the
  // whole argument for the real resolver existing (P2 §1.3, F1/F17). If this
  // fails, the ones below are skipped and this line says why.
  it('can create the link the rest of this corpus needs', () => {
    expect(linkSupported, `this platform refused to create a junction: ${linkFailure}`).toBe(true);
  });

  it('passes the lexical check but fails the real one', async () => {
    if (!linkSupported) return;

    // Nothing in the string is suspicious. That is the whole point.
    expect(() => resolveWithin(root, 'escape/secret.txt')).not.toThrow();

    await expect(resolveWithinReal(root, 'escape/secret.txt')).rejects.toMatchObject({
      reason: 'symlink-escape',
    });
  });

  it('allows an ordinary path through the real check', async () => {
    await expect(resolveWithinReal(root, 'actors')).resolves.toBe(join(root, 'actors'));
  });

  it('allows a path that does not exist yet, since writes target those', async () => {
    // A write resolves a file that is not there. The check is on the deepest
    // existing ancestor — here, `actors`.
    await expect(resolveWithinReal(root, 'actors/vera-solano/card.png')).resolves.toBe(
      join(root, 'actors', 'vera-solano', 'card.png'),
    );
  });

  it('catches an escape even when the target does not exist yet', async () => {
    if (!linkSupported) return;

    // The dangerous case: writing *through* a link, to a file that is not there.
    // Only the ancestor walk catches this.
    await expect(resolveWithinReal(root, 'escape/new-file.txt')).rejects.toMatchObject({
      reason: 'symlink-escape',
    });
  });

  it('tolerates a root that is itself a link', async () => {
    if (!linkSupported) return;

    // A data directory on another volume is an ordinary deployment. Comparing a
    // realpath'd candidate against a non-realpath'd root would reject every
    // path in it.
    // Not wrapped in a try: the first junction succeeded, so a failure here is
    // a real difference between the two calls rather than a platform refusing
    // links, and swallowing it would skip the case silently.
    const linkedRoot = join(base, 'root-link');
    await symlink(root, linkedRoot, 'junction');

    await expect(resolveWithinReal(linkedRoot, 'actors')).resolves.toContain('actors');
  });
});
