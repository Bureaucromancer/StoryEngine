// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { ModelCall, Turn } from './sessions/types.js';

/**
 * Reading a turn record in a test, where the doubt the type carries is about
 * *other people's disks* rather than about this run.
 *
 * `ModelCall`'s `purpose`, `blocks`, `budget` and `notFilled` are optional for
 * one stated reason, and the argument lives in `packages/shared/src/turn.ts`
 * rather than being restated here: a record on disk may be older than this
 * build, a reader is a reader over *what is on disk*, and typing those four as
 * always-present made that a lie the compiler enforced until the workbench
 * threw `call.blocks.filter` on the first P2-era turn somebody opened.
 * Backfilling `[]` on read was refused on the same grounds — *nobody recorded
 * them* is a claim about the build and *this call assembled nothing* is a claim
 * about the prompt, and [03 §8] is the line between them.
 *
 * **A test over a turn this process just produced sits on the other side of
 * that line.** These suites run a turn into a fresh `mkdtemp` directory and
 * read it straight back; the runner mints a `ModelCall` only downstream of
 * assembly, including the provisional it checkpoints before dispatch. So
 * absence *there* cannot mean *old* — there is nothing old in a directory the
 * test filled a millisecond ago. It can only mean the writer stopped recording
 * what it assembled, which is a defect these tests exist to catch.
 *
 * Which is why this throws, and why the throwing is the point. Left to
 * themselves the call sites had each reached for an optional chain ending in
 * `?? []`, which is the refused backfill wearing a different hat and is far
 * worse in a test than on a read: `expect(kinds).not.toContain('lore')` over a
 * list that was never built passes, forever, proving nothing. Mutation testing
 * is this project's standard of proof and a test that cannot fail is worse than
 * no test, so the doubt is discharged here — once, loudly — instead of being
 * absorbed by sixteen fallbacks that each quietly swallow it.
 *
 * The message names what was missing for the reason `lineFor` in
 * `routes/recovery.test.ts` gives one type further up: *"cannot read property
 * of undefined"* reads as a broken test rather than as the record being thin at
 * exactly the place the test was looking.
 *
 * **`undefined` only, deliberately.** `null` is a value this record uses on
 * purpose — `usage: null` means the provider reported nothing, `error: null`
 * means nothing failed — and those are claims, not gaps. Widening this to
 * `T | null | undefined` would let a test assert away a `null` the record meant,
 * which is the same confusion pointing the other way. Hand it a nullable and
 * the return type stays nullable and the compiler says so.
 */
export function onRecord<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`The record is missing ${what}`);
  return value;
}

/**
 * One model call off a committed turn, by position — `0` for the single call a
 * narrate step makes, `-1` for the last one when a Stop interrupted a retry.
 *
 * Most of the sites this exists for reach through `turn.request?.calls[0]?.`,
 * and spelling that as two nested `onRecord` calls reads worse than the optional
 * chain it replaces — which is how those chains got there in the first place.
 * The two layers stay *separately named* rather than collapsed into one message,
 * though, because they fail for different reasons and a failure that cannot tell
 * them apart is half a failure: a turn with no `request` died before assembly,
 * while a `request` whose `calls` are empty is [16]'s finding 2 — the
 * interrupted call missing from the record — which is a defect with its own
 * test.
 *
 * The turn is taken already narrowed rather than as `Turn | undefined`, so a
 * caller reading `written[0]` or `written.at(-1)` has to say for itself that
 * nothing was written at all. That is a different failure from a turn written
 * thin, and it is worth its own sentence at the sites that write two turns and
 * read the second.
 *
 * Deliberately narrows the *call* and not the four fields on it. A helper that
 * demanded all four would make a test about `budget` go red when `notFilled`
 * stops being written — collapsing four independently meaningful absences into
 * one, which is the same flattening the shared type refuses. Each site narrows
 * the field it actually reads.
 *
 * Indexed through `Array.at`, so a negative position counts from the end.
 */
export function callOnRecord(turn: Turn, position = 0): ModelCall {
  const request = onRecord(turn.request, `a request on turn ${turn.id}`);
  const call = request.calls.at(position);
  if (call === undefined) {
    const count = String(request.calls.length);
    throw new Error(`Turn ${turn.id} has no call at position ${String(position)} of ${count}`);
  }
  return call;
}
