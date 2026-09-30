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
  original?: string;     // the text as the model returned it, when cleanup or the editor changed it
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

*Corrected 2026-09-29, at P13.0:* `policy` is typed as the SDK's
`ParticipantPolicy['select']`, which **keeps `fixed`** where the sketch leaves
it out. Three things need it: Scene declares `select: 'fixed'` until P13.1
changes it, creation writes the mode's declared value, and the reading of a
pre-P13 session below is narrator/merged/**fixed**. `smart` joins the union at
P13.1, which builds it. And `note.every` of 0 or less is a note switched off
with its text kept, which is ST's `note_interval <= 0` (`authors-note.js:351`),
so §2.6 copies the value across as it is.

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
  none the last message (`group-chats.js:990-1000`). Then
  (`activateNaturalOrder`, `:1242-1316`):
  1. every eligible member one of whose name's words is a word of the activation
     text speaks, in the order the words appear;
  2. every member, in shuffled order, speaks if a talkativeness roll succeeds
     (`talkativeness >= roll`), so a mentioned member can be picked twice and
     is de-duplicated;
  3. if still nobody, one random member with talkativeness above zero speaks
     (anyone, if nobody has any).

  **On a turn with no input only**, the last message's speaker is excluded
  unless `allowSelfResponses`: ST bans them only when the round was not
  started by the player (`:1245`). ST matches words with ASCII `\w`, so a
  name outside it matches badly: ~~a name like *Zoë* never matches~~
  (*corrected at P13.1*: *Zoë* reads as `zo` and so matches "Zo" and "Zoé"
  too; *Renée* reads as `ren` and a lone `e`; Cyrillic, Greek and CJK names
  are never found). Ours matches Unicode letters and digits, a deliberate
  difference. **Talkativeness**
  lives at `actor.modeData['storyengine.scene'].talkativeness`, default 0.5. It
  is participation, not prompt, so it belongs in `modeData`: the card schema's
  *"prompt assembly is owned by the preset"* exclusion (`actor.ts:158`) is about
  the other kind. ST's `talkativeness` imports there (§3, P13.9).
- **`list`**: everyone eligible, once each, in cast order. This is ST's LIST and
  Marinara's `sequential`.
- **`pooled`**: one member. After an input, anyone at random. On a turn with
  no input, one who has not spoken since the last input, else anyone but the
  last speaker (`activatePooledOrder`, `:1197-1231`: its scan back stops at
  once when the round has user input).
- **`manual`**: nobody replies to an input. Replies are asked for by force-talk
  (§1.6). A turn with **no** input (*let them talk*, auto-mode) gets one random
  eligible member, which is ST's (`:1029-1031`); Marinara's manual does nothing
  there, and a *let them talk* that silently does nothing is the failure §1.3a
  refuses for `smart` too.
- **Force talk** overrides every policy. A submission may name
  `speakers: [actorId]`: ST's member *speak* button and `/trigger`, and
  Marinara's `forCharacterId`. It reaches **muted** members too, as ST's does
  (`force_chid` bypasses `disabled_members`, `:1005`), but never the dead or
  departed, and never the persona.

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

   ~~The raw reply stays in the call record, which is where an unmodified model
   response already lives.~~ *Corrected 2026-09-29: it does not.* `ModelCall`
   records the prompt, parameters, usage and outcome and never the reply
   (`shared/src/turn.ts`, `ModelCall`); the reply lives only in the output. So a
   message whose text cleanup changed keeps what the model returned in
   `OutputMessage.original` (§1.1), written only when the two differ.
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
agent work (`:3785-9786`: arming and cadence to `:4278`, the phases from
`:4575`, results applied `:8054-9610`, the text-rewrite editors `:9630-9786`), `services/generation/committed-tracker-context.ts`,
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

**Six trackers, as Scene channels**, each off until switched on. The value
shapes are Marinara's stored ones, read from the code that applies its results
(`generate.routes.ts:8243-8930`) and the types and helpers it calls
(`shared/src/types/game-state.ts:54-164`, `utils/quest-state.ts`,
`generate-route-utils.ts:205-330`), with field names made ours where noted:

| Channel | Scope | Value | Marinara |
|---|---|---|---|
| `se.track.world` | session | `{ date, time, location, weather, temperature, fields: [{name, value}], recent: string[] }` | world-state (`worldCustomFields`, `recentEvents`) |
| `se.track.character` | **actor** | `{ mood, appearance, outfit, thoughts, fields: Record<string, string>, stats: [{name, value, max, color?}] }` | character-tracker (`PresentCharacter`, `game-state.ts:54`) |
| `se.track.persona` | session | `{ status, stats: [{name, value, max, color?}] }` | persona-stats |
| `se.track.quests` | session | `[{ name, stage?, objectives: [{text, completed}], completed }]` | quest (stored `QuestProgress`, `game-state.ts:158`) |
| `se.track.inventory` | session | `{ currencies: [{name, qty?}], equipped: [{name, qty?}], inventory: [{name, qty?}] }` | inventory-tracker; persona-stats' own `InventoryItem`s fold into `inventory` |
| `se.track.custom` | session | `[{ name, value }]` whose names a person defines | custom-tracker |

- **`update: 'model-proposed'`, and that is the line between this and
  Campaign.** [work plan §0](01-work-plan.md) puts *"the RPG channel library:
  HP and pools, attributes, inventory, quests…"* at **5.0**, and §0.4 says what
  that library is: `engine-computed` state, *"combat round maths, HP pools,
  inventory arithmetic, quest counters: Campaign's own TypeScript"*. These are
  the other thing: **what the story has established, as a model reading it
  reports**, with no arithmetic and no rules. A sword in `se.track.inventory` is
  there because the prose said the player picked it up. No engine-computed
  mechanics come forward from 5.0. ~~5.0 can still build the engine-computed
  library beside these without either knowing the other exists.~~
  *Corrected 2026-09-29:* it cannot, and must not. 06 §4 treats inventory,
  quests, clock and weather as **one** set of channels a mode enables, and
  [00 §2.7](../00-stance.md) rejects exactly the split Marinara has between
  roleplay trackers and Game HUD widgets. So these are the subjects' channels,
  and **5.0 inherits them**: Campaign's library changes the update policy of
  the ones it makes mechanical (`engine-computed`, *model proposes, engine
  decides*, 06 §4) and adds the ones with no narrative counterpart (HP pools,
  combat). That is a channel migration 5.0 owns, recorded here so it is
  planned rather than discovered.
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
  and hide per field. It needs two widget arms: **`meter`**, a stat bar, which
  the build deferred until a channel needed it
  ([10 §8.0](../10-ui-surfaces.md)'s *"a `meter` arrives with the first numeric
  channel"*: this is it), and **`record`**, a structured value edited field by
  field, which is new here. Both are `WidgetSpec` arms, so
  [10 §8.1](../10-ui-surfaces.md)'s *"what must not happen is the vocabulary
  quietly acquiring an `html: string` field"* holds.

#### 1.9.3 The narrative director: a push, and a secret plot

**Push story.** Marinara's director *push* runs only when the player arms it
for one turn, *natural* or *random* (`generate.routes.ts:942-945, 3819-3826`;
the client clears the flag after one use). Its other run, secret-plot upkeep,
is on a cadence and is the next paragraph. Here that is a
submission flag, `push: 'natural' | 'random'`, which arms an engine-owned `pre`
step, `se.scene.direct`. It makes one small call over its own candidates (the
recent messages, the secret plot if there is one) and writes a short direction.
**The direction reaches the prompt through the guidance slot**, which is where
[06 §5.1](../06-modes-and-turn-pipeline.md) already put it: *"one slot, several
producers… or a step such as a Narrative Director push"*. It goes through an
engine-only report cell, as the hook selector's guidance does
(`hook-selector.ts:117`, the cell at `runner.ts:515`), because the guidance
slot is the engine's: a step's own candidates are appended after the preset's,
so a step can add advisory words but cannot fill the slot the pack positioned.
If the call fails, the pack's own fixed push text for that flavour stands in:
Marinara's individual group mode uses exactly such a fixed directive
(`generate.routes.ts:5754`). This is also **the first producer for
`StepCondition.armed`**, which [25 C17](../25-open-questions.md) records as
having none. The flag on the submission is the producer.

**Secret plot.** [06 §7.3](../06-modes-and-turn-pipeline.md): *"Hidden GM state
(… the Narrative Director's Secret Plot) is a channel with `visibility:
"hidden"` and a reveal affordance."* So: `se.plot.secret`, a hidden session
channel, `{ description, protagonistArc, characterArc?, completed }`
(Marinara's `overarchingArc`, `director-secret-plot-runtime.ts`). A cadence
step keeps it, writing a fresh arc when there is none or the last one
completed, and a second pass immediately when a pass completes one. The
default is every **4 story turns**: Marinara's default is 8 *messages*, user and
assistant counted together, which is about four rounds. It reaches the narrator through a
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
  are the edited ones. The unedited text is the message's `original` (§1.1),
  written only when the editor changed something; ~~it stays in the generate
  call's record~~ (*corrected: the call record holds no reply text*). The step
  outcome carries the `changes`. The transcript marks an edited message and offers the original.
  Under `per-actor` dispatch it edits each message on its own. *Hold for
  rewrite* (Marinara's default) is ours too: a round being edited streams to
  the transcript only once the edit is in.
- **Continuity** is built as **notices, not rewrites, by default.**
  [24 §2c.2](../24-roadmap.md) decided this for continuity in so many words:
  *"Emits notices, never effects… a checker confident enough to rewrite the
  story would be worse than the problem."* So continuity rides the same call and
  its findings appear as a checklist on the message they are about. That
  placement is ours: Marinara lists them in a chat-wide HUD menu
  (`ContinuityIssueChecklist.tsx`, rendered from `RoleplayHUDActionsMenu.tsx`)
  after its editor has already applied them. Applying a finding is the edit
  gesture (§1.6), a sibling authored with the fix. A session setting
  `continuity: 'apply'` lets the editor apply its own findings, which is
  Marinara's behaviour, opt-in and labelled.
- **Immersive HTML is not built, and this one is a refusal.** It asks a model
  to emit markup that the client renders. [10 §8.1](../10-ui-surfaces.md) (the
  widget vocabulary must never acquire *"an `html: string` field"*) and
  [10 §13.1](../10-ui-surfaces.md), which 06 §10.4a applies (*"annotate, never
  rewrite"*: the message text stays plain prose with no markup injected), both
  rule it out, and the reason under both is that
  rendering model-authored HTML from this server's origin is a script-injection
  surface. Recorded so it is not re-proposed as a missing feature.

#### 1.9.5 The rest of the catalogue

- **Echo chamber** (side reactions from other characters, shown beside the
  chat): built as a panel fed by a cadence step, since it never touches the
  story. Off by default.
- **Beholder** (per-character body slots: worn, holding, wounds): folded into
  `se.track.character`'s `fields` rather than a seventh channel. That is our
  choice, not Marinara's, which keeps it as its own agent with typed state
  (`beholder-state.ts`); a field map per character carries the same facts
  without a second per-actor tracker to keep in step with the first.
- **Card-evolution auditor** (proposes edits to a character card): not built.
  A card is a library object with its own version history
  ([03 §11](../03-data-model.md)), and a session copies from it when it is
  made (03 §11.4). An agent editing the card from inside a session would carry
  that session's events into every later session made from it: the same
  spoiler bleed [08 §6](../08-cross-session-memory.md) designs against for
  memory, by a route 08 §6 does not cover. The memory extractor, reviewed and
  scoped, is this build's version of the idea.
- **Combat, Spotify, haptics**: combat is Campaign's (5.0);
  the others are [triage](02-triage.md)'s *"DISCARD from core"*.

#### 1.9.6 Agent configuration is session configuration

Marinara keeps `enableAgents` and `activeAgentIds` (and `manualTrackers`, the
secret-plot switch and the prose-guardian settings) in the chat's metadata;
its per-agent connections are global, on `agent_configs.connection_id`, not
per chat. Here: each tracker, the director, the secret plot, the editor
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

*Made exact at P13.6 (`import/chat/ids.ts`), 2026-09-29.* `messages` means each
message's **speaker key and text** and nothing else: never a resolved library
id (a card imported later must not move an id), never `carried` or `hidden`
(both say how a node was reached or shown, not what it is; hashing `carried`
split one swipe into two siblings when two chats showed different swipes, and
the review caught it). `familyKey` is the root chat's bare path, the same
string §2.7 stamps as `origin.originalFilename`. `time` is the **round's**:
the player's line's send time, or for an output-only round the earliest time
among its opening line's swipes, so a round and every swipe sibling of it
share one time and switching the active swipe in the source moves no id; it is
then forced above the parent's.

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
| `activeAgentIds`, `manualTrackers`, `narrativeDirectorSecretPlotEnabled`, prose-guardian settings | the session's agent switches (§1.9.6). Agent *models* are global in Marinara, not per chat, so they are not imported; a note names them |
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

**The open case, found at P13.6: a chat that grew *inside* its last round.**
A round is one turn and its id hashes the whole round, so a group round that
gains a fourth reply, or a player's line that gets its reply after the import,
is a **different** node from the one imported, and a plain re-import writes it
as a sibling beside the old round rather than extending it. Two ways out, for
P13.10a to choose between with a test for each: key a round on its opening
(the input and the first reply) and let later replies extend it in place,
which gives up a little of §2.4's *identical content, identical id*; or accept
the sibling, name it for what it is (*the round as it now stands*) and move the
head onto it when the person had not played on. The builder's tests pin the
current behaviour (`import/chat/build.test.ts`) so the choice is made on
purpose.

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

*As built, 2026-09-29.* §1.4 left these to the stage, and got one of them
slightly wrong; each is recorded where the code carries its argument.

- **`{{notChar}}` is the persona and every other member, muted ones included.**
  ST's documented meaning is *"all participants except the current speaker"*
  (`env-macros.js:45-50`), but its group branch builds it with the user dropped
  and muted members excluded (`MacroEnvBuilder.js:137`, `:194`). Ours keeps the
  documented meaning, because *"do not write for {{notChar}}"* is the sentence
  the macro exists for. `{{group}}` is the whole cast, muted included, and
  `{{charIfNotGroup}}` its alias, as in ST. The three are always in the
  namespace, counted from `char` — the speaker on a speaking call, the first of
  the cast otherwise (`assembly/template.ts`). *Review, 2026-09-29*: on a call
  that speaks for nobody, `{{notChar}}` is the persona alone — ST's solo-chat
  meaning. Counted from the first of the cast it named everyone but them, and
  it reaches narrator calls, because the importer keeps an ST preset's
  `{{notChar}}` as written; before P13.2 it rendered empty there. So narrator
  output is byte-identical for a pack that never spells it, and a pack that
  does now reads the persona (`assembly/collect.ts`, `renderContextOf`, pinned
  in `collect.test.ts`).
- **The speaker's cards come first, and that is ours, not ST's.** §1.4 calls
  it ST's `APPEND` without the string-joining, but `APPEND` joins in member
  order and drops muted members unless the group says `APPEND_DISABLED`
  (`group-chats.js:549-558`); here every card stays and only the order moves.
  *Review, 2026-09-29*: **muted (presence-`false`) members' cards are kept
  too**, which contradicts §1.4's *"every present card"* (presence as §1.3
  defines it) and §1.10's *"what they see is ST's"* — ST's `collectField` and
  Marinara's `resolveActiveCharacterIds` both leave a muted member out. It is
  so because the collector reads no presence, and Scene declares no
  `castIsPresent` until P13.3, so *muted* cannot yet be told from *no presence
  value*; [00 §2.10] argues for the other members' cards, not the muted ones.
  **An open decision for [P13.3]**: filter non-speakers whose presence reads
  `false` (keeping a muted speaker, as ST's `characterId !== index` exemption
  keeps a force-talked one), or correct §1.4 to *"every card"* with a reason.
- **The two block scopes partition the cast on every call**: `speaker` is
  nobody on a call that speaks for nobody, and `others` is everyone. `samples`
  takes a scope too, for its actor carrier only, which is what §1.5's
  *"scoped to the speaker"* example dialogue needs (`schema/preset.ts`).
- **The round is a pseudo-source**, `BlockSource` `round`, placed by the
  collector after ~~the pack's first input slot~~ the input slot that applies
  to this turn, or the first input slot when none does (or last, in a pack
  with none), each message an `assistant` entry priced as the history is — the
  history slot's `priority + index` ramp continued past the window's newest
  turn, so the round is chat, trimmed before the cards and the instruction as
  ST trims chat before card fields. *Review, 2026-09-29*: placed after the
  first slot, a Freeform-shaped pack (a slot per input kind) showed a later
  speaker the earlier replies before the move they answer; priced from the
  input slot, the round outranked every block in the pack.
- **Cleanup cuts at the persona's line too** — ST's `trimWrongNames`
  (`script.js:6433-6457`) — cuts before it strips, which is ST's order, and runs
  under `per-actor` only: under `merged` *"nothing splits it"* (`turns/cleanup.ts`).
  It strips the speaker's `Name:` from the start of **every** line, as ST's
  default per-line pass does (`script.js:6494-6497`) — ~~a leading one~~,
  corrected at the review, 2026-09-29. A reply cleaned to nothing stays an
  empty message with its `original`, and `output.text` leaves it out
  (`joinMessageTexts` skips empty messages).
- **A merged speaking call resolves with no hint** (review, 2026-09-29). Scene's
  embodied `merged` call speaks as the first selected member — prompt and
  attribution — but [06 §3] consults a card's `modelHint` only under
  `per-actor`, so the runner passes the dispatch to `planCall` and a speaker
  implies `actorId` for resolution under `per-actor` alone.
- **A partial round is the runner's decision.** A speaking call's failure after
  another speaking call of the same step finished is handled as `warn` —
  `StepOutcome.failure` now records how a failure was handled, corrected on the
  type — and the outcome's new `round` says how many messages were kept and who
  was lost. A Stop is never a partial round. What a failed speaker had streamed
  stays in their message. *Review, 2026-09-29*: §1.4's *"two messages"* holds
  when the third speaker fails before its first token; a mid-stream stall
  leaves a third, cut message, kept because the person watched it arrive, and
  `round.cut` says so (`kept` counts the calls that finished; `lost` is who
  failed to finish). The kept speakers' lore timing settles as a finished
  step's would — cooldown, sticky and `fired` for the entries their prompts
  reached.
- **Narrator voice ignores `dispatch`.** §1.4 opens on dispatch alone, but
  everything a speaking call does is an embodied reply's: `{{char}}` as the
  speaker, the speaker's cards first, the cut at another member's line. A
  narrator speaks for the scene, not for a member. So a `narrator` session
  makes one merged call and one `message` whatever `dispatch` says
  (`modes/scene/src/mode.ts`, `narrate`; pinned in `turns/runner-dispatch.test.ts`,
  whose narrator case passes `per-actor` explicitly). [06 §3]'s *narrator +
  per-actor dialogue passes* cell is therefore not built. For [P13.5]: the
  settings panel either shows dispatch only under embodied voice or says it has
  no effect under narrator, until a stage defines that cell.
- **A later speaker's lore scan reads the round** (review, 2026-09-29), as §1.4
  point 2's *"the history includes this turn's earlier messages"* says and as
  ST re-scans each member's generation over the chat holding the last reply
  (`group-chats.js:1051`, `script.js:4565`): `RetrieveContext.round`, newest
  first ahead of the input, so the previous reply is the scan's latest message.
- **The stream says which message**: `call.started`, `call.streaming` and the
  `delta` frame carry `message: n`, and the blank line between two speakers is
  a delta without one, so a client that appends every delta still paints
  `output.text` ([api.md](../../api.md)) — up to cleanup: a reply that settles
  shorter than it streamed rebases the bus's live cell on the draft, so a
  reattach sees the cleaned text, while a client already appending keeps the
  raw text until the turn lands (review, 2026-09-29).
- **Three design notes state the old shapes, and carry dated corrections**:
  [21 §1.1]'s `BlockSource` (the `round` arm), [04 §8.2]'s slot sources (the
  `scope` field) and [19]'s template namespace (five names).

*Left for [P13.3]:* the pack's wording (naming the speaker as the one to write,
the group nudge); names in history, which prefixes the round's entries as it
does past turns'; the preview, which still assembles one merged call; and the
importer's macro table, which refuses `{{group}}`, maps `{{charIfNotGroup}}`
to `{{ char }}` and leaves `{{notChar}}` verbatim — all three now have a name to
map to.

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

*As built, 2026-09-29.* The *Ends at* is `routes/preview.test.ts`'s *"a chat's
preview"*, through the card converter and the route. What §1.5 left to the
stage, and where the build parts from the letter of this document, each where
the code carries its argument:

- **Scene flipped** to `embodied`, `per-actor` and
  `{ select: 'natural', castIsPresent: true, maxActors: 32 }`
  (`modes/scene/src/mode.ts`); `legacy` stays narrator/merged/fixed, and
  `chat-settings.test.ts` now pins, against the Scene that ships, that a
  pre-P13.0 file, a file P13.0 created narrated, and a file made today read
  as they were made. `mode.test.ts`'s narrator pin is a pin on the declared
  values and on the pack having an instruction for each voice — the
  narrator's word for word as every earlier session has it.
- **One pack, two voices, through `appliesTo`.** The collector matches a
  block against the call's **voice** beside its call kind and input kind
  (`CollectContext.voice`): `embodied` on a speaking call, `narrator` on a call
  that speaks for nobody, and unset on every call that does not write the
  turn's messages. `se.instruction` is keyed `narrator` (~~`narrate`~~, the
  call kind of both), `se.instruction.embodied` and the three card blocks
  `embodied`; the rest are both voices'. A new session set to `narrator`
  assembles byte-identically to before — `collect.test.ts`'s pre-P13.2
  snapshot did not move. *Pre-P13 sessions hold their own copy* of the pack
  (`SessionFile.preset`), whose instruction still says `narrate`; `presetOf`
  adds the new blocks, all embodied-only. One such session switched to
  embodied by hand would get both instructions, and *Switch to the mode's
  own* is the repair (said in `preset.ts`).
- **A room nobody is cast in is narrated** — a rule this document does not
  have. With `natural` declared, a Scene session with no characters selected
  nobody and every input got silence. `turnSelection` (`turns/speakers.ts`,
  now shared by the runner and the preview) makes no selection when nobody
  but the persona is cast and nobody was forced, so the step makes the one
  call nobody speaks, and that call is the narrator's. An all-muted room
  still selects nobody, as ST does.
- **The card's prompt fields** are sections `se.card.system`,
  `se.card.post-history` and `se.card.depth` (`CARD_PROMPT_SECTION_IDS`,
  admitted to the reserved namespace), and a depth prompt's depth and role
  ride on a new optional `Section.placement`, honoured by the collector for any
  actor block the way a lore entry's own position is. `{{char}}` in them is
  written as the card's name at import, as its description's is — which is
  *"rendered with its own `{{char}}"*. The pack scopes all three with a new
  `ActorScope`, **`voiced`**: the speaker under `per-actor`, everyone present
  under `merged` (and to a narrator, where the blocks do not apply anyway);
  `se.samples` takes it too. **Card prompts are embodied-only**, which §1.5
  does not say: a narrated scene is never told *"you are Vera"*.
  `talkativeness` lands in `modeData[CHAT_IMPORT_MODE_ID]` — the importer
  spells no mode id — from V1's top level or V2's `extensions`, strings read
  as numbers. `import.card.wantsPromptOverride` now fires only for `{{original}}`,
  the one request a stack cannot honour; the placeholder is taken out.
  *Existing imports pick this up on re-import.* *Review, 2026-09-29*: the
  persona slot leaves the three sections out, so a card taken as the persona
  sends none of them — they are instructions about that actor as a speaker,
  and only the actor path holds them to the voice, `voiced` and switch rules.
  **Not placed by an imported
  SillyTavern preset**: its converter maps no marker to these sections, so a
  session on an imported pack sends no card prompts — a converter change, left
  for P13.9.
- **Post-history instructions follow the input in sequence**, not
  `in-history` depth 0 as the table says: this build's history run ends where
  the input slot begins, so depth 0 would sit *before* the move the reply
  answers. After the input they are also after the round, which is ST's
  order. ~~The same fact moves every depth by one against ST's — a depth-*n*
  block here sits *n* entries before the input, where ST counts the player's
  new message as depth 0 — and that holds for the author's note and the
  depth prompt too.~~ *Corrected at the review, 2026-09-29*: that offset was
  1 + the round's length for a later speaker, and a depth-0 note sat before
  the player's move. The author's note and a card's depth prompt now count
  their depth over the whole chat — the history run, the move and the round
  so far — as ST does, so depth 0 is after the round and depth *n* is *n*
  entries before the newest one (`Injected.frame` in `assembly/collect.ts`).
  A pack's own in-history blocks and a lore entry's `at_depth` still count
  over the history run alone, which is what imported presets were written
  against.
- **The group nudge is `per-actor`'s** (review, 2026-09-29). §1.5 says the
  instruction adds *"write only as {{char}}"* in a group; a `merged` call is
  one reply that may voice every member (§1.4), so the nudge contradicted it.
  The template now reads the session's dispatch — `dispatch`, added to the
  namespace beside the five names as its one setting, argued in
  `RenderContext` (`assembly/template.ts`) — and sends the sentence under
  `per-actor` only.
- **`prompts.instruction: false`** skips the blocks `isInstructionBlock`
  names — `se.instruction`, `se.instruction.*`, and an imported ST preset's
  `st.main` — an id convention rather than a schema field.
- **Muted cards leave**, deciding [P13.2]'s open question the first way: under
  `castIsPresent` a non-speaker whose presence is `false` has no card on the
  call (ST's `collectField`, Marinara's `resolveActiveCharacterIds`), and a
  muted speaker keeps theirs. Without `castIsPresent` nothing changes.
  `readPresence` takes the mode's reading and is the one reader for the
  selector, the collector and the cast panel, whose rows now show a Scene
  member nobody muted as present. *Review, 2026-09-29*: ~~the mode's
  reading~~ **the mode's reading in an embodied session** —
  `castIsPresentFor` (`sessions/chat-settings.ts`). Read through the mode
  alone, every narrated Scene session (`legacy`, and those P13.0 created
  narrated) dropped the card of a member the story had walked out, and its
  panel moved every untouched member to *Here*; now those sessions keep the
  prompt and the panel they had. And a value the quarantine reset to the
  channel's `init: false` reads as absent under `castIsPresent`, by its
  `degraded` marker, rather than as a mute nobody made.
- **Names in history**: a turn with `output.messages` is one entry per
  message — `assistant`, named `Name: ` when names are on, or `system` and
  unnamed for a narrator's line — and the round is named by the same count.
  `groups` counts distinct speakers across the window's visible messages and
  the round, as §1.5 says, which is not ST's test (`selected_group`). A turn
  with only `text` stays one unnamed `assistant` entry, so narrated history is
  unchanged. `BlockSource`'s `history` arm gained `message`.
- **The author's note** is engine-placed, like the round — a fourth
  `BlockSource` arm, `note` — at its depth as `system`, priced as the round is.
  `noteDue` transcribes `setFloatingPrompt`: the count is the player's inputs
  on the whole path including the one being answered, interval 1 always, and a
  multiple of the interval otherwise. It reaches only calls that write the
  turn's messages; ST also sends it to an impersonation, and this does not.
- **Hidden**: a turn hidden whole contributes nothing, its input included, and
  a hidden index drops that message. The window is cut before the filter, so
  hidden turns shorten it rather than letting older turns in — ST keeps filling
  the context past them. The retriever still scans hidden lines, and still
  reads a card's prompt sections as part of what the card says.
- **The importer's macro table** maps `{{group}}`, `{{charIfNotGroup}}` and
  `{{notChar}}` (and `<GROUP>`) onto the namespace P13.2 gave them.
- **The preview is the first speaker's call** under an embodied voice,
  whatever the dispatch, and passes the dispatch so the speaker's model hint
  applies under `per-actor` only. It draws the selection on a fresh tape, as
  its lore scan does, so an unaddressed `natural` draft shows *a* first
  speaker rather than the one the turn will roll; `smart` shows its fallback;
  a selection of nobody reads `not-this-turn`. Later speakers are not
  previewed: their prompts hold replies not yet written.

#### P13.4 — The gestures

- `input` optional on `POST /turns`, plus `speakers`, `fromMessage`,
  `continueOf` and `authored`.
- The hide routes.
- The opening turn at creation (§1.7).

*Ends at:* every row of §1.6's table has a route test, and a new session opens
on its greeting with the alternates as siblings.

*As built, 2026-09-29.* The *Ends at* is `routes/gestures.test.ts`, one
`describe` per row of §1.6 and one for §1.7, played on Scene itself;
`turns/runner-gestures.test.ts` proves what the runner does with a swipe, a
continue and an edit it is handed. What the stage decided that §1.6 and §1.7
left open, each where the code carries its argument:

- **The gestures are read in one place**, `routes/gestures.ts` (`gestureOf`),
  and the submission route keeps its one flow for all of them. Fields that
  cannot mean anything together are one 422, `conflicting-gesture`, with a
  sentence naming the clash: an edit beside anything that steers a call; an
  `input` or `speakers` beside a swipe or a continue; `fromMessage` without
  `redoOf`/`rewriteOf`, or with the two naming different turns.
- **A swipe and a continue carry the named turn's input**, pictures and
  force-talk included, and go **beside it**: `parentTurnId` is filled in with
  its parent, and a body naming another is `not-a-sibling`. The carried
  speaker reaches the selector as the forced list (`TurnPayload.carry`) and
  **not** `Turn.input.speakers`, which keeps the carried move's own — a later
  rewrite of the whole round must not read *"only Lund was asked for"* on a
  turn where nobody asked for anybody. A guided swipe's attempt is the one
  message it redoes, not the round.
- **The runner's round is seeded with what is carried**: the regenerated
  speaker's index is *k*, its prompt shows `0..k-1` as the round so far, the
  draft holds them from the first checkpoint, the bus's live cell is given
  their text as one unindexed piece, and the step's messages are put back
  behind them — the carried ones were never the step's to return, so no mode
  has to know about them. A partial round counts from *k*, so a swipe whose
  speaker fails is an ordinary failed turn that still shows what it carried.
  *A rewrite swipe from k > 0 replays call k's draws* (2026-09-29, at this
  stage's review): a speaking call's lore draws are tagged with the message it
  writes (`Draw.message`, `Rng.speaking`), and `swipeReplay` drops calls
  `0..k-1`'s and re-keys the rest from 0 — keyed from 0 across the turn, call
  *k* had been handed call 0's rolls, marked `replayed`. A tape recorded
  before the tag has its `lore.*` draws dropped, so call *k* rolls fresh.
- **Continue**: the one speaking call writes **into** the last message rather
  than after it. The old text and the continuation are joined by a space
  unless the old text already ends in a space — ST's `continue_postfix`
  default and its *"coping mechanism for OAI spacing"*, which checks
  `!cyclePrompt.endsWith(' ')` (`script.js:4918`). ~~Unless it already ends in
  whitespace~~ — corrected 2026-09-29, at this stage's review: ST checks for a
  space and nothing else, and the code now does too. *One deliberate
  difference*: an empty old text gets no joiner, where ST's would still get
  the space. Cleanup runs on the continuation alone, and `original` is the
  old text plus what the model said. The round's last entry is `required` and
  the nudge, ST's sentence verbatim (`CONTINUE_NUDGE`), is a fifth
  engine-placed `BlockSource` arm, `continue`. **The continued message and
  then the nudge end the call**: the splice runs with the continued message
  still in the chat, so a depth counts over it as ST's does, and then it is
  moved out to the end, past every run the splice put after it — ST takes the
  last non-injected message out after injection (`openai.js:908`), so a
  depth-0 note, depth prompt or depth-0 lore sits *before* the continued
  message. ~~Pushed after the splice, so a depth-0 note or depth prompt sits
  before it~~ — corrected 2026-09-29, at this stage's review: that put a
  depth-0 run between the continued message and the nudge. *That is §1.6's
  "the call ends on the nudge", and slightly not ST*: ST's post-history
  instructions follow the chat history its continue collection is part of,
  so a card's post-history instructions are after the nudge there and before
  the continued message here. The continued message is carried whole,
  reasoning included, and **marked `carried` until the first streamed piece
  takes it over**, so a call that fails before its first piece leaves it
  exactly as it was and says this turn wrote none of it (~~carried as its
  speaker and text, unmarked~~ — corrected at the same review).
- **A hide follows a message onto its carried copy** (2026-09-29, at this
  stage's review, which found a swipe and a continue showing the model lines
  the person had hidden on the named turn, and bringing them back visible on
  the sibling). The named turn's `session.hidden` entry travels as
  `TurnPayload.hidden`, kept to what the sibling carries — `true` stays
  `true`, a list keeps its indices below *k* (swipe) or below the last
  (continue), the numbering being the same on both turns. While the turn runs
  those carried messages are left out of the round the call shows and lore
  scans (`CollectContext.roundHidden`), and `true` leaves the carried move out
  of the call too; at the commit the entry is written as
  `hidden[newTurnId]` in the same session write that moves the head
  (`advanceHead`, `CommitExtras`). A hidden message is not continued:
  `hidden-message` (422) says to unhide it first. *A turn recovered at
  startup from its draft is committed without the entry* — the draft is a
  `Turn`, which does not carry it — so its carried copies come back visible.
- **Narrated text is not swiped or continued** — deliberately not built. A
  narrator's reply is one merged call that speaks for nobody, so *"by the same
  speaker"* has no speaker; a narrated turn is one message, whose swipe is the
  existing redo; and a `narrator`-voice session's step makes that merged call
  whoever is selected. `narrated-message` and `narrated-session` (422) say to
  redo the whole turn.
- **An edit goes through the job**, not a direct append: idempotency, the
  one-turn-at-a-time refusal, the head and parent checks and `turn.finished`
  are all a submission's. The runner commits `payload.authored` before the
  gather — no plan, no call, no `request`, and **no clock**: an edit is a
  person correcting the words, not time passing, so its effects are empty and
  the sibling's state is its parent's. Its lines are checked on force-talk's
  three grounds (the persona's lines are the input) and signed with the cast's
  names at the node; `null` is a narrator's line. Sent at the head it is a
  line added by hand. **`editOf` names the turn it edits** (added 2026-09-29,
  at this stage's review): the edit is that turn's sibling and carries what it
  does not rewrite — the input whole, pictures, force-talk and raw text
  included, unless `authored.input` is sent, when only its text, actor and
  kind are laid over the carried one; the messages, unless
  `authored.messages` is sent; each line left as it was kept whole, reasoning
  and `original` included (`editedFrom`); and the hide entry on the lines it
  left alone. Without it an edit was a turn re-authored from nothing, and an
  edit of a reply lost the move's pictures and force-talk even when the client
  re-sent its text — which an edit sent with `parentTurnId` alone still is.
- **Delete of a first turn** needed one change: `PUT /head` accepts
  `turnId: null`, the root (`moveHead`). Without it the greeting was the one
  message nobody could delete. `resume` from the root goes forward only when
  there is exactly one root.
- **Hide is one route**, `PUT /sessions/:id/turns/:turnId/hidden`, with
  `true`, a list of indices or `false`/`[]` — **set, not toggled**, so a
  retry lands where the first did. Under the session lock and *not* refused
  while a turn runs: a hide moves no node, and the running turn assembled
  before it. An index past the turn's messages is `no-such-message`. Owed a
  caller at [P13.5] in `route-callers.test.ts`.
- **The opening turn is a mode's declaration**, `ModeDefinition.openingTurn`
  (an optional SDK field; Scene declares it). The engine may not name a mode,
  and `voice: 'embodied'` is not the same claim — the assistant is embodied
  too. *Single-character* means one cast member besides the persona: the
  primary is written first, then each alternate as a root beside it, so the
  strip offers them in ST's swipe order. In a group, a member with nothing
  written says nothing. The creation body's `openings` (actor id → opening
  id) chooses per member, and **in a single-character chat picks which sibling
  the head starts on**, every opening still written; a choice naming nobody is
  `unknown-opening` before the session exists. Written directly under the
  lock, before any setup turn is reserved — a greeting has no call to watch.
  Rendered once, at write time (`sessions/opening.ts`, `renderOpening`), with
  ST's forms of `{{user}}` and `{{char}}`; with no persona the player is
  *the player*, as the assembler calls them. `lastSelectedChild` has no entry
  for a root, so the head is the whole of which greeting is selected.

*Left for [P13.5]:* ~~an empty send under `manual`, with nobody forced, commits
a turn with no input and no reply~~ — corrected 2026-09-29, at this stage's
review: under `manual` an empty send with nobody forced gets **one eligible
member, chosen at random** — ST's `shuffle(enabledMembers).slice(0, 1)`, kept
on purpose in `turns/speakers.ts` over Marinara's *do nothing*. A turn with no
input and no reply happens only when nobody in the cast is eligible (every
member muted or absent), and the composer should not offer that send, or
should say it will get no reply. Provider prefill for continue stays later
work, as §1.6 says.

#### P13.5 — The chat surface

- The transcript, composer, cast panel, settings and creation form (§1.8).
- Auto-mode.

*Ends at:* the gate's first sitting (§4) can be walked.

*As built, 2026-09-29.* Each item of §1.8 has a client test —
`play/PlayPage.chat.test.tsx` (the transcript, the gestures, the composer,
the streamed round and its order, auto-mode), `CastPanel.chat.test.tsx`,
`ChatSettingsPanel.test.tsx`, `SessionsPage.test.tsx`'s *picking the
characters*, `reading/prose.test.ts`'s *a chat turn* — and the arithmetic
under them is `play/chat.ts` (`chat.test.ts`), the stream's half
`play/reducer.ts` (`reducer.test.ts`), the clock `useAutoMode.ts`. What the
stage decided that §1.3a, §1.5 and §1.8 left open, each where the code carries
its argument:

- **The server read-side the surface needed, and nothing else.** Four
  additions, each argued where it lives. `GET /sessions/:id` sends `chat`, the
  **effective** settings through `chatSettingsOf` — so a pre-P13 session's
  panel shows the narrated, merged, `fixed` values its turns get — and only
  for a mode that plays as a chat (`isChatMode`: the mode declares
  `castIsPresent`; not the voice, which a chat can switch). `PUT
  /sessions/:id/chat` is the settings door (`routes/chat.ts`,
  `sessions/chat-write.ts`), and **writing any of voice, dispatch and speakers
  writes all three**: `chatSettingsOf`'s era rule reads a file with none of
  them as the mode's legacy, so writing `dispatch` alone would have let an
  absent `voice` fall to Scene's declared `embodied` and re-voiced a saved
  game with one checkbox. The transcript sends `swipes`
  (`sessions/swipes.ts`): which message each sibling is a swipe of. And the
  stream says who: `call.started` carries the message's `speaker`, and a new
  progress key, `speakers.picked`, carries the round's order once it is final
  — §1.3a point 8's *response_queue* — with `by` saying whether the rules, a
  model, the fallback or a rewrite chose (`state/events.ts`, two lines in
  `turns/runner.ts`). `GET /modes` gained `openingTurn`, so the creation form
  offers openings only where the mode writes them.
- **A counter is placed by shared content, not by `carried`.** §1.6 draws the
  swipe strip for *"siblings that differ only from message k"* on message *k*.
  The server places each sibling at the length of the messages the two share
  by speaker and text, clamped to the turn's last message, or `null` for a
  sibling answering a different move (an edited input), which stays on the
  turn's own strip. `carried` alone could not do it: a swipe of message 2
  carries 0..1 from the turn it named, which carried nothing, yet both belong
  on message 2's counter — and an import's swipes carry no flag at all. A
  continue lands on the last message; greetings on the first, which is ST's
  greetings-as-swipes.
- **Branch at a message is an edit that stops there.** §1.8 lists *branch*
  among a message's actions and §1.6 has no row for it. Mid-round it is an
  `editOf` sibling whose lines are the round up to that message — the server
  carries them whole — and at the last message there is nothing to cut, so it
  is *continue from here*, a head move that writes nothing.
- **Swipe is a rewrite** (`rewriteOf` + `fromMessage`), the Redo button's
  default and for its reason: swiping past a failed check must not be
  save-scumming by accident. Swipe and continue are not offered on a
  narrator's line, and continue only on the last line and never a hidden one
  — the three refusals [P13.4] built, not shown as buttons that fail.
- **Talkativeness is written to the card**, as §1.3 puts it
  (`modeData[mode].talkativeness`), through the ordinary library save and
  under the session's mode id. So changing it in one chat's cast panel changes
  it in every chat that card is in, and the control's hint says so; a
  per-session value would be a second answer the runner does not read.
- **Mute is presence relabelled.** In an embodied chat the one checkbox reads
  *Muted*, ticked when presence is `false`; in a narrated one it stays *In the
  scene*, because there presence means the room (`castIsPresentFor`).
- **Dispatch shows only under the characters' voice** — [P13.2]'s *"either
  shows dispatch only under embodied voice or says it has no effect"*, the
  first of the two. **Smart's cost is in its option's label.** A pre-P13
  session's `fixed` is shown as itself, offered by no control.
- **An empty send in a chat is a turn with no input**, labelled *Let them talk*
  while the box is empty, and it sends under `manual` with nobody named — the
  policy picks one, as [P13.4] settled. It is refused, with a sentence, only
  when nobody seated could answer (every member muted or gone), which is
  [P13.4]'s *"should not offer that send, or should say it will get no
  reply"* — both. *Who speaks next* is one-shot and cleared by the send; while
  a round streams its place shows the order.
- **The round is painted per message** from `call.started` and the indexed
  deltas. A reattach mid-round cannot: `seen` is seeded from the snapshot's
  cursor, so the earlier `call.started` frames do not replay and the pieces
  before the snapshot exist only in its joined text — so the reducer paints
  that text instead (`round.whole`). A swipe's carried messages arrive as one
  unindexed piece and are not painted while it streams; the turn shows them
  when it lands.
- **Auto-mode is a timer per idle stretch**, not an interval — re-armed after
  each reply, as ST's is — and typing, Stop and a failed turn each switch it
  off; so does finding nobody left who could answer.
- **The reading view names speakers** from `output.messages` in all three
  renderings (`lines` on a passage); a turn with no attributed message reads
  as prose, as before. A chat turn's pictures fall to the end of the turn on
  both surfaces — anchoring one inside a message is later work.
- **Legacy turns render as before**: the chat drawing is for a turn whose
  `output.messages` exist; a narrated turn's siblings stay on the turn's strip.
  Redo is now offered on a turn that answered no move but made a call (*let
  them talk*), and sends no input for it.
- **The entry budget was raised** from 310 to 320 kB gzip
  (`tools/entry-budget.test.ts`, with the numbers): the stage's code added
  7.78 kB to a play page that is on the common entry, and no dependency.
- **Discharged**: `route-callers.test.ts`'s owed row for the hide route.
  **Also documented**: the hide route itself, which [P13.4] left out of
  `docs/api.md`.

*Not walked:* the gate (§4.1 items 1 and 2) is now walkable and has not been.

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

*As built, 2026-09-29 — the server half.* The four claims are
`routes/trackers.test.ts`, through the routes a tracker panel will call; the
step's own claims are `modes/scene/src/tracking.test.ts`, the state block's
`assembly/collect.test.ts`'s *the state slot*. What the stage decided that
§1.9.2 left open, each argued where the code carries it:

- **The switches are user-only channels, not a `session.trackers` field** —
  `se.track.<tracker>.on`, one boolean each, all `false` (`tracking.ts`). A
  field on the session record would be the engine knowing Scene's trackers;
  a channel is the staging toggle's precedent (a mode cannot keep its step out
  of a plan, so the step reads its gate), branch-correct and undoable through
  the existing channel route, and where an import of §2.6's `activeAgentIds`
  and `manualTrackers` can put them. **Cadence and manual mode are one more,
  `se.track.cadence` `{ everyNTurns, manual }`**, counted in story turns over
  `transcript` as `evaluateCondition` counts; **hidden fields are
  `se.track.hidden`**, the locks' twin, ~~read by the panel only~~ — hidden from
  the reader, not the narrator, ~~as Marinara's are~~. *Corrected 2026-09-29*:
  Marinara's `compactGameStateForAgentContext` (`agent-executor.ts:345-411`,
  used at `:2252` and `:2628`) also strips a hidden character field (`mood`,
  `appearance`, `outfit`, `thoughts`) and the locks on hidden paths from the
  **tracker agents'** context, keeping them in the narrator's. StoryEngine now
  matches it: the step leaves those fields out of the state it shows the model
  and writes them back unchanged, as a locked field is, so a field a person hid
  is not rewritten from a value nobody is looking at; the state block still
  renders them for the narrator.
- **The contract grew four fields rather than the engine naming anything.**
  `ChannelDefinition.state` (`EstablishedState { label, enabledBy }`) is what
  the `{ of: 'state' }` slot renders, so the collector walks declarations and
  names no tracker; a switched-off tracker is silent there and in
  `renderedChannels` (the illustration digest). `StepDefinition.onDemand` and
  `StepInput.onDemand` make *Update trackers* a generic route —
  `POST /sessions/:id/steps/:stepId/run` (`routes/on-demand.ts`,
  `turns/on-demand.ts`) — that runs only a declared on-demand `post` step
  writing effects. `CastEntry.persona` says which entry is the player's, so the
  character tracker leaves them to the persona tracker.
- **Lock paths are a channel key and a JSON Pointer**, a list row addressed by
  its `name` (an objective by its `text`), never its index — Marinara migrated
  its index keys to name keys for the reason (`trackerPath`, `writeBack`). A
  locked row the model dropped comes back; one the story never had stays out.
- **The state block sits at `in-history` depth 0, not 1.** Marinara inserts
  before the newest history message, which in its prompt is the player's move;
  this build's history ends where the input begins, so the same place is depth
  0 — after the last reply, before the move — and `user`, so it reads as one
  message with the move. Depth 1 would put *as of the last message* before
  the last message.
- **The on-demand turn** is a child of the head carrying `request.calls` and
  `cost`, **no `steps`**, so it is no story turn and moves no cadence. The call
  runs outside the session lock (a submission waits on it); `busy` is refused
  up front, and the append under the lock is refused as `moved` if the head
  moved meanwhile. A call that wrote no turn goes to the usage log.
- **A malformed answer fails the step `warn`** rather than proposing nothing:
  a tracker that silently did not update reads as *nothing changed*. An
  unchanged tracker proposes no effect.
- *`se.location` stays beside the world tracker's `location`*, recorded in
  `mode.ts`: the stager's place drives the backdrop whether or not a tracker is
  on, and folding them would couple the two.

*Not in this half:* the `meter` and `record` widget arms and the tracker panel
(the client half). `POST …/steps/:p/run` is owed in `route-callers.test.ts`
until the panel names it.

*As built, 2026-09-29 — the client half and the import.* The panel is
`ModeRegion.test.tsx`'s *a record, a meter and a group* and
`routes/trackers.test.ts`'s *what the tracker panel reads*; the settings group
is `ChatSettingsPanel.test.tsx`'s last case; the import is
`import/marinara/trackers.test.ts` over the shared fixture, which now carries
tracker snapshots (`fixtures/test-marinara.ts`), and the builder's half is
`chat/build.test.ts`'s *the source's state*. What was decided:

- **The panel knows no tracker.** Scene declares six `record` surfaces in the
  `panel` region (group *Tracked*) and its six switches plus the cadence in a
  new **`settings`** region (group *Agents*), `tracking.ts`'s
  `TRACKING_SURFACES`; the client draws them through `ModeRegion` and a new
  `RecordCard`, neither of which names a channel. `SurfaceContribution` grew
  `settings` and an optional `group`, which is [10 §8.1]'s *"ask what widget
  would let it"* applied to regions again.
- **`record` declares its fields; it does not infer them from the schema.**
  `{ kind: 'record', label, fields: [{ key, label, show }], locks?, hidden? }`,
  `show` from a closed set (`line`, `number`, `flag`, `lines`, `pairs`, `map`,
  `items`, `meters`, `checklists`), `key: ''` for a value that is itself a
  list. A schema says what a value may be, not that `stats` is a row of bars;
  guessing presentation from `type: 'array'` would be a second description of
  the value. `locks` and `hidden` name the two set channels, and a lock or a
  hide is the ordinary channel write of the whole set. **The value crosses as
  raw JSON** — every other arm sends a rendered string — because a record is
  edited; it is still data, and `contract.test.ts` now asserts a record's
  fields carry nothing but `key`, `label`, `show`.
- **`meter` is an arm over a number or a `{ value, max }`**, and the tracker
  stats are `meters` rows drawn by the same bar (the platform's `<meter>`). No
  Scene channel is a bare number, so the top-level arm's only consumer today
  is the server's render and the tests; the rows are its subject.
- **Surfaces obey the switches**: a channel whose `state.enabledBy` is off has
  no surface (`modeSurfaces`), so a tracker's card appears when it is switched
  on. An actor-scoped `record` is one card per **present member but the
  persona**, whether or not the tracker has reached them (`SurfaceMembers`,
  `presentMembers`), so a person can fill a character in before the model
  does; a muted member's card closes and their value stays on the tree.
- **Editing is Save, not per keystroke** — a tracker is several fields of one
  value, and a write per keystroke would be an engine turn each. *A quest
  objective's box writes at once*, which is *"checkable objectives"*. A value
  the channel refuses is said beside the card (`effect.rejectedReason`).
  Hidden fields are left off the card with a *Show N hidden* control, and stay
  in every prompt.
- **Update trackers**: `StepDefinition.onDemand` became `{ label }` (the
  button's words are the mode's, as a widget's label is), and the session read
  sends `actions: [{ stepId, label }]`, each **only while a channel the step
  writes is switched on** (`modeActions`). `ModeActions` draws them above the
  panel region, disabled while a turn runs. The route-callers debt is paid.
- **The import** (`import/marinara/trackers.ts`, [§2.6]'s second table):
  - *Snapshots are effects on the turn holding their message's swipe*: the
    parser hangs each `(messageId, swipeIndex)` snapshot — the latest, by
    `createdAt` — on the line (active swipe) or on the `ChatSwipe` (any other),
    and the builder writes them on the round's turn or the swipe's sibling.
    `ChatMessage.state`, `ChatSwipe.state` and `ChatSettings.state` are
    source-neutral `ChatStateValue`s; the builder knows no tracker.
  - *Only where the state moves*, against the parent's end state, a channel
    nobody wrote reading as its `init` — a snapshot is a whole state every
    time, and six effects per turn saying nothing would bury the changes. Ids
    are `effectKey` over the turn's key, the channel and the member's foreign
    key, as P13.9's presence effects are; `proposedBy: engine`, applied,
    `before` the parent's value; the head cache is the head path's replay, so
    opening the session reconciles nothing (asserted).
  - *Per-character values are per actor*: a present character is written only
    when the library resolved their `characterId` and the cast holds them; one
    with no card (an NPC the tracker named) has nowhere to go, and whoever
    cannot be placed is counted (`import.chat.stateMemberUnresolved`).
  - *Locks and hidden fields* are Marinara's lock keys read as field paths —
    `world.location` → `se.track.world/location`,
    `characters.id:<id>.mood` → `se.track.character#<actor>/mood` (the
    builder rewrites the member key), `quests.id:<q>` by the quest's name, and
    so on. A row's `.name` and `.value` locks collapse to one path, since a
    lock here is on the row. Keys naming what is not kept (emoji, an `index:`
    past the end) are counted (`trackerKeysNotCarried`).
  - *Switches* from the root chat: an agent's switch is on only when
    `enableAgents` **and** `activeAgentIds` say so, which is when Marinara ran
    it; `manualTrackers` is the cadence's `manual`. Written on the opening
    turns beside the mutes, for P13.9's reason.
  - *Not carried, each a note*: agent models (`agentModelsNotCarried` —
    global in Marinara, the session's `stepRoles` here), per-agent manual
    (`manualTrackersPerAgent`), a quest's stage *number* (an index into
    lorebook stages that did not come), and the non-tracker agents
    (`agentsNotCarried`, narrowed to them). `game_state_snapshots` is
    `converted` in `registries/marinara.ts`.
- **The entry bundle is 318.7 kB gzip against the 320 kB ceiling** (315.2
  before this half): within it, with 1.3 kB left. Recorded rather than raised.
  *2026-09-29*: **319.65 kB** after the review's row locks and write ordering
  in `RecordCard` — 0.35 kB left, so the next client addition meets the
  ceiling and has to argue for it.

*Corrections from the review, 2026-09-29.*

- **The trackers follow the present cast.** `CastEntry` grew `present?: false`,
  set by `castEntries` from `castIsPresentFor` and `readPresence` — the reading
  the cards and the panel use — and the character tracker skips a muted
  member, as Marinara's follows only the characters in the scene. The state
  block builds its names from the persona and the collector's `present`, so a
  muted member's state leaves the prompt; their value stays on the tree.
- **A blank world line is absent**: Marinara's `coerceGameStateTextValue(x) ??
  prev` (`generate.routes.ts:8263-8313`, `game-state-text.ts:39-42`). The
  character fields are not treated so, since Marinara replaces a character
  whole.
- **Quest field locks stay per field** — the import writes
  `quests.<q>.completed` as `se.track.quests/<q>/completed`, not the row,
  because a quest nests its objectives and a row lock would freeze them;
  `currentStage` is counted as not carried.
- **Per-agent manual trackers** (`manualTrackerAgentTypes`) no longer arrive as
  every-turn trackers: when every tracker switched on was per-agent manual the
  cadence is manual; when only some were, those are left switched off.
- **A `#` past the channel key is a row name**: the builder looks for the actor
  separator only before the first `/`, and counts a scoped path whose member
  does not resolve.
- **The panel locks and hides named rows** (a stat, an item, a custom world
  field, an objective), not only whole fields, so an imported row lock shows
  and clears; a path the card cannot place is listed with a control to clear
  it. Lock and hide toggles compute the next set from the freshest cached
  session, the controls wait while a write to the set is pending, and Save
  merges only the fields a person edited onto the current value.

*Where this departs from the text above, left for its owner.*
[10 §8.0](../10-ui-surfaces.md) still says *"three widget arms ship"* and
*"a `meter` arrives with the first numeric channel… Neither is scheduled"*;
five ship now, and its region count (four) is five. A **switch change in
Marinara after the first import does not arrive on a sync**: switches are
written on opening turns, and §2.7's graft rule carries only presence. And
**Update trackers' model is the session's `stepRoles` at `se.scene.track`**,
which has no control yet (`PUT …/roles` is still owed, P7B §1.12), so a
Marinara user looking for a tracker model finds the note and no setting.

#### P13.5b — The director and the secret plot

- `push` on submission, `se.scene.direct` armed by it, guidance through the
  engine-only cell, the pack's fixed push text as the fallback.
- `se.plot.secret`, its cadence step, its slot, the reveal toggle.

*Ends at:* a pushed turn's record shows the direction it was given; a failed
direction call falls back to the fixed text and says so; the secret plot is in
the prompt and not in the transcript until revealed.

*As built, 2026-09-29.* The three claims are `routes/director.test.ts`,
through the submission and the channel routes; the director's own claims are
`turns/direct.test.ts`, the plot pass's `modes/scene/src/plot.test.ts`, and the
import's `import/marinara/plot.test.ts` over the shared fixture, which now
carries `agent_memory` rows and a director that keeps a plot
(`fixtures/test-marinara.ts`). What the stage decided that §1.9.3 left open:

- **Push.** `push: 'natural' | 'random'` on `POST /turns` (`TurnPayload.push`)
  puts `push` in the turn's armed set — **the first producer
  `StepCondition.armed` has had**, recorded at [25 C17] with why it does not
  close C17 — and `se.scene.direct` (`turns/direct.ts`, engine-owned) is
  `{ when: 'armed', flag: 'push' }`. The runner plans it only on a pushed turn
  (the suggester's rule) and still evaluates its condition. **After the mode's
  own `pre` steps**, so a plot pass that just wrote a fresh arc is the one the
  direction reads. One plain-text call over its own candidates — the task, the
  secret if the session keeps one, the last eight visible messages and the
  move — capped at 600 characters; the task words are the engine's (they make
  the answer a direction, as the hook selector's make its answer a hook), and
  the fallback is the pack's: a new optional `Preset.pushDirections { natural,
  random }`, which Scene ships in its own words and `presetOf` brings to an
  existing session's copy by presence, as it brings the level lists.
- **The record.** `StepOutcome.direction { push, by: 'model' | 'fallback',
  text? }` on the director's outcome, beside the smart pick's `speakers` and
  for its reason; a fallback is the outcome `failed`/`warn` with the error
  beside it, and an empty answer is a failure, not a direction. The words
  reach the guidance slot as a third producer, `se.guidance.direction`
  (`CollectContext.direction`), after the person's box and a fired hook.
  **A rewrite keeps the push** (read off the redone turn's outcome, as
  force-talk is read off `input.speakers`) and asks the director again; an
  edit refuses it (`conflicting-gesture`). *Not `Turn.input.push`*: a *let
  them talk* turn has no input to hang it on, and the outcome already says it.
- **The secret plot** is Scene's (`plot.ts`): `se.plot.secret` (hidden,
  `model-proposed`, `null` until a pass writes one), its switch
  `se.plot.secret.on` and reveal `se.plot.secret.reveal` (user-only, off), and
  `se.plot.secret.cadence { everyNTurns: 4 }` — Marinara's per-chat run
  interval, which §1.9.3's *default* implies a person can set. The pass,
  `se.scene.plot`, is a `pre` step declared first: due with no arc, with a
  completed one, or on the cadence (story turns over `transcript`); a pass
  that completes the arc is followed at once by a second, both written as
  effects; **a failed follow-up keeps the completion** (the next turn is due
  because the arc is completed) rather than failing the step and losing it; a
  completed arc renders nothing. The slot is `se.plot.secret`, a `{ of:
  'channel' }` block after the samples with `appliesTo: ['narrate']` — the
  suggester, impersonation and the judge write things the player reads, and
  none may know where the story is secretly heading.
- **The contract grew two fields rather than the engine naming a channel.**
  `ChannelDefinition.enabledBy` is `EstablishedState.enabledBy` for a channel
  that is not established state (the slot, the surfaces and the digests go
  silent while the plot is off; the value stays on the tree), and
  `ChannelDefinition.reveal` is [06 §7.3]'s *reveal affordance*: a hidden
  channel declaring one is drawn while its switch is on, never otherwise, and
  is kept out of `renderedChannels` (a picture is shown) until revealed. The
  director reads *every switched-on hidden channel that declares a reveal*
  (`secretChannels`), so the engine names no plot. An empty channel slot whose
  switch is off now reads `disabled` in the record.
- **The surface.** A *Push the story* select in the composer (not this turn /
  naturally / with a surprise), one-shot like *who speaks next*, a chat's
  alone. The plot's switch and cadence are under *Agents* in settings; the
  reveal and the revealed card are in the panel under *Director*, both drawn by
  `ModeRegion` knowing no plot. **The entry bundle is 319.85 kB gzip against
  the 320 kB ceiling** (319.65 before): 0.15 kB left.
- **The import** (`import/marinara/plot.ts`): the root chat's latest
  `overarchingArc` is `se.plot.secret` on the **head** turn — Marinara keeps
  one arc per chat rewritten in place, so what it states is the arc as of now
  — as an applied engine effect through a new `ChatSettings.headState`, the
  head cache the head path's replay as before. `narrativeDirectorSecretPlotEnabled`
  is the switch **only when the director ran** (`enableAgents` and `director`
  in `activeAgentIds`, the trackers' rule), and the run interval is half as
  many story turns. The director is no longer an `agentsNotCarried` agent (its
  push is a per-turn flag here); `agent_memory` is `converted`. *Not carried*:
  a branch chat's own arc (the session opens on the root's head), and the
  director's global `secretPlotEnabled` default (an agent config, not per chat).

*Corrections the stage made to code it did not own.* `previewStepFor` read
*the first `prose`-role step*, which is a model binding and not what a step
writes; with the plot pass declared ahead of the narrator the context meter
and impersonation measured the plot's call. It now prefers the first
`prose`-role step that writes messages (`preview.test.ts`). And
`runner.test.ts` and `recovery.test.ts` read the narrator's outcome by id
rather than as `steps[0]`.

*Left for its owner.* A switch or arc changed in Marinara after the first
import does not arrive on a sync, for the trackers' reason (§2.7 grafts
presence only). The director's and the plot's models are the session's
`stepRoles` at `se.scene.direct` and `se.scene.plot`, which still have no
control (`PUT …/roles`, P7B §1.12). And every Scene turn now carries a third
dead `ok` row, the plot pass switched off — [25 C17], now past its *decide
with the second instance*.

#### P13.5c — The editor and the echo chamber

- `se.scene.edit`: style edits applied before commit, per message, with the
  unedited text in `OutputMessage.original` and the transcript's *show original*.
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

*As built, 2026-09-29.* The *Ends at* is `import/chat-sync.test.ts`'s first
two cases; the rest of §2.7 is one case each there, and the two doors are in
`routes/import.test.ts`.

- **§2.7's open case: the sibling.** A round that grew in its source (a reply
  to a trailing player's line, a further reply without a new `gen_id`) is a
  new turn beside the round as it was imported, counted and named
  (`import.chat.roundGrew`: *the round as it now stands*), and the head moves
  onto it when nobody played on. Keying a round on its opening was declined:
  letting later replies extend it in place is a turn rewritten, which §2.7
  promises never happens, and it gives one id to two contents, which §2.4's
  every other property rests on. `build.test.ts` pins the builder half on
  purpose; `ids.ts` carries the argument.
- **Found by `(account, originalFilename)`.** `importSession` keeps the
  document's `origin.originalFilename`, and the index carries it
  (`session.origin_filename`, index schema 11, `sessionByOrigin`). A session
  imported before this stage has none, and is found by the turns it holds
  instead, then stamped. `extend` is an option the chat doors pass. It is
  never inferred, so an export loaded back where it came from is still
  `already-here`, §2.7's original case.
- **"Played on" is defined, and recorded beside the session.** A session has
  been played on if a turn in it has no `foreign` (only the import writes
  one), if its head is not where the last import left it, or if a turn is in
  flight. The last import's head, refs, turn ids, cast, hidden flags and
  settings are kept in `import-sync.json` in the session's folder. It is not in
  `session.json`: it records one install's relationship with a source on the
  same disk, and an export has no use for it. Every merge is three-way against
  it. The source's value is taken only where the source changed it and the
  session did not. So an unhide in ST arrives, a hide made here stays, a
  reply order changed here survives a note changed there, and a cast member
  removed here is not put back. Without the file, the session is read for it:
  the root chat's ref gives the imported head (no gesture re-points a ref), the
  held imported turns give the turn ids, the session's cast gives the cast, and
  flags and settings read as the session's own, so the source's latest wins.
- **Only the chat doors write the record as the source's word.** A backup or
  export of an imported chat's session also carries `originalFilename`, so a
  restored session stays syncable, but its document is the session as played.
  Its record has no imported head and no flags or settings, so it always reads
  as played on and every value it has reads as chosen here and is kept. What
  that costs is an unhide in the source of a line hidden before the backup,
  which does not arrive.
- **Refs.** A ref the source had is moved to where its chat now ends, whether
  or not the person played on. It is the source's name for that chat, and it
  is where the new messages wait for somebody who did. A new chat's ref is
  added. A ref deleted here stays deleted. Refs made here are not the
  source's, and are not touched. When played on, `lastSelectedChild` takes the
  source's choices only at forks the person never chose at, and a fork on
  their own path is pinned to it.
- **Mutes are effects on the grafts, per path.** A new turn hanging off a turn
  already here gets an effect for each member whose presence the source now
  gives differs from the last presence effect a turn *from the source* carries
  on that path (the opening turn's, or an earlier graft's), measured against
  the state at its parent. Per path because a group's mutes are group-wide and
  its chats are branches: a branch that grows at a later sync than the one that
  first carried a change still gets it. Only the source's own turns count, so a
  mute made here is not undone by a change the source has not made. Nothing is
  rewritten, the head cache is derived again through `reconstructAlong` when
  the head moves, and `reconcileHandEdits` finds nothing, which is asserted. A
  change that has not reached the source's current path — nothing new came, or
  only a swipe or a branch the head never walks — waits for the next graft on
  it (`import.chat.mutesWaiting`, a warning), rather than minting a turn the
  source never had.
- **`appended: 0` is `unchanged` only when nothing at all was written.** A sync
  that appended nothing but carried an unhide or a setting across is
  `converted`, with each change as a note. `unchanged` writes neither the
  session file nor its clock. The `grownSince` row is gone. A grown chat is
  `converted` with `import.chat.extended`, naming the session it extended, and
  a group's file says `groupSynced`, not `groupNotApplied`.
- **Deletions are notes.** Imported turns the source no longer has, deleted or
  edited there, are counted (`import.chat.notInSource`) and kept. A grown
  round's old self is named as grown in the sync that brought its successor,
  and is never counted as not in the source after. A turn deleted here is not
  appended again, nor anything below it: the record lists every turn the source
  put here, which survives an index rebuild where the tombstone's index row
  does not (a session synced from no record falls back to that row).
- **A sync row reports the sync.** The builder's counts of the whole family
  (`import.chat.swipes`, `import.chat.hiddenKept`) are left off a `converted`
  sync row, since they describe what arrived at every earlier import too; its
  warnings about what is still unresolved stay.
- **The surface.** Play's session panel offers *Update from source* on a
  session with a source (`SessionPanel.tsx`). `POST
  /api/import/sessions/:id/update` re-sweeps the root the ledger last recorded
  for the session (`recordedRootFor`), with `onConflict: skip`, because the
  person asked for a conversation and not for their edited cards to be
  replaced. The root is never sent back. With no recorded root it answers
  `409`, and the panel offers the picker for the same file under the same
  name, since the name is the chat's identity (§2.4), or, for a chat that came
  in a browser-uploaded folder, says to import the folder again. The hint in
  *Load a session or a chat* now says what an update does and does not do,
  replacing P13.8's interim *"comes later"*.
- **Where this departs from §2.7's text.** The text above is unedited; these
  are the disagreements, for whoever owns §2.7 to settle or point at:
  1. *"`lastSelectedChild` … left alone"* when played on: it is not. It takes
     the source's choices at forks nobody chose at here, and forks on the
     person's own path are pinned to it, because otherwise *forward* at a fork
     the sync just created would stop short of where they are.
  2. *"A hide made here stays"*: not for a session imported before this stage.
     With no record its flags and settings read as its own, so a hide made here
     on a turn the source shows is undone. Accepted, once, on its first sync.
  3. *"`appended: 0` becomes `unchanged`"*: only when nothing was written.
  4. *"The source's new head gets its own ref"*: the source's existing ref is
     moved to where its chat now ends instead; a new ref is minted only for a
     chat new to the family.
  5. *"With a test for each"*: the open case was decided by argument, above.
     Only the sibling behaviour has tests (`build.test.ts`,
     `chat-sync.test.ts`). §2.7's open-case paragraph still reads as open and
     wants a one-line pointer here, left for after P13.4's edit to the file
     lands.
- **Not done.** A backup restored under another account handle names the same
  source with ids hashed for the old handle, so a sync there appends the whole
  family beside itself. A group's renamed title does not rename the session.

#### P13.11 — The first turn after a long import

`ensureChain` is lazy and sequential (`sessions/summaries.ts:213`). After
`importSession`, a background warm derives the head path's chain outside any
turn job, reporting on the event bus. It is safe to race a turn: link keys never
include text, so a duplicate derivation changes no key; and `ensureChain` joins
a derivation already in flight rather than repeating it, so a race costs no
duplicate call. *(Amended 2026-09-29: this read "a duplicate derivation costs
one call", which review found false — see the as-built note's race bullet.)*

*Ends at:* a long fixture's first previewed turn derives zero links.

*As built, 2026-09-29.* The *Ends at* is `turns/warm-summaries.test.ts`'s
first case: a 240-line SillyTavern chat through `importChatFile` (five links
above Scene's window), warmed, then previewed with the whole chain held, then
played with no `se.summary` call in the turn's record. The warm is
`turns/warm-summaries.ts` (`SummaryWarmer`, on `AppServices.summaryWarm`).

- **Every door warms, because the hook is on the store's context.**
  `importSession` calls `SessionContext.imported` after a first import and
  after every extending sync, a sync that changed nothing included, since a
  warm over a warm chain reads files and asks for nothing and it finishes a
  chain an earlier warm did not. The route, the chat sweep and upload, and a
  backup restore all hand over that context, so none can forget it. A hook on
  `ImportContext` would have needed each caller edited, one of them
  `routes/sessions.ts`.
- **The turn's questions in the turn's words.** The warm gathers at the head
  and asks `summaryPlanFor`, so slot, depth and the summariser's role (with
  `roles`, `stepRoles` and the bindings) are decided once for the turn, the
  preview and the warm. The step's path conversion, candidates and keep rule
  are now exported from `turns/summarise.ts` (`summarisablePath`,
  `summaryCandidates`, `keptSummary`) and used by both. A warm that built its
  path any other way would write keys no turn reads. No slot, or no
  summariser, means no plan, no event and no call. The control case (the same
  session in a mode with a slot warms) keeps that test from passing on its
  own.
- **The race costs no duplicate call, because `ensureChain` joins one in
  flight.** Review found the plan's *"a duplicate derivation costs one call"*
  wrong for the build as first written: two lazy walks of one chain run in
  lockstep, each finding the next link missing, so a turn sent mid-warm paid
  for every remaining link twice, on the endpoint it was waiting for. Now
  `sessions/summaries.ts` keeps the derivations in flight by the link's file
  path; a walk that reaches one waits for it and takes its link. An owner
  registers before its second disk read, and leaves the map only after its
  write, so no interleaving calls twice. A waiter whose link failed or was
  cancelled goes round and derives it itself, so a warm stopped by a delete
  does not fail a turn that joined it. In process only: a second process
  over one data root would still pay the duplicate, and still write one key.
  Both of the second `describe`'s cases race. At the store, two concurrent
  `ensureChain`s in different words produce identical key lists, one file per
  key, and derive every link exactly once between them. End to end, a warm
  held inside its first call while a turn reaches its summary step: the
  turn's carried `linkKey`s equal the files on disk exactly, and the
  summariser calls equal the links. The turn is not otherwise serialised
  behind the warm.
- **Progress is a `summaries` frame** (`TurnStream.summaries`,
  `Listener.onSummaries`, SSE `event: summaries`): whole state
  (`warming | warmed | failed | cancelled`, `links`, `missing`, `derived`),
  no `id:`, and not in the snapshot, for the rendition frame's reasons. The
  `warming` frames are droppable and the ending is not. **The client does not
  read it yet.** Its reducer ignores unknown frames, and showing *the story so
  far is being read* is client work outside this stage.
- **Bounded, cancellable, forgotten.** One warm per session: a second import
  while it runs marks it to go round again, since the head may have moved.
  `WARM_CONCURRENCY = 2` install-wide, FIFO beyond it, and a constant rather
  than a config key until something measures a reason to turn it. Delete
  awaits `SessionContext.deleting` under the session lock before the folder
  moves. A reply that lands after the abort is thrown rather than written, so
  no `summaries/` folder is recreated beside the trashed one.
  `disposeServices` stops the warm after the renditions drain and before the
  stores close, and `settled()` waits for it. Nothing is persisted: after a
  restart the next turn derives what is missing.
- **Usage** is one `usage.jsonl` line per link, purpose `summarise`, including
  a call that failed or was cancelled after reaching the provider.
- **Not covered:** removing an account does not cancel its warms. A warm in
  flight then can write one link into a folder being removed. It is the same
  exposure a rendition job has, and it is left for whoever next touches
  account removal. [18 §7.5](../18-session-import.md)'s other open point, that the memory extractor
  *"has the same shape and was not checked"*, is still unchecked. Its
  eight-turn read is §3's *not in this phase*.

#### P13.12 — The corpus and the gate test

- A fixture pair per source in the `fixture-pair` project (`FIXTURE_PAIR`
  becomes a list). Each sweeps cards and chats, opens the session, previews a
  turn, and asserts the history carries names and the speaker's card leads.
- One 10,000-message size test, because nobody has measured `importSession`
  turn by turn.

*As built, 2026-09-29.* `FIXTURE_PAIR` in `vitest.config.ts` is a list, spread
into the `fixture-pair` project's `include` and the `packages` project's
`exclude` as `DOCS` is, and `vitest list` shows each of its three files claimed
by that project alone. The two new files are `import/fixture-pair-chats.test.ts`
(one test per source) and `import/chat-size.test.ts`.

- **Each source's tree is swept whole**, cards and chats together, through
  `sweep` with the session pass. SillyTavern is the shared corpus plus a branch
  of its own chat and a two-member `natural` group. Marinara is the shared
  corpus as it stands, since it already holds a roleplay with a branch and a
  three-member `manual` group with a mute. Each session is opened through the
  route, previewed, and played on the stub provider. The assertions are the
  old gate's (no `empty-source` for a slot the pair should feed, no
  `unknown-slot` at all), plus four that only a chat has:
  - the embodied instruction names the speaker, and the speaker's card leads,
    with every other present member's card after it;
  - the persona fills, and the speaker's three card-prompt sections fill in the
    card's own name, with post-history last and no other member's (`voiced`);
  - every attributed history line is compared with the turn it came from,
    `Name: ` prefixed exactly when `namesInHistory` says;
  - the played turn is `complete`, its messages are attributed by id and name,
    and each `se.narrate` call in its record was led by that message's
    speaker's card.
- **The corpus cards were given prompts in the test, not in the shared
  trees.** Neither tree's cards carries `system_prompt`,
  `post_history_instructions` or a depth prompt, because they were written at
  P4, before P13.3 gave those fields a destination. Over them, the test could
  not tell *unreachable* from *nothing to place*. Other tests count and compare
  those cards, so the fields are added where the pair test builds its tree.
- **"Fed" is named by block, not by source kind.** The old gate's *no `actor`
  row* is right for an imported preset, which places only the fields its cards
  have. The Scene pack places every field an actor could have, and a V2 card has
  no appearance, voice or background. So `FED` lists the blocks a card and a
  chat do carry: persona, summary, traits, the three card prompts, history and
  input.
- **The `manual` group is previewed as `manual` works.** A draft previews as
  `not-this-turn`, which is asserted: Marinara's manual order answers a
  player's line with nobody. The round is played by force-talk (Maris, then
  Vera), which is how a manual group gets replies. The assembled preview is
  *let them talk*: no input, one unmuted member at random, and `se.input`
  dropped from `FED` for that reason alone. Names are off in that session as
  imported, and correctly so: the opening round and Maris's reply come in
  hidden, which leaves Vera alone in the window. They come on once the played
  round puts Maris there, and that is what the preview asserts.
- **The size test's measurement** is in its module docstring. On a 4-core
  container, `importChatFile` is linear at about a millisecond a turn: 5.2–5.8 s
  for 10,000 messages (5,001 turns) and 10.3–11.5 s for 20,000. Parse and
  build together take about 0.1 s of that. The rest is `importSession`'s
  per-turn `appendTurnOnly`, a segment append and an index row each, not
  batched, which is where a faster import would start. Opening the session
  afterwards costs about 0.2 ms a turn (1 s at 5,001 turns). No model is
  bound, so the P13.11 warm makes no call inside the timed span.
- **The size test bounds growth, not speed.** The first bound was 30 s,
  called "about five times the measurement", but the measurement above was
  taken with the file running mostly alone. CI's `pnpm test` runs
  `fixture-pair` beside the whole `packages` project, on Linux and Windows.
  Re-measured on the same container, the 10,000-message import took 7.5 s
  alone and 15.3 s in that shape, so the margin on Linux was about 2×. Windows
  writes small files several times slower, and the import does about fifteen
  small-file operations a turn. That puts the Windows leg near or past 30 s,
  failing on runner speed rather than on the quadratic walk the test is for:
  F28's failure mode, short of F28's own rule of about ten times the loaded
  worst case. The test now imports a 1,000-message chat and then the
  10,000-message one in the same install and asserts the ratio is under 25:
  linear is about 10, quadratic about 100, and the ratio does not move with
  the runner (measured alone: 5.6 s over 0.6 s, a ratio of 9.2). The small
  one runs first, so its warm-up only lowers the ratio.
  An absolute bound stays at 150 s, ten times the loaded figure, as a hang
  detector only, and the test's timeout is above it, so a slow import fails on
  the bound with both timings in the message rather than on vitest's timeout.
- **Found, not fixed** (none of these is this stage's code):
  1. **An imported chat session sends no scenario.** The sweep turns a card's
     `scenario` into a Treatment, but the chat door links no treatment to the
     session it builds, so `se.treatment` is `empty-source` on every imported
     chat. SillyTavern sends the card's scenario on every turn of that chat.
     Neither §2.6 nor [18](../18-session-import.md) says which should happen.
     The pair test leaves `se.treatment` out of `FED` rather than assert the
     gap.
  2. **Example dialogue reaches the model with `<START>` verbatim.** Nothing in
     the server reads it. SillyTavern treats it as the separator between
     example chats and replaces it. `{{user}}` in the same text is kept on
     purpose (`import/sillytavern/card.ts`, *"the player's placeholder is
     kept, and said"*), but it reaches the model as braces too, because a
     sample body is never rendered.

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
