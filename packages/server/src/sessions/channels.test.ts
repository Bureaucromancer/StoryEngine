// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { uuidv7 } from '@storyengine/shared';

import { openIndex, type OpenedIndex } from '../index-db/open.js';
import { Layout } from '../storage/layout.js';
import {
  advance,
  channelDefinition,
  channelKey,
  channelSurfaces,
  clockStart,
  divergenceEffects,
  initialValue,
  keyBelongsTo,
  readClock,
  quarantineEffects,
  registerChannel,
  scopeKeyOf,
  SE_CLOCK,
  SE_LORE_TIMING,
  splitChannelKey,
} from './channels.js';
import { installBuiltIns } from '../mode-loader.js';
import { walkPath } from './segments.js';
import {
  appendTurnToSession,
  applyEffects,
  createSession,
  readSession,
  readTurns,
  reconcileHandEdits,
  replayChannels,
  type SessionContext,
} from './store.js';
import type { ChannelEffect, ChannelState, SessionFile, Turn } from './types.js';

/**
 * `se.clock` and the hand-edit rule — [P2 §2.7], [03 §8.1].
 *
 * The claim under test is the one that makes the head snapshot safe to keep in
 * a file people can open: **a hand edit is an intent, not corruption.** Get it
 * wrong in one direction and the edit silently vanishes on the next turn; wrong
 * in the other and the snapshot becomes authoritative, which is the branching
 * failure [07 §5.1] rules out arriving by a different door.
 */

let dataDir: string;
let index: OpenedIndex;
let context: SessionContext;
let session: SessionFile;

const ACCOUNT = 'ned';

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'se-channels-'));
  // Channels are registered rather than frozen into the engine since [P7.0], so
  // a test that needs one asks for the built-ins the way `buildServices` does.
  await installBuiltIns();

  index = await openIndex({ path: ':memory:' });
  context = { layout: new Layout(dataDir), index: index.db };
  session = await createSession(context, ACCOUNT, 'Rain City');
});

afterEach(async () => {
  index.close();
  await rm(dataDir, { recursive: true, force: true });
});

function sessionFile(): string {
  return join(context.layout.sessionRoot(ACCOUNT, session.id), 'session.json');
}

async function onDisk(): Promise<SessionFile> {
  const found = await readSession(context, ACCOUNT, session.id);
  if (found === null) throw new Error('the session went missing');
  return found;
}

/**
 * The clock effect a turn carries, built here rather than imported.
 *
 * `channels.ts` exported a `clockEffect` helper with no production caller until
 * [P7.0] — the runner builds its own inline, after the step loop and not as a
 * step — while `navigation.test.ts` and `snapshots.test.ts` each defined a local
 * one anyway. This follows them.
 */
function clockEffect(turnId: string, channels: Record<string, ChannelState>): ChannelEffect {
  const before = readClock(channels);
  return {
    id: uuidv7(),
    turnId,
    channelId: SE_CLOCK,
    scopeKey: null,
    op: { type: 'set', path: '/' },
    before,
    after: advance(before, 5),
    proposedBy: { kind: 'engine' },
    applied: true,
    rejectedReason: null,
    supersedes: null,
    channelVersion: 1,
    scope: 'session',
  };
}

/** One ordinary turn, with the clock effect the engine computes for it. */
async function turn(parentTurnId: string | null): Promise<Turn> {
  const current = await onDisk();
  const id = uuidv7();
  const record: Turn = {
    id,
    sessionId: session.id,
    parentTurnId,
    createdAt: new Date(Date.UTC(2026, 7, 16, 12)).toISOString(),
    status: 'complete',
    effects: [clockEffect(id, current.channels)],
    tape: [],
  };
  await appendTurnToSession(context, ACCOUNT, session.id, record);
  return record;
}

/**
 * **Where a channel starts is part of declaring it** — [P7.1].
 *
 * `CLOCK_START` was a constant in this module, next to `readClock`, so the
 * engine knew where a mode's channel began. That is the same gap
 * `ModeDefinition.channels` had before [P7.0] — a declaration that documents
 * without enabling — one level further down, and `InitPolicy` is what closes
 * it.
 *
 * **Asserted by substitution rather than by equality**, because the two values
 * agree today: `clockStart()` returning `08:00` proves nothing about *where it
 * read that from*, and the engine's own no-mode fallback is also `08:00`. So a
 * different clock declaration is registered and the answer has to follow it. A
 * `clockStart` that still consulted a constant would pass every equality test
 * in this file and fail this one.
 */

/**
 * **A value that was legal when it was written and is not now** — [06 §4.2]'s
 * quarantine rung, [P7.1].
 *
 * The pair with `divergenceEffects` above, and the difference is what each is
 * *about*. A divergence is a value **arriving** — somebody edited the file — so
 * one that does not fit is refused and the log's state stands. A quarantine is a
 * value **already there** under a schema that has since changed, where refusing
 * would be refusing the past. The two live in one turn and mean different
 * things.
 */
describe('a channel whose stored value stopped fitting', () => {
  beforeEach(async () => {
    await installBuiltIns();
  });

  it('resets to the declared init and says why, keeping the raw value', () => {
    const effects = quarantineEffects('t-1', {
      [SE_CLOCK]: { version: 1, value: { day: 3, hour: 25, minute: 0 } },
    });

    expect(effects).toHaveLength(1);
    const [effect] = effects;
    expect(effect?.channelId).toBe(SE_CLOCK);
    // The engine noticed; nobody proposed.
    expect(effect?.proposedBy).toEqual({ kind: 'engine' });
    expect(effect?.applied).toBe(true);
    // `before` *is* the raw value, which is why the effect carries only a
    // reason — and why a quarantine is reversible like any other effect.
    expect(effect?.before).toEqual({ day: 3, hour: 25, minute: 0 });
    expect(effect?.after).toEqual({ day: 1, hour: 8, minute: 0 });
    expect(effect?.degraded?.reason).toContain('/hour');
  });

  it('marks the state degraded when applied, which is `degraded`’s first writer', () => {
    // `ChannelState.degraded` has carried a docstring since P3.0 saying *"the
    // writer arrives with the first `ChannelDefinition.schema`"*. This is it.
    const before = { [SE_CLOCK]: { version: 1, value: { day: 3, hour: 25, minute: 0 } } };
    const after = applyEffects(before, quarantineEffects('t-1', before));

    expect(after[SE_CLOCK]?.value).toEqual({ day: 1, hour: 8, minute: 0 });
    expect(after[SE_CLOCK]?.degraded?.raw).toEqual({ day: 3, hour: 25, minute: 0 });
    expect(after[SE_CLOCK]?.degraded?.reason).toContain('/hour');
  });

  it('is idempotent, so opening a session twice does not grow the log', () => {
    // The reset value validates, so the second pass has nothing to say. A
    // quarantine that fired every load would turn one bad value into an
    // unbounded effect log.
    const before = { [SE_CLOCK]: { version: 1, value: { day: 3, hour: 25, minute: 0 } } };
    const once = applyEffects(before, quarantineEffects('t-1', before));

    expect(quarantineEffects('t-2', once)).toEqual([]);
  });

  it('leaves a good value alone, so the check is not a rewrite', () => {
    expect(
      quarantineEffects('t-1', {
        [SE_CLOCK]: { version: 1, value: { day: 1, hour: 8, minute: 0 } },
      }),
    ).toEqual([]);
  });

  it('carries the scope key, so one bad entry does not reset its neighbours', () => {
    // A scoped channel's map keys are composite, and an effect built from the
    // key as though it were an id is the defect [P7 §0.1a] found in
    // `divergenceEffects`. Same iteration, same hazard, so the same assertion.
    const effects = quarantineEffects('t-1', {
      [channelKey(SE_LORE_TIMING, 'entry-a')]: { version: 1, value: { sticky: -1 } },
      [channelKey(SE_LORE_TIMING, 'entry-b')]: {
        version: 1,
        value: { sticky: 0, cooldown: 0, fired: 0 },
      },
    });

    expect(effects).toHaveLength(1);
    expect(effects[0]?.channelId).toBe(SE_LORE_TIMING);
    expect(effects[0]?.scopeKey).toBe('entry-a');
  });

  it('says nothing about a channel nobody declared', () => {
    // An uninstalled mode leaves its channels behind, and resetting them to a
    // default nobody declares would be inventing state. [00 §3.3]: survivable,
    // visible, non-blocking — and untouched is the survivable answer.
    expect(quarantineEffects('t-1', { 'example.gone': { version: 1, value: 'anything' } })).toEqual(
      [],
    );
  });

  it('leaves a channel alone when its own default would not validate', () => {
    // An author's mistake, and quarantining to it would write an effect on every
    // load forever. Same reasoning as an uncompilable schema: the person playing
    // cannot fix it and should not pay for it with a growing log.
    registerChannel({
      id: 'example.impossible',
      owner: 'example.quiet',
      version: 1,
      scope: 'session',
      update: 'model-proposed',
      visibility: 'player',
      budget: null,
      schema: { type: 'integer', minimum: 10 },
      init: { kind: 'literal', value: 0 },
    });

    expect(quarantineEffects('t-1', { 'example.impossible': { version: 1, value: 1 } })).toEqual(
      [],
    );
  });
});

/**
 * **The hand-edit path consults the schema too** — [P7.1], and it is a
 * correction: a docstring in `turns/effects.ts` briefly claimed the check there
 * covered this, and `reconcileHandEdits` never calls `acceptEffect`.
 */
describe('a hand edit that does not fit', () => {
  beforeEach(async () => {
    await installBuiltIns();
  });

  it('is recorded as refused, attributed to the person, and does not move the state', () => {
    const effects = divergenceEffects(
      't-1',
      { [SE_CLOCK]: { version: 1, value: { day: 1, hour: 8, minute: 0 } } },
      { [SE_CLOCK]: { version: 1, value: { day: 1, hour: 25, minute: 0 } } },
    );

    expect(effects).toHaveLength(1);
    expect(effects[0]?.proposedBy).toEqual({ kind: 'user' });
    expect(effects[0]?.applied).toBe(false);
    expect(effects[0]?.rejectedReason).toBe('schema');
    // Refused means the state stays where the log says it is.
    expect(effects[0]?.after).toEqual({ day: 1, hour: 8, minute: 0 });
  });

  it('still applies an edit that fits, which is what the mechanism is for', () => {
    const effects = divergenceEffects(
      't-1',
      { [SE_CLOCK]: { version: 1, value: { day: 1, hour: 8, minute: 0 } } },
      { [SE_CLOCK]: { version: 1, value: { day: 2, hour: 9, minute: 30 } } },
    );

    expect(effects[0]?.applied).toBe(true);
    expect(effects[0]?.after).toEqual({ day: 2, hour: 9, minute: 30 });
  });

  it('applies a deletion without asking the schema about it', () => {
    // A delete carries no value, so there is nothing to validate — and refusing
    // one would make removing a channel from the file impossible, which is the
    // divergence [03 §8.1] is most explicit about supporting.
    const effects = divergenceEffects(
      't-1',
      { [SE_CLOCK]: { version: 1, value: { day: 1, hour: 8, minute: 0 } } },
      {},
    );

    expect(effects[0]?.op).toEqual({ type: 'delete', path: '/' });
    expect(effects[0]?.applied).toBe(true);
  });
});

/**
 * **Gate step 3's last clause** — *"renders through the declared widget
 * vocabulary"* — [10 §8], [P7.1].
 *
 * The other three clauses of that step were already held: a mode-declared
 * channel appears in the registry (`mode-registry.test.ts`), is enforced against
 * its `update` policy (`turns/effects.test.ts`), and reconstructs at an old node
 * (the P6 property test). This is the one that had nothing.
 */
describe('the channels a person sees', () => {
  beforeEach(async () => {
    await installBuiltIns();
  });

  it('renders a declared widget from the declaration, label and all', () => {
    const [widget, ...rest] = channelSurfaces({
      [SE_CLOCK]: { version: 1, value: { day: 3, hour: 9, minute: 5 } },
    });

    expect(widget).toEqual({
      key: SE_CLOCK,
      channelId: SE_CLOCK,
      scopeKey: null,
      kind: 'text',
      label: 'Time',
      text: 'Day 3, 09:05',
    });
    // Lore timing is registered and hidden, which is the next assertion's
    // subject; nothing else ships a surface.
    expect(rest).toEqual([]);
  });

  it('shows the declared init before anything has touched the channel', () => {
    // A HUD that waited for the first effect would disagree with the prompt,
    // which reads the same read-time default.
    expect(channelSurfaces({})[0]?.text).toBe('Day 1, 08:00');
  });

  it('leaves a hidden channel out, which is what `visibility` has been waiting for', () => {
    // The field has been on the type since P2.3 with no consumer. `'hidden'`
    // means *not in the HUD* — [06 §7.3]'s distinction, not a new one — and lore
    // timing is the shipped example: bookkeeping a player gets from the
    // workbench rather than from a strip above the story.
    const surfaces = channelSurfaces({
      [channelKey(SE_LORE_TIMING, 'entry-a')]: {
        version: 1,
        value: { sticky: 1, cooldown: 0, fired: 2 },
      },
    });

    expect(surfaces.map((each) => each.channelId)).not.toContain(SE_LORE_TIMING);
  });

  it('omits a channel with no surface rather than showing a blank one', () => {
    registerChannel({
      id: 'example.plain',
      owner: 'example.mode',
      version: 1,
      scope: 'session',
      update: 'model-proposed',
      visibility: 'player',
      budget: 10,
      render: 'something',
      schema: { type: 'object' },
      init: { kind: 'literal', value: {} },
    });

    expect(channelSurfaces({}).map((each) => each.channelId)).not.toContain('example.plain');
  });

  it('shows one widget per scope key, so a scoped channel is not one line', () => {
    // A per-actor channel has one value per actor, and a HUD showing only the
    // unscoped key would show nobody.
    registerChannel({
      id: 'example.mood',
      owner: 'example.mode',
      version: 1,
      scope: 'actor',
      update: 'model-proposed',
      visibility: 'player',
      budget: 10,
      render: '{{ value }}',
      schema: { type: 'string' },
      init: { kind: 'literal', value: '' },
      surface: { kind: 'text', label: 'Mood' },
    });

    const surfaces = channelSurfaces({
      [channelKey('example.mood', 'vera')]: { version: 1, value: 'watchful' },
      [channelKey('example.mood', 'ned')]: { version: 1, value: 'tired' },
    });

    expect(surfaces.filter((each) => each.channelId === 'example.mood')).toHaveLength(2);
    expect(surfaces.find((each) => each.scopeKey === 'vera')?.text).toBe('watchful');
  });

  it('skips a widget whose template will not compile, rather than throwing', () => {
    // The author's mistake, answered the way the collector answers it: a HUD
    // that threw would take the session down over a label.
    registerChannel({
      id: 'example.bad-widget',
      owner: 'example.mode',
      version: 1,
      scope: 'session',
      update: 'model-proposed',
      visibility: 'player',
      budget: 10,
      render: '{% if %}',
      schema: { type: 'object' },
      init: { kind: 'literal', value: {} },
      surface: { kind: 'text', label: 'Broken' },
    });

    expect(channelSurfaces({}).map((each) => each.channelId)).not.toContain('example.bad-widget');
  });
});

/**
 * The module loaded with an empty registry, which is the only way to see a build
 * that has no clock — every other test in this file has installed the built-ins
 * by the time it runs, because the registry is a module global.
 */
async function freshChannels(): Promise<typeof import('./channels.js')> {
  vi.resetModules();
  const loaded = await import('./channels.js');
  vi.resetModules();
  return loaded;
}

describe('a channel says where it starts', () => {
  beforeEach(async () => {
    await installBuiltIns();
  });

  it('reads the clock’s start from whoever declared the channel', () => {
    const declared = channelDefinition(SE_CLOCK);
    expect(declared?.init).toEqual({ kind: 'literal', value: { day: 1, hour: 8, minute: 0 } });
    expect(clockStart()).toEqual({ day: 1, hour: 8, minute: 0 });

    // The substitution: same id, same owner, a different morning.
    //
    // Restored in a `finally` because the registry is a module global and
    // `registerChannel` is a write to it — a substitution left behind would
    // reach every test that runs after this one in the same worker without
    // installing the built-ins, which is a failure nobody would trace back here.
    const original = declared!;
    try {
      registerChannel({
        ...original,
        init: { kind: 'literal', value: { day: 4, hour: 22, minute: 30 } },
      });

      expect(clockStart()).toEqual({ day: 4, hour: 22, minute: 30 });
      // And through the reader a turn actually uses, over an untouched session.
      expect(readClock({})).toEqual({ day: 4, hour: 22, minute: 30 });
    } finally {
      registerChannel(original);
    }

    expect(clockStart()).toEqual({ day: 1, hour: 8, minute: 0 });
  });

  it('falls back rather than throwing when no mode declared a clock', async () => {
    // A build with no clock channel is what an uninstalled mode leaves behind,
    // and [06 §4.2] is explicit that *a session must always open*. Throwing here
    // would make a missing mode cost somebody their session, which is the one
    // outcome that section rules out.
    const channels = await freshChannels();

    expect(channels.channelDefinition(channels.SE_CLOCK)).toBeNull();
    expect(channels.clockStart()).toEqual({ day: 1, hour: 8, minute: 0 });
  });

  it('refuses to invent a value for a channel nobody declared', () => {
    // `null` rather than `undefined` or a throw: an unknown channel is a
    // recorded refusal everywhere else in this module (`refuse` returns
    // `unknown-channel`), and a reader that got `undefined` could not tell
    // "declared as null" from "not declared".
    expect(initialValue('example.nobody')).toBeNull();
  });

  it('hands back the fallback for an authored init, which is what unauthored means', () => {
    // The `authored` arm needs the session's treatment and setup, which this
    // module has no business reading — so until the dial wires it, an authored
    // init resolves to its own declared fallback. [04 §6.1b]: absent means
    // *unspecified*, and the channel is what says what unspecified resolves to.
    registerChannel({
      id: 'example.pacing',
      owner: 'example.quiet',
      version: 1,
      scope: 'session',
      update: 'user-only',
      visibility: 'player',
      budget: null,
      schema: { type: 'string' },
      init: { kind: 'authored', field: 'hookPacing', fallback: 'normal' },
    });

    expect(initialValue('example.pacing')).toBe('normal');
  });
});

describe('the clock', () => {
  it('carries minutes into hours and days', () => {
    expect(advance({ day: 1, hour: 8, minute: 0 }, 5)).toEqual({ day: 1, hour: 8, minute: 5 });
    expect(advance({ day: 1, hour: 23, minute: 58 }, 5)).toEqual({ day: 2, hour: 0, minute: 3 });
    expect(advance({ day: 1, hour: 0, minute: 0 }, 24 * 60 * 3)).toEqual({
      day: 4,
      hour: 0,
      minute: 0,
    });
  });

  it('advances every turn, engine-attributed', async () => {
    await turn(null);
    const second = await turn((await onDisk()).headTurnId);

    expect(readClock((await onDisk()).channels)).toEqual({ day: 1, hour: 8, minute: 10 });
    expect(second.effects[0]?.proposedBy).toEqual({ kind: 'engine' });
    // Stored rather than derived, which is what makes undoing the tip an apply
    // rather than a replay of 0..N−1 ([22 §1.2]).
    expect(second.effects[0]?.before).toEqual({ day: 1, hour: 8, minute: 5 });
  });

  it('starts from the same place whether replayed or read', async () => {
    await turn(null);
    await turn((await onDisk()).headTurnId);

    const file = await onDisk();
    const turns = await readTurns(context, ACCOUNT, session.id);
    // The head snapshot is derived, and this is the thing it is derived from.
    expect(replayChannels(walkPath(turns, file.headTurnId))).toEqual(file.channels);
  });
});

describe('a hand edit lands as a user-attributed effect', () => {
  /** Opens `session.json` in a text editor, so to speak, and changes the clock. */
  async function editTheClockOnDisk(value: unknown): Promise<void> {
    const file = JSON.parse(await readFile(sessionFile(), 'utf8')) as SessionFile;
    file.channels[SE_CLOCK] = { version: 1, value };
    await writeFile(sessionFile(), JSON.stringify(file, null, 2));
  }

  it('appends a turn carrying the edit, attributed to the user', async () => {
    await turn(null);
    const headBefore = (await onDisk()).headTurnId;

    // "It should be evening by now."
    await editTheClockOnDisk({ day: 1, hour: 19, minute: 30 });

    const effects = await reconcileHandEdits(context, ACCOUNT, session.id);

    expect(effects).toHaveLength(1);
    expect(effects[0]?.channelId).toBe(SE_CLOCK);
    expect(effects[0]?.proposedBy).toEqual({ kind: 'user' });
    // `before` is what the log said was true, which is what makes the effect
    // reversible into a state the log agrees with.
    expect(effects[0]?.before).toEqual({ day: 1, hour: 8, minute: 5 });
    expect(effects[0]?.after).toEqual({ day: 1, hour: 19, minute: 30 });

    // A turn of its own, because a segment is append-only and the head turn's
    // line cannot be rewritten to carry somebody's edit.
    const file = await onDisk();
    expect(file.headTurnId).not.toBe(headBefore);
    const turns = await readTurns(context, ACCOUNT, session.id);
    expect(turns.get(file.headTurnId ?? '')?.parentTurnId).toBe(headBefore);
  });

  it('makes the edit survive the next replay, which is the whole point', async () => {
    await turn(null);
    await editTheClockOnDisk({ day: 1, hour: 19, minute: 30 });
    await reconcileHandEdits(context, ACCOUNT, session.id);

    // Delete the snapshot's authority entirely and rebuild from the log: the
    // edit is still there, because it is *in* the log now.
    const file = await onDisk();
    const turns = await readTurns(context, ACCOUNT, session.id);
    expect(readClock(replayChannels(walkPath(turns, file.headTurnId)))).toEqual({
      day: 1,
      hour: 19,
      minute: 30,
    });
  });

  it('keeps advancing from the edited value, not the one it replaced', async () => {
    await turn(null);
    await editTheClockOnDisk({ day: 1, hour: 19, minute: 30 });
    await reconcileHandEdits(context, ACCOUNT, session.id);

    await turn((await onDisk()).headTurnId);

    expect(readClock((await onDisk()).channels)).toEqual({ day: 1, hour: 19, minute: 35 });
  });

  it('survives a head advance that has not reconciled it yet', async () => {
    // The failure this whole mechanism exists to prevent, in the reconciler's
    // own words: *the next head advance would recompute `channels` from the log
    // and the edit would vanish with no error, which is the worst of the three
    // possible behaviours*. What prevents it is `advanceHead` folding onto the
    // **file's** map at the head, which is the arm [P6.0b] kept when it stopped
    // trusting that map everywhere else — see `snapshotIsAt`. The falsifying
    // mutation is replaying unconditionally, and until this test that arm could
    // be deleted with the suite green.
    //
    // On a channel the turn does not write, because a whole-value set of the
    // clock lands on the same number whichever map it folds onto — which is the
    // reason the fault this stage fixes went five phases unnoticed.
    await turn(null);

    const edited = JSON.parse(await readFile(sessionFile(), 'utf8')) as SessionFile;
    edited.channels['se.mood'] = { version: 1, value: 'thunderstruck' };
    await writeFile(sessionFile(), JSON.stringify(edited, null, 2));

    await turn((await onDisk()).headTurnId);

    expect((await onDisk()).channels['se.mood']?.value).toBe('thunderstruck');

    // And it is still only in the snapshot: nothing wrote it to the log, which
    // is precisely the divergence `reconcileHandEdits` exists to close on the
    // next read. The edit is held, not adopted.
    const turns = await readTurns(context, ACCOUNT, session.id);
    const replayed = replayChannels(walkPath(turns, (await onDisk()).headTurnId));
    expect(replayed['se.mood']).toBeUndefined();
  });

  it('is reversible like any other effect', async () => {
    await turn(null);
    await editTheClockOnDisk({ day: 1, hour: 19, minute: 30 });
    const [effect] = await reconcileHandEdits(context, ACCOUNT, session.id);
    if (!effect) throw new Error('expected an effect');

    // Undoing the tip is applying `before` — no replay from zero.
    const undone = applyEffects((await onDisk()).channels, [
      { ...effect, op: { type: 'set', path: '/' }, before: effect.after, after: effect.before },
    ]);
    expect(readClock(undone)).toEqual({ day: 1, hour: 8, minute: 5 });
  });

  it('does nothing when the file and the log agree', async () => {
    await turn(null);
    const before = await onDisk();

    expect(await reconcileHandEdits(context, ACCOUNT, session.id)).toEqual([]);

    // Not even a touch: an ordinary load must not append a turn.
    expect(await onDisk()).toEqual(before);
  });

  it('records a channel deleted from the file as a delete', async () => {
    // The one divergence a re-derive-and-overwrite would read as "nothing
    // changed", and it is as much an intent as an edit.
    await turn(null);
    const file = JSON.parse(await readFile(sessionFile(), 'utf8')) as SessionFile;
    // Rebuilt without the key rather than deleted from — the same shape
    // `applyEffects` uses, and for the same reason the rule bans the other one.
    const { [SE_CLOCK]: removed, ...rest } = file.channels;
    void removed;
    await writeFile(sessionFile(), JSON.stringify({ ...file, channels: rest }, null, 2));

    const [effect] = await reconcileHandEdits(context, ACCOUNT, session.id);

    expect(effect?.op).toEqual({ type: 'delete', path: '/' });
    expect(effect?.proposedBy).toEqual({ kind: 'user' });
    expect((await onDisk()).channels[SE_CLOCK]).toBeUndefined();
  });

  /**
   * **A hand edit to a *scoped* channel names the channel and the key, not the
   * composite** — the defect [P7 §0.1a] found, and the reason it survived.
   *
   * `divergenceEffects` iterated `Object.keys(channels)` and passed each one
   * straight through as `channelId`, with `scopeKey` hardcoded null. For
   * `se.clock` the map key *is* the channel id, so every test here passed. For
   * an entry-scoped channel the key is `se.lore.timing#<entryId>`, and the
   * recorded effect claimed a channel of that name at no scope.
   *
   * **It round-tripped, which is why nothing noticed**: `applyEffects` rebuilds
   * the key with `channelKey(channelId, scopeKey)`, and
   * `channelKey('se.lore.timing#e-1', null)` is the same string it started
   * from. So the map came out correct and the *record* was wrong — the one
   * outcome this whole mechanism exists to prevent, since a hand edit becomes
   * an effect precisely so a person can read it.
   */
  async function editScopedTimingOnDisk(entryId: string, value: unknown): Promise<void> {
    const file = JSON.parse(await readFile(sessionFile(), 'utf8')) as SessionFile;
    file.channels[channelKey(SE_LORE_TIMING, entryId)] = { version: 1, value };
    await writeFile(sessionFile(), JSON.stringify(file, null, 2));
  }

  it('names the channel and the scope key, not the composite key', async () => {
    await turn(null);
    await editScopedTimingOnDisk('e-1', { sticky: 2, cooldown: 0, fired: 1 });

    const effects = await reconcileHandEdits(context, ACCOUNT, session.id);
    const timing = effects.find((candidate) => candidate.channelId === SE_LORE_TIMING);

    expect(timing).toBeDefined();
    expect(timing?.scopeKey).toBe('e-1');
    // The consequence, stated as the thing a reader actually needs: the id on
    // the effect resolves to a definition. `se.lore.timing#e-1` never did, so
    // nothing could look up the policy that governs it or render its name.
    expect(channelDefinition(timing?.channelId ?? '')).not.toBeNull();
    // And the map is untouched by the correction, because it was already right.
    expect((await onDisk()).channels[channelKey(SE_LORE_TIMING, 'e-1')]?.value).toEqual({
      sticky: 2,
      cooldown: 0,
      fired: 1,
    });
  });

  it('keeps two scoped edits apart, each naming its own key', async () => {
    await turn(null);
    await editScopedTimingOnDisk('e-1', { sticky: 2, cooldown: 0, fired: 1 });
    await editScopedTimingOnDisk('e-2', { sticky: 0, cooldown: 3, fired: 4 });

    const effects = await reconcileHandEdits(context, ACCOUNT, session.id);
    const scoped = effects.filter((candidate) => candidate.channelId === SE_LORE_TIMING);

    expect(scoped.map((candidate) => candidate.scopeKey).sort()).toEqual(['e-1', 'e-2']);
    // Two effects, not one clobbering the other — the same property [P5.5]
    // established for the map, now held by the record as well.
    expect(scoped.find((candidate) => candidate.scopeKey === 'e-2')?.after).toEqual({
      sticky: 0,
      cooldown: 3,
      fired: 4,
    });
  });

  it('records a scoped value deleted from the file against its own key', async () => {
    await turn(null);
    await editScopedTimingOnDisk('e-1', { sticky: 2, cooldown: 0, fired: 1 });
    await reconcileHandEdits(context, ACCOUNT, session.id);

    const file = JSON.parse(await readFile(sessionFile(), 'utf8')) as SessionFile;
    const { [channelKey(SE_LORE_TIMING, 'e-1')]: removed, ...rest } = file.channels;
    void removed;
    await writeFile(sessionFile(), JSON.stringify({ ...file, channels: rest }, null, 2));

    const [effect] = await reconcileHandEdits(context, ACCOUNT, session.id);

    expect(effect?.op).toEqual({ type: 'delete', path: '/' });
    expect(effect?.channelId).toBe(SE_LORE_TIMING);
    expect(effect?.scopeKey).toBe('e-1');
    expect((await onDisk()).channels[channelKey(SE_LORE_TIMING, 'e-1')]).toBeUndefined();
  });

  it('is still reversible when the channel is scoped', async () => {
    // The inversion carries `channelId` and `scopeKey` through unchanged, so a
    // malformed effect made a malformed undo. This is that path, scoped.
    await turn(null);
    await editScopedTimingOnDisk('e-1', { sticky: 9, cooldown: 0, fired: 1 });
    await reconcileHandEdits(context, ACCOUNT, session.id);

    const turns = await readTurns(context, ACCOUNT, session.id);
    const head = turns.get((await onDisk()).headTurnId ?? '');
    const written = head?.effects.find((candidate) => candidate.channelId === SE_LORE_TIMING);

    expect(written?.scopeKey).toBe('e-1');
    // Replaying the log from zero puts the value back under the scoped key,
    // which is the claim the record has to be right for.
    const replayed = replayChannels(walkPath(turns, (await onDisk()).headTurnId));
    expect(replayed[channelKey(SE_LORE_TIMING, 'e-1')]?.value).toEqual({
      sticky: 9,
      cooldown: 0,
      fired: 1,
    });
  });

  it('heals a divergence nobody intended, visibly', async () => {
    // If the snapshot drifted because of a bug rather than a person, the same
    // mechanism turns it into an effect somebody can inspect — instead of
    // letting it persist silently, which is the failure mode that costs a
    // week to diagnose.
    await turn(null);
    await editTheClockOnDisk({ day: 400, hour: 3, minute: 0 });

    const effects = await reconcileHandEdits(context, ACCOUNT, session.id);

    expect(effects).toHaveLength(1);
    const turns = await readTurns(context, ACCOUNT, session.id);
    const head = turns.get((await onDisk()).headTurnId ?? '');
    // Visible in the turn record, which is where the workbench will show it.
    expect(head?.effects[0]?.after).toEqual({ day: 400, hour: 3, minute: 0 });
  });
});

/**
 * **A channel scoped per entry keeps one value per entry** — the widening
 * [P5.5] made, and the reason it had to.
 *
 * `ChannelDefinition.scope` has offered `'actor'` and `'entry'` since the first
 * channel was written, and `ChannelEffect.scopeKey` carries the docstring
 * *"Which value, when the channel is scoped per actor or per entry"* — but
 * `applyEffects` keyed on the channel id alone, so the vocabulary was a promise
 * nothing kept. [P5 §0.4] found it, [P6 §1.9] asked which phase pays, and the
 * phase order answers this one: P5.5 is the first stage that needs a per-entry
 * value, and shipping it under the old key would have been shipping a feature
 * that silently overwrites itself.
 *
 * These are about the **map**, not about lore. Timing is simply the first
 * caller, and an actor-scoped channel arriving at P7 gets the same behaviour
 * without a second argument.
 */
describe('a channel scoped to something', () => {
  function scopedEffect(scopeKey: string | null, value: unknown): ChannelEffect {
    return {
      id: uuidv7(),
      turnId: 't-1',
      channelId: SE_LORE_TIMING,
      scopeKey,
      op: { type: 'set', path: '/' },
      before: null,
      after: value,
      proposedBy: { kind: 'engine' },
      applied: true,
      rejectedReason: null,
      supersedes: null,
      channelVersion: 1,
      scope: 'session',
    };
  }

  /** The assertion the widening exists for. Keyed by id alone, one wins. */
  it('does not let two scope keys overwrite each other', () => {
    const applied = applyEffects({}, [
      scopedEffect('entry-a', { sticky: 2 }),
      scopedEffect('entry-b', { sticky: 5 }),
    ]);

    expect(applied[channelKey(SE_LORE_TIMING, 'entry-a')]?.value).toEqual({ sticky: 2 });
    expect(applied[channelKey(SE_LORE_TIMING, 'entry-b')]?.value).toEqual({ sticky: 5 });
  });

  it('still replaces the value under one key', () => {
    const applied = applyEffects({}, [
      scopedEffect('entry-a', { sticky: 2 }),
      scopedEffect('entry-a', { sticky: 1 }),
    ]);

    expect(Object.keys(applied)).toHaveLength(1);
    expect(applied[channelKey(SE_LORE_TIMING, 'entry-a')]?.value).toEqual({ sticky: 1 });
  });

  it('deletes only the scoped value it names', () => {
    const both = applyEffects({}, [
      scopedEffect('entry-a', { sticky: 2 }),
      scopedEffect('entry-b', { sticky: 5 }),
    ]);
    const after = applyEffects(both, [
      { ...scopedEffect('entry-a', null), op: { type: 'delete', path: '/' } },
    ]);

    expect(after[channelKey(SE_LORE_TIMING, 'entry-a')]).toBeUndefined();
    expect(after[channelKey(SE_LORE_TIMING, 'entry-b')]?.value).toEqual({ sticky: 5 });
  });

  /**
   * **An unscoped channel is untouched**, which is what keeps every stored
   * session and every existing reader working: `se.clock` is `se.clock`, not
   * `se.clock#null`, so the shape on disk did not change and neither did the
   * lookups against it.
   */
  it('leaves an unscoped channel under its plain id', () => {
    expect(channelKey(SE_CLOCK, null)).toBe(SE_CLOCK);

    const applied = applyEffects({}, [{ ...scopedEffect(null, { day: 2 }), channelId: SE_CLOCK }]);

    expect(applied[SE_CLOCK]?.value).toEqual({ day: 2 });
  });

  it('tells a channel’s own keys from another channel’s', () => {
    expect(keyBelongsTo(SE_LORE_TIMING, SE_LORE_TIMING)).toBe(true);
    expect(keyBelongsTo(channelKey(SE_LORE_TIMING, 'e-1'), SE_LORE_TIMING)).toBe(true);
    expect(keyBelongsTo(SE_CLOCK, SE_LORE_TIMING)).toBe(false);
    // The prefix test is on the separator, so a longer channel id that happens
    // to start with a shorter one is not swept up with it.
    expect(keyBelongsTo('se.lore.timings', SE_LORE_TIMING)).toBe(false);
  });

  it('gives the scope key back', () => {
    expect(scopeKeyOf(channelKey(SE_LORE_TIMING, 'e-1'), SE_LORE_TIMING)).toBe('e-1');
    expect(scopeKeyOf(SE_LORE_TIMING, SE_LORE_TIMING)).toBeNull();
  });

  /**
   * The inverse, for the caller that has a key and no channel id — which is
   * anything iterating the map, and is where the divergence defect lived.
   */
  it('splits a key back into the pair that built it', () => {
    expect(splitChannelKey(channelKey(SE_LORE_TIMING, 'e-1'))).toEqual({
      channelId: SE_LORE_TIMING,
      scopeKey: 'e-1',
    });
    // Unscoped comes back as null rather than as an empty string: *absent* and
    // *empty* are different claims here exactly as they are on the wire.
    expect(splitChannelKey(SE_CLOCK)).toEqual({ channelId: SE_CLOCK, scopeKey: null });
  });

  it('round-trips every scope key through the composite form', () => {
    // Including the ones a uuid or an import id can actually be — the dotted
    // and hyphenated shapes are what made splitting at the *first* separator
    // the contract rather than an implementation detail.
    for (const scopeKey of ['e-1', uuidv7(), 'imported.entry-4', '0', 'a.b.c']) {
      expect(splitChannelKey(channelKey(SE_LORE_TIMING, scopeKey))).toEqual({
        channelId: SE_LORE_TIMING,
        scopeKey,
      });
    }
  });
});
