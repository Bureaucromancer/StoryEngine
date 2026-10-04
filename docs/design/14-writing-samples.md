# 14 — Writing samples

**Status:** position. Adds one shared substructure and one field to three kinds;
supersedes two standing decisions, both recorded below.

---

## 1. The gap, in one sentence

Everything in this design that touches style **describes** it, and nothing
**demonstrates** it.

`Treatment.tone.styleNotes` says "terse, hardboiled, present tense". `se.voice`
is register and verbal tics, and [04 §4](04-schemas.md) is careful that it is
"not what they sound like". `tone.genres` and `tone.moods` are vocabulary. Every
one of these is a *description of prose* handed to a machine that must then infer
the prose — which is the harder half of the job, done in the harder direction.

A **writing sample** is the other half: a passage from the setting, or a page in
a character's voice, pasted whole and offered as *write like this*. Not a
paraphrase of the register — the register itself.

The distinction is not new to this project. [18 §3](18-character-studio.md)
already drew it for pictures:

> **Style anchoring.** Style is a property of the *production*, not the person —
> the same character rendered in ink wash and in photoreal is still that
> character. So style exemplars are a separate media role and separately
> selectable.

This note is that argument applied to prose. It is why the three kinds that may
carry a sample are the three that describe production — the person, the world,
and the stance on the world — and why a sample is positioned and budgeted by a
preset slot rather than injected merely by existing.

## 2. What it is not

- **Not `styleNotes`, and it does not replace it.** A directive and an exemplar
  fail differently: a directive is cheap and vague, an exemplar is expensive and
  specific. An author with only one of them is not doing it wrong.
- **Not `se.voice`.** Voice is a description of speech and belongs to the person.
  A sample is a demonstration and belongs to the production.
- **Not an opening.** `Openings.written` is prose that *starts a session* —
  content the player receives. A sample is never shown to a player and never
  becomes part of the story; it is shown to the model and then falls out of the
  window like anything else.
- **Not an unbudgeted paste.** See §5.
- **Not a world fact.** A sample on a Treatment demonstrates how the world is
  *written*; the world itself stays in the linked lorebook, so the §6 invariant
  in [04](04-schemas.md) — a Treatment of Rain City does not describe Rain City —
  survives intact.

## 3. Shape

One shared substructure ([04 §3.1](04-schemas.md)), carried by Actor, Lorebook
and Treatment as an optional list:

```ts
interface WritingSample {
  id: string
  /** Names it for the author, in the editor and the block table. Never injected. */
  title: string
  /** The prose itself. The only field that reaches a model. */
  body: string
  enabled: boolean
  /** Budget priority. Absent = inherit the slot block's. */
  priority?: number
  /** Why this sample is here, for a person reading the object. Never injected. */
  note: string
}
```

**A list rather than one blob**, because the budgeter's only move against a
single block is to drop all of it. Three samples in one field are three samples
that succeed or fail together; three samples in a list are three the author can
rank, disable, and lose one of.

**`enabled` and deletion are different acts.** A disabled sample costs nothing
and appears nowhere, and it is still on the card tomorrow. Conflating the two
costs somebody their writing.

**`priority` is optional and usually absent.** Present, it overrides the slot
block's; absent, it inherits — which is how every other candidate already
behaves, so the common case needs no number and the field is reached for only to
rank samples against each other.

## 4. One slot, three carriers

The preset vocabulary gains `{ of: "samples", from?: "actor" | "treatment" |
"lore" }`, replacing the `{ of: "examples" }` arm that was reserved for
SillyTavern's `mes_example` and filled by nothing.

**Renamed rather than added.** `examples` named the source field it was reserved
for rather than the thing it fills; with a carrier called `writingSamples`, one
concept under two names is exactly the drift
[22 §1.1](22-internal-contracts.md) exists to prevent. The rename is free:
`Preset` is at `/0`, the one schema whose own docstring says the shape will move;
no shipped preset positioned the old arm; and an unknown slot from a newer build
is skipped rather than thrown.

`from` absent means every carrier, in the fixed order **treatment → lore →
actor** — the stance on the material, then the world, then the person, which is
the order they narrow in.

The block records `{ kind: "samples"; owner: { kind, id, contentHash }; sampleId }`.
`contentHash` for the reason the `actor` arm carries one ([P3.0]): every carrier
is reached by link and read fresh each turn, so the id alone resolves to whatever
that object is *now*, and the hash is what gate step 4 clicks through to the
sample as it was actually sent.

## 5. The budget consequence, which is the whole behaviour

[00 §2.6](00-stance.md) is not negotiable here:

> every block is budgeted, including the ones we are sure are important. "Never
> trim this" is a priority value, not the absence of a budget

So a sample is an ordinary candidate: one per sample, each with a token cost on
the record and a row in the block table. Two consequences follow, written down
here rather than discovered later.

**A long sample at a low priority often will not survive, and it is
all-or-nothing.** A sample is dropped whole, never truncated — a half-excerpt
teaches a register that stops mid-sentence. `estimateTokens` is `ceil(len/4)` and
runs about 10% low ([26 §E5](26-open-questions.md)), so a 3,000-word story costs
roughly 4,000 tokens and is *understated*. Against the Scene preset on a 24k
window (`contextShare` 0.75, 1,024 reserved, so about 17k available) that fits
comfortably. Against an 8k local model (about 5k available) it does not, and it
goes. The author's lever is `priority`; the honest advice is that a sample wants
to be a page, not a chapter.

**Where the default sits, and why it is not obvious.** The Scene preset places
`se.samples` at priority 20 — above history's declared 10, below lore's 25.
History blocks are emitted at `priority + index` across the window, so Scene's
history actually spans 10..29 rather than sitting at 10. A sample at 20 therefore
outlives roughly the ten oldest turns and dies before the ten newest. That is the
intended reading of *a nicety that improves voice*: losing it costs tone, never
continuity or facts.

## 6. Two decisions this supersedes

Both are recorded rather than quietly applied, and both leave the reasoning that
produced them standing.

### 6.1 Dialogue examples were a `Section`

[03 §2.7](03-data-model.md) and [04 §4](04-schemas.md) route `mes_example` to a
`Section` with `disposition: "on-demand"`, on the reasoning that prompt assembly
belongs to the preset and the mode rather than to the description of a person —
the card is not a prompt configuration file.

**That reasoning survives untouched.** A sample is still positioned and budgeted
by a slot; the card still declares no assembly. What did not survive is the
*container*: a `Section` has no priority, and §5 requires every block to carry
one. A sample that could not rank itself could not participate in the one rule
the budgeter is built on — and three carriers sharing one shape is worth more
than one of them reusing a nearby shape.

The Actor's deliberately-absent list therefore loses one name. `system_prompt`,
`post_history_instructions`, `depth_prompt`, `talkativeness` and `scenario`
remain absent; `mes_example` now has a home.

### 6.2 Lorebooks were to gain no new field

[11 §4](11-lorebooks-as-a-format.md) refuses new lorebook fields by name, and the
argument was a count: eleven activation fields already ship, validate and
round-trip while nothing reads them as the field they are, so a twelfth would be
"buying machinery to avoid building a surface".

**The argument is sound and is not disputed on its merits. It is overridden
because this field is not the kind it was aimed at.** A writing sample has a
reader on the day it lands — the assembler fills a slot from it, and the block
table shows what it cost. It does not join the unread eleven; it is the first new
field in a while that does not. §4's own instruction is that refusals be recorded
with their reasons "so that they get re-checked rather than re-argued". This is
that re-check, and it went the other way.

Two constraints from §4 that the field still honours:

- **Book-scoped, not entry-scoped**, and this is load-bearing. An entry-level
  sample would have to activate — keys, scan depth, the whole matching apparatus
  — and a tone exemplar that appears only when somebody says a magic word is not
  a tone exemplar. Samples belong to the book the way `media` does.
- **Portable.** §4.2 moves out anything that is a fact about *how you like a
  book* rather than about the book. How a world reads is a fact about the world,
  so a sample travels with an export the way `description` does.

## 7. What ships when

- **Now.** The substructure, the field on all three kinds, the renamed slot, and
  the **actor** arm end to end — cast actors are already gathered and read fresh
  every turn, so nothing new has to reach the session. The Scene preset positions
  the block; the actor editor grows a repeatable sample row.
- ~~**P5.** The **treatment** and **lore** arms. A session references neither
  object today, which is why those arms return nothing and report
  `no-producer` — the same posture `se.lore` has held since P2, and for the same
  reason: the slot rendering empty is what keeps this a wiring change rather than
  a preset change.~~ **Shipped at [P5.9]**, and it was the wiring change this
  predicted it would be: [P5.6] gave `SessionFile` a `treatment` and a `lore`
  list, so the two arms needed the carriers threaded to the slot and nothing
  else. The prediction that *a session references neither object today* was the
  load-bearing part, and it is what made the schedule right.

~~The empty reason discriminates on the carrier, deliberately. A slot naming the
Treatment is waiting on the engine; an actor slot with nothing in it is waiting
on the author. Collapsing both to `no-producer` would tell somebody their preset
is blocked on P5 when it is blocked on them having written a sample.~~

**The discrimination closed with the arms it existed for.** It said something
true only while the three carriers were landing at different times. With all
three live, an empty samples slot means the same thing whichever carrier it
names — *write a sample, or link an object that has one* — and keeping the split
would leave `no-producer` claiming an outstanding phase that no longer exists.
The test that pinned it was changed in P5.9's own commit rather than repaired
later, on the rule [P5 §1.10] set for the fixture-pair gate.

**A sample rides with its carrier, never with activation.** A book's samples are
offered because the book is *in play*, not because one of its entries matched: a
sample is not an entry, has no keys, and has nothing to match with. That is what
keeps this a preset slot rather than a feature of the retriever, and it is why
P5.9 was a stage of the phase rather than part of P5.6.

## 8. Deliberately not decided here

- **No length limit.** No portable schema carries a `maxLength` — the only string
  bounds in the project are at the route layer — and inventing the first one here
  would be a policy change smuggled in as a field. §5 states the consequence
  instead.
- **No excerpting or truncation.** See §5; a sample is dropped whole.
- **No generation.** Field assists arrive with providers
  ([10 §11.1](10-ui-surfaces.md)), and "write me a sample of my own setting" is a
  circular request worth refusing until somebody asks for it.
- **No Treatment or Lorebook editor.** Neither kind has one; both are edited as
  JSON today, and this field does not change that.
