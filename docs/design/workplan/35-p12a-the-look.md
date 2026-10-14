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
  move; T1's walker should look at it. *(2026-10-14, from [P12A.4](#p12a4--the-hud-and-whether-it-can-write)'s
  review: the HUD strip is the part of the column that does not leave with
  P12A.5 — it is what stays over the picture — and its labels and its* not set
  *were set in `ink-faint`. They are `ink-subtle` now; see that stage's* After
  review.)*
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

***Built 2026-10-13***, under [§0.4](#04-what-the-audit-of-2026-10-13-found-and-what-each-finding-decides)'s
decisions for this stage, which were binding on it. Six things, one of them on
the server.

- **A blank card answers 404.** `GET /library/actors/:id/avatar` compares the
  card's picture — its `IHDR`, `PLTE` and `IDAT` chunks, type and data, walked
  by hand — with the 1×1 transparent picture `blankCardPixels()` writes, and
  answers `404 not-found` when they are the same (`isBlankCard`,
  `library.ts`). The download and a copy still hand the blank card over whole:
  the card is still the file, and only *show me the picture* has no answer.
  [The API reference](../../api.md) has a dated note.
- **One face, `ui/Face.tsx`**, on the tile `auth/tile.ts` drew for the sign-in
  gallery, **moved to `ui/tile.ts`** with its inputs renamed — `handle` and
  `displayName` became `id` and `name` — so an actor's hue is its id's and an
  account's its handle's. A picture when there is one, the tile when there is
  not, and the tile again on the `<img>`'s error; it remembers *which* source
  failed, so a new one is tried. Four sizes in one class table, the editor's
  header on `rounded-media` because it is the card's own picture.
  `play/Portrait.tsx` is the actor's face on it, keeping its ranking — a
  `reference` medium, then the card — and its own `initialOf` is gone; its
  comment's false clause about 404s has a dated note saying it is true from
  today. `auth/Gallery.tsx` and `settings/UserSettings.tsx` import the moved
  tile. The actor editor's header is the face: the card's picture, the tile
  for a draft — from the name being typed — and the tile when the route answers
  404 for a blank card, where it drew an empty grey square in both.
- **A face on every cast row**, not only a chat's, the picture by the content
  hash from the library's actors query as every face site already did.
- **The player's own line.** The page sends `input.actorId` — the persona it
  plays, `roster.persona`, `null` for nobody in particular — with every move
  (`api.ts`'s `submitTurn`, inside the input; the route already took it —
  `routes/sessions.ts`'s input schema and `payloadOf` — and nothing sent it). A past line draws the face its own record names and **no face when
  it names none**: chat's `turn.input.actorId ?? personaId` is gone — the
  `personaId` prop with it, so the fallback cannot come back by a default — and
  the non-chat line in `TurnView` draws `PlayedAs` beside the line when the
  record names somebody. **The correction path**: no *you play* control
  existed anywhere, in a chat or out of one, and `LorePanel.tsx`'s note called
  that a deliberate absence; the cast panel has one now, **You play** — a
  choice and **Play as them**, nothing written until the button is pressed,
  the persona through `PUT /sessions/:id/cast` with the roster's actors as they
  were. The face on a line is a button that hands *You play* the keyboard,
  which scrolls it into view; where the page draws no cast panel, the face is
  a face and not a button. `LorePanel.tsx`'s note has a dated note.
  *(2026-10-14, after review: sending `actorId` changes one more surface, the
  reading view — its Markdown and text copies and Print with it. A move played
  as the persona is headed with the persona's name now, *Ned said*, where it
  read *You said*, because `prose.ts` keeps *You* for a move whose `actorId`
  is `null`, [polish §11](06-polish.md)'s rule. That agrees with the chat's
  line, which showed that name already through the `?? personaId` fallback
  removed above. Older moves in the same session keep *You*, since their
  records name nobody, and `prose.test.ts`'s first case already holds a named
  move. The guide's* Reading a story *says so now.)*
- **Mentions.** `runsFor` (`library/search.ts`) carries each hit's span, so a
  run is no longer only text and a flag, and the overlay maps a mark to its
  target by what it was cut from rather than by counting. A mark is the
  trigger of **`ui/Popover`**, built here — non-modal, anchored beside its
  trigger and scrolling with it, closed by its trigger, Escape or a press
  outside, Escape handing the keyboard back and stopping there, no trap
  *(2026-10-14, after review: and closed by focus leaving it, the keyboard's
  press outside — see* After review *below)* — and
  opens a card: the actor's face and name, *Matched by "…"*, **Open** the
  actor's editor, the sentence that names the correction (*a name is marked
  when it is a character's name or one of their aliases*) and a link to
  **Edit …'s aliases**, which the editor lands on: `#aliases` wraps the field,
  and the editor gives it the keyboard as it is first drawn, since the router's
  own scroll to a hash runs before the editor has its object. An actor the
  library no longer has keeps the name the span recorded and offers no links.
  **No new route.**
- **The library**: an actor's row on the shelf draws its face beside the name,
  which stays the link, and an actor's own page opens on it; no other kind
  draws one.

**What the stage text said and what turned out different:**

- *"No new server route is expected"* — none was built. A route's answer
  changed instead, which is §0.4's decision: a blank card's `200` became a
  `404`. *The bytes* §0.4 names are taken as **the picture**: a card's file
  holds its own object beside the blank's two chunks, so no two blank cards
  are the same bytes and a file comparison would never match.
- *"`api.avatarUrl` and the content hash are enough"* — they are, and §1.1's
  *"`CastRow` carries `actorId` and the avatar URL is derivable from it"* is
  not quite: a row has no content hash, so a row's face reads the library's
  actors query for it, as every existing face did.
- *"A second invention here would be the third spelling of one idea"* — the
  second was already there (`Portrait`'s one code-point initial on a grey
  disc), so this stage removed one rather than avoided one.
- *"Each … gets the path from the face to the place the claim is corrected"* —
  for three of the four places. The cast row is its own correction surface;
  the player's line leads to *You play*, which had to be built; the mention
  leads to the aliases. **The object header's picture has none**: the editor
  shows the card and does not replace it, as its note says, and changing a
  card's picture in the app is not something any surface offers. That is
  [P12A.7](#p12a7--editors-section-jumps-and-an-identity-header)'s header to
  carry, and `library/note-labels.ts`'s import sentence *"Add a picture in the
  editor instead"* still points at a control that does not exist — found here,
  left for that stage.
- *`ui/Popover`* is built here rather than at P12A.4, which §0.4's P12A.4
  bullet names as its builder, because this stage runs first; P12A.4 reuses
  it. **A press outside does not move focus**: Escape gives the keyboard back
  to the trigger, while a press already put focus where the person meant it
  to go, and pulling it back would undo the click. Its content is phrasing
  content, because a mention is a word inside a `<p>`.
- *Decided inside the stage*: **a redo is played as whoever made the move**
  — it sends the turn's own `input.actorId`, as it sends its words, its kind
  and its pictures — not as today's persona. A line whose record names an
  actor the library no longer has draws that id's colour under *You*, the name
  chat already used there, never the id.
- *Not done, and said*: a **shadowed** actor's face is the winner's, because
  the avatar and media routes take no address; and the card's panel is
  `w-64` from its trigger's start, so a mark near the end of a line on a
  narrow phone can push past the column — [P12A.8](#p12a8--the-phone-rules)'s
  to look at.
- *Tests that held the old answer*: `routes/history.test.ts`'s *serves the
  avatar with the card's bytes* made an actor through the API — a blank card —
  and asserted `200`, which is the answer that drew the empty circle; it is
  two tests now, below. `import-aventuras-transports.test.ts` digested each
  actor's picture through the avatar route, and reads it through the download
  now, since a character imported without a portrait has a blank card.
  `PlayPage.chat.test.tsx` asserted *Ned* — today's persona — on a turn whose
  record names nobody, which is the claim §0.4 reverses. `LibraryPage.test.tsx`
  and `ObjectDetailPage.test.tsx` replace the whole `api` object in their mocks
  and now pass its two address builders through; `CastPanel.chat.test.tsx`
  finds a row's name as a `span`, since *You play* offers the same name.

**Tests, each checked against a mutation and restored.** In
`routes/history.test.ts`: *serves the avatar with the card's bytes when the
card has a picture* — a 4×4 card and a 1×1 opaque card with the blank's own
header — fails with every card treated as blank, with only the header compared
(the 1×1, *expected 404 to be 200*), and with nothing but `PLTE` compared;
*answers not-found for a blank card, and still downloads it whole* fails with
the route's check removed. In the new `ui/Face.test.tsx`: *falls back to the
tile when the picture answers with an error* fails with `onError` unwired;
*tries a new picture* fails with the face remembering *that* a picture failed
rather than which; *keeps an id's colour through a rename, and gives another
id another* fails with the hue taken from the name. In the new
`ui/Popover.test.tsx`: *closes on Escape and gives the keyboard back* fails
with the refocus removed and with Escape let through to an enclosing handler;
*closes on a press outside* fails with the outside listener removed; *stays
open for a press inside it* fails with the inside check removed; *opens …
and hands the keyboard to what is inside* fails with focus left on the
trigger; *lets Tab leave it* fails with Tab trapped inside. One mutation
**survived and is equivalent**: focusing the trigger from the outside press,
because a press's own focus lands after its `pointerdown`, on the control
pressed or on the page, so the trigger never keeps it. In `play/MentionOverlay.test.tsx`: *names the
actor it matched, the words it matched by, and both corrections* fails with
`runsFor` dropping the span (the three existing tests that draw a mark fail
with it too), with the aliases link losing its hash, with *Open* gone, and
with the card naming the matched words instead of the target; *opens the span
the mark was cut from, not one counted to* — two marks, the spans out of order
— fails with the span found by counting hits over the unsorted list, and with
links offered for an actor the library lacks. In `play/CastPanel.test.tsx`:
*draws a face on every row, outside a chat as in one* fails with the face back
behind `chat`, and with the row's card not passed; *changes the persona when
asked, and only then, with the roster whole* fails with the choice writing on
change and with the actors dropped; *says who the session is played as, even
somebody the library no longer has* fails with that option removed. In
`api.test.ts`: *sends who a move is played as inside its input, null included*
fails with `actorId` left off the wire and with `null` dropped. In
`play/PlayPage.test.tsx`: *sends the move as the persona it is played as, and
as nobody without one* fails with `actorId` taken out of the send; *draws no
face on a line whose record names nobody* fails with a face drawn for every
line; *draws the face its record names, and opens who you play from it* fails
with none drawn for any and with the face not wired to *You play*; *redoes a move as whoever made it* fails with the redo sending no
`actorId`. In `play/PlayPage.chat.test.tsx`: *draws no face and no persona on
a line whose record names nobody* fails with a face drawn from a fallback id
and with the persona's name put back; *opens who you play from the face* fails
with the face not wired. In `editor/ActorEditorPage.test.tsx`: *shows the
card, and the tile in its place* fails with no picture asked for; *gives a
draft a face from the name being typed* fails with the name not passed; *lands
on the aliases* fails with the landing removed. `LibraryPage.test.tsx`'s
*draws an actor's face beside its name, and no face on another kind* fails
with the face on no row and on every row; `ObjectDetailPage.test.tsx`'s
header test fails with the face gone. `ui/tile.test.ts` moved with its module,
its inputs renamed and its assertions unchanged. `i18n/catalogue.test.ts`
exempts `Face`'s size table, a table of classes. *Not looked at in a browser* —
none is installed where this was built.

**Entry after: 315.37 kB, CSS 8.39** — **313.90 and 8.34 before**, at
`2a31f971` — gzip level 9 over the files `index.html` pulls, the budget test's
method. **+1.47 kB**, over the 315 ceiling by 0.37, so
`tools/entry-budget.test.ts` is **raised to 320**, with its paragraph saying
where it went: the mention's popover and card 0.61, *You play* 0.14, the rest
the face and its sites. The mention's card behind a `lazy()` measured
**316.27**, worse, for the reason that file's earlier notes give. **4.63 kB is
left** for P12A.4 onward.

***After review, 2026-10-14*** — a review of the stage's diff, each finding
verified before it was acted on, found nine things, two of them the same one:
that *You play* could take itself away, that *Play as them* let a move go out
as the persona just put down, that the popover stayed drawn after the keyboard
left it, that a card opened from a hidden chat line was half transparent, that
the player's line outside a chat could name nobody, that the reading view's
headings changed without a word, and that the corpus said three things that
are not so.

**You play could take itself away.** Two findings, one fault. The panel was
drawn for a cast row or a chat, and a session whose one row was its persona —
a fresh Scene session, outside a chat, with no presence or status written for
anybody — has nothing else. Choosing *Nobody in particular* and pressing
*Play as them* wrote `{ persona: null, actors: [] }`, the refetch brought back
no rows, and the panel went, with *You play* inside it: nothing in the product
could set a persona on that session again, and every face on a line played as
the old persona stopped being a button, since the page offers the press only
where the panel is. So **a roster is a reason to draw the panel**, as a chat
is, for the chat's reason — the control that seats somebody is inside it.
`castPanelShows` takes the roster as a third question, and the page asks the
panel's question with it, which comes to `roster !== undefined` and stays a
call so that the two cannot drift. A session started with no cast at all has no
roster and still draws no panel: nothing was chosen there to take back. The
predicate's docstring and the page's comment over `<CastPanel>` have dated
notes, 10 §13.2's note has one, and the guide says *Nobody in particular*
keeps the panel.

**Play as them settled before the session had caught up.** `useSetCast` voided
its invalidation, so the write was over when the `PUT` was: the choice was
cleared, the select snapped back to the persona just changed away from with the
button live again, and a move sent before the refetch went out with that old
persona as its `input.actorId` — its line wearing for good the face the player
had put down, the stale attribution this stage exists to stop. Two halves, each
closing its own window: the cast the `PUT` answered is written into the session
cache at once, so `roster.persona`, which the composer sends, is right the
moment the write is acknowledged; and the invalidation is returned, as
`useSetChatSettings`' and `useSetHidden`'s are, so the mutation — and each
caller's own `onSuccess`, which clears its choice — waits for the refetch. An
answer with no roster writes nothing, and the second half alone then keeps the
choice on screen. Nothing changed in `CastPanel.tsx`.

**The popover stayed open after the keyboard left it.** It closed three ways,
and Tab past its last link left the `w-64` card drawn over the lines below its
mark, so the next control could sit under it (WCAG 2.4.11, *focus not
obscured*), and Escape did nothing from there, the keystroke no longer passing
through the wrapper; only a pointer could close it. It closes **four ways**
now: `onBlur` on the wrapper, which hears every `focusout` inside, closes it
when focus goes to a real element outside, and leaves the keyboard where it
went, as a press outside does. A `null` `relatedTarget` — the window losing
focus, Safari's button press that focuses nothing — is left alone, since the
`pointerdown` listener already covers presses and closing there would let a
press on the trigger close and reopen it. Focus moving inside never closes it.
The docstring says four, and 10 §13.1 and the mention bullet above have dated
notes. **For [P12A.4](#p12a4--the-hud-and-whether-it-can-write)**: a HUD widget
holding an unsaved value has to commit it on blur, as `TokenField` does, or
Tabbing out of the popover drops what was typed — said in the docstring and
beside that stage's text.

**A card opened from a hidden chat line was drawn at half opacity.** The line
was `opacity-50`, and opacity below one makes a stacking context the card
cannot leave: the next lines' prose showed through it, and later lines' marks —
positioned, and later in paint order — were drawn over its links, in exactly
the case where someone has stopped on that line. **The line is never
translucent now**: its prose is dimmed by colour, `text-ink-subtle` for
`text-ink`, which holds a card without trapping it, and the face, the name and
everything after the prose are ghosted in boxes of their own, none of which
holds a card — the finding named the face and the name, and the box after the
prose keeps the rest of the line looking as hidden as it did. With no stacking
context on the line, the panel's `z-10` takes part in the page's again. *The
finding's smaller alternative*, `has-[[role=dialog]]:opacity-100` on the line,
was not taken: jsdom cannot evaluate `:has`, so it could be held only by its
class string, and the whole line would stop looking hidden while the card was
open. The input line keeps its whole-line ghost, since it draws no mentions.

**The player's line outside a chat could name nobody.** `Face` is decorative
because its name is beside it, and outside a chat the player's line draws the
move's words and the face, no name. Where the page offers no *You play* the
face is not a button, so it was `aria-hidden` initials: a screen reader heard
nothing about who the move was played as, and a sighted reader saw *V* —
though that is the claim §1.1 says this face exists to make visible. `PlayedAs`
takes `nameShown` now: where the caller draws no name and there is no button,
the face is wrapped in `role="img"` named *Played as Vera*, through the
`play.face` table. A chat's line draws the name above the words and passes
`nameShown`, so it is not named twice (*Played as Ned, Ned*). `Face`'s
*Decorative* paragraph has a dated note: a face is decorative when the name is
beside it **or on what holds it**. *The finding's test* set the session's
roster to `{ persona: null, actors: [] }` with no rows; after the first fix
that roster draws the panel and the face is a button, so the test uses a
session with no roster, an import's — which is where a non-chat line can name
somebody with no *You play* to open.

**The reading view's headings changed and nobody said so.** Recorded beside
*The player's own line* above, and the guide's *Reading a story*, which
promised *You did* and *You said* for every move, says what a heading is now —
the character the move was played as, or *You* for a move played as nobody in
particular or from before the character was recorded with it. No code: polish
§11's rule is the one wanted.

**The corpus.** `Face`'s docstring and `tile.ts`'s said `Face` is the one
place the tile is drawn; the sign-in gallery's `DrawnFace` and the settings
preview's `AvatarField` still draw it themselves, and the gallery's `<img>` has
no error fallback. Both docstrings say so now — this stage's own, corrected in
place — and moving the account faces onto `Face`, with two more sizes, is a
scope and entry-budget question left to a later stage. 10 §13.2's note from this
stage counted *who you play* among *the four repairs above*, which it is not
and which `CastPanel`'s own note says it is not; that clause of the note is
corrected in place to say it is built beside them.

**Tests after review, each checked against a mutation and restored.** In
`play/CastPanel.test.tsx`: *is drawn for a roster with nobody in it, and not
for no roster at all* and *stays to be chosen from again after nobody is
chosen* fail with the old two-question predicate, rows or a chat; *keeps the
persona it sent on screen until the session has caught up* — the refetch held,
the `PUT`'s answer carrying no roster so the cache write cannot hide the other
half — fails with the invalidation voided and with the hook's `onSuccess` as it
was. The finding's first test played `actor-ned` and asked that it still be
offered after *Nobody*; a persona the library lacks is offered only while it is
the persona, and this file's library holds Vera alone, so the test plays Vera.
In `play/PlayPage.test.tsx`: *sends a move as the persona just chosen, before
the session is read again* fails with the cache write removed — the move goes
as `actor-vera`; *names the face when it is not a button* fails with the
wrapper removed. In `play/PlayPage.chat.test.tsx`: *names a face that opens
nothing once* fails with the wrapper drawn whenever the face is not a button,
`nameShown` ignored; *opens a mention on a hidden line outside anything that
fades* fails with `opacity-50` back on the line, with the prose's colour dim
removed, with the name's ghost removed, and with the ghost taken off the box
after the prose. In `ui/Popover.test.tsx`: *lets Tab leave it in reading order,
and closes as it goes* fails with the `onBlur` close removed; the new *stays
open when focus goes to no element at all* fails with a `null` `relatedTarget`
counted as leaving, which the Tab test alone let survive; the inside check
removed fails four tests, and *stays open for a press inside it* now also
presses the card's own text. *Not looked at in a browser*, still.

**Entry after: 315.57 kB, CSS 8.39** — **315.37 and 8.39 before**, at
`02b335ce`, gzip level 9 over the files `index.html` pulls, the budget test's
method. **+0.20 kB**: the popover's blur close, the cache write, the named
wrapper and its label, and the panel's third question. CSS is unchanged: every
class the fixes spend was already emitted. **4.43 kB is left** for P12A.4
onward.

### P12A.4 — The HUD, and whether it can write

§1.4. Audit first, then the strip: the *facts about now* widgets in one line
above the prose, each opening in place, each writing through a real state effect
that lands on the record.

*(2026-10-14, from [P12A.3](#p12a3--faces)'s review: `ui/Popover` closes when
focus leaves it, as a press outside does, so a widget here that holds a value
not yet written has to commit it on blur, as `TokenField` does, or Tabbing out
of the popover drops what was typed.)*

***Built 2026-10-13***, under [§0.4](#04-what-the-audit-of-2026-10-13-found-and-what-each-finding-decides)'s
decisions for this stage, which were binding on it. **§1.4's audit answered
first, and §0.4 had already written the answer**: the channel route is complete
and appends a person's effect to the record, so the stage is presentation plus
two fields on what the server sends — no new route and no new kind of record
entry. Seven things, one of them on the server.

- **A HUD entry carries its value and how it is edited.** `ChannelSurface`
  (`sessions/channels.ts`) gains `edit` and, beside an edit and only there,
  `value`. `hudEdit` derives the edit from the schema the channel declares —
  the one its writes are judged against — so a string is `{ kind: 'text',
  nullable }`, a number `{ kind: 'number', integer, nullable, min, max }` from
  the schema's `minimum` and `maximum`, and anything else `null`: an object, an
  `enum`, a `const`, a union. `editableValue` sends a string or a number as it
  stands and `null` for a value a quarantine left in the wrong shape. **An entry
  with an edit stands even with nothing in it**, where a readout with nothing
  to say is still left out. A mode's `text` placed in the `hud` region carries
  the same two fields by the same rule (`modeSurfaces`), since
  [10 §8.0](../10-ui-surfaces.md) defines a channel's `surface` as exactly that
  placement; a `text` in any other region carries neither. The client's
  `ChannelSurface` and `ModeSurface` spell the fields optional, so an entry from
  an older server reads as not editable here. [The API reference](../../api.md)
  and [P7](23-p7-implementation.md) have dated notes.
- **The entry, `play/HudEntry.tsx`**, knows no channel: a strip item showing
  the label and the value, opening in place to a line of text or a number box
  from the edit, or to the sentence *This can't be changed from here* when there
  is none. The write is `useWriteChannel` — `PUT …/channels/:key`, a turn with
  a person's effect. **What was typed is committed on every close but
  Escape** — Save, Enter, Tab away, a press outside, the trigger again — which
  is the sentence [P12A.3](#p12a3--faces)'s review left this stage; Escape drops
  it and hands the keyboard back. A number is held to the whole-number rule and
  its bounds at the box, in the entry's words, before anything is sent; the form
  is `noValidate` so a browser's own bubble does not say it first. A refusal —
  a `200` with the effect unapplied — is said by its class, *Place was not
  changed. That doesn't fit what Place holds.*, in the panel and, once it has
  closed, in the strip after the entry, so a write that did not land never
  looks as though it did.
- **The strip, `play/HudStrip.tsx`**: a region named *The story now*, one
  wrapping line, **directly over the transcript**, holding in order a channel
  that could not be loaded, the channels' entries and a mode's placements, the
  cast, the goal and the hooks. Each opens in place. It is hidden while the
  session loads rather than left out — see below.
- **The four story-now panels moved into it, reused.** `GoalPanel` and
  `HookPanel` were `<details>`; each is a strip item now whose trigger is the
  line its summary showed — *Working toward: …*, *Plot hooks — 1 of 2
  eligible* — and whose panel is what the disclosure held, unchanged.
  `ChannelHealth`'s banner is the strip's first item, in `Alert`'s warning
  tone, its headline and *Your story is unaffected.* said on the item without
  a press, its rows and their two recoveries opened in place. `CastPanel` is
  unchanged and opens from the strip's **Cast** item, which shows the faces of
  who is present — four at most — and *n of m here*, drawn for exactly the
  sessions the panel is (`castPanelShows`). The face on the player's line opens
  the item and hands *You play* the keyboard through `HudStripHandle`.
- **`ui/Popover` grew what the strip needed**: a second placement, `under` —
  flow content, drawn under the strip at its full width whichever item opened
  it, scrolling past 70% of the screen's height — that is **hidden while shut
  rather than unmade**; a controlled form, `open` with `onOpenChange` told which
  of the four ways a close came; and **a stranded keyboard handed back**: a
  close the holder made, or the trigger, that leaves focus inside the hidden
  panel or nowhere gives it to the trigger. A press outside and focus leaving
  still leave it where it went.
- **`ModeRegion` draws the `hud` region**, which the session route has promised
  since [P7](23-p7-implementation.md) and nothing drew: a `text` is a
  `HudEntry`, a `record` or an `image` opens in place under its label, a switch
  and a bar are drawn in the line, all bare, a group's heading inline and
  faint.
- **One spelling of a strip item**, `strip` in `ui/classes.ts`: a line of muted
  text at rest that takes a ground on hover, on the keyboard and while its panel
  is open, and a warning variant for the health item.

**What the stage text said and what turned out different:**

- *"Audit first"* — the audit is §0.4's, and its split answer decided the size:
  *if the route is complete, the stage is presentation*. It was, and it is.
- *"Each writing through a real state effect that lands on the record"* — true
  of every HUD entry, and of the panels' channel writes (presence, status, a
  goal's offers, a hook's Commit), which are what they were. **Four of the
  panels' controls were never channel writes and still are not**: *Add to the
  cast* and *You play* are `PUT /cast`, *Set an objective* is a goal written to
  the session file, adding a hook is the pool's, and *Save this to…* writes the
  library. Reused, not rewritten; none of them is a fact a HUD shows.
- *§1.3's proposal*, which moved the hooks to the workbench — **10 §10.1 won**,
  §0.4's decision: the hooks are the strip's item. The configuration panels are
  left in the column above the strip, [P12A.5](#p12a5--the-column-that-grew-seven-disclosures)'s
  to move; the strip sits where it will be once they have gone, which leaves
  the two dials a line from the pacing dial in the hook panel rather than beside
  it until then (`PlayPage.tsx` says so).
- *Decided inside the stage*: **a string is shown as itself.** The entry's text
  was the prompt's sentence, so Scene's place read *Place — Where this is
  happening: the harbour*, and a box typed into would have shown a different
  string from the one typed. `render` is how a value reads to a model; the clock,
  an object, still reads through it as *Day 3, 09:05*. 10 §1.3's note says so.
- *Decided inside the stage*: **an entry with an edit stands empty**, *Place
  not set*, where it was left out — the strip would otherwise be read-only
  exactly when the place is unknown. Every Scene session shows *Place* from
  now on.
- *Decided inside the stage*: **a strip item's panel is hidden while shut, not
  unmade.** Unmade, the add-a-hook form dropped its half-typed title on a press
  outside, *You play* forgot a choice not yet pressed, and every open mounted
  the panel's own read of the session against a stale cache — a refetch per
  open. Hidden, it is the `<details>` it replaced. The mention's card is still
  unmade, since a transcript holds one per mark.
- *Decided inside the stage*: **a close does not send again what was just
  refused**, and nothing is sent while a write is out. Committing on every close
  would otherwise record one refusal per close, and a Save followed by a quick
  Tab would write the same value twice.
- *Found by an existing test*: drawn only once the session had arrived, the
  strip's items mounted their reads against a stale cache and fetched the
  session a second time on every load — `PlayPage.test.tsx`'s *does not keep
  refetching afterwards* counted three reads. The strip is drawn from the first
  render and hidden while there is nothing in it.
- *[06 §4.2](../06-modes-and-turn-pipeline.md)'s persistent banner* is an item
  of the strip rather than a box over the column, and keeps what that section
  asks of it: there from the load for as long as anything is degraded, not a
  modal, and both of its sentences said without a press. Its rows — which
  channel, why, and the two recoveries — are behind the press. 06 is not edited:
  none of its sentences stopped being true.
- *Not done, and said*: the strip can change **a line of text or a number and
  nothing else**. Scene's clock is `{ day, hour, minute }` and opens to the
  sentence saying it is not changed here; a `choice` arm for an `enum` is
  [10 §8.0](../10-ui-surfaces.md)'s obvious next one and is not built. *Not
  looked at in a browser* — none is installed where this was built — so the
  line's wrapping and where its panel lands over the story are T2's and T3's to
  look at.
- *Tests that held the old answer*: `channels.test.ts`'s *renders a declared
  widget from the declaration* expected no `edit` and nothing else surfaced, and
  now says the clock has `edit: null` and Scene's unset place stands beside it.
  `GoalPanel.test.tsx`, `HookPanel.test.tsx` and `ChannelHealth.test.tsx` opened
  a `<details>` by attribute or found a banner's rows unopened; each presses the
  strip item now, through its helper, and finds every control by role and name
  as before — the goal's summary test reads the item's line where it read the
  `<summary>`. Two `PlayPage.test.tsx` tests found *You play* and *Set an
  objective* in the column, and press the **Cast** and goal items first. No
  assertion was deleted.

**Tests, each checked against a mutation and restored.** In
`sessions/channels.test.ts`'s new *a strip entry says how it is changed*: *gives
a string a line of text, its value, and its own words* fails with the edit taken
from a fixed schema rather than the channel's, with the value left off, and with
the string rendered through its template; *stands an editable entry with nothing
in it* fails with the old skip of an empty text; *gives a number its bounds and
its value* fails with `integer` read as `number`, with the maximum dropped, and
with the value sent as its rendered text; *offers nothing for an object, a
vocabulary or a union* fails with the vocabulary check removed. In
`mode-registry.test.ts`: *gives a text placed in the strip its edit and value,
and a panel's neither* fails with the edit offered in every region, with the
value left off, with an empty entry skipped, and with a number left unshown. In
the new `play/HudStrip.test.tsx`: *writes Place through the channel, and then
shows the new place* fails with the panel left open after a Save and with the
popover's hand-back of a stranded keyboard removed; *writes what was typed when
the keyboard leaves it* fails with a close dropping the draft; *drops what was
typed on Escape, and gives the keyboard back* fails with Escape committing, with
Escape keeping the draft, and with the refocus removed both ways; *says a
refusal in its own words, in the panel and after it has closed* fails with
`applied` not read, with the strip's note removed, and with a close re-sending
the refused words; *holds a number to its bounds at the box* fails with the
bound check removed, with the whole-number check removed, and with the number
sent as its string; *opens an entry it cannot change to a sentence* fails with a
text box offered whatever the edit; *shows an unset place as not set, and
clears a place to nothing* fails with an empty box sent as `""`; *draws a text a
mode placed in the strip* fails with the region undrawn and with the text drawn
as a panel's read-only line; *opens a picture placed in the strip under its
label* fails with the picture drawn in the line; *opens the cast, the goal, the
hooks and the health to their controls* fails with the cast item drawn without
its panel, with the health item's rows left out, and with the refocus on Escape
removed both ways; *shows the faces of who is present* fails with every row's
face drawn; *keeps what was typed into a panel when it closes* fails with the
panel unmade on close. In `PlayPage.test.tsx`: the new *stands directly over the
transcript, holding what the column held* fails with the strip drawn back at
the column's top and with the cast panel drawn open in the column; *does not
keep refetching afterwards* fails with the strip drawn only once the session has
arrived; *draws the face its record names, and opens who you play from it* and
the chat page's *opens who you play from the face* fail with the face not
opening the cast item. **Two mutations survived and are equivalent**: removing
Escape's own refocus, because the stranded keyboard's hand-back gives the
trigger the keyboard on that close too, and the reverse — so both are removed
together above; and dropping `HudStrip`'s focus on *You play* after it opens the
cast item, because the popover hands the keyboard to the first control inside,
which is *You play* today. `i18n/catalogue.test.ts` exempts the `strip` table, a
table of classes.

**Entry after: 317.70 kB, CSS 8.42** — **315.57 and 8.39 before**, at
`91f146a6`, both measured here — gzip level 9 over the files `index.html`
pulls, the budget test's method. **+2.13 kB**: the strip and its cast item, the
entry with its parse and its words, the popover's second placement and its
holder, and the `hud` region's arms. **Under the 320 ceiling, with 2.30 kB
left** for [P12A.5](#p12a5--the-column-that-grew-seven-disclosures) onward, so
no raise; CSS gained the strip's few new classes.

***After review, 2026-10-14*** — a review of the stage's diff, each finding
verified before it was acted on, found eleven things, two pairs of them one
fault each: that the strip's quiet words were in an ink the strip cannot stand
on, that a write's answer took back what was typed while it was out, that a
number box's unreadable text was written as nothing, that the health item's
live region read its rows out on every open, that a docstring claimed a
contrast pair was measured when it was not, and that the API reference, the
SDK, 10 §8.0, a docstring and the guide said things that are not so.

**The strip's labels and *not set* were in `ink-faint`** (two findings, one
fault). An item takes `surface-muted` while it is hovered, focused or open, and
`ink-faint` on that ground is **4.35 to 1** in the light theme — under the floor
on the very ground that says *this is the one you are on*. And over a backdrop
it is about **3 to 1** (2.99 over a black pixel): [P12A.2](#p12a2--the-backdrop-becomes-a-backdrop)'s
finding was that `ink-faint` can never sit on the veil, and that most of the
column's fine print would leave with P12A.5 — but the strip is the part of the
column that stays, which that bullet now has a dated note to say. `strip.label`
is `ink-subtle`, the quietest ink the veil's 82% was worked out for (4.745 to 1
over black, in light), and a new recipe beside it, `strip.unset`, is the italic
*not set* in the same ink, where `HudEntry` had spelled `ink-faint` at the call
site. A mode's group heading in the strip and a record's or a picture's item
follow through `strip.label`; a panel's `text` widget (`ModeRegion`'s other
arm) is not in the strip, takes no hover ground, and is left. `strip`'s
docstring keeps its *a label in the faintest ink* with a dated note after it,
and `label`'s own docstring says why.

**A docstring claimed a pair the contrast test did not measure.** `strip`
justified wearing `Alert`'s warning tone at rest on a story surface by *"whose
pairs the contrast test already measures"*, and no row measured `warn-ink` on
`warn-surface` — so a re-tune of `--color-warn-*` could have taken the Shell's
banner, every warning `Alert` and now the health item under the floor without
a failure. The row is there now (**6.88** light, **10.37** dark), and the
sentence is true rather than weakened.

**A write's answer took back what was typed while it was out.** The answer
closed over the render that sent it, so a write that landed reset the draft
whatever had been typed since: *the docks*, Save, then *, north quay* before the
reply — the box went back to *the docks*, and the Save's own close shut the
panel over it. A Tab away followed at once by reopening and typing a new place
lost that too, when the first write landed. `HudEntry` keeps what is typed now
in a ref, kept current as `Popover` keeps its holder, and the answer clears the
draft and closes only if what is in the box is what it sent; otherwise the
newer words stay, unsaved, in an open panel.

**A number box's unreadable text was written as nothing.** A `type="number"`
box holding *1-2* in Chrome or *abc* in Firefox reports its value as `''`, as
an emptied box does, and for a number that may be unset `parse` read that as
`null` — a recorded write clearing the channel where the person should have been
told *That is not a number.* No built-in channel puts a number in the strip, so
this was latent, but `hudEdit` offers the edit to every mode. `settle` now asks
the box's own `validity.badInput` first, through a ref on the entry's form —
live at every close, since the panel is hidden rather than unmade — and says
the sentence at the box. *Not done here, and said*: the shared `NumberField`'s
`inputMode="numeric"` still gives an iPhone a keypad without *-* or *.*; it
predates this stage and every caller has it, so it is a change to `Field.tsx`
of its own if it is wanted.

**The health item's live region read its rows out on every open.** It was
`role="status"` round the whole item, and the item's panel is hidden while shut
and shown on a press: shown inside a polite region, the channel, the reason and
both offers would be read out on every open, while focus landing on *Try again*
said as much again. The region is a copy of the two sentences now, `sr-only`
beside the item, and a refused retry's note — outside any region once the item
is not one — has a region of its own, mounted empty so that it is listening
before the note arrives. `ChannelHealth`'s docstring has a dated note after its
*Still `role="status"`, round the item*.

**The corpus.**

- [The API reference](../../api.md)'s *"A client from before this sends
  neither"* had the sides backwards: a server sends the fields, and one from
  before this sends neither, so its entries read as not editable. This stage's
  own sentence, corrected in place, as `api.ts`'s comment already had it.
- The SDK's `text` arm still said *a short value, read* and nothing else (two
  findings), so a mode author declaring a `text` surface on a string channel was
  not told that a person could now overwrite it from the strip. The arm has a
  dated paragraph
  — what is edited and how, that the arm gained no field, that the write is
  the ordinary route's and admitted by every policy — and the `surface` field a
  pointer to it. *Found while writing it, and not a finding*: the `toggle`
  arm's *"a `toggle` over an `engine-computed` channel produces a recorded
  refusal"* is not so — `engine-computed` refuses a model and a step, and a
  person's write is admitted by every policy (`refuse`, in `turns/effects.ts`)
  — so that clause has a dated note rather than standing under a paragraph that
  says the opposite.
- [10 §8.0](../10-ui-surfaces.md)'s new note said the paragraph above's *no min
  or max* still describes `WidgetSpec`, whose `meter` arm has had both since
  [P14.5a](31-p14-scene-and-session-import.md). This stage's own note,
  corrected in place to say the `text` arm carries none; the older *Three widget
  arms ship* paragraph has a dated parenthesis — five ship — rather than a
  rewrite. 10 §10.1's *beside the cast* is left: it is §0.4's binding wording,
  and §1.3's note gives the order.
- `renderSurface`'s docstring in `mode-registry.ts` said a `text` widget renders
  through the channel's `render` template, and its `text` arm has shown a string
  as itself since P7.11 wrote that — the arm `channels.ts`'s new comment cites.
  The sentence is struck, with a dated note saying what the arm does and why the
  channel's own surface now agrees with it.
- **The guide described the column before the strip** — the cast, goals and
  plot hooks under the heading, a HUD *at the top* that only showed things. It
  describes the strip now, edited in place as user prose: `playing.md`'s *The
  play page* gives the column's order and the strip's, how an entry is changed,
  saved, dropped and refused; a correction from the strip is among the changes
  recorded as turns; *Cast*, *Goals* and *Plot hooks* say each is opened from
  its line in the strip. `pictures.md` and `modes.md` put the strip above the
  transcript, and Scene's two switches above the strip.

**Tests after review, each checked against a mutation and restored.** In
`ui/contrast.test.ts`, the `ink-subtle` row gains `surface-muted` (**6.90**
light, **5.58** dark), and a new row measures `warn-ink` on `warn-surface`:
`ink-faint` added to the `surface-muted` row fails the light assertion at 4.35,
and the light `--color-warn-ink` pointed at `amber-500` fails it at 2.07. In
`theme.test.ts`, the new *the HUD strip* scan refuses `text-ink-faint` in every
`strip` recipe and in the class lists of `HudStrip.tsx` and `HudEntry.tsx`,
calibrated by finding each file's `flex`: it fails with `strip.label` back at
`ink-faint` and with *not set* spelled `text-ink-faint italic` at the call site.
In `play/HudStrip.test.tsx`: *keeps what was typed while a write was out, and
the panel open* holds the `PUT`'s answer open, types more, then lets it land,
and fails with the `now.current !== sent` guard removed; *says a number box
holds text it cannot read* stubs the box's `validity` — jsdom never sets
`badInput` — and fails with the check removed, `null` written. In
`play/ChannelHealth.test.tsx`: the new *keeps the rows it opens out of its live
region* fails with `role="status"` back round the item and with the copy of
the sentences no longer a region; *says so when a retry is refused* now asks
that the note be in a live region, and fails with the row's region removed;
*says what failed and that the story is unaffected* reads the item, since the
sentences are in the page twice. *Not looked at in a browser*, still.

**Entry after: 317.80 kB, CSS 8.42** — **317.70 and 8.42 before**, at
`161d9d92`, gzip level 9 over the files `index.html` pulls, the budget test's
method. **+0.10 kB**: the live region's copy and the row's region, the two refs
and their checks, and the recipe's new string. CSS is unchanged: every class
the fixes spend was already emitted. **2.20 kB is left** for
[P12A.5](#p12a5--the-column-that-grew-seven-disclosures) onward.

### P12A.5 — The column that grew seven disclosures

§1.3's move, and the largest stage in the phase. Play becomes the HUD strip, the
prose, and the composer; the session-configuration panels move into the
workbench under a session subject. **The measurable claim is the one to test in
the suite**: every control reachable before is reachable after, and
`PlayPage.test.tsx` is where that is asserted rather than hoped — it is 1,301
lines of exactly the right assertions, and they should be moved, not deleted.

***Built 2026-10-13***, under [§0.4](#04-what-the-audit-of-2026-10-13-found-and-what-each-finding-decides)'s
decisions for this stage, which were binding on it: **10 §10.1 wins**, so the
hooks stay on the play surface (P12A.4 had already made them the strip's item);
the configuration panels move into a **Session** section of the workbench's play
subject; [10 §3](../10-ui-surfaces.md)'s *honest residue* is honoured; and the
reachability test is new, on the real router and shell, listing every control by
its accessible name. Play is now the heading row, two lines a session can say
about itself, the backdrop's two controls, the strip, the prose and the
composer.

**Every block, sorted by one rule.** A fact about *the story right now* stays on
Play, in the strip P12A.4 built; a fact about *how this session is configured*
moves to the workbench. The column as it stood at `5d01529d`, top to bottom:

| Block | Where it is now | Why |
|---|---|---|
| Heading row — name, *Rename*, *Add to a world* | Play, with **Session settings** added | What the session is called and where it belongs is the session as a whole, not a setting; the row is where its new way to the settings goes. |
| *In these worlds* | Play | A fact about what the session *is*, nothing in it is set from here. |
| `StartedWithout`'s alert | Play | A standing warning about the whole session in the health banner's register; nothing in it can be changed, so it is not configuration. |
| The health banner, the channels' entries, the cast | The strip (P12A.4) | — |
| **How this chat plays** (`ChatSettingsPanel`, with the mode's `settings` region) | Session | Voice, dispatch, who replies, the author's note, the card prompts, the agents' switches: every one says how the session runs. |
| The lore panel | Session | What the session retrieves from — its own comment called it *a fact about the session rather than about any turn*. |
| The session panel, with *Memories*, *Pictures* and *Update from source* | Session | The pack, its parameters and the session's verbs. *Read it as a story* and *Export* went with it, since they are verbs on the session, not on a turn. |
| The goal, the hooks | The strip (P12A.4, §0.4) | — |
| The dials | Session | How hard the world pushes and how much the narrator steers are set, not read. |
| `ModeActions` (*Update trackers*) | Session | **Decided here.** It is neither a fact nor a setting but a verb on the mode's machinery, and it is needed exactly when the tracker cadence switch beside it in the same section says *only when I press*; so it goes where that switch is. The cost is named below. |
| The mode's `panel` region: its **switches** (*Show the scene*, *Stage a backdrop*, *Show me the secret plot*) | Session | Each says what the session does from now on — a model call, a picture, a view — which is configuration. |
| The mode's `panel` region: its **readings** (the trackers' cards, the revealed plot, the echo chamber's reactions) | The strip, after the hooks | **Decided here.** The world's date, place and weather, a character's mood, a quest: values the story holds now, which is the strip's whole subject and 10 §1.3's *world state as a strip of widgets you can edit in place*. Each opens in place, as a record placed in the strip always has. |
| *Set the scene*, *Choose a backdrop…* | Play | **Decided here.** The picture behind the story is a fact about now, and these are a person's two ways to change it: draw it again for here, or pick it. *Stage a backdrop* — whether the story stages its own from now on — is the setting, and it went. |
| The strip, the transcript, the composer | Play | — |

**What was built.**

- **`workbench/session/SessionSection.tsx`** hosts the moved panels as they
  were — `ChatSettingsPanel`, `LorePanel`, `SessionPanel`, `DialPanel`,
  `ModeActions`, and `ModeRegion` over the `panel` region's switches — in the
  column's order, each reading the session through the key Play holds, so drawing
  them issues no new read and a write in one refreshes the other. `ModeActions`
  waited on `running || send.isPending`; the dock cannot see the composer, so it
  waits on the live turn the page mirrors into the cache, and a run asked for
  before a turn's first frame is the route's to refuse as `busy`, which the
  actions say in their own words.
- **The play subject is two stacked sections**, **Session** and then **Turn
  record**, each a `<section>` named by its `h3` and focusable out of the tab
  order, with a jump to each at the top (`Workbench.tsx`'s `DockSection` and
  `JumpChip`, words in a `labels` table) — never tabs. ForceFire stays with the
  record. *Session first* because the chord Play shows opens the dock at its top.
- **`workbench/jump.ts`**: the two sections' element ids, `jumpInDock` (scroll
  and focus, waiting a frame at a time for a dock just opened, and only ever an
  element inside `#workbench`), `useOpenDockAt` (open if shut, never toggle, write
  only when shut, then jump), and `useOpenDockFor` (an address that names a block
  opens the dock once per arrival).
- **Play's heading row gains *Session settings***, `OpenDockButton` with an `at`
  and `aria-keyshortcuts="Control+\`"`, the chord shown beside the name and out of
  it, hidden on a phone. A second press with the dock open goes back to the
  section and writes nothing. *(2026-10-14, after review: the attribute is
  withdrawn — the chord is the shell's toggle and closes an open dock, so it is
  shown and not declared; see* After review *below.)*
- **The context meter opens at the record** — opening the dock first if shut —
  because a dock that merely opened would now open on the settings, and the
  block table the meter's name promises would be a screen further down.
- **`?block=` moved with the session panel.** The play route no longer passes it
  to the page; the dock reads it from the address as it reads `?turn=`, the route
  opens the dock when the address names a block (`useOpenDockFor`), and the block
  editor brings itself into view and puts the keyboard in its text on mount —
  mounting is the one moment certain to come after the dock, the session's read
  and the pack have all arrived. *Edit in the pack* **keeps `turn`** in the
  address, since the record is now directly under the editor and should still
  show the turn the block was found in. *(2026-10-14, after review: on the mount
  that answers an arrival, not on every mount; the opener waits for the
  preference to be read; and the record's turn picker keeps `block` — see*
  After review *below.)*
- **The strip draws the `panel` region's readings** after the hooks, through
  `ModeRegion`'s new `drawn="line"`; **`isSwitch`** — a `toggle` is a setting,
  every other arm a reading — is the rule that split the region, and the file
  still knows no channel. A per-member card's strip item is named for whom it is
  about (*Character: Vera*), as its heading was, or three characters would be
  three items called *Character*.
- **The assistant draws the settings in place.** It mounts `PlayPage` in a panel
  beside whatever the main view is, and the dock follows the main view, so its
  *Session settings* would have opened the dock on the wrong subject — and
  *Archive this session*, the assistant's documented way to start afresh, would
  have been unreachable. `PlayPage` takes `settings="here"` from it and draws
  the same section in one fold under its heading row instead. *(2026-10-14,
  after review: and its context meter is a reading there, not a button, and the
  fold is mounted from the first render — see* After review *below.)*
- **Words.** *Choose a backdrop*'s sentence names where *Stage a backdrop* is
  now (*That switch is in Session settings.*). `ChatSettingsPanel`'s fold for a
  mode with settings and no chat was called *Session settings*, which is now the
  name of the section it is drawn in and of Play's control: it is *This mode's
  settings*.

**What the stage text said and what turned out different:**

- *"Move into the workbench under a session subject"* — the workbench had no
  session subject (§0.4), and the subject follows the route, so it is not a new
  subject but a **section** of the play subject: over one route the panel
  shows two things about one session.
- *"`PlayPage.test.tsx` is where that is asserted … 1,301 lines of exactly the
  right assertions, and they should be moved, not deleted"* — §0.4 found it is
  2,606 lines and asserts nothing about where a panel sits, and a claim that
  crosses from the page into the dock needs the real router and shell. So the
  claim is a new file, `play/reachability.test.tsx`, and `PlayPage.test.tsx`
  keeps every assertion and gains two. *No assertion anywhere was deleted.*
- *§1.3's "already has a session subject"* — it did not; and *"the hooks"* move
  to the workbench — they did not, 10 §10.1 won (P12A.4).
- *"Nothing becomes harder to reach than one keystroke"* — one press of *Session
  settings*, or Ctrl+` from shut; the reachability test holds the first.
- *Found, and in no audit*: **the assistant mounts the play page** in a panel
  whose dock is about something else — the `settings="here"` bullet above.
- *Found*: **the `panel` region held switches and readings together**, so the
  sort split it rather than moving it whole, by arm.
- *Decided*: tracker cards to the strip, *Choose a backdrop* on Play,
  `ModeActions` to Session, Session above the record, the meter to the record,
  `?block=` opening the dock once per arrival, the link keeping `turn` — each
  argued above or in the table.
- *Decided, and not said until review* (added 2026-10-14): **Scene's reveal of
  its secret plot went to the dock against its mode's own placement.** Scene's
  `plot.ts` and [P14](31-p14-scene-and-session-import.md)'s P14.5b record put
  the reveal toggle beside the revealed card, under *Director*, because reading
  the plot is reading the story rather than configuring it. The split by arm
  overrode that: the reveal is a `toggle`, a switch changes what is shown from
  now on, which is configuration, so it is in the Session section and the card
  is an item of the strip. *The cost*: [06 §7.3](../06-modes-and-turn-pipeline.md)'s
  *reveal affordance* is in two places — open the dock, tick the box, close it,
  find the new item — which T3's walker should weigh. The declaration is
  unchanged; a reveal meant for the story surface would go in `hud`.
- *Not done, and said*: the Session section is still several panels stacked, not
  the one panel [P7B §1.4](24-p7b-presets-and-prompts.md) wanted
  (`SessionPanel`'s docstring answers its own debt note with that); **the dials
  no longer sit by hook pacing**, which is in the strip's hook item, so the guide
  says the three belong together; **in manual tracker cadence *Update trackers*
  is a press away** — open the dock, press — where it was on the page, which T3's
  walker should count; and *not looked at in a browser* — none is installed
  where this was built — so where the jump lands, the chips' look and the dock
  on a phone are T3's and T4's to see.

**The docs.** [10 §3](../10-ui-surfaces.md) has the rewrite its honest residue
asked for, as a dated note there and a new **§3.1**, *What the panel is about,
now that two of its subjects write*; 10 §1.1, §1.3, §2.3 and §8.0 have dated
records; the SDK's `panel` region and [the API reference](../../api.md) have
dated notes on how this client draws it; `SessionPanel.tsx`'s and `PlayPage.tsx`'s
debt comments have their answer, dated, and every comment in the column that
named a moved panel has a dated note saying where it went; the guide's *Playing
a session* has a **Session settings** section holding the lore, session and dial
panels, and *Modes*, *Pictures*, *Lorebooks and memory*, *Presets and prompts*,
*Importing and exporting* and *Troubleshooting* say where each control is now,
edited in place as user prose.

**Tests, each checked against a mutation and restored.** In the new
`play/reachability.test.tsx`, on the real router and shell with a fixture that
draws every block at once: *is still within reach: on the play surface, in a
strip item, or in the Session section* — the column's list at `5d01529d`, a
hundred controls by role and name, each asked for where the stage put
it — fails with the lore panel, the session panel, `ModeActions` or the
switches left out of the Session section, and with the strip not drawing the
`panel` region's readings; *leaves none of what moved to the Session section on
the play surface* fails with the lore panel drawn back in the column and with
the strip drawing the switches too; *opens at Session from Session settings, and
goes back there with the dock open* fails with the jump left out and with the
open written on every press; *opens at the turn record from the context meter*
fails with the meter aimed at Session; *opens a shut dock at the block's editor,
with the keyboard in its text* fails with the route not opening the dock, the
dock not handing the section the block, the section without the session panel,
and the editor not taking the keyboard; *stays shut when it is closed with the
block still in the address* fails with the effect keyed on the opener; *is what
Edit in the pack opens, from a turn the head has passed, keeping that turn*
fails with the link dropping `turn`. In `PlayPage.test.tsx`'s new *the column*:
*draws none of the session's configuration, and offers the way to it* fails with
the lore panel, the dials, `ModeActions`, the `panel` region or how a chat plays
drawn back in the column, and with *Session settings* left out of the heading
row; *draws its settings in place, folded, when it is not the main view* fails
with the `here` arm ignored and with the section drawn without the session
panel. In `workbench/dock.test.tsx`, the new *the play subject's sections*,
*stacks Session over the turn record, each with a jump to it*, fails with the two
sections in the other order, a jump aimed at the wrong section, and the record
drawn inside Session; *shows the head turn* and *reaches the head turn's block
table* are scoped to the record's section, deliberately, so a turn's words
among the settings cannot pass for the record. In `ModeRegion.test.tsx`: *draws
a panel's readings as items of a line, each named for whom it is about* fails
with `drawn` ignored, the item named by its label alone, and `isSwitch`
answering by anything but the arm. **Tests that held the column's answer**:
`HudStrip.test.tsx`'s *draws a text a mode placed in the strip* asserted a
panel's placement was not in the strip, and now asserts it is its own read-only
item, not the entry pressed; `ChooseBackdrop.test.tsx`'s sentence test gained
the new clause; `i18n/catalogue.test.ts` exempts `DOCK_SECTIONS`, element ids.
`SessionPanel.test.tsx`, `LorePanel.test.tsx`, `ChatSettingsPanel.test.tsx` and
`DialPanel.test.tsx` render their panels standalone and pass unchanged.

**Entry after: 318.72 kB, CSS 8.43** — **317.79 and 8.42 before**, at
`5d01529d`, both measured here — gzip level 9 over the files `index.html`
pulls, the budget test's method. **+0.93 kB**: the two sections and their
jumps, `jump.ts`, *Session settings* and its words, the strip's new region, the
block editor's jump, and the assistant's fold; the panels themselves only moved,
both ends being on the entry already. *Measured twice*: before the assistant's
fold the figure was 319.25, and adding it took the entry down — gzip's window
over a reordered module graph, not code removed — so the number is the build's,
not a sum. **Under the 320 ceiling with 1.28 kB left** for P12A.6 onward, so no
raise; CSS is 0.01 kB larger.

***After review, 2026-10-14*** — a review of the stage's diff, each finding
verified before it was acted on, found twelve things, two pairs of them one
fault each: that the dock's Escape threw away what was being typed in it, that
the record's turn picker unmounted the block editor with its draft, that the
block editor took the keyboard on every reopen and not once per arrival, that an
address loaded with the dock already open wrote the preference anyway, that
*Session settings* declared a shortcut that closes what it opens, that the
assistant's fold read the session and the transcript twice, that the
assistant's context meter opened the dock on another session, that nothing held
the assistant's `settings="here"`, and that two comments and a placement said
less than was so.

**Escape in a Session field closed the dock, and the draft with it.** The
dock's Escape was written for a reader, where an Escape inside the dock had
nothing to lose; since this stage the Session section writes, and the dock
unmounts when it closes. Pressed in the block editor *Edit in the pack* opens
— to dismiss an input method's candidates, or out of habit — it closed the dock,
and reopening showed the template again; the author's note and a sampler
setting went the same way. The aside's handler now leaves an Escape alone when
something inside already prevented its default, and when its target is
somewhere text is typed: a text area, a contenteditable region, or an input of a
type that takes text (`isTextEntry`). *Narrower than the chord's guard, on
purpose*: a check box, a radio or a select keep no draft, so Escape on one
still closes the dock — the chord is already inert on them, and a keyboard user
who has just ticked a switch is not left without the one key out. `isEditable`
moved out of `useToggleChord.ts` into a new `workbench/editable.ts` beside
`isTextEntry`, so the two questions are spelled in one place. `Workbench.tsx`'s
header has a dated note after its Escape paragraph; the guide's *The
workbench* and *Keyboard* say Escape does not close it while you are typing in
one of its boxes, edited in place as the guide's user prose always is — it
carries no dated notes anywhere, and this stage edited it the same way.

**The record's turn picker dropped `?block=`.** *Edit in the pack* keeps
`turn` because the editor and the record are read together, and that held one
way only: choosing another turn under *Showing* to compare against wrote an
address with the turn alone, the editor unmounted, the session panel folded and
the draft went. `TurnPicker` carries `block` forward now, the way the link
carries `turn`, with a dated paragraph in its docstring and a sentence in
`PlaySearch.block`'s note.

**The block editor took the keyboard on every reopen** (two findings, one
fault). `?block=` stays in the address until the person leaves the session, the
dock unmounts on close, and the editor scrolled to itself and focused its text
on every mount — so every later Ctrl+` or press of *Workbench* opened the dock
at the pack with the keyboard in a text box where the chord no longer works,
not at the top of Session as 10 §3.1, the guide and T3's sentence all say; a
press of *Session settings* also raced the editor's focus against its own jump.
The two findings proposed two keys, and neither is taken whole. The router's
per-navigation history key would make the turn picker's navigation — a new key
with the same block, now that the picker keeps it — an arrival, and a reopen
after looking at another turn would land in the editor again. A module key
cleared only by an address without a block makes a route mounted afresh at a
block address (Back to it, say) open the dock and not land: two notions of
arrival for one press. So there is one, decided where the dock's opening is:
`useOpenDockFor` hands the block over as **a landing** in a layout effect —
in place before any passive effect of the same commit, where an editor drawn
with it would ask — checked against the last value handed, so StrictMode's
second run of a first mount is not a second arrival; the editor takes it once,
on mount (`landOnce`), still the moment certain to come after the dock, the
read and the pack. A dock closed and reopened over the same address is the
same arrival and starts at its top, which makes 10 §3.1's *a dock opened from
shut starts at its top* and *once per arrival* true as written. `jump.ts`'s
*Where it lands* paragraph is struck with a dated note, and the editor's comment
has one.

**An address loaded with the dock already open wrote the preference anyway.**
The route's opener ran on mount, before the preference had been read, and took
*unknown* for *shut*: its patch cancelled the read in flight, and until the
write answered the cache held the open key alone — the theme read as `system`
and the dock's width as the default, with nothing to restore if the write
failed. `useOpenDockFor` waits on the read now (`loaded`, which only ever goes
from false to true, so the effect still fires once per arrival, and closing the
dock changes neither of its keys).

***Session settings* declared a shortcut that closes what it opens** (two
findings, one fault). `aria-keyshortcuts` names a chord that activates or
focuses *the element*, and Ctrl+` is the shell's toggle: with the dock open a
screen reader said the chord would take a person to the settings, and it took
them away. One finding withdrew the attribute; the other kept it and the
visible hint while the dock is shut. **Withdrawn**, because the attribute was
not true from shut either — there the chord opens the dock at its top without
pressing this button or moving the keyboard — and because a hint that vanished
the moment the dock opened would change the button's width under the pointer
whose press had just opened it. The hint stays as it was, `aria-hidden`, beside
the name and out of it, where a sighted reader can see whether the dock is
open. `OpenDockButton` loses the `keyshortcuts` prop, struck in its docstring
with a dated note; the shell's *Workbench* keeps its attribute, since that
button is the toggle. 10 §1.1's note gains *from shut*, dated; §3.1's sentence
already said so.

**The assistant's fold read the session and the transcript twice.** It was
mounted only once the session had arrived, so the section's panels mounted their
reads against a cache entry already stale, and every opening of the assistant
fetched each twice where before this stage it fetched each once. The fold is
there from the first render now and hidden until the session arrives —
`HudStrip`'s *hidden while the session loads, not left out*, cited in the
fold's comment.

**The assistant's context meter opened the dock on another session.** 10 §3.1
said no control on the assistant's Play opens the dock, and the meter did: it
opened the dock on the main view's subject and, since this stage, jumped to and
focused that view's record — another session's turn, not the one it measured.
The code was made to match the sentence rather than the sentence weakened,
since in that mount there is no right dock to open: `ContextMeter` takes
`opensDock`, which `PlayPage` passes as `settings === 'workbench'`, and without
it draws the same bar and figure in a plain element, its sentence as text,
without the trailing *Open the workbench to see the block table* (`meterLabel`
leaves it out). §3.1 has a dated note saying the meter was such a control
until review; the guide's meter paragraph says it is only a reading in the
assistant's panel.

**Nothing held the assistant's `settings="here"`**, and dropping it passed
every test while the assistant's Play showed a *Session settings* that opened
the dock on the main view and left *Archive this session* nowhere.
`AssistantPanel.test.tsx` records what the panel hands `PlayPage` — the
finding's minimal version, since what `here` draws is already
`PlayPage.test.tsx`'s.

**Two comments and a placement said less than was so.** `ModeActions`'
docstring still put the cards it updates *above it*; they are items of the
strip on the page behind the dock now, and a dated note says so and names the
separation as the cost T3's walker judges. And **Scene's reveal of its secret
plot was moved against its mode's own placement without a word**: the
*Decided, and not said until review* bullet above records it, `plot.ts`'s
`REVEAL` and `PLOT_SURFACES` have dated notes, [P14](31-p14-scene-and-session-import.md)'s
P14.5b sentence has a dated parenthesis, and 10 §8.0's note names the reveal as
the one placement whose mode argued the other way. The reveal stays where the
split put it; moving it to `hud` is a design change for the owner or T3.

**Tests after review, each checked against a mutation and restored.** In
`play/reachability.test.tsx`: the new *Escape in the Session section*, *leaves
the dock open, and the draft in it, when it is pressed while typing*, fails
with both guards removed and with the guard keyed only on `defaultPrevented`;
*still closes the dock from a control that keeps no draft* fails with
`isTextEntry` widened to `isEditable`. *Keeps the block and what was typed in
it when the record shows another turn* fails with the picker's search back to
`{ turn }`. *Opens at its top when it is reopened with the block still in the
address* reopens by the header's *Workbench* and by the chord, and asks that a
second chord closes it; it fails with the editor's `landOnce` guard removed.
*Writes nothing when the address is loaded with the dock already open* puts the
router at the address before anything is drawn, as a reload would, and holds
the preference read; it fails with `loaded` dropped from the opener's guard.
*Opens at Session from Session settings* asks that the control carries no
`aria-keyshortcuts` and still shows *Ctrl+\`*, and fails with the stage's
`PlayPage.tsx` and `OpenDockButton.tsx` put back. In `PlayPage.test.tsx`, *draws
its settings in place, folded, when it is not the main view* counts the reads —
one session and one transcript, which the fold mounted on `session.data` again
makes 2 and 2 — and asks that the meter is no button, its sentence promises no
workbench, and a press on it writes nothing: it fails with `opensDock` ignored,
with the reading given the press, and with the name's last sentence kept. In
`assistant/AssistantPanel.test.tsx`, the new *asks the play page for its
settings in place, since the dock is not about it* fails with
`settings="here"` dropped. `dock.test.tsx`'s *closes on Escape only when focus
is inside it* still holds Escape on *Close*, unchanged. *Not looked at in a
browser*, still.

**Entry after: 318.93 kB, CSS 8.43** — **318.72 and 8.43 before**, at
`76fce95a`, gzip level 9 over the files `index.html` pulls, the budget test's
method. **+0.21 kB**: `editable.ts` and the Escape guard, the landing, the
meter's reading, the picker's search function. CSS is unchanged: every class the
fixes spend was already emitted. **1.07 kB is left** for
[P12A.6](#p12a6--motion-five-of-them) onward.

### P12A.6 — Motion, five of them

Turn arrival, the streaming state, a panel or sheet entering, the backdrop's
crossfade (already in P12A.2, named here), and Send acknowledging the press
([polish §11](06-polish.md) built the first word of this). Each spelled **once**,
in `ui/classes.ts` beside `reveal`, with the same test `theme.test.ts` already
applies to `reveal`: spelled in one place, and honouring its media query.

***Built 2026-10-13***, under [§0.4](#04-what-the-audit-of-2026-10-13-found-and-what-each-finding-decides)'s
decisions for this stage, which were binding on it: a turn's arrival animates
only the turn that just finished, each motion is a recipe in `ui/classes.ts`
spending P12A.0's tokens, and the test is new. The five, each spelled once
beside `reveal`:

| Motion | Recipe | Spent by | Tokens | With reduced motion asked for |
|---|---|---|---|---|
| **A turn arriving** | `arrival` — a fade and a quarter-rem rise, from `@starting-style` | the `<li>` of the one turn `PlayState.arrived` names | `arrive`, `ease-arrive` | no length: the turn is there |
| **The streaming state** | `busy` — a dot in the status line's ink, breathing | `StreamStatus`, beside *Waiting for the first words…* and then alone on its line, from Send to the turn's end | `--animate-busy`, new: a 1.6s breath on `swap`'s curve | `none`: the dot is drawn and holds still |
| **A panel or sheet entering** | `enter` — a fade, from `@starting-style` | `ui/Dialog`'s scrim, `ui/Popover` in both places, the workbench, the assistant | `arrive`, `ease-arrive` | no length: the panel is there |
| **A scene changing** | `crossfade`, [P12A.2](#p12a2--the-backdrop-becomes-a-backdrop)'s, unchanged | `play/Backdrop.tsx` | `arrive`, `swap` | no length: the picture is there |
| **A press acknowledged** | `press` — a pixel down while held, on an enabled button only | `ui/Button`, every variant | `respond`, `swap` | down while held; it does not travel |

**`reveal` moves onto the tokens** — `duration-respond ease-swap` beside its
`transition-opacity` — which are what it spent before by default: `respond` is
150ms, and `swap` is Tailwind's `ease-in-out`, `cubic-bezier(.4,0,.2,1)` in the
built stylesheet, as is `--default-transition-timing-function`. Nothing on
screen changes. What changes is that every motion in the client now names what
it spends.

**What the stage text said and what turned out different:**

- *"With the same test `theme.test.ts` already applies to `reveal`"* — as §0.4
  found, that test reads `(hover: none)`, not reduced motion; the tests below are
  new, and they extend P12A.0's scan rather than standing beside it.
- *"The backdrop's crossfade (already in P12A.2, named here)"* — named, and
  nothing moved: it was a recipe on the tokens already. It is the fourth row,
  and 10 §1.3's *a scene changing*.
- *"Send acknowledging the press"* — **spent by `ui/Button`, not by Send.** A
  press answered on one button teaches that the others did not register, and
  [polish §11](06-polish.md) put Send's busy state in `ui/` rather than at its
  call site for a reason that holds more strongly for a pressed state, which no
  button lacks. **`enabled:` only**, because a disabled Send that went down under
  a press would acknowledge a press that does nothing — the false answer §11
  removed when it stopped Send being live for the length of the post. A link
  drawn as a button (`link.action`) does not press: it is a navigation, and the
  page changing is its answer. `press`'s docstring says the same.
- *A panel entering, and leaving*: **nothing animates out.** Each of these
  panels unmounts when it closes — `Popover`'s `under` arm is hidden instead —
  and a fade out needs the element held in the tree until the fade ends: a timer,
  or a `transitionend` that the reduced-motion block's zero never fires, which is
  why `index.css` forbids waiting on one. A panel somebody dismissed is gone when
  they dismiss it. A fade, not a slide: a panel opens in its own place — centred,
  under its trigger, docked at the edge — and one that slid toward it would claim
  to have come from somewhere else. `Dialog` spends it on the scrim, which holds
  the card, so the two fade as one; on the card as well, the card would fade
  twice over. The hidden popover fades on every opening too: `@starting-style`
  applies on the way from undrawn to drawn, not only on a mount.
- *Which panels*: the four the stage named. **Three overlays drawn by hand do not
  spend it** — `editor/FieldAssist.tsx`'s assist popover, the notification toast
  and `ui/TokenField`'s suggestion list. The list must be there with the
  keystroke that asked for it; the other two are one `${enter}` from it, and
  whether a notification should arrive moving is a question this stage was not
  asked.
- *A ~~sixth~~ fifth token* *(2026-10-14, after review: P12A.0 built four —
  two durations and two easings — so this is the fifth, as `index.css` says)*.
  The streaming state loops, and a loop is an animation rather
  than a transition: it has no two ends for a duration to carry it between, and
  Tailwind writes an `--animate-*` token's timing into the shorthand. So it is
  `--animate-busy`, with its keyframes inside `@theme`, and its line in the
  reduced-motion block is `none` — which P12A.0's test already demanded of any
  `--animate-*`, and which is what makes the dot *still* rather than slow. The
  build keeps the indirection the block needs: `.animate-busy{animation:var(--animate-busy)}`.
- *Found by building it: the streaming state had nowhere to stand once words
  arrived.* `StreamStatus` returned nothing while text streamed, so a stream
  that paused — between two steps, or while a model thinks — looked exactly like
  one that had finished, and the only sign left was Stop where Send had been. The
  dot stays on the status line from the press to the end: beside the sentence
  while nothing has come, alone once words are arriving. Hidden from a screen
  reader both times, since the sentence and the live turn say it in words. The
  line no longer comes and goes when the first word lands, taking a line of the
  transcript's height with it.
- *Found by building it: what the arrival lands on.* The live turn leaves at
  `turn.finished`, and the record's turn comes with the transcript's refetch a
  round trip later — so a reply that streamed is gone for that moment, and then
  arrives as the record, its player's line above it for the first time. The gap
  is older than this stage: the turn used to pop back, and now it fades back.
  **It is left**, because the obvious repair is not one: holding the live turn
  until the record arrives would make the arrival a dip — the words drawn, then
  not, then fading in — where the gap at least hands one drawing to the next.
  Whether the fade reads as the record settling or as a flicker is a person's,
  with the preference off; 05's note for T5 asks for it.
- *"Only the turn that just finished"* — and **watched** is the word the reducer
  keys on: `turn.finished` while the status was `running`, for the job that was
  running. A page opened after a turn ended is sent its frames again,
  `turn.finished` among them, and that turn did not just arrive for anybody. A
  stream that dropped and came back after its turn ended takes the same path, so
  that turn is drawn without the motion — the cheaper mistake: a turn that is
  simply there is never wrong. The next job, by its POST or its first frame,
  forgets the last arrival~~, so a sibling switch or an undo that takes the turn off
  the path and back does not make it arrive again~~. *(2026-10-14, P12A.6 after
  review: a head move starts no job, so the next job's clearing never reached a
  sibling switch, and a turn stepped away from and back to arrived again on every
  return; `moved` forgets the arrival on every head move, and an undo never
  remounted the turn — see* After review *below.)*
- *The cost in coverage, small and named.* Five class lists that were literals —
  `Dialog`'s scrim, the popover's two panels, the two docks — are template
  literals now, with the recipe in a hole, and `tailwind-utilities.test.ts` reads
  quoted literals only, as `reveal`'s call sites already showed. Each list is
  unchanged and was checked by that test until this commit; P12A.0's scan, which
  reads template text, still reads their radii and shadows. *(2026-10-14, after
  review: the five lists are quoted constants again — `SCRIM`, `PANEL_BELOW`,
  `PANEL_INLINE` and each dock's `ASIDE` — with `enter` alone in the template's
  hole, and the test reads them; see* After review *below.)*
- *Not looked at in a browser* — none is installed where this was built — so
  every motion's look, and its absence under the preference, is T5's.

**The emitted CSS**, from `packages/client/dist/assets/index-*.css`:
`@starting-style{.starting\:translate-y-1{--tw-translate-y:var(--spacing);translate:var(--tw-translate-x) var(--tw-translate-y)}.starting\:opacity-0{opacity:0}}`,
`.animate-busy{animation:var(--animate-busy)}`, `@keyframes busy{50%{opacity:.25}}`,
`.enabled\:active\:translate-y-px:enabled:active{--tw-translate-y:1px;translate:var(--tw-translate-x) var(--tw-translate-y)}`,
and
`@media (prefers-reduced-motion:reduce){:root{--transition-duration-respond:0s;--transition-duration-arrive:0s;--default-transition-duration:0s;--animate-busy:none}}`.
`.transition-opacity` and `.transition-transform` read `var(--tw-duration,…)` and
`var(--tw-ease,…)`, which `duration-*` and `ease-*` set from the tokens, so a
recipe's length is the token's and the block reaches it.

**Tests, each checked against a mutation and restored.** In `theme.test.ts`'s
new *the motions*: *names each motion as a recipe beside reveal, and each one
moves* fails with `arrival` emptied to its `starting:` classes; *names a
duration and an easing wherever it transitions* fails with `reveal` back on
Tailwind's defaults and with the crossfade's duration dropped, and — with the
scan — with `enter` at `duration-300`; *writes motion in a motion recipe and
nowhere else in the file* fails with `transition-colors duration-respond
ease-swap` in `link.inline`, which the P12A.0 scan passes, since it is the right
file; *stills the streaming state rather than slowing it* fails with the busy
line dropped from the reduced-motion block (P12A.0's *stills every motion* with
it), with that line a slower loop instead of `none`, and with `busy` on
`motion-safe:animate-pulse` (the scan with it). In `reducer.test.ts`'s new *the
turn that arrives*: the first test fails with the arrival set before the end; the
second with the arrival taken from any `turn.finished`, watched or not; the third
with `forJob` keeping the last arrival, and with `submitted` keeping it. In
`PlayPage.test.tsx`'s new *a turn arriving, and the streaming state*: the
watched turn's test fails with every turn drawn arriving and with none; the
opened-after test with the arrival taken from any `turn.finished`, and with
every turn drawn arriving; the streaming test with the dot only while waiting,
with the dot left after the end, and with the sentence's dot dropped. In the new
`ui/motion.test.tsx`: the press test fails with the recipe dropped from `Button`
and with it spent by the primary variant alone; the disabled test with
`active:` not under `enabled:`; the dialog test with the recipe dropped, moved
onto the card alone, and spent by both; the popover test with either arm without
it. `dock.test.tsx`'s and `AssistantPanel.test.tsx`'s *fades in as it opens*
fail with the recipe dropped from each aside. The client's other 158 test files
pass unchanged, `tailwind-utilities.test.ts` among them after the build.

**Entry after: 319.19 kB** of the 320 ceiling, **CSS 8.66** — **318.93 and 8.43
before**, at `5987cd17`, gzip level 9 over the files `index.html` pulls, the
budget test's method. **+0.26 kB**: the four recipes and the call sites that
spend them, the reducer's field, and the status line's second branch. CSS
**+0.23**: the `@starting-style` block, the keyframes, the animation and press
utilities, and the reduced-motion block's fourth line. **0.81 kB is left** for
[P12A.7](#p12a7--editors-section-jumps-and-an-identity-header) onward.

***After review, 2026-10-14*** — a review of the stage's diff, each finding
verified before it was acted on, found six things, one pair of them one fault:
that a turn that arrived arrived again when a sibling step brought it back,
that four sentences said every button presses where only `ui/Button`'s do, that
five class lists had left the test that reads them, that the docs counted the
motion tokens one short, and that T5's walker was told nothing moves on a
reload.

**A turn that arrived arrived again when a step brought it back** (two
findings, one fault). The bullet above said the next job forgets the arrival,
*so a sibling switch or an undo that takes the turn off the path and back does
not make it arrive again* — and a sibling switch starts no job. Redo a turn, let
the new attempt finish, and it fades in; step to the attempt it replaced and its
`<li>`, keyed by the turn, unmounts; step back and it mounts afresh with
`arrived` still naming it, and fades and rises again, on every return until
something is sent. That is the regenerate-then-compare flow at its first swipe,
and the case §0.4's decision exists to rule out. **A head move forgets the
arrival now**: the reducer takes a `moved` action, which sets `arrived` to null
(and returns the same state when there is nothing to forget), and `PlayPage`
dispatches it first in the `onSuccess` of every mutation that moves the head —
a sibling step, a continue from an earlier turn (which *Branch* at the last
message is), an undo and a delete — so the turn the refetch remounts already
sees nothing arriving. *`onSuccess`, not `onMutate`*: a move the server
refuses (a `409` while a turn runs) moved nothing, and keeps the arrival.
*Every head move, not only the ones that can bring the turn back*, because which
those are is a fact about the transcript's paths that the reducer cannot see,
and a turn that is simply there is never wrong; an undo never remounted the
turn at all — it appends one after it — and forgets the arrival because it
moves the head like the rest. Naming a line moves none and keeps it. *Not
cleared by the arriving `<li>` itself*: on its mount the class would go before
the motion ran, and its `transitionend` never fires once the reduced-motion
block has zeroed the duration. The reducer's docstring and the bullet above
are struck with dated notes, and `moved` carries the reason in its own.
**Not covered, and left for [P12A.8](#p12a8--the-phone-rules) or T5**: on a
phone `<main>` is `max-sm:hidden` while a dock is open, and `@starting-style`
applies when an element goes from undrawn to drawn — so closing the workbench
before the next job or move very likely draws the arrived turn arriving again.
Likely, not run: no browser is installed where this was built.

**Four sentences said every button presses, and only `ui/Button`'s do.** T5's
walker note told a walker to hold *any* button down; [polish §11](06-polish.md)'s
note said *every button*, 10 §1.3's *every enabled button*, and `press`'s
docstring *every button presses*. `press` is spent by `ui/Button`, every variant
of it, and the `<button>`s drawn by hand do not spend it: `ui/Popover`'s
trigger and with it every item of the HUD strip, `play/InputKind`'s toggles
beside Send, `play/ContextMeter`, `play/ChooseBackdrop`'s tiles,
`play/Portrait`, `ui/SelectorBar`, and others in the editors, the library and
the tag manager. A walker holding a strip item would have recorded a failure
against a claim the code never made. **The sentences are corrected, and the gap
is a stated limit of this stage, left for a decision rather than closed in
passing**: spent in `Popover` itself, `press` would reach the prose —
`MentionOverlay` makes each mention the trigger of the same Popover — and a
word of the story that goes down under a press is a different decision from a
button that does; spent on `strip.item` alone, on `InputKind` and on
`ContextMeter`, it would close the gap beside Send, which is the inconsistency
the stage's decision was made against, and whether a selected toggle should
also travel when pressed is a question about toggles nobody has asked. So: 05's
note is struck where it said *any button*, and its dated note names Send, Stop
and a dialog's own buttons and says a hand-built control's not moving is not a
failure; polish §11 and 10 §1.3 have dated clauses; `press`'s docstring names
the sites and why they are open; `motion.test.tsx`'s comment says *every
`ui/Button`*.

**Five class lists had left the test that reads them.** The stage's *cost in
coverage* bullet named it and accepted it; review asked for it back, and it was
one move each. `Dialog`'s scrim, the popover's two placements and the two docks'
asides are module-level quoted constants again — `SCRIM`, `PANEL_BELOW`,
`PANEL_INLINE`, and `ASIDE` in `Workbench.tsx` and in `AssistantPanel.tsx`, as
`Alert` and `Badge` keep `BASE` — each list unchanged, with `enter` alone in the
template's hole, and each with a comment saying why it is quoted.
`tailwind-utilities.test.ts` reads them: `bg-overlay` misspelt in `SCRIM` fails
it after a build, as does a token misspelt in each of the other four —
`overflow-y-auto` in `PANEL_BELOW`, `rounded-panel` in `PANEL_INLINE`,
`border-line` in the workbench's `ASIDE`, `max-w-md` in the assistant's. *What
it still cannot reach*, found by the same mutations: a unit mistyped inside the popover's arbitrary maximum height builds
a rule and passes, because Tailwind emits whatever an arbitrary value's
brackets hold, quoted or not. `Popover.tsx`'s comment says so without spelling
the misspelling out — the first wording did, and the build, which reads
comments too, emitted it into the stylesheet until the sentence changed.

**The docs counted the motion tokens one short.** 10 §1.3's note said each
recipe spends only the tokens *§1.2's note names*, and `busy` spends
`--animate-busy`, which §1.2's note never named, under a reduced-motion block it
described as zeroing durations alone; and the bullet above called the loop's
token a *sixth* where `index.css` counts four and one. 10 §1.2 has a dated note
naming the animation token and why the block sets it to `none` rather than
zero; §1.3's pointer is struck for *§1.2's notes*, naming the four and the loop;
the bullet above reads *fifth*, dated. `crossfade`'s docstring, which calls it
*the first of the five motions P12A.6 names*, has a dated clause: the first
built, and the fourth in 10 §1.3's order.

**T5's walker was told that on a reload nothing on the page moves.** Two things
do, and neither is a turn arriving: a staged backdrop fades in once its picture
has loaded, as [P12A.2](#p12a2--the-backdrop-becomes-a-backdrop) built it —
`play/Backdrop.tsx` draws the first picture waiting and shows it on `load` —
and a workbench left open paints closed for the round trip that reads the
preference, then enters with `enter`. A walker reading the sentence as written
could record a `FAIL` on an arrival gate that is working, and under the
two-tier gate that answer stays against the row. 05's sentence is struck and
its dated note says what does and does not move on a reload, and adds the step
to a sibling and back that the fix above makes still. T5's row is not edited.

**Tests after review, each checked against a mutation and restored.** In
`reducer.test.ts`'s *the turn that arrives*, the new *is forgotten when the head
moves, and nothing else is* fails with `moved` a no-op. In `PlayPage.test.tsx`'s
*a turn arriving, and the streaming state*, the new *forgets the arrival when
the head moves, so a step back to the turn draws it still* watches a turn
finish, steps by the sibling strip to its sibling and back with `moveHead` and
both transcripts mocked, and asks that the turn's `<li>` no longer carries
`arrival`; it fails at that assertion with the dispatch dropped from
`goToSibling`. The other three dispatches are the same line and are not pinned
apart: a turn a continue or a delete takes off the path comes back by a sibling
step, which is, and an undo never takes it off. `tailwind-utilities.test.ts`
fails with each of the five misspellings above, after a build, and passes
restored. `theme.test.ts`, `ui/motion.test.tsx`, `dock.test.tsx` and
`AssistantPanel.test.tsx` pass unchanged over the quoted constants. *Not looked
at in a browser*, still.

**Entry after: 319.27 kB, CSS 8.66** — **319.19 and 8.66 before**, at
`918975f4`, gzip level 9 over the files `index.html` pulls, the budget test's
method. **+0.08 kB**: the reducer's branch and the four dispatches; the quoted
constants cost nothing the gzip can see. CSS is unchanged. **0.73 kB is left**
for [P12A.7](#p12a7--editors-section-jumps-and-an-identity-header) onward.

### P12A.7 — Editors: section jumps and an identity header

Anchor chips over the long form — never tabs
([10 §1.3](../10-ui-surfaces.md), [10 §11.2d](../10-ui-surfaces.md)) — generated
from the fieldsets that already exist rather than hand-listed, so a schema
change cannot leave a jump pointing at nothing. And `EditorFrame` grows the
header `ActorEditorPage` already has: the object's image, its name, its kind.

***Built 2026-10-13***, under [§0.4](#04-what-the-audit-of-2026-10-13-found-and-what-each-finding-decides)'s
decisions for this stage, which were binding on it: a `JumpSection` that
registers with the frame replaces the `<section>`/`h2` pairs, so a chip cannot
point at nothing; a jump into a closed `<details>` opens it; and the header's
image is an answer every kind can give, with *none* an answer.

**The jumps** are `editor/jumps.tsx`. A `JumpSection` draws a `<section>` and
its heading together — the heading's words are the chip's, one string — and is
labelled by that heading, with a `note` held under it and an `aside` beside it;
a `JumpHeading` is the same heading alone, for the two places a section's
heading stands inside something that is not a section, an actor's `<legend>`
and a lore entry's `<summary>`. As each heading is drawn it tells the frame it
is there, holding the element itself rather than an id to look up, and it takes
itself away as it goes. `EditorFrame` owns the list, sorted by where each
heading stands in the document rather than by when it arrived, and draws a chip
for each under the object's name — a `ui/Button` that scrolls its heading to the
top and gives it the keyboard (`tabIndex={-1}`, `SettingsAnchor`'s ring),
opening every `<details>` around it first. Every section the four editors drew
as a `<section>` and a `SectionTitle` is one now, fifteen places:

| Editor | Its chips, in the page's order |
|---|---|
| Actor | each of the card's sections, by its title — *Summary*, *Appearance*, *Voice* and *Background* on a new card — and *Writing samples* |
| Treatment, setup | *Fields*, *Plot hooks* |
| World | *Fields*, *Members* |
| Preset | *Blocks*, *Fields* |
| Lorebook | *Scope*, *Retrieval*, *Pictures*, *Folders* (for a book that has folders), *Entries*; while an entry is selected, its name and its seven groups, *Matching* to *The entry itself*; *Plot hooks* |

**The header** is the frame's: the object's picture, its kind (`KIND_WORDS`,
above the name) and its name, for every kind, with the line each page still
says for itself under them — the frame's `header` prop is `note` now. The
picture is the kind's own `imageOf` on `EditorKind`: an actor's card, drawn by
`ui/Face` and falling back to its tile; a lorebook's cover, `primaryMediaId`; a
treatment's, a setup's or a World's first picture; and a preset's nothing. It is
read from the saved object, since the media route reads what is on disk, so a
draft is a tile for an actor and nothing for the rest. `ActorEditorPage`'s own
header is gone, and its note that the card travels with the file stays as the
actor's line.

**What the stage text said and what turned out different:**

- *"Generated from the fieldsets that already exist rather than hand-listed"*
  — there was nothing to generate them from, which was §0.4's finding: no
  section carried an id, and only `LoreEntry`'s schema has banners. **The
  heading is the list** instead: a section exists as a chip exactly as long as
  its heading is drawn, which is what *cannot point at nothing* needs and what a
  list beside the page — Settings' `SECTIONS`, held in step by a test — can only
  promise. An actor's chips do come from its fieldsets, the card's own sections,
  and a lore entry's from its schema's banners in the schema's words.
  `SchemaFields`' banner groups register too, though no schema it draws has one
  today, so a banner added to a treatment's schema is a chip with no edit to a
  page.
- *"Never tabs ([10 §1.3], [10 §11.2d])"* — the rule is 10 §1.3's and 10 §3's,
  as §0.4's smaller slips say; what §11.2d contributes is why a tab would break
  it, and its dated note says so. There is no tab role anywhere in the client,
  and a test reads the source for one.
- *"The header `ActorEditorPage` already has: the object's image, its name, its
  kind"* — it had the image and the name, and **no kind**; the kind is new to
  every header, the actor's with it. And of the five other kinds only the
  lorebook names its picture: [10 §11.3](../10-ui-surfaces.md) lists a
  *treatment cover* and a *World cover* among the image slots, and neither
  schema has a field that designates one. **The first picture stands in for
  both**, and the setup's with them; a field to choose a cover is a schema
  decision this stage did not take, and the design note and the schema disagree
  about it until one is taken.
- *Two sections the stage did not name.* **The schema's own fields are a
  section, *Fields***, on the treatment, setup, World and preset pages, so the
  first section of each has a chip like those after it — the one word true of
  all four lists, which are whatever the schema declares that the page does not
  draw itself. And **the lorebook's hook fold has a chip**, because `HookList`
  is a section in every editor that draws it; [03 §4.1](../03-data-model.md)'s
  *secondary* is kept by what kept it before — last on the page, shut, under its
  sentence — and its chip is last, where the fold stands. A chip into it opens
  it. *(2026-10-14, after review: and one region in the form that has no chip,
  deliberately. The import review `EntryTravel` draws after a file is read,
  "What arrived", stays a region named by its label, with a subsection heading:
  a report on one import, drawn under the button that asked for it while the
  reader is still looking there, gone when it is dismissed, and inside the
  section the Entries chip already reaches. A chip for it would jump to where
  the reader is, and arrive in the row and leave it again with every import.
  See* After review *below.)*
- *Decided here: buttons, not addresses.* Settings' rows are links because the
  address is the jump there, with a fixed anchor per section. An editor's
  sections come and go with what is selected and their ids are `useId`'s, so a
  pasted `#…` would land nowhere after a reload; the dock's jumps are the
  precedent, an element and not a route. The editor's address keeps what it
  says already, `?entry=` and `#aliases`.
- *Decided here: not pinned.* The chips stand where the page starts and scroll
  away with it. Held over the form, a dozen of them on a phone would be two or
  three lines less form on every screen — a shrunken panel by another name,
  which [P12A.8](#p12a8--the-phone-rules)'s rules refuse — and the critical
  controls already hold the bottom edge.
- *A motion the vocabulary did not name.* A jump scrolls smoothly when
  `--transition-duration-arrive` has a length and is simply there when the
  reduced-motion block has zeroed it, or when no stylesheet can be read — the
  token rather than a second media query, so that block stays the one switch.
  The scroll's length is the browser's, and no token reaches it. 05's note for
  T5 says where it is seen.
- *One shape for a heading row, where the sections had grown five.* The heading
  with its note held under it, and anything beside it pushed to the far edge.
  The Scope and Retrieval notes sit closer to their headings than before, and
  the Folders table and the entry list's controls a little further from what
  is above them. *Writing samples* keeps the subsection step it had, below the
  section step its level would give it, since the card's sections beside it are
  smaller still.
- *An actor's sections are headings now*, a level-two heading inside each
  legend, so heading navigation finds the card's sections; the legend still
  names the group for a form's reading, and the heading carries the legend's
  look.
- *Found by building it: tests that read the page's structure.*
  `LorebookEditorPage.test.tsx` took every list item on the page for an entry
  row, and the heading's parent for its section; the chips are a list, and a
  heading sits a level deeper in its row. Those readings go through the
  *Entries* region and `closest('section')` now, and no assertion changed.

**Tests, each checked against a mutation and restored**, all in the new
`editor/jumps.test.tsx`. *A chip for every section, and a section for every
chip*: on a bare registry, *draws one chip per section, in the order the page
has them* fails with the sort removed, since a section drawn late then lands
last, and with the first chip dropped from the row; *takes the chip away with
its section, and renames it with its heading* fails with the cleanup keeping
the chip, and with a heading that does not follow its title; and over all six
editors, *holds in the … editor* — every region in the form *(2026-10-14,
after review: as its fixture draws it, which never imports — see* After review
*below)* has exactly one chip, every chip lands on a heading in the form that
says its words, no two on one, and every level-two heading in the form is one a
chip reaches — fails with
a heading that never registers, with the focus dropped, with the first chip
dropped, with the lorebook's *Pictures* drawn as a plain `<section>` and
heading, and with an actor's section heading drawn plainly. *Registers the
selected entry and its groups, and lets them go with the selection* — Harbour,
then Bridge, then none — fails with the cleanup keeping the chip and with the
title not followed; *follows an entry renamed in the form* with the title not
followed. *A jump into a shut fold* — the entry's *Timing*, the book's hook
fold, and a heading two folds deep — fails, each test, with the folds left shut
and with the focus dropped. *How a jump moves the page* — smooth at `300ms`,
`auto` at `0s` and with no token — fails with the behaviour always smooth and
always `auto`. *The identity header, for every kind*: the six kinds' *kind,
name and picture* fail with the kind word dropped; the lorebook's with the
first picture taken over the cover, and *shows no picture for a book that has
chosen no cover* with that and with an absent cover read as *the first*; the
treatment's and the World's with the simple kinds answering *none*; the
setup's and the preset's with a placeholder drawn for *none*; *passes over
media that is not a picture* with the `image/` check removed; *draws an actor's
tile when the card will not load* with the actor drawn as a picture rather
than a face; *draws nothing for a cover that will not load* with the failure
not remembered; and *draws a new actor as its tile* with the draft asking for
its card, and with the actor drawn as a picture. *Never tabs*: no tab, tablist
or tabpanel in any of the six editors drawn, and none in the client's source
read as text — both fail with a chip given the tab role. The client's other
test files pass, `LorebookEditorPage.test.tsx` with its two readings repointed
and `tailwind-utilities.test.ts` after the build. *Not looked at in a browser*
— none is installed where this was built — so whether the row reads as the
page's contents, and where a jump lands on a long book, are a person's; no row
of T names this stage.

**Entry after: 320.18 kB, CSS 8.66** — **319.27 and 8.66 before**, at
`d43d92fb`, gzip level 9 over the files `index.html` pulls, the budget test's
method. **+0.91 kB, 0.18 over the 320 ceiling**: the registry, the chips and
the jump **0.36**, the header's picture **0.16**, and the sections with the
header's move into the frame about **0.39** — each measured by taking it out of
a build. **The ceiling is raised to 325**, which leaves **4.82** for P12A.8,
and `tools/entry-budget.test.ts` records beside the raise the measurement that
makes it the lesser answer: **the four editors behind one `lazy()` chunk
measured 294.42, −25.76 kB** — the largest boundary measured on this branch,
and the *editors* group [21 §4.1](../21-client-loading.md) names among its first
candidates. It is a loading decision with 21 §7's obligations — a chunk
boundary, a pending state, a check that keeps it off the entry — and not a
stage's, so it is measured and recorded (21 §4.1 has a dated note) and not
built.

***After review, 2026-10-14*** — a review of the stage's diff, each finding
verified before it was acted on, found two things, both in what the stage said
rather than in what it built: that the every-region check was stated of every
state of the lorebook page and holds of the states its fixture draws, and that
`EditorFrame`'s docstring gave [10 §1.3](../10-ui-surfaces.md) a sentence that
is this stage's.

**The import review is a region with no chip.** Import entries from a file and
`EntryTravel` draws *What arrived* in the form — a `<section>` named by its
`aria-label`, with an `h3` — and no chip arrives for it. The stage's own claim
survives it: what became a `JumpSection` was every `<section>` and
`SectionTitle` pair, and this one's heading is a `SubsectionTitle`. But *holds
in the … editor*'s docstring said *every region in the form*, and had its loop
run with a review drawn it would have stopped at *a region named by its
heading*, since the review is named by a label and not by its heading. **The
review stays as it is, and the claim is narrowed to what holds.** It is a
report on one import, drawn under the button that asked for it while the reader
is still looking there and gone at *Dismiss*, inside the region whose chip,
*Entries*, lands on the heading it sits under; a chip of its own would jump to
where the reader is, and would arrive in the row and leave it again with every
import. The test's docstring now states its rule of the form as the fixture
draws it, which never imports, and names the review as the one other region the
form can hold and why it has no chip; `ImportReview`'s docstring says the same
from its side; the bullet and the tests paragraph above have dated notes.
*Converting it was the other answer* — a `JumpSection` at `h3` with *Dismiss*
as its aside, and a test that imports and watches the chip arrive and leave on
*Dismiss* — and was not taken, for the reason above. *That it is the one other
region* was checked by reading every `<section>` and `role="region"` in the
client: `HistoryPanel`'s stands after the `<form>`, not in it, and
`WorldMembers`' is on the read page.

**`EditorFrame`'s docstring credited 10 §1.3 with the stage's words.** It said
§1.3 *asks for the actor's shape everywhere — the object's image, its name, its
kind*. That is P12A.7's stage text; what §1.3 says is *the avatar first in an
editor header*, written of characters. The sentence now gives the ask to the
stage and says what it takes from §1.3 — a sentence about characters, taken for
every kind — which is the direction citations run in this corpus: 10 is the
authority, and P12A is the plan. Comment only.

**No test is new**, since neither finding is behaviour: one is a test's
account of itself and the other a comment, so there is no mutation to check
them against. `editor/jumps.test.tsx`, which holds the every-region loop over
all six editors, and `LorebookEditorPage.test.tsx`, which draws the review, pass
unchanged, with the rest of `editor/`.

**Entry after: 320.18 kB, CSS 8.66** — unchanged from `e6f00ac3`, gzip level 9
over the files `index.html` pulls, the budget test's method: the build drops
comments, and the entry's file and the stylesheet hash the same before the
change and after it. **4.82 kB is left** for
[P12A.8](#p12a8--the-phone-rules).

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
