// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { Preset } from '@storyengine/sdk';

/**
 * Scene's default prompt pack — a real, valid portable `Preset`.
 *
 * **A literal value, not `newPreset()` plus mutation**, and that is not style:
 * the factory mints a fresh `uuidv7()` and stamps `now()`, and this object is
 * copied into every session and pinned, field by field where it matters, in
 * `mode.test.ts`. A new id or timestamp per process makes both
 * non-reproducible. (This said *snapshotted by a golden test* for six phases
 * and there has never been one — the repo's only inline snapshot is
 * `assemble.test.ts`'s, over hand-built candidates — so it now names the test
 * that exists.)
 *
 * **A code constant rather than a file seeded into `system/library/presets/`.**
 * [P2 §2.4] says the mode relocates behind the SDK unchanged, and a mode that
 * depended on a boot-time seeder would not; nothing writes to `system/library/`
 * today, and a session gets its own copy either way. ~~The cost, stated: the
 * default preset is readable in the turn record and not editable in the app
 * until P7.~~
 *
 * ***The value stayed a constant and the cost was paid another way*** — [P7B.0],
 * and the distinction is the point. The engine still writes this object into
 * `system/library/presets/` at boot, so it has a library address, a detail page
 * and a *Copy to my library* action — but **the mode does not know that**. It
 * declares a value; the host decides to materialise it. Had the dependency run
 * the other way, a mode would need a seeder to be a mode, and [P2 §2.4]'s claim
 * that it relocates unchanged would have stopped being true. Editing it is
 * still refused, because a shipped object is read-only everywhere ([09 §4.3]):
 * what changed is that there is now something to copy.
 *
 * It goes through `validate()` in a test — the same validator a user's write
 * goes through — which is the assertion that caught `SlotSource` missing the
 * `guidance` arm that [06 §5.1] requires a preset to be able to position.
 *
 * ***One pack, two voices — [P13.3]***
 * ([P13 §1.5](../../../../docs/design/workplan/30-p13-scene-and-session-import.md)).
 * Scene became an embodied chat and kept narration one control away
 * ([P13 §1.2]), so this pack has to write both, and it does it with the one
 * mechanism a pack already had for *"a different instruction per kind"*:
 * `appliesTo`. The collector matches a block against the call's **voice** as
 * well as its call kind and input kind — `narrator` on a call that speaks for
 * nobody, `embodied` on a speaking call, and neither on any call that does not
 * write the turn's messages (`CollectContext.voice`). So:
 *
 * - `se.instruction` is the narrator's, `se.instruction.embodied` the chat's;
 * - the card's own prompts (`se.card.system`, `se.card.depth`,
 *   `se.card.post-history`) are the chat's only — a narrated scene is never
 *   told *"you are Vera"*;
 * - everything else — the persona, the cards' sections, the lore, the samples,
 *   the history, the goal and guidance — is both voices', and the card blocks
 *   come **speaker first** on a speaking call ([P13.2]'s `castFor`).
 *
 * ***The pre-P13 narrator pack is not lost, and needs no second constant.***
 * Every session carries its own copy of the pack it was created with
 * (`SessionFile.preset`), so a pre-P13 session's copy still says
 * `appliesTo: ['narrate']` on its one instruction, and `presetOf` adds only the
 * blocks it lacks — each of which applies to `embodied` alone, or to both
 * voices as its existing siblings do. The narrator's words themselves are
 * unchanged here, so a *new* session set to `narrator` is narrated in exactly
 * the words an old one is.
 */

/** Fixed, so a golden snapshot over this object is reproducible. */
const STAMP = '2026-01-01T00:00:00.000Z';

export const SCENE_PRESET: Preset = {
  schema: 'storyengine.preset/0',
  id: '0199c000-0000-7000-8000-00000000e5e7',
  name: 'Scene',
  blurb: '',
  modes: ['storyengine.scene'],
  blocks: [
    /**
     * *The narrator's, and a narration's only* (2026-09-27): `appliesTo` was
     * every kind of call, and an impersonation is collected as `impersonate`
     * and asks for exactly what this forbids — the player's own words. A
     * session keeps the pack it was created with, so older sessions still
     * carry the wide one; the impersonation instruction answers for those.
     *
     * ***The narrated voice's, since [P13.3]*** — `appliesTo: ['narrator']`,
     * ~~`['narrate']`~~. Scene's pack serves both voices, and says which block
     * is whose through the collector's third match key, the call's voice
     * (`CollectContext.voice`): `narrator` on a call that speaks for nobody,
     * `embodied` on one that speaks as a member. `narrate` is the call kind of
     * **both**, so keyed to it this block would tell an embodied Vera she is
     * the narrator of a scene. A voice is set only on a call that writes the
     * turn's messages, so an impersonation still gets neither instruction.
     *
     * ***Sessions made before this keep `['narrate']`*** — the pack is a copy,
     * and a copy follows the shipped pack in what it adds, not in what it
     * changes (`presetOf`). Those sessions are narrated (`legacy`, or the
     * narrator values P13.0 wrote at creation), and there the two keys pick the
     * same calls. One of them switched to `embodied` by hand would get this
     * instruction beside the embodied one, and *Switch to the mode's own* is
     * the repair — said here because it is the one way the old key shows.
     */
    {
      id: 'se.instruction',
      label: 'instruction',
      role: 'system',
      enabled: true,
      placement: {
        at: 'sequence',
      },
      priority: 90,
      appliesTo: ['narrator'],
      advisory: false,
      omitWhenEmpty: true,
      kind: 'text',
      template:
        "You are the narrator of a scene. Write what happens next in third person, past tense. Describe only what the player could perceive. Never write the player's own dialogue, thoughts or decisions, and never end by asking what they do.",
    },
    /**
     * ***The embodied chat's instruction*** — [P13 §1.5](../../../../docs/design/workplan/30-p13-scene-and-session-import.md),
     * [P13.3].
     *
     * **The sense of SillyTavern's default main prompt, in our words**:
     * *"Write {{char}}'s next reply in a fictional chat between
     * {{charIfNotGroup}} and {{user}}"* (`openai.js:101`). It **names the
     * speaker as the one to write** — `{{ char }}` is the speaker on a speaking
     * call ([P13.2]), so under `per-actor` each call names its own member.
     *
     * ***And in a group, the group nudge*** — ST's *"[Write the next reply only
     * as {{char}}.]"* (`openai.js:114`) and Marinara's *"Respond ONLY as"*
     * (`generate.routes.ts:7332`). *A group* is `charIfNotGroup` differing from
     * `char`, which is exactly ST's own test: in a cast of one the alias is the
     * character's name, and the sentence would tell a solo chat it is a group.
     * `{{ notChar }}` names who the reply must leave alone — the player first,
     * then every other member, muted ones included, because a muted member is
     * still somebody the reply must not speak as (`assembly/template.ts`).
     *
     * ***Under `per-actor` dispatch only*** (2026-09-29, the [P13.3] review).
     * ~~In a group~~ — a `merged` call is one reply that may voice every member
     * ([P13 §1.4], `mode.ts`), and telling it to write only as its first
     * speaker and leave the rest to speak for themselves asked for the one
     * thing merged dispatch is not. The names cannot tell the two calls apart,
     * so the template reads the session's `dispatch`, the one setting in its
     * namespace (`RenderContext.dispatch`). Absent outside a session, which
     * sends no nudge: a call nobody said was one member's reply is not told
     * it is.
     *
     * *The player's words are refused in both voices*, which is the one rule
     * the narrator's instruction and this one share: a reply that writes the
     * player's lines has taken the player's turn.
     */
    {
      id: 'se.instruction.embodied',
      label: 'instruction (embodied)',
      role: 'system',
      enabled: true,
      placement: {
        at: 'sequence',
      },
      priority: 90,
      appliesTo: ['embodied'],
      advisory: false,
      omitWhenEmpty: true,
      kind: 'text',
      template:
        "Write {{ char }}'s next reply in a fictional chat between {{ charIfNotGroup }} and {{ user }}. Write as {{ char }}: what they say and do, in their own voice. Never write {{ user }}'s dialogue, thoughts or decisions.{% if charIfNotGroup != char and dispatch == 'per-actor' %} This is a group chat: write only as {{ char }}, and leave {{ notChar }} to speak for themselves.{% endif %}",
    },
    /**
     * ***The card's own system prompt, stacked after the instruction*** —
     * [P13 §1.5]'s table: *"directly after the pack's instruction: the more
     * specific voice speaks last among the system blocks"*.
     *
     * **Stacked rather than replacing**, which is §1.5's decision against ST's
     * `prefer_character_prompt`: a card's one-line *"You are {{char}}"* would
     * otherwise throw away the names, the group nudge and the refusal to write
     * the player. A chat that wants ST's behaviour switches the instruction off
     * (`prompts.instruction: false`), and a chat that wants neither switches
     * this card's part off (`prompts.cards`).
     *
     * ***`voiced`***, so whose prompt it is follows the dispatch: under
     * `per-actor` the speaker's only — another member's system prompt is an
     * instruction to write *as them*, and sent to somebody else's call it would
     * tell the model to be two people — and under `merged` every present card's,
     * each its own block, because the one call writes for all of them. *Each
     * rendered with its own `{{char}}`*: the importer writes the card's own name
     * where its prompt said `{{char}}` (`import/sillytavern/card.ts`), which is
     * the only reading a card's placeholder for itself can have.
     *
     * **Embodied only.** A narrator's call speaks for nobody, and a card prompt
     * telling it *"you are Vera"* is the one thing a narrated scene must not
     * be told; the narrated setting still produces narrator prose.
     *
     * *Bare, no wrapper*: the card's words as its author wrote them, which is
     * what ST sends. Priority just under the instruction's, so under pressure
     * the card's prompt goes before the pack's framing does.
     */
    {
      id: 'se.card.system',
      label: 'card system prompt',
      role: 'system',
      enabled: true,
      placement: {
        at: 'sequence',
      },
      priority: 85,
      appliesTo: ['embodied'],
      advisory: false,
      omitWhenEmpty: true,
      kind: 'slot',
      source: {
        of: 'actor',
        sectionId: 'se.card.system',
        scope: 'voiced',
      },
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
    /**
     * ***Whose block is whose*** (2026-09-27) — the persona's and the five
     * actor blocks' wrappers name who each one is about.
     *
     * Bare, they reached the model as bodies with no names on them: the
     * persona's sections with nothing to say they were the player's
     * character, and — with two characters in a scene — two descriptions, then
     * two appearances, then two voices, and nothing to say which was which.
     * The persona's name was in no prompt at all. A wrapper renders `char` as
     * the actor its candidate is about and `user` as the persona, and never the
     * content, so a `{{` in somebody's card is still prose.
     *
     * *Sessions copied before this keep their bare blocks* — a pack follows
     * the shipped one in what it adds, not in what it changes — and *Switch to
     * the mode's own* brings these.
     */
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
      wrapper: "The player's character, {{ user }}:\n{{content}}",
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
      wrapper: '{{ char }}:\n{{content}}',
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
      wrapper: 'What {{ char }} looks like:\n{{content}}',
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
      wrapper: 'How {{ char }} speaks:\n{{content}}',
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
      wrapper: "{{ char }}'s traits: {{content}}",
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
      wrapper: "{{ char }}'s background:\n{{content}}",
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
      /**
       * ***`voiced`, since [P13.3]*** — [P13 §1.5]'s *"example dialogue… scoped
       * to the speaker"*. Under `per-actor` an example of how Lund talks is no
       * help writing Vera; under `merged`, and to a narrator, every present
       * member's examples are, as before. `speaker` would have starved the
       * narrator of every sample, which is why the scope is not that one. The
       * scope narrows the actor carrier only; a Treatment's or a book's samples
       * are the room's.
       */
      source: {
        of: 'samples',
        scope: 'voiced',
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
     * ***The card's depth prompt, at its own depth*** — [P13 §1.5]'s table: a
     * card's `extensions.depth_prompt`, *"at its declared depth and role
     * (default 4, `system`)"*.
     *
     * **The placement here is the default, and the section's own wins.** The
     * depth and role are the card author's and travel on the section
     * (`Section.placement`), so two cards asking for two depths land at two
     * depths through this one block — the collector moves each, as it moves a
     * lore entry by its own position. `voiced` and embodied-only for the system
     * prompt's reasons above.
     */
    {
      id: 'se.card.depth',
      label: 'card depth prompt',
      role: 'system',
      enabled: true,
      placement: {
        at: 'in-history',
        fromEnd: 4,
      },
      priority: 60,
      appliesTo: ['embodied'],
      advisory: false,
      omitWhenEmpty: true,
      kind: 'slot',
      source: {
        of: 'actor',
        sectionId: 'se.card.depth',
        scope: 'voiced',
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
      id: 'se.input',
      label: 'input',
      role: 'user',
      enabled: true,
      placement: {
        at: 'sequence',
      },
      priority: 100,
      appliesTo: [],
      advisory: false,
      omitWhenEmpty: true,
      kind: 'slot',
      source: {
        of: 'input',
      },
    },
    /**
     * ***The card's post-history instructions, last*** — [P13 §1.5]'s table:
     * *"in history at depth 0, user role, after the last message"*. ST sends
     * them after the chat; Marinara at depth 0 as the user
     * (`macro-context.ts:806`).
     *
     * **After the input in sequence, which is after everything said** — the
     * player's move and, under `per-actor`, the round so far, which the
     * collector places straight after the input slot. An `in-history` depth 0
     * would put them before the move the reply answers, because this build's
     * history run ends where the input begins. `voiced` and embodied-only for
     * the system prompt's reasons; a high priority, because a card's author
     * put these last to be the last thing obeyed.
     */
    {
      id: 'se.card.post-history',
      label: 'card post-history instructions',
      role: 'user',
      enabled: true,
      placement: {
        at: 'sequence',
      },
      priority: 95,
      appliesTo: ['embodied'],
      advisory: false,
      omitWhenEmpty: true,
      kind: 'slot',
      source: {
        of: 'actor',
        sectionId: 'se.card.post-history',
        scope: 'voiced',
      },
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
   * ***What the dial should mean to the model*** —
   * [06 §6.1](../../../../docs/design/06-modes-and-turn-pipeline.md),
   * [P11.5](../../../../docs/design/workplan/28-p11-implementation.md).
   *
   * §6.1's split: *"Level → cadence, cooldown and patience is engine code; the
   * level's prose is the prompt pack's."* The numbers are in
   * `sessions/hooks.ts` and are not a pack's to set — their effect is that a
   * step does not run, which is invisible in the record by construction. These
   * are the other half, and until [P11.5] there was nowhere to put them: the
   * selector asked the identical question at every setting and the dial changed
   * only how often it asked.
   *
   * ***`aggressive` is written carefully, because §6.1 names the way it goes
   * wrong.*** *"`aggressive` must not reach railroading… The dial changes how
   * often a hook is **considered**. Guidance stays advisory at every setting and
   * none of them makes the narrator comply — otherwise the top of the dial is
   * not brisk pacing, it is the directedness [§7.3.2] spends a section
   * refusing."* So the top level says **say yes more readily**, never *insist*,
   * and it keeps the one refusal the bottom level has: *not over the top of what
   * the player is doing.* A pack is free to write it differently; this one
   * thinks a dial that overruns the player is a broken dial at any setting.
   *
   * ***Two fragments each, so the ranking is real rather than decorative.***
   * [19 §5.3]'s cap drops the lowest `priority` first, and a level with one
   * fragment either survives whole or vanishes whole. The high one is the
   * disposition; the low one is the caveat that makes it safe — which is the
   * right thing to lose first if something must be lost, because a prompt
   * without the caveat is still the same dial.
   *
   * *`rank` mirrors `PACING_LEVELS` rather than sorting by frequency*, so the
   * order here is the order the dial presents. `manual-only` is last because it
   * is the **off** position and not the quietest setting: nothing reaches this
   * question under it except a hook somebody committed by hand.
   *
   * **Near-identical prose ships in Freeform's pack and that is correct**, not
   * duplication to be factored out: a mode is a package, a pack is its words,
   * and a shared constant would be one mode importing another's opinion.
   */
  pacingLevels: [
    {
      id: 'sparse',
      label: 'Sparse',
      rank: 0,
      fragments: [
        {
          text: 'Beats are rare in this story. Answer null unless the scene has reached a natural seam — an arrival, a departure, a question answered, a silence somebody has to break.',
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
          text: 'If nothing here connects to what the player just did, answer null and let the scene keep its own shape.',
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
