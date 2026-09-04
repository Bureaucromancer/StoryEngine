// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { defineConfig } from 'vitest/config';

/** The one test CI runs under its own name. Referenced twice, so it is a constant. */
const GATE = 'packages/server/src/index-db/rebuild-property.test.ts';

/**
 * The import gate ([testing §5.1]) — wired at P4.0 while it still failed, and
 * green since P4.2. A gate written after the code is a gate written to pass.
 *
 * Its own project for the same reason `GATE` has one: a named CI step cannot be
 * retired by a `test.skip` nobody notices.
 *
 * *`pnpm test` negated this project while it was red*, so that a suite expected
 * to fail could not teach people to ignore it — as one visible word in
 * `package.json` rather than a `skip` inside the file, precisely so that
 * removing it was part of making the gate pass rather than a separate errand
 * somebody had to remember. It was removed at P4.2, which is the mechanism
 * working.
 */
const FIXTURE_PAIR = 'packages/server/src/import/fixture-pair.test.ts';

/**
 * **Spread into every project, because `projects` do not inherit it** — F28.
 *
 * This was first written once at the top level, which reads as a default and is
 * not one: vitest gives each project its own config, and the suite went on
 * failing with *"Test timed out in 5000ms"* while the file said fifteen
 * thousand. A setting that looks applied and is not is worse than one nobody
 * wrote, so it lives in a named constant that each project has to mention.
 *
 * Vitest's undeclared default is 5000ms and nearly every test here ran on it —
 * the four that set their own are the ones somebody had already been bitten by.
 * That is not a margin, it is about the wall time of the slowest honest test on
 * a loaded machine.
 *
 * **A timeout is a hang detector, not a performance budget.** Fifteen seconds is
 * roughly ten times the idle worst case: long enough that reaching it means
 * something is stuck, short enough that a stuck test does not hold a CI leg for
 * a quarter of an hour. Making the suite fast is a different job and this number
 * must not be mistaken for it.
 */
const TIMEOUTS = { testTimeout: 15_000, hookTimeout: 15_000 };

export default defineConfig({
  test: {
    /**
     * **Declared, because the default was the largest single reason this suite
     * failed for reasons unrelated to the change** — F28.
     *
     * Vitest's undeclared default is 5000ms, and nearly every test here ran on
     * it: the four that set their own are the ones somebody had already been
     * bitten by. That is not a margin, it is roughly the wall time of the
     * slowest honest test on a loaded machine, so the suite went red under
     * concurrency while the code was fine — three concurrent runs produced
     * three reds, measured.
     *
     * **A timeout is a hang detector, not a performance budget.** Fifteen
     * seconds is about ten times the idle worst case, which is long enough that
     * reaching it means something is stuck and short enough that a stuck test
     * does not hold a CI leg for a quarter of an hour. Making the suite *fast*
     * is a different job, and one this number must not be mistaken for.
     *
     * [15 §1.5](docs/design/workplan/15-p2c-first-real-run.md) sizes this at about nine
     * tenths of the load ceiling; the remaining tenth was `logging.test.ts`'s
     * own wall-clock poll, fixed beside this.
     */
    projects: [
      {
        test: {
          name: 'lint-rules',
          ...TIMEOUTS,
          root: '.',
          include: ['tools/lint-fixtures/**/*.test.ts'],
          environment: 'node',
        },
      },

      /**
       * The packaging artefacts, whose subject is the **repository** rather
       * than any package in it — [P6A.4].
       *
       * A project of its own because the `packages` project below only looks
       * inside each package's own `src`, and a test about `compose.yaml` and the unraid
       * template that lived there would be filed under a package it is not
       * about. The alternative — no test — is what lets an image tag in three
       * files drift from the version in a fourth, which is the same drift class
       * `config.test.ts` already guards for config keys.
       */
      {
        test: {
          name: 'release',
          ...TIMEOUTS,
          root: '.',
          include: ['tools/*.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'packages',
          ...TIMEOUTS,
          root: '.',
          include: ['packages/*/src/**/*.test.ts'],
          // The gate below is a project of its own so CI can name it. Excluded
          // here because an `include` elsewhere does not remove a file from
          // this one, and vitest runs a file once *per matching project* — the
          // slowest test in the suite would run twice, on both OSes.
          // `*.live.test.ts` is excluded for the same mechanical reason and one
          // more: those files make real provider calls and belong only to the
          // project below that carries their timeout.
          exclude: ['**/node_modules/**', GATE, FIXTURE_PAIR, '**/*.live.test.ts'],
          environment: 'node',
        },
      },

      /**
       * The P1 exit gate's property test, as a **named** step.
       *
       * [work plan P1](docs/design/workplan/01-work-plan.md) calls
       * rebuild-equals-incremental this phase's CI assertion, and P1 left it as
       * three fixed examples folded anonymously into the suite — where a
       * `test.skip` retires it and nobody notices (F11, F17). A project it can
       * be run by name from is what makes the CI step possible.
       */
      {
        test: {
          name: 'gate',
          ...TIMEOUTS,
          root: '.',
          include: [GATE],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'fixture-pair',
          ...TIMEOUTS,
          root: '.',
          include: [FIXTURE_PAIR],
          environment: 'node',
        },
      },

      /**
       * Live provider tests — real calls to whatever endpoint `.env` names.
       *
       * The tests gate themselves on `STORYENGINE_LIVE_BASE_URL` /
       * `STORYENGINE_LIVE_MODEL`, so this project is inert in any run where the
       * environment does not name an endpoint — including a plain `pnpm test`.
       * `pnpm test:live` is the entry that loads `.env` first.
       *
       * The timeout is its own, not `TIMEOUTS`: fifteen seconds is a hang
       * detector calibrated against stubs, and a local model's cold first token
       * is slower than that while being exactly what the run exists to witness.
       * Two minutes is still a hang detector — the server's own idle limit
       * defaults to five (`limits.providerTimeoutMs`) — it is just calibrated
       * against the thing actually being waited on.
       */
      {
        test: {
          name: 'live',
          testTimeout: 120_000,
          hookTimeout: 120_000,
          root: '.',
          include: ['packages/*/src/**/*.live.test.ts'],
          environment: 'node',
        },
      },

      /**
       * Component tests — F16.
       *
       * `.test.tsx` was included by tsconfig and by eslint and by nothing here,
       * so the first component test anyone wrote would have linted, typechecked
       * and never run. The split is by extension rather than by directory, and
       * that is what keeps the two projects from both claiming a file: vitest
       * runs a file once per matching project, and `api.test.ts` says in its
       * own docstring that it needs the node environment (`request()` reads
       * `document.cookie`, and it is asserting the branch where there is no
       * document).
       *
       * jsdom is declared at the workspace root because vitest imports it from
       * inside its own bundle, while `@testing-library/react` is declared in
       * `packages/client` because the root has no React and a second copy of it
       * fails as "Invalid hook call" — which reads as a bug in the component
       * rather than in the setup.
       */
      {
        test: {
          name: 'client-dom',
          ...TIMEOUTS,
          root: '.',
          include: ['packages/client/src/**/*.test.tsx'],
          environment: 'jsdom',
          setupFiles: ['packages/client/src/test-dom-setup.ts'],
        },
      },
    ],
  },
});
