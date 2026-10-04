# 33 — P15 implementation plan

**Status: stages P15.0–P15.9 built on `claude/nice-davinci-xjdpf6`, 2026-09-26,
~~and not merged~~ *and merged through the `p15` branch on 2026-10-03, which
brought `main` into the branch and resolved what the two had each built
(§1.7–§1.9)*. ***The exit gate ([§3](#3--the-exit-gate)) has not been
walked***, so under [manual testing §0](05-manual-testing.md)'s two-tier gate
this phase is **open**: merged, and not closed — its critical list is
[sitting W](05-manual-testing.md), unwalked.** One feature,
filed as a phase for [P12 §1.5](29-p12-implementation.md)'s reason: a roadmap
entry ([24](../24-roadmap.md)) holds no release commitment, and this was built
now.

*2026-10-04: the three questions the merge left open — whether a turn that only
seeds is drawn, whether the wizard leaves the common entry, and the
`partyDefault` round trip — are answered on the recommended answer, owner
deferred, at [§1.10–§1.12](#110-a-turn-that-only-seeds-is-drawn-as-every-turn-with-no-words-is).
None of them closes the phase; sitting W still does.*

*Renamed 2026-10-03, at the merge.* Written and built as **P13**, in a document
30 (`30-p13-implementation.md`), on a branch cut from `main` at `8cd8cc6c`
before `main`'s own P13 — the Aventuras import, [P13](30-p13-aventuras-import.md),
document 30 — and [P14](31-p14-scene-and-session-import.md), document 31,
reached it. Both names and the number were taken and cited by hash first, so
this phase is **P15**, and the [P14](31-p14-scene-and-session-import.md)
precedent (`1c859485`) is how: **the rename is by line** — a *P13* on a line
`main`'s copy of a file does not have is this phase's and now reads *P15*, here,
in the design notes, in [the API reference](../../api.md) and in code comments,
while every line about `main`'s P13 is untouched. **The commits that built it
still say P13 in their subjects, and the stage hashes in §2 still cite those
original commits**: the branch was merged rather than rebased, precisely so
that every one of them stays reachable, and that history is not rewritten. Its
document is filed at **33**, ahead of [P12A](34-p12a-the-look.md), by the
execution-order rule the work-plan README's 2026-10-02 refiling applied — this
ran while P12A had not opened — and its sitting, lettered T on the branch, is
**W**, because `main` had spent T, U and V by the day it landed.

**P15 is *make a setup from here*.** From any turn of a session a person can
run a wizard that condenses the story up to that turn and converts the point
into a real **Setup** — a library object new sessions start from — rather than
merely branching the chat there. The primary use is a point somebody will
start from again and again, or hand to someone else, without recreating it by
hand and without shipping the whole pre-played session.

---

## 0 — Readiness: what the design says and what the code has

### 0.1 The design has promised this since the Setup split, and nothing built it

[04 §7](../04-schemas.md): *"a running session can emit a Setup, which is
Marinara's play-first-share-afterwards snapshot as a first-class object rather
than a text file."* [03 §7.1](../03-data-model.md) and
[10 §2.1](../10-ui-surfaces.md) say the same, and [triage](02-triage.md) marks
Marinara's setup snapshot **PORT, strengthened**. No phase scheduled it.

**[16 §3](../16-authoring.md) goes further and is wrong.** It counts *"a running
session can emit a Setup"* among the two thirds of the play-to-authoring loop
that *"already exist"*. What exists is [P7.4](23-p7-implementation.md)'s *Save
as a setup*, which names the **session form's** configuration before a session
exists — `setup-from-form.ts` — and never reads a running session. The design
and the code disagree, and the repair is to build the thing and correct the
sentence in the stage that makes it true (P15.7), not to reword the sentence
now.

### 0.2 An emitted Setup would be unplayable today, three ways

Read against `POST /api/sessions` (`routes/sessions.ts`) as it stands:

1. **Nothing consumes `Setup.openings`.** They reach a session only inside
   `setup: structuredClone(from)`, and no reader on either side looks at them.
   [03 §6](../03-data-model.md)'s *"at session creation the user picks one
   written opening, one seed to expand, or neither"* has no implementation.
2. **`cast.partyDefault` is read by nothing**, and the route says why: *"seeding
   it means writing effects, which needs a turn."* An opening **is** a turn —
   which is the answer this phase gives.
3. **The browser cannot start a session from a Setup.** The client's
   `NewSession` has no `setup` field and nothing sends one; the server has
   accepted one since P7.4.

So the feature is both directions. Emitting a Setup nobody can start from would
be [P7.4](23-p7-implementation.md)'s own complaint in reverse — *"a field one
writes that the other does not read is a promise the library keeps and the game
does not."*

### 0.3 One hazard, found before it was written

`retrieval/blocks.ts` marks every block from a lorebook whose
`provenance.source` is `'session'` **advisory** — the memory-book convention
([P8](25-p8-implementation.md)), and it is `isMemoryBook`'s marker too. A
companion lorebook of established facts stamped `'session'` because it *came
from* a session would therefore have its entries barred from every effect and
verdict call, silently. It is stamped `'generated'`. The Setup itself may be
`'session'`: only lorebooks are read for that marker.

### 0.4 What is not the same feature

[25 B10](../25-open-questions.md)'s *prologue package* is a partly-played
**session** travelling in a package. This is the opposite trade: the history is
condensed away and what travels is a Setup, which starts clean, reads in a
library editor, and carries no turn record. Both are worth having; neither
replaces the other.


### 0.5 Found on the way, and where each went

Three things turned up while building that §0 did not predict. Recorded here
because each is a sentence somebody would otherwise have to rediscover.

- ~~***The illustrate route cancels its own call.*** It aborts its model call on
  the **request's** `close`, and since Node 16 that fires once the body has been
  read — under Fastify, before the handler has done anything, which a probe on
  this build confirmed. … against a real endpoint that honours it,
  *Illustrate*'s moment call is cancelled almost as soon as it starts.~~
  ***The illustrate route's cancellation never fired — corrected the same day,
  when the regression test written to prove the sentence above passed against
  the unfixed route.*** The premise was right: the request's `close` is emitted
  once the body is read, as the handler starts. The conclusion was not, because
  the event is emitted **once** and Illustrate attached its listener after two
  awaited reads, when it had already gone by. So the button worked, and a person
  who left mid-press still had the call run to the end and paid for — the
  opposite failure from the one first written here, and found by the test rather
  than by reasoning. ~~**Fixed** in `routes/disconnect.ts`'s `abortOnDisconnect`,
  which reads the response's `close` and which the [P15.6](#p156--the-draft)
  route uses too; `p9-gate-controls.test.ts` presses Illustrate over a listening
  socket both ways, and [P9.4](26-p9-implementation.md)'s record carries the
  correction.~~ ***Fixed on `main` instead, and this branch's fix dropped —
  corrected 2026-10-03, at the merge.*** `main` found the same bug the same day,
  independently, and fixed it in `af5811a0`: `routes/disconnect.ts`'s
  `disconnectSignal` reads the response's `close` exactly as `abortOnDisconnect`
  did, **and is stricter** — it also checks `raw.destroyed`, which catches a
  client that left during the route's own awaits, whose `close` has already
  gone by when the listener would be attached. `abortOnDisconnect` had no such
  check, and both of this branch's callers attached it after two awaited reads.
  So the merge took `main`'s `disconnect.ts` and its socket-level tests, and
  `main`'s side of `p9-gate-controls.test.ts`, and dropped `3d499ca0` whole —
  reachable through the merge, and not in the tree. The [P15.6](#p156--the-draft) draft route uses `disconnectSignal` now,
  and swallows the `Cancelled` it causes — a client that leaves gets nothing
  back, as Illustrate's does, rather than an *Unhandled error* logged for every
  closed tab. The branch's addendum to [P9.4](26-p9-implementation.md)'s record
  was dropped with it, and P9.4 now carries a short note of its own citing
  `af5811a0`, which until this date it did not.
- ***An undeclared step's calls are `effects` calls.*** The condensation step
  first declared no `contributes`, so `callPurposeFor` read every call as
  effects and refused a person's advisory steer on it — every *Regenerate, but
  shorter* a 500. It declares `messages` now, which is the truth: it makes words
  for a person and writes nothing.
- ***A string-valued table is a catalogue question even when it is data.***
  `i18n/catalogue.test.ts` holds every such table in client code to the
  catalogue or an exemption; the wizard's map from a part to a Setup path was
  inlined rather than exempted, because it was two lines.

---

## 1 — The decisions this phase makes

### 1.1 The story so far is a Setup field, and it becomes the summary's root

Decided 2026-09-25, over two alternatives recorded so they can be re-argued:
a companion lorebook with an always-on *story so far* entry (works with any
preset, costs a second object), and folding the recap into the opening's prose
(no schema change, and it scrolls out of the window).

`Setup.storySoFar?: string` is additive, so it needs no version bump
([04 §2](../04-schemas.md)). A session started from such a Setup gets it as the
**root of its rolling summary chain**: the `summary` slot emits it as the oldest
link from the first turn, and the first derived link ~~folds it in as
`previous`~~ *is handed it as `previous`, which since the merge means context
— the note below*.
That is [07 §5.1](../07-branching.md)'s `summary(n) = f(summary(n-1), turns)`
with a seeded `n = 0` — no second mechanism, and the built-in Freeform and
Scene presets already position the slot as *"the story so far"*.

**What it costs**: a preset with no enabled summary slot never shows the model
the root. The wizard says so when the session it was run from has none.

***The chain it is the root of changed shape before it landed — 2026-10-03, at
the merge.*** `main`'s `e9d1a142`, the day after this branch was cut, put the
summary chain into **stretches**: each link summarises its own turns and is
handed the one before as context, told not to repeat it. So "folds it in as
`previous`" stopped being what `previous` does. The root is the stretch before
the first turn, read *with* the links rather than retold by the first of them,
and every reader of the story so far — the collector and the draft alike —
reads the root and the links together. Two things follow, both settled by the
merge rather than by this section as first written:

- **The root is the first part of the summary given up when the slot is
  full.** The branch argued that dropping it first cost nothing because the
  first link already carried what it said; under stretches no link does, so
  the argument was false by the time it reached `main`. The order stands for
  a different reason — the one every link follows: the root is the oldest
  stretch, and as a rule the largest, and a model continuing a story needs
  where things stand more than how they began. What must outlast it is in the
  companion lorebook, whose entries reach the prompt on their keys.
- **Every caller that plans or derives a chain takes the root from one
  plan** — the turn, and `main`'s warm derivation and preview, which the
  branch never saw and which would otherwise have keyed a chain the turn never
  reads.

### 1.2 What carries over, and what does not

Decided 2026-09-25 — all four of the offered groups.

| Group | Becomes | Honoured at creation by |
|---|---|---|
| **Party** at the turn | `cast.partyDefault` | seating them in `cast.actors` and writing `se.party` on the opening turn |
| **Goal progress** | `goals`, the current one first and the achieved ones dropped | nothing new — `goals[0]` is where play begins ([04 §7](../04-schemas.md)) |
| **Plot-hook state** | unfired setup- and session-sourced hooks in `hooks`, ids kept; every fired hook's id in `spentHooks` | writing `se.hook: fired` for each spent id on the opening turn, so a treatment's hook does not fire twice |
| **Established facts** | a companion lorebook, linked from `lore` | ordinary lore activation |

**Channel state is not copied wholesale**, and that is the rule rather than an
omission. Channel state is [04 §1](../04-schemas.md)'s *free to move* tier and a
Setup is its *stable* tier; a Setup that carried raw channel values would freeze
every engine channel's shape into a portable format. Only the four groups above
cross, each through a field the Setup already has or an additive one with a
host-owned meaning.

**Known gaps, named rather than dropped:** presence and status (a character who
died is dead in the story so far, not in `se.status`); a difficulty dial's live
value (the wizard's original answer in `mode.config` is kept); a session's own
edits to its preset copy (the Setup refers to the library preset); and a
`committed` or `forced` hook intent, which carries as an ordinary unfired hook.

*A fifth, found 2026-10-04 while recording §1.12:* **a seated actor who is not
in the party.** The party group is read off `se.party`, and a seated actor is
not a member until something made them one — and only a model's effect can:
the cast panel seats, mutes and sets status, but has no party control, so a
person cannot make anyone a companion by hand. So a Scene chat started with a
character cast carries nobody unless the model made that character a
companion, and a Setup made from any of its turns starts without the character
the chat was with. Nor is it only chats: any seated actor outside the party is
left behind, as the seeded session's Mara would be. The wizard's preview says so
(*The party (nobody but you)*), which is honest and is not a remedy. A Setup
has no field for a cast that is not a party; [25 B19](../25-open-questions.md)
is that question.

### 1.3 Hidden content stays on the server

[`sessions/promote.ts`](../../../packages/server/src/sessions/promote.ts)'s
header is the precedent and applies unchanged: an unfired hook's premise and
entrances, a hidden goal, and a hidden channel are hidden content, and a
surface that spoils them to the person still playing defeats the feature. So:

- The wizard's preview of what carries over is **redacted** — names, the
  current goal's statement only if it is player-visible, and counts.
- The commit **recomputes** the carry-over on the server from the turn. Nothing
  hidden ever makes a round trip through the browser.
- The condensation reads **only what the player saw**: `transcriptOf(path)`
  and summary links built from it. It never reads `renderedChannels`, which
  includes hidden channels.

### 1.4 The established-facts lorebook is a precursor, not 16 §3

[16 §3](../16-authoring.md)'s lorebook extraction reads the story bible, which
does not exist until 4.0. This phase reuses the memory extractor
(`memory/extract.ts` — its prompt, schema and reader) over the summary chain
and the recent turns, and puts the result in front of a person to keep, edit or
drop. It is the **offered, never automatic, reviewed before it lands** half of
16 §3 with a cheaper reader under it — and when the bible lands, it is the
reader that changes.

### 1.5 An opening is a turn, written by the engine

The chosen written opening becomes the session's first turn: `output.text` is
the opening, there is no `input` and no model call, ~~and `Turn.opening` names
the opening it came from~~ *and no field marks it — §1.8, corrected 2026-10-03
at the merge*. Its effects are the seeding writes of §1.2, proposed
by `engine` through `acceptEffect` exactly as a hand-edit reconciliation's are.
Redo, reroll and guided redo are refused on it — nothing generated it, so there
is nothing to generate again.

### 1.6 A feature in its own document, and a branch that is not `p13`

***The branch is `claude/nice-davinci-xjdpf6`, not `p13`***, by instruction
rather than by choice — [P12 §1.5](29-p12-implementation.md)'s departure, and
recorded for the same reason: so nobody hunts for a branch that was never cut.

***And then it was `p15` — 2026-10-03.*** The phase reached `main` through a
branch cut for it at the branch's tip, `3d499ca0`, into which `main` was
merged and its conflicts resolved before `p15` merged back — the
[P14](31-p14-scene-and-session-import.md) precedent, `1c859485`. **The phase
was renamed on the way, from P13 to P15, because P13 and P14 were both taken**:
`main` had planned, built and merged the Aventuras import as P13 and Scene with
session import as P14 while this was on its branch, and both are cited by hash.
The status at the top says what the rename touched and what it left alone.

### 1.7 A Setup's opening wins over a cast's greetings — always

**Decided 2026-10-03 by the owner, at the merge.** [P14.4](31-p14-scene-and-session-import.md)
built a different first turn while this phase was on its branch: in a mode that
declares `openingTurn`, a session whose cast carries greetings opens on them —
one output-only turn, the greetings chosen per actor by `openings`. P15.3's
Setup opening is also a first turn. Each was right alone; together they both
claimed turn 1, and only one kind of opening can be it.

**When a Setup carries a written opening, the Setup's opening is the session's
first turn, and the cast's greetings are not used for that session** — whichever
of the Setup's openings is chosen, and even when the person starts it cold with
`opening: null`. The reason is the feature's: a Setup made here holds an opening
written for *this* point of *this* story, with the party already seated, and a
greeting is an actor's first line in a story that has not started. A Setup with
no written opening leaves greetings as P14.4 has them.
[25 B18](../25-open-questions.md) records the decision where the other
documents it touches can find it.

**Two edges the decision does not reach, settled at the merge on the
recommended answer, owner deferred — 2026-10-03:**

- ***A greeting chosen beside a Setup that carries an opening is refused***,
  `422 conflicting-openings`, rather than ignored, **wherever `openings` is
  read**: a mode that declares `openingTurn`, with someone cast besides the
  persona. There the Setup's opening is what the session starts on, so a
  greeting chosen in the same request would be a choice the server quietly did
  not honour — the failure the Setup-opening refusal (§1.9) exists to stop — and
  the body asks for two first turns that only its client can choose between.
  Anywhere else no greeting would be written, so the map asks for nothing and is
  ignored, as P14.4 ignores it; so is an empty `openings`.
- ***A Setup with no written opening, whose turn only seeds the party or spent
  hooks, writes that seeding turn first, and the cast's greetings hang from it
  as its children*** rather than beside it as second roots. Beside it, the head
  would start on a greeting whose path never passes through the party or the
  spent hooks — the effects would be written and not in force. As children, the
  head's path runs through the seeding, and a single character's alternate
  greetings are still siblings of each other, exactly as P14.4 lays them out.

`sessions/opening.ts`'s `firstTurns` is the one account of turn 1 since the
merge, and [the API reference](../../api.md)'s `POST /api/sessions` is the
contract.

### 1.8 An opening is a turn with no input and no request, and no field says so

**Recommended answer, owner deferred — 2026-10-03.** P15.1 added `Turn.opening`,
`{ id }`, naming the written opening a turn came from, and P15.3 refused a redo
or rewrite of any turn carrying it. `main` had meanwhile settled the same
question without a field: [P14](31-p14-scene-and-session-import.md)'s greeting
turns are recognised by having **no `input` and no `request`**, which is what
the play surface's `rerunnable` reads. A Setup's opening has neither, so it is
already that kind of turn.

**The field is dropped, and the convention is the test.** `Turn` is the frozen
record ([25 B12](../25-open-questions.md)), and a field on it is a promise every
reader keeps forever; one is worth adding only when a consumer genuinely needs
to tell a Setup's opening from something else. None does. The only reader was
the redo refusal, and with §1.7 only one kind of opening can be a session's
turn 1 — so *which* opening a turn was is a question nothing asks, and
*whether* it was one is answered by what it lacks. The predicate is named once,
`redoable` in `packages/shared/src/turn.ts`, and both readers apply it: the play
surface, which withholds **Redo**, and the turn route, which refuses a redo or
rewrite with its code unchanged, `opening-turn`.

**Wider than the field, on purpose.** The refusal now covers every turn of that
shape — a Setup's opening and its effects-only seeding turn, a cast's greeting,
a hand edit's divergence turn, a turn written by hand with no move, an import's
reply to nothing. Each answered no move and made no call, so a whole-turn redo
would put a reply to nothing in its place, which is *let them talk* sent from
the parent — a gesture the composer already has. Before the merge `main`
refused none of these, and the branch refused only turns that carried the
field. *A swipe of one line is not refused here*: regenerating one member's
line with the lines before it carried is P14's Swipe on a greeting, and it has
something to make.

### 1.9 A Setup opening that is not there has its own refusal

**Recommended answer, owner deferred — 2026-10-03.** Both phases chose the
code `unknown-opening`: P14.4 for a greeting chosen for somebody not in the
cast or one that actor does not have, P15.3 for an opening id the Setup does
not hold, or for any `opening` sent without a `setup`. **The causes differ** —
one names an actor's greeting, the other a Setup's written opening — and a
client that reads the code to say what went wrong would otherwise say the wrong
thing about one of them. So the Setup's refusal is **`unknown-setup-opening`**,
and P14.4's keeps `unknown-opening`; [the API reference](../../api.md) names
both. *The branch's reference also said any `opening` without a `setup` was
refused; the code refused only a string, and the reference now says so.*

### 1.10 A turn that only seeds is drawn, as every turn with no words is

**Recommended answer, owner deferred — 2026-10-04.** The merge left one thing
seen and not judged, in [sitting W](05-manual-testing.md)'s notes: a Setup
started cold, or one with no written opening that makes a party's members or
spends a hook, begins on `setupTurn`'s effects-only turn — no move, no words,
only the engine's writes — and the transcript draws it as an empty row
carrying only its hover actions. Whether to draw it at all was left to a
reader. **It is drawn, and nothing changed to make it so.**

***By the convention already in force.*** The play surface draws a turn by what
it carries: prose as prose — a Setup's opening, §1.5 — messages as a chat —
[P14.4](31-p14-scene-and-session-import.md)'s greetings — and a turn that
carries neither as a row holding its gestures. Every turn the engine writes
without a move has that shape and has always been drawn that way: an undo's
inverse (`undoTurn`), a hand edit's divergence turn (`divergenceTurn`, the very
shape `setupTurn` copies), a person's write to a channel (`writeChannel`), a
backdrop chosen (`selectBackdrop`, `renditions/backdrop.ts`), the record a
*Remember this* capture leaves (`recordEscape`, `memory/capture.ts`), and an
on-demand step's run (`turns/on-demand.ts`). Nothing filters any of them.
Hiding the seeding turn alone would need something that tells it from the
rest, which is the marker §1.8 declined to put on the frozen record; hiding
them all would reverse the convention for turns nobody asked about.

***By the stance.*** The transcript shows the record, not a selection of it.
[03 §8.1](../03-data-model.md) puts a change of state in the turn record so
that it is visible, and the play surface already draws a failed turn rather
than hide it because *"it is on the record with what it managed"*. And the row
is not empty of use: its **Undo** takes the companions out of the party
(`se.party`) — they stay seated in the cast, which the session file holds and
no turn wrote — and puts the spent hooks back in the pool, which is what
somebody rewinding past the start of a story means, and *Continue from here*
and *Make a setup from here* work on it as on any turn. Hidden, all three
would be unreachable from the story.

**What would change it, named so the wrong remedy is not reached for:** if the
row reads as a gap to whoever walks W1, the answer is a line saying what the
turn changed — within what the player may see — on every turn of that shape,
not skipping this one. `PlayPage.test.tsx`'s *a turn that only seeds* pins the
row and its gestures; with turns that have no input and no output skipped when
the transcript is drawn, it fails.

### 1.11 The wizard's dialog loads when it is first opened

**Recommended answer, owner deferred — 2026-10-04.** The merge raised the
entry bundle's ceiling from 336 to 342 kB rather than split (the merge record
below), and named the wizard the plainest candidate yet for the client's first
`lazy()` — a dialog nobody sees until they press a button on one turn, with
every byte of it on the common entry. **Taken.** The dialog moved, unchanged,
into `play/SetupWizard.tsx`, which `SetupFromTurn.tsx` reaches through
`React.lazy` inside a `Suspense`; the button stays on the play page, because
every turn draws it and a lazy button would be fetched as soon as a transcript
drew its first turn. The entry measured **337.79 kB** with the dialog on it,
**335.38** without, and **335.55** with review's changes below, and the
ceiling is **336** again — restored rather than re-chosen, with 0.45 kB to
spare, so the next client change of any size has to say what it added.

- **Where it is drawn**: the module's hook, `useSetupFromTurn`, hands the play
  page the button and what the button opens as two pieces, and the page draws
  the second *after* the turn's row of gestures, not in it — that row fades
  unless the turn is hovered or focused, and a failure note inside it vanished
  as soon as somebody followed its advice to go to the composer. *A review
  finding, 2026-10-04*; [20 §7.2](../20-client-loading.md) records *Remember
  this* as the exception still drawn inside the row.
- **While it loads**, a sentence under the turn's gestures — *Opening the setup
  wizard…* — and not a modal frame. Nothing is covered while the chunk is on
  its way, and a frame the dialog replaced could leave the dialog's focus trap
  remembering one of the frame's own buttons as the place to return focus to,
  gone by the time the dialog closes.
- **If it never arrives** — [20 §5](../20-client-loading.md)'s upgrade under an
  open tab — a local error boundary says the wizard could not be loaded and
  that a reload is the remedy, and the transcript, the composer and an unsent
  move stay where they were; without the boundary the router's would have
  replaced the whole play page. No *Try again*, because `lazy` caches the
  failure as it caches a success; no *Reload* button, because a reload
  discards an unsent move, which is not kept. **If it arrives and then fails
  as it draws**, the same boundary catches it and says only that the wizard
  stopped with an error: the reload advice belongs to a failed load, which the
  `lazy` factory marks with an error type of its own, and a bug would only
  recur after a reload. *Dismiss* hands focus back to the button.
- **Proved**: `tools/entry-budget.test.ts` gained *keeps the setup wizard off
  the entry*, and with the lazy import reverted to a static one both it and
  the byte ceiling fail (the entry measured 338.19 kB).
  `SetupFromTurn.load.test.tsx` holds the waiting and failing states and the
  focus on *Dismiss*, `SetupFromTurn.crash.test.tsx` the dialog that fails as
  it draws, and `PlayPage.test.tsx`'s *opens the wizard outside the row that
  fades* the placement — each shown failing with its mechanism removed. The
  dialog's own tests open it through the button, so through `lazy()`.

[20 §7.2](../20-client-loading.md) records it as the client's first lazy
boundary, and the shape the next one starts from.

### 1.12 A Setup has no place for a cast that is not a party — open, as 25 B19

**Recommended answer, owner deferred — 2026-10-04: the asymmetry stays as
documented, and is recorded as an open question so it is not lost.** The merge
found that *Save as a setup* writes no `partyDefault` while the creation path
has read one since P15.3, and argued — [P7.4](23-p7-implementation.md)'s
symmetry paragraph and `setup-from-form.ts` — that writing the form's
*Characters* there would not close it: they are a cast, which Start seats
without making anyone a companion, and `partyDefault` is a party, which the
creation path makes companions on a seeding turn. So a Setup saved from a form
that picked characters starts with nobody seated. **The same gap reaches this
phase's own carry-over**, found while recording it, and §1.2's known gaps now
carry it: a chat whose character was cast and never made a companion yields a
Setup without them. In a chat, the cast panel's *Add to the cast* seats them
once the session exists, which is a workaround and not a round trip.

*Said where a person reads it, and not in the wizard's last sentence.* The
in-app help and the user guide now say what *the party* means — who travels
with you, not everyone seated — and that a character in the scene who never
joined it does not carry. The wizard's *Saved* screen still says *a session
started from it begins where this one was*, and stays so: the preview the
person saved from had just said *The party (nobody but you)*, the other four
known gaps of §1.2 are not qualified there either, and a caveat on that one
sentence would stand in for B19's answer rather than be one.

**What closing it takes is a Setup that holds a cast distinct from its party.**
[04 §2](../04-schemas.md) makes a new optional field free in format terms — no
version bump, and readers keep what they do not know (`schema/common.ts` sets
no `additionalProperties`) — so this is *not* [25 B16](../25-open-questions.md)'s
closed-union question. What makes it the owner's is permanence: from the first
release that exports native objects, a Setup field's name and meaning are fixed
in every file anyone holds, and how a Setup's cast meets
[25 B18](../25-open-questions.md)'s greetings rule and this phase's carry-over
is a design question rather than a field to add in passing.
[25 B19](../25-open-questions.md) is the question.

---

## 2 — Stages

*Depends on:* nothing outstanding. [P7.4](23-p7-implementation.md) (the Setup
on creation), [P8](25-p8-implementation.md) (the summary chain and the memory
extractor) and [P7.5](23-p7-implementation.md) (the hook pool and `se.hook`)
are the prior art, and all three are on `main`.

### P15.0 — This document

The readiness audit (§0) and the decisions (§1), written before code.
**Done — `a46a1cc`.**

### P15.1 — The schema

`Setup.storySoFar` and `Setup.spentHooks`, both optional; `Turn.opening`; and a
`story-so-far` arm on the block provenance, so the workbench can say where the
root came from. [04 §7](../04-schemas.md) gains the two fields and a subsection
on emitting a Setup from a turn.
*Proof obligation:* a Setup without either field is byte-identical on a round
trip, and one with them validates.

**Done — `f8affa5`.** *`Turn.opening` did not survive the merge (2026-10-03):
§1.8 is why, and the frozen record carries no field from this phase.*
### P15.2 — The summary root

`planChain` and `ensureChain` take an optional root; the runner and every other
assembler emit it as the oldest summary link.
*Proof obligation:* **with no root, every existing chain's keys are unchanged**;
a different root keys a disjoint chain; the fork properties hold with a root.

**Done — `393f04b`.** *Re-threaded at the merge (2026-10-03) — §1.1's note.*
### P15.3 — The opening turn

`POST /api/sessions` consumes a Setup's written opening, `partyDefault` and
`spentHooks` through one engine-written turn, and takes an `opening` parameter
(absent is the primary, `null` starts cold).
*Proof obligation:* turn 1 is the opening, the party channel and the spent hooks
are written by it, and a redo naming it is refused.

**Done — `d364808`.** *Met [P14.4](31-p14-scene-and-session-import.md)'s
greetings at the merge (2026-10-03): §1.7 is which wins, §1.8 how a redo
recognises an opening without `Turn.opening`, and §1.9 the refusal's own code.*
### P15.4 — Starting from a Setup in the browser

The session form offers the account's Setups and their written openings; a
Setup's own page offers *Start a session*; the play surface does not offer redo
on an opening turn.

**Done — `b2fc84c`.** *Since the merge (2026-10-03) the form carries
[P14.5](31-p14-scene-and-session-import.md)'s greeting pickers too — beside a
Setup only when it has no opening of its own, by §1.7 — and the play surface
withholds redo by `main`'s rule rather than by `Turn.opening` (§1.8).*
### P15.5 — The carry-over

A pure builder from the state at a turn to a Setup, and the redacted preview of
it.
*Proof obligation:* **a serialised preview contains no unfired premise, no
entrance text and no hidden goal's statement**, for any pool and goal chain.

**Done — `ffb126a`.**
### P15.6 — The draft

`POST /api/sessions/:sessionId/turns/:turnId/setup-draft`: the story so far, an
opening, a name and blurb, and candidate facts, each its own model call through
its own step definition so one failing discards nothing.
*Proof obligation:* the prompts carry the transcript and never hidden content;
a warm summary chain costs no summariser call.

**Done — `bb29aa5`.** *Its summariser rewritten at the merge (2026-10-03) —
the merge record below.*
### P15.7 — The commit

`POST /api/sessions/:sessionId/turns/:turnId/setup` writes the companion
lorebook, then the Setup.
*Proof obligation:* **the round trip** — emit at a turn, start a session from
the Setup, and the new session's first prompt carries the story so far, turn 1
is the opening with the party seeded, the spent hook is fired, the goal current
at the turn is `goals[0]`, and an unfired hook is still in the pool.

**Done — `f7c789f`.**
### P15.8 — The wizard

*Make a setup from here* beside *Continue from here*, opening a dialog with the
carry-over, the story so far, the opening, the facts, and a name.

**Done — `e033435`.** *Since 2026-10-04 the dialog is a chunk of its own,
fetched the first time the button is pressed (§1.11); what it shows and saves
is unchanged.*
### P15.9 — Close-out

The gate lands in [manual testing](05-manual-testing.md) as a sitting, the
design corrections are checked against what shipped, and the changelog prose is
parked in §2.1 for [P12 §2.1](29-p12-implementation.md)'s reason.
**Done — ~~this commit~~ `feb7c8b`**, which is the one that ~~says~~ *said, on
the branch,* where the phase stands. *(The hash written on 2026-10-03, at the
merge: "this commit" stops naming anything once the document has moved on.)*

### The merge into `main` — 2026-10-03

*Not a stage.* `p15` was cut at the branch's tip, `3d499ca0`, and `main` was
merged into it — the [P14](31-p14-scene-and-session-import.md) precedent,
`1c859485` — so every hash above stays reachable. The first turn is at
§1.7–§1.9, the summary root at §1.1's note, the disconnect at §0.5. The rest:

- **The draft** (`turns/condense.ts`) had its own path to the chain and kept
  every reply — on `main`, a cut-off summary under the runner's key and, for a
  pictured move, a chain the runner never reads. It takes the runner's path,
  plan (root included) and keep rule now, and reads the root and every link,
  not the last alone. A link it cannot derive fails every part still wanted
  with that link's class (`summary-truncated` or `summary-no-answer` for a
  link not kept). *Recommended answer, owner deferred:* a part cut off at its
  length limit is `truncated` and not offered. A provider failure
  carries `class` and `remedy`, `window-too-small` is a refusal rather than a
  500, and calls are usage lines,
  `setup-draft:<part>` and `setup-draft:summarise` ([the API reference](../../api.md)).
- **The client**: a chosen Setup hides *Characters*, says when it sets
  greetings aside, and offers *How they open* when it has none; the two new
  refusals clear the stale choice; a blank greeting is not offered; *Redo*
  reads `redoable`; the wizard gives remedies; *Story so far* links to its
  Setup; the entry ceiling rose from 336 to 342 (`tools/entry-budget.test.ts`)
  — *and fell back to 336 on 2026-10-04, when the wizard's dialog moved off the
  entry (§1.11)*.

No gate row was edited.

### What is deliberately not in this phase

- **An end-to-end journey.** `e2e/journeys.spec.ts` admits a journey by its
  being *catastrophic to break*, and the seven it holds are the list; this is a
  feature beside them. The browser walk that did happen, before
  [P15.8](#p158--the-wizard) committed, is recorded in its commit.
- **A live test of the condensation.** The prompts are new, and whether a real
  model condenses well is critical row 1 — a judgement a live test could not
  make, since those assert structure and never prose.
- **Seed openings.** A Setup made here carries one written opening; expanding a
  seed is still [P7B §1.11](24-p7b-presets-and-prompts.md)'s revisit.
- **Consuming a treatment's or an actor's openings.** Only a Setup's are read at
  creation, which is the half this feature needed. *(2026-10-03, at the merge:
  an actor's are read too now — `main`'s [P14.4](31-p14-scene-and-session-import.md)
  plays them as greetings in a mode that declares `openingTurn` — and §1.7 is
  which of the two plays when both could. A treatment's are still not played
  at creation.)*

---

## 2.1 — What the changelog will say

*Written at P15.9, here rather than in `CHANGELOG.md`, for
[P12 §2.1](29-p12-implementation.md)'s reason: that file's headings are parsed by
the About surface and an unreleased one is not a heading it takes.*

**Added**

- **Make a setup from here.** Every turn of a session offers it beside
  *Continue from here*. A dialog drafts the story so far, an opening, a name and
  a blurb, and the facts the story has established; you edit what you like,
  switch off what should not carry — the party, the goal, the plot hooks — and
  save it as a Setup in your library. A session started from it begins where
  this one was, without the turns behind it, and it travels in a package like
  any other Setup. **Nothing it would spoil is shown**: hooks that have not
  happened and goals hidden from you are carried, and counted, and not described.
  *(2026-10-04, §1.2's fifth gap and [25 B19](../25-open-questions.md):
  whoever writes the release should say that **the party** is who travels with
  you — a character who was in the scene without ever joining the party, such
  as a chat's character the story never made a companion, does not carry, and
  in a chat can be added to the cast again once the new session has begun.)*
- **Start a session from a Setup.** From the session form, which now offers your
  Setups and their openings, and from a Setup's own library page. Until now the
  browser had no way to start from one.
- **A Setup's opening is the session's first turn**, and its party is seated in
  it. `opening: null` starts cold. *(Added 2026-10-03, §1.7:)* In a mode that
  opens on the cast's greetings, a Setup with an opening of its own opens on
  that instead, and the greetings are not used; a greeting chosen beside it is
  refused (`conflicting-openings`). Beside a Setup that only seats a party or
  spends hooks, the greetings come after its seeding turn.
- **A Setup can carry the story so far**, and a session started from it shows
  the model that text from its first turn, as the oldest part of its rolling
  summary.

**Changed**

- A redo or rewrite ~~naming an opening~~ is refused — an opening was written, not
  generated. *(2026-10-03, at the merge, §1.8: any turn nothing made is, as
  `422 opening-turn` — an opening, a greeting, a hand edit's divergence turn, a
  turn written with no move, an import's reply to nothing; a swipe of one line
  is not. The play surface already withheld Redo from these, so the change
  shows only through the API.)*

**Fixed**

- **Leaving while a picture is being made now cancels it.** Illustrate was meant
  to stop its model call when you navigated away or closed the tab, and never
  did: the call ran to the end and the picture was asked for and paid for.
  *(2026-10-03: true, and not this phase's — `main` fixed it in `af5811a0` and
  this branch's fix was dropped, §0.5. The line stays because none of the
  entries parked since alpha 4 — [main audit](32-main-audit.md) §7,
  [P12 §2.1](29-p12-implementation.md), [P13 §3.5](30-p13-aventuras-import.md),
  [polish §25](06-polish.md) — carries it; whoever writes the release takes it once.)*

---

## 3 — The exit gate

Two tiers, per [manual testing §0](05-manual-testing.md). **The rows below are
not edited to match what was walked.**

### 3.1 The critical list

*Registered in [manual testing](05-manual-testing.md) as sitting **W** —
lettered T on the branch, and re-lettered at the merge on 2026-10-03 because
`main` had spent T, U and V. Unwalked.*

| # | What | Why it is critical | Check |
|---|---|---|---|
| 1 | Emit a Setup around turn thirty of a real session against a real model and start from it: the first two turns continue the story — names, situation and party intact — and the opening reads as a scene rather than a recap | The whole claim, and only a person can judge *continues the story* | By hand, with a live endpoint |
| 2 | In a session with an unfired hook and a hidden goal, the wizard shows neither, and the new session does not surface either early | Spoiling the person still playing is the one failure this feature must not have | By hand |
| 3 | Start from the same Setup twice and get two independent sessions with the same opening; edit its story so far in the library and a third session carries the edit | *Start from again and again* is the primary use, and the edit is what makes a Setup better than a saved session | By hand |

### 3.2 The remainder — extends the standing list

| # | What | Where |
|---|---|---|
| 4 | A Setup made here, exported as a package to a second account, starts there with its facts lorebook | [manual testing](05-manual-testing.md) |
| 5 | Run from a session whose preset has no summary slot, the wizard warns, and the warning is true | [manual testing](05-manual-testing.md) |
| 6 | A kept fact activates in play on its key | [manual testing](05-manual-testing.md) |
