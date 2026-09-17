// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { Preset } from '@storyengine/sdk';

/**
 * Freeform's default prompt pack — [06 §1], [P7.9].
 *
 * ***Derived from Scene's and then diverged, which is the useful part.*** The
 * slot list is nearly identical, because the slots are the engine's vocabulary
 * and a second mode assembling prose wants the same ones — that is the contract
 * generalising rather than a copy. What differs is everything a mode is allowed
 * to have an opinion about, and it is worth listing because each one is a
 * declaration Scene could have made and did not:
 *
 * - **Four input blocks and four instruction blocks**, filtered by `appliesTo`.
 *   [13 §8.3] promised this and predicted it would cost nothing: *"a preset
 *   carries a different instruction block per kind with no new machinery, which
 *   is the `appliesTo` filter doing the job it was built for."* A `think` is
 *   wrapped as a thought and told not to be reacted to; a `story` is taken as
 *   having happened. **That is the entire implementation of the input-kind
 *   selector's prompt half** — no code, in a file an author can edit.
 * - **Two dial slots**, whose fragments are below. [06 §7.3.1] puts the levels
 *   here rather than in engine code so that *"someone who dislikes how 'hard'
 *   behaves can read the fragment that caused it and change it"*.
 * - **A narrator instruction about a story rather than a scene**, which is a
 *   one-word difference that is the difference between the two modes.
 *
 * *A code constant for the reason Scene's is*: a mode that depended on a
 * boot-time seeder would not relocate behind the SDK unchanged, and a session
 * gets its own copy either way.
 */

/** Fixed, so a golden snapshot over this object is reproducible. */
const STAMP = '2026-01-01T00:00:00.000Z';

export const FREEFORM_PRESET: Preset = {
  schema: 'storyengine.preset/0',
  id: '0199c000-0000-7000-8000-00000000f4ee',
  name: 'Freeform',
  blurb: '',
  modes: ['storyengine.freeform'],
  blocks: [
    {
      id: 'se.instruction',
      label: 'instruction',
      role: 'system',
      enabled: true,
      placement: {
        at: 'sequence',
      },
      priority: 90,
      appliesTo: [],
      advisory: false,
      omitWhenEmpty: true,
      kind: 'text',
      template:
        "You are the narrator of an ongoing story. Write what happens next in third person, past tense. Describe only what the player's character could perceive. Never write that character's own dialogue, thoughts or decisions, and never end by asking what they do.",
    },
    {
      id: 'se.treatment',
      label: 'treatment',
      role: 'system',
      enabled: true,
      placement: {
        at: 'sequence',
      },
      priority: 60,
      appliesTo: [],
      advisory: false,
      omitWhenEmpty: true,
      kind: 'slot',
      source: {
        of: 'treatment',
        part: 'framing',
      },
    },
    {
      id: 'se.persona',
      label: 'persona',
      role: 'system',
      enabled: true,
      placement: {
        at: 'sequence',
      },
      priority: 70,
      appliesTo: [],
      advisory: false,
      omitWhenEmpty: true,
      kind: 'slot',
      source: {
        of: 'persona',
      },
    },
    {
      id: 'se.actor.summary',
      label: 'actor.summary',
      role: 'system',
      enabled: true,
      placement: {
        at: 'sequence',
      },
      priority: 70,
      appliesTo: [],
      advisory: false,
      omitWhenEmpty: true,
      kind: 'slot',
      source: {
        of: 'actor',
        sectionId: 'se.summary',
      },
    },
    {
      id: 'se.actor.appearance',
      label: 'actor.appearance',
      role: 'system',
      enabled: true,
      placement: {
        at: 'sequence',
      },
      priority: 40,
      appliesTo: [],
      advisory: false,
      omitWhenEmpty: true,
      kind: 'slot',
      source: {
        of: 'actor',
        sectionId: 'se.appearance',
      },
    },
    {
      id: 'se.actor.voice',
      label: 'actor.voice',
      role: 'system',
      enabled: true,
      placement: {
        at: 'sequence',
      },
      priority: 40,
      appliesTo: [],
      advisory: false,
      omitWhenEmpty: true,
      kind: 'slot',
      source: {
        of: 'actor',
        sectionId: 'se.voice',
      },
    },
    {
      id: 'se.actor.traits',
      label: 'actor.traits',
      role: 'system',
      enabled: true,
      placement: {
        at: 'sequence',
      },
      priority: 35,
      appliesTo: [],
      advisory: false,
      omitWhenEmpty: true,
      kind: 'slot',
      source: {
        of: 'actor',
        field: 'traits',
      },
    },
    {
      id: 'se.actor.background',
      label: 'actor.background',
      role: 'system',
      enabled: true,
      placement: {
        at: 'sequence',
      },
      priority: 30,
      appliesTo: [],
      advisory: false,
      omitWhenEmpty: true,
      kind: 'slot',
      source: {
        of: 'actor',
        sectionId: 'se.background',
      },
    },
    {
      id: 'se.lore',
      label: 'lore',
      role: 'system',
      enabled: true,
      placement: {
        at: 'sequence',
      },
      priority: 25,
      appliesTo: [],
      advisory: false,
      omitWhenEmpty: true,
      kind: 'slot',
      source: {
        of: 'lore',
        phase: 'before',
      },
    },
    /**
     * Lore the entry asked to place *after* the character — [P6B.1], and the
     * defect [P5 §0.5] found: **this preset had one lore slot and lore has two
     * phases.**
     *
     * `placementOf` maps SillyTavern's `after_char` to `{ at: 'after' }` and
     * `collect.ts` fills an `after` placement only from an `after` slot, so
     * every entry at that position activated, was charged against its book's
     * `tokenBudget` and `entryLimit`, matched nothing, and was dropped without
     * a word — while the lore report still counted it kept. **ST positions 1,
     * 2, 3, 5 and 6 all import as `after_char`**, so the first imported book
     * lost the majority of its entries after they had spent the budget. A
     * hand-made book never showed it: `newLoreEntry` defaults to `before_char`.
     *
     * **Here rather than after the history splice.** The phase name is ST's
     * `after_char` — *after the character definitions* — and in that format both
     * phases sit before the conversation; only positions 2 through 6 go into
     * the chat, and those import as `at_depth` and reach the splice by another
     * road entirely. [P6B §1.4]'s lean said after the splice and was reasoning
     * from the English word rather than from `placementOf`; corrected here,
     * where the mapping is.
     *
     * Immediately after its sibling, so the two ST positions keep the order
     * their own format gives them. The priority is positional rather than
     * operative: lore blocks take the *first* enabled lore slot's priority
     * (`lorePriorityOf`), adjusted per block by trim rank, so this number ranks
     * nothing on its own and matches its sibling to say so.
     */
    {
      id: 'se.lore.after',
      label: 'lore (after)',
      role: 'system',
      enabled: true,
      placement: {
        at: 'sequence',
      },
      priority: 25,
      appliesTo: [],
      advisory: false,
      omitWhenEmpty: true,
      kind: 'slot',
      source: {
        of: 'lore',
        phase: 'after',
      },
    },
    /**
     * Writing samples — [04 §3.1].
     *
     * **Priority 20 puts it between history's floor and lore**, and the
     * arithmetic is worth stating because it is not obvious. History blocks are
     * emitted at `priority + index` over a 20-turn window, so this preset's
     * history occupies 10..29 rather than a single 10. A sample at 20 therefore
     * survives roughly the ten oldest turns falling out and drops before the ten
     * newest — which is the intended reading of "a nicety that improves voice":
     * losing it costs tone, never continuity.
     *
     * **Not advisory.** A sample is content a model may see on any call;
     * marking it advisory would bar it from every effects and verdict call
     * ([06 §6]), which is not what an exemplar is for.
     *
     * `from` is omitted, so it names every carrier. Only the actor arm produces
     * anything today; the block is positioned now so that P5 wiring the other
     * two is a change in what fills the slot rather than a change to the
     * preset — the same posture `se.lore` has held since P2.
     */
    {
      id: 'se.samples',
      label: 'writing samples',
      role: 'system',
      enabled: true,
      placement: {
        at: 'sequence',
      },
      priority: 20,
      appliesTo: [],
      advisory: false,
      omitWhenEmpty: true,
      kind: 'slot',
      source: {
        of: 'samples',
      },
    },
    /**
     * ***The story above the window*** — [07 §5.1](../../../../docs/design/07-branching.md),
     * [25 E1](../../../../docs/design/25-open-questions.md), added at
     * [P8.1](../../../../docs/design/workplan/25-p8-implementation.md).
     *
     * **The slot is where the standing line is discharged.** A chain nothing
     * positions is a chain nothing reads, and the engine never splices a block
     * of its own — so a summary reaches a prompt because a pack put it
     * somewhere, the same way the goal statement does.
     *
     * **Priority 8, just under history's floor, and the arithmetic is the
     * point.** Links are emitted at `priority + index` the way history turns
     * are, so on a four-hundred-turn session the chain occupies 8..26 against
     * history's 10..29. Read as a trim order that is what a reader would
     * choose: *the oldest summarised stretch goes first*, and **the most recent
     * stretch — the one that ends where the window begins — outranks the oldest
     * verbatim turns**, which is right, because those turns are already the
     * least valuable thing in the window.
     *
     * **Not advisory**, for the reason the samples block gives: a summary is
     * ordinary context a model may see on any call, and marking it advisory
     * would bar it from every effects and verdict call ([06 §6]) — which would
     * make a long session's judge blind to everything but the last twenty turns.
     */
    {
      id: 'se.summary',
      label: 'the story so far',
      role: 'system',
      enabled: true,
      placement: {
        at: 'sequence',
      },
      priority: 8,
      appliesTo: [],
      advisory: false,
      omitWhenEmpty: true,
      kind: 'slot',
      source: {
        of: 'summary',
      },
    },
    {
      id: 'se.history',
      label: 'history',
      role: 'system',
      enabled: true,
      placement: {
        at: 'sequence',
      },
      priority: 10,
      appliesTo: [],
      advisory: false,
      omitWhenEmpty: true,
      kind: 'slot',
      source: {
        of: 'history',
      },
    },
    /**
     * ***What the story is trying to do*** — [06 §7.3.3], [04 §8.2], added at
     * [P7.6](../../../../docs/design/workplan/23-p7-implementation.md).
     *
     * *"The goal statement is therefore always injected, and difficulty
     * fragments are written to reference it."* The slot kind has been in the
     * published preset schema since P2 with nothing filling it; the producer is
     * the session's own goal chain and the cursor over it.
     *
     * **In the pack rather than in engine code**, which is what *always
     * injected* has to mean in a build where assembly is a preset's job: a
     * statement the engine spliced in would be a block the block table could not
     * explain and an author could not move.
     *
     * *A high priority and above the guidance box*, because what the story is
     * for outranks an instruction about this turn of it — and `omitWhenEmpty`,
     * because a session with no goal is [04 §7.1]'s deliberate opt-out rather
     * than a heading with nothing under it.
     *
     * ***Scene declares no goals of its own and this is still Scene's pack.***
     * A `Goal` lives on a **Setup**, which is authored content ([06 §7.3.3]:
     * *"the condition belongs to whoever wrote the game rather than to the mode
     * running it"*), so any mode can be played toward one and the default pack
     * is where every mode's default assembly is written down.
     */
    {
      id: 'se.goal',
      label: 'goal',
      role: 'system',
      enabled: true,
      placement: {
        at: 'sequence',
      },
      priority: 75,
      appliesTo: [],
      advisory: false,
      omitWhenEmpty: true,
      kind: 'slot',
      wrapper: 'What you are working toward: {{content}}',
      source: {
        of: 'goal',
      },
    },
    {
      id: 'se.guidance',
      label: 'guidance',
      role: 'system',
      enabled: true,
      placement: {
        at: 'sequence',
      },
      priority: 80,
      appliesTo: [],
      advisory: true,
      omitWhenEmpty: true,
      kind: 'slot',
      source: {
        of: 'guidance',
      },
    },
    /**
     * The previous attempt a guided redo shows the model — [06 §5.1], [07 §7].
     *
     * **The first shipped block with a `wrapper`, and it needs one.** Bare,
     * the slot is a system message holding prose the model itself wrote, with
     * nothing to say what it is; the wrapper is the sentence that makes it a
     * discarded draft rather than a continuation. It is written to stand on
     * its own, because the schema does not couple `redoOf` to `guidance` and
     * an attempt can arrive without an instruction.
     *
     * **After `se.guidance`, not before it.** `render` merges adjacent
     * same-role blocks with a blank line and the guidance slot has no wrapper,
     * so attempt-then-guidance would hand a provider *…the attempt's last
     * paragraph* followed by *Keep it short.* — the instruction reading as the
     * last line of the prose it is about. This way round the wrapper's framing
     * sentence is the seam between the two.
     *
     * **Priority 50**, which is a position in the order of sacrifice rather
     * than a number: under pressure the attempt goes after every actor detail
     * section (30–40), the lore (25), the samples (20) and the whole history
     * run (10..29), and before the treatment (60), the persona (70) and the
     * instruction it exists to serve (80). A squeezed redo that forgot who the
     * character was but remembered the reply it is discarding would have the
     * order backwards, which is what 75 would have done. `mode.test.ts` pins
     * the relationship to guidance and leaves the number free.
     *
     * Advisory in the pack as well as forced by the collector — an author
     * reading the preset should see the claim, not just inherit it.
     */
    {
      id: 'se.attempt',
      label: 'previous attempt',
      role: 'system',
      enabled: true,
      placement: {
        at: 'sequence',
      },
      priority: 50,
      appliesTo: [],
      advisory: true,
      omitWhenEmpty: true,
      kind: 'slot',
      source: {
        of: 'attempt',
      },
      wrapper:
        'This is the previous attempt at this turn. The player asked for a different one — do not repeat it.\n\n{{content}}',
    },
    {
      id: 'se.difficulty',
      label: 'how much the world resists',
      role: 'system',
      enabled: true,
      placement: {
        at: 'sequence',
      },
      priority: 86,
      appliesTo: [],
      advisory: false,
      omitWhenEmpty: true,
      kind: 'slot',
      source: {
        of: 'difficulty',
      },
    },
    {
      id: 'se.directedness',
      label: 'how much you steer',
      role: 'system',
      enabled: true,
      placement: {
        at: 'sequence',
      },
      priority: 85,
      appliesTo: [],
      advisory: false,
      omitWhenEmpty: true,
      kind: 'slot',
      source: {
        of: 'directedness',
      },
    },
    {
      id: 'se.input.do',
      label: 'input (do)',
      role: 'user',
      enabled: true,
      placement: {
        at: 'sequence',
      },
      priority: 100,
      appliesTo: ['do'],
      advisory: false,
      omitWhenEmpty: true,
      kind: 'slot',
      source: {
        of: 'input',
      },
    },
    {
      id: 'se.instruction.do',
      label: 'how to treat a do',
      role: 'system',
      enabled: true,
      placement: {
        at: 'sequence',
      },
      priority: 89,
      appliesTo: ['do'],
      advisory: false,
      omitWhenEmpty: true,
      kind: 'text',
      template:
        'The player acts. Their attempt may fail, cost something, or work partially — but it is their attempt.',
    },
    {
      id: 'se.input.say',
      label: 'input (say)',
      role: 'user',
      enabled: true,
      placement: {
        at: 'sequence',
      },
      priority: 100,
      appliesTo: ['say'],
      advisory: false,
      omitWhenEmpty: true,
      kind: 'slot',
      source: {
        of: 'input',
      },
      wrapper: 'The player’s character says: “{{content}}”',
    },
    {
      id: 'se.instruction.say',
      label: 'how to treat a say',
      role: 'system',
      enabled: true,
      placement: {
        at: 'sequence',
      },
      priority: 89,
      appliesTo: ['say'],
      advisory: false,
      omitWhenEmpty: true,
      kind: 'text',
      template: 'The player speaks. Write what their words land on, never what they meant.',
    },
    {
      id: 'se.input.think',
      label: 'input (think)',
      role: 'user',
      enabled: true,
      placement: {
        at: 'sequence',
      },
      priority: 100,
      appliesTo: ['think'],
      advisory: false,
      omitWhenEmpty: true,
      kind: 'slot',
      source: {
        of: 'input',
      },
      wrapper: 'The player’s character thinks: {{content}}',
    },
    {
      id: 'se.instruction.think',
      label: 'how to treat a think',
      role: 'system',
      enabled: true,
      placement: {
        at: 'sequence',
      },
      priority: 89,
      appliesTo: ['think'],
      advisory: false,
      omitWhenEmpty: true,
      kind: 'text',
      template: 'The player thinks. Nobody in the scene heard that. Nothing may react to it.',
    },
    {
      id: 'se.input.story',
      label: 'input (story)',
      role: 'user',
      enabled: true,
      placement: {
        at: 'sequence',
      },
      priority: 100,
      appliesTo: ['story'],
      advisory: false,
      omitWhenEmpty: true,
      kind: 'slot',
      source: {
        of: 'input',
      },
      wrapper: 'The player narrates: {{content}}',
    },
    {
      id: 'se.instruction.story',
      label: 'how to treat a story',
      role: 'system',
      enabled: true,
      placement: {
        at: 'sequence',
      },
      priority: 89,
      appliesTo: ['story'],
      advisory: false,
      omitWhenEmpty: true,
      kind: 'text',
      template:
        'The player is narrating rather than acting. Take what they wrote as having happened and continue from it — this is the one kind where they are writing the story with you rather than in it.',
    },
  ],
  budget: {
    contextShare: 0.75,
    maxContextTokens: null,
    reserveOutputTokens: 1024,
    sources: [],
  },
  params: {
    temperature: 0.85,
    maxTokens: 800,
  },
  modelHint: null,
  /**
   * ***The dials' prose, which is the pack's whole reason for holding it*** —
   * [06 §7.3.1]: *"The levels live in the prompt pack, not in engine code…
   * 'Hard' meaning something different in one prompt pack than another is a
   * feature."* Swap this preset and *harsh* means whatever the next one says.
   *
   * **Ranked, so [19 §5.3]'s cap drops the least important rather than cutting a
   * sentence**, and the floor [06 §7.3.1] requires is written into `harsh`
   * itself: *"Obstruction must not reach unreachability. Difficulty modulates
   * the cost and the route, never whether the goal can be attained at all."*
   * Engine code cannot enforce a claim about prose; what it can do is be a pack
   * that makes it, in a sentence a reader can find and change.
   */
  difficultyLevels: [
    {
      id: 'gentle',
      label: 'Gentle',
      rank: 1,
      fragments: [
        {
          text: 'When the player attempts something, let it work. Complications are colour rather than obstacles, and the world is on their side.',
          priority: 90,
        },
        { text: 'Offer help before it is asked for.', priority: 40 },
      ],
    },
    {
      id: 'even',
      label: 'Even',
      rank: 2,
      fragments: [
        {
          text: 'An attempt succeeds when it is reasonable and costs something when it is not. Do not invent obstacles, and do not remove the ones that are there.',
          priority: 90,
        },
      ],
    },
    {
      id: 'harsh',
      label: 'Harsh',
      rank: 3,
      fragments: [
        {
          text: 'Concede little. Most attempts work partially, late, or at a price the player did not price in.',
          priority: 90,
        },
        {
          text: 'The route to what they are working toward may be long and expensive. It is never closed.',
          priority: 80,
        },
        { text: 'Nothing volunteers help.', priority: 30 },
      ],
    },
  ],
  /**
   * ***The other axis, and the prose could not be swapped with the list above***
   * — which is [06 §7.3.2]'s whole point. Resistance is *how readily the world
   * grants what you attempt*; directedness is *how hard the narration pulls
   * toward its own idea of the story*. A pack that raised both together would
   * have built *"railroading wearing difficulty's clothes"*, and players report
   * that as the AI ignoring them rather than as hard.
   *
   * *Two levels and no third*, because [06 §7.3.2] says the default is low and
   * *"a narrator with none is a stenographer"* — so the floor is *following*
   * rather than *silent*, and there is no level above *steering* on purpose:
   * a pack that shipped one would be shipping the failure as a setting.
   */
  directednessLevels: [
    {
      id: 'following',
      label: 'Follow me',
      rank: 1,
      fragments: [
        {
          text: 'Follow where the player goes. You may put things in their way and offer openings; do not insist on a direction they have declined.',
          priority: 90,
        },
      ],
    },
    {
      id: 'steering',
      label: 'Have its own ideas',
      rank: 2,
      fragments: [
        {
          text: 'You have an idea of where this is going. Bend scenes back toward it when you can do so without contradicting what has already happened, and drop it when the player has clearly chosen otherwise.',
          priority: 90,
        },
      ],
    },
  ],
  /**
   * ***What the hook dial should mean to the model*** —
   * [06 §6.1](../../../../docs/design/06-modes-and-turn-pipeline.md),
   * [P11.5](../../../../docs/design/workplan/28-p11-implementation.md).
   *
   * **The same shape as the two lists above and deliberately not a third dial.**
   * [23 §5.4] is explicit: a frequency dial stays a *separate channel* from
   * difficulty, *"because folding* how often *into* how hard *rebuilds exactly
   * the conflation [06 §7.3.2] exists to prevent"*. What these three lists share
   * is a data shape — a named level with ranked fragments — and nothing else:
   * `se.hook.pacing` is its own channel, resolved by `sessions/hooks.ts`, and
   * `dials.ts` still reads two axes.
   *
   * §6.1's split is why the prose is here at all: *"Level → cadence, cooldown
   * and patience is engine code; the level's prose is the prompt pack's."* Until
   * [P11.5] there was nowhere to put the second half, so the selector asked the
   * identical question at every setting.
   *
   * ***`aggressive` keeps §6.1's refusal*** — *"`aggressive` must not reach
   * railroading… The dial changes how often a hook is **considered**… none of
   * them makes the narrator comply"* — so the top of the dial says *say yes more
   * readily*, never *insist*, and keeps the clause about not running over what
   * the player is doing. *That is the same floor `harsh` carries above, one
   * control along.*
   *
   * **Near-identical prose ships in Scene's pack and that is correct**, not
   * duplication waiting to be factored out: a mode is a package and a pack is
   * its words, so a shared constant would be one mode importing another's
   * opinion — the dependency [P2 §2.4]'s *"relocates behind the SDK unchanged"*
   * refuses. *They are not quite the same words either*: Scene is a scene and
   * can say *the scene has reached a seam*; this is an ongoing story with no
   * such edge, so its quietest level reaches for the story's own drift instead.
   */
  pacingLevels: [
    {
      id: 'sparse',
      label: 'Sparse',
      rank: 0,
      fragments: [
        {
          text: 'Beats are rare in this story. Answer null unless one of them follows plainly from where the story has drifted — a thread the player picked up, a place they went back to, a question they left open.',
          priority: 100,
        },
        {
          text: 'A beat that has to interrupt something is not the right beat yet, and waiting costs nothing.',
          priority: 60,
        },
      ],
    },
    {
      id: 'normal',
      label: 'Normal',
      rank: 1,
      fragments: [
        {
          text: 'Introduce a beat when one follows from what just happened. A workable opening is enough; a perfect one is not required.',
          priority: 100,
        },
        {
          text: 'If nothing here connects to what the player just did, answer null and let the story keep its own shape.',
          priority: 60,
        },
      ],
    },
    {
      id: 'aggressive',
      label: 'Brisk',
      rank: 2,
      fragments: [
        {
          text: 'This story wants to move. Say yes to a workable opening rather than holding out for a better one, and treat a lull as an opening in itself.',
          priority: 100,
        },
        {
          text: 'Still not over the top of what the player is doing: if they are mid-action or mid-sentence, the beat can wait a turn.',
          priority: 60,
        },
      ],
    },
    {
      id: 'manual-only',
      label: 'Only when asked',
      rank: 3,
      fragments: [
        {
          text: 'Nothing reaches this question unless somebody asked for it by hand, so the only thing left to judge is whether this is a place it can land at all.',
          priority: 100,
        },
      ],
    },
  ],
  variables: [],
  tags: [],
  provenance: {
    source: 'manual',
    creator: null,
    version: null,
    license: null,
    originalFilename: null,
    createdAt: STAMP,
    updatedAt: STAMP,
  },
  generated: null,
  compat: null,
  metadata: {},
};
