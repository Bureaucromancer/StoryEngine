// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { createContext, runInContext, type Context } from 'node:vm';

/**
 * Running a pattern somebody else wrote, without giving them the server.
 *
 * **This is P5.4's first commit and it is deliberately alone**
 * ([P5 §1.10](../../../../docs/design/workplan/07-p5-implementation.md)):
 * `LoreEntry.useRegex` has been stored since P1 and read by nothing, P4 filled
 * the library with patterns nobody here wrote, and a matcher that runs one of
 * those unbounded is **a denial-of-service on your own server, triggered by a
 * book somebody downloaded**. On a household install that is one person's
 * afternoon; on a shared one it is everybody's turns, which is where
 * [triage §5.1](../../../../docs/design/workplan/02-triage.md) says it stops
 * being a robustness nicety.
 *
 * **A static check is not enough and that is why this exists.** Catastrophic
 * backtracking has recognisable shapes — `(a+)+b` is the schoolbook one — and a
 * linter can find those; an expert-crafted pattern gets through anyway. The
 * mechanism that always works is an interrupt, and V8 inserts interrupt checks
 * during regex execution, so a script running inside `node:vm` with a hard
 * timeout **aborts** where a bare `pattern.test(text)` would stall the event
 * loop with no way back.
 *
 * **On timeout this does not fall back to substring matching.** Triage §5.1
 * flags that as the tempting mistake and it is right: the pattern may match
 * perfectly well on simpler input, so substituting different semantics turns a
 * refusal into a silent, *different* answer. The refusal is returned instead,
 * carrying the pattern, so the surface that asked can tell an author which of
 * their entries stopped firing and why — which is exit-gate step 15's *the
 * entry reports why*.
 *
 * *One detail from the source checked rather than inherited.* §5.1 says the
 * pattern must be **recompiled inside** the vm because passing a compiled
 * `RegExp` in "would not work, and that is not obvious". Measured on this
 * runtime, a compiled `RegExp` passed through the context aborts too — so the
 * stated reason does not currently hold. The recompile is kept anyway, for two
 * reasons that survive: the interrupt is wired through the isolate that
 * compiled the pattern, which is the arrangement the guarantee was reasoned
 * about under and the one a future V8 is least likely to break; and it costs
 * nothing measurable next to the context.
 */

/**
 * Long enough that no honest pattern reaches it, short enough that a hostile one
 * costs a fraction of a turn.
 *
 * A legitimate key matched against a few kilobytes of chat text finishes in
 * microseconds; the gap between that and this is four orders of magnitude, so
 * there is no tuning question hiding here. **Not configurable**, deliberately:
 * `limits.providerTimeoutMs` is settable because an operator can know their
 * endpoint is genuinely slower than any default, and nobody can know their
 * regex is genuinely slower than fifty milliseconds. A number a person could
 * raise is a number that reopens the thing this file exists to close, and
 * [01 §2.3](../../../../docs/design/workplan/01-work-plan.md) would then be owed
 * a surface for it.
 */
export const PATTERN_TIMEOUT_MS = 50;

/**
 * What running a pattern produced.
 *
 * Four outcomes rather than a boolean, because *did not match* and *could not
 * be run* are different facts about an entry and only one of them is the
 * author's to fix. Collapsing them is how an entry that never fires becomes
 * unexplainable.
 */
export type PatternOutcome =
  | { kind: 'matched' }
  | { kind: 'no-match' }
  /** Abandoned at the timeout. The pattern travels so a surface can name it. */
  | { kind: 'timed-out'; pattern: string }
  /** Not a regular expression at all — a hand edit, or a foreign dialect. */
  | { kind: 'invalid'; pattern: string; detail: string };

/**
 * The isolate the patterns run in.
 *
 * **Reused, and that is measured rather than assumed.** A fresh context per call
 * costs about 0.4ms against 0.125ms for a reused one — nothing for the handful
 * of regex entries a normal book has, and about 120ms a turn for a book that is
 * all of them. There is no state to leak either way: the script assigns nothing,
 * and the three inputs are overwritten on every call.
 *
 * The one thing worth checking was whether a context survives having a script
 * torn out of it by the interrupt. It does — a timed-out call followed by an
 * ordinary one returns the ordinary answer — so there is no discard-and-rebuild
 * step here, and its absence is a finding rather than an omission.
 */
let isolate: Context | undefined;

/**
 * **The inputs cross as data, never as source**, and the first reason is
 * ordinary rather than dramatic: a pattern containing a `/` is completely
 * normal — a date, a URL, *and/or* — and a script built as `/${pattern}/` turns
 * that into a syntax error or, worse, into different flags. Passing it through
 * the context is the only spelling under which `a/b` means `a/b`.
 *
 * The security half is real but smaller than it first looks, and the difference
 * is worth stating because the overstatement is the tempting version. This
 * context holds **three strings and nothing else** — measured: `process`,
 * `require` and every other host global are `undefined` inside it, and an
 * assignment to its `globalThis` does not reach ours. So interpolation would
 * not be arbitrary code execution *on the server*; it would be code execution
 * inside an empty isolate, bounded by the same timeout. What it would actually
 * buy an attacker is **a wrong answer** — a crafted key that makes the
 * expression evaluate true regardless of the text — which is a quieter problem
 * and, for a matcher, the one that matters.
 */
const SCRIPT = 'new RegExp(source, flags).test(text)';

/** Node's own discriminator for the interrupt, rather than matching on prose. */
const TIMED_OUT = 'ERR_SCRIPT_EXECUTION_TIMEOUT';

export function testPattern(
  pattern: string,
  flags: string,
  text: string,
  timeoutMs: number = PATTERN_TIMEOUT_MS,
): PatternOutcome {
  isolate ??= createContext({ source: '', flags: '', text: '' });
  const context = isolate as { source: string; flags: string; text: string };
  context.source = pattern;
  context.flags = flags;
  context.text = text;

  try {
    return runInContext(SCRIPT, isolate, { timeout: timeoutMs }) === true
      ? { kind: 'matched' }
      : { kind: 'no-match' };
  } catch (error) {
    /**
     * **Read off the value, never through `instanceof`.** An error raised
     * across a vm boundary is not necessarily an `Error` *of this realm*, and
     * under the test runner it is not: `error instanceof Error` is false for
     * the interrupt, so a version of this that guarded on it reported **every
     * timeout as an invalid pattern**. That is the worst of the four outcomes
     * to get wrong — it tells an author their regex is malformed when it is
     * merely ruinous, and sends them to fix the wrong thing.
     *
     * Found because the test asserted the whole outcome rather than that it was
     * *not* a match; three neighbouring assertions passed over it.
     */
    const thrown = error as { code?: unknown; message?: unknown } | null;
    if (thrown?.code === TIMED_OUT) return { kind: 'timed-out', pattern };

    // Otherwise a `SyntaxError` from the constructor: an unbalanced group, an
    // unknown flag, or a dialect JavaScript does not speak. Not the server's
    // fault and not a reason to stop scanning the rest of the book.
    return {
      kind: 'invalid',
      pattern,
      detail: typeof thrown?.message === 'string' ? thrown.message : String(error),
    };
  }
}
