// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type {
  CastEntry,
  Candidate,
  StepDefinition,
  StepHost,
  StepInput,
  StepResult,
} from '@storyengine/sdk';

/**
 * Who is wearing what, and where this is — [06 §7.2]'s *expression selection*,
 * built at [P7.12](../../../../docs/design/workplan/23-p7-implementation.md).
 *
 * ***A step in the mode package, which is the whole claim.*** §7.2 says
 * *"sprites, backgrounds and expression selection are steps writing to
 * channels"*, and the interesting word is **steps**: this could have been
 * engine code beside the goal judge and the suggester, and it is not. It is
 * declared by Scene, implemented by Scene, and reads nothing the contract does
 * not hand it — which is the difference between a mode having a feature and the
 * engine having one on a mode's behalf.
 *
 * *It found a gap on the way.* A step could not see an actor's expression set
 * at all: `speakers` carries ids, `StepHost` has no library reader until
 * [22 §4]'s capability API, and being handed the cast by the engine would have
 * been the back door [06 §2] refuses. So `StepInput.cast` exists now, gated by
 * `reads: ['cast']` — the contract widening rather than the workaround, which is
 * what [P7] is for.
 *
 * ***What it writes, and why neither channel needed a policy change.***
 * `se.expression` and `se.location` are both `model-proposed`, because both are
 * judgements about prose — *is she angry*, *are we still in the office* — and a
 * model is what judges. `refuse()` has no branch for that policy, so the step
 * proposes and the effect applies, stamped with the call it was judged in.
 *
 * **`se.backdrop` is deliberately not written here.** It is `engine-computed`
 * and [P9] fills it: §7.2's three things have three different writers, which is
 * why the section reads like it forces [25 C16] and does not.
 */

export const SE_SCENE_STAGE = 'se.scene.stage';

export const STAGE_STEP: StepDefinition = {
  id: SE_SCENE_STAGE,
  stage: 'post',
  /**
   * `output` for the prose it judges, `cast` for who is in it, and `se.staging`
   * for whether it should be doing any of this. **Not `history`**: a face is
   * about the moment, and a step that read twenty turns to choose one would be
   * paying for context to answer a question the last paragraph already answers.
   *
   * ***The toggle is a declared read rather than a constructor argument***, and
   * that is forced rather than chosen — see {@link staging} on why this step
   * gates itself where [P7.9]'s suggester was gated by the runner.
   *
   * ***And `se.backdrop.on`*** (2026-09-30): this step is the only writer of the
   * place, and the backdrop is drawn from the place, so *Stage a backdrop* on
   * its own is a reason to ask where the scene is.
   */
  reads: ['output', 'cast', 'se.staging', 'se.backdrop.on'],
  writes: ['se.expression', 'se.location'],
  callKind: 'stage',
  when: { when: 'cadence', everyNTurns: 1 },
  /**
   * **`warn`, never `abort`.** The prose exists by the time a `post` step runs,
   * and a turn thrown away because a picture could not be chosen would be the
   * scenery deciding whether the scene happened.
   */
  failure: 'warn',
  /**
   * `prose`, for [25 C15]'s reason: nothing in this build binds any role but
   * this one, so asking for `fast` would make every staged session log a failed
   * step. An install that wants something cheaper says so through `stepRoles`.
   */
  role: 'prose',
};

/**
 * What the model is asked, and the two things it is told not to do.
 *
 * *A face is a reading of the prose and never an invention.* An expression the
 * scene does not support is worse than no expression — [10 §13.1] makes the
 * same point about a tentative match that looks certain — so the instruction is
 * to leave somebody out rather than guess at them.
 *
 * ***And a place is a place, not a moment.*** [06 §10.1a] is explicit that a
 * backdrop *"will put the fight in the wallpaper and then stay there for thirty
 * turns"* if it is drawn from the action, and `se.location` is what [P9] diffs
 * to decide whether to redraw. So the instruction asks for where the scene is,
 * and says in as many words that what is happening is not part of the answer.
 *
 * ***In two halves since 2026-09-30***, because the place is asked without the
 * faces whenever nobody present has a face to choose — the common case — and a
 * question about people who are not in the prompt would be a question the
 * model answers by inventing them.
 */
const FACES_TASK = [
  'For each numbered person, choose the expression that best matches how they',
  'are in this passage — only from the list offered for them, and only if the',
  'passage actually shows it. Answer by their number. Leave somebody out rather',
  'than guess.',
].join('\n');

const PLACE_TASK = [
  'For the place: name where the scene is happening, in a few words — a room, a',
  'street, a kind of building. This is a PLACE and not an EVENT: "the',
  'harbourmaster\'s office", never "an argument in the office". Leave it out if',
  'the passage does not say.',
].join('\n');

function taskFor(faces: boolean): string {
  return faces
    ? ['Read the passage and answer two questions about it.', '', FACES_TASK, '', PLACE_TASK].join(
        '\n',
      )
    : ['Read the passage and answer one question about it.', '', PLACE_TASK].join('\n');
}

/**
 * Whether this session wants staging at all — [06 §7.2]'s text-only rule, read
 * from the channel that holds it.
 *
 * *Absent reads as `false`*, which restates {@link STAGING_CHANNEL}'s `init`
 * and is the one place in this package that has to: a mode cannot reach the
 * engine's `initialValue`, and the alternative — assuming the payload always
 * carries the key — would turn a filtered read into a crash.
 */
function staged(channels: StepInput['channels']): boolean {
  return channels['se.staging']?.value === true;
}

/** Whether this session draws a backdrop — `se.backdrop.on`, absent as off. */
function backdropOn(channels: StepInput['channels']): boolean {
  return channels['se.backdrop.on']?.value === true;
}

/**
 * Everyone in the room with a face to choose from, and the labels to choose
 * between.
 *
 * ***In the room*** since 2026-09-30: a muted member is out of the scene by the
 * mode's own reading of presence, which the host says on the entry
 * (`CastEntry.present`) — the reading the plot and the trackers already take —
 * and a face chosen for somebody who is not there is a face nobody sees.
 */
function withFaces(cast: readonly CastEntry[]): CastEntry[] {
  return cast.filter(
    (member) =>
      member.present !== false &&
      member.media.some((one) => one.role === 'expression' && one.label !== undefined),
  );
}

function facesOf(member: CastEntry): { id: string; label: string }[] {
  return member.media
    .filter((one) => one.role === 'expression' && one.label !== undefined)
    .map((one) => ({ id: one.id, label: one.label ?? '' }));
}

/**
 * The step, and the one place this design differs from the suggester it is
 * otherwise modelled on.
 *
 * ***[P7.9]'s toggle keeps its step out of the plan; this one cannot.*** The
 * runner builds the suggester, so it can read the session's toggle and simply
 * not append it — and `runner.ts` argues for that at length: *"a suggestion step
 * nobody asked for has nothing to report… an `ok` row contributing nothing on
 * every turn of every session in the build."* Every word of that applies here,
 * and the mechanism does not: `planFor` zips **every** step a mode declares, and
 * a mode has no way to say *not this turn*. `StepCondition` is the obvious place
 * for it and is a **closed set of three arms** by explicit design — its own
 * docstring refuses a fourth for an `always` that would be less than this — so
 * widening it to make one mode tidier would be reversing a stated decision to
 * save a log row.
 *
 * **So the gate is here, the cost is an `ok` row on a text-only session's every
 * turn, and the asymmetry is recorded rather than papered over** — [25 C17]. It
 * is the honest shape of what P7 found: the engine can keep its own steps out of
 * a plan and a mode cannot keep its own out, which is a difference between
 * built-in and declared that [22 §4.1] says should not exist.
 *
 * *The early return is genuinely free either way*: no call, no effects, no
 * channel read beyond the ~~one boolean~~ two booleans (the second since
 * 2026-09-30: *Stage a backdrop* asks for the place on its own).
 */
export async function stage(input: StepInput, host: StepHost): Promise<StepResult> {
  const prose = input.output?.text ?? '';
  const cast = staged(input.channels) ? withFaces(input.cast ?? []) : [];

  /**
   * ***Two questions, each asked only when something will use the answer, and
   * none of the gates costs a call.*** Faces are for a staged session with
   * somebody present who has a face to choose from. The place is for a staged
   * session or one that draws a backdrop — ~~and nobody with a face is a
   * session whose characters came from a card with no expression set, which is
   * most of them. A step that asked anyway would spend a model call to be told
   * nothing.~~ *Corrected 2026-09-30:* that gate stood in front of the place
   * too, and this step is the place's only writer, so in the common case — no
   * sprites, or staging left off with *Stage a backdrop* on — the place was
   * never written and the backdrop was drawn from the tone alone, once, for
   * the whole session. No prose is a turn that failed upstream.
   */
  const asksPlace = staged(input.channels) || backdropOn(input.channels);
  if (prose.trim() === '' || (!asksPlace && cast.length === 0)) return {};

  const result = await host.call({
    candidates: [
      block('se.scene.stage.task', 'system', taskFor(cast.length > 0)),
      ...(cast.length === 0 ? [] : [block('se.scene.stage.cast', 'system', rosterOf(cast))]),
      block('se.scene.stage.turn', 'user', prose),
    ],
    schema: schemaFor(cast),
  });

  const answer = readAnswer(result.object, cast);

  const effects = [];
  for (const [actorId, mediaId] of Object.entries(answer.faces)) {
    const member = cast.find((one) => one.actorId === actorId);
    if (member === undefined) continue;
    effects.push({
      channelId: 'se.expression',
      scopeKey: actorId,
      op: { type: 'set' as const, path: '/' },
      after: { from: 'authored', kind: member.kind, objectId: actorId, mediaId },
      /**
       * ***Stamped `model`, because a model judged it.*** The step is the
       * plumbing and the judgement is the call's — the same attribution
       * [P7.6]'s goal achievement makes, and the reason `model-proposed`
       * means anything.
       */
      proposedBy: { kind: 'model' as const, callId: result.callId },
    });
  }

  if (answer.place !== null) {
    effects.push({
      channelId: 'se.location',
      op: { type: 'set' as const, path: '/' },
      after: answer.place,
      proposedBy: { kind: 'model' as const, callId: result.callId },
    });
  }

  return effects.length === 0 ? {} : { effects };
}

/**
 * Who is present, and what each of them may be wearing — **numbered**.
 *
 * ***By number, and answered by number*** (2026-09-30). The roster named
 * people and the schema keyed their faces by actor id, which nothing in the
 * prompt tied to a name: two members sharing one expression set — the standard
 * pack most imported sprites carry — could have their faces swapped and pass,
 * and a reply keyed by name, the natural reading of the roster, failed the
 * schema, was asked twice more, and lost the place with it. A number is in the
 * prompt beside the name, and it is not a uuid to copy.
 */
function rosterOf(cast: readonly CastEntry[]): string {
  return cast
    .map(
      (member, at) =>
        `${String(at + 1)}. ${member.name}: ${facesOf(member)
          .map((one) => one.label)
          .join(', ')}`,
    )
    .join('\n');
}

/**
 * The shape the answer has to take.
 *
 * **Each person's expression is an enum of their own labels**, which is what
 * makes *only from the list offered* structural rather than an instruction —
 * a model that names a face somebody does not have fails the schema rather than
 * writing a channel value nothing can resolve.
 *
 * ***Keys nobody asked for are allowed, and ignored*** (2026-09-30), at both
 * levels. Refused, a face keyed by name — the natural reading of a roster of
 * names — failed the whole answer, which was asked for twice more and then
 * dropped with the place beside it; now it costs that face. And *leave it out*
 * may be written `null`, which the place's own instruction invites.
 */
function schemaFor(cast: readonly CastEntry[]): Record<string, unknown> {
  const properties: Record<string, unknown> = {
    place: { type: ['string', 'null'], maxLength: 120 },
  };
  if (cast.length > 0) {
    const faces: Record<string, unknown> = {};
    cast.forEach((member, at) => {
      faces[String(at + 1)] = {
        type: 'string',
        enum: facesOf(member).map((one) => one.label),
      };
    });
    properties['faces'] = { type: 'object', properties: faces };
  }
  return { type: 'object', properties };
}

/**
 * **Read defensively, because a refusal is a normal answer.** The step is
 * `warn`, the session has a text-only configuration it can fall back to, and a
 * malformed answer must cost a picture rather than a turn.
 *
 * *Labels resolve to media ids here rather than in the prompt*, because a model
 * asked to return an id would be asked to copy a uuid, which is the request
 * most likely to come back wrong — and *numbers resolve to people here*, for
 * the same reason.
 */
function readAnswer(
  object: unknown,
  cast: readonly CastEntry[],
): { faces: Record<string, string>; place: string | null } {
  const faces: Record<string, string> = {};
  if (typeof object !== 'object' || object === null) return { faces, place: null };

  const given = (object as { faces?: unknown }).faces;
  if (typeof given === 'object' && given !== null) {
    cast.forEach((member, at) => {
      const label = (given as Record<string, unknown>)[String(at + 1)];
      if (typeof label !== 'string') return;
      const face = facesOf(member).find((one) => one.label === label);
      if (face !== undefined) faces[member.actorId] = face.id;
    });
  }

  const place = (object as { place?: unknown }).place;
  return {
    faces,
    place: typeof place === 'string' && place.trim() !== '' ? place.trim() : null,
  };
}

/** A candidate of this step's own, the way every engine-owned step builds one. */
function block(id: string, role: 'system' | 'user', text: string): Candidate {
  return {
    id,
    source: { kind: 'step', stepId: SE_SCENE_STAGE },
    reason: 'staging',
    role,
    text,
    required: true,
  };
}
