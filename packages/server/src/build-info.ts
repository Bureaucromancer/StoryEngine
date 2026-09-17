// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { fileURLToPath } from 'node:url';

import { readFileBytes } from './storage/files.js';

/**
 * What build this is — [P6A §1.5](../../../docs/design/workplan/19-p6a-alpha-1.md),
 * [releases §7](../../../docs/design/workplan/04-repo-and-releases.md).
 *
 * **A frozen build that cannot say what it is defeats its own purpose.** The
 * whole of P6A is *a build you can go back to*; a running container that cannot
 * name the commit it came from leaves you back where the phase started, reading
 * a commit graph and guessing.
 *
 * **Written into the artifact, not read from the environment.** An environment
 * variable would be settable by whoever runs the image, so a container could
 * say anything; the file is put there by the build that made it. Absent means a
 * build nobody identified, which is every development run and is reported as
 * such rather than as a version.
 *
 * Deliberately **not** the About surface. That is [P11.6] and needs a
 * specification no document has written yet — [10 §15.3] enumerates the admin
 * panels and About is not among them — so what this stage ships is the string,
 * and the surface arrives later to a value that already exists.
 *
 * It arrived at alpha.2, in part: the footer on every page and the About block
 * on the user half of Settings ([10 §15.1]) render this value from
 * `GET /api/auth/state`, after the first install of Alpha 1 could not name the
 * build it was running. The §13 link is still [P11.6]'s.
 */

export interface BuildInfo {
  /** The version this build claims, matching the tag it was cut at ([P6A §1.6]). */
  version: string;
  /** The commit it was built from. Short or full; whatever the builder wrote. */
  commit: string;
  /**
   * Where this build's source is — [09 §7](../../../docs/design/09-server-multiuser-deployment.md),
   * [P10.5].
   *
   * ***Written by whoever cut the build, from the remote they cut it from***,
   * which is the whole of why it is a field rather than a constant. AGPL §13
   * obliges an offer of the source corresponding to **the running version**, and
   * §7 names the case that makes that more than a link: *"a link to `main` is
   * not strictly compliant when the operator is running a patched build — and
   * the patched-build case is exactly the one §13 exists for."* A fork that
   * ships its own image ships its own link, with nothing to remember.
   *
   * **Optional, because a build can honestly not know.** A clone with no
   * `origin`, an export, a tarball: the field is absent and the footer shows no
   * link rather than pointing somebody at somebody else's repository, which
   * would be a worse answer than none.
   */
  source?: string;
}

/**
 * The identity file, or null when this build has none.
 *
 * **Resolved from the package root rather than from the compiled output**, which
 * is what lets one path work in both arrangements: this module is
 * `src/build-info.ts` under `tsx` and `dist/build-info.js` after a build, and
 * both are exactly one directory below `packages/server/`. A path relative to
 * the *output* would have needed two answers and would have been wrong in
 * whichever one nobody tested.
 *
 * Every failure is null — absent, unreadable, not JSON, missing a field. A
 * server that refused to start because it could not identify itself would turn
 * a cosmetic fact into an outage, and the honest report for all four is the
 * same: this build was not identified.
 */
export async function readBuildInfo(): Promise<BuildInfo | null> {
  // `fileURLToPath`, not `.pathname`: on Windows the latter is `/C:/…`, which is
  // not a path anything can open.
  const bytes = await readFileBytes(fileURLToPath(new URL('../build-info.json', import.meta.url)));
  return bytes === null ? null : parseBuildInfo(new TextDecoder().decode(bytes));
}

/**
 * The decidable half, split out so it can be tested.
 *
 * What is left in {@link readBuildInfo} is one path expression, which no unit
 * test can check without writing into the package it is testing — so the rules
 * live here and the path is proved by running a built server, which is what
 * [P6A §3] step 8 does.
 */
export function parseBuildInfo(text: string): BuildInfo | null {
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { version, commit, source } = parsed as Record<string, unknown>;
    if (typeof version !== 'string' || typeof commit !== 'string') return null;
    if (version === '' || commit === '') return null;
    /**
     * ***`source` is optional and a bad one is dropped rather than refused***,
     * which is the other two fields' rule inverted and deliberately so: they
     * are the **identity**, and a build that cannot say what it is has no
     * business claiming to be something. A source link is an **offer**, and an
     * absent offer is a smaller problem than a refusal to start — [P6A §1.5]'s
     * own argument that a cosmetic fact must not become an outage.
     *
     * *Only `http` and `https`*, so a `javascript:` or a `file:` in a
     * hand-edited identity file cannot become an anchor's `href` on every page
     * of a signed-in surface.
     */
    const offered = typeof source === 'string' && /^https?:\/\//.test(source) ? { source } : {};
    return { version, commit, ...offered };
  } catch {
    return null;
  }
}

/**
 * Semantic version precedence: negative, zero or positive — or `null` when
 * either side is not a version this understands.
 *
 * **Hand-written, and the null is why that is defensible.** A comparator is a
 * small thing to get subtly wrong, and the usual answer is a dependency; what
 * makes one unnecessary here is that the caller ([§1.7]'s stamp) has a safe
 * answer for *I cannot tell* — refuse, and say what it read. So this implements
 * the precedence rules for the versions this project produces and admits it
 * when handed anything else, rather than guessing and being confidently wrong
 * about a directory somebody's data is in.
 *
 * Build metadata (`+…`) is ignored, which is the specification's own rule.
 */
export function compareVersions(left: string, right: string): number | null {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (a === null || b === null) return null;

  for (let index = 0; index < 3; index += 1) {
    const difference = (a.release[index] ?? 0) - (b.release[index] ?? 0);
    if (difference !== 0) return difference;
  }

  // A release outranks any prerelease of the same numbers: 1.0.0 > 1.0.0-alpha.1.
  if (a.pre.length === 0 && b.pre.length === 0) return 0;
  if (a.pre.length === 0) return 1;
  if (b.pre.length === 0) return -1;

  for (let index = 0; index < Math.max(a.pre.length, b.pre.length); index += 1) {
    const one = a.pre[index];
    const two = b.pre[index];
    // A shorter set of identifiers is lower, all else being equal.
    if (one === undefined) return -1;
    if (two === undefined) return 1;
    if (one === two) continue;

    const oneNumeric = /^\d+$/.test(one);
    const twoNumeric = /^\d+$/.test(two);
    // Numeric identifiers compare numerically and always rank below
    // alphanumeric ones — `alpha.2` beats `alpha.10` otherwise.
    if (oneNumeric && twoNumeric) return Number(one) - Number(two);
    if (oneNumeric) return -1;
    if (twoNumeric) return 1;
    return one < two ? -1 : 1;
  }
  return 0;
}

interface ParsedVersion {
  release: number[];
  pre: string[];
}

function parseVersion(value: string): ParsedVersion | null {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(value);
  if (match === null) return null;
  return {
    release: [Number(match[1]), Number(match[2]), Number(match[3])],
    pre: match[4] === undefined ? [] : match[4].split('.'),
  };
}
