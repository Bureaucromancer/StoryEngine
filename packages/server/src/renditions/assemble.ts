// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { StepCastMember } from '@storyengine/sdk';
import {
  literalSpans,
  type AssembledPrompt,
  type RecordedFragment,
  type RenditionPurpose,
} from '@storyengine/shared';

import { budgetFor, capPrompt, type PromptFragment } from '../providers/prompt-caps.js';
import type { ProviderCapabilities } from '../providers/types.js';

/**
 * Where an image prompt comes from —
 * [06 §10.3](../../../../docs/design/06-modes-and-turn-pipeline.md),
 * [20 §5.3](../../../../docs/design/20-tech-stack.md), [P9.1].
 *
 * ***This module is `providers/prompt-caps.ts`'s first caller, two phases after
 * that file was written.*** [P9 §0.1]'s finding 6 is that the ranked-fragment
 * capper is *"already written, already tested, and called by nothing"* — 156
 * lines of exactly this phase's work, whose docstring already states the
 * property this module would otherwise have had to argue for: **the cap is an
 * input to generation, not a guillotine at send.** So the work here is ranking
 * and calling, not capping.
 *
 * ***One fragment set, two orderings, one cap.*** [P9 §1.7] is explicit that the
 * background branch is *"not a second assembly path — the same step under the
 * same cap, ranking channel state and tone up and the turn's output text and
 * actor descriptors out"*, and names the failure mode for getting it wrong: *"a
 * second assembly path written in P9.4 under pressure to show a backdrop is how
 * it stops being one."* Two exported builders and one {@link assemblePrompt} is
 * that sentence as a module shape.
 *
 * **What is deliberately absent is any image.** [06 §10.1a]'s *text in, images
 * out*: a background prompt is built from channel state as **text**, never by
 * conditioning on a location's `reference` picture. That is lore-conditioned
 * renditions, deferred past 1.0 by [25 §3](../../../../docs/design/25-roadmap.md)
 * — and §1.7 names this exact file as where somebody will be tempted, because
 * *"a backdrop of a place is the most plausible excuse anyone will ever have to
 * cross that line: the location entry is right there, it has exactly one
 * `reference` image, and the selector problem looks solved for this one case. It
 * is not solved; it is absent."*
 */

/**
 * What the two builders are handed, resolved by the runner.
 *
 * **The treatment's tone reaches a step through its context rather than through
 * `StepInput`**, which is `hookSelector`'s arrangement and for its reason: the
 * payload filter is a vocabulary of *sources a step might not be entitled to*
 * ([23 §3.1]), and a widening of it for one consumer is a pseudo-source the
 * whole contract then carries. What the runner already read, the runner passes.
 */
export interface FragmentInputs {
  /** The turn's finished prose. Empty for a background, which never reads it. */
  moment: string;
  /** Who is in the scene, with their descriptors — `reads: ['cast']`. */
  cast: readonly StepCastMember[];
  /** Rendered channel values, keyed by channel id, in the mode's own order. */
  channels: readonly { id: string; text: string }[];
  /** The treatment's `tone`, and any style profile beside it. */
  tone: string | null;
}

/**
 * ***Ranks are given up lowest first, so a higher number survives longer.***
 * `capPrompt`'s own rule, restated here because these constants are read as
 * priorities and the arithmetic runs the other way.
 *
 * The ordering is [20 §5.3]'s list — *subject, style, quality tags, character
 * reference, negative* — with the subject named by [06 §10.3] as the moment.
 */
const ILLUSTRATION_RANKS = { moment: 100, actors: 80, tone: 60, place: 40, channels: 20 } as const;

/**
 * **The same fragments, ranked for a place rather than for a moment.**
 *
 * Not an optimisation and not a variant: §10.3's *"a background takes a
 * different subset of the same list, and the difference is the point"*. What
 * belongs in a backdrop and what belongs in an illustration are different
 * questions asked of one turn.
 */
const BACKDROP_RANKS = { place: 100, tone: 80 } as const;

/**
 * The fragments of an illustration — [06 §10.3]'s four.
 *
 * **The moment is `required`**, which is what `capPrompt`'s flag is for: a
 * prompt with everything but its subject is a prompt for nothing, so the capper
 * reports `overCap` rather than quietly cutting it. §10.3 calls the moment *the
 * subject*, and [20 §5.3]'s list opens with the same word.
 */
export function illustrationFragments(inputs: FragmentInputs): PromptFragment[] {
  const fragments: PromptFragment[] = [];

  const moment = inputs.moment.trim();
  if (moment !== '') {
    fragments.push({
      id: 'moment',
      text: moment,
      rank: ILLUSTRATION_RANKS.moment,
      required: true,
    });
  }

  const actors = describeCast(inputs.cast);
  if (actors !== '') {
    fragments.push({ id: 'actors', text: actors, rank: ILLUSTRATION_RANKS.actors });
  }

  if (inputs.tone !== null && inputs.tone.trim() !== '') {
    fragments.push({ id: 'tone', text: inputs.tone.trim(), rank: ILLUSTRATION_RANKS.tone });
  }

  pushChannels(fragments, inputs.channels, ILLUSTRATION_RANKS.place, ILLUSTRATION_RANKS.channels);
  return fragments;
}

/**
 * The fragments of a backdrop — [06 §10.1a], [06 §10.3]'s background branch.
 *
 * ***Three things are absent and each absence is the design.*** No **moment**,
 * because a backdrop is a place and a place has no moment — which is also why
 * this branch makes no model call at all. No **output text**, for the same
 * reason one level down: what happened in the room is not what the room looks
 * like. And no **actor descriptors**, because a backdrop is staged *behind* the
 * cast rather than of them, and putting three people into it is how a backdrop
 * becomes an illustration that will not go away.
 *
 * **The place is `required`** for the reason the moment is: a backdrop prompt
 * that lost its location is a prompt for a mood.
 *
 * ***A fourth absence, found by the test that asserts the money row***
 * (2026-09-16). [06 §10.1a] describes the background branch as taking *"channel
 * state and the treatment's tone"*, and a first draft read that literally: every
 * rendered channel, with the location lifted to the top. **That makes a backdrop
 * regenerate every turn**, because Scene's clock renders to the minute
 * (`Day 1, 09:15`) and every turn advances it — so the recipe changes whether or
 * not the place did, the digest never matches, and the reuse lookup becomes a
 * function that always misses.
 *
 * Which is exactly the failure [06 §10.6] names: *"a backdrop that regenerates
 * each turn is the failure mode rather than the thorough option."* And the
 * sentence that decides it is §10.6's other one — **a backdrop generates *when
 * the place changes*** — so the recipe has to be over what describes the
 * **place**, and a minute-precision clock describes a *moment*.
 *
 * ***So the backdrop's recipe is the place and the tone, and the gap is named
 * rather than papered over***: nothing in the channel contract says which
 * channels describe a place and which describe a moment. A mode that tracks
 * weather has something a backdrop genuinely wants and no way to say so. That is
 * a widening for whoever needs it — a flag on `ChannelDefinition`, or a
 * declaration on the mode — and inventing one here for a feature with one
 * consumer would be guessing at a vocabulary. What ships is the version whose
 * cost is one image per place, which is what §1.7's digest exists to buy.
 */
export function backdropFragments(inputs: FragmentInputs): PromptFragment[] {
  const fragments: PromptFragment[] = [];

  const place = placeOf(inputs.channels);
  if (place !== undefined) {
    fragments.push({
      id: 'place',
      text: place.text.trim(),
      rank: BACKDROP_RANKS.place,
      required: true,
    });
  }

  if (inputs.tone !== null && inputs.tone.trim() !== '') {
    fragments.push({ id: 'tone', text: inputs.tone.trim(), rank: BACKDROP_RANKS.tone });
  }

  return fragments;
}

/**
 * Ranked fragments to a stored recipe — {@link capPrompt}, plus what it ran over.
 *
 * ***The three things this adds to `CappedPrompt` are what make the recipe
 * re-runnable***: `fragments` (the input the cap ran over), `separator` (what it
 * joined with), and a `budget` in a shape that survives JSON. [22 §7] states the
 * property they buy: **`capPrompt(fragments, budget, separator).text === text`,
 * for every rendition, forever.**
 *
 * `budget` is `number | null` here where `PromptBudget` is `number | undefined`,
 * because `undefined` does not survive `JSON.stringify` — a stored recipe whose
 * budget came back as an absent key would re-cap under *no* budget and produce a
 * longer prompt than the one that was sent. One conversion, in one place.
 */
export function assemblePrompt(
  fragments: readonly PromptFragment[],
  capabilities: ProviderCapabilities,
  separator = ', ',
): AssembledPrompt {
  const budget = budgetFor(capabilities);
  const capped = capPrompt([...fragments], budget, separator);

  return {
    fragments: fragments.map((fragment): RecordedFragment => ({
      id: fragment.id,
      text: fragment.text,
      rank: fragment.rank,
      ...(fragment.required === undefined ? {} : { required: fragment.required }),
    })),
    separator,
    budget: {
      maxChars: budget.maxChars ?? null,
      usefulChars: budget.usefulChars ?? null,
    },
    text: capped.text,
    kept: capped.kept,
    dropped: capped.dropped,
    overCap: capped.overCap,
  };
}

/**
 * ***Nobody's name, wherever the words came from*** (2026-09-30) — [06 §10.3]'s
 * first rule, *"a character's name never appears in an image prompt"*, applied
 * to the text this module did not write.
 *
 * {@link describeCast} keeps names out of what it builds, and the moment call
 * is *asked* to — and a model told to describe a picture names the person in
 * it anyway, so *Elena on the quay* reached the image model as written. So did
 * a tracker's line in the channels fragment. Every name in the cast — the
 * written-out and the muted too, since a moment can name anybody — becomes
 * *someone*, whole words and any case, longest first so a full name goes
 * before its first word. *Someone* rather than the person's descriptor: the
 * descriptors travel in the actors fragment already, and a figure is what an
 * image model can draw.
 */
export function withoutNames(text: string, cast: readonly { name: string }[]): string {
  const names = [...new Set(cast.map((one) => one.name.trim()).filter((name) => name !== ''))].sort(
    (left, right) => right.length - left.length,
  );
  let out = text;
  for (const name of names) {
    const spans = literalSpans(out, name, { wholeWords: true, caseSensitive: false });
    for (const span of [...spans].reverse()) {
      out = `${out.slice(0, span.start)}someone${out.slice(span.end)}`;
    }
  }
  return out;
}

/**
 * ***How much of the budget the moment may take*** (2026-09-30), or `null` when
 * the image connection declares none.
 *
 * The moment call was told the whole budget, so a model that wrote to it left
 * no room: the moment is `required`, and the capper gave up every other
 * fragment — the cast's descriptors, the tone, the place — to keep it. So the
 * rest is measured first and the moment told what is left, *never less than a
 * third*, because a subject squeezed to a few words is a picture of nothing.
 */
export function roomForMoment(
  capabilities: ProviderCapabilities,
  rest: readonly PromptFragment[],
  separator = ', ',
): number | null {
  const budget = capabilities.usefulPromptChars ?? capabilities.maxPromptChars ?? null;
  if (budget === null) return null;
  const used = rest.reduce((sum, fragment) => sum + fragment.text.length + separator.length, 0);
  return Math.max(Math.floor(budget / 3), budget - used);
}

/** Which builder a purpose uses. One statement, so a caller cannot pick wrong. */
export function fragmentsFor(purpose: RenditionPurpose, inputs: FragmentInputs): PromptFragment[] {
  return purpose === 'background' ? backdropFragments(inputs) : illustrationFragments(inputs);
}

/**
 * The cast as an image prompt may describe them — **descriptors, never names**.
 *
 * [06 §10.3]'s first assembler rule, enforced here rather than asked of a model:
 * *"the image model does not know who Elena is; it knows what a woman with
 * cropped grey hair looks like."* `StepCastMember.name` is right there and is
 * deliberately not read — [04 §3] built `VisualDescriptors` *"precisely so the
 * substitution is mechanical"*, and a mechanical substitution is one that cannot
 * be forgotten under deadline.
 *
 * ***Somebody with no descriptors contributes nothing rather than their name.***
 * That is the rule at its hardest, and it is where an implementation would be
 * tempted to fall back: a card imported from a format with no structured
 * appearance has `visual: null`, and *"Elena"* in an image prompt is worse than
 * silence — it produces a stranger with confidence instead of an unspecified
 * figure.
 *
 * *§10.3's second rule — how many named characters one picture can hold — is a
 * provider capability and lands with the adapter, not here.* What this does is
 * refuse to write a name at all, which makes the count a question about
 * descriptors rather than about people.
 */
function describeCast(cast: readonly StepCastMember[]): string {
  return cast
    .map((entry) => describeOne(entry))
    .filter((described) => described !== '')
    .join('; ');
}

function describeOne(entry: StepCastMember): string {
  const visual = entry.visual;
  if (visual === undefined) return '';
  // The order is the schema's, which reads head to hem and is the order a person
  // describing somebody tends to use. Nothing downstream depends on it, but a
  // stable order is what lets the digest mean anything.
  return [
    visual.build,
    visual.hair,
    visual.eyes,
    visual.face,
    visual.clothing,
    visual.accessories,
    visual.distinguishing,
  ]
    .map((part) => part?.trim() ?? '')
    .filter((part) => part !== '')
    .join(', ');
}

/**
 * ***The place a backdrop would be of, or nothing*** — the one reading of *which
 * channel is the place* ({@link pushChannels} says why it is by name), shared
 * since 2026-09-30 with the two callers that hold a backdrop that has none:
 * the render step and **Set the scene**. A backdrop prompt with no place is a
 * prompt for a mood, and paying for one is what they now decline to do.
 */
export function placeOf(
  channels: readonly { id: string; text: string }[],
): { id: string; text: string } | undefined {
  const place = channels.find((channel) => channel.id.endsWith('.location'));
  return place === undefined || place.text.trim() === '' ? undefined : place;
}

/**
 * Channel state as fragments — the place first, then whatever else a mode tracks.
 *
 * **`se.location` is lifted out by name and nothing else is**, which is the one
 * place this module knows a channel id. It is not a mode coupling: a location is
 * *what a backdrop is of*, so the ranking has to be able to tell it from the
 * clock, and a mode that tracks no location simply contributes no `place`
 * fragment. Everything else lands as one fragment at the lower rank, in the
 * order the mode declared its channels, so an author's ordering decides what is
 * given up first among equals.
 *
 * `required` is passed only by the backdrop builder, for which a place is the
 * subject.
 */
function pushChannels(
  fragments: PromptFragment[],
  channels: readonly { id: string; text: string }[],
  placeRank: number,
  otherRank: number,
  placeRequired = false,
): void {
  const place = placeOf(channels);
  if (place !== undefined) {
    fragments.push({
      id: 'place',
      text: place.text.trim(),
      rank: placeRank,
      ...(placeRequired ? { required: true } : {}),
    });
  }

  const rest = channels
    .filter((channel) => channel !== place && channel.text.trim() !== '')
    .map((channel) => channel.text.trim());
  if (rest.length > 0) {
    fragments.push({ id: 'channels', text: rest.join(', '), rank: otherRank });
  }
}

/**
 * The treatment's tone as one line of an image prompt — [06 §10.3]'s fourth
 * fragment, [P9.1].
 *
 * ***Style, and not the whole of `TreatmentTone`.*** That object carries
 * `genres`, `moods`, `pov`, `tense`, `contentRating` and `styleNotes`, and only
 * the first two and the last describe how a picture should look: point of view
 * and tense are facts about **prose**, and handing *"second person, past tense"*
 * to an image model is the category error §10.3 opens by describing one size
 * larger.
 *
 * *`contentRating` is deliberately not read either.* [04 §6.2] makes it
 * advisory — *"nothing in the engine gates on it… because enforcement here would
 * be a promise that cannot be kept"* — and a rating spliced into an image prompt
 * would be exactly that promise, made to a model that cannot keep it.
 *
 * Returns null rather than an empty string when there is nothing to say, so the
 * fragment is **absent** rather than blank: a blank fragment would occupy a rank
 * and contribute a separator.
 */
export function toneOf(treatment: unknown): string | null {
  if (!isRecord(treatment)) return null;
  const tone = treatment['tone'];
  if (!isRecord(tone)) return null;

  // Read through `unknown` rather than through a declared shape, which is
  // `readSummary`'s rule and `originOf`'s: a treatment reaches here out of a
  // library file, and a `Treatment` annotation would make the checks below look
  // redundant to the compiler while doing the only work that matters.
  const words = [...listOfStrings(tone['genres']), ...listOfStrings(tone['moods'])];
  if (typeof tone['styleNotes'] === 'string') words.push(tone['styleNotes']);

  const kept = words.map((word) => word.trim()).filter((word) => word !== '');
  return kept.length === 0 ? null : kept.join(', ');
}

/** The strings in an unknown array, and nothing else in it. */
function listOfStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((one): one is string => typeof one === 'string') : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
