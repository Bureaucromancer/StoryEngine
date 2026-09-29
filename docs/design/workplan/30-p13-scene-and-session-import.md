# 30 — P13 implementation plan

**Status: planned 2026-09-28, for immediate implementation.** No stage has
landed. A feature in its own document, on the precedent
[P12 §1.5](29-p12-implementation.md) set.

**P13 is two things, in order.**

- **Part A — Scene, built out to the mode [06 §7.2](../06-modes-and-turn-pipeline.md)
  specified.** A direct functional equivalent of a SillyTavern or Marinara
  roleplay chat, single-character and group:
  - characters speaking in their own voice, one message each;
  - who replies chosen by ST's four activation strategies;
  - greetings, swipes, continue, force-talk, edit and hide;
  - a transcript that names who spoke.
- **Part B — session import from both sources into that Scene.** Swipes,
  branches and groups included. This is [18 §7](../18-session-import.md)'s
  verdict built: a pure converter per source, emitting the
  [P11.10](28-p11-implementation.md) interchange format, handed to the
  `importSession` reader that already exists.

*Revised the same day.* The first draft of this document imported
single-character chats into a narrator-voiced Scene and groups into Freeform,
and recorded the voice mismatch as a limit. **That is reversed by instruction.**
Part A exists so that an imported chat lands in a mode that plays the way the
chat did. §0.6 shows the reversal restores the design rather than departing
from it.

**Sources are pinned**, as 18's are, and at the same commits. Both were fetched
and read for this document, including the code that *runs* a chat, not only
the shapes it stores.

| Source | Pinned at | What was read |
|---|---|---|
| SillyTavern | `8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8` (v1.18.0) | `public/script.js` (`Generate`, `saveChat`, `saveReply`, `swipe`, `getFirstMessage`), `public/scripts/{group-chats,bookmarks,chats,openai,authors-note,utils}.js`, `src/endpoints/{chats,groups}.js` |
| Marinara Engine | `34442e26da577ff0d95ee890a87024e35831bfa9` (v2.4.3) | `packages/shared/src/types/chat.ts`, `packages/server/src/db/schema/chats.ts`, `services/storage/chats.storage.ts`, `services/prompt/{assembler,marker-expander}.ts`, `routes/{generate,chats}.routes.ts`, `services/import/st-chat.importer.ts` |

---

## 0 — What reading the sources and our own corpus found

### 0.1 SillyTavern branches and checkpoints are copied chats, as Marinara's are

`createBranch(mesId)` (`bookmarks.js:186`) saves messages `0..mesId` as a **new
chat file** whose `chat_metadata.main_chat` names the chat it came from. It also
pushes the new name onto `extra.branches` of the fork message in the parent.
`createNewBookmark` (checkpoints, `:253`) does the same with
`extra.bookmark_link`. A branch of a branch names the branch. **Both sources
therefore need the same family reconstruction.** 18 §2.1's *"a flat file"* is
true of one file and false of what a person actually has.

### 0.2 `chat_metadata.integrity` identifies a family, not a chat

`saveChat` builds the branch header from `{ ...chat_metadata, ...withMetadata }`
(`script.js:7347`), and `integrity` is minted only when absent
(`script.js:7606`, `group-chats.js:277`). **A branch inherits its parent's
integrity uuid.** A chat's own identity is its path:
`chats/<card file sans .png>/<name>.jsonl` (`endpoints/chats.js:554`) or
`group chats/<id>.jsonl`.

### 0.3 `mes` is authoritative, and `swipes[swipe_id]` is the copy that goes stale

An edit writes `mes`. Older builds left `swipes[swipe_id]` holding the pre-edit
text. Marinara's own SillyTavern importer overwrites the swipe with `mes`
(`st-chat.importer.ts:341-343`).

Marinara stores the same asymmetry. `setActiveSwipe` copies `messages.content`
onto the outgoing swipe row only when switching away
(`chats.storage.ts:1527-1556`). So the message row, not its swipe row, holds
the active swipe's current text.

### 0.4 Marinara's per-chat export is SillyTavern JSONL

`chats.routes.ts:3596` writes a chat as ST JSONL with extra fields:
`extra.marinara_role`, `extra.marinara_character_id`,
`extra.marinara_swipes` and `chat_metadata.marinara_metadata`. One JSONL parser
serves both sources' single-file path.

### 0.5 Hidden is a flag on an ordinary message, in both

- **SillyTavern.** `/hide` sets `is_system: true` (`chats.js:157`), and prompt
  assembly filters on it (`script.js:4437`). The message stays on screen with a
  ghost icon. `is_system` does not mean *system*; it means *not in the prompt*.
- **Marinara.** The equivalent is `extra.hiddenFromAI`, plus a per-character
  `hiddenFromAICharacterIds`.

Narrator lines are a separate thing and are sent. ST's are `extra.type:
'narrator'`, sent as the `system` role with no name (`openai.js:581`).
Marinara's are `role: 'narrator'`, also sent as `system`.

### 0.6 Our own corpus already specifies this Scene, and P2's minimum is what shipped

**[06 §1](../06-modes-and-turn-pipeline.md)'s naming table** maps *"SillyTavern/Marinara
RP"* to **Scene**.

**[06 §7.2](../06-modes-and-turn-pipeline.md)** reads:

> *"The SillyTavern/Marinara RP shape… one or more actors present… This is the
> mode where the requirement's 'narrator vs direct RP' and 'merged vs per-call'
> both live."*

It then takes ST's activation strategies *"as the taxonomy for
`ParticipantPolicy`… with the implementation being 'the policy selects
speakers', not card-swapping"*.

**[06 §3](../06-modes-and-turn-pipeline.md)** names `embodied` × `per-actor`
*"classic ST group chat"* and says both axes are *"exposed per-session and
overridable per-turn."*

**[03 §2.6](../03-data-model.md)** assumes *"individual-dispatch Scene mode"*.

**[07 §3](../07-branching.md)** and **[25 C11](../25-open-questions.md)** settle the
record shape. Under `per-actor` dispatch *"one turn produces several messages. A
turn is still **one node**"*.

What shipped is [P2 §2.4](08-p2-implementation.md)'s minimum:
- `voice`/`dispatch` fixed to `narrator`/`merged`;
- *"no participant policy beyond 'the user and one actor'"*.

[P7.9](23-p7-implementation.md) grew Scene's staging and nothing else.
[P7.3](23-p7-implementation.md) deferred voice and dispatch to P7.9, whose
record never mentions them.

**Two documents say otherwise, and both are wrong.**
[P7B §0.3](24-p7b-presets-and-prompts.md) and `sessions/store.ts:1937` both say
P7.3 *"decided"* voice and dispatch as session fields. No session field exists,
and the only readers echo the mode's constant (`mode-registry.ts:168`). Both
are corrected at P13.0.

**So this phase finishes a mode, not a new direction.** Nothing in the corpus
rejects embodied or per-actor. What [00 §2.10](../00-stance.md) rejects is
ST's **mechanism**, card-swapping: *"the assembler is multi-actor from the
start"*. [00 §4](../00-stance.md) rejects a promise of *behavioural parity*
("not an ST drop-in replacement").

Part A is held to that line:
- **functional equivalence**: every thing a person does in an ST or Marinara
  chat has a way to be done here;
- **not parity**: the same prompt bytes, the same slash commands, the
  extension API.

§1.10 lists where the two part company.

### 0.7 The P7.3 speaker arms do not do what their ST names do

`speakers.ts`'s arms differ from ST's in three places:

| Arm | `speakers.ts` today | ST, at the pin (`group-chats.js`) |
|---|---|---|
| `list` | rotates **one** speaker per turn on path depth | **everyone**, once each, in member order (`:1180`); Marinara's `sequential` is the same |
| `pooled` | a weighted draw from all eligible | one of those who have **not spoken since the last user message**, else anyone but the last speaker (`:1197`) |
| `natural` | name scan only, can answer nobody | name scan, **then a talkativeness roll per member**, **then one random member if nobody** — and the last speaker is banned unless self-responses are allowed (`:1242-1316`) |

P7.3 took the taxonomy and not the behaviour. No shipped mode reads the result,
because Freeform's single narrate step ignores `speakers`. So correcting the
arms changes nothing anybody has played, and §1.3 does it.

---

# Part A — Scene as a chat

## 1 — The decisions

### 1.1 A turn's output is a list of messages

A turn is one node however many messages it emits (C11). So the record needs
somewhere for several messages and their authors. It has neither: `Turn.output`
is `{ text, reasoning? }`, with no speaker.

**Decided: `Turn.output.messages?: OutputMessage[]`**, where

```ts
interface OutputMessage {
  speaker: Ref | null;   // null is the narrator
  text: string;
  reasoning?: string;
  carried?: true;        // copied from the sibling this turn redoes, not generated (§1.6)
}
```

**`output.text` stays, and becomes derived when `messages` is present.** It is
the messages' texts joined by a blank line. Everything that reads `text` today
keeps working unchanged: search, the summary chain, the memory extractor, an
older install reading an export. A writer keeps the two consistent, and a
reader that knows `messages` prefers it.

**Additive and optional, so [P11.10](28-p11-implementation.md)'s freeze holds.**
The freeze is *a promise not to tighten*. An unknown optional field rides
through `importSession`'s spread unchanged, and every turn ever written lacks it
and stays valid. `storyengine.session-export/1` does not change.

*It also gives [25 C2](../25-open-questions.md) its record.* C2 is mixed voice
within a turn: a narrator paragraph followed by embodied dialogue. That is a
`speaker: null` message beside attributed ones. C2 is not built here, but it no
longer needs a format change when it is.

*Superseded:* the first draft's `Turn.output.speaker`, one speaker per output.
It could not hold the group round ST writes as one batch (`extra.gen_id`), and
C11 had already said what a turn is.

### 1.2 Voice, dispatch and the speaker policy are session settings

[06 §3](../06-modes-and-turn-pipeline.md)'s two axes and Scene's participant
policy become optional session fields. Each defaults to the mode's value, as
[P7.3] promised and never shipped:

```ts
voice?: 'narrator' | 'embodied';
dispatch?: 'merged' | 'per-actor';
speakers?: {
  policy: 'natural' | 'list' | 'pooled' | 'manual' | 'smart';
  allowSelfResponses: boolean;
  namesInHistory: 'never' | 'groups' | 'always';
  maxPerRound: number;   // smart only: the most it may pick, default 3
};
note?: { text: string; depth: number; every: number };   // §1.5
hidden?: Record<string, true | number[]>;                // §1.7
prompts?: { instruction?: false; cards?: Record<string, false | CardPromptPart[]> };  // §1.5
```

**Scene's declared values become `embodied`, `per-actor`, `natural`.** In a
single-character chat, `per-actor` and `merged` are the same single call.

**`narrator` stays one control away.** That is *"Scene 'narrated'"* in 06 §3's
table, and it keeps [13](../13-write-mode.md)'s falsification test meaningful:
that test asks whether people already produce chapters in Scene.

**An existing session keeps what it was played with.** A Scene session written
before P13 has none of these fields, and absence has always meant the mode's
value. Flipping that value would silently re-voice every existing session. So:

- the session-creation route writes all three explicitly from P13 on;
- the readers treat a Scene session **without** them as
  `narrator`/`merged`/`fixed`.

The pre-P13 preset is already a copy inside each session (`SessionFile.preset`),
so its narrator instruction travels with it regardless.

**`participants.maxActors` rises to 32**, the cast route's own ceiling
(`CastBody.actors.maxItems`). ST has no cap and Marinara has none. 32 is a bound
on a request body, not a claim about groups.

### 1.3 Who replies: ST's four strategies, as ST runs them

`speakers.ts`'s arms are corrected to the pinned behaviour (§0.7). All
randomness is drawn on the turn's tape, so a replayed turn picks the same
speakers.

- **`natural`**, the default. The activation text is the input, or when there is
  none the last message. Then:
  1. every eligible member whose name appears in it speaks, in order of mention;
  2. every other member speaks if a talkativeness roll succeeds, in shuffled order;
  3. if still nobody, one random member with talkativeness above zero speaks.

  The last speaker is excluded unless `allowSelfResponses`. **Talkativeness**
  lives at `actor.modeData['storyengine.scene'].talkativeness`, default 0.5. It
  is participation, not prompt, so it belongs in `modeData`: the card schema's
  *"prompt assembly is owned by the preset"* exclusion (`actor.ts:158`) is about
  the other kind. ST's `talkativeness` imports there (§3, P13.9).
- **`list`**: everyone eligible, once each, in cast order. This is ST's LIST and
  Marinara's `sequential`.
- **`pooled`**: one member who has not spoken since the last input, else anyone
  but the last speaker.
- **`manual`**: nobody replies to an input. Replies are asked for (§1.6).
- **Force talk** overrides every policy. A submission may name
  `speakers: [actorId]`: ST's member *speak* button and `/trigger`, and
  Marinara's `forCharacterId`.

**Eligible is: in the cast, not muted, not dead or departed.** `se.presence` has
been the eligibility test since P7.3, and nothing writes it, so today nobody is
ever eligible (`speakers.ts:70`, `cast.ts:89`). Scene declares
**`castIsPresent`**: a declared cast member with no presence value is present,
and presence `false` is **muted**. That is ST's `disabled_members` and
Marinara's `inactiveCharacterIds`, and it is the checkbox the cast panel already
has.

A fifth arm, **`smart`**, asks a model who should reply. §1.3a is its whole
design, because it is the one arm that makes a call.

### 1.3a Smart order: a small call, a closed answer, a deterministic fallback

Marinara's `smart` order (`generate.routes.ts:5306-5456`) is the best answer
either source has to *"who would actually speak now?"*. It is also the only
arm whose answer is a judgement rather than a rule. Marinara's version is:

- explicit `@mentions` win outright;
- otherwise a separate non-streamed call picks, at temperature 0.2, over the
  roster, their talkativeness and personality, and the last five exchanges;
- its prompt says *"usually choose exactly one character… avoid making the same
  character speak twice in a row"*;
- if the answer is unusable, it falls back to the first member who was not the
  last speaker.

**Ours takes that behaviour and builds it the way the hook selector is built**
([P7.5](23-p7-implementation.md), `turns/hook-selector.ts`). That step is this
build's existing answer to *"a cheap engine judgement before the prose"*, and
every decision it made about cost, failure and trust applies here unchanged.

**1. Rules first, and most turns never make the call.** `selectSpeakers` answers
`smart` without a model whenever a rule already decides:

| Situation | Answer | Call? |
|---|---|---|
| force-talk named somebody | them | no |
| the activation text names eligible members | them, in order of mention | no |
| one eligible member | them | no |
| otherwise | ask, with `natural`'s pick computed as the fallback | **yes** |

Mentions winning outright is Marinara's rule and ST's first step. It also means
the call runs only when there is genuinely something to judge. In a
three-person scene where the player addresses somebody by name, that is not
most turns.

**2. The call is an engine-owned `pre` step, `se.speakers.smart`.** It sits
beside the hook selector and is planned only when the session's policy is
`smart` and the rules asked. Its prompt is **its own candidates, not the
scene**: `StepCallRequest.candidates` is set, so neither the preset nor the
retriever runs. That is what makes it cheap. It gets:

- **the roster**: each eligible member's id, name, talkativeness and the first
  ~300 characters of their `se.summary`, plus how many rounds ago they last
  spoke;
- **what just happened**: the last six messages, each cut to ~600 characters,
  with speakers named. Hidden lines are excluded, because the orchestrator sees
  what the characters see;
- **the question**: who should reply next, in order. Usually one; several only
  when each has an immediate reason; the last speaker only if addressed; at
  most `maxPerRound`. Marinara's instruction in substance, with our wording.

**3. A closed answer, enforced twice.** The schema is an array of the eligible
ids (`enum`), `minItems: 1`, `maxItems: maxPerRound`. Each item optionally
carries a one-line `because`. The reader then filters to eligible ids,
de-duplicates and caps. [P7.4] measured that `jsonSchema()` is not validated on
the degraded path, and the hook selector's reason applies word for word: *"a
model naming an ineligible hook is the failure [06 §6.1] warns about"*. A name
instead of an id is accepted when it matches exactly one eligible member,
because Marinara found models do that (`:5262-5304`).

**4. It never fails a turn.** `failure: 'warn'`. A timeout, an unbound role, an
unreadable answer or an empty one all fall back to rule 1's `natural` pick. That
pick was drawn from the turn's tape before the call, so the fallback is
deterministic and replayable. The fallback is recorded as a warned step, never
silent. A person who chose `smart` and got the rule-based pick can see that
happened and why ([00 §3.3](../00-stance.md)).

**5. The role is `prose`, and that is deliberate.** The hook selector found
that declaring `fast` fails on every stock install, because nothing binds it.
The same holds here. An install that wants a cheap model for this points the
session's `stepRoles` at `se.speakers.smart`, which is exactly the case that
layer exists for. Temperature 0.2, as Marinara's, set as the call's parameter.

**6. How the answer reaches the generate step.** Speakers are selected once,
before the step loop (`runner.ts:756`), and a step cannot write `speakers`
back through `StepResult`. That is correct: widening the result would let any
mode rewrite who spoke. So this follows the hook selector's precedent. The
runner hands the step an **engine-only cell**, the step writes its pick there,
and the runner substitutes it into `StepInput.speakers` for the steps that
follow. The door is only reachable from engine code, and `planFor` cannot
produce one.

**7. It is recorded, and a rewrite keeps it.**
- The call is an ordinary `request.calls` entry.
- The pick and its `because` lines go on the step's outcome, so the workbench
  shows *who was chosen and why*.
- The transcript shows only the result: the messages' speakers.
- **Rewrite keeps the speakers and reroll asks again.** That is the same line
  [07](../07-branching.md) draws between *"not that sentence"* and *"not that
  outcome"*. A `rewriteOf` submission carries the redone turn's speakers,
  read from its messages, and the call is not made.

**8. The surface.** The policy control offers *"Smart — a model picks who
replies (one extra call on turns where nobody is named)"*. The cost is in the
label, not a help page. While a round streams, the *who speaks next* control
shows the picked order, which is Marinara's `response_queue` event. Force-talk
still overrides it.

*Deliberately not built:* smart choosing **nobody**. Marinara's `manual` is the
policy for *"only when I ask"*, and a smart arm that could answer nobody would
make *let them talk* silently do nothing. `minItems: 1` is the guard.

### 1.4 Per-actor dispatch: one call per speaker, in order, each seeing the last

This is the one runtime change, so it is stated exactly. With `dispatch:
'per-actor'`, Scene's generate step runs the selected speakers in order. For
each speaker:

1. **The call is made with `speaker: actorId`**, a new field on
   `StepCallRequest`. P7.3's `actorId` only chose a model. `speaker` also
   **re-scopes assembly**:
   - `{{char}}` is the speaker;
   - `{{group}}`, `{{charIfNotGroup}}` and `{{notChar}}` join the template's
     closed namespace, with their ST meanings;
   - actor blocks may be scoped `speaker` or `others`;
   - the model-role hint resolves as P7.3 built.

   **Every present card stays in the prompt** (00 §2.10). The speaker's comes
   first and is named as the one to write. That is ST's `APPEND` without its
   string-joining, and a pack that wants SWAP scopes its card blocks to
   `speaker`.
2. **The history includes this turn's earlier messages.** The second speaker
   answers the first, as in both sources (`group-chats.js:1051`,
   `generate.routes.ts:7370`).
3. **The reply is cleaned as both sources clean it**
   (`group-chats.js:3112`, `generate.routes.ts:6652`):
   - a leading `Speaker:` is stripped;
   - the text is cut at the first line opened by another member's name.

   The raw reply stays in the call record, which is where an unmodified model
   response already lives.
4. **It is appended as one `OutputMessage`, streamed with its index.** Progress
   events gain `message: n`.

With `dispatch: 'merged'` it is one call and one message. In embodied voice
that is Marinara's merged mode: the speaker is the first selected, all cards
are present, and the text may voice several characters. Nothing splits it.

**A speaker's call failing mid-round** keeps the messages already written. It
reports the failure the way a warned step does, and the turn commits with
what it has. A group round that loses its third speaker to a timeout is a turn
with two messages, not a lost turn.

### 1.5 The Scene pack, rewritten for an embodied chat

`SCENE_PRESET` becomes a chat prompt, built from 06's blocks and not from ST's
bytes.

**The instruction:** *"Write {{char}}'s next reply in a fictional chat between
{{charIfNotGroup}} and {{user}}…"*. Its sense is taken from ST's default main
prompt (`openai.js:101`), and the wording is ours. In a group it adds *"Write
only as {{char}}"*, which is ST's group nudge (`openai.js:114`) and Marinara's
*"Respond ONLY as"* (`generate.routes.ts:7332`).

**The card's own prompt fields are honoured, and they stack rather than
replace.** A card that carries a system prompt was written to be sent with it,
so the pack sends it. The pack's own instruction is sent too.

*Decided 2026-09-29, by instruction.* ST's default is the other way:
`prefer_character_prompt` makes the card's prompt **replace** the main prompt
(`openai.js:1486`). Stacking was chosen instead because a replacement throws
away the pack's framing — names, the group nudge, the no-speaking-for-the-user
rule — for every card whose author wrote a one-line *"You are {{char}}"*. A
stack loses nothing that either author wrote, and anyone who wants ST's
behaviour turns off the pack's half (below).

| Card field | Section | Placed |
|---|---|---|
| `system_prompt` | `se.card.system` | directly **after** the pack's instruction: the more specific voice speaks last among the system blocks |
| `post_history_instructions` | `se.card.post-history` | in history at depth 0, user role, after the last message. ST sends it after the history; Marinara at depth 0, user role (`macro-context.ts:806`) |
| `extensions.depth_prompt` | `se.card.depth` | at its declared depth and role (default 4, `system`) |

**Whose card prompts, in a group.** A card's prompts are written with `{{char}}`
meaning that card's character.

- Under `per-actor` dispatch, each call carries **the speaker's** card prompts
  only, rendered with `{{char}}` as the speaker. Another member's system prompt
  is an instruction to write *as them*, and sending it to somebody else's call
  would tell the model to be two people. This matches both sources: ST's card
  prompt is the active character's, and Marinara's per-responder call resolves
  macros per responder.
- Under `merged` dispatch, every present card's prompts are stacked, each in its
  own block and rendered with its own `{{char}}`. The single call is writing for
  all of them.

**What a chat can switch off.** A session field:

```ts
prompts?: {
  instruction?: false;                                   // skip the pack's instruction
  cards?: Record<string, false | CardPromptPart[]>;      // per actor: all, or which
};
type CardPromptPart = 'system' | 'post-history' | 'depth';
```

- **`instruction: false`** sends the card's system prompt alone. That is ST's
  default behaviour, one toggle away.
- **`cards[actorId]: false`** skips that card's prompts entirely, and a list
  skips the named parts. That is ST's `forbid_overrides`, made per card.

Absent means *send everything*. Both toggles live in the session-settings panel,
and the card toggles also appear on each member's cast row, because that is
where a person looks when one character misbehaves.

Today these fields import into `actor.compat` with an
`import.card.wantsPromptOverride` warning (`card.ts:367`). P13 moves them into
sections the Scene pack places, and the warning goes. **00 §2.4 holds**:
assembly is still owned by the preset, and a pack that leaves the sections
unplaced sends none of them.

**Names in history** follow `speakers.namesInHistory`. The default `groups`
prefixes `Name: ` on each attributed message when the window holds two or more
speakers, and never on the user's line. That is ST's default names behaviour
(`openai.js:586`). Each message is its own assistant-role entry, and a narrator
message is a system-role entry with no name.

**Author's note** is `session.note`, rendered in history at `depth`, on every
`every`-th input. That is ST's `note_prompt`/`note_depth`/`note_interval`
(`authors-note.js:324`). Unlike the guidance box it persists, which is the
whole difference between the two.

**Example dialogue** is the existing `se.samples` block over `writingSamples`,
scoped to the speaker. ST's `mes_example` already imports there (`card.ts:306`).

### 1.6 The gestures, each onto the tree

The tree is append-only and a gesture that ST performs in place becomes a node.
**That is not a limitation to apologise for. It is [07](../07-branching.md)'s
design:** nothing a person did is lost, and the sibling strip shows it. Each ST
and Marinara verb has one form here:

| Gesture | ST / Marinara | Here |
|---|---|---|
| Send | new user message, then replies | a turn with `input`; speakers by policy |
| Empty send / *let them talk* | ST: a reply with the last message as activation text; Marinara: a new reply | a turn **with no input** (`input` becomes optional on `POST /turns`), speakers by policy |
| Force talk | member *speak*, `/trigger`, `forCharacterId` | the same, with `speakers: [id]` |
| Swipe (regenerate the last message) | a new swipe on the last message, by its author | a sibling carrying messages `0..k-1` (`carried: true`) and regenerating message *k* by the same speaker: `redoOf` + `fromMessage: k` |
| Regenerate the round | ST group: delete the batch, roll again | the existing redo/reroll: a sibling, speakers re-selected |
| Continue | append to the last message | a sibling whose last message is the old text plus the continuation (`continueOf`). The call ends on ST's *"continue your last message"* nudge (`openai.js:110`); provider prefill is later work |
| Edit | in place | a sibling **authored by hand**: `POST /turns` with `authored: { input?, messages? }`, no call, no `request`. The original stays a sibling |
| Delete | removes it | the head moves to the parent. The turn remains as a sibling nobody is on |
| Hide / unhide | `is_system`, `hiddenFromAI` | `session.hidden`: a turn or message indices. Mutable session state, like `lastSelectedChild`. History skips it and the transcript ghosts it |
| Impersonate | ST: a draft into the input box | as built (`turns/impersonate.ts`) |
| Stop | ST keeps the partial | as the runner does today, recorded at the gate |

**Swipes surface on the message, not the turn.** The sibling strip for siblings
that differ only from message *k* is drawn on message *k*. That is where ST
draws its counter, and where a person looks for it.

### 1.7 Greetings: an opening turn at creation

A new Scene session writes an **opening turn**: output-only, with no call and no
`request`. It holds one message per cast member that has a written opening:

- **Single-character.** The primary opening. Every alternate is a **sibling**,
  which is ST's greetings-as-swipes (`script.js:7651`) and Marinara's silent
  swipes.
- **Group.** Each member's primary opening, as one message each, in cast order.
  The alternates are chosen per member in the creation form, because siblings
  across *N* members would be a product.

Openings are rendered at write time with the session's names. `{{user}}` and
`{{char}}` are what greetings are written in.

This gives [P11](28-p11-implementation.md)'s *"`fromSeedId` has shipped since P1
with no writer anywhere… Unowned"* row an owner for the written half. Seeds stay
unowned.

### 1.8 The surface

**The transcript is a chat.** For each message:
- the speaker's portrait and name, and the persona's for the input;
- the reasoning, collapsed;
- the swipe counter on the message it belongs to;
- a ghost on hidden lines;
- actions: edit, continue, swipe, hide, branch.

A narrator message is drawn as one. The reading view names speakers from the
same field.

**The composer:**
- sending an empty box is *let them talk*;
- a **who-speaks-next** control forces a member;
- Impersonate stays.

**The cast panel** gains:
- add and remove, over `PUT /sessions/:id/cast`, which exists and has no client;
- mute (presence);
- talkativeness;
- *speak*.

**Session settings** gain voice, dispatch, policy, self-responses, names in
history and the author's note, as *"two visible controls with plain-language
labels, not a four-way enum"* (06 §7.2).

**Creation picks characters.** The form picks a persona only today
(`SessionsPage.tsx`), and every session it makes has an empty cast. Scene's form
picks one or more characters and each member's opening.

**Auto-mode** is ST's `auto_mode_delay`: while the page is idle, a client timer
submits *let them talk* turns, and typing stops it. It is client-side in both
sources and stays client-side here.

### 1.9 Marinara's agents, as steps and channels

*Moved into the phase 2026-09-29, by instruction; the first draft listed them
as not in Part A.* Read at the pin for this section:
`services/agents/agent-{pipeline,executor}.ts`, `routes/generate.routes.ts`'s
phases (`:4281-8150`), `services/generation/committed-tracker-context.ts`,
`db/schema/{game-state,agents}.ts`, and the catalogue in
`services/professor-mari/official-agent-knowledge.ts`. **The agents' own
manifests and default prompts are not in Marinara's repository.** They ship as
downloadable packages (`agent-registry.ts:36` starts empty,
`agent-prompts.ts:123` says so), so what is taken here is each agent's
*contract* (its input, its output shape as the code that applies it reads it,
and where its result goes), never its prompt.

**The design already said how.** [06 §6](../06-modes-and-turn-pipeline.md) is
explicit: *"This unifies 'agent' and 'pipeline stage'. Marinara's agents —
Narrative Director, Prose Guardian, Echo Chamber, tracker agents, Music DJ —
are all steps under this definition, differing only in stage and cadence."*
[06 §4](../06-modes-and-turn-pipeline.md) makes channels *"the generalisation of
Marinara's HUD widgets / trackers / game state"*.
[triage](02-triage.md) marks agent execution **REBUILD — "unify agent and
pipeline step"**, and the Secret Plot **PORT as a channel**. So every agent
below is a step, every piece of state it keeps is a channel, and the tree does
the rest: **a tracker value is an effect on the turn that produced it**, which
makes Marinara's whole `(chatId, messageId, swipeIndex)` snapshot keying, its
commit flag and its branch-copy of every snapshot (`chats.routes.ts:3904`)
something this build gets by construction.

#### 1.9.1 What already has an equivalent here

Half of Marinara's roleplay catalogue exists in this build under another name.
They are named so nobody builds them twice:

| Marinara agent | Here |
|---|---|
| expression (sprite per character) | `se.scene.stage` → `se.expression`, per actor ([P7.12](23-p7-implementation.md)) |
| background | the backdrop rendition and `se.location` ([P9.4](26-p9-implementation.md)) |
| illustrator | renditions ([P9](26-p9-implementation.md)) |
| knowledge retrieval, knowledge router | lore activation and retrieval ([P5](17-p5-implementation.md)) |
| lorebook keeper, long-term memory | the memory extractor writing the memory book ([P8](25-p8-implementation.md)) |
| chat summary | the summary chain ([P8](25-p8-implementation.md)) |
| CYOA choices | the suggester, `se.suggest` ([P7](23-p7-implementation.md)) |

#### 1.9.2 Trackers: model-proposed channels, one batched call

**Six trackers, as Scene channels**, each off until switched on, with value
shapes taken from the code that applies Marinara's results
(`generate.routes.ts:8243-8930`):

| Channel | Scope | Value | Marinara |
|---|---|---|---|
| `se.track.world` | session | `{ date, time, location, weather, temperature, fields: [{name, value}], recent: string[] }` | world-state |
| `se.track.character` | **actor** | `{ mood, appearance, outfit, thoughts, fields: [{name, value}], stats: [{name, value, max?}] }` | character-tracker |
| `se.track.persona` | session | `{ status, stats: [{name, value, max?}] }` | persona-stats |
| `se.track.quests` | session | `[{ name, description?, objectives: [{text, done}], notes? }]` | quest |
| `se.track.inventory` | session | `{ currencies: [{name, qty}], equipped: [{name}], carried: [{name, qty}] }` | inventory-tracker (and persona-stats' inventory) |
| `se.track.custom` | session | `[{ name, value }]` whose names a person defines | custom-tracker |

- **`update: 'model-proposed'`, and that is the line between this and
  Campaign.** [work plan §0](01-work-plan.md) puts *"the RPG channel library:
  HP and pools, attributes, inventory, quests…"* at **5.0**, and §0.4 says what
  that library is: `engine-computed` state, *"combat round maths, HP pools,
  inventory arithmetic, quest counters: Campaign's own TypeScript"*. These are
  the other thing: **what the story has established, as a model reading it
  reports**, with no arithmetic and no rules. A sword in `se.track.inventory` is
  there because the prose said the player picked it up. Nothing is pulled
  forward from 5.0, and 5.0 can still build the engine-computed library beside
  these without either knowing the other exists.
  [00 §4](../00-stance.md)'s *"RPG systems are opt-in channels"* holds: all six
  are off by default.
- **One post step, one call, every enabled tracker.** `se.scene.track` (post,
  `failure: 'warn'`, role `prose`, `stepRoles`-bindable) sends one structured
  call whose schema is the enabled channels' schemas side by side. This is
  Marinara's batching (`agent-pipeline.ts:76-142`: agents sharing a model share
  a call) and it is the answer to [25 C18](../25-open-questions.md)'s *"three
  `post` steps make three calls over the same prose"* for this case: six
  trackers are one call, not six. Its candidates are its own: the enabled
  channels' current values, the last few messages and the turn's output, never
  the scene prompt.
- **Whole-value `set`, which is all the effect path accepts**
  (`turns/effects.ts:67`). Each channel's new value replaces the old one, which
  is also what Marinara does (`custom-tracker` replaces its array; the inventory
  replaces each group it names). A group the model omits keeps its old value:
  *absent is not empty*, Marinara's rule (`generate-route-utils.ts:205`).
- **Locks.** A person can lock a field so the model cannot change it. Locks are
  a user-only channel, `se.track.locks` (a set of field paths), and the step
  writes a locked field's current value back into its proposal before
  proposing. Marinara restores locked values the same way
  (`applyTrackerFieldLocksToGameStatePatch`, `tracker-field-locks.ts:1043`).
  **Hidden fields** (a character's thoughts, say) are the channel's
  `visibility`, extended to a field list the same way.
- **In the prompt, as established state, once.** A new preset source,
  `{ of: 'state' }`, renders every enabled tracker, scoped values included, as
  one block: *"what the story has established as of the last message"*, placed
  before the history's last message. That is Marinara's placement and its
  wording's intent (`committed-tracker-context.ts:299`). The existing
  `{ of: 'channel' }` slot reads only unscoped keys (`collect.ts:1203`), which is
  why a new source rather than six channel slots: per-character state is scoped.
- **Cadence and manual mode.** Each session sets the step's `everyNTurns`
  (Marinara's `runInterval`), or switches trackers to **manual**: they then run
  only on *Update trackers*, which is the one on-demand step in this phase. It
  writes an **engine turn** carrying the step's call and its effects, exactly as
  a person's channel edit already writes one (`store.ts:1207`), so an on-demand
  update is branch-correct and undoable for free.
- **Editing.** A person edits any tracker value in the tracker panel; the edit
  is the existing `PUT /sessions/:id/channels/:key`, an engine turn with a
  `user` effect. What Marinara calls a *manual override* is simply the latest
  effect.
- **The surface.** A tracker panel: world, each present character, the
  persona, quests with checkable objectives, inventory, custom fields, with lock
  and hide per field. It needs two widget arms the build has deferred until a
  channel needed them: **`meter`** (a stat bar, [10 §8.0](../10-ui-surfaces.md)'s
  *"a `meter` arrives with the first numeric channel"*: this is it) and
  **`record`** (a structured value edited field by field). Both are
  `WidgetSpec` arms, so the rule that there is never an `html` field holds.

#### 1.9.3 The narrative director: a push, and a secret plot

**Push story.** Marinara's director runs only when the player arms it for one
turn, *natural* or *random* (`generate.routes.ts:3785-3827`). Here that is a
submission flag, `push: 'natural' | 'random'`, which arms an engine-owned `pre`
step, `se.scene.direct`. It makes one small call over its own candidates (the
recent messages, the secret plot if there is one) and writes a short direction.
**The direction reaches the prompt through the guidance slot**, which is where
[06 §5.1](../06-modes-and-turn-pipeline.md) already put it: *"one slot, several
producers… or a step such as a Narrative Director push"*. It goes through an
engine-only report cell, as the hook selector's guidance does
(`hook-selector.ts:117`), because a mode's step cannot write advisory text.
If the call fails, the pack's own fixed push text for that flavour stands in:
Marinara's individual group mode uses exactly such a fixed directive
(`generate.routes.ts:5754`). This is also **the first producer for
`StepCondition.armed`**, which [25 C17](../25-open-questions.md) records as
having none. The flag on the submission is the producer.

**Secret plot.** [06 §7.3](../06-modes-and-turn-pipeline.md): *"Hidden GM state
(… the Narrative Director's Secret Plot) is a channel with `visibility:
"hidden"` and a reveal affordance."* So: `se.plot.secret`, a hidden session
channel, `{ arc, protagonistArc, characterArc?, completed }` (Marinara's
`overarchingArc`, `director-secret-plot-runtime.ts`). A cadence step keeps it
(default every 8 story turns, Marinara's default), writing a fresh arc when
there is none or the last one completed. It reaches the narrator through a
channel slot placed with the system blocks. The reveal affordance is a panel
toggle that shows it to the player; off by default, since a plot the player can
read is not secret.

*The tension, stated rather than hidden.* [06 §7.3.2](../06-modes-and-turn-pipeline.md)
calls hooks *"the honest form of directedness, authored and selected in the
open"*, against *"a narrator improvising a pull"*, which is what a secret plot
is. It is opt-in, labelled as a model-kept hidden arc, and its every revision is
an effect a person can read in the workbench. That is as open as a secret can
be, and the triage verdict (PORT as a channel) already accepted the trade.

#### 1.9.4 The editor: style applies, continuity reports

Marinara merges prose guardian, continuity and immersive HTML into **one
combined editor call** after generation (`prose-guardian-settings.ts:135-220`),
which rewrites the message and keeps the original in the message's extras.

- **Style (prose guardian)** is built: a `post` step, `se.scene.edit`, run
  before the turn commits, with the session's banned words, avoid-instructions
  and style instructions. Its answer is Marinara's shape,
  `{ editNeeded, editedText, changes }`. When an edit is needed it replaces the
  message's text **before the turn is written**, so the turn's authored bytes
  are the edited ones. The unedited text stays where every raw model response
  already lives, the generate call's record, and the step outcome carries the
  `changes`. The transcript marks an edited message and offers the original.
  Under `per-actor` dispatch it edits each message on its own. *Hold for
  rewrite* (Marinara's default) is ours too: a round being edited streams to
  the transcript only once the edit is in.
- **Continuity** is built as **notices, not rewrites, by default.**
  [24 §2c.2](../24-roadmap.md) decided this for continuity in so many words:
  *"Emits notices, never effects… a checker confident enough to rewrite the
  story would be worse than the problem."* So continuity rides the same call and
  its findings appear as a checklist on the message, which is Marinara's own
  continuity UI (`ContinuityIssueChecklist.tsx`). Applying a finding is the edit
  gesture (§1.6), a sibling authored with the fix. A session setting
  `continuity: 'apply'` lets the editor apply its own findings, which is
  Marinara's behaviour, opt-in and labelled.
- **Immersive HTML is not built, and this one is a refusal.** It asks a model
  to emit markup that the client renders. [10 §8.0](../10-ui-surfaces.md)'s
  *"what must never happen is an `html: string` field"* and
  [06 §10.4a](../06-modes-and-turn-pipeline.md)'s *"annotate, never rewrite…
  no markup injected"* both rule it out, and the reason under both is that
  rendering model-authored HTML from this server's origin is a script-injection
  surface. Recorded so it is not re-proposed as a missing feature.

#### 1.9.5 The rest of the catalogue

- **Echo chamber** (side reactions from other characters, shown beside the
  chat): built as a panel fed by a cadence step, since it never touches the
  story. Off by default.
- **Beholder** (per-character body slots): folded into `se.track.character`'s
  custom fields rather than a seventh channel, which is what Marinara's own
  character tracker does for anything it has no field for.
- **Card-evolution auditor** (proposes edits to a character card): not built.
  A card is a library object with its own history and review flow
  ([03 §11](../03-data-model.md)); an agent proposing library edits from inside
  a session is the spoiler path [08 §6](../08-cross-session-memory.md) exists to
  close, and the memory extractor is this build's reviewed version of the idea.
- **Combat, Spotify, haptics**: combat is Campaign's (5.0);
  the others are [triage](02-triage.md)'s *"DISCARD from core"*.

#### 1.9.6 Agent configuration is session configuration

Marinara keeps `enableAgents`, `activeAgentIds` and per-agent connections in the
chat's metadata. Here: each tracker, the director, the secret plot, the editor
and the echo chamber are switches in the session's settings, grouped under
*Agents* because that is what a Marinara user will look for; their models are
the session's `stepRoles` at each step's id, which already exists
(`PUT /sessions/:id/roles`).

### 1.9a What is still not in Part A

- **Mixed voice within a turn** (C2). The record now holds it and nothing
  produces it.
- **Per-character hide** (`hiddenFromAICharacterIds`). It needs per-speaker
  history, which per-actor dispatch makes possible and this phase does not use.
- **Immersive HTML** and the **card-evolution auditor** (§1.9.4, §1.9.5).

### 1.10 Where equivalence stops short of parity

Stated so it is not re-litigated turn by turn, as 00 §4 asks:

- **The prompt is ours.** The behaviour is ST's: who speaks, what they see,
  whose card leads, where the card's own instructions go. The strings,
  separators, story string and instruct templates are not ST's. An imported
  ST preset converts as P4 built it.
- **No slash commands.** Every verb they reach is a control (§1.6).
- **Edits are branches** (§1.6).
- **Card-swapping is not reproduced.** SWAP's effect is: a pack scopes its
  card blocks to the speaker.

---

# Part B — session import into Scene

## 2 — The decisions

### 2.1 One shape for every path: foreign → `SessionExport` → `importSession`

Every entry point ends in `importSession(context, handle, document)`:
- a folder sweep;
- a zip;
- a Marinara profile;
- one uploaded `.jsonl`.

`importSession` already mints the session id, stamps `origin`, marks turns
`foreign`, refuses a collision and indexes. The backup import
(`backup/import.ts:305`) is the precedent.

**The converters are pure**: `(chats, resolution) → { documents, items }`, with
no I/O. What the library knows arrives as `resolution` (§2.5).

### 2.2 A round is a turn

The mapping follows §1.1 exactly, so an import is a session Part A could have
produced:

| Messages | Turn |
|---|---|
| a user message, then the character messages until the next user message **or the next ST `gen_id`** | one turn: `input` + `output.messages` |
| character messages with no user message before them (greetings, auto-mode, force-talk, a Marinara empty send) | output-only |
| a user message with no reply | input-only |
| a narrator line (ST `extra.type: 'narrator'`, Marinara `role: 'narrator' \| 'system'`) | a `speaker: null` message in the round it falls in |

`gen_id` is ST's own batch marker: one group generation shares one
(`group-chats.js:988`). A force-talked member after a round is a new batch, so
it becomes its own output-only turn, exactly as Part A would record it. Where
there is no `gen_id` (single chats, Marinara), consecutive character messages
fold into the round.

`input.kind` is `do`, verbatim in every shipped pack. `input.actorId` is the
persona when resolved. `status: 'complete'`, `effects: []`, `tape: []`, and
nothing fabricated.

### 2.3 Swipes are siblings from the message they belong to

A swipe of message *k* in a round is a sibling turn carrying messages `0..k-1`
and holding the swipe at *k*. This is §1.6's swipe, read backwards.

- The active swipe's text is `mes` or `messages.content` (§0.3).
- `lastSelectedChild` names the active sibling.
- Continuations hang off the active swipe only, because that is where the
  source hung them.
- A swipe array left on an older message (ST keeps them) becomes leaves, because
  nothing ever followed them.

ST's greetings-as-swipes on message 0 become sibling opening turns, which is
§1.7.

### 2.4 Turn identity: a trie over *(account, family, parent, content)*, printed as uuidv7

```
id = uuidv7Shaped( time, H(account, familyKey, parentId, input, messages) )
```

- **Content and parent, not position.** Chats in one family that share a
  prefix produce the same ids for it, so the prefix collapses into one path.
  Each branch forks where it actually diverged, including a branch copy that
  was edited before its fork point. §0.1's family reconstruction falls out of
  identity.
- **The account is in the hash.** `sessionHoldingTurns` looks turn ids up across
  the whole index (`index-db/sessions.ts:368`). Without the account, a second
  person importing the same chat would be refused `already-here`, and would
  learn that somebody else has it.
- **uuidv7-shaped**, because `exportSession` sorts by id and `importSession`
  appends in file order. `time` is the send time, forced strictly above the
  parent's: both sources hold send times that repeat or run backwards
  (`st-chat.importer.ts:89`).
- **Deterministic**, so re-importing an unchanged chat finds every turn already
  present, which is `unchanged` in the ledger. ~~A chat that grew since it was
  imported cannot be imported again… a one-shot copy, not a sync~~ — *reversed
  2026-09-29, by instruction*: a chat that grew **extends** the session it was
  imported into. See §2.7; this identity scheme is what makes it cheap.

### 2.5 Families, branch refs, resolution

**A family** is a chat and every chat that points back to it:
- ST: `main_chat`, within a character folder or a group's `chats`;
- Marinara: `branchParentChatId`.

A pointer to a chat that is not in the source makes the pointing chat a root of
its own, with a note. One family becomes one session:
- each chat is a `BranchRef`;
- the head is the root chat's head;
- unlinked chats stay separate sessions, even when they open on the same
  greeting.

**Resolution** finds library objects through `priorImportId`
(`import/identity.ts:80`), the re-import rule's own lookup. If that fails it
falls back to an exact, **unique** name match. Nothing is invented; what is not
found is a note.

| Foreign reference | Tried |
|---|---|
| ST character, single chat | folder → `characters/<folder>.png`, then `<folder>.png` |
| ST character, group | each line's `original_avatar` → the same two forms, plus `groups/<id>.json` `members` for the roster |
| ST persona | a user line's `force_avatar` thumbnail `file=` → `User Avatars/<file>`, else `chat_metadata.persona` |
| ST chat lorebook | `chat_metadata.world_info` → `worlds/<name>.json` |
| Marinara character | `storage/tables/characters.json#<characterId>` |
| Marinara persona | `storage/tables/personas.json#<chat.personaId>` |

A resolved speaker becomes `speaker: { id, name }`. An unresolved one keeps
`{ id: <foreign id>, name }`, which `Ref` shows by name and flags as missing
(`schema/common.ts:43`). The transcript keeps its names either way.

### 2.6 What maps onto the Scene settings

| Source | Here |
|---|---|
| ST `activation_strategy` 0–3 | `speakers.policy`: natural, list, manual, pooled |
| ST `allow_self_responses` | `speakers.allowSelfResponses` |
| ST `disabled_members`, Marinara `inactiveCharacterIds` | presence `false` (muted) |
| ST `generation_mode` SWAP / APPEND | recorded. The pack's speaker scoping is the equivalent, and it is a pack choice, not a session one |
| Marinara `groupChatMode` individual / merged | `dispatch` per-actor / merged |
| Marinara `groupResponseOrder` sequential / manual / smart | `list` / `manual` / `smart` |
| Marinara `groupSpeakerNamesInHistory` | `namesInHistory` |
| ST `note_prompt` / `note_depth` / `note_interval` | `session.note` |
| ST `is_system` lines, Marinara `hiddenFromAI` | **imported, and hidden** (`session.hidden`), no longer dropped |
| ST `/comment` lines | a hidden narrator message |

**Marinara's agent state comes too** (§1.9):

| Marinara | Here |
|---|---|
| `game_state_snapshots` row for a message's swipe | effects on the turn holding that message, one per enabled tracker channel, `proposedBy: engine`; the snapshot keying *is* the tree's |
| `activeAgentIds`, `manualTrackers`, `narrativeDirectorSecretPlotEnabled`, prose-guardian settings | the session's agent switches (§1.9.6) |
| `agent_memory` `overarchingArc` | `se.plot.secret` on the root chat's head turn |
| field locks, hidden tracker fields | `se.track.locks` and the channels' hidden fields |
| `extra.proseGuardianOriginalText` | nothing to carry: the imported text is the edited one, and the original is noted |

Everything else is a note, never silence:
- ST chat variables, Marinara rolling summaries, reactions;
- attachments without bytes;
- `extra.api`/`model`/`token_count`. A `TurnRequest` built from three of its
  fields is a fabrication of the other twenty.

**Marinara `conversation` and `game` chats stay recorded**; Part B imports
`roleplay`. **Chat-scoped lorebooks** link as `global` books
([18 §4.4](../18-session-import.md)).

### 2.7 Sync: a re-import extends the session it came from

**It is the library's re-import rule, applied to a session.** The library
decides *same object* by *"same owner, same kind, same
`Provenance.originalFilename`"* (`import/identity.ts:21`). A session gets the
same rule. The converter stamps `origin.originalFilename` with the family's
**root chat path**: ST's `chats/<folder>/<file>.jsonl` or
`group chats/<id>.jsonl`, or Marinara's `storage/tables/chats.json#<chatId>`.
A later import of the same account and the same root finds that session through
the index and **extends it** instead of refusing.

**Extending is append-only, and §2.4's identity is why that is enough.** A
turn's id is its account, family, parent and content. So:

- every message the chat already had is a turn already present, and is skipped;
- every new message is a turn whose parent is present, and is appended;
- a message **edited** in the source since the last import is a new node
  beside the old one — the edit becomes a branch, as §1.6 says edits are;
- a new branch chat in the family is a new `BranchRef`, and a new swipe is a
  new sibling.

Nothing already in the session is rewritten. The tree only grows, which is the
only way [07](../07-branching.md) lets it change.

**What sync does not do, and says so:**

- **Deletions in the source are not deletions here.** A message deleted in ST
  leaves its turn in the session. The import notes it, and the head does not
  follow a path the source no longer has.
- **It does not move the person.** The session's head, `lastSelectedChild` and
  refs made in StoryEngine are left alone if the person has played on here
  since the last import. The source's new head gets its own ref, named for the
  chat. Only a session nobody has touched since its import follows the source's
  head, which is the case where following is plainly what was meant.
- **Turns played here are never compared with the source.** Their ids come from
  the runner, not the trie, so they cannot collide and are not candidates.
- **Hidden flags** are taken from the source for imported turns only, so an
  unhide in ST arrives and a hide made here stays.
- **One direction.** Nothing is written back to SillyTavern or Marinara.

**The write path.** `importSession` gains an `extend` arm. It runs under the
target session's lock, appends in the document's order (parents first, by
§2.4's uuidv7 ordering), then merges refs and hidden flags. It answers with
`{ ok: true, sessionId, appended }`, and `appended: 0` becomes `unchanged` in
the ledger. The `already-here` refusal stays for its original case: an export
from this install being loaded back, where there is no source to extend from.

**How a person triggers it:** the same doors as a first import. Re-running a
folder sweep or a server-path import brings every grown chat up to date. Play's
session menu gains *Update from source* on an imported session, which offers
the file picker (a browser cannot reopen a path) or re-sweeps the server path
recorded in the ledger when the import came from one.

### 2.8 A phase, and a branch that is not `p13`

It is filed as a phase for P12's reason, and because it changes the frozen turn
record. ***The branch is `claude/sillytavern-marinara-import-id4eim`***, by
instruction.

---

## 3 — Stages

*Depends on:* nothing unbuilt. The order is Part A and then Part B, because an
import is only as good as the mode it lands in. Groups are not a late stage;
they are the general case throughout (00 §2.10).

### Part A

#### P13.0 — Corrections and the record

- 18 §7 corrected to §0.
- [P7B §0.3](24-p7b-presets-and-prompts.md) and the `store.ts:1937` docstring
  corrected (§0.6).
- **The record.** `Turn.output.messages` (§1.1); the session fields (§1.2);
  `StepCallRequest.speaker`; `StepResult.messages`. The export round-trip test
  carries all of them through.

*Ends at:* a turn with three attributed messages and a hidden index exports and
imports unchanged, and a pre-P13 Scene session reads as narrator/merged/fixed.

#### P13.1 — Who replies

- `speakers.ts`'s arms to ST's behaviour (§1.3), every draw on the tape.
- `castIsPresent` and muting.
- Talkativeness in `modeData`.
- Force-talk on submission.
- **Smart order** (§1.3a):
  - `se.speakers.smart` and its rules-first pre-pass;
  - the engine cell into `StepInput.speakers`;
  - the fallback, and rewrite carrying the speakers.

*Proof obligation:*
- each arm against a table transcribed from `group-chats.js`;
- a replayed turn picking the same speakers;
- for `smart`, with a stubbed provider:
  - mentions, force-talk and a single eligible member make **no** call;
  - an ineligible id, a name, an empty array and a thrown call each land on the
    tape's `natural` pick, with a warned outcome;
  - a rewrite makes no call and keeps the speakers.

#### P13.2 — Per-actor dispatch

- The generate step's loop (§1.4) and assembly re-scoped by `speaker`.
- The three macros; `speaker`/`others` block scopes.
- In-turn history; cleanup; per-message streaming; partial rounds.

*Ends at:* a three-member `list` round produces three messages, and the third
prompt holds the first two replies.

#### P13.3 — The Scene pack and the card's own fields

- `SCENE_PRESET` rewritten (§1.5).
- ST import moves `system_prompt`, `post_history_instructions` and
  `depth_prompt` out of `compat` into sections, and `talkativeness` into
  `modeData`. Existing imports pick this up on re-import.
- Names in history; the author's note; the hidden filter.
- `mode.test.ts`'s narrator pin becomes a pin on the declared values and the
  pack agreeing with them.

*Ends at:* a preview of an imported ST card's session shows the card's system
prompt stacked after the pack's instruction and its post-history instructions last,
and a second preview with that card's prompts switched off shows neither.

#### P13.4 — The gestures

- `input` optional on `POST /turns`, plus `speakers`, `fromMessage`,
  `continueOf` and `authored`.
- The hide routes.
- The opening turn at creation (§1.7).

*Ends at:* every row of §1.6's table has a route test, and a new session opens
on its greeting with the alternates as siblings.

#### P13.5 — The chat surface

- The transcript, composer, cast panel, settings and creation form (§1.8).
- Auto-mode.

*Ends at:* the gate's first sitting (§4) can be walked.

### Part B

#### P13.5a — Trackers

- The six `se.track.*` channels and `se.track.locks` (§1.9.2).
- `se.scene.track`: one batched structured call, locks written back, absent
  groups kept, cadence and manual mode.
- The `{ of: 'state' }` preset source and its place in the Scene pack.
- *Update trackers*: the on-demand engine turn.
- The `meter` and `record` widget arms and the tracker panel.

*Ends at:* with world, character and inventory switched on, a turn whose prose
moves a character to the docks and hands the player a key proposes all three;
a locked location stays put; a swipe of that turn has its own tracker state;
the next prompt shows the established state once.

#### P13.5b — The director and the secret plot

- `push` on submission, `se.scene.direct` armed by it, guidance through the
  engine-only cell, the pack's fixed push text as the fallback.
- `se.plot.secret`, its cadence step, its slot, the reveal toggle.

*Ends at:* a pushed turn's record shows the direction it was given; a failed
direction call falls back to the fixed text and says so; the secret plot is in
the prompt and not in the transcript until revealed.

#### P13.5c — The editor and the echo chamber

- `se.scene.edit`: style edits applied before commit, per message, with the
  original in the call record and the transcript's *show original*.
- Continuity findings as a checklist, applied through the edit gesture;
  `continuity: 'apply'` opt-in.
- The echo chamber panel and its cadence step.

*Ends at:* a banned word in a reply is edited out before the turn is written,
and the message offers the original; a continuity finding applied from the
checklist is a sibling.

#### P13.6 — The chat tree builder

`import/chat/` is source-neutral and pure. It holds `ChatMessage`,
`ChatFamily`, and `buildSession(family, resolution, account)` →
`SessionExport` + notes. The build covers rounds (§2.2), swipes (§2.3), ids
(§2.4), families and refs (§2.5), and settings (§2.6).

*Proof obligation* is a set of property tests over generated families, because
hand-written fixtures are linear:
- shared prefixes collapse;
- parents precede children in id order;
- the same input gives byte-identical output;
- two accounts produce disjoint ids.

#### P13.7 — SillyTavern JSONL

The parser handles:
- header detection, including headerless old group files;
- `parseTimestamp` ported from `utils.js:1096`: epoch, ISO,
  `June 19, 2023 2:20pm`, and the three `@h m s` forms;
- `mes` over the stale swipe;
- `swipe_info` per swipe;
- `gen_id` batches, narrator, comment and hidden lines;
- the `marinara_*` extras (§0.4).

#### P13.8 — Resolution and the doors

- `import/chat/resolve.ts` (§2.5), with note keys under `import.chat.*`, where
  `note-labels.test.ts` scans them.
- **The sweep** gains a session pass after the library loop, so a tree of cards
  and chats resolves against the cards it just wrote. `chats`, `group chats`
  and `groups` become `converted`.
- **The browser folder upload** makes chats opt-in. They are most of an ST
  tree's bytes.
- **One file.** `readUpload` learns JSONL, and Play's *Import session* takes
  `.jsonl`.
- The surface says once what an update from source does and does not do (§2.7).

#### P13.9 — SillyTavern families and groups

- `main_chat` families, branch of branch, missing parents, checkpoints.
- `groups/<id>.json`, with its strategy, self-responses and muted members, onto
  §2.6.

*Ends at:* a fixture folder with a chat, a branch, a branch of the branch and a
checkpoint imports as one session with four refs and the prefix once. A
three-member group imports with each round's messages attributed.

#### P13.10 — Marinara

- Over the reader's `#rows`: `chats` filtered to `roleplay`.
- `messages` ordered `(createdAt, id)` (`chats.storage.ts:963`).
- `message_swipes` by `messageId`/`index`, with §0.3's rule for the active one.
- `characterId` as speaker.
- `hiddenFromAI`, families, and the group settings onto §2.6.
- `game_state_snapshots` onto tracker effects, `agent_memory`'s secret plot,
  and the agent switches (§2.6).

The profile archive, data root and v1 profile come in through the sweep. The
per-chat JSONL export comes in through P13.7.

#### P13.10a — Sync

- `origin.originalFilename` stamped with the family's root path.
- `importSession`'s `extend` arm, under the session lock.
- Ref, head and hidden merging by §2.7's rules.
- *Update from source* in Play.

*Ends at:* a fixture chat imported, grown by three messages, an edit and a new
branch, and re-imported. The session gains exactly those turns, one new
sibling and one ref. A session played on here in between keeps its head.

#### P13.11 — The first turn after a long import

`ensureChain` is lazy and sequential (`sessions/summaries.ts:213`). After
`importSession`, a background warm derives the head path's chain outside any
turn job, reporting on the event bus. It is safe to race a turn: link keys never
include text, so a duplicate derivation costs one call and changes no key.

*Ends at:* a long fixture's first previewed turn derives zero links.

#### P13.12 — The corpus and the gate test

- A fixture pair per source in the `fixture-pair` project (`FIXTURE_PAIR`
  becomes a list). Each sweeps cards and chats, opens the session, previews a
  turn, and asserts the history carries names and the speaker's card leads.
- One 10,000-message size test, because nobody has measured `importSession`
  turn by turn.

### What is deliberately not in this phase

- **Immersive HTML and the card-evolution auditor** (§1.9.4, §1.9.5).
- **Mixed voice** (C2), and per-character hide.
- **`LoreScope`'s chat arm** ([18 §4.4](../18-session-import.md)).
- **Aventuras `.avt`.**
- **Backfilling cross-session memory from imported history.** The extractor
  reads only the eight turns since it last ran (`memory/extract.ts:345`).

---

## 4 — The exit gate

### 4.1 The critical list

Walked before the phase closes, by [manual testing §0](05-manual-testing.md)'s
criterion:

1. **A single-character chat, played from creation.** The greeting shows and
   swipes to its alternates. Swipe, continue, edit, hide and impersonate each
   behave like the thing a person who uses ST expects them to be.
2. **A three-character group, played.** Natural activation picks plausible
   speakers, and force-talk and *let them talk* work. **Played again on
   `smart`**, where a person judges whether its picks beat natural's often
   enough to be worth the call. Each message names its
   speaker, and nobody writes another member's lines.
3. **A real SillyTavern data folder imported**, then played one turn. A branched
   chat is one session. A group keeps its members, strategy and muted members.
4. **A real Marinara profile imported**, then played one turn, with its
   trackers: the imported state is what Marinara showed, and the next turn
   updates it.
5. **Trackers, a push and the editor on a Scene played from scratch.** A person
   judges whether the tracked state is right often enough to be worth its call,
   whether a push moves the story, and whether an edited message reads better
   than its original.

### 4.2 The remainder — extends the standing list

- *Update from source* is understood by somebody who has not read §2.7, including
  why a message deleted in SillyTavern is still here.
- The narrated setting still produces what Write's falsification test
  ([13](../13-write-mode.md)) assumes Scene produces.
- Auto-mode stops when it should.
- A 10,000-message import's first turn after the warm feels like any other
  turn.
