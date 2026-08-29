# 06 — Open questions

Collected from the inline **[OPEN]** markers, plus questions that don't belong to
one document. Ordered by how expensive they are to answer late.

---

## A. Decide before writing code

**A0. The licence. — RESOLVED 2026-08-09: AGPL-3.0.** Matches all three sources;
`LICENSE` is in the repository root. Lifting code from the sources is permitted
with notices preserved, §13 obliges us to offer source to LAN users
([04 §7](04-server-multiuser-deployment.md)), dependencies must be
AGPL-compatible, and user content is unaffected. See [triage §1](workplan/02-triage.md).
Spawns A1b, below.

**A1. Extension execution model. — RESOLVED: worker-thread boundary from 1.0.**
Specified in [12](12-extensions.md). The decision turns on separating two things
that get bundled under "sandbox": **fault isolation** (a crash, hang or runaway
loop not taking the server down) is cheap and shapes the API, so take it now;
**authority isolation** (an extension unable to reach the filesystem at all) is
expensive and additive, so defer it — extensions are AGPL and admin-installed,
which is a materially weaker threat model than untrusted code.

The reason this costs less than instinct suggests: **the extension surface
already serialises.** Five of the seven things [03 §9] requires are declarative
and cross no boundary at all; the remaining two are a function over JSON-shaped
data and async host calls. Built-in modes run through the same boundary, so the
contract cannot drift. *[03 §9, 12]*

**A1b. May extensions be non-AGPL? — RESOLVED 2026-08-09: no. Extensions and
modes are AGPL-3.0, with no linking exception.** The friction of requiring
copyleft from extension authors is smaller and more recoverable than the damage
of a copyleft project being seen to close things down. Consequences: no
exception means no decide-before-first-PR deadline; the SDK package must itself
be AGPL for this to hold; extension manifests should carry a declared licence
field for legibility. Content — including packages and their authored rules —
is explicitly *not* covered and stays the author's own. See
[triage §1.1–1.2](workplan/02-triage.md).

**A1c. Extension-owned durable storage. — RESOLVED: a namespaced key/value host
API, not a directory.** Specified in [12 §5](12-extensions.md). The worker
boundary from A1 makes this cleaner than the directory the question assumed:
storage is a host call namespaced per (user, extension), so cross-user and
cross-extension reach are impossible by construction rather than by check. Backed
by files under the user's directory so it inherits the watcher, index and backup
story; quota declared in the manifest; removed on uninstall with an explicit
keep-the-data prompt. Values are JSON — bulk bytes go through a separate asset
call returning a handle. *[03 §9, 14 §4.6, 12 §5]*

**A2. Can a package ship code? — SHARPENED by [08 §2.1](08-infinite-worlds.md):
packages may ship *rules*, never *code*.** Declarative rules are terms in a
closed vocabulary our evaluator interprets, so importing one grants no capability
the importer lacks — which is what makes shared content far more expressive
without touching A1's execution question. Still open: bundling an actual mode or
extension implementation remains a no for 1.0, and the rule vocabulary needs
versioning so a package authored against v2 fails legibly on a v1 host.
*[02 §7, 08 §2]*

**A2b. Randomness. — RESOLVED 2026-08-09: one canonical server-local RNG
service, no network dependency, every draw recorded in the turn's effects.**
Nothing else draws — not steps, modes, the rules evaluator, or extensions.
`node:crypto` under the hood with an injectable generator for tests; the API
must be complete enough (dice notation, weighted pick, chance) that nobody is
tempted to bypass it. Specified in [07 §14](07-tech-stack.md).

**Follow-on also resolved: rewrite and reroll are separate operations, and
rewrite is the default.** An ordinary swipe replays the recorded draw tape —
same mechanical outcome, different prose — and drawing fresh is a deliberate
second action, so swiping past a failed check cannot be save-scumming by
accident. Draws are keyed by site rather than position so replay survives a
divergent execution path. Still open, and minor: whether a session may flip the
default. See [07 §14.5–14.6](07-tech-stack.md).

**A2c. Notification event schema. — RESOLVED, by separating two taxonomies that
were being treated as one.** Specified in
[04 §3.2–3.5](04-server-multiuser-deployment.md).

The question stalled because "how granular should status be?" and "what are the
notification classes?" felt like one question. They are not: **progress events**
are dozens per turn, ephemeral, structural, sent to session subscribers, and
rendered by the client; **notifications** are a handful, routed to a person,
need `{key, params}` and dedupe, and sometimes leave the app. Both ride the same
SSE stream; only the second goes through the router.

**So a far more granular status view than Marinara or Aventuras costs nothing in
notification classes.** The live view people want — where in the chain we are,
what exactly failed — is the turn record rendered while it is still being
written, which means one component serves live and historical alike.

Classes, closed: `turn.complete`, `turn.failed`, `turn.awaiting-input`,
`artifact.ready`, `system.notice` at 1.0; `message.received` at 2.0. Named
`artifact.ready` rather than `rendition-ready` because the class is about async
work attached to a turn finishing, and naming it for its first producer means
renaming it for the second. Deliberately **not** split into blocking and
non-blocking: renditions never block by design and the blocking case is already
`awaiting-input`, so the split would model a state the architecture forbids.
`agent-note` dropped — that is a progress event. `actionable: boolean` carries
the distinction that actually matters for routing, as a field rather than a
doubling of the list. *[04 §3.2–3.5]*

**A2d. UI localisation.** Settled in [07 §12](07-tech-stack.md): i18next with
explicit hierarchical keys, ICU plurals, silent per-key English fallback,
machine translation as the primary path with provenance markers, Weblate for
contributors. Two items are load-bearing before code: **CSS logical properties
from the first stylesheet** (otherwise RTL is permanently foreclosed), and
**server events carrying `{key, params}` rather than English prose**. Both are
free now. Docs translation is explicitly out of scope — Marinara's `docs-i18n`
branch shows the real ongoing cost. *[07 §releases, 04 §3.2]*

**A2e. Sharing content between users on one install — deferred, deliberately.**
[04 §4.3](04-server-multiuser-deployment.md) reverses an earlier draft: every
user gets a complete independent library, with no `owner` or `visibility`
fields, because merging separate stores later is mechanical while splitting a
shared one is adjudication. Four decisions keep the door open — globally unique
ids, provenance recording origin, sharing arriving as a new *location* rather
than a new field, and no ownership fields until then. A **full system library**
ships alongside — same layout, read-only, loaded for everyone — which doubles as
a working rehearsal of the merge a shared library would need. Note the corollary:
that library is one admin write permission away from *being* the household
share, which is not offered at 1.0 but is likely the shape sharing takes. Open:
when it arrives, and whether it needs a real permission model or just
copy-from. *[04 §4.3, 02 §5.1]*

**A3. Server-scoped connections. — RESOLVED: account-scoped, with a system
scope, exactly like the library.** Specified in
[04 §4.5](04-server-multiuser-deployment.md). Connections belong to an account
except for system connections, and the admin capability is adding and removing
those — the same authority that manages the system library, not a new permission
model. Effective list is the user's plus the system's, resolved as one merge.

**The symmetry breaks in one place and that is the important part:** library
objects are readable and forkable, connections are **usable but opaque**. The key
never leaves the server, `system/connections/` is excluded from file access
entirely (unlike `system/library/`), and there is no copy-to-mine because copying
would mean copying the credential.

They are consumed through **role bindings** ([07 §5.1](07-tech-stack.md)) rather
than picked per turn, which is what makes the household case work — an admin
binds `prose` and `fast` to system connections and personal bindings override.
Two consequences worth carrying: cost attribution stops being optional once
everyone spends one key, and rate limits become shared. Still true that
library-time assists are a second call path, so role resolution must work outside
a session ([05 §11.4](05-ui-surfaces.md)).

**Extended: whether a user may hold private connections at all is a named
account capability**, default true, enforced at resolution rather than creation
so the file browser is not a bypass. Revoking disables rather than deletes.
Beyond that, a general role system is post-2.0 ([04 §4.2.1](04-server-multiuser-deployment.md),
[14 §3](14-roadmap.md)). *[04 §4.5, 04 §4.2, 07 §5.1]*

**A4. Raw-completion support. — RESOLVED: legacy, dropped, no adapter.**
Specified in [07 §5.5](07-tech-stack.md). Not "chat-shaped by default with a
completion path behind it" — the supported surface is **OpenAI-compatible chat
and nothing below it**, stated as a position rather than left to be discovered.

It costs less than it would have three years ago: llama.cpp, Ollama, vLLM, LM
Studio, KoboldCpp and text-generation-webui all expose OpenAI-compatible chat, so
the excluded set is small — completion-only services, and anyone deliberately
driving a raw endpoint — and a translating proxy is an off-the-shelf answer that
is not ours to maintain. What is genuinely lost is byte-exact control of the
final prompt string, which is the part power users will feel.

Cheap to unmake: [03 §5](03-modes-and-turn-pipeline.md) already isolates
rendering as a single step, so a completion renderer would be a second
implementation of one seam rather than a rewrite. Two conditionals elsewhere now
close firmly — bundled tokenizers and the instruct/context template surface both
stay discarded. *[00 §2.2, 07 §5.5, triage §6.2]*

**A5. Multiplayer posture. — CONFIRMED: don't preclude, don't build.**
`participants` is a list, `control: "player"` is not structurally limited to one,
and turns are already server-side jobs on an event stream. No turn arbitration,
no per-user hidden state, no simultaneous input at 1.0 — those are the actual
feature and none of them is prejudiced by the three decisions above.
*[04 §8]*

**A6. Client framework. — CONFIRMED: React + Vite + TanStack, and the custom-
rendering escape hatch is pushed out as far as it will go.** The framework
choice is reversible because extensions declare widgets rather than shipping
components ([05 §8](05-ui-surfaces.md)), so nothing outside the client package
knows what it is.

On the escape hatch: **deferred deliberately and for as long as possible.**
Sandboxed custom rendering is painful for everyone it touches — see
[05 §8.1](05-ui-surfaces.md) — and core features come first. The paired
commitment is that deferring it means *actively widening the declarative
vocabulary* instead, since every widget type added is one fewer reason to need
an iframe. *[05 §8, 07 §6]*

**A7. Schema direction of derivation. — CONFIRMED: TypeBox.** JSON Schema is the
artefact; TypeScript types are derived from it. The deciding argument stands:
package and extension manifests must be validatable by tools not compiled
against our TypeScript ([07 §4](07-tech-stack.md)). *[07 §4]*

**A8. Runtime and index driver. — CONFIRMED: Node LTS, `node:sqlite` preferred
with `better-sqlite3` as fallback.** Low-risk because the index is derived — a
driver bug costs a rebuild, not data — and preferring the built-in leaves the
project with no unavoidable native dependency, which is what keeps Docker builds
simple. *[07 §2, §7]*

---

## B. Data model questions

**B1. Fixed profile fields or conventional sections? — RESOLVED: conventional
sections.** No fixed prose fields on `ActorProfile`. `se.summary`,
`se.appearance`, `se.voice`, `se.background` are reserved section ids that
everything assumes exist, enforced at three layers rather than by the schema:
the editor creates all four on a new actor, generation and assists treat them as
required and recreate a deleted one, and the default preset addresses them by id
while tolerating absence. Buys one kind of prose block instead of two — adding a
custom section is the same operation as editing a built-in one. *[02 §2.1,
13 §4]*

**B2. Does a Treatment own a primary lorebook? — RESOLVED: no. It only links.** A
primary lorebook would block many treatments over one lorebook — a noir and a
comedy drawing on the same world — and create an ownership question on delete.
`LoreLink.required` is the concession: mark a link load-bearing and a consumer
warns loudly when it will not resolve, still without blocking. *[02 §4, 10 §3]*

**B3. Turn record retention. — RESOLVED: keep everything.** No compaction, no
automatic pruning. The cost is disk and the benefit is that every question about
a session stays answerable forever, which is most of why the record exists. Worth
knowing the order of magnitude: a full record is roughly 10–100× its message
text, so a thousand-turn session is tens to a couple of hundred megabytes.
Acceptable, and it makes B4 matter more than it otherwise would. *[02 §8]*

**B4. Turn storage layout. — RESOLVED: append-only JSONL segments, and branching
does not affect it.** Specified in [02 §5.5](02-data-model.md).

The worry — that reconstructing the primary thread of a long, repeatedly
branched session gets complicated — comes from an assumption worth dropping:
that file order should resemble reading order. It should not. **Segments are
creation-ordered and never rewritten; reading order is a tree walk resolved
through the index.** Once those are separate, branching stops being a storage
concern entirely: a branch is just more appends, so no branch-aware cap is
needed and no segment ever has to be pieced back together.

**B5. Embedded payload compression. — RESOLVED: plain base64 `tEXt`.** Simplest,
and most widely readable by third-party tools. Volume is not the concern it
looks like: binary media travels in its own chunk as raw bytes
([02 §5.2.2](02-data-model.md)), so base64's ~33% overhead applies only to the
JSON, which is small. *[02 §5.2]*

**B6. JSON or YAML? — RESOLVED: JSON everywhere, including config.** YAML is
nicer to hand-edit and supports comments, and is still not worth mixing two
serialisation formats inside one application — JSON is the norm here and every
import/export path already speaks it. The one real loss is self-documenting
config; covered by a commented `config.example.json` and keeping the settings UI
the primary path. *[02 §5.4]*

**B7. Channel schema migration. — RESOLVED: validate, coerce, migrate,
quarantine — and the session always opens.** Specified in
[03 §4.2](03-modes-and-turn-pipeline.md).

**Embedding the schema and running the old one is rejected.** It looks like
compatibility and is a trap: every session becomes a schema store, the engine
must keep every historical reducer and widget alive, and nothing can ever be
removed. **Record the version, never the schema** — one integer per channel is
all that is needed to know whether anything must happen.

The rule to apply already exists: dangling references are survivable, visible and
non-blocking ([00 §3.3](00-stance.md)), and a channel that no longer fits its
schema is the same situation. So load never fails; a channel that cannot be
salvaged is quarantined with its raw value preserved, the channel reset to
default, and the session marked degraded rather than broken.

Two things make this smaller than it first looks. **Most schema evolution never
needs a migration** — additive changes validate already and removals are handled
by dropping unknown fields — so migration functions are optional, which matters
because third-party extension authors cannot be made to write them. And the
stakes are lower than they feel: channel state is tracked numbers and flags, not
the story, so the worst honest outcome is a reset inventory.

The real work is the **error surface** — a per-session health record, a
persistent banner that says the story is unaffected, and recovery offered rather
than applied. The same path covers channels orphaned by an uninstalled
extension. Migrations must be pure and deterministic, because they sit inside the
replay path. *[03 §4.2, 09 §4]*

**B8. Translated play. — RESOLVED: not attempted, and explicitly not a blocker
for 1.0 or 2.0.** Translating *content* — cards, lorebooks, narration — is
wanted in principle and cannot realistically be implemented or assessed here, so
it is not attempted rather than half-attempted. UI localisation (A2d) is a
separate matter and does ship.

**Doing nothing is the correct action, and it forecloses nothing.** Aventuras'
approach — `translated*` columns smeared across every entity — is what would
have to be avoided, and simply not adding them costs nothing now. If it is ever
attempted, a sidecar keyed by (objectId, field, language) needs no schema change
at all, because readers already preserve unknown fields
([10 §2](10-schemas.md)). *[01 §2, 07 §releases]*

**B9. Can an expanded opening seed be promoted back? — RESOLVED: yes.** That is
the point of carrying seeds and written openings as two lists: a seed is reusable
machinery, a good expansion is content worth keeping. The loop closes —
seed → expand → edit → accept → promote — and the promoted opening records
`fromSeedId`. Promotion targets the source object, not the session. *[02 §6, 10 §3]*

**B11. Lorebook revisions. — CONFIRMED as proposed.** All four:
(a) entry state — `dynamicState`, quests, relationships, disposition — moves to
session channels with only a `stateSchema` left on the entry, so an exported
lorebook cannot carry somebody's playthrough; (b) `activationConditions` and
`schedule` unify as typed channel predicates; (c) `embedding` moves to the
derived index; (d) the five overlapping book-level scoping mechanisms collapse
to one `LoreScope` union. Everything else — matching, timing, recursion,
placement, grouping, gating and the two-tier budget — is taken from Marinara
essentially unchanged. *[02 §3, 10 §5]*

**B12. Are sessions exportable? — RESOLVED in principle: yes, eventually. Not an
early priority.** Sessions are marked internal and free-to-migrate
([10 §1](10-schemas.md)) *because* nothing exports them, so this has a
consequence worth carrying: **the turn record may churn freely now and should be
expected to freeze when export ships.** Better to know that is coming than to
discover it. Export drags along `localActors`, channel state, branch structure
and renditions, which is why it is a larger commitment than it looks.

Distinct from the **reading view** ([05 §12](05-ui-surfaces.md)), which *does*
ship at 1.0 and is deliberately lossy — a person reading a story rather than an
install loading one.

**B10. Prologue packages — good concept, worth doing, unblocked once B12 lands.**
A package shipping a partially-played session as a starting state. Conceptually
welcome and no longer blocked on an undecided question, only on a sequenced one.
The [10 §7](10-schemas.md) split makes it clean: a prologue is a *session*
travelling in a package, not a variant of Setup. *[02 §7]*

**B13. Where per-user UI preferences live. — RESOLVED on the third answer, at
[P2A §2.2](workplan/13-p2a-configuration-surface.md).** A separate per-user
`prefs.json`, which is what
[04 §4.3](04-server-multiuser-deployment.md)'s canonical layout block had
already been drawing while this question stayed open — closing it was mostly
letting two documents agree. Namespaced string keys, JSON values, unvalidated by
the server; a patch merges shallowly and `null` deletes, because a
whole-document write makes two open tabs a lost update; writes serialise per
handle; and an unreadable file reads as empty rather than refusing to start,
which is the deliberate asymmetry with `accounts.json` — a broken accounts file
means the server cannot tell who anyone is, a broken prefs file means somebody's
pane is collapsed wrong. **The key pattern and size cap are bounds, not
validation**, and the code has to say which it is doing or the next reader
improves them into the schema this answer ruled out.

The question as it stood, kept because the reasoning is what makes the answer
binding rather than arbitrary:

`Account` ([04 §4.2](04-server-multiuser-deployment.md)) carries
`locale` and `capabilities` and nothing else presentational, but the client has
already accumulated preferences with nowhere to go: the *As stored* pane state
and the all-kinds library view ([polish §2, §4](workplan/09-polish.md)), with
§1.1's density question likely to follow. The settings surface that shows them
is [05 §15](05-ui-surfaces.md) and is P10's; **the store is not, and blocks the
first preference that ships.** *Both halves of that last clause moved: the
surface is P2A's too, which is what forced this question rather than deferring
it again.*

Three candidate answers, in increasing order of commitment:

- **`localStorage`, client-only.** Free, and wrong for anything a user would
  expect to follow them to another browser — which is most of it, on a LAN
  server people reach from a laptop and a phone.
- **A `preferences` map on `Account`.** Small, obvious, and consistent with
  `locale` already living there. The cost is that `accounts.json` is
  security-sensitive, hand-editable and written on every preference toggle,
  which is a poor fit for a chatty write path next to a password hash.
- **A separate per-user preferences file**, under the user's own directory like
  everything else ([04 §4.3](04-server-multiuser-deployment.md)), so it
  inherits the watcher, the backup story and the folder-is-yours position.

**Leaning to the third**, with the shape of the value deliberately loose:
namespaced string keys and JSON values, unvalidated by the server, because a
preference the client stops using should rot quietly rather than need a
migration. What must be decided before the first one ships is only *where* —
moving them later means either a migration or silently losing everyone's
settings. *[04 §4.2, 05 §15]*

*The lean is what was adopted, unchanged. It is recorded here rather than
rewritten because the argument for the third answer is the reason it binds — a
future proposal to move preferences onto `Account` has to answer the chatty
write path beside a password hash, not merely prefer a different file.*

---

## C. Mode and pipeline questions

**C1. Names. — RESOLVED: Messages, Scene, Adventure**, with Adventure presets
**Freeform** (1.0) and **Campaign** (2.0).

*Chronicle* was the earlier name for Freeform and was replaced: it read as
Campaign's sibling by being another grand noun, and suggested *recording*
something that had already happened rather than playing it. Campaign works
because it is borrowed from the domain; the other preset needed the same,
naming the axis that actually separates them — how much structure the game
imposes. "Freeform RP" is established vocabulary for roleplay without dice or
stats, legible from both tabletop and RP culture. *Solo* was the other contender
and overclaims, since companions are allowed.

`freeform` is the **identifier**, which is the part that needed settling now:
preset ids travel inside Setup objects ([10 §7](10-schemas.md)), so changing one
later is a content migration rather than a rename. The **user-facing label**
stays free until Campaign ships — there is one Adventure preset at 1.0 and the
UI can simply say *Adventure*. *[03 §1]*

**C2. Mixed voice within a turn. — CONFIRMED: yes**, as a mode-preset
capability rather than a per-turn toggle. A narrator paragraph followed by
embodied dialogue as several `generate` steps feeding one message. It multiplies
latency and failure modes, which is why a preset declares it rather than a user
toggling it mid-session. *[03 §3]*

**C3. Multiple player-controlled party members. — CONFIRMED: yes**, and
permitted by default in the Adventure presets, where playing a pair is a normal
way to run a story.

**This also settles something not previously specified: impersonation.**
SillyTavern's *impersonate* — the model writes your next message as your persona
and you edit or accept it — is the same axis seen from the other end: a
`player`-controlled member being model-authored for one turn. Not a separate
feature, a per-turn control override. Scene mode is its home and it ships at
1.0. Three details make it feel right: the output is a **draft** that lands in
the input box and is not sent until the user sends it; it is a `generate` step
like any other, so it is recorded and re-rollable; and the call is
`voice: "embodied"` on the persona. *[03 §3.1, 03 §8]*

**C4. Turn job durability across restart. — CONFIRMED as proposed.** Turns are
not resumed; the partial turn is recorded as failed with its blocks intact, and
recovers through the ordinary retry affordance. *[04 §2]*

**C5. Steps that suspend for player input. — CONFIRMED: include it.**
Potentially powerful, and worth noting that Infinite Worlds — where the idea
comes from — uses it sparingly. So: build the mechanism, and do not over-invest
in its UX before there is evidence anyone reaches for it often. *[03 §6]*

**C6. One expression language for templates and rules. — PARTLY SETTLED: one
language, definitely. Which one stays open.**

The constraint is confirmed — templates and rule conditions share an evaluator,
so authors learn one thing and we sandbox one thing. The *choice* needs real
research and, more usefully, a closer understanding of the suite as actually
built: what rule conditions really need to express, and whether a template
language stretches to them comfortably. Deferring the pick costs nothing as long
as the single-language constraint holds. *[03 §5, 07]*

**C7. Authored rule vocabulary. — RE-SCOPED: deferred to 2.0.** The direction is
unchanged — take Infinite Worlds' conditions and effects close to wholesale
([08 §3](08-infinite-worlds.md)) — but the vocabulary, its evaluator and its
authoring surface leave 1.0 entirely ([work plan §0.4](workplan/01-work-plan.md)).

The argument that moved it: IW itself ran on triggers and tracked items for years
before arriving at PawScript, **and arrived at it with a corpus of real authored
worlds to design against.** We have none, and an expression language designed
against imagination is one nobody can use. Two stable schemas were also carrying
⚠ warnings for fields typed against something unwritten; deferring removed both
and left `PlotHook` and `Goal` honestly stable.

**What 1.0 owes it** ([03 §4.1](03-modes-and-turn-pipeline.md)): `owner` accepts
a package id from the first channel definition written, and every effect —
model-proposed, engine-computed, later authored-rule — applies through one path
into the turn record. Both free now, both migrations later. The fields removed
from the two schemas return additively, so neither goes to `/2`.

**The fuzzy-condition position below stands** and moves with the vocabulary; it
is recorded here so the reasoning is not re-derived in two years.

**AI-evaluated fuzzy conditions are allowed, uncapped, and openly discouraged.**
IW caps them at ten per world because it is a hosted service paying for every
evaluation; a self-hosted install is not under that constraint, so a hard cap
would be borrowed rather than reasoned. But they are slow, they cost a call, and
IW's own documentation warns they produce false positives — so the editor should
warn on use, the documentation should say plainly why they are a last resort, and
the workbench should show when one misfired. **Making the cost visible is better
discouragement than a limit.** *[08 §3]*

**C7b. Plot hooks — scope at 1.0. — RESOLVED: data structures from the
beginning, and a simple selector early.** Both ship. The structures because they
are cheap and foreclose nothing; the selector because hooks are one of the
clearest things StoryEngine does that its sources do not, and a data structure
nobody can use is not a differentiator. Expect it to do little in early practice
— pacing takes tuning — and build the simple version anyway. Replaceable by an
extension, following retrieval's pattern.

**Hooks must be addable to a running session**, which is most of why the feature
earns its place: *"I have just realised I want this plot point to come up, but
not necessarily on this turn."* That brushes against prefill-not-binding, so the
reconciliation is explicit — **session-local hooks are the primary path** (add to
the session, immediately eligible, no principle bent), and **treatment changes are
pulled, never pushed** (*"the treatment has 2 new hooks — add them?"*). A pushed
update would mean editing a treatment could silently alter a story in progress,
which is the failure prefill-not-binding exists to prevent.

"Hook packs" as a separately shareable kind stay declined; C7c covers the case
that motivated them. *[02 §4.1, 03 §6.1]*

**C7c. Plot hooks on lorebooks. — RESOLVED: allowed, secondary.** Hooks are
treatment-shaped rather than lorebook-shaped, and multi-sourcing is genuinely
untidy — but a hook is often *about* a specific piece of world content, and two
things make the association principled rather than convenient. It **travels with
the thing people actually exchange**, since lorebooks are this ecosystem's
universal currency where Treatments are ours; and it **gets an eligibility
condition for free**, being live only while its lorebook is active.

Costs accepted: hooks now come from up to four places (treatment, setup, lorebook,
session), mitigated the way multi-book lore already is — every hook shows its
source and editing navigates to the owner. Compatible export to third-party
lorebook formats drops them, like everything else we add. The real risk is
conceptual drift, so it is documented as being for hooks genuinely inseparable
from a piece of lore, with Treatments staying the default answer.
*[02 §4.1, 10 §5]*

**C8. Branch snapshot interval. — RESOLVED: tuneable, and generous during
alpha.** Snapshot often and keep many; they are derived and disposable
([09 §4](09-branching.md)), so the cost is disk and the benefit is that branch
materialisation stays fast while the real access patterns are still unknown.
Tighten once there is evidence, not before. *[09 §4]*

**C9. Unnamed-sibling retention.** [09 §6](09-branching.md) is now **decided**:
swipes and branches are one mechanism, so discarded swipes are permanently
recoverable — something none of the sources offers. What remains open is
presentation, not storage: a long session accumulates many unnamed siblings, and
the history view must not become a tree browser by default. Inline
sibling affordance on the node, full tree behind a deliberate action, prune
available. *[09 §6]*

**C10. Cross-branch merge.** Out of scope for 1.0. Recorded only to confirm
nothing in [09](09-branching.md) precludes it — merging is a question about
reconciling two effect sequences, which the log makes expressible even if it is
not easy. *[09 §9]*

**C11. Branch anchor within a multi-message turn. — RESOLVED** by the turn tree
in [09 §3](09-branching.md). A turn is one node however many messages it emits,
so branching from any of them is an operation on that node. The related
ambiguity also resolves cleanly rather than needing a convention: *redo* adds a
sibling, *continue differently* adds a child. Both are offered explicitly.

**C12. Confirmation before a narrative goal completion fires.** Goals with
`completion: { kind: "narrative" }` are judged by an evaluation step
([03 §7.3.3](03-modes-and-turn-pipeline.md)), and the two error directions are
not symmetric: a missed completion is an annoyance the player resolves manually,
a false one ends the story on a turn that did not earn it. A confirmation step
is cheap insurance against the worse error and costs a prompt at the most
dramatically loaded moment in the session. Leaning toward asking, on the
grounds that a mis-fired ending is unrecoverable in a way nothing else here is —
but it wants real sessions to judge. Under-firing plus always-available manual
completion is the position regardless. *[03 §7.3.3]*

---

## D. Deployment questions

**D0. Config reload tiers. — CONFIRMED.** Every config key annotated
`live` / `reconnect` / `restart`, so the restart-required notice is derived
rather than hand-maintained. *[04 §6]*

**D0b. Packaging targets. — CONFIRMED, and promoted from optional to required.**
The canonical automated build path delivers **six artifacts**: OCI image,
tarball, `.deb`, AUR, Windows service installer, Homebrew formula. All six are
required rather than as-capacity-allows, which rewrites the earlier tiering — the
tiers now describe order of value, not optionality. Declined stays declined:
Flatpak, AppImage, Snap, `.rpm`, LXC.

**Re-cut on the milestone, not on the list** ([work plan §0.4](workplan/01-work-plan.md)): the
OCI image and the tarball are the **beta** requirement; the other four join the
in-app update **check** as **1.0 release** requirements. Tiers 1 and 2 are enough
to have users, and four more build chains before there are any is work that reads
as progress. *[04 §5.4, releases §0]*

**D1. Tailscale. — RESOLVED: Level 1 yes, Level 2 maybe, Level 3 no. All
post-2.0.** An embedded `tsnet` node is a real component for a convenience the
simpler levels mostly deliver. Not hard, but a side project rather than anything
on the path. The only thing to do now is keep the auth layer shaped so Level 2 is
a provider rather than a special case, which costs nothing. *[04 §5.2]*

**D2. Auto-provisioning accounts. — RESOLVED: no. All accounts manually
provisioned until post-2.0 at the earliest.** No self-registration, no invite
links, no identity-provider provisioning. Not philosophical — simpler, and
matched to reality, since most installs are one user or a handful and adding
someone is a conversation followed by typing a name. Revisit only if Tailscale
Level 2 or 3 ever lands.

**This also records a decision rule worth having** ([04 §4.2.2](04-server-multiuser-deployment.md)):
StoryEngine is not targeting hosted-service deployment, which resolves a family
of future arguments — self-registration, tenant isolation, per-object ACLs, abuse
handling. If it were hosted the answer would be **VPS, not shared tenancy**, and
if multi-tenancy is ever genuinely wanted the answer is **fork before
complicating**: a sibling project sharing the engine, rather than taxing every
home user with complexity for a deployment they will never run. *[04 §4.2]*

**D3. File access. — RESOLVED: deprioritised, experimental at best, roadmap
rather than 1.0.** The feature is still wanted and the reasoning still stands;
what changed is its position. Import and export UIs exist for a reason, in-app
library management matters more, and a file-management UI is a disproportionate
amount of surface and risk for something most people will never open.

**Two things survive and still land at 1.0:** the capability field, and the
single audited path-resolution helper — needed by every filesystem-touching route
regardless, and having one from the start is the difference between a security
property and a hope. **Hand-editing on disk keeps working**, because that was
never about the UI: [05 §4.1](05-ui-surfaces.md)'s forcing function is unchanged.
*[05 §4, 14 §3]*

**D4. Mobile layout, and the stance on native clients. — RESOLVED.**
Responsive-and-usable at 1.0; a distinct mobile-optimised layout stays later.

**The "no apps ever" position is softened, with a bar.** Notification-driven
modes — Messages especially — are the kind of thing a native client genuinely
serves better, so a blanket never is the wrong shape. Instead: *not a priority
and not ours to build; pitch it if you want to contribute one, but nothing ships
that is not a feature-complete client with a real advantage over the web app.*
A partial native client is worse than none — it splits the surface, halves the
testing, and teaches people that some features live in one place and some in the
other. *[05 §1, 14 §3]*

---

## E. The remaining gaps, with positions

Was a list of things these documents did not address. Now a list of positions on
them — some decided, some opinionated leans, all better than silence.

### E1. Memory within a session — rolling summaries, chapters later

**Decided: a rolling summary is the default. Chapterisation is a roadmap
feature, manual with agentic advice.**

Rolling wins on the thing that matters day to day: it needs no ongoing thought
from the user. Chapters demand a judgement — *is this a chapter break?* — every
few thousand words, and a mode whose memory quality depends on the user making
that call reliably will have bad memory.

**But "rolling" must not mean "mutating".** This is the part that would silently
break something. [09 §5](09-branching.md) requires summaries to be
content-addressed values keyed by their inputs, because that is what makes a
fork cheap. A naive rolling summary — one record, updated in place — violates it
directly.

The reconciliation: **a rolling summary is an immutable chain, not a mutated
blob.**

```
summary(n) = f( summary(n-1), turns[a..b] )
```

Each link is a value keyed by the hash of its inputs. "Rolling" describes the
chain, not mutation. Forking at turn *f* leaves every link up to *f*
byte-identical — same inputs, same key — so the whole prefix is shared, exactly
one straddling link is recomputed, and the branch's chain continues from there.
This is the property [09 §5](09-branching.md) promised, and it is only available
if the chain is built this way from the start.

**Summaries are derived and disposable**, like the index ([02 §5.1](02-data-model.md)).
Full history is always on disk, so a bad summary is regenerable — nuke and
rebuild, at any point, with a better model or a better prompt. Summary quality is
not a one-way door, which is what makes shipping a simple rolling summary early a
safe bet rather than a commitment.

**Chapters, when they come, are primarily a *reading* feature.** That is a better
justification than memory structure, and it explains why manual is right: a human
knows where a chapter ended better than a heuristic does, and the payoff is a
readable [05 §12](05-ui-surfaces.md) view with real divisions. Chunking summaries
along chapter boundaries is a secondary benefit that falls out. An agent
proposing *"this looks like a chapter break"* is the right amount of automation —
advice, accepted or ignored.

### E2. Embeddings and vector search — later, and aimed at memory

**Opinionated: lower value than it looks for lorebooks, genuinely useful for
memory, and post-1.0 either way.**

Keyword activation plus the budgeter covers most real lorebook use — the whole
SillyTavern ecosystem runs on it. Semantic activation adds a provider
dependency, an index to maintain, re-embedding on every edit, a threshold to
tune, and a class of confusion keywords do not have: **"cosine 0.71" is not a
reason a human can act on.** The turn record's plain-language inclusion reasons
([02 §8](02-data-model.md)) are worth more than the extra recall.

Where it *does* earn its keep is **cross-session memory**
([11](11-cross-session-memory.md)): memories are numerous, keyword-poor, and
exactly the case where "what is relevant here?" has no lexical answer. So when
this arrives, aim it there first and at lorebooks second.

Storage goes in the derived index, which means re-embedding is a rebuild cost
rather than data loss — consistent with everything else, and it disposes of the
"what if the embedding model changes" worry.

### E3. Renditions in the transcript — non-destructive, and keep the recipe

**Decided.** The transcript surface: placeholder while pending, retry on
failure, an **Illustrate** action on any message.

**Retroactive illustration is additive, never replacing.** Illustrating an old
turn adds a rendition alongside whatever that turn already had; it does not
overwrite. Renditions accumulate per turn and the user picks which is shown —
structurally the same as siblings in the turn tree, and for the same reason.

**And a general policy: the recipe is preserved forever; the pixels need not
be.**

> A rendition's **prompt, seed, model and workflow parameters are never
> discarded** unless the user deletes the rendition. The generated asset may be
> evicted.

Worth stating as policy because of what it buys:

- **Any rendition can be re-created**, even one whose image is long gone. The
  recipe is bytes; the asset is megabytes.
- **Eviction becomes safe.** "Generated images will fill the disk" gets an answer
  that loses nothing irreplaceable — evict pixels, keep recipes, regenerate on
  demand.
- **Regenerations are comparable.** Two renditions of the same turn carry their
  seeds, so *why did this one come out different?* is answerable.

It also means an eviction policy is a later decision rather than a now one,
because adopting one can never cost history.

### E4. Session import from other platforms — speculative, not roadmapped

**Nice one day, maybe. Deliberately not a commitment.**

The lift is large and the promise is hard to keep: chat formats move under you,
every source has years of edge cases, and a **half-working importer generates
more support burden than no importer at all**. Better none than one that rots.

Distinct from **card, lorebook and preset import**, which is committed and early
([work plan](workplan/01-work-plan.md) P4). That is a bounded, well-understood surface against
formats that barely move. Session history is neither.

### E5. Tokenisation — one approximator and a margin

**Opinionated: stop trying to be exact.**

Bundled per-model tokenisers are already discarded ([triage §6.2](workplan/02-triage.md)).
What replaces them is not a better estimate but a different posture: **budget
with a margin, not with precision.** If a pre-flight estimate is within ~10% and
the budget reserves headroom, exactness buys nothing — and the turn record stores
*actual* usage from the response, so drift is measurable rather than assumed.

Concretely: one modern BPE tokeniser as a universal approximator, wrong in a
known and consistent direction, rather than one model per provider. One
dependency, no bundled model files, and a measurable error to tune the margin
against.

*Recorded at P3.4, because a surface now shows this number to people.* The
shipped approximator is not the BPE one above: it is `ceil(length / 4)`, with
no dependency at all. The posture is vindicated and the implementation is not
what this section describes, which is worth saying rather than quietly
reconciling in either direction. The one real measurement — P3.2's browser
walk — was **356 estimated against 397 reported, 10.3% low**, sitting exactly
on the ~10% tolerance argued for here; the delta is the chat template, which
`length/4` cannot see. The context meter therefore **labels rather than
corrects**: it says *estimated* and shows the number the budgeter actually
ruled with, because a corrected figure would disagree with the drops the
verdict recorded, and the margin already lives in `reserveOutputTokens`. A
better approximator remains open; a fudge factor at the surface is closed.

### E6. Backup and restore — a command, not a feature

**Opinionated: the design already did most of this, so do not build a
subsystem.**

Files on disk means `rsync` is a legitimate backup strategy and should be
documented as one. What is worth building is small: a command that briefly
quiesces writes, archives the data directory **excluding the index**, and a
restore that puts it back and rebuilds. The index being derived
([02 §5.1](02-data-model.md)) is what makes both trivial.

**The part that actually matters is testing restore.** An untested restore is not
a backup, and this belongs in CI beside the upgrade test
([work plan §8](workplan/01-work-plan.md)): populate a data directory, back it up, restore into a
clean install, assert the library and sessions are intact.

### E7. Error and rate-limit handling — a taxonomy, then a policy

**Opinionated: under-specified, and more load-bearing than it looks.** Pieces
exist — step `failure` modes, the bounded re-ask for malformed structured output
([00 §2.3](00-stance.md)), connectivity detection
([04 §6.5](04-server-multiuser-deployment.md)) — but nothing classifies failures,
and the class is what should determine the response.

| Class | Examples | Response |
|---|---|---|
| **Transient** | 429, 5xx, timeout, connection reset | Bounded retry with backoff, **visible in progress events** as "retrying (2/3)" rather than a spinner |
| **Retryable with a change** | Context overflow, malformed structured output, prompt cap exceeded | Shrink and resend, or re-ask — mechanisms that already exist ([07 §5.3](07-tech-stack.md)) |
| **Terminal** | Invalid credential, model not found, content refusal | Fail the step, surface as **actionable** ([04 §3.5](04-server-multiuser-deployment.md)) |

Two things worth calling out:

- **Shared connections make rate limits a design concern rather than an
  annoyance.** With one system connection serving a household
  ([04 §4.5](04-server-multiuser-deployment.md)), several users hit provider
  limits one user never would. **Queue per connection with a concurrency cap**
  rather than hammering and failing — a turn that waits beats a turn that errors,
  and the progress stream makes waiting legible.
- **Content refusal deserves its own treatment.** It is terminal for that call
  but not for the user's intent, so it should offer *"try a different model"*
  against another role binding rather than surfacing a raw provider error. It is
  among the most common real failures in this domain and the one most likely to
  be met with a shrug if handled generically.

### E8. Content rating — advisory, and always caveated

**Decided: `contentRating` is advisory. It states authorial *intent*, never a
guarantee about model behaviour, and any surface that shows it says so.**

Two reasons, the second stronger than the first:

- Enforcement is not an area worth wrestling into this engine.
- **Even trying would be a promise that cannot be kept.** A rating implying the
  model will behave accordingly is a guarantee no local software can make, and
  making it badly is worse than not making it at all.

So nothing mechanical gates on it. It is metadata for a human choosing content,
and a signal a preset *may* act on if its author chooses.

**Where enforcement actually belongs is prompt packs and upstream system
prompts** — the layer that shapes model behaviour directly, authored by whoever
has an opinion about it and replaceable by whoever does not. That is also the
layer where the effect is visible in the turn record rather than hidden in engine
logic.

`contentRating: null` continues to mean *unspecified, ask* rather than *safe*
([10 §6](10-schemas.md)).

### E9. Testing — done

Now [testing](workplan/10-testing.md).

### E10. Simple/advanced, or a rearrangeable layout — open, and not blocking

The density stance is settled: [05 §1.1](05-ui-surfaces.md) commits the *tooling*
surfaces to a high-density interface in a modern implementation, and the story
and arrival surfaces to a quiet one. What is not settled is what happens for
people who want less density on the tooling side — a real constituency, and one
that will make itself heard the moment the library shows a panel per kind
([05 §5.1](05-ui-surfaces.md)).

**Two candidate answers, an order of magnitude apart in cost:**

- **A simple/advanced split** — two presentations of the same surfaces, one
  culled. Cheap to state, expensive to keep honest: every surface acquires a
  second layout to design, test and keep in step, and the cull is our taste
  imposed on someone else's workflow.
- **A rearrangeable layout** — density becomes a thing a user dials. The more
  attractive answer and much the larger. **Not a theme.** Theming reaches
  colour, type scale and spacing; *what is on the screen and how it is grouped*
  is layout and component structure, and exposing that to users is a dashboard
  builder, not a stylesheet. Nothing in the design provides either today:
  [05 §8](05-ui-surfaces.md) deliberately gives extensions no UI surface, so this
  would be ours to build rather than something to delegate.

**The caution, which is the reason this entry exists at all.** *"Ship it dense,
users can dial it back later"* is a trap with a worked example: SillyTavern's
configurability is extensive, and its reputation for being overwhelming is not
in spite of that but partly because of it — configuration stood in for design,
and the settings surface became one more overwhelming thing. **Neither answer
here licenses shipping an undesigned surface.** Every surface has to be right at
its default before it is worth making adjustable, and each one built before a
layout system exists is one to retrofit into it later.

**Why it is still not blocking.** Both answers are presentation layers over the
dense layout, and the dense layout is the one to build first — a culled view
derives from a full one, never the reverse ([05 §1.1](05-ui-surfaces.md)). The
cost of deferring is that surfaces built now should avoid hard-coding their own
arrangement where a cheap alternative exists; that is a coding-standards note,
not a design decision waiting on this.

**What would force it early:** evidence that the dense default actually loses
people at first run, which is exactly what the PLAYABLE checkpoint
([work plan §4.1](workplan/01-work-plan.md)) exists to produce. Note what that evidence would
*not* justify — the first-run and setup flows are already on the quiet side of
the split, so losing people there is a §6 problem before it is a density one.

**What has since landed, and what it does not settle.** A token layer now
exists: colour, radius and the type scale are named once in
`packages/client/src/index.css`, spent by `packages/client/src/ui/`, and a
Tailwind palette scale written anywhere else in the client is a build error
([05 §1.2](05-ui-surfaces.md)). Two themes ship, light and dark, chosen by
`prefers-color-scheme`. That settles the half of this entry's vocabulary that is
*look* — and settles none of the rest. Simple/advanced and rearrangeable layout
are both still open, because both are about **what is on the screen and how it
is grouped**, which the entry above is careful to say a theme does not reach.

**A config file for the theme was considered and refused**, and the reason is
this entry's own test. *Every surface has to be right at its default before it
is worth making adjustable* — and at the time of asking the primary button had
three incompatible spellings, the error box seven paddings, and no token was
named anything. A config key pointing at that is configuration standing in for
design, which is the failure this entry was written about. Two designed defaults
with the OS picking between them is not the same thing: nothing is exposed, so
there is no settings surface to get wrong.

**The explicit toggle has since landed, in `prefs.json` rather than
`config.json`** — light, dark or match my system, in the Preferences pane
([05 §15.1](05-ui-surfaces.md)). Per-user rather than per-install, which is what
a theme actually is; live rather than restart-tiered; and it is the first
consumer of the store B13 settled, which until then had a route, a hook,
four tests and nothing using it. `config.json` was the wrong shape twice over:
admin-only behind the `/api/admin` guard, so a non-admin could not read it, and
the login screen is a Quiet surface that must be styled *before* anyone has
authenticated.

**And it is still not a configuration surface in this entry's sense**, which is
the distinction worth keeping. What shipped is a choice between two designed
defaults, both of which had to be right before either could be offered — not a
dial that hands the design problem to the user. The test this entry sets was met
in the order it asks for: the surfaces were made correct, and *then* one of them
was made selectable.
