# 01 — Work plan to beta

**Status: first pass.** A sequence, not a schedule. There are no time estimates
here on purpose: a solo project with unknown availability makes them fiction, and
fiction in a plan is worse than an ordering with honest dependencies.

**Beta is defined as feature-complete to the 1.0 spec** ([releases §0](04-repo-and-releases.md)).
That definition is about to widen — release engineering, automation and workflow
stabilisation belong in it too, and §8 holds the space for that rather than
guessing at it.

---

## 0. The committed versions

**1.0 ships the Play surface with two modes: Scene and Freeform.**
**2.0 adds Write — a surface of its own, holding Outline and Prose
([13](../13-write-mode.md)).**
**3.0 adds the Character Studio — the surface that turns a played actor into a
reusable visual identity ([17](../17-character-studio.md)).**
**4.0 adds World — the continuity container ([15](../15-world.md)).**
**5.0 adds Campaign — the mode, and the RPG channel library under it.**
**6.0 adds the authoring tier — authored rules, and the surfaces that make
authoring what you played a first-class activity.**

**Surfaces own modes, and the two words are not interchangeable.** A surface is
a top-level place in the application; a mode configures the pipeline inside one.
Play holds Scene and Freeform, and later Campaign; Write holds Outline and
Prose. The old *Adventure–Freeform* and *Adventure–Campaign* pairing is gone:
Adventure was a grouping that existed to hold two modes sharing a preset
lineage, and it obscured the thing that actually matters, which is the surface a
mode belongs to ([06 §7](../06-modes-and-turn-pipeline.md),
[10 §2](../10-ui-surfaces.md)).

**The ordering criterion is what must have *happened* first, rather than what
must have been built.** Sequencing releases by subsystem dependency is the
obvious approach and the weaker one, because it only says what code must exist.
Five of these six tiers are gated on something having been *used*, which no
dependency graph shows:

| Release | What must have happened |
|---|---|
| **1.0** | Nothing. This is the core loop, and where this project diverges most from what already exists. |
| **2.0 — Write** | 1.0's substrate *built*. Write consumes lorebook activation, mention resolution, the mode contract as a real interface rather than a shape one built-in mode happens to fit, and the summary chain — P5 through P8 ([13](../13-write-mode.md)). |
| **3.0 — the Character Studio** | 1.0's actors *played*. Every format prerequisite lands at 1.0 ([17 §5](../17-character-studio.md)), so no later release owns anything it consumes; what it waits for is a stock of actors worth making reusable, because a reusable visual identity is worth nothing until there is a character you want back. |
| **4.0 — World** | 1.0's play *accumulated*. A World is worth nothing until the third session ([15](../15-world.md)), so designing a continuity container before continuities exist is designing against a guess. |
| **5.0 — Campaign** | 4.0's *continuity to run in*. A campaign is a multi-session form by nature — [06 §7.3](../06-modes-and-turn-pipeline.md) wants sessions-within-a-campaign with structured recaps and a bridging message on resume, and calls that a shared capability rather than a Campaign-specific one. World is where it becomes shared. |
| **6.0 — the authoring tier** | 5.0's play *authored*. The rule vocabulary was deferred for want of a corpus of real authored worlds to design against ([25 C7](../25-open-questions.md)), and a release of Campaign is what produces one. |

**The 6.0 row is literal rather than a play on the word.**
[25 C7](../25-open-questions.md)'s argument for deferring the rule vocabulary is
that Infinite Worlds ran on triggers and tracked items for years before arriving
at PawScript, and arrived at it *with a corpus of real authored worlds to design
against.* Putting the tier a full release behind Campaign means the language is
designed against the thing its own deferral argument asks for, instead of
against imagination. §0.6 is the release itself, and says why it is *the
authoring tier* rather than *authored rules*.

**Where this project has an opinion is the secondary reading, and it mostly
agrees.** Scene and Freeform are the modes worth being opinionated about, and
they go first. Write is the most opinionated thing in these documents
([13 §1](../13-write-mode.md)), and it goes second. Campaign is very good in
Marinara already — what StoryEngine adds is multi-user and the channel model
underneath, not a different opinion about what an RPG mode should be — so it
goes last among the modes.

*Where the two readings disagree is 5.0, and the happened-first one wins.*
Opinion alone would let Campaign go earlier, since being unopinionated is a
reason to build against a proven substrate rather than a reason to wait four
releases. What actually holds it is the continuity dependency in the table
above: a campaign without sessions that know about each other is a campaign with
the recap written by hand.

**Messages is not a committed version at all.** It was scheduled for 2.0 and now
sits on the feature list as part of a Social cluster ([24](../24-roadmap.md)),
on the proposition that messaging, a feed and a board are three modes of a
*fourth surface* rather than one more mode of Play. That is a better shape than
the one it had and it is not yet defined well enough to schedule. §0.3 records
what deferring it costs, which is more than the mode.

**The release line is therefore: alpha → beta → 1.0 → 2.0 → 3.0 → 4.0 → 5.0 →
6.0.**
1.0 is a real release with a `release/1.0` branch that persists
([releases §2](04-repo-and-releases.md)); each series after it continues on `main`
while the previous release branch takes fixes.

### 0.1 What deferring a mode removes

Deferring a mode removes more than the mode:

| Deferred with | Lands | What goes with it |
|---|---|---|
| **Messages** | feature list | Presence (Active/Idle/DND/Invisible), per-actor schedules, autonomous messaging, Discord-style profiles, reactions, the command-family gating model |
| **Messages** | feature list | **Background scheduling.** Autonomous messages were the forcing function for a server-side timer that starts turns with no client attached. Nothing else at 1.0 needs one — the plot-hook selector is a pipeline step, not a timer. Turns remain server-side *jobs* for reattach, which is a different thing. |
| **Messages** | feature list | Web Push, ntfy and the delivery-channel spread, and the `message.received` event class |
| **Campaign** | 5.0 | The RPG channel library: HP and pools, attributes, inventory, quests, map, clock/weather, NPC reputation, sessions-within-a-campaign, combat |
| **Campaign** | 5.0 | Incremental world generation at setup, and the character-sheet machinery |

**Notifications stay at 1.0 but shrink.** The Messages argument for them goes
away; the other two do not — completion sounds, and awaiting-input when a turn
suspends for the player ([25 C5](../25-open-questions.md)). In-app plus the
browser Notification API covers 1.0.

**The event schema does not shrink** ([25 A2c](../25-open-questions.md)). Class,
target user, `{key, params}` summary, dedupe key and coalescing window are the
retrofit cost, and they are as cheap now with two event classes as with ten.

### 0.2 The checks this cut creates

The scope cut is also a test, and it is worth stating as a commitment rather
than a hope. It is five commitments rather than one, because the six tiers do
not all make the same promise.

> **Adding Campaign at 5.0 must require no changes to the 1.0 portable schemas**
> ([04](../04-schemas.md)).

The design says it should not: Campaign's state lives in channels the mode
declares, and nothing it needs touches Actor, Lorebook, Treatment, Setup or
Package. If it turns out to need a schema change, the mode contract or the data
model was wrong — and finding that out at 5.0 is exactly what the stability
tiers exist to prevent. The same held for Messages when it had a release, and
holds again if it ever gets one.

> **World at 4.0 must add no portable kind at all** ([15](../15-world.md)).

A World is a play-side grouping of sessions rather than a seventh portable kind,
and sessions are the free-to-move tier ([04 §1](../04-schemas.md)). This is the
easiest of the five to pass and the easiest to fail by accident, because the
pressure to make a World exportable will be real the first time somebody wants
to share one.

> **Write at 2.0 may change internal-tier shapes and may not break portable
> ones.**

Write's version is the mirror of the other two, and needs stating because it
does not pass unchanged. It adds a *kind* — Manuscript — which is not a change
to an existing portable schema, and [13 §5](../13-write-mode.md) argues it into
the internal tier precisely so that it is not one. The turn record's anchor and
the span overlay are internal and free ([04 §1](../04-schemas.md)); the three
lore-entry fields it wants are optional additions and therefore not a bump
([04 §2](../04-schemas.md)) — and they land at 1.0 rather than with Write, per
§0.5.

> **The Character Studio at 3.0 must add no portable schema change at all**
> ([17 §5](../17-character-studio.md)).

Not *no breaking change* and not *no new kind* — **no change**. All four of the
Studio's obligations are Actor-card format work inside the 1.0 series: typed
media roles, structured descriptors, per-media generation provenance, and crop
as a stored rectangle. The Studio is a surface over a format that already
exists, so if it turns out to need a field, one of those four was specified
wrong — and the first of them is not recoverable, because guessing afterwards
which image was the canonical likeness is not a migration. **This is the
strictest check in the series and the first one to run**, which is the change
the re-ordering makes to this section.

> **The authoring tier at 6.0 must add only optional fields and new variants.
> No portable schema may bump.**

Everything the tier returns was *removed* rather than stubbed, which is what
makes this checkable: `PlotHook.requires` and `onFire` come back as optional
fields, `Goal.completion` gains a third variant, and `rules` is a new optional
collection on Package and Treatment ([02 §2.2](../02-infinite-worlds.md)).
Adding an optional field and adding a variant are both additive
([04 §2](../04-schemas.md)). If the tier turns out to need a *breaking* change to
Actor, Lorebook, Treatment, Setup or Package, then §0.4 performed a deletion
rather than a deferral — and that is worth discovering as a failed check rather
than as a surprise.

**Worth naming: the checks no longer run in the worst possible order.** Write's
looser rule still applies at the nearest release and Campaign's strict one is now
four releases out rather than three, which on its own would be the reverse of
where a check does the most good. What changes it is the Character Studio: its
check is the strictest of the five and it runs at 3.0, so a format frozen at 1.0
gets asked whether it was right two releases on rather than four.

**Campaign's remains the late one**, and the mitigation is unchanged: the strict
rule is checkable *now* — nothing has to wait for 5.0 to ask whether Campaign's
channels touch a portable schema, and
[21 §6](../21-internal-contracts.md) is where that question already lives.

### 0.3 The honest cost

Cutting a mode also cuts a forcing function, and two seams go into 1.0 designed
but unexercised. Both got worse in this re-cut, and the second got worse in a
way that has no end date.

- **Heavy channels and engine-computed effects** were Campaign's to prove.
  Freeform uses channels lightly by design, so the model is under-exercised —
  and Campaign is now four releases out rather than one. The mitigation is real
  but partial: the dice reference extension ([24 §4.4](../24-roadmap.md))
  exercises engine-computed channels and evaluate-before-narrate on a small
  surface, which is a reason to keep it at 1.0 even though Freeform defaults to
  no mechanics.
- **Background scheduling and presence** were Messages' to prove. They are
  specified ([09 §3](../09-server-multiuser-deployment.md)), nothing at 1.0 will
  test them, and Messages no longer has a release — so unlike every other
  deferral here, this one has no date at which the seam finally gets exercised.
  There is no mitigation short of building something that needs a timer.

**The second is the sharpest cost of this cut and should not be softened.** A
specified-but-never-run subsystem decays: the code rots quietly and the design
stops being checked against anything. The honest options are to accept it, to
find a smaller consumer that genuinely needs server-side scheduling, or to drop
the specification until something does. This plan accepts it, and records the
choice here so that it is a decision rather than an oversight.

**And one cost that belongs to §0.6 rather than to a deferred mode: three
predicate dialects run separately for five releases.**

The authored-rule vocabulary is not a greenfield language design. It is
substantially the job of *unifying* three mini-vocabularies that all ship inside
1.0:

| Dialect | Ships | Scope, and the guard already written against it |
|---|---|---|
| Lorebook `activationConditions` and `schedule`, unified as channel predicates ([03 §3.3](../03-data-model.md)) | ~~P5~~ **P7** | The minimal comparison set. *"Anything richer waits for the rule vocabulary and must not leak in here early"* ([P5 §1.4](17-p5-implementation.md)). **Moved 2026-09-07 at [P6B.1](20-p6b-playable.md):** P5 decided in the code not to build it — the schema lists `activationConditions` as deliberately absent and the importer discards it — and no document followed, so this cell read P5 for a thing P5 had declined. A predicate needs a channel to be about, and channels become a contract at P7. |
| `StepCondition` | P7 | A small closed set — a cadence, a stage flag, an explicit arm. *"Deliberately not an expression language… the tempting move once rules arrive is to let steps take rule predicates, and that quietly makes an internal shape depend on a portable one"* ([06 §6](../06-modes-and-turn-pipeline.md)). |
| `PlotHook.involves`, `notBefore`, `blockedBy` | P7 | Mechanical filters that need no vocabulary at all, and carry most authored hooks (§0.4). |

**Every release those three run apart is a release in which each can grow a
special case under real user pressure.** Three still-minimal dialects unify
cleanly; three that have each acquired one convenience do not, because the
convenience is now behaviour somebody depends on. Putting the tier a release
behind Campaign buys a better corpus (§0.6) and pays for it here — and inserting
the Character Studio ahead of both adds one more release to that bill
([17 §1.3](../17-character-studio.md)), which is the sharpest thing that
re-ordering cost.

**The mitigation is real but it is a person's job rather than a mechanism.** All
three guards are written down in the documents that own them, and none of them is
enforced by anything. The check worth running at each phase revisit is narrow:
*did any of the three grow an operator this release, and if so, why was it not a
reason to unify?*

### 0.4 Further cuts, not driven by the mode scope

§0.1 cut what falls out of deferring modes. These are different: they survive
the mode cut and were removed anyway, on a review pass that asked the question
§2.1 exists to ask — *what is additive, and can therefore wait?*

**Authored rules: the vocabulary and evaluator go to 6.0, a release behind
Campaign.**

The third extensibility tier ([06 §4.1](../06-modes-and-turn-pipeline.md)) stays
a committed direction. What moves is the part that is a language design project
wearing a feature's clothes: a predicate and effect vocabulary, an evaluator,
and the authoring surface that makes either usable. §0.6 is where it lands and
what it lands with.

Three reasons, and the third is the strongest:

- [25 C7](../25-open-questions.md) already held the vocabulary open, and two stable
  schemas were carrying ⚠ warnings because they depended on something
  unspecified — `PlotHook.requires`/`onFire` and `Goal.completion`. Deferring
  removes both warnings and makes those schemas honestly stable.
- Infinite Worlds — the entire evidence base for this tier
  ([02](../02-infinite-worlds.md)) — ran on triggers and tracked items for years
  before arriving at PawScript, and arrived at it *with a corpus of real authored
  worlds to design against.*
- **We have no such corpus.** Designing an expression language against
  imagination is how you get one nobody can use. Channels and engine-computed
  effects ship at 1.0 and are where the actual power lives; the rule layer gets
  designed at 6.0, against a release of real Campaign play.

**It sits a release behind Campaign rather than beside it**, which is the change
from when this was tied to Campaign directly, and the reason is that **Campaign
does not need it.**

That claim is worth being exact about, because the two look coupled.
[02 §2](../02-infinite-worlds.md) introduces the tier with RPG-shaped examples —
quest state machines, loot generators, class trees — but those are things
Infinite Worlds' *authors* built with no engine involvement. Campaign is not an
author. It is a first-party mode package consuming the published SDK
([19 §10](../19-tech-stack.md)), and its determinism comes from
`update: "engine-computed"` ([06 §4](../06-modes-and-turn-pipeline.md)) — the
mode declares a channel and computes the update in code. Combat round maths, HP
pools, inventory arithmetic, quest counters: Campaign's own TypeScript, needing
no predicate language to express.

**Three seams touch, and all three are additive** (§0.2):

- `PlotHook.requires` and `onFire` — already severed. Both were removed from the
  schema rather than stubbed ([04 §6.1](../04-schemas.md)), and hooks keep the
  mechanical filters that carry most authored ones.
- `Goal.completion: { kind: "mechanical" }` — a third variant beside `narrative`
  and `manual`. This is the one that genuinely wants the vocabulary, and the
  reason is instructive: `Goal` sits on **Setup**, which is portable *authored*
  content, so a quest's completion condition belongs to the author rather than
  to Campaign. Campaign's code cannot supply what is not Campaign's to say.
- Author-declarable channels — the `owner`-accepts-a-package-id widening lands
  at 1.0; only the authoring surface waits.

**So what a rules-less Campaign cannot do is let somebody else author one.**
Every authored quest completes narratively or manually; a shipped Package can
declare a Corruption channel but not state a rule about it — which is exactly the
gap [02 §2](../02-infinite-worlds.md) names as the tier's reason to exist. That
is a real hole, and it is a hole in the *authoring* story rather than in
Campaign, which is why §0.6 is a release about authoring rather than a release
about rules.

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
([19 §12](../19-tech-stack.md)).

### 0.5 What 1.0 gained

Four things moved *into* 1.0 on the same review pass, three of them because a
release that cannot be installed, exported or restored is not a release anyone
can rely on.

**Packaging is pre-1.0, and all six artifacts are in it.**

An earlier pass cut packaging to container plus tarball at beta and put the
other four "at the 1.0 bar", which left them owned by no phase at all: P11 is the
last phase before beta and put them out of scope, so four required artifacts had
a requirement and no builder. That is the failure a bar without an owner always
has.

The reasoning that put them on the list is unchanged and right — a home server
product people cannot install is a home server product nobody uses. What changes
is that **P11 owns all six** ([P11](28-p11-implementation.md)), while the beta
gate keeps its narrower requirement of the OCI image and the tarball
([releases §0](04-repo-and-releases.md)). Enough to have users is the beta test;
enough to be installed by people who are not us is the 1.0 test.

**Session export ships at 1.0** ([25 B12](../25-open-questions.md)).

Previously "yes, eventually. Not an early priority", with no release attached.
Two arguments move it: *feature complete to the 1.0 spec* is not a credible
claim about a storytelling tool whose stories cannot leave it, and export is the
beginning of the session interchange format that every other import question
depends on ([25 B13](../25-open-questions.md)).

It carries one hard ordering constraint. [13 §13](../13-write-mode.md) requires
that export "must not freeze the turn record before §4 is settled", and
[13 §15](../13-write-mode.md) sets a reopening condition on itself for exactly
this case. Export at 1.0 with Write at 2.0 triggers it: **[13 §4](../13-write-mode.md)
must be settled before export ships**, which makes Write a near-term design
question rather than a far one.

**Backup and restore ships at 1.0** ([25 E6](../25-open-questions.md)).

Small — quiesce, archive the data directory excluding the index, restore and
rebuild — and in the same class as the two above. Files on disk means `rsync`
works today and should be documented. The part that matters is the CI restore
test ([testing testing](03-testing.md)); an untested restore is not a backup, and
shipping a self-hosted data product without one is a gap rather than a deferral.

***~~Small~~ — and the sizing above is what [P12](29-p12-implementation.md)
reopened, 2026-09-22.*** It shipped that small at
[P11.11](28-p11-implementation.md) and the result was a command nobody on the
two supported deployment paths can reach: both hand a person a browser and
nothing else. So backups grew a surface, a schedule and an import — and
[25 E6](../25-open-questions.md)'s *do not build a subsystem* is amended rather
than quietly ignored, with the one word that was wrong (*outside*) named there.
**The sentence that survives intact is the one this row was always really
about**: an untested restore is not a backup.

**The three lore-entry fields land at 1.0** ([13 §13](../13-write-mode.md)).

The AI-context value, the track flag and the exclusion list, added as *optional*
fields whose absence means today's behaviour. Write wants them and Write is now
2.0, so the old "2.0 at the latest" deadline collides with its own consumer.
Optional fields are additive and free; *reinterpreting* the existing constant
and enabled flags as the four-value axis would be a version bump
([04 §2](../04-schemas.md)). Free now, a bump later, so now.

### 0.6 The authoring tier, and why it is not called "authored rules"

**6.0 is the release where authoring what you have played becomes a
first-class activity.** Authored rules are its mechanism; they are not its
product.

The distinction is not cosmetic. A release whose entire content is *a language
for authors* has no forcing function of its own — it would be designed by us,
for us, against our own idea of what an author needs. That is
[25 C7](../25-open-questions.md)'s failure mode arriving through a different
door: **the corpus protects against designing the wrong vocabulary; nothing in
it protects against designing a vocabulary nobody asked for.** A release that
can state its purpose in a sentence a user would recognise — *you can now author
what you have been playing* — has a shape to design against, and rules become
the part that makes the rest work.

**What lands together:**

The design is [16](../16-authoring.md); this is the scope.

| Piece | Why it belongs here |
|---|---|
| **The rule vocabulary, its evaluator, and the authoring surface** | The mechanism. [06 §4.1](../06-modes-and-turn-pipeline.md), [25 C7](../25-open-questions.md), [02 §3](../02-infinite-worlds.md) for the starting vocabulary, [16 §2](../16-authoring.md) for what this release adds. |
| **The author-declarable channel surface** | Rules need something to be about. The `owner` field widens at 1.0; what waits is a way for an author to *define* a channel rather than only to have one defined for them ([02 §2.2](../02-infinite-worlds.md)). |
| **Lorebook extraction from a session** | The play-to-authoring loop itself — *play a session, keep the world* ([16 §3](../16-authoring.md)). Moved off the feature list, because it is the clearest single statement of what this release is for. |

**The Character Studio was a member of this tier and is now 3.0**
([17](../17-character-studio.md)). It shared the shape — extraction turns a
played session into a lorebook, and the Studio turns a played actor into a
reusable one — and it turned out not to share the gate: every one of its
obligations lands at 1.0, so nothing here holds it and nothing it needs waits for
the corpus. It was also always the least settled member, the only piece whose
*surface* question was open, and that question is better answered as a release's
first problem than discovered as a tier's late one
([17 §6](../17-character-studio.md)).

**The tier keeps its point with two members and a surface**, because the two that
remain are the two the corpus argument is actually about: a vocabulary designed
against real authored worlds, and the loop that produces them. *You can now
author what you have been playing* is still the sentence.

**What is deliberately *not* here.** Continuity checking and the branch tree
visualiser stay on the feature list ([24](../24-roadmap.md)) — both are readers
rather than authoring surfaces, and folding them in would make this a release
about "everything left", which is how a scope stops being checkable
([releases §0](04-repo-and-releases.md)).

**One decision this release inherits half-made.**
[02 §6](../02-infinite-worlds.md) argues that one expression language should
serve both template rendering and rule conditions — one thing for authors to
learn, one evaluator to sandbox. Liquid is already chosen for block templating
and P4 proceeds on it, deliberately leaving the other half of
[25 C6](../25-open-questions.md) open ([P4 §6.1](16-p4-implementation.md)).
Deferring rules to 6.0 does not defer that choice; it extends how long the
project runs on a half-made one. **The revisit should ask whether Liquid still
looks right for conditions after five releases of using it for templates**, and
treat "no" as an answer worth having rather than an inconvenience.

### 0.7 What is not a committed version

Everything else is on the feature list ([24](../24-roadmap.md)), which is a
different kind of document: three priority tiers with no releases attached, plus
a parallel wishlist of things we hope somebody else builds.

Nothing there is scheduled — and, the part worth saying out loud, nothing there
is refused either. An item on that list is **unscheduled, not unwanted**, and any
of them can be pulled forward by whoever wants to build it.

The boundary is simply this: **a committed version has a number, a scope, and a
gate it is checkable against ([releases §0](04-repo-and-releases.md)). Everything else
has a priority.**

---

## 1. Two things this plan is built around

**Vertical slices, not horizontal layers.** Do not build all the storage, then
all the assembly, then all the UI. Get *one turn working end to end* as early as
it can be made to work, then widen. The alternative produces three subsystems
that have never met.

**Order by what unblocks learning, not by what sounds foundational.** Two items
land far earlier here than instinct suggests, both flagged in
[triage §8](02-triage.md):

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
  library merges without collisions ([09 §4.3](../09-server-multiuser-deployment.md)).
- **No `owner` / `visibility` fields.** The path is the owner. Adding them later
  is a feature; removing them later is churn.
- **Per-user directory structure from the first write** — `users/<handle>/…`.
  Retrofitting user scoping into a flat store is miserable.
- **Every portable object self-describes** with a `schema` field, so containers
  never enumerate kinds ([04 §9](../04-schemas.md)).
- **Channel state records its schema version** — one integer, never the schema
  itself ([06 §4.2](../06-modes-and-turn-pipeline.md)). Without it, a later
  migration cannot tell what it is migrating from.
- **Turn segments append in creation order, never rewritten**, with reading order
  resolved through the index ([03 §5.5](../03-data-model.md)). Making file order
  resemble tree order is the mistake that makes branching a storage problem.
- **Readers preserve unknown fields.** The single rule that lets formats evolve
  ([04 §2](../04-schemas.md)).
- **Reserve the `se.*` section-id namespace** ([04 §4](../04-schemas.md)).
- **Typed media roles** on embedded media, even if only two are populated
  ([03 §5.2.2](../03-data-model.md)).
- **Structured `VisualDescriptors`** alongside prose appearance.
- **Per-media generation provenance including the seed** — a reference image
  whose seed was not recorded cannot be regenerated
  ([17 §5](../17-character-studio.md)).
- **Crop as a stored normalised rectangle**, never a destructive edit.

### The turn record

- **Blocks recorded with source, reason, token cost and budget verdict.** Not a
  debug feature; the workbench, replay and branching all read it
  ([03 §8](../03-data-model.md)).
- **Effects complete and reversible.** The sharp test is not undo, it is that
  branching is a pointer rather than a copy ([07 §2](../07-branching.md)).
- **`advisory: true` on guidance-class blocks**, refused by any effect-producing
  call ([06 §5.2](../06-modes-and-turn-pipeline.md)).
- **Cost recorded even though nothing displays aggregates at 1.0** — a spend view
  built later over uncaptured data shows nothing ([10 §3](../10-ui-surfaces.md)).
- **Turn storage tolerates removal** — tombstone plus compaction, no UI needed
  ([24 §1.6](../24-roadmap.md)).
- **Summaries content-addressed by their inputs**, never a rolling mutable total
  ([07 §5](../07-branching.md)).

### Runtime

- **One RNG service; every draw recorded; draws keyed by site, not position**
  ([19 §14](../19-tech-stack.md)).
- **Steps name model *roles*, never models** ([19 §5.1](../19-tech-stack.md)).
- **Prompt caps declared per provider; composed prompts built from ranked
  fragments** ([19 §5.3](../19-tech-stack.md)).
- **Server events carry `{key, params}`, never English prose**
  ([09 §3.4](../09-server-multiuser-deployment.md)).
- **Notification event schema complete from the first producer** — class, target
  user, dedupe key, coalescing window ([25 A2c](../25-open-questions.md)).
- **`locale` on the account** ([09 §4.2](../09-server-multiuser-deployment.md)).
- **The step contract async and serialisable from the first step** — the worker
  boundary ([22](../22-extensions.md)) is not something to convert to later.
- **One audited path-resolution helper**, used by every filesystem-touching
  route ([19 §9](../19-tech-stack.md)).

### Client

- **CSS logical properties from the first stylesheet.** `margin-inline-start`,
  never `margin-left`. Skip this and RTL is permanently foreclosed
  ([19 §12.6](../19-tech-stack.md)).
- **Never concatenate sentences from fragments, and never put a user-visible
  string in logic** ([19 §12.6a](../19-tech-stack.md)). Wrapping strings and
  extracting the catalogue is a pre-beta task; *these two* are habits, and a
  codebase that broke them has to be reworked component by component with nothing
  flagging where (§0.4).
- **`Intl` for all dates, numbers and relative times.** No hand-rolled
  "2 minutes ago".
- **Semantic HTML, focus management, and a keyboard path through the play loop.**
  Landmarks and headings that mean something, focus moved deliberately on view
  change and returned on dismiss, every play-loop action reachable without a
  mouse, and **no state encoded in colour alone** — the turn status indicators
  ([10 §9](../10-ui-surfaces.md)), the mention confidence tiers
  ([10 §13.1](../10-ui-surfaces.md)) and the cast badges
  ([10 §13.2](../10-ui-surfaces.md)) all need a second channel. Same argument as CSS
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
  ([P1 §P1.7](07-p1-implementation.md)) has a real write path and an empty slot
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
worked example ([P1 §1.3](07-p1-implementation.md)): a stub user context was one
file, but it would have been threaded through every route in P1 through P9 and
then torn out at P10, which is every one of those routes written twice. The real
thing — scrypt, a session cookie, CSRF, a first-run admin — is not much more code
than the stub *plus* its eventual removal, and the design had already ruled out
everything that makes auth large ([09 §4.1](../09-server-multiuser-deployment.md)).

Three qualifications, because this rule is the easiest one here to abuse:

- **It does not override §2.1.** The question is only asked about things that
  must exist now. If nothing needs it yet, defer the whole thing — that is not
  throwaway work avoided, it is work not done, which is better.
- **It is not permission to build the finished version.** Capability
  *enforcement* was deferred past P1 even though the `Capabilities` record ships
  in P1: the record is a persisted shape (§2's first cost), the enforcement is
  additive (§2.1). Splitting on that line is the point.

  *Enforcement moved to [P2A](09-p2a-configuration-surface.md), and the example
  is better for it rather than spoiled. The split was correct while nothing
  granted a capability. What changed is that P2A builds the screen that grants
  them — and this same section forbids a system whose only purpose is to be
  replaced, which is what a switch labelled "may add their own provider keys"
  becomes when nothing reads it. The line is still record-versus-enforcement;
  it just turned out that the phase which grants is the phase that owes.*
- **Test doubles are exempt.** Fakes, fixtures and harnesses are supposed to be
  disposable, and [testing](03-testing.md) governs them. This is about production
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
[P2A](09-p2a-configuration-surface.md) is the repair;
[P2B](10-p2b-provider-configuration.md) is the rest of it.

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
[testing §2](03-testing.md)'s whole argument is that a lint rule is worth more
than a paragraph in a document nobody re-reads, and the mechanically checkable
core here is that **`config.example.json` declares every key the schema does** —
a test that would have caught the four keys that had already drifted out of it.
The rest of the rule is a question every exit gate now asks: *does anything this
phase built need a value set, and where does someone set it?*

---

## 3. Before any code: close the A-series

[25 §A](../25-open-questions.md) exists precisely because these constrain
everything downstream.

**The A-series is closed.** A1/A1c: a worker-thread
boundary with a namespaced storage API ([22](../22-extensions.md)). A3: connections
are account-scoped with a system scope, mirroring the library
([09 §4.5](../09-server-multiuser-deployment.md)). A4: raw completion is legacy and
unsupported ([19 §5.5](../19-tech-stack.md)). That resolves the one item this plan
called genuinely unretrofittable, and it changes P2 and P7: the step contract is
async and serialisable from the first step written, not converted later. A5–A8
are confirmed: multiplayer stays "don't preclude, don't build"; React + Vite +
TanStack; TypeBox; Node LTS with `node:sqlite`.

**A2c is closed too**, by separating progress events from notifications
([09 §3.2](../09-server-multiuser-deployment.md)) — granular status turns out to
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
| The turn record is *legible*, not just complete | [00 §1](../00-stance.md), [10 §3](../10-ui-surfaces.md) | Use the workbench to answer a real "why did it say that" |
| Files on disk beat a database for this | [00 §3.4](../00-stance.md), [03 §5](../03-data-model.md) | Hand-edit a card mid-session and watch it take |
| One budgeter over everything is comprehensible | [00 §2.6](../00-stance.md), [06 §5](../06-modes-and-turn-pipeline.md) | Watch it under pressure against an imported library, not fixtures |
| Inclusion reasons are a product feature | [06 §5](../06-modes-and-turn-pipeline.md) | Read them and see whether they explain anything |

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

**Expanded into a working plan: [P1](07-p1-implementation.md)** — stages, the
decisions the design documents left open (folder naming and rename, duplicate ids
on disk), the phasing revision that pulls auth forward from P10, and the exit
gate.

Repo shape ([19 §10](../19-tech-stack.md)), workspaces, CI, schema tooling, licence
headers. Then the part everything else stands on:

- Portable object schemas ([04](../04-schemas.md)) as TypeBox, emitting JSON Schema.
- Files on disk, atomic writes, per-user layout, the PNG card envelope.
- Derived index, filesystem watcher, **rebuild-from-disk as a startup option**.
- Library CRUD, with accounts and login ([P1 §1.3](07-p1-implementation.md)).
- **Version history on write** ([03 §11](../03-data-model.md)) — cheap here and
  awkward later, because the trigger points are every write path there will ever
  be. The watcher makes *hand-edits* snapshot too, which no source can offer and
  which this phase's demo exercises directly.
- A library list, and **a prototype actor editor**
  ([P1 §P1.7](07-p1-implementation.md)) — actor only, real write path, no assist.
  The editor is also where the history panel first appears
  ([10 §11.2a](../10-ui-surfaces.md)): restore and diff are the parts worth having
  early, since they are what make a prototype editor safe to experiment in.

**Demonstrable:** create an actor through the API, see the folder appear, edit
the JSON on disk by hand, watch the change reflected without a restart. That
last step is the whole storage thesis in one gesture — if it does not work, the
design has already failed ([10 §4.1](../10-ui-surfaces.md)).

**And then the harder version of the same demo:** hand-edit an object on disk
*while it is open in the editor*, and watch the save be rejected rather than
silently eat one of the two edits ([09 §4.4](../09-server-multiuser-deployment.md)).
The first demo proves the storage model reads honestly; this one proves it
survives a second writer, which is the claim that actually has to hold once
anyone uses it. It is the reason P1 carries an editor at all.

**CI from here on:** rebuild-from-disk equals incremental index.

### P2 — One turn, end to end

**Expanded into a working plan: [P2](08-p2-implementation.md)** — the P1 audit
and hardening stage, the turn pipeline, and the exit gate.

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
([testing](03-testing.md)).

### P2A — The configuration surface

**Expanded into a working plan: [P2A](09-p2a-configuration-surface.md).**

[10 §15](../10-ui-surfaces.md)'s core, pulled forward from P10 — not because it
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

**Expanded into a working plan: [P2B](10-p2b-provider-configuration.md)**, with a
§6 naming what P2A has to settle before its last questions close.

System connections and the install default bindings through the UI, admin-only
for now ([09 §4.5](../09-server-multiuser-deployment.md)). The per-user half
waits on P2A's capability enforcement and on there being a system layer to fall
back to.

**Which there is not.** Writing the plan found that the install-default layer
[09 §4.5](../09-server-multiuser-deployment.md),
[10 §15.3](../10-ui-surfaces.md) and [19 §5.1](../19-tech-stack.md) all rely on
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

**Expanded into a working plan: [P2C](12-p2c-first-real-run.md).**

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
sessions — and [P2C §1.8](12-p2c-first-real-run.md) says what it costs to cut.

**Demonstrable:** the P2B demo, finished. A turn against a real endpoint, from an
empty directory, with the exchange committed as a fixture the suite replays
offline.

### P3 — The workbench

Early, deliberately. Block list with sources and reasons, budget verdict, calls,
effects, per-turn cost, diff between two turns.

**Why here:** everything after this is debugged through it. It is also nearly
free at this point, because the turn record already holds everything — the
workbench is a *reader*, not a second assembler ([10 §3](../10-ui-surfaces.md)).

**Expanded into a working plan: [P3](15-p3-implementation.md)**, revised against
the record as built rather than as designed. It holds almost everything the
workbench renders; the exceptions are named there, and two of them are one field
each in P2's record rather than work for this phase.

*Built and merged. Every phase since has been debugged through it, which was the
argument for building it early.*

### P4 — Import

**Expanded into a working plan: [P4](16-p4-implementation.md)**, the revisit its
skeleton asked for, performed against the repo rather than against the design.

Cards, lorebooks and presets from SillyTavern, Marinara and Aventuras. The
largest PORT in the triage ([triage §4](02-triage.md)) and the reason to do it now:
it turns an empty install into a realistic library.

**Presets are the load-bearing half and the one to sequence first**, because they
are what makes the imported library *playable* rather than merely present, and
because the conversion is already designed ([04 §8.4](../04-schemas.md)) against
ST's actual format rather than against a guess. Three things it must do from the
first version: drop connection fields unconditionally and report them
([04 §8.4.4](../04-schemas.md)), preserve depth-injected blocks at their depth
rather than flattening them to the top, and name every lossy conversion in the
review instead of implying fidelity.

**Demonstrable:** point it at a real SillyTavern data directory — **or a real
Marinara data directory** — and get a populated library, with a review step
showing what resolved, what went to `compat`, and what dangled — and a converted
preset whose block list, read in the workbench, is recognisably the preset that
went in.

*The second arm was added 2026-08-29 ([P4 §1.5](16-p4-implementation.md)).*
Marinara's library is a relational store rather than a folder of files, so a
second folder source is not a second helping of the same work — it is what
decides the shape of the sweep engine, which is why it was settled before P4.0
rather than during P4.3.

**Then stop — this is where PLAYABLE falls (§4.1).**

*Built and merged, and the import previews what it would do before it writes
([P4 §7](16-p4-implementation.md)). Nobody stopped: PLAYABLE has not run, and a
private Alpha 1 is being cut first, under the rule
[P6A §5](19-p6a-alpha-1.md) sets. **Three phases later it has a phase of its
own** — [P6B](20-p6b-playable.md), opened 2026-09-07, because the reason nobody
could stop turned out to be a missing surface rather than a missing intention:
nothing anywhere chooses a session's lorebooks, so the checkpoint's own subject
could not be put under pressure.*

### P5 — Lorebooks and retrieval

**Expanded into a working plan: [P5](17-p5-implementation.md)**, restructured
into two halves — the book as a *document* first, the retriever second, because
half of *why doesn't this entry fire* is a reading problem before it is a
matching one.

**Half-revisited, deliberately.** Audited against the repo at P4's close, with
the decisions that audit forces settled and the four that genuinely need
PLAYABLE's findings marked and left open. That checkpoint's findings are about
exactly this phase's subject, so the remaining half of the revisit waits for
them rather than guessing.

Full activation semantics, folders, the two-tier budget, trim order, skip
reporting. Now testable against P4's real library rather than fixtures.

**Demonstrable:** the workbench showing exactly which entries fired, why, what
they cost, and what the budget dropped.

*Built and merged (`a27be5b`), and **closed 2026-09-09 with its exit gate
unwalked** — the eighteen steps stand as
[manual testing sitting F](05-manual-testing.md), which is what the two-tier
gate does with a gate whose moment has passed.
[P5 §0.5](17-p5-implementation.md) says what walking it would have met —
including that the browser still had no way to choose a session's lorebooks,
which [P6B.0](20-p6b-playable.md) then fixed without the walk having happened.*

### P6 — The turn tree

**~~Skeleton~~ Plan, and now the record: [P6](18-p6-implementation.md)** —
mostly sequencing, unusually, because [07](../07-branching.md) and
[19 §14.5](../19-tech-stack.md) already decided the tree model,
swipes-as-branches, snapshots-as-cache and the tape.

Branching, rewrite/reroll, the RNG tape, sibling navigation.

**Why before modes:** it changes the shape of the turn store, and every mode
built after it inherits the behaviour for free. Built after modes, it is a
migration.

*Built and merged (`a6f78c3`), and **closed 2026-09-09**.
[P6 §3](18-p6-implementation.md) marks what the suite covers; what it does not
is two rows — a branch two hundred turns back and a clock on the
reconstruction — standing as [sitting J](05-manual-testing.md), both waiting on
a session that only a long play produces. Of §5's three questions for PLAYABLE,
one is answered: the sibling affordance, at [F-06](21-playable-log.md).*

### P6A — Alpha 1

**Expanded into a working plan: [P6A](19-p6a-alpha-1.md)**, written at its phase
rather than ahead of it — P6 merged the morning it was drafted.

**The first build you can go back to.** Six phases in, the only record of a
working state is the commit graph, so *the version where lorebooks worked before
the budgeter changed* is archaeology rather than something anyone can run. Alpha
1 is that state tagged, changelogged, built from the tag, and started with one
command.

**It is an artifact, not a distribution**, and [P6A §0](19-p6a-alpha-1.md) makes
that the load-bearing distinction. The repository and the registry package are
both private, the unraid template is written and committed rather than submitted,
and nothing about `latest`, `nightly` or the other five packaging artifacts
moves — so [releases §0](04-repo-and-releases.md)'s argument that alpha should
not be *maintaining a distribution for software that has no users* survives
intact. AGPL §13 attaches on distribution and therefore does not attach here,
which is what keeps the About surface and the source link where P10 and P11
already plan them.

**Three things stand in front of the release flow, and none of them is release
engineering** — which is why this is a phase rather than an afternoon. The server
reads one environment variable in the whole codebase and has no `--host`, so an
image binds the container's own loopback and is unreachable however its port is
mapped. It serves no static files, so an image is an API and a 404. And the setup
token and the cookie hardening were both deferred on a premise — *the loopback
default* — that a container removes at a stroke, so [P2 §2.11](08-p2-implementation.md)'s
F10 comes forward here whole rather than in halves.

**Why after P6 specifically:** it is the first point at which there is something
worth freezing — a turn tree, a library, retrieval and branching — and it lands
before [P7](23-p7-implementation.md), the largest phase in the plan and the one
that most wants a known-good baseline to measure against.

**Demonstrable:** pull a tagged image, map a port, take the setup token out of
`docker logs`, create an admin, play a session — with the working tree in any
state at all, and the running build able to name the commit it came from.

*Built and merged (`3ab6a62`), and Alpha 1 cut 2026-09-06: the tag
`v1.0.0-alpha.1`, and the image the on-tag workflow built from it on its second
run — the first found that the base no longer ships corepack. The
demonstration above is still a person's: pull, token, admin, a session, from a
machine with Docker; [P6A §3](19-p6a-alpha-1.md) says what the suite and the
workflow have proved of it. Alpha 2 followed on 2026-09-07, alpha 3 on
2026-09-08, and **alpha 4 on 2026-09-09 — cut as [sitting K](05-manual-testing.md)'s
K0, because a finding recorded against a dirty tree is not attributable**. **The phase closed on its merge — the precedent the project made a
rule on 2026-09-09** — and steps 3 through 12 stand as
[sitting I](05-manual-testing.md), where the first install has already turned
three of them into halves.*

### P6B — The close-out, and the first real play

**Expanded into a working plan: [P6B](20-p6b-playable.md)**, with
[playable log](21-playable-log.md) as the findings log [P5 §0.4](17-p5-implementation.md)
noticed had never been created.

**This is PLAYABLE (§4.1), three phases late, plus the smallest set of repairs
that make its findings trustworthy.** Not new work: the checkpoint P1–P4 were
supposed to be tested by, and the close-out of the phase that built the
subsystem it tests.

**Why it did not happen on time, which is the finding that shaped the phase.**
Two audits five days apart — [P5 §0.5](17-p5-implementation.md) and
[P7 §0.1](23-p7-implementation.md) — name one obstacle: **nothing anywhere
chooses a session's lorebooks.** `POST /api/sessions` has accepted a treatment
and a book list since P5.6 and the client sends neither; `PUT
/api/sessions/:id/lore` has no caller outside tests; `pnpm seed` builds a
treatment with a book and then names neither. So a session resolves nothing, and
two of §4.1's four hypotheses — the budgeter under pressure, and whether
inclusion reasons explain anything — have had nothing to be about.

**P5's gate comes with it**, because it is the same subsystem: that gate has
never been walked, [P5 §0.5](17-p5-implementation.md) says walking it today
would fail, and walking it separately would find what playing should have.

**Why before P7 and not during:** [P7 §5](23-p7-implementation.md) says
whatever the record got wrong *"lands in the middle of this phase's channel and
effect work"* — the phase that publishes the contract as an SDK — and no
document describes a recovery from that. §7 calls skipping this checkpoint the
single most expensive economy available in this plan.

**Demonstrable:** reset, seed, start a session naming a treatment and a book,
take a turn, and read in the workbench which entries fired and why. Nobody has
ever been able to do that.

### P7 — Modes and channels

**Skeleton: [P7](23-p7-implementation.md)**, whose §0 states what a skeleton
several phases out is for and applies to [P8](25-p8-implementation.md) through
[P11](28-p11-implementation.md) as well. Its first finding: the move of the Scene
mode behind the SDK is a *move* or a *rewrite*, and `modes/contract.ts` already
knows which.

- The mode contract as a real interface; built-ins as separate packages
  consuming the published SDK ([19 §10](../19-tech-stack.md)).
- Channels, effects, engine-computed updates. **Not the authored-rule vocabulary
  or evaluator** — deferred to 6.0 (§0.4, §0.6), which is the single largest
  thing this phase lost and the reason it is merely large rather than
  impossible.
- Setup objects and the declarative setup wizard.
- Party as a timeline, always non-empty ([06 §8](../06-modes-and-turn-pipeline.md)).
- **Plot hooks and the selector — the mechanism.** The pool and its four sources,
  the mechanical filter, the judgement pass, firing through the guidance slot,
  and the three things [06 §6.1](../06-modes-and-turn-pipeline.md) specifies
  around them: the **pacing dial** as a channel, **Commit** with its bounded
  patience, and **`introduces`** — a character as a hook
  ([04 §6.1a](../04-schemas.md)).

  *This lands here and not earlier because of what it reads, not what it is.*
  The introduction hook's eligibility turns on *introduced*, which
  [06 §8.1](../06-modes-and-turn-pipeline.md) defines over presence and party
  effects — both P7, both two bullets below. The dial is a channel with an
  `init` policy, and channels are P7. Building any of it sooner means inventing
  a prefill path and an introduced-yet signal that this phase then replaces.

  *Two corrections this phase discharges*, both pre-existing and both cheap here:
  hook firing state moves out of the session file into a channel, because a flat
  set does not branch ([03 §4.1](../03-data-model.md)); and the selector writes
  its own line into the turn record, because a pacing-held turn is otherwise
  indistinguishable from a judged-none one.
- **Goals** — the chain, the progress channel, narrative completion, and the
  three offers at conclusion ([06 §7.3.3](../06-modes-and-turn-pipeline.md)).
- **Presence and status channels**, and the editable cast panel over them
  ([06 §8.1](../06-modes-and-turn-pipeline.md), [10 §13.2](../10-ui-surfaces.md)).
- **Mention resolution** as an `extract` step sharing the lorebook keyword pass,
  with spans on the turn record ([06 §8.2](../06-modes-and-turn-pipeline.md)).
  `explicit` and `matched` at 1.0; `proposed` can follow, but the span overlay
  and the never-auto-create rule must land now — both are structural.
- **Difficulty and directedness** as two settings, with levels supplied by the
  prompt pack rather than engine code ([06 §7.3.1](../06-modes-and-turn-pipeline.md)).
- **Scene** and **Freeform**, the two Play modes 1.0 ships (§0).

Still the largest phase and still the one where the contract either holds or is
revealed as wrong. If a built-in mode needs a back door, stop and fix the
contract ([06 §2](../06-modes-and-turn-pipeline.md)).

Two modes rather than four is a smaller phase but a weaker test, since the two
retained modes are the more similar pair. §0.3 records what that costs.

### P7B — Presets, prompt handling, and the surfaces the server already has

**Skeleton: [P7B](24-p7b-presets-and-prompts.md)**, written 2026-09-11 while P7
runs on its branch, and filed out of order for that reason — its status line
says why and what moves it. **Widened 2026-09-14** by a second sweep, and the
two halves turned out to be one phase: see §0.1 there.

**The prompt pack a session runs on cannot be opened, copied or edited anywhere
in the app**, and the sentence that makes Scene a narrator has been a code
constant since P2. Four phase documents sent the editor to P7; P7's stage list
does not carry it, and P11's *editors are not dumb forms, across every editor*
assumes editors that do not exist. This phase is §2.3's standing line paid for
presets, nine phases late: the built-in pack as a library object with *Copy to
my library*, a preset editor, a treatment editor — the other half of every
prompt — a session-settings panel that can switch a running session's pack and
its parameters, and edit-a-block-and-re-run through the pack rather than
through a field on the record.

**The second sweep found the same failure on five more surfaces**, and its
shape is the same sentence from the other side: a server capability that
shipped, and a client file no phase since had a reason to open. So the phase
also takes **the setup and package editors**, which complete the six library
kinds; **session delete and archive**, whose routes shipped at P2.3 and whose
archive half is one field on a `PATCH` the client already sends; **the
workbench pointed at a turn the head has passed**, which
[10 §3](../10-ui-surfaces.md) has always specified and whose reader exists with
one caller; **the import quarantine's listing**, which is the only way to see
what an import rejected; and **home as a prototype** — `/` stops being a
redirect and shows the changelog, with the full [10 §2.2](../10-ui-surfaces.md)
home deliberately held (below).

**Why after P7 and not inside it:** [P7 §5](23-p7-implementation.md) says a
plan that cuts under pressure cuts a panel and never the boundary, and three
editors are three panels. Why not P11: a hardening phase applies a contract
across editors; it should not be discovering that half of them are missing.

**What this phase deliberately does not take.** The full home stays a 1.0
feature expected immediately before the cut-over to feature-complete beta, and
may move further out ([polish §5](06-polish.md) carries the wording). **Search**
stays [P11](28-p11-implementation.md)'s, beside the reading view, because the
two are read-surfaces over the same data and share a print story. Both are
choices rather than omissions and both are recorded where they were made.

**Demonstrable:** copy the Scene pack from the library, change the narrator
sentence, start a session on the copy, and read the changed sentence in the
workbench — then switch packs mid-session and watch compare show the
difference. No text editor anywhere in the walk.

**And one check the phase owes that is not a stage:** *nothing in the suite
asserts that a shipped route has a caller.* Five of this phase's items are
routes whose only callers are their own tests, green in CI the whole time
([manual testing §9](05-manual-testing.md)).

### P8 — Memory

~~**Skeleton: [P8](25-p8-implementation.md)**~~ ~~**Planned:
[P8](25-p8-implementation.md)**~~ ~~***Ready to start:
[P8](25-p8-implementation.md)***~~ ~~***Built on §5's fallback cut***~~
***Merged into `main` 2026-09-16 at `4a6e377`, and open*** — six stages, each
with a *Done* block naming its commit, and **§3.2** as the gate's results table.
*`main` as it stood immediately before the merge is the `pre-p8` branch.*

***The cut was taken deliberately rather than under pressure***, which is why §5
named one: the chain, the pipeline, the books, **manual capture** and the
toggles, with the **automatic extractor deferred**. §5's argument is that the
extractor is *"the one component whose value nobody can currently evidence and
whose failure mode §1.5 calls unforgivable"* — and what shipped in its place is
the affordance [08 §2.1](../08-cross-session-memory.md) calls nearly free and
authored by *the only judge who cannot be wrong about what mattered*.

**The cut removes two of the three criticals' subjects, and the phase says so
first.** C2 and C3 are both about the extractor; both travel with it. So P8
closes on **C1 alone**, C1 is unwalked, and the phase merges and stays open —
[P7](23-p7-implementation.md)'s precedent and [P7B](24-p7b-presets-and-prompts.md)'s.
Its critical list is **sitting N** in [manual testing](05-manual-testing.md).

Revisited 2026-09-13 once P5, P6 and P7 had all landed — which is what its §0
said it was waiting for — and **re-audited 2026-09-15 after P7B**, which is what
its §0.3 is. It found the phase's one storage decision hiding outside both design
documents: `memories/` sat beside `library/` and outside everything the index
walks, while [08 §7](../08-cross-session-memory.md) asks for the ordinary
lorebook editor, which needs a library address. ***Settled and deleted***: a
memory book is an ordinary library lorebook marked `provenance.source =
'session'`, and `memoriesRoot()` is gone with a repo-shape assertion behind it.

**The re-audit changed nothing about the plan and two things about its
surroundings.** All ten of the first audit's findings still hold, so the stages
are sized against the code they will meet. What moved is that the surfaces two of
them wanted now exist: [P7B](24-p7b-presets-and-prompts.md) built the preset
editor, so the summary slot arrives editable with no client edit, and it built
the session panel [08 §7](../08-cross-session-memory.md)'s two switches belong
on. *The audit also found the preset editor rendering no slot as a slot, which is
what a readiness audit is for.*

Cross-session memory as an auto-maintained lorebook ([08](../08-cross-session-memory.md))
is designed and buildable.

**Within-session summarisation is a rolling summary** ([25 E1](../25-open-questions.md)),
which is schedulable here rather than needing its own design pass. The one
constraint that must be honoured on the first commit: it is an **immutable
chain**, `summary(n) = f(summary(n-1), turns[a..b])`, each link keyed by the hash
of its inputs ([07 §5.1](../07-branching.md)). The mutate-one-record version is the
obvious implementation, is indistinguishable from the UI, and quietly breaks
cheap branching — so it is a review item, not a detail.

Summaries are derived and disposable, so a bad summariser is a regeneration
rather than lost history. That is what makes shipping a simple version in P8
safe. Chapterisation is roadmap ([24 §3](../24-roadmap.md)), not P8.

***The revisit found three things that move the phase***, none of them where the
plan above was looking. The spoiler defence
[08 §6](../08-cross-session-memory.md) demands is **not buildable through `reads`
as the step contract stands**, because a step is handed whole `Turn`s and a
`Turn` carries every block's text — so *refuse at the source* is a contract
change rather than a prompt discipline. **Nothing on the lore path can be marked
advisory**, so the *memories never write state* rule has a firewall and no route
into it. And memory extraction is the **first producer of an escaped effect** —
P6 shipped a count for it and named this phase as the writer.

**And the chain above is the flat form.** What P6 hands forward is two-level,
with the summariser's identity in the key: [13](../13-write-mode.md)'s node
summaries ride the same machinery, and the property test this phase owes CI is
satisfiable by a bug without it.

### P9 — Renditions

~~**Skeleton: [P9](26-p9-implementation.md)**~~ ~~*A plan, audited
2026-09-15*~~ ~~*A plan built out against the tree*~~ ~~***Built, 2026-09-16, on
branch `p9`***~~ ***Merged into `main` 2026-09-16 at `f51ad46`, and open***:
[P9](26-p9-implementation.md),
re-audited 2026-09-16 at `bf88153` — and its first stage is a contract rather
than a feature: `Rendition` is specified in
[06 §10.1](../06-modes-and-turn-pipeline.md) and appears in no schema document at
all. The provider layer speaks chat and no image endpoint does, which is the
phase's one real question **and the one its audit deliberately did not answer**:
it wants a real endpoint in hand rather than another paragraph, which is what
[manual testing](05-manual-testing.md)'s R10 is for.

**It does not wait on [P8](25-p8-implementation.md), and only the numbering
suggests it does.** P9's dependencies are P6, P7 and P10; the single place it and
P8 could touch is the step payload, and the narrow shape P9 wants shipped with
P7's contract. *Worth knowing because [§0.4](#04-further-cuts-not-driven-by-the-mode-scope)'s question —
whether renditions are worth 1.0 at all — is easier to weigh when the ordering is
known to be free.* The audit also found the phase smaller than it read in one
place and larger in another: the ranked-fragment capper P9.1 assumed it would
build is already written and tested with no caller, and P9.2's jobs are a second
job shape rather than the reuse the document claimed.

***P8 has since been built and merged, which turns the ordering claim into a
record*** ([P9 §0.3](26-p9-implementation.md)). All ten findings of the first
audit still hold at the paths they were checked at, so every stage is still sized
against the code it will meet. **What P8 left behind is four things P9 no longer
has to invent** — a length-prefixed content digest, a derive-only-the-misses
chain with a call counter on it, a `resolveStepRole` that answers *which model*
before the call, and a fourth worked example of the engine applying an effect a
step may not propose. *And one rule that bites:* P8 deleted a session-scoped path
helper with no caller and put an assertion behind the deletion, and P9.0's exit
condition as drafted added another — corrected in place, in the proof rather than
the stage.

**The phase is ready to build and is not ready to close**, which is the honest
pair. P9.0 is blocked by nothing; both of the gate's criticals are blocked on
R10, an **image** endpoint that no other outstanding sitting produces: the four
that hold a phase open — K for P6B, L for P7, M for P7B, N for P8 — all want a
**chat** one. A P9 opened before that errand starts can be built in full and
cannot be closed.

***That is exactly what happened*** (2026-09-16). All six stages landed —
`fae4de7`, `bf27efa`, `18b5b8f`, `5819843`, `49f43c2`, `041882e`, merged into
`main` the same day at `f51ad46` — and
[§3.2](26-p9-implementation.md) records **thirteen of the gate's fifteen rows
discharged by test**. The two criticals were **never walked**, which is the form
this project keeps rather than a shortfall to tidy: they are carried as
**sitting O** with R10 named as their blocker, and the phase stays open behind
them. **A block is an errand, not a judgement**, and this errand is one endpoint.

*What is proven and what is not, plainly*: every claim about **mechanism** — a
turn that does not wait, a recipe that survives its pixels, a digest that matches
a place, an empty diff on rewind, a text call that is not made on re-creation —
is asserted. Every claim about **what it looks like** is not. §0.4's question,
*are renditions worth 1.0 at all*, is therefore no easier to answer than it was;
what has changed is that the code exists to answer it with.

***And the fleshing out closed two of its own forks and pinned its split seam***
(2026-09-16). **All twelve stages now name what they depend on, what they end at
and the check that says they are done** — §1.1's rule turned on the document's own
list, which its §5 asks for. Two forks fell out of it: the **assistant's mode
definition** is P11's because [P7](23-p7-implementation.md) shipped without
answering its §1.8, which is precisely the *both documents leaving it to the
other* that P11 §1.5 said must not happen; and **P11.4's impersonation** is the
whole feature rather than a remainder, because P7's own dependency list records
that *"P7's revisit did not know it was asked."*

***And the split is not where §5 guessed.*** With every stage carrying a
dependency, **nine of twelve depend on nothing** — so the seam is not product
completion against release engineering, it is *everything else* against **P11.8
and P11.9**, the only two that depend on the phase. **That cut cannot be a release
boundary**, because [releases §0](04-repo-and-releases.md) requires P11.9 for beta
to count: the honest form is two phases and one release, which is worth knowing
before somebody proposes a split as a way to ship sooner.

***Three decisions the phase closed on its way through***, all recorded in the
plan rather than in commit messages: `Rendition` is **internal tier** and
graduates when the turn record does, at the export freeze (§1.1, which is the
answer P9 owed P11); `Provider` grows a second **verb** rather than a second
**kind**, with the reversal condition written beside it — an endpoint whose
request is not prompt-plus-scalars (§1.2, taken under that section's own warning);
and an on-demand picture of an old turn assembles from that turn's **recorded**
state, disclosed through the workbench rather than through a setting (§1.3, which
strikes [06 §10.6](../06-modes-and-turn-pipeline.md)'s `[OPEN]`).

Per-turn and on-demand illustration ([06 §10](../06-modes-and-turn-pipeline.md)),
built against the general rendition shape so video and speech are later kinds.

**And backdrops**, which are the same shape under a second *purpose* rather than
a second feature ([06 §10.1a](../06-modes-and-turn-pipeline.md),
[P9 §1.7](26-p9-implementation.md)). This closes an absence older than the phase
documents: [06 §7.2](../06-modes-and-turn-pipeline.md) has always said Scene has
an optional background written by a step, and no document has ever said where the
image comes from — so without this, P7 ships a backdrop channel that nothing can
fill. Backdrops generate when the place changes rather than per turn and reuse
an existing image for a place already rendered, which is what keeps the one
subsystem that spends money on its own from spending it per turn.

### P10 — Multi-user, notifications, deployment

~~**Skeleton: [P10](27-p10-implementation.md)**~~ ~~***re-audited 2026-09-16 at
`fee56da`***~~ ~~***Built on branch `p10`, 2026-09-16 to 2026-09-17, and open***~~
***Merged into `main` 2026-09-17 at `b572c4c`, and open***,
on the spine that document gives a remainder phase because it does not have one
by default: *this is the phase that makes the install reachable, and safe, for
someone who is not the developer.* Anything here off that line gets checked
against P11 before it is built.

***All six stages landed and the phase does not close on them*** —
[P10 §3.2](27-p10-implementation.md) records seven gate rows discharged and
[§3.1](27-p10-implementation.md) four criticals, **three of which are errands**:
a supervised install, a second machine, and a non-author for an hour
([sitting P](05-manual-testing.md)). *This is the most blocked rows any critical
list has carried, and unlike P9's they are not one errand* — so the sitting does
not become walkable when any single one arrives.

***What a built P10 proves is who is told what***, which is the half that would
be worst to get wrong on a household server: a turn notifying its own account and
nothing addressed to anybody else, five arrivals folding into one notification
that knows it is five, an unauthenticated account listing held to three fields by
a test, a hidden account absent from the sign-in grid and still able to sign in by
handle. **What is unproven is reaching it.**

***Three things were not the shape the plan predicted, and each is worth a
line.*** **The update check moved into this phase** — [P10 §1.7] called the lean
and the two config keys it needed had already shipped `unread`, which that section
names as *shipping dark by default*. **The extensions fork closed as a deferral**
rather than as a build, on a distinction four audits had missed: *1.0 needs
extensions **loaded**, not **installed***, and the first-party reference extension
ships inside the image the way a built-in mode does — so acquiring one from
outside is [24 §3.2](../24-roadmap.md)'s. And **the §13 source link needed the
build to carry its URL**: a constant is right for this repository and wrong for
every fork, and the patched-build case is the one §13 exists for.

***The re-audit was that document's own instruction, and it moved a producer
between phases.*** [P10 §5](27-p10-implementation.md) names *re-reading P7's, P8's
and P9's gates for things a person should be told about, before writing the
router rather than after* as the revisit's cheapest move; all three have now
shipped, so §0.1 ran it. **[09 §3.5](../09-server-multiuser-deployment.md)'s five
notification classes are three with producers**: `turn.awaiting-input` still has
no suspending step, and **`artifact.ready` was P9's to build and P9 did not build
it** — [P9.2](26-p9-implementation.md) chose a whole-record stream frame over a
`ProgressEvent` for a structural reason that is correct, and the class was simply
never written. So the producer joins the router at P10.1, which is a morning
rather than a stage, and the retrofit risk [P9 §1.5](26-p9-implementation.md)
named lands one phase later than that section says.

*Three smaller things it settled:* P10.3's preference rows are three not five and
its *your connections* half landed at P7.3; P10.5 is one link into a slot
[P6A](19-p6a-alpha-1.md) already cut; and **three of the four config keys marked
`'unread'`** — the tier that means nothing consumes them — are this phase's, which
makes §3's *"the line's last large debtor"* a number instead of a
characterisation.

**Accounts, login and first-run moved to P1** ([P1 §1.3](07-p1-implementation.md))
— they were always small, and the alternative was a stub identity threaded
through every route until this phase. The per-user *storage layout* was already
in P1 because that part is not retrofittable; auth turned out to be cheaper to
build than to fake.

**And account management and capability enforcement moved to
[P2A](09-p2a-configuration-surface.md)**, for the reason §2.3 gives: five
already-shipped things described that surface as existing. What lands here is
the remainder of [10 §15](../10-ui-surfaces.md) — the extensions panel, the
system library panel if it ever earns an admin action, *Restart now* with the
supervisor detection and drain it needs, and connectivity state once P11's
update check produces the signal. Plus the notification router and delivery
channels, ~~the loopback bind and its container inversion, the setup token,~~
mDNS, the account-gallery arrival screen ([12](../12-account-gallery.md)), the
About surface and §13 source link. *The struck pair went to
[P6A](19-p6a-alpha-1.md), which shipped the image their deferral was scheduled
against; [P10.0](27-p10-implementation.md) is what is left.*

### P11 — Beta hardening

~~***Built on branch `p10`, 2026-09-17***~~ ***Merged into `main` 2026-09-17 at
`b572c4c`: thirteen stages, and the critical list is unwalked.***

**The branch is `p10` for both phases**, which is why one merge carries two — it
was opened for P10 and P11 together, and P11's own status line above says so
rather than implying a `p11` that never existed. [P11 §3.2](28-p11-implementation.md) is the record and
[sitting R](05-manual-testing.md) is the list. **Five criticals, two of them desk
work**, and the phase does not close until they have results — which is
[manual testing §0](05-manual-testing.md)'s rule and, here, the rule that decides
when *beta* may be said.

***What it does not have is named rather than absorbed***, which is the part of
this row worth reading twice. ~~Four~~ ~~**Three**~~ ~~**Two**~~ ~~**One**~~
**None**. All four — ~~[10 §11.2c](../10-ui-surfaces.md)'s entry travel~~,
~~[10 §11.2b](../10-ui-surfaces.md)'s image slots~~, ~~the assistant's docs
lorebook~~ and ~~the Playwright suite~~ — were built on 2026-09-17, hours after
being written down as missing. **Writing them down is what closed them**, which
is the one general claim this row makes about the form of a phase record. ~~and the **Playwright journeys the gate's own row 8 assumed and no
stage was asked to build**~~. ~~Three are features with an argument beside them;
the fourth is infrastructure.~~ **All three are features with an argument beside
them**, and they are in [manual testing §10](05-manual-testing.md) with no owner,
because *giving a false owner would stop anybody looking* — and the person walking
R4 meets them as known absences rather than as discoveries.

***The fourth was the Playwright suite, and it was built on 2026-09-17***, the
day the record named it. **It is worth a sentence because of how it went**: three
of the four were features, each with a reason it could wait; the fourth was
infrastructure the gate had simply assumed, which is not a thing a reader can
weigh — so rather than ask R4's reader to adjudicate it, the suite was written.
**Walking the seven journeys found three of them had been read wrong**, the
sharpest being that *branch* is **Redo** and not a second send — and a second send
posts the same one turn, so a suite written to the wrong reading would have been
green while protecting the wrong claim. [testing §3.5](03-testing.md) records all
three.

~~**Skeleton: [P11](28-p11-implementation.md)**~~ ~~***A register,
re-audited 2026-09-16 at `2f3f5d9`***~~ ***A register with a costed stage list,
fleshed out 2026-09-16 at `7c5e0bd`***: [P11](28-p11-implementation.md), whose
exit gate *is* the beta gate — the one structural difference from every other phase
document. Its first stage
is the audit that produces the list, ~~because the list exists today only as *home
P11* scattered across the phase documents~~ **and a partial list now exists**:
§0.1 registered nineteen unowned 1.0 commitments on 2026-09-14, and §0.2 re-ran it
on 2026-09-16 against [P7B](24-p7b-presets-and-prompts.md),
[P8](25-p8-implementation.md) and [P9](26-p9-implementation.md) once all three had
merged. And §8 below is what it rewrites.

***What the re-run found is one new row and it is the expensive kind.*** Six of
the nineteen are built — the four editors, session delete and archive, the
workbench on a past turn, the import quarantine's listing and home's prototype —
and the check is mechanical, because `route-callers.test.ts`'s OWED map went from
seven entries to four and the four are the register's own rows. **The twentieth
is [P8](25-p8-implementation.md)'s deferred automatic extractor**, cut
deliberately on that phase's named fallback and landing in a corpus where neither
later phase mentions it. It is row 14's shape — a careful deferral with no
destination — and it is worse in one respect: **two of P8's three gate criticals
travel with it**, so *feature complete to the 1.0 spec* is not a claim the beta
gate can make until some phase takes it or somebody records that 1.0 ships manual
capture on purpose.

Everything left that the 1.0 spec commits to and the phases above did not
absorb: the assistant, editors-are-not-dumb-forms across every editor, the
reading view ([10 §12](../10-ui-surfaces.md)), impersonation in Scene
([06 §3.1](../06-modes-and-turn-pipeline.md)), the plot-hook selector, the in-app
update check, and the localisation catalogue extraction sweep (§0.4).

**Plus the three things §0.5 moved into 1.0**: session export
([25 B12](../25-open-questions.md)), backup and restore with its CI restore test
([25 E6](../25-open-questions.md), [testing](03-testing.md)), and the four packaging
artifacts that previously had a requirement and no builder. This is a real
increase in the last phase's load, and [P11](28-p11-implementation.md) is where
it gets sized rather than here.

**The plot-hook selector here is the *tuning*, not the build** — a correction,
because this line and P7's have both read as owning it and two homes for one job
is a scheduling argument waiting to be had. P7 ships the mechanism. What is left
for hardening is the part that can only be done by playing: what the four pacing
levels resolve to, how long a commitment should wait, how the judgement prompt is
worded, and the hook panel ([10 §10.1](../10-ui-surfaces.md)) that makes a large
pool authorable. §2 already lists *that hook pacing works at all* among the
hypotheses nothing has tested, and this is the phase that tests it.

**Packaging here is all six artifacts** (§0.5). The container and the tarball
are what the *beta gate* requires ([releases §0](04-repo-and-releases.md)); the other
four ([09 §5.4](../09-server-multiuser-deployment.md)) are a 1.0 requirement, and
this is the phase that owns them — which is the correction, because previously
nothing did.

**No longer here:** the file
browser ([25 D3](../25-open-questions.md)) and Tailscale ([25 D1](../25-open-questions.md)),
both moved to the roadmap.

---

## 5. After 1.0: the committed series

Five of them (§0), and none has a phase breakdown yet — that is post-1.0
implementation planning, and writing it now would be guessing at a substrate
that does not exist.

- **2.0 — Write.** A surface of its own, holding Outline and Prose
  ([13](../13-write-mode.md)). The one that must be *designed* early even though
  it is built late, because §0.5's session export cannot freeze the turn record
  until [13 §4](../13-write-mode.md) is settled.
- **3.0 — the Character Studio.** Reference-set curation, descriptor authoring
  and the consistency loop that makes a card produce the same person twice
  ([17](../17-character-studio.md)). The one whose *format* is entirely 1.0's
  work, which is why it can go this early — and the one that has to settle a
  navigation argument before its scope is even checkable
  ([17 §6](../17-character-studio.md), [10 §2](../10-ui-surfaces.md)).
- **4.0 — World.** The continuity container ([15](../15-world.md)), with the
  story bible that gives a continuity a way to say what it contains. Its three
  cheap obligations on 1.0 are real requirements now rather than insurance, and
  they land at P7 and P8.
- **5.0 — Campaign.** The mode, the RPG channel library, incremental world
  generation and the character-sheet machinery. Not the rule tier: §0.4 explains
  why Campaign does not need it, and why the two travelling together was the
  wrong reading of a real relationship.
- **6.0 — the authoring tier.** Authored rules and the surfaces that turn played
  material into authored material (§0.6). The release whose scope is most likely
  to move, because it is the one furthest from anything anybody has used yet.

All five are **committed**, not speculative, which distinguishes them from the
feature list ([24](../24-roadmap.md)). Items there are unscheduled; these are
scheduled.

Each series is also when its §0.2 check gets answered — whether the release
needed a portable schema change it promised not to need. Those answers are worth
recording either way, and three matter more than the rest: **3.0's, because it is
the strictest form of the check and the first to run**; **5.0's, because it is
the strict form applied to a whole mode**; and **6.0's, because a failed check
there means §0.4 deleted two fields rather than deferring them.**

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
  ([03 §5.1.1](../03-data-model.md)): the server indexes its own writes
  synchronously, so the API is read-after-write consistent and only *foreign*
  edits go through the watcher. What remains is self-write suppression getting
  its `(path, mtime, size)` token wrong, which shows up as double-indexing rather
  than as missing data.
- ~~A1, the extension execution model~~ — **closed** ([22](../22-extensions.md)).
  The remaining risk is not structural but velocity: a boundary means anything
  the API does not expose is blocked until it grows. Watch the signals in
  [22 §9](../22-extensions.md).
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
## 8. What "beta" means — rewritten 2026-09-17, at [P11.9](28-p11-implementation.md)

~~to be expanded~~ **This section was a sketch held open for the phase that would
build it**, and [P11](28-p11-implementation.md) §1.1 named the rewrite as
P11.9's. What follows is that rewrite: the seven bullets are gone, replaced by
what they turned out to mean once three of them had been built.

[releases §0](04-repo-and-releases.md) defines beta as **feature complete to the
1.0 spec**, which is a good completeness gate and half a definition of readiness.
The other half is release engineering, and it belongs *in* the beta bar rather
than after it — a phase that does not know what it is hardening toward ends when
someone gets tired.

### What the rehearsal taught

**Three of the seven were taken early, at [P6A](19-p6a-alpha-1.md)**, on one
artifact: the release cut automated end to end, version and commit embedded in
the build, and an on-tag CI tier. That was not a schedule change.
[releases §0.1](04-repo-and-releases.md) draws the line it was for — *a release
artifact* is published, channelled and supported, while *a build the project
produces for itself* is tagged, reproducible and handed to nobody — and
front-loading release engineering is defensible on exactly the second one.

**The rehearsal was worth more than the plan it shortened, and specifically
because it failed.** The first `v*` tag, on 2026-09-06, died at `corepack` with
exit 127: Node 25 stopped shipping it, `node:26-slim` has no such command, and
nothing had run the Dockerfile before a daemon did. Two more of the same class
were found by reading the workflow against `compose.yaml` — an image tagged with
the `v` that the trigger needed, so the tag [deploy](../../deploy.md) told people
to pull did not exist; and a comment saying *lowercased* beside an expression
that did not, which the registry would have refused.

***All three were string mistakes in a file that runs once, on a tag, and
nowhere else.*** That is what the rehearsal taught, and it is what
`tools/release.test.ts` exists for: this build chain's characteristic failure is
not *the compiler broke*, it is **two files disagreeing about a version, a name
or a path**, and every one of those is visible to a test that reads them together
on an ordinary run. So the rule this section now carries is: ***a release step
that cannot be exercised on an ordinary run should be asserted about on one.***

### What beta requires

**Two artifacts, not six.** [releases §0](04-repo-and-releases.md) settles it —
*"the canonical build must deliver the OCI image and the tarball
([09 §5.4](../09-server-multiuser-deployment.md)) for beta to count"* — and the
other four packaging artifacts are a **1.0** requirement: enough to have users is
the beta test, and four more build chains is work that reads as progress while
delaying the thing being packaged. They are P11's rather than a bar's, because a
bar nobody owns is a wish.

| | What | Where it stands, 2026-09-17 |
|---|---|---|
| 1 | **CI that builds, tests and produces artifacts on every merge** | `ci.yml` builds and tests on every push; the on-tag tier produces the artifacts. *Merge-time artifacts are deliberately not built* — a private alpha has nobody to hand them to, and an artifact nobody fetches is a cache with a retention policy. |
| 2 | **Reproducible builds of the container and the tarball, from a tag** | The tarball is reproducible **and checked**: packed twice in the workflow and compared, with `tools/pack-tarball.test.ts` making the same claim over a fixture. The container's half is [P11 §3](28-p11-implementation.md)'s row 9 — it wants a daemon and two runs. |
| 3 | **The release cut automated: tag → build → publish → changelog** | Done for the image at [P6A](19-p6a-alpha-1.md) and for the tarball at [P11.9](28-p11-implementation.md). ~~one artifact's chain, built once for real; five to go~~ **Two, and one tag cuts both.** |
| 4 | **Channels wired and *boring*** | `testing` moves with every `v*` tag and the unraid template follows it; `latest` moves nowhere, deliberately, because unraid's auto-update and watchtower both track that alias and an alpha is not something to hand an auto-updater. **`nightly` does not exist and should not until somebody is reading it** — [releases §4](04-repo-and-releases.md): a nightly that is often broken is worse than none. |
| 5 | **Version and commit embedded in the build** | Taken at [P6A](19-p6a-alpha-1.md). The AGPL §13 *surface* that uses it arrived at [P10.5](27-p10-implementation.md), because §13 attaches on distribution and P6A distributes nothing. |
| 6 | **Upgrade tested, not assumed** | The tarball's upgrade path *is* re-running the install script, which is why that script is written to be idempotent and leaves the data directory alone. **Walking it is a person's** — a previous release, with data, upgraded — and it is a gate row rather than a check. |
| 7 | **Backup and restore actually exercised** | Built and tested at [P11.11](28-p11-implementation.md): `tools/backup.mjs`, and a restore test whose load-bearing assertion is that the index is **rebuilt rather than carried**. The live half — restore into a running install and watch a search answer — is [testing](03-testing.md)'s. |

### What is left is two rows and a person

Rows 2 (the container half) and 6 are the whole of the remainder, and neither is
code. **Both want a machine with a container daemon and a previous release
installed on it**, which is the same sitting twice, and
[P11 §3](28-p11-implementation.md) carries them — row 9 for the first, and the
critical list its close builds for the second.

*That is a much smaller residue than this section's first draft implied*, and the
reason is worth keeping rather than quietly enjoying: the sketch listed seven
bullets as though each were a project. Three were an afternoon each once the
first artifact existed, one was a decision **not** to build something, and one
turned out to be a test file.

**~~The plan above front-loads none of this~~** — it front-loads five of seven
now, and the original argument is unchanged for what is left: front-loading
release engineering during alpha is defensible where the artifact is for the
project rather than for an audience. What would be a mistake is carrying the
*deferral* into beta, and this table is what retires it.
