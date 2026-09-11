// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { BranchRef, ChannelState, ModelRole, Preset } from '@storyengine/shared';

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
   */
  mode?: { id: string; config: unknown };
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
