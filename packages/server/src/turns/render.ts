// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type {
  Candidate,
  ChannelDefinition,
  StepDefinition,
  StepHost,
  StepImplementation,
  StepInput,
} from '@storyengine/sdk';
import type { AssembledPrompt, RenditionRequest, RenditionScope } from '@storyengine/shared';

import {
  assemblePrompt,
  fragmentsFor,
  illustrationFragments,
  placeOf,
  roomForMoment,
  withoutNames,
  type FragmentInputs,
} from '../renditions/assemble.js';
import { recipeDigest } from '../renditions/digest.js';
import { initialValue } from '../sessions/channels.js';
import type { Binding, ProviderCapabilities } from '../providers/types.js';

/**
 * The rendition step — [06 §10.3](../../../../docs/design/06-modes-and-turn-pipeline.md),
 * [P9.1].
 *
 * **The sixth engine-owned step**, after the hook selector, the mention pass,
 * the goal judge, the suggester and the summariser — and `turns/runner.ts`
 * appends it the way it appends those, for the reason it appends those: deciding
 * what a turn is a picture *of* is engine machinery like the clock, not a
 * narrative choice a mode makes. A mode that wants no pictures has the session
 * setting off, and the runner leaves the step out of the plan entirely rather
 * than running it to do nothing.
 *
 * ---
 *
 * ***It makes one call and it is not the one that costs money.*** The `fast`
 * call here writes **the moment** — one line saying what is in the picture —
 * because [06 §10.3] opens by refusing the alternative: *"handing the whole turn
 * text to an image model produces a prompt about a paragraph, which is how an
 * illustration ends up depicting three things at once and none of them well."*
 * The **image** call is dispatched as a job after the turn commits ([P9.2]), and
 * that split is [06 §10.2]'s *not an optimisation, the only workable design*:
 * an image is seconds and a video can be minutes, and a story that stalls on
 * either is unusable.
 *
 * **So what this step produces is a *request*, not a picture**, and the step's
 * falsifying mutation is making the image call here — at which point every
 * assertion about pixels still passes and the turn blocks.
 *
 * ***The background branch makes no call at all***, which §10.3 states as the
 * sharpened version of its own sentence: *"a backdrop is a place and a place has
 * no moment."* Same step, same fragments, same cap; one branch calls and the
 * other does not, and the ranking differs because what belongs in a backdrop and
 * what belongs in an illustration are different questions asked of one turn.
 *
 * ---
 *
 * ***What it does not write is the channel.*** `se.backdrop` is
 * `update: 'engine-computed'` and [P7.9] wrote the clause for this phase: *"a
 * person may pick a backdrop, a model may not, and P9's generator writes it
 * through the engine rather than out of its step."* So `writes` is empty, the
 * step reports, and the engine applies the selection ([P9.3]). [P9 §1.7] warns
 * what happens otherwise: a stage that discovers the policy by failing an effect
 * proposal will be tempted to widen the channel, *"and widening it is the one
 * repair that undoes the argument."*
 */

export const SE_RENDER = 'se.render';

/** The session channel that says whether this session illustrates — [P9.4]. */
export const SE_ILLUSTRATE = 'se.illustrate';

/** Scene's own switch for the backdrop — declared by the mode, read here. */
export const SE_BACKDROP_ON = 'se.backdrop.on';

/**
 * Whether this session illustrates — [06 §10.6], [P9.4].
 *
 * *Absent reads as the declaration*, through `initialValue`, which is
 * `readSuggesting`'s rule and `readPacing`'s fourth rung: **the channel is what
 * says what unspecified means**, and a restated `?? 'off'` here would be a
 * second statement of it that could disagree.
 *
 * ***`byMode` is the per-mode default, and it is read here rather than written
 * at creation.*** §10.6 asks for per-mode defaults — *"Scene wants illustration
 * far more than Messages does"* — and the obvious implementation, seeding
 * `session.channels` when the session is made, is **wrong in a way the suite
 * catches loudly**: a value in that map with no effect behind it is exactly what
 * [P6.0b]'s reconciliation calls a **hand edit**, so the next turn folds it into
 * a user-attributed divergence turn and every *writes no turn* assertion in the
 * build goes red. The map is derived from the effect log; a default is not a
 * change anybody made, so it does not belong in it.
 *
 * **Which leaves the channel's own `init` as the only honest home for a
 * default** — and `ILLUSTRATE_CHANNEL` is owned by a package rather than by a
 * mode, so it cannot hold a different one per mode. The fallback is therefore a
 * parameter: the caller knows which mode is playing, the channel still says what
 * unspecified means for a mode that declares nothing, and a person who turns the
 * feature off writes a real effect that wins over both.
 */
export function readIllustration(
  channels: Readonly<Record<string, { value: unknown }>>,
  byMode?: 'off' | 'on-demand' | 'each-turn',
): 'off' | 'on-demand' | 'each-turn' {
  const value = channels[SE_ILLUSTRATE]?.value ?? byMode ?? initialValue(SE_ILLUSTRATE);
  return value === 'on-demand' || value === 'each-turn' ? value : 'off';
}

/**
 * Whether this session stages a backdrop — [06 §10.6]'s *off, or on*.
 *
 * ***The reader is the engine's and the declaration is Scene's***, which is the
 * split `staging.ts` already models and explains: `initialValue` reads the
 * channel registry, which only the engine has, while the channel itself is
 * declared by the mode that has somewhere to put a backdrop. A mode with no
 * `se.backdrop` never registers this one either, so this answers `false` and the
 * runner's gate leaves the step out — which is how *"P9 delivers backdrops"*
 * comes to mean *for modes that declare a backdrop channel*.
 */
export function readBackdropOn(channels: Readonly<Record<string, { value: unknown }>>): boolean {
  const value = channels[SE_BACKDROP_ON]?.value ?? initialValue(SE_BACKDROP_ON);
  return value === true;
}

/**
 * Whether this session illustrates — [06 §10.6], [P9.4].
 *
 * ***Owned by a package rather than by a mode***, which is `SUGGEST_CHANNEL`'s
 * argument and `HOOK_PACING_CHANNEL`'s before it: every mode wants it, none owns
 * it, and routing it through one mode's declaration would make the second mode
 * either import the first or declare a rival — *"which is `registerChannel`'s
 * last-write-wins rule being asked to arbitrate"*. Nothing about *does this
 * session want pictures* is mode-shaped.
 *
 * ***Off by default, and the argument is the fourth time this build has made
 * it.*** `SUGGEST_CHANNEL` and Scene's `STAGING_CHANNEL` both default off for
 * the same reason: an image is somebody's own GPU and, on a hosted endpoint,
 * their own money, and a build that spent either on their behalf to be
 * discoverable would be making a decision that is theirs. **What keeps a default
 * of off honest rather than hiding the feature is that the control is on the
 * screen either way**, which is what [P7.11] built and what [P9.4] uses.
 *
 * *Three values rather than a boolean*, because [06 §10.6] asks for three — and
 * `on-demand` is the one that matters most: it is *the manual **Illustrate**
 * action works and nothing runs on its own*, which is the setting somebody who
 * is paying per image actually wants.
 */
export const ILLUSTRATE_CHANNEL: ChannelDefinition = {
  id: SE_ILLUSTRATE,
  owner: 'storyengine.renditions',
  version: 1,
  scope: 'session',
  /**
   * `user-only`. A model proposing that this session start spending money on
   * pictures is the narrator deciding to spend somebody's machine — Scene's
   * staging toggle makes the identical call in the identical words.
   */
  update: 'user-only',
  visibility: 'player',
  schema: { enum: ['off', 'on-demand', 'each-turn'] },
  init: { kind: 'literal', value: 'off' },
  budget: null,
};

export const RENDER_STEP: StepDefinition = {
  id: SE_RENDER,
  /**
   * **`post`, per [06 §10.3]**, and both halves want it. The moment is a reading
   * of prose that has to exist first, and the place is a reading of channel
   * state this turn has already moved — a `pre` backdrop would describe the room
   * you were leaving. ***Which it did anyway until 2026-09-30***: the channels
   * were rendered when the plan was built, before any step ran, so the place a
   * stager moved this turn reached the next turn's backdrop. They are read when
   * the step runs now (`RenderContext.channels`).
   */
  stage: 'post',
  /**
   * `output` for the moment, `cast` for the descriptors, and the channels the
   * two rankings read.
   *
   * ***`output` rather than `history`, and [P9 §0.1]'s finding 10 is why it is
   * already the right shape.*** `StepInput.output` is *"present only when
   * `reads` includes `output`"* and carries the finished text and nothing else —
   * which is the narrowing [P8 §1.5] had to add a third pseudo-source to get. A
   * step that declared `history` would be handed whole `Turn` records on its way
   * to writing an image prompt: a hook's premise, an unfired entrance's prose
   * and a hidden channel's rendered value, verbatim. Nothing here needs them.
   */
  reads: ['output', 'cast', SE_ILLUSTRATE, SE_BACKDROP_ON, 'se.location'],
  /**
   * Nothing, and this is the one declaration here that is a decision rather than
   * a description — see the header. What this produces reaches the record and
   * the dispatcher through `context.report`, which is the shape the selector,
   * the mention pass, the judge, the suggester and the summariser all use.
   */
  writes: [],
  callKind: 'moment',
  when: { when: 'cadence', everyNTurns: 1 },
  /**
   * **`warn`, never `abort`** — [06 §10.2]. The prose already exists by the time
   * a `post` step runs, so a turn thrown away because a picture could not be
   * described is precisely the failure this whole section exists to make
   * impossible: *"a failed rendition is a placeholder with a retry button, never
   * a failed turn."*
   */
  failure: 'warn',
  /**
   * ***`fast`, and this is the first step in the build to ask for a role other
   * than `prose`.***
   *
   * [19 §5.1] names this step as the one that wants both — *"a rendition step
   * asks for both, `fast` to write the moment and `image` to render it"* — and
   * [25 C15] is why the three steps before it all settled for `prose` anyway:
   * `resolveRole` has no cross-role fallback, so an unresolvable role is a
   * failed step row on every turn of every session.
   *
   * **What buys the honest role is the runner's gate.** `wantsRender` resolves
   * both `fast` and `image` *before* building the plan and omits the step
   * entirely when either fails — so an install with nothing bound gets no row
   * rather than a failure, which is `wantsSummary`'s arrangement and [P2B]'s
   * dangling posture applied to a step.
   */
  role: 'fast',
};

/**
 * What the step decided, for the runner to record and dispatch.
 *
 * A list, from the first commit, with one element — [P9 §4]'s first of the three
 * things that keep the count judgement's deferral cheap. The later phase widens
 * the producer, not this type.
 */
export interface RenderReport {
  requests: readonly RenditionRequest[];
  /**
   * The resolved `image` binding these recipes were keyed on — [P9 §0.3]'s
   * item 2.
   *
   * ***On the report rather than resolved a second time at record creation.***
   * The digest already keys on this binding, so a record that learned its model
   * from anywhere else could name a model the key does not: `recordRenditions`
   * runs in a different method from the gate that resolved the role, and the
   * only way to be sure the two agree is for one of them to hand the answer to
   * the other.
   */
  binding: { connectionId: string; modelId: string };
  /** A backdrop resolved to one already paid for — [P9 §1.7]'s money row. */
  reused?: { renditionId: string; digest: string };
  /**
   * Why nothing was asked for. Absent when something was. `no-place` since
   * 2026-09-30: a backdrop with no place to be of is not asked for — see the
   * background branch.
   */
  held?: 'place-unchanged' | 'no-moment' | 'no-binding' | 'no-place';
}

export interface RenderContext {
  /** Whether this session illustrates, resolved from channel state by the runner. */
  illustration: 'off' | 'on-demand' | 'each-turn';
  /** Whether this session stages a backdrop at all. */
  backdrop: boolean;
  /**
   * The resolved `image` binding, and the capabilities of the connection
   * serving it.
   *
   * ***Resolved by the runner, which is the only place that can*** — the same
   * argument `SummariseContext.key` makes, and for the same two reasons. The
   * digest keys on the *resolved* binding ([P9 §0.3]'s item 2), and resolving a
   * role needs the account's bindings, the install defaults and the session's
   * overrides; a step has none of those and `StepHost` deliberately gives it no
   * way to learn which model answered. `resolveStepRole` exists because [P8.1]
   * needed exactly this, and *"a second copy of this layering would be a second
   * answer to which model is this."*
   */
  image: { binding: Binding; capabilities: ProviderCapabilities };
  /** The treatment's tone, read by the runner along with everything else lore. */
  tone: string | null;
  /**
   * Rendered channel values the two rankings draw on, in the mode's order.
   *
   * ***A thunk, read when the step runs*** (2026-09-30), `reusable`'s shape for
   * `reusable`'s reason: the value is not known when the plan is built. A list
   * rendered then was the state before this turn's steps, so the place the
   * stager wrote this turn — and a tracker's write — were a turn late in
   * every backdrop and illustration.
   */
  channels: () => readonly { id: string; text: string }[];
  /**
   * Generation parameters for the image call, minus the seed.
   *
   * The seed is the worker's: it is different on every generation and is
   * excluded from the digest, so a step that chose one would be choosing the one
   * value that must not be part of *what picture is this*.
   */
  workflow: Readonly<Record<string, string | number | boolean>>;
  /**
   * A backdrop already paid for with this digest, or null — [P9 §1.7].
   *
   * A thunk rather than a value, which is `ExtractContext.subjects`' shape and
   * its reason: the digest is not known until the fragments are assembled, which
   * happens inside `run`. A context built eagerly would have to guess.
   *
   * ***Or `'in-flight'`, when one is being made*** (2026-09-30). Only a ready
   * one could answer, so every turn taken while a place's first backdrop was
   * still being drawn asked for another of the same place — and, being a
   * background of its own, it made the first give way when that one landed:
   * paid for twice, and the first never shown. A slow image model and a quick
   * narrator make that most turns of a new place.
   */
  reusable: (digest: string) => { renditionId: string } | 'in-flight' | null;
  report: (report: RenderReport) => void;
}

/**
 * ***What the moment call asks for, and what it must not do.***
 *
 * **Not the whole prompt.** [06 §10.3] names Aventuras' version as the failure:
 * its call writes the entire prompt and concatenates a style suffix afterwards,
 * *"so the result routinely overruns the character limit its own system prompt
 * spends four lines insisting on — and nothing downstream checks."* Ranked
 * fragments are what make a cap true, because the cap applies to the assembled
 * whole and the ranking decides what goes. **The model is told its budget and
 * writes within it; the assembler is what makes the budget real.**
 *
 * **No names.** The same rule the assembler enforces mechanically, said to the
 * model as well — not because the model is trusted with it, but because a model
 * told to describe a picture will otherwise name the person it is describing,
 * and the fragment would then contain a name the assembler has no way to find.
 *
 * ***The anchor is the second half of the answer and not a second call.*** §10.4a
 * wants *"a verbatim quote from the message's own text"* — three to fifteen
 * words, copied exactly — and asking for it here is what makes it free. A
 * separate call would be a second reading of the same prose, and §10.3's
 * *written once, replayed* would then be true of one field and false of the
 * other.
 */
export const MOMENT_PROMPT = (budget: number | null): string =>
  [
    'You are choosing one image to illustrate a moment from this passage.',
    '',
    'Answer with two things.',
    '`subject`: what the picture shows — the scene, the action, the light.',
    budget === null
      ? 'Keep it to one short line.'
      : `Keep it under ${String(budget)} characters; it is one part of a longer prompt.`,
    'Describe people by appearance only. Never use a name: the image model does not know who anyone is.',
    '`anchor`: a phrase of three to fifteen words copied EXACTLY from the passage,',
    'naming the sentence the picture belongs beside.',
    '',
    'If nothing in the passage is worth a picture, answer with an empty subject.',
  ].join('\n');

const MOMENT_SCHEMA = {
  type: 'object',
  properties: {
    subject: { type: 'string', maxLength: 600 },
    anchor: { type: 'string', maxLength: 200 },
  },
  required: ['subject'],
  additionalProperties: false,
};

/**
 * The step as the runner appends it.
 *
 * Returns `{}`: this contributes no candidates and proposes no effects. What it
 * produces reaches the record and the dispatcher through `context.report`.
 */
export function render(context: RenderContext): {
  definition: StepDefinition;
  run: StepImplementation;
} {
  return {
    definition: RENDER_STEP,
    run: async (input: StepInput, host: StepHost) => {
      const requests: RenditionRequest[] = [];
      let reused: { renditionId: string; digest: string } | undefined;
      let held: RenderReport['held'];

      /**
       * ***The backdrop first, because it is the branch that can answer without
       * a call.*** Doing it second would mean paying for a moment on a turn
       * whose only rendition turns out to be a reused backdrop — which is the
       * bill §1.7's digest exists to keep down, spent one level up.
       */
      /**
       * ***A backdrop with no place is held*** (2026-09-30). Its recipe is the
       * place and the tone, and with no place it was the tone alone — a
       * picture of a mood, paid for and then reused by every later turn,
       * since the recipe never changed. Every first turn of a session whose
       * story names no place yet reached it, and so did every turn of one
       * where nothing writes the place.
       */
      const channels = context.channels();
      if (context.backdrop && placeOf(channels) === undefined) {
        held = 'no-place';
      } else if (context.backdrop) {
        const prompt = assemble('background', context, channels, [], '');
        const digest = recipeDigest(context.image.binding, prompt, context.workflow);
        const already = context.reusable(digest);
        if (already === 'in-flight') {
          // Asked for already, and selected by the worker when it lands.
          held = 'place-unchanged';
        } else if (already !== null) {
          reused = { renditionId: already.renditionId, digest };
          held = 'place-unchanged';
        } else {
          requests.push(request('background', prompt, digest, null, await seedFor(host), context));
        }
      }

      if (context.illustration === 'each-turn') {
        const prose = input.output?.text ?? '';
        if (prose.trim() === '') {
          held ??= 'no-moment';
        } else {
          /**
           * ***Who is in the room, and nobody's name*** (2026-09-30) — [06 §8.1],
           * [06 §10.3]. The whole cast was drawn, the dead and the departed and
           * the muted with it, and a name the moment call or a tracker's line
           * wrote reached the image model as written. The host says who is out
           * of the room (`StepCastMember.present`); every name becomes *someone*
           * (`withoutNames`); and the moment is told the room the rest leaves it
           * (`roomForMoment`) rather than the whole budget.
           */
          const everyone = input.cast ?? [];
          const drawn = everyone.filter((member) => member.present !== false);
          const named = channels.map((one) => ({ ...one, text: withoutNames(one.text, everyone) }));
          const room = roomForMoment(
            context.image.capabilities,
            illustrationFragments({ moment: '', cast: drawn, channels: named, tone: context.tone }),
          );
          const moment = await askForMoment(host, prose, room);
          if (moment.subject === '') {
            /**
             * **The empty list is a real answer** — [06 §10.4]. A model saying
             * *nothing here is worth a picture* is a judgement this phase is
             * allowed to accept even though the judgement that would make a
             * habit of it is deferred, and recording it as `no-moment` is what
             * keeps it distinguishable from the step never having run.
             */
            held ??= 'no-moment';
          } else {
            const prompt = assemble(
              'illustration',
              context,
              named,
              drawn,
              withoutNames(moment.subject, everyone),
            );
            const digest = recipeDigest(context.image.binding, prompt, context.workflow);
            requests.push(
              request('illustration', prompt, digest, moment.anchor, await seedFor(host), context),
            );
          }
        }
      }

      context.report({
        requests,
        binding: context.image.binding,
        ...(reused === undefined ? {} : { reused }),
        ...(requests.length === 0 && held !== undefined ? { held } : {}),
      });
      return {};
    },
  };
}

/**
 * Fragments to a recipe, for one purpose.
 *
 * ***The backdrop branch is handed an empty cast and an empty moment, and that
 * is the subset §10.3 specifies rather than a shortcut.*** *"A background takes
 * a different subset of the same list… without the turn's output text, without
 * the present actors' descriptors, and — the sharpened version of the same
 * sentence — without the moment call."* Passing the two absences in here, at one
 * call site, is what keeps the two branches one assembly path: the builders in
 * `renditions/assemble.ts` differ in ranking, and this differs in what it hands
 * them.
 */
function assemble(
  purpose: 'illustration' | 'background',
  context: RenderContext,
  channels: readonly { id: string; text: string }[],
  cast: FragmentInputs['cast'],
  moment: string,
): AssembledPrompt {
  const inputs: FragmentInputs = {
    moment,
    cast: purpose === 'background' ? [] : cast,
    channels,
    tone: context.tone,
  };
  return assemblePrompt(fragmentsFor(purpose, inputs), context.image.capabilities);
}

function request(
  purpose: 'illustration' | 'background',
  prompt: AssembledPrompt,
  digest: string,
  anchor: string | null,
  seed: number,
  context: RenderContext,
): RenditionRequest {
  const scope: RenditionScope | null =
    anchor === null || anchor.trim() === '' ? null : { anchor: anchor.trim() };
  return {
    kind: 'image',
    purpose,
    scope,
    prompt,
    workflow: context.workflow,
    seed,
    digest,
    // Always zero at 1.0 — [06 §10.4]'s judgement is [P9 §4]'s deferral, and
    // this is the field it will sort on when it arrives.
    ordering: 0,
  };
}

/**
 * ***The sampling seed, drawn through the engine's RNG and put on the tape.***
 *
 * [19 §14]'s rule, and the reason it applies to a thing that takes no part in
 * state reconstruction: the draw belongs to the **turn** that asked for the
 * picture, the tape is where this build records draws, and *"an unrecorded draw
 * does not fail here; it fails much later"*. A first draft had the worker call
 * `randomInt` on the argument that a rendition cannot make a branch reconstruct
 * wrong — which is true ([06 §10.2]) and was still the wrong conclusion, because
 * an exemption argued from *this one cannot hurt* is how the rule stops being
 * one. The lint rule is what caught it.
 *
 * *One site, two purposes*, so a turn that asks for both a backdrop and an
 * illustration draws twice and the tape says which was which.
 */
async function seedFor(host: StepHost): Promise<number> {
  return await host.random.at(SE_RENDER, 'seed').int(0, 2_147_483_647);
}

/** The turn's side of {@link momentCall} — the host makes it, this reads it. */
async function askForMoment(
  host: StepHost,
  prose: string,
  room: number | null,
): Promise<{ subject: string; anchor: string | null }> {
  return readMoment((await host.call(momentCall(prose, room))).object);
}

/**
 * The moment call, as a request rather than as a dispatch — [P9.4].
 *
 * ***Exported so the hand-pressed **Illustrate** is the same call and not a
 * second one.*** [06 §10.6] says the manual action is *"the same step invoked by
 * hand"*, and the only way to mean that when one caller is inside a turn and the
 * other is a route is for the *request* to be the shared thing: `host.call`
 * makes this one on the turn, `performCall` makes it from `renditions/illustrate.ts`,
 * and neither can drift on the prompt, the schema or the budget.
 *
 * ~~`capabilities` is the **image** provider's, which is what makes the budget
 * honest: what the model is told to write within is the room the assembler will
 * actually have, not the room the text model has.~~ *`room` since 2026-09-30*:
 * the image provider's budget less what the rest of the prompt takes
 * (`roomForMoment`), because the whole budget was what the moment wrote to and
 * the capper then gave up everything else to keep it. *The schema keeps its
 * generous bound on purpose*: tight to the room, a slightly long answer would
 * fail it, be asked for twice more and come back as no picture — and the
 * assembler caps the prompt whatever the model writes.
 */
export function momentCall(
  prose: string,
  room: number | null,
): { candidates: Candidate[]; schema: typeof MOMENT_SCHEMA } {
  return {
    candidates: [
      block('se.render.task', 'system', MOMENT_PROMPT(room)),
      block('se.render.turn', 'user', prose),
    ],
    schema: MOMENT_SCHEMA,
  };
}

/**
 * **Read defensively, because a refusal is a normal answer here** —
 * `readActions`' rule: the step is `warn`, so the worst available outcome is a
 * turn with no picture, which is the state every turn before this phase was in.
 */
export function readMoment(object: unknown): { subject: string; anchor: string | null } {
  if (typeof object !== 'object' || object === null) return { subject: '', anchor: null };
  const answer = object as { subject?: unknown; anchor?: unknown };
  const subject = typeof answer.subject === 'string' ? answer.subject.trim() : '';
  const anchor = typeof answer.anchor === 'string' ? answer.anchor.trim() : '';
  return { subject, anchor: anchor === '' ? null : anchor };
}

/**
 * *A local helper, like the judge's, the selector's, the suggester's and the
 * summariser's.* The fifth, and the repetition is still deliberate: what would
 * be shared is a `reason` string, which is author-facing English about **this**
 * step and is the one part that must not be.
 */
function block(id: string, role: 'system' | 'user', text: string): Candidate {
  return {
    id,
    source: { kind: 'step', stepId: SE_RENDER },
    reason: 'what the picture is of',
    role,
    text,
    required: true,
  };
}
