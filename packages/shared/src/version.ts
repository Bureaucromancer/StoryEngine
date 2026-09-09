// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

/**
 * The name a person calls a build, derived from the string the machinery
 * reads — [releases §7.1](../../../docs/design/workplan/04-repo-and-releases.md).
 *
 * The string is semver (`1.0.0-alpha.1`, `1.0.0-beta.1.1`, `1.0.0`, `1.0.1`)
 * and is what the tag, the data-directory stamp, the release test and the
 * workflow compare. The name (`1.0-alpha 1`, `1.0-beta 1.1`, `1.0`, `1.0.1`)
 * is what the footer and the About block show, and the rule that turns the one
 * into the other lives here and nowhere else — §7.1's *derived by one rule and
 * typed nowhere on its own*. Four places already carried the version before
 * anything compared them; a name that could not be derived would be a fifth
 * to disagree.
 *
 * Shared rather than client-side because a name is typed on the server's side
 * too — the CHANGELOG heading carries one beside its string, and
 * `version.test.ts` holds it to this function — and because a rule about the
 * project's own version belongs beside the schemas everything else is built
 * against.
 *
 * **The rule:** drop the patch when it is zero (`1.0.0` is `1.0`, `1.0.1`
 * stays `1.0.1`); keep the hyphen; put a space where the dot before the
 * prerelease number was (`-beta.1` is `-beta 1`) and keep a hotfix's second
 * field as a dot (`-beta.1.1` is `-beta 1.1`). Read the other way, every name
 * yields its string.
 *
 * **`null` for anything outside the scheme**, rather than a guess. A
 * prerelease with no number (`1.0.0-alpha`), a `v` prefix, a two-part version,
 * build metadata — §7.1 defines none of them, and a name invented for one
 * would be exactly the fifth spelling this function exists to prevent. The
 * caller shows the string as typed instead, so a build outside the scheme is
 * visible rather than tidied.
 */
export function versionName(version: string): string | null {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([a-z]+)((?:\.\d+)+))?$/.exec(version);
  if (match === null) return null;
  const major = match[1] ?? '';
  const minor = match[2] ?? '';
  const patch = match[3] ?? '';
  const word = match[4];
  const numbers = match[5];
  const release = patch === '0' ? `${major}.${minor}` : `${major}.${minor}.${patch}`;
  if (word === undefined || numbers === undefined) return release;
  // `numbers` arrives with its leading dot — `.1`, or `.1.1` for a hotfix. The
  // first dot is the one that becomes a space; any after it stay.
  return `${release}-${word} ${numbers.slice(1)}`;
}
