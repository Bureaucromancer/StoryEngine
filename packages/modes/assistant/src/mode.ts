// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type {
  ChannelDefinition,
  Mode,
  ModeDefinition,
  StepDefinition,
  StepHost,
  StepInput,
  StepResult,
} from '@storyengine/sdk';

import { ASSISTANT_PRESET } from './preset.js';
import { propose, PROPOSE_STEP } from './propose.js';

/**
 * ***The assistant*** —
 * [06 §7.4](../../../../docs/design/06-modes-and-turn-pipeline.md),
 * [10 §7](../../../../docs/design/10-ui-surfaces.md),
 * [P11.3](../../../../docs/design/workplan/28-p11-implementation.md).
 *
 * ***"It is a session, in a mode, with an actor card. That is the whole
 * design."*** §7.4 says it in one sentence and then spends a table on what
 * follows for free: streaming and reconnection, the turn record and the
 * workbench, rewrite and reroll, the guidance box, branching, notifications, and
 * per-user ownership. **None of that is in this package**, and that absence is
 * the feature — every one of those arrives because this is an ordinary mode.
 *
 * ***The proof obligation is the same sentence, inverted.*** §7.4: *"If building
 * the assistant requires a parallel chat implementation, something in the mode
 * contract is wrong — so this doubles as a test of [§2]."* So the thing to watch
 * is not whether the assistant works; it is whether anything had to be built
 * twice to make it work. `tools/repo-shape.test.ts` holds that, and this
 * package's one dependency is the other half of it.
 *
 * ***Capabilities here, personality on the card*** — §7.4's own heading, and
 * [00 §2.4]'s split. This declares what the assistant can *do*; the card it runs
 * with carries how it talks. *"Swapping the assistant's card changes how it
 * talks and nothing else. Point it at a roleplay character for fun and it still
 * works."*
 *
 * ***`embodied`, where both story modes are `narrator`.*** [06 §3]'s axis is
 * about whose voice the output is in, and the assistant answers **as itself** —
 * there is no scene it is describing. That makes it the first `embodied` mode in
 * the build, which is worth one line because the field has had two identical
 * consumers since P2 and this is the first declaration that differs.
 */

export const ASSISTANT_ID = 'storyengine.assistant';

/**
 * ***What the assistant can see, and the disclosure that makes it bearable*** —
 * [06 §7.4]'s *ambient context, disclosed*, [10 §7].
 *
 * §7.4 states both halves in two sentences: *"The assistant should know what you
 * are looking at — the actor you have open, the session you were in — or every
 * request starts with the user re-describing their own screen. That context is a
 * block the client contributes, and it must be **visible in the turn record like
 * any other block**. An assistant that silently knows what is on your screen is
 * unsettling; one that shows you it knows is useful."*
 *
 * ***A channel with a budget is exactly that, and it is why this needed no new
 * machinery.*** A channel the client writes (`user-only`) with a non-null
 * `budget` is rendered into the prompt as an ordinary block and lands in the
 * turn record's block table with everything else — so *visible in the turn
 * record like any other block* is not a thing this mode implements, it is a
 * thing it gets by declaring the channel honestly. **`budget: null` here would
 * be the unsettling version**, and it would look like a smaller declaration
 * rather than a different feature.
 *
 * *`user-only`, so the model cannot write what the model is told it can see.*
 * That is the same refusal `se.hook.pacing` makes for its own reason: a channel
 * the model can widen is a model deciding how much of your screen it gets.
 */
export const ASSISTANT_CONTEXT: ChannelDefinition = {
  id: 'se.assistant.context',
  owner: ASSISTANT_ID,
  version: 1,
  scope: 'session',
  update: 'user-only',
  visibility: 'player',
  budget: 400,
  schema: {
    type: ['object', 'null'],
    properties: {
      /** What the person is looking at — *actor*, *lorebook*, *session*. */
      kind: { type: 'string' },
      /** Its id, so the assistant can ask about it by name rather than by guess. */
      id: { type: 'string' },
      /** What it is called, which is what a sentence about it uses. */
      name: { type: 'string' },
      /** The route, so the disclosure says where rather than only what. */
      where: { type: 'string' },
    },
    additionalProperties: true,
  },
  init: { kind: 'literal', value: null },
  /**
   * ***What the block says*** (2026-09-30).
   *
   * The budget made this channel a block, and nothing gave the block any
   * words: a channel with no `render` "has no textual form"
   * (`renderedChannels`), and the collector's renderer answers it with nothing
   * (`renderWithin`). So the slot the pack positions was empty on every turn,
   * the workbench said *nothing produces this*, and the panel's *"You can see
   * what they have open"* was never true of any prompt. The test that pinned
   * the budget could not see it, because a budget with no template renders
   * the same nothing as no budget at all.
   *
   * ***One sentence, in the library's own words for its kinds*** — the ones
   * the person reads on the page (`library/labels.tsx`), so the assistant says
   * *the actor* about what the person calls an actor. A kind this does not
   * name goes as written. `null`, which the panel writes where nothing is
   * open, renders nothing (`renderChannelValue`).
   *
   * ***(2026-10-10, [P16.0](../../../../docs/design/workplan/35-p16-world.md))***
   * ~~`packages` → *the package*~~ — the kind is a World now, its folder
   * `worlds` and the page's word *world*, so a World open in the library is
   * *the world*. **`packages` stays as a second name for it**, and that is
   * [P16 §1.1](../../../../docs/design/workplan/35-p16-world.md)'s *read both,
   * write the new one* rather than tidiness left undone: the panel writes this
   * channel only when what it sees changes, and a session reopened on a page
   * with nothing open writes nothing at all (`useDisclosedContext` in the
   * client's `AssistantPanel.tsx`), so an assistant session whose last write was
   * made on a Package's page before the upgrade still holds `packages` as its
   * value, and without the alias its next turn would tell the model *packages* —
   * the folder name of a kind that no longer exists — where every other kind
   * gets a word. Nothing writes `packages` from now on, so the alias costs one
   * comparison and can never be wrong.
   */
  render:
    'What they have open{% if where %}, in {{ where }}{% endif %}: ' +
    '{% case kind %}{% when "actors" %}the actor{% when "lorebooks" %}the lorebook' +
    '{% when "treatments" %}the treatment{% when "setups" %}the setup' +
    '{% when "presets" %}the preset{% when "worlds", "packages" %}the world' +
    '{% when "session" %}the session{% else %}{{ kind }}{% endcase %}' +
    '{% if name %} “{{ name }}”{% endif %}{% if id %} (id {{ id }}){% endif %}.',
};

/**
 * ***A change the assistant proposes, never one it makes*** — [06 §7.4]'s
 * *propose, then apply*.
 *
 * *"Every mutation is a reviewable diff, not a silent write… the risk is not
 * editing somebody else's character; it is that an assistant quietly rewriting
 * your own work is the fastest way to stop trusting it."*
 *
 * ***`model-proposed`, which is the ordinary path and the whole point.*** A
 * proposal is a channel write a step proposes and `acceptEffect` records — the
 * same mechanism a mode uses for any other model-proposed state — so a proposal
 * is in the turn record, is reversible by branching, and is visible in the
 * workbench beside the call that produced it. **Applying it is a separate act by
 * the person, through the library route they already have**, which is what keeps
 * the write on their side of the line: nothing here can touch a file.
 *
 * *`budget: null`*, because a proposal is an output rather than context. Feeding
 * the last proposal back into the next prompt would make the assistant argue
 * with itself about a change the person has not looked at yet.
 */
export const ASSISTANT_PROPOSAL: ChannelDefinition = {
  id: 'se.assistant.proposal',
  owner: ASSISTANT_ID,
  version: 1,
  scope: 'session',
  update: 'model-proposed',
  visibility: 'player',
  budget: null,
  schema: {
    type: ['object', 'null'],
    properties: {
      kind: { type: 'string' },
      id: { type: 'string' },
      /** The fields to change, by dotted path, with the value proposed for each. */
      changes: {
        type: 'object',
        additionalProperties: { type: 'string' },
      },
      /** One sentence on why, which is what a person reads before applying. */
      why: { type: 'string' },
    },
    required: ['kind', 'id', 'changes'],
    additionalProperties: false,
  },
  init: { kind: 'literal', value: null },
};

export const ASSISTANT_CHANNELS: readonly ChannelDefinition[] = [
  ASSISTANT_CONTEXT,
  ASSISTANT_PROPOSAL,
];

/**
 * The answer — one call, streamed, exactly as a narrator's is.
 *
 * *`contributes: 'messages'` and nothing else*, because an answer **is** the
 * turn's output. A mode that wrapped it in something would be the parallel
 * implementation §7.4 forbids, three lines in.
 */
export const ANSWER: StepDefinition = {
  id: 'se.assistant.answer',
  stage: 'generate',
  reads: ['history', ASSISTANT_CONTEXT.id],
  writes: [],
  contributes: 'messages',
  callKind: 'narrate',
  when: { when: 'cadence', everyNTurns: 1 },
  failure: 'abort',
  role: 'prose',
};

async function answer(_input: StepInput, host: StepHost): Promise<StepResult> {
  const result = await host.call({ stream: true });
  return { message: { text: result.text } };
}

export const ASSISTANT: ModeDefinition = {
  id: ASSISTANT_ID,
  version: '1.0.0',
  displayName: 'Assistant',
  voice: 'embodied',
  dispatch: 'merged',
  presets: [],
  /**
   * ***One, and fixed*** — the assistant is one character and the cast cannot
   * change as an outcome of a turn, which is what `fixed` declares ([P7.3]).
   * A party here would be a room full of assistants, which is not a feature
   * anybody asked for and is the shape a copied declaration would have.
   */
  participants: { select: 'fixed', maxActors: 1 },
  /**
   * *A longer window than either story mode's twenty*, and the reason is what
   * the two are for. A narrator wants the recent scene; a person debugging a
   * preset wants the question they asked ten exchanges ago still in the room,
   * because the whole session is one problem rather than a story that moves on.
   */
  assembly: { defaultPreset: ASSISTANT_PRESET, historyWindow: 40 },
  steps: [ANSWER, PROPOSE_STEP],
  channels: ASSISTANT_CHANNELS,
  /**
   * ***One kind, and it is `do`.*** [06 §1]'s kinds are about what a player is
   * doing *in a story*, and none of them describes asking a question — so the
   * honest declaration is the one that offers no choice at all, which is also
   * what makes `InputKind` render nothing here ([P7.9]: *"a selector offering
   * one option would be a control that cannot do anything"*).
   */
  inputs: ['do'],
  surfaces: [],
  /**
   * ***No wizard, and that is a declaration rather than an omission.*** [10 §7]
   * wants the assistant *summonable from anywhere, including mid-session,
   * without losing your place* — and a setup form is the opposite of summonable.
   * The session it makes has a name and a card and nothing to configure, which
   * is what `kind: 'none'` says.
   */
  setup: { kind: 'none' },
};

export const ASSISTANT_MODE: Mode = {
  definition: ASSISTANT,
  run: { [ANSWER.id]: answer, [PROPOSE_STEP.id]: propose },
};
