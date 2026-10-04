# 05 — Manual testing, running

**Status: standing. This file does not complete.** Opened as a ledger
2026-09-07 at `bded9f7`, merged with the pre-P6 walk sheet 2026-09-08. It holds
what a person still owes the project, what they did about it, and what to do
next — and it keeps holding them, because manual testing runs behind
implementation by construction and every phase that closes adds to it.

**Why one file and not two.** The ledger and the walk sheet each argued that
*"they go stale differently: a ledger is true until a phase closes, a walk sheet
is true for an afternoon."* That argument dies the moment the sheet stops
completing — a never-completing sheet is a second ledger at finer grain, in a
second place, which is the duplication the ledger opens by naming. **The
perishable unit is the sitting, not the document.** A walked sitting is struck
through where it stands and keeps its results; the file that holds sittings is
true forever.

It also ends a live duplication: three of the ledger's five outstanding passes
were already items on the sheet, each citing the other, and the two documents
kept two gate tables that are two update sites for one fact.

## The two-tier gate

**This is the file's central claim and the project's testing modality from
2026-09-09.** It replaces a rule that was good and did not survive contact with a
solo project.

**The old model was one gate per phase, walked in full by a person, blocking the
close.** Its record is in §6: **five phase gates accumulated unwalked, and no
gate in this project's history has ever been closed by a person.** P3's fifteen
steps, P4's fifteen, P5's eighteen, P6's fourteen, P6A's thirteen — each phase
document honestly recording that its own gate was outstanding, and none of them
saying it about the sequence.

**A gate nobody walks is not a gate. It is a wish** — [work plan §0.5](01-work-plan.md)'s
*"a bar nobody owns is a wish"*, one level up. The failure was not laziness; the
unit of work was wrong. A fifteen-step walk wanting a real library, a second
machine and an afternoon does not fit between finishing a phase and starting the
next, so it never happened, and the next phase started anyway. And the
arithmetic was worsening: **P7 through P11 will land fifty-five more
person-walked steps** on a pile that has never once been drained.

***The first of the five has landed, and the prediction was right about the
steps and wrong about the pile*** (2026-09-13). P7's ten steps arrived as
thirteen gate rows and **put three on the pile** — sitting **L**. The other ten
went to §5 with a named test, to §10 with an owner, or were already answered by
P6. **Forty-five of the fifty-five are still to come**, and if they resolve at
P7's ratio the pile grows by a third of what this sentence feared. *That is the
split working. It is not the pile draining, which is a different number and is in
[§0's tally](#0-where-this-stands-2026-09-09).*

***And there are six phases now, not five*** — [P7B](24-p7b-presets-and-prompts.md),
skeletoned 2026-09-11 and widened 2026-09-14. It lands a gate like any other
phase: **seventeen rows, with four marked as critical-list candidates on the
day the document was written** rather than on the day it closes. That is the
first time a phase has named its criticals in advance, and it is worth noticing
why it could — **both halves of this phase were found by an audit**, so what
each stage claims was written down before anybody built anything.

**The denominator moved and the ratio did not**, which is the only honest way to
report a new phase arriving on a pile this section is about. *And the pile is
not what grew*: P7B's seventeen rows resolve to three walks and a sitting, which
is the same arithmetic P7's thirteen ran — the second instance of the split
doing what it was adopted to do, and still not a drained pile.

> **When a phase closes, its exit gate splits.**
>
> **The critical list is the gate.** A small set of checks — walkable in a
> sitting or two, with what is to hand — derived from the full gate by the
> criterion below. **These are walked before the phase closes.** They are the
> gate in the operative sense: the phase does not close until they have results.
>
> **The remainder extends the standing list.** Everything else arrives here as
> sittings, each with a result in §2's vocabulary — `BLOCKED`, `DEFERRED`, or
> blank-and-sequenced in §1. It is drained continuously, by whoever has an
> afternoon, against whatever build is current.
>
> Automated steps go to §5 with the test named. Deferrals go to §10 with a name
> beside them.

**This is not a relaxation, and the arithmetic is the argument.** The old
model's fifteen steps had a completion rate of zero. A four-step list walked at
every close is strictly more evidence, and it arrives when it is cheapest —
which is [work plan §7](01-work-plan.md)'s whole reason for putting a checkpoint
at a particular moment rather than eventually.

**The precedent is already in the corpus, twice.** [P6A](19-p6a-alpha-1.md)'s
status line reads *"the phase closes on its merge into `main`, and the exit gate
… waits on a person with Docker"*, and [P4 §3](16-p4-implementation.md) says
outright *"P4 can close without it; PLAYABLE is where its absence will be
felt."* What is new is that this becomes the rule rather than two exceptions —
and that the part which *is* held is chosen deliberately rather than being
whatever nobody got to.

### The criterion

> **A check belongs on the critical list if and only if all three hold.**
>
> **(i) It can falsify a claim the phase makes about itself** — not a claim its
> gate merely *transports* from another phase. This clause is what keeps the
> list small: [P6B §3](20-p6b-playable.md) step 8 is *"P5's eighteen steps,
> walked by a person"*, which is P5's claim living in P6B's gate, and it belongs
> in sitting F rather than in P6B's close.
>
> **(ii) The claim compounds.** A wrong answer found two phases later costs more
> than one found now. This is the only warrant for walking it *at this moment*
> rather than eventually, and it is [work plan §7](01-work-plan.md)'s argument:
> the assembler, the record and the budgeter are built on by every phase after
> them, so an error in any of them compounds per phase.
>
> **(iii) It is walkable with what is to hand.** A check blocked on a resource
> with lead time is a deferral, not a check. **Holding a gate open on `BLOCKED`
> is precisely how a phase stops closing** — which is how §3's R1 came to block
> four obligations across three phases.

**Breadth, duration, platform and corpus are not criticality** — not less
valuable, differently urgent. A coverage sweep asks *does everything work*, a
question with no phase attached and the same price next month. A leak at turn
forty is as findable in November as today.

**And a caveat that is inherited rather than assumed:** clause (ii) privileges
compounding, and compounding is a *prediction about the plan* rather than a
fact. Re-read it when each phase opens. If P7 reshapes the mode contract far
enough, some of what is excluded today as *equally cheap later* becomes more
expensive instead.

### The three things that keep it honest

1. **The gate document is never edited to match what was walked.**
   [P6B §1.3](20-p6b-playable.md) names the failure: *"a walk that edits the gate
   until it passes."* The steps keep asking what they asked; a second table in
   the phase document records what was answered and by what. **That separation
   is the whole mechanism**, and without it the two-tier model is a rubber stamp
   with extra steps.
2. **The criterion is written down and applied, not argued per phase.**
   Otherwise *critical* means *what I felt like doing*.
3. **The standing list must visibly drain.** §5 and §9 are the two valves.
   [manual gate §4](11-p2-manual-gate.md) names what they exist against: *"a
   manual checklist grows every year because nobody wants to say which items
   were never automated."* **If this file only grows, the model has failed**, and
   the honest response is to say so here rather than to keep adding sittings.

**The intake is mechanical, not a matter of remembering.** ~~Every exit gate in
this project ships at least one step marked *"Only a person can walk"*~~ — **five
of nine do**, and the four that do not are P4, P6, P8 and P9 (counted
2026-09-13, at P8's revisit). P3, P5, P7, P10 and P11 carry the phrase, always on
the step that carries the phase's actual claim, and that is what to grep for when
a phase closes.

***A mechanical intake over a convention four documents do not follow is an
intake that returns nothing and says nothing***, which is the same failure this
section's own opening describes one level up. **The repair is not to add the
phrase to four gates** — P4's and P6's are closed, and adding a marker to a
walked gate is editing a gate after the fact. It is to say which gates the grep
covers, which is now said. [P8 §3.1](25-p8-implementation.md) carries the phrase
on its **critical list** instead of on a step, for that reason, and that is the
pattern for any gate revised after its sketch.

**The two valves, named once more because they are the model's only defence
against itself.** §5 records what a test now covers, so nobody walks it again;
§9 holds what *should* be a test and is not. Without both, "manual testing,
running" becomes "manual testing, accumulating."

---

## 0. Where this stands, 2026-09-09

**One hundred and ten items across eleven sittings; forty-nine have a result
and sixty-one are blank.** Of the forty-nine: 37 `PASS`, 4 `PART`, 4 `BLOCKED`,
3 `AUTO`, 1 `DEFERRED`, and **no `FAIL`** — which says less than it looks like,
because a `FAIL` needs a walk. Two sittings are swept clean (A, C); B stands at
six of nine.

***Updated 2026-09-13: one hundred and fifteen items across twelve sittings,
still forty-nine results.*** [P7](23-p7-implementation.md)'s gate arrived as
**L**, five items, every cell blank. *The base figures above are the 2026-09-09
count and the delta is stated against them rather than re-derived — recounting
eleven sittings is an afternoon and a fresh chance to be wrong.*

**No gate in this project's history has ever been closed by a person.** P1's is
closed by CI and is the only row in §6 with nothing owed. **Three more phases
closed on 2026-09-09 without theirs being walked** — P5, P6 and P6A, under the
model in the section above — and the twenty-two steps that made them close
arrived here as F, J and I. **The item count grew by twenty-two on the day the
model was adopted**, and that number is the model on trial: if it is bigger
again next quarter with the same forty-nine results under it, the answer is to
say so here rather than to add a twelfth sitting.

***So: saying so, 2026-09-13, five days rather than a quarter.*** The twelfth
sitting is here and **the forty-nine has not moved.** Nothing that arrived on the
day the model was adopted has produced a result since, and a second phase's gate
has landed on top of it. **That is the criticism and it is unanswered.**

***And the other half, which the same paragraph has to be honest enough to
carry.*** **P7's gate was thirteen rows and put three on this pile.** Nine are
answered by named tests, one was already discharged by P6, and two are deferred
with an owner — so the arithmetic ran 13 → 3 rather than 13 → 13. **Under the
model this file replaced, all thirteen would be sitting here blank**, which is
what P3's fifteen, P4's fifteen, P5's eighteen, P6's fourteen and P6A's thirteen
did. *That is the first evidence the split does the thing it was adopted to do*,
and it is worth exactly as much as the criticism above and no more: **sorting a
pile faster is not draining it.** The number to watch next quarter is still the
forty-nine.

***Updated 2026-09-16: fifteen sittings, still forty-nine results.*** [P7B](24-p7b-presets-and-prompts.md)'s
gate arrived as **M**, [P8](25-p8-implementation.md)'s as **N** and
[P9](26-p9-implementation.md)'s as **O**, every cell of all three blank. *The
count of items is deliberately not re-derived, for the reason given three
paragraphs up.*

***Updated 2026-09-17: sixteen sittings, still forty-nine results.***
[P10](27-p10-implementation.md)'s gate arrived as **P**, eight rows, every cell
blank. **That is a fourth consecutive phase whose gate has landed on this pile
without a result being written anywhere on it**, and the paragraph three above
said the number to watch is the forty-nine. It has not moved in eight days and
four phases.

***And P is a different shape of unwalkable from O, which is worth the
sentence.*** O waits on **one** thing and is otherwise an hour. P's three blocked
rows want three unrelated things — a supervised install, a second machine, a
person with an hour — so it does not become walkable when any one of them
arrives. **The honest reading is that the split is still sorting the pile and
still not draining it**, and that the pile now contains two sittings that a free
weekend would not clear.

***And O is a new kind of row on this pile, which is worth one sentence rather
than a section.*** Every other unwalked sitting is waiting for **an hour**. O is
waiting for **a thing** — [R10](#3-standing-prerequisites), an endpoint that
serves the `image` role — and no other outstanding prerequisite produces one. So
a weekend that drained K, L, M and N would leave O untouched and P9 open. **That
is not the model failing; it is the model reporting an errand**, which is what
§0's criterion calls clause (iii) and what this file exists to make visible
rather than to absorb.

***Updated 2026-10-04: twenty-six sittings, and the alphabet is spent.*** Q, R,
S, T, U, V, W and Z arrived after the last update without a line here. Today X
and Y arrived: [P13](30-p13-aventuras-import.md)'s and
[P14](31-p14-scene-and-session-import.md)'s critical lists, registered five
days and four days after their merges. *That lateness is the new failure.*
The phases from P7 to P12 each had a sitting here within a day or so of the
merge, and these two did not. Nothing noticed until a later sitting reserved their letters. *No commit to
this file since 2026-09-17 records a walk*, so the count of results is still
forty-nine. **Eleven phases are now held open by a critical list here** — P6B,
P7, P7B, P8, P9, P10, P11, P12, P13, P14 and P15 — which is more than at any
earlier update. The paragraphs above still apply: the split is sorting the
pile, and it is not draining it.

***Later the same day, AA arrived*** — [P16](35-p16-world.md)'s critical list,
registered before the phase opens as T was — so the count is **twenty-seven**,
AA the first sitting past Z (§4 says how the letters run on), and the results are
still forty-nine. *P16 is not a twelfth phase held open here*, because it has not
opened; it joins that count the day it does.

The walk so far has produced six findings in [playable log](21-playable-log.md) and eleven
graded refinements in [refinements](22-walkthrough-refinements.md), and its sharpest
result is one nobody asked for: sitting C ran eleven deliberate breakages,
passed eleven, and produced **no refinement note at all**, while the sittings
where nothing went wrong produced five. The app is well built for failure and
thin for progress.

---

## 1. What to walk next

*Rewritten whenever something is walked or a prerequisite lands. Everything else
is below; this is the afternoon.*

1. **L1** — the cheapest item in this file and the one with the most riding on
   it. **The repository and a text editor; no install, no endpoint, no
   prerequisite**, which is true of nothing else on this list. It is first
   because it is first-out rather than because it is most urgent: L1 answers
   whether [06 §9](../06-modes-and-turn-pipeline.md)'s contract holds for
   somebody outside it, and an afternoon spent finding out that it does not is an
   afternoon that changes [P8](25-p8-implementation.md) onward.
2. **K, entire** — and it is not an afternoon. ~~**This is the only item on this
   list holding a phase open:**~~ ~~**two items on this list now hold a phase
   open** (2026-09-13)~~ ~~***three, since 2026-09-15***~~ ~~***four, since
   2026-10-03***~~ ***six, since 2026-10-04*** — this list's own items, not every open phase in the file: under
   [§0](#the-two-tier-gate)'s model K *is* [P6B](20-p6b-playable.md)'s gate, so
   P6B does not close until K1–K9 have results; **L is
   [P7](23-p7-implementation.md)'s**; ~~and~~ **M is
   [P7B](24-p7b-presets-and-prompts.md)'s**; ~~and~~ **W is
   [P15](33-p15-setup-from-a-turn.md)'s** (item 11); and **X is
   [P13](30-p13-aventuras-import.md)'s** and **Y is
   [P14](31-p14-scene-and-session-import.md)'s** (items 13 and 14), on the same
   terms.
   ~~K0 cuts alpha 4 before anything is recorded.~~ *K0 said cut alpha 4, and it
   was cut on 2026-09-09 — before P7's sixty-seven commits and P7B's twelve.
   **L0 and M0 are the same question asked again** and all three sittings want
   one answer, so read L0 before walking any of them.* Two sittings and 45
   minutes of desk work.
3. **L2 and L3, in the sitting K builds.** Both want a running install with a
   real connection, which is exactly what K1 stands up — so they are cheaper
   after K and duplicated work before it, the same argument item 7 makes for F.
   **L4 after them**, because it is what closes P7.
4. **M, entire, in the same sitting** — added 2026-09-15. **Every row of it
   wants what K1 stands up**, which is the honest difference from L: L could
   claim nothing waited on a resource and M cannot, because every one of its
   rows is about what a turn assembles. So M1–M4 belong beside L2 and L3 rather
   than ahead of them, **M6 is three cheap walks once the install is up**, and
   **M5 is an hour of play** that reads more like G than like a step. M7 closes
   the phase.
5. **D11–D20** — needs only the running app and a text editor (R7). D18, D19 and
   D20 are the three storage scenarios no other document has a home for, and
   D17 needs a re-check first: it was flagged unperformable, and P5.6 may have
   made it performable.
6. **E3–E5, E7–E13** — the fixture arm of import, walkable without the corpus.
   Only E1, E2 and part of E6 want R1.
7. **F0–F5, F7–F10, F13, F15, F16** — lore against a seeded install. F0 is the
   entry point and the walk nobody could do before [P6B.0](20-p6b-playable.md).
   **Walk K first regardless:** K1 and K2 build the install F wants, so F is
   cheaper after K and duplicated work before it — and K1 discharges F0 outright.
8. **B2 and B8** when a local runtime (R3) is confirmed; **B6** when a second
   machine (R5) is; **H1 and H2** when there is an ubuntu box (R6).
9. **U** — added 2026-09-27, [26 E15](../26-open-questions.md)'s pictures on a
   move. **U1 needs only a phone and the running app**, and it is the claim the
   feature's privacy rests on; U2–U4 want [R12](#3-standing-prerequisites). Not
   a phase's gate: a roadmap feature's, which is why it drains with the
   standing list rather than holding anything open.
10. **V** — added 2026-09-26 on a branch as T, re-lettered at its merge
    (2026-10-03): [polish §25](06-polish.md#25-a-connection-can-be-tried-without-taking-a-turn)'s
    connection test against real endpoints. It rides along with whichever of
    item 8's walks first puts a real endpoint in front of somebody: twenty
    minutes against R2 and R3, and **V5 is the cheapest way to find out whether
    an R10 candidate is one** — the errand the paragraph below says O waits on.
11. **W** — added 2026-09-26 on a branch as T, re-lettered at its merge
    (2026-10-03): [P15](33-p15-setup-from-a-turn.md)'s critical list, *make a
    setup from here*, and **it holds a phase open** — P15 does not close until
    W1–W3 have results. It wants a real model
    ([R2 or R3](#3-standing-prerequisites)) and a session of about thirty turns
    played against it, so it is cheapest in the sitting that has played one:
    **after K, beside G**, whose hours produce exactly the session W1 starts
    from.
12. **Z** — added 2026-10-04: [polish §26](06-polish.md#26-a-connection-that-hides-another-says-so)'s
    connection that hides another. **Ten minutes, a text editor and a second
    account, and no endpoint** — walkable today, as D11–D20 and U1 are. Not a
    phase's gate, so it holds nothing open; it is on this list because it is
    cheap, not because anything waits on it.
13. **X** — added 2026-10-04: [P13](30-p13-aventuras-import.md)'s two critical
    lists, as one sitting in two halves, and **it holds a phase open**. Every
    row wants [R13](#3-standing-prerequisites), an Aventuras install with a
    library and stories in it, so it is an errand before it is a sitting, as O
    is, though a cheaper one. Installing Aventuras and playing a story with a
    branch in it is an afternoon, where R10 is an endpoint nobody has. X2 also
    wants a second account on the same server. **X8 alone wants a picture
    Aventuras drew**, which needs an image provider inside Aventuras. The other
    rows can be walked without it, **but P13's close waits on it**, as P9's
    waits on O: X records it as blocked rather than deferred.
14. **Y** — added 2026-10-04: [P14](31-p14-scene-and-session-import.md)'s
    critical list, and **it holds a phase open**. Y1, Y2 and Y5 want what K1
    stands up, and Y1 one thing more: a character with at least two written
    openings, because the seeded Mara has one. They belong **in the sitting
    with L2, L3 and M**, after K.
    Y3 and Y4 want a SillyTavern folder and a Marinara profile that have been
    used. The walker's own will do, on the reading Y records, and each is half
    an hour of play in the other program with the same key. Y0 says what each
    must hold, including a group on a reply order other than SillyTavern's
    default, without which Y3 cannot fail.

**Not next, and deliberately:** G, which wants hours and is PLAYABLE's second
sitting — K5–K8 are the short form of it, and what they cannot reach is exactly
what G is for; and I and J, which want a container and a two-hundred-turn
session respectively.

***Not on this list at all, and that is the point*** — added 2026-09-16. **O is
[P9](26-p9-implementation.md)'s gate and it is ~~the fourth item holding a phase
open~~ another phase held open** *(2026-10-03: the number went stale when W
joined the list, so the sentence no longer carries one)*, but it does not appear above because **it cannot be scheduled**: every
row wants [R10](#3-standing-prerequisites), an endpoint that serves the `image`
role, and no other outstanding prerequisite produces one — R2 is a chat endpoint,
and K, L, M and N all queue on that. So the four sittings above could be walked
in a weekend and leave O exactly where it is. *The list is what to walk next; O
is what to **get** next*, and the errand is one endpoint.

*Not on it either, and for a plainer reason* — added 2026-10-04: **T and AA**,
the critical lists of [P12A](34-p12a-the-look.md) and [P16](35-p16-world.md),
registered before either phase opened. Their rows are known and their code is
not written, so there is nothing to walk. *AA0's errand is the exception*, and it
belongs on whatever day P16 opens rather than on this list: a data directory and
an archive from before the rename, which cannot be made afterwards.

---

## 2. How to write a result

Seven words, and only seven, so that a filled sheet can be read at a glance:

| Result | Means |
|---|---|
| **PASS** | Walked, and it did what the step says. |
| **FAIL** | Walked, and it did not. Gets a finding in [playable log](21-playable-log.md), and the id goes in the cell. |
| **PART** | Walked, and it half did. The cell says which half; a finding carries the rest. |
| **BLOCKED** | Cannot be walked here. The cell says what it needs and who arranges it. |
| **DEFERRED** | Not this phase's. The cell names the phase that has it. |
| **AUTO** | A test does it. The cell names the test. No walk. |
| **CORRECTION** | The step describes behaviour the code does not have. **The step is wrong, not the code** — correct it in the phase document that owns it, and record that here. |

**`CORRECTION` is the one worth going looking for.** [P2C §3](12-p2c-first-real-run.md)'s
own account of the first P2B walk is that the three corrections it produced were
worth more than the ticks, and this sheet's citations were written from documents,
some of which are two phases old.

**Write the result the day you walk it, not afterwards.** A remembered outcome is
an opinion.

**A blank is not a result.** `BLOCKED` and `DEFERRED` are results — they say what
the thing needs and who arranges it. An empty cell says only that nobody has
looked, which is the state this whole file exists to make visible.

---

## 3. Standing prerequisites

*Not "arranged before the day" — these outlive any one walk, and what each
unblocks reaches across phases rather than across one sheet.* Ordered by lead
time, longest first, because that ordering is a property of the prerequisite and
not of the steps.

**Nothing here is walkable on the day it is thought of.**

| # | What | Unblocks | State |
|---|---|---|---|
| **R1** | **A real library somebody else made** — a used SillyTavern data directory, a used Marinara install, and a handful of explicitly-permissive lorebooks. None of it is in the repository and none of it can be synthesised. | E1, E2, E6, F1, F6 — and [P4 §3](16-p4-implementation.md) step 1, [P5 §3](17-p5-implementation.md) step 6, PLAYABLE's third hypothesis, and [testing §5](03-testing.md)'s corpus policy, which is a plan rather than a record that it ran | **Not to hand. The longest lead item in the file and the only one that cannot be started by deciding to.** Begin acquiring before G, not after: four obligations read the same shelf. |
| **R3** | **A local runtime** (Ollama, LM Studio, llama.cpp) with one model. | B2, B8, and G's whole endpoint | Unconfirmed |
| **R5** | **A second machine on the network**, to sign in from. | B6, I's step 7, and — added 2026-09-17 — [P10 §3](27-p10-implementation.md) step 9 and sitting P's **C3**, which is the one row `storyengine.local` cannot be proved by any other means | Unconfirmed |
| **R6** | **An ubuntu box or VM.** Everything this project has ever verified was verified on Windows. | H1, H2 — and [manual gate §2.5](11-p2-manual-gate.md), [manual gate §4.5](11-p2-manual-gate.md), *the platform nobody has watched* | Unconfirmed |
| **R4** | **A non-author for forty-five minutes**, with the README and a URL and nothing else. | A9 — and [P10 §3](27-p10-implementation.md) step 10, which asks for the same person and says *the phase's whole claim is about that person* | **Partly expired** for A9 and cannot be recovered by trying harder; **live, and now the one thing a built P10 waits on** — sitting P's **C4**, 2026-09-17. *The only row in this table that is a person rather than a machine*, and the only one whose lead time is somebody else's diary |
| **R2** | **A hosted endpoint with a real key.** | B1, C1 | **To hand** — used at A3, 2026-09-08 |
| **R7** | **A full text editor and a file manager** on the machine running the server — not `fs`, not the IDE. | D18 | To hand. Trivial, and it is the point of the step. |
| **R8** | **A Docker daemon, an unraid host with a registry credential.** | I | Partly to hand — the first install ran 2026-09-07 |
| **R9** | **A session two hundred turns deep**, against a book of a few hundred entries. | J | **Only G has ever produced one.** Walk J in the same sitting as G, while one exists — recreating one on purpose is an afternoon, noticing you still have one is free. |
| **R11** | **A supervised install** — the image under `compose.yaml`'s `restart: unless-stopped`, ~~an unraid container with autostart~~ an unraid container whose Extra Parameters carry `--restart=unless-stopped`, or a systemd unit. *R8 is close and is not this*: a Docker daemon is what runs a container, and what this needs is a container something will start **again**. | [P10 §3](27-p10-implementation.md) step 6, and sitting P's C2 | **Partly to hand** — R8's first install ran 2026-09-07 under unraid, ~~which is supervised, so what is missing is a walk rather than a machine~~. Added 2026-09-17 by [P10 §3.1](27-p10-implementation.md). *The thing it blocks is narrow and is exactly the half a test cannot reach*: `restart.test.ts` proves the refusal, the 503 and the drain in-process, and **nobody has watched the process come back**. **Corrected 2026-09-27**: that unraid container was *not* supervised. Autostart restarts nothing that exits, and the template set no restart policy, so a walk there would have watched it stay stopped. The shipped unit did the same thing a different way: `Restart=on-failure` against a restart that exited 0. And on every deployment the process never exited at all, because the tab pressing the button held the listener's close open. All three are fixed underneath this row (the stream closer in `preClose`, the template's `--restart=unless-stopped`, an exit status of 75 and `RestartForceExitStatus=75`; [09 §6.4](../09-server-multiuser-deployment.md)). R8's container predates the template change, so add the parameter to it by hand before walking this. `main.test.ts` now proves the status and that a process with a tab open exits at all. **Watching it come back is still nobody's yet** |
| **R10** | **An endpoint that serves the `image` role**, with a key — hosted or local. **R2 is a chat endpoint and does not answer this**; no prerequisite here ever has. | [P9](26-p9-implementation.md)'s whole gate: twelve of its fifteen steps want pixels, and **both of its criticals are blocked on this and nothing else** ([P9 §3.1](26-p9-implementation.md)) | **Not to hand**, added 2026-09-15 by [P9 §0.2](26-p9-implementation.md)'s readiness audit and **the row that made this table ten** — which is why that document's own *"nine standing prerequisites"* is struck in two places rather than left to read as though the audit had not happened ([P9 §0.3](26-p9-implementation.md), 2026-09-16). *Second-longest lead item after R1 and the only one a whole phase's critical list waits on.* ***And it is its own errand***: K, L, M and N — the four sittings that hold a phase open — all queue on a **chat** endpoint, and none of them produces this one. ~~It is also what settles [P9 §1.2](26-p9-implementation.md) — whether image providers go behind the same `Connection` vocabulary or beside it — which that document deliberately leaves open rather than deciding at a desk.~~ ***That half was decided at a desk after all*** (2026-09-16, [P9 §1.2](26-p9-implementation.md)): the pinned SDK already exports `imageModel` and `generateImage`, so the fork had no second client on the other side of it and `Provider` grew a second **verb** rather than a second **kind**, with the reversal condition written down — an endpoint whose request is not prompt-plus-scalars. **What R10 still blocks is the gate**, which is the larger half: [sitting O](#o--p9s-critical-list--two-rows-and-the-first-sitting-that-cannot-start) cannot start without it, and P9 is built and open behind it |
| **R12** | **A chat endpoint serving one model that sees pictures and one that does not** — Ollama with `llava` beside a text model is the cheap form; a hosted key whose provider offers both works too. *Neither R2 nor R10 answers it*: R2 is a chat endpoint that may or may not see, and R10 makes pictures rather than reading them. | ~~T2–T4~~ U2–U4 *(the sitting was re-lettered U on 2026-10-02 and this cell was missed; corrected 2026-10-03)*, and `pnpm test:live`'s picture case (`STORYENGINE_LIVE_VISION_MODEL`) | **Unconfirmed**, added 2026-09-27 with [26 E15](../26-open-questions.md) R1 |
| **R13** | **An Aventuras install with a library and stories in it.** It needs a character with a PNG portrait and one with a JPEG, a scenario linked to a vault lorebook, a story with at least two branches and a lorebook of its own, a turn Aventuras illustrated, and a backup zip exported from it. *The walker's own, played for an afternoon, will do.* X's rows ask whether the import carries what is there, not what other people's libraries hold, which would be R1's question asked of another program. | [Sitting X](#x--p13s-critical-list--two-halves-one-aventuras-install-and-a-prerequisite-nobody-had-written-down) entire, which is [P13](30-p13-aventuras-import.md)'s two critical lists, and most of its remainder | **Unconfirmed**, added 2026-10-04 with sitting X. [P13 §3.3](30-p13-aventuras-import.md) calls its rows walkable *"with an Aventuras install, which Part 1's rows already assume is to hand"*, and nothing in this table recorded that assumption until now. ***The illustrated turn is an errand inside this one.*** Aventuras draws its pictures through an image provider set up inside Aventuras, so an install that never had one has no X8 to walk. That is [R10](#3-standing-prerequisites)'s kind of endpoint, run inside another program. The rest of X does not wait for it, and P13's close does: X records X8 as blocked rather than deferred |

---

## 4. The sittings

**A struck-through heading is a record, not a deletion.** That is how this file
stays standing: a sitting is walked once, keeps its results in place, and the
next phase's gate arrives as new sittings below rather than as a new sheet.

Run everything under `pnpm dev:logged` from B onward, so the sittings leave a
cassette corpus behind rather than a memory — §9's first item, and the
machinery has existed since P4 with **no cassette ever promoted**. The runbook
for that, and the six measured traps that go with it, is
[P2C brief §2.2–§2.4](13-p2c-brief.md); it is not restated here, and if that
document is ever retired the runbook has to move first.

*A–H came from the pre-P6 walk and cover every gate before P6. I and J are the
ledger's outstanding passes, folded in here rather than kept as a second list.
**K and L are the two-tier gate's own arrivals** — a phase's critical list, one
per phase since the model was adopted, and the shape every gate after P7 will
land in.* *(2026-10-04: and after Z comes **AA**, the first of the doubled
letters — a spreadsheet's order, chosen where AA is registered, so the next is
AB and nothing already lettered moves.)*

### ~~A — Fresh install, first contact~~ Walked 2026-09-08 — *nine of nine PASS*

**A clean sweep, and the first thing this project has ever walked end to end.**
It clears [manual gate §2.1](11-p2-manual-gate.md) entirely — the eight-item sequence
that three separate gates each ask for in their own words — and
[P2C.1](12-p2c-first-real-run.md), the first-contact stage that had never run.

**A8 passed with nothing written in the *what did you have to guess* column**,
which is the answer [work plan §4.1](01-work-plan.md)'s fourth hypothesis wanted and
the one it calls likeliest to be wrong. Worth saying plainly rather than
ticking — with one correction under it that is the reason this file keeps a
result and a date rather than a tick.

**CORRECTION, 2026-09-09.** This paragraph read *"the hypothesis survived its
first contact with a real turn."* **It did not have one.** A8's session
**resolved zero books** — the defect [P6B.0](20-p6b-playable.md) found and
fixed — so the turn behind that record carried no retrieved blocks at all, and
the page A8 read therefore showed none of the retriever's vocabulary: no
`keyword match`, no refusal row, no activated-but-unplaced entry. What A8 does
evidence is the **static** record — the prompt, the call, the usage, the reasons
that do not come from retrieval — which is hypothesis 1's territory and a real
result worth keeping. **Hypothesis 4 has never been in contact with anything.**

**Why the error is worth writing down rather than quietly fixing:** it made a
question look half-answered for three weeks, and a half-answered question is
not scheduled. That is [§7](#7-closing-a-gate-and-closing-a-phase)'s third step
— the one it says gets skipped — arriving as its own example.

Its first real contact is **K8**, on a turn built to carry retrieved lore, a
budget refusal and an unplaced entry at once. Even a pass there is narrow,
because the walker arranged the turn; the wide one is [G](#g--the-long-pass--hours-unscripted-playables-second-sitting),
where P3 step 12 expects it to get harder.

*Walked against a `pnpm dev` install on Windows.* The same nine run again on
Docker as the first half of [B](#b--the-scripted-session-against-both-endpoints-walked-2026-09-08--six-of-nine-three-unconfirmed),
because a container is a different install and A1's *open the address the
server prints* is exactly the line that was wrong on the first unraid install
([P6A §3](19-p6a-alpha-1.md)).

*The sitting as it was written:*

```bash
pnpm reset-data && pnpm build && pnpm dev
```

**Do A9 first, before anything else in this sheet.** It is the only item here
that is destroyed by having already looked.

| # | Do | Clears | Result |
|---|---|---|---|
| **A9** | **Write down, before opening the browser, what you expect each screen to do.** Then walk A1–A8 and treat every divergence as a finding. Where you looked first, what you expected a control to do before clicking, and every point at which you consulted the source instead of the screen — that last one is the signal. | [P2C.1](12-p2c-first-real-run.md) | PASS |
| **A1** | Open the address the server prints — the **client's**, not the API's. Create the first admin. Reload; sign out and back in. | [manual gate §2.1.1](11-p2-manual-gate.md), P2B 1 | PASS |
| **A2** | **Settings → Administration.** The account list should say *1 person has no usable connection and cannot send a message…*. Read it as a stranger would; it is the one piece of copy whose whole job is to be understood by somebody stuck. | [manual gate §2.1.2](11-p2-manual-gate.md), [manual gate §2.4](11-p2-manual-gate.md), P2A 1 & 7 | PASS |
| **A3** | Add a connection with a real key. The model list fetches as an assist and saves without it; a **refused key** says so in its own sentence rather than reading as an unreachable endpoint. | [manual gate §2.1.3](11-p2-manual-gate.md) | PASS |
| **A4** | The two-picker default-binding form appears on its own after the first connection saves. Answer it. | [manual gate §2.1.4](11-p2-manual-gate.md) | PASS |
| **A5** | Back to the account list: the dead-end count goes to zero **after the binding, not after the connection** — the count asks whether `prose` resolves, through the turn's own resolver. | [manual gate §2.1.5](11-p2-manual-gate.md) | PASS |
| **A6** | Start a session, send a message, watch the reply stream. | [manual gate §2.1.6](11-p2-manual-gate.md), P2 9 | PASS |
| **A7** | Send another and **reload the page while it is streaming.** The finished turn should be there. | [manual gate §2.1.7](11-p2-manual-gate.md), P2 9 | PASS |
| **A8** | Open *Turn record* and read it. **Could you tell from this alone why the turn came out the way it did?** Write down what you had to guess. | [manual gate §2.1.8](11-p2-manual-gate.md), [manual gate §2.4](11-p2-manual-gate.md) | PASS |

> **A9 has partly expired, and the sheet should say so rather than pretend.**
> [P2C.1](12-p2c-first-real-run.md) calls the stranger's view *perishable* and
> names the problem it cannot solve: the tester is the person who built this.
> The mitigation in order of preference is a borrowed non-author (R4), then a
> screen recording watched a week later, then written-in-advance predictions —
> which is what the row above asks for, and which is the closest an author gets
> to not knowing. **Whatever is done, record which of the three it was**, because
> a prediction-based A9 and a stranger-based A9 are not the same evidence.

---

### ~~B — The scripted session, against both endpoints~~ Walked 2026-09-08 — *six of nine; three unconfirmed*

**B1, B3, B4, B5, B7 and B9 pass.** The wire format holds against a real
endpoint: chunks arrive incrementally, `usage` comes back populated, the
resolved model is the one that answered, and cost is `null` rather than the
fabricated zero. Two admins on the settings page get both halves of the 412.

**B2, B6 and B8 are not marked**, because each needs a resource §2 records as
unconfirmed — a local runtime (R3) for B2 and B8, a second machine (R5) for B6 —
and a walk that may not have happened is the one thing this sheet must never
assert. They are blanks on purpose.

**B9 passed its stated check and produced a refinement anyway** — the 412
behaves, and the connection surface around it is thin. That is [F-01] and it is
not a half-failure of B9; the sheet keeps the two apart on purpose.

*The sitting as it was written:*

**Every automated test in this repository runs against `FakeProvider`.** The
shipped adapter's wire format is asserted only against a stub this repo wrote,
and a stub agrees with whatever it was written to agree with.

| # | Do | Clears | Result |
|---|---|---|---|
| **B1** | Run A1–A8 against a **hosted** endpoint. | [manual gate §2.2](11-p2-manual-gate.md) |PASS |
| **B2** | Run A1–A8 against a **local runtime**. They fail differently, which is the reason for both. | [manual gate §2.2](11-p2-manual-gate.md) | |
| **B3** | Chunks arrive **incrementally**, not in one lump. | [manual gate §2.2](11-p2-manual-gate.md) |PASS |
| **B4** | `usage` comes back populated; `ModelCall.resolved` names the model that **answered**; the turn's cost is **`null`, never `0`** — no price table ships, so a zero is a fabrication. | [manual gate §2.2](11-p2-manual-gate.md), P3 4 |PASS |
| **B5** | *Fetch models* against both, and against something that does not implement `/models` at all. Several local runtimes answer with one entry called `gpt-3.5-turbo` regardless of what is loaded. | [manual gate §2.2](11-p2-manual-gate.md), P2B 2.6 |PASS |
| **B6** | **Be a second user.** Create a non-admin, sign in from a second browser profile (R5), take a turn on the system connection, then revoke `privateConnections` and watch what the turn does. That capability is enforced in the resolver and its enforcement has never been seen from outside. | [P2C.2](12-p2c-first-real-run.md) | |
| **B7** | **Two tabs on one session.** Server fan-out is asserted; two real clients rendering the same deltas is not. | [manual gate §2.3](11-p2-manual-gate.md) |PASS |
| **B8** | **Two sessions at once** against the local runtime — one model slot, no queue, no concurrency cap. Whatever happens is the finding. | [P2C.2](12-p2c-first-real-run.md) | |
| **B9** | **Two admins on the settings page.** Save in one, then the other. Both offers of the 412 should work — *load what is on disk* and *overwrite with mine* — and a plain Save in between should still be refused. | [manual gate §2.3](11-p2-manual-gate.md) |PASS — *underneath, 2026-09-27*: the third clause was never exercised, and was false: a plain Save straight after the refusal overwrote the file. `868384f` refuses it again until an offer is chosen. The PASS is the two offers' |

---

### ~~C — Break it on purpose~~ Walked 2026-09-08 — *eleven of eleven PASS*

**The half most likely to be skipped, and it held.** Every deliberate breakage
surfaced as a *classified* failure rather than a provider string: a wrong key, a
model id that does not exist, an endpoint answering HTML, the network cut
mid-stream. The ten-token ceiling came back as `outcome: 'truncated'` and not as
an error class, which is the distinction the field exists to draw and the one
thing here a test could not have told us.

**The three copy judgements passed too** — the removal dialog, the capability
groups, the restart banner. Those are opinions by construction
([playable log](21-playable-log.md): *a judgement is a finding*), and recording them as
passes is recording an opinion, which is what the step asks for.

*The sitting as it was written:*

**The valuable half, and the easy half to skip because nothing is going wrong
yet.** Each of C1–C5 should surface as a *classified* failure rather than a
provider string in the UI — except C3, which is not a failure at all, and telling
those apart is the point of the field.

| # | Do | Clears | Result |
|---|---|---|---|
| **C1** | Wrong key. | [manual gate §2.2](11-p2-manual-gate.md), P2 |PASS |
| **C2** | A model id that does not exist. | [manual gate §2.2](11-p2-manual-gate.md) |PASS |
| **C3** | **A completion ceiling of ten tokens.** ~~No UI for this: hand-edit `preset.params.maxTokens` in the session's own `session.json`, a one-line edit, since a created session carries a full inline preset.~~ ***There is a UI, from [P7B.2]***: *Maximum reply length* on the session panel, which writes the session's own pack through `PUT /api/sessions/:id/preset`. **The old wording is struck rather than replaced**, per [§0](#the-two-tier-gate)'s rule that a step is never edited to match what was walked — this one was walked on the hand-edit path and passed, and the re-walk on the UI path is a different check of the same claim. Expect **`outcome: 'truncated'`** on the call, not an error class. | [manual gate §2.2](11-p2-manual-gate.md), [P2C.2](12-p2c-first-real-run.md) |PASS |
| **C4** | An endpoint that returns HTML. | [P2C.2](12-p2c-first-real-run.md) |PASS |
| **C5** | The machine's network off mid-stream. | [P2C.2](12-p2c-first-real-run.md) |PASS |
| **C6** | **Kill the server mid-turn** (Ctrl-C), restart, reload. The partial turn is recorded failed and the session is usable. | [manual gate §2.3](11-p2-manual-gate.md) |PASS |
| **C7** | **Sleep the laptop mid-turn**, wake it, watch the stream reconnect. Materially different from an aborted socket: a sleeping machine's socket dies without a close, and the resume goes through `Last-Event-ID` on a connection the browser reopened itself. | [manual gate §2.3](11-p2-manual-gate.md) |PASS |
| **C8** | **Close the tab mid-generation and reopen.** Automated at the socket level; a browser's actual unload is not. | [manual gate §2.3](11-p2-manual-gate.md) |PASS |
| **C9** | Start removing an account and **read the dialog before clicking.** It is the one piece of copy somebody would want to have read beforehand, and the only test of it is whether it reads that way. | [manual gate §2.4](11-p2-manual-gate.md) |PASS |
| **C10** | **The capability groups.** *In force now* against *recorded for later*: does the second read as honest, or as an excuse? | [manual gate §2.4](11-p2-manual-gate.md) |PASS |
| **C11** | **The restart banner.** Does *StoryEngine does not restart itself* answer the question it raises, or invite it? | [manual gate §2.4](11-p2-manual-gate.md) |PASS |

---

### D — The workbench, the record, and the disk — *walked to D10, 2026-09-08*

**D1–D10 pass. D11–D20 are outstanding.** The panel toggles from the keyboard
over both views, survives navigation and reload at the same size, is reachable
from nowhere else, and answers *what is about to fall out of context* without
generating anything. The live half — the running step named, a skip explained, a
failure attached to its step — works, and swaps to the record on commit.

**And the sitting produced the most valuable finding of the walk so far, which
no D item asked for.** P3 built a drag handle for the panel and
[P3 §4](15-p3-implementation.md) names it as the surface for the stored size.
It has been **zero pixels tall since P3** — `inset-block-0` is not a Tailwind
utility, Tailwind emits nothing for a name it does not know, and an
absolutely-positioned element with no block inset has no height. Only the
keyboard half of that control has ever worked. See [F-04].

*That is a gate correction as much as a finding:* D2 asks that the panel come
back **the same size**, and it does — because the size is stored and the only
thing broken is the mouse affordance for changing it. The step passes over a
control that is not there, which is exactly the shape of check this sheet's
`CORRECTION` vocabulary exists for.

*The sitting as it was written:*

P3's whole gate, plus the three storage scenarios [P2C.2](12-p2c-first-real-run.md)
added that nothing else has a home for.

| # | Do | Clears | Result |
|---|---|---|---|
| **D1** | Toggle the panel from the keyboard over **both** Play and Library. Typing in the action input or the guidance box does not fire it. It **insets** rather than replaces; Tab passes through; it is not `aria-modal`. | P3 1 |PASS |
| **D2** | Open the panel, then **Play → Library → Play**: still open, same size, subject changed with the view. Then reload: still open, same size. | P3 2 | **PASS**, and **CORRECTION** — see below |
| **D2a** | **Set** the size by *dragging the edge with a pointer*, then reload. | P3 2, the half D2 never asked for | |
| **D3** | **Nothing switches it on.** No debug mode, no advanced toggle, no nav entry, nothing in Settings. | P3 3 |PASS |
| **D4** | Over a turn: every block's source is clickable through to the object; **no `unknown` sources**; the resolved model is the one that *answered* — and a cancelled or failed call truthfully records the one that was *asked*. | P3 4 |PASS |
| **D5** | *What is about to fall out of context* is answered from the verdict **without generating anything** — and on a turn with headroom it does not claim the system instruction is about to fall out. | P3 5 |PASS |
| **D6** | Per-block estimate beside per-call reported, on a turn where they differ. | P3 6 |PASS |
| **D7** | **The meter reflects the pending input.** Type into the action box: the fill changes with nothing sent. Clear it: it falls back to the head. With nothing bound to `prose` the meter is still there, saying it cannot measure and why. | P3 6a |PASS |
| **D8** | Over a library object: the as-stored view matches the bytes on disk — **hand-edit the file and watch the panel follow**; the folder path is one you can paste into a file manager; the revision list is there **with no restore button**. | P3 7 |PASS |
| **D9** | Over a **shadowed** object, the index rows name the winning path. | P3 8 |PASS |
| **D10** | **The panel says what is happening while it happens.** Take a turn with it open: the running step is named, a skipped step says why, a failure attaches to the step rather than the turn — and on commit the panel shows the record instead, with neither view lingering beside the other. | P3 8a |PASS |
| **D11** | **Compare.** ~~Hand-edit the session's own copied preset on disk, drop a block's priority, take the same turn again~~ ***From the browser, since [P7B.4]***: open the workbench on a turn, follow *Edit in the pack* from a block row, change its text, and reroll. The compare view shows exactly what changed, and its address can be pasted into a bug report. *The hand-edit path still works and is still the harder case — [09 §4.4] — so walking it too is worth the minute it costs.* | P3 9 | |
| **D12** | **The replay path is wired** — a committed tape can be handed to a runner and replays. *Not* identical draws; that moved to P5 and then to P6. | P3 10 | |
| **D13** | **Dry run**, if P3.7 shipped: inspect then send → one record; abandon → nothing sent, nothing charged, and a restart does not commit it. The pending state is visible and the session says it is busy. | P3 11 | |
| **D14** | **The legibility claim itself.** Somebody who did not build the turn opens the panel on a real turn they did not script and says why it came out that way — without the log, the source, or a JSON pretty-printer. **And its honest counterpart:** at least one turn where the answer is *I could not tell*, written down with what was missing. | P3 12, §6, PLAYABLE hyp. 4 | |
| **D15** | **Density.** A turn with thirty blocks reads as a table rather than thirty disclosures; nothing that belongs on screen is behind a click for calm's sake; the panel open over Play does not squeeze the transcript into a column nobody can read. | P3 13 | |
| **D16** | **The phone.** At 375px the same toggle produces a full-height sheet with the same content, the view under it does not scroll horizontally, and the sheet is dismissable one-handed. | P3 14 | *Underneath, 2026-09-17* ([polish §15](06-polish.md#15-the-per-turn-controls-exist-on-a-touch-screen)): found against this row before it was walked — the dock's 280px floor and `shrink-0` took three quarters of a phone's width and left the page a gutter, no sheet. Below `sm` an open dock is now the full row and the page under it is hidden rather than unmounted, which is the sheet this row describes; *one-handed* and *no horizontal scroll* are still the walk's |
| **D17** | **A rejected effect, visible with its reason.** *The step was flagged unperformable* — Scene shipped one step that writes nothing. **Re-check before walking:** P5.6 ships `se.lore.timing` effects and [P6B.1](20-p6b-playable.md) made two of them on one channel distinguishable, so the *rendering* half may now be walkable even if nothing yet proposes a **rejected** one. If it is still unperformable, that is a `DEFERRED` with the phase that ships an effect-producing step. | P3 15 | |
| **D18** | **Use a real editor, not `fs`.** Every write the watcher has ever seen came from node. Save once from a full editor, once from Notepad, and once as an Explorer copy-over, watching an open detail page. `awaitWriteFinish` has a 150 ms stability threshold and real editors write in ways `fs` does not. | [P2C.2](12-p2c-first-real-run.md) | |
| **D19** | **Hand-edit a committed turn** on disk. No route edits, deletes or re-runs one; the file is there, and what happens when somebody changes it is a storage question no test asks. | [P2C.2](12-p2c-first-real-run.md) | |
| **D20** | **The version history panel** — the app's only editing surface beyond the actor form, and on nobody's list. Edit five times, restore an old one, confirm **the restore is itself recorded**. | [P2C.2](12-p2c-first-real-run.md) | |

---

**CORRECTION on D2, 2026-09-09.** ***The step tests only that a size
persists.*** It says *same size* three times and never says *set the size*, so
a panel whose drag handle is zero pixels tall passes it — which is exactly what
happened, for three phases, until [F-04](21-playable-log.md) found the handle by
reading the class name rather than by walking the step.

**A step that only checks persistence cannot find a control that was never
grabbable**, and this is the second document to have been fooled by the same
gap: [P3.1a](15-p3-implementation.md)'s stage record claimed the drag outright.
**The `PASS` stands** — what D2 asked, the app did — and **D2a** is the half it
never asked. The fix landed at `71ff7f1` with a test that reads the built
stylesheet, so D2a should now pass; it is written here rather than assumed,
because assuming is how the first one was recorded.

---

### E — Import, for real — *about an hour and a half, and it wants R1*

| # | Do | Clears | Result |
|---|---|---|---|
| **E1** | **Sweep a real SillyTavern data directory.** Populated library, review report at an address, nothing crashed, and **every file the sweep saw accounted for** — converted, recorded, skipped-by-position, or counted as unrecognised. | P4 1, P4 7 | **BLOCKED** — R1. Named outstanding by the step itself, which is why P4 could close without it. |
| **E2** | **The same for a Marinara data root.** | P4 1 | **BLOCKED** — R1. |
| **E3** | **The credential drop.** A preset with `proxy_password` → imported, credential gone from the object *and* from `compat`, review names the removed fields, and **no "import as-is" affordance exists anywhere.** | P4 3 | |
| **E4** | **Depth.** A depth-4 block sits four **messages** from the end in the block list — not at the top, not eight back. | P4 4 | |
| **E5** | **Macros, both halves.** An unrecognised macro imports verbatim and flagged; a recognised one renders through Liquid; **no literal `{{`** from the closed table's set reaches a rendered message. | P4 5 | *Underneath, 2026-09-27*: the table converts **presets**; a **card's** prose is never rendered, so until then its `{{char}}` reached the model as braces. A card's placeholders for itself are now its name at import. **Its `{{user}}` is kept and flagged** ([triage §6.1](02-triage.md) is open), so a card that says it fails the third clause visibly, with the review saying why |
| **E6** | **Re-import the same directory, of each kind.** Unchanged objects skip and are reported unchanged; a changed one offers replace or keep-both; nothing doubles silently. The Marinara arm is the sharper test — `originalFilename` for a row in a table is not a filename anyone typed. | P4 6 | Partly **BLOCKED** — the fixture arm is walkable now; the real arm wants R1. |
| **E7** | **One poisoned file never aborts a sweep.** A deliberately corrupt card is a `warn`-class row and the sweep completes around it. | P4 8 | |
| **E8** | **Rebuild equals incremental, after a bulk import** — run against the post-import library rather than a synthesised one. | P4 9 | |
| **E9** | **The config surface is honest.** `limits.maxUploadMb` reads `applied`; the `fileAccess` grant surface is somewhere an admin can reach **and says what it grants**, naming the sweep and not only the browser. | P4 10 | |
| **E10** | **The report is data.** Fetch the review over the API: reason classes, counts and parameters, **no stored English prose** — the sentences are composed client-side from the reason class. | P4 11 | |
| **E11** | **Undo is real in-app.** Delete a badly-imported object from the client; the tombstone behaviour is visible and the library reflects it. | P4 12 | |
| **E12** | **The three refusals**, each refusing **before anything is written**, each with a message a person can act on: a held `.writer-lease`, a `.migrating` marker, and a manifest declaring a format we do not know. A half-import is worse than no import. | P4 14 | |
| **E13** | **`.bak` does not double the library.** A root with a `.bak` beside every table imports the same object count, and the review reports them skipped. | P4 15 | |

---

### F — Lore under pressure — *about two hours, and F1/F6 want R1*

**Start here, because until [P6B.0](20-p6b-playable.md) nobody could:**

```bash
pnpm reset-data && pnpm seed && pnpm dev
```

then start a session **naming a treatment and a book**, take a turn, and open the
workbench. The lore report should show entries firing with their reasons. That
single walk is [P6B](20-p6b-playable.md)'s own verification and the entry point
to everything below.

| # | Do | Clears | Result |
|---|---|---|---|
| **F0** | The seeded end-to-end above: a session that resolves books, a turn, and a lore report with reasons. | [P6B §3](20-p6b-playable.md) | |
| **F1** | **A three-hundred-entry imported book opens as something readable**, and a named entry is reachable by its own address — the link survives a reload and lands on that entry. | P5 1 | |
| **F2** | **An entry that will not fire says why**, distinguishing *off*, *its folder is off*, and *the book is off* — and the folder case leaves the entry's own `enabled` **visibly unchanged**. | P5 2 | |
| **F3** | Filtering within a book by a key chip, a tag and a folder each narrows the list; the panel's own filters narrow the shelf. | P5 3 | |
| **F4** | A search phrase occurring in exactly one entry returns **that entry** with a snippet, across books. | P5 4 | |
| **F5** | An entry is created, edited and deleted through the real write path, and a collapsed section in the editor names its non-default values. | P5 5 | |
| **F6** | **Open a book you did not author** and judge whether the page reads as a document or as a form. | P5 6 | **BLOCKED** — R1, with lead time. Settled as person-blocked at [P6B.1](20-p6b-playable.md); this is its outcome, not a blank. §3, R1. |
| **F7** | **An imported ST lorebook fires on its keywords in a real session** — entries appear as blocks with `keyword match: "…"` reasons. | P5 7 | |
| **F8** | **Timing, three cases and they are not the same case.** A sticky entry **counts down in the block list** and says when its window closes; cooldown and ephemeral are legible in the record through their effects, now that two on one channel can be told apart. **`delay` is not** — record that rather than hunting for it; its only trace is a skip reason, and skip reasons reach the preview and never the record. | P5 8 | |
| **F9** | **Recursion.** An activated entry's text activates another; `preventRecursion` et al. honoured; no runaway at the book's depth limit. **Use a chain of width more than one** — every automated recursion test is width one, which is how [P6B.1](20-p6b-playable.md)'s haystack defect survived. | P5 9 | |
| **F10** | **Budget pressure.** A book over its `tokenBudget` drops entries in the documented order, each skip named with the blocking budget, and a small entry still fits after a large one dropped. **Spot-check `tokenBudget: 0`** — it now means unlimited, which is the first contradiction settled. | P5 10 | |
| **F11** | A rewrite reproduces identical activations. | P5 11 | **PART / DEFERRED.** P5's half — the keying — is met. The reproduction half is [P6 §3](18-p6-implementation.md) step 3's; there is no production replay entry point to look for. Settled at [P6B.1](20-p6b-playable.md). |
| **F12** | An entry conditioned on a channel that does not exist → visible warning, never fires, nothing blocks. | P5 12 | **DEFERRED — P7.** No entry can be conditioned on a channel; the schema lists `activationConditions` as deliberately absent. [work plan §0.3](01-work-plan.md)'s row moved and [P7 §0.1](23-p7-implementation.md) carries it. *Do not credit `unknownSources` here* — such an entry keeps scanning and can still fire. |
| **F13** | **The keyword tester answers *why does this entry never fire*** without playing a turn — and where the answer is a gate or a disabled book rather than a match, **it agrees with what the book page already showed.** Disagreement here is the failure P5.7 exists to prevent. | P5 13 | |
| **F14** | Timing counters reconstruct correctly at an old node. | P5 14 | **AUTO** — `sessions/reconstruct-property.test.ts`, discharged at P6.0a: four turns with a sticky, a cooldown and an ephemeral entry, replayed at every node of a forked session. |
| **F15** | **A hostile pattern from an imported book does not hang the server.** A catastrophically backtracking regex is abandoned at the timeout, the entry reports why, and the turn completes. The one gate step about somebody else's file being able to hurt you. | P5 15 | |
| **F16** | **The book page says what the import did to it** — a book whose entries lost something on the way in says so on the page, not only in the review. | P5 16 | |
| **F17** | The five delete sites are one, and the property can see them. | P5 17 | **AUTO** — `index-db/rebuild-property.test.ts` (`pnpm test:gate`), with the `orphan-fts` assertion added at [P6B.1](20-p6b-playable.md); before that, deleting one of the five left the suite green. |
| **F18** | The fixture-pair gate is green with lore as a producer. | P5 18 | **AUTO** — `import/fixture-pair.test.ts` (`pnpm test:fixture-pair`). |

---

### G — The long pass — *hours, unscripted; PLAYABLE's second sitting*

**Not a second scripted pass with a different list.** The point is duration and
accumulation: forty turns, a library with things in it that were made rather than
seeded, an index written to all afternoon, a watcher that has seen a hundred
events. None of the automated tests run long enough to be interesting, and none
of A–F leaves anything behind.

**Play it rather than test it.** The scripted pass answers whether a turn works;
this answers whether forty do.

| # | Watch for | Clears | Result |
|---|---|---|---|
| **G1** | Memory and handle growth; a session that gets slower as it gets longer; index and watcher disagreement after a lot of writes; SQLite lock contention; a keepalive that stops keeping alive. Look at the server's memory and the log **afterwards**, rather than not. | [P2C.3](12-p2c-first-real-run.md) | |
| **G2** | **The turn record getting harder to read as the thing it records gets longer.** This is the one that only shows up here. | [P2C.3](12-p2c-first-real-run.md), P3 12 | |
| **G3** | **The four PLAYABLE hypotheses** ([work plan §4.1](01-work-plan.md)) — is the record legible; does hand-editing a card mid-session take; is one budgeter comprehensible under pressure; do inclusion reasons explain anything. The fourth is the one 01 calls likeliest to be wrong. | PLAYABLE | |
| **G4** | **P5's four held-open questions** — the trim order, whether the per-book budget tier earns its keep, whether recursion depth needs a surface, whether the keyword tester is the diagnostic or a consolation. Observation prompts are already written at [P5 §0.3](17-p5-implementation.md). | P5 `[AWAITS PLAYABLE]` | |
| **G5** | **P6's two** ([P6 §5](18-p6-implementation.md)) — which reply an edit changes, and whether the sibling affordance is enough to find a line abandoned twenty turns ago. | P6 §5 | |

***A second phase now waits on this session, and knowing that before G is walked
is the point of saying it*** (2026-09-13). [P8](25-p8-implementation.md)'s gate
refuses its own headline check under clause (iii) — *the same session, four
hundred turns long, still assembles inside budget* — because nothing in this
project has ever played that far, and **G is the only thing that would produce
one.** P8's plan can prove the summary *chain* over a synthesised tree; what a
synthesised tree cannot answer is whether a summary of four hundred real turns is
worth reading.

This is the dependency [§3](#3-standing-prerequisites)'s **R9** already records
for J — *"Only G has ever produced one. Walk J in the same sitting as G, while
one exists"* — and it now has a second claimant. **When G happens, the session it
leaves behind is worth keeping**: J wants it at two hundred turns and P8 will
want it at four hundred. *Nothing is added to this sitting for P8, because P8 has
not opened and a check against unbuilt code is not walkable.*

---

### H — The other platform — *about half an hour*

**Everything this project has ever verified was verified on Windows.** CI runs
the suite on ubuntu and `ci-shape.test.ts` stops that matrix being deleted
quietly — but CI does not *run the application*, and path handling, file watching
and SQLite locking are the three places this codebase has already been bitten,
all three platform-shaped.

| # | Do | Clears | Result |
|---|---|---|---|
| **H1** | Start the server on ubuntu (R6) and play a turn. | [manual gate §2.5](11-p2-manual-gate.md) | |
| **H2** | Hand-edit a library file from a Linux editor and watch the panel follow — the watcher half, which is the one with a platform-shaped history. | [manual gate §2.5](11-p2-manual-gate.md), P3 7 | |

---
### I — The container walk — *[P6A §3](19-p6a-alpha-1.md) steps 3–12, and it wants R8*

**Partly walked already, 2026-09-07**, by the first install: the template
pulled, the container started, and three findings came out of it — a root-owned
appdata directory, an icon that cannot exist while the repository is private,
and a setup token nobody could find. All three are fixed.

**What that walk did not cover:** step 7 (a turn from another machine), step 9
(restart with the volume), step 10 (the stamp refusing an older build), and step
12 (an unauthenticated pull failing).

**The steps, as rows, because [P6A](19-p6a-alpha-1.md) closed on 2026-09-09 and
handed them here.** A sitting that is only prose has no cell to write in, so
nothing it half-answers can be recorded and nothing can visibly drain — which
is the failure [§0](#the-two-tier-gate)'s third honesty condition names. These
are [P6A §3](19-p6a-alpha-1.md) steps 3–12 verbatim; **the gate document is not
edited**, and the results below are this sheet's, not its.

| # | Do ([P6A §3](19-p6a-alpha-1.md)) | Clears | Result |
|---|---|---|---|
| **I1** | **Fresh container, no volume.** Comes up reachable on the mapped port with no prior state. | P6A 3 | **PART** — came up 2026-09-07; appdata was root-owned, fixed |
| **I2** | **The UI is served.** The mapped port serves the client rather than a 404. | P6A 4 | **PASS**, 2026-09-07 |
| **I3** | **Refusal before setup.** Every route but setup refuses until setup has run. | P6A 5 | |
| **I4** | **The token is required and checked.** Setup with no token fails; with the right one succeeds. | P6A 6 | **PART** — walked 2026-09-07; the token was unfindable, fixed |
| **I5** | **A turn, from another machine.** Sign in from a host that is not the container's and play. | P6A 7; R5 | |
| **I6** | **Identity.** The running server reports a version and commit matching the image. | P6A 8 | |
| **I7** | **Restart with the volume.** Stop, start again against the same volume, and nothing is lost. | P6A 9 | |
| **I8** | **The stamp refuses.** A build older than the volume's stamp declines to open it. | P6A 10 | |
| **I9** | **The template installs.** On unraid, with a registry credential configured. | P6A 11 | **PART** — installed 2026-09-07; the icon cannot exist while private |
| **I10** | **The package is private.** An unauthenticated `docker pull` fails. | P6A 12 | |

**Three of the ten carry a `PART` from the same afternoon, and all three
findings are fixed** — so re-walking I1, I4 and I9 against a current image is
the cheapest thing in this file and turns three halves into three results.
**I2 is the only outright `PASS`**, which is worth saying plainly: one install
on one host has confirmed one step of thirteen.

**Answers:** whether the artifact this project cuts is installable by somebody
who is not its author. **Unblocks:** [P10.0](27-p10-implementation.md), which
re-verifies this path against an artifact it inherits rather than one it built.

### J — The tree walk — *[P6 §3](18-p6-implementation.md) step 1 and 14's clock, and it wants R9*

Step 1 is *branch from a message two hundred turns back, in one action, with
state at the fork correct.* Step 14's wall-clock half is *reconstruct at that
depth in a time a person would accept* — deliberately not a CI assertion,
because a threshold on a busy runner is a flake waiting to happen.

**Do this in the same sitting as G**, while a deep session exists.

| # | Do ([P6 §3](18-p6-implementation.md)) | Clears | Result |
|---|---|---|---|
| **J1** | **Branch from a message two hundred turns back**, in one action, with the state at the fork correct. | P6 1; R9 | |
| **J2** | **Reconstruct at that depth in a time a person would accept.** A clock, not an assertion — a threshold on a busy runner is a flake waiting to happen, which is why the suite covers the other half of 14 and not this one. | P6 14, wall-clock half; R9 | |

**Two rows, and [P6](18-p6-implementation.md) closed on 2026-09-09 with both of
them blank.** They are here rather than in the phase document for the reason
[§0](#the-two-tier-gate) gives: neither is cheaper today than in November, so
neither meets clause (ii), and a phase held open on them is a phase that does
not close. What makes that safe rather than convenient is R9 — **only G has
ever produced a session this deep**, so the honest schedule for J is *the
afternoon G happens*, and the honest state until then is blank.

**Answers:** whether the snapshot cache earns its complexity under real depth.
**Unblocks:** [P6 §5](18-p6-implementation.md)'s snapshot-interval question and
[P8](25-p8-implementation.md)'s cadence sizing, which wants real turn volumes.

### K — P6B's critical list — *two sittings and an hour of desk work; the one that closes a phase*

**The first critical list under [§0](#the-two-tier-gate)'s model, and the
reason the model exists.** P6B is the hardest case it will meet: P6B.2 *is*
PLAYABLE, the checkpoint [work plan §7](01-work-plan.md) calls skipping *"the
single most expensive economy available in this plan"*. So P6B does not close
on its buildable work — it closes on this, and everything else in its gate
extends the sittings above.

**Derived, not chosen.** Gate steps 6 and 7 are suite-covered and go to §5.
Step 8 is *"P5's eighteen steps, walked by a person"* — P5's claim living in
P6B's gate, which fails criterion (i) and goes to **F**. What is left is five
steps that each name a code path P6B itself built or repaired, none of them
covered by a test, plus the two the checkpoint owes.

| # | Do | Clears | Result |
|---|---|---|---|
| **K0** | **Cut and build 1.0-alpha 4 first.** Not a check — a precondition. [playable log](21-playable-log.md)'s record format opens with `git describe --tags --always --dirty`, and a finding recorded against a dirty tree is not attributable. 389 files of code have landed since alpha 3, including the fix for **F-04**; walking without cutting means re-finding a defect already fixed. | — | |
| **K1** | `pnpm reset-data && pnpm build && pnpm dev:logged`, then `pnpm seed`. Add a connection with the real key, answer the binding form, open the seeded session, take **one turn**, open the workbench lore report. **Expect** the treatment's entries as blocks with `keyword match` reasons, sourced *linked by the treatment*. | P6B 3; **F0** entire | |
| **K2** | **Hand-author a twelve-entry SillyTavern world** across the `position` map in `import/sillytavern/lorebook.ts:51-60` — three `before_char`, three `after_char`, two flagged-collapse, one `at_depth: 4`, one outlet naming nothing, a width-2 recursion chain, one `constant`, one `disable`. Import it through the single-file pick and read the review. **The shipped fixture will not do:** `RAIN_CITY_BOOK` has only positions 0 and 4, so it never exercises the `after_char` defect P6B.1 fixed. **Record it as a format probe, not R1** — you wrote it, so it cannot answer what limits real authors set. | sets up P6B 5, **F7** | |
| **K3** | Create a session **in the browser** naming the treatment *and* the imported book; confirm the report distinguishes *linked by the treatment* from *linked by this session*. Take several turns, then attach a third book mid-session through the panel and take the next turn. | P6B 1, 2 | |
| **K4** | **The single most critical item.** Play turns hitting keys at each position group. Reconcile **every** activation in the lore report against either a block in the right phase or a refusal row naming its rule. **Nothing may activate, be charged, and disappear.** Confirm the `at_depth` entry sits four *messages* from the end and the width-2 chain fires both children. | P6B 5; **F7**, **F9**'s person half | |
| **K5** | Set the imported book's `tokenBudget` to a value that cuts; read the drop order and the skip rows. Set it to `0` and confirm it means unlimited. Then make the **global** arbiter cut and read the verdict. | **F10**; hypothesis 3's answerable half | |
| **K6** | Two tabs on one session, force a `412 stale-head`; then unbind the `prose` role and send. Both must say something on screen. **This is the play page's rendering**, not the settings 412 that B9 already passed. | P6B 4 | |
| **K7** | Hand-edit an actor's `description` on disk mid-session. Take the next turn; the block table shows the new text. | **hypothesis 2**, in full | |
| **K8** | With the workbench open on a turn carrying retrieved lore, a budget refusal and an unplaced entry, **write answers to the four hypotheses** in [playable log](21-playable-log.md)'s record format — `expected` before `observed`. **Include one honest *I could not tell*** if it is true. Record which of A9's three mitigations you used. | P6B 9; **D14** | |
| **K9** | **Desk work, 45 minutes, no install.** Route every finding — the six in the playable log, whatever K1–K8 produced, and [P2C log](14-p2c-log.md)'s fourteen — to one of [P2C §2.5](12-p2c-first-real-run.md)'s five destinations. Then update §6, add the date beside R1 in §3, and write the status lines. | P6B 10 | |

**What this list cannot reach, stated so nobody mistakes a pass for a finish.**
Every item here is one turn long and none leaves anything behind, so a defect of
*accumulation* survives it intact — G1's index-and-watcher disagreement after an
afternoon of writes, G2's record becoming unreadable as it grows, J's snapshot
cache at depth. **And the sharpest one is a property of this design rather than
of the code: the budgeter may look comprehensible precisely because the walker
chose the book, the budget and the turn.** A controlled experiment answering a
question about uncontrolled use is what a full walk exists to avoid, and this
list is a controlled experiment by construction.

**A second way it could pass and be worthless: it cannot fail the way C did.**
Sitting C ran eleven deliberate breakages, passed eleven, and produced **no
refinement note at all**, while the quiet sittings produced five. K1–K7 are all
built around something going wrong or being made to go wrong — the shape that
has so far produced nothing. **Keep [refinements](22-walkthrough-refinements.md)
open beside the log, and treat a sitting that adds no row to it as a signal
rather than a clean sweep.**

---

### L — P7's critical list — *a sitting, and the one that closes P7*

**The second critical list under [§0](#the-two-tier-gate)'s model, and the first
one nothing blocks.** [P7](23-p7-implementation.md) merged into `main` on
2026-09-13 with its buildable work done and these three unwalked, so under §7 the
phase is open until they have results. Its own labels are C1, C2 and C3; **they
are L1–L3 here**, because sitting C above already has a C1 and [§3](#3-standing-prerequisites)'s
R2 cites it.

**Derived, not chosen.** P7's gate is thirteen rows. Nine are answered by named
tests and went to §5. Step 7 — *dead on one branch, alive on the other* — is
P6's claim living in P7's gate, covered at P6.3, so it fails criterion (i) and is
in §5 too. Two stay Standing with an owner and are in §10. **What is left is
three steps that each name something the contract claims and no assertion
covers**, plus the desk work that writes them down.

**And clause (iii) is satisfied outright rather than argued**, which no earlier
critical list could say: L1 wants the repository and a text editor, L2 wants R2
(*to hand*), L3 wants a browser. **Nothing here waits on a resource**, so the
only thing between this sitting and a result is an afternoon.

| # | Do | Clears | Result |
|---|---|---|---|
| **L0** | **The build — a precondition, not a check**, as K0 is, and here it is a fork rather than an instruction. `v1.0.0-alpha.4` was cut 2026-09-09 and **predates P7 entirely**: the mode contract is not in it, so it cannot answer L1–L3 at all. Walking `main` instead records a commit and not a build anybody can return to, which is the attributability K0's record format exists to give. **An alpha is expected within days; walking after it lands resolves this for nothing.** | — | |
| **L1** | **Author a small mode against the published SDK, with no access to `server`** — [P7 §3](23-p7-implementation.md) step 10, and *"the phase's actual claim"*. **Read the gate's own admission first**: [triage §6.3](02-triage.md) states the sharper version and P7's gate does not use it — *"if a motivated person cannot build UNO against the extension API without engine changes, [06 §9] has failed"*, which is a channel holding board state, a step validating moves and a declared widget. **Three named parts and an adversarial subject. Build that, not a mode you already know will work.** | P7 10; **P7's C1** | |
| **L2** | **Play Freeform end to end through the contract** — P7 §3 step 2a. Make a session on the second mode, answer its setup wizard, take turns through `do`, `say`, `think` and `story`, and use the difficulty and directedness dials. **The mode exists and is loadable and nobody has played it**; that is the whole of what this clears. | P7 2a; **P7's C2** | |
| **L3** | **Render the setup wizard for a mode the engine has no knowledge of**, from its declaration alone — P7 §3 step 9a. Freeform declares one and `modes.test.ts` proves the declaration crosses the wire intact; **what no test can do is look at it.** A throwaway declaration with each field kind on it is the adversarial form, and cheaper than it sounds. | P7 9a; **P7's C3** | |
| **L4** | **Desk work, and it is what closes the phase.** Write the results into [P7 §3.2](23-p7-implementation.md)'s table — never into the ten steps, which [§0](#the-two-tier-gate)'s first honesty condition forbids — then update §6's row here, and write P7's status line. **Route every `CORRECTION` into the document that owns the step**, which §7 names as the item that gets skipped. | P7's close | |

**What this list cannot reach, and P7 §3.1 says it rather than this file.** All
three are *one-sitting* checks against **things the walker builds** — a mode they
wrote, a wizard they declared, a session they set up. **The contract's hardest
failure is not visible to an author who knows what the contract permits**,
because they will not try what they know is unavailable. And **nothing here is a
second person**, so *would a stranger's mode work* stays unanswered by
construction. That is the price of closing the phase in a month, and L1's UNO
framing is the cheapest partial answer to it: an adversarial subject is the
nearest thing to a stranger that one person can be.

**A second way it could pass and be worthless.** L2 and L3 are both *does it
work* questions, and sitting C's lesson is that the sittings where nothing goes
wrong produce the refinements. **Play Freeform badly on purpose** — an empty
setup field, a `think` where a `say` belongs, both dials at once — because
[refinements](22-walkthrough-refinements.md) is where this sitting is most likely
to earn its afternoon, and a clean sweep with no row in it is a signal.

**Answers:** whether [06 §9](../06-modes-and-turn-pipeline.md)'s contract is real
for somebody outside it — which [20 §10](../20-tech-stack.md) calls the design's
central bet, and which fifteen stages of building have evidenced and not tested.
**Unblocks:** P7's close, and the confidence [P8](25-p8-implementation.md) through
[P11](28-p11-implementation.md) each build on, since every one of them adds a step
or a channel through this contract.

---

### M — P7B's critical list — *a sitting on a live install, and the one that closes P7B*

**The third critical list under [§0](#the-two-tier-gate)'s model, and the first
one that is honest about wanting a resource.**
[P7B](24-p7b-presets-and-prompts.md) merged into `main` on 2026-09-15 with its
ten stages committed and these unwalked, so under [§7](#7-closing-a-gate-and-closing-a-phase)
the phase is open until they have results. Its own labels are gate rows 1, 5, 10,
12 and 14; **they are M1–M5 here**, for the reason L's are L1–L3 — a row number
is a row number in whichever document you are holding, and this file is the one
that sequences the walk.

**Derived, not chosen.** P7B's gate is seventeen rows. **Nine are answered by
named tests** — the materialised pack and its link, the system copy's refusals,
the outlet, the treatment's framing *(answered falsely until 2026-09-27: the
collector never filled the slot — see [P7B §3.2](24-p7b-presets-and-prompts.md)
row 7)*, archive and delete, `fields.test.ts`'s deleted negative, the rebuild
gate, `/` as a page, and the route-caller check itself — and go to
[§5](#5-already-discharged-and-by-what). What is left is
**four steps that each name a claim no assertion covers**, one judgement sitting,
the three walked rows that are not critical, and the desk work.

**Clause (iii) is *not* satisfied, and saying so is the difference from L.** L
could claim nothing waited on a resource; **every row below wants a running
install with a real endpoint** — R2 or R3 — because every one of them is about
what a turn assembles. So M sits with L2 and L3 in the sitting K1 stands up, and
walking it before that means standing the same install up twice.

| # | Do | Clears | Result |
|---|---|---|---|
| **M0** | **The install — a precondition, not a check**, as K0 and L0 are. M wants what K1 builds: a real endpoint, a model that answers, and a session that can take several turns. **Read L0 first** — the build question it forks on is the same one, asked again after P7B's twelve commits. | — | |
| **M1** | **The phase's whole claim, end to end.** Copy the Scene default from the library, change the sentence that begins *"You are the narrator of a scene"*, start a session on the copy, take a turn, and read the changed sentence in the rendered messages. **No JSON, no text editor, no `curl` anywhere in the walk** — and every step of it was impossible before this phase, the first one since P2. | P7B 1 | |
| **M2** | **Switch the pack mid-session and take the same turn again.** The new turn assembles from the new pack, **the old turn's record still names the old blocks**, compare shows the difference, and a rewind past the switch behaves as [P7B §1.1](24-p7b-presets-and-prompts.md) documents. The automated half asserts the switch; what a person is here for is whether the history *reads* as the record it is, because a switch that quietly rewrote what earlier turns claim to have used is the failure §1.1 was written to prevent. | P7B 5 | |
| **M3** | **Hand-edit the session's copied pack on disk while the settings panel has it open**, then save from the panel. It is refused with the conflict dialog, not accepted over the hand edit — [09 §4.4](../09-server-multiuser-deployment.md)'s claim, for the one object this walk sheet has always edited by hand. **The 412 path is the editor shell's and it is new**, so this is the first walk of it on a surface that is not an editor page. | P7B 10 | |
| **M4** | **Open the workbench on a turn the head has passed**, and read that turn's blocks, calls, effects and verdicts — **and check that the panel says which turn it is showing.** [10 §3](../10-ui-surfaces.md)'s sentence has been false since P3, and a person is the only instrument that notices a panel quietly showing the wrong turn: every automated assertion here passes just as well against a panel that renders the head and labels it correctly by accident. | P7B 14 | |
| **M5** | **Play several turns on a pack authored entirely in the browser, and judge whether the narrator changed the way the edit intended.** A sitting, not a step — the one row in this gate that no test could be written for even in principle, because the question is about prose. **Change one thing at a time** and say what you expected before you read what came out ([§8](#8-where-a-finding-goes)). | P7B 12 | |
| **M6** | **The remainder, which is cheap once M0 is up.** Three walks that are not critical and want the same install: `maxTokens` set to ten from the session panel and the next call reporting `truncated` (**which re-walks C3 on the UI path** — its hand-edit wording is struck, not replaced); breaking an actor file by hand, importing, and reading what was quarantined and why from the browser (**which retires [manual gate §3.5](11-p2-manual-gate.md)**, a step that has failed since it was written); and assembling a package in the browser from objects you own, because a picker over somebody's whole library is a surface a test cannot judge. | P7B 6, 15, 13b; **C3**; **manual gate 3.5** | *Underneath, 2026-09-30*: reading the quarantine from the browser did not retire manual gate §3.5 until `3f97526` — an object whose file broke after it was read was still shown as current and offered for editing, and a save over a file that was JSON but not a valid object answered *changed since you read it* for ever. Both are fixed; the walk is still owed |
| **M7** | **Desk work, and it is what closes the phase.** Write the results into [P7B §3.2](24-p7b-presets-and-prompts.md) — never into the gate's own seventeen steps, which [§0](#the-two-tier-gate)'s first honesty condition forbids — then update §6's row here, and write P7B's status line. **Route every `CORRECTION` into the document that owns the step**, which §7 names as the item that gets skipped. | P7B's close | |

**What this list cannot reach, and the gate says it rather than this file.**
Every row checks that a named surface arrived and behaves. **None of them can
say whether an eighteenth surface is missing** — which is the class
[P7B §0.5](24-p7b-presets-and-prompts.md) is about, and exactly why gate row 17
is a test rather than a step. A walk of the things the walker just built cannot
find the thing nobody built.

**A second way it could pass and be worthless.** M1 through M4 are *does it
work* questions and the surfaces are new, so the temptation is to author a pack
that is obviously fine. **Author a bad one on purpose** — a block list with the
instruction removed, an outlet no lore entry addresses, a `maxTokens` that
truncates mid-sentence — because the editors' job is not only to accept what
works, and [refinements](22-walkthrough-refinements.md) is where an afternoon on
a new surface earns itself.

**Answers:** whether the prompt pack is a thing a person can own, which is what
nine phases of deferral left unanswered and what
[03 §8](../03-data-model.md)'s copy-never-link rule exists to make safe.
**Unblocks:** P7B's close, and the assumption every editor after this one is
built on — that [10 §11.2d](../10-ui-surfaces.md)'s *the editor's shape is the
schema's shape* survives contact with six kinds rather than two.

---


### N — P8's critical list — *one row, and the shortest a phase has ever closed on*

**The fourth critical list under [§0](#the-two-tier-gate)'s model, and the first
one a **cut** shortened rather than a criterion.**
[P8](25-p8-implementation.md) built six stages on
[§5](25-p8-implementation.md)'s named fallback — the chain, the pipeline, the
books, **manual capture** and the toggles, with the **automatic extractor
deferred** — and two of its three criticals are about the extractor.

***So this sitting has one row where §3.1 derived three, and the arithmetic is
worth stating rather than hiding.*** C2 (*a hand correction survives the next
extraction*) is **vacuous** while nothing rewrites an entry; C3's extraction half
has no extractor to bleed. **Both travel with the stage**, and arrive here as
rows when it does. What is left is C1, which was always *the anchor*.

**Clause (iii) is satisfied by C1 and was never the problem.** §3.1 says so
plainly: *two short sessions and one actor — no long session needed*, which is
**what makes the phase's headline claim cheap to walk**. It still wants a live
endpoint, so N sits behind K1 with L and M.

| # | Do | Clears | Result |
|---|---|---|---|
| **N0** | **The install**, as K0, L0 and M0 are: a real endpoint, a model that answers, and a session that can take several turns. If M has been walked this is already standing. | — | |
| **N1** | ***Cross-session recall, named.* Only a person can walk it.** Play a short session with an actor; press **Remember this** on a message and leave your own words in the box. Start a second session with the same actor and the same persona, say something that touches the memory, and check three things: **she refers to it**, the workbench's lore report shows the book arriving as *memories of somebody in the cast*, and opening the book from the Session panel shows the entry saying **which session it came from**. *The phrase is on this row rather than on a gate step, which is [P8 §3.1](25-p8-implementation.md)'s own finding: P8's ten steps carry it nowhere.* | P8 4; **C1** | |
| **N2** | **The remainder, cheap once N0 is up.** Start a second session in a treatment you have already played and check the warning names the earlier one and that **Start isolated** seals it; turn `share` off and check *Remember this* refuses with a sentence rather than doing nothing; press it on a turn a hook fired on and read the refusal. *All three are asserted by tests; what a person is here for is whether the sentences are the ones somebody would act on.* | P8 9; §1.5's remainder | |
| **N3** | **Desk work, and it is what closes the phase.** Write the results into [P8 §3.2](25-p8-implementation.md) — never into the gate's own ten steps, which [§0](#the-two-tier-gate) forbids — then update §6's row here and P8's status line. **Route every `CORRECTION` into the document that owns the step.** | P8's close | |

**What this list cannot reach is the phase's own headline**, and [P8 §3.1] says it
rather than this file: *"and the same session, four hundred turns long, still
assembles inside budget"* is on no critical list, because the only long session
this project can produce is **synthesised**, and a synthesised one proves the
chain rather than the summary. **So P8 closes on evidence that memory works and
no evidence that summarisation is any good.** That is tolerable only because
summaries are derived and disposable — a bad summariser is a regeneration rather
than lost history — and it is said here so nobody reads a closed P8 as a verdict
on summary quality. *The long walk is sitting G's, and it is as answerable in
November.*


### O — P9's critical list — *two rows, and the first sitting that cannot start*

**The fifth critical list under [§0](#the-two-tier-gate)'s model, and the first
one that is an errand before it is a sitting.** K, L, M and N are all *waiting for
an hour*; this one is waiting for a **thing**. Both rows want
[R10](#3-standing-prerequisites) — an endpoint that serves the `image` role — and
no other outstanding prerequisite produces one: R2 is a chat endpoint, and the
four sittings that hold a phase open all queue on that.

***The phase is built and the list is unwalked, which is a state this file has
not held before.*** [P9](26-p9-implementation.md) landed all six stages on
2026-09-16 and [§3.2](26-p9-implementation.md) records thirteen of its fifteen
rows discharged by test. What is left is the two rows where the claim is about
**what it looks like** — and those are exactly the ones a test cannot reach.
**So P9 stays open on a list nobody could have walked**, which is the difference
§0 draws between a deferral and a block said as plainly as it can be: nobody
decided these were not worth walking.

*Cheap once R10 exists.* Neither row needs a long session, a second account or a
particular mode: one session, two turns, one picture. The expensive part is the
endpoint.

| # | Do | Clears | Result |
|---|---|---|---|
| **O0** | **The install, and R10.** A connection whose endpoint answers image generation, saved with `rendersImages` set on it — ~~[P2B](10-p2b-provider-configuration.md)'s per-connection capability override is where a person says so~~ ***the form's* Makes pictures *says so since [polish §25](06-polish.md#25-a-connection-can-be-tried-without-taking-a-turn)*** (written 2026-09-26, merged 2026-10-03; before it, only a hand edit to the file could), because whether the URL behind `openai-compatible` also serves images is a fact about that endpoint. ***Then press* Test → Try a picture *on its row before binding anything*** — a picture there confirms R10 for the price of one image, where O1 would spend a turn finding out. Bind the `image` role to it and the `fast` role to a chat model. Then open the Session panel's **Pictures** section and set *Illustrate the story* to **Every turn**. *Added 2026-10-03, a courtesy rather than a step any row needs:* if the endpoint accepts a `seed`, set ~~`supportsImageSeed` beside `rendersImages`~~ ***Sends a seed with a picture*** *beside* Makes pictures *(the same day: the control arrived with polish §25's merge)*; without it the workbench says *Not sent* beside each seed, which is correct and not a finding ([P9 §3.2](26-p9-implementation.md)). | R10 | |
| **O1** | ***An image arrives and renders in place, and a reattached client finds it.* Only a person can walk it.** Take a turn; watch the **text** land and the turn finish, then watch the picture follow it seconds later. *The turn must be usable the whole time* — type the next one while the first picture is still being made. Then take another turn and **close the tab while it is generating**; reopen the session and check the finished picture is there. | P9 1, 2; **C1** | |
| **O2** | ***The picture lands *in* the prose, at the sentence the moment call quoted.*** Read the paragraph. The image should sit **after the sentence it is of**, not underneath the message — and the workbench's **Pictures** section names the anchor it was given, so the two can be compared. Then **edit that message** so the quoted words are gone, and check the picture moves to the end and stays `ready`: *a miss is ordinary and must never be an error.* | P9 13, 14; **C2** | |
| **O3** | **The remainder, cheap once O0 is up.** Press **Illustrate** on an old turn and check a **second** picture appears with the first still choosable; press **Set the scene** and check the backdrop stages behind the reading column without competing with the prose; turn *Illustrate the story* to **Never** and check Play looks like a text-only session. *All three are asserted by tests; what a person is here for is whether it looks like anything.* | P9 4, 12; §1.5's remainder | *Underneath, 2026-09-30*: there was nothing to look at for the second check — a generated backdrop was made, selected and never drawn until `75f88d0`. *Set the scene* now draws, and where the story has named no place yet it says so and makes nothing (`c52f6d4`); a picture of a turn draws only who is in the room, and nobody by name (`2362524`). The walk is still owed |
| **O4** | **Desk work, and it is what closes the phase.** Write the results into [P9 §3.2](26-p9-implementation.md)'s table — never into the gate's own fifteen steps, which [§0](#the-two-tier-gate) forbids — then update §6's row here and P9's status line. **Route every `CORRECTION` into the document that owns the step.** | P9's close | |

***What this list cannot reach, and it is not a gap in the list.*** Nothing here
asks whether a generated image is any **good**.
[testing §4.3](03-testing.md) forbids building a quality eval and
[P9 §4](26-p9-implementation.md) names an image eval as the most tempting version
of that mistake — so the gate answers *does it arrive, is it reproducible, does it
cost what it should* and is silent on *is it worth having*. That second question
is [work plan §0.4](01-work-plan.md)'s, it is about the feature rather than the
build, and **a closed P9 is not a verdict on renditions.**


### P — P10's critical list — *four rows, three of them errands, and the one that is not is a person*

**The sixth critical list under [§0](#the-two-tier-gate)'s model, and the first
whose subject is somewhere other than this machine.** That is not a
complication — it is what the phase *is*. [P10](27-p10-implementation.md)'s test
is *"this is the phase that makes the install reachable, and safe, for someone
who is not the developer"*, and every clause of it is about a browser, a
supervisor, a neighbour or a person, none of which is in a repository.

***Three blocked rows is the most any list here has carried, and the blocks are
not one errand.*** Sitting O waits on **one** thing ([R10](#3-standing-prerequisites));
this one waits on three that have nothing to do with each other —
[R11](#3-standing-prerequisites) a supervised install, [R5](#3-standing-prerequisites)
a second machine, [R4](#3-standing-prerequisites) a non-author for an hour. **So
this sitting is not one sitting.** C1 is a browser and ten minutes; C2 and C3
travel together on an install somebody already has; C4 is somebody else's diary
and is the only row here that cannot be brought forward by deciding to.

***What a built P10 already proves, so the list stays honest about its size.***
[§3.2](27-p10-implementation.md) records seven rows discharged, and the one that
would be worst to get wrong is among them: **who is told what**. A household
server that notified the wrong person, published an account list it should not
have, or served a portrait somebody had hidden would be this phase failing at the
thing it is for, and all three are asserted. What is left is *reaching* it.

| # | Do | Clears | Result |
|---|---|---|---|
| **P0** | **The install.** Two accounts on one server, both with a session and a bound `prose` role. No endpoint beyond a chat one is needed — nothing on this list wants a picture. If the install is the container under `compose.yaml` or unraid, **C2 and C3 come free with it**; if it is `pnpm dev`, they do not and are a second sitting. | — | |
| **P1** | ***A completion sound fires in a tab nobody is looking at.* Only a person can walk it.** Take a turn, switch to another tab or another window **before it finishes**, and listen. Then come back and check the unread badge on **Notifications** and the count in the tab's own title. Turn the class to *A toast, no sound* in Settings and do it again: the toast and the badge, no chime. Then **Mute sounds** from the header and check it silences without blinding. | P10 5; **C1** | |
| **P2** | ***Restart now, and the process comes back.* Only a person can walk it.** On a supervised install, change a `restart` key (`server.port` is the easy one to see), then press **Restart now** in the banner. Read the confirmation: it should name how many **other** people have a turn running. Take a turn on the second account first, so that number is not zero. Watch the page reconnect on its own. **Then the half a test cannot reach at all**: run a bare `node dist/main.js`, check the banner offers no button and says the server does not restart itself, and check `POST /api/admin/restart` is refused. | P10 6; **C2** | R11 |
| **P3** | ***A neighbour resolves `storyengine.local`.*** From a second machine on the same network: open `http://storyengine.local:8080` and sign in. Then **stop the server and try again within a minute** — the goodbye should have taken the name out of the neighbour's cache, so this fails fast rather than hanging on a stale address. *If the install is a container on the default bridge, expect this not to work and check the log says why rather than being silent.* | P10 9; **C3** | R5 |
| **P4** | ***Somebody who has never seen it, from the URL alone.* Only a person can walk it — and it is the phase's whole claim rather than a check on it.** Hand them the address and nothing else. Watch where they stop. **Do not help.** Write down the first three places they hesitate, in their words rather than yours. *The specific thing this phase claims is that they get in and take a turn without you*, so the result is a yes or a no and then the three sentences. | P10 10; **C4** | R4 |
| **P5** | **The gallery, in front of that person, and it is the reason to do P4 second.** Before P4, set `auth.loginScreen` to `gallery` and give both accounts a face. Check the grid, check picking a tile lands on the password box with the handle filled, and check **Sign in by name** still works. Then hide one account from Settings and check it is gone from the grid **and still signs in by typing its handle**. *All of this is asserted by tests; what a person is here for is whether a grid of two faces reads as a front door or as a user table.* | P10 7; [12 §2](../12-account-gallery.md) | |
| **P6** | **The container's first run, and the question [P10.0](27-p10-implementation.md) deferred to a second install.** On a fresh volume, does it start? Alpha 1's answer to a root-owned bind mount is a one-time host `chown` said in the template and refused in one line by the server; the convention unraid users expect is a container that starts as root, takes its volume and drops to `PUID`/`PGID`. **Walk the first and write down whether it cost anything**, then decide. *A question whose whole point is that it is answered by watching somebody, so it is here rather than at a desk.* | [P10.0](27-p10-implementation.md)'s open question | R8 |
| **P7** | **Desk work, and it is what closes the phase.** Write the results into [P10 §3.2](27-p10-implementation.md)'s table — never into the gate's own ten steps, which [§0](#the-two-tier-gate) forbids — then update §6's row here and P10's status line. **Route every `CORRECTION` into the document that owns the step.** | P10's close | |

***What this list cannot reach, and it is worth naming because the phase invites
the question.*** Nothing here asks whether **two people actually enjoy sharing a
server**. [09 §8](../09-server-multiuser-deployment.md) keeps multiplayer out of
1.0 on purpose and this phase is about *access separation among people who trust
each other*, so the gate answers *are they kept apart* and is silent on *is it
pleasant to share*. That second question wants a household and a month, and it is
[work plan §0.4](01-work-plan.md)'s rather than this file's.

### Q — The machine French — *twenty minutes, and the only thing it needs is eyes*

**The layout half of [P11.8](28-p11-implementation.md)'s *Ends at***, which is
one sentence — *"the app runs in the test French with no layout breakage"* — and
is not a thing a test can answer. `useLocale.test.tsx` carries the path (an
account's locale reaches a chunk, the chunk reaches a module-level table, a
component re-renders in French) and `catalogue.test.ts` carries the rule (a label
map outside the catalogue fails the build). *Neither can see a button.*

***Why it is a sitting and not a critical row.*** Nothing here can lose data,
take a one-way door, or be undone only by a migration — a clipped label is
ugly and reversible. It belongs on the standing list, and it belongs there
**now** rather than when a real locale exists, which is the whole argument for a
deliberately bad French: *the cheapest moment to find out that a layout only
holds English is while nobody is relying on the alternative.*

| # | Do | Clears | Result |
|---|---|---|---|
| **Q0** | **Switch.** Settings → *You* → **Language and formats** → *Français (machine translation, unreviewed)*. It should apply without a reload. Check the picker itself still reads in English — the label is a warning, and a warning written in the language being warned about is one the reader cannot check. | [P11.8](28-p11-implementation.md) | |
| **Q1** | ***The bilingual row, which is the point rather than a defect.*** Open a session. The composer's kind buttons read *Faites / Parler / Penser*; **hover one** and the tooltip reads English, because the hints are deliberately untranslated. That is [20 §12.1](../20-tech-stack.md)'s *per key* on screen. **No `[MISSING]`, no placeholder, nothing on the console** — open it and check. | [20 §12.1](../20-tech-stack.md) | |
| **Q2** | ***The longest strings in the build, which is where it will break if it breaks.*** Open the tag manager and read the three folder labels — *Dossier ouvert — les membres restent également visibles dans la liste* and its siblings. Do they clip, wrap into the control, or push the dialog wider than the viewport on a phone-width window? Then the workbench's step list and call view, whose badges are sized for *Ran* and now hold *En cours d'exécution*. | [10 §1](../10-ui-surfaces.md) | *Underneath, 2026-10-01* ([polish §20](06-polish.md#20-destructive-actions-ask-once-the-same-way-everywhere)): the tag manager's rows grew longer strings than the three named here — Remove asks in its row, *Remove the entry for noir? It stays on everything that carries it.*, and Prune lists every tag it takes — so a phone-width walk should open a Remove and a Prune as well as read the folder labels. Nothing here was walked |
| **Q3** | **Back again.** Choose a regional English. The interface returns to English without a reload. *The failure this catches is the one a person cannot work around from inside the app*: a catalogue that stayed applied after the account changed its mind, with the setting saying otherwise. | [P11.8](28-p11-implementation.md) | |
| **Q4** | **Write down every clipped or overflowing thing, with the screen it was on.** Each one is a layout bug in **English's** favour and a fix in the component, not in the French — *the French is not going to get shorter, and the next one will be German.* | — | |

### R — P11's critical list — *two sittings and an afternoon; the one that closes the beta gate*

**The seventh critical list under [§0](#the-two-tier-gate)'s model, and the only
one whose phase has nothing after it.** That changes what the criterion returns
and [P11 §3.1](28-p11-implementation.md) says how: clause (ii) privileges what
**compounds**, and what this gate compounds into is not a later phase but a
**declaration** — *feature complete to the 1.0 spec*, said to other people, once.

***~~Five~~ six rows, two of them desk work, and the order matters here as it
has not before.*** R5 is a fact to record and R4 is a person reading the whole
corpus against the build; **R4 must not start before R5 is written down**,
because the gate's own row 13 says *what must not happen is row 12 being walked
by somebody who does not know the question was open.* *(2026-10-04: and not
before T and AA either —
[P12A §0.1](34-p12a-the-look.md) and [P16 §0.1](35-p16-world.md) each put
commitments into the 1.0 corpus that R4 reads, so R4 waits on both phases
landing; R1, R2, R3, R5 and R6 do not. Written here because this is the
paragraph a walker of R4 reads, and R4's own row is not edited.)*

***R6 arrived 2026-09-22 with [P11.2](28-p11-implementation.md)'s hook stage***,
and it is here rather than in that document for §10.1's reason: a walk recorded
only as a paragraph inside a phase document is a deferral nobody collects, and
the person closing P11 reads this list. Its three clauses are argued where the
stage is.

***And it carries a known absence rather than hiding one.*** [P11 §3.2](28-p11-implementation.md)
records **four things a 1.0 commitment asks for and this phase did not build** —
[10 §11.2b]'s image slots, [10 §11.2c]'s entry travel, the assistant's docs
lorebook, and the Playwright suite the gate's row 8 assumed. *Three are features
with an argument beside them; the fourth is infrastructure nobody was asked for.*
R4's reader meets all four as entries in §10 below rather than as discoveries.

***All four were built on 2026-09-17***, the day the record named them — the
Playwright suite, entry travel, image slots and the docs lorebook — **which is
what the four-row list was for**, and is a reason to keep making one rather than
a reason to stop. R4's reader now meets four closed rows and no open absence.

*Image slots is the row that most earns the table*: it had been carried as a
stage of work, and what looking found was a **container that did not exist**.
*The docs lorebook is the one that earns it least and is still worth having*: its
row said the machinery was there and only a corpus was missing, and that was
exactly right — so what the row bought was somebody sitting down and writing
twenty-five answers rather than assuming a later phase would.

| # | Do | Clears | Result |
|---|---|---|---|
| **R0** | **The install.** One account, a session with a few branches in it, and a bound `prose` role. R3 wants a live endpoint; R1, R2 and R5 do not. | — | |
| **R1** | **Desk work, and it is the first thing.** Walk [P11 §0.1](28-p11-implementation.md)'s list item by item against the stage that took it, with the named check's output beside it. **Including `CONFIG_TIERS` reaching zero `'unread'` keys**, which is the standing line's mechanical half. *Write the result into [P11 §3.2](28-p11-implementation.md)'s table, never into the thirteen rows* — [§0](#the-two-tier-gate) forbids that. | P11 1 | |
| **R2** | ***A real session, read.* Only a person can walk it.** Open a session with branches at `/read/<id>`. Does it read as prose rather than as a transcript — the moves, the attribution, the passages? Then **print it** through the browser and look at the PDF: no nav, no dock, no footer. Then **copy it as Markdown** and paste it somewhere else. *Two hundred turns is [sitting G](#g--the-long-pass--hours-unscripted-playables-second-sitting)'s; what this asks is whether the three renderings are each worth having.* | P11 2 | *Underneath, 2026-09-17 and 2026-10-01* ([polish §13](06-polish.md#13-the-story-prints), [§23](06-polish.md#23-the-keyboard-and-the-screen-reader-get-there-too)): found against this row before anybody walked it, and fixed — the print was the first page and nothing after it, the scroll container clipping it (`b2926fc`); a move with no persona was headed *DID*, an illustration's alt read its sentence a second time, and the page was a second `<main>` whose printed width the stylesheet released by that landmark (`73be6b6`). **None of that is the walk**: whether the three renderings are each worth having is still a person's |
| **R3** | ***Ask the assistant something about your own library.* Only a person can walk it.** Open it from the header while an actor is on screen. Check the line at the top says what it can see, and check the **turn record** shows that as a block. Ask it why a lorebook entry never fires. ~~**Expect it to be worse than it looks**: there is no docs lorebook, so it knows the app only as well as the model already did.~~ ***The book was written on 2026-09-17***, so the question changed with it: what this walks now is **whether the answers are any good** — whether the entry that fired was the right one, whether it said something true about *this* build, and whether a follow-up question that names none of the original words still retrieves anything. *Write down which entry fired and whether it helped.* **The gate's own step is not edited**; this is the note beside it. *Underneath, 2026-09-30 and 2026-10-01*: the line at the top said what it could see, and no prompt carried it — the turn record's block was empty on every turn — until `4aed877`; and a suggested change named fields an actor does not have, and was addressed to a session when one was open, until `0ceb5ff` | P11 4 | R2 |
| **R4** | ***Read the 1.0 design documents and say, capability by capability, whether it exists and works.* It is the beta gate rather than a check on it.** [releases §0](04-repo-and-releases.md) defines beta as *feature complete to the 1.0 spec*, and that is checkable against documents rather than negotiable. **Do not start before R5.** Read §10's four named absences first, so they are known rather than found. | P11 12; **the phase's close** | |
| **R5** | **Record that row 13 is answered.** [P11.12](28-p11-implementation.md) took the extractor, so [sitting N](#n--p8s-critical-list--one-row-and-the-shortest-a-phase-has-ever-closed-on) stops being one row: **C2** *(a hand correction survives the next extraction)* and **C3**'s extraction half are walkable now and travel with that stage. Write it into P11 §3.2 and into N. | P11 13; **unblocks R4** | |
| **R6** | ***A hook written on an object, and one saved back off a session.* Only a person can walk it.** `pnpm dev`. Open a treatment and write a hook with an **`introduces`** block — subject, an entrance with a label and text, a primary. Start a session from that treatment and check the panel shows it **attributed to the treatment** and its entrance **by label, never by text**. Add a hook in the panel, press *Save this to…*, and save it onto the treatment; reload the treatment editor and it is there, with the **same id**. Press it again and read the refusal. Then check the **pool is unchanged** — the row still says it is the session's own — and that the actor the hook names lists the treatment under *Used by*. Also open a Setup that carries no hooks and confirm it is offered as a target. *Cleared against [P11.2](28-p11-implementation.md), which argues all three of [§0](#the-two-tier-gate)'s clauses for it.* | ~~P11 4~~ P11 3; **[P11.2](28-p11-implementation.md)** | |

***What this list cannot reach, and it is the same shape every list here has.***
Nothing in R asks whether the thing is **good** — whether four pacing levels read
differently, whether the French layout holds, whether a two-hundred-turn session
stays coherent. Those are sittings **G**, **Q** and the standing list, and §0 is
explicit that breadth and duration are *differently urgent* rather than less
valuable. **A beta gate that waited for them would be waiting for the product.**

### S — P12's critical list — *one sitting, and the one thing no test can witness*

**The eighth critical list under [§0](#the-two-tier-gate)'s model**, and the
shortest so far, because [P12](29-p12-implementation.md) is one feature. The
criterion returns five rows and the reason each is here rather than in a test is
the same in every case: **the thing being checked is a file leaving this
machine, or a process restarting.**

| # | What | Why a person |
|---|---|---|
| S1 | Take an install backup from Settings, restore it with `pnpm backup restore` into an empty directory, start the server on it, and **run a search** | A search answering is the only observable proof the index was **rebuilt rather than carried** — [P11.11](28-p11-implementation.md)'s obligation, inherited. A test can assert the archive's contents and cannot watch a server rebuild from them |
| S2 | Restore an install archive from the admin panel with `SE_SUPERVISED` set; confirm the server drains, comes back on the archive's data, and that ~~`data.replaced-<uuid>` is intact beside it~~ `.restore/<id>/replaced` is intact inside it *(2026-09-27, `3db0579`: the sibling swap could not run where this ships)* | **No test can witness a supervisor restarting a process**, and the moved-aside directory is the undo — the single most important safety property here |
| S3 | Download an account archive and unpack it with `tar -xzf … -C` into a data directory; confirm `pnpm backup restore` **refuses** it by name | The one sharp edge of data-root-relative member names, and the one that erases other people's data if it is wrong |
| S4 | Import a backup into a live account with `skip`: a deleted actor returns, an edited lorebook keeps **your** edit. Re-run with `replace`: it reverts, and the old text is in its history | The distinction the whole second half exists to make, and it is a judgement about what came back rather than a count |
| S5 | Attempt to restore a `redacted` archive; confirm it refuses until confirmed, and says nobody will be able to sign in | A restore that silently produced an install nobody can enter |

*Underneath these five, 2026-09-27* — the steps are not edited; this is what
changed beneath them. **S1's** restore used to empty the data directory before
it read a header, stored backups included; `3db0579` reads every header first,
deletes nothing and takes exactly one archive — and a backup taken during play
could hold truncated JSON until `e83ca44`, which S1 would have restored
faithfully. **S3's** refusal did not exist: `pnpm backup restore` took an
account archive until `3db0579`. **S4's** import brought back no pictures and
every session twice until `546386f`. None of the five has been walked.

*And two things this list deliberately does not reach*: whether an archive of a
genuinely large library is quick enough to be pleasant, and whether the
`content-length` on a download survives a reverse proxy. Both extend the
standing list below rather than gating the phase.

### T — P12A's critical list — *an afternoon and a phone; the one that unblocks R4*

**Registered 2026-09-22, before a line of the phase is built**, which is a first
here and is deliberate: [P12A](34-p12a-the-look.md) exists because
[10 §1.3](../10-ui-surfaces.md) added commitments to the 1.0 corpus that the
build does not meet, and **R4 reads that corpus**. So this sitting is what stands
between the two — not because P12A is more important than the beta gate, but
because R4 cannot honestly be walked against a spec written last week and a build
from the week before.

***The rows are known now and cannot be walked yet***, and the distinction
matters: sitting **O** cannot start because a *thing* is missing
([R10](#3-standing-prerequisites)); **T** cannot start because the code is not
written. **Nothing here is blocked on a prerequisite** — that is
[P12A §1.2](34-p12a-the-look.md)'s doing, which built a choose-your-own-backdrop
path precisely so this list does not queue behind R10 with O.

| # | Do | Clears | Result |
|---|---|---|---|
| **T0** | **The install.** One account, a session with a cast of three and a few branches, an actor with a portrait and one without, and an image on disk to use as a backdrop. **No image endpoint** — [P12A §1.2](34-p12a-the-look.md) is why. | — | |
| **T1** | ***The prose over the worst backdrop you can find.* Only a person can walk it.** A bright, busy image; a long turn; then the backdrop off, and no empty frame where it was. | P12A.2; [10 §2.3](../10-ui-surfaces.md) | |
| **T2** | ***A face that is wrong, corrected from where it is shown.*** Make the engine's attribution stale, then fix it from the face. [00 §3.6](../00-stance.md)'s test, applied to what this phase added. | P12A.3, P12A.4 | |
| **T3** | ***Play a session after the panels moved.* Only a person can walk it.** Mid-scene: change the lore selection, check a hook, read the goal, correct a channel. Does [P12A §1.3](34-p12a-the-look.md)'s defence survive contact, or is this the disclosure reflex [10 §1.1](../10-ui-surfaces.md) rejects? | P12A.5 | |
| **T4** | **A phone, one session, twenty minutes.** Send, read, use a per-turn control, open the workbench, correct a channel — **every essential action reachable without a hover**. | P12A.8, P12A.5 | |
| **T5** | **Desk work: reduced motion.** Set the OS preference, walk the five motions. Each *absent*, not merely fast. | P12A.0, P12A.6 | |

***What this list cannot reach*** is whether any of it is beautiful, and the
gate does not ask. Five of its six rows test a written claim; taste is a
standing-list matter and a token away from being reversed.

### U — Pictures on a move — *half an hour, a phone, and R12*

**A standing sitting rather than a critical list**, added 2026-09-27 with
[26 E15](../26-open-questions.md) R1, which is a roadmap feature and closes no
phase. Its rows are here for the reason every row in this file is: **the thing
checked is a browser's canvas, a real endpoint, or a phone**, and a test can
reach none of the three — `preparePicture.test.ts` says outright that the redraw
is not exercised there, and the wire test's endpoint is a fake.

***Lettered T when it was added, and re-lettered U on 2026-10-02.*** It was
registered on `main` by a branch that could not see
[P12A](34-p12a-the-look.md)'s T, registered five days earlier on a local `main`
that had not been pushed; the two met at the merge, and the later registration
took the next letter. Its rows, their order and their wording are unchanged
apart from the letter, and nothing outside this file had cited it. *(2026-10-03:
one citation inside it had — R12's* Unblocks *cell still said T2–T4 until this
date, and now says U2–U4 with a note.)*

| # | What | Why a person |
|---|---|---|
| U1 | From a **phone**, attach a photo taken with location on. Fetch it back from `GET /api/sessions/:id/attachments/:digest` and read it with an EXIF tool: **no GPS, no EXIF at all**, and the long edge at most 1568 px | The feature's privacy claim is that the browser redraws the picture and fails closed rather than sending the original. jsdom has no canvas; only a real browser on a real phone can show the redraw happened |
| U2 | With the model that sees marked *can see pictures*, attach a captioned picture: the composer says **the model will see this picture**; send it; the workbench badge reads *Picture sent* and the reply is about the picture | The one question no fake answers: whether an endpoint takes the `image_url` data URL this build writes, and does something with it |
| U3 | Rebind `prose` to the text model **on the same connection**; the composer's line changes to *the caption instead*; redo the picture turn and take one more. Both complete | The lock-in property against a real text endpoint, some of which refuse array content outright — the reason the adapter sends a string whenever no picture goes |
| U4 | Export the session, import it on another install (or account): the transcript and the reading view show each picture's caption with *not on this server*, and a redo goes as words | What an imported session looks like to a person, which is a judgement about the placeholder rather than a count |

*What it deliberately does not reach*: whether pictures make narration better,
which E15 says only real sessions will answer — that is G's kind of sitting, with
a model that sees, and extends the standing list when somebody has one.

### V — A connection, tried — *twenty minutes, and it wants R2 and R3*

**[Polish §25](06-polish.md#25-a-connection-can-be-tried-without-taking-a-turn)'s
*what needs a person***: the Test button on a connection row, against endpoints
that are real. Every test of it runs against `FakeProvider` or a stub transport,
which proves the route's vocabulary and not that a real endpoint's refusals land
in it — and *which sentence a real 401 produces* is the whole of what this
button is for.

***Lettered T when it was written, and re-lettered V on 2026-10-03.*** It was
registered on a branch, cut on 2026-09-26 from the pushed `main`, that could not
see [P12A](34-p12a-the-look.md)'s T (registered 2026-09-22 on a local `main`
that met the pushed one only on 2026-10-02) or the pictures-on-a-move sitting
(registered as T on 2026-09-27, after the branch was cut, and re-lettered U on
2026-10-02). They met at the merge, and the later registration took the next
free letter. Its rows are unchanged apart from the letter, two dated notes on
what the merge changed underneath them, and one on the control the merge added
beside *Makes pictures*.

***Why it is a sitting and not a critical row*** — Q's reason exactly. No phase
gate owns it, and nothing here can lose data or take a one-way door: a test
writes nothing but a usage line, and the worst outcome is a sentence that sends
somebody to the wrong field. It extends the standing list.

| # | Do | Clears | Result |
|---|---|---|---|
| **V1** | **A hosted endpoint (R2).** Settings → the connection → **Test** → *Send a test message* with the offered prompt. A reply, a time, and a token sentence. **Open DevTools' network panel and read the request and the response: no key in either.** *Since the merge (2026-10-03) the test is also a line in your `usage.jsonl`, purpose `connection-test:text`* — look, once. | [polish §25](06-polish.md#25-a-connection-can-be-tried-without-taking-a-turn) | |
| **V2** | **Save a wrong key** on a copy of it and press Test. *That endpoint refused the key* — not *could not be reached*, which is finding 5 in the [P2C log](14-p2c-log.md) at its second route. | [P2C log](14-p2c-log.md) | |
| **V3** | **A model it does not serve.** Add a nonsense id to the connection's *Models*, save, pick it in the test, and press Test. *Refused the request … check the model.* Write down what the endpoint actually answered with (the server log's `connection.tested` line has its words, key redacted) — if it is a 401 or a 5xx rather than a 400/404, this row's sentence is wrong for that endpoint. | [polish §25](06-polish.md#25-a-connection-can-be-tried-without-taking-a-turn) | |
| **V4** | **A local runtime (R3).** With it stopped: *could not be reached*, and **never** *no internet access* — *after about a second, since the merge: a message is asked again twice, as a turn's is, before nothing answering is believed.* Start it with a model that is not yet loaded and press Test: it should wait rather than fail, and answer. If a reasoning model is to hand, try it: an empty reply should read *used the whole test allowance … all worked*, not as a failure. | [09 §6.5](../09-server-multiuser-deployment.md) | |
| **V5** | **R10, if a candidate is to hand.** Save it with *Makes pictures* → **Yes**, then **Test → Try a picture** with the offered prompt. A picture on the page. *Since the merge (2026-10-03), under a group headed* Drawing pictures*:* **Sends a seed with a picture** *appears once* Makes pictures *says Yes.* Then set *Makes pictures* back to the default and confirm *Try a picture* is gone, and the seed control with it. | R10 | |
| **V6** | **As a non-admin with `privateConnections`**, Test one of your own connections. It works, and the admin's connections are not offered at all. | [10 §15.1](../10-ui-surfaces.md) | |

### W — P15's critical list — *one sitting against a real model, and a judgement only a reader can make*

**The ~~ninth~~ tenth critical list under [§0](#the-two-tier-gate)'s model**, from
[P15 §3.1](33-p15-setup-from-a-turn.md) and not edited here. *Make a setup from
here* is tested end to end on the server — emit a Setup at a turn, start from
it, and the opening, the party, the spent hook, the goal, the story so far and a
kept fact all arrive — so what is left is **what no scripted provider can
answer**: whether a real model's story so far is one a new session can continue
from, and whether the person still playing was spoiled.

***Lettered T when it was written, and re-lettered W on 2026-10-03*** — and the
phase it belongs to was P13 then and is P15 now. It was registered on a branch
cut on 2026-09-26 from the pushed `main`, which could not see
[P12A](34-p12a-the-look.md)'s T (registered 2026-09-22 on a local `main`), the
pictures-on-a-move sitting (registered as T on 2026-09-27 and re-lettered U),
or the connection sitting (written as T on a branch of the same day and
re-lettered V earlier the same day). They met at the merges, and the latest
registration took the next free letter. Its rows, their order and their wording
are unchanged apart from the letter. *One thing the merge changed underneath
them*, so that whoever walks W1 is not surprised by it: a Setup's own opening
now wins over a cast's greetings ([P15 §1.7](33-p15-setup-from-a-turn.md)), so
a session started from a setup made here opens on the setup's opening even in a
mode that would otherwise open on greetings — which is the opening W1 reads.

| # | What | Why a person |
|---|---|---|
| W1 | On a real session of about thirty turns, against a real model, make a setup from a turn in the middle and start a session from it. Read the first two turns: names, situation and party intact, and the opening reading as a **scene** rather than a recap | *Continues the story* is a judgement about prose, and the live tier asserts structure and never prose |
| W2 | In a session with an unfired plot hook and a hidden goal, open the wizard: it shows neither — hooks as counts, the goal as *hidden from you* — and the new session does not surface either before its time | The one failure this feature must not have, and the half that happens in a model's words rather than in a payload is only visible by reading them |
| W3 | Start from the same setup twice, and get two independent sessions with the same opening; edit the setup's story so far in the library, and a third session carries the edit | *Start from again and again* is the primary use, and the edit is what makes a setup better than a saved session |

*What this list does not reach, which extends the standing list*: a setup made
here travelling in a package to a second account and starting there with its
facts; the no-summary-slot warning on a preset that really has none; and a kept
fact activating on its key in play rather than in a scripted prompt.

*And one thing seen at the merge and not judged* (2026-10-03): a setup started
cold, or one with no opening of its own that seats a party or spends a hook,
begins on a turn that only seeds — no words, no move — and the transcript draws
it as an empty row carrying only its hover actions (*Continue from here*, *Make
a setup from here*, *Undo*, and *Remember this* when the session has a cast),
above the greetings in a Scene chat. It was so on the
branch for a cold start; the merge's greetings-as-its-children
([P15 §1.7](33-p15-setup-from-a-turn.md)) made it reachable from a Scene
session too. Whether it should be drawn at all is a reader's call, and no row
here was edited for it. *Answered 2026-10-04 on the recommended answer, owner
deferred ([P15 §1.10](33-p15-setup-from-a-turn.md)): it is drawn, as every
turn the engine writes without a move already is — an undo's, a hand edit's
and a channel write's among them — because the transcript shows the record and
the row's Undo is how the seeding is taken back. Whoever walks W1 and finds the
empty row reads as a gap should say so — the remedy §1.10 names is a line on
every turn of that shape, never hiding this one — and still no row is edited
for it.*

*And one thing found 2026-10-04 that a W1 walk will meet* (recommended answer,
owner deferred, [P15 §1.12](33-p15-setup-from-a-turn.md),
[26 B19](../26-open-questions.md)): a setup carries the party at the turn, not
the cast. An actor who was seated and never made a member of `se.party` is not
carried — a Scene chat's character, unless the model made them a companion,
and an NPC such as the seeded session's Mara — so the new session starts
without them, and in a Scene chat there may be nobody to answer its second
turn. The
wizard's *The party (nobody but you)* is the cue. **A character missing in W1
is this known gap, not a regression**: record which kind of session the setup
was made from — its mode, and whether the character was a companion — and no
row is edited for it.

### X — P13's critical list — *two halves, one Aventuras install, and a prerequisite nobody had written down*

**The eleventh critical list under [§0](#the-two-tier-gate)'s model**, from
[P13 §3.1 and §3.3](30-p13-aventuras-import.md) and not edited here.
[P13](30-p13-aventuras-import.md) merged into `main` on 2026-09-29 at
`7565265`, and again on 2026-09-30 at `6f55e6e` with Part 2 built. Every stage
is done and neither list is walked, so under
[§7](#7-closing-a-gate-and-closing-a-phase) the phase is open until these have
results.

***Registered 2026-10-04, five days late.*** P13's status line said *"neither
gate is walked"*, and nothing here said so: §6 had no row for the phase and §4
no sitting. That is [§10.1](#101-the-dangling-owner-which-is-the-finding-this-sweep-exists-to-have-produced)'s
*a deferral nobody collects*, one level up. The lettering follows
[Z](#z--a-connection-that-hides-another--ten-minutes-a-text-editor-and-a-second-account)'s
note: **X is P13's sitting, with its two lists as halves**, because one
Aventuras install serves both.

**Derived, not chosen — and this time the phase did the deriving.** P13's gate
is eighteen rows in two parts, and its document split each part itself, citing
this file: four critical rows and five for the remainder in Part 1, and the
same in Part 2. §3.3 argues the three clauses for Part 2's rows outright. §3.1
does not, so they were applied here to all eight:

- **(i) holds for every row.** Each names something P13 built: the snapshot
  (P13.1), identity on the row (§1.5), carried portraits (§1.6), links resolved
  inside the database (§1.7), the pairing and lineage rebuild (P13.11), the
  world stored as lore (P13.12), identity across two sources (P13.15), and
  pictures as renditions (P13.13). None is another phase's claim transported.
- **(ii) holds plainly for six.** A snapshot that harmed a live database
  (row 1) damages another program's data, and nothing here can undo that. An
  identity that misses (rows 2 and 12) makes a second copy on every re-import.
  A link, a pairing or a world used wrongly (rows 4, 10 and 11) is played
  onward, and an imported session cannot be brought again to repair it,
  because row 12's refusal is the design. ***The two picture rows, 3 and 13,
  are the weakest, and they stay.*** For row 13, the reason is that same
  refusal: a session played onward keeps the pictures its import wrote. Row 3
  rests on what the mend costs. A portrait can be mended by importing again
  with *replace*, which puts whatever was edited since into the actor's history
  and off the actor.
- **(iii) is where this sitting differs from the document.** §3.3 calls its
  rows walkable *"with an Aventuras install, which Part 1's rows already assume
  is to hand"*, and [§3](#3-standing-prerequisites) had no row for that
  assumption. **It does now: R13, unconfirmed.** Row 13 wants more than an
  install, too. Aventuras draws its pictures through an image provider set up
  inside it, so an install that never had one has no illustrated turn to
  bring. **Row 13 is therefore blocked rather than deferred**, as
  [P9 §3.1](26-p9-implementation.md)'s C1 and C2 are: nobody decided it was not
  worth walking, and it waits on R10's kind of endpoint run inside Aventuras.
  So X8 stays on the list, and **P13 does not close until it has a result**.
  The rest of X can be walked without it.

| # | Do | Clears | Result |
|---|---|---|---|
| **X0** | **The install, and R13.** A running StoryEngine with a real chat connection (R2 or R3) bound to `prose`, the Aventuras install R13 describes, and a second account on the same server for X2. **Read L0 first.** The build question it forks on is asked again here, and more sharply: `v1.0.0-alpha.4` predates P13 entirely, so walking it answers none of these rows. | R13 | |
| **X1** | ***A live database, swept while Aventuras is open.* Only a person can walk it.** In the library's import panel, sweep the Aventuras config directory by path while Aventuras is still running, and read the review. Then close Aventuras and open it again: it opens, and its library and stories are intact. | P13 1 | |
| **X2** | **The backup zip, uploaded, makes the same library.** Upload it into a second account and compare that library with X1's: the same objects. Then, in the first account, upload the zip and sweep the directory again: every row of both reviews reads `unchanged`. | P13 2 | |
| **X3** | **Portraits.** The PNG portrait is the card's picture, and the JPEG one is visible as its source image. | P13 3 | |
| **X4** | **A linked lorebook, used.** Start a session from the scenario, take one turn, and read the workbench's lore report: the linked book is bound and its entries can fire. | P13 4 | |
| **X5** | ***The story, beside Aventuras.* Only a person can walk it.** Sweep again with *stories* ticked. The imported session reads as the story did in Aventuras on its head branch, and each other branch can be reached as a line of its own. | P13 10 | |
| **X6** | **Played one turn onward.** The narration has the story's cast and its story lorebook bound, and the persona is the protagonist. | P13 11 | |
| **X7** | **Brought twice, kept once.** Sweep the database a second time, then pick the story's `.avt` by hand. Both are refused as already here, naming the first session, and no second session appears. | P13 12 | |
| **X8** | **The illustrated turn.** Its picture is where Aventuras drew it, and no `<pic` text appears anywhere in the prose. *It needs R13's illustrated turn. Without one this row waits, and P13's close waits with it; the rest of X does not.* | P13 13 | |
| **X9** | **Desk work, and it is what closes the phase.** Write the results into a table of their own in [P13 §3](30-p13-aventuras-import.md), and never into the eighteen rows, which [§0](#the-two-tier-gate)'s first honesty condition forbids. Then update §6's row here and P13's status line, and **route every `CORRECTION` into the document that owns the step.** | P13's close | |

**X's remainder, which extends the standing list and holds nothing open.**
These are P13 §3.2's and §3.4's ten rows, put here so that each has somewhere
to record a result. They are breadth, duration, platform and corpus, which §0
says are not criticality. Several want something X0 does not provide, and the
row says what.

| # | Do | Clears | Result |
|---|---|---|---|
| **X10** | A database of several hundred MB, swept by server path: the time and the peak memory stay reasonable. *Wants a large Aventuras library.* | P13 5 | |
| **X11** | A Docker install with the Aventuras config directory mounted read-only, swept by path. *Wants [R8](#3-standing-prerequisites).* | P13 6 | |
| **X12** | A backup exported from Aventuras on Android. *Wants Aventuras on an Android phone.* | P13 7 | |
| **X13** | The imported tags' colours look like the ones in Aventuras. | P13 8 | |
| **X14** | A backup over 64 MB, uploaded from a browser, once from a phone: it imports and shows progress. Behind a reverse proxy, the proxy's refusal reads as a sentence. *Wants a large backup, and a proxy for the last clause.* | P13 9 | |
| **X15** | A story of several thousand entries: the sweep time, the peak memory, and the session list afterwards. | P13 14 | |
| **X16** | A database from before Aventuras' migration 013, which has no branches, and one from before 029, whose branch copies are guessed ([P13 §0.5](30-p13-aventuras-import.md)). *Wants old Aventuras builds, or databases saved from them.* | P13 15 | |
| **X17** | A `.avt` exported on Android, and one written by Aventuras' sync, stamped 1.7.0. | P13 16 | |
| **X18** | An imported story played past its window: the chain summarises the imported turns, and none of Aventuras' chapters appears. *Wants a long story, or a long evening.* | P13 17 | |
| **X19** | An imported backdrop chosen by hand, in a mode that stages backdrops. | P13 18 | |

***What this list cannot reach.*** Every row is somebody's own install, so the
sitting can say that the import carries what is there. It cannot say what other
people's installs hold: the limits real authors reach, odd rows, a library some
years old. That is R1's kind of question, asked of another program, and no row
here answers it. *And the import runs one way.* Nothing writes back to
Aventuras ([P13](30-p13-aventuras-import.md)'s *what is deliberately not in
this phase*), so no row asks whether a story survives a round trip.

### Y — P14's critical list — *a sitting against a real model, and the last free letter*

**The twelfth critical list under [§0](#the-two-tier-gate)'s model**, from
[P14 §4.1](31-p14-scene-and-session-import.md) and not edited here.
[P14](31-p14-scene-and-session-import.md) merged into `main` on 2026-09-30 at
`8878851` with every stage built and reviewed and the list unwalked, so under
§7 the phase is open until these have results. *Registered 2026-10-04, with X,
for the same reason and just as late.*

***Y is the last free letter.*** With X and Y registered, every letter from A
to Z names a sitting. The next sitting needs a scheme nobody has chosen yet, and
the choice falls to whoever registers it.

**Derived, not chosen — and again the phase did the deriving**: §4.1's five
rows, written *"by manual testing §0's criterion"*, and §4.2's four for the
remainder. Applied here:

- **(i) holds for all five.** Rows 1, 2 and 5 are Part A's Scene: the gestures
  (P14.4), who replies and per-actor dispatch (P14.1, P14.2), and the agents
  (P14.5a–c). Rows 3 and 4 are Part B's import, SillyTavern's families and
  groups (P14.9) and Marinara's trackers (P14.10).
- **(ii) holds.** Part B's reason is X's: an imported chat is played onward,
  and bringing it again cannot repair it, because a re-import *extends* the
  session ([P14 §2.7](31-p14-scene-and-session-import.md)) rather than
  replacing it. Part A compounds for a different reason. Every Scene session
  after this phase plays on what rows 1 and 2 check, and so does every chat that
  Part B imports.
- **(iii) is satisfied for rows 1, 2 and 5** by a real chat endpoint, R2 or
  R3: the install K1 stands up. **Rows 3 and 4 ask for a *real* SillyTavern
  data folder and a *real* Marinara profile**, which are R1's first two items,
  and R1 is not to hand. ***Read here as satisfied without R1 — recommended
  answer, owner deferred, 2026-10-04.*** What these two rows check is
  structure: a branched chat is one session; a group keeps its members, its
  strategy and its muted members; the imported tracker state is what Marinara
  showed. A folder the walker makes by playing in each program for half an hour
  answers that, provided it has a branch, a group with a muted member on a
  reply order other than SillyTavern's default, and trackers switched on. The
  default matters because SillyTavern's *Natural order* imports as `natural`,
  which is also what the import writes when it carries no strategy and Scene's
  own default, so a group left on it would pass whether the importer carried
  the strategy or dropped it. It cannot answer what other people's chats hold, which
  is R1's question; K2 records the same limit for a hand-written lorebook. *If
  this reading is overruled, Y3 and Y4 wait on R1 with E1 and E2.*
- **Two of the five ask for a judgement**: row 2's *whether smart's picks beat
  natural's often enough to be worth the call*, and row 5's three *worth its
  call* questions. They are on the list because §4.1 put them there, and the
  gate is not edited. The walk passes when the judgement is made and written
  down. A *no* is a finding about the feature rather than a `FAIL` of the build,
  the line [sitting O](#o--p9s-critical-list--two-rows-and-the-first-sitting-that-cannot-start)
  draws for pictures, and it goes to [refinements](22-walkthrough-refinements.md)
  with what was expected written before what was seen
  ([§8](#8-where-a-finding-goes)).

| # | Do | Clears | Result |
|---|---|---|---|
| **Y0** | **The install**: a real endpoint, a model that answers, and room for several sessions. This is what K1 builds, and it is already standing if L or M has been walked. Y1 also wants a character with at least two written openings (a card's alternate greetings), made in the editor or imported from a card, because the seeded Mara has one. Then the two folders for Y3 and Y4, made or brought: a SillyTavern data folder holding a chat with a branch and a group of three with one member muted and its reply order set to something other than SillyTavern's default *Natural order* (*List*, *Manual* or *Pooled*), and a Marinara profile holding a roleplay with trackers on. **Read L0 first**: `v1.0.0-alpha.4` predates P14. | — | |
| **Y1** | ***A single-character chat, from creation.* Only a person can walk it.** Start a Scene with a character whose card has alternate greetings. The greeting shows and swipes to its alternates. Then swipe, continue, edit, hide and impersonate (**Draft my next message**), and check that each behaves the way somebody who uses SillyTavern expects. | P14 1 | |
| **Y2** | **A three-character group.** Play it on the default **Who replies**: the speakers are plausible, and force-talk (**Speak**, **Who speaks next**) and **Let them talk** both work. Then play it again on **Smart** and judge whether its picks beat the default's often enough to be worth the extra call. Every message names its speaker, and nobody writes another member's lines. | P14 2 | |
| **Y3** | **The SillyTavern folder, imported and played one turn.** The branched chat is one session. The group keeps its members and its muted member, and its **Who replies** shows the order it was set to in SillyTavern: *List* reads as *Everyone, in cast order*, *Pooled* as *One at a time, taking turns*, and *Manual* as *Only who I ask*. A group left on *Natural order* would match what the import writes when it carries no strategy, which is Scene's own default (`SCENE_CHAT` in `import/chat/build.ts`, and `participants.select` in the Scene package's `mode.ts`), and prove nothing. | P14 3 | |
| **Y4** | **The Marinara profile, imported and played one turn, with its trackers.** The imported tracker state is what Marinara showed, and the next turn updates it. | P14 4 | |
| **Y5** | **Trackers, a push and the editor, on a Scene played from scratch.** Switch the trackers on, push the story, and switch on **Edit replies for style**. Judge three things: whether the tracked state is right often enough to be worth its call, whether a push moves the story, and whether an edited message reads better than its original. | P14 5 | |
| **Y6** | **Desk work, and it is what closes the phase.** Write the results into a table of their own in [P14 §4](31-p14-scene-and-session-import.md), and never into §4.1's five rows. Then update §6's row here and P14's status line, and **route every `CORRECTION` into the document that owns the step.** | P14's close | |

**Y's remainder, which extends the standing list and holds nothing open** —
P14 §4.2's four, with somewhere to record a result.

| # | Do | Clears | Result |
|---|---|---|---|
| **Y7** | **Update from source**, read by somebody who has not read [P14 §2.7](31-p14-scene-and-session-import.md): do they understand it, including why a message deleted in SillyTavern is still here? *Wants a second person, as [R4](#3-standing-prerequisites) does.* | P14 §4.2 | |
| **Y8** | The narrated voice (**A narrator, telling the scene**) still produces what Write's falsification test ([13](../13-write-mode.md)) assumes Scene produces. | P14 §4.2 | |
| **Y9** | Auto-mode (**Let them keep talking on their own**) stops when it should: on typing, on **Stop**, on opening an edit box, on a failed turn, and when nobody can reply. | P14 §4.2 | |
| **Y10** | A 10,000-message import's first turn after the warm feels like any other turn. *Wants a chat that long.* | P14 §4.2 | |

***What this list cannot reach.*** Every row is a short session over chats the
walker chose or made, so a defect of accumulation survives it: a group three
hundred turns in, or tracker state drifting over an evening. That is
[sitting G](#g--the-long-pass--hours-unscripted-playables-second-sitting)'s.
*And one known gap Y4 will meet.* A Marinara profile made today is storage
format 7, and P14's chat readers were checked at format 4 (its status,
2026-10-02). A private roleplay line importing as an ordinary one is that
recorded gap, not a regression, and is written down as such.

### Z — A connection that hides another — *ten minutes, a text editor and a second account*

**[Polish §26](06-polish.md#26-a-connection-that-hides-another-says-so)'s
*what needs a person***: a personal connection that shares an install
connection's id, read on every row that now says so, by somebody who did not
make the file. The suite plants the file and asserts the sentences and the
controls; what it cannot say is whether the sentences tell a person what
happened, and that is the whole of the feature.

***Lettered Z, and not X or Y, on 2026-10-04.*** X and Y are held for the
critical lists of the two import phases —
[P13 §3.1 and §3.3](30-p13-aventuras-import.md) and
[P14 §4.1](31-p14-scene-and-session-import.md) — which are written and not yet
registered here as sittings. Both phases were merged before this entry was
filed, so their lists keep the next two letters, and this takes the one after
rather than a letter that would have to move when they arrive — the re-lettering
V and W went through, avoided. ***Three lists for two letters***, because P13
has two — Part 1's rows 1–4 and Part 2's rows 10–13, the second written
2026-09-30 once Part 2 was scheduled. The reading this note takes is that
**X is P13's sitting with those two lists as its halves** — one Aventuras
install serves both, which is what §3.3's third clause says it assumes — and
**Y is P14's**. The mapping is whoever registers them to make; if X has to
split, this note is where the dated line goes, and this sitting's letter does
not move for it. *Registered later the same day as this note reads: X is P13's,
with Part 1's list and Part 2's as its two halves, and Y is P14's. X did not
split.*

***Its own sitting rather than a row of V***, which is the connections sitting
already: V wants R2 and R3, real endpoints, and this wants neither — the
running app, [R7](#3-standing-prerequisites)'s text editor on the machine
holding the data directory, and a second account. A row
inside V would wait on V's errands for no reason of its own. ***And a sitting
rather than a critical row*** — Q's reason exactly: no phase gate owns it,
and nothing here can lose data or take a one-way door; the worst outcome is a
sentence that confuses. It extends the standing list.

| # | Do | Clears | Result |
|---|---|---|---|
| **Z1** | **As an administrator** (the account may keep its own connections, which is the default). **First**, under **Which models your stories use**, pick one install connection that lists at least two models and set two jobs to two different ones of them — *Writing the story* to one, *Quick background jobs* to the other. **Then** copy that connection's file from `data/system/connections/` into your own `data/users/<handle>/connections/`, keep its `id`, change its `label` to *My copy*, and delete from its `models` the model *Writing the story* is set to. Reload Settings. **Your connections**: *My copy* says it has the same id as the install's connection and that your stories use it wherever a job is set to that one, including the install's defaults, and still has **Test**, **Edit** and **Remove**. **Administration → Connections**: the install's row says your own *My copy* is used instead *for you*, that everyone else still uses it — and also keeps its three buttons. **Read both sentences as somebody who did not make the file: do they say what happened, and what to do?** | [polish §26](06-polish.md#26-a-connection-that-hides-another-says-so) | |
| **Z2** | **Which models your stories use**: the install connection's models are no longer offered, and a sentence above the table names both connections. *Writing the story*, set to the model *My copy* no longer lists, reads *model — My copy, which does not list it*, not *on a connection that is gone*. *Quick background jobs*, set to a model *My copy* kept, reads plainly *model — My copy*: the same choice, which now reaches your file. **Does the first say what changed for that job, and does the second leave anyone wondering where it went?** | [polish §26](06-polish.md#26-a-connection-that-hides-another-says-so) | |
| **Z3** | **Sign in as a second account** with no file of its own. Nothing is said anywhere, and the install connection is offered as before — the sentence is about one person's files, and nobody else's turns changed. | [P2B §1.5](10-p2b-provider-configuration.md) | |
| **Z4** | **Back as the administrator, remove *My copy*** from Your connections. Both sentences go, the install connection's models are offered again, and both of Z1's jobs read as the install connection's. | [polish §26](06-polish.md#26-a-connection-that-hides-another-says-so) | |

### AA — P16's critical list — *an install that had Packages, a second account, and one turn; the second that unblocks R4*

**The thirteenth critical list under [§0](#the-two-tier-gate)'s model**, from
[P16 §3.1](35-p16-world.md) and not edited here. **Registered 2026-10-04, before a
line of the phase is built** — the second list registered that early, after
[T](#t--p12as-critical-list--an-afternoon-and-a-phone-the-one-that-unblocks-r4),
and for T's reason: [15](../15-world.md) was rewritten the same day and put
membership, contribution and transport into the 1.0 corpus, and **R4 reads that
corpus**. So R4 waits on this sitting as it waits on T, and R1, R2, R3, R5 and R6
do not.

***Lettered AA, which is a scheme, chosen 2026-10-04 by the rule Y left.*** Y's
note says every letter from A to Z names a sitting and that the next scheme falls
to whoever registers the next sitting; Z went to
[polish §26](06-polish.md#26-a-connection-that-hides-another-says-so) the same
day. **The scheme is a spreadsheet's: after Z comes AA, then AB**, so the next
sitting takes the next pair and nothing already registered moves. Its rows are
AA0, AA1 and so on, which cannot be read as A's rows because the letter is
doubled, and its anchor is as unambiguous as any single letter's. *Greek letters
and numbered suffixes were the other two candidates*: the first cannot be typed
from a keyboard and searched by somebody who has not met it, and the second makes
`A2` both a row of A and a second A.

***The rows are known now and cannot be walked yet***, T's distinction exactly:
nothing here is blocked on a prerequisite with lead time — AA3's one turn wants
[R2](#3-standing-prerequisites), which is to hand — and the sitting cannot start
because the code is not written. **AA0 has one errand that cannot be done
later**: the data directory and the archive AA1 reads have to come from before
P16.0, so they are copied the day the phase opens or never.

*Derived, not chosen*: [P16 §3.1](35-p16-world.md) applies the criterion row by
row in a table of its own, the three clauses beside each check, and it is not
repeated here. Rows 1 and 4 are the two only a person can walk; row 2 is there for
clause (ii) — membership that behaved as ownership would shape every later feature
over Worlds, and a cascade destroys data — and row 5 is desk work, R5's shape.

| # | Do | Clears | Result |
|---|---|---|---|
| **AA0** | **The install, and the errand.** *Before P16.0 lands*, on a build from before it. **Make a Package in the app, then fill its contents by hand**, because no build before P16.1 has a surface for membership ([P16 §0.2](35-p16-world.md)'s second fact): with the server stopped, add three `{ "schema", "id", "name" }` envelopes naming an existing lorebook, treatment and actor to the `contents` of its `library/packages/<slug>/package.json`, copying each `schema` and `id` from that object's own file. Start the server: the Package's page lists the three under its contents, and *Export this package* carries them. Edit its description twice so it has history, and check the page still lists the three; export it once as a `.sepack.json`. **Make a second Package and delete it**, so the trash holds one. **Create one more lorebook and leave it out of everything** — before P16.2 a new book is `global`, the factory default, and AA3 needs one; check *As stored* says so. Then take a backup archive of the account, and copy the whole data directory aside. Then upgrade. A second account on the same install; a [R2](#3-standing-prerequisites) connection bound to `prose` for AA3. | — | |
| **AA1** | ***The rename, on an install that had Packages.* Only a person can walk it.** Open the copied data directory with a P16 build: the Package is in the **Worlds** panel with its three members. **Before editing it, make a new World with the same name**, so the folder name the legacy one would move to is taken. Then edit the legacy one's description: the edit succeeds, its folder is now under `library/worlds/` beside the new World's under a different folder name, its history shows the two earlier versions, and both Worlds open as themselves. **Open the trash**: the Package AA0 deleted is listed, as a World; restore it, and it opens from the Worlds panel. Import AA0's archive into the second account: its Package arrives as a World. Then import AA0's `.sepack.json` there too, once P16.3 is built: it arrives as a World naming what landed. | [P16.0](35-p16-world.md), [P16.3](35-p16-world.md) | |
| **AA2** | ***Membership is not ownership.*** Make a World of a lorebook and two actors and start a session in it. Delete one actor: the delete is not refused and asks nothing about the World, and the World's page shows the actor missing, named, without blocking anything. Then delete the World: the lorebook, the other actor and the session are all still there, and the session's page no longer lists the World. **Does the World's page say what happened in words a person would use?** | [P16.1](35-p16-world.md); [15 §3.1](../15-world.md) | |
| **AA3** | ***Contribution copies, and P5.7 stays reversed.*** **Have a `global` lorebook that is in no World** — the one AA0 created before the upgrade, or a native `storyengine.lorebook` `.json` carrying `"scope": { "kind": "global" }` brought in through the import panel; after P16.2 neither a new book nor a SillyTavern import is one, which is the next check. Import a standalone SillyTavern lorebook: *As stored* gives its scope as `linked` with no actors, not `global`. Make a World of a treatment and one other lorebook. Start a session in the World: the treatment is chosen, `session.lore` on disk names the World's book and not the `global` one, and after one turn the workbench shows nothing retrieved from the `global` book. Add a second book to the World: the session already started does not change. Remove the World's book from the session's lore: it stops contributing. *If the `world` arm has landed*, scope the `global` book to the World, start a second session, and it is in that session's lore beside the member. | [P16.2](35-p16-world.md); [15 §5.3](../15-world.md) | |
| **AA4** | ***A World published, and arriving.* Only a person can walk it.** Publish AA3's World with one session ticked. Read the review: every level shown, the session unticked until you ticked it, the pictures that stay behind named, the sentence about which builds can read the file. Import the file on the second account: the import says what is inside before it writes anything, and on commit a World arrives naming the objects and the one session, which opens. Back on the first account, edit one member and publish again: the review opens on what changed. | [P16.3](35-p16-world.md); [16 §5](../16-publish.md) | |
| **AA5** | **Desk work: the release check, recorded.** Write [P16 §1.6](35-p16-world.md)'s test output — four schema artefacts unchanged, the lorebook's changed inside `LoreScope` alone or not at all, and the World's artefact in the package one's place, with no frozen copy kept ([P16 §1.1](35-p16-world.md)) — into [P16 §3.3](35-p16-world.md) and [work plan §0.2](01-work-plan.md). *Write the result there, never into P16's five rows* — [§0](#the-two-tier-gate) forbids that. | P16 5 | |

**AA's remainder, which extends the standing list and holds nothing open** —
[P16 §3.2](35-p16-world.md)'s five, in its order, with somewhere to record a
result. Not walkable before the stage each names, for the reason the critical
rows are not.

| # | Do | Clears | Result |
|---|---|---|---|
| **AA10** | **The Worlds panel's columns and empty state**, read by somebody who never saw Packages: do the columns say what a World holds, and does the empty panel say what a World is for and how to make one? | [P16 §3.2](35-p16-world.md) | |
| **AA11** | **The picker at the scale of a real library**: add members to a World from a library of hundreds of objects, and judge whether finding the one you want is quick. *Wants [R1](#3-standing-prerequisites).* | [P16 §3.2](35-p16-world.md) | |
| **AA12** | **The backlinks from each member kind**: open one actor, lorebook, treatment, setup and preset that a World holds, and a session in it — each names the World, *Used by* on the five and *In these Worlds* on the session. | [P16 §3.2](35-p16-world.md) | |
| **AA13** | **A World holding only sessions, published without ticking any**: read what the review says and what comes out. [16](../16-publish.md) gives this case no rule of its own, so the row asks whether what happens is what a person would expect, with what was expected written before what was seen ([§8](#8-where-a-finding-goes)). | [P16 §3.2](35-p16-world.md) | |
| **AA14** | **The review and the picker on a phone**, under [P12A](34-p12a-the-look.md)'s rules, which govern by the time this phase is built: both usable at phone width, no sideways scroll, every control reachable. | [P16 §3.2](35-p16-world.md) | |

***What this list cannot reach*** is whether anybody wants a World at all, and the
gate does not ask. [15 §8](../15-world.md) and [16 §8](../16-publish.md) hold the
tests that would say, each marked with the stage that makes it runnable, and every
one of them is evidence that arrives through use rather than through a sitting.

## 5. Already discharged, and by what

Listed so the count is honest. **Nobody walks these.**

| Step | Result | By |
|---|---|---|
| **P1's gate** | **AUTO** | The named gate test, run in CI on every push. §6's only row with nothing owed. |
| **P4 2** | **AUTO** | `import/fixture-pair.test.ts`, a named CI step: no `empty-source` rows for persona, actor, history or input, no `unknown-slot` rows at all. |
| **P4 13** | **AUTO** | `import/registries/registries.test.ts` over the two vendored snapshots — every ST directory key and Marinara table maps to a disposition, and a name in neither imports as unrecognised-and-counted. |
| **P5 14** | **AUTO** | See F14. |
| **P5 17** | **AUTO** | See F17. |
| **P5 18** | **AUTO** | See F18. |
| **P6B 6** | **AUTO in part** | `retrieval/activate.test.ts` — *"feeds every entry that activated into the next pass, not the first `scanDepth` of them"*, the width-three chain [P6B.1](20-p6b-playable.md) added at the default depth. **Its carrier is the third entry in scan order**, so the step's second clause — raising an `order` does not remove text from the haystack — is covered in substance and by nothing that says so: no test raises an `order` and re-checks. K4's width-2 chain is the person-side residue; **do not open a sitting for it.** |
| **P6B 7** | **AUTO** | `state/migrations.test.ts` — *"carries every import item across the step that rebuilds its table"*, written at the version the step leaves *from* and asserting every column rather than a count. The step asks for a **mutation** rather than a pass, and it was run at [P6B.1](20-p6b-playable.md) (`a6d3eb4`, `0e228ec`, `39f9ee1`): deleting the `insert into import_item_new … select` reddens it, where before P6B.1 it left the whole suite green. Re-running it is a minute at a terminal. |
| **P11 3** | **AUTO** | `editor/contract.test.tsx` — over `LIBRARY_KINDS` rather than over the editors somebody remembered, which is the obligation's own wording: six kinds asked for assist, disclosure and history, plus one assist driven end to end because *the control is there* and *the feature works* are different claims. The closed-section invariant is `entry-defaults.test.ts`'s and predates the phase. |
| **P11 4** (the grep half) | **AUTO** | `tools/repo-shape.test.ts`'s *the assistant, which must not be a second chat* — the panel **renders** `PlayPage`, its directory carries no composer, no turn submission, no stream and no `EventSource`, the mode package resolves one dependency, and nothing in `packages/server` names the mode. [06 §7.4]'s own test of the mode contract, in the only form that survives somebody deciding one small copy would be tidier. *The answering half is [R3](#r--p11s-critical-list--two-sittings-and-an-afternoon-the-one-that-closes-the-beta-gate).* |
| **P11 8** | **AUTO** | `e2e/journeys.spec.ts`, run by `ci.yml`'s `journeys` job — the seven journeys [testing §3.5](03-testing.md) names, in its order, against a **built** server serving a **built** client and an OpenAI-compatible double on a second port. *The one row in this table whose entry moved from ❌ to AUTO by the suite being written*, which happened because [P11 §3.2](28-p11-implementation.md) had to write ❌ down. **Three of the seven had been read wrong** — the sharpest being *branch*, which is **Redo** and not a second send: a second send posts the same one turn and continues the line instead of splitting it, so a suite written to that reading would have been green and would have protected the wrong claim. *Underneath, 2026-10-01*: red on `main` from P14 until `d66ad2b`, and unseen, because CI had not run since K — the transcript collapsed to nothing under P14's controls at the journeys' 1280×720, and in a chat *branch* is the message's *Previous reply*, P14's grouping, rather than the turn's *Previous version* |
| **P11 §11.2c** (entry travel) | **AUTO** | `editor/entry-travel.test.ts` and `editor/LorebookEditorPage.test.tsx` — the two questions a screen cannot answer (**which folders come with a selection**, and **what a merge does with a collision**) and the three only the page can (a selection is makeable, what comes out is a file, and the save carries [10 §11.2c]'s `import` history line). *Not a gate row*: entry travel was a [§10](#10-deferred-with-an-owner) absence rather than a numbered step, which is why it is here with its own label — the thing it discharges is the deferral. |
| **P11 §11.2b** (image slots) | **AUTO** | `library/assets.test.ts` and `editor/LorebookEditorPage.test.tsx` — bytes in and bytes out of the **folder** container that did not exist before this; a row on an **entry** served as readily as one on the book, because [10 §11.2b] puts pictures in two places and a lookup reading `body.media` alone would serve half of them; and the sweep that collects what no manifest row names, with the case that would break it — a picture only an *entry* names. *The one claim with no mechanism behind it is §11.2b's own sentence* that the pictures are never sent, so what is asserted is that the sentence is on the page. |
| **P11 §7.4** (docs lorebook) | **AUTO** | `docs-lorebook.test.ts` and `system-library.test.ts` — the corpus's own health (every entry keyed and ungated, every folder used, no two entries claiming one key, and the book left retrievable rather than always-on) and the shipping (it lands on the shelf as a lorebook, with its entries rather than a manifest of them). `tools/repo-shape.test.ts` holds the seam: **the id is written out in two packages that cannot import each other**, and a `lore` link naming nothing resolves to nothing rather than failing — so the day they diverge produces an assistant with no documentation, silently. *Whether the answers are any good is [R3](#r--p11s-critical-list--two-sittings-and-an-afternoon-the-one-that-closes-the-beta-gate)'s.* |
| **P11 10** | **AUTO** | `sessions/export.test.ts` and `sessions/import.test.ts` — the round trip through a reader sharing no state with the writer: **every** turn rather than the path, a new session id, the old turn ids kept, each turn marked foreign, `origin` recorded, and a second trip that keeps the **first** install it came from. *Another **build** reading them is what a second install would prove.* The importer did not exist until the record was being written, which is what made row 10 a sentence about a capability rather than about this build. |
| **P11 11** | **AUTO** | `tools/restore.test.ts` — the archive carries the files and **not** the index, and the restored tree has none either, which is what makes it a restore rather than a copy. *A search answering afterwards is [testing](03-testing.md)'s, and P11's one case of a check living outside the document that owes it.* ***True since `aaf7345`, and not when this row was written*** ([P12 §0.5](29-p12-implementation.md)): the exclusion tested file names at the data root while the index lives at `index/`, and the fixture wrote it at the root too, so the test agreed with the mistake — green over an archive that carried the index every time. Repaired at [P12.0](29-p12-implementation.md), fixture included; **[sitting S](#s--p12s-critical-list--one-sitting-and-the-one-thing-no-test-can-witness)'s S1 is the search half** |
| **P11 13** | **AUTO** | Answered rather than asserted: [P11.12](28-p11-implementation.md) took the extractor, and `tools/repo-shape.test.ts`'s *the extractor cannot eat a correction* holds the clause that makes [P8](25-p8-implementation.md)'s C2 answerable at all. **[R5](#r--p11s-critical-list--two-sittings-and-an-afternoon-the-one-that-closes-the-beta-gate) is recording it**, which is the desk half. |
| **P2 / P2A / P2B** | **AUTO in part** | 8 of 20, 13 of 17+2, and 9 of 11 respectively. The residue is [manual gate §2](11-p2-manual-gate.md), which is sittings A–D above. |
| **P7 1** | **AUTO** | `tools/repo-shape.test.ts` — `packages/server/src/modes/` absent, the server's manifest, tsconfig and imports naming no mode, and a live eslint probe written into **each** mode package's `src` so both boundary layers are asserted against the input each can see. *The P7 document's §3.1 says this test "does not exist"; it landed at P7.0 and §3.2 corrects the cell.* |
| **P7 2b** | **AUTO** | `tools/repo-shape.test.ts`'s *the engine names no mode* — no `switch` keyed on a mode, and no mode id spelled in engine code outside a **two-entry allowlist with an argument on each**, which is §3.1's *"shape that matters"*. ~~**The lint-rule half is not built**~~ — **built at [P7.13]**: `eslint-rules.test.ts`'s *the engine names no mode*, four fixtures through `syntaxReportsMatching`, selectors for all three shapes §3.1 names, scoped to `packages/server/src/**`. **Two of the four are controls** — code that reads the declaration instead, and a mode package naming itself — because a rule that fires on everything is as useless as one that fires on nothing. A violation is now caught as it is typed *and* at the next `pnpm test`. |
| **P7 3** | **AUTO** | Four clauses, four homes: `mode-registry.test.ts` (registry), `effects.test.ts` (`update` policy), `channels.test.ts` + `ChannelHud.test.tsx` (widget), `reconstruct-property.test.ts` (reconstruction — whose fixture drives `se.clock`, **declared by the Scene package**, so it is already a mode-declared channel). |
| **P7 4** (record half) | **AUTO** | `hook-selector.test.ts`'s *the five answers are five answers* — five situations driven, five verdicts, and the set asserted to have five members. Four were asserted before, **one at a time across three files**, which is a weaker claim; `cooling` had never reached a record at all. *The reading half is Standing: [work plan P11](01-work-plan.md) owns selector legibility.* |
| **P7 5** | **AUTO** | `hooks.test.ts`'s *a commitment rewound past* — committed on one line and absent on its sibling, plus the case that would survive a broken implementation: a rewind landing **between** a commitment and its lapse. Asserted for `fired` too, which is the half [03 §4.1] states first. |
| **P7 6** (mechanics) | **AUTO** | `sessions.test.ts` *advances, carries on and ends through the channel write*; `goals.test.ts` for retention and the completing turn; `GoalPanel.test.tsx` for the three offers; `runner.test.ts` for a turn still running after *End*. Plus the confirmation gate ([26 C12], answered *ask* at P7.6), which the gate cell could not ask for because the question was open when it was written. |
| **P7 8** (the half that compounds) | **AUTO** | `mentions.test.ts` for the highlight set; `extract.test.ts`'s *an unresolved name* for **never creates** — no span, no effect, no model call, no cast channel in `writes`. ***The gate says `offers` and the stage shipped `never creates`***: [P7.7]'s Done cell defers the `proposed` span with its reason, and §3.1 had already named the structural clause as the one that compounds. |
| **P7 7** | **Covered by P6, not by P7** | *Dead on one branch, alive on the other, in the panel.* **Not a deferral and not a walk — a step that was already answered before its own gate was written.** [P6 §3](18-p6-implementation.md) step 5 is the same check, covered at P6.3 through the replay and through the head, so it fails criterion (i) outright: it is P6's claim transported into P7's gate. What is genuinely new is the clause *"with no special case in the panel's code"*, which is a component test and a code read rather than a sitting. Routed here 2026-09-13. |
| **P7 9b** | **AUTO** | `sessions.test.ts`'s *keeps what succeeded when a part fails*, against the scripted provider over `GENERATING_MODE`'s two setup parts — [00 §2.3]'s *8 of 10 valid sections applies 8 and re-asks for 2*. |
| **P9 1, 3, 4, 5, 7, 8, 9, 10, 11, 12, 14, 15** | **AUTO** | Twelve of [P9](26-p9-implementation.md)'s fifteen, against a scripted provider — `routes/p9-gate.test.ts` (the turn does not wait; a refusal is a placeholder), `routes/p9-gate-selection.test.ts` (**the money row**: a place already rendered dispatches no job, asserted on a count — *and, underneath since 2026-09-30, selected*: the count was true while no generated backdrop was ever drawn and nothing selected the reused one, until `75f88d0`; and the empty diff on branch and rewind), `routes/p9-gate-controls.test.ts` (no `image` binding, both settings off, the additive **Illustrate**, the anchor that is kept whether or not it still resolves, and **the recipe outliving its pixels** with no text call on re-creation), `renditions/assemble.test.ts` and `play/Rendition.test.tsx`. *The two the list keeps are C1 and C2, and they are [sitting O](#o--p9s-critical-list--two-rows-and-the-first-sitting-that-cannot-start).* |
| **P9 6** | **AUTO** | `workbench/turn/views.test.tsx` — two siblings of one turn made identical in every visible way **except** the seed, because that is the only shape in which *why did this one come out different* is a sharp question. The same file holds the dropped-fragment row, which is what makes a capped prompt legible rather than mysteriously short. |
| **P3 1–11** | *Assertable, coverage unaudited* | Marked "assertable" by [P3 §4](15-p3-implementation.md), but **which of them a test actually asserts has never been checked.** They are in sitting D as browser checks because confirming one takes a minute and auditing eleven takes an afternoon — and a step believed covered is exactly what [P6B.1](20-p6b-playable.md) found four of. |

---

---

## 6. Where every gate stands

*Anchored 2026-09-08 at `fb646c5`: 2,889 tests across 194 files, green, plus
`test:gate`, `test:fixture-pair` and `test:docs`. [manual gate §1](11-p2-manual-gate.md)'s own
anchor reads 1,186 and is four phases stale — noted rather than edited, because
that document's anchor is a record of when it was walked and moving it would be
a claim nobody made.*

| Gate | Steps | Automated | Walked | What is left, and by whom |
|---|---|---|---|---|
| **P1** | — | the named gate test | — | Its exit is the CI step, which runs. **Nothing outstanding.** |
| **P2 / P2A / P2B** | 20 / 17+2 / 11 | 8 / 13 / 9 | **A, B (less B2/B6/B8), C** | [manual gate §2.3](11-p2-manual-gate.md) the browser under real conditions, and §2.5 both platforms — H |
| **P2C** | 4 stages | P2C.0 only | **P2C.1**, 2026-09-08 | .2 is A–D, .3 is G, .4 is the triage. The boundary has since been crossed by ordinary use; what was never done is *capture* |
| **P3** | 15 | most | **steps 1–10**, 2026-09-08, plus one gate correction | D11–D20. Step 12 is PLAYABLE's fourth hypothesis wearing a step number |
| **P4** | 15 | most | — | E. Step 1 wants R1 |
| **P5** | 18 | 14, 17, 18 — §5 | **none; closed 2026-09-09 anyway** | **F**, and the criterion returned an empty critical list because clause (ii) had expired seven days and four phases ago. Step 6 is person-blocked on R1; step 12 is P7's |
| **P6** | 14 | steps 2–14 | **none; closed 2026-09-09** | **J**, two rows, both wanting R9 — and only G has ever produced one. §5's sibling question closed at the same time on [F-06](21-playable-log.md), a recorded judgement rather than a walk |
| **P6A** | 13 | 1, 2, 13 partly | **1 walked; closed 2026-09-09** | **I**, now ten rows rather than a paragraph: one `PASS`, three `PART` from the first install with all three findings fixed, six blank. It set the precedent §0 made a rule |
| **P6B** | 10 | **6, 7** — §5 | **K, pending** | **The first gate to split under [§0](#the-two-tier-gate).** Steps 1–5, 9 and 10 are sitting **K**, the critical list, and the phase does not close until they have results. Step 8 is P5's eighteen wearing P6B's number — criterion (i) — and is **F** |
| **PLAYABLE** | the four hypotheses | none, by definition | **never run** | K5–K8 answer what a walker's own turn can; G is the uncontrolled one. **CORRECTION, 2026-09-09:** this row read *"the fourth survived its first contact at A8"*. It did not. A8's session **resolved zero books** — [P6B.0](20-p6b-playable.md)'s defect — so that turn carried no retrieved blocks and none of the retriever's reason vocabulary. A8 evidenced hypothesis 1 and the static reasons; **hypothesis 4 has never been in contact with anything** |
| **P7** | 10 (13 rows) | **1, 2b, 3, 4a, 5, 6a, 8, 9b** — §5 | **L, pending** | **Sitting L**, three steps and the desk work that closes the phase. **Merged into `main` 2026-09-13 at `589900e`, and open** — the first phase where §7's rule and P6A's *the merge is the close* disagree, and the first with a derived non-empty critical list for the rule to hold. **Buildable work done, 2026-09-13** ([P7 §3.2](23-p7-implementation.md)) — through P7.14, which finished Scene, built `surfaces`, closed row 2b's lint half and gave the last two configuration-without-a-surface instances a control. ~~Eight rows~~ **nine** answered by tests, two Standing (§10), and **three await a person** — **L1** author a small mode against the SDK with no `server`; **L2** Freeform played end to end; **L3** a wizard for a mode the engine knows nothing about. *P7 calls them C1–C3; they are relettered in sitting L because sitting C has a C1 already.* Each is one sitting against something the walker builds. *§3.2 is the second table [§0](#the-two-tier-gate)'s first honesty condition requires; the ten steps were not edited* |
| **P8** | 10 (14 rows) | **1a, 1b, 2, 3, 5, 7, 8a, 9, 10** — landed 2026-09-16 | **merged 2026-09-16 at `4a6e377`, and open** | **Planned rather than sketched, 2026-09-13** ([P8 §3.1](25-p8-implementation.md)). Eight rows automatable, three Standing, and **three criticals — C1 cross-session recall named in the workbench, C2 a hand correction surviving the next extraction, C3 no spoiler bleed.** All three are *short-session* checks, which is unusually cheap for a critical list. **What the list cannot reach is the phase's own headline**: *the same session, four hundred turns long* is refused by clause (iii), because nothing here has ever played four hundred turns and a synthesised tree proves the chain rather than the summary. That walk is a sitting behind PLAYABLE, with **sitting G**. ***Re-audited 2026-09-15 after P7B and unchanged*** ([P8 §0.3](25-p8-implementation.md)): all ten findings of the first audit still hold, so the three criticals are still the three. *What did change is outside the gate* — the route-caller check now fails on a route with no caller, so the standing line's mechanical half runs on the commit rather than being read here. ***Built 2026-09-16 on §5's fallback cut and merged into `main` the same day at `4a6e377`*** — the chain, the pipeline, the books, **manual capture** and the toggles, with the **automatic extractor deferred** — and **the cut removed two of the three criticals' subjects**, which is the honest way to say it. C2 *(a correction survives the next extraction)* is **vacuous** while nothing rewrites an entry, and C3's extraction half has no extractor to bleed; **both travel with the stage** and arrive as rows when it does. So the list is **sitting N** with **one critical row**, C1, plus the cheap remainder and the desk work — *the shortest a phase has ever closed on*, and short because of a cut rather than because of the criterion. Nine of the fourteen rows are answered by named tests and are in §5. **Eight of the nine automatable rows landed**; the ninth, 1b, is *covered rather than walked* — `BlockSource` gained a `summary` arm so the block table has something to show, and the rendering is Standing. *The standing line's six field rows are five surfaced and one deliberately not*: the summariser's cadence is a constant with its reason beside it, because §1.3 makes it a measurement rather than a setting and a control offered before the measurement is a number somebody has to guess |
| **P9** | 15 | **1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15** — landed 2026-09-16 | **merged 2026-09-16 at `f51ad46`, and open** | **Planned rather than sketched, 2026-09-15** ([P9 §3.1](26-p9-implementation.md)). Thirteen rows automatable and **two criticals — C1 an image arriving and rendering in place, C2 the picture landing at its anchor inside the prose.** *Unusually short, and not because the phase is safe*: thirteen rows are about mechanism — a dispatch, a digest, a diff, a call log — and what is left for a person is the two where the claim is about what it looks like. **Both are blocked on R10**, which is why that row exists; a P9 that ships without one closes having proved every mechanism and looked at no picture. ***Re-audited 2026-09-16 after P8 and unchanged*** ([P9 §0.3](26-p9-implementation.md)): all ten findings of the first audit still hold, so the two criticals are still the two, and what P8 moved lands on the stages rather than on the gate — a content digest, a call counter, a pre-call role resolution and a worked example of the engine applying an effect. ***What the re-run sharpened is the errand, not the list***: the four sittings that hold a phase open — **K**, **L**, **M** and **N** — all want a **chat** endpoint, so none of them discharges R10, and the day that closes four phases leaves both of these criticals exactly where they are. ***Built 2026-09-16 and merged into `main` the same day at `f51ad46` — all six stages, all thirteen AUTO rows discharged by test, and the two criticals never walked*** ([P9 §3.2](26-p9-implementation.md)). The list is **sitting O**, and it is the first in this file that is an errand before it is a sitting: K, L, M and N are waiting for an hour, and O is waiting for a thing. *What a built-and-open P9 proves is every claim about mechanism* — a turn that does not wait, a recipe that survives its pixels, a digest that matches a place, an empty diff on rewind, a text call that is not made on re-creation — *and no claim about what any of it looks like*, which is exactly the shape §3.1 predicted it would have |
| **P10** | 10 | **2 (in part), 3, 4, 5 (in part), 6 (in part), 7, 8 (in part)** — landed 2026-09-17 | **merged 2026-09-17 at `b572c4c`, and open; the list is unwalked** | **Planned rather than sketched, 2026-09-17** ([P10 §3.1](27-p10-implementation.md)), and it is the sixth gate to split under [§0](#the-two-tier-gate). ***Four criticals and three of them are errands*** — **C1** a completion sound in a backgrounded tab, **C2** *Restart now* and the process coming back ([R11](#3-standing-prerequisites)), **C3** `storyengine.local` from a neighbour ([R5](#3-standing-prerequisites)), **C4** a household member from the URL alone ([R4](#3-standing-prerequisites)). *This is the most blocked rows any list here has carried, and unlike sitting O they are not one errand*: O waits on a thing, P waits on three unrelated ones, so **sitting P is not one sitting**. Steps 1 and 2 are [P6A](19-p6a-alpha-1.md)'s claims wearing P10's numbers — criterion (i) — and are **I**'s. ***What a built P10 proves is who is told what***, which is the half that would be worst to get wrong on a household server: A's turn producing nothing addressed to B, five arrivals folding to one notification that **knows** it is five, an unauthenticated listing held to three fields, a hidden account absent from the grid and still able to sign in. *What is unproven is reaching it* — a sound nobody is watching for, a process that comes back, a name a neighbour resolves, a stranger who gets in. **Three stages were not the shape the plan predicted**: §1.7's update check moved here and turned two `unread` config keys `applied`; §1.5's fork closed as a **deferral** with a roadmap row rather than a build, so the standing line's table reaches **two** rather than one; and the §13 source link turned out to need the *build* to carry its URL, because a constant cannot be right for a fork |
| **P11** | ~~10~~ **13** | **2 (in part), 3, 4 (in part), 5 (in part), 6 (in part), 7 (in part), 9 (in part), 10 (in part), 11 (in part), 13** — landed 2026-09-17 | **merged 2026-09-17 at `b572c4c`, and open; the list is unwalked** | **Planned rather than sketched, 2026-09-17** ([P11 §3.1](28-p11-implementation.md)), the seventh gate to split under [§0](#the-two-tier-gate), and **the only one whose phase has nothing after it** — so clause (ii) is re-read there rather than applied: what this gate compounds into is the **beta declaration** rather than a later phase. ***~~Five~~ Six criticals, two of them desk work***, which is unusual and is a property of a gate mostly asking *did the thing get built*: **R1** the item-by-item read of [§0.1](28-p11-implementation.md)'s list; **R2** a real session read, printed and copied; **R3** the assistant asked about your own library ([R2](#3-standing-prerequisites)); **R4** the 1.0 corpus read capability by capability, which **is** the beta claim; **R5** recording that row 13 is answered, which **unblocks R4**; and — added 2026-09-22 with [P11.2](28-p11-implementation.md)'s hook stage — **R6** a hook written on a carrier and one saved back out of a session, which is the first authoring surface a portable field has had. ***What a built P11 proves is most of its own list*** — the reading view's model, the editor contract over the key set rather than over the editors somebody remembered, *not a second chat* asserted from both sides, the trash and its sweep, the catalogue's per-key fallback, the tarball packed twice and compared, a session exported and imported through a reader sharing no state with the writer. ***What it does not have is named rather than absorbed***: [10 §11.2b]'s image slots, [10 §11.2c]'s entry travel, the assistant's **docs lorebook**, and — the one to argue about — ~~**row 8's Playwright suite, which no stage was asked to build**~~. Three are features with an argument; the fourth was infrastructure the gate assumed. All four are in [§10](#10-deferred-with-an-owner) so that R4's reader meets them as known absences. ***Row 8 built 2026-09-17***, the same day the record named it: the argument was withdrawn rather than won, the suite is [§5](#5-already-discharged-and-by-what)'s **P11 8** row, and **three of the seven journeys turned out to say something other than what they had been read as saying** — which is the case this row had been making all along with nothing anybody could act on. **Three absences stood**, and by the end of the same day two more were built: [10 §11.2c]'s entry travel — selection, export, import, and `VersionSource`'s `import` arm's first writer — and [10 §11.2b]'s image slots, which turned out to be **unreachable rather than unbuilt**, because a lorebook's container is a folder and nothing had ever written into one. **And the last of the four went the same day**: the docs lorebook, twenty-five keyed entries attached by one line, which is what *"needs no new machinery"* turned out to mean. **Nothing stands** — the four named absences are four closed rows, and none of them closed by being argued about |
| **P12** | 5 + ~~5~~ **7** | **most of both halves** — `backup/archive.test.ts`, `backup/schedule.test.ts`, `backup/restore.test.ts`, `storage/tar-archive.test.ts`, `tools/tar-seam.test.ts`, `routes/backups.test.ts`, `settings/ImportBackup.test.tsx`, `settings/AdminBackups.test.tsx`, and `tools/restore.test.ts` repaired | **merged 2026-09-23 at `671950f`, and open; the list is unwalked — sitting S** | **The eighth gate to split under [§0](#the-two-tier-gate)**, and the shortest, because the phase is one feature. ***What no test here can witness is the two things the criterion keeps***: a **server rebuilding its index from an archive** (S1 — a search answering is the only observable proof), and a **supervisor restarting a process** after a self-restore, with the moved-aside directory intact beside the new one (S2). ***The phase found two defects in what [P11.11](28-p11-implementation.md) shipped rather than being blocked by them***: the index exclusion never fired, and long member names were being cut — and **the second table this file's first honesty condition requires is [P12 §3](29-p12-implementation.md), whose rows were not edited**. *The one thing the remainder cannot reach is size*: nothing here has archived a genuinely large library, and whether that is quick enough to be pleasant is a sitting behind a corpus rather than behind a build. ***Built and merged 2026-09-23, all fourteen stages, and the critical list never walked*** — **the seventh phase to be merged and left open**, which is the split [P7](23-p7-implementation.md)'s row first recorded and the rule §7 states. *Two of the five criticals are the ones no test can witness and they are unchanged by the build*; what changed is the remainder, which grew **two rows** for two surfaces the plan did not name: `DELETE /api/admin/restore`, because a failed restore keeps its marker so the next boot can refuse it and a marker nobody can remove is a trap on an install with no shell, and the **manifest read** that stands in for the preview [P12.9](29-p12-implementation.md) was written to build — [P4 §1.4](16-p4-implementation.md) having already settled that a sweep commits and reports. **The gate's own five rows were not edited**, which is this file's first honesty condition and the reason the two additions are in the remainder rather than in the list |
| **P7B** | ~~12~~ **17** | **2, 3, 4, 7, 8, 9, 11, 16, 17** — §5 | **M, pending** | Written to [§0](#the-two-tier-gate) from the start: ~~three~~ **four** critical-list candidates named in [P7B §3](24-p7b-presets-and-prompts.md), the rest to a sitting here on the day it closes. ***Five rows and four stages added 2026-09-14*** by a second sweep reading the code against the design notes rather than the design notes against the phases ([P11 §0.1](28-p11-implementation.md)) — the setup and package editors, the workbench on a turn the head has passed, the import quarantine's listing, and home as a changelog-only prototype. **Its gate row 17 is the one worth naming here**: *nothing in the suite asserts that a shipped route has a caller*, and five of this phase's items were routes green in CI with no caller for up to six phases (§9). *What no critical list in this phase can reach is the class it exists for* — a walk can say these surfaces arrived, never whether an eighteenth is missing. ***Written and green 2026-09-14, and it found an eighteenth, a nineteenth and a twentieth on its first run*** ([P7B §1.12](24-p7b-presets-and-prompts.md)) — which is the answer to the clause before it, arriving from a test rather than from a walk. ~~**The ten stages are all committed; the critical list is walked on the day the phase closes and nothing below records a walk**~~ ***Merged into `main` 2026-09-15 at `e7d6dee`, and open*** — the same split P7's row above records, for the same reason: §7's rule is that a phase closes when its critical list is walked, and P7B's is not. **Sitting M**, four criticals and a judgement sitting: **M1** the pack demo end to end; **M2** the mid-session switch against compare and a rewind; **M3** the hand edit under an open panel; **M4** the workbench saying which turn it is showing; **M5** several turns on a browser-authored pack, judged. Nine rows answered by tests and in §5, three walked-but-not-critical folded into **M6** because they want the same install, and **M7** is the desk work. *Every row of M wants a live endpoint, which no earlier critical list had to admit*. ***Row 7's answer was false until 2026-09-27***: the framing never reached a prompt, and the tests it cited did not look ([P7B §3.2](24-p7b-presets-and-prompts.md)) |
| **P13** | 8 + 10 | **none of the eighteen**, which are all *by hand*. The stages underneath are tested — `import/aventuras/*.test.ts` and the four `routes/import-aventuras*.test.ts` — over a fixture database built from hand-written DDL (`import/fixtures/test-aventuras-db.ts`) | **merged 2026-09-29 at `7565265`, and with Part 2 built at `6f55e6e` on 2026-09-30, and open; both lists are unwalked — sitting X, registered 2026-10-04** | **The eleventh gate to split under [§0](#the-two-tier-gate), and the first in two parts**: [P13 §3.1](30-p13-aventuras-import.md)'s four rows and §3.3's four, which X walks as two halves on one install. The phase derived its own lists. Applying the criterion again here found one thing the document assumed: **the Aventuras install every row wants had no row in [§3](#3-standing-prerequisites), and is R13 now.** X8 also wants a turn Aventuras illustrated, which needs R10's kind of endpoint inside Aventuras: it is blocked rather than deferred, as P9's C1 and C2 are, and the phase's close waits on it. *What the suite cannot reach is the other program*: a live database read beside the app that holds it, a portrait looked at, a story read beside the original. The ten remainder rows are X10–X19. *Registered five days after the merge*, because P13's status said both lists were unwalked and nothing here did |
| **P14** | 5 + 4 | **none of the nine as written**, because every row is a person's judgement or a real folder. Underneath, by stage: `turns/speakers.test.ts`, `turns/smart-speakers.test.ts`, `turns/runner-dispatch.test.ts`, `sessions/swipes.test.ts`, the Scene package's `tracking`, `plot`, `edit` and `echo` tests, `import/chat/build-property.test.ts`, `import/chat-sync.test.ts`, and the `fixture-pair` project's `import/fixture-pair-chats.test.ts` with `import/chat-size.test.ts` ([P14.12](31-p14-scene-and-session-import.md)) | **merged 2026-09-30 at `8878851`, and open; the list is unwalked — sitting Y, registered 2026-10-04** | **The twelfth gate to split under [§0](#the-two-tier-gate).** Five criticals: two plays of Part A's Scene (Y1, Y2), two real imports (Y3, Y4), and the agents judged (Y5). ***Y3 and Y4 are read as walkable without R1*** — recommended answer, owner deferred, 2026-10-04: a folder the walker makes answers the structural claim, provided its group is on a reply order other than SillyTavern's default, though not R1's question. *Two rows carry a judgement*, smart's worth and the agents' worth, and a *no* there is a refinement rather than a `FAIL`. The four remainder rows are Y7–Y10. *Registered with P13's, and as late* |
| **P15** | 3 + 3 | **most of both halves** — `sessions/opening.test.ts`, `sessions/setup-from-turn.test.ts` (the no-hidden-content property), `sessions/summary-chain-property.test.ts` (a golden no-root key), `routes/setup-from-turn.test.ts` (the round trip), `play/SetupFromTurn.test.tsx`, `play/SessionsPage.test.tsx` | **built 2026-09-26 on `claude/nice-davinci-xjdpf6`, ~~not merged~~ *merged through `p15` 2026-10-03, and open*; the list is unwalked — sitting ~~T~~ W** | **The ~~ninth~~ tenth gate to split under [§0](#the-two-tier-gate)**, and one feature like P12. *What the suite cannot reach is prose*: whether a real model's story so far is one a session can continue from (W1), and whether a spoiler reached the person still playing through a model's words rather than a payload (W2). ***The round trip is automated rather than owed*** — emit at a turn, start from the Setup, play a turn — and was run against two mutations before it was trusted. **The gate's three rows were not edited**; the three remainder rows are [P15 §3.2](33-p15-setup-from-a-turn.md)'s. *Written as P13 with sitting T, on a branch that could not see `main`'s P13 and P14 or P12A's T; renamed, re-lettered and counted again at the merge, 2026-10-03 — [P15](33-p15-setup-from-a-turn.md)'s status says how* |
| **P12A** | 9 stages | ~~none yet~~ **P12A.1's face pairing** — `theme.test.ts`'s *the two faces*, from [polish §17](06-polish.md) | **T, registered 2026-09-22; ~~nothing built~~** *P12A.1, and P12A.0's typeface token, were built on `main` on 2026-10-01 at [polish §17](06-polish.md) (`04e45a5`), before the phase opened. What is left of P12A.1 is its measure check ([P12A](34-p12a-the-look.md)). No row of T is about the face, and each wants a stage that is still unbuilt, so T is still unwalkable.* | **The ninth gate to split under [§0](#the-two-tier-gate), and the first registered before its phase opens.** Six rows, five of them a person and one desk work, and **none of them blocked on a prerequisite** — [P12A §1.2](34-p12a-the-look.md) spends a stage decision on keeping it that way. *Why a phase exists here at all*: [10 §1.3](../10-ui-surfaces.md) was written on 2026-09-22 and put commitments into the 1.0 corpus that the build does not meet, and [releases §0](04-repo-and-releases.md) makes beta a completeness gate against that corpus — so **R4 waits on T**, and R1, R2, R3 and R5 do not. *What the list deliberately cannot reach*: whether a generated backdrop reads well, which is [sitting O](#o--p9s-critical-list--two-rows-and-the-first-sitting-that-cannot-start)'s errand and travels with R10 rather than holding this phase open |
| **P16** | 4 stages | none yet — nothing is built | **AA, registered 2026-10-04; nothing built** | **The thirteenth gate to split under [§0](#the-two-tier-gate), and the second registered before its phase opens**, after T and for T's reason: [15](../15-world.md) was rewritten on 2026-10-04 and put membership, contribution and transport into the 1.0 corpus, so **R4 waits on AA as it waits on T**, and R1, R2, R3, R5 and R6 do not. Five rows: the rename on a real install that had Packages (AA1), membership that is not ownership (AA2), contribution that copies with P5.7 still reversed (AA3), a World published and arriving on a second account (AA4), and the release check recorded (AA5). *One errand cannot wait*: AA1 reads a data directory and an archive from before P16.0, so AA0 copies them the day the phase opens or never. ***What the list deliberately cannot reach*** is accrual and the story bible, which this phase does not build ([P16 §4](35-p16-world.md)), and whether anybody wants a World at all, which [15 §8](../15-world.md)'s tests answer through use |

**Two things this table makes plain and no single document did.** Every gate
from P3 onward is unwalked — and until this table existed, each phase document
said so about itself while none said it about the sequence. **Saying it about
the sequence is what produced [§0](#the-two-tier-gate)**: five in a row is not
five oversights, it is a rule that does not work. And **the walks are not
independent**: P3 step
12, P4 step 1, P5 step 6, P6 step 1 and PLAYABLE's four hypotheses all want a
real imported library and a long session played by a person. One arrangement
answers five obligations.

---


## 7. Closing a gate, and closing a phase

**These are two events now, and the file that confuses them loses the model.**

**A phase closes** when its buildable work is done and **its critical list is
walked** — the small tier, derived by §0's criterion, whose results are recorded
in the phase document's own table. The remainder arrives here as sittings the
same day.

**A gate closes** later, when **every one of its steps has a result** — not when
every step passes. `BLOCKED` and `DEFERRED` are results; a blank is not. A
gate may stay open for months after its phase closed, and that is the ordinary
case rather than a failure: P5's eighteen sit in sitting F while P5 itself is
closed.

**What the phase document must say on the day it closes**, and the third is the
one that gets skipped:

1. Its status line says so, with the date, **which steps were the critical list**
   and where the rest went.
2. §6's row changes to the split — walked, deferred, and to which sitting.
3. **Every `CORRECTION` is written back into the document that owns the step.**
   The corrections are worth more than the ticks — that is
   [P2C.4](12-p2c-first-real-run.md)'s claim, made from the one walk this project
   has actually completed.

---

## 8. Where a finding goes

**Evidence to [playable log](21-playable-log.md)**, in that file's record format — build,
endpoint, session, **expected before observed**, snapshot. One log, not two:
the sittings here and [P6B.2](20-p6b-playable.md)'s play are the same evidence
gathered on different days, and splitting them would make the triage read two
files and reconcile them. [P2C log](14-p2c-log.md) is P2C's and is closed to new
entries; **its fourteen findings still need triage rows**, which is an
obligation this file carries at §10 rather than leaving inside a log whose own
rule says it is not a queue.

**Requests to [refinements](22-walkthrough-refinements.md)**, graded rather than
scheduled. What a person saw is a finding; what they asked for is a proposal;
the two go stale at different rates.

**Nothing is fixed because it is written there.** That is the log's own standing
rule and the reason it stays honest: a finding that has to justify a fix before
it can be recorded is a finding that does not get recorded.

**Triage by [P2C §2.5](12-p2c-first-real-run.md)'s five destinations**, decided
in advance because afterwards every finding argues for its own importance:
**stops the phase / fixed inside it / a gate correction / polish / a later phase
or the roadmap.** Nothing is allowed to have no home.

**A pass that produces no written finding produced no finding.** Not a slogan:
[P2C](12-p2c-first-real-run.md) is the phase that proved it, and the reason its
log exists is that the first pass's observations were not reconstructible
afterwards.

---


## 9. Should be a test, and is not yet

**Absorbed from [manual gate §4](11-p2-manual-gate.md), which carried five.** A
should-be-a-test list stranded in a document marked historical is a list nobody
reads, and this is the section that keeps this file from becoming a checklist
that only grows. Their state today:

- **4.1 a recorded transcript tier for the provider adapters** — the machinery
  landed (`*.live.test.ts`, cassettes into `captures/`, promotion by hand), and
  **no cassette has ever been promoted**: there is no
  `packages/server/src/providers/fixtures/`. [P6B §1.6](20-p6b-playable.md)
  captures during play; promoting is what closes this.
- **4.2 nobody fuzzes a hand-written file, and every one of them is
  hand-written** — still open, and it is the one that found six real defects in
  one pass. The sharpest class in the file.
- **4.3 two clients on one session, at the DOM tier** — still open. P6's
  stale-head work made the server half testable and the DOM half is untested.
- **4.4 the suite is load-sensitive** — still open.
- **4.5 the ubuntu leg has never been watched** — still open, and now also
  sitting H.

**What this sweep adds to that list:**

- **The seed script had no test until [P6B.0](20-p6b-playable.md)**, and the
  reason it shipped broken through two phases is that nothing looked at it. Any
  other dev script in `tools/` is in the same position.
- **A request body can be built wrong under a green suite.**
  [P6B.0](20-p6b-playable.md) found `createSession` could send `{name}` alone
  with both page tests passing, because they mock the function. Every other
  client call whose body is assembled from optional fields has the same shape
  and no equivalent test.
- **Nothing tells anybody when `main` goes red, and it had been red for three
  days.** Found 2026-09-09 while watching the alpha 4 tag build: **every CI run
  on `main` since 2026-09-07 had failed**, across five pushes including two
  release cuts, on two tests that only fail on the GitHub Windows runner. The
  cause is [F26] one layer out — the runner's `TMP` holds the **8.3 alias**
  `C:UsersRUNNER~1...` while every path the server resolves comes back long,
  so a test comparing the two passes here and fails there. Fixed at its source
  (`test-server.ts`'s `tempRoot`), and **proved by pointing `TMP` at a directory
  with a real 8.3 alias**, which is the only way this class can be watched to
  fail on a developer machine.

  **The test-shaped half is done; the watching half is not.** A suite that is
  green locally and red in CI is indistinguishable from a green one to anybody
  who does not open the tab, and this file's whole subject is the difference
  between *checked* and *believed*. **Sixty-three other temp roots in the suite
  still call `mkdtemp` directly**; none of them compares a path across the
  server boundary today, and nothing stops the next one doing so.

- **No test can see an empty frame** — added by [P7.12] (2026-09-13).
  [10 §2.3] requires that with the backdrop off *"Play is the surface it was
  before, not a surface with an empty frame in it"*, and `ModeRegion.test.tsx`
  asserts the component renders nothing. **That is not the claim.** The claim is
  about the *page*: a wrapper with padding around nothing, a grid row that still
  reserves its height, a gap where the stage would be. Every one of those passes
  a `textContent === ''` assertion and is visible to a person in a second. **This
  is the by-hand item P7.12 owes**, and it is a should-be-a-test only in the weak
  sense — a layout assertion at this tier would pin a stylesheet, which
  `tailwind-utilities.test.ts` already declines to do.

- **The stager's prompt has never met a model** — added by [P7.12]. Its schema
  is enforced structurally, so a wrong *label* cannot reach a channel; what is
  untested is whether a local model, asked for *a place and not an event*, gives
  a place. That is [work plan P11]'s tuning class rather than a missing
  assertion, and it is recorded here because the cassette tier is where it would
  eventually be caught: nothing in `captures/live-tests/` exercises a `stage`
  call, and nothing will until somebody plays a staged session.

- **Nothing asserts that a shipped route has a caller** — added 2026-09-14 by
  [P11 §0.1](28-p11-implementation.md)'s sweep, and it is the sharpest item this
  section has held since 4.2. **Five routes have had no client caller for up to
  six phases**: session delete, the archive field on a `PATCH` the client already
  sends, `GET /api/search`, `GET /api/library/errors`, and the four library kinds
  with no editor to reach their routes. Every one of them has tests. Every test
  is green. **The suite cannot tell the difference between a route whose caller
  is a client and a route whose only caller is its own test**, and that is not a
  judgement call — it is a mechanical property of the two trees.

  *Why it is a should-be-a-test rather than a finding.* Each of the five was
  found by a person reading documentation, which is the most expensive
  instrument available and the one that had not been pointed at this in six
  phases. A walk of the server's route table against the client's request calls,
  failing on a route with neither a caller nor a written exemption, costs a
  morning and never gets tired. **The exemptions are the interesting half** —
  a route that legitimately has no client caller should have to say so in one
  line, and writing those lines is itself the audit.

  ~~*And the honest risk*, since this section's job is to say what a check cannot
  do: the client's request layer may be too dynamic to walk statically, in which
  case the fallback is a hand-maintained list — worse, but still a list somebody
  has to look at, which is more than exists today.~~ [P7B §3](24-p7b-presets-and-prompts.md)
  carries it as the one gate item that is not a stage, and [P7B §5](24-p7b-presets-and-prompts.md)
  carries the risk.

  ***Built at [P7B.5](24-p7b-presets-and-prompts.md), 2026-09-14 — and the risk
  was real and the fallback was not needed.*** The request layer is dynamic:
  `api.ts` composes six addresses through URL helpers and splits a seventh
  across a `+`. Joining adjacent templates and expanding the helpers **by shape
  rather than by name** reads them, so the list is derived rather than
  maintained, and a helper written later in the same shape is found without
  editing the check. *The route side does not walk text at all* — it reads
  Fastify's own routing tree through `routesUnder()`, which is why the check
  lives in `packages/server` rather than in `tools/`: the first draft
  reconstructed paths by regex, assumed one mount prefix, and reported seventeen
  admin routes as uncalled.

  **What it found on its first honest run is the argument for it**: four routes
  with no caller that a careful manual sweep over the same code, two days
  earlier, had not found — a session's model override, rename and delete of a
  named node, and an administrator resetting a password. That last one was built
  the same day. *What it still cannot do is say whether a capability that never
  became a route is missing, which is why this section keeps the person.*

- **Whether a rendered document reads as a document, nothing sees** — added
  2026-09-15 with the arrival page's revision
  ([polish §5b](06-polish.md)). Home stopped dumping `CHANGELOG.md` into a
  `<pre>` and started rendering it, and **three defects in that change were
  found by opening a browser and by nothing else**:

  - the bold sentence that opens nearly every changelog bullet was **invisible**
    — `text-ink` emphasis on a `text-ink` body, so weight alone carried the whole
    distinction and lost;
  - *Added*, *Fixed* and *Changed* read as stray lines rather than as section
    labels, being the same size and weight as the lede directly beneath them;
  - every release row in the workbench links to `/`, and the router's search
    matching is a **subset** test, so the newest row was marked current
    *alongside* whichever release had actually been chosen — two current rows.

  **Only the third is now pinned**, and it is worth saying why it was the one
  that could be: it is a fact about the DOM (`aria-current` appearing more than
  once), so `workbench/home/subject.test.tsx` and `dock.test.tsx` assert
  *uniqueness* rather than presence, and the fill that makes the mark
  perceivable is asserted as a class. The first two are **not testable as
  written, and this entry does not pretend a check is coming**: every element
  was present, correctly nested, correctly labelled, and carried a real token —
  a passing tree in every respect except the one that mattered. Contrast
  [F16]'s class, which `tailwind-utilities.test.ts` *can* catch because a
  class that emits no rule is a mechanical property. *Legibility is not, and
  this is the section that keeps the person.*

  Two cheap things that would narrow it, neither built: a contrast floor
  between a body token and the emphasis token used inside it — `ui/contrast.test.ts`
  already measures pairs against 4.5:1 and measures none of these — and a
  screenshot of `/` in the standing list, since the whole page is one document
  and a person looking at it is the instrument that found all three.

- **A hand-enumerated fixture over a union is only as total as the hand** —
  added 2026-09-16 at [P9.5](26-p9-implementation.md), which found it rather
  than looked for it. `workbench/address.test.ts` asserts
  `expect(address.label).not.toBe(source.kind)` over an `EVERY_ARM` array — the
  check exists precisely to catch a `BlockSource` arm that shipped with no
  label — and **it missed two**: `summary`, added at
  [P8.1](25-p8-implementation.md), rendered in the workbench's Source column as
  the bare word `summary` for a whole phase with the suite green over it, and
  `schema` had been absent from the fixture since [P7.4]. Both labels and both
  fixture rows landed at P9.5.

  *This is the same class as the seed script and the request body above*: a
  check pointed at a list that does not contain the thing. What would close it
  is **a type-level exhaustiveness check** — `BlockSource` is free-to-move tier
  with no runtime representation to iterate, so the mechanical form is a
  `satisfies`-shaped assertion that fails to compile when an arm has no fixture,
  rather than a longer array. Not built, and named here rather than in a commit
  message because the next arm is when it matters.


---


## 10. Deferred, with an owner

*The point of this section is that everything in it has a name beside it.
Anything that loses its owner comes back to §0's rule.*

| Item | Where it was made | Owner | Why deferred |
|---|---|---|---|
| The permissive corpus | [P4 §0](16-p4-implementation.md), [P5 §1.6](17-p5-implementation.md) | whoever acquires it; blocks P4 step 1 and P5 step 6 | Person-blocked with lead time. Cannot be synthesised. §3, R1 |
| **F22's leftover** — the rebuild/watcher divergence over a refused path | [P2.3](08-p2-implementation.md) | ~~P2.7~~ ~~nobody~~ **closed at P6B.1**, `0e228ec` | See §10.1 — and it was a live divergence, not the bookkeeping the sentence made it sound. |
| ~~P2 gate step 8 / F12 — an editor-page mount rather than a component mount~~ **Closed, found by [P11.0](28-p11-implementation.md) 2026-09-17** | [P2.6](08-p2-implementation.md) | ~~unassigned; "unblocked rather than done"~~ **[P7B](24-p7b-presets-and-prompts.md)**, without knowing it was owed | ~~The harness exists now, so it is a test somebody has to write~~ `packages/client/src/editor/` carries five page-level mounts. *Nobody was careless; the row simply has no direction that runs from **fixed** back to **written down*** |
| ~~A killed *process* names no model call~~ **Closed, found by [P11.0](28-p11-implementation.md) 2026-09-17** | [manual gate §3.6](11-p2-manual-gate.md) | ~~the suite's one `it.todo`, `recovery.test.ts`~~ **done** | `routes/recovery.test.ts` asserts it by name — *and this repository now has **no** `it.todo` at all*, so the row's own pointer had stopped existing, which is a sharper form of the same failure |
| ~~The record cannot say a block is advisory~~ **It can. Corrected 2026-09-10** | [manual gate §3.6](11-p2-manual-gate.md) | **a test somebody has to write** | ~~`assemble()` drops `Candidate.advisory`; `ModelCall` records no purpose. **[P7](23-p7-implementation.md) makes this expressible or it stays unexpressible**~~ **Both halves were repaired at P3.0** and the row was never updated: `assembly/assemble.ts:141` carries the flag onto the assembled block with a comment naming this finding, and `ModelCall.purpose` is `shared/src/turn.ts:364`, written at `turns/calls.ts:301-305`, whose docstring calls it *"the committed half of [testing §1]'s invariant, beside `advisory` on the block"*. The residue is one line rather than a phase: nothing asserts the invariant **over a committed record** — the checks live at `assemble()` and at the pipeline. Found by [P7 §0.1a](23-p7-implementation.md) |
| ~~Two clock-effect constructors disagree; `clockEffect` has no production caller~~ **Closed, found by [P11.0](28-p11-implementation.md) 2026-09-17** | [manual gate §3.6](11-p2-manual-gate.md) | ~~unassigned~~ **[P7.0](23-p7-implementation.md)** | ~~Dead code with a disagreement in it~~ The production export went when the runner started building its own inline; three test-local helpers remain, which is ordinary duplication in tests and not what this row describes |
| A turn carries no money total | [manual gate §3.6](11-p2-manual-gate.md) | [work plan §2](01-work-plan.md)'s day-one list says record cost now, display later | ~~`costOf()` never aggregates. The recording is done; the aggregate is not~~ ***Re-stated 2026-09-17 by [P11.0](28-p11-implementation.md), because the row asked for work that had been done.*** `runner.ts` aggregates across every call and the workbench renders it. What is absent is **money**: `TurnCost` is prompt tokens, completion tokens, wall time and a model id, and **nothing in this repository holds a price for a model**. The row wants *no price source*, which is a different and much larger thing than *no aggregate* |
| `requestId` unbound on job log lines | [manual gate §3.6](11-p2-manual-gate.md) | deferred **with a written reason** — the model | A turn outlives its request; carrying one means a column, a migration and a meaning |
| Nightly tier, dependency-licence scan, forward-port check | [testing §6](03-testing.md), [releases §8](04-repo-and-releases.md) | [P11](28-p11-implementation.md) | Beta-gate work; `testing` landed early at alpha.2 and nightly did not |
| Restore test, upgrade test | [work plan §8](01-work-plan.md), [26 E6](../26-open-questions.md) | [P11](28-p11-implementation.md) | ~~"An untested restore is not a backup" — and it is 1.0 scope~~ ***The restore test is written and green at [P11.11](28-p11-implementation.md)*** (`tools/restore.test.ts`), which is the half E6 calls *"the part that actually matters"*. **The upgrade test stays**, and it is [P11.9](28-p11-implementation.md)'s: it needs two built images, which needs a Docker daemon |
| Release-line support window; release-branch cut point | [releases §8](04-repo-and-releases.md) | [P11](28-p11-implementation.md) | Cheap to declare now, awkward later; no release line exists yet |
| The twelve polish items | [polish](06-polish.md) | unscheduled by design | The file's own house rule: user-facing, bounded, not roadmap |
| **[F-03](21-playable-log.md)** — a turn in flight is invisible unless the workbench is open | the pre-P6 walk, 2026-09-08; triaged 2026-09-09 | **unowned, and named rather than assigned** | [10 §9](../10-ui-surfaces.md) specifies it nearly verbatim — *"a collapsed line while things go well"* — and P3.5 built it inside the panel only. ~~**No phase owns `10 §9`.**~~ ***Too broad, corrected 2026-09-14 by [P11 §0.1](28-p11-implementation.md)'s sweep: [P10.2](27-p10-implementation.md) owns §9's delivery half — sound, toast, unread badge, document title. What nobody owns is the first half, the collapsed in-flight line itself.*** Graded [R7](22-walkthrough-refinements.md), *small*. **Still unowned, and now a [P7B](24-p7b-presets-and-prompts.md) candidate held deliberately** — it is one story with [R4](22-walkthrough-refinements.md) below and [polish §11](06-polish.md), and building a third of it is how the other two thirds get built twice. Giving it a false owner would stop anybody looking |
| **[F-05](21-playable-log.md)** — the workbench cannot be pointed at a turn the head has passed | the pre-P6 walk, 2026-09-08; triaged 2026-09-09 | ~~**unowned; a 1.0 commitment**, and [P11.0](28-p11-implementation.md)'s audit is what exists to find those~~ **[P7B.7](24-p7b-presets-and-prompts.md)** — *the audit ran early, 2026-09-14, and found this already found* | [10 §3](../10-ui-surfaces.md) says the panel shows any turn *current or historical*; it is wired to the head. `useTurn` exists with one caller, so the reader is built and the affordance is not. Graded [R1](22-walkthrough-refinements.md) |
| ~~**[P2C 6](14-p2c-log.md)** — `capabilities` is the only lever for the context window, and it has no surface~~ **Closed 2026-09-10: it had a surface** | P2C.0, 2026-08-23; triaged 2026-09-09; re-checked at [P7 §0.1a](23-p7-implementation.md) | **nobody — it is done** | ~~Sixteen days open because nobody had a reason to open the file.~~ **Seventeen days open because three documents grepped for `contextWindow`, an identifier that appears nowhere in this repository.** The field is `maxContextTokens`, and `client/src/settings/AdminConnections.tsx:225-236` has offered it — with `docs/api.md:1583-1592` saying so — for longer than the finding stood. [Work plan §2.3](01-work-plan.md)'s line is **paid** for connections. *The lesson is the row rather than the fix: a deferral is checked once, by whoever routes it, and then travels on its label* |
| **[P2C 11](14-p2c-log.md)** — an in-flight turn is broadcast as `failed` | P2C.0, 2026-08-23; triaged 2026-09-09 | **[P7](23-p7-implementation.md)** | The disk half is the recovery contract and stays. The wire half is a contract question nobody has answered: a client reading `turn.status` on a running turn is told `failed` |
| **[R4](22-walkthrough-refinements.md)** — where the reader's view sits while a turn streams | the walk's grading, 2026-09-08; **regraded 2026-09-09** | **unowned, and it needs a paragraph in [10](../10-ui-surfaces.md) before it can have one** | The refutation that downgraded it cited `[07 §]` — no section, and `07-branching.md` says nothing of the kind. **The largest genuine blank in the corpus**, restored to that status |
| **P7 4's reading half** — *does the selector's line explain anything to a person* | [P7 §3.1](23-p7-implementation.md), 2026-09-13 | **[work plan P11](01-work-plan.md)**, which owns selector legibility as tuning | The record half is `AUTO` and in §5 — four situations, four distinguishable lines. Whether any of them *reads* is a judgement about wording, and clause (ii) has nothing to say about it: it is as answerable in November. **Tuning is P11's for every other feature and is P11's here.** |
| ~~**[10 §11.2b]'s image slots**~~ — upload, crop and replace, on a book and on each entry | [P11.2](28-p11-implementation.md), 2026-09-17 | **closed 2026-09-17 — built** | [10 §11] lists *"every image slot can be generated, uploaded, cropped and replaced"* as the second of its two capabilities and [§11.2b] is the lorebook half. Its own text removes the **generated** arm from P11 — *"generating a location image is a rendition… so it arrives with them and not before"*, which [P9](26-p9-implementation.md) has now shipped — leaving upload, crop and replace. ***Built the same day it was written down***, and it turned out to be **unreachable rather than unbuilt**: `EmbeddedMedia` names bytes *a container* carries, a lorebook's container is a folder, and nothing had ever written into one — so every read of a book's picture ended at *"that object is not in a container that carries media"*, and `assetsRoot` had sat in `layout.ts` since P1 unused. **That is the row this table most justifies**: a false owner would have stopped anybody looking, and what looking found was not the stage of work the row predicted. **Kept rather than deleted**, for the reason the two rows above it are |
| ~~**[10 §11.2c]'s entry travel**~~ — selecting entries, exporting them as a lorebook, importing into an open book | [P11.2](28-p11-implementation.md), 2026-09-17 | **closed 2026-09-17 — built** | **The reordering half already existed** — a drag with a landing line, a keyboard pair, a self-scrolling list — so what was missing was *selection* and the two file actions over it. §11.2c is emphatic that the unit is the point: *"people do exactly that, which is evidence about the unit rather than about the people."* ***Built the same day it was written down***: an entry export **is a lorebook**, so nothing new was versioned and the way in is the way in for any book; a selection brings the folders above it and not the rest; and a merge **adds and never overwrites**, because a shared id is shared ancestry rather than permission. It also gave `VersionSource`'s `import` arm its first writer since P1. **Kept rather than deleted**, for the reason the row above it is |
| ~~**The assistant's docs lorebook**~~ — the corpus, not the machinery | [P11.3](28-p11-implementation.md), 2026-09-17 | **closed 2026-09-17 — written** | [06 §7.4] says *"docs retrieval needs no new machinery. Ship the documentation as a built-in lorebook and attach it to the assistant."* **The machinery was built**: the pack positions a `lore` slot and the retriever runs. What was missing was a corpus, and shipping an empty book to close the row would have been the placeholder shape P11 refused at every stage. ***Written the same day***: twenty-five keyed entries in eleven folders, shipped beside the assistant card and attached by **one line** of the session's own `lore` links — *"needs no new machinery"* was exactly true. What it cost was writing twenty-five answers, which is work no plan shortens. `docs-lorebook.test.ts` keeps the corpus honest and found a real defect on its first run: *restore* was claimed by both the trash entry and the backup entry, so both fired on one question and the budgeter dropped one by a priority nobody set. **Kept rather than deleted**, for the reason the three rows above it are |
| ~~**The Playwright journeys**~~ — [P11 §3](28-p11-implementation.md)'s row 8 | [P11 §3.2](28-p11-implementation.md), 2026-09-17 | **closed 2026-09-17 — built** | *"The Playwright journeys pass against the fake provider, on CI, on every merge."* ~~**There is no suite, no harness, and no stage was asked for one.**~~ Three of the four rows above it are features with an argument beside them; this was **infrastructure the gate assumed**, and ~~whether beta can be declared without it~~ was going to be [sitting R](#r--p11s-critical-list--two-sittings-and-an-afternoon-the-one-that-closes-the-beta-gate)'s R4 reader's call. ***It was built instead***, the same day this row was written: `e2e/`, one test, `ci.yml`'s `journeys` job, [§5](#5-already-discharged-and-by-what)'s **P11 8**. **Kept here rather than deleted**, because a deferral that vanishes on being collected leaves no evidence that this table is what collected it — and [§10.1](#101-the-dangling-owner-which-is-the-finding-this-sweep-exists-to-have-produced) is a whole section about what happens to deferrals nobody reads |
| **P7 6's judgement half** — *is the goal judge accurate, at the moment that matters most* | [P7 §3.1](23-p7-implementation.md), 2026-09-13 | **[work plan P11](01-work-plan.md)**, same sweep | The mechanics are `AUTO` and in §5, confirmation gate included. Accuracy wants real sessions rather than a scripted provider, and **a judgement at the most dramatically loaded moment of a story is exactly what a walker cannot manufacture** — which makes it G's kind of evidence, arriving through play rather than through a check. |
| **The import quarantine has no surface** | same sweep; [manual gate §3.5](11-p2-manual-gate.md) said *"No client code calls it"* at P2 | **[P7B.8](24-p7b-presets-and-prompts.md)** | `GET /api/library/errors` is the only way to see what an import quarantined. A quarantine nobody can look into is a deletion with extra steps, and it has been that way for six phases |
| **What sitting K cannot reach** — hypothesis 3 under a real library's pressure, hypothesis 4 under a long session, and any defect of *accumulation* | [K](#k--p6bs-critical-list--two-sittings-and-an-hour-of-desk-work-the-one-that-closes-a-phase), on the day it was derived | **[G](#g--the-long-pass--hours-unscripted-playables-second-sitting) and J**, which is a named sitting rather than a person — and R1 and R9 are what they wait on | **This row exists because the two-tier gate owes it.** A critical list closes a phase on the part that compounds; the part it drops has to land somewhere with a name, or the model is just a smaller gate with the same silence. Every K item is one turn long and leaves nothing behind, so nothing in it can see a leak at turn forty |
| **A preset editor**, and the built-in pack no editor could open | [P2 §5](08-p2-implementation.md) and `modes/scene/preset.ts` (*"not editable in the app until P7"*); [P3 §5](15-p3-implementation.md); [P4 §1.9](16-p4-implementation.md); [P5 §3](17-p5-implementation.md); [P6B §4](20-p6b-playable.md) | **[P7B](24-p7b-presets-and-prompts.md)**, P7B.0 and P7B.1 | Four documents sent it to P7 and **no P7 stage carries it** — [P7 §1.10](23-p7-implementation.md) keeps only *browsing, previewing, switching*. The Scene pack is a code constant with no library address, so even an editor could not open it, and the narrator sentence has been unchangeable since P2. P5's `outlet` defect retires with it. Found by the 2026-09-11 surface sweep |
| **A session-settings surface** — the pack, its parameters, the session's own copy, and archive and delete | [P6B §4](20-p6b-playable.md) (*"P7.2 owns them"*); [refinements §4](22-walkthrough-refinements.md)'s R9 | **[P7B](24-p7b-presets-and-prompts.md)**, P7B.2, over whatever P7.3 built | P7.2's text is the cast panel. P7.3 carries voice, dispatch and the role overrides on branch `p7`, and nothing carries the pack or `params`: C3 still says *no UI for this*, D11 still hand-edits a priority on disk, and archive and delete have routes and no control. ***Sharpened 2026-09-14***: the archive half is one field on a `PATCH` the client **already sends** — `SessionsPage` has called `renameSession` against that route since P2, and the same handler has accepted `{ archived }` the whole time |
| **A treatment editor** | [P6B §5](20-p6b-playable.md) (*"that is P7's and P11's"*); P7's 2026-09-10 re-audit (*"a hook has nowhere to be authored"*) | **[P7B](24-p7b-presets-and-prompts.md)**, P7B.3 | Neither phase's stage list names it. The framing is injected every turn, so it is the other half of every prompt; P7.5 proceeds on hand-edited JSON, as its own audit chose, and the editor lands the phase after |
| **Edit a block and re-run** ([10 §3](../10-ui-surfaces.md)) | [P3 §1.8](15-p3-implementation.md), which sent it to P6 | **[P7B](24-p7b-presets-and-prompts.md)**, P7B.4, through the pack | [P6 §1.8](18-p6-implementation.md) answered *which reply an edit changes* and nothing else, and P3's diagnosis — no block-override hook, no record field — still stands. Answered without a record field: edit the session's own copy, reroll |
| **A package editor**, the last library kind with none | [10 §5](../10-ui-surfaces.md)'s create rule | ~~**[P11.2](28-p11-implementation.md)**~~ **[P7B.6](24-p7b-presets-and-prompts.md)**, 2026-09-14 | *Across every editor* cannot apply to an editor that does not exist, and [P11 §1](28-p11-implementation.md) already says the clause's size depends on how many editors arrive first. ***And the argument in this cell is why it moved***: if *across every editor* cannot apply to an editor that does not exist, that is a reason to build it **before** the sweep rather than inside it. *The honest limit travels with it* — `.sepack` import and export is not in P7B, so the editor lands able to make and describe a bundle and not to send one |
| **Home** ([10 §2.2](../10-ui-surfaces.md)) | [polish §5](06-polish.md) holds the build detail | ~~**[P10.4](27-p10-implementation.md)**, beside the gallery~~ **Deferred, and a prototype at [P7B.9](24-p7b-presets-and-prompts.md)** — 2026-09-14 | Polish is unscheduled by design and `/` still redirects to the library. Both screens are arrival — one before sign-in, one after — and one stage owning both keeps them from disagreeing about what arrival is for. ***Reversed by direction***: the full [10 §2.2](../10-ui-surfaces.md) home is not core-alpha work — nominally a 1.0 feature, expected immediately before the cut-over to feature-complete beta, and possibly further out. What lands at P7B.9 is `/` ceasing to be a redirect and showing the changelog, nothing else. **The placement above was right about the defect and wrong about the size**: this row's own point stands, that polish is unscheduled by design, and the repair is a destination plus a condition rather than a phase number |
| **The search surface** ([10 §14](../10-ui-surfaces.md)) | the route landed at P2 naming the UI as P3's; [P5.2](17-p5-implementation.md) said *"the surface for all three is §14.5's"* | ~~**[P11.1](28-p11-implementation.md)**, with the reading view~~ **Built 2026-09-17 at [P11.1](28-p11-implementation.md)** | Argued for 1.0 in the design, built server-side, and no phase builds a client: nothing in `packages/client` calls `GET /api/search`. A hit lands on the reading view's addressable node, which is why they are one stage |
| ***Used by* backlinks** ([10 §5.2](../10-ui-surfaces.md)) and the delete confirmation's reference counts ([03 §10.1](../03-data-model.md)) | [P3 §5](15-p3-implementation.md); [P4 §6.6](16-p4-implementation.md) | ~~**[P11.7](28-p11-implementation.md)**~~ **Built 2026-09-17 at [P11.7](28-p11-implementation.md)** | P4: *"whichever phase builds that panel pays both"*, and none did. The link table serves the counts, the panel and *played alongside*; trash and restore is the stage already opening delete |
| **Print, and copy as Markdown**, for a lorebook ([10 §5.3](../10-ui-surfaces.md)) | specified, never routed | ~~**[P11.1](28-p11-implementation.md)**~~ **Built 2026-09-17 at [P11.1](28-p11-implementation.md)** | The same two formats and the same print stylesheet the reading view ships; a second implementation would disagree with the first |
| **The per-kind library panels** for the four kinds still on the generic shelf ([10 §5.1](../10-ui-surfaces.md)) | [polish §4](06-polish.md) | **Treatments and Presets: [P7B](24-p7b-presets-and-prompts.md)**; Setups and Packages stay with polish §4 until their editors have a phase | Create arrives with the kind's editor and the panel is what renders it, so the two kinds gaining editors gain panels in the same stage; polish keeps the shared machinery specified. ***Updated 2026-09-14***: Setups and Packages get their editors at [P7B.6](24-p7b-presets-and-prompts.md), so their panels follow into the same phase rather than waiting on one |
| **Personal connections and bindings** ([10 §15.1](../10-ui-surfaces.md)'s *your connections*) | [P2B §2.7](10-p2b-provider-configuration.md) (*"the phase after, or at P10"*); [P6B §5](20-p6b-playable.md) (*"that is P10's"*) | **[P10.3](27-p10-implementation.md)** | P10's stage list never carried it. The enforcement half landed at P2A and the fallback display at P2B; what is left is the writer for the per-user file and the second column of the role table. The role-binding editor itself is P7.3's on branch `p7` |
| ~~**A personal connection shadowing a system one is not on screen**~~ **Closed 2026-10-04 — built, as [polish §26](06-polish.md)** | the [P2B §1.5](10-p2b-provider-configuration.md) correction note, 2026-10-03, at the `claude/loving-bardeen-ey9bhv` merge | ~~**unowned, and named rather than assigned** — [F-03](21-playable-log.md)'s pattern~~ **[polish §26](06-polish.md)**, on the recommended answer, owner deferred: show it | *Your connections* reads `shadowed: false` for the file that wins — true of the row, silent about the system connection it hides — and the only report is the runner's `connections.shadowing` log line, a count. The phase that built *Your connections* is [P10.3](27-p10-implementation.md), and P10 is merged and open; adding scope to it is the owner's call rather than this row's. ~~**Deferred rather than polish** because showing it needs a new field on `/api/me/connections` or `/api/me/roles` and the `docs/api.md` text to match — a new contract, which [polish](06-polish.md)'s house rule excludes~~ ***2026-10-04: filed as polish after all, on [polish §25](06-polish.md)'s reading of the house rule*** — merged the same day as this row, it took *no new contract* to mean nothing [22](../22-internal-contracts.md) specifies, and two optional fields on existing responses are that; §26 says so and can be overruled. Both rows now say it (`shadows` on `/api/me/connections`, `shadowedBy` on `/api/me/roles`), and the person-visible check is [sitting Z](#z--a-connection-that-hides-another--ten-minutes-a-text-editor-and-a-second-account). **Kept rather than deleted**, for the reason the closed rows above it are |

### 10.1 The dangling owner, which is the finding this sweep exists to have produced

**F22's leftover is owned by `P2.7`, and P2 has stages P2.0 through P2.6.**

The sentence that assigned it says exactly why it was assigned:

> *"**Still open, and now owned by P2.7** — P2.6 opened the same code and did not
> take it, so leaving it pointed at a closed stage is how it becomes nobody's."*

It was moved off a closed stage and onto a stage that was never created, so it
became nobody's by the other route. That is [work plan §0.5](01-work-plan.md)'s *a bar
nobody owns is a wish* in miniature, and it is the exact failure
[P7 §0](23-p7-implementation.md) says a skeleton exists to prevent — **a
deferral nobody collects is a deferral that gets lost.**

**It needs an owner before this file is worth anything**, and the honest
candidates are two: fold it into [P6B.1](20-p6b-playable.md), which is already
opening the index and storage code for the `orphan-fts` assertion and the
migration test; or write it into [P11](28-p11-implementation.md)'s audit as a
known defect with a test to write. **The recommendation is P6B.1**, because the
work is in the same file and the alternative is a fifth year of the same
sentence.

**Taken, and closed 2026-09-07 at `0e228ec` — and it was not the small thing
the sentence made it sound.** Opening the code found a *live divergence* rather
than an unreconciled asymmetry: a rebuild refused a folder whose name this build
will not resolve and counted a silent skip, while the watcher never applied the
rule at all and **indexed a row pointing at a file no read in this build can
open** — every read goes back through the same builder, which throws. Indexing
it was worse than not indexing it.

**Neither the P1 gate nor any unit test could have caught it, and the two
reasons are why it lasted six phases.** The gate compares what got indexed, and
the disagreement was about something that did not: it lived in a table the
comparison never read. And the folder names in question cannot be created on the
machine this repository is developed on, so a test that made one would be a test
that never ran here — the seam is the layout instead, which refuses one ordinary
slug on demand.

Both producers now ask the same function, the refusal is recorded rather than
counted, a rebuild clears that table like every other stale belief it must not
preserve, and the snapshot reads it — **an absence has to be in the comparison
or it is not compared.**

*The general lesson, since this section exists to have produced one:* the
sentence was six phases old and read like bookkeeping. It was a defect. **A
deferral nobody collects is not merely lost; it stops being read, and what it
says stops being checked.**

---

**A second instance, and this one costs two rows of a gate** — added 2026-09-16
by [P11 §0.2](28-p11-implementation.md)'s re-audit, which registers it as its
row 20.

[P8](25-p8-implementation.md) shipped on its own named fallback cut with the
**automatic extractor deferred**. The cut was made well: §5 named it in advance
*"so that cutting under pressure cuts the right thing"*, the reason is written
out, and the phase document says *"when the extractor arrives"*. **It names no
arrival.** `grep -c extractor` over [P10](27-p10-implementation.md) and
[P11](28-p11-implementation.md) returns zero for both, and they are the only
later phases.

***What makes it this section's business rather than the work plan's*** is §6's
own P8 row: C2 (*a hand correction survives the next extraction*) is **vacuous**
under the cut and C3's extraction half *"has no extractor to bleed"*, and that
row records that **both travel with the stage**. So while the extractor has no
owner, **two of P8's three criticals cannot be walked by anybody** — not blocked
on a resource the way [sitting O](#o--p9s-critical-list--two-rows-and-the-first-sitting-that-cannot-start)
is, but blocked on a schedule that does not exist. [Sitting N](#n--p8s-critical-list--one-row-and-the-shortest-a-phase-has-ever-closed-on)
is one row because of it.

*The difference from F22 is the direction, and it is worth one line.* F22 was
moved **onto a stage that was never created**. This was moved **off every stage
and onto no document at all** — which is harder to see, because there is no
dangling pointer to find. What found it was reading a shipped phase's own cut
against the two phases that come after it, which is the pass
[P11 §0.2](28-p11-implementation.md) exists to be.

***Closed 2026-09-17: the extractor is [P11.12](28-p11-implementation.md), and
it is built.*** [P11 §0.4](28-p11-implementation.md) took it rather than carrying
it a third time, on the ground this row states — **two of P8's three criticals
cannot be walked by anybody while nothing extracts**, so leaving it unowned did
not defer a feature, it left a closed phase's gate permanently unfinishable.
[Sitting N](#n--p8s-critical-list--one-row-and-the-shortest-a-phase-has-ever-closed-on)
**stops being one row**: C2 (*a hand correction survives the next extraction*)
and C3's extraction half are walkable as of that stage, and both travel with it
rather than with P8, which is what §6's P8 row already said they would do.

---

**A third instance, and the first one a machine will now catch** — added
2026-09-17 by [P11 §0.4](28-p11-implementation.md).

Four rows of §10's own table above described defects that had been **fixed**, by
phases that did not know they were paying them, and said so nowhere. An editor
page mount that P7B built, a killed-process assertion `recovery.test.ts` carries
by name, a `clockEffect` export P7.0 deleted, and an aggregate `runner.ts`
computes. *Two of them pointed at things that had stopped existing* — the
suite's *one `it.todo`* when the suite now has none.

***So the register has a direction and is missing its inverse.*** A row is
written when a defect is found, and re-read when somebody goes looking for work.
**Nothing re-reads it when the defect is fixed**, and nothing watches a
deferral's stated blocker to say when it clears — which is how
[P11 §0.3](28-p11-implementation.md)'s row 21 arrived, by the gallery being
built. Two findings from opposite directions make that a property of this file
rather than an accident.

*What was buildable of the answer is built*:
[`tools/citation-targets.test.ts`](../../../tools/citation-targets.test.ts) holds
every stage and section citation in the repository to a target that exists, which
is the part of *a row that stopped being true* that a machine can see. **What it
cannot see is a row whose prose is stale**, and no instrument proposed so far
could. That is the honest limit and it is why this section keeps being added to.

---

## 11. What this file replaced

**The pre-P6 walk sheet is merged into this file and gone.** It was
`27-pre-p6-walk.md`, and it existed for eight days. Its condensing method survives as §4's shape and is worth restating,
because it is the technique for turning any newly-closed gate into sittings:
**merge the duplicates across gates, give the scattered obligations a sitting of
their own, and pre-fill anything that already has an answer.** The list does not
get shorter than the gates; it gets *sequenced*, and that is the transformation
worth doing.

Three documents are now historical and are marked so in place. [manual gate](11-p2-manual-gate.md)
is the P2-era record: its §2 is walked through sittings A–D and H, its §4 is
absorbed above, and it stays a cited source because thirty of §4's rows cite it
for the reasoning behind a step. [P2C log](14-p2c-log.md) is closed to new entries.
[P2C brief](13-p2c-brief.md) is historical as a brief and **permanently live as the
runbook** — §2.2–§2.4 is the only one in the corpus.
