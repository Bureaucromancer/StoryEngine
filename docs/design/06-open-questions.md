# 06 — Open questions

Collected from the inline **[OPEN]** markers, plus questions that don't belong to
one document. Ordered by how expensive they are to answer late.

---

## A. Decide before writing code

**A0. The licence. — RESOLVED 2026-08-09: AGPL-3.0.** Matches all three sources;
`LICENSE` is in the repository root. Lifting code from the sources is permitted
with notices preserved, §13 obliges us to offer source to LAN users
([04 §7](04-server-multiuser-deployment.md)), dependencies must be
AGPL-compatible, and user content is unaffected. See [08 §1](08-triage.md).
Spawns A1b, below.

**A1. Extension execution model. — RESOLVED: worker-thread boundary from 1.0.**
Specified in [17](17-extensions.md). The decision turns on separating two things
that get bundled under "sandbox": **fault isolation** (a crash, hang or runaway
loop not taking the server down) is cheap and shapes the API, so take it now;
**authority isolation** (an extension unable to reach the filesystem at all) is
expensive and additive, so defer it — extensions are AGPL and admin-installed,
which is a materially weaker threat model than untrusted code.

The reason this costs less than instinct suggests: **the extension surface
already serialises.** Five of the seven things [03 §9] requires are declarative
and cross no boundary at all; the remaining two are a function over JSON-shaped
data and async host calls. Built-in modes run through the same boundary, so the
contract cannot drift. *[03 §9, 17]*

**A1b. May extensions be non-AGPL? — RESOLVED 2026-08-09: no. Extensions and
modes are AGPL-3.0, with no linking exception.** The friction of requiring
copyleft from extension authors is smaller and more recoverable than the damage
of a copyleft project being seen to close things down. Consequences: no
exception means no decide-before-first-PR deadline; the SDK package must itself
be AGPL for this to hold; extension manifests should carry a declared licence
field for legibility. Content — including packages and their authored rules —
is explicitly *not* covered and stays the author's own. See
[08 §1.1–1.2](08-triage.md).

**A1c. Extension-owned durable storage. — RESOLVED: a namespaced key/value host
API, not a directory.** Specified in [17 §5](17-extensions.md). The worker
boundary from A1 makes this cleaner than the directory the question assumed:
storage is a host call namespaced per (user, extension), so cross-user and
cross-extension reach are impossible by construction rather than by check. Backed
by files under the user's directory so it inherits the watcher, index and backup
story; quota declared in the manifest; removed on uninstall with an explicit
keep-the-data prompt. Values are JSON — bulk bytes go through a separate asset
call returning a handle. *[03 §9, 11 §4.6, 17 §5]*

**A2. Can a package ship code? — SHARPENED by [09 §2.1](09-infinite-worlds.md):
packages may ship *rules*, never *code*.** Declarative rules are terms in a
closed vocabulary our evaluator interprets, so importing one grants no capability
the importer lacks — which is what makes shared content far more expressive
without touching A1's execution question. Still open: bundling an actual mode or
extension implementation remains a no for 1.0, and the rule vocabulary needs
versioning so a package authored against v2 fails legibly on a v1 host.
*[02 §7, 09 §2]*

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
branch shows the real ongoing cost. *[07 §12, 04 §3.2]*

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
[11 §3](11-roadmap.md)). *[04 §4.5, 04 §4.2, 07 §5.1]*

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
stay discarded. *[00 §2.2, 07 §5.5, 08 §6.2]*

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

**B2. Does a Setting own a primary lorebook? — RESOLVED: no. It only links.** A
primary lorebook would block many settings over one lorebook — a noir and a
comedy drawing on the same world — and create an ownership question on delete.
`LoreLink.required` is the concession: mark a link load-bearing and a consumer
warns loudly when it will not resolve, still without blocking. *[02 §4, 13 §3]*

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

**B7. Channel schema migration.** What happens to an in-flight session when the
mode that owns its channels updates its schema? Needs an answer before anything
ships. *[03 §4]*

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
([13 §2](13-schemas.md)). *[01 §2, 07 §12]*

**B9. Can an expanded opening seed be promoted back? — RESOLVED: yes.** That is
the point of carrying seeds and written openings as two lists: a seed is reusable
machinery, a good expansion is content worth keeping. The loop closes —
seed → expand → edit → accept → promote — and the promoted opening records
`fromSeedId`. Promotion targets the source object, not the session. *[02 §6, 13 §3]*

**B11. Lorebook revisions. — CONFIRMED as proposed.** All four:
(a) entry state — `dynamicState`, quests, relationships, disposition — moves to
session channels with only a `stateSchema` left on the entry, so an exported
lorebook cannot carry somebody's playthrough; (b) `activationConditions` and
`schedule` unify as typed channel predicates; (c) `embedding` moves to the
derived index; (d) the five overlapping book-level scoping mechanisms collapse
to one `LoreScope` union. Everything else — matching, timing, recursion,
placement, grouping, gating and the two-tier budget — is taken from Marinara
essentially unchanged. *[02 §3, 13 §5]*

**B12. Are sessions exportable? — RESOLVED in principle: yes, eventually. Not an
early priority.** Sessions are marked internal and free-to-migrate
([13 §1](13-schemas.md)) *because* nothing exports them, so this has a
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
The [13 §7](13-schemas.md) split makes it clean: a prologue is a *session*
travelling in a package, not a variant of Setup. *[02 §7]*

---

## C. Mode and pipeline questions

**C1. Names.** "Messages / Scene / Adventure", with Adventure presets "Campaign"
and "Chronicle". All six names are open, and "Chronicle" is doing a lot of work
for what is likely the most-used mode. *[03 §1]*

**C2. Mixed voice within a turn** — a narrator paragraph followed by embodied
dialogue from two characters, stitched into one message. Powerful; multiplies
latency and failure modes. Mode-preset capability rather than per-turn toggle?
*[03 §3]*

**C3. Multiple player-controlled party members** — may one human author two
characters? Cheap to allow structurally; it is also where real multiplayer would
attach. *[03 §8]*

**C4. Turn job durability across server restart.** Proposed 1.0 answer: not
resumed, but recorded as failed with blocks intact so it can be re-run rather
than lost. *[04 §2]*

**C5. Steps that suspend for player input.** [09 §4.2](09-infinite-worlds.md):
Infinite Worlds can present a choice or request free text mid-turn and store the
answer. Our `StepDefinition` cannot — a turn runs to completion. Proposed: a
step may return a *suspend* outcome carrying an input request; the turn job
parks, the event stream publishes it, the answer arrives as an intent, the turn
resumes. Fits the server-authoritative model well, but it makes turn jobs
long-lived and interacts with C4. *[03 §6, 09 §4.2]*

**C6. One expression language for both templates and rules.**
[09 §6](09-infinite-worlds.md): Infinite Worlds ran on purely declarative
triggers for years and then added an expression language. Assume we will need
one, and make it the same language used for block rendering (Liquid is proposed)
rather than growing a second. Open: whether Liquid is actually a good fit for
rule *conditions*, and what query surface collection-valued channels need.
*[03 §5, 07]*

**C7b. Plot hooks — scope at 1.0.** [02 §4.1](02-data-model.md) adds an authored
pool of discrete major plot turns, fired by a selector step
([03 §6.1](03-modes-and-turn-pipeline.md)). The *schema* is cheap, forecloses
nothing, and should land at 1.0 so packages authored early stay valid. The
*selector* is a real feature and its pacing judgement is an opinion — open
whether a simple built-in ships at 1.0, whether it is replaceable the way
retrieval is, and whether it is core or an extension. Also open: whether hooks
are separately shareable as "hook packs" (lean: no, their value is specificity).
*[02 §4.1, 03 §6.1]*

**C7. Authored rules — the vocabulary itself.** [09 §3](09-infinite-worlds.md)
proposes taking Infinite Worlds' trigger vocabulary close to wholesale as a
starting point. Open: which conditions and effects make the 1.0 cut, how the
vocabulary is versioned, and whether AI-evaluated fuzzy conditions ship at all
(IW caps them at ten per world and warns they produce false positives).
*[09 §2, §3]*

**C8. Branch snapshot interval and eviction.** [10 §4](10-branching.md) makes
channel-state snapshots a derived cache so branch creation stays O(1) and
materialisation stays bounded. Open: the interval, and whether old snapshots are
evicted. Needs a default, cheap to tune later. *[10 §4]*

**C9. Unnamed-sibling retention.** [10 §6](10-branching.md) is now **decided**:
swipes and branches are one mechanism, so discarded swipes are permanently
recoverable — something none of the sources offers. What remains open is
presentation, not storage: a long session accumulates many unnamed siblings, and
the history view must not become a tree browser by default. Inline
sibling affordance on the node, full tree behind a deliberate action, prune
available. *[10 §6]*

**C10. Cross-branch merge.** Out of scope for 1.0. Recorded only to confirm
nothing in [10](10-branching.md) precludes it — merging is a question about
reconciling two effect sequences, which the log makes expressible even if it is
not easy. *[10 §9]*

**C11. Branch anchor within a multi-message turn. — RESOLVED** by the turn tree
in [10 §3](10-branching.md). A turn is one node however many messages it emits,
so branching from any of them is an operation on that node. The related
ambiguity also resolves cleanly rather than needing a convention: *redo* adds a
sibling, *continue differently* adds a child. Both are offered explicitly.

---

## D. Deployment questions

**D0. Config reload tiers.** [04 §6.1](04-server-multiuser-deployment.md)
annotates every config key `live` / `reconnect` / `restart`, which makes the
restart-required notice derived rather than hand-maintained. Settle the
annotation early: a hand-kept list of settings-needing-restart is wrong within
two releases, and wrong in the direction where a user changes something, sees
nothing happen, and concludes the app is broken. *[04 §6]*

**D0b. Packaging targets.** [04 §5.4](04-server-multiuser-deployment.md) settles
the list: OCI image as the real distribution, a tarball with a systemd unit as
the highest-value non-container artifact, then `.deb` and AUR, plus a Windows
service installer and a Homebrew tap for Apple Silicon. Explicitly declined:
Flatpak, AppImage, Snap, `.rpm`, LXC templates, Intel macOS binaries. Open:
whether Tier 3 lands at 1.0 or after, and whether an in-app update *check* ships
with it. *[04 §5.4]*

**D1. Tailscale target level for 1.0.** Level 1 (detect and show the tailnet
URL) is cheap and captures most of the practical value; Level 2 (tailnet
identity as auth, following SillyTavern's trusted-proxy header pattern) changes
the auth model; Level 3 (`tsnet` embedded node) is a real project. Lean: ship
1, design auth so 2 is a provider rather than a special case. *[04 §5.2]*

**D2. Auto-provision accounts from tailnet identity**, or require an admin to
pre-create them? *[04 §5.2]*

**D3. File access scope and phasing.** [05 §4] proposes `FileAccess = "none" |
"read" | "write"` per account with library-write as a separate flag, shipping
read-plus-zip-download early and deferring write and the in-UI text editor to
1.x. Open: whether `write` should require password re-entry, and whether
library write is admin-only on a shared server. *[05 §4]*

**D4. Truly mobile-optimised layout.** [05 §1] commits to responsive-and-usable
at 1.0 and defers a distinct mobile layout — different navigation, thumb-reach
play surface — as a later project within the same web app. Worth confirming that
is the right ordering versus designing the mobile play surface alongside the
desktop one from the start. *[05 §1]*

---

## E. Questions these documents don't address at all

Flagged so the gaps are known rather than discovered:

- ~~Image, audio and video generation~~ — **now designed** as *renditions*
  ([03 §10](03-modes-and-turn-pipeline.md)). Per-turn and on-demand illustration
  is a 1.0 feature; video and speech are further kinds of the same mechanism and
  are not. What remains open there: whether an on-demand rendition of an old turn
  assembles from that turn's recorded state or from the present, and the
  transcript surface (placeholder while pending, retry on failure) is not yet
  designed.
- **Memory and summarisation *within* a session.** Aventuras has chapters,
  batched summarisation and retrieval; Marinara has rolling summaries and session
  recaps. Still the largest omission. Note one constraint already fixed by
  [10 §5](10-branching.md): summaries must be content-addressed values keyed by
  their inputs, not a mutating running total, or branching stops being cheap.
  Memory *across* sessions is now covered separately in
  [14](14-cross-session-memory.md).
- **Embeddings and vector search.** Assumed available as a retriever
  ([02 §3](02-data-model.md)); no position on what provides it or where the index
  lives.
- **Renditions in the transcript** — placeholder while pending, retry on failure, and an **Illustrate** action on any message ([03 §10](03-modes-and-turn-pipeline.md)). Not yet designed as a surface.
- **Import from SillyTavern chat logs and Marinara/Aventuras exports.** Card
  import is sketched ([02 §2.7](02-data-model.md)); session/chat history import
  is not.
- **Tokenisation.** Budgeting assumes token counts exist. Which tokeniser, how
  it varies by model, and what the fallback estimate is when a provider's
  tokeniser is unavailable.
- **Backup and restore.** Files on disk makes this mostly "copy the folder", but
  the index, in-flight sessions and per-user separation need a real answer.
- **Error and rate-limit handling** across providers, and how a failed turn
  presents.
- **Content filtering / rating enforcement.** `contentRating` exists in the data
  model and nothing says what, if anything, acts on it.
- **Testing strategy.** Notably: the assembler and budgeter are the highest-value
  things to test and the easiest to test well, since the turn record is a
  complete, inspectable artefact.
