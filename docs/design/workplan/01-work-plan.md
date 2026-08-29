# 01 — Work plan to beta

**Status: first pass.** A sequence, not a schedule. There are no time estimates
here on purpose: a solo project with unknown availability makes them fiction, and
fiction in a plan is worse than an ordering with honest dependencies.

**Beta is defined as feature-complete to the 1.0 spec** ([11 §0](11-repo-and-releases.md)).
That definition is about to widen — release engineering, automation and workflow
stabilisation belong in it too, and §8 holds the space for that rather than
guessing at it.

---

## 0. What is in 1.0, and what is 2.0

**1.0 ships two modes: Scene, and Adventure–Freeform.**
**2.0 adds Adventure–Campaign and Messages.**

The cut is by *where this project has an opinion*, which is a better criterion
than feature count:

- **Scene** and **Freeform** are where StoryEngine diverges most from what
  exists. They are the modes worth being opinionated about, and the ones whose
  shape the design documents actually argue for.
- **Campaign** is very good in Marinara already. What StoryEngine adds is
  multi-user and the channel model underneath — not a different opinion about
  what an RPG mode should be. Building it second, against a proven substrate,
  is strictly better than building it first against an unproven one.
- **Messages** is mechanically thin and presentationally expensive: presence,
  schedules, autonomous messaging, profiles, reactions, and a great deal of look
  and feel, for comparatively little that the pipeline does not already do.
  It is the easiest place to spend six months on polish.

**The release line is therefore: alpha → beta → 1.0 → 2.0 beta series → 2.0.**
1.0 is a real release with a `release/1.0` branch that persists
([11 §2](11-repo-and-releases.md)); 2.0 work continues on `main`.

### 0.1 What this removes from 1.0

Deferring a mode removes more than the mode:

| Deferred with | What goes with it |
|---|---|
| **Messages** | Presence (Active/Idle/DND/Invisible), per-actor schedules, autonomous messaging, Discord-style profiles, reactions, the command-family gating model |
| **Messages** | **Background scheduling.** Autonomous messages were the forcing function for a server-side timer that starts turns with no client attached. Nothing else at 1.0 needs one — the plot-hook selector is a pipeline step, not a timer. Turns remain server-side *jobs* for reattach, which is a different thing. |
| **Campaign** | The RPG channel library: HP and pools, attributes, inventory, quests, map, clock/weather, NPC reputation, sessions-within-a-campaign, combat |
| **Campaign** | Incremental world generation at setup, and the character-sheet machinery |

**Notifications stay at 1.0 but shrink.** The Messages argument for them goes
away; the other two do not — completion sounds, and awaiting-input when a turn
suspends for the player ([06 C5](../06-open-questions.md)). In-app plus the browser
Notification API covers 1.0. Web Push, ntfy and the delivery-channel spread move
to 2.0 with Messages.

**The event schema does not shrink** ([06 A2c](../06-open-questions.md)). Class,
target user, `{key, params}` summary, dedupe key and coalescing window are the
retrofit cost, and they are as cheap now with two event classes as with ten.

### 0.2 The check this cut creates

The scope cut is also a test, and it is worth stating as a commitment rather
than a hope:

> **Adding Campaign and Messages at 2.0 must require no changes to the 1.0
> portable schemas** ([10](../10-schemas.md)).

The design says it should not: Messages-specific fields live in `modeData` under
a namespaced key, and Campaign's state lives in channels the mode declares.
Neither touches Actor, Lorebook, Treatment, Setup or Package. If either turns out
to need a schema change, the mode contract or the data model was wrong — and
finding that out at 2.0 is exactly what the stability tiers exist to prevent.

### 0.3 The honest cost

Cutting a mode also cuts a forcing function, and two seams go into 1.0 designed
but unexercised:

- **Background scheduling and presence** were Messages' to prove. They are
  specified ([04 §3](../04-server-multiuser-deployment.md)) and nothing at 1.0 will
  test them.
- **Heavy channels and engine-computed effects** were Campaign's to prove.
  Freeform uses channels lightly by design, so the model is under-exercised.

The mitigation for the second is real: the dice reference extension
([14 §4.4](../14-roadmap.md)) exercises engine-computed channels and
evaluate-before-narrate on a small surface, which is a reason to keep it at 1.0
even though Freeform defaults to no mechanics. The first has no mitigation
short of building Messages, and is simply a risk carried into 2.0.

### 0.4 Three further cuts, not driven by the mode scope

§0.1 cut what falls out of deferring two modes. These three are different: they
survive the mode cut and were removed anyway, on a review pass that asked the
question §2.1 exists to ask — *what is additive, and can therefore wait?*

**Authored rules: the vocabulary and evaluator move to 2.0.**

The third extensibility tier ([03 §4.1](../03-modes-and-turn-pipeline.md)) stays a
committed direction. What moves is the part that is a language design project
wearing a feature's clothes: a predicate and effect vocabulary, an evaluator, and
the authoring surface that makes either usable.

Three reasons, and the third is the strongest:

- [06 C7](../06-open-questions.md) already held the vocabulary open, and two stable
  schemas were carrying ⚠ warnings because they depended on something
  unspecified — `PlotHook.requires`/`onFire` and `Goal.completion`. Deferring
  removes both warnings and makes those schemas honestly stable.
- Infinite Worlds — the entire evidence base for this tier
  ([08](../08-infinite-worlds.md)) — ran on triggers and tracked items for years
  before arriving at PawScript, and arrived at it *with a corpus of real authored
  worlds to design against.*
- **We have no such corpus.** Designing an expression language against
  imagination is how you get one nobody can use. Channels and engine-computed
  effects ship at 1.0 and are where the actual power lives; the rule layer gets
  designed at 2.0 against real channel usage.

Plot hooks lose nothing that matters. `involves`, `notBefore` and `blockedBy` are
mechanical filters that need no vocabulary, and they carry most authored hooks.
Goals keep narrative and manual completion.

**i18n discipline is reduced, not removed.**

"Every string through i18n from the first component" is a genuine ongoing tax on
a solo developer whose stated plan is one bad machine translation for testing.
What stays on the day-one checklist is the part that is actually
unretrofittable:

- **Never concatenate sentences from fragments**, and never build a string by
  assembling clauses in code. This is the one that cannot be fixed later without
  rewriting the components that do it.
- **Never bake user-visible strings into logic** — no branching on displayed
  text, no strings as keys.
- **CSS logical properties and `Intl` unchanged.** Both near-free, both
  permanently foreclosing if skipped.

What moves is *catalogue extraction*, which becomes a pre-beta sweep rather than
a per-component obligation. Extraction over a codebase that never concatenated
is mechanical work; extraction over one that did is a rewrite. Keeping the
discipline and dropping the ceremony holds nearly all the value
([07 §12](../07-tech-stack.md)).

**Packaging at beta is container plus tarball.**

[04 §5.4](../04-server-multiuser-deployment.md) lists six artifacts and §8 made all
six a beta requirement. Container and tarball are enough to have users, and the
audience for a pre-1.0 release of this can run a container. `.deb`, AUR,
Homebrew and the Windows service are a substantial build chain to stand up and
maintain for people who are not there yet.

**They move to the 1.0 bar rather than off the list.** The reasoning that put
them there — that a home server product people cannot install is a home server
product nobody uses — is right about 1.0 and premature for beta.

---

## 1. Two things this plan is built around

**Vertical slices, not horizontal layers.** Do not build all the storage, then
all the assembly, then all the UI. Get *one turn working end to end* as early as
it can be made to work, then widen. The alternative produces three subsystems
that have never met.

**Order by what unblocks learning, not by what sounds foundational.** Two items
land far earlier here than instinct suggests, both flagged in
[02 §8](02-triage.md):

- **Import**, because it is how a realistic library exists to test retrieval and
  budgeting against. Synthetic fixtures will not surface what real cards do.
- **The workbench**, because it is the debugging tool for everything built after
  it. Building it late means debugging the assembler by reading logs for months.

---

## 2. Day-one checklist

Decisions scattered across these documents that are **free on the first day and
expensive on the four-hundredth**. None is a feature. Most are one line. This is
probably the most useful single list in the document.

### Data and identity

- **uuidv7 ids, globally unique**, never namespaced per user — a future shared
  library merges without collisions ([04 §4.3](../04-server-multiuser-deployment.md)).
- **No `owner` / `visibility` fields.** The path is the owner. Adding them later
  is a feature; removing them later is churn.
- **Per-user directory structure from the first write** — `users/<handle>/…`.
  Retrofitting user scoping into a flat store is miserable.
- **Every portable object self-describes** with a `schema` field, so containers
  never enumerate kinds ([10 §9](../10-schemas.md)).
- **Channel state records its schema version** — one integer, never the schema
  itself ([03 §4.2](../03-modes-and-turn-pipeline.md)). Without it, a later
  migration cannot tell what it is migrating from.
- **Turn segments append in creation order, never rewritten**, with reading order
  resolved through the index ([02 §5.5](../02-data-model.md)). Making file order
  resemble tree order is the mistake that makes branching a storage problem.
- **Readers preserve unknown fields.** The single rule that lets formats evolve
  ([10 §2](../10-schemas.md)).
- **Reserve the `se.*` section-id namespace** ([10 §4](../10-schemas.md)).
- **Typed media roles** on embedded media, even if only two are populated
  ([02 §5.2.2](../02-data-model.md)).
- **Structured `VisualDescriptors`** alongside prose appearance.
- **Per-media generation provenance including the seed** — a reference image
  whose seed was not recorded cannot be regenerated ([14 §2.4](../14-roadmap.md)).
- **Crop as a stored normalised rectangle**, never a destructive edit.

### The turn record

- **Blocks recorded with source, reason, token cost and budget verdict.** Not a
  debug feature; the workbench, replay and branching all read it
  ([02 §8](../02-data-model.md)).
- **Effects complete and reversible.** The sharp test is not undo, it is that
  branching is a pointer rather than a copy ([09 §2](../09-branching.md)).
- **`advisory: true` on guidance-class blocks**, refused by any effect-producing
  call ([03 §5.2](../03-modes-and-turn-pipeline.md)).
- **Cost recorded even though nothing displays aggregates at 1.0** — a spend view
  built later over uncaptured data shows nothing ([05 §3](../05-ui-surfaces.md)).
- **Turn storage tolerates removal** — tombstone plus compaction, no UI needed
  ([14 §1.6](../14-roadmap.md)).
- **Summaries content-addressed by their inputs**, never a rolling mutable total
  ([09 §5](../09-branching.md)).

### Runtime

- **One RNG service; every draw recorded; draws keyed by site, not position**
  ([07 §14](../07-tech-stack.md)).
- **Steps name model *roles*, never models** ([07 §5.1](../07-tech-stack.md)).
- **Prompt caps declared per provider; composed prompts built from ranked
  fragments** ([07 §5.3](../07-tech-stack.md)).
- **Server events carry `{key, params}`, never English prose**
  ([04 §3.4](../04-server-multiuser-deployment.md)).
- **Notification event schema complete from the first producer** — class, target
  user, dedupe key, coalescing window ([06 A2c](../06-open-questions.md)).
- **`locale` on the account** ([04 §4.2](../04-server-multiuser-deployment.md)).
- **The step contract async and serialisable from the first step** — the worker
  boundary ([12](../12-extensions.md)) is not something to convert to later.
- **One audited path-resolution helper**, used by every filesystem-touching
  route ([07 §9](../07-tech-stack.md)).

### Client

- **CSS logical properties from the first stylesheet.** `margin-inline-start`,
  never `margin-left`. Skip this and RTL is permanently foreclosed
  ([07 §12.6](../07-tech-stack.md)).
- **Never concatenate sentences from fragments, and never put a user-visible
  string in logic** ([07 §12.6a](../07-tech-stack.md)). Wrapping strings and
  extracting the catalogue is a pre-beta task; *these two* are habits, and a
  codebase that broke them has to be reworked component by component with nothing
  flagging where (§0.4).
- **`Intl` for all dates, numbers and relative times.** No hand-rolled
  "2 minutes ago".
- **Semantic HTML, focus management, and a keyboard path through the play loop.**
  Landmarks and headings that mean something, focus moved deliberately on view
  change and returned on dismiss, every play-loop action reachable without a
  mouse, and **no state encoded in colour alone** — the turn status indicators
  ([05 §9](../05-ui-surfaces.md)), the mention confidence tiers
  ([05 §13.1](../05-ui-surfaces.md)) and the cast badges
  ([05 §13.2](../05-ui-surfaces.md)) all need a second channel. Same argument as CSS
  logical properties: cheap now, a rewrite later, and there is no native client
  to fall back on if the web app is unusable.

### 2.1 The inverse discipline: what is free to defer

§2 answers *what is expensive to retrofit*. That question, asked alone, has a
predictable failure mode — it grows the release, because everything that might be
expensive later becomes a reason to do it now. The list above is genuinely worth
its length; the release scope around it is not.

So the counter-question, asked of every feature before it enters a phase:

> **If this is added a year later, what does it cost?** If the answer is "the
> work itself, and nothing else", it is a candidate for cutting — however good it
> is.

Three cost shapes make something *not* deferrable, and they are the only three:

- **It changes a persisted shape.** Turn storage, portable schemas, the per-user
  layout, ids. Adding these later is a migration over user data.
- **It changes a contract others build against.** The step interface, the
  extension API, the event schema. Adding later breaks what exists.
- **It is a habit rather than a feature.** Provenance, i18n-safe strings, logical
  properties, accessible markup, recording cost. These are not built once; they
  are done continuously or not at all, and retrofitting means touching everything.

Everything else is additive, and **additive work should be scheduled by value,
not by fear.** §0.4 applies this to three items that were in 1.0 for no better
reason than that they were designed.

The general risk this guards against is worth naming plainly, because it is the
one most likely to sink this project: not that it ships slowly, but that **the
design never meets reality.** Every claim in these documents is a hypothesis —
that the budgeter is legible, that channels carry mode divergence, that the mode
contract holds without back doors, that hook pacing works at all. None of them is
tested by being written down. §4.1 exists to test them early.

### 2.2 The third discipline: nothing built to be discarded

§2 asks what is expensive to retrofit. §2.1 asks what is free to defer. Between
them sits everything that must exist *now* but is not yet worth its full shape,
and the early phases have one rule about it:

> **Demonstrate minimally, but do not build a system whose only purpose is to be
> replaced.**

The two halves are easy to confuse, so the distinction is worth drawing sharply:

- **A minimal demonstration is the real thing, scoped small.** It is not
  discarded later; it grows. P1's actor editor
  ([03 §P1.7](03-p1-implementation.md)) has a real write path and an empty slot
  where assist will attach — not a mock editor, an editor missing a feature that
  cannot exist yet. The `system/library/` merge ships in P1 with nothing in it:
  the query is real, the content is absent. Neither gets rewritten when the phase
  after it arrives.
- **A placeholder is a system that exists to be deleted.** It is paid for three
  times: building it, working around it while it stands, and removing it — and
  the third payment is the one that arrives as a broad refactor or a migration,
  in a phase already busy with something else.

**The test to apply before writing a placeholder: cost the real thing first.**
Often it is not much larger, because the placeholder has to satisfy the same
callers. Auth is the case that made this explicit and is worth carrying as the
worked example ([03 §1.3](03-p1-implementation.md)): a stub user context was one
file, but it would have been threaded through every route in P1 through P9 and
then torn out at P10, which is every one of those routes written twice. The real
thing — scrypt, a session cookie, CSRF, a first-run admin — is not much more code
than the stub *plus* its eventual removal, and the design had already ruled out
everything that makes auth large ([04 §4.1](../04-server-multiuser-deployment.md)).

Three qualifications, because this rule is the easiest one here to abuse:

- **It does not override §2.1.** The question is only asked about things that
  must exist now. If nothing needs it yet, defer the whole thing — that is not
  throwaway work avoided, it is work not done, which is better.
- **It is not permission to build the finished version.** Capability
  *enforcement* was deferred past P1 even though the `Capabilities` record ships
  in P1: the record is a persisted shape (§2's first cost), the enforcement is
  additive (§2.1). Splitting on that line is the point.

  *Enforcement moved to [P2A](13-p2a-configuration-surface.md), and the example
  is better for it rather than spoiled. The split was correct while nothing
  granted a capability. What changed is that P2A builds the screen that grants
  them — and this same section forbids a system whose only purpose is to be
  replaced, which is what a switch labelled "may add their own provider keys"
  becomes when nothing reads it. The line is still record-versus-enforcement;
  it just turned out that the phase which grants is the phase that owes.*
- **Test doubles are exempt.** Fakes, fixtures and harnesses are supposed to be
  disposable, and [10](10-testing.md) governs them. This is about production
  scaffolding only.

**The real counter-argument, recorded rather than dismissed:** a placeholder
makes no claim, and the real thing does. Building early against a contract that
has not met reality can bake in a wrong contract — which is the risk §2.1 closes
on, and it is not imaginary. The resolution is that this rule is about
*replacement*, not *commitment*: prefer the real thing when it is the same size,
and prefer the smallest real thing that can be grown when it is not. Where a
contract is genuinely unproven, the answer is to build less of it, not to build a
false version of it. A stub does not de-risk a bad design; it postpones finding
out, which is the failure §2.1 names outright.

**Where this bites hardest is the earliest phases**, because that is where the
real system is smallest and the temptation to fake it is largest — the gap
between a stub and the genuine article is never narrower than at P1.

### 2.3 The fourth discipline: configuration ships with its surface

§2 asks what is expensive to retrofit, §2.1 what is free to defer, §2.2 what may
be built small. This one is about a thing all three of them let through, and it
was found by discovering it had already happened:

> **Configuration ships with the thing it configures.** If a feature cannot be
> used without a value somebody has to set, the surface that sets it lands in
> the same phase as the feature.

**It belongs here rather than in §2's checklist because it is §2.1's third cost
shape exactly** — *a habit rather than a feature*, done continuously or not at
all. §2.1's own question is what let this through, and the failure is
instructive. Asked of *the settings screen*, "what does it cost to add this a
year later?" answers "the work itself", and the screen defers, correctly.
Asked of *the ability to configure the thing you just built*, it answers "every
phase between now and then ships a feature nobody can turn on without a text
editor". Same question, right answer both times, and the noun was wrong.

**What it had already cost by the time it was written.** P1 shipped accounts
with no way to manage one; P2 shipped a provider layer whose connections and
role bindings are hand-written JSON, and a `pendingRestart()` that is correct,
tested and reachable from nothing. A fresh install could not take a turn without
a text editor, and no phase had failed — each had shipped exactly what it said.
[P2A](13-p2a-configuration-surface.md) is the repair;
[P2B](14-p2b-provider-configuration.md) is the rest of it.

Three qualifications, because a rule about surfaces attracts surface work:

- **It does not mean every knob gets a form.** A value with a working default
  that nobody has a reason to change is configured *by* that default, and
  `config.example.json` documents it. The test is whether the feature can be
  used at all without someone setting the value.
- **It does not override §2.1.** If the feature is deferred, so is its surface.
  This is not an argument for building features so that their settings can be
  built.
- **Developer and test values are exempt.** `dev.enabled` needs no form; the
  person who sets it is editing the file already.

**And it gets a check rather than only a paragraph.**
[testing §2](10-testing.md)'s whole argument is that a lint rule is worth more
than a paragraph in a document nobody re-reads, and the mechanically checkable
core here is that **`config.example.json` declares every key the schema does** —
a test that would have caught the four keys that had already drifted out of it.
The rest of the rule is a question every exit gate now asks: *does anything this
phase built need a value set, and where does someone set it?*

---

## 3. Before any code: close the A-series

[06 §A](../06-open-questions.md) exists precisely because these constrain
everything downstream.

**The A-series is closed.** A1/A1c: a worker-thread
boundary with a namespaced storage API ([12](../12-extensions.md)). A3: connections
are account-scoped with a system scope, mirroring the library
([04 §4.5](../04-server-multiuser-deployment.md)). A4: raw completion is legacy and
unsupported ([07 §5.5](../07-tech-stack.md)). That resolves the one item this plan
called genuinely unretrofittable, and it changes P2 and P7: the step contract is
async and serialisable from the first step written, not converted later. A5–A8
are confirmed: multiplayer stays "don't preclude, don't build"; React + Vite +
TanStack; TypeBox; Node LTS with `node:sqlite`.

**A2c is closed too**, by separating progress events from notifications
([04 §3.2](../04-server-multiuser-deployment.md)) — granular status turns out to
cost nothing in notification classes.

**Nothing in §A now blocks the first commit.**

---

## 4. Phases

Each phase should end somewhere demonstrable. If a phase cannot be shown
working, it is a layer rather than a slice and should be resliced.

### 4.1 PLAYABLE — the milestone that matters most

**At the end of P4, with a crude Scene mode bolted on, stop and play with it.**

Not a release, not a preview, and nothing anyone else installs. A named
checkpoint whose purpose is different in kind from the phases around it: **P1–P4
build the design; PLAYABLE tests it.** Everything after is completion work; this
is the last point before a large amount of construction is committed on top of
assumptions nobody has hit yet.

By the end of P4 the following exist: files on disk with a rebuildable index, one
turn end to end as a resumable server-side job, a complete turn record, the
workbench reading it, and a real imported library from three ecosystems. The
minimal mode from P2 is already there and already disposable. Wiring it into
something one person can sit down and use is a small amount of work on top.

**Four hypotheses get answered, and no earlier point answers any of them:**

| Claim | Where it is asserted | How PLAYABLE tests it |
|---|---|---|
| The turn record is *legible*, not just complete | [00 §1](../00-stance.md), [05 §3](../05-ui-surfaces.md) | Use the workbench to answer a real "why did it say that" |
| Files on disk beat a database for this | [00 §3.4](../00-stance.md), [02 §5](../02-data-model.md) | Hand-edit a card mid-session and watch it take |
| One budgeter over everything is comprehensible | [00 §2.6](../00-stance.md), [03 §5](../03-modes-and-turn-pipeline.md) | Watch it under pressure against an imported library, not fixtures |
| Inclusion reasons are a product feature | [03 §5](../03-modes-and-turn-pipeline.md) | Read them and see whether they explain anything |

The fourth is the one most likely to be wrong, and the cheapest to fix at this
point.

**Why here specifically.** P5 onward all *build on* the assembler and the record:
retrieval feeds the budgeter, the tree stores records, modes configure the
pipeline, memory summarises history. If the record's shape or the budgeter's
behaviour is wrong, every later phase inherits the error and the correction gets
more expensive per phase. P4 is also the first point where a *realistic* library
exists, which is exactly what makes the test meaningful — synthetic fixtures will
not surface what real cards do, which is already the stated reason import lands
early ([§1](#1-two-things-this-plan-is-built-around)).

**What it is not.** Not a scope gate, not something to polish, and explicitly not
a milestone to add features to. If it takes more than a small amount of work
beyond P4, it has been misunderstood.

### P1 — Skeleton and storage spine

**Expanded into a working plan: [03](03-p1-implementation.md)** — stages, the
decisions the design documents left open (folder naming and rename, duplicate ids
on disk), the phasing revision that pulls auth forward from P10, and the exit
gate.

Repo shape ([07 §10](../07-tech-stack.md)), workspaces, CI, schema tooling, licence
headers. Then the part everything else stands on:

- Portable object schemas ([10](../10-schemas.md)) as TypeBox, emitting JSON Schema.
- Files on disk, atomic writes, per-user layout, the PNG card envelope.
- Derived index, filesystem watcher, **rebuild-from-disk as a startup option**.
- Library CRUD, with accounts and login ([03 §1.3](03-p1-implementation.md)).
- **Version history on write** ([02 §11](../02-data-model.md)) — cheap here and
  awkward later, because the trigger points are every write path there will ever
  be. The watcher makes *hand-edits* snapshot too, which no source can offer and
  which this phase's demo exercises directly.
- A library list, and **a prototype actor editor**
  ([03 §P1.7](03-p1-implementation.md)) — actor only, real write path, no assist.
  The editor is also where the history panel first appears
  ([05 §11.2a](../05-ui-surfaces.md)): restore and diff are the parts worth having
  early, since they are what make a prototype editor safe to experiment in.

**Demonstrable:** create an actor through the API, see the folder appear, edit
the JSON on disk by hand, watch the change reflected without a restart. That
last step is the whole storage thesis in one gesture — if it does not work, the
design has already failed ([05 §4.1](../05-ui-surfaces.md)).

**And then the harder version of the same demo:** hand-edit an object on disk
*while it is open in the editor*, and watch the save be rejected rather than
silently eat one of the two edits ([04 §4.4](../04-server-multiuser-deployment.md)).
The first demo proves the storage model reads honestly; this one proves it
survives a second writer, which is the claim that actually has to hold once
anyone uses it. It is the reason P1 carries an editor at all.

**CI from here on:** rebuild-from-disk equals incremental index.

### P2 — One turn, end to end

The spine. Deliberately with the crudest possible mode.

- Provider layer, model roles, capability record.
- Assembler → budgeter → render. Turn record written complete.
- Turn as a server-side job; SSE event stream; client reattach.
- RNG service.
- **The smallest real Scene mode**, not a hardcoded stand-in. An earlier draft
  had this thrown away; §2.2 says otherwise. The pipeline needs a mode-shaped
  caller regardless, and the step contract is already committed here (§2) — so
  writing that caller as a short list of real steps costs about what faking it
  costs, and P5 grows it instead of replacing it. What stays out is everything
  §2.1 makes deferrable: no channels, no hooks, no mode registry, no SDK
  boundary — that is P7's.

**Demonstrable:** type a message, get a streamed reply, close the tab mid-turn
and reattach to the finished result. Read the whole turn record as JSON.

**CI from here on:** golden-file assembly tests. Given a fixture library and
session, assemble and snapshot the turn record. This is the highest-value test
surface in the project and it exists as soon as the record does
([10](10-testing.md)).

### P2A — The configuration surface

**Expanded into a working plan: [13](13-p2a-configuration-surface.md).**

[05 §15](../05-ui-surfaces.md)'s core, pulled forward from P10 — not because it
would be nice this early, but because §2.3 found that five shipped artifacts
already describe it as existing. The user half in full, the accounts half in
full, and the half of §15.3 that has something to configure: the whole `Config`
shape, and the restart notice P2 built and could not surface.

**Capability enforcement moves here too**, which revises §2.2's worked example.
The record-versus-enforcement split was right while nothing granted
capabilities; a screen that grants them makes the ungranted half a false front.

**Demonstrable:** create a second account from the browser, sign in as them,
change their password — and watch the admin list say plainly that they still
have no usable connection.

### P2B — Provider configuration

**Expanded into a working plan: [14](14-p2b-provider-configuration.md)**, with a
§6 naming what P2A has to settle before its last questions close.

System connections and the install default bindings through the UI, admin-only
for now ([04 §4.5](../04-server-multiuser-deployment.md)). The per-user half
waits on P2A's capability enforcement and on there being a system layer to fall
back to.

**Which there is not.** Writing the plan found that the install-default layer
[04 §4.5](../04-server-multiuser-deployment.md),
[05 §15.3](../05-ui-surfaces.md) and [07 §5.1](../07-tech-stack.md) all rely on
does not exist in any form — no file, no path, no layer in the resolver — so a
dangling binding fails a turn where three documents say it falls back. That is a
data-model gap rather than a UI one, it is independently testable, and it is the
phase's first stage.

**Demonstrable:** install fresh, paste in one API key, take a turn — no text
editor. Which is not possible today, and is the plainest statement of what §2.3
was written to prevent.

*Built. The demo is half-walked: everything but the turn, which needs a model
that is not ours — see P2C.*

### P2C — The first real run

**Expanded into a working plan: [15](15-p2c-first-real-run.md).**

**Four phases are built and nobody has used any of them.** Every test in this
repository calls a provider it wrote to agree with an adapter it also wrote, and
three exit gates are now open on the same clause: P2 step 9, P2A steps 1 and 7,
and P2B step 1 each stop at *a human, and a model that is not ours*. This phase
is that person, and it is one obligation three phases deep rather than a new one.

**Not an early PLAYABLE**, and the distinction decides the scope. §4.1 asks *is
the design right*, against an imported library, at the end of P4. This asks *does
the thing work* — and it has to come first, because P3 reads the turn record and
P4 fills a library that then has to be playable, both downstream of a boundary
whose only witness is a stub.

**A readiness survey found twenty-two defects before the phase opened**, three of
them blocking, and that is the argument for running it rather than against: every
one was missable precisely because nothing had ever exercised the path. The
preparation is the larger half — five or six days against two or three of
sessions — and [15 §1.8](15-p2c-first-real-run.md) says what it costs to cut.

**Demonstrable:** the P2B demo, finished. A turn against a real endpoint, from an
empty directory, with the exchange committed as a fixture the suite replays
offline.

### P3 — The workbench

Early, deliberately. Block list with sources and reasons, budget verdict, calls,
effects, per-turn cost, diff between two turns.

**Why here:** everything after this is debugged through it. It is also nearly
free at this point, because the turn record already holds everything — the
workbench is a *reader*, not a second assembler ([05 §3](../05-ui-surfaces.md)).

**Expanded into a working plan: [05](05-p3-implementation.md)**, revised against
the record as built rather than as designed. It holds almost everything the
workbench renders; the exceptions are named there, and two of them are one field
each in P2's record rather than work for this phase.

### P4 — Import

Cards, lorebooks and presets from SillyTavern, Marinara and Aventuras. The
largest PORT in the triage ([02 §4](02-triage.md)) and the reason to do it now:
it turns an empty install into a realistic library.

**Presets are the load-bearing half and the one to sequence first**, because they
are what makes the imported library *playable* rather than merely present, and
because the conversion is already designed ([10 §8.4](../10-schemas.md)) against
ST's actual format rather than against a guess. Three things it must do from the
first version: drop connection fields unconditionally and report them
([10 §8.4.4](../10-schemas.md)), preserve depth-injected blocks at their depth
rather than flattening them to the top, and name every lossy conversion in the
review instead of implying fidelity.

**Demonstrable:** point it at a real SillyTavern data directory and get a
populated library, with a review step showing what resolved, what went to
`compat`, and what dangled — and a converted preset whose block list, read in the
workbench, is recognisably the preset that went in.

**Then stop — this is where PLAYABLE falls (§4.1).**

### P5 — Lorebooks and retrieval

Full activation semantics, folders, the two-tier budget, trim order, skip
reporting. Now testable against P4's real library rather than fixtures.

**Demonstrable:** the workbench showing exactly which entries fired, why, what
they cost, and what the budget dropped.

### P6 — The turn tree

Branching, rewrite/reroll, the RNG tape, sibling navigation.

**Why before modes:** it changes the shape of the turn store, and every mode
built after it inherits the behaviour for free. Built after modes, it is a
migration.

### P7 — Modes and channels

- The mode contract as a real interface; built-ins as separate packages
  consuming the published SDK ([07 §10](../07-tech-stack.md)).
- Channels, effects, engine-computed updates. **Not the authored-rule vocabulary
  or evaluator** — deferred to 2.0 (§0.4), which is the single largest thing this
  phase lost and the reason it is merely large rather than impossible.
- Setup objects and the declarative setup wizard.
- Party as a timeline, always non-empty ([03 §8](../03-modes-and-turn-pipeline.md)).
- **Plot hooks and the selector — the mechanism.** The pool and its four sources,
  the mechanical filter, the judgement pass, firing through the guidance slot,
  and the three things [03 §6.1](../03-modes-and-turn-pipeline.md) specifies
  around them: the **pacing dial** as a channel, **Commit** with its bounded
  patience, and **`introduces`** — a character as a hook
  ([10 §6.1a](../10-schemas.md)).

  *This lands here and not earlier because of what it reads, not what it is.*
  The introduction hook's eligibility turns on *introduced*, which
  [03 §8.1](../03-modes-and-turn-pipeline.md) defines over presence and party
  effects — both P7, both two bullets below. The dial is a channel with an
  `init` policy, and channels are P7. Building any of it sooner means inventing
  a prefill path and an introduced-yet signal that this phase then replaces.

  *Two corrections this phase discharges*, both pre-existing and both cheap here:
  hook firing state moves out of the session file into a channel, because a flat
  set does not branch ([02 §4.1](../02-data-model.md)); and the selector writes
  its own line into the turn record, because a pacing-held turn is otherwise
  indistinguishable from a judged-none one.
- **Goals** — the chain, the progress channel, narrative completion, and the
  three offers at conclusion ([03 §7.3.3](../03-modes-and-turn-pipeline.md)).
- **Presence and status channels**, and the editable cast panel over them
  ([03 §8.1](../03-modes-and-turn-pipeline.md), [05 §13.2](../05-ui-surfaces.md)).
- **Mention resolution** as an `extract` step sharing the lorebook keyword pass,
  with spans on the turn record ([03 §8.2](../03-modes-and-turn-pipeline.md)).
  `explicit` and `matched` at 1.0; `proposed` can follow, but the span overlay
  and the never-auto-create rule must land now — both are structural.
- **Difficulty and directedness** as two settings, with levels supplied by the
  prompt pack rather than engine code ([03 §7.3.1](../03-modes-and-turn-pipeline.md)).
- **Scene** and **Adventure–Freeform** (§0).

Still the largest phase and still the one where the contract either holds or is
revealed as wrong. If a built-in mode needs a back door, stop and fix the
contract ([03 §2](../03-modes-and-turn-pipeline.md)).

Two modes rather than four is a smaller phase but a weaker test, since the two
retained modes are the more similar pair. §0.3 records what that costs.

### P8 — Memory

Cross-session memory as an auto-maintained lorebook ([11](../11-cross-session-memory.md))
is designed and buildable.

**Within-session summarisation is a rolling summary** ([06 E1](../06-open-questions.md)),
which is schedulable here rather than needing its own design pass. The one
constraint that must be honoured on the first commit: it is an **immutable
chain**, `summary(n) = f(summary(n-1), turns[a..b])`, each link keyed by the hash
of its inputs ([09 §5.1](../09-branching.md)). The mutate-one-record version is the
obvious implementation, is indistinguishable from the UI, and quietly breaks
cheap branching — so it is a review item, not a detail.

Summaries are derived and disposable, so a bad summariser is a regeneration
rather than lost history. That is what makes shipping a simple version in P8
safe. Chapterisation is roadmap ([14 §3](../14-roadmap.md)), not P8.

### P9 — Renditions

Per-turn and on-demand illustration ([03 §10](../03-modes-and-turn-pipeline.md)),
built against the general rendition shape so video and speech are later kinds.

### P10 — Multi-user, notifications, deployment

**Accounts, login and first-run moved to P1** ([03 §1.3](03-p1-implementation.md))
— they were always small, and the alternative was a stub identity threaded
through every route until this phase. The per-user *storage layout* was already
in P1 because that part is not retrofittable; auth turned out to be cheaper to
build than to fake.

**And account management and capability enforcement moved to
[P2A](13-p2a-configuration-surface.md)**, for the reason §2.3 gives: five
already-shipped things described that surface as existing. What lands here is
the remainder of [05 §15](../05-ui-surfaces.md) — the extensions panel, the
system library panel if it ever earns an admin action, *Restart now* with the
supervisor detection and drain it needs, and connectivity state once P11's
update check produces the signal. Plus the notification router and delivery
channels, the loopback bind and its container inversion, the setup token, mDNS,
the account-gallery arrival screen ([15](../15-account-gallery.md)), the About
surface and §13 source link.

### P11 — Beta hardening

Everything left that the 1.0 spec commits to and the phases above did not
absorb: the assistant, editors-are-not-dumb-forms across every editor, the
reading view ([05 §12](../05-ui-surfaces.md)), impersonation in Scene
([03 §3.1](../03-modes-and-turn-pipeline.md)), the plot-hook selector, the in-app
update check, and the localisation catalogue extraction sweep (§0.4).

**The plot-hook selector here is the *tuning*, not the build** — a correction,
because this line and P7's have both read as owning it and two homes for one job
is a scheduling argument waiting to be had. P7 ships the mechanism. What is left
for hardening is the part that can only be done by playing: what the four pacing
levels resolve to, how long a commitment should wait, how the judgement prompt is
worded, and the hook panel ([05 §10.1](../05-ui-surfaces.md)) that makes a large
pool authorable. §2 already lists *that hook pacing works at all* among the
hypotheses nothing has tested, and this is the phase that tests it.

**Packaging here is the container and the tarball only** (§0.4). The other four
artifacts ([04 §5.4](../04-server-multiuser-deployment.md)) are a 1.0 requirement,
not a beta one.

**No longer here:** the file
browser ([06 D3](../06-open-questions.md)) and Tailscale ([06 D1](../06-open-questions.md)),
both moved to the roadmap.

---

## 5. After 1.0: the 2.0 series

**Campaign** and **Messages** (§0), each a mode built against a substrate that
has by then been proven by two others. Campaign brings the RPG channel library
and incremental world generation; Messages brings presence, schedules,
background scheduling, autonomous messaging and the delivery-channel spread that
Web Push and ntfy belong to.

Both are **committed**, not speculative, which distinguishes them from the
deferred items in [14 §3](../14-roadmap.md) and the desired extensions in
[14 §4](../14-roadmap.md). The roadmap items may never happen; these are scheduled.

The 2.0 series is also when the §0.2 check gets answered — whether either mode
needed a portable schema change. That answer is worth recording either way.

---

## 6. Continuous, not phased

Things that are wrong to schedule because they must happen inside every phase:

- **i18n**, from the first component.
- **The turn record staying complete** as new block sources and step kinds
  appear.
- **Provenance** on everything generated.
- **Golden-file tests** growing with the assembler.
- **The documentation lorebook** the assistant reads, kept current with the app.

---

## 7. Where the risk actually is

- **The assembler and budgeter** are the heart of the design and the easiest
  thing to get subtly wrong. Mitigated better than most projects manage, because
  the turn record makes them snapshot-testable from P2.
- **Watcher and index consistency** under rapid or concurrent writes. The
  mitigation is architectural — the index is disposable — but the failure mode
  is confusing while it lasts. **Reduced, not removed**, by the dual write path
  ([02 §5.1.1](../02-data-model.md)): the server indexes its own writes
  synchronously, so the API is read-after-write consistent and only *foreign*
  edits go through the watcher. What remains is self-write suppression getting
  its `(path, mtime, size)` token wrong, which shows up as double-indexing rather
  than as missing data.
- ~~A1, the extension execution model~~ — **closed** ([12](../12-extensions.md)).
  The remaining risk is not structural but velocity: a boundary means anything
  the API does not expose is blocked until it grows. Watch the signals in
  [12 §9](../12-extensions.md).
- **Import fidelity** across three sources with years of edge cases. Expect this
  to take longer than it looks and to keep producing bug reports after P4.
- **P7 is where the mode contract is tested** — where it meets two real modes and
  either holds or does not. Everything before it is infrastructure whose shape we
  control.
- **The risk PLAYABLE exists to reduce** is different and larger: that the
  assembler, the record and the budgeter are all *built on* by P5 through P11, so
  an error in any of them compounds per phase. §4.1 is the cheapest point at
  which a human can find that error, and skipping it is the single most expensive
  economy available in this plan.

---

## 8. What "beta" means — to be expanded

[11 §0](11-repo-and-releases.md) currently defines beta as **feature complete to
the 1.0 spec**, which is a good completeness gate and an incomplete definition of
readiness.

The other half is release engineering, and it belongs in the beta bar rather
than after it: build chains, release automation, and the workflows that make
shipping repeatable rather than an event. Sketched here only to hold the shape —
**this section is awaiting expansion** and should be rewritten rather than
extended:

- CI that builds, tests and produces artifacts on every merge.
- Reproducible builds of the container and the tarball, from a tag. **Those two
  artifacts only** (§0.4) — the remaining four are a 1.0 requirement, and
  standing up four more build chains is exactly the kind of work that reads as
  progress while delaying the thing being packaged.
- The release cut itself automated: tag → build → publish → changelog.
- Channels wired (`latest`, `testing`, `nightly`) and *boring* — a nightly that
  is often broken is worse than none ([11 §4](11-repo-and-releases.md)).
- Version and commit embedded in the build, which AGPL §13 already requires
  ([04 §7](../04-server-multiuser-deployment.md)).
- Upgrade tested, not assumed: an install from the previous release upgrading
  with its data intact.
- Backup and restore actually exercised.

The plan above front-loads none of this, which is defensible during alpha and
would be a mistake to carry into beta.
