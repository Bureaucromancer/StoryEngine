# 30 — P12A implementation plan: the look, and the sentence it has to put back

**Status: skeleton, written 2026-09-22**, the day
[10 §1.3](../10-ui-surfaces.md) was written. Nothing is built. Format follows
[P1](07-p1-implementation.md); citations follow the corpus convention.

**P12A delivers [10 §1.3](../10-ui-surfaces.md)'s direction**: the story
surfaces stop being *quiet* in the sense of unfinished. Concretely — an
appearance layer that can express elevation, motion and a reading face at all;
characters with faces wherever the engine says who someone is; the backdrop
behaving like the backdrop [10 §2.3](../10-ui-surfaces.md) specifies rather than
like a picture in the column; a play surface whose tools have stopped stacking
above the prose; section jumps and an identity header in the editors; and the
phone rules, which are two sentences and have never been enforced.

**The phase is filed after [P12](29-p12-implementation.md) and before beta is
said**, which is an unusual place to put a phase and is the whole argument of
§0.1. Its number is also its execution position, so nothing renumbers and
`PLAN_ORDER` in [`tools/renumber-docs.mjs`](../../../tools/renumber-docs.mjs)
gained two lines at the end — this one, and P12's, which it did not have.

***Renamed 2026-09-23, from P11A at 29.*** It was written on a branch cut before
[P12](29-p12-implementation.md) existed, as *the phase after P11*; P12 merged to
`main` the next day, backups, at 29 and with sitting S, so on the merge this
document moved to 30, its sitting became **T**, and its name became the one the
lettering rule gives a phase that runs after P12 — P6A and P6B after P6, P7B
after P7. **Nothing about the argument moved**: P12 is merged and open on its own
critical list, and it neither meets nor removes any commitment
[10 §1.3](../10-ui-surfaces.md) made.

---

## 0. What this document is, and what writing it cost

### 0.1 Writing the design note moved the beta gate, and this phase is what puts it back

**Beta is a completeness gate** ([releases §0](04-repo-and-releases.md)):
*feature complete to the 1.0 spec*, and the spec is these documents. [P11](28-p11-implementation.md)
merged on 2026-09-17 and its gate is [sitting R](05-manual-testing.md), whose
**R4** is a person reading the 1.0 design corpus capability by capability and
saying whether each exists.

So writing [10 §1.3](../10-ui-surfaces.md) had a mechanical consequence, and it
is better stated here than discovered by R4's reader: **the corpus R4 reads now
contains commitments the build does not meet.** There were two honest ways out —
write the direction as a roadmap item and read the old corpus, or write it as
1.0 and build it — and the second was chosen because the first produces a beta
whose *look* is explicitly the thing deferred, on a product whose story surfaces
are where people spend their evenings.

**What that buys and what it costs, plainly.** It buys a beta that can be shown
to somebody. It costs the calendar between now and R4, and it means **R4 must
not be walked until P12A lands** — the one scheduling claim this document makes
about another phase's gate. **R1, R2, R3 and R5 are unaffected** and should be
walked now; only R4 reads the corpus as a whole, and only R4 waits.

**[10 §1.3](../10-ui-surfaces.md) split its own list to keep this bounded**, and
the split is load-bearing rather than decorative: the seven items it marks *1.0,
owned by P12A* are the stages below, the two it marks *not 1.0* are on
[24](../24-roadmap.md)'s feature list, and **arrival is neither** —
[polish §5](06-polish.md) already carries the full home page as nominally 1.0
and expected immediately before this same cut-over, so the direction says how it
should look and asks no phase to build it. **Nothing in the direction is unowned**,
which is the defect [P11 §0.1](28-p11-implementation.md) had to register
nineteen of and the reason that register exists.

### 0.2 What the client is today — audited 2026-09-22

Read before costing anything below. Five facts, each one a reason a stage is
cheaper or dearer than it looks:

1. **The appearance layer cannot express most of what the direction asks for.**
   `index.css` defines two radii and both are `var(--radius-md)`; there are **no
   shadow tokens, no motion tokens, no typeface tokens and no spacing scale**.
   The only shadow in the client is a raw `shadow-lg` in `editor/FieldAssist.tsx`.
   [polish §6](06-polish.md) built the layer and deliberately stopped at colour,
   radius and type step — which was right then and is the bill now.
2. **There is effectively no motion.** One opacity transition, in
   `ui/classes.ts`'s `reveal`, and **zero occurrences of
   `prefers-reduced-motion` anywhere in the client**. Motion is not a change to
   existing motion; it is a subsystem with an accessibility obligation attached.
3. **A turn has no face, and cannot simply grow one** — see §1.1. `TurnView`
   renders the player's input and the model's prose as two paragraphs
   distinguished by ink colour alone. There is no name, no avatar, no timestamp
   and no bubble.
4. **The backdrop is built on the server and is not a backdrop on the client.**
   `renditions/backdrop.ts`, `selectBackdrop` and the reuse key all exist and
   work; `play/ModeRegion.tsx` renders the image as an ordinary inline `<img>`
   in normal flow, above the transcript. Every one of
   [10 §2.3](../10-ui-surfaces.md)'s four bullets is therefore unimplemented,
   and the document and the code disagree without either being wrong about
   itself.
5. **The play column has grown seven disclosures above the prose**, and the code
   says so before this document does: `PlayPage.tsx` calls `SessionPanel` *"the
   seventh disclosure in this column, which `SessionPanel` says is a debt rather
   than a design."* [10 §1.1](../10-ui-surfaces.md)'s *where the two meet,
   tooling gives way* is the rule it broke, one panel at a time, each with a good
   reason.

**And two facts about the cost of changing any of it**, which set the shape of
every stage: `tailwind-utilities.test.ts` asserts that every class string in the
client appears in the built stylesheet, **so a UI pass needs a build before the
suite**; and `theme.test.ts`, `contrast.test.ts` and `eslint.rules.js` between
them mean a new colour needs a light value aliasing a scale, two byte-identical
dark blocks, and a contrast entry. **That is the appearance layer working**, not
friction to route around.

### 0.3 What this phase is not

- **Not a rewrite of the tooling surfaces.** [10 §1.3](../10-ui-surfaces.md)
  settles this: the left-hand column of [10 §1.1](../10-ui-surfaces.md)'s table
  is untouched, and the library still shows the model
  ([10 §2.1](../10-ui-surfaces.md)).
- **Not a theme, and not a second theme.** Light and dark are the two designed
  defaults ([10 §1.2](../10-ui-surfaces.md)); nothing here adds a third or a
  config file ([25 E10](../25-open-questions.md)).
- **Not the reading view's rebuild.** [10 §12](../10-ui-surfaces.md) shipped at
  P11 and is on the right side of this direction already. It gains the story
  face at P12A.1 and nothing else.
- **Not a mobile-first pass.** [10 §1](../10-ui-surfaces.md)'s 1.0 bar —
  responsive and genuinely usable — is unchanged. P12A.7 enforces two rules that
  were already written, which is a different thing from designing a phone layout.

---

## 1. Decisions this plan has to make

### 1.1 What "characters have faces" can mean, when the transcript is prose

**Marinara's portrait rail assumes one speaker per message.** Its roleplay
surface renders a bubble per message with a portrait panel beside it, and that
works because a message has an author. **Ours does not.** A Scene turn's output
is prose that may contain three people talking, and the record says so honestly:
what it carries is `ActorSpanTarget` spans over the text
(`packages/shared/src/turn.ts`) — [10 §13.1](../10-ui-surfaces.md)'s mentions,
of which only the certain arm ships — plus `input.actorId` for who the player
spoke as.

**So the sensibility is adopted and the mechanism is rejected**, which is
[10 §1.3](../10-ui-surfaces.md)'s rule working in the one place it is hardest.
A face may be drawn where the engine has actually made a claim about identity,
and nowhere else:

- **The cast panel** ([10 §13.2](../10-ui-surfaces.md)) — every row, since every
  row is a claim that this person is in this scene. `CastRow` carries `actorId`
  and the avatar URL is derivable from it (`api.avatarUrl`), so this is
  presentation rather than a route.
- **The player's own line**, where `input.actorId` says who they spoke as — the
  one place in the transcript with a real author, and the place impersonation
  becomes visible instead of invisible.
- **A resolved mention**, in its affordance rather than inline. A face beside
  every occurrence of a name would be exactly the decoration
  [10 §1.1](../10-ui-surfaces.md) forbids on a story surface; a face in what the
  mention opens is the claim, shown where it can be corrected.
- **The editors, the library and the object header**, which is the crossing
  item [10 §1.3](../10-ui-surfaces.md) marks deliberately: identity is not
  atmosphere.

**No avatar per model paragraph, at 1.0 or later**, unless a mode's record grows
a per-utterance author — and if one ever does, this is the paragraph that says
what would have to be true first.

### 1.2 The backdrop, and making its gate walkable without an image endpoint

§0.2's fourth fact is the work: the client renders the backdrop in flow.
Implementing [10 §2.3](../10-ui-surfaces.md) is four things — behind the reading
column, a scrim that guarantees the prose's contrast rather than hoping for it,
a crossfade on change, and **off as a first-class configuration with no
placeholder frame** ([06 §7.2](../06-modes-and-turn-pipeline.md) requires
text-only Scene to be first-class).

**The prerequisite problem, and the decision it forces.**
[manual testing §3](05-manual-testing.md)'s **R10** — an endpoint serving the
`image` role — is *not to hand*, and it already blocks
[sitting O](05-manual-testing.md) and the whole of [P9](26-p9-implementation.md)'s
gate. A P12A critical row reading *is the prose legible over a generated
backdrop* would be blocked on the same errand, and
[manual testing §0](05-manual-testing.md)'s clause (iii) is explicit that a
blocked check is a deferral rather than a check.

**So the stage delivers the path that unblocks it**: a backdrop may be
**chosen** — an uploaded image, or one already in the library — and not only
generated. That is not a workaround bolted on for the gate;
[10 §2.3](../10-ui-surfaces.md) says *generated or uploaded* in its first
sentence, and the worst case for legibility is a bright image the user picked,
not one the model made. **The check becomes walkable today, against a
deliberately hostile image, which is the better test.**

### 1.3 Where the seven disclosures go

**The panels are not the problem; the column is.** Each of `ChannelHealth`,
`ChannelHud`, `CastPanel`, `LorePanel`, `SessionPanel`, `GoalPanel`, `HookPanel`
and `DialPanel` earned its place, and none of them is a candidate for deletion.
What they have in common is that they are *tooling on a story surface*, which
[10 §1.1](../10-ui-surfaces.md) already rules on: **where the two meet, tooling
gives way.**

**The proposal, and it is a proposal rather than a settled thing:** the ones
that are facts about *the story right now* — the cast, the channel state and its
health, the goal — become the **HUD strip** of §1.4, above the prose, one line
deep, each widget opening in place. The ones that are facts about *how this
session is configured* — the pack and its parameters, the lore selection, the
dials, the hooks — move to the **workbench** ([10 §3](../10-ui-surfaces.md)),
which is the inspector that already opens over any surface and already has a
session subject. **Nothing is deleted and nothing becomes harder to reach than
one keystroke**, which is the test this decision has to pass.

**The risk is real and is named here so the gate can ask about it**: the
workbench is a panel someone has to open, and moving a control into it is the
*progressive disclosure as a reflex* [10 §1.1](../10-ui-surfaces.md) rejects.
The defence is that Play is a story surface and the rejection is written for the
tooling ones — but that defence is an argument, not a measurement, and **T3 is
where a person answers it.**

### 1.4 The HUD has to be able to write, or it is a read-only strip

[10 §1.3](../10-ui-surfaces.md) takes Marinara's editable HUD because it is
[00 §3.6](../00-stance.md)'s *shown and correctable* in the right form. Today's
`ChannelHud` shows. **Whether it can write is the first thing P12A.4 checks**,
and the answer decides the stage's size: if the channel-correction route from
[P7](23-p7-implementation.md) is complete, the stage is presentation; if it is
not, the stage grows a route and a record entry, because a correction is a state
effect and has to reach the record like any other
([00 §1](../00-stance.md)). **An uneditable HUD is not a smaller version of this
stage — it is the stage not done**, and the phase should not pretend otherwise
by shipping widgets that only read.

### 1.5 A reading face: system stack first, self-hosted only if it is not enough

`--text-story` exists; no `font-family` is declared anywhere in the client, so
the story is set in the same system sans as the tooling. The direction asks for
a face of its own.

**Three options and one of them is out immediately.** A webfont from a CDN is
not available to us: [09](../09-server-multiuser-deployment.md)'s install is a
LAN server that may have no route to the internet at all, and a story surface
whose type depends on a third-party request is a story surface that renders
differently on the machine it was designed for. **Self-hosting** a face is
possible and costs bytes measured against
[20](../20-client-loading.md)'s budget. **A system serif stack** costs nothing,
ships today, and is genuinely good on every platform this runs on.

**Start with the stack**, and treat self-hosting as a later decision with a
trigger rather than a preference: if the four platforms resolve to faces that
disagree about measure badly enough to need per-platform leading, that is the
evidence for buying the bytes.

---

## 2. Stages

*Each stage is a commit or a short series, green before the next opens
([CLAUDE.md](../../../CLAUDE.md): a green suite closes a stage, not a phase).
Branch `p12a`.*

### P12A.0 — The tokens every other stage spends

`index.css` grows what §0.2's first fact says is missing, and nothing else:
**radii that differ** (control, panel, media — today's two both resolve to
`--radius-md`, which is one radius wearing two names), an **elevation pair**
(a resting lift and an overlay shadow), a **motion set** (two durations and two
easings, named for what they do rather than how long they take), a **scrim**
token for §1.2, and `--font-story` per §1.5.

**And the reduced-motion rule lands here, in the same commit as the first
duration token.** Every motion token resolves to `0s` under
`prefers-reduced-motion: reduce`, defined once in `index.css`, so a later stage
cannot forget it — the same argument [polish §6](06-polish.md) makes for the
palette, applied to the thing that did not exist when it was written.

*Tests:* `theme.test.ts` gains the assertions that keep the pair of dark blocks
identical and the new steps single-sourced; `contrast.test.ts` gains any inked
pair. **No surface changes in this stage**, which is what makes it reviewable.

### P12A.1 — The story face, and the two surfaces that wear it

Apply `--font-story` where `text-story` already is — the play transcript and the
reading view ([10 §12](../10-ui-surfaces.md)) — and check the measure still
holds at `--container-reading` with the new face's x-height. Cheap, visible, and
it is the stage that proves P12A.0's tokens reach a surface.

### P12A.2 — The backdrop becomes a backdrop

§1.2's four behaviours, plus the **choose-an-image** path that makes them
walkable: behind the column, scrim, crossfade, off with no placeholder, and
dropped entirely under the phone breakpoint
([10 §2.3](../10-ui-surfaces.md): *on a phone it is the first thing to go*).

**The contrast claim is a test, not a hope.** The scrim's job is that
`--color-ink` on the story column clears 4.5:1 *whatever is behind it*, which
means the scrim's floor is computed rather than eyeballed and
`contrast.test.ts` gets the pair. A person still looks at it — T1 — because a
ratio that passes over an average is not a ratio that passes over a highlight.

### P12A.3 — Faces

§1.1's four places: cast rows, the player's own line, the mention affordance,
and the object header in the editors and the library. Each is a claim, so each
gets the second half of [00 §3.6](../00-stance.md) — the path from the face to
the place the claim is corrected. **No new server route is expected**;
`api.avatarUrl` and the content hash are enough, and if a surface turns out to
lack the id it needs, that absence is the finding.

**The fallback is designed, not defaulted.** Most actors will have no portrait
for a long time, so the no-image case is the common case: `auth/tile.ts` already
generates deterministic initials for the sign-in gallery, and a second
invention here would be the third spelling of one idea.

### P12A.4 — The HUD, and whether it can write

§1.4. Audit first, then the strip: the *facts about now* widgets in one line
above the prose, each opening in place, each writing through a real state effect
that lands on the record.

### P12A.5 — The column that grew seven disclosures

§1.3's move, and the largest stage in the phase. Play becomes the HUD strip, the
prose, and the composer; the session-configuration panels move into the
workbench under a session subject. **The measurable claim is the one to test in
the suite**: every control reachable before is reachable after, and
`PlayPage.test.tsx` is where that is asserted rather than hoped — it is 1,301
lines of exactly the right assertions, and they should be moved, not deleted.

### P12A.6 — Motion, five of them

Turn arrival, the streaming state, a panel or sheet entering, the backdrop's
crossfade (already in P12A.2, named here), and Send acknowledging the press
([polish §11](06-polish.md) built the first word of this). Each spelled **once**,
in `ui/classes.ts` beside `reveal`, with the same test `theme.test.ts` already
applies to `reveal`: spelled in one place, and honouring its media query.

### P12A.7 — Editors: section jumps and an identity header

Anchor chips over the long form — never tabs
([10 §1.3](../10-ui-surfaces.md), [10 §11.2d](../10-ui-surfaces.md)) — generated
from the fieldsets that already exist rather than hand-listed, so a schema
change cannot leave a jump pointing at nothing. And `EditorFrame` grows the
header `ActorEditorPage` already has: the object's image, its name, its kind.

### P12A.8 — The phone rules

Two rules, both already written and neither enforced: **sheets rather than
shrunken panels**, and **no essential action that exists only on hover**. The
client has five breakpoint usages in total, so this stage is mostly an audit
producing a small number of fixes plus the lint or test that keeps them fixed.
`reveal` is the good case to generalise from — it carries an
`[@media(hover:none)]` arm because someone thought about it once.

---

## 3. Verification — the P12A exit gate

**The two-tier split** ([manual testing §0](05-manual-testing.md)): the critical
list below is walked by a person before the phase closes and lands as **sitting
T**; everything else extends the standing list and drains continuously. **The
steps here are never edited to match what was walked** — results go in §3.2,
which does not exist until there are results.

### 3.1 The critical list, and why each row is on it

Applying the criterion: **(i)** it can falsify a claim *this* phase makes,
**(ii)** the claim compounds, **(iii)** it is walkable with what is to hand.

| # | Do | Clears |
|---|---|---|
| **T0** | **The install.** One account, a session with a cast of three and a few branches, an actor with a portrait and one without, and **an image on disk to use as a backdrop**. No image endpoint needed — §1.2 is why. | — |
| **T1** | ***The prose over the worst backdrop you can find.* Only a person can walk it.** Choose a bright, busy image. Read a long turn. Then turn the backdrop off and confirm the surface is what it was, with no empty frame. *Compounds because [10 §2.3](../10-ui-surfaces.md) is the rule every later visual feature will cite.* | P12A.2 |
| **T2** | ***A face that is wrong, corrected from where it is shown.*** Rename or re-cast so the engine's attribution is stale, then fix it from the face. *This is [00 §3.6](../00-stance.md)'s test applied to the thing this phase added, and identity errors are the corpus's own example of what compounds.* | P12A.3, P12A.4 |
| **T3** | ***Play a session after the panels moved.* Only a person can walk it.** Mid-scene, change the lore selection, check a hook, look at the goal, correct a channel. Count the keystrokes and say whether §1.3's defence survived contact. *The layout is what every later surface is built beside.* | P12A.5 |
| **T4** | **A phone, one session, twenty minutes.** Send, read, use a per-turn control, open the workbench, correct a channel. **Every essential action reachable without a hover.** *Walkable today on any phone on the LAN.* | P12A.8, P12A.5 |
| **T5** | **Desk work: reduced motion.** Set the OS preference and walk the five motions. Each must be *absent*, not *fast*. | P12A.0, P12A.6 |

**Deliberately not critical**, and each is a standing-list row rather than a
judgement withheld: whether the story face is *the right* face (taste, and
reversible in one token), the gallery view and arrival cards (not 1.0 —
[10 §1.3](../10-ui-surfaces.md)), a second platform's rendering of the system
serif stack (breadth, and [manual testing §3](05-manual-testing.md)'s R6 owns
the machine), and every question about a **generated** backdrop, which waits on
R10 with [sitting O](05-manual-testing.md) and does not hold this phase open.

### 3.2 What was answered

*Empty. Results go here when sitting T is walked, and the six rows above are not
edited to match them.*

---

## 4. Out of scope, deliberately

- **Marinara's excess**, item by item, is listed in
  [10 §1.3](../10-ui-surfaces.md) and none of it is here: no per-mode
  presentation forks, no overlay stack, no ambient decoration, no eight-pixel
  type.
- **The gallery view and per-step setup explanation** — the two items
  [10 §1.3](../10-ui-surfaces.md) marks *not 1.0*. If a stage finishes early
  they are the first things to reach for.
- **Home.** [polish §5](06-polish.md) owns it, on terms this phase does not
  touch: nominally 1.0, expected immediately before the beta cut-over, and
  explicitly pushable. **If it lands in this window it lands wearing P12A.0's
  tokens and P12A.3's faces**, which is the whole of what the direction asks of
  it — and if it does not, nothing here is late.
- **A dialable density** ([25 E10](../25-open-questions.md)). Still open, still
  not this.
- **Radix, or any component dependency.** [polish §6](06-polish.md) drew that
  line and nothing here needs to cross it — a popover with a focus trap is what
  `ui/Dialog` already owns.

---

## 5. The honest size

**Nine stages, and three of them are the phase**: P12A.2, P12A.3 and P12A.5.
P12A.0 and P12A.1 are a day and are the reason the others are not each a week.
P12A.6, P12A.7 and P12A.8 are bounded enough to cut if the calendar says so —
**and cutting any of them means editing [10 §1.3](../10-ui-surfaces.md) to say
so**, because an owned commitment that quietly does not ship is the exact defect
[P11 §0.1](28-p11-implementation.md) exists to catch.

**The risk that is not in the stage list** is that a look phase has no natural
end. The defence is the gate: six rows, five of them about whether a specific
written claim holds, and none of them asking whether it is beautiful. **When S
has results, the phase closes**, and R4 can read a corpus the build matches.
