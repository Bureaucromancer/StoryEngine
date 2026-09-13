// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

import { BUILT_IN_MODE_PACKAGES } from '../packages/server/src/mode-loader.js';

/**
 * **The negative half of [P7.0]'s exit condition** —
 * [P7 §1.1](../docs/design/workplan/23-p7-implementation.md).
 *
 * That stage *ends at* two things: a deliberate bad import in the mode package
 * failing the build, **and `packages/server/src/modes/` gone, with a check that
 * fails if it comes back**. The first half is a lint rule with a shipped
 * subject and it holds itself. The second half had **no mechanism at all** — the
 * eslint policy governs what `packages/modes/*` may import and nothing in the
 * repository notices the directory reappearing — while §0 and §5 both call it
 * the phase's deliverable. This file is that mechanism.
 *
 * **Its subject is the repository, which is why it is here and not in a
 * package.** Same argument the `release` project makes for
 * `tools/release.test.ts`: the `packages` vitest project only looks inside each
 * package's own `src`, so a test about the *arrangement of packages* filed
 * there would be filed under a package it is not about.
 *
 * **Why this is not a tautology**, which is the standing objection to a test
 * that reads configuration. A tautological config test asserts that a file says
 * what the file says and moves whenever the file moves. Every assertion below
 * holds a promise made somewhere else — in [19 §10](../docs/design/19-tech-stack.md)'s
 * repository shape, in [22 §4.1](../docs/design/22-extensions.md)'s *"built-ins
 * go through the same boundary"*, in P7 §1.1's exit gate — against configuration
 * that is free to drift away from it silently and has exactly one mechanism,
 * this file, that notices. Prose in a design note cannot fail. This can.
 *
 * **The drifts it is actually against**, each one edit away and none of them
 * caught by `pnpm lint`, `pnpm typecheck` or `pnpm build`:
 *
 * - `packages/server/src/modes/` recreated, because a registry, a loader and a
 *   mode were neighbours for five stages and the name is still the obvious one.
 * - `@storyengine/mode-scene` added to `packages/server/package.json`, which is
 *   the natural way to make the loader's specifier resolve and the one direction
 *   the lint rules cannot see: eslint reads imports, not manifests.
 * - `{ "path": "../../modes/scene" }` added to the server's `tsconfig.json`,
 *   which §0.1a names as *"the obvious move and the wrong one"*.
 * - A second mode package whose `tsconfig.spec.json` nobody references from the
 *   root, so its tests typecheck against nothing.
 * - A mode in `BUILT_IN_MODE_PACKAGES` that the image does not deploy, which
 *   starts a server that refuses every turn.
 * - The eslint resolver losing the nested `tsconfig.json`, which does not fail
 *   anything — an import the resolver cannot resolve classifies as unknown, and
 *   an unknown import is *permitted*.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Every directory under `packages/modes/`, discovered rather than listed. */
function modePackageDirs(): string[] {
  const modes = join(ROOT, 'packages', 'modes');
  if (!existsSync(modes)) return [];
  return readdirSync(modes, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/**
 * The two file shapes this reads, declared rather than indexed.
 *
 * `noPropertyAccessFromIndexSignature` is on across this repository, so a
 * `Record<string, unknown>` would make every field below a bracket lookup — and
 * naming the four keys that are actually asserted is more honest than a cast to
 * a shape nobody wrote down.
 */
interface Manifest {
  name?: string;
  private?: boolean;
  license?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

interface TsConfig {
  references?: { path: string }[];
}

function readJson<T>(...parts: string[]): T {
  return JSON.parse(stripComments(readFileSync(join(ROOT, ...parts), 'utf8'))) as T;
}

/**
 * The tsconfigs in this repository are commented, and JSON.parse is not.
 *
 * Line comments only, because that is all they use and a general JSONC parser
 * would be a dependency added to the workspace root to read four files we
 * control — the trade `ci-shape.test.ts` already declined for YAML.
 */
function stripComments(text: string): string {
  return text
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
}

const DIRS = modePackageDirs();

describe('the mode packages exist and are shaped like packages', () => {
  it('finds at least one, or every assertion below is vacuously true', () => {
    // The failure this guards is the whole file quietly asserting nothing: every
    // `it.each` over an empty list passes, and a `packages/modes/` that had been
    // deleted or renamed would read as a clean run.
    expect(DIRS.length).toBeGreaterThan(0);
  });

  it.each(DIRS)('packages/modes/%s is named for what it is', (dir) => {
    const manifest = readJson<Manifest>('packages', 'modes', dir, 'package.json');

    // The name carries the class, which is what lets the image's deploy lines,
    // the root manifest and the loader's list be checked against each other
    // below rather than maintained in parallel by hand.
    expect(manifest.name).toBe(`@storyengine/mode-${dir}`);
    expect(manifest.private).toBe(true);
    expect(manifest.license).toBe('AGPL-3.0-or-later');
  });

  it.each(DIRS)('packages/modes/%s depends on the SDK and nothing else', (dir) => {
    const manifest = readJson<Manifest>('packages', 'modes', dir, 'package.json');

    // [19 §10]: built-in modes consume the published SDK *exactly as a third
    // party would*. A second dependency is not automatically wrong — a mode may
    // want a markdown renderer — but `@storyengine/server` or
    // `@storyengine/shared` here would be, the first because it reverses the
    // decision and the second because it is two paths to one vocabulary.
    const deps = Object.keys(manifest.dependencies ?? {});
    expect(deps).toContain('@storyengine/sdk');
    expect(deps).not.toContain('@storyengine/server');
    expect(deps).not.toContain('@storyengine/client');
    expect(deps).not.toContain('@storyengine/shared');
  });

  it.each(DIRS)('packages/modes/%s compiles against the SDK and nothing else', (dir) => {
    const tsconfig = readJson<TsConfig>('packages', 'modes', dir, 'tsconfig.json');
    const references = tsconfig.references ?? [];

    // The manifest above is what pnpm reads; this is what `tsc -b` reads, and
    // they fail differently. A reference to `../../server` would compile, and
    // nothing but this line would mind.
    expect(references.map((reference) => reference.path)).toEqual(['../../sdk']);
  });

  it.each(DIRS)('packages/modes/%s has a spec project, so its tests typecheck', (dir) => {
    // Without one the package's tests are excluded by `tsconfig.json` and
    // claimed by nothing — they lint, they run, and `tsc -b` never sees them.
    expect(existsSync(join(ROOT, 'packages', 'modes', dir, 'tsconfig.spec.json'))).toBe(true);
  });
});

describe('the root is what knows about modes', () => {
  const references = (readJson<TsConfig>('tsconfig.json').references ?? []).map(
    (reference) => reference.path,
  );

  it.each(DIRS)('builds packages/modes/%s, because nothing else may reference it', (dir) => {
    expect(references).toContain(`./packages/modes/${dir}`);
  });

  it.each(DIRS)('typechecks packages/modes/%s’s tests, which is the silent one', (dir) => {
    // The build reference failing is loud — `tsc -b` does not emit the package
    // and the loader finds nothing. A missing *spec* reference fails nothing at
    // all: the tests still run under vitest, which transpiles without checking.
    expect(references).toContain(`./packages/modes/${dir}/tsconfig.spec.json`);
  });

  it.each(BUILT_IN_MODE_PACKAGES)('declares %s, which is what makes it resolvable', (specifier) => {
    // `mode-loader.ts` resolves each built-in by bare specifier, so something on
    // the server's resolution path has to link it. The root is the distribution
    // and is where that belongs; `packages/server/package.json` would work and
    // would put a mode in the server's manifest, which is the edge below.
    const deps = readJson<Manifest>('package.json').dependencies ?? {};

    expect(Object.keys(deps)).toContain(specifier);
  });

  it('ships only modes that exist in the workspace', () => {
    const names = DIRS.map((dir) => `@storyengine/mode-${dir}`);

    expect(names).toEqual(expect.arrayContaining([...BUILT_IN_MODE_PACKAGES]));
  });
});

describe('the server does not acquire the edge it may not have', () => {
  it('has no packages/server/src/modes/ directory, which is P7.0’s exit condition', () => {
    // **The assertion the phase is named for.** `registry.ts` and `built-ins.ts`
    // lived beside `scene/` for five stages; the rehome to `mode-registry.ts`
    // and `mode-loader.ts` at the top of `src/` is what makes this checkable at
    // all, and a directory with this name is where a mode ends up next time
    // somebody is in a hurry.
    expect(existsSync(join(ROOT, 'packages', 'server', 'src', 'modes'))).toBe(false);
  });

  it('names no mode in its manifest', () => {
    const manifest = readJson<Manifest>('packages', 'server', 'package.json');
    const deps = Object.keys({
      ...(manifest.dependencies ?? {}),
      ...(manifest.devDependencies ?? {}),
    });

    // eslint reads imports, not manifests, so this direction is invisible to
    // `pnpm lint`. It is also the natural way to make the loader's specifier
    // resolve, which is exactly why it needs a check.
    expect(deps.filter((name) => name.startsWith('@storyengine/mode-'))).toEqual([]);
  });

  it('references no mode from its tsconfig', () => {
    const references = (
      readJson<TsConfig>('packages', 'server', 'tsconfig.json').references ?? []
    ).map((reference) => reference.path);

    // §0.1a item 5, as an assertion: *"`packages/server/tsconfig.json` must not
    // gain a reference to the mode. The graph forbids server → modes, and adding
    // it is the obvious move and the wrong one."*
    expect(references.filter((path) => path.includes('modes'))).toEqual([]);
  });

  it('imports no mode from anywhere in its source', () => {
    // The belt to the lint rule's braces, and it reads the source rather than
    // the config: `boundaries/dependencies` catches this too, but only while its
    // resolver is working, and the failure mode of that resolver is silence.
    const offenders = sourceFiles(join(ROOT, 'packages', 'server', 'src')).filter((file) =>
      /from\s+'@storyengine\/mode-/.test(readFileSync(file, 'utf8')),
    );

    expect(offenders).toEqual([]);
  });
});

describe('the image ships what the loader will ask for', () => {
  const dockerfile = readFileSync(join(ROOT, 'Dockerfile'), 'utf8');

  it.each(BUILT_IN_MODE_PACKAGES)('deploys %s beside the server', (specifier) => {
    // **The one whose failure is a server that starts and then refuses every
    // turn.** `pnpm deploy` walks one package's dependency closure and the
    // server's deliberately excludes the modes, so each has to be deployed by
    // name — and a mode added to the loader's list without a line here is an
    // image that boots, registers nothing, and throws `assertModesRunnable`'s
    // refusal at whoever presses Send.
    expect(dockerfile).toContain(`pnpm --filter ${specifier} --legacy deploy`);
  });
});

/**
 * **The rules actually firing, in the real tree rather than in the fixture one.**
 *
 * `tools/lint-fixtures/eslint-rules.test.ts` already asserts that both boundary
 * layers fire on `modes → server`, but it does so against `fixtureConfig` — a
 * graph built over the fixture root — so it proves the *rules* work and says
 * nothing about whether the repository's own `eslint.config.js` reaches a real
 * mode package. Those are different claims, and the second one is what P7.0
 * bought.
 *
 * **Two probes, because the two layers catch different things and this is where
 * that stopped being theory.** `eslint.rules.js` describes the name ban as "the
 * second, dumber layer", a backup for the graph rule's resolver failing. In this
 * repository, for a mode package, it is not a backup — it is the only layer that
 * sees a forbidden import *by package name*, because `@storyengine/server` is
 * not resolvable from `packages/modes/scene` at all (nothing links it there, by
 * design) and eslint-plugin-boundaries classifies an unresolvable dependency as
 * unknown, which it permits. The graph rule's unique value is the case no name
 * ban can express: a **relative path** reach into the server's source, which
 * resolves and is therefore classified.
 *
 * So each layer is asserted against the input it can actually see. Asserting
 * both on one probe is what an earlier draft did, and it passed under vitest and
 * failed as a standalone script over the identical file and config — an
 * environment-dependent assertion in the file that exists to make a gate
 * enforceable. Split this way, both probes report the same thing in both.
 *
 * *The probes are written to disk because they have to be: type-aware linting
 * goes through the TypeScript project service, which refuses a path that is not
 * in a project — `lintText` on a synthetic path reports "was not found by the
 * project service" and nothing else. Each is removed in a `finally`, and removed
 * again before the next write in case a crash left one behind.*
 */
describe('the boundary rules reach the real mode packages', () => {
  const PROBE = 'boundary-probe.generated.ts';
  const eslint = new ESLint({ cwd: ROOT });

  async function rulesFiredOn(dir: string, body: string): Promise<(string | null)[]> {
    const src = join(ROOT, 'packages', 'modes', dir, 'src');
    const file = join(src, PROBE);
    mkdirSync(src, { recursive: true });
    rmSync(file, { force: true });
    writeFileSync(
      file,
      [
        '// SPDX-License-Identifier: AGPL-3.0-or-later',
        '// Copyright (C) 2026 StoryEngine contributors',
        '',
        body,
      ].join('\n'),
    );

    try {
      const [result] = await eslint.lintFiles([file]);
      if (!result) throw new Error(`No lint result for ${file}`);
      const fatal = result.messages.find((message) => message.fatal);
      if (fatal) throw new Error(`${PROBE} failed to parse: ${fatal.message}`);
      return result.messages.map((message) => message.ruleId);
    } finally {
      rmSync(file, { force: true });
    }
  }

  it.each(DIRS)(
    'bans the server by name inside packages/modes/%s',
    async (dir) => {
      const fired = await rulesFiredOn(
        dir,
        "import type { AppServices } from '@storyengine/server';\n\nexport type Probe = AppServices;\n",
      );

      expect(fired).toContain('no-restricted-imports');
    },
    30_000,
  );

  it.each(DIRS)(
    'classifies a relative reach out of packages/modes/%s, which is the graph rule’s own case',
    async (dir) => {
      // The import the name ban cannot express, and the one that proves the
      // resolver is classifying rather than shrugging: a path that resolves to a
      // file under `packages/server/`, which the element patterns match.
      const fired = await rulesFiredOn(
        dir,
        "import type { AppServices } from '../../../server/src/app.js';\n\nexport type Probe = AppServices;\n",
      );

      expect(fired).toContain('boundaries/dependencies');
    },
    30_000,
  );

  it.each(DIRS)(
    'leaves a permitted import alone in packages/modes/%s',
    async (dir) => {
      // **A rule that fires on everything is as useless as one that fires on
      // nothing** — `eslint-rules.test.ts` says so and this is the same control,
      // against the real config. It also catches the failure that would make
      // both assertions above meaningless in the other direction: a mode package
      // whose own SDK import has stopped resolving.
      const fired = await rulesFiredOn(
        dir,
        "import type { Mode } from '@storyengine/sdk';\n\nexport type Probe = Mode;\n",
      );

      expect(fired).not.toContain('no-restricted-imports');
      expect(fired).not.toContain('boundaries/dependencies');
    },
    30_000,
  );
});

/** Every `.ts` under a directory, skipping `node_modules` and build output. */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(path));
    else if (entry.name.endsWith('.ts')) out.push(path);
  }
  return out;
}

/**
 * ***Gate step 2's second clause, as the tracked-file survey §3.1 asks for*** —
 * [06 §2](../docs/design/06-modes-and-turn-pipeline.md), [P7 §3] row 2b, written
 * at [P7.9].
 *
 * The step: *"the engine contains no `switch (mode)` — the survey is a grep and
 * it belongs in the gate."* §3.1 sharpens it and is worth quoting, because the
 * literal reading is the weak one: *"[06 §2] says the host never has one, which
 * also fails as an `if`, a mode-keyed lookup, or **a mode id spelled in engine
 * code**. The last of those is the shape that matters."*
 *
 * ***So this surveys for mode ids, not for `switch`.*** A `switch` on a mode is
 * the easy shape to avoid and the easy shape to find; what actually erodes a
 * contract is one engine file quietly naming one mode, after which the next one
 * is a precedent rather than a decision. **Every id that reaches this file is
 * therefore an allowlist entry with a reason**, which is the mechanism: adding a
 * line here is a visible act, and a build that needs to add a third should stop
 * and ask why.
 *
 * *Two kinds of file are exempt and both are stated rather than assumed.* Tests
 * name modes constantly — that is what a test of a mode is — and
 * `test-mode.ts`'s fixtures declare ids of their own, which are modes the engine
 * ships for itself and not knowledge about somebody else's.
 *
 * **This is the survey half. The lint-rule half is not built** — §3.1 asks for
 * *"a lint rule with fixtures, plus a tracked-file survey"* and what exists is
 * the second. A rule would catch a new `switch (mode)` at the moment somebody
 * typed it rather than at the next `pnpm test`, which is better and is not the
 * difference between enforced and unenforced.
 */
describe('the engine names no mode', () => {
  const ENGINE = join(ROOT, 'packages', 'server', 'src');

  /**
   * **Each of these is a deliberate literal with a reason on it**, and the
   * reason is in the source beside the line. A fourth arriving without a
   * paragraph is what this list exists to make awkward.
   */
  const ALLOWED = new Map<string, string>([
    [
      'mode-registry.ts',
      "DEFAULT_MODE_ID — the distribution's choice of default, which is a fact about this build rather than knowledge about the mode. Pinned to the package's own spelling by mode-loader.test.ts, which imports neither side.",
    ],
    [
      'test-mode.ts',
      "The engine's own fixtures declare ids of their own. A mode the engine ships for itself is not the engine knowing about somebody else's.",
    ],
  ]);

  /** Every `.ts` under the engine's source that is not a test. */
  function engineSources(dir: string, found: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) engineSources(path, found);
      else if (entry.name.endsWith('.ts') && !entry.name.includes('.test.')) found.push(path);
    }
    return found;
  }

  const sources = engineSources(ENGINE);

  it('finds the engine’s sources, or every assertion below is vacuously true', () => {
    expect(sources.length).toBeGreaterThan(50);
  });

  /**
   * *The literal reading of the step, kept because it is what the step says*,
   * and because a `switch` is what somebody reaches for first when the pressure
   * to special-case one mode finally arrives.
   */
  it('switches on no mode', () => {
    const switching: string[] = [];
    for (const path of sources) {
      const body = readFileSync(path, 'utf8');
      if (/switch\s*\(\s*[A-Za-z.]*\bmode(Id)?\b/i.test(body)) switching.push(path);
    }
    expect(switching).toEqual([]);
  });

  /**
   * ***The shape that matters.*** A mode id in engine code is the engine knowing
   * which modes exist, which is the bet [19 §10](../docs/design/19-tech-stack.md)
   * calls the design's central one.
   */
  it('spells no mode id outside the two places that have a reason', () => {
    const named: string[] = [];
    for (const path of sources) {
      const file = path.slice(ENGINE.length + 1);
      const base = file.split('/').at(-1) ?? file;
      if (ALLOWED.has(base)) continue;

      const body = readFileSync(path, 'utf8');
      // Code only: a docstring naming a mode is a reference to a design note,
      // and this file is about what the engine *does*.
      const code = body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
      for (const match of code.matchAll(
        /['"`]storyengine\.(scene|freeform|campaign|messages)[^'"`]*['"`]/g,
      )) {
        named.push(`${file} → ${match[0]}`);
      }
    }
    expect(
      named,
      'a mode id in engine code — see this file for why that is the shape that matters',
    ).toEqual([]);
  });

  /**
   * *And the allowlist is held to being small.* A list that grows is a contract
   * that is being eroded one justified exception at a time, which is exactly how
   * the erosion this gate step is about would look from the inside.
   */
  it('keeps the allowlist to the two entries that have arguments', () => {
    expect([...ALLOWED.keys()].sort()).toEqual(['mode-registry.ts', 'test-mode.ts']);
  });
});
