// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type {
  BranchRef,
  ChannelState,
  Goal,
  ModelRole,
  PlotHook,
  Preset,
  Setup,
} from '@storyengine/shared';

import type { SessionMemoryConfig } from '../memory/config.js';
import type { Binding } from '../providers/types.js';

/**
 * Sessions and turns on disk — [03 §5.5](../../../../docs/design/03-data-model.md),
 * [21 §1](../../../../docs/design/21-internal-contracts.md).
 *
 * **The turn record's shapes live in `@storyengine/shared` since [P3.0]** —
 * `packages/shared/src/turn.ts`, which carries the contracts' documentation
 * and the internal-tier argument (free to migrate until session export makes
 * a stored turn portable). They moved *after* the P3.0 repairs landed, per
 * §1.9's rule: the promise to stop churning the shapes is only keepable once
 * they have stopped churning. This module re-exports them so the server's
 * import paths stay put, and keeps the one shape that never crosses:
 * `SessionFile` describes a file on this install's disk, and the client reads
 * a projection of it through the routes rather than the file's own type.
 */
export type {
  AssembledBlock,
  BlockSource,
  BranchRef,
  BudgetLimit,
  BudgetVerdict,
  CallPurpose,
  ChannelEffect,
  ChannelState,
  EffectOp,
  ModelCall,
  NotFilledReason,
  NotFilledSlot,
  StepFailureReason,
  StepOutcome,
  StepSkipReason,
  StepStage,
  Turn,
  TurnCost,
  TurnRequest,
} from '@storyengine/shared';

/**
 * `session.json` — metadata, cast, the lore links, named branch refs, and the
 * head channel snapshot.
 *
 * **The snapshot is derived, not authoritative** ([03 §8.1]). A session is a
 * tree, so "the channel state of a session" is not a thing that exists: state
 * exists *at a node*. A single `channels` map here can therefore only mean
 * state at `headTurnId`, and deleting it must cost a recomputation and nothing
 * else. It is in the file at all because somebody will open it, and a session
 * file that cannot tell you what time it is in the story fails the legibility
 * promise the whole storage design rests on.
 *
 * *This docstring advertised branch refs the interface did not have from P2
 * until [P6.1], and stopped mentioning `treatment` and `lore` when P5.6 added
 * them — [P6 §0.3]'s first item, which asked for one edit because a reader of
 * this file would believe both.*
 */
export interface SessionFile {
  schema: 'storyengine.session/1';
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  /** Null before the first turn. */
  headTurnId: string | null;
  /** State at `headTurnId`. Derived. Hand-editing it writes an effect. */
  channels: Record<string, ChannelState>;
  /**
   * Which mode this session plays, and how it was configured — [06 §1].
   *
   * Optional because every session written by P2.3 to P2.5 predates it, and a
   * read that healed the file would need the session lock, which is not
   * reentrant. Absent reads as the default mode.
   *
   * ***`config` is the wizard's answers, and it acquired its writer at [P7.4]***
   * — 2026-09-12. *"How it was configured"* has meant this since P2.3 and was
   * written `null` by every creation; the portable `Setup` names the same value
   * the same way — `mode.config`, *"whatever the mode's own setup collected,
   * stored verbatim, never interpreted by the host"*. **A first draft of P7.4
   * put the answers in a `setup` field beside this one**, which was a second
   * home for a value that already had one, and a name collision with the Setup
   * object below. Corrected before anything depended on it.
   *
   * *A step reads the same value as `StepInput.setup`, and the two names are
   * both the corpus's: the record calls it config, and a mode answering its own
   * `SetupSchema` calls it setup — which is the split `Setup.mode.config`
   * already draws.*
   */
  mode?: { id: string; config: unknown };
  /**
   * The **Setup** this session was created from, copied — [04 §7], [P7.4].
   *
   * ***Not the mode's wizard; the library object one word away from it.*** A
   * `Setup` is *how to start playing* — a mode, a preset, a treatment, a cast to
   * choose from, lore, hooks and goals — and [04 §7] is explicit that sessions
   * are created from one **by copy**, so *"editing a Setup afterwards cannot
   * reach a running session"* ([00 §3.1]). The same asymmetry the preset has,
   * for the same reason.
   *
   * **It is what makes [04 §6.1b]'s middle rung reachable.** That section
   * settles where an authored default may be written down — *"a Treatment
   * proposes, a Setup overrides, and the running session owns it"* — and until
   * this there was no Setup rung at all, because a session did not record which
   * one it came from. A recorded finding of this phase, discharged.
   *
   * Absent for a session started from parameters rather than from a Setup,
   * which is every session written before P7.4 and every one a person starts by
   * pressing Start.
   */
  setup?: Setup;
  /**
   * The hook pool, with each hook's source — [03 §4.1], [06 §6.1], [P7.5].
   *
   * **The pool's fourth source finally has a home.** 03 §4.1 calls a session's
   * own hooks *the primary path* for adding one mid-game, and until [P7.5] there
   * was no field for them and no way to pass one — which is what that stage's
   * cell records.
   *
   * **Copied at creation, which is [06 §6.1]'s *pulled, never pushed*** over
   * [00 §3.1]: editing a treatment must not reach a game already in progress.
   * The preset's asymmetry, not the cast's. *The copies keep their source hooks'
   * ids, which is [15 §5]'s obligation and is pinned by a test rather than left
   * to a `structuredClone` — a corpus of sessions whose hooks have unrelated ids
   * cannot be retro-fitted into a continuity.*
   *
   * Absent for every session written before P7.5, and for one whose sources
   * carried no hooks — which is different from a pool somebody emptied.
   */
  hooks?: PooledHook[];
  /**
   * What this session is trying to do, in order — [04 §7.1], [06 §7.3.3],
   * [P7.6].
   *
   * ***A copy, like the pool and the pack and for the same reason***: a Setup is
   * authored content and editing one must not reach a game in progress
   * ([00 §3.1]). The chain is ordered, `goals[0]` is where play begins, and
   * **Advance may write a goal that was never in the Setup** — [06 §7.3.4]'s
   * *"set the next goal, either the authored `next` or one written now"*, which
   * is the clause that makes this a session field rather than a link.
   *
   * *What has **happened** to a goal is not here*: that is `se.goal`, per-goal
   * channel state, because a completion has to branch and a field does not.
   *
   * Absent for every session written before P7.6, and for one created from a
   * Setup with no goals — which [04 §7.1] calls *"the deliberate opt-out rather
   * than the default"*.
   */
  goals?: Goal[];
  /**
   * The session's own copy of its prompt pack — [03 §8].
   *
   * **A copy, not a link**, and the asymmetry with `cast` is deliberate:
   * editing a preset must not silently change how an ongoing game is assembled,
   * while improving a character card *should* reach it.
   */
  preset?: Preset;
  /**
   * Who is in it. **Links, resolved fresh every turn** — see `preset` above for
   * why this one is the opposite.
   */
  cast?: { persona: string | null; actors: string[] };
  /**
   * The treatment this session is played under, and the lorebooks the retriever
   * scans — [03 §8], added at [P5.6] because before it a session referenced
   * **neither object at all** and a retriever with no books has nothing to do.
   *
   * **Links, like `cast`, and for `cast`'s reason.** Fixing a typo in the world
   * should reach the story being told in it. The full argument — including how
   * a session naming its own treatment squares with [03 §8]'s *editing the
   * source treatment later must not affect this session*, which is about the
   * `origin` provenance chain rather than about this field — is in
   * `turns/lore.ts`, next to the code that acts on it.
   *
   * Optional for the same reason `mode` is: every session written before P5.6
   * predates them, and healing a file on read would need the session lock.
   * Absent reads as *no treatment, no books*, which is what those sessions had.
   */
  treatment?: string | null;
  /** Extras beyond whatever the treatment already links — [03 §7]. */
  lore?: string[];
  /**
   * Model overrides for this session — [19 §5.1](../../../../docs/design/19-tech-stack.md)'s
   * third and fourth layers, [P7 §1.9], built at [P7.3].
   *
   * *"Overrides layer on top in a fixed order: install default → role binding →
   * **session override** → **step override** → actor hint."* `resolveRole` has
   * implemented all of that since P2B and **nothing outside a test has ever
   * passed either of these two** — which is what 19 §5.1's own table means by
   * *"plumbed into `resolveRole` and never passed"*.
   *
   * **Here rather than in a mode or a preset, and that is a correction.**
   * [P7 §1.9] says the step override's *"surface is the mode or preset
   * declaration, not a panel"* — but 19 §5.1 opens with **"Steps never name a
   * model… Nothing in a mode, step or extension refers to a provider or a model
   * id — which is what makes an install portable, an extension safe to share"**.
   * A `Binding` names a `connectionId`, which exists only on one install, so a
   * mode or a portable preset cannot carry one without breaking the property
   * that whole section is for. *A cheap model for one noisy step is an
   * operator's decision about their own providers, not an author's about their
   * story* — so it lives on the session, keyed by step id, beside the session
   * override it layers under.
   *
   * Optional for the reason every field here is: a session written before this
   * has neither, and absent reads as *no override*, which is what those sessions
   * had.
   */
  roles?: Partial<Record<ModelRole, Binding>>;
  /** Per-step overrides, keyed by `StepDefinition.id`. See {@link SessionFile.roles}. */
  stepRoles?: Record<string, Binding>;
  /**
   * Named bookmarks on nodes — [07 §3], added at [P6.1].
   *
   * **A list of names, and no turn data.** Creating one writes a name and an
   * id; deleting one deletes a name. Nothing in this array owns a turn, and
   * nothing reads it to decide what history is: that is `headTurnId` and the
   * walk. Optional because every session written before P6.1 predates it, and
   * absent reads as *no names yet*.
   */
  branchRefs?: BranchRef[];
  /**
   * Which child a node was last continued through — [07 §3]'s
   * `lastSelectedChildId`, *"purely so that navigating back and then forward
   * again resumes where you were rather than guessing"*.
   *
   * **A map here rather than a field on the turn, and that is forced.** The
   * design says *a node may record* it, but a turn is a line in an append-only
   * segment that is never rewritten ([03 §5.5]) — so a field on the record
   * could only be written once, at creation, when the answer is not yet known.
   * The mutable half of a session lives in this file; this is the mutable fact
   * about a node, keyed by the node's id.
   *
   * Derived in the weak sense that losing it costs a person one navigation
   * choice rather than any story: `resumeFrom` falls back to the only child
   * when a node has exactly one, and stops at a node with two the map does not
   * name — which is `reconcileSession`'s rule for the same situation, and the
   * difference between resuming and guessing.
   */
  lastSelectedChild?: Record<string, string>;

  /**
   * ***Whether this session shares memories and draws on them*** —
   * [08 §4](../../../../docs/design/08-cross-session-memory.md),
   * [08 §7](../../../../docs/design/08-cross-session-memory.md), [P8.4].
   *
   * Two switches and a tri-state list — see `memory/config.ts`, which carries
   * the argument for each and the table of all four combinations.
   *
   * **On the session rather than on the book**, and that is 08 §1's requirement
   * rather than a placement: *"Each session has two toggles"* and *"beyond
   * those, manual association: a list of the account's sessions, each
   * individually forceable on or off"*. A book is shared between sessions by
   * construction, so a toggle on it would be one session deciding for the rest.
   *
   * Optional for the reason every field here is: every session written before
   * this predates it, and absent reads as `DEFAULT_MEMORY_CONFIG` — both
   * switches on, which is what those sessions had when the feature did not
   * exist.
   */
  memory?: SessionMemoryConfig;

  /**
   * Set when the session is archived — [03 §10.3].
   *
   * **Archive is not deletion**, and it is here because most sessions people
   * stop playing are not sessions they want gone; they are sessions they want
   * out of the way. Offering only Delete for that pushes people into a
   * destructive action to solve a cosmetic problem.
   *
   * A field in the file rather than a marker file or a directory move: it is
   * legible to somebody who opens `session.json`, it survives a copy, and — the
   * deciding reason — an archived session is *fully intact*, so moving it would
   * make "restorable, never swept" a second code path instead of a flag.
   */
  archivedAt?: string;
}

/**
 * Where a pooled hook came from — [03 §4.1], [P7.5].
 *
 * **The lorebook arm carries the book's id for a reason that is mechanical
 * rather than navigational.** 03 §4.1: *"a hook carried by a lorebook is only
 * eligible while that lorebook is active in the session. That is a sensible
 * default and a mechanical justification for the association, rather than 'it
 * seemed handy'."* The filter reads this; without the id there would be nothing
 * to check the session's live book list against.
 *
 * *The session arm carries no id because there is no object to navigate to — a
 * session-local hook is owned by the session, which is the thing you are already
 * looking at.*
 */
export type HookSource =
  | { kind: 'treatment'; id: string }
  | { kind: 'setup'; id: string }
  | { kind: 'lore'; id: string }
  | { kind: 'session' };

/**
 * One hook in a session's pool, with its attribution.
 *
 * **Here rather than in `sessions/hooks.ts`, and the reason is a build error
 * this file has hit before** ([P7.3] moved `Binding` for it). This module is the
 * session record's *shapes* and imports nothing that touches storage; `hooks.ts`
 * imports the lore resolver, so a type declared there and referenced from
 * `SessionFile` drags the whole storage layer into this file's type graph — and
 * `write-file-atomic`'s missing declarations surface as the error that says so.
 */
export interface PooledHook {
  hook: PlotHook;
  source: HookSource;
}
