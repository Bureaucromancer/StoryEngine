# 25 — Open questions

Collected from the inline **[OPEN]** markers, plus questions that don't belong to
one document. Ordered by how expensive they are to answer late.

---

## A. Decide before writing code

**A0. The licence. — RESOLVED 2026-08-09: AGPL-3.0.** Matches all three sources;
`LICENSE` is in the repository root. Lifting code from the sources is permitted
with notices preserved, §13 obliges us to offer source to LAN users
([09 §7](09-server-multiuser-deployment.md)), dependencies must be
AGPL-compatible, and user content is unaffected. See [triage §1](workplan/02-triage.md).
Spawns A1b, below.

**A1. Extension execution model. — RESOLVED: worker-thread boundary from 1.0.**
Specified in [22](22-extensions.md). The decision turns on separating two things
that get bundled under "sandbox": **fault isolation** (a crash, hang or runaway
loop not taking the server down) is cheap and shapes the API, so take it now;
**authority isolation** (an extension unable to reach the filesystem at all) is
expensive and additive, so defer it — extensions are AGPL and admin-installed,
which is a materially weaker threat model than untrusted code.

The reason this costs less than instinct suggests: **the extension surface
already serialises.** Five of the seven things [06 §9] requires are declarative
and cross no boundary at all; the remaining two are a function over JSON-shaped
data and async host calls. Built-in modes run through the same boundary, so the
contract cannot drift. *[06 §9, 22]*

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
API, not a directory.** Specified in [22 §5](22-extensions.md). The worker
boundary from A1 makes this cleaner than the directory the question assumed:
storage is a host call namespaced per (user, extension), so cross-user and
cross-extension reach are impossible by construction rather than by check. Backed
by files under the user's directory so it inherits the watcher, index and backup
story; quota declared in the manifest; removed on uninstall with an explicit
keep-the-data prompt. Values are JSON — bulk bytes go through a separate asset
call returning a handle. *[06 §9, 24 §4.6, 22 §5]*

**A2. Can a package ship code? — SHARPENED by [02 §2.1](02-infinite-worlds.md):
packages may ship *rules*, never *code*.** Declarative rules are terms in a
closed vocabulary our evaluator interprets, so importing one grants no capability
the importer lacks — which is what makes shared content far more expressive
without touching A1's execution question. Still open: bundling an actual mode or
extension implementation remains a no for 1.0, and the rule vocabulary needs
versioning so a package authored against v2 fails legibly on a v1 host.
*[03 §7, 02 §2]*

**A2b. Randomness. — RESOLVED 2026-08-09: one canonical server-local RNG
service, no network dependency, every draw recorded in the turn's effects.**
Nothing else draws — not steps, modes, the rules evaluator, or extensions.
`node:crypto` under the hood with an injectable generator for tests; the API
must be complete enough (dice notation, weighted pick, chance) that nobody is
tempted to bypass it. Specified in [19 §14](19-tech-stack.md).

**Follow-on also resolved: rewrite and reroll are separate operations, and
rewrite is the default.** An ordinary swipe replays the recorded draw tape —
same mechanical outcome, different prose — and drawing fresh is a deliberate
second action, so swiping past a failed check cannot be save-scumming by
accident. Draws are keyed by site rather than position so replay survives a
divergent execution path. Still open, and minor: whether a session may flip the
default. See [19 §14.5–14.6](19-tech-stack.md).

**A2c. Notification event schema. — RESOLVED, by separating two taxonomies that
were being treated as one.** Specified in
[09 §3.2–3.5](09-server-multiuser-deployment.md).

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
`artifact.ready`, `system.notice` at 1.0; `message.received` whenever Messages is
built ([24 §3.4](24-roadmap.md)). Named
`artifact.ready` rather than `rendition-ready` because the class is about async
work attached to a turn finishing, and naming it for its first producer means
renaming it for the second. Deliberately **not** split into blocking and
non-blocking: renditions never block by design and the blocking case is already
`awaiting-input`, so the split would model a state the architecture forbids.
`agent-note` dropped — that is a progress event. `actionable: boolean` carries
the distinction that actually matters for routing, as a field rather than a
doubling of the list. *[09 §3.2–3.5]*

**A2d. UI localisation.** Settled in [19 §12](19-tech-stack.md): i18next with
explicit hierarchical keys, ICU plurals, silent per-key English fallback,
machine translation as the primary path with provenance markers, Weblate for
contributors. Two items are load-bearing before code: **CSS logical properties
from the first stylesheet** (otherwise RTL is permanently foreclosed), and
**server events carrying `{key, params}` rather than English prose**. Both are
free now. Docs translation is explicitly out of scope — Marinara's `docs-i18n`
branch shows the real ongoing cost. *[releases, 09 §3.2]*

**A2e. Sharing content between users on one install — deferred, deliberately.**
[09 §4.3](09-server-multiuser-deployment.md) reverses an earlier draft: every
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
copy-from. *[09 §4.3, 03 §5.1]*

**A3. Server-scoped connections. — RESOLVED: account-scoped, with a system
scope, exactly like the library.** Specified in
[09 §4.5](09-server-multiuser-deployment.md). Connections belong to an account
except for system connections, and the admin capability is adding and removing
those — the same authority that manages the system library, not a new permission
model. Effective list is the user's plus the system's, resolved as one merge.

**The symmetry breaks in one place and that is the important part:** library
objects are readable and forkable, connections are **usable but opaque**. The key
never leaves the server, `system/connections/` is excluded from file access
entirely (unlike `system/library/`), and there is no copy-to-mine because copying
would mean copying the credential.

They are consumed through **role bindings** ([19 §5.1](19-tech-stack.md)) rather
than picked per turn, which is what makes the household case work — an admin
binds `prose` and `fast` to system connections and personal bindings override.
Two consequences worth carrying: cost attribution stops being optional once
everyone spends one key, and rate limits become shared. Still true that
library-time assists are a second call path, so role resolution must work outside
a session ([10 §11.4](10-ui-surfaces.md)).

**Extended: whether a user may hold private connections at all is a named
account capability**, default true, enforced at resolution rather than creation
so the file browser is not a bypass. Revoking disables rather than deletes.
Beyond that, a general role system is on the feature list at High
([09 §4.2.1](09-server-multiuser-deployment.md),
[24 §3.1](24-roadmap.md)) rather than in any committed version.
*[09 §4.5, 09 §4.2, 19 §5.1]*

**A4. Raw-completion support. — RESOLVED: legacy, dropped, no adapter.**
Specified in [19 §5.5](19-tech-stack.md). Not "chat-shaped by default with a
completion path behind it" — the supported surface is **OpenAI-compatible chat
and nothing below it**, stated as a position rather than left to be discovered.

It costs less than it would have three years ago: llama.cpp, Ollama, vLLM, LM
Studio, KoboldCpp and text-generation-webui all expose OpenAI-compatible chat, so
the excluded set is small — completion-only services, and anyone deliberately
driving a raw endpoint — and a translating proxy is an off-the-shelf answer that
is not ours to maintain. What is genuinely lost is byte-exact control of the
final prompt string, which is the part power users will feel.

Cheap to unmake: [06 §5](06-modes-and-turn-pipeline.md) already isolates
rendering as a single step, so a completion renderer would be a second
implementation of one seam rather than a rewrite. Two conditionals elsewhere now
close firmly — bundled tokenizers and the instruct/context template surface both
stay discarded. *[00 §2.2, 19 §5.5, triage §6.2]*

**A5. Multiplayer posture. — CONFIRMED: don't preclude, don't build.**
`participants` is a list, `control: "player"` is not structurally limited to one,
and turns are already server-side jobs on an event stream. No turn arbitration,
no per-user hidden state, no simultaneous input at 1.0 — those are the actual
feature and none of them is prejudiced by the three decisions above.
*[09 §8]*

**A6. Client framework. — CONFIRMED: React + Vite + TanStack, and the custom-
rendering escape hatch is pushed out as far as it will go.** The framework
choice is reversible because extensions declare widgets rather than shipping
components ([10 §8](10-ui-surfaces.md)), so nothing outside the client package
knows what it is.

On the escape hatch: **deferred deliberately and for as long as possible.**
Sandboxed custom rendering is painful for everyone it touches — see
[10 §8.1](10-ui-surfaces.md) — and core features come first. The paired
commitment is that deferring it means *actively widening the declarative
vocabulary* instead, since every widget type added is one fewer reason to need
an iframe. *[10 §8, 19 §6]*

**A7. Schema direction of derivation. — CONFIRMED: TypeBox.** JSON Schema is the
artefact; TypeScript types are derived from it. The deciding argument stands:
package and extension manifests must be validatable by tools not compiled
against our TypeScript ([19 §4](19-tech-stack.md)). *[19 §4]*

**A8. Runtime and index driver. — CONFIRMED: Node LTS, `node:sqlite` preferred
with `better-sqlite3` as fallback.** Low-risk because the index is derived — a
driver bug costs a rebuild, not data — and preferring the built-in leaves the
project with no unavoidable native dependency, which is what keeps Docker builds
simple. *[19 §2, §7]*

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
warns loudly when it will not resolve, still without blocking. *[03 §4, 04 §3]*

**B3. Turn record retention. — RESOLVED: keep everything.** No compaction, no
automatic pruning. The cost is disk and the benefit is that every question about
a session stays answerable forever, which is most of why the record exists. Worth
knowing the order of magnitude: a full record is roughly 10–100× its message
text, so a thousand-turn session is tens to a couple of hundred megabytes.
Acceptable, and it makes B4 matter more than it otherwise would. *[03 §8]*

**B4. Turn storage layout. — RESOLVED: append-only JSONL segments, and branching
does not affect it.** Specified in [03 §5.5](03-data-model.md).

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
([03 §5.2.2](03-data-model.md)), so base64's ~33% overhead applies only to the
JSON, which is small. *[03 §5.2]*

**B6. JSON or YAML? — RESOLVED: JSON everywhere, including config.** YAML is
nicer to hand-edit and supports comments, and is still not worth mixing two
serialisation formats inside one application — JSON is the norm here and every
import/export path already speaks it. The one real loss is self-documenting
config; covered by a commented `config.example.json` and keeping the settings UI
the primary path. *[03 §5.4]*

**B7. Channel schema migration. — RESOLVED: validate, coerce, migrate,
quarantine — and the session always opens.** Specified in
[06 §4.2](06-modes-and-turn-pipeline.md).

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
replay path. *[06 §4.2, 07 §4]*

**B8. Translated play. — RESOLVED: not attempted, and explicitly not a blocker
for any committed version.** Translating *content* — cards, lorebooks, narration — is
wanted in principle and cannot realistically be implemented or assessed here, so
it is not attempted rather than half-attempted. UI localisation (A2d) is a
separate matter and does ship.

**Doing nothing is the correct action, and it forecloses nothing.** Aventuras'
approach — `translated*` columns smeared across every entity — is what would
have to be avoided, and simply not adding them costs nothing now. If it is ever
attempted, a sidecar keyed by (objectId, field, language) needs no schema change
at all, because readers already preserve unknown fields
([04 §2](04-schemas.md)). *[work plan §2, releases]*

**B9. Can an expanded opening seed be promoted back? — RESOLVED: yes.** That is
the point of carrying seeds and written openings as two lists: a seed is reusable
machinery, a good expansion is content worth keeping. The loop closes —
seed → expand → edit → accept → promote — and the promoted opening records
`fromSeedId`. Promotion targets the source object, not the session. *[03 §6, 04 §3]*

**B11. Lorebook revisions. — CONFIRMED as proposed.** All four:
(a) entry state — `dynamicState`, quests, relationships, disposition — moves to
session channels with only a `stateSchema` left on the entry, so an exported
lorebook cannot carry somebody's playthrough; (b) `activationConditions` and
`schedule` unify as typed channel predicates; (c) `embedding` moves to the
derived index; (d) the five overlapping book-level scoping mechanisms collapse
to one `LoreScope` union. Everything else — matching, timing, recursion,
placement, grouping, gating and the two-tier budget — is taken from Marinara
essentially unchanged. *[03 §3, 04 §5]*

**B12. Are sessions exportable? — RESOLVED: yes, and it ships at 1.0**
([work plan §0.5](workplan/01-work-plan.md), P11).

**Re-scoped from "yes, eventually. Not an early priority."** Two arguments moved
it. *Feature complete to the 1.0 spec* is not a credible claim about a
storytelling tool whose stories cannot leave it — the beta gate is checkable
against the design notes ([releases §0](workplan/04-repo-and-releases.md)), and a
gate that passes with no way out of the product is measuring the wrong thing.
And export is the beginning of the **session interchange format** that E4's
import question turns out to depend on, so building it late means answering that
question twice.

Sessions are marked internal and free-to-migrate ([04 §1](04-schemas.md))
*because* nothing exports them, and the consequence now has a date: **the turn
record freezes at P11.** [13 §4.8](13-write-mode.md)'s window has therefore shut
rather than narrowed — Write's anchor and parent-link changes must be settled
before the format is frozen, which is why [13](13-write-mode.md) became a
near-term document. Export drags along `localActors`, channel state, branch
structure and renditions, which is why it is a larger commitment than it looks,
and that size is now inside P11's estimate rather than outside it.

Distinct from the **reading view** ([10 §12](10-ui-surfaces.md)), which *does*
ship at 1.0 and is deliberately lossy — a person reading a story rather than an
install loading one.

**B10. Prologue packages — good concept, worth doing, unblocked once B12 lands.**
A package shipping a partially-played session as a starting state. Conceptually
welcome and no longer blocked on an undecided question, only on a sequenced one.
The [04 §7](04-schemas.md) split makes it clean: a prologue is a *session*
travelling in a package, not a variant of Setup. *[03 §7]*

**B13. Where per-user UI preferences live. — RESOLVED on the third answer, at
[P2A §2.2](workplan/09-p2a-configuration-surface.md).** A separate per-user
`prefs.json`, which is what
[09 §4.3](09-server-multiuser-deployment.md)'s canonical layout block had
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

`Account` ([09 §4.2](09-server-multiuser-deployment.md)) carries
`locale` and `capabilities` and nothing else presentational, but the client has
already accumulated preferences with nowhere to go: the *As stored* pane state
and the all-kinds library view ([polish §2, §4](workplan/06-polish.md)), with
§1.1's density question likely to follow. The settings surface that shows them
is [10 §15](10-ui-surfaces.md) and is P10's; **the store is not, and blocks the
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
  everything else ([09 §4.3](09-server-multiuser-deployment.md)), so it
  inherits the watcher, the backup story and the folder-is-yours position.

**Leaning to the third**, with the shape of the value deliberately loose:
namespaced string keys and JSON values, unvalidated by the server, because a
preference the client stops using should rot quietly rather than need a
migration. What must be decided before the first one ships is only *where* —
moving them later means either a migration or silently losing everyone's
settings. *[09 §4.2, 10 §15]*

*The lean is what was adopted, unchanged. It is recorded here rather than
rewritten because the argument for the third answer is the reason it binds — a
future proposal to move preferences onto `Account` has to answer the chatty
write path beside a password hash, not merely prefer a different file.*

**B14. May a lorebook's `scope` narrow a book the session already chose? —
OPEN. Deliberately not decided at [P5.7], and it is the question that survives
the reversal.**

Settled first, so the open part is small: **selection is the only way a lorebook
reaches a session** ([03 §3.4](03-data-model.md)) — `session.lore`, or the
treatment the session names. P5.7 briefly let `scope` *admit* books and that was
reversed, because `global` is the factory default *and* the SillyTavern
importer's fallback, so a person's whole library landed in every prompt.

What is open is the other direction. A book scoped `linked` to Vera, which a
session has **chosen**, could reasonably either:

- **Contribute unconditionally** — what ships. The person who linked it said to,
  and that is the end of it. `scope` is stored, exported, and read by nothing.
- **Narrow to sessions casting one of its actors** — so the chosen book goes
  quiet when Vera is not in the scene.

The second is coherent and was **not** taken, for a stated reason rather than by
omission: it introduces a new way for a deliberately chosen book to be silently
inactive, which is the same class of surprise the reversal removed, pointing the
other way. A person who links a book and sees nothing from it would have to
learn that a field on the *book* was overruling their choice.

Two things would change the answer. If **inheritance** arrives — a Worlds
concept ([15 §5](15-world.md)) where something above the session contributes
books — then `scope` acquires a real consumer and narrowing may follow naturally
from it. And if narrowing does ship, it needs a surface: the reason has to reach
the retrieval report as a skip reason, or it reintroduces exactly the silence
[P5.8]'s tester was built to end.

**B15. What should a new lorebook's `scope` be? — OPEN, and only *because* B14
is.** `newLorebook` sets `{ kind: 'global' }`, and the SillyTavern importer
falls back to it for a chat-scoped book. That is currently harmless — nothing
reads the field — and it is exactly the default that made P5.7's behaviour so
sharp. If `scope` ever regains a consumer, this default is the thing to decide
first rather than to inherit: *global* is the most permissive value in the union,
and a field nobody sets should not default to the widest answer. There is also
no surface for changing it; a book's scope is visible only in *As stored*.
*[04 §5](04-schemas.md), [03 §3.4](03-data-model.md)*

**B16. A closed portable union widened inside its version — OPEN, for the owner,
and due before the first release that exports native objects.** Three arms have
been added to closed unions in published schemas without a version bump:
`MediaRole`'s `background` in `actor/1` (P7.9), and the preset block source's
`{ of: 'state' }` (P14) and `{ of: 'setup' }` (the audit's T-c, 2026-10-01) in
`preset/0`. A build without an arm fails a file that uses it, **whole** — the
emitted schema is an `anyOf` of the known shapes — so [04 §2](04-schemas.md)'s
round-trip rule cannot hold for any closed portable union that grows. *Nothing
has met it yet*: alpha.1 to alpha.4 export and import no native object, so no
file this build writes reaches them. The next release is the first that does.
The choices: **open the unions** before then (an unknown role or source kept
and ignored, which is what `ActorRole` and `CallKind` already do); **bump the
version** at each widening, with a migration; or **accept** that an older build
refuses a newer file, and say so where exports are offered. *[04 §2–§3](04-schemas.md),
[21 §7](21-internal-contracts.md)*

---

## C. Mode and pipeline questions

**C1. Names. — RESOLVED: Messages, Scene, Freeform, Campaign — four modes, no
Adventure grouping.** Freeform ships at 1.0 and Campaign at 5.0
([work plan §0](workplan/01-work-plan.md)); Messages is specified and unscheduled
([24 §3.4](24-roadmap.md)).

**Amended once, and the amendment is the interesting half.** The original
resolution named a mode **Adventure** carrying two presets, *Adventure ·
Freeform* and *Adventure · Campaign*, on the reasoning that naming presets rather
than modes kept them sharing one contract. The contract argument was right and
is unaffected — every mode shares it — but the grouping was buying a name for a
pair, and the release re-cut put three releases between the two halves of that
pair. A name for a pair nobody chooses between is a name for nothing.
[06 §1](06-modes-and-turn-pipeline.md) carries the full reasoning.

*Chronicle* was the earlier name for Freeform and was replaced: it read as
Campaign's sibling by being another grand noun, and suggested *recording*
something that had already happened rather than playing it. Campaign works
because it is borrowed from the domain; the other preset needed the same,
naming the axis that actually separates them — how much structure the game
imposes. "Freeform RP" is established vocabulary for roleplay without dice or
stats, legible from both tabletop and RP culture. *Solo* was the other contender
and overclaims, since companions are allowed.

`freeform` is the **identifier**, which is the part that needed settling now:
ids travel inside Setup objects ([04 §7](04-schemas.md)), so changing one later
is a content migration rather than a rename. The identifier is unchanged by the
amendment; what moved is where it sits, from a preset id inside `mode.config` to
the `mode.id` itself. **That move was free only because P7 has not built either
mode** — there are no Setup objects carrying the old shape. *[06 §1]*

**C2. Mixed voice within a turn. — CONFIRMED: yes**, as a mode-preset
capability rather than a per-turn toggle. A narrator paragraph followed by
embodied dialogue as several `generate` steps feeding one message. It multiplies
latency and failure modes, which is why a preset declares it rather than a user
toggling it mid-session. *[06 §3]*

**C3. Multiple player-controlled party members. — CONFIRMED: yes**, and
permitted by default in Freeform and Campaign, where playing a pair is a normal
way to run a story.

**This also settles something not previously specified: impersonation.**
SillyTavern's *impersonate* — the model writes your next message as your persona
and you edit or accept it — is the same axis seen from the other end: a
`player`-controlled member being model-authored for one turn. Not a separate
feature, a per-turn control override. Scene mode is its home and it ships at
1.0. Three details make it feel right: the output is a **draft** that lands in
the input box and is not sent until the user sends it; it is a `generate` step
like any other, so it is recorded and re-rollable; and the call is
`voice: "embodied"` on the persona. *[06 §3.1, 06 §8]*

**C4. Turn job durability across restart. — CONFIRMED as proposed.** Turns are
not resumed; the partial turn is recorded as failed with its blocks intact, and
recovers through the ordinary retry affordance. *[09 §2]*

**C5. Steps that suspend for player input. — CONFIRMED: include it.**
Potentially powerful, and worth noting that Infinite Worlds — where the idea
comes from — uses it sparingly. So: build the mechanism, and do not over-invest
in its UX before there is evidence anyone reaches for it often. *[06 §6]*

**C6. One expression language for templates and rules. — PARTLY SETTLED: one
language, definitely. Which one stays open.**

The constraint is confirmed — templates and rule conditions share an evaluator,
so authors learn one thing and we sandbox one thing. The *choice* needs real
research and, more usefully, a closer understanding of the suite as actually
built: what rule conditions really need to express, and whether a template
language stretches to them comfortably. Deferring the pick costs nothing as long
as the single-language constraint holds. *[06 §5, 19]*

**C7. Authored rule vocabulary. — RE-SCOPED: deferred to 6.0, the authoring
tier** ([work plan §0.6](workplan/01-work-plan.md)).
The direction is unchanged — take Infinite Worlds' conditions and effects close
to wholesale ([02 §3](02-infinite-worlds.md)) — but the vocabulary, its evaluator
and its authoring surface leave 1.0 entirely
([work plan §0.4](workplan/01-work-plan.md)).

**Re-scoped three times, and the last move is the one that changed the shape.**
It went 1.0 → 2.0 → *with Campaign* → **a release behind Campaign**, and the
reason for the last step is that the coupling to Campaign was real but pointed
the other way. **Campaign does not consume authored rules; it produces the corpus
they are designed against.** Campaign's determinism is engine-computed mode code
([06 §4](06-modes-and-turn-pipeline.md)), not a predicate language — the three
seams that touch are `PlotHook.requires`/`onFire`, `Goal.completion`'s mechanical
arm, and the channel authoring surface, all additive and all about *authored*
content rather than about the mode
([work plan §0.4](workplan/01-work-plan.md)).

So it lands with the things that share its purpose rather than with the mode that
motivates it, in a release about authoring
([work plan §0.6](workplan/01-work-plan.md)). **The cost of the extra release is
named rather than assumed**: three minimal predicate dialects — lorebook
activation, `StepCondition`, and the hook filters — run separately for a release
longer, and unifying dialects that have each grown a convenience is harder than
unifying ones that have not ([work plan §0.3](workplan/01-work-plan.md)).

The argument that moved it: IW itself ran on triggers and tracked items for years
before arriving at PawScript, **and arrived at it with a corpus of real authored
worlds to design against.** We have none, and an expression language designed
against imagination is one nobody can use. Two stable schemas were also carrying
⚠ warnings for fields typed against something unwritten; deferring removed both
and left `PlotHook` and `Goal` honestly stable.

**What 1.0 owes it** ([06 §4.1](06-modes-and-turn-pipeline.md)): `owner` accepts
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
discouragement than a limit.** *[02 §3]*

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
that motivated them. **And the positive answer is recorded at
[03 §4.1](03-data-model.md) (2026-09-22)**: the three carriers, promotion out of
a running session, and — where a hooks-only artifact is wanted — a **Treatment
carrying only hooks**, on [10 §11.2c](10-ui-surfaces.md)'s *an entry export is a
lorebook* argument. So the decline stands and the need it was declining has
somewhere to go, which is the half this entry did not carry. *[03 §4.1, 06 §6.1]*

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
*[03 §4.1, 04 §5]*

**C7d. A character as a plot hook. — RESOLVED: an optional `introduces` block,
and the subject is not in `involves`.** A hook whose content is *bring this
person into the story*, optionally guided by written alternates in the spirit of
a card's greetings. Additive and optional, so the schema stays `/1` on the same
argument that let `requires` and `onFire` be removed.

The whole reason it needs a field rather than a naming convention is that it
needs **the opposite eligibility test**, and `involves` cannot hold both. That
inversion is exactly one of `involves`' three clauses: the subject must not be
introduced, but must still resolve, must not be dead or gone, and must be neither
the persona nor already in the party. Exempting it from the entire check would
fire an arrival for someone the session recorded dead — the severe failure the
check exists for, reintroduced by the feature meant to use it.

Two consequences that had to be designed rather than discovered. **Firing writes
no effect**, because `onFire` waits for the rule tier at 6.0 (C7) and
`se.presence` is model-proposed, so the
arrival is narrated and state follows the story — which means the narrator can
decline, so the firing is **provisional until the arrival is confirmed** or the
hook is silently and permanently lost. And **firing must supply the subject's
card and aliases for that turn**, because an actor outside the session cast
contributes neither, leaving the narrator describing a stranger and the mention
pass unable to link the arrival it just wrote.

Allowed on lorebook-carried hooks, over the objection that it makes a Lorebook
depend on an Actor for the first time: banning it would contradict C7c's own
argument, since *the stranger from the Flower Kingdom* is close to that case's
canonical form, and the dependency is soft — an unresolvable subject breaks the
hook, never the book. *[03 §4.1, 04 §6.1a]*

**C7e. Hook pacing and firing by hand. — RESOLVED: a dial that is a channel, and
two controls that are not two strengths of one.** [06 §6.1](06-modes-and-turn-pipeline.md)
had promised *"a cooldown after firing, a cadence rather than running every turn,
and an author-facing pacing treatment"* without saying what any of them were.

The dial is sparse / normal / aggressive / manual-only, and it is a **channel** —
session-scoped, user-only, never injected, initialised from a Treatment's
advisory value and overridable by a Setup. That buys mid-session change recorded
as an effect and correct branching with no new concept, and it is what a live
setting has to be here; a plain session field would not reconstruct at a node.
The numbers a level resolves to are engine code, while how a level *reads to a
model* is the prompt pack's, which is the half of C-series precedent that
actually transfers.

**The dial is not a step condition.** A committed hook needs the selector
consulted every turn and a sparse dial needs it consulted rarely, and one step
cannot declare both — nor can a condition see the channel state that would tell
it. So the step runs every turn and the dial gates the judgement call inside it,
which costs nothing because the mechanical filter was always free. The price is
that a held turn looks identical to a judged-none turn from outside, so the
selector writes its own line into the turn record.

**Commit** is the play control: must-fire now, exempt from cooldown and cadence,
but the engine still chooses the moment, with three turns of patience and a
**lapse rather than a firing** at the deadline — firing at the deadline would
deliver the twist at the moment already rejected three times. **Force-fire**
stays the authoring control and stays a real turn; a scratch preview was
considered and declined, because rewind is a pointer here and a second assembly
path is a poor trade for a slightly shorter audition loop. *[03 §4.1, 06 §6.1]*

**C8. Branch snapshot interval. — RESOLVED: tuneable, and generous during
alpha.** Snapshot often and keep many; they are derived and disposable
([07 §4](07-branching.md)), so the cost is disk and the benefit is that branch
materialisation stays fast while the real access patterns are still unknown.
Tighten once there is evidence, not before. *[07 §4]*

**C9. Unnamed-sibling retention.** [07 §6](07-branching.md) is now **decided**:
swipes and branches are one mechanism, so discarded swipes are permanently
recoverable — something none of the sources offers. What remains open is
presentation, not storage: a long session accumulates many unnamed siblings, and
the history view must not become a tree browser by default. Inline
sibling affordance on the node, full tree behind a deliberate action, prune
available. *[07 §6]*

**C10. Cross-branch merge.** Out of scope for 1.0. Recorded only to confirm
nothing in [07](07-branching.md) precludes it — merging is a question about
reconciling two effect sequences, which the log makes expressible even if it is
not easy. *[07 §9]*

**C11. Branch anchor within a multi-message turn. — RESOLVED** by the turn tree
in [07 §3](07-branching.md). A turn is one node however many messages it emits,
so branching from any of them is an operation on that node. The related
ambiguity also resolves cleanly rather than needing a convention: *redo* adds a
sibling, *continue differently* adds a child. Both are offered explicitly.

**C12. Confirmation before a narrative goal completion fires. — RESOLVED:
ask.** (2026-09-13, [P7.6](workplan/23-p7-implementation.md).) `se.goal`
declares `confirm: ['achieved']`, so the judge's completion lands on the turn
**recorded and unapplied**, the three offers do not raise, and the goal panel
asks. The original text stands below and the leaning in it was right; what
changed is that the leaning turned out to cost nothing to act on.

***The deferral was costing more than the decision.*** The leaning said the gate
*"wants real sessions to judge"* — true of the **prompt** the question imagined,
and the question imagined one because it was written before
`ChannelDefinition.confirm` existed. That field shipped at
[P7.2](workplan/23-p7-implementation.md) for terminal statuses, with a docstring
naming this as its second consumer and warning that *"building one status-shaped
now is the reinvention this phase keeps catching itself about"*. So by P7.6 the
mechanism was built, unused, and pointing here — and *ask* was three words in a
channel declaration rather than a prompt at the most dramatically loaded moment
in the session. **A confirmation is not a call.** That is the whole correction:
the cost this question priced was a second model round trip, and the thing built
is a refusal a person rules on at their own pace, on a surface already there.

*What real sessions can still judge* is the judge's **accuracy**, and the
asymmetry the question turns on does not depend on it: a false completion ends a
story that did not earn it at any hit rate short of perfect. If sessions show
the judge is right nearly always, the remedy is to drop `confirm` from the
declaration — one line, and a mode may already declare its own goal channel
without it. The decision is reversible in the direction the evidence could
point, which is the shape a question *"wanting real sessions"* should be settled
in rather than left open.

*Also settled in passing: the runner's fallback attribution.* With no call to
point at, a completion stamps `{ kind: 'step' }` rather than `{ kind: 'engine' }`
— `confirm` is checked for `model` and `step` only, so the engine stamp would
have been a bypass of this gate on the one path it applied to.

**C12 as written (kept):** Goals with
`completion: { kind: "narrative" }` are judged by an evaluation step
([06 §7.3.3](06-modes-and-turn-pipeline.md)), and the two error directions are
not symmetric: a missed completion is an annoyance the player resolves manually,
a false one ends the story on a turn that did not earn it. A confirmation step
is cheap insurance against the worse error and costs a prompt at the most
dramatically loaded moment in the session. Leaning toward asking, on the
grounds that a mis-fired ending is unrecoverable in a way nothing else here is —
but it wants real sessions to judge. Under-firing plus always-available manual
completion is the position regardless. *[06 §7.3.3]*

**C13. What the randomizers ask of the pipeline. — OPEN, three parts, and the
first two get expensive after P7.** [23](23-randomizers.md) outlines a plot
randomizer (an evaluate-before-narrate step that draws an outcome from
model-proposed candidates) and an appearance randomizer (a field assist that
draws descriptors from a palette before the model writes). Neither needs a new
mechanism; each exposes a gap in an existing one. *(a)* A step's judgement call
is re-run on rewrite, so a draw made over its output cannot replay — the
rendition moment's *written once, replayed* rule ([06 §10.3]) wants to become a
step-level contract ([23 §5.1]). *(b)* Draws outside a turn have nowhere to be
recorded, because the assist path's record is provenance and provenance has no
tape ([23 §5.2]) — a portable-schema addition, so it wants doing once. *(c)* A
step's block is one of the two sources no preset slot can position, and an
outcome verdict that lands at the top of the prompt is the one most likely to
be softened ([23 §5.3]). Leaning: do *(a)* with P7's async-draw conversion,
since the randomizer is the first production step that draws; do *(b)* whenever
provenance is next touched; decide *(c)* with the dice extension, which needs
the same slot. *[23 §5]*

***(a) has its first production caller, and (c) turned out to be two questions***
(2026-09-13, [P7.5](workplan/23-p7-implementation.md) stage three). The plot-hook
selector is a judgement call followed by a draw across `introduces.entrances`,
which is (a)'s shape exactly — and it is built on `weightedPick` rather than
`pick` for precisely the reason above: the hook the draw sits under may be a
different hook on a rewrite, `pick` records the list's *length* and would hand
back a position into different content, and `weightedPick` records the winner's
**id** and refuses the replay when that winner is no longer a candidate. *So the
mechanism the leaning asked for is in production; what stays open is the
step-level **contract** — nothing obliges a step to use the id-keyed draw.*

*(c) is unchanged as written and did not block the hook.* A step's block still
cannot be positioned by a slot, and an outcome verdict still has nowhere of its
own. But a fired hook is **guidance**, and [06 §5.1](06-modes-and-turn-pipeline.md)'s
slot takes *several producers* — so the selector hands its words to the runner
and the collector emits them at the slot the preset positioned, under the
`producer: 'step'` arm the record already had. Nothing points a slot at a step.
The dice extension's verdict block is the case that still needs (c) answered.

**C14. Does guidance belong on the turn record? — OPEN.** [06 §5.1] said a
rewrite replays the guidance of the turn it redoes, and the build does not:
`Turn` ([03 §8]) has no field for it, the record keeps it only as an assembled
block with its wrapper already applied, and the client's redo resends the
turn's words and not its instruction. The sentence is struck, and the gap is
recorded here rather than closed because it is two questions dressed as one.
*(a)* Should a plain redo carry the original's instruction at all? It was
one-shot, written for an attempt now being discarded, and half the time the
redo is *because* of what it produced. *(b)* If so, where does the text live —
a `guidance` field on `Turn`, which is free-to-move tier and cheap, or a read
back from the block table, which is lossy once a wrapper has touched it. Decide
together with [10 §10]'s one-click refill, which is the same question from the
composer's side: guidance outliving the turn it was typed for. The guided redo
([07 §7]) does not wait on this — its instruction is new, and its record says
what was asked. *[06 §5.1, 10 §10, 07 §7]*

**C15. Seven of the eight model roles cannot be reached. — OPEN, found by
building something that asked for one, and SHARPENED by E15** (2026-09-13,
[P7.5](workplan/23-p7-implementation.md); sharpened 2026-09-26). `MODEL_ROLES`
has eight arms —
`prose`, `fast`, `reasoning`, `vision`, `image`, `video`, `speech`, `embedding` —
and [19 §5.1](19-tech-stack.md) orders five resolution layers over them. **Every
one of those layers is a binding for the role asked for**: `resolveRole` has no
cross-role fallback, so a role nothing bound resolves `unbound` and the step
fails. ~~And nothing in the build binds anything but `prose`: no install
default, no wizard, no route that suggests one.~~ **Corrected 2026-09-26: there
is a route that suggests one.** The first-run offer
(`POST /api/admin/bindings/defaults`, [P2B](workplan/10-p2b-provider-configuration.md)
stage P2B.4) spreads a good model and a cheap one across the five roles
[19 §5.1](19-tech-stack.md)'s hi/lo table names, so an install whose admin
accepted it has `fast`, `reasoning`, `vision` and `embedding` bound as well —
and `vision` bound to the cheap *text* model. The premise holds for an install
that declined the offer or wrote its bindings by hand. So a step declaring any
other role fails on such an install, every turn, and the hook selector was the
first thing to declare one and discover it.

*The workaround is real and is what the selector does*: ask for `prose` and let
an operator point the step at something smaller through `stepRoles`, which is
[19 §5.1]'s fourth layer and exactly the *"a cheap model for one noisy step"*
case. What that costs is that the roles vocabulary describes an intent nothing
can act on, and the cost grows with every step that would honestly want a
different role — a summariser, a mention-resolver, an image prompt.

Three candidate answers, none obviously right. *(a)* `resolveRole` falls back to
`prose` for any unbound role, which makes every role reachable at once and
quietly means *role* is advisory. *(b)* Binding setup grows a per-role UI, which
is honest and is a lot of surface for an install with one endpoint. *(c)* A role
declares its own fallback chain (`fast → prose`, `reasoning → prose`,
`vision → ∅`), which is more mechanism but is the only one of the three that can
say *there is no sensible substitute for `vision`*. **Decide with the first step
that genuinely cannot use `prose`**, which is an image or vision step rather than
a cheaper text one. *[19 §5.1, 06 §6]*

**SHARPENED 2026-09-26 by E15, which is that step.** Describing a picture the
player attached cannot use a text model at all, and its needs add a fourth
candidate. *(d)* **A capability-gated chain**: `vision` resolves to the first
layer whose model — after the actor hint — is one its connection lists as
seeing images; failing that, the same over `prose`; failing that, to nothing,
which is a legal outcome for that step rather than a failure, because the
player's caption carries the picture. *(d)* is *(c)* with the chain keyed on
what the model can do instead of on which role was bound, and it is the only
option that survives the correction above: every install that took the
first-run offer already has `vision → lo` written into its bindings, and under
*(a)*, *(b)* or a plain *(c)* that row would send pictures to a text model.
Under *(d)* it is inert rather than wrong. **A discrepancy to settle, not a
side to take here:** [19 §5.1](19-tech-stack.md) and `ROLE_TIER_DEFAULTS` put
`vision` on *lo* alongside `fast` and `embedding`, while its own reason for
leaving `image`, `video` and `speech` unset — *no sensible text-model fallback* —
is true of `vision` too. It is harmless only because nothing calls `vision`, and
nothing should until this is decided.

**A stopgap for one caller, 2026-09-27.** Field assist asks for `prose` for this
entry's reason, where [10 §11.4](10-ui-surfaces.md) wants `fast`. Rather than wait,
each account may now choose which of `prose`, `fast` and `reasoning` the assist
asks for (`users/<handle>/task-roles.json`, set beside the bindings table),
defaulting to `prose`. It decides nothing here — it moves the choice to the
person who knows whether their `fast` model is bound — and it is the file to
retire when this is decided.

**C16. A mode cannot declare a channel the engine computes for it. — OPEN,
found by writing the second mode** (2026-09-13,
[P7.9](workplan/23-p7-implementation.md)). [06 §4] lets a mode declare a channel
with any `update` policy, and one of the three is `engine-computed`. **Two of
them a mode can actually use and the third it cannot**, which nothing noticed
while one mode declared one channel:

- `model-proposed` — a model proposes through a step's effects. Works.
- `user-only` — a person writes through the channel route. Works; the two dials
  are the shipped case.
- `engine-computed` — *nothing writes it.* `acceptEffect` refuses such a channel
  for a `step` proposal, deliberately and correctly ([06 §8.1]'s whole posture),
  so the mode cannot write its own. And the engine writes exactly two channels
  after the step loop, **naming both by id in `turns/runner.ts`**: the clock and
  a judged goal. A mode-declared one would need the engine to know what that
  mode's channel means, which is [06 §2]'s `switch (mode)` wearing different
  clothes.

*Scene's `se.clock` is `engine-computed` and is written*, which is what made the
gap invisible: it is written by a line of engine code that names `SE_CLOCK`, and
that line is older than the declaration. **A third-party mode gets no such
line.** So the policy is reachable for a built-in whose channel the engine
already knew about, and unreachable for exactly the author [06 §9] is the test
for.

The concrete instance: Freeform wanted a channel holding *what kind of thing the
last turn was* — [06 §1]'s *world-state classification* in its smallest true form
— computed from the submission's validated input kind, which is a fact the
**engine** holds. It was declared, found unwritable, and withdrawn rather than
shipped null; `mode.test.ts` asserts the mode declares no `engine-computed`
channel so the placeholder cannot come back before a writer does.

Three candidate answers. *(a)* **A step may write its own mode's
`engine-computed` channels** — narrow, checkable against `owner`, and it weakens
a rule whose whole value is that it is absolute. *(b)* **A fourth policy**,
`step-computed`: honest about what is happening, and a fourth arm on a
three-arm union that four stages have found sufficient. *(c)* **A declared
*source*** — the mode names a turn fact (`input.kind`, `turn.status`) and the
engine writes it after the loop with no mode-specific code, which is declarative
in the way the rest of the contract is and is the only one of the three that
scales past one field. **Decide with the first mode that cannot proceed without
it**; Freeform proceeded. *[06 §4, 06 §4.1, 06 §9]*

*Still open at [P7.12], and deliberately not forced by it.* §7.2's *"sprites,
backgrounds and expression selection are steps writing to channels"* reads like
it settles this — `se.backdrop` is `engine-computed` and a step cannot write it
— and it does not, because the three things that sentence names have **three
different writers**: a background's pointer is the engine's and P9 writes it
through the route the hook firing and the goal achievement already take; an
expression and a location are judgements about prose, so `model-proposed`, which
admits a step; text-only is a person's setting, so `user-only`. Scene grew up
without needing an answer here, which is the outcome this question wants.

**C17. A mode cannot keep its own step out of a turn. — OPEN, found by giving a
mode a step worth skipping** (2026-09-13,
[P7.12](workplan/23-p7-implementation.md)). The engine keeps *its* conditional
steps out of the plan by not appending them, and `turns/runner.ts` argues for it
at length where the suggester is built: *"a suggestion step nobody asked for has
nothing to report… an `ok` row contributing nothing on every turn of every
session in the build, which is a step outcome that means this feature exists
rather than anything about the turn."* **A mode has no equivalent.** `planFor`
zips every step in `ModeDefinition.steps`, so a declared step runs or reports
itself skipped, and there is no third state.

*The concrete instance is Scene's stager.* `se.scene.stage` costs a model call
per turn and is off by default, so on nearly every Scene session it reads one
boolean and returns — and eight assertions in `runner.test.ts` now carry its id
while testing something else, which is the cost made visible.

**`StepCondition` is where the answer goes and it is closed at three arms on
purpose** — its own docstring refuses a fourth for an `always` that would be
less than this, and refuses an expression language in as many words. So the
tempting fix is the one to resist. What is more interesting is that **two of the
three arms have no producer at all**: `ConditionContext.stages` is *"stage flags
the mode has raised"* and has been an empty set since P2.6 because a mode has no
way to raise one, and `armed` is the same for the user's side. The arm this
wants may already exist.

Three candidate answers. *(a)* **Build the `stage` arm's producer** — give a mode
a declarative way to raise a flag, which is the only one that adds no vocabulary.
*(b)* **A fourth arm keyed on a channel** — `{ when: 'channel', channelId,
equals }`, honest and small, and the first step onto the expression-language
slope the type exists to refuse. *(c)* **Leave it**, and accept a dead `ok` row
as what declaring a step costs — defensible while one mode has one such step and
worse with every mode that gets another. **Decide with the second instance**, or
when a phase is measuring turn cost, since (c)'s price is paid in the record
rather than in tokens. *[06 §6, 22 §4.1]*

*`armed` has a producer since 2026-09-29*
([P14.5b](workplan/31-p14-scene-and-session-import.md)): a submission's
`push` (Push story) puts `push` in the turn's armed set, and the engine's
director step, `se.scene.direct`, is `{ when: 'armed', flag: 'push' }`. The
runner still plans that step only on a pushed turn (the suggester's rule) and
evaluates its condition as the belt, so the arm is exercised by a real flag
rather than only by `steps.test.ts`. **It does not answer this question**: the
flag is a person's, per turn, and what C17 asks for is a mode keeping its own
step out on a *session* setting. The same stage adds the **third** instance of
the dead row — Scene's secret-plot pass (`se.scene.plot`, `pre`), off by
default, reading one switch and returning — beside the stager and the trackers,
and `runner.test.ts` and `recovery.test.ts` now read the narrator's outcome by
id rather than by position because a `pre` step moved it off `steps[0]`. (a)
is still the answer that adds no vocabulary; the count is now three steps, and
"decide with the second instance" is past due.

*Five since [P14.5c](workplan/31-p14-scene-and-session-import.md)*: the editor
(`se.scene.edit`, `post`, off until style or continuity is switched on) and the
echo chamber (`se.scene.echo`, `post`, off) are two more, so every Scene turn now
carries five `ok` rows that read a switch and return. The editor's switches are
also read by the engine — `StepDefinition.revises.enabledBy`, for *hold for
rewrite*, which has to know before the prose streams whether an edit is coming —
which is (a)'s shape arriving by the side door: a mode naming, declaratively,
the channels that decide whether its step does anything. Generalising that
field to every step (skip the step, write no row, when none of its switches is
on) would close this question with no new arm; it was not done here because
the skip changes what the record says about every existing turn shape, and
that is a decision for this question rather than for a stage.

**C18. Three `post` steps make three calls over the same prose. — OPEN, noted
rather than solved** (2026-09-13, [P7.12](workplan/23-p7-implementation.md)). The
goal judge asks *was the goal met*, the suggester asks *what could they do next*,
and the stager asks *what face and what place* — three structured calls, same
turn, same passage, three round trips on somebody's own GPU. One call with a
three-part schema would answer all of it.

*Not done here, and the reason is the record rather than the difficulty.* Each
effect and each turn field currently names the call it came from, and one
`callId` behind three unrelated judgements makes *why is this here* answerable
only as *because of the combined call* — which is a real loss in a build whose
whole posture is that a reader can ask that question. It also couples three
independent gates: today any of the three can be off, and a merged call either
asks all three or needs the schema assembled per turn from whichever are on,
which is most of the saving gone.

**The right time is when something is measuring turn cost**, and the right
evidence is a measurement rather than an argument. Until then the three stay
three. *[06 §6, 06 §7.3]*

---

## D. Deployment questions

**D0. Config reload tiers. — CONFIRMED.** Every config key annotated
`live` / `reconnect` / `restart`, so the restart-required notice is derived
rather than hand-maintained. *[09 §6]*

**D0b. Packaging targets. — CONFIRMED, and promoted from optional to required.**
The canonical automated build path delivers **six artifacts**: OCI image,
tarball, `.deb`, AUR, Windows service installer, Homebrew formula. All six are
required rather than as-capacity-allows, which rewrites the earlier tiering — the
tiers now describe order of value, not optionality. Declined stays declined:
Flatpak, AppImage, Snap, `.rpm`, LXC.

**Re-cut on the milestone, not on the list** ([work plan §0.5](workplan/01-work-plan.md)): the
OCI image and the tarball are the **beta** requirement; the other four join the
in-app update **check** as **1.0 release** requirements. Tiers 1 and 2 are enough
to have users, and four more build chains before there are any is work that reads
as progress. *[09 §5.4, releases §0]*

**The first of the six is built early, and it does not change this list**
([P6A](workplan/19-p6a-alpha-1.md)). P6A produces the OCI image, its compose file
and the unraid template as a **private** artifact — undistributed, so no
milestone here moves and the beta requirement is unchanged. The template is not a
seventh artifact: [09 §5.4](09-server-multiuser-deployment.md) calls it a thin
wrapper over Tier 1, and it is scheduled with the image.

**D1. Tailscale. — RESOLVED: Level 1 yes, Level 2 maybe, Level 3 no. Feature
list, High** ([24 §3.1](24-roadmap.md)). *Post-2.0* was the old phrasing and it
stopped meaning anything when the release line grew past 2.0; what it meant was
**not in a committed version**, which is what the feature list is for. An embedded `tsnet` node is a real component for a convenience the
simpler levels mostly deliver. Not hard, but a side project rather than anything
on the path. The only thing to do now is keep the auth layer shaped so Level 2 is
a provider rather than a special case, which costs nothing. *[09 §5.2]*

**D2. Auto-provisioning accounts. — RESOLVED: no. All accounts manually
provisioned; the feature is on the list at Low** ([24 §3.2](24-roadmap.md)),
not in any committed version. No self-registration, no invite
links, no identity-provider provisioning. Not philosophical — simpler, and
matched to reality, since most installs are one user or a handful and adding
someone is a conversation followed by typing a name. Revisit only if Tailscale
Level 2 or 3 ever lands.

**This also records a decision rule worth having** ([09 §4.2.2](09-server-multiuser-deployment.md)):
StoryEngine is not targeting hosted-service deployment, which resolves a family
of future arguments — self-registration, tenant isolation, per-object ACLs, abuse
handling. If it were hosted the answer would be **VPS, not shared tenancy**, and
if multi-tenancy is ever genuinely wanted the answer is **fork before
complicating**: a sibling project sharing the engine, rather than taxing every
home user with complexity for a deployment they will never run. *[09 §4.2]*

**D3. File access. — RESOLVED: deprioritised, experimental at best, roadmap
rather than 1.0.** The feature is still wanted and the reasoning still stands;
what changed is its position. Import and export UIs exist for a reason, in-app
library management matters more, and a file-management UI is a disproportionate
amount of surface and risk for something most people will never open.

**Two things survive and still land at 1.0:** the capability field, and the
single audited path-resolution helper — needed by every filesystem-touching route
regardless, and having one from the start is the difference between a security
property and a hope. **Hand-editing on disk keeps working**, because that was
never about the UI: [10 §4.1](10-ui-surfaces.md)'s forcing function is unchanged.
*[10 §4, 24 §3]*

**D4. Mobile layout, and the stance on native clients. — RESOLVED.**
Responsive-and-usable at 1.0; a distinct mobile-optimised layout stays later.

**The "no apps ever" position is softened, with a bar.** Notification-driven
modes — Messages especially — are the kind of thing a native client genuinely
serves better, so a blanket never is the wrong shape. Instead: *not a priority
and not ours to build; pitch it if you want to contribute one, but nothing ships
that is not a feature-complete client with a real advantage over the web app.*
A partial native client is worse than none — it splits the surface, halves the
testing, and teaches people that some features live in one place and some in the
other. *[10 §1, 24 §3]*

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
break something. [07 §5](07-branching.md) requires summaries to be
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
This is the property [07 §5](07-branching.md) promised, and it is only available
if the chain is built this way from the start.

**Summaries are derived and disposable**, like the index ([03 §5.1](03-data-model.md)).
Full history is always on disk, so a bad summary is regenerable — nuke and
rebuild, at any point, with a better model or a better prompt. Summary quality is
not a one-way door, which is what makes shipping a simple rolling summary early a
safe bet rather than a commitment.

**Chapters, when they come, are primarily a *reading* feature.** That is a better
justification than memory structure, and it explains why manual is right: a human
knows where a chapter ended better than a heuristic does, and the payoff is a
readable [10 §12](10-ui-surfaces.md) view with real divisions. Chunking summaries
along chapter boundaries is a secondary benefit that falls out. An agent
proposing *"this looks like a chapter break"* is the right amount of automation —
advice, accepted or ignored.

### E2. Embeddings and vector search — later, and aimed at memory

**Opinionated: lower value than it looks for lorebooks, genuinely useful for
memory, and not in a committed version either way — feature list, Low
([24 §3.2](24-roadmap.md)).**

Keyword activation plus the budgeter covers most real lorebook use — the whole
SillyTavern ecosystem runs on it. Semantic activation adds a provider
dependency, an index to maintain, re-embedding on every edit, a threshold to
tune, and a class of confusion keywords do not have: **"cosine 0.71" is not a
reason a human can act on.** The turn record's plain-language inclusion reasons
([03 §8](03-data-model.md)) are worth more than the extra recall.

Where it *does* earn its keep is **cross-session memory**
([08](08-cross-session-memory.md)): memories are numerous, keyword-poor, and
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
  recipe is bytes; the asset is megabytes. **Which requires that re-creation make
  no model call**: one fragment of an image prompt is written by a model
  ([06 §10.3](06-modes-and-turn-pipeline.md)), and a fragment regenerated on
  re-creation would make *"the same rendition"* a thing this policy could not
  actually promise. It is stored with the rest of the recipe and replayed.
- **Eviction becomes safe.** "Generated images will fill the disk" gets an answer
  that loses nothing irreplaceable — evict pixels, keep recipes, regenerate on
  demand.
- **Regenerations are comparable.** Two renditions of the same turn carry their
  seeds, so *why did this one come out different?* is answerable.

It also means an eviction policy is a later decision rather than a now one,
because adopting one can never cost history.

**The backdrop is governed by all of this and appears in none of it**, which is
why it is worth a paragraph rather than being left implied. This entry is titled
*renditions in the transcript*, and a backdrop
([06 §10.1a](06-modes-and-turn-pipeline.md)) is not in the transcript — it is
behind it. The two policies above apply to it unchanged: regenerating a backdrop
**adds** a sibling and selects it rather than overwriting the one you liked, and
its recipe is permanent while its pixels are not.

**One thing does differ, and it is not a policy exception.** Which backdrop is
*currently showing* is channel state rather than a property of any rendition,
because a backdrop persists across turns and only channel state describes that
lifetime. So the accumulate-and-select rule lands in two places instead of one:
the siblings are renditions, the selection is an effect. That is the same
division [07 §2](07-branching.md) already relies on, and it means rewinding past
a location change restores the earlier backdrop with nothing written to make it
happen.

### E4. Session import from other platforms — conditional on an interchange format

**Not a commitment, and no longer a flat refusal. The condition is the shape,
not the appetite.**

The original objection stands and is unchanged: the lift is large and the promise
is hard to keep, because chat formats move under you, every source has years of
edge cases, and a **half-working importer generates more support burden than no
importer at all**. Better none than one that rots.

**What changed is that the objection is an argument against a particular
shape.** Writing a converter per source is what rots — each one tracks somebody
else's product, and the maintenance is unbounded because the number of sources
is. The shape that does not rot is a **session interchange format**: one
documented target that we own and version, with conversion into it left to
whoever cares about a given source. That inverts the maintenance — we maintain
one format, not N importers — and it is the same posture
[00 §4](00-stance.md) already takes on refusing SillyTavern parity while
accepting SillyTavern *content*.

**Session export at 1.0 is where such a format would start** (B12), which is why
this is worth writing down now rather than when somebody asks. Export is not the
format — it is a serialisation of our own record — but a format designed with
import in mind and a format designed without it are different documents, and
only one of them can be written at P11.

**Still not a commitment.** Nothing here schedules an importer, and if nobody
ever writes one that is a fine outcome. What this rules out is answering the
question twice.

*Surveyed 2026-09-01, in [18](18-session-import.md).* **The condition above is
now checkable**, which it was not while it named a shape nobody had costed.
Three things from that survey are worth having here rather than only there.
**Aventuras already ships this document's proposed shape** — `.avt`, one
versioned single-file export at v1.8.0, grown by addition alone — so the
argument that the interchange form is the one that does not rot has a working
instance rather than only a rationale. **The lift is where this section says and
not where it reads**: Aventuras' own SillyTavern chat importer is 116 lines,
because it keeps the prose and drops the swipes, the timestamps and every link
to a card. That is the half-working importer named above, and its smallness is
the argument, not a counter to it. And **the ordering is forced rather than
preferred**: until session export writes the format, an importer for it is a
reader for a format with no writer, which
[P4 §1.3](workplan/16-p4-implementation.md) struck `.seactor` for being and
[work plan §2.2](workplan/01-work-plan.md) forbids.

[18 §3](18-session-import.md) is the part addressed to P11 — four things the
export format has to do if it is to be the target E4 describes, rather than a
serialisation of our own records that happens to be written down.

*The shape a source converter takes, now that the format exists — 2026-09-26,
for [P13](workplan/30-p13-aventuras-import.md).* [P11.10](workplan/28-p11-implementation.md)
wrote the format and its one reader, `importSession`, and the condition above is
met. **What E4 protects is not "no per-source code"; it is "one reader".** A
converter for one source that *emits* `storyengine.session-export/1` and hands it
to `importSession` keeps that: the format stays the only target, the reader stays
the only thing that writes a session from outside, and if the source moves and
nobody follows, the converter is deleted and nothing else changes. A per-source
*importer* — one that writes sessions itself — fails that test, and is still what
this entry declines. [P12.8](workplan/29-p12-implementation.md)'s
`backup/import.ts` is already the first producer. Aventuras' stories are headed
as P13's Part 2 on this reading and **not scheduled**, so *"still not a
commitment"* above is unchanged.

*Revisited 2026-09-28, at [18 §7](18-session-import.md).* The condition is met:
P11.10 shipped the format with a writer and a reader, so a converter aimed at it
is no longer a reader for a format with no writer. Still not a commitment — §7
prices what is left and proposes an order, and schedules nothing.

***Scheduled for Aventuras, 2026-09-29*** — by the person, for
[P13](workplan/30-p13-aventuras-import.md)'s Part 2
([§0.3](workplan/30-p13-aventuras-import.md#03-how-this-sits-with-25-e4)). This
is a commitment for **one producer**, Aventuras' stories, and not for session
import from other platforms in general: the paragraphs above stand for every
other source, and the producer keeps the *one reader* shape this entry
protects — deleting it deletes nothing else.

*And a second, 2026-09-30, at the merge of the two.* The paragraph above was
written on P13's branch while [P14](workplan/31-p14-scene-and-session-import.md)
— SillyTavern and Marinara roleplay chats into Scene — was scheduled and built
on another, and merged to `main` first. So *"one producer … not for session
import from other platforms in general"* stopped being true before it reached
`main`: SillyTavern's and Marinara's chats are producers too
(`import/chat-sessions.ts`), in the same shape — a pure converter that emits the
format and hands it to `importSession`. What the paragraph protects holds for all
three: one reader, and a converter that can be deleted alone. The one thing P14
added to the reader is an `extend` arm, asked for by its doors and never
inferred, because a chat goes on growing where a finished export does not
([P14 §2.7](workplan/31-p14-scene-and-session-import.md#27-sync-a-re-import-extends-the-session-it-came-from)).

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

### E6. Backup and restore — ~~a command, not a feature~~ a command **and** a feature

***Amended 2026-09-22 at [P12](workplan/29-p12-implementation.md), which is the
one place in this corpus where an* Opinionated *verdict has been reversed.***
The original is kept below in full rather than rewritten, because a position
worth overturning is worth being able to read.

**What stands.** `rsync` is still a legitimate strategy and
[docs/deploy.md](../deploy.md) still documents it. The archive still excludes
the index, and that is still the clause that makes it a restore rather than a
copy. And the sentence this section is best for —
***an untested restore is not a backup*** — is the bar P12 is held to rather
than something it got past.

**What was wrong, and it was one word: *outside*.** The quiesce paragraph below
reads *"there is no write-lock to take from outside the process, and inventing
one would be the subsystem E6 forbids."* Every word of that is about a process
on the outside, and it was read as a fact about backups generally. From the
**inside**: `state/state.sqlite` is copied with `VACUUM INTO`, a
transactionally consistent snapshot of a database being written to; library
objects, `accounts.json`, `prefs.json` and the bindings go through
`storage/atomic.ts`'s temp-and-rename, so a reader sees the old file or the new
one; and a turn segment is append-only, so a prefix is whole turns plus possibly
a partial last line that `sessions/segments.ts` already drops. **The in-process
backup is strictly more consistent than the command**, not less.

**And three things this section never considered.**

*Its caller had a shell.* [docs/deploy.md](../deploy.md)'s two supported paths
are an unraid template and a compose file, and
[09 §5.1](09-server-multiuser-deployment.md) designs for a household where the
operator and the user are the same person. **A backup command nobody can reach
is not a backup story**, and the gap did not show at [P11.11](workplan/28-p11-implementation.md)
because the person writing the script had a terminal open.

*Half of it was never this section's subject.* E6 reasons about the **install**.
*Export my account* is portability, in the family of session export
(B12 above) and library
download ([10 §5.0a](10-ui-surfaces.md)) — and it is how
[the fourth commitment](README.md) (*"drag a folder out of the storage directory
and you have exported it"*) is kept for somebody who cannot reach the storage
directory.

*And import is not restore.* Bringing an archive's **content** into a running
install is the import engine with one more source arm —
[P4 §1.3](workplan/16-p4-implementation.md) built `FileSource` so that a new
transport costs a class rather than a second engine. Routing it anywhere else
would be the duplication that seam exists to prevent.

*And restore stayed a handoff rather than becoming one.* A running server cannot
replace its own data directory in place — it holds open handles on the files the
archive would overwrite, and the session key it would replace is the one
validating the request asking for it. So `POST /api/admin/restore` checks every
precondition **while the process is still answering** (a refusal after it has
exited is one nobody can read), writes a marker, and drains; the next boot
~~unpacks to a sibling, renames the live directory aside and renames the new one
in~~ unpacks inside the data directory and swaps the install's entries out and
the archive's in, one at a time behind a journal (corrected 2026-09-27: the
sibling needed a writable parent, which no shipped deployment has; see
[P12.12](workplan/29-p12-implementation.md)). ***The install that moved aside is
kept and never deleted***, which is
`removed/`'s promise and the one property that covers *the restore worked and
was the wrong archive* — it is the closest thing this section's own sentence,
*an untested restore is not a backup*, has to an insurance policy.

*What this section refused and would still refuse* is a restore that quietly
reorganises itself around being a subsystem: there is no restore queue, no
snapshot chain, no second format, and the marker is a JSON file that the swap
does not have to delete, because it lives in the directory being replaced.

**What P12 does not build**, so that *do not build a subsystem* still binds
something: no retention policy, no job queue, no second archive format, and no
account created from an archive. The scheduler is one `setInterval` on
`startTrashSweep`'s shape, and **its state is the archives themselves** — there
is no last-run row, which is what makes *the machine was off for three days*
work and what keeps deleting a file by hand a non-event.

*Two defects in what P11.11 shipped were found while reading it and are fixed at
`aaf7345`*: the index exclusion was a filename test at the data root and the
index is a directory down, so **it never once fired**; and `tarHeader` cut any
name past a hundred bytes, which collapsed a lorebook's version payloads onto
one truncated name. [P12 §0.5](workplan/29-p12-implementation.md) has both.

---

*The original, unedited:*

**Opinionated: the design already did most of this, so do not build a
subsystem.**

Files on disk means `rsync` is a legitimate backup strategy and should be
documented as one. What is worth building is small: a command that briefly
quiesces writes, archives the data directory **excluding the index**, and a
restore that puts it back and rebuilds. The index being derived
([03 §5.1](03-data-model.md)) is what makes both trivial.

**The part that actually matters is testing restore.** An untested restore is not
a backup, and this belongs in CI beside the upgrade test
([work plan §8](workplan/01-work-plan.md)): populate a data directory, back it up, restore into a
clean install, assert the library and sessions are intact.

**Scheduled: 1.0, at P11** ([work plan §0.5](workplan/01-work-plan.md)). This was
on the roadmap and moved for the same reason session export did — shipping a
self-hosted data product with no tested restore is a gap rather than a deferral,
and the command is small enough that its absence was never about cost.

### E7. Error and rate-limit handling — a taxonomy, then a policy

**Opinionated: under-specified, and more load-bearing than it looks.** Pieces
exist — step `failure` modes, the bounded re-ask for malformed structured output
([00 §2.3](00-stance.md)), connectivity detection
([09 §6.5](09-server-multiuser-deployment.md)) — but nothing classifies failures,
and the class is what should determine the response.

| Class | Examples | Response |
|---|---|---|
| **Transient** | 429, 5xx, timeout, connection reset | Bounded retry with backoff, **visible in progress events** as "retrying (2/3)" rather than a spinner |
| **Retryable with a change** | Context overflow, malformed structured output, prompt cap exceeded | Shrink and resend, or re-ask — mechanisms that already exist ([19 §5.3](19-tech-stack.md)) |
| **Terminal** | Invalid credential, model not found, content refusal | Fail the step, surface as **actionable** ([09 §3.5](09-server-multiuser-deployment.md)) |

Two things worth calling out:

- **Shared connections make rate limits a design concern rather than an
  annoyance.** With one system connection serving a household
  ([09 §4.5](09-server-multiuser-deployment.md)), several users hit provider
  limits one user never would. **Queue per connection with a concurrency cap**
  rather than hammering and failing — a turn that waits beats a turn that errors,
  and the progress stream makes waiting legible.
- **Content refusal deserves its own treatment.** It is terminal for that call
  but not for the user's intent, so it should offer *"try a different model"*
  against another role binding rather than surfacing a raw provider error. It is
  among the most common real failures in this domain and the one most likely to
  be met with a shrug if handled generically.

**Pictures are asked once, and a person retries — answered 2026-10-03.** The
table's *Transient* row has a picture-shaped exception, and it was made by
accident before it was made on purpose. `renderImage` was written without the
`maxRetries: 0` every chat call carries, so the AI SDK retried a 429 or a 5xx
twice behind it — requests no rendition record counted — and the last failure
arrived as a status-less `RetryError` classed `terminal`, a rate limit reported
as *do not try again*. `0d6152e` turned the hidden pair off: a picture is now
sent once, a 429 or 5xx arrives classed `retryable`, and the failed placeholder's
**Try again** ([06 §10.2](06-modes-and-turn-pipeline.md)) is the only retry an
*illustration* has. That trade is real — an illustration that the hidden pair
would have ridden out now needs a click — and it was put to the owner, who
**accepted it for now**, as *"something to play with later"*, with one
condition: ***if pictures ever get automatic retries, the policy must be
configurable***. So it will not arrive as a ladder hard-coded around the call —
`renditions/worker.ts` says at the call why it is not a loop there, since there
is nowhere honest to count a retry — but as a config key, a five-place edit made
then ([21 §4](21-internal-contracts.md)), most naturally beside the
per-connection queue above, where a retry is *visible in progress events* and
has somewhere to be counted. The chat calls' ladder is untouched by this answer.

*A backdrop is the exception this answer did not decide.* A failed backdrop has
no placeholder and no **Try again**, and it gets no immediate retry either — but
it is asked for again, as a new rendition record with a fresh seed, after every
reply while its place stands, because the render step's reuse checks
(`reusableBackdrop` and `backdropInFlight` in `renditions/store.ts`) count only
`ready` and `pending` records and a `failed` one matches neither (the guide's
[Backdrops](../guide/pictures.md#backdrops) says so to players). That re-ask
predates this answer and is not a retry of one call in the sense the hidden pair
was — each one is a record the workbench shows, not a request spent behind one —
and the question put to the owner was about retries of a single call. ***Whether
the configurable condition also covers the per-reply re-ask of a failed
backdrop is open***, and is the owner's to answer: today it is automatic, paced
only by how often a person replies, and has no setting.

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
([04 §6](04-schemas.md)).

### E9. Testing — done

Now [testing](workplan/03-testing.md).

### E10. Simple/advanced, or a rearrangeable layout — open, and not blocking

The density stance is settled: [10 §1.1](10-ui-surfaces.md) commits the *tooling*
surfaces to a high-density interface in a modern implementation, and the story
and arrival surfaces to a quiet one. What is not settled is what happens for
people who want less density on the tooling side — a real constituency, and one
that will make itself heard the moment the library shows a panel per kind
([10 §5.1](10-ui-surfaces.md)).

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
  [10 §8](10-ui-surfaces.md) deliberately gives extensions no UI surface, so this
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
derives from a full one, never the reverse ([10 §1.1](10-ui-surfaces.md)). The
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
([10 §1.2](10-ui-surfaces.md)). Two themes ship, light and dark, chosen by
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
([10 §15.1](10-ui-surfaces.md)). Per-user rather than per-install, which is what
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

**A referral this entry had never been told about, accepted and answered
2026-09-11.** [Refinements §4](workplan/22-walkthrough-refinements.md) and
[polish §12](workplan/06-polish.md) both route R3's *roll the settings sections up*
and *use the workbench as a table of contents* here, and neither told this entry,
which has not been edited since it was written. **They are refused rather than
deferred**, and the distinction matters: a deferral waits for this entry to
resolve, and these do not.

**R3 is not the forcing evidence this entry is waiting for.** The test above is
*evidence that the dense default actually loses people at first run* — a
stranger, at their first contact, from PLAYABLE. R3 is the author finding his own
administration page long on the fourth sitting of a walk he was conducting. That
is a real complaint and it got a real remedy — a search over the settings pages,
[polish §12](workplan/06-polish.md), which hides nothing and so does not touch
the density stance at all. It is not a person being lost.

**What the roll-up would have cost, stated so the refusal is a judgement rather
than a reflex:** [10 §11.2d](10-ui-surfaces.md)'s rule that *a closed section must
name what is inside it that is not at its default* is what makes disclosure
honest, and it makes a rolled-up settings page expensive rather than cheap — every
closed section has to summarise its own non-default state. And the ToC half asks
the workbench to be a place rather than a panel, which
[D3](workplan/05-manual-testing.md) walked and passed the day before the request
was written: nothing switches it on. **The density question this entry exists for
stays open and stays unforced.**

### E11. The prose editor — open, leaning plain text with decorations

Write ([13 §12](13-write-mode.md)) needs the first structured editor this
repository has had, and nothing in any manifest is one today. The decision is
open, and the reason it can safely stay open is that **the requirement is much
narrower than "a rich text editor"**, and stating the requirement is most of the
work:

> **The editor must maintain externally-held, offset-keyed annotations across
> arbitrary edits.**

That falls out of two decisions already made. The canonical form is plain
Markdown on disk ([13 §5.2](13-write-mode.md)), so an editor whose document model
is a node tree makes the file a *render* of that model and reintroduces the
two-sources-of-truth failure [03 §5.2](03-data-model.md) rejects for cards. And
mentions, provenance and beat positions are all overlays under *annotate, never
rewrite* ([10 §13.1](10-ui-surfaces.md)), so none of them may be injected into
the authored bytes.

**Lean: a plain-text editor with a first-class position-mapping API and
decoration sets**, rather than a rich-text document model. A textarea with a
mirrored overlay is a genuine fallback and loses block widgets, per-span hit
targets and long-document virtualisation.

**Why leaving it open costs nothing.** The document on disk is Markdown, the
annotations are offsets in `manuscript.json`, and no part of the server, the
schemas or the API knows what the editor is — client-internal in the same
structural sense [19 §6](19-tech-stack.md) makes the framework choice reversible.
Two constraints hold whichever way it goes: read-only rendering must not require
the editor bundle, or the reading view ([10 §12](10-ui-surfaces.md)) takes a
dependency on it; and if the beat interaction turns out to need rich structured
content *inside* the prose, the plain-text model is wrong and the storage
decision reopens with it. *[13 §12]*

### E12. The remaining Write-mode shapes — four, all cheap, none blocking

Collected rather than given entries of their own, because each is a local choice
inside [13](13-write-mode.md) that changes nothing outside it. Recorded so they
are re-checked rather than re-argued.

- **Sessions per manuscript — lean: one.** A Write session is a tool and the
  manuscript is the work ([13 §4.5](13-write-mode.md)), so the session is created
  lazily and never shown. Several would matter mainly for two humans, which is a
  non-goal ([13 §14](13-write-mode.md)).
- **Manuscript version granularity — lean: a manifest, not per node.** A version
  is the set of content hashes for `manuscript.json` and every `text/*.md`
  ([13 §5.4](13-write-mode.md)). Payloads are already content-addressed, so an
  unchanged node costs nothing and restore is atomic — which is what Scrivener's
  snapshots actually are. It depends on one property worth verifying rather than
  assuming: snapshot payloads must stay opaque digest-addressed bytes.
- **Where automatic plurals are configured — lean: the matcher, not the entry.**
  It is a property of the language rather than of a lore entry
  ([13 §9.2](13-write-mode.md)), so a per-entry boolean would be the wrong shape
  repeated a hundred times.
- **Whether Write is finally the feature that wants templating inside a text
  block — lean: still no.** [06 §5](06-modes-and-turn-pipeline.md) already
  intends templates to render *within* a block, so this is not a refusal of
  templating; it is a question about a small residue — a manuscript title, a POV
  name — each of which is arguably a slot ([13 §11.1](13-write-mode.md)). A
  template language admitted for three tokens is admitted permanently.

And one that is **not** in this list because it is not open: whether the codex is
a new kind. It is not ([13 §9](13-write-mode.md)), and the reopening condition —
a lore entry gaining a portable cross-install identity
([11 §4.1](11-lorebooks-as-a-format.md)) — is recorded there rather than here.
*[13 §§4.5, 5.4, 9.2, 08.1]*

### E13. Deriving a session's name from what was played — deferred, and unnamed is fine

**Position: a session may have no name, indefinitely.** `POST /api/sessions`
takes an optional name, `PATCH` renames whenever its owner knows what to call
it, and until then the client shows *Untitled session* over a stored `""` — the
same convention the library already uses for *Untitled entry* and *Untitled
actor* ([10 §11.1a](10-ui-surfaces.md)). Nothing is derived, and nothing is
pending.

Settled, and not worth relitigating: unnamed is `""` on disk rather than an
absent field, because the index column is `name text not null` in a `strict`
table and the only distinction optionality would buy — *never named* versus
*named and then emptied* — is one nothing consumes. A rename is one JSON write
plus one index upsert, because a session is id-addressed and a session name
matches nothing, unlike a tag ([05 §1](05-tagging.md)) or a lore entry name
([11](11-lorebooks-as-a-format.md)).

**Why not derive one now.** The cheap derivations are all worse than blank
exactly where it matters: the first line of the first turn is usually a stage
direction, the treatment's name gives every session started from it the same
title, and a date is what the list already sorts by. A model-derived title would
be better and costs a call — which makes it an offer and never a requirement,
since [10 §11.1](10-ui-surfaces.md) holds that nothing may require a model call
to proceed. P8's `fast`-role summarisation is the natural thing to ride when it
lands, and the corpus's standing position on deriving structure from content is
propose, never impose. E1 makes chapterisation manual with agentic advice, and
[15 §7](15-world.md) makes *not automatic* an explicit non-goal on the ground
that a human knows where a continuity's edges are and a heuristic does not —
which is the same sentence about a name as it is about a boundary.

**The strongest argument is not that the material is thin — it is that deriving
would destroy evidence.** [15 §8](15-world.md) makes session names the
falsification test for World: *watch what people put in session names; if they
are hand-encoding continuity — 'Rain City 3', 'Rain City 4' — that is the
feature asking to exist, and it is also the cheapest possible evidence for it.*
A name the product wrote is not evidence of anything. Leaving the field optional
and renamable **strengthens** that test, because what somebody types into an
empty box is a signal and what they leave in a generated one is not.

Reopening conditions: a surface that lists many sessions at once, where a column
of *Untitled session* stops being honest and starts being useless; and session
export (B12), where a file leaving the install wants a name a human chose.
*[03 §8, 10 §11.1a, 15 §8]*

### E14. Midjourney — deferred, and the reason is not technical

**Position: not built, and not refused on principle either.** It is the one
image backend people ask for by name that this project cannot simply go and
implement, and the obstacle is worth stating precisely rather than as a shrug.

**There is no API to write against.** As of 2026 Midjourney publishes no public
API, no developer programme and no enterprise offering; access is the Discord bot
and the web app on a subscription. Its terms are explicit rather than silent —
*"You may not use automated tools to access, interact with, or generate
Assets."* Every product sold as a "Midjourney API" is an unofficial wrapper
driving consumer accounts, and the documented failure mode is permanent
suspension with the remaining GPU credits gone.

***Why that lands differently on this project than on a desktop app.***
StoryEngine is a multi-user server somebody runs for a household
([09 §1](09-server-multiuser-deployment.md)). The operator supplies the
connection, and the account at risk is theirs — but the people who lose the
feature, mid-story, are everyone in the install. A risk one person accepts on
their own behalf is a different thing from one an operator accepts on four
people's behalf without their knowing there was a choice. Shipping named support
would also be this project distributing code whose only purpose is automating a
service that forbids automation, which is a thing to decide deliberately and not
by adding a row to a table.

**There is a structural mismatch as well**, recorded so a later builder does not
rediscover it: a Midjourney prompt returns a **grid of four**, and a chosen tile
is then upscaled by a second call. That is two round trips producing two
artefacts, where `renderImage` assumes one call returns one picture. The shape
that fits is the grid splitting into **four sibling renditions** at ingest —
which is very close to what [P9.3](workplan/26-p9-implementation.md) already
models, since variation there is already siblings rather than a batch parameter —
with upscale as an action on the chosen sibling. Somebody should confirm that
against a real endpoint rather than take it from here.

**Where it belongs instead.** Not in core. [22 §11](22-extensions.md) commits to
a renderer contract published through the SDK, timed to ComfyUI — and that is
the honest home for this: an extension somebody who actually uses Midjourney
writes, installs on their own server, and accepts the terms of. The deferral is
recorded here rather than left implicit **because a deferral with nowhere to land
is how something becomes nobody's** — §10.1 of the manual-testing list is a whole
section about exactly that failure.

Reopening conditions: an official API or a documented developer programme, which
would make this an ordinary table row overnight; or the renderer contract
landing, after which this stops being a question for the project at all. Until
one of those, the nearest backends with real APIs and comparable output are Nano
Banana Pro, FLUX through OpenRouter, and Stability — all of which
[19 §5.6](19-tech-stack.md) already reaches.
*[19 §5.6, 22 §11, 09 §1]*

### E15. Images on the player's input — on the roadmap, and never a lock-in

**Position: a High-tier roadmap feature ([24 §3.1](24-roadmap.md)), specified
here because its one hard requirement is easy to get wrong and expensive to
put right afterwards.** A player may attach one or more pictures to a move, and
a model that can see them gets the pixels. **Having done that once must never
confine a session to models that can.** Continuing, redoing, branching,
summarising, exporting and importing all keep working on a text-only model
afterwards — and on an install that has never had a model that sees at all.

**R1 built 2026-09-27; R2 onward open.** What landed, against the tier list
below:

- **Storage and upload.** `sessions/<id>/attachments/<sha256 hex>.<ext>`,
  content-addressed, written atomically, never evicted
  ([03 §5.5](03-data-model.md)), and resolved against the real session folder so
  a linked `attachments/` cannot lead out of it. `POST /api/sessions/:id/attachments`
  takes a PNG, JPEG or WebP by its own signature, up to 8 MB, and only while the
  session exists; `GET …/:digest` serves it. The sweep rides on the upload, on
  age: a day since anybody last *wanted* the file — an upload or a submitted move
  renews it — and counts every turn a reader sees as a reference. The browser
  scales to a 1568-pixel long edge and re-encodes before upload, and fails
  closed.
- **The record**, all optional: `input.attachments` (id, open `kind`, digest,
  and the type, size and pixel dimensions the server read from its own store,
  and the caption); `RenderedMessage.parts` beside `content`
  ([21 §2](21-internal-contracts.md)); `AssembledBlock.image`, the disclosure;
  `part: "attachment"` on the `input` and `history` sources
  ([21 §1.1](21-internal-contracts.md)). Four pictures to a move.
- **Per-model support**: `imageModels` on a connection, a subset of `models`,
  empty by default, with a checkbox per model in the connection editor
  ([21 §3](21-internal-contracts.md)).
- **The send rule, in `planCall`**, against the model resolved after the session
  and step layers and the actor hint. A picture whose pixels do not go sends its
  words, and the block says why. When several reasons hold, the one recorded is
  the one choosing another model cannot fix — kind, then window, then role, then
  bytes, and the model last — and a picture a budget dropped says `budget`. The
  adapter builds array content only for a user message carrying a loaded
  picture; a wire test asserts the `image_url` data URL leaves, and a live test
  (`STORYENGINE_LIVE_VISION_MODEL`) sends one to a real endpoint.
- **A picture is never framed by its move's kind.** Freeform's `say` slot wraps
  words as *the player's character says: "…"*, and a picture is not speech; it
  goes in its own words as the move being made and wears only the history
  slot's wrapper in history, so it reads the same on both sides of its turn.
- **Every text consumer reads the picture's words**: the summariser and memory
  extraction read a move's words plus its pictures' stand-ins through one
  function (`moveText`), every line of it quoted as the player's; the index, the
  lore scan and speaker detection read captions only. A step's transcript
  carries each picture's kind and caption beside the unchanged `text`, and the
  built-in steps that read it apply `moveText` themselves. A summary unit's key
  gains the captions only for a turn that has pictures, so no existing chain
  re-keys. A move that is only a picture is no longer dropped from history.
- **Play, the reading view and the workbench**: attach and caption in the
  composer, which says under each picture — from the preview, so it is the
  turn's own answer — whether the model will see it or get the caption, and
  why; pictures on the move in the transcript and the reading view, with a
  placeholder where the bytes are missing; and a badge on the block — *Picture
  sent*, *Picture as words* or *Picture dropped*, with the reason.
- **Continuity**: redo carries a move's kind and its pictures — named by the turn
  (`input.attachmentsOf`), so the server copies them as recorded, ids and kinds
  and digest-less pictures included, rather than a client rebuilding them.
  Export carries the records, and the export control says the pictures travel
  as their captions; backup import re-stores the bytes under their own digest;
  a redo of an imported turn whose bytes never arrived sends words. The one
  obligation test — an unknown field inside `input` surviving import and
  re-export — is in `sessions/import.test.ts`.
- **The lock-in tests** are the ones this entry turns on
  (`routes/attachments.test.ts`): a picture sent to a model that sees, `prose`
  rebound to a text model on the same connection, and the next turn completing
  with the earlier picture as its words; and a session imported without its
  bytes, whose picture turn is redone as a sibling and goes as words.

*Revised the same day, after an audit of the build against `main` as the
merge left it.* The first cut's sweep deleted a picture re-uploaded after a day,
in the request that uploaded it, because a second upload of the same bytes
changed nothing on disk; it followed a linked folder; its redo rebuilt pictures
from digest and caption and so lost what it could not name, and lost the move's
kind; its preview hid every picture when one was unknown and, in a pack whose
input slots are per-kind, showed none; and it framed a `say` move's picture as
speech. Each is fixed above and pinned by a test.

***Where R1 departs from this entry's text, said here rather than
silently:***

- **The placeholder reaches the summariser and memory.** The floor bullet below
  says the placeholder is never handed to them; this entry's own opening says a
  picture with no text form is what those consumers would silently lose. R1
  sided with the opening: a move that was an undescribed picture reaches them as
  `[Picture, not described]`, because a summary that says a picture was shown is
  truer than one that skips the move. The half of the rule that matters for
  stability holds: the placeholder's **wording** is never hashed into a summary
  key (the key carries the caption or `null`), and neither the lore scan nor the
  index — which a person reads, in search snippets — ever sees it. Reversing
  this is one function, `moveText`.
- **The placeholder is message content, inside a block of its own.** The floor
  bullet says *a block with its own source, never message content*; R1 emits it
  as the picture's own block, whose text — like every block's — renders into
  `content`, which the restraint on `RenderedMessage.content` requires. What
  the bullet protects, `input.text`, is untouched.
- **No token figure for the pixels.** The current move's picture is required, so
  the budgeter cannot drop it, and it is counted as its words; what the pixels
  cost the model is not estimated until R3's declared per-image figure. So a
  near-full window can overflow on the endpoint's side when pictures are sent —
  the call view's estimated-against-reported line is where that shows, and the
  *Picture sent* badge says its figure leaves the picture out. A step's own
  picture candidate can be dropped, and records `budget`.
- **Changes to published shapes, named as this entry asked.** The SDK's
  `Candidate` gained `image?` (the new `CandidateImage`), `StepInput.input`
  gained `attachments?` (the record's `TurnAttachment`, as `history` already
  carries it), and the transcript's move gained `attachments?` (kind and caption
  only). `ImageWithheld` is a new exported union, and it grew `budget` the day it
  shipped. `POST …/turns`'s `input` is now **closed** — it was open, so a newer
  client's field was accepted and silently dropped, which for a picture sent to
  an older server would have lost it without a word — and gained
  `attachmentsOf`. The preview's `input` was already closed.
- **No SDK helper for a move's words plus its pictures.** The server has it
  (`assembly/pictures.ts`); publishing it is P7's contract work.

***What the changelog will say***, parked here until the next tag is cut, as
[P12 §2.1](workplan/29-p12-implementation.md) parks its own: *Pictures on a
move* — attach up to four, caption each, and a model that can see pictures is
shown them, while one that cannot gets the caption, so using a picture never
ties a session to a model that sees; mark which models see pictures in
Settings → Connections. **For an existing install**: `POST …/turns` and the
preview now answer `400` to an unknown `input` field; new files appear under
`sessions/<id>/attachments/`, `users/<handle>/usage.jsonl` and
`users/<handle>/task-roles.json`; the state store gains a migration
(`STEPS[7]`, rendition jobs keyed by session) and the search index rebuilds once
(version 11). Nothing needs doing by hand.

*Surveyed 2026-09-26, against the build as P12 left it.* No design note
addressed image input before this entry. The `vision` role
([19 §5.1](19-tech-stack.md)) is the only hook, and nothing calls it.

**The engine already refuses to lock, and the design is about keeping that
true.** Every model call re-resolves its role — `resolveRole`, through
`planCall` — and records what it got as `ModelCall.resolved`
([21 §1.4](21-internal-contracts.md)), precisely because the binding can change
between turns. And history is re-collected from the `Turn` records on every
call; nothing ever replays an earlier call's `messages`. So a session is not
"on" a model at all, and there are only two ways images could change that.
Both are leaks. One is image content getting into the strings the text pipeline
runs on, where a text-only model cannot take it back out. The other is an image
with no text form at all, which every text consumer would silently lose: the
summariser, memory extraction, the lore scan, the index, the reading view, and
the history collector, which already drops a half whose text is empty.

**The invariant: an attachment annotates the player's move; it never replaces
text, and it always has a text rendering.** Whether pixels are sent is decided
**per call**, in `planCall` — the one place that holds the resolved model and
its capabilities before anything is assembled, and where structured output
already degrades the same way. No session, turn, binding or preset ever records
that it is "multimodal", so there is nothing to be locked into.

Attachments are **story input**. They land in history, and their text is what
summaries, memory and exports carry — which is exactly
[06 §5.1](06-modes-and-turn-pipeline.md)'s list of what happens to input. So an
out-of-story picture — *"she looks like this"*, *"match this style"* — is a
different feature: an image in the guidance slot, one-shot and advisory, which
never re-enters history and is lock-in-safe by construction. It is R4 below,
not this.

**The text rendering has two sources and a floor.**

- **The caption** is what the player wrote about the picture. It is on the turn,
  immutable, and theirs; correcting it is a sibling, which is the tree's routine
  for an edit.
- **The description** is written by a model through the `vision` role, and it
  lives **beside the turn**, keyed by the picture's digest and so shared across
  siblings. That is [21 §7.2](21-internal-contracts.md)'s fork taken the same
  way for the same reason: turn segments are never rewritten, so anything
  produced after a turn commits cannot be added to its record. On the turn, a
  description could never be written later, and two populations would stay
  undescribed for good — everything attached before descriptions exist, and
  everything attached on an install that only later gains a model that sees,
  which is the more common direction. The server writes it, from the describe
  call, with the model and usage that produced it. A client never asserts
  provenance, on the reasoning that makes `rewriteOf` an id rather than a
  claim. And a description the player edits before sending becomes their
  caption, which is impersonate's rule: anything else takes authorship away.
- **The floor** is an honest placeholder — *a picture the player showed, which
  nothing has described*. It is a block with its own source, never message
  content, and it is never hashed into a summary key or handed to the
  summariser, memory, the lore scan or the index.

**Describing is worth doing early, and it is never automatic.** Every text
consumer needs the text whatever the narrator can do, and the model that sees
may not be bound next month. But describing uploads the picture, possibly to a
hosted endpoint, so it is an explicit action that names where the picture is
going rather than a side effect of attaching one. And nothing may *require* it:
[10 §11.1](10-ui-surfaces.md)'s *"Nothing may require a model call to proceed,
ever"* holds here unchanged.

***The quality argument points the same way.*** Few models tuned for roleplay
see images at all, and whether pictures improve narration is something only
real sessions will say. *Describe once with a model that sees, narrate with the
one you like* is therefore probably the path most people take, and pixels to
the narrator is the upgrade rather than the requirement. It is the path to tune
first.

**The send rule.** Pixels go for an attachment in a call only when all of these
hold; otherwise its text goes instead, and the block records why.

1. It is inside the **image window** — the current turn, until R3 widens it.
2. The model the call resolved to — after the session and step overrides *and*
   the actor hint — is one its connection lists as seeing images.
3. It sits in a user-role message, since a system message cannot carry one.
4. Its bytes are present. After an import, the ordinary state is that they are
   not.
5. Its kind is `image`. An unknown kind is text only, never pixels.

The reason travels on the assembled block as a disclosure — sent, or withheld
because the model is text-only, the attachment is outside the window, the bytes
are missing, the message is not the player's, or the budget dropped it —
rather than as a not-filled slot, because the attachment *did* emit something:
its text. That keeps [00 §3.6](00-stance.md)'s question answerable. The
workbench shows what was sent, and Play marks each attachment *sent as a
picture* or *sent as its description*.

**The summariser and memory extraction never see pixels, and not by rule.**
Both bring their own text candidates, so the collector and the window never run
for them. They read the caption and description. A summary unit's key gains
those only for a turn that has attachments, so every existing chain keeps its
key, and a re-description re-keys only the units it touches — regeneration, not
data ([07 §5.1](07-branching.md)). The lore scan reads the caption as it reads
input; scanning a model's description is opt-in, for 06 §5.1's reason.

**Capability is per model, and has to be from the first tier.** Every
capability so far is a property of the endpoint, which is why
[21 §3](21-internal-contracts.md) makes them overridable per connection. Seeing
images is a property of the *model*: one Ollama URL serves a vision model and a
text one, and so does OpenRouter. A connection-wide flag is a lock-in bug with
extra steps. Mark the connection for the describer, then rebind `prose` to a
text model on the same connection — or let an actor hint pick one — and a redo
of the image turn sends pixels to a model that refuses them, every time. So a
connection lists **which of its models see images**, beside `models` and a
subset of it, empty by default. Not inside `capabilities`: the connection
editor keeps stored capability overrides across model edits, which would leave
the list naming models that are gone, and
[P2B §6.2](workplan/10-p2b-provider-configuration.md) already warns that the
first capability to grow an object reopens the aliasing question. It is the
first capability to depart from 21 §3's per-endpoint premise, and it should say so
when it lands.

**This is C15's trigger.** C15 says to decide role fallback *"with the first
step that genuinely cannot use `prose`"*, and describing a picture is that step.
It wants a fourth option, recorded there as *(d)*: `vision` resolves to the
first layer whose model, after the hint, sees images; failing that, the same
over `prose`; failing that, to nothing — which is a legal outcome here rather
than a failure, because the caption or the placeholder carries the picture. C15
also records that many installs already bind `vision` to a text model, which
*(d)* makes inert rather than wrong.

**Where the bytes live.** A new session directory, content-addressed and **not
evictable**. Never `assets/`, which [03 §5.5](03-data-model.md) makes the one
disposable directory on the strength of every file in it having a recipe (E3);
an upload has none. Uploading is the library's two-step shape
([10 §11.2b](10-ui-surfaces.md)) — bytes first, then ids in the ordinary JSON
turn. A sweep of unreferenced uploads runs on age, never on commit, and counts
every turn in every segment as a reference: walking the head path, the obvious
reachability function, would delete a swipe's pictures. The browser re-encodes
before upload and **fails closed** — it refuses rather than sends the original
— because a phone photo carries where it was taken, and the server keeps its
position of having no raster encoder. Re-encoding is also where a picture is
scaled down to something worth paying a provider for.

**The record.** All of it is optional, so all of it is addition under the
freeze ([P11.10](workplan/28-p11-implementation.md): *a promise not to
tighten*).

- `Turn.input` gains `attachments?`: an id, an open `kind`, the digest, type,
  size and dimensions the server read from its own store, and the caption. The
  byte facts are optional, so an importer without the bytes can still say a
  picture was there. It deliberately does not reuse the portable media types,
  whose roles are a closed and published union, for the reason
  `RenditionAsset` does not.
- `input.text` stays the player's words and nothing else — no `[image]`
  marker — so spans, summary keys and *annotate, never rewrite*
  ([10 §13.1](10-ui-surfaces.md)) are untouched.
- `RenderedMessage.content` stays the whole text rendering, which is the
  contract [21 §2](21-internal-contracts.md) froze. An ordered `parts?` rides
  beside it and names pictures **by digest**, so the call record stays small;
  the bytes are loaded for the wire and never persisted. The adapter builds
  array content only for a message carrying an admitted picture, because some
  text-only endpoints reject arrays outright, and it inlines `data:` URLs,
  because a local endpoint cannot reach this server.
- The attachment is emitted as its own block from inside the existing `input`
  and `history` expansions, as a new `part`, rather than as a new top-level
  source — which [21 §1.1](21-internal-contracts.md)'s derivation would turn
  into a slot any preset could position.
- The SDK's `Candidate` gains an optional picture too. That is a change to a
  published contract, and should be named as one when it happens.
- The session export gains the descriptions kept beside the turns, optionally
  and with no schema bump. A bump would make an older install refuse the file,
  and refusing is worse than what an older install does with it.

**What an older install does with it — honestly.** A pre-feature install
imports the file and keeps the field, because readers carry what they do not
recognise ([04 §2](04-schemas.md)). But it does not *read* it: its collector
drops an image-only move from history, and its summaries skip one. That is lost
meaning rather than lock-in — nothing asks for a model that sees — and an export
containing attachments should say so. Third-party steps that read raw history
see attachments only if they know the field; an SDK helper returning a move's
words plus its text rendering is the cheap answer.

**Feature tiers**, in build order, each useful without the next.

- **R1 — attach, with a caption.** Storage, upload, serving, the sweep and the
  fail-closed re-encode. Per-model image support and the send rule, current
  turn only. `parts`, the byte loader, and a wire test asserting that the
  picture actually leaves as a `data:` URL — this SDK has dropped a field in
  silence before ([polish §8](workplan/06-polish.md)). The block disclosure;
  thumbnails in Play, and pictures in the reading view with a placeholder
  where the bytes are missing. Redo carrying attachments, because they are
  input and not one-shot instruction — the line C14 draws for guidance. Export
  and backup import carrying them.
- **R2 — describe.** The `vision` call, once C15 is decided as *(d)*: an
  explicit action, the description beside the turn, describing retroactively,
  and its cost recorded — [24 §3.3](24-roadmap.md) already obliges 1.0 to record
  assist-call cost, and this call joins that obligation.
- **R3 — a wider window, and a budget.** Pictures from earlier turns, each its
  own droppable block carrying a declared per-image token figure. The
  budgeter's estimate is characters over four (E5) and a picture has none, so
  where no figure is declared the fallback is a configured default marked
  *image cost unknown* — never zero, and never a number this project made up,
  which is why [21 §3](21-internal-contracts.md) leaves a limit it has not
  verified *undeclared rather than defaulted*. Asking an endpoint which of its
  models see images belongs here too, where endpoints will say; this entry has
  not checked which do.
- **R4 — the rest.** Paste and drop; guidance-slot pictures; export with the
  pixels; and SillyTavern's chat-attached images on import, which waits on a
  chat importer (E4) and on confirming the field, which this survey did not do.

**What this obliges 1.0 to do: one thing worth acting on now, and three
restraints.** The one thing is **a test that a turn carrying an unknown field
inside `input` survives import and re-export unchanged.** [04 §2](04-schemas.md)
already requires a newer file to survive a round trip through an older reader,
and nothing asserts it for a nested field — the export tests check the fields
the record knows. The restraints: `RenderedMessage.content` stays the whole text
rendering, with anything else beside it; `input.text` stays the player's words;
and `assets/` stays the renditions' disposable directory, so that anything a
person made, which cannot be regenerated, gets a directory of its own. And one
condition on whoever reaches for `vision` first: nothing calls it until its
resolution asks whether the model can see.

**Not this.** Lore and actor reference images sent to the narrator — that is
the selector problem [24 §3.1](24-roadmap.md)'s lore-conditioned renditions row
defers, and [10 §11.2b](10-ui-surfaces.md)'s *"they are not sent"* stays true of
library pictures. Pictures out of the text model, which renditions already
cover. Video, audio and documents: `kind` is held open for them, and nothing
more.

~~What moves it: C15 decided as *(d)*, which this entry is the occasion for; or
somebody who plays with a model that sees wanting R1 enough to build it, which
needs nothing else first.~~ **R1 is built (2026-09-27).** What moves the rest:
R2 waits on C15 decided as *(d)*; R3 has no outside gate — its per-picture
figure is part of its own work; R4's chat-attached pictures wait on a chat
importer (E4).
*[24 §3.1, 06 §5.1, 21 §1.1, 21 §2, 21 §3, 21 §7.2, 03 §5.5, 04 §2, 10 §11.1, 10 §11.2b, 19 §5.1, C14, C15, E3]*

### E16. Money — the provider's figure, a declared price, and never a shipped table

**Position: the record has somewhere to put money, and nothing fills it yet;
the approach below is the recommendation for what should.** Three places carry
a money figure — `ModelCall.cost`, the usage log's `cost` for calls that make no
turn ([21 §1.4](21-internal-contracts.md)), and since 2026-09-27 the turn's own
total, `TurnCost.money` — and all three are null on every real endpoint, because
the adapter prices nothing. [09 §4.5](09-server-multiuser-deployment.md) said
turns *"already record cost"*, which was true of tokens only; it now says so.
The field landed first on purpose: a turn priced later needs no migration to
say what it cost, and an unpriced one says *not priced*, never zero.

**The rule a filler has to keep is [21 §1.4]'s**: *provider-reported, not
estimated*. So the recommendation is ordered by how honestly each source can
claim that.

**1. The provider's own figure, where it gives one — OpenRouter first.**
OpenRouter returns what a call cost on every completion as `usage.cost`, the
total charged to the account, with `usage.cost_details.upstream_inference_cost`
beside it; it arrives in the last streamed chunk as well as in a whole response,
and the old `usage: { include: true }` opt-in is deprecated and does nothing
(checked against OpenRouter's usage-accounting page, 2026-09-27). That is a
provider-reported amount in the plainest sense, from the aggregator a roleplay
install most often points at, and it needs no table of anybody's prices. Its
unit is OpenRouter's **credits**: record `currency: "credits"` — which the
workbench already shows as a word rather than refusing — until somebody confirms
against an account that a credit is a dollar and it can be written `"USD"`.

The work is small and has one unknown. The adapter is built on the AI SDK's
OpenAI-compatible provider, which surfaces token counts; whether it passes
through `usage.cost` is **not verified**, and the same SDK has dropped a field
in silence before ([polish §8](workplan/06-polish.md)). So the first step is a
live test in the `live` project's pattern — one OpenRouter call, asserting that
a number arrives — and if the SDK does not carry it, the adapter reads it where
it already owns the response: the fetch it wraps for capture. A per-connection
capability, `reportsCost`, false in the conservative baseline exactly as
`reportsUsage` began, keeps a connection that claims the format and does not
honour it from being believed.

**2. A price the person declares, where the provider says nothing.** Direct
OpenAI and Anthropic endpoints, and every local one, report tokens and no money.
For those a connection may carry, **per model**, a price its owner enters —
input and output per million tokens, and a currency — and the call's cost is the
provider's token counts times that price. That is not an estimate of usage; it
is a person's own number applied to a measured one, and the record should be
able to tell the two apart: an optional `source: "provider" | "declared"` on the
cost, so a spend view built later can say which of its figures a provider
vouched for. Per model because a price is, like image input
([E15](25-open-questions.md)), a property of the model rather than of the
endpoint; on the connection because that is where somebody who knows says so
([21 §3](21-internal-contracts.md)). A local model's owner who wants *free* to
read as a claim rather than an absence declares zero.

**3. Never a shipped price table.** A bundled table of per-model prices is the
*"confident-looking table of half-remembered limits"* `capabilities.ts` refuses
for context sizes, with a worse failure attached: prices change without notice,
cached and batch tiers differ by account, and a wrong price does not truncate a
prompt somewhere out of sight — it is printed beside every turn as fact. Not as a
default and not as a fallback.

**Downstream, and not part of the first step:** cached-token pricing, which
OpenRouter's figure already includes and a declared price would have to model;
image calls, whose `ImageResult.cost` exists and is dropped because a rendition
has no field for it; and the aggregate view itself
([24 §3.3](24-roadmap.md)), which reads whatever this fills.

What moves it: somebody on OpenRouter wanting the number, which needs only the
live test and the adapter change in step 1. Step 2 waits for somebody who wants
a figure beside a direct or local endpoint.
*[21 §1.4, 21 §3, 09 §4.5, 24 §3.3, E15]*
