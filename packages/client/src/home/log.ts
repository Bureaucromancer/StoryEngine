// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { parseChangelog, type Changelog } from '@storyengine/shared';

import source from '../../../../CHANGELOG.md?raw';

/**
 * This build's changelog, parsed once.
 *
 * **Why the import is a build-time one rather than a route** — [P7B §1.3], and
 * unchanged by this revision. A changelog shown by a running build should be
 * *that build's*, which is the same category of fact as the version string
 * [AboutBuild](../about/AboutBuild.tsx) renders from the auth payload. A route
 * would invite a question nobody needs to answer — who may read it, and whether
 * it exists before sign-in — and a bundled string has no permission model
 * because it is not a resource. `tools/release.test.ts` already pins this file's
 * version against `package.json`, `compose.yaml` and the unraid template, so a
 * further consumer inherits that guarantee.
 *
 * **Why it is a module of its own, which is new.** Two surfaces read this
 * document now: the arrival page renders one release, and the workbench lists
 * them all. Parsed twice they could disagree — about which release is newest,
 * about whether `?release=` names one that exists — and the disagreement would
 * be a panel whose highlighted row was not the release beside it. One parse, at
 * module scope, and both read the same object.
 *
 * Module scope rather than a `useMemo` because the input is a constant folded
 * into the bundle: there is no render at which it could differ, and a hook
 * would be a cache keyed on something that cannot change.
 */
export const CHANGELOG: Changelog = parseChangelog(source);

/**
 * The release the page shows when the address does not name one — the newest in
 * this build's file.
 *
 * `undefined` only for a changelog with no releases at all, which is not a state
 * the shipped file can be in (`release.yml` refuses a tag without an entry) but
 * is one the type admits, so both surfaces answer for it rather than asserting
 * it away.
 */
export const NEWEST = CHANGELOG.releases[0];
