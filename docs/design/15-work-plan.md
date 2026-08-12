# 15 — Work plan to beta

**Status: first pass.** A sequence, not a schedule. There are no time estimates
here on purpose: a solo project with unknown availability makes them fiction, and
fiction in a plan is worse than an ordering with honest dependencies.

**Beta is defined as feature-complete to the 1.0 spec** ([12 §0](12-repo-and-releases.md)).
That definition is about to widen — release engineering, automation and workflow
stabilisation belong in it too, and §8 holds the space for that rather than
guessing at it.

---

## 0. What is in 1.0, and what is 2.0

**1.0 ships two modes: Scene, and Adventure–Chronicle.**
**2.0 adds Adventure–Campaign and Messages.**

The cut is by *where this project has an opinion*, which is a better criterion
than feature count:

- **Scene** and **Chronicle** are where StoryEngine diverges most from what
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
([12 §2](12-repo-and-releases.md)); 2.0 work continues on `main`.

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
suspends for the player ([06 C5](06-open-questions.md)). In-app plus the browser
Notification API covers 1.0. Web Push, ntfy and the delivery-channel spread move
to 2.0 with Messages.

**The event schema does not shrink** ([06 A2c](06-open-questions.md)). Class,
target user, `{key, params}` summary, dedupe key and coalescing window are the
retrofit cost, and they are as cheap now with two event classes as with ten.

### 0.2 The check this cut creates

The scope cut is also a test, and it is worth stating as a commitment rather
than a hope:

> **Adding Campaign and Messages at 2.0 must require no changes to the 1.0
> portable schemas** ([13](13-schemas.md)).

The design says it should not: Messages-specific fields live in `modeData` under
a namespaced key, and Campaign's state lives in channels the mode declares.
Neither touches Actor, Lorebook, Setting, Setup or Package. If either turns out
to need a schema change, the mode contract or the data model was wrong — and
finding that out at 2.0 is exactly what the stability tiers exist to prevent.

### 0.3 The honest cost

Cutting a mode also cuts a forcing function, and two seams go into 1.0 designed
but unexercised:

- **Background scheduling and presence** were Messages' to prove. They are
  specified ([04 §3](04-server-multiuser-deployment.md)) and nothing at 1.0 will
  test them.
- **Heavy channels and engine-computed effects** were Campaign's to prove.
  Chronicle uses channels lightly by design, so the model is under-exercised.

The mitigation for the second is real: the dice reference extension
([11 §4.4](11-roadmap.md)) exercises engine-computed channels and
evaluate-before-narrate on a small surface, which is a reason to keep it at 1.0
even though Chronicle defaults to no mechanics. The first has no mitigation
short of building Messages, and is simply a risk carried into 2.0.

---

## 1. Two things this plan is built around

**Vertical slices, not horizontal layers.** Do not build all the storage, then
all the assembly, then all the UI. Get *one turn working end to end* as early as
it can be made to work, then widen. The alternative produces three subsystems
that have never met.

**Order by what unblocks learning, not by what sounds foundational.** Two items
land far earlier here than instinct suggests, both flagged in
[08 §8](08-triage.md):

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
  library merges without collisions ([04 §4.3](04-server-multiuser-deployment.md)).
- **No `owner` / `visibility` fields.** The path is the owner. Adding them later
  is a feature; removing them later is churn.
- **Per-user directory structure from the first write** — `users/<handle>/…`.
  Retrofitting user scoping into a flat store is miserable.
- **Every portable object self-describes** with a `schema` field, so containers
  never enumerate kinds ([13 §8](13-schemas.md)).
- **Readers preserve unknown fields.** The single rule that lets formats evolve
  ([13 §2](13-schemas.md)).
- **Reserve the `se.*` section-id namespace** ([13 §4](13-schemas.md)).
- **Typed media roles** on embedded media, even if only two are populated
  ([02 §5.2.2](02-data-model.md)).
- **Structured `VisualDescriptors`** alongside prose appearance.
- **Per-media generation provenance including the seed** — a reference image
  whose seed was not recorded cannot be regenerated ([11 §2.4](11-roadmap.md)).
- **Crop as a stored normalised rectangle**, never a destructive edit.

### The turn record

- **Blocks recorded with source, reason, token cost and budget verdict.** Not a
  debug feature; the workbench, replay and branching all read it
  ([02 §8](02-data-model.md)).
- **Effects complete and reversible.** The sharp test is not undo, it is that
  branching is a pointer rather than a copy ([10 §2](10-branching.md)).
- **`advisory: true` on guidance-class blocks**, refused by any effect-producing
  call ([03 §5.2](03-modes-and-turn-pipeline.md)).
- **Cost recorded even though nothing displays aggregates at 1.0** — a spend view
  built later over uncaptured data shows nothing ([05 §3](05-ui-surfaces.md)).
- **Turn storage tolerates removal** — tombstone plus compaction, no UI needed
  ([11 §1.6](11-roadmap.md)).
- **Summaries content-addressed by their inputs**, never a rolling mutable total
  ([10 §5](10-branching.md)).

### Runtime

- **One RNG service; every draw recorded; draws keyed by site, not position**
  ([07 §14](07-tech-stack.md)).
- **Steps name model *roles*, never models** ([07 §5.1](07-tech-stack.md)).
- **Prompt caps declared per provider; composed prompts built from ranked
  fragments** ([07 §5.3](07-tech-stack.md)).
- **Server events carry `{key, params}`, never English prose**
  ([04 §3.2](04-server-multiuser-deployment.md)).
- **Notification event schema complete from the first producer** — class, target
  user, dedupe key, coalescing window ([06 A2c](06-open-questions.md)).
- **`locale` on the account** ([04 §4.2](04-server-multiuser-deployment.md)).
- **The step contract async and serialisable from the first step** — the worker
  boundary ([17](17-extensions.md)) is not something to convert to later.
- **One audited path-resolution helper**, used by every filesystem-touching
  route ([07 §9](07-tech-stack.md)).

### Client

- **CSS logical properties from the first stylesheet.** `margin-inline-start`,
  never `margin-left`. Skip this and RTL is permanently foreclosed
  ([07 §12.6](07-tech-stack.md)).
- **Every string through i18n from the first component**, explicit hierarchical
  keys, extraction as a build step.
- **`Intl` for all dates, numbers and relative times.** No hand-rolled
  "2 minutes ago".

---

## 3. Before any code: close the A-series

[06 §A](06-open-questions.md) exists precisely because these constrain
everything downstream. Several are already resolved; the ones that are not:

| | Why it blocks |
|---|---|
| **A6/A7/A8** framework, schema direction, runtime + driver | Ordinary but touch every file once chosen |

A6, A7 and A8 have recommendations; they need confirming rather than
researching.

**A1, A1c, A3 and A4 are now closed.** A1/A1c: a worker-thread
boundary with a namespaced storage API ([17](17-extensions.md)). A3: connections
are account-scoped with a system scope, mirroring the library
([04 §4.5](04-server-multiuser-deployment.md)). A4: raw completion is legacy and
unsupported ([07 §5.5](07-tech-stack.md)). That resolves the one item this plan
called genuinely unretrofittable, and it changes P2 and P7: the step contract is
async and serialisable from the first step written, not converted later.

---

## 4. Phases

Each phase should end somewhere demonstrable. If a phase cannot be shown
working, it is a layer rather than a slice and should be resliced.

### P1 — Skeleton and storage spine

Repo shape ([07 §10](07-tech-stack.md)), workspaces, CI, schema tooling, licence
headers. Then the part everything else stands on:

- Portable object schemas ([13](13-schemas.md)) as TypeBox, emitting JSON Schema.
- Files on disk, atomic writes, per-user layout, the PNG card envelope.
- Derived index, filesystem watcher, **rebuild-from-disk as a startup option**.
- Library CRUD.

**Demonstrable:** create an actor through the API, see the folder appear, edit
the JSON on disk by hand, watch the change reflected without a restart. That
last step is the whole storage thesis in one gesture — if it does not work, the
design has already failed ([05 §4.1](05-ui-surfaces.md)).

**CI from here on:** rebuild-from-disk equals incremental index.

### P2 — One turn, end to end

The spine. Deliberately with the crudest possible mode.

- Provider layer, model roles, capability record.
- Assembler → budgeter → render. Turn record written complete.
- Turn as a server-side job; SSE event stream; client reattach.
- RNG service.
- A minimal Scene-ish mode, hardcoded, which will be thrown away.

**Demonstrable:** type a message, get a streamed reply, close the tab mid-turn
and reattach to the finished result. Read the whole turn record as JSON.

**CI from here on:** golden-file assembly tests. Given a fixture library and
session, assemble and snapshot the turn record. This is the highest-value test
surface in the project and it exists as soon as the record does
([16](16-testing.md)).

### P3 — The workbench

Early, deliberately. Block list with sources and reasons, budget verdict, calls,
effects, per-turn cost, diff between two turns.

**Why here:** everything after this is debugged through it. It is also nearly
free at this point, because the turn record already holds everything — the
workbench is a *reader*, not a second assembler ([05 §3](05-ui-surfaces.md)).

### P4 — Import

Cards, lorebooks and presets from SillyTavern, Marinara and Aventuras. The
largest PORT in the triage ([08 §4](08-triage.md)) and the reason to do it now:
it turns an empty install into a realistic library.

**Demonstrable:** point it at a real SillyTavern data directory and get a
populated library, with a review step showing what resolved, what went to
`compat`, and what dangled.

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

### P7 — Modes, channels, rules

- The mode contract as a real interface; built-ins as separate packages
  consuming the published SDK ([07 §10](07-tech-stack.md)).
- Channels, effects, engine-computed updates.
- The authored-rule vocabulary and evaluator.
- Setup objects and the declarative setup wizard.
- Party as a timeline, always non-empty ([03 §8](03-modes-and-turn-pipeline.md)).
- Plot hooks and the selector.
- **Scene** and **Adventure–Chronicle** (§0).

Still the largest phase and still the one where the contract either holds or is
revealed as wrong. If a built-in mode needs a back door, stop and fix the
contract ([03 §2](03-modes-and-turn-pipeline.md)).

Two modes rather than four is a smaller phase but a weaker test, since the two
retained modes are the more similar pair. §0.3 records what that costs.

### P8 — Memory

Cross-session memory as an auto-maintained lorebook ([14](14-cross-session-memory.md))
is designed and buildable.

**Within-session summarisation is not designed** ([06 §E](06-open-questions.md))
and is the largest remaining hole in the specification. It needs a design pass
before it can be scheduled — flagged here rather than pretended into a phase.

### P9 — Renditions

Per-turn and on-demand illustration ([03 §10](03-modes-and-turn-pipeline.md)),
built against the general rendition shape so video and speech are later kinds.

### P10 — Multi-user, notifications, deployment

Accounts and auth are small and could land earlier; the per-user *storage
layout* is already in P1 because that part is not retrofittable. What lands here:
login, admin, the notification router and delivery channels, first-run flow, the
loopback bind and its container inversion, mDNS, the About surface and §13 source
link.

### P11 — Beta hardening

Everything left that the 1.0 spec commits to and the phases above did not
absorb: the assistant, editors-are-not-dumb-forms across every editor, the file
browser, packaging, localisation catalogue extraction, Tailscale level 1.

---

## 5. After 1.0: the 2.0 series

**Campaign** and **Messages** (§0), each a mode built against a substrate that
has by then been proven by two others. Campaign brings the RPG channel library
and incremental world generation; Messages brings presence, schedules,
background scheduling, autonomous messaging and the delivery-channel spread that
Web Push and ntfy belong to.

Both are **committed**, not speculative, which distinguishes them from the
deferred items in [11 §3](11-roadmap.md) and the desired extensions in
[11 §4](11-roadmap.md). The roadmap items may never happen; these are scheduled.

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
  is confusing while it lasts.
- ~~A1, the extension execution model~~ — **closed** ([17](17-extensions.md)).
  The remaining risk is not structural but velocity: a boundary means anything
  the API does not expose is blocked until it grows. Watch the signals in
  [17 §9](17-extensions.md).
- **Import fidelity** across three sources with years of edge cases. Expect this
  to take longer than it looks and to keep producing bug reports after P4.
- **P7 is where the design is tested.** Everything before it is infrastructure
  whose shape we control; P7 is where the mode contract meets three real modes
  and either holds or does not.

---

## 8. What "beta" means — to be expanded

[12 §0](12-repo-and-releases.md) currently defines beta as **feature complete to
the 1.0 spec**, which is a good completeness gate and an incomplete definition of
readiness.

The other half is release engineering, and it belongs in the beta bar rather
than after it: build chains, release automation, and the workflows that make
shipping repeatable rather than an event. Sketched here only to hold the shape —
**this section is awaiting expansion** and should be rewritten rather than
extended:

- CI that builds, tests and produces artifacts on every merge.
- Reproducible builds of the container and the tarball, from a tag.
- The release cut itself automated: tag → build → publish → changelog.
- Channels wired (`latest`, `testing`, `nightly`) and *boring* — a nightly that
  is often broken is worse than none ([12 §4](12-repo-and-releases.md)).
- Version and commit embedded in the build, which AGPL §13 already requires
  ([04 §7](04-server-multiuser-deployment.md)).
- Upgrade tested, not assumed: an install from the previous release upgrading
  with its data intact.
- Backup and restore actually exercised.

The plan above front-loads none of this, which is defensible during alpha and
would be a mistake to carry into beta.
