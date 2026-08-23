// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { createRequire } from 'node:module';
import { resolve } from 'node:path';

import { ESLint } from 'eslint';
import { beforeAll, describe, expect, it } from 'vitest';

import { FIXTURE_ROOT, fixtureConfig } from './fixture-config.js';

/**
 * P1.0 ships a set of claims about what is a build error
 * (docs/design/workplan/03-p1-implementation.md §P1.0). These tests are what turn each
 * claim into a check.
 *
 * The negative cases matter as much as the positive ones. A rule that fires on
 * everything is as useless as one that fires on nothing, and the failure mode
 * that actually bites — a resolver silently stopping — looks exactly like a
 * clean run.
 */

const eslint = new ESLint({
  overrideConfigFile: true,
  overrideConfig: fixtureConfig as ESLint.Options['overrideConfig'],
  ignore: false,
  cwd: process.cwd(),
});

async function reportsIn(fixture: string): Promise<{ rule: string; message: string }[]> {
  const [result] = await eslint.lintFiles([`${FIXTURE_ROOT}/${fixture}`]);
  if (!result) {
    throw new Error(`No lint result for ${fixture} — is the path right?`);
  }
  if (result.fatalErrorCount > 0) {
    const fatal = result.messages.find((m) => m.fatal);
    throw new Error(`${fixture} failed to parse (${fatal?.message ?? 'unknown'}).`);
  }
  return result.messages.map((m) => ({ rule: m.ruleId ?? '<no rule>', message: m.message }));
}

async function rulesFiredIn(fixture: string): Promise<string[]> {
  return (await reportsIn(fixture)).map((report) => report.rule);
}

/**
 * Reports from one *selector*, not one rule id.
 *
 * `no-restricted-syntax` is a single slot holding every syntactic day-one rule,
 * so counting by rule id counts them together: the moment a second selector
 * lands in that slot, an exact-count assertion silently absorbs its reports and
 * a `not.toContain` assertion starts meaning "and none of the other rule
 * either". The message is what distinguishes them, so the message is what these
 * assertions match on.
 */
async function syntaxReportsMatching(fixture: string, pattern: RegExp): Promise<string[]> {
  return (await reportsIn(fixture))
    .filter((report) => report.rule === 'no-restricted-syntax' && pattern.test(report.message))
    .map((report) => report.message);
}

describe('the architectural boundary graph (docs/design/workplan/10-testing.md §2)', () => {
  // The graph rule classifies an import by its *resolved* path, and workspace
  // packages resolve through their `types`/`main` entry into `dist`. If the
  // packages have not been built, every import resolves to nothing, every
  // dependency is classified unknown, and the rule reports nothing at all —
  // a clean run that means the opposite of what it looks like. Fail loudly
  // instead.
  beforeAll(() => {
    const from = resolve(process.cwd(), FIXTURE_ROOT, 'packages/client/src/probe.ts');
    try {
      createRequire(from).resolve('@storyengine/server');
    } catch {
      throw new Error(
        'Cannot resolve @storyengine/server from the fixture tree. Run `pnpm build` ' +
          'first — the boundary rule resolves imports through each package’s built ' +
          'entry point, so an unbuilt workspace makes it silently pass.',
      );
    }
  });

  it('blocks modes → server, before packages/modes/ exists', async () => {
    const fired = await rulesFiredIn('packages/modes/scene/src/imports-server.ts');
    expect(fired).toContain('boundaries/dependencies');
    expect(fired).toContain('no-restricted-imports');
  });

  it('blocks client → server', async () => {
    const fired = await rulesFiredIn('packages/client/src/imports-server.ts');
    expect(fired).toContain('boundaries/dependencies');
    expect(fired).toContain('no-restricted-imports');
  });

  it('blocks sdk → server', async () => {
    const fired = await rulesFiredIn('packages/sdk/src/imports-server.ts');
    expect(fired).toContain('boundaries/dependencies');
    expect(fired).toContain('no-restricted-imports');
  });

  it('permits sdk → shared', async () => {
    const fired = await rulesFiredIn('packages/sdk/src/imports-shared.ts');
    expect(fired).not.toContain('boundaries/dependencies');
    expect(fired).not.toContain('no-restricted-imports');
  });
});

describe('no direct fs outside server/src/storage (docs/design/07-tech-stack.md §9)', () => {
  it('blocks node:fs in an ordinary server file', async () => {
    const fired = await rulesFiredIn('packages/server/src/uses-fs.ts');
    expect(fired).toContain('no-restricted-imports');
  });

  it('permits node:fs inside server/src/storage', async () => {
    const fired = await rulesFiredIn('packages/server/src/storage/uses-fs.ts');
    expect(fired).not.toContain('no-restricted-imports');
  });

  it('permits node:fs in a build script, which never sees a request', async () => {
    // The rule keeps one audited path resolver the only door to *user data*,
    // reached from a request whose user is the thing being checked. A script
    // emitting artefacts into the repository has no user root to be contained
    // within, so the rule has nothing to say about it.
    const fired = await rulesFiredIn('packages/shared/scripts/emits-artefacts.ts');
    expect(fired).not.toContain('no-restricted-imports');
  });
});

describe('no randomness outside the RNG service (docs/design/07-tech-stack.md §14.4)', () => {
  it('blocks Math.random', async () => {
    const fired = await rulesFiredIn('packages/shared/src/uses-math-random.ts');
    expect(fired).toContain('no-restricted-properties');
  });

  it('blocks randomInt from node:crypto', async () => {
    const fired = await rulesFiredIn('packages/shared/src/uses-node-crypto.ts');
    expect(fired).toContain('no-restricted-imports');
  });

  it('blocks crypto.randomUUID on the global', async () => {
    const fired = await rulesFiredIn('packages/shared/src/uses-global-crypto.ts');
    expect(fired).toContain('no-restricted-syntax');
  });

  it('permits it in the id generator — an id is not a draw', async () => {
    // Nothing replays a uuid and no outcome depends on its value, so it is not
    // the thing docs/design/07-tech-stack.md §14.1 protects. The exemption is
    // deliberately one file wide, which the next test is what actually proves.
    // Both rules are relaxed together: the real ids.ts draws through the Web
    // Crypto global (shared runs in the browser too), which the syntax rule
    // bans everywhere else.
    const fired = await rulesFiredIn('packages/shared/src/ids.ts');
    expect(fired).not.toContain('no-restricted-imports');
    expect(fired).not.toContain('no-restricted-syntax');
  });

  it('permits it in the RNG service, which is where the rule has been pointing', async () => {
    // P2.2 landed the destination. Every draw above this file goes through
    // `rng.at(site, purpose)` and onto the turn tape; this is the one place the
    // numbers may actually come from.
    const fired = await rulesFiredIn('packages/server/src/rng/source.ts');
    expect(fired).not.toContain('no-restricted-imports');
  });

  it('still catches the file beside it, so the service is not a folder-wide pass', async () => {
    // A `dice.ts` that drew its own numbers is exactly the unrecorded draw the
    // rule exists to stop, and it would sit one directory entry away from the
    // exemption.
    const fired = await rulesFiredIn('packages/server/src/rng/dice.ts');
    expect(fired).toContain('no-restricted-imports');
  });

  it('permits it in the secrets module — a salt is not a draw either', async () => {
    // The second exemption, and the same argument: nothing replays a password
    // salt or a session key, and routing them through a recorded generator
    // would put secrets on the turn tape.
    const fired = await rulesFiredIn('packages/server/src/auth/secrets.ts');
    expect(fired).not.toContain('no-restricted-imports');
  });

  it('catches the file beside the secrets module too', async () => {
    const fired = await rulesFiredIn('packages/server/src/auth/session.ts');
    expect(fired).toContain('no-restricted-imports');
  });

  it('still catches the file next door, so the exemption is one file wide', async () => {
    // `uses-node-crypto.ts` sits in the same directory as the exempt `ids.ts`.
    // If this ever passes, the carve-out has widened into a hole.
    const fired = await rulesFiredIn('packages/shared/src/uses-node-crypto.ts');
    expect(fired).toContain('no-restricted-imports');
  });
});

describe('the AGPL header', () => {
  it('fires on a file without one', async () => {
    const fired = await rulesFiredIn('packages/shared/src/no-header.ts');
    expect(fired).toContain('headers/header-format');
  });

  it('does not fire on a file with one', async () => {
    const fired = await rulesFiredIn('packages/sdk/src/imports-shared.ts');
    expect(fired).not.toContain('headers/header-format');
  });
});

describe('sentences assembled from fragments (docs/design/workplan/01-work-plan.md §2)', () => {
  const ASSEMBLY = /assembled from fragments/;
  const DISPLAYED = /Branching on displayed text/;

  it('catches a sentence joined with +, in both directions', async () => {
    const fired = await syntaxReportsMatching('packages/client/src/assembled-prose.tsx', ASSEMBLY);
    // Four, not three: `'You have ' + n + ' unread messages'` nests as
    // `('You have ' + n) + ' unread messages'`, so both halves of the sentence
    // are reported. That is the right answer — each is a fragment — and it is
    // worth pinning, because a selector that reported the outermost expression
    // once would also report a class list once.
    expect(fired).toHaveLength(4);
  });

  it('catches a sentence split across JSX children', async () => {
    const fired = await syntaxReportsMatching('packages/client/src/assembled-prose.tsx', ASSEMBLY);
    // The `<span>Revision {count}</span>` case is the third of the three: it is
    // the one with no single string to hand a translator at all.
    expect(fired.length).toBeGreaterThanOrEqual(1);
  });

  it('catches a comparison against displayed text', async () => {
    const fired = await syntaxReportsMatching('packages/client/src/assembled-prose.tsx', DISPLAYED);
    expect(fired).toHaveLength(1);
  });

  it('leaves whole messages, class lists, values and paths alone', async () => {
    // The negative case, and the one that decides whether the rule survives
    // contact with a real component. A template literal with a placeholder is
    // *not* assembly — it is one message with a value in it.
    const assembly = await syntaxReportsMatching(
      'packages/client/src/whole-messages.tsx',
      ASSEMBLY,
    );
    const displayed = await syntaxReportsMatching(
      'packages/client/src/whole-messages.tsx',
      DISPLAYED,
    );
    expect(assembly).toEqual([]);
    expect(displayed).toEqual([]);
  });

  it('does not apply to the server, whose strings are log lines', async () => {
    // docs/design/07-tech-stack.md §12.7 keeps those deliberately untranslated,
    // and a rule that fired on them would teach people to work around it.
    const fired = await syntaxReportsMatching('packages/server/src/uses-fs.ts', ASSEMBLY);
    expect(fired).toEqual([]);
  });
});

describe('Intl only (docs/design/07-tech-stack.md §12.6)', () => {
  const INTL = /Hand-rolled date, time or number formatting/;

  it('catches every way of baking a locale in', async () => {
    const fired = await syntaxReportsMatching('packages/client/src/hand-rolled-dates.ts', INTL);
    expect(fired).toHaveLength(4);
  });

  it('permits Intl, and permits toISOString — which is storage, not display', async () => {
    const reports = await reportsIn('packages/client/src/hand-rolled-dates.ts');
    const good = reports.filter((report) => /Good/.test(report.message));
    expect(good).toEqual([]);
  });
});

describe('physical-direction Tailwind utilities (docs/design/07-tech-stack.md §12.6)', () => {
  /** This rule's own reports, told apart from anything else in the same slot. */
  const PHYSICAL = /Physical-direction utility/;

  it('blocks every form a physical utility can arrive in', async () => {
    // Five elements in the fixture: a plain literal, several classes in one
    // literal, a literal inside a helper call, a template literal, and one
    // behind variant prefixes. One report each — the rule reports the
    // expression, not the individual class.
    const fired = await syntaxReportsMatching('packages/client/src/physical-utility.tsx', PHYSICAL);
    expect(fired).toHaveLength(5);
  });

  it('permits the logical equivalents, including behind a variant prefix', async () => {
    const fired = await syntaxReportsMatching('packages/client/src/logical-utility.tsx', PHYSICAL);
    expect(fired).toEqual([]);
  });

  it('reaches a class list that has been given a name, outside any className', async () => {
    // Four shapes, none inside a `className` attribute: a module const, a
    // template const, an object property, and `activeProps={{ className }}`.
    // The rule was anchored on `JSXAttribute[name.name="className"]` until the
    // appearance layer landed, which made every one of these invisible — the
    // last of them in shipped code, at `Shell.tsx`.
    const fired = await syntaxReportsMatching('packages/client/src/class-constants.tsx', PHYSICAL);
    expect(fired).toHaveLength(4);
  });

  it('reads ordinary English and SQL without firing, now that it sees every string', async () => {
    // The cost of unanchoring, and the reason the pattern requires a
    // Tailwind-shaped suffix on `left` and `right`. With the optional suffix
    // the anchored version could afford, this fixture reports five times: a
    // `left join`, "the right one", "right-to-left", "left aligned", and
    // "nothing left to do".
    const fired = await syntaxReportsMatching(
      'packages/client/src/class-constants-logical.ts',
      PHYSICAL,
    );
    expect(fired).toEqual([]);
  });
});

describe('the palette lives in one file', () => {
  const PALETTE = /Tailwind palette scale in a component/;
  const DARK = /A `dark:` variant/;

  it('blocks a palette scale in every shape one arrives in', async () => {
    // Seven className expressions carrying a scale, plus a module const — the
    // const is the one the old className-anchored rule could not have seen.
    // `dark:bg-slate-800` counts here *and* under the `dark:` rule below,
    // because it is two mistakes at once and each has its own advice.
    const fired = await syntaxReportsMatching('packages/client/src/palette-scale.tsx', PALETTE);
    expect(fired).toHaveLength(8);
  });

  it('blocks a `dark:` variant, which means a token is missing', async () => {
    const fired = await syntaxReportsMatching('packages/client/src/palette-scale.tsx', DARK);
    expect(fired).toHaveLength(1);
  });

  it('permits semantic tokens, and says nothing about sizes', async () => {
    // `text-sm` and `rounded-md` are here deliberately: the rule is about
    // colour, and one that also policed the spacing scale would be worked
    // around within a day.
    const reports = await reportsIn('packages/client/src/palette-token.tsx');
    expect(reports.filter((report) => PALETTE.test(report.message))).toEqual([]);
    expect(reports.filter((report) => DARK.test(report.message))).toEqual([]);
  });
});

describe('the appearance layer (packages/client/src/ui)', () => {
  const JOIN = /A class list joined with/;
  const ASSEMBLY = /assembled from fragments/;
  const PHYSICAL = /Physical-direction utility/;

  it('refuses a class list joined with `+`, and still bans physical utilities', async () => {
    // One report per offending *operand*, so the single join reports twice —
    // both halves carry a hyphenated utility. The physical ban reports once
    // more, from a const that never reaches a `className`.
    const reports = await reportsIn('packages/client/src/ui/button.tsx');
    expect(reports.filter((report) => JOIN.test(report.message))).toHaveLength(2);
    expect(reports.filter((report) => PHYSICAL.test(report.message))).toHaveLength(1);
  });

  it('explains a joined class list, alongside the assembly rule that misreads it', async () => {
    // `rounded border` is two plain words in a row, so the assembly rule fires
    // on the first operand too — with advice about word order that is not what
    // is wrong. ESLint reports every matching selector rather than the first,
    // so the join message does not replace it; it is the one that applies.
    const reports = await reportsIn('packages/client/src/ui/button.tsx');
    expect(reports.filter((report) => ASSEMBLY.test(report.message))).toHaveLength(1);
  });

  it('adds the join ban without relaxing the assembly rule beside it', async () => {
    const reports = await reportsIn('packages/client/src/ui/labels.ts');
    expect(reports.filter((report) => ASSEMBLY.test(report.message))).toHaveLength(2);
    expect(reports.filter((report) => JOIN.test(report.message))).toEqual([]);
  });
});
