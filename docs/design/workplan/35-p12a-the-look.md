# 35 — P12A implementation plan: the look, and the sentence it has to put back

**Status: ~~skeleton~~ *opened 2026-10-13 on branch `p12a` (the note below)*; written 2026-09-22**, the day
[10 §1.3](../10-ui-surfaces.md) was written. ~~Nothing is built.~~ *Part of it
is, since 2026-10-01 — see the note on [polish §17](06-polish.md) below.* Format follows
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

***Renumbered 2026-10-02, from 30 to 33***, at the merge that brought
`origin/main` into a local `main` which had held this document since 2026-09-23
and never pushed it. In that interval `main` planned, built and merged
[P13](30-p13-aventuras-import.md) (~~2026-09-29, `7565265`~~ its plan
2026-09-29 at `7565265`, its stages 2026-09-30 at `6f55e6e`) and
[P14](31-p14-scene-and-session-import.md) (2026-09-30, `8878851`), and recorded
the [main audit](32-main-audit.md), filing them at 30 to 32. **All three ran
before this phase, which has not opened**, and it is still the one in front of
beta, so in execution order it comes after them and the filing number follows:
`PLAN_ORDER` gained their three lines ahead of this one, the script's `--plan`
moved this document and nothing else, and `--rename` moved it. *The citations
were repointed by hand*, five files, because `--rewrite` reads its map from a
committed rename and a merge in progress has none. The paragraph two above —
*its number is also its execution position, so nothing renumbers* — stopped
being true at this merge.

***Renumbered again 2026-10-03, from 33 to 34***, at the merge that brought
[P15](33-p15-setup-from-a-turn.md) — *make a setup from here*, built on
2026-09-26 as "P13" in a document 30 on `claude/nice-davinci-xjdpf6`, a name
and a number `main` gave the Aventuras import while that branch was out — into
`main` through the `p15` branch. **It ran before this phase, which has still not opened**, so the
paragraph above decides it without a new argument: execution order puts P15
ahead, `PLAN_ORDER` gained its line ahead of this one, `--plan` moved P15's
document and this one and nothing else, and `--rename` moved both. The
citations of this document were repointed by hand again — four files, the
work-plan README, [work plan](01-work-plan.md), [manual testing](05-manual-testing.md)
and [10](../10-ui-surfaces.md) — for the same reason as last time: the rename
sits inside a merge in progress, and `--rewrite` needs a committed one. **Its
sitting stays T and its name stays P12A**, both for the reasons the next
paragraph gives; P15's sitting is **W**.

***And no longer the last phase before beta, from 2026-10-04*** — which moves
nothing here. [P16](34-p16-world.md), World, was planned that day, when
[15](../15-world.md) put its set half into the 1.0 corpus, and it is filed
**after** this phase, ~~at 35~~, by a decision [P16 §0.1](34-p16-world.md) argues:
this phase is ready and unblocked, P16's `LoreScope` arm waits on an owner's
answer, and P16's new surfaces are cheaper built to this phase's rules than
retrofitted by its sweep. So this number, this sitting and this name all stay,
and **§0.1's one scheduling claim gains a sibling** rather than changing: R4 must
not be walked until this phase lands, and not until P16 lands either.
*(2026-10-11: ~~filed **after** this phase~~ — P16 opened **ahead** of this phase
on 2026-10-10, by the owner's word, and was built first; by `PLAN_ORDER`'s rule it
is refiled ahead of this document at its merge, and this paragraph is on
[P16](34-p16-world.md)'s list of what `tools/renumber-docs.mjs` will not reach.
The sibling claim stands: R4 waits on both.)*

***Renumbered a third time 2026-10-12, from 34 to 35***, on the `p16` branch
before its merge, when [P16](34-p16-world.md) merged first. The paragraph two
above decided it again without a new argument — execution order is filing order,
and P16 ran first — so `PLAN_ORDER`'s two entries were swapped, `--rename` moved
both documents (`d42aceb`), and **this time `--rewrite` repointed the
citations**, a hundred and fifty files, because the rename was committed on the
phase branch before the merge rather than sitting inside one: the trap the two
renumbering notes above record, avoided by doing it in that order, which P16's
owed-at-the-merge list had written down. What the rewrite cannot read — bare
numbers, and sentences that say *after* — was edited by hand in the same commit,
this paragraph's *~~at 35~~* among them. **Its sitting stays T and its name stays
P12A**, for the reasons the next paragraph gives, and it is **the phase in front
of us and the last before beta again**. The sibling claim is unchanged: R4 waits
on both, and P16 merged with its own critical list unwalked, so landing is not
yet closing ([P16 §2](34-p16-world.md)).

**Its sitting stays T.** It was registered 2026-09-22; `main`'s own T — pictures
on a move, [26 E15](../26-open-questions.md) — was registered 2026-09-27 by a
branch that could not see this one, so it is the later registration and became
**U** ([manual testing §4](05-manual-testing.md)). **Its name stays P12A, and
that is a choice rather than a consequence**: the lettering rule the rename
note above cites would now say ~~P14A~~ *P15A since 2026-10-03, when P15
filed ahead of this phase*, and renaming a phase is a rewrite of every
citation and note that says P12A — a decision for a person, and not one a merge
should make on its way past.

***And part of it was built on `main` while it waited.***
[Polish §17](06-polish.md) — 2026-10-01, `04e45a5`, the commit titled
*polish 5* — gave the story `--font-story`, a system serif stack with no webfont,
which is §1.5's own choice, beside every `text-story` in the client, and
`theme.test.ts` refuses the step without the face. That is
[P12A.1](#p12a1--the-story-face-and-the-two-surfaces-that-wear-it) and the
typeface token of [P12A.0](#p12a0--the-tokens-every-other-stage-spends); the
sentences below that said otherwise are corrected where they stand rather than
rewritten. The rest of that pass — polish §18 to §23 — is colour, navigation,
confirmation, refusals and the keyboard, and none of it is a stage here.

***And P16 hands this phase its entry — a note dated 2026-10-11, at
[P16](34-p16-world.md)'s final audit.*** P16 ran first, and it leaves the client
entry at about **312.35 kB** gzip against a ceiling of **317**
(`tools/entry-budget.test.ts`, raised at that audit with every figure measured) —
under five kB for a phase whose stages, tokens, motions, faces and editor headers,
all touch the client, and whose first stage is the one that spends them. ***The
named remedy, measured before this phase opens***: the admin half of Settings —
Accounts, Connections, Install, Backups — behind one `lazy()` took the entry to
**310.50**, **−1.85 kB**, with every audit fix in; it wants a chunk-error boundary
and an off-the-entry check like the publish review's, which makes it a loading
decision of its own ([21 §7](../21-client-loading.md)) rather than something to
slip into a stage. *A split that imports what the entry already holds measured
worse, not better* — the budget test's raise note says by how much — so the
remedy is the one that moves a whole surface, and a raise is the other honest
answer, with a measured reason, as every earlier raise had.

***Opened 2026-10-13, by the owner's word*** — *"do P12A now"* — on the bare
branch `p12a`, cut from `main` at `e460b637` (P16 and
[26 B20](../26-open-questions.md) merged, alpha 6 the last tag). P16's two
follow-ups the owner asked for the same day — travelling renditions without their
connection id, and the degraded start [04 §9](../04-schemas.md) promises — were
being built on `p16` at the time and reach this branch through `main`. **The
skeleton below was written three weeks and four phases ago**, so the first thing
done was the audit §0.2 asks to be read before costing anything, again: five
read-only reports against `e460b637`, one per group of stages. What they found
that changes a stage is **§0.4**, with the decision each finding forces. Those
decisions are the lead's, dated, and open to the owner's reversal, as
[P16](34-p16-world.md)'s were; none of them edits a stage's text or a row of §3,
which stay as written beside them.

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
[25](../25-roadmap.md)'s feature list, and **arrival is neither** —
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
   shadow tokens, no motion tokens, ~~no typeface tokens~~ and no spacing scale**.
   *(2026-10-13, §0.4: the spacing scale was never asked for by P12A.0 and is not
   built — Tailwind's `--spacing` is the scale.)*
   *(The typeface half is stale since 2026-10-01: [polish §17](06-polish.md)
   added `--font-ui` and `--font-story`. The rest of this sentence still held
   at the merge of 2026-10-02.)*
   ~~The only shadow in the client is a raw `shadow-lg` in `editor/FieldAssist.tsx`.~~
   *(False when written, and still false at the merge of 2026-10-02: there are
   three raw `shadow-lg`s, all on overlays — `editor/FieldAssist.tsx`'s assist
   popover, `notifications/NotificationToast.tsx`'s toast and
   `ui/TokenField.tsx`'s suggestion list. All three are what P12A.0's overlay
   shadow replaces.)*
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
  config file ([26 E10](../26-open-questions.md)).
- **Not the reading view's rebuild.** [10 §12](../10-ui-surfaces.md) shipped at
  P11 and is on the right side of this direction already. ~~It gains the story
  face at P12A.1 and nothing else.~~ *It has the story face already —
  [polish §17](06-polish.md), 2026-10-01 — ~~so this phase changes nothing in it.~~*
  *(2026-10-13, P12A.1, under §0.4: one thing — its `<article>` spends the
  `story` recipe and so takes the story's measure, about seventy characters of
  the story face, and releases it for print beside the column's own; see
  P12A.1's record in §2. Beyond that it moves only with the tokens every page
  spends: P12A.0's radii, and its illustration onto `rounded-media` with every
  other picture. It is not rebuilt.)*
- **Not a mobile-first pass.** [10 §1](../10-ui-surfaces.md)'s 1.0 bar —
  responsive and genuinely usable — is unchanged. ~~P12A.7~~ *P12A.8 (2026-10-13,
  §0.4)* enforces two rules that
  were already written, which is a different thing from designing a phone layout.

### 0.4 What the audit of 2026-10-13 found, and what each finding decides

*Read against `e460b637`. Each finding is the code's, cited where it stands; each
decision is the lead's, and the stage that carries it says so in its record in
§2.*

**Across the phase.**

- **The client entry is the budget every stage spends**, and the figure in the
  note above (312.35) is stale: the last measured build was **312.91** of 317, and
  B20 and P16's two follow-ups land on top of it. *Decided*: the named remedy —
  the admin half of Settings behind one `lazy()`, with the publish review's chunk
  boundary and off-the-entry check — is built **first**, as its own commit before
  P12A.0, because every stage after it is client work and the alternative is a
  raise at each. `Connections.tsx` holds both halves (`MyConnections` is the
  user's), so the split moves the admin components out of it rather than the file
  whole ([21 §7.4](../21-client-loading.md): a module the entry reads pulls its
  whole file onto a preloaded chunk).
- **A UI stage needs a build before the suite**, as §0.2 says: the
  `tailwind-utilities` and entry-budget tests read `dist/`. Every stage's gate
  here is `pnpm build` and then the suite.

**P12A.0 — the tokens.**

- *Found*: two radii, both `--radius-md`; no shadow, motion, scrim or spacing
  token; three raw `shadow-lg`s (all overlays); **21 raw `rounded-md`** and six
  `rounded-full`; media on three radii; **no lint for any of them**. Tailwind 4
  resolves `duration-<name>` from `--transition-duration-*` (a `--duration-*`
  token emits nothing) and **inlines shadow geometry**, so a dark shadow must
  carry its colour through a `--color-*` token. `theme.test.ts` single-sources
  colours only, and `contrast.test.ts` cannot read a `color-mix()` token and
  requires exactly two dark blocks.
- *Decided*: **the radii differ** — control, panel and media — which is a visible
  change to every panel at once, made in the token and nowhere else; that is
  what *"no surface changes in this stage"* is taken to allow, and the raw
  `rounded-md`s move onto the token their element is. The elevation pair's colour
  is one `--color-shadow`, aliased per theme. Motion is two durations and two
  easings under Tailwind's own namespaces, and one `prefers-reduced-motion`
  block zeroes every duration — `--default-transition-duration` included, which
  is what `reveal` spends today. A source scan beside the `opacity-0` one refuses
  raw `shadow-*`, `rounded-{sm,md,lg,xl,…}`, `duration-*`, `ease-*`, `animate-*`
  and `transition*` outside the recipes. **No spacing scale**: §0.2's first fact
  lists one as missing and the stage never asked for it; Tailwind's
  `--spacing` is the scale, and §0.2's line gets a dated note rather than a token
  nobody spends.

**P12A.1 — the measure.**

- *Found*: the story's measure is **45em whatever the face** — `max-w-reading`
  (48rem) less the column's padding, at `text-story` 1rem — which in a text serif
  is roughly **90–100 characters a line**. Nothing in the corpus gives a target,
  so *"the measure still holds"* could not be checked until one is written down.
- *Decided*: the target is **about 70 characters of the story face**, the
  middle of the range typographers cite, and it is held **in `ch` on the prose
  itself**, so the measure follows the face rather than the column: a
  `--container-story` step, spent by the story recipe beside `font-story`. The
  column stays 48rem for the composer and the HUD. The check is two tests that
  can run without a browser — the recipe spends the step, and every `text-story`
  element carries it — and a person's look on a second platform, which §3.1
  already files as a standing row.

**P12A.2 — the backdrop.**

- *Found*: §0.2's fourth fact holds — an in-flow `<img>` with the widget label as
  its `alt`. **No path chooses a backdrop by hand**, while
  `renditions/backdrop.ts`, the Aventuras import and a user-facing import
  sentence all say one can be. The server already admits a person's write to
  `se.backdrop` through the channel route, and serves both arms of
  `MediaSelection`. With *Stage a backdrop* on, a person's pick is overwritten by
  the next reuse or generation.
- *Decided*: **choose from what the session already uses** — the background
  renditions it holds, and the pictures on its treatment, lorebooks and their
  entries, setup, cast and Worlds — written through the existing channel route as
  a person's effect, so it lands on the record and rewinds with the tree. **No
  new arm of `MediaSelection`** (a schema change under live sessions, which
  `sdk/src/media.ts` calls a migration) and **no upload into a session**: a new
  picture goes into a library object first, through the galleries that exist.
  **Choosing one turns *Stage a backdrop* off**, in the same act and said in the
  same sentence, so a pick holds without a new rule in the runner; turning
  staging back on hands the choice back to the story. **Off** is *No backdrop*:
  the selection cleared and staging off, which leaves no frame. The scrim's floor
  is computed for **`ink-subtle`**, not only `ink`, because the player's line is
  set in it — about 0.81 opacity in both themes by the audit's arithmetic — and
  `contrast.test.ts` learns to composite a `color-mix()` token over the worst
  pixel.

**P12A.3 — faces.**

- *Found*: chat turns have drawn names and faces since P14.5 (`play/Portrait.tsx`),
  so §0.2's third fact is half stale; **a second spelling of initials exists**
  (`Portrait`'s `initialOf` beside `auth/tile.ts`); and **the common no-picture
  case draws an empty circle**, because a card made in the editor is a 1×1
  transparent PNG that the avatar route serves with a 200. `CastRow` has the
  actor's id but not the content hash `avatarUrl` needs (the library query
  supplies it). The player's own line has an `input.actorId` that **turns
  played in the client never set**, and chat draws today's persona on yesterday's
  lines. Mentions render a bare `<mark>` and lose their span before rendering.
- *Decided*: the avatar route answers **404 for a blank card**, so every face
  falls back the same way; **one face component** in `ui/`, on `auth/tile.ts`'s
  spelling generalised (two initials by grapheme, a hue from the immutable id),
  replaces `Portrait`'s; the client **sends `input.actorId`** from the persona
  it plays, and a past line draws the face its record names and **no face when
  it names none** — today's persona on an old line is a claim the record never
  made. A mention becomes a control that opens the actor it matched, with the
  name it matched by and the correction that exists: the actor's aliases, which
  is what decided the match. **No new route.**

**P12A.4 — the HUD.**

- *Found*: §1.4's question has a split answer. **The write is complete** — the
  channel route appends a person's effect to the record — but **the HUD cannot
  use it**: an entry carries only its rendered text, and a mode's `hud`-region
  contributions are rendered nowhere. There is no non-modal popover in `ui/`.
- *Decided*: a HUD entry carries its value and how it is edited, beside its text,
  so the strip can write without per-channel code in the client; a `ui/Popover`
  is built once, here, and P12A.3's mention uses it. *Each widget opens in place
  and writes through the route that exists.*

**P12A.5 — the column.**

- *Found*: not seven disclosures but **five, among up to thirteen blocks**
  above the prose — P14's chat settings and mode actions, P16's World controls
  and the scene toggles arrived after §0.2. **The workbench has no session
  subject** (§1.3 says it does). **§1.3's move of the hooks contradicts
  [10 §10.1](../10-ui-surfaces.md)**, which puts *Commit* and *Save this to…* on
  the play surface. `PlayPage.test.tsx` is 2,606 lines now and asserts nothing
  about where a panel sits; the *reachable before, reachable after* claim needs
  the real router and shell.
- *Decided*: **10 §10.1 wins** — it is the design authority, and §1.3 called
  itself a proposal — so the hooks stay on the play surface as a HUD item that
  opens in place, beside the cast, the state and the goal. The configuration
  panels move into a **Session** section of the workbench's play subject, and
  [10 §3](../10-ui-surfaces.md)'s *honest residue* — rewrite the section when a
  second non-reader subject arrives — is honoured with a dated note there. The
  reachability test is new, in `dock.test.tsx`'s setup, and lists every control
  by its accessible name.

**P12A.6 — motion.** *Found*: still one transition, `reveal`, at Tailwind's
default and with no reduced-motion arm; the Send acknowledgement polish §11 built
has no motion; a mount-time animation would fire for every turn on load.
*Decided*: turn arrival animates only the turn that just finished (the reducer
knows its id); each motion is a recipe in `ui/classes.ts` spending P12A.0's
tokens; and the test is new — §2's *"the same test"* reads `hover:none`, not
reduced motion.

**P12A.7 — editors.** *Found*: no section carries an id, and only `LoreEntry`'s
schema has banners, so chips from `groupsOf` would be empty for five kinds of
six; `EditorFrame`'s docstring refuses a prop that some kind cannot answer.
*Decided*: a `JumpSection` that registers with the frame replaces the
`<section>`/`h2` pairs, so a chip cannot point at nothing; a jump into a closed
`<details>` opens it. The header's image is an answer every kind can give, and
*none* is an answer.

**P12A.8 — the phone.** *Found*: five breakpoint uses; **no essential action is
hover-only** — every `reveal` carries a focus arm and a `hover:none` arm — but
explanations that live only in a `title` are invisible on a phone (the rule
`ClosureList.tsx` already states), and the assistant panel has no phone arm.
*Decided*: the audit's list is the stage's work list, and its test refuses an
`invisible`/`group-hover` reveal outside the recipe and a control whose only
explanation is a `title`.

*Smaller slips, noted where they stand*: §0.3 says *"P12A.7 enforces two
rules"* (it is P12A.8); §5 says *"When S has results"* (the sitting is T); the
*never tabs* rule is [10 §1.3](../10-ui-surfaces.md)'s and 10 §3's, not
[10 §11.2d](../10-ui-surfaces.md)'s.

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

~~`--text-story` exists; no `font-family` is declared anywhere in the client, so
the story is set in the same system sans as the tooling.~~ The direction asks for
a face of its own. ***Decided and built on `main` before this phase opened***
(2026-10-01, [polish §17](06-polish.md)): the system stack, as below, with no
webfont, for the reason below. What is left of this section is its trigger.

**Three options and one of them is out immediately.** A webfont from a CDN is
not available to us: [09](../09-server-multiuser-deployment.md)'s install is a
LAN server that may have no route to the internet at all, and a story surface
whose type depends on a third-party request is a story surface that renders
differently on the machine it was designed for. **Self-hosting** a face is
possible and costs bytes measured against
[21](../21-client-loading.md)'s budget. **A system serif stack** costs nothing,
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

### Before P12A.0 — the entry's headroom

*Not a stage of the skeleton — the remedy the note of 2026-10-11 above names
and §0.4's first bullet decided to build first, recorded here because it is
work on this branch and every stage after it spends what it bought.*

***Built 2026-10-13.*** The administration half of Settings — accounts, the
install's connections and role table, the install's settings, the install's
backups — is one `lazy()` chunk, `settings/Administration.tsx`, reached from
inside the conditional that draws the half for an administrator, so a
non-admin's browser never fetches it. `SettingsPage.tsx` keeps the half's
heading and anchor, a `status` sentence while the chunk is on its way, and the
publish review's shape of boundary: the factory wraps the import's rejection in
an error of its own, and only that failure is told to reload; the user half
stands either way. `tools/entry-budget.test.ts` gained *keeps the
administration half of Settings off the entry*, which looks for the chunk by
name and for a sentence from each of the half's four files on every file
`index.html` pulls. [21 §7.5](../21-client-loading.md) records the boundary.

**What the note said and what turned out different:**

- *It measured −1.85 kB to 310.50*; built, it is **313.21 → 310.30, −2.91**.
  The note did not record what shape it measured. The larger part of the
  difference is §0.4's own decision to split `Connections.tsx` rather than move
  it whole: the install's half went to `AdminConnections.tsx` (the file's name
  before P10.3), the shared panel was exported, and the first-run question
  reaches the shared form through a slot instead of being drawn by it. With
  `AdminConnections.tsx` reachable from the entry again, the entry measures
  **311.67**, so that split is 1.37 of the drop.
- *The drop is smaller than the chunk* (8.25 kB on its own): another
  `import()` of modules the entry holds made the bundler split them into
  sixteen preloaded files where there were ten, and small files compress
  worse — the sixteen as one file would be 306.59. That is
  [21 §4.4](../21-client-loading.md)'s open question, recorded and not tuned.
- *Two things the note did not name, both found by building it.* **The jump to
  the address's hash** (`useJumpToHash`) runs when the hash or the role
  changes, and the half's four anchors arrive after both, so a link to
  `#connections-section` landed nowhere; the half now asks for the jump as it
  is drawn (`useJumpOnArrival`), once and only for its own sections, so a
  person who arrived at a section of the user half and moved on is neither
  taken back nor robbed of a field's focus. **Two tests in
  `SettingsPage.test.tsx` read the page before the chunk** — the contents test
  read the anchors straight after the half's heading, and the dead-end
  warning's test took the page's first `status` for the warning — and passed
  only because an earlier test had fetched the chunk; run alone, each failed.
  Both now wait for the half, and every test in that file was run alone to find
  them.
- *The half's heading stays on the entry* rather than moving with the chunk:
  the anchor a jump lands on then exists with the role, and the pending and
  failure sentences sit under the heading they are about.
- *The ceiling comes down, 317 to **315***, by `entry-budget.test.ts`'s own
  convention — its changelog lowering left about five kB of margin rather than
  the forty a split freed, and 317 would leave 6.70. 315 leaves **4.70** for
  P12A.0 onward, against 3.79 before this. At 315 the byte ceiling no longer
  catches the half imported statically (313.44); the structural check does.

**Tests, each checked against a mutation and restored:**
`SettingsPage.load.test.tsx` (new — the sentence while the chunk is on its way,
then a chunk that never arrives: the reload sentence, the user half standing)
fails with the factory's rejection left unwrapped and with the boundary
removed; `SettingsPage.arrival.test.tsx` (new — a pasted `#connections-section`
lands once the half arrives, and not before) fails with the half's jump on
arrival removed; in `SettingsPage.test.tsx`, the boundary's two sentences fail
with every failure told to reload, and *leaves a section it does not draw where
the page left it* fails with the arrival jump made for any section the address
names; the entry-budget check fails with the half imported statically (no
`Administration-*` chunk) and with `AdminConnections.tsx` re-exported from
`Connections.tsx` (its sentence found on an entry file); and
`Connections.test.tsx`'s first-run test, unchanged but for its import, fails
with the slot left unfilled and with the form ignoring it. *Not walked in a
browser* — none is installed where it was built; 21 §7.5 lists what a look
would check.

**Entry after: 310.30 kB** of a 315 ceiling, CSS 7.81 — gzip level 9 over the
files `index.html` pulls, the budget test's method.

### P12A.0 — The tokens every other stage spends

`index.css` grows what §0.2's first fact says is missing, and nothing else:
**radii that differ** (control, panel, media — today's two both resolve to
`--radius-md`, which is one radius wearing two names), an **elevation pair**
(a resting lift and an overlay shadow), a **motion set** (two durations and two
easings, named for what they do rather than how long they take), a **scrim**
token for §1.2, ~~and `--font-story` per §1.5~~ — *`--font-story` is already
there, beside `--font-ui`, since [polish §17](06-polish.md).*

**And the reduced-motion rule lands here, in the same commit as the first
duration token.** Every motion token resolves to `0s` under
`prefers-reduced-motion: reduce`, defined once in `index.css`, so a later stage
cannot forget it — the same argument [polish §6](06-polish.md) makes for the
palette, applied to the thing that did not exist when it was written.

*Tests:* `theme.test.ts` gains the assertions that keep the pair of dark blocks
identical and the new steps single-sourced; `contrast.test.ts` gains any inked
pair. **No surface changes in this stage**, which is what makes it reviewable.

***Built 2026-10-13***, under §0.4's decisions for this stage. `index.css`'s
`@theme` names **three radii that differ** — `--radius-control` at Tailwind's
`md` (0.375rem, where it was), `--radius-panel` at `lg` (0.5rem) and
`--radius-media` at `sm` (0.25rem): three consecutive steps of one scale, the
panel rounder because it holds controls and a corner reads as concentric only
round a tighter one, the picture tighter because a picture's corners are content
and rounding trims what somebody made. **An elevation pair**, `--shadow-raised`
(the geometry of Tailwind's `sm` shadow) and `--shadow-overlay` (its `lg`, which
the three overlays drew), every layer coloured by `--color-shadow` — black at
10% in light, Tailwind's own shadow colour, so the overlays draw the same pixels
there, and 50% in both dark blocks. **A motion set**: `--transition-duration-respond`
(150ms, the default `reveal` spends) and `--transition-duration-arrive` (300ms),
`--ease-arrive` (Tailwind's `ease-out`) and `--ease-swap` (its `ease-in-out`,
the default curve). **The backdrop's scrim**, `--color-veil`, each theme's canvas
step at 82%. After the dark theme, **one** `@media (prefers-reduced-motion: reduce)`
block zeroes both durations and `--default-transition-duration`. The 21 raw
`rounded-md`s moved onto the token their element is — twelve panels (the history
section, the actor editor's two kinds of fieldset, the two kinds of revision
row, an account's card and the new-account form, a connection's card and the
connection form, a connection test's text answer, the first-run question's box
and form), six controls (the revision-rename input, four selector chips, the
*Shadowed* badge), three pictures (the actor's portrait, its placeholder, a
connection test's picture) — and the ~~six~~ *seven* pictures already on another token moved to
`rounded-media`: a rendition, two in *Pictures*, the media strip's, the mode
region's image and the reading view's illustration *(2026-10-13, after review:
and the moves grid's stand-in for a missing picture, which this paragraph first
left on `rounded-control` — see* After review *below)*. The three `shadow-lg`
overlays spend `shadow-overlay`. 10 §1.2 has a dated note.

**What the stage text said and what turned out different:**

- *"No surface changes in this stage"* — taken as §0.4 decided: the visible
  change is the token values, every panel 2px rounder at the corner and every
  picture 2px tighter, made in `index.css` and nowhere else; the class moves
  change nothing on their own but where an element changed token. The light
  overlays are pixel-identical; the dark ones are heavier, which is the point
  of a shadow colour a theme can reach. *Not looked at in a browser* — none is
  installed where this was built — so the dark shadow's 50% is an argument
  (the canvas is near black and the shadow has little left to darken) waiting
  for a person's eye.
- *"A scrim token for §1.2"* — named **`veil`**, because `--color-overlay` is
  the modal's scrim and its own comment calls it that. Its floor was re-derived
  rather than taken from the audit: bisection over the palette read from
  Tailwind's `theme.css`, the ink composited in gamma-encoded sRGB over the worst
  pixel each theme has — black under light's dark ink, white under dark's light
  ink. `ink-subtle` needs **0.7993** in light and **0.8033** in dark (the audit's
  0.800 and 0.804, to its 0.001 step), `ink-muted` 0.6846 and 0.6556, `ink`
  0.5115 and 0.5614; `ink-faint` needs 0.9945 in light, so it can never sit on
  the veil. **82%** in both themes leaves `ink-subtle` at 4.745 and 4.786 over
  its worst pixel.
- *Found by building it, and not in any plan*: the veil was first written
  `color-mix(in oklab, var(--color-canvas) 82%, transparent)`, so that it could
  not drift from the canvas. The build writes a plain fallback beside every
  `color-mix()` for browsers without it, resolving any token inside against
  `@theme` — and so emitted `#f8fafcd1`, the **light** canvas, as the fallback
  in both dark blocks: the stranding `--color-overlay`'s note warns of, by
  another route. Each block now names its canvas's ramp step (dark's fallback is
  `#020618d1`), and `contrast.test.ts` holds the veil to its theme's canvas step,
  which is what the token name was for.
- *"`theme.test.ts` gains the assertions that keep the pair of dark blocks
  identical and the new steps single-sourced"* — and more, because each new
  kind of step has its own way to be wrong. The dark-identity test compares
  every declaration, not only colours; a new describe, *the steps that are not
  colours*, holds `@theme` to one declaration per step, refuses a non-colour
  step anywhere but `@theme` (the dark blocks hold colours only), holds the
  three radii to three values, refuses a shadow step with a colour of its own,
  refuses a duration or easing token outside Tailwind's real namespaces
  (`--transition-duration-*`, not `--duration-*`, which compiles to nothing), and
  holds the reduced-motion block to **exactly** the motion tokens `@theme`
  declares — durations and delays at `0s`, an `--animate-*` at `none`, and
  `--default-transition-duration` — so P12A.6's first token cannot arrive
  without its line. **The block lookups were fragile, and are not now**: they
  found a block by the first occurrence of its opening, and the first `@theme`
  is in the header comment. They read a comment-blanked copy, and a block that
  opens twice or not at all is an error rather than a wrong block. With a brace
  quoted in that header comment, the test as it stood at `95c057b4` read an empty
  block — its two light-palette tests passed reading nothing, and only the faces
  test failed — where the new one reads the right block and passes.
- *§0.4's source scan*, beside the `opacity-0` one: a radius class must name a
  radius token or be `rounded-full` or `rounded-none`; a shadow class must name
  an elevation or be `shadow-none` (`inset-`, `drop-` and `text-shadow` refused);
  and a motion class — `transition*`, `duration-*`, `ease-*`, `delay-*`,
  `animate-*` — may be written only in `ui/classes.ts`, where every one but
  `transition*` must name a token `@theme` declares, because a number is
  written into the utility and the reduced-motion block cannot reach it. Arbitrary
  values are refused with the rest. It reads **string literals only**, through a
  small lexer, so a template literal's text between its `${…}` holes is read —
  the face test's regex reads neither — and the bare words `rounded`, `shadow`
  and `transition` count only in a literal that reads as a class list. It is
  calibrated on what it must see, `field-sizing-content` among it, which is
  written only after a `${control}` hole.
- *"`contrast.test.ts` gains any inked pair"* — it could not read the veil at
  all: its parser took only `var(--color-<step>)`, so a `color-mix()` token was
  invisible rather than a failure, which is why the overlay was never read. It
  reads a step at an opacity now, **and fails on any third spelling** — the count
  of colours read must equal the count declared, block by block. `ink`,
  `ink-muted` and `ink-subtle` are measured over the veil composited over black
  and over white in all three theme blocks, with the ink held outside the span
  of colours the veil can make, which is what makes two pixels a proof for every
  picture.
- *Comments that name a class keep it in the build.* Tailwind reads candidates
  out of every source file in the client, comments included (not `index.css`,
  which was checked: a class named in its comments is not emitted). The scan's
  first docstring named four raw classes, and the build carried `.bg-slate-800`
  and `.duration-300` and kept `.rounded-md` and `.shadow-lg` alive; reworded,
  the stylesheet **drops** `.rounded-md` and `.shadow-lg` — the build's own
  evidence that nothing spends them.
- *Left as written*: nine bordered `p-3` boxes spend `rounded-control` — in
  `EntryTravel`, `PresetEditorPage`, `LorebookEditorPage`, `SchemaFields`,
  `HookFields`, `RenditionList`, `NotificationBell`, `SessionPanel` and
  `RememberThis`. Each sits inside a panel, which the tighter radius suits;
  whether each is a panel is a sweep's question, and only the raw classes were
  this stage's.

**The emitted CSS**, from `packages/client/dist/assets/index-*.css`. What the
client spends:
`--radius-control:var(--radius-md);--radius-panel:var(--radius-lg);--radius-media:var(--radius-sm)`,
`.rounded-media{border-radius:var(--radius-media)}`,
`.shadow-overlay{--tw-shadow:0 10px 15px -3px var(--tw-shadow-color,var(--color-shadow)), 0 4px 6px -4px var(--tw-shadow-color,var(--color-shadow));…}`,
`.transition-opacity{…;transition-duration:var(--tw-duration,var(--default-transition-duration))}`
and
`@media (prefers-reduced-motion:reduce){:root{--transition-duration-respond:0s;--transition-duration-arrive:0s;--default-transition-duration:0s}}`.
**The motion tokens are spent by nothing yet, and Tailwind leaves an unspent
token out of `:root`**, so a build with a probe file spending them — deleted, and
the client rebuilt without it — is what shows the classes keep the indirection:
`.duration-respond{--tw-duration:var(--transition-duration-respond);transition-duration:var(--transition-duration-respond)}`,
`.ease-arrive{--tw-ease:var(--ease-arrive);transition-timing-function:var(--ease-arrive)}`,
and `.shadow-raised` with `var(--tw-shadow-color,var(--color-shadow))` in each
layer. So the plain `duration-<name>` form reaches the reduced-motion block, and
the arbitrary `duration-(--…)` form was not needed.

**Tests, each checked against a mutation and restored.** In `theme.test.ts`: a
radius declared in one dark block fails *states a step … in `@theme` alone* and
the dark-identity test; a duration missing from the reduced-motion block, the
default duration missing, a stranger in it, a duration at `0.01ms`, and a new
`--animate-*` token without a line each fail *stills every motion*; a
`--duration-quick` token fails the namespace test; the panel radius set back to
`md` fails the three-radii test; an `rgb()` layer in the overlay fails the shadow
test; a radius declared twice fails *declares each step once*; a second
reduced-motion block, and a step redeclared in a stray `:root`, fail the
single-source test. The scan fails with `rounded-md` back in a selector chip, a
`shadow-lg` back on the assist popover, a `rounded-lg` inside a template
literal, a bare `rounded` in a class list, a `transition-colors duration-arrive`
outside the recipes, a recipe given `duration-300`, `ease-out` or
`motion-safe:animate-pulse`, a `hover:shadow-md!`, and a `rounded-[3px]`; its
calibration fails with the lexer made blind to template text; a recipe spending
`duration-respond ease-swap motion-reduce:transition-none` passes, as it must.
In `contrast.test.ts`: the light veil at 79% and the dark at 80% fail the
picture test (the second also the dark blocks' agreement); a veil of `slate-100`
fails *thins the canvas*; the first spelling, `var(--color-canvas)`, fails
*reads every colour* among others; a veil at 10% fails the picture test; and the
span assertion forced true fails with its own message — no token in the palette
sits where it alone would fail, which needs an ink near luminance 0.18 under a
nearly clear veil, so it was checked by forcing it. The touched components'
tests and their neighbours — twenty-two files — pass unchanged.

**Entry after: 310.33 kB** of a 315 ceiling (310.30 before; the class strings
are a few bytes longer), **CSS 7.98** (7.81 before: the two colours' fallbacks
in both dark blocks, the reduced-motion block and the new radii) — gzip level 9
over the files `index.html` pulls, the budget test's method.

***After review, 2026-10-13*** — a review of the stage's diff, each finding
verified before it was acted on, found one thing, reported twice. **A picture's
stand-in stayed behind when its picture moved.** `MovePicture` in
`play/Pictures.tsx` draws a dashed stand-in in a picture's slot when the move's
picture has no bytes here or its `<img>` fails to load; the picture moved to
`rounded-media` above and the stand-in did not, so a row of a move's pictures
with one lost had one tile 2px rounder at the corner than the tiles beside it —
a slot that changed shape because its bytes went missing. That mismatch did not
exist before this stage, and *every picture 2px tighter* in the first bullet
above did not cover it. The actor editor's portrait placeholder had followed its
picture; this one had not, and the paragraph did not say why — there was no
reason. It spends `rounded-media` now, with a comment saying a stand-in takes its
picture's radius because it takes its picture's slot. `Rendition`'s status line
stays on `rounded-control`: it is a line of text in a box, not a slot shaped like
a picture.

*Test, checked against a mutation and restored*: `PlayPage.test.tsx`'s *keeps a
picture that fails to load the shape of the pictures beside it* gives a move two
pictures, fails the first one's load, and holds the stand-in to the same radius
token as the picture beside it, read off the classes because jsdom draws nothing.
It fails with the stand-in back on `rounded-control` (*expected
`rounded-control` to deeply equal `rounded-media`*), and with the load failure
not handled, when no stand-in is drawn at all. `theme.test.ts`'s calibration now
counts ten `rounded-media` spenders — eight pictures and the two stand-ins — and
its floor is ten, which the same revert fails at nine. **Entry after: 310.33 kB, CSS 7.98**, unchanged, by the same
method.

### P12A.1 — The story face, and the two surfaces that wear it

~~Apply `--font-story` where `text-story` already is — the play transcript and the
reading view ([10 §12](../10-ui-surfaces.md)) — and~~ ***Applied on `main` before
the phase opened*** — [polish §17](06-polish.md), `04e45a5`, 2026-10-01, beside
every `text-story` in the client, with `theme.test.ts` refusing the step without
the face. **What is left of the stage is its check**: that the measure still
holds at `--container-reading` with the new face's x-height, which that commit
does not say it measured. ~~Cheap, visible, and it is the stage that proves
P12A.0's tokens reach a surface.~~

***Built 2026-10-13***, under §0.4's decision for this stage: **the measure**.
`index.css`'s `@theme` names ~~**`--container-story: 70ch`**~~
*(**`55ch`**, 2026-10-13, after review — see* After review *below)*, beside
`--container-reading`, and `ui/classes.ts` names one recipe that spends it,
**`story`** — `text-story font-story max-w-story`, the step, the face and the
measure in one string. The fourteen class strings that paired the step and the
face by hand spend the recipe now, so the measure lands on **the element that
carries the face**, which is the whole reason it is a recipe: a `ch` is the
advance of the zero in the font of the element it is resolved on, and the token
is an unregistered custom property, so `70ch` travels as text and resolves where
`max-width` uses it rather than on `:root`. On the column, which is set in the
interface face, the same seventy would count characters of the sans. **The
column stays `page.reading`, 48rem**, for the composer and the HUD, which are
not prose. The prose is not centred in it — it starts on the column's text line
with the title and the composer, by `ui/classes.ts`'s rule that a margin belongs
at the call site, and the room the measure gives back is on the far side.

**The target, and why.** About **seventy characters of the story face** — the
middle of the range typographers commonly cite for a single column of prose,
which is §0.4's wording, held by the test to the band ~~sixty to eighty either
side of it~~ *(fifty to sixty `ch`, 2026-10-13, after review — which is about
sixty-three to seventy-six characters)*. It replaces a measure nobody chose:
45em of prose once the column's padding is off, whatever the face, which the
audit estimated at ninety to a
hundred characters of a text serif. *A `ch` is the zero, not the average
letter*, ~~so seventy `ch` is a width that holds about seventy characters of
running text in a face whose figures are about as wide as its lower case;~~
*(2026-10-13, after review: unchecked, and no face in the stack is such a face
— a serif's zero is about 1.26 times its running text's average advance, so
seventy `ch` held nearly ninety characters; see* After review *below.)* How
many a real line holds in Charter, Sitka Text or Noto Serif needs a browser,
and §3.1 already files a second platform's rendering as a standing row rather
than a critical one.

**The fourteen sites, each decided rather than swept.**

| Site | The element the recipe lands on | What the cap does there |
|---|---|---|
| The reading view (`reading/ReadingPage.tsx`) | The `<article>` round every passage | A passage, a move's quoted words and an illustration share one measure, as a book's do; an illustration wider than the measure is drawn at it, centred by its own `mx-auto`. **Released for print** at the call site, `print:max-w-none` beside the column's own, so the printed story is set as it was. |
| The transcript's prose, five strings (`IllustratedProse`) | Each `MentionOverlay` paragraph | The prose narrows; a picture between two halves of a turn is the paragraphs' sibling, so it keeps the column's width, as it did. |
| The player's line (`TurnView`) | Its `<p>` | Narrows like the prose it precedes. |
| The turn being written, three strings (`LiveTurn`) | The joined text, a narrator's line, and a named speaker's line beside a portrait | Arrives at the measure it will have when it lands, so a finished turn does not reflow. |
| A chat's lines, two strings (`ChatMessages`) | The input line and each message, beside a `w-8` portrait and a `gap-2` | The column there is about 42.5em, so the cap applies wherever seventy characters of the face come to less, and costs nothing where they do not. *(2026-10-13, after review: at 55ch the cap is 27.5em to 35em in every face measured, so a chat line is capped like every other paragraph of story once the window gives the column its width.)* |
| Home's changelog (`home/HomeRelease.tsx`) | The `<article>`, which drops its `max-w-reading` for the recipe | The widest prose in the client was this one — 48em, having no padding to take off — and it narrows most. |
| Compare's two outputs, one string (`compare/ComparePage.tsx`) | Each output's `<p>` | **Harmless, and said so at the call site**: side by side each column is about 26em of the tooling width, well inside the cap *(2026-10-13, after review: inside it still at 55ch, though not well inside — Liberation Serif's 55ch, the narrowest measured, is 27.5em)*; below the two-column breakpoint one output takes the width and is a block of prose like any other. |

**What the stage text said and what turned out different:**

- *"The measure still holds at `--container-reading` with the new face's
  x-height"* — there was nothing to hold it to, and once a target was written
  down it did not hold: ninety-odd characters against seventy. So the stage is
  not the check it was written as; it is §0.4's move of the measure off the
  column and onto the prose, and the check is where the measure is spent.
  `--container-reading` keeps its name and its value and stops being the
  measure.
- *§0.4's "every `text-story` element carries it"* is held as the stronger
  thing the recipe makes possible: **no class string in the client but the
  recipe spells any of the three** — the step, the face or the measure — so a
  paragraph cannot take the step without the measure, and nothing can take the
  measure in a face it does not count. A surface that wants one of them alone
  adds a second recipe, which is a decision rather than a default, as `reveal`'s
  rule has it.
- *Found by building it*: the reading view's column releases its width for
  print, and an article capped at seventy characters inside it would have
  printed a narrower page inside the page. The article releases its own cap
  beside the column's; the recipe does not carry the release, because the
  paper is the call site's business as the column's was.
- *The test file's lexer moved*: `strip` and `literals`, written in P12A.0 for
  the radius scan, are hoisted to module scope in `theme.test.ts` so the
  recipe's scan reads string literals the same way, template text included.
  *(2026-10-13, after review: and `utilityOf` after them, so the recipe's scan
  reads each class as the utility it names, as the radius scan does.)*
- *Comments and the corpus*: 10 §1.1 and §1.2 have dated notes, the measure's
  `--container-reading` struck where they named it; `ui/classes.ts`'s `page`
  docstring and the play column's comment carry dated notes beside what they
  said.

**The emitted CSS**, from `packages/client/dist/assets/index-*.css`:
`--container-reading:48rem;--container-story:70ch` *(`55ch` after review)* in `:root`, and
`.max-w-story{max-width:var(--container-story)}` — the `var()` survives, and no
`@property` registers the token, so `ch` resolves on the element.

**Tests, each checked against a mutation and restored.** In `theme.test.ts`, a
new describe, *the story's measure*: *holds the measure in characters, about
seventy of them* fails with the step at `38rem`, at `90ch`, ~~at `50ch`,~~ and
undeclared *(2026-10-13, after review: `50ch` is inside the band now, which is
fifty to sixty; the mutations against it are listed below)*; *spends it on the
prose, through the recipe that sets the face* fails with the recipe lacking
`max-w-story`, with the column spending
`max-w-story` in place of `max-w-reading`, and with the column carrying both;
*is spelled nowhere but the recipe* fails with the pair re-typed at Compare,
with the pair written beside a `${reveal}` hole on the player's line, with
`max-w-story` written on home's article outside the recipe, and with
`font-story` alone on a heading *(2026-10-13, after review: and with
`sm:font-story` on a heading, `md:max-w-story` on a heading, `md:text-story`
on the player's line, `print:max-w-story` and `print:font-story` on home's
article, and `!max-w-story` and `text-story/7` on Compare's output — the scan
reads a class's utility now, through the radius scan's `utilityOf`, rather
than a whitespace-bounded name, so a variant, `!` or the line-height modifier
no longer hides a spelling)* — and its calibration, the recipe found exactly
once, fails with the lexer made blind; *is spent wherever the story is set*
(at least fourteen holes) fails with Compare's output losing the recipe. The
faces describe's pairing test, *never sets the story step without the story
face*, is a test of the recipe now, and fails with `font-story` taken out of it.
In `ReadingPage.test.tsx`, *sets the story to its measure in its own face, and
gives the paper that back too* fails with the article's `print:max-w-none`
removed, with the recipe lacking the measure, and with a passage's paragraph
given a measure of its own. In `PlayPage.test.tsx`, *holds each paragraph of
story to it, and leaves the composer the column* — the player's line, a
finished turn's prose and a streaming one — fails with the column spending
`max-w-story`, with the recipe lacking the measure, and with the turn being
written put back on the bare pair. `HomePage.test.tsx`'s reading-column test
asserts the story measure on the article and fails with it back on
`max-w-reading`. *Not looked at in a browser* — none is installed where this
was built.

**Entry after: 310.37 kB** of a 315 ceiling (310.33 before; the recipe is
imported at five sites), **CSS 7.99** (7.98 before: the new token and its
utility) — gzip level 9 over the files `index.html` pulls, the budget test's
method.

***After review, 2026-10-13*** — a review of the stage's diff, each finding
verified before it was acted on, found that the stage missed its own target,
that its scan could be walked round, and that the corpus was behind the code in
four places.

**Seventy `ch` held nearly ninety characters, not seventy.** The premise struck
in *the target, and why* above was never measured, and no face in the stack is
the face it supposed. A `ch` is the advance of the zero, and a serif's zero is
wider than its running text. Measured here from advance widths — Bitstream
Charter's AFM file, and PIL's `getlength` at 1000px for the TrueType faces —
over 1,262 characters of English novel prose, spaces and punctuation included,
in thousandths of an em:

| Face | The zero | Running prose, on average | Ratio | `70ch` holds | `55ch` holds | `55ch` is |
|---|---|---|---|---|---|---|
| Bitstream Charter | 556 | 434 | 1.28 | 90 characters | 70 | 30.6em |
| Liberation Serif | 500 | 397 | 1.26 | 88 | 69 | 27.5em |
| DejaVu Serif | 636 | 507 | 1.25 | 88 | 69 | 35.0em |

Two other samples, the prose of 10 and of `CHANGELOG.md` with markdown and code
taken out, put the ratio between 1.26 and 1.30 and `55ch` at 69 to 71
characters in every face. Sitka Text, Cambria and Noto Serif are not installed
here and were not measured, and Charter on macOS stands in the table only
through Bitstream Charter, the same design; a real line on each platform is
still §3.1's standing row, a person's look. By the same measurement the measure
this stage replaced, 45em, held about 89 characters of DejaVu Serif, 104 of
Charter and 113 of Liberation Serif, so the audit's *ninety to a hundred* was if
anything low.

So the step is **`--container-story: 55ch`**. That is §0.4's target converted
rather than a new one: about seventy characters of the story face. The three
comments that state the value — `index.css`'s, the `story` recipe's and the
test's — say why it is 55, and give the figures.

**The chat row changes, and Compare's holds.** At `55ch` the cap is 27.5em to
35em in every face measured, under the 42.5em a chat line has beside its
portrait, so a chat line is capped like every other paragraph of story whenever
the window gives the column its width. Compare's two columns, about 26em each
side by side, stay under the cap in every face measured, Liberation Serif's
27.5em being the narrowest, so that row stands, though not *well inside*. The
recipe's docstring says both, and Compare's call site says its own.

**The band is fifty to sixty `ch`**, and the test's comment gives the ratio it
assumes: the sixty to eighty characters typographers cite is about 48ch to 64ch
at 1.26, and the band is tightened round the 55 that is seventy. *Holds the
measure in characters, about seventy of them* fails with the step at `70ch`
(*expected 70 to be less than or equal to 60*), at `45ch`, at `62ch`, at
`38rem` and undeclared, and passes at `50ch` and `60ch`, the band's two ends.

**The scan could be walked round.** *Is spelled nowhere but the recipe* matched
the three names bounded by whitespace, so a class under a variant (a breakpoint,
`print:`, a state), or with `!` or a line-height modifier, was not read as the
step, the face or the measure it sets. P12A.8, the phone stage, is the one most
likely to write such a class. The scan now reads each token through
`utilityOf`, which is hoisted from the radius scan to module scope beside
`strip` and `literals`, with its body unchanged; the column's check in *spends
it on the prose* reads the same way. With the old scan, each of the following
stayed green: `sm:font-story` and `md:max-w-story` on an editor's heading,
`md:text-story` on the player's line, `print:max-w-story` and
`print:font-story` on home's article, and `!max-w-story` and `text-story/7` on
Compare's output. With the new scan, each one fails (*expected [ Array(1) ] to
deeply equal []*), and `md:max-w-story` on the column fails *spends it on the
prose* as well. Every mutation the record lists above still fails. The
calibration still fails when the lexer is made blind, and it still finds the
recipe exactly once.

**The corpus.** §0.3 said this phase changes nothing in the reading view. That
clause is struck, with a dated note saying what changed. 10 §1.2's `70ch` is
struck with a note beside it. `ui/classes.ts`'s `page` docstring still named
`--container-reading` as 10 §1.2's measure, and `max-w-reading` as home's.
Both are struck now, each with an inline replacement. The P12A row in
[the manual-testing plan](05-manual-testing.md) is brought up to date in a
docs commit after this one.

**Entry after: 310.37 kB, CSS 7.99**, unchanged, by the same method; one value
in the stylesheet changed, and the built `:root` reads
`--container-story:55ch`.

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

***Built 2026-10-13***, under [§0.4](#04-what-the-audit-of-2026-10-13-found-and-what-each-finding-decides)'s
decisions for this stage. The server half was as the audit found it —
`se.backdrop` and its two arms, `mediaUrlFor`, `selectBackdrop` and
`offerBackdrop`, the reuse key, and `se.backdrop.on` gating both generation and
the stager's place question, all built and working — so what was missing was
the client, and a way to choose.

**Behind the column.** `play/Backdrop.tsx` draws the stage region as a layer
behind the window — `fixed inset-0 -z-10`, `object-cover`, **`max-sm:hidden`**
(the codebase's phone idiom) and `print:hidden` — decorative: `alt=""` on each
picture and the layer `aria-hidden`, because the widget's label, *Scene*, names
the region and not the picture. It is keyed on the **region**, not the widget:
`stagePicture` reads the first `image` surface whose region is `stage`, and the
message region's sprites keep `ModeRegion`'s inline `<img>` and their label.
`ModeRegion`'s `region` union no longer admits `stage`, with a dated note, so
the in-flow arm cannot be reached for it by accident. **The reading column takes
the veil only while a picture shows** — `veiled`, `bg-veil` with two more
classes this section's next list says why — and with none its class list is the
one it had, which a test holds. *(2026-10-13, after review: `veiled` is a
marker now, `data-veiled`, and `<main>` paints the veil under the column — see*
After review *below; the column's class list is the same with a picture or
without.)* A picture that fails to load (`onError`: an
object deleted, a file gone) is reported up (`useStage` remembers the last one
lost) and the page treats it as no backdrop: no layer, no veil.

**The crossfade** is `crossfade` in `ui/classes.ts`, beside `reveal` —
`transition-opacity duration-arrive ease-swap`, with a `waiting` and a `shown`
state, the first of the five motions [P12A.6](#p12a6--motion-five-of-them)
names. A new picture is drawn over the old one, waiting, and shown once its
pixels have arrived; the old one stays drawn underneath until the next change,
so the stage never passes through an empty frame and nothing has to wait for a
`transitionend` that a zeroed duration never fires. *Reduced motion, confirmed
in the built stylesheet rather than assumed*: the utilities keep the token —
`.duration-arrive{--tw-duration:var(--transition-duration-arrive);transition-duration:var(--transition-duration-arrive)}`
and `.ease-swap{--tw-ease:var(--ease-swap);transition-timing-function:var(--ease-swap)}`
— and `@media (prefers-reduced-motion:reduce){:root{--transition-duration-respond:0s;--transition-duration-arrive:0s;--default-transition-duration:0s}}`
zeroes it, so the new picture is simply there. Now that something spends them,
`:root` carries `--transition-duration-arrive:.3s` and `--ease-swap`, which
P12A.0's record said Tailwind leaves out until then.

**Choose.** *Choose a backdrop…* (`play/ChooseBackdrop.tsx`) sits beside *Set
the scene*, under the same condition, and opens a `ui/Dialog` listing **both
arms**: the background renditions the session holds with pixels, newest first,
and the pictures on what the session uses — its treatment, its setup, the Worlds
it is in, its lorebooks and their entries, and its cast — grouped under whose
they are, with the picture's label or its entry's name or a number. **A small
server endpoint, `GET /sessions/:id/backdrops`** (`renditions/candidates.ts`),
**rather than the client stitching library queries**, because stitching would
have made the browser a second reader of [04 §9.1](../04-schemas.md)'s session
row — the lore links and the treatment's own, the World membership, the cast's
arrivals — and a second resolver of a `MediaSelection`, which `ModeRegion`
refuses for the stage's own surface. The route follows each reference with the
function the engine follows it with (`resolveLore`, `resolveCast`'s union, the
index's *Used by*) and builds each URL with `mediaUrlFor`, now exported, so a
thumbnail and the stage cannot disagree about an address; the client's
`selection` is typed `unknown` and sent back unread. Choosing writes, in order,
**`se.backdrop.on` = `false`, then `se.backdrop` = the selection**, both through
the existing `PUT /sessions/:id/channels/:key` as a person's effect — **two
engine turns on the record**, two empty rows in the transcript, both rewinding
with the tree. **No backdrop** writes `false` and then `null`. The dialog's
sentence says that choosing stops the story staging its own and that switching
*Stage a backdrop* back on hands the choice back; its words are a `labels`
table, `play.backdrop`.

**The promises are true now, and say so**: `renditions/backdrop.ts`'s *"can
still be chosen by hand"* and its `{ kind: 'user' }` caller,
`import/aventuras/pictures.ts`'s *"chosen by hand in a mode that shows a
backdrop"* and the same sentence in [the API reference](../../api.md), each with
a dated note; the import review's user-facing sentence in
`library/note-labels.ts` names the control now, its old clause struck in the
comment above it. [10 §2.3](../10-ui-surfaces.md) has a dated record of what
was built and how off works, and the user guide's *Pictures* has *Choosing a
backdrop*.

**What the stage text said and what turned out different:**

- *"Behind the column"* needed **the column to scroll itself** while a picture
  is behind it — `overflow-y-auto` in `veiled`, `max-sm:overflow-visible` where
  the layer is gone. The column is `h-full`, the transcript's own scrolling
  depends on that, and with up to thirteen blocks above the prose (§0.4) its
  content runs past its box and `<main>` scrolls it: a background stops at its
  box, so everything past the first screenful — the composer among it — would
  have been drawn on the bare picture. Found by reasoning about the layout, not
  in a browser, and not in any plan. *(2026-10-13, after review: the problem was
  real and this was the wrong answer to it. A column that scrolls itself is a
  second scroller: its `sr-only` labels still made `<main>` scroll, so the
  veiled box slid off the top and left bare picture under it, and switching
  which box scrolls threw the reader's place away whenever a picture came or
  went. `<main>` stays the one scroller and paints the veil — see* After review
  *below.)*
- *A layer behind the column* is **a portal into `document.body`**, not a child
  of the page: a `fixed` element is fixed to the nearest ancestor with a
  transform, a filter or containment, and the column and `<main>` are where a
  later stage puts one — P12A.6's motions. Outside every box the page owns, it
  cannot be captured.
- *"`--color-ink` on the story column clears 4.5:1 whatever is behind it"* — and
  `ink-muted` and `ink-subtle`, as §0.4 decided and P12A.0's pairs measure.
  **`ink-faint` cannot**: it would need the veil at 99.5%. The play column still
  sets fine print in it — field hints, `Fine`, a text widget's label — so over a
  backdrop that print falls below its floor. It is tooling rather than prose,
  and most of it leaves the column with [P12A.5](#p12a5--the-column-that-grew-seven-disclosures)'s
  move; T1's walker should look at it.
- *"Choose-an-image … an uploaded image, or one already in the library"* (§1.2)
  is **chosen from what the session uses**, §0.4's narrowing: an upload goes
  into a library object first, through the galleries that exist. So
  [T0](#31-the-critical-list-and-why-each-row-is-on-it)'s *image on disk* has
  to go onto the session's treatment, a lorebook entry, a character or a World
  before T1 can choose it — a sentence for the walker, not an edit to the row.
  *(2026-10-13, after review: "the galleries that exist" are a lorebook's two —
  the book's Pictures and an entry's strip. A treatment, a setup, a character
  and a World have no picture editor, so their pictures arrive only by import
  or through the API, and T0's image goes into a lorebook the session uses. The
  dialog's empty sentence, the guide and 05's note to the walker said
  otherwise, and are corrected.)*
- ***Set the scene* and the new control were hidden until *Stage a backdrop* had
  been flipped**, which no audit named. The session read sent
  `renditions.backdrop` when `se.backdrop.on` was **in the channel map**, and a
  session's map starts empty, so the condition meant *written on this path*,
  not *declared by the mode* as its own docstring said — and the guide had
  documented the result, rewinding past the first flip hiding the button again.
  It is `channelInPlay` now, the channel route's own question, with a dated note
  at the route; the guide's sentence is rewritten.
- *Always both writes*, even when the switch already reads off: the page's idea
  of the switch can be stale (another tab, a rewind), and the write is what makes
  the pick hold. A **refused** first write stops the second, and the dialog says
  the choice did not take: a pick the next turn would overwrite is worse than
  none.
- ***What §0.4's decision leaves open***: a staged background **already being
  drawn** when a person chooses still lands, and is shown, overwriting the pick
  once — the worker shows every finished background whatever the switch says,
  and *Set the scene*, which works with staging off, depends on exactly that. A
  rule that told the two apart (a background its turn's render step requested
  is staged; one from *Set the scene* is not) would be the new rule §0.4 chose
  not to write, so it is not written here; it is said in 10 §2.3's record and
  the guide, and it is a question for the owner.
- *The dialog off the entry* was measured rather than assumed: behind a
  `lazy()` the entry came to **314.06**, worse than **313.75** static (before
  the import sentence's last words) — the
  split imports what the entry already holds, the case the budget test's raise
  note records. It stays static.
- *Not looked at in a browser* — none is installed where this was built. The
  layer's stacking (behind `<main>`, under the header's, the dock's and the
  footer's `bg-surface`), the crossfade and the column's scrollbar are T1's to
  see.

**Tests, each checked against a mutation and restored.** *(2026-10-13, after
review: and `PlayPage.test.tsx`'s* offers no choice for a mode with no backdrop
*fails with Choose a backdrop… moved outside the `renditions.backdrop`
condition; `ChooseBackdrop.test.tsx`'s* says where pictures come from when the
session uses none *fails with the empty arm dropped and with No backdrop
offered only beside a non-empty list. Neither had been seen to fail.)* In the new
`routes/backdrops.test.ts`, *offers a picture from each thing the session uses,
and nothing from what it does not* — a fixture with a picture on every kind the
session uses and the same kind unused beside each — fails with the Worlds not
followed, with every treatment in the library offered, with set members
(`expression`) offered, with an actor offering every picture but set members,
with renditions offered without pixels, with illustrations offered, with
arrivals not followed, with the entry's name not used as a label, with the setup
not followed, and with the newest-first order dropped; *marks the one the stage
is showing* fails with `current` never set; *is staged from the address it was
offered under* (a row written the way the dialog writes it, read back off the
session's `stage` surface) fails with a rendition URL built in the module rather
than by `mediaUrlFor`; *answers not-found for a session whose mode stages no
backdrop* fails with the route's check removed; and the session read's *are there
in a Scene session before anybody has touched the switch* fails with the old
`in session.channels` condition, and *are not there for a mode with no backdrop*
with the condition forced true. In the new `play/Backdrop.test.tsx`: *drawn
behind the window, outside the page, decorative and gone on a phone* fails with
the layer drawn in place, with the label as `alt`, and with `max-sm:hidden`
removed; *draws no frame at all* fails with an empty layer for nothing; *says so
when a picture will not load* fails with `onError` unwired; the crossfade's
*fades the new picture in over the old one* fails with the picture shown before
its pixels arrive and with the old one dropped at once, *shows a room it has
drawn before* fails with only the last arrival remembered, and *brings nothing
back underneath once it has been turned off* fails with off keeping the old
picture; *is the stage region's picture, and a sprite is not* fails with the
region ignored and with the kind ignored. In `PlayPage.test.tsx`'s new *the
backdrop*: *draws the stage behind the column rather than in it, and veils the
column* fails with the layer drawn in the column, with the stage drawn in flow
under its label as well, and with the veil never applied; *draws no frame and no
veil without a backdrop* fails with the veil always applied; *treats a picture
that will not load as no backdrop at all* fails with the failure not passed up;
*offers a choice beside Set the scene* fails with the control removed from that
row. In the new `play/ChooseBackdrop.test.tsx`: *lists both arms as the server
sent them, under whose pictures they are* fails with one heading for every
picture and with the showing one unmarked; *says that choosing stops the story
staging one* fails with the sentence dropped; *turns staging off and then writes
the choice, as it was sent* fails with the two writes swapped and with the
selection rebuilt rather than sent back; *writes no backdrop as staging off and
then nothing* fails with the switch left alone and with `undefined` for `null`;
*chooses nothing when the switch refuses* fails with the refusal ignored; *does
not offer a picture whose thumbnail will not load* fails with the error
unhandled. `ModeRegion.test.tsx`'s image tests moved from the stage region to
the message region — the image arm's remaining home — and its no-frame test's
stage half is `Backdrop.test.tsx`'s now. `i18n/catalogue.test.ts` exempts the
`crossfade` recipe, a table of classes, as it exempts `page`.

**Entry after: 313.77 kB** of a 315 ceiling, **CSS 8.16** — **312.25 and 7.99
before**, at `e93cab0e`, the merge that brought P16's follow-ups under the
phase after P12A.1's 310.37 — gzip level 9 over the files `index.html` pulls,
the budget test's method. **+1.52 kB**: the layer, the dialog, the two hooks,
the recipe, and the import sentence's new words. **1.23 kB is left** for
P12A.3 onward, which is the next stage's first number to read.

***After review, 2026-10-13*** — a review of the stage's diff, each finding
verified before it was acted on, found ten things: that the column's veil
broke the page's scrolling in two ways, that the layer fetched on a phone and
could draw one picture twice, that the dialog and the guide sent people to
galleries that do not exist and claimed who made an imported story's
backgrounds, and that the corpus was wrong or unchecked in four places.

**The column scrolled itself, which was the wrong answer to a real problem.**
Two findings, one remedy. *The first*: the veiled column was a scroller but
not a containing block. An absolutely positioned descendant belongs to its
nearest positioned ancestor, so every `sr-only` label in the column — the
composer's own among them — was still `<main>`'s, sat at its static position
below the fold, and gave `<main>` a scroll range as well. On a laptop-height
window that was two scrollbars; scrolling the outer one slid the veiled box up
and left a band of bare picture under it (268px in the reviewer's repro), with
the composer clipped inside a scroller nobody had found. Its narrow remedy was
`relative` on the column, `Shell.tsx`'s 2026-10-07 remedy for `<main>` one box
further in. *The second*: switching which box scrolls throws the position away.
A first staged picture arriving, a chosen one failing to load and *No backdrop*
each took a reader at the bottom of the story back to the top of the panels, and
while a picture showed, the wheel and the keyboard did nothing outside the
column — the layout pushed around on a change, which 10 §2.3 rules out.
`relative` would have fixed the first and not the second. The second's remedy
takes the column's scroller away, and the first's cause with it, so it is the
one built, and the column is not made `relative`.

So **`veiled` is a marker**, `{ 'data-veiled': '' }`, spread onto the column
while a picture is staged, and the column's class list is the same with a
backdrop or without. **`<main>` paints the veil** — `veil` in `Shell.tsx`, four
classes under `sm:has-[>[data-veiled]]:`: a gradient from `--color-veil` to
itself, not repeated, centred, sized `min(100%, var(--container-reading))` by
`100%`. A scroller's own background stays put while its content scrolls
(`background-attachment: scroll`, the default), so the strip is under the column
on every screenful and the column scrolls over it. `<main>` has no padding and
the column is `page.reading`, so the strip is the column's footprint, an open
dock included. `<main>` is `relative`, so it is painted over the layer at
`-z-10`. Nothing changes overflow, so `<main>`'s `scrollTop` survives every
arrival, failure and switch-off. The built stylesheet has each rule inside
`@media (width>=40rem)` as
`.sm\:has-\[\>\[data-veiled\]\]\:bg-center:has(>[data-veiled])`. *From `sm` up
only*, matching the layer's `max-sm:hidden`: the column's `bg-veil` had been on
at every width, and below the breakpoint the veil over the canvas was the
canvas, so nothing there looks different. `Backdrop.tsx`'s `veiled` bullets, the
column's comment in `PlayPage.tsx` and 10 §2.3's *the column scrolls itself*
are struck, each with a dated note.

**`tailwind-utilities.test.ts` could not see the strip.** Its `classShaped`
refused a token holding `>`, `,` or `_`, so all four of the strip's classes were
skipped: with the old line, `bg-no-repeat` misspelt in the strip passed. It
admits them now, with a dated note; the test passes on the build, and fails with
`bg-no-repeat` or `bg-size-[…]` misspelt in `Shell.tsx`.

**A phone downloaded what it never showed.** `max-sm:hidden` stops the drawing
and not the fetch, so every phone session with a backdrop fetched each
full-size picture and never drew it. Both of the layer's pictures are
`loading="lazy"` now: a picture that is not displayed never comes near the
viewport, so it is never fetched, and from `sm` up the full-window layer is in
view at once and loads as before. The crossfade already waits for `load`.

**Going A → B → A before B had arrived drew A twice**, under and on top, as two
siblings with one key — a quick pick and its Undo, or a staged picture a rewind
replaced before its bytes came. The picture coming in is never kept underneath
now: it has arrived already, so it is shown on top at once.

**The dialog sent people to galleries that do not exist.** Only a lorebook has a
picture editor, the book's *Pictures* and an entry's strip. The empty list's
sentence, the guide's *Choosing a backdrop* and 05's note to T1's walker named
the treatment's, a World's and a character's as well. The server's listing of
those kinds is right, since an import or the API can fill them, and it is
unchanged. The sentence keeps its first clause and sends a person to a lorebook
the session uses, and says that pictures already on the other kinds, from an
import, are offered too. The guide's sentence is corrected in place, since it is
user prose. 05 has a dated correction after its walker note, and the T0
sentence above has one beside it.

***Made in this session* claimed who made the pictures.** An Aventuras story's
backgrounds were drawn in Aventuras by another model, and a session export's can
come from another install, but both are this session's renditions and were
listed under that heading. That is the provenance claim the import's notes go
out of their way not to make. The heading is ***This session’s own
backgrounds*** now. `candidates.ts`'s `source` docstring and the comment over
the renditions block say *held*, not *made*. 05's X19 note has the old name
struck and the new one beside it, and the guide names the heading.

**The corpus.** `index.css`'s motion block said nothing spends its tokens, and
the crossfade spends `arrive` and `swap`: it has a dated note after the
sentence, naming tokens only, since a class named in a comment is emitted. The
guide said the text stays *as readable* over a backdrop as without, which this
stage's own `ink-faint` finding contradicts; it says now that the story's text
stays clearly readable and the faintest fine print is harder to read over a
bright picture. `docs/api.md` struck a phrase it had never contained; that
became a plain dated note saying what the session read did until this stage.
And two of this stage's tests had never been seen to fail. They have now, as the
dated note on the tests paragraph above records. 10 §2.3 also gains a dated note
on the galleries that exist (*today, a lorebook's*) and one on the phone, which
no longer downloads the pictures it hides.

**Tests after review, each checked against a mutation and restored.**
`PlayPage.test.tsx`'s *draws the stage behind the column rather than in it*
asserts the marker, no `overflow-y-auto`, and a class list equal to the
no-backdrop one. It fails with `overflow-y-auto` put back on the veiled column,
with `bg-veil` put back, with the marker never set, and with the marker on the
column's first row instead of the column. *Draws no frame and no veil* and
*treats a picture that will not load as no backdrop* assert the marker absent,
and both fail with the marker always set. The new `shell-layout.test.tsx`
*the backdrop's veil*, on the real router, holds the join between the two files.
*Is painted by main under the column* fails with the strip's classes taken off
`<main>`, with the marker renamed in `Backdrop.tsx` alone, with the marker on the
column's first row, with `overflow-y-auto` back on the column, and with
`page.reading` moved off `max-w-reading`. *Is asked for by nothing on a session
with no backdrop* fails with the marker always set. In `Backdrop.test.tsx`,
the layer test's `loading` assertion fails with `lazy` taken off the top
picture, and the crossfade's fails with it taken off either picture. The new
*takes a room back before the next one has arrived without drawing it twice*
fails against the old line, with both pictures drawn; it also spies on
`console.error`. In `ChooseBackdrop.test.tsx`, the first test finds the new
heading and fails with the old one, and the empty-list test asserts the lorebook
and fails with the old sentence. jsdom applies no stylesheet, so none of this
shows the strip being drawn: that is T1's look, and 05's note now asks T1's
walker for the strip under the composer, one scrollbar, and the wheel and
**Page Down** over the picture. *Not looked at in a browser*, still: none is
installed where this was built.

**Entry after: 313.90 kB** of the 315 ceiling, **CSS 8.34**, against **313.77
and 8.16** at `8e2f7c29`, measured the budget test's way (gzip level 9 over the
files `index.html` pulls). JavaScript is **+0.13 kB**: the corrected sentences,
the `loading` attributes, the A → B → A guard and the marker's spread. CSS is **+0.18**: the strip's
four rules. 0.01 of that is `.bg-veil` and `max-sm:overflow-visible`, which
nothing uses now but which the struck bullets in `Backdrop.tsx` name, so
Tailwind's scan keeps them. **1.10 kB is left** for P12A.3 onward.

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
- **A dialable density** ([26 E10](../26-open-questions.md)). Still open, still
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
written claim holds, and none of them asking whether it is beautiful. **When ~~S~~
*T (2026-10-13, §0.4)* has results, the phase closes**, and R4 can read a corpus the build matches.
