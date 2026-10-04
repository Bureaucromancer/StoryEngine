// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import {
  RENDITION_SCHEMA,
  type Rendition,
  type RenditionProvenance,
  type RenditionPurpose,
} from '@storyengine/shared';

import type { StepCastMember } from '@storyengine/sdk';

import { assemblePrompt, fragmentsFor } from './assemble.js';
import { recipeDigest } from './digest.js';
import { readRenditions, renditionIdFor, writeRendition } from './store.js';
import type { ProviderCapabilities } from '../providers/types.js';
import type { Binding } from '../providers/types.js';
import type { Layout } from '../storage/layout.js';

/**
 * **Illustrate** and **Set the scene** — [06 §10.6](../../../../docs/design/06-modes-and-turn-pipeline.md),
 * [26 E3](../../../../docs/design/26-open-questions.md), [P9.4].
 *
 * *"A manual **Illustrate** action on any message in the history, which is the
 * same step invoked by hand — **additive, never replacing**."*
 *
 * ***The same assembly, outside the runner***, which is `previewAssembly`'s
 * arrangement and [P3 §1.7]'s *assemble-without-dispatch as a parameterised
 * function*. What it is **not** is a second assembly path: the fragment builders
 * and the capper are the step's, imported, so a change to how a picture is
 * described cannot reach one caller and miss the other.
 *
 * ---
 *
 * ***§1.3's `[OPEN]`, decided here and disclosed*** — [06 §10.6]'s standing
 * question, *"whether an on-demand rendition of an old turn assembles from that
 * turn's recorded state or from the present"*.
 *
 * **Recorded state.** Three things decide it:
 *
 * - *It is decidable now in a way it was not when the question was written.* P3
 *   shipped the record reader and P6 shipped reconstruction at a node, so *that
 *   turn's state* is a function call rather than a research project.
 * - ***Backgrounds make it one-sided rather than finely balanced***, which is
 *   §1.3's own evidence: a backdrop's whole subject is **where you were
 *   standing**, so present state is visibly wrong for one purpose and merely
 *   arguable for the other — and both read the same field, so *"whatever is
 *   decided, it is decided once"*.
 * - The surprise is mitigated by **disclosure rather than by a setting**: the
 *   assembled fragments are on the record and the workbench shows them beside
 *   the turn they were assembled at, which is the surface §1.3 names.
 *
 * *So the caller reconstructs at the node and hands the state in.* This module
 * does no I/O beyond the store, for the reason `previewAssembly` does none: what
 * varies between a preview, a turn and a hand-pressed button is where the state
 * came from, not what is done with it.
 */

export interface ManualRequest {
  layout: Layout;
  handle: string;
  sessionId: string;
  /** The node this picture is of — its **recorded** state, reconstructed by the caller. */
  turnId: string;
  purpose: RenditionPurpose;
  /** The turn's own prose, for an illustration. Empty for a backdrop. */
  moment: string;
  cast: readonly StepCastMember[];
  channels: readonly { id: string; text: string }[];
  tone: string | null;
  image: { binding: Binding; capabilities: ProviderCapabilities };
  workflow: Readonly<Record<string, string | number | boolean>>;
  /** Drawn by the caller, so this module makes no draw of its own ([20 §14]). */
  seed: number;
  /** A verbatim quote naming where the picture goes, when one is known. */
  anchor?: string;
}

/**
 * Builds a pending rendition for a turn and returns it, for the caller to
 * dispatch. ~~Writes~~ *Corrected 2026-09-27:* the dispatch writes it, after
 * claiming its job, so that no `pending` record is on disk without a job row
 * recovery can find (`dispatchRenditions`).
 *
 * ***The ordinal is the next free one***, which is what makes one id scheme
 * serve both producers. The step names its requests `<turnId>.0`, `<turnId>.1`;
 * a hand-pressed button takes the next number after whatever that turn already
 * holds. So a turn's siblings are enumerable from the directory with no index,
 * and [06 §10.7]'s *"illustrating an old turn adds; it does not overwrite"* is
 * true because the name is different rather than because something checked.
 *
 * **No moment call here**, and that is not a shortcut. For a backdrop there is
 * none by definition (§10.3). For an illustration the caller makes it, because
 * making a model call needs the role resolution a route has and this module does
 * not — the same division `SummariseContext.key` draws.
 */
export async function requestRendition(request: ManualRequest): Promise<Rendition> {
  const held = await readRenditions(request.layout, request.handle, request.sessionId);
  const siblings = [...held.values()].filter((one) => one.turnId === request.turnId);
  const id = renditionIdFor(
    request.turnId,
    nextOrdinal(
      siblings.map((one) => one.id),
      request.turnId,
    ),
  );

  const prompt = assemblePrompt(
    fragmentsFor(request.purpose, {
      moment: request.purpose === 'background' ? '' : request.moment,
      cast: request.purpose === 'background' ? [] : request.cast,
      channels: request.channels,
      tone: request.tone,
    }),
    request.image.capabilities,
  );

  const rendition: Rendition = {
    schema: RENDITION_SCHEMA,
    id,
    sessionId: request.sessionId,
    turnId: request.turnId,
    createdAt: new Date().toISOString(),
    kind: 'image',
    purpose: request.purpose,
    scope:
      request.anchor === undefined || request.anchor.trim() === ''
        ? null
        : { anchor: request.anchor.trim() },
    state: 'pending',
    prompt,
    asset: null,
    provenance: {
      at: null,
      binding: request.image.binding,
      answeredAs: null,
      seed: request.seed,
      workflow: request.workflow,
    },
    error: null,
    digest: recipeDigest(request.image.binding, prompt, request.workflow),
    ordering: 0,
  };

  return rendition;
}

/**
 * Re-creates an evicted or failed rendition from its own record — [26 E3].
 *
 * ***This is gate step 15, and it is structural rather than careful.*** *"Re-create
 * an evicted rendition and **no text call is made**: the moment is replayed from
 * `prompt`, not asked for again."* There is no assembly here and no role to
 * resolve — the record already holds the fragments, the separator, the budget
 * and the seed, so the only thing this function does is set the state back to
 * `pending` and hand the record to a job.
 *
 * **Which means the assertion is about a code path that does not exist**, rather
 * than about a flag somebody remembered to check. [06 §10.3] is emphatic that
 * *"a second call is a second answer"* and that two identical places would then
 * stop hashing alike; a re-creation that went through the step would break both
 * the recipe promise and the reuse key at once.
 *
 * *The seed is kept too*, which is the difference between *the same picture* and
 * *another picture of the same thing*. Regenerating deliberately is a different
 * act and makes a **sibling** ({@link requestRendition}), which is §10.7's
 * *additive, never replacing*.
 */
export async function recreateRendition(
  layout: Layout,
  handle: string,
  sessionId: string,
  rendition: Rendition,
): Promise<Rendition> {
  const provenance: RenditionProvenance = { ...rendition.provenance, at: null, answeredAs: null };
  /**
   * ***Whether the last run's seed was sent is the last run's fact, not the
   * recipe's.*** The next one may go out on a connection whose capability has
   * changed since, so a pending record carrying the old answer would state a
   * claim about a call that has not happened. Deleted from a copy rather than
   * the fields enumerated, so a recipe field added later survives re-creation
   * by default — which is the direction [06 §10.7] needs the default to point.
   */
  delete provenance.seedSent;
  const again: Rendition = {
    ...rendition,
    state: 'pending',
    asset: null,
    error: null,
    provenance,
  };
  await writeRendition(layout, handle, sessionId, again);
  return again;
}

/**
 * The next free ordinal under a turn.
 *
 * Reads the numbers off the ids rather than counting them, because a rendition
 * somebody deleted must not make the next one collide with a survivor.
 */
function nextOrdinal(ids: readonly string[], turnId: string): number {
  const used = ids
    .map((id) => (id.startsWith(`${turnId}.`) ? Number(id.slice(turnId.length + 1)) : Number.NaN))
    .filter((one) => Number.isInteger(one));
  return used.length === 0 ? 0 : Math.max(...used) + 1;
}
