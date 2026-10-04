// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { realpathSync } from 'node:fs';
import { realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

/**
 * **The audited path helper.**
 *
 * [20 §9](../../../../docs/design/20-tech-stack.md) calls this *"the single most important
 * piece of security code in the project"*, and
 * [10 §4.4](../../../../docs/design/10-ui-surfaces.md) is why: every filesystem-touching
 * route resolves through here, so containment is a property of one function
 * rather than a habit spread across handlers. The no-direct-`fs` lint rule from
 * P1.0 exists to keep it that way — see the README beside this file.
 *
 * Two entry points, and the difference matters:
 *
 * - {@link resolveWithin} is **lexical**. Pure, synchronous, no I/O. It catches
 *   everything expressible in the path *string*.
 * - {@link resolveWithinReal} additionally resolves symlinks. A lexically
 *   innocent path can still escape if something along it is a link pointing out
 *   of the root, and only the filesystem knows.
 *
 * Anything that will actually touch the disk wants the second. The first exists
 * because it is cheap, total, and testable without a fixture tree.
 *
 * **Windows is the development platform** (see .gitattributes), which cuts both
 * ways: its path quirks are the ones most likely to be found by accident and
 * least likely to be probed deliberately. So they are all rejected explicitly
 * below rather than left to the platform, and the rules apply on every platform
 * — a data directory written on Linux has to be readable on Windows, and a name
 * that is legal on one and not the other is a portability bug waiting to be a
 * support thread.
 */

export type PathRejection =
  | 'absolute'
  | 'drive-relative'
  | 'unc'
  | 'traversal'
  | 'null-byte'
  | 'control-character'
  | 'alternate-data-stream'
  | 'reserved-device-name'
  | 'trailing-dot-or-space'
  | 'illegal-character'
  | 'empty'
  | 'symlink-escape';

export class PathEscapeError extends Error {
  readonly reason: PathRejection;
  readonly attempted: string;

  constructor(reason: PathRejection, attempted: string, detail?: string) {
    super(`Refused path (${reason}): ${JSON.stringify(attempted)}${detail ? ` — ${detail}` : ''}`);
    this.name = 'PathEscapeError';
    this.reason = reason;
    this.attempted = attempted;
  }
}

/** Reserved on Windows in every directory, with or without an extension. */
const RESERVED_DEVICE_NAMES = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  ...Array.from({ length: 9 }, (_, i) => `com${String(i + 1)}`),
  ...Array.from({ length: 9 }, (_, i) => `lpt${String(i + 1)}`),
]);

/** Illegal in a Windows filename. `:` is handled separately, as it means ADS. */
// eslint-disable-next-line no-control-regex -- the point is to match control characters
const ILLEGAL_CHARACTERS = /[<>"|?*\u0000-\u001f]/;

const DRIVE_RELATIVE = /^[a-zA-Z]:/;

/**
 * Splits on both separators regardless of platform. A path arriving from a card
 * authored on Windows carries backslashes, and treating them as ordinary
 * filename characters on Linux is how `..\..\etc` becomes a single innocent
 * "filename" that later resolves as traversal somewhere else.
 */
function segmentsOf(relative: string): string[] {
  return relative.split(/[/\\]+/);
}

/**
 * Rejects a single path segment.
 *
 * Exported because the same rules apply to a slug being minted
 * ([P1 §1.1](../../../../docs/design/workplan/07-p1-implementation.md)) and to a handle being
 * accepted at first run — and a check that lives in two places drifts.
 */
export function assertSafeSegment(segment: string, whole: string = segment): void {
  if (segment.length === 0) {
    throw new PathEscapeError('empty', whole);
  }
  if (segment.includes('\0')) {
    throw new PathEscapeError('null-byte', whole);
  }
  if (segment.includes(':')) {
    // `card.png:evil` is an NTFS alternate data stream: it writes hidden bytes
    // attached to a legitimate-looking file, and `readdir` will not show it.
    // Also catches a drive letter that survived the checks above.
    throw new PathEscapeError(
      'alternate-data-stream',
      whole,
      `in segment ${JSON.stringify(segment)}`,
    );
  }
  if (ILLEGAL_CHARACTERS.test(segment)) {
    throw new PathEscapeError('illegal-character', whole, `in segment ${JSON.stringify(segment)}`);
  }
  if (segment !== '.' && segment !== '..' && /[. ]$/.test(segment)) {
    // Windows silently strips these, so `evil.` and `evil` are the same file
    // there and different files everywhere else. That difference is a way to
    // write one path and have a containment check read another.
    throw new PathEscapeError(
      'trailing-dot-or-space',
      whole,
      `in segment ${JSON.stringify(segment)}`,
    );
  }

  // `con.txt` is still the console device on Windows: the check is on the stem.
  const stem = segment.split('.')[0] ?? '';
  if (RESERVED_DEVICE_NAMES.has(stem.toLowerCase())) {
    throw new PathEscapeError(
      'reserved-device-name',
      whole,
      `in segment ${JSON.stringify(segment)}`,
    );
  }
}

/**
 * Resolves `segments` beneath `root` and refuses anything that leaves it.
 *
 * Lexical only — see the module comment. Throws {@link PathEscapeError} rather
 * than returning null, because every caller's correct response to an escape
 * attempt is to stop, and an ignorable return value is how that stops happening.
 */
export function resolveWithin(root: string, ...segments: string[]): string {
  const absoluteRoot = resolve(root);
  const relative = segments.join('/');

  if (relative.includes('\0')) {
    throw new PathEscapeError('null-byte', relative);
  }

  // `//server/share` and `\\server\share`. Node treats a UNC path as absolute
  // on Windows and as an ordinary rooted path on POSIX, so checking it before
  // `isAbsolute` keeps the rejection reason honest on both.
  if (/^[/\\]{2}/.test(relative)) {
    throw new PathEscapeError('unc', relative);
  }
  if (isAbsolute(relative) || relative.startsWith('/') || relative.startsWith('\\')) {
    throw new PathEscapeError('absolute', relative);
  }
  // `C:foo` is *not* absolute by `path.isAbsolute` on win32 — it means "foo,
  // relative to the current directory on drive C". Resolving it can land
  // anywhere, and it is the one traversal that looks like an ordinary relative
  // path.
  if (DRIVE_RELATIVE.test(relative)) {
    throw new PathEscapeError('drive-relative', relative);
  }

  for (const segment of segmentsOf(relative)) {
    if (segment === '.') continue;
    if (segment === '..') {
      throw new PathEscapeError('traversal', relative);
    }
    assertSafeSegment(segment, relative);
  }

  const candidate = resolve(absoluteRoot, relative);

  // Belt and braces. The segment walk above should make this unreachable, but
  // this is the assertion that actually states the property, and the cost of
  // being wrong here is the whole security model.
  if (!isContained(absoluteRoot, candidate)) {
    throw new PathEscapeError('traversal', relative);
  }

  return candidate;
}

/**
 * True when `candidate` is `root` itself or lies beneath it.
 *
 * Compared case-insensitively on Windows, where `C:\Data` and `C:\data` are one
 * directory — a case-sensitive check there would reject a legitimate path, and
 * (worse) could be talked into accepting one by a caller who knew which way it
 * leaned.
 */
export function isContained(root: string, candidate: string): boolean {
  const a = resolve(root);
  const b = resolve(candidate);
  const [normalisedRoot, normalisedCandidate] =
    process.platform === 'win32' ? [a.toLowerCase(), b.toLowerCase()] : [a, b];

  return (
    normalisedCandidate === normalisedRoot || normalisedCandidate.startsWith(normalisedRoot + sep)
  );
}

/**
 * Walks up until it finds a path that exists, and returns its real location.
 *
 * A write targets something that does not exist yet, so there is nothing to
 * `realpath`. What can be checked is the deepest ancestor that *does* exist: if
 * that is inside the root after following links, the new file will be too.
 */
async function realpathOfNearestExisting(target: string): Promise<string> {
  let current = target;

  for (;;) {
    try {
      return await realpath(current);
    } catch {
      const parent = dirname(current);
      if (parent === current) {
        // Reached the filesystem root without finding anything that exists.
        return current;
      }
      current = parent;
    }
  }
}

/**
 * The real location of a root, resolved once before anything is built on it — F26.
 *
 * `resolve` is lexical, and one directory can have several absolute paths that
 * all open the same files: a link pointing at it, a different casing, and on
 * Windows its 8.3 alias. **Every *read* agrees across those spellings. libuv's
 * directory watcher does not.** It expands the name `ReadDirectoryChangesW`
 * reports and asserts the result still starts with the string it was handed
 * (`src\win\fs-event.c:72`) — and when it does not, the assert is a native
 * `abort()`. No JS frame, nothing to catch, and the server dies before it
 * listens. [03 §5.1](../../../../docs/design/03-data-model.md) makes the index derived and
 * disposable precisely so its watcher failing is a recoverable event; it can
 * never be a dead process.
 *
 * A link root is the quieter half and the more likely one: no abort, and a
 * watcher that indexes **nothing**, because chokidar reports the target's paths
 * while the layout still holds the link's.
 *
 * Found by CI. `os.tmpdir()` returns the 8.3 form whenever the account name runs
 * past eight characters, and GitHub's Windows runner is `runneradmin`.
 *
 * **`realpathSync.native`, not `realpathSync`.** The plain one is Node's own JS
 * symlink walker: it follows links and hands back an 8.3 name exactly as it
 * found it, because a short name is not a link. Only the native variant goes
 * through the OS. The async {@link realpathOfNearestExisting} above expands
 * too, which is why {@link assertRealContained} was right all along and this
 * was not.
 *
 * **Sync**, although the async form would also work, because {@link Layout}'s
 * constructor calls it — and making that async turns every construction site
 * into a static factory, one of them at module scope, to fix a spelling bug.
 *
 * **Deepest existing ancestor, with the rest re-appended**, exactly as
 * {@link realpathOfNearestExisting} does it: `main.ts` builds a `Layout` on
 * `./data` before anything has created it, and a root that threw `ENOENT` from
 * inside a constructor would be the worse bug.
 *
 * **This is not a validation step** and must not grow into one. A root that
 * exists nowhere comes back lexically unchanged, and `mkdir` says so shortly.
 */
export function realRoot(root: string): string {
  const absolute = resolve(root);
  let current = absolute;

  for (;;) {
    try {
      // `relative` is empty when the whole path exists, and `join` drops it.
      return join(realpathSync.native(current), relative(current, absolute));
    } catch {
      const parent = dirname(current);
      if (parent === current) return absolute;
      current = parent;
    }
  }
}

/**
 * The real-path check on a path that is already built — F1's other half.
 *
 * {@link resolveWithinReal} is for a caller holding a root and some segments.
 * Most of this server is not: `Layout` composes paths in sync chained steps,
 * and the index hands back an absolute path it stored earlier. Those are the
 * paths that actually reach `open()`, so this is the form the check has to take
 * to be *called* — the audit's finding was never that the resolver was wrong,
 * only that nothing used it.
 *
 * Both sides are realpath'd, for the same reason as `resolveWithinReal`: a data
 * directory that is itself a link is an ordinary deployment.
 */
export async function assertRealContained(root: string, target: string): Promise<void> {
  const realRoot = await realpathOfNearestExisting(resolve(root));
  const realTarget = await realpathOfNearestExisting(resolve(target));

  if (!isContained(realRoot, realTarget)) {
    throw new PathEscapeError(
      'symlink-escape',
      relative(root, target) || target,
      `resolves to ${JSON.stringify(realTarget)}, outside ${JSON.stringify(realRoot)}`,
    );
  }
}

/**
 * {@link resolveWithin}, plus the check only the filesystem can answer.
 *
 * A path can pass every lexical rule and still escape: `library/actors/vera`
 * is innocent until `actors` turns out to be a symlink to `/etc`. This resolves
 * the deepest existing ancestor of the target and re-checks containment against
 * the *real* root.
 *
 * Both sides are realpath'd, because the root itself is frequently a link — a
 * data directory on another volume is a normal deployment, and comparing a real
 * candidate against a symlinked root would reject every path in it.
 */
export async function resolveWithinReal(root: string, ...segments: string[]): Promise<string> {
  const candidate = resolveWithin(root, ...segments);
  const realRoot = await realpathOfNearestExisting(resolve(root));
  const realCandidate = await realpathOfNearestExisting(candidate);

  if (!isContained(realRoot, realCandidate)) {
    throw new PathEscapeError(
      'symlink-escape',
      segments.join('/'),
      `resolves to ${JSON.stringify(realCandidate)}, outside ${JSON.stringify(realRoot)}`,
    );
  }

  return candidate;
}

/**
 * The asset-manifest rule from [03 §5.3](../../../../docs/design/03-data-model.md): a
 * manifest holds *relative paths within the object's folder*, never absolute and
 * never escaping it.
 *
 * A separate name rather than a comment on `resolveWithin`, because this is the
 * check that stops a malicious package writing outside its own directory, and a
 * reviewer should be able to find every place it is applied. ***Which was
 * nowhere until 2026-09-27***, so the one place bytes beside an object are read,
 * stored and swept followed any link it met. Those three are now its callers,
 * all in `library/assets.ts`, and each roots it at the object folder.
 */
export async function resolveAssetPath(
  objectFolder: string,
  manifestPath: string,
): Promise<string> {
  return resolveWithinReal(objectFolder, manifestPath);
}
