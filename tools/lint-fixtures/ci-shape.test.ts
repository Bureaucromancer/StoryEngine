// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * **The two exit-gate clauses that are about the build rather than about the code.**
 *
 * [P2 §4](../../docs/design/workplan/08-p2-implementation.md) step 1: *"The P1 gate
 * stays green — [P1 §3], automated to the three tiers §3's P2.0 entry defines,
 * **on ubuntu and Windows, as standing regression** (P2.0)."* And step 20, in
 * its second half: *"…and **the rebuild property test is a named CI step on
 * both OSes** (F11, F17)."*
 *
 * Every other step in that list is held by a test that runs product code. These
 * two are not claims about product code at all — they are claims about the
 * repository's own configuration, and at the time this file was written both
 * were *true of the repository and held by nothing*. No test in the workspace
 * read `.github/workflows/ci.yml`, `package.json` or `vitest.config.ts`, so
 * each of the following one-line edits left every test green, the checks list
 * green, and the gate quietly retired:
 *
 * - Delete `windows-latest` from the job matrix. The Windows job exists because
 *   of **F4** — an `ignored` predicate that compared mixed separators and so
 *   matched nothing on win32, invisible for as long as CI was ubuntu-only. Every
 *   test in the suite still passes without it; that is the point.
 * - Leave the matrix alone and change `runs-on: ${{ matrix.os }}` to a literal.
 *   The matrix still *names* Windows and nothing ever runs there — the more
 *   plausible accident of the two, and the one a matrix-only assertion misses.
 * - Move the workflow's triggers to `workflow_dispatch` only. "Standing
 *   regression" is the whole of step 1's second clause: a suite that runs when
 *   someone remembers to press a button is a suite that runs after the breakage.
 * - Rename the `test:gate` script, or repoint the `gate` project's `include`.
 *   The chain workflow → script → project → file has four links and no test on
 *   any of them.
 * - Delete the `name:` from the gate's step. It still runs — inside `pnpm test`
 *   as well, which is why it is cheap — but the checks list stops saying *which*
 *   gate went red, and the name in the checks list is the entirety of what
 *   **F17** asked for.
 * - Put `.skip` on the property test itself. This is the one a named step does
 *   **not** cover, and F17's sentence is literally *"a `test.skip` retires it and
 *   nobody notices"*: `vitest run --project gate` exits 0 with every test
 *   skipped, and the named check reports success over an empty run.
 *
 * **Why this is not tautological.** A tautological config test asserts that a
 * file says what the file says, and moves whenever the file moves. These
 * assertions hold a promise made *somewhere else* — in the gate above, in [P2
 * §3]'s P2.0 stage ("Windows CI job … `format:check`, `--max-warnings 0`"), and
 * in [testing §6](../../docs/design/workplan/03-testing.md)'s per-PR tier —
 * against configuration that is free to drift away from it silently and has
 * exactly one mechanism, this file, that notices. The subject is the promise;
 * the text is only how the promise is read. Prose in a design doc cannot fail.
 * This can.
 *
 * **Why there is no YAML parser here.** Adding a dependency to the workspace
 * root to read one 92-line file we control is the worse trade. The scan below is
 * indentation-aware where it has to be and *loud* everywhere: each helper throws
 * naming the construct it could not find, so a restructured workflow produces a
 * message about the workflow rather than a comparison against `undefined` that
 * passes or fails for the wrong reason.
 */

/**
 * The repository root, from this file rather than from `process.cwd()`.
 *
 * The `lint-rules` vitest project sets `root: '.'` and is invoked from the
 * workspace root today, so cwd would work — until someone runs a single file
 * from inside `tools/`, at which point every path here resolves to nothing and
 * the failure looks like missing configuration rather than a bad base path.
 * `import.meta.url` cannot drift.
 */
const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

const WORKFLOW = '.github/workflows/ci.yml';
const PACKAGE_JSON = 'package.json';
const VITEST_CONFIG = 'vitest.config.ts';

/**
 * A repository file as text, with line endings normalised.
 *
 * `.gitattributes` pins `eol=lf`, so the normalisation should be a no-op — but
 * this is the file that would have to survive a checkout where it is not, and
 * of all the tests in the suite this is the one that must mean the same thing
 * on both legs of the matrix it exists to protect. A `\r` on the end of every
 * scanned value would break the scan in a way that reads as config drift.
 */
function repoText(relativePath: string): string {
  return readFileSync(join(REPO_ROOT, relativePath), 'utf8').replace(/\r\n/g, '\n');
}

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

/**
 * Everything nested under the first line matching `matcher`, by indentation.
 *
 * Blank lines are kept rather than treated as terminators — the workflow puts
 * one between every step, and a blank-line-terminated block would see exactly
 * one step and then assert cheerfully about the rest of a file it never read.
 */
function blockUnder(lines: readonly string[], matcher: RegExp): string[] {
  const start = lines.findIndex((line) => matcher.test(line));
  if (start === -1) {
    throw new Error(
      `${WORKFLOW} has no line matching ${String(matcher)} — has it been restructured?`,
    );
  }
  const outer = indentOf(lines[start] ?? '');
  const block: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === '') {
      block.push(line);
      continue;
    }
    if (indentOf(line) <= outer) break;
    block.push(line);
  }
  return block;
}

/** A YAML flow sequence — `[ubuntu-latest, windows-latest]` — as its entries. */
function flowList(value: string): string[] {
  const match = /^\[(.*)\]$/.exec(value.trim());
  if (match === null) return [];
  return (match[1] ?? '')
    .split(',')
    .map((entry) => entry.trim().replace(/^['"]|['"]$/g, ''))
    .filter((entry) => entry.length > 0);
}

/**
 * A sequence-valued key, written either inline or as a block.
 *
 * Both spellings are read because the assertion is about *what the matrix
 * contains*, and reformatting `os: [a, b]` across three lines is a change to
 * nothing that matters. A test that fails on the reformat teaches people to
 * delete the test.
 */
function sequenceUnder(lines: readonly string[], key: string): string[] {
  const keyLine = new RegExp(`^\\s*${key}:`);
  const found = lines.find((line) => keyLine.test(line));
  if (found === undefined) throw new Error(`No \`${key}:\` in the block being read.`);

  const inline = flowList(found.slice(found.indexOf(':') + 1));
  if (inline.length > 0) return inline;

  return blockUnder(lines, keyLine)
    .map((line) => /^\s*-\s*(.+)$/.exec(line)?.[1]?.trim())
    .filter((entry): entry is string => entry !== undefined);
}

/**
 * The workflow with its comments removed.
 *
 * `ci.yml`'s header comment is long and says several of the things asserted
 * below in prose — "It runs on ubuntu and Windows", "joins this file as a
 * *named* step". An assertion a comment can satisfy is an assertion about
 * nothing, and this one would have been: the comment would have kept it green
 * through the deletion of the matrix entry it describes.
 */
function workflowLines(): string[] {
  return repoText(WORKFLOW)
    .split('\n')
    .map((line) => line.replace(/(^|\s)#.*$/, ''))
    .map((line) => (line.trim() === '' ? '' : line));
}

interface WorkflowStep {
  /** `undefined` when the step has no `name:` — which is the thing F17 is about. */
  readonly name: string | undefined;
  /** The `run:` script, block scalars folded into one string. */
  readonly run: string | undefined;
  /** The step's `if:` condition, when it has one. */
  readonly if: string | undefined;
}

/**
 * `jobs.check.steps`, as steps.
 *
 * Fields are taken only at the step's own indentation, so the `node-version:`
 * and `cache:` under `actions/setup-node`'s `with:` are not mistaken for the
 * step's own keys. Block scalars (`run: |`) are folded because the assertions
 * below are about which commands CI runs, and whether a step spells two
 * commands on two lines or in one `|` block is not a fact about CI's coverage.
 */
function workflowSteps(): WorkflowStep[] {
  const block = blockUnder(workflowLines(), /^\s*steps:\s*$/);
  const first = block.find((line) => line.trim().startsWith('- '));
  if (first === undefined) throw new Error(`${WORKFLOW}'s \`steps:\` holds no list items.`);
  const itemIndent = indentOf(first);

  const groups: string[][] = [];
  for (const line of block) {
    const isItemStart = indentOf(line) === itemIndent && line.trim().startsWith('- ');
    if (isItemStart || groups.length === 0) groups.push([]);
    groups[groups.length - 1]?.push(line);
  }

  return groups.map((group) => {
    // `- name: x` and `  name: x` are the same field written two ways; rewriting
    // the dash to spaces means one parse handles both, and it puts every field
    // of every step at exactly `itemIndent + 2`.
    const lines = group.map((line, at) => (at === 0 ? line.replace(/^(\s*)-\s/, '$1  ') : line));
    const fields = new Map<string, string>();

    for (let at = 0; at < lines.length; at += 1) {
      const line = lines[at];
      if (line === undefined || line.trim() === '') continue;
      const match = /^(\s*)([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
      if (match === null) continue;
      const [, pad = '', key = '', rawValue = ''] = match;
      if (pad.length !== itemIndent + 2) continue;

      if (!/^[|>]/.test(rawValue.trim())) {
        fields.set(key, rawValue.trim());
        continue;
      }

      const body: string[] = [];
      let scan = at + 1;
      for (; scan < lines.length; scan += 1) {
        const next = lines[scan];
        if (next === undefined) break;
        if (next.trim() === '') {
          body.push('');
          continue;
        }
        if (indentOf(next) <= pad.length) break;
        body.push(next.trim());
      }
      at = scan - 1;
      fields.set(key, body.join('\n').trim());
    }

    return { name: fields.get('name'), run: fields.get('run'), if: fields.get('if') };
  });
}

/** Every command CI runs, one per line, so a two-command step counts as two. */
function runCommands(): string[] {
  return workflowSteps()
    .flatMap((step) => (step.run ?? '').split('\n'))
    .map((command) => command.trim())
    .filter((command) => command.length > 0);
}

interface PackageJson {
  readonly scripts?: Record<string, string | undefined>;
}

function scripts(): Record<string, string | undefined> {
  const parsed = JSON.parse(repoText(PACKAGE_JSON)) as PackageJson;
  return parsed.scripts ?? {};
}

/**
 * Source with comments removed, tracking string state.
 *
 * Needed twice, and for opposite reasons. In `vitest.config.ts` the docstring
 * above the `gate` project explains the project by quoting the very syntax
 * scanned for below. In `rebuild-property.test.ts` the same risk runs the other
 * way: the retirement scan must not fire on a docstring that *mentions*
 * `test.skip` — F17's own sentence, which any future editor might reasonably
 * quote there — and must still fire on one real `.skip`.
 *
 * Regex literals are not tracked: a `/` outside a string is treated as an
 * ordinary character unless it opens `//` or `/*`, which is right for division
 * and wrong for a regex containing a quote. Neither scanned file has one, and
 * the guard below turns that case into a loud failure rather than a silent
 * mis-scan, which is the only property that matters here.
 */
function stripComments(source: string): string {
  type State = 'code' | 'line' | 'block' | "'" | '"' | '`';
  let state: State = 'code';
  let out = '';

  for (let at = 0; at < source.length; at += 1) {
    const char = source[at] ?? '';
    const next = source[at + 1] ?? '';

    if (state === 'line') {
      if (char === '\n') {
        state = 'code';
        out += char;
      }
      continue;
    }
    if (state === 'block') {
      if (char === '*' && next === '/') {
        state = 'code';
        at += 1;
      } else if (char === '\n') {
        out += char;
      }
      continue;
    }
    if (state === "'" || state === '"' || state === '`') {
      out += char;
      if (char === '\\') {
        out += next;
        at += 1;
      } else if (char === state) {
        state = 'code';
      }
      continue;
    }

    if (char === '/' && next === '/') {
      state = 'line';
      at += 1;
      continue;
    }
    if (char === '/' && next === '*') {
      state = 'block';
      at += 1;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') state = char;
    out += char;
  }

  if (state !== 'code' && state !== 'line') {
    throw new Error(
      `The comment scan ended inside ${state} — it mis-read the source, so its verdict means nothing.`,
    );
  }
  return out;
}

/**
 * The literal values of top-level `const NAME = '…'` declarations.
 *
 * `vitest.config.ts` deliberately hoists the gate's path into a constant
 * because it is "referenced twice", so reading `include:` alone finds the
 * identifier `GATE` and not a path. Following the binding is the difference
 * between asserting what the config *does* and asserting how it is spelled.
 */
function stringConstants(source: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const match of source.matchAll(/^const\s+([A-Za-z_$][\w$]*)\s*=\s*'([^']*)'\s*;/gm)) {
    const [, name, value] = match;
    if (name !== undefined && value !== undefined) found.set(name, value);
  }
  return found;
}

/**
 * The `include:` of the vitest project called `projectName`, with identifiers
 * resolved to their paths.
 *
 * The slice runs from this project's `name:` to the next one, so the entry
 * belongs to the project asked for rather than to whichever project happens to
 * declare an `include` first.
 */
function projectInclude(projectName: string): string[] {
  const source = stripComments(repoText(VITEST_CONFIG));
  const marker = `name: '${projectName}'`;
  const start = source.indexOf(marker);
  expect(
    start,
    `${VITEST_CONFIG} declares no project called '${projectName}', so \`--project ${projectName}\` matches nothing`,
  ).toBeGreaterThan(-1);

  const nextProject = source.indexOf("name: '", start + marker.length);
  const segment = source.slice(start, nextProject === -1 ? undefined : nextProject);

  const include = /include:\s*\[([^\]]*)\]/.exec(segment);
  if (include === null) throw new Error(`The '${projectName}' project declares no \`include\`.`);

  const constants = stringConstants(source);
  return (include[1] ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => {
      const literal = /^'([^']*)'$/.exec(entry);
      if (literal !== null) return literal[1] ?? '';
      const resolved = constants.get(entry);
      if (resolved === undefined) {
        throw new Error(`\`include\` names ${entry}, which is not a top-level string constant.`);
      }
      return resolved;
    });
}

describe('gate step 1 — the P1 gate runs on both platforms, on every change', () => {
  /**
   * The matrix and the job that consumes it, asserted as a pair.
   *
   * Catches two different single-line mutations that a one-sided assertion
   * would not: deleting `windows-latest` from `os:` (the matrix loses the
   * platform), and rewriting `runs-on:` to a literal (the matrix keeps naming a
   * platform the job never uses, which is the drift that reads as correct in a
   * diff). `ubuntu-latest` is asserted too, in both directions — the finding
   * being repaired is one-sided coverage, and swapping one one-sided pipeline
   * for the other is not a fix.
   */
  it('names ubuntu-latest and windows-latest in the matrix, and runs the job on it', () => {
    const lines = workflowLines();
    const platforms = sequenceUnder(blockUnder(lines, /^\s*matrix:\s*$/), 'os');

    expect(platforms, 'the ubuntu leg of the matrix').toContain('ubuntu-latest');
    expect(
      platforms,
      'the Windows leg — F4 (a mixed-separator `ignored` predicate that matched nothing on win32) ' +
        'is what an ubuntu-only pipeline cost, and no product test can notice its absence',
    ).toContain('windows-latest');

    const runsOn = /^\s*runs-on:\s*(.+)$/m.exec(lines.join('\n'))?.[1]?.trim();
    expect(runsOn, 'a matrix the job does not consume is a matrix that runs on one platform').toBe(
      '${{ matrix.os }}',
    );
  });

  /**
   * "Standing regression" is a claim about *when* CI runs, and it is the half
   * of step 1 that no amount of matrix correctness delivers.
   *
   * Catches: deleting either trigger, or replacing the pair with
   * `workflow_dispatch`. `fail-fast: false` rides along because the whole
   * subject of the step is one platform disagreeing with the other, and a
   * cancelled green leg hides which half is which — deleting that line turns a
   * two-platform pipeline back into a one-answer one.
   */
  it('triggers on pull_request and on push to main, rather than on demand', () => {
    const lines = workflowLines();
    const on = blockUnder(lines, /^on:\s*$/);
    const triggers = on
      .filter((line) => indentOf(line) === 2)
      .map((line) => /^\s*([a-z_]+):/.exec(line)?.[1])
      .filter((trigger): trigger is string => trigger !== undefined);

    expect(triggers, 'every proposed change is checked before it lands').toContain('pull_request');
    expect(triggers, 'and every change that lands is checked again as it lands').toContain('push');
    expect(sequenceUnder(blockUnder(on, /^\s*push:/), 'branches')).toContain('main');

    expect(
      lines.some((line) => /^\s*fail-fast:\s*false\s*$/.test(line)),
      'with fail-fast on, the failing leg cancels the other and the checks list stops saying ' +
        'whether the breakage is platform-specific — which is the only question the matrix exists to answer',
    ).toBe(true);
  });

  /**
   * The per-PR tier from [testing §6]: *"typecheck, lint including the boundary
   * rules, unit, golden-file, schema validation, build"*, with `format:check`
   * ahead of them per the workflow's own header.
   *
   * Catches deleting any one of the five `- run:` lines. `pnpm test` is matched
   * as a whole command rather than as a substring, because `pnpm test:gate` —
   * the step below — contains it: a substring match would keep this green with
   * the entire suite deleted from CI and only the gate left running.
   */
  it('runs format, typecheck, lint, build and the whole suite', () => {
    const commands = runCommands();

    for (const command of ['pnpm format:check', 'pnpm typecheck', 'pnpm lint', 'pnpm build']) {
      expect(commands, `${command} is part of the per-PR tier`).toContain(command);
    }
    expect(
      commands,
      'the suite itself, as a whole command — `pnpm test:gate` contains this string',
    ).toContain('pnpm test');
  });

  /**
   * F17's fourth clause, and the only one that lives in `package.json` rather
   * than in the workflow: *"`eslint .` without `--max-warnings 0` while
   * `exhaustive-deps` is warn-level"*.
   *
   * It is asserted on the script rather than on the CI line deliberately, and
   * `ci.yml` says why: the flag lives in `lint:es` "so that `pnpm lint` means
   * the same thing here and on a developer's machine". Catches deleting the
   * flag — after which every warn-level rule, `exhaustive-deps` among them,
   * reports and exits 0 on both platforms.
   */
  it('makes a lint warning fail the build, in the script rather than in the workflow', () => {
    expect(scripts()['lint:es']).toBe('eslint . --max-warnings 0');
  });
});

describe('gate step 20 — the rebuild property test is a named CI step', () => {
  /**
   * The pair F17 actually asked for: a step that both **runs** the gate and
   * **carries a name**.
   *
   * Asserting the command alone would be satisfied by an anonymous step, which
   * is the state the finding describes — the run happens, and the checks list
   * shows `check (windows-latest)` going red with nothing to say about why.
   * Asserting a name alone would be satisfied by a step that names the gate and
   * runs something else.
   *
   * The name is matched loosely, on the subject rather than on the sentence:
   * rewording "Rebuild from disk equals the incremental index" is not drift, and
   * a test that fails on a reword is a test people learn to delete. Renaming it
   * to "step 20", which is what the checks list would then say, is drift.
   * Catches: deleting the `name:` line, or the `run:` line, from that step.
   */
  it('has exactly one step that both runs `pnpm test:gate` and says what it gates', () => {
    const gateSteps = workflowSteps().filter((step) => (step.run ?? '').includes('test:gate'));

    expect(gateSteps, 'one step, so "the named step" is a thing and not several').toHaveLength(1);
    const gate = gateSteps[0];
    expect(gate?.run).toBe('pnpm test:gate');
    expect(
      gate?.name,
      'the name in the checks list is the whole of what F17 asked for; without it the step is ' +
        'the anonymous suite run it already had',
    ).toMatch(/rebuild/i);
  });

  /**
   * ***A named gate that can go red under its own name.*** `pnpm test` runs the
   * `gate`, `fixture-pair` and `docs` projects before any of these steps, so
   * under the implicit `success()` a failing gate failed `pnpm test` first and
   * its own step then showed *skipped* — the checks list could say a named gate
   * held or was skipped, and never that it broke. That was the state of every
   * run on `main` from 2026-09-15 for eighteen runs.
   *
   * Catches: deleting the `if:` from any of the three, or narrowing it back to
   * a plain `success()`.
   */
  it('runs each named gate even after the suite before it has failed', () => {
    for (const script of ['test:gate', 'test:fixture-pair', 'test:docs']) {
      const step = workflowSteps().find((one) => one.run === `pnpm ${script}`);
      expect(step, `the step that runs pnpm ${script}`).toBeDefined();
      expect(step?.if, `pnpm ${script} has to run after an earlier failure`).toMatch(
        /!\s*cancelled\(\)/,
      );
    }
  });

  /**
   * Link two of the chain: the workflow spells a **script name**, and the
   * script has to exist. A missing script is a red build rather than a silent
   * retirement, so this is the least dangerous link — but it is also the one
   * that pins the exact shape of the run, and that shape is load-bearing.
   *
   * `vitest run --project gate` and nothing else: catches an appended
   * `--passWithNoTests`, which is the flag that converts the entire gate into a
   * green check over zero tests, and catches `--project` being dropped (the
   * named step would then run the whole suite twice and be a name over
   * nothing in particular).
   */
  it('runs a script that exists and resolves to a single named project run', () => {
    const gate = workflowSteps().find((step) => (step.run ?? '').includes('test:gate'));
    const scriptName = /pnpm\s+([\w:-]+)/.exec(gate?.run ?? '')?.[1];
    expect(scriptName).toBe('test:gate');

    expect(scripts()[scriptName ?? '']).toBe('vitest run --project gate');
  });

  /**
   * Link three: `--project gate` has to name a project vitest declares, and
   * that project's `include` has to be the property test.
   *
   * The project name is taken from the script rather than hard-coded, so the
   * assertion is the *link* and not a second copy of the string — rename the
   * project in `vitest.config.ts` alone and `projectInclude` fails naming the
   * missing project; rename it in the script alone and the same thing happens
   * from the other side.
   *
   * Catches: repointing `include` (directly or through the `GATE` constant),
   * and deleting the whole `gate` project — after which `pnpm test:gate` matches
   * no project at all. The file is also required to exist, because a stale path
   * is the version of this that survives a `git mv`.
   */
  it('points that project at the rebuild property test, which is on disk', () => {
    const scriptName = /--project\s+([\w-]+)/.exec(scripts()['test:gate'] ?? '')?.[1];
    expect(scriptName).toBe('gate');

    const include = projectInclude(scriptName ?? '');
    expect(include).toEqual(['packages/server/src/index-db/rebuild-property.test.ts']);
    expect(
      existsSync(join(REPO_ROOT, include[0] ?? '')),
      'the gate project includes a path that does not exist',
    ).toBe(true);
  });

  /**
   * And the half a named step does not deliver.
   *
   * `vitest run --project gate` **exits 0 when every test in the project is
   * skipped**. The step keeps its name, the checks list keeps its green tick,
   * and the assertion the phase rests on has been retired by five characters.
   * F17's sentence is exactly this: *"a `test.skip` retires it and nobody
   * notices"*. Nothing upstream of this line notices either — not the matrix,
   * not the trigger, not the name, not the project wiring.
   *
   * `.only` is included because in a two-test file it retires the other test by
   * the same mechanism, and `.skipIf` because a condition that is false in CI is
   * a `.skip` with deniability. Comments are stripped first so that a docstring
   * *quoting* F17 — as this one does, and as the config's own docstring does —
   * cannot fail the scan; the scan is about code.
   *
   * The path scanned is the one the config actually resolves to, not a second
   * hard-coded copy: repointing the gate at a decoy file therefore has to
   * produce a decoy that exists, holds tests, skips none of them and asserts the
   * property below. That is a considerably larger lie than a one-line edit.
   */
  it('leaves no test in that file skipped, focused or todo', () => {
    const [path = ''] = projectInclude('gate');
    const code = stripComments(repoText(path));

    const retirements = [...code.matchAll(/\.(?:skipIf|skip|only|todo)\b/g)].map(
      (match) => match[0],
    );
    expect(
      retirements,
      `${path} contains a skipped, focused or todo test — \`vitest run --project gate\` exits 0 ` +
        'over it and the named CI step reports success on an empty run',
    ).toEqual([]);

    // …and a file with no tests left in it is the same retirement by deletion,
    // reached without any of the tokens above.
    expect(code).toMatch(/\bit\(/);
  });

  /**
   * Identity, so that "the rebuild property test" means the property test.
   *
   * Everything above holds a path; this holds what is at the end of it. The
   * finding being closed is F11 — *"rebuild==incremental is three fixed
   * examples … not the named property test"* — and a config chain that
   * faithfully names a file containing three hand-written examples would satisfy
   * every other assertion here while leaving F11 exactly where it was.
   *
   * Catches: replacing `fc.asyncProperty` with a fixed list of cases, and
   * dropping the `rebuild(` call the whole comparison is between.
   */
  it('and that file is a property test over rebuild, not a fixed-example one', () => {
    const [path = ''] = projectInclude('gate');
    const code = stripComments(repoText(path));

    expect(code, 'randomised sequences, per F11 — not three examples someone thought of').toMatch(
      /fc\.asyncProperty\(/,
    );
    expect(code, 'and the rebuild is one of the two producers being compared').toMatch(/rebuild\(/);
  });
});
