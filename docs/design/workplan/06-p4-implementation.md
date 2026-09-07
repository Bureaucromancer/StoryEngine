# 06 — P4 implementation plan

**Status: ~~plan~~ landed**, merged into `main` 2026-08-31 across three merges
— `10e5356`, `4482f55` and `3e0af17`, which is the shape of a phase that
reopened twice.

**Fifteen gate steps and no record of a walk.** Step 1 wants a real imported
library, which the repository does not have and cannot synthesise: it is
person-blocked with lead time, and [26 §3.4](26-manual-ledger.md) is where it
waits with [P5 §3](07-p5-implementation.md) step 6, which wants the same
thing.

*(This status line was written 2026-09-07 at
[P6B.1](24-p6b-playable.md), in the sweep that found five phase documents
still describing themselves as plans. It had said **plan** since before the
phase shipped, which is how a corpus comes to record what was intended
rather than what happened.)*

The revisit the skeleton asked for, performed 2026-08-29
against the repo at `693b266` (branch `p3`, P3.−1 through P3.6 Landed). The
skeleton was drafted during P1 and said so; nearly every one of its "to decide
on revisit" items is decided below, several against ground that moved under it,
and the deviations from its leans are named where they happen. Format follows
[03](03-p1-implementation.md); the readiness audit, honest-size and
still-to-settle sections follow [05](05-p3-implementation.md)'s.

**Amended 2026-08-29, after the plan was written and before P4.0 started:**
Marinara is imported by folder too, on the same footing as SillyTavern. That is
not a scope tweak — it changes what the sweep engine *is* (§1.3), so it had to
be decided before the module skeleton was written rather than after. The
amendment touches §0, §1.2, §1.3, §1.5, §1.8, the stages, the gate and the
honest size, and every place it overturns a decision says so rather than
quietly reading as if it had always said this.

**Citation convention, adopted because the skeleton tripped over it:** two
documents are "10". `10 §N` means [10-schemas](../10-schemas.md); **`testing
§N`** means [10-testing](10-testing.md) — the convention [01](01-work-plan.md)
and [15](15-p2c-first-real-run.md) already use. Likewise **`survey §N`** means
[01-source-survey](../01-source-survey.md), because "01" is otherwise the work
plan. The skeleton labelled the fixture-pair citation "[10 §5.1]" — a label
that reads as the schemas doc, whose §5.1 is *Images on lore* — even though
its hyperlink happened to resolve to the testing doc; the label is the thing
people quote, so the convention fixes the label.

**P4 delivers**, from [01 P4](01-work-plan.md): import of cards, lorebooks and
presets from SillyTavern, Marinara and Aventuras — the largest PORT in the
triage ([triage §4](02-triage.md): Marinara's `import/`, 4,666 lines, "the
single largest body of 'someone already found the edge cases' in any of the
three") — turning an empty install into a realistic library.

**The demo that defines done:** *point it at a real SillyTavern data directory
~~and~~ **or a real Marinara data directory, and** get a populated library, with
a review step showing what resolved, what went to `compat`, and what dangled —
and a converted preset whose block list, read in the workbench over a real turn,
is recognisably the preset that went in.* The last clause got sharper at the
revisit: "read in the workbench" means read over a turn the preset actually
drove, which needs §1.9's one piece of wiring.

**The second arm was added at the amendment**, and it is the load-bearing change
in it. One folder importer can be written as a file walker; two cannot, because
Marinara's library is a relational store where an object is a join across files
(§1.5). Discovering that after P4.0 had written "one sweep engine over an
abstract file source" as a walker would have meant rewriting the engine in the
stage that depends on it most.

**And then stop: PLAYABLE falls here** ([01 §4.1](01-work-plan.md)). P4 is
sequenced before retrieval precisely because synthetic fixtures will not
surface what real cards do, and the four PLAYABLE hypotheses are only testable
against a real library. The checkpoint is a small amount of wiring beyond P4 by
definition — if it is growing, it has been misunderstood. §0 names the one
external dependency PLAYABLE has that P4 cannot supply.

**The posture, in one line** ([10 §8.4.5](../10-schemas.md)): *authored prose
survives intact, order is preserved, depth-injected blocks stay at their depth,
and everything that could not be carried is named in the review rather than
discovered later.* Round-tripping is not a goal and is not promised. §1.6 adds
the half the skeleton missed: "survives intact" is a claim about behaviour, not
only bytes, and it is why the template renderer lands in this phase.

**CI this phase establishes:** the fixture-pair assertion — import the fixture
SillyTavern directory containing both cards and a **chat-completion** preset,
assemble one turn, and assert over `ModelCall.notFilled` that no slot the pair
should have fed went unfed ([testing §5.1](10-testing.md), restated in §3 step
2 — the skeleton's "no slot resolves empty" is unimplementable as written,
§1.1); plus the wild corpus, which must import without crashing
([testing §3.4](10-testing.md)). §1.2 settles which corpus CI can actually
reach.

---

## 0. Readiness — audited 2026-08-29, at `693b266`

The skeleton predates P2A through P3.6. The ground is more ready than it knew
in six places, less ready in five, and moved outright in four.

**More ready than the skeleton knew:**

- **The card reader is already written.** `storage/card/png.ts` has decoded
  SillyTavern's `chara`/`ccv3` tEXt chunks since P1 — V3 preferred when both
  are present, chunk splicing on write, never a pixel re-encode, container
  sniffed by magic number rather than extension — and hands the legacy payload
  back raw with a comment saying conversion "is import's job … and lands at
  P4" (envelope.ts:56–68). The dependencies ([07 §7](../07-tech-stack.md)'s
  blessed pair plus `png-chunks-encode`) are installed. P4 writes converters,
  not parsers.
- **`in-history` placement exists and is tested** — `collect.ts:80–88` routes
  depth-placed blocks aside and `splice()` inserts them into the history run;
  depth counts **messages**, not turns, which is ST's own semantics (the F36
  test at collect.test.ts:503–513 records the doubled-depth bug the earlier
  turn-counting version had). The skeleton attributed this to "the P2
  assembler"; it landed at P3 (commit `5d5eeed`). The precondition is
  satisfied either way, and the converter carries ST depths through 1:1.
- **The collector was built for this.** One collector, driven by data, living
  in `assembly/` and not on a mode — its own header gives the reason: "what
  lets an imported preset work the day it lands" (collect.ts:16–22).
- **The fixture-pair assertion has a better vocabulary than the one it was
  written in.** [05 §7.5] (decided at P3.0) put `notFilled` on the record —
  one entry per preset block that emitted no candidate, with the reason as a
  class (`disabled | not-applicable | no-producer | empty-source |
  unknown-slot`). The assertion is now a statement over reason classes rather
  than an inspection of rendered output. §3 step 2 restates it.
- **P3.3 landed the review surface's substrate**, exactly as [05 §6]'s "do not
  cut the Library subject" line demanded for this phase: provenance rendered
  as rows (`ObjectSubject`'s label map already carries `import: 'Imported'`),
  the revision list (whose source map already carries `import: 'Import'`),
  the as-stored fold, the index-rows projection with shadow rulings, and the
  F19 `(source, slug)` addressing. The dependency is landed machinery, not a
  promise.
- **"Assemble one turn" is cheap.** P3.4's `gatherAssemblyInputs` + `planCall`
  are one shared path the runner and the stateless preview both use; the
  fixture-pair test assembles through the same machinery as everything else.

**Less ready — the gaps this plan turns into scope:**

- **Liquid does not exist.** The schema says a text block's `template` is
  "Liquid, rendered within the block" (preset.ts:208);
  [03 §5](../03-modes-and-turn-pipeline.md) says "Liquid, following
  Aventuras"; [10 §8.4.2]'s macro table converts *into* Liquid — and
  no template engine exists in any package. A `{{char}}` reaches the model as
  literal braces today, and the collector's own comment frames the language as
  arriving "with variable interpolation and imported presets, which is P4's
  review surface" (collect.ts:190–198). §1.6 decides this; it is the largest
  single scope addition the revisit makes.
- **No upload machinery of any kind.** No multipart, no content-type parser
  beyond JSON, no file input or `FormData` anywhere in the client; the one
  request wrapper is JSON-in/JSON-out. `limits.maxUploadMb` is
  [13 §4.3](../13-internal-contracts.md)'s standing example of a `live` key
  that is honestly `unread` until exactly this route exists ("The key names
  uploads and will apply live when there is an upload route; there is not
  one"). P4 opens the first upload route and pays that whole bill (§1.3).
- **No session can play an imported preset.** Sessions copy the mode's default
  preset unconditionally, and the route's comment records the position:
  "choosing a different pack is P7's surface" (routes/sessions.ts:53–54).
  PLAYABLE cannot happen through that. §1.9 decides the amendment.
- **Five slot sources have no producer**: `lore`, `setting`, `examples`,
  `goal`, `channel` all return `[]` with reason `no-producer`
  (collect.ts:305–312). A converted ST preset *will* carry world-info and
  scenario slots; they resolve `no-producer` until P5, by design. The gate
  language is restated accordingly (§3 step 2) rather than left asserting
  both halves of a contradiction.
- **P2C.1–P2C.4 still have not run** — verified on disk: no `captures/`, no
  `packages/server/src/providers/fixtures/`. Those sessions are person-blocked
  and PLAYABLE presumes the proven real-endpoint boundary they exist to prove.
  **P4 does not depend on them; PLAYABLE does.** Stated here so the checkpoint
  is not discovered blocked: the P2C sessions must run before or alongside P4,
  and PLAYABLE does not happen against a stub.

*Three more, found at the 2026-08-29 amendment by reading the code this plan
leans on rather than the design it cites:*

- **The operational store is session-shaped**, so §1.3's "the sweep lands in the
  operational store with the existing job/idempotency vocabulary" is not free.
  `job.session_id` is `not null`, `idempotency`'s primary key includes
  `session_id`, and `draft` and `event` both foreign-key to `job`
  (state/migrations.ts:41–127). An import job has no session. The migration
  chain is stepwise and may never drop a table (migrations.ts:6–28), so this is
  an append rather than an edit — §1.3 decides which append. One thing *is*
  free: `job.progress` is a declared progress key with no emitter anywhere
  (state/events.ts:39, :52), and import is what the slot was left open for.
- **The card reader reads `tEXt` only** (png.ts:100, :203). Cards in the wild
  also carry their payload in a compressed `zTXt` chunk — Character Tavern
  writes them that way, and Marinara's importer reads both
  ([survey §3](../01-source-survey.md)). The failure mode is the bad one: such
  a file is not a card that fails to convert, it is a file the sweep never
  recognises as a card, which files it under "not recognised" and reads to the
  person as *this tool cannot open my cards*. P4.0 widens the read, and the
  fixture corpus gains a compressed-chunk card.
- **The wrapper nit is wider than §1.6 says.** The substitution at
  collect.ts:395 is first-occurrence-only, which §1.6 names — but the filled
  text is also the *replacement string*, so the `$&` and `$1` replacement
  patterns occurring inside imported prose silently rewrite the output.
  Third-party prose is exactly where such sequences turn up. The P4.0 fix is
  all-occurrences **with a function replacement rather than a string one**, and
  the test asserts both halves.

**Ground that moved:**

- **The treatment slot literal never made it into code.** The Setting→Treatment
  rename ([10 §6]'s blockquote) updated the docs — [10 §8.2] and the
  [10 §8.4.1] marker table say `{ of: "treatment" }`, and [13 §1.1]'s
  `BlockSource` spells the same arm `kind: "treatment"` — while every line of
  shipped code, the scene preset, the workbench fixtures and the published
  JSON Schema artifact say `'setting'`. An importer written to the marker
  table emits presets the shipped `/0` schema rejects. §1.7 settles it.
  *Audit correction, 2026-08-29:* "never made it into code" is half right, and
  the half it gets wrong is the dangerous half. `treatment` **does** appear in
  shipped code — as the `samples.from` carrier value (preset.ts:128,
  collect.ts:130, :334), which is a different axis from the slot kind
  (preset.ts:132–135). The rename has to move the slot kind without touching
  the carrier; a find-and-replace over the word collides two axes into one.
- **`LoreScope` shipped with two arms, not [02 §3.4]'s three** — session
  scoping was deliberately moved to the session's own lore links
  (lorebook.ts:30–44). An ST book scoped to a chat has no representable
  target; the review names the drop (§1.4).
- **Marinara moved ~~twice~~ three times, and the pin it asked for now exists.**
  Its storage went SQLite → JSON snapshots under `storage/tables/` during this
  project's design window — and then moved again, to storage format 4, which
  shards sixteen tables into per-chat directories. The flat
  `storage/tables/<table>.json` shape this document described is an *older*
  layout. That is precisely the staleness the "pin a commit" instruction was
  written to prevent, and it arrived before anyone acted on the instruction.
  The pin is now `34442e26d` (v2.4.3, 2026-08-18) and the layout is written
  down in [survey §1](../01-source-survey.md) rather than left to §1.5's two
  words. The `feat/scenarios` branch is still gone from the remote
  ([triage §2A.3]), so the skeleton's "Marinara scenarios → Setup" example
  still targets an object that does not ship — but a local checkout preserves
  it, so the design is readable, and `scenarios` is a table name an install may
  carry and the dispositions must therefore cover.
- **A hazard on the exact path imports bulk-use:** finding 8 in the P2C log
  ([16](16-p2c-log.md)) — a broken library file becomes permanently
  unwritable *and* undeletable (three
  successive 412s with a byte-identical hash; the only exit is a text editor).
  P4.0 verifies it fixed or adopts the fix, because a wild-corpus object that
  lands broken, or a re-import over one, walks straight into it.

---

## 1. Decisions this plan makes

### 1.1 Presets are sequenced first — kept, and the tables sharpened

[01 P4](01-work-plan.md) decides this and it holds: presets are what make an
imported library *playable* rather than merely present, and the conversion is
designed against ST's actual format ([10 §8.4]). The three obligations from the
first version stand — each a silent-failure class:

- **Connection fields drop unconditionally and are reported**
  ([10 §8.4.4](../10-schemas.md)). Not a prompt, not a choice; there is nowhere
  to put them, which is the type refusing rather than a check someone could
  forget. *Mechanism decided:* the drop list is a **vendored snapshot of ST's
  own `sensitiveFields` category**, committed with a provenance comment naming
  the source file, commit and date, plus a test asserting it covers the
  §8.4.4-named fields — "derived from that category rather than enumerated by
  hand" without a build-time dependency on ST's repository. Credentials are
  the one class of source field that must **never** land in `compat` — the
  preservation rule's explicit exception.
- **Depth-injected blocks keep their depth** — `in-history` placement, which
  exists and counts messages exactly as ST does (§0). Depths carry through
  1:1; any table converting turns↔messages would reintroduce the doubled-depth
  bug F36 fixed.
- **Every lossy conversion is named in the review** — the text-completion
  preset that was "mostly sampler settings for a local backend; 6 of 41 fields
carried over" says
  so.

Corrections and closures the revisit makes to the conversion contract itself:

- **It is nine special-cased fields, not eight.** [10 §8.4.3]'s table has nine
  rows and its own body says "Nine fixed fields collapse into two general
  properties"; only the heading, the §8.2 comment beside `appliesTo`
  (10-schemas.md:1178), the skeleton, and the code comment at preset.ts:170
  say eight. All four are fixed in P4.1's commit — fixing the heading alone
  would leave the same wrong count standing two sections up.
- **Text-completion sampler fields land in `compat`, not the floor.**
  [10 §8.4.2] says they "drop"; the shipped `GenerationParams` comment
  (preset.ts:265–269) says they "land in `compat`". The code comment wins —
  it is the reading consistent with [10 §2]'s preservation rule and
  [00 §2.4]'s "nothing is lost and re-export is possible" — and §8.4.2 is
  amended in the same commit. The review still reports the carried-over ratio.
- **The conversion targets are the code shapes**, which are more specific than
  the doc's prose: `openai_max_context` → `BudgetPolicy.maxContextTokens`
  (which can only *narrow* the resolved window, never substitute for it —
  budget.ts:36–48 — and the review says the source value was absolute);
  snake_case sampler names → the camelCase `GenerationParams` fields,
  `openai_max_tokens` → `maxTokens`; `openai_model` and friends →
  `modelHint.preferredModelIds`.
- **Budget priorities are ours and the review says so.** [00 §2.6] requires
  every block budgeted; ST presets carry no priorities. Converted blocks get
  one flat documented default (50 — the same value the assembler assumes for
  an undeclared candidate), and the review states plainly that budget
  priorities are StoryEngine defaults, not the source's. Inventing a ladder
  would imply a fidelity the source file does not contain.
- **`advisory: false` on every converted block.** Nothing in ST's preset
  format is guidance-shaped, an import-declared advisory block is honoured by
  the collector (collect.ts:345–348), and an advisory block reaching a future
  effects-purpose call **aborts the turn** (`AdvisoryLeakError`,
  assemble.ts:180–189). The converter never sets the flag.
- **Per-character `prompt_order`**: only the global order (`100000`) converts;
  a preset carrying genuinely per-character orders gets one preset plus a
  warning naming the characters ([10 §8.4.2]). *The half §8.4.2 left
  unstated:* when no global order exists, the group default (`100001`)
  converts in its place with a review note; when both exist the group default
  drops-with-review.
- **`sysprompt` presets**: `content` → a `TextBlock` at the top, `post_history`
  → a `TextBlock` **in sequence after the history slot** — not
  `in-history fromEnd: 0`, which would put it inside the run and move under
  trimming; "after history" in ST's sysprompt sense is a fixed position.
- **`injection_trigger[]` → `appliesTo`** carries values verbatim — `CallKind`
  is an open string by rule ([10 §8.2]), so unmapped trigger names ride
  through and render as `not-applicable` skips in modes that never make such
  calls, visible in `notFilled` rather than lost.
- **The macro table is P4.1 work.** [10 §8.4.2] promises "a closed mapping
  table" and does not contain one; authoring it — and the render context it
  maps onto — is a named deliverable, not an assumed input (§1.6).

### 1.2 The corpus licensing question is settled before code — and the CI split decided

[testing §5](10-testing.md)'s answer stands: synthesised cards for structural
edge cases in the repo, a handful of explicitly-permissive real ones, and a
larger private local corpus for manual verification that never enters the
repository. A prerequisite task, not a during-P4 discovery.

**The skeleton's "wild corpus … in CI" contradicted that answer** — CI cannot
run a corpus that never enters the repository, and [testing §6]'s nightly "full
wild-corpus import run" reads as if it could. Decided: **the corpus CI runs is
the in-repo set** (synthesised + permissive), per-PR for schema validation and
nightly for the full import run; **the private corpus is walked by hand** at
gate time and whenever fidelity bugs arrive, findings triaged into synthesised
fixtures that *can* enter the repo. A clarifying sentence goes into testing
§5/§6 with P4.0. The parses-but-is-wrong table pattern
([12 §4.2](12-p2-manual-gate.md) — `null`, a string, a number, an array, an
object missing each required field, asserting a status rather than a throw) is
the test shape for every import parser.

**Amended 2026-08-29: the private corpus does not exist, and the plan stops
assuming it.** "A prerequisite task, not a during-P4 discovery" described a task
nobody has done and nobody currently can — there is no used SillyTavern data
directory and no used Marinara install on hand. So: **the in-repo synthesised
corpus carries the whole phase, for both folder sources**, and the hand-walk of
a real library becomes a named outstanding manual task on the P2C precedent —
person-blocked, blocking nothing in P4, written down here so it is not
discovered missing at PLAYABLE. Gate step 1 is restated accordingly (§3).

*And it now has an owner, which it did not on the day it was written
(2026-08-30).* A task recorded only in the phase that cannot supply it is a task
nobody owns, so the prerequisite is written into
[P5 §1.6](07-p5-implementation.md) — the document whose own argument for its
shape depends on having real books — and [16 §6](../16-lorebooks-as-a-format.md)
records that its falsification counts wait for it. P4 is unaffected either way;
what changed is that the phase after this one has stopped assuming this one
produced a corpus.

**What synthesis means for a source whose library is a database.** For
SillyTavern it means what it always meant: hand-authored cards, worlds and
preset files in a fixture directory. For Marinara it means a fixture **data
root** — a `storage/manifest.json` and hand-authored table snapshots, written
against the pinned schema, including a sharded table so the reader's two layouts
are both exercised. The three local source checkouts
([survey §1](../01-source-survey.md)) are **schema oracles, cited by commit and
never vendored**: the shapes come from reading them, the rows are ours. This
matters beyond tidiness — a Marinara install ships with a default character, and
copying it into our fixtures would be redistributing somebody's authored card
under cover of a test, which is the exact thing [testing §5](10-testing.md)'s
licensing answer exists to prevent.

### 1.3 Where import runs, what a unit of import is, and how bytes arrive

**A server-side import module — and this is forced, not leaned.**
[12 §3–§4](../12-extensions.md) has no importer hook and `HostApi.library` can
only `propose`, never bulk-write; converters-as-extensions would be a design
change to the extension contract, not a P4 option. The module lands as
`routes/import.ts` over an `import/` module, in the shape `library.ts` sits
behind `routes/library.ts`, writing through `create()`/`update()` — which is
what buys watcher suppression, synchronous indexing (read-after-write is a
[13 §5] invariant for the server's own writes), the content-hash discipline,
and slug allocation (`resolveFreeSlug` already suffixes collisions from `-2`,
so a corpus of same-named cards is safe at the folder level).

**Three write-path facts the skeleton's "same write path" sentence hid, now
stated:**

- **A first import writes no version record, and that is correct.** History
  snapshots the *replaced* state ([13 §1.6]; history.ts:160–164) and a create
  replaces nothing — `create()` takes no attribution at all. The
  `{ kind: 'import'; from }` arm (typed since P1, "no writers until their
  phases") fires when an import **overwrites** an existing object through
  `update()`, which already accepts the attribution. Re-import is that arm's
  first writer; nobody should "fix" the importer to stamp a spurious v1.
  `from` holds the source file named per the foreign-path doctrine below.
- **`create()` cannot carry card pixels** — new actors get a built 1×1
  transparent PNG and no parameter accepts a canvas. P4.0 adds the deliberate
  extension: a composer that splices our envelope into the imported card's
  pixels and still goes through `writeAtomic` + `ingestFile` + the kind queue
  + the id-conflict check — a sibling of `create()`, never a bypass.
- **The legacy `chara`/`ccv3` chunk stays in the imported file, and the review
  says so.** The codec's write path preserves foreign chunks; stripping them
  would destroy the file's validity as an ST card, which is someone else's
  data. The cost — other tools keep reading a payload that no longer moves
  when ours does — is accepted and named, per object, in the review.

**Id policy: mint fresh `uuidv7` ids, always.** The schema deliberately accepts
foreign ids (common.ts:34–41), but `create()`'s duplicate check is **global
across owners** — carrying source ids through would let user B's import 409
against an object of user A's that B cannot even see, a hole in exactly the
anti-leak posture the 404-for-everything rule exists to keep
(library.ts:283–305). Source identity lives in `Provenance.originalFilename`
instead — which is enough, because ST objects are identified by filename, not
by id (V2 cards carry none; a world file's identity *is* its name).

**Re-import identity — the rule gate step 6 needed and nothing had decided:**
[02 §7.2]'s "link or duplicate" is *package* posture, keyed on shared
StoryEngine ids that ST files do not carry; the F19 shadowing machinery covers
one id copied into two folders and is the wrong tool. The rule: **same owner +
same kind + same `Provenance.originalFilename` is a re-import candidate.** If
the converted output is byte-identical to what is stored, the object is
skipped and reported unchanged (the no-op rule, extended to import). If it
differs, the review offers **replace** (through `update()` with the `import`
attribution — the history arm fires, and the person's own edits are what the
snapshot preserves) or **keep both** (a fresh id, a suffixed slug, both named).
Nothing doubles silently, which is the whole of what step 6 asks.

*The second source makes the rule work harder, decided at the amendment.* A
Marinara object has no filename — it is a row. `originalFilename` therefore
holds the **source-relative path of the file the row came from, plus the row's
own id within it** (`storage/tables/characters.json#<id>`), which keeps the
field doing what it does for every other source: naming the thing on disk that
this object came out of, in a form a person can go and look at. Marinara ids
are stable within an install, so a re-import of the same root matches; a
re-export from a *different* install does not, and should not. That is the
limit §6.2 is watching, now with a second source's evidence to watch it with.

**What a unit of import is** — widened from the skeleton's three examples to
what [02 §5.2] already committed to: a bare PNG, a V2/V3 card PNG, a **CHARX**
zip (card plus assets; the assets land in the object's `assets/` directory), a
JSON card, ~~a `.seactor` folder-zip,~~ a lorebook JSON — including an
entry-subset file, which [10 §5.2] makes a lorebook like any other — and a
preset JSON (chat-completion, text-completion, or sysprompt). Plus the
directory sweep.

*Corrected 2026-08-31, at §7.5's repair.* **`.seactor` never belonged in that
list**, and it contradicted this document's own [§4](#4-out-of-scope-deliberately)
two sections later: `.seactor` is *our* container, the actor-sized sibling of the
`.sepack` that §4 puts out of scope in as many words — *"our own format, not a
port; P11-ish"* — and `layout.ts:74–79` records P4.0 reading it exactly that way,
*"P4 imports other people's formats and deliberately not our own."* Nothing
writes one, either: there is no export path in this build, so an importer for it
would have been a reader for a format with no writer, which [01 §2.2] forbids
under the same rule that bans a control that does nothing. CHARX is the half of
that list that was real, and it is built.

*Widened again at the amendment, for the second source:* a **Marinara data
root**, a **Marinara profile archive** (the same tree zipped), and a
single-object **`.marinara.json`** envelope — `{ type, version, exportedAt,
data }` over the eight `ExportType` values, of which characters, personas,
lorebooks and the two preset types are ours to convert
([survey §1](../01-source-survey.md)). All three were taken, rather than the
folder alone, because the envelope and the archive are nearly free once the
store reader exists: an archive is a root read through a different file source,
and an envelope is a single candidate in the shape the store reader already
emits.

**Transport — both, from day one** (decided at this revisit, with the cut
order priced in §5):

- **Single files are a browser upload.** `@fastify/multipart` (a new
  dependency, argued into [07 §7] when it lands), the CSRF header echoed like
  any mutation, and `limits.maxUploadMb` enforced **per request** off the live
  config reference — which flips its `LIVE_APPLIERS` row from `unread` to
  `applied` — a row the suite pins from both sides: [13 §4.3]'s coverage test
  requires the entry to exist, and `config.test.ts` currently asserts the row
  *is* `unread`, so the flip is a deliberate two-file edit rather than a
  drive-by. Fastify's
  constructor `bodyLimit` stays as the outer bound; the honest tier is the
  per-request check.
- **The directory sweep runs both ways.** A **server-side path**, gated on the
  `fileAccess` capability — ~~its first real teeth; the grant surface is the
  admin accounts page, per [01 §2.3]'s no-configuration-without-a-surface
  rule~~ — for the self-hosted single box the demo describes. *Corrected
  2026-08-30, and it was a permission-widening error rather than a wording
  one:* `fileAccess` is specified in three places as a file browser **over the
  user's own directory**, and [05 §4.2]'s table scopes it to roots under
  `/data/users/<own handle>/`. A sweep reads a path the user names anywhere on
  the host, which is outside every row of that table, so gating on the
  capability as written would have widened it by implication — the exact
  failure [05 §4.2.1] exists to record. **Decided: widen it by decision, with
  `/data` carved out** — the new [05 §4.2.2] holds the argument, the bounded
  grant and what it costs. Three consequences for this phase: a sweep root
  inside `/data` is **refused**, so the capability never becomes a route to
  another user's library; the grant surface is not built, because
  `AdminAccounts.tsx` already renders the control — what P4.4 ships is moving
  it out of the "Recorded for later" fieldset and **relabelling it**, since
  three labels that say *file browser* over a permission that now also means
  *read a path I name* are worse than no permission at all; and the
  capability's own code comment (accounts.ts:75) becomes wrong the day the
  sweep lands, so it rides the same stage (§6.4). And a **browser
  directory upload** (`webkitdirectory`, many files with relative paths
  through the same multipart route) for a client that is not on the server's
  machine. ~~One sweep engine over an abstract file source with two adapters —
  a local-path walker and an uploaded batch — so the converters never know
  which transport fed them.~~ **That sentence described a file walker, and a
  file walker cannot express Marinara. Replaced below.**

**The engine's unit is a candidate, not a file — decided at the 2026-08-29
amendment, and the reason the amendment could not wait for P4.3.** "An abstract
file source with two adapters" quietly assumes that one file yields zero or one
object. That is true of SillyTavern, where the tree *is* the library: one PNG is
one character, one JSON is one world. It is false of Marinara, where
`characters.json` holds every character at once and an actor is a join across
`characters`, `character_card_versions`, `character_images` and a file under
`avatars/` ([survey §1](../01-source-survey.md)). Written as a walker, the
engine would have had to grow a second, unlike path for Marinara inside the
stage that depends on it most.

So the seam moves up one level. **A source reader opens a root and yields import
candidates**; a candidate carries its kind, the payload its converter expects,
and the source-relative name that becomes its provenance. Three readers —

- a **SillyTavern tree walker**, which is the degenerate one-file-one-candidate
  case and is the check on the abstraction: if the ST path gets *more*
  complicated in order to accommodate Marinara, the seam is in the wrong place;
- a **Marinara store reader**, which loads the tables an object needs, joins
  them, and emits one candidate per row rather than per file;
- an **uploaded batch**, which is a walker over relative paths instead of a
  directory.

— over transports that sit *below* them: a local path, a multipart upload, and
an archive. The converters stay ignorant of every bit of it. A card converter is
handed a card; it never learns whether the bytes came from a PNG on disk, a row
in a JSON table, or an entry in a zip.

**A root is classified by probing it, never by what someone typed.** The person
points at a directory; the engine says what it is:

| Probe | Verdict |
|---|---|
| `storage/tables/` exists | a Marinara data root |
| `settings.json` beside `characters/` and `worlds/` | a SillyTavern user directory |
| a zip containing `storage/tables/` | a Marinara profile archive |
| JSON whose top level is `{ type: "marinara_…", version, data }` | a Marinara envelope |
| a card, lorebook or preset file | a single-file import (§1.3's existing units) |

**Two probes matching is reported and refused, never guessed** — a wrong guess
converts somebody's library through the wrong tables, and the review would say
it went fine. **No probe matching is not a refusal**: the directory is swept as
loose files, which is the walker's degenerate mode and the right answer for the
folder of cards somebody assembled by hand. The review names which verdict the
root got, because "I pointed it at my Marinara folder and it found four cards"
is otherwise indistinguishable from success.

**A known format converts; an unknown one is refused with its number in the
review.** Marinara's store refuses outright to open a format newer than it knows
(`StorageFormatTooNewError`), and that is the posture to copy rather than
improve on: a best-effort parse of a layout we have not seen produces a
plausible, wrong library. **And the manifest states the version without
establishing the layout** — Marinara's own comment records that a crash between
the shard migration and its first flush leaves sharded data under a version-2
manifest. Whether a table is a file or a directory of shards is a question for
the filesystem, asked per table.

**A live install is refused, and the message says why.** A running Marinara
saves on a 750 ms debounce and marks itself with `.writer-lease` and
`owner.json`; a store part-way through the monolith-to-shard migration carries
`.migrating`. Reading either produces a torn library, and it produces one
*quietly*. The sweep stops before it starts and the review says **close Marinara
and try again** — which is a refusal a person can act on, not a crash they have
to interpret.

**`.bak` siblings are skipped and counted.** Every table and the manifest may
have one, and it holds the same rows rather than more of them. A reader that
takes both doubles the library, and does it in the way that is hardest to
notice, because both copies are valid.

**One poisoned row never aborts a table** — the row-level sibling of the rule
below, and it earns its own sentence because Marinara's rows carry their cards
as a JSON string inside the JSON row. That is two parses per character, and the
inner one can fail on its own. A row that will not parse is one `warn`-class
line in the review; the table around it converts.

**An archive is a root, with the bounds an archive needs.** Entry count,
per-entry uncompressed size, total uncompressed size, and refusal of any entry
whose path escapes the extraction root — the failure modes are old and the
numbers are not the interesting part (Marinara caps its own profile import at
8,192 entries and 2 GiB uncompressed, which is the right order of magnitude).
`layout.assertReal` is the existing symlink door and the extraction uses it.

**The sweep is a job — and the vocabulary is an append, not a reuse.** A real ST
directory is years of data; a request that walks it inline times out. The sweep
lands in the operational store ([13 §5.1]), emits progress, and announces
completion as `system.notice` — the closed notification list
([06 A2c](../06-open-questions.md)) is not widened for this. Its durable output
is the review report (§1.4). ~~with the existing job/idempotency vocabulary~~
**The existing vocabulary cannot hold it**: `job.session_id` is `not null`,
`idempotency`'s primary key includes `session_id`, and `draft` and `event` both
foreign-key to `job` (§0). Decided: **sibling `import_job` and `import_event`
tables, appended to the migration chain as a new step** — rather than making
`session_id` nullable, which would weaken a uniqueness index and two foreign
keys that are load-bearing for turns in order to spare import one table. The
migration chain is append-only by its own rule (migrations.ts:6–28), so this is
the shape it was built for. Import emits through the already-declared,
never-emitted `job.progress` key (state/events.ts:39).

**Foreign-path doctrine — new, and written back into [13 §4.1]:** F22 and the
log rules govern *library* paths; nothing governed the source side. The rule:
**source files are named relative to the sweep root** — in logs, in the review
report, and in `VersionRecord.from` — never absolute. The root itself is
recorded once, on the job's own record, where the person who typed it can see
it; it never rides per-file rows or log lines, because the log is the thing
people paste into issues. One unreadable file is a `warn` (`error` is for what
the server could not do; a refused foreign file is the system working —
[13 §4.1]), and **one poisoned file never aborts a sweep** — F22's original
sin, one bad folder aborting a whole scan, pre-paid and not repeated.

### 1.4 The review is a feature, not a log — post-hoc, addressable, structured

**Decided: import commits immediately and the review reports loudly — against
the letter of [05 §5](../05-ui-surfaces.md)**, whose bullet reads "let the user
fix it before committing". That sentence predates the machinery that makes
post-hoc the better answer: a staging area is a second library to maintain
([01 §2.2]'s nothing-built-to-be-discarded, in miniature); dangling references
are survivable, visible and non-blocking *by stance* ([00 §3.3] — resolve by
id, fall back to name match, show missing and carry on; import is exactly
where the name-match middle step earns its keep), so there is nothing a person
must fix before commit for the library to be safe; and a three-hundred-object
sweep gated per-object on a human is not a review, it is a chore. The
amendment is written into 05 §5 in the stage that lands the surface, striking
the old words rather than editing them silently.

**What post-hoc costs, paid rather than hand-waved: delete lands in P4.** The
server can already delete (the tombstone settling window and winner promotion
shipped with the index); the *client* has no delete affordance for library
objects at all, so "the trash and version history make it reversible" was only
true on disk. P4.4 adds the client affordance and the api.ts function, and the
review's undo copy points at it.

**The review is a routed, addressable view** — the compare view's argument
verbatim ([P3 §7.2]): a report someone consults after the fact, pastes into a
bug report, or reopens next week wants an address, and a panel scoped to the
main view can never be one. The report rides at its own route, keyed by the
import job's id; the panel over it stays an ordinary reader.

**The report is structured data, never stored prose.** [07 §12.5–12.6] and
[06 A2d]: the server emits facts — reason classes, counts, field lists,
`{key, params}` — and the sentence is composed at display time ~~through
Intl/ICU~~ **on the client, from the class**. A report stored as English
sentences would be A2d's latent bug rebuilt. The reason-class vocabulary is a
shared type (the client imports only from `@storyengine/shared` — [P3.0]'s
precedent for the turn record), and the client label maps stay open with
raw-word fallback, because a newer build's class can arrive from disk.

*Corrected 2026-08-30, because "through Intl/ICU" named machinery that does not
exist* — the same shape of error §1.6 caught for Liquid, and smaller only
because the fix is a sentence rather than a dependency. `format.ts` is `Intl`
for dates, numbers and durations; there is no message catalogue, no ICU
formatter and no i18n dependency anywhere in the workspace, and the label maps
are literal English objects. The catalogue extraction that would change that is
[P11 §1.3](22-p11-implementation.md)'s pre-beta sweep. So P4 renders through
the label maps this codebase already has — and the decision above is what keeps
**the largest body of user-facing prose any phase has added** off that sweep's
debt list, where [P3 §3](05-p3-implementation.md)'s free-English block `reason`
already sits. Emitting `{key, params}` now is the cheap half; it is only cheap
before the strings are written.

**Per-kind honesty the skeleton's "what went to `compat`" glossed:** Actors
and Presets carry `compat`; Lorebooks, Treatments and Setups carry `metadata`
only. The review says which escape hatch each unconvertible field landed in —
or that it was dropped, with its class. The dropped-and-named list for
lorebooks is the full six from [02 §3.3]: `dynamicState`, quest structures,
`embedding`, `relationships`, `activationConditions`, `schedule` — the
skeleton listed three.

**Three categories of non-conversion, distinct in the review, because they
answer differently:**

- **Not converted, by position** — instruct and context templates
  ([00 §2.2]): nothing chat-shaped exists for them to become, ever.
- **Not yet importable** — needs machinery from a later phase (channel-shaped
  state, setup-shaped config): recorded, named, and honest about *when*.
- **Not recognised** — files the sweep could not classify: skipped and
  counted, never silently.

The review's "needs a look" copy points at the file on disk or the detail
page — only actors have an editor, and a flagged macro in a preset is repaired
with a text editor, which the watcher and the as-stored fold already honour.

### 1.5 Marinara and Aventuras — ~~all three sources, survey first~~ one survey done, one still gated

Decided at this revisit: P4 keeps all three sources, and **P4.3 opens with a
survey stage whose questions are enumerated now** rather than discovered
mid-stage — because the survey ground moved (§0) and the skeleton's own
examples went stale.

**Amended 2026-08-29, and this is the amendment's subject.** The survey was
performed, against the pin, and it answered its own questions: the storage
layout is written down ([survey §1](../01-source-survey.md)), and the preset
format turns out to be documented in type definitions rather than absent. What
was scoped as *a survey stage, then conversion of whatever it confirms* is now
**a conversion stage with the shape of the work known**, and Marinara stands
beside SillyTavern in the demo (header) and off the cut list entirely (§5).

**Marinara** — `Pasta-Devs/Marinara-Engine` v2.4.3, pinned at `34442e26d`
(2026-08-18); a data root, a profile archive or an envelope (§1.3), read
through the store reader:

- Cards are literally V2 plus fifteen engine fields — they ride P4.2's ST card
  path with the extensions going verbatim to `compat` ([00 §2.4]). The
  difference from ST is arrival, not shape: the card is a JSON string inside a
  row of `characters.json` rather than a chunk inside a PNG, and its portrait is
  a separate file under `avatars/` rather than the pixels the card is written
  on. So an imported Marinara actor gets a **built** card ([02 §5.2]'s blank
  pixels, or the referenced avatar composed in through §1.3's composer) rather
  than a foreign one preserved — which also means the "legacy chunk stays in
  the file" cost (§1.3) simply does not arise for this source.
- Lorebooks are the interchange format ([02 §3]) and land nearly unchanged;
  Marinara's *categories* map to `tags`, because `Lorebook.category` was
  removed deliberately ([19](../19-world.md)). The book is a join: `lorebooks` for the
  book, `lorebook_entries` for the entries, `lorebook_folders` for the
  structure P5 will care about, and `lorebook_{character,persona}_links` for
  the links that become ours or dangle.
- ~~**The preset format is undocumented** — the survey's first question,
  against the pinned commit, before any conversion is budgeted.~~ **It is
  documented, in `Marinara-Engine/packages/shared/src/types/prompt.ts`, and it
  is the closest thing to our block model that any source has.**
  `PromptSection` carries `content`, `role`, `enabled`, `isMarker` with a
  `markerConfig`, `injectionPosition` of `ordered` or `depth`, an
  `injectionDepth` counted from the last message, and an `injectionOrder` for
  ties. Those are our text block, our slot block, our `in-sequence` and
  `in-history` placement, our `fromEnd` and our `tiebreak`, one for one — which
  is unsurprising, because Marinara's prompt manager and ST's are the same
  lineage ([triage §4]) and [10 §8.4] converted against that lineage. The
  conversion **reuses P4.1's machinery rather than duplicating it**, and that
  is why this stage stopped being survey-dependent. What does not map, and is
  named rather than discovered: `MarkerType` has ten values, of which
  `chat_summary` is P8-shaped and `id_macro_cards` and `agent_data` have no
  home at all — recorded with the "not yet importable" and "not converted"
  classes respectively (§1.4); `wrapFormat` and the per-section
  `wrapInXml`/`xmlTagName` become our `wrapper` string; `forbidOverrides`,
  `PromptGroup` nesting and the `conversationPrompt`/`gamePrompt` mode
  templates land in `compat`; `parameters` splits across `GenerationParams` and
  `compat` exactly as ST's samplers do (§1.1); and
  `variableGroups`/`variableValues` and `ChoiceBlock` are the shape
  `PresetVariable` was adopted from, so they carry across and **stay inert**,
  which the review says rather than implies.
- **Scenarios do not exist** in what ships. The `feat/scenarios` branch is
  gone from the remote and no scenario type or table is in the tree, so the
  skeleton's "Marinara scenarios → Setup" line dies here. ~~There is nothing to
  record.~~ **There is something to record, on two counts:** a local checkout
  preserves the branch (§0), so the design is readable rather than lost; and
  `scenarios` is a table name an install that ran that branch still carries,
  which §1.8 meets as its worked example of the *unrecognised* class rather
  than as a surprise. `GameSetupConfig` (~70 fields mixing narrative and
  production) remains Setup-shaped later machinery — recorded, not converted,
  with [00 §3.2] stripping the production half if it ever converts.
- Personas convert as actors — the unified card exists because two of three
  sources regret the split ([survey §4](../01-source-survey.md)). Marinara's
  live in their own tables rather than, as in ST, in the settings file
  ([survey §3](../01-source-survey.md)), which makes this the easier of the two
  persona paths.
- **What must never land, and the source's own behaviour agrees.**
  `api_connections` and `api_connection_folders` are credentials, and the data
  root's `.encryption-key` is a key. Marinara's own profile importer
  *quarantines* connection credentials, custom tools, instructions, extensions
  and themes rather than importing them — independent arrival at §1.1's
  position from a project with no stake in ours. Ours is stricter: dropped, not
  quarantined, and never into `compat` (§1.1).

**Aventuras** (v0.7.8, single-user Tauri app, "local database"):

- ~~**The extraction path is the survey's gating question — nothing documents
  how data leaves the app.** Until an artefact exists that a person can hand
  the importer, conversion cannot even be designed. If the survey finds none,
  P4.3 ships the finding, the review's "not yet importable" category covers
  the formats, and that is a completed stage rather than a failure.~~

  **Surveyed at P4.3, against `8ae0d79a` (2026-08-16), and the gate opens:
  there are three extraction paths, not none.** The question was written from
  the documentation, and the answer was in the source.

  - **Lorebooks export *as SillyTavern files***
    (`lorebookImportExport/export/formats.ts:13`), one of three offered formats
    beside `aventura` and `text`. So Aventuras lore arrives through the
    converter P4.2 already shipped, with **no Aventuras-specific code at all** —
    the best possible answer to the gating question, and one nothing in this
    plan anticipated.
  - **Characters and scenarios export as their own raw JSON**
    (`export/vault.ts:137`) — `VaultCharacter` and `VaultScenario` verbatim,
    which is the shape [survey §4](../01-source-survey.md) already documented as
    *not* V2. A converter for these is small and is the honest remaining work.
  - **The whole vault exports as a zip of a SQLite snapshot**
    (`services/backupService.ts:45`), zipped in native Rust. This is the heavy
    path: a zip reader plus a SQLite reader, and `node:sqlite` is already here.
  - **There is a fourth, and P4.3 missed it** — *added 2026-09-01, at
    [21](../21-session-import.md)'s survey.* A single story exports as **`.avt`,
    one versioned JSON file** (`services/export.ts:28`, shape at
    `services/import/types.ts:24`, `EXPORT_FORMAT_VERSION = '1.8.0'` with nine
    additive revisions recorded in the file). It carries the story, its entries,
    its cast, its lorebook entries, checkpoints, branches, chapters and its
    images as base64. Missing it mattered in the direction that flatters P4
    least: this stage concluded the vault-as-SQLite-zip was how a whole story
    leaves, and named it *the heavy path*, when the light one was beside it.
    Nothing P4 shipped is wrong because of it — `.avt` is session-shaped and
    §4 puts sessions out of scope — but the survey's *shape* of Aventuras was
    incomplete, and a later reader costing the work would have costed the wrong
    path.

  *Finding this cost something and paid for itself.* Aventuras' SillyTavern
  export writes book-level settings in **snake_case**, as the V3
  `character_book` spec does — and P4.2's converter read only camelCase, so an
  embedded book's `scan_depth` and `token_budget` were being silently replaced
  by our defaults. A book that imports and behaves differently. Fixed at P4.3,
  with the Aventuras export shape as its test.
- What maps ~~if the path exists~~ *when the converter is written*:
  `VaultCharacter` → actor (its own shape, *not*
  V2 — the skeleton's "the other two orbit ST" holds for Marinara only);
  `Entry`'s static half → lorebook entries, its typed per-entry state being
  channel-shaped P7 material; `PackTemplate` is **already Liquid** — no macro
  mapping needed, but its variables resolve against Aventuras' flat context
  namespace and need a mapping table onto ours (§1.6); `CustomVariable[]` is
  the shape `PresetVariable` was adopted from, so those carry 1:1 (and stay
  inert at P4 — nothing reads preset variables yet, said in the review rather
  than implied working); translated-\* fields drop-with-review (triage
  DISCARD); derived counters drop — Marinara's own port set the precedent.

**Expect this phase to underestimate itself** ([01 §7]): import fidelity
across three sources with years of edge cases keeps producing bug reports
after P4. The exit gate is the demo, not the absence of edge cases.

### 1.6 Liquid lands with the importer

**Decided: P4.1 implements the block-scoped template renderer — LiquidJS, the
[triage §7] BUY, per [03 §5](../03-modes-and-turn-pipeline.md)'s "Liquid, following Aventuras" — rendered within
a block, never across blocks.**

The skeleton missed this entirely, and it cannot wait: the macro table
([10 §8.4.2]) converts ST macros *into Liquid*, and nothing renders Liquid —
so a converted preset's `{{char}}` would reach the model as literal braces.
That fails the posture's central promise in behaviour ("authored prose
survives intact" is worthless if it renders as template soup), and PLAYABLE —
the checkpoint this phase exists to reach — would be testing prompt garbage.
The collector's own comment has framed the language as arriving with imported
presets since the line was drawn (collect.ts:190–198).

Scope fence, drawn deliberately tight:

- **The render context is a small closed namespace, designed alongside the
  macro table as one piece of work**: the things ST macros actually name —
  the active actor's name, the persona's name, and the handful the closed
  table maps. Names, never bodies — content arrives through slots, and a
  template that could pull a section body would be a second assembler.
  `{{charIfNotGroup}}`-class conditionals become Liquid conditionals over that
  namespace rather than being dropped ([10 §8.4.2]).
- **An unrecognised macro is preserved verbatim and flagged** — unchanged, and
  now meaningful: recognised macros render, unrecognised ones visibly need a
  look.
- **What stays open, stated so this is not misread**: [06 C6]'s remaining
  question is which language serves *rule conditions* (deferred with the rule
  vocabulary to 5.0 anyway), and [triage §6.1]'s `[OPEN]` on authoring-side
  macro syntax stays open. P4 settles Liquid **for block templating**, which
  three documents already chose; it does not decide the other two.
- **Deferred with a name**: Aventuras' `contentHash`/`baselineHash` dual-hash
  update mechanism ([03 §5](../03-modes-and-turn-pipeline.md) says "adopted wholesale") is an update-propagation
  feature, not a rendering one; it waits for a phase with pack updates in it.
- One nit fixed in passing at P4.0: the wrapper's `{{content}}` substitution is
  first-occurrence-only (`String.replace` with a string pattern,
  collect.ts:340–343); it becomes all-occurrences with a test, before the wild
  corpus finds a format string that repeats it.

### 1.7 The slot literal: `'setting'` becomes `'treatment'` before any file fossilises it

The Setting→Treatment rename was made deliberately ([10 §6]; the kind is named
for what it holds, and `Setting` was one case-fold from the configuration
surface) and the docs carry it — [10 §8.2], the [10 §8.4.1] marker table and
[13 §1.1] all spell the slot source `treatment`. The code never followed:
`preset.ts:114`, `turn.ts:153`, the assembler, the scene preset, the workbench
fixtures and the published JSON Schema artifact all spell it `'setting'`.

**Decided: complete the rename, at P4.0.** The docs are the design authority;
`/0` exists precisely so the shape can move; and the moment P4.1 ships,
converted presets are portable files that fossilise whichever spelling they
carry — the rename is nearly free today and impossible later. The turn record
is free-to-move tier, and committed records carrying `kind: 'setting'` keep
rendering because the client's source-label maps are open-keyed by rule; the
`setting` label entry stays beside the new `treatment` one. The stale
pre-rename comment at lorebook.ts:231 ("Settings remain the primary home")
rides along.

### 1.8 What the sweep does with everything else in ~~an ST user directory~~ a source tree

A real ST user tree is thirty directories and a Marinara store is
eighty-one tables; the sweep must have a stated disposition for each class or
the review's "nothing silently dropped" is a lie. **Widened at the amendment to
cover both**, because keeping the dispositions in one section is what makes
that claim a single checkable thing rather than two claims that drift.

**The claim is made checkable the way §1.1 already decided for credentials: by
vendored snapshot.** ST's `USER_DIRECTORY_TEMPLATE` (`src/constants.js:16`,
thirty-one keys) and Marinara's `FILE_BACKED_TABLES`
(`Marinara-Engine/packages/server/src/db/file-backed-store.ts:349`, eighty-one
tables) are each committed as a snapshot with a provenance comment naming the
source file, commit and date, and a test asserts that **every name in the
snapshot has a disposition**. A name that appears in a real install but in
neither the snapshot nor the map is not a hole — it is the *unrecognised*
class, reported and counted. Marinara's `scenarios` table is the worked
example: it is not in the pinned registry, because it only ever existed on a
branch, and an install that ran that branch still has it (§1.5).

**SillyTavern.** **Convert** — `characters` (cards), `worlds` (lorebooks),
`OpenAI Settings` (chat-completion presets), `TextGen Settings`
(text-completion presets, params-only, ratio reported), `sysprompt` presets,
and personas — ~~where they live on disk is a P4.0 survey line — the source
survey never documented it~~ **`User Avatars/` for the images, with the names
and descriptions under `power_user.personas` and
`power_user.persona_descriptions` in `settings.json`
([survey §3](../01-source-survey.md)); closed 2026-08-29.** That last one is
the tree's one irregular case, because it makes `settings.json` an import input
rather than a skipped file. **Record, not converted** — `groups`/`group chats`
(session/mode-shaped; member references would resolve-or-dangle if they ever
convert), `chats` (see §4). **Not converted, by position** — `instruct` and
`context` template files, `NovelAI Settings`/`KoboldAI Settings` (the
raw-completion fossil). **Skipped and counted** — `backgrounds`, `themes`,
`backups`, `vectors` (embeddings are derived data, [00 §2.8]), `QuickReplies`
(absent from every survey document; the sweep counts them by name so the review
is honest about what it saw), and — *added when the template was actually
counted* — `thumbnails` and its three children, `movingUI`, `extensions`,
`assets`, `reasoning`, and the `user/` subtree (`user/images`, `user/files`,
`user/workflows`). Roughly a dozen of the thirty-one had never been named by
any plan, and a disposition nobody wrote is the silent drop this section exists
to prevent.

**Marinara.** By family, because eighty-one names is a code artefact rather
than prose:

| Class | Tables |
|---|---|
| **Convert** | `characters`, `character_images`, `personas`, `persona_images`; `lorebooks`, `lorebook_entries`, `lorebook_folders`, `lorebook_character_links`, `lorebook_persona_links`; `prompt_presets`, `prompt_sections`, `prompt_groups`, `choice_blocks`; `library_folders`, as tags on what it organises |
| **Credential — never lands, not even in `compat`** | `api_connections`, `api_connection_folders`, and the data root's `.encryption-key` |
| **Record, not converted** | Session-shaped: `chats`, `messages`, `message_swipes`, `chat_folders`, `chat_presets`, `conversation_notes`, `ooc_influences`. Party- and mode-shaped, P7: `character_groups`, `persona_groups`, the six `game_*` tables, `spatial_context_snapshots`. Agent- and extension-shaped: `agent_configs`, `agent_runs`, `agent_memory`, `capability_documents`. Rule-shaped, deferred with the rule vocabulary: `regex_scripts`, `prompt_overrides`. History-shaped: `character_card_versions`, `persona_card_versions` — ours are files per version and a first import writes no version record (§1.3), so there is no writer for a foreign history and inventing one would fabricate dates. Configuration: `app_settings`, which has its own surface here ([P2A](13-p2a-configuration-surface.md)) |
| **Skipped and counted** | The `noodle_*` and `slurp_*` families — twenty-four tables, **nearly a third of the store**, and [triage §4] discards the subsystem outright. `memory_chunks` (embeddings, [00 §2.8]), `achievement_unlocks`, the three `conversation_call_*` tables, the media libraries with no object to hang on (`assets`, `chat_images`, `gallery_folders`, `global_images`, `custom_emojis`, `custom_stickers`), and the four Marinara's own profile importer quarantines rather than trusts — `custom_tools`, `mari_instructions`, `installed_extensions`, `custom_themes` — plus `mari_workspace_context` |

Beside the tables, the seventeen asset directories: `avatars`, `sprites`,
`lorebooks/images` and `prompts/images` feed the objects that reference them and
are converted with those objects; the rest — `game-assets`, `fonts`,
`notification-sounds`, `long-term-memory`, `knowledge-sources` and the video
directories — are skipped and counted.

### 1.9 A session can play an imported preset

**Decided: session creation grows one optional parameter — a preset id, copied
into the session instead of the mode's default.** The recorded position that
"choosing a different pack is P7's surface" (routes/sessions.ts:53–54) is
amended in place rather than silently contradicted: P7 keeps the *surface* —
browsing, previewing, switching mid-session; P4 takes only copy-at-creation,
the minimum that makes the demo's "read in the workbench over a real turn"
readable and PLAYABLE playable. The session still copies, never links
(sessions/types.ts's own rule: editing a preset must not silently change an
ongoing game), and `preset.modes` stays advisory — a preset for a mode you do
not have still imports, still shows, and still plays if you insist.

### 1.10 Card conversion, in the shipped schema's own terms

[02 §2.7]'s table is kept, rewritten in section terms — `profile.summary` is
shorthand for the reserved `se.summary` *section*, not a field:

- `description` → the `se.summary` section body. `name` → `name`.
- `personality` → `profile.traits` when it is list-shaped (short
  comma-separated fragments); otherwise the text lands whole in `se.summary`
  as its own paragraph. The review names which happened, and the result is
  user-editable either way — the heuristic is a starting point, not a claim.
- **The importer creates only the sections the mapping fills.** `se.appearance`,
  `se.voice` and `se.background` stay absent on an imported card — three of
  the five actor blocks in the default Scene preset render empty
  (`omitWhenEmpty` makes that legal and quiet), and the plan says so here
  rather than letting the gate discover it. Splitting `description` into
  appearance/voice by heuristic would be inventing structure the source does
  not have. ([06 B1]'s editor-creates-all-four rule is about the editor;
  import claims only what it knows.)
- `scenario` → **a Treatment, created eagerly** (post-hoc posture, §1.4), one
  per distinct scenario text within a sweep (identical text dedupes), with the
  card's actor in its cast and the extracted lorebook linked; framing carries
  the text, and the review names the created treatment per card. "Offered as
  a new Treatment draft" ([02 §2.7]) becomes "created and reported" under the
  posture this plan decided.
- `first_mes` / `alternate_greetings` → `openings.written`, first as primary.
- `mes_example` → **one `writingSamples` entry**, enabled, titled from the card
  name ([18](../18-writing-samples.md)). ~~the `examples` section, disposition
  `on-demand`~~ — the destination moved when dialogue examples stopped being a
  `Section`; a `Section` carries no `priority` and [00 §2.6] requires one. A
  redirect, not new import surface: still one row, still one destination.
- `system_prompt`, `post_history_instructions`, `depth_prompt` → `compat`,
  surfaced as "this card wants to override prompts; review". `talkativeness` —
  in the deliberately-absent list with no destination row until now — goes to
  `compat` with the rest. `extensions.*` → `compat` verbatim.
- `character_book` → extracted to a real Lorebook, linked from the actor.
- The card's pixels become the portrait through §1.3's composer; V3 preferred
  over V2 when both chunks are present, matching the reference parser.

### 1.11 Lorebook conversion: the numeric tables nobody had written

The activation vocabulary carries as-is into `storyengine.lorebook/1` — the
schema stores every field P5 will fire ([10 §5]; P4 only stores them). What
the skeleton's "carried as-is" glossed, decided here:

- **ST's numeric encodings get explicit decode tables** with fixture tests:
  `selectiveLogic` integers → the four-string union; `position` integers → the
  four-arm union, where ST's author's-note and example-message positions have
  no arm and **collapse to the nearest sequence arm with a review flag naming
  the original position** — mapped-and-flagged, never silently reinterpreted.
- **Entry `role` is synthesised as `system`** where ST carries none (ST only
  has roles on at-depth entries; ours is required).
- **`entryLimit` clamps visibly**: the 1..1000 range is the one hard numeric
  constraint an ST book can trip; a bigger source value clamps with a review
  note rather than failing the file.
- **Chat-scoped books import as `global`, and the review names the dropped
  scoping** — the two-arm `LoreScope` cannot express it and P4 imports no
  chats for it to bind to. Character/persona scoping collapses to `linked`
  with refs that resolve or dangle like any other.
- **Entry ids may be renumbered freely** ([10 §5.2], reaffirmed by
  [16 §4.1](../16-lorebooks-as-a-format.md)) — and the same rule means
  re-import cannot match *entries* by id; §1.3's identity rule works at the
  object level, and that limit is already recorded as a known one.
- Unknown source fields land in entry/book `metadata` (the kinds carry no
  `compat`), or drop-with-review where they are state (§1.4's list of six).

---

## 2. Stages

### P4.0 — Corpus, harness, and the ground work

**Landed 2026-08-30**, in ten commits. What each clause became, and the three
places the stage found the plan wrong:

- *§1.2's corpus:* built as two synthesised roots — content maps rather than
  committed files, so card images are constructed and a binary never enters a
  diff. Eleven tests keep them honest, because a fixture nobody checks stops
  being one. The Marinara root lies about itself twice on purpose: a version-2
  manifest over a sharded table, and a card double-encoded inside its row.
- *The parses-but-is-wrong harness:* `ParseOutcome` plus a table generated from
  the parser's own valid example. Tested against two parsers — one that obeys
  the contract and one that guards the shape then trusts the fields — because a
  harness that cannot fail hands every later parser a green light it never
  earned.
- *§1.7's rename:* done, and **the plan was wrong about it in the dangerous
  direction.** "The treatment literal never made it into code" — it had, as the
  `samples.from` carrier, which is a different axis from the slot kind. A
  find-and-replace over the word would have merged two vocabularies. The schema
  now says so beside the arm.
- *§1.3's write-path extension:* `create()` grew a card-pixels parameter rather
  than gaining a sibling that writes files itself, so the kind queue, the
  id-conflict check and the synchronous ingest still apply. A test creates the
  same actor twice and still conflicts, which is what that choice buys.
- *The wrapper fix:* both halves. First-occurrence-only was the known one; the
  filled text also being a *replacement string*, so `$&` in imported prose
  rewrote the output, was not. That bug bit while this document's amendment was
  being written, in the script inserting the sentence describing it.
- *The card reader:* widened to compressed `zTXt` and to `iTXt`. Our own
  envelope stays `tEXt`-only, because `write()` removes our chunk by looking for
  a `tEXt` with our keyword and a reader accepting more than the writer removes
  would leave two envelopes in one file.
- *The shared types and the module skeleton:* the seam is a **source reader
  yielding candidates**, with the file source beneath it — and `FileSource`
  being an interface is not a testing convenience, it is the `node:fs` boundary
  rule. Candidates and observations share one stream, because *nothing is
  silently dropped* is a property of a single pass.
- *The two vendored registries:* thirty-one SillyTavern directories and
  eighty-one Marinara tables, each with a disposition and four tests — coverage,
  the reverse direction, the snapshot's own size, and that no entry claims
  `unrecognised`. The last three exist because coverage alone can be satisfied
  dishonestly.
- *The sweep-as-job vocabulary:* `import_job` / `import_event` as `STEPS[1]`,
  and the migration chain's own preserving rule got its first test — until now
  there was one step, so the upgrade path had never run.
- *P2C finding 8:* reproduced and fixed. **The plan said "verified fixed or
  fixed here" and it was neither fixed nor, as it turned out, one bug**: *the
  file changed* and *the file broke* were answered identically, and splitting
  them fixed the loop while making the ordinary 412 more useful than it had
  been.
- *The fixture-pair CI assertion:* wired as its own project, red on purpose,
  with the assertion spelled out in full. `pnpm test` negates the project rather
  than the file carrying a skip, so **removing that negation is part of P4.2
  making it pass** and cannot be forgotten separately.

*Ends at:* `pnpm test:fixture-pair` failing with `ImportNotImplementedError`
naming the stage that owes it, and the rest of the gate green.

§1.2's corpus built (synthesised structural cases for both folder sources —
including a Marinara fixture data root with one sharded table — permissive real
ones, ~~the private corpus's location documented outside the repo~~ *and the
absent private corpus recorded as an outstanding manual task rather than
assumed*); the parses-but-is-wrong table harness for every parser; §1.7's
slot-literal rename completed across code, fixtures and the emitted schema
artifact, **without collapsing the `samples.from` carrier into it** (§0);
§1.3's write-path extensions (the card-bytes composer; nothing else —
`create()`'s no-version-record behaviour is kept and documented); the wrapper
fix, all-occurrences **and** function-replacement (§0); the card reader widened
to compressed `zTXt` payloads (§0); the shared report/reason-class types and
the import module skeleton — **including §1.3's source-reader seam and the two
vendored registry snapshots §1.8 checks against, which are the two things this
stage exists to get right before anything is written on top of them**; the
sweep-as-job vocabulary in the operational store, as the `import_job` /
`import_event` migration append §1.3 decided; the P2C log's finding 8 verified
fixed or fixed here; the fixture-pair CI assertion wired as a **named step**,
failing. ~~The ST-personas-on-disk survey line closed.~~ *Closed already, at the
amendment — §1.8 carries the answer.*

### P4.1 — SillyTavern presets, and the renderer they need

**Landed 2026-08-30**, in five commits. What each clause became:

- *The full §8.4 conversion:* three preset kinds — chat-completion, sysprompt,
  text-completion. Four corrections to §8.4 came out of implementing it, and
  all four are written back in this stage's docs commit: the heading's
  "Eight" is nine (its own table always had nine rows); text-completion
  samplers land in `compat` rather than dropping, because `GenerationParams`'
  comment was right and the prose was not; `dialogueExamples` maps to
  `samples`, since the arm was renamed when dialogue examples stopped being a
  `Section`; and `scenario` maps to `treatment`, which the marker table always
  spelled correctly.
- *The vendored `sensitiveFields` drop:* ST's own list, with a test that the
  snapshot covers every field §8.4.4 names and is a superset of them.
  Present-and-empty is not present — ST writes these keys into every preset,
  and reporting eleven removals on a file that carried none is how a warning
  stops being read.
- *Per-character order handling:* §8.4.2's rule, plus the half it left
  unstated — group default in place of an absent global with a note, group
  default dropped with a note when both exist.
- *§1.6's renderer:* Liquid, block-scoped, over a closed namespace of two
  names. Most of its tests are about what it may **not** reach, because the
  risk in adding a template language to an assembler is not bad
  interpolation — it is quietly acquiring a second assembler. A template that
  will not compile emits its own source rather than throwing.
- *The macro table:* closed, and closed in a stronger sense than §8.4.2's
  sentence implies — mapped, refused **with a reason**, or unrecognised. The
  refusals carry the decisions: macros naming a *body* are what slots supply,
  and `{{random}}`/`{{time}}` would break replay, which is the RNG rule and the
  record's reproducibility arriving from two directions.
- *The upload route and the `LIVE_APPLIERS` flip:* `limits.maxUploadMb` is read
  per request and now reads `applied`, after three phases as [13 §4.3]'s
  standing example of an honestly-unread key. The exemplar moved to
  `trash.retentionDays`; **a key stops being an example of dishonesty by
  becoming honest**, which is the table working rather than a defect in it.
  Getting the 413 right needed a catch rather than a check — the plugin throws
  past `file.truncated`, and the app's handler would have called a large file a
  malformed one.
- *§1.9's preset-at-creation:* one optional id, copied not linked, with the
  recorded P7 position amended in the same commit. `preset.modes` is
  deliberately not checked: it is advisory, and the phase that fills a library
  with other people's presets is the worst place to turn a hint into a gate.

*Ends at:* a preset uploaded through the route, converted, credential-free, and
playable in a session created against it.

The full [10 §8.4] conversion under §1.1's sharpened tables: marker table
(with the renamed literal), the nine special-cased fields, the vendored
`sensitiveFields` drop, per-character order handling, sysprompt and
text-completion (params + `compat`, ratio reported). §1.6's LiquidJS renderer
with the closed macro table and render context, designed together. The
single-file upload route (multipart, CSRF, per-request `maxUploadMb` — the
`LIVE_APPLIERS` flip). §1.9's preset-at-creation parameter, with the recorded
P7 position amended in the same commit. Docs ride along: 10 §8.4.2 (compat),
§8.4.3 (nine), [07 §7] (the two new dependencies argued in place),
[docs/api.md](../../api.md) gains the routes.

### P4.2 — SillyTavern cards and lorebooks

**Landed 2026-08-30**, in two commits. **The fixture-pair assertion is green**,
and `pnpm test` no longer negates its project — the removal being part of making
it pass is the mechanism P4.0 wired for, working.

- *§1.10's card converter:* built, with the `personality` row checked against
  P4.1's `charPersonality` marker rather than on its own. Only the sections the
  mapping fills are created, so three of the five Scene actor blocks render
  empty by design — asserted here rather than discovered at the gate.
- *Scenario → Treatment with sweep-level dedupe:* the converter returns the
  text and the **sweep** creates the object, because *one treatment per distinct
  scenario text* is not a property a converter handed one card can enforce. A
  pack of twelve cards sharing a premise yields one treatment with twelve
  actors in its cast.
- *§1.11's decode tables:* both, with mutation-proofed tests. `world_info_logic`
  is not in our union's order, so an array indexed by the integer would have
  been shorter and wrong; and ST spells the enabled flag inverted as `disable`,
  which read straight through turns every entry off. Neither mutation fails
  anything but its own test — the book still imports and still validates, which
  is what makes these the worst bugs available here.
- *Personas:* the tree's one irregular case, since the name and description live
  in `settings.json` rather than beside the image.
- *The gate:* green — **and it caught something on its first honest run.** It
  reported `history` as `empty-source`, correctly, because a session with no
  turns has no history. That is not a conversion disagreement, so the test now
  takes a turn first, which is what §3 step 2 said all along and the first draft
  skipped. A gate that cannot tell an honest empty from a disagreement is one
  that gets edited until it passes.

*Ends at:* `pnpm test:fixture-pair` green, and the whole suite green with it.

§1.10's card converter — V2/V3 PNG, CHARX, JSON card, ~~`.seactor`~~ (struck at
§7.5: our own format, and [§4]'s) — checked
**against** P4.1's slot targets, which is the whole point of
[testing §5.1](10-testing.md): the card importer and the preset importer
convert opposite ends of one format and must be checked against each other.
Scenario→Treatment creation with sweep-level dedupe; `character_book`
extraction and linking; personas. §1.11's lorebook converter with the decode
tables. **The fixture-pair assertion goes green here**, in its §3 step 2 form.

### P4.3 — Marinara, then Aventuras — ~~survey first~~ the store reader first

**Landed 2026-08-30**, in three commits.

- *The Marinara store reader:* built behind §1.3's seam, reading both table
  layouts — and **which layout a table is in is a question for the filesystem
  rather than the manifest**, because a crash between the shard migration and
  its first flush leaves sharded data under a version-2 manifest. The
  SillyTavern walker did not change to accommodate any of it, which is the
  check the seam was given.
- *The converters:* redirections, as §1.5 predicted. **Two traps, both
  camouflaged by everything around them reading as a rename**: Marinara numbers
  at-depth `2` where SillyTavern numbers it `4`, so one shared table would send
  every at-depth entry to the wrong place; and stored booleans arrive as the
  *strings* `"true"` and `"false"`, so `=== true` disables every block in a
  preset. Both import and validate. `selectiveLogic` has five arms to our four,
  and the fifth is narrowed-and-flagged.
- *§1.8's disposition map:* driven by the reader, so a table Marinara adds is
  `unrecognised` and counted.
- *The archive and the envelope:* an envelope becomes a table with one row in
  it, and a **native profile becomes a data root held in memory** — the store
  reader reads it unchanged and never learns it arrived as one file, which is
  §1.3's *an archive is a root read through a different file source* paying out
  with no new code. **The zip form is the one piece deferred with a reason**:
  it needs a zip reader plus §1.3's bounds, which is not the *cheap tail* §5
  described, and the native JSON profile carries the same content.
- *The Aventuras survey:* **the gating question opened.** Three extraction paths
  exist, and the best of them needed no code — Aventuras exports lorebooks *as
  SillyTavern files*. Writing that up found a P4.2 bug: its export uses the V3
  spec's snake_case book-level fields, which our converter did not read, so an
  embedded book's scan depth and budget were silently replaced by defaults.
- *The fixture corpus earned its keep twice.* It caught an actor being lost over
  an unreadable portrait — the poisoned-file rule violated one level down.

*Ends at:* a Marinara data root, a profile envelope and a single-object envelope
all importing, with the SillyTavern paths untouched.


*Restructured at the amendment.* The Marinara survey it was going to open with
has been performed (§1.5), so this stops being a stage that might discover it
has nothing to build.

§1.5, in order: the **Marinara store reader** — manifest, the two table
layouts, the joins, the refusals of §1.3 — behind §1.3's source-reader seam;
then the converters, which are mostly redirections into P4.1's and P4.2's,
because a Marinara card is a V2 card and a Marinara preset is the same prompt-
manager lineage [10 §8.4] was written against; then §1.8's disposition map with
its registry-coverage test; then the profile archive and the `.marinara.json`
envelope, which are the same reader over a different file source and a single
candidate respectively. Then the Aventuras survey, still gated on the
extraction-path question, conversion only if an artefact exists, the named
fallback otherwise. Everything that needs later machinery is recorded with the
review category that says when.

### P4.4 — The review surface, the sweeps, and the way out

**Landed 2026-08-30**, in four commits — with two clauses cut, named below with
§5's cut order as the reason rather than discovered as silence.

- *Re-import identity:* built, and it was the correctness gap P4.3 left open —
  the sweep wrote through `create()` alone, so a second run over one directory
  either collided or quietly doubled everything. Two things had to change before
  *byte-identical* could ever be true, and **both were behaviour bugs rather
  than test scaffolding**: a re-imported object now keeps the timestamps it had
  here (its `createdAt` is when it entered *this* library), and converters no
  longer mint ids for content they did not identify — openings, samples and
  lorebook entries are derived from their own content, so conversion is
  reproducible. Without that second one, §1.3's *skipped and reported
  unchanged* was unreachable code and the rule would have replaced every object
  on every sweep while looking like it worked.
- *The `{ kind: 'import' }` version arm has its first writer*, three phases
  after the type declared it with "no writers until their phases".
- *The server-path sweep:* built, gated on `fileAccess` as [05 §4.2.2] widened
  it — **and the `/data` carve-out is enforced in code**, compared on real paths
  so a symlink into the data directory is refused like a literal one. That
  refusal is what makes the widening safe rather than merely honest.
- *The review surface:* rendered on the Library page, composing sentences from
  classes and params — with tests pinning that an unknown class renders as the
  word itself rather than as a blank cell, because a blank reads as *nothing
  happened to this file*.
- *The way out:* delete on the object detail page, which the server could do
  since P1 and no surface could reach. The post-hoc posture rests on a bad
  import being reversible, and that was true on disk and false in the app.
- *`address.ts`'s preset arm and the empty state's new sentence:* both done.
  A session's pack is a copy, but a copy keeps the id it was copied from, so an
  imported preset's blocks link back to the file they came from.

**Cut, in the order §5 set before the pressure arrived:**

1. **The browser directory upload** — §5's first-to-cut, and the reason holds:
   *the server-path sweep alone still pays the demo on the install the demo
   describes; the upload variant is reach, not core.* The single-file upload
   route ships and is the must-not-cut half.
2. **The review report at its own address.** §1.4 argues for it and the argument
   stands — a report somebody pastes into a bug report or reopens next week
   wants an address. What ships is the report rendered where the sweep was run,
   which is a review step but not an addressable one. The `import_job` /
   `import_event` tables P4.0 appended are the storage it needs and nothing
   writes them yet. **Named here rather than left as a gap**: this is the piece
   of P4 that is genuinely unfinished.

*Ends at:* a folder swept from the Library page, a review naming what happened to
every file, and the same folder swept twice leaving one library.


§1.4 rendered: the routed report view over the structured report; the two
sweep transports over one engine (§1.3), the server-path side gated on
`fileAccess` ~~with its grant surface in admin accounts~~ **as [05 §4.2.2]
widened it — with the `/data` carve-out enforced in code, the existing control
moved out of "Recorded for later", and its three labels rewritten to say what
the permission now means**; the re-import
skip/replace/keep-both flow; the client delete affordance and its api.ts
function; the import entry point on the Library page (whose empty-state
sentence finally learns the word "import"); `address.ts` grows the preset
source arm its docstring currently rules out, so the demo's block list links
back to the imported preset. 05 §5's review bullet amended per §1.4. The demo.

### P4.5 — The other way in

Import is a way *in*, not the only one. P4.4's empty state finally learned the
word "import" and in the same breath sent anyone wanting a single new object to
the API; this stage is what stops that sentence being true.

**Not a stage the plan called for, and it belongs here rather than in
[polish](09-polish.md) for [01 §2.3]'s reason.** The surface ships with the
thing it serves. P4.4 shipped the way out and the bulk way in, and left the
single way in as `curl` — a strange place to stop, with the Library page
already open on the bench and the machinery complete since P1.7.
`api.createObject` and `useCreateObject` have existed since then with exactly
one caller: the conflict dialog's *save as a copy*, the side door
[17 §3.1](17-p2c-brief.md) had to pre-brief testers about so they would not
file it as a bug.

**Actors only, and that is the rule rather than the shortcut.**
[05 §11.2d](../05-ui-surfaces.md) says the first editor owes create; read from
the library's side it says the inverse, and the inverse is the constraint here
— a *New lorebook* lands somebody on a read-only page holding an empty book
they cannot fill in, and a blank-page dead end teaches worse than no button
does. The other five arrive with their editors. A kind that cannot be made says
so in a sentence, because a greyed control is the placeholder [01 §2.2] rules
out. Import leads in the empty state and the blank page follows it, per
[05 §5.3](../05-ui-surfaces.md).

**It also covered the stage before it, and that is where §7.10 and §7.11 came
from.** P4.4's delete shipped with no component test at all. Writing one found
two defects in it — neither caught by §7, because that audit read the code's
shape rather than driving it. Both are fixed here, and both now redden a test
when reverted.

*Ends at:* an actor named in the browser, edited in the browser and removed in
the browser, with no `curl` anywhere in the walk — and P4.4's delete answering
for itself when it refuses. **The walk is what this stage is still waiting on;**
everything above it is in the tree and under test.

### Then: PLAYABLE

Not a stage of P4 and listed so it is not forgotten: wire the crude Scene mode
to the imported library — the preset picker from P4.1 is the wiring — sit
down, and play ([01 §4.1]). The four hypotheses get their answers here, the
answers feed the revisit of [07](07-p5-implementation.md) before P5 starts,
~~and [16 §6](../16-lorebooks-as-a-format.md)'s two corpus counts (Mentions and
folders across the imported corpus) run shortly after import lands, as that
document asks.~~ **PLAYABLE needs the P2C sessions to have run** (§0) — a real
endpoint, proven, not the stub.

**The corpus counts do not run here, and saying so is this phase's obligation
rather than P5's.** *Corrected 2026-08-30.* [16 §6] specifies four falsification
tests that run "against the imported library rather than against fixtures", none
runnable before P4 and all of them "shortly after". §1.2 has since established
that **there is no such library** — no used SillyTavern or Marinara install on
hand — so P4 imports the corpus it synthesised, and counting Mentions across
fixtures we authored measures our own assumptions rather than anybody's books.
The tests are not failed, and they are not quietly skipped: they wait, and
**acquiring a real library is now a named prerequisite of P5's document half**
([P5 §1.6](07-p5-implementation.md)), person-blocked with lead time in the same
way the P2C sessions are. P4 still closes without it; what changes is that the
phase after this one no longer assumes this one produced it.

---

## 3. Verification — the P4 exit gate

1. **The sweep, for real — both arms**: point the server-path sweep at a
   SillyTavern data directory **and at a Marinara data root** → populated
   library, review report at an address, nothing crashed, and **every file or
   table the sweep saw is accounted for** — converted, recorded,
   skipped-by-position, or counted as unrecognised. Nothing silently dropped.
   *Amended 2026-08-29:* ~~(the private corpus, by hand)~~ — there is no private
   corpus (§1.2), so this step runs against the fixture roots, and **walking a
   real library of either kind is a named outstanding manual task** rather than
   a gate condition this phase can meet. It is written here, in the gate, so
   that it is carried rather than quietly dropped: P4 can close without it;
   PLAYABLE is where its absence will be felt, alongside the P2C sessions (§0).
2. **The fixture-pair assertion, restated over the record** (replaces the
   skeleton's unimplementable "no slot resolves empty"): import the fixture ST
   directory (cards + a **chat-completion** preset — testing §5.1's qualifier,
   which the skeleton dropped), create a session with the imported preset,
   assemble one turn against the fake provider, and assert over
   `ModelCall.notFilled`: **no `empty-source` rows for persona, actor, history
   or input slots, and no `unknown-slot` rows at all**; `lore` and `setting`
   slots read `no-producer` — expected until P5, and the test says so by
   asserting it. A named CI step, per testing §6's discipline.
3. **The credential drop**: a preset with `proxy_password` in it → imported,
   credential gone — from the object *and* from `compat` — review names the
   removed fields. No "import as-is" affordance exists anywhere. The
   testing §1 invariant (*no portable object contains a connection or
   credential*) runs as a property over the whole imported corpus. **And the
   Marinara arm**: a fixture data root carrying `api_connections`,
   `api_connection_folders` and `.encryption-key` imports with none of the
   three anywhere in the result, and the review names them as dropped by class.
4. **Depth**: a depth-4 block sits four **messages** from the end in the
   workbench block list — not at the top, and not eight messages back.
5. **Macros, both halves**: an unrecognised macro → imported verbatim,
   flagged; a *recognised* macro → renders through Liquid in the assembled
   prompt, and no literal `{{` from the closed table's set reaches a rendered
   message.
6. **Re-import the same directory** — *of each kind* → §1.3's identity rule:
   unchanged objects skip and are reported unchanged; a changed one offers
   replace (the version-history `import` arm fires — its first writer) or
   keep-both. Nothing doubles silently. The Marinara arm is the sharper test of
   the rule, because `Provenance.originalFilename` for a row in a table is not
   a filename anyone typed; what it holds, and whether that is stable across a
   re-export, is the question §6.2 is already watching.
7. **The in-repo corpus imports without a crash, in CI** — ~~and the private
   corpus has been walked by hand at least once, findings triaged into
   synthesised fixtures.~~ *Amended with step 1: there is no private corpus
   (§1.2), so the second clause is not a condition this phase can meet. It
   stands as the outstanding task, in the same words, for whenever a real
   library of either kind is to hand.*
8. **One poisoned file never aborts a sweep**: a deliberately corrupt card in
   the fixture directory is a `warn`-class row in the review, and the sweep
   completes around it.
9. **Rebuild equals incremental, after a bulk import** — the [13 §5] CI
   assertion gets the best stress it will ever get, run against the
   post-import library.
10. **The config surface is honest**: the `LIVE_APPLIERS` row for
    `limits.maxUploadMb` reads `applied` and its test passes; the `fileAccess`
    grant surface exists where an admin can reach it — ~~exists~~ *and, since
    2026-08-30, **says what it grants**: the control is out of "Recorded for
    later" and its labels name the sweep, not only the browser* ([05 §4.2.2]).
    **And the standing line from [01 §2.3]:** if this phase built anything else
    that needs a value set, name where someone sets it before calling the phase
    done.
11. **The report is data**: fetch the review report over the API — reason
    classes, counts and parameters, no stored English prose; the sentences are
    composed client-side ~~through Intl/ICU~~ **from the reason class through
    the same open-keyed label maps every other class-to-word surface uses**.
    *Corrected 2026-08-30:* there is no ICU message layer in this repository —
    `format.ts` is `Intl` for dates, numbers and durations, the label maps are
    literal English objects, and the catalogue extraction that would change
    that is [P11 §1.3](22-p11-implementation.md)'s. The decision §1.4 makes is
    unaffected and is the point: emitting `{key, params}` rather than sentences
    is what keeps this phase's large new body of user-facing prose **off**
    P11's sweep debt, beside the workbench `reason` field that is already on
    it.
12. **Undo is real in-app**: delete a badly-imported object from the client;
    the tombstone behaviour is visible and the library reflects it.

*Three steps added at the 2026-08-29 amendment, numbered after the existing
twelve rather than woven in, because §1.3 and §1.5 cite the old numbers.*

13. **Every name has a disposition**: the test over §1.8's two vendored
    registry snapshots passes — all thirty-one ST directory keys and all
    eighty-one Marinara tables map to convert, credential, record,
    skipped-by-position or skipped-and-counted. And a name in *neither* — a
    fixture root carrying a `scenarios` table — imports as **unrecognised and
    counted**, not ignored.
14. **The three refusals, each with a message a person can act on**: a data
    root whose `.writer-lease` is held, one carrying `.migrating`, and one
    whose manifest declares a format we do not know. Each is refused **before
    anything is written** — the review says which and what to do, and the
    library is untouched. A half-import here is worse than no import, which is
    why this is a gate step and not a nicety.
15. **`.bak` does not double the library**: a fixture root with a `.bak`
    beside every table imports the same object count as one without, and the
    review reports the `.bak` files as skipped.

---

## 4. Out of scope, deliberately

- **Export in any source's format.** We import ST; we do not write it.
  [00 §2.4]'s "re-export is possible" is a claim about `compat` preserving the
  bytes, not an obligation to build the writer.
- **Instruct and context templates** — not converted, *by position*
  ([00 §2.2]: raw completion is not supported at all). A distinct review
  category, because "will never come" answers differently from "not yet".
- **Chat and session history import — ~~closed, not deferred~~ *conditional*,
  and out of scope here either way.** The skeleton said "to confirm on revisit";
  [06 E4](../06-open-questions.md) had already answered: ~~session import
  is speculative and unroadmapped,~~ "a half-working importer generates more
  support burden than no importer at all. Better none than one that rots" —
  and card/lorebook/preset import is explicitly distinguished as the bounded
  surface against formats that barely move. ~~Confirmed by citation.~~

  *Corrected 2026-09-01, and the correction is about a citation rather than a
  decision.* **[06 E4] was rewritten on 2026-08-31**, two days after this
  paragraph, to *"conditional on an interchange format — not a commitment, and
  no longer a flat refusal. The condition is the shape, not the appetite"*. The
  quoted words above are the version it replaced, and this document was itself
  edited on 2026-08-31 at §7.5's `.seactor` repair without the quotation being
  refreshed — which is how a citation chain rots, and worth leaving visible
  rather than tidying away.

  **P4's own scope does not change**, and neither does the disposition: `chats`,
  `groups` and `group chats` stay `recorded` in §1.8's registry. What changes is
  what the review is saying *when* about. The condition E4 names is
  a session interchange format, which begins at P11's session export
  ([06 B12](../06-open-questions.md)) — so the answer is *after the phase that
  writes the target*, and [21](../21-session-import.md) is the survey that makes
  the condition checkable. Its §1 reaches this document's own `.seactor` rule
  for the reason: an importer for a format with no writer is what
  [01 §2.2](01-work-plan.md) forbids.
- **Package (`.sepack`) import/export** — our own format, not a port; P11-ish.
  The stale comment at layout.ts:74–79 promising the package folder shape "is
  settled at P4" is corrected at P4.0 rather than left dangling.
- **Embeddings and all derived data** (`vectors`, retrieval snapshots, retry
  state, derived counters — [00 §2.8]).
- **Any conversion that needs channels, modes or the rule vocabulary** —
  recorded with the "not yet importable" category, not converted (§1.5).
- **The dual-hash pack-update mechanism** (§1.6) and **authoring-side macro
  syntax** ([triage §6.1], still `[OPEN]`).
- **Thumbnails.** [07 §7] blesses `sharp` for ingest-time thumbnails; nothing
  in the demo needs them; the dependency waits for a surface that does.

---

## 5. The honest size

The phrase of record — "the conversion is already designed" ([01 P4]) — survives
for exactly half the phase. The ST preset and card tables are real and
detailed; the lorebook decode tables are small and mechanical. What was never
designed, and is priced here: **the Liquid renderer and its render context**
(the largest addition, and unskippable — cutting it poisons PLAYABLE, §1.6);
**the two sweep transports** (the widest deliberately-chosen scope in the
phase); **the review surface as a routed view over a job**; and ~~the
Marinara/Aventuras half, whose yield is survey-dependent by construction~~
**the Aventuras half, whose yield is survey-dependent by construction — the
Marinara half is not, and is priced below.**

**The amendment made this phase bigger, and the honest thing is to say so
rather than absorb it.** What it added: the source-reader seam and the Marinara
store reader with its two table layouts, joins and refusals; the disposition map
and its two registry snapshots; the archive reader and its bounds; the
`import_job` migration append that §1.3 thought it was getting for free; and a
second arm on the demo and on gate step 1. What it *removed* is smaller but
real: the Marinara survey stage, which is done; the ST-personas survey line,
which is closed; and the risk that P4.3 discovers it has nothing to build.

What paid for it, in part, is that the Marinara converters are largely
redirections rather than new code — a Marinara card is a V2 card, and a Marinara
preset is the same prompt-manager lineage [10 §8.4] was written against (§1.5).
The reader is the new thing; the conversions mostly are not.

The cut order, decided ahead of pressure rather than under it:

1. **The browser directory upload goes first** — the server-path sweep alone
   still pays the demo on the install the demo describes; the upload variant
   is reach, not core.
2. **Aventuras conversion goes second** — the survey still ships either way,
   and the extraction-path question may cut this one for us (§1.5 names the
   fallback as a completed stage).
3. ~~**Marinara presets go third** — cards and lorebooks ride the ST paths
   nearly free and stay.~~ **Struck at the amendment. Marinara is not on this
   list any more** (see below). If something inside it must give, it is the
   profile archive and the `.marinara.json` envelope before the data root —
   and those are the cheap ones (§1.3), so cutting them saves little, which is
   the argument for taking all three now.

**What must not be cut, with the downstream phase as the reason:** the
credential drop (the stance's own showcase, [00 §3.2]); the fixture-pair
assertion (it exists because two individually-correct importers disagreed once
already); the single-file import path (it is what people use forever after,
and what [17 §14](../17-write-mode.md)'s content-import posture later leans
on); the Liquid renderer (PLAYABLE); the preset picker (PLAYABLE, again); the
review report itself — P5's retrieval debugging inherits a library whose
provenance the review wrote; and, **added at the amendment, Marinara import
from a data root**, because the reason is the same one that put the source
reader in P4.0: a second folder source is what proves the seam is in the right
place, and a seam proved by one source is a seam that has not been tested.

Expect the tail to be long ([01 §7]): three sources, years of edge cases, bug
reports after the phase closes. The exit gate is the demo, not the absence of
edge cases — which is why every gate step above is phrased against the fixture
corpus and the machinery, not against the wild.

---

## 6. What the design still has to settle

Undecided by the *design*, not merely absent from the code. Each needs an
answer written back into the owning document rather than settled here — or is
listed because this plan schedules the write-back it already owes.

**6.1 Which language serves rule conditions.** [06 C6] is partly settled — one
language, definitely; which one, open — and the rule vocabulary itself is
deferred to 5.0. P4 proceeds on the settled half (Liquid for block templating,
chosen in three documents) and deliberately does not close C6; §1.6's scope
fence says so in place.

**Deferring rules further does not defer this decision, it extends it.**
[08 §6](../08-infinite-worlds.md) wants one language for templates *and*
conditions; picking Liquid here commits the template half now and leaves the
condition half running on that commitment for four releases.
[01 §0.6](01-work-plan.md) records the revisit this owes: whether Liquid still
looks right for conditions after four releases of using it for templates.

**6.2 Whether Provenance grows structured import fields.** Today
`source: 'import'` + `originalFilename` carry the identity, and §1.3's dedupe
rule is built on exactly that. If the corpus proves filename identity too weak
(renamed files re-importing as new), the additive candidates are a source-app
tag and a source-content hash — legal additive changes to a stable shared
substructure ([10 §2]), decided then, against evidence, in [10 §3].

**6.3 The review's relationship to `GET /api/library/errors`.** The file-error
surface still has no client caller ([12 §3.5](12-p2-manual-gate.md)); the review report is adjacent
but distinct — the sweep's record versus the index's present-tense complaints.
P4.4 keeps them separate and links where a written object landed broken; a
"this file looks like an ST card — import it?" affordance on the errors
surface is a nicety recorded here and built by nobody yet.

**6.4 Write-backs this plan owes and schedules** (each rides the stage that
makes it true): ~~[05 §5] — the review posture, post-hoc, amended by strike
(§1.4, lands with P4.4).~~ *Paid at P4.4.* ~~[10 §8.4.2] — text-completion fields to `compat`;
[10 §8.4.3] — the heading's "Eight" becomes "Nine" (both with P4.1).~~ *Paid at
P4.1, and two more the conversion found: §8.4.1's `dialogueExamples` row said
`examples`, an arm renamed to `samples`, and its `wrapper` prose said eight in a
third place. [07 §7] gained `liquidjs` and `@fastify/multipart`, argued rather
than noticed in a lockfile.*
~~[13 §4.1] — the foreign-path doctrine (with P4.0).~~ *Paid at P4.0: it is
[13 §4.1.1](../13-internal-contracts.md), and it turned out to be the same rule
one root over — relative to the sweep root rather than the data root, with the
root itself recorded once on the job.* [testing §5/§6] — which
corpus CI runs (with P4.0). routes/sessions.ts's recorded P7 position — the
~~copy-at-creation amendment (with P4.1).~~ *Paid at P4.1, by strike in the
comment itself.* ~~[02 §2.7] — the table restated in
section terms with `talkativeness`'s destination (with P4.2); 02's header
self-contradiction ("see [10] … 13 is current") fixed in passing. [10 §5]'s
"the changes are four" — five, as the code's header already counts (with
P4.2).~~ *All three paid at P4.2. The header contradiction had been read wrong
at least once while writing the importer, which is what a self-contradicting
pointer costs.* And the two stale code comments this audit caught: layout.ts:74–79
(package shape "settled at P4") and lorebook.ts:231 ("Settings remain the
primary home").

*The amendment paid four of its own write-backs on the day, because they are
source facts rather than consequences of building something:*
[survey §1](../01-source-survey.md) gained Marinara's on-disk layout, the pin,
and the three export shapes; [survey §3](../01-source-survey.md) gained where ST
personas live and the compressed-chunk card fact; [triage §2A.3] and
[triage §4] were corrected on the deleted branch and the measured line count;
[work plan P4](01-work-plan.md)'s demonstrable line gained the second arm; and
[testing §5/§6](10-testing.md) took the corpus-split sentence early, because
the private corpus's absence is true now and P4.0 would only have re-derived it.
*Two more are owed and scheduled:* [13 §5.1](../13-internal-contracts.md) gains
the import-job tables beside the turn-job ones (with P4.0), and
[07 §7](../07-tech-stack.md) gains a zip reader argued in place beside
`@fastify/multipart` and LiquidJS (with the stage that opens an archive) —
**three new dependencies in one phase, which is worth seeing written in one
sentence rather than discovered one at a time**.

*The 2026-08-30 re-evaluation paid two more on the day and owes three:*
[05 §4.2](../05-ui-surfaces.md) gained §4.2.2 — the deliberate widening of
`fileAccess`, with `/data` carved out — and
[04 §4.2](../04-server-multiuser-deployment.md)'s `Capabilities` comment now
says the capability carries two powers. *Owed, all riding P4.4 with the sweep:*
`accounts.ts:75`'s comment, which describes only the browser;
`AdminAccounts.tsx:159`'s three labels, which describe only the browser and sit
under a "Recorded for later" legend that stops being true; and
`storage/README.md:68`, which says `files.ts` is "one place to add a permission
check when `fileAccess` grows teeth" — a forward-looking line this phase makes
true, so it gains the sweep rather than a correction. *Checked and deliberately
not on the list:* `layout.ts:171` and `:302` say `accounts.json` sits outside
every user directory "whatever `fileAccess` a user is granted", and the
carve-out is what keeps that true rather than what threatens it. **A widened
permission behind unchanged labels is the one item on this list that is not
bookkeeping**, which is why it is a gate step (§3.10) rather than a write-back
alone.

**6.5 What P4's landing changes for the panel's rules.** [P3 §7.1] (whether the
panel may re-subject itself) stays open and P4 does not force it: the review
is a full view by §1.4's addressability argument, so its rows navigate the
main view like any other link. [P3 §7.3] (the panel over a subjectless view)
gains one more surface — the review route — and inherits the same interim
answer: honestly empty.

---

**6.6 The reference counts [02 §10.1](../02-data-model.md) specifies, and the
delete that ships without them.** That section wants a confirmation reading
*referenced by 12 sessions, 3 treatments and 1 package*; what P4.4 built asks
*move to trash?* and counts nothing, because the counts need an inbound-links
query the index does not expose. It is the same query
[05 §5.2](../05-ui-surfaces.md)'s *Used by* panel needs, so this is one debt
rather than two and whichever phase builds that panel pays both. The interim is
defensible on the stance's own terms — dangling references are survivable,
visible and non-blocking ([00 §3.3](../00-stance.md)) — and it is recorded here
rather than left to be rediscovered, because a confirmation that has stopped
asking about consequences is very hard to notice is missing.

---

## 7. The completeness audit — 2026-08-30

**Run after P4.4's Landed record, against the code rather than against the
stage records.** The stage records say what each session set out to do; this
section says what is true. Six findings, three of them defects nobody had
written down, and the ordering below is by what a person would hit first rather
than by how hard each is to fix.

The recorded cuts are *not* repeated here — the browser directory upload, the
addressable report, the zip profile archive and the missing real corpus are all
named in §5 and in the P4.3 and P4.4 records, and being named is what they
needed. What follows is what was **not** named.

### 7.1 The single-file upload never grew past P4.1

**Fixed 2026-08-30**, with a correction to this section's own claim — see the
record at the end of it.

`routes/import.ts:196` converts Marinara envelopes and the three SillyTavern
preset kinds. It does not convert a V2/V3 card PNG, ~~a JSON card,~~ or a
SillyTavern lorebook — ~~all three~~ **both** of which the *sweep* converts,
through the same library, on the same build.

*Correction.* The JSON card was wrong in both directions and the error was mine:
the sweep did not convert one either. `reader.ts` routes **by top-level
directory**, not by content — `characters/` goes to `#card`, which requires a
container codec and reports `notACard` when there is none. So
`characters/Vera.json` was refused by the sweep with the same confident wrong
answer the upload gave. That made it a defect in the sweep as well, and it is
fixed in the same change rather than filed, because the two arms disagreeing
about *what counts as a card* is the exact failure this finding is about.

Two different wrong answers come out of that gap:

- A card PNG returns `recorded` with `import.file.notYetConvertible`, whose
  comment reads *"a file this build will convert at P4.2"* (`:226`). P4.2
  landed. The note now tells a person their file is fine but the software is
  unfinished, which was true when it was written and is false today.
- A lorebook JSON falls past all three preset probes and returns
  `unrecognised` — *"Could not be identified"*. That is worse than the PNG
  case, because it is a **confident wrong answer** about a file this build
  reads perfectly well one code path over.

`routes/import.test.ts:93` pins the PNG behaviour green, so the suite reports
the gap as correct.

**Why it matters more than its size.** *Upload one card* is the most common
single import anyone does, and the first thing a person will try. The sweep is
the impressive arm and the upload is the arm that gets used. Convergence here is
one call into the existing readers, not new conversion work.

### 7.2 The `fileAccess` control still describes the permission it used to be

Gate step 10 was amended on 2026-08-30 to require that the control be *out of
"Recorded for later" and that its labels name the sweep*. It was not done, and
P4.4 was recorded as landed anyway.

`routes/import.ts:128` refuses the sweep when `fileAccess` is `none`, so the
capability gates something real today. But `AdminAccounts.tsx:169` still sits
inside the fieldset whose legend reads **"Recorded for later"** and whose
sentence reads *"These features have not shipped"*, with the three labels *No
file browser*, *May read their own files*, *May edit their own files*.

So an administrator granting `read` is told they are enabling a file browser
over that person's own content, and is in fact granting **a server-side read of
any path on the machine outside `/data`** — which is precisely the widening
[05 §4.2.2] argued for in the open, on the grounds that a widening nobody can
see is the dangerous kind. The document was amended; the surface that carries
the decision to the person making it was not.

[01 §2.2] forbids a control that does nothing. This is its inverse and the more
serious one: a control that does **more** than its label admits. The `/data`
carve-out in `local-source.ts:86` is what keeps this from being a
privilege-escalation route between users, and it holds — the defect is in what
the grantor is told, not in what the grant permits.

### 7.3 Gate step 9 was never run — *closed 2026-08-31, §7.14*

*"Rebuild equals incremental, after a bulk import"* — described in the gate as
the best stress the [13 §5] assertion will ever get. `rebuild-property.test.ts`
exists and predates P4; no import test rebuilds. The one thing P4 could
contribute to that invariant, it did not contribute.

### 7.4 `import_job` and `import_event` are created and never written — *closed 2026-08-31, §7.14*

`state/migrations.ts:141` and `:176`. The migration landed at P4.4 as §1.3
decided; the writer was cut with the addressable report. The cut was recorded,
the **schema consequence** was not: the operational store now carries two tables
no code touches, which is exactly the shape of a migration that gets
misremembered as load-bearing later.

### 7.5 CHARX and `.seactor` are unimplemented and unrecorded — *closed 2026-08-31, §7.14*

§1.3 (`:417`) and §1.10 (`:1155`) both list them among what the card converter
covers. Neither exists. Both are zip containers — the same blocker as the
deferred Marinara profile archive — but only the profile archive's deferral was
written down, so these two read as shipped.

### 7.6 Gate step 11, precisely — *closed 2026-08-31, §7.14*

The substance holds: the report is `{key, params, level}` and the sentences are
composed client-side. What is not true is the word **fetch** — the report exists
only in the POST response and there is no address to re-read it from. That is
the recorded cut, so this is a wording repair to the gate rather than a finding
against the code, and it is listed here so the gate is not read as met in a
sense it was not.

### 7.7 What the audit confirmed rather than faulted

Named because an audit that only lists faults is not a measurement:

- Gate step 3's credential rule is a **property over the whole imported
  corpus**, not an example — `fixture-pair.test.ts:155` walks every object of
  every kind and asserts the fixture's credential appears in none of them.
- Gate step 4's depth reading is real and tested in *messages*
  (`collect.test.ts:529`), including the grouped-splice ordering.
- Gate steps 1, 6, 8, 13, 14 and 15 all have the tests their text describes.
- Every other `at P4.x` reference in the source is past-tense and accurate;
  `routes/import.ts:200` is the only stale forward-promise in the codebase.

### 7.8 A folder of loose cards converts nothing — found while fixing 7.1

`classifyRoot` returns `loose-files` for a directory that matches no probe, and
`sweep.ts:127` hands it to the SillyTavern walker with the reasoning *"a folder
of cards somebody assembled by hand is the ST tree with most of it missing, and
the walker already reports what it does not recognise"*.

The first half is the intent and the second half is doing something else. The
walker routes by **top-level directory**, so `Vera.png` sitting at the root has
`top === 'Vera.png'`, falls to `default:`, and is `unrecognised` — with an empty
note list, so the review does not even say why. Checked rather than reasoned:
classifying a two-file memory source and iterating it returns
`{"kind":"loose-files"}` followed by two `unrecognised` rows and no notes.

`detect.test.ts:51` asserts only the *verdict* — that such a root classifies as
`loose-files` — and never that anything in it converts, so the suite reports this
as working.

~~**Not fixed here, deliberately.**~~ *Fixed 2026-08-30 — see 7.8.1.* It looks
like the same defect as 7.1 and is not: the walker's `default:` arm is where
[§1.8]'s disposition table lives, and content-probing everything that lands
there would change what a *real* ST root does with `stats.json` and its
siblings — which gate step 13 asserts. The fix is to make the reader aware of
which kind of root it is walking and probe by content only for `loose-files`,
and that is a decision about the disposition table rather than a repair, so it
wants its own commit and its own gate line.

#### 7.8.1 The repair, and what reviewing it changed

`SillyTavernReader` takes its root kind as a constructor argument, and the two
roots now differ **completely** rather than partly:

- `sillytavern` is unchanged. Position decides everything, the disposition table
  is the knowledge, and gate step 13 still asserts it.
- `loose-files` never consults the table at all. Every file is read and probed by
  content, through `readUpload` — the same probe the single-file upload runs, so
  a card converts identically whether it arrives alone or in a folder of forty.

**The first version consulted the table first on both roots, and its own comment
said why that was wrong** — *position carries no information on a loose root* —
while the code checked position anyway. A review caught the contradiction: a
folder with an `assets/`, `themes/` or `backgrounds/` subfolder had every card
in it silently skipped, because those are thirty names SillyTavern happens to
use and in somebody's Downloads folder they are just words.

Four more things came out of that review, all of them the same shape — the loose
arm being quietly wrong in the way §7.8 was written to stop:

- **A sweep does not get to guess.** Two of the probes key on a field name rather
  than a format: `{ content: "…" }` and `{ temperature: 0.7 }`. Sweeping a folder
  of build config imported `appsettings.json` as a preset whose system prompt was
  the string it happened to have under `content`. `readUpload` now takes a
  confidence, and the sweep passes `high`: only formats that identify themselves
  — a card container, a `chara_card_v*` spec, a prompt manager, a world file. The
  named cost is that a loose folder of exported sysprompt and sampler presets
  imports nothing; a real tree still takes both by position, and a person who
  wants one can upload it.
- **`settings.json` at a loose root was swallowed.** It is an input on a real
  tree and an input to nothing on a loose one, so it vanished from the report —
  the single thing §1.3 says a sweep never does.
- **A file that could not be read came back with an empty note list**, which is
  the exact defect this finding exists to remove, arriving by a new door — and
  newly reachable, because of the next item.
- **A size bound**, because this change made one necessary. A walker used only to
  read files under directories it recognised, all of them small; a loose root has
  none, so the probe reads whatever is there, and a folder somebody points at can
  hold a disc image. `maxFileBytes` defaults to 64 MB, is checked with `stat`
  before the read rather than after, and a file past it is listed but not read.

**And a prototype-chain hole that predates all of this.** The disposition
registry is an object literal, so `TABLE['constructor']` answers with a
*function*, and so do `toString`, `valueOf` and `hasOwnProperty`. The old
`TABLE[top] ?? 'unrecognised'` had it too: a directory named `constructor` was
handed a function as its disposition, which travelled into the report and into
the counts. `Object.hasOwn` is the whole fix.

**Three of the guards written for this change passed against the bug they
guarded**, which is now the session's most repeated lesson and worth stating as a
rule: the `constructor` test used a *file* named `constructor.png` when the
hazard needs a *directory* (`top` is the first path segment, so the file never
reached the lookup); *accounts for everything it saw* asserted a list of source
names, which is identical before and after the repair; and the earlier
re-import test issued a `DELETE` that answered `428 hash-required` and deleted
nothing. **A test written beside the fix it tests is the easiest kind to write
green. Mutate it, or it is decoration.**

Two things left open rather than fixed. A Marinara envelope sitting in a loose
folder still reads `unrecognised`, though the same file uploaded alone converts —
`readUpload` deliberately does not handle envelopes, because one can carry a
whole profile and is therefore a *source* rather than an item, and giving a loose
sweep a nested sweep is a bigger change than this finding. And re-import identity
stays root-relative, so sweeping `~/cards` and then `~/cards/august` gives two
copies of the same card: [§6.2](#62)'s open question about filename identity,
reached from a third direction.

### 7.9 What the fix changed — 2026-08-30

**7.1.** The upload route no longer has a converter. `import/upload.ts` is the
third reader §1.3 always described: it probes one file by content and yields the
same `SourceItem` a directory walk yields. `sweep.ts` exports `convertOne`,
which is the sweep's own `Writer` at the scale of one candidate, so the upload
arm now inherits re-import identity, the version-history `import` attribution,
scenario deduplication, the portrait rule and the whole note vocabulary — none
of which it had. `routes/import.ts` kept only its transport: `convertPreset` and
`presetNameFrom` are gone, thirty-one lines including a docstring claiming the
sweep probes by shape — which it did not, and which is how the JSON-card
correction above stayed invisible for three stages.

The sweep's own JSON-card gap (the correction above) is closed in
`sillytavern/reader.ts#card`, which now falls back to reading the bytes as a
card when there is no container codec. Both arms share the probe —
`looksLikeCard` is exported from `upload.ts` and imported by the walker —
because *what counts as a card* is precisely the judgement they must not make
differently.

Six route tests cover the shapes a person actually arrives with: a card as a
picture, a card as JSON, a lorebook, the treatment a card's scenario produces,
a picture with no character in it, and the same card twice. Mutating the PNG arm
and the lorebook probe fails five of the six, so they are load-bearing rather
than decorative.

**7.2.** The `fileAccess` control moved to *In force now* and its three labels
name the sweep. The hint carries [05 §4.2.2]'s own bar — *grant it to someone
you would give a shell to on this machine* — rather than a softer paraphrase,
and says plainly that the browser half has not shipped, so the group's promise
stays true for what remains in it. `accounts.ts`'s *"still gate nothing"*
paragraph was rewritten; it had been false since P4.4. Three settings tests
assert the arrangement and the wording, including that *No file browser* is gone.

**And a third thing, which 7.1 made unavoidable.** `NOTE_LABELS` was missing
**24 of the 41** classes the server emits, so those rendered to a person as raw
dotted keys — including `import.card.bookExtracted`, which fires on every card
carrying a lorebook. Five of the missing 24 land on the upload path for the
first time in this change, so leaving them would have shipped a half-fix. All 41
are labelled, and `note-labels.test.ts` now fails the build in both directions:
a note with no sentence, and a sentence for a note nothing emits. That guard is
the actual repair — the map drifted for three stages because nothing looked.

Gate steps 9, 11 and findings 7.4, 7.5 and 7.8 are untouched and still open.

### 7.10 What an adversarial review of the fix found — 2026-08-30

The fix above was reviewed before it landed, by independent readers told to
refute rather than confirm. Four things came back that were worth acting on, and
the first is the one that matters.

**The `/data` carve-out was root-only, and 7.2's new labels had just finished
promising otherwise.** `openLocalSource` refused a sweep root *at or below* the
data directory and said nothing about a root *above* it — and `dataDir` defaults
to `./data`, so on an ordinary install the directory somebody would naturally
sweep is an **ancestor** of our own store. Reproduced before fixing: sweeping the
install root opened `ok`, listed `data/accounts.json`,
`data/system/connections/*.json` and
`data/users/<someone-else>/library/actors/<slug>/actor.json` — slugs being
name-derived, so another person's character and lorebook names were disclosed in
the review — and `read('data/accounts.json')` returned the file's bytes. Only the
walker's folder routing kept contents unconverted, which is one `switch` arm away
from not being true either.

This predates P4.4 and is the kind of gap a phase can carry without noticing.
What made it *this* change's problem is that [§7.2](#72) had just written three
sentences — the admin hint, the block comment above it, and `accounts.ts`'s
paragraph — telling an administrator that the carve-out is why the grant is safe.
A widened permission behind a containment claim that is not enforced is worse
than the unlabelled control it replaced.

Fixed by pruning rather than by refusing an ancestor root, because refusing would
break the case the capability exists for: someone whose data lives at
`/home/bob/storyengine/data` sweeping `/home/bob` to find SillyTavern. They may
walk around us; they may not walk through us. Enforced in both `list()` and
`read()`, because the readers build paths the walk never yielded — a portrait, a
table named by a manifest.

**The upload could answer with a treatment it had synthesised.** The route chose
`reports.find(converted)`, and the trigger is narrower than the review stated,
which is why it is written out in the test: on a plain re-import the card and its
treatment both read `unchanged`, so the fallback returns the right row anyway.
The bug needs the card unchanged while the treatment is new — import, delete the
treatment, import again — and then the response `source` is `Scenario: …`, a file
the person never sent. `reports[0]` is right in every case, because `convertOne`
puts the uploaded file's own row first by construction.

**`looksLikeCard` would have imported `package.json` as a character.** The first
list counted `description` as evidence, and `name` plus `description` is the shape
of half the JSON on a disk. It now requires a greeting, an example exchange or a
personality — fields nothing but a card has — or an explicit `chara_card_v*`
spec. The cost is a hand-written minimal card with only a description, which is
now an honest `unrecognised`.

**Two of the checks I had just written did not check.** The note-label guard's
first version searched for a bare word and matched the *local variable* in
`params: { file: filename }`, so the mutation that should have failed passed; and
the re-import test's `DELETE` answered `428 hash-required` and deleted nothing,
so it passed for the wrong reason. Both are fixed and both now fail when the
behaviour they describe is reverted. Worth recording as a class rather than as
two slips: **a guard written alongside the fix it guards is the easiest kind to
write green**, and mutating it is the only thing that tells you.

Two findings were left alone deliberately. Re-import identity keys on
`Provenance.originalFilename`, so a card swept from a folder is
`characters/Vera.png` while the same card uploaded is `Vera.png` — importing both
ways gives two actors, and two unrelated files sharing a name replace each other.
That is [§6.2](#62)'s open question about filename identity, reached from a new
direction rather than a new defect, and the answers it already names — a
source-app tag, a content hash — are the answers here too.

### 7.11 The wrong folder inside the right install — 2026-08-31

**`classifyRoot` has never failed on a folder that is merely wrong**, and
[§7.8](#78) made that worse rather than better. Every directory matching no probe
answers `loose-files`, which was the correct call for the folder of cards
somebody assembled by hand and is the wrong shape of answer for somebody who
pointed at `C:\SillyTavern` instead of `C:\SillyTavern\data\default-user`. Before
7.8 that sweep found almost nothing; after it, the loose walker asks every file
what it is, so the same mistake now walks the whole checkout, converts whatever
self-identifies — the sample content SillyTavern ships in `default/content/`
included — and still cannot see the personas, because those are a join between
`settings.json` and `User Avatars/` that only the positional reader makes.

**A successful-looking import of the wrong things is worse than an empty one**,
and it is exactly the case [§1.3](#13)'s own sentence names: *"I pointed it at my
Marinara folder and it found four cards" is otherwise indistinguishable from
success.* The verdict was made visible; what was missing is the advice.

`import/near-miss.ts` is that advice. Given the folder somebody named, and the
folder above it when there is one, it answers which of sixteen recognisable
mistakes this is and what to point at instead — `data/default-user` for a
SillyTavern install root, `public` for one older than 1.12, `packages/server/data`
for a Marinara install root, `..` for somebody who picked `characters/`.

**The invariant is what makes the false-positive question answerable.** A finding
marked `verified` names a folder at which *the same marks `classifyRoot` uses*
were all found, so following it produces a root the classifier agrees about. The
marks are therefore never re-declared: `detect.ts` gained a `probeMarks(files,
kind, prefix)` and evaluates its own table under a prefix. Two copies of a probe
table is one copy that eventually stops matching — `marinaraPreflight`'s argument,
applied one level out. The round-trip test is the property, and it is the only
thing that would catch a prefix added to the table without its marks.

**Four decisions worth keeping:**

- **A suggestion is advice, not a gate.** Acting on one sends a fresh absolute
  path back through `openLocalSource`, `classifyRoot` and `survey()`, which are
  the real gates and are untouched. So the bar for speaking is *would not
  embarrass us* rather than *safe to import*, which is why an inferred `../..` is
  acceptable and a guessed `characters/` is not: the first costs a wrong hint,
  the second tells somebody a lie about their own machine.
- **No basename, ever.** The obvious implementation of *you picked `characters/`*
  is to look at the picked folder's own name. It fails in both directions — a
  hand-assembled folder called `characters` would be told its SillyTavern library
  is one level up when the parent is somebody's Downloads, and a copied library
  renamed `st-backup-2026` would be missed. The ascending rules probe the parent's
  marks instead, which costs one `openParentSource` and is the same bar as
  classification.
- **The descent is not gated on install markers**, and that is deliberate rather
  than lax. A Docker host directory holds `config/`, `data/`, `plugins/` and
  `extensions/` and has no `server.js`, no `package.json` and no `public/`, while
  `data/default-user` under it is perfectly valid. Requiring an install marker
  before descending would read as prudence and silently drop that whole
  population. The suggestion carries the full mark set, so it justifies itself.
- **Where the evidence ran out, it says so rather than guessing.** SillyTavern
  keeps user handles in node-persist rather than as directory names, so a
  multi-user data folder gets a sentence and no path. A relocated `dataRoot` is
  named as unknowable without reading `config.yaml`, which would need a YAML
  parser this module has no business owning. Marinara's own `.env.example` tells
  people to check both of its two possible data folders and not to delete either,
  so when both are present both are offered and neither is chosen.

**`POST /api/import/inspect` is the same reading without the import**, and it is
behind the same `fileAccess` gate and the same `/data` carve-out, because it
reads a foreign directory the same way. **It never lists a directory**: every
answer is a yes/no probe at one of twenty-seven paths this build already names in
its own source. [05 §4.2.2] keeps the sweep's report relative so the review does
not become a filesystem map, and an endpoint that enumerated children would hand
back precisely the map that clause refuses. What a person learns is whether the
folder they already named is the one to use.

**One clause of the plan is deliberately not discharged here.** [05 §4](../05-ui-surfaces.md)
defers the file browser past 1.0 and this is not a down payment on it: there is
no tree, no listing, and no way to discover a path you could not already type.

**Cut and named:** a seventeenth rule, for a Marinara data root whose
`FILE_STORAGE_DIR` was relocated so it has the asset folders and no `storage/`.
It rested on which of those folders always exist, and several are created on
demand by a route rather than seeded at boot — so unlike every other row it could
not be grounded, and it would have been the one rule guessing.

#### What an adversarial review of the near miss found

Reviewed the way [§7.10](#710) was, by readers told to refute rather than
confirm, across four lenses — security, rule correctness, test honesty, and
whether the citations in the table check out. Twenty-four candidates, eleven
upheld. One was a defect in the code; the rest divide almost evenly between
tests that passed for the wrong reason and comments that cited the wrong line.

**The defect: `verified` was a claim the code could not always keep.** Both
sources are rooted at `realpath(root)` — `openLocalSource` resolves before
constructing, and `openParentSource` takes `dirname` of that same resolved path
— but the suggestion was made absolute against the *unresolved* string the
caller sent. The two agree until a symlink is involved. Reproduced: with
`decoy/st-characters` a link into a real library's `characters/`, the marks were
probed in the library's user directory and the path handed back was `decoy/`, so
a finding whose contract says *the classifier would agree* named a folder that
classifies as `loose-files` — and following it would have swept an unrelated
directory. The fix anchors the suggestion on the real path, and the regression
test builds the junction rather than describing it.

**Four rules could be reduced to one conjunct each with the suite green.** The
SillyTavern program folder to `server.js` alone, the Marinara one to
`pnpm-workspace.yaml` alone, the data folder to a lone `_storage`, the storage
folder to a bare `tables/`. Each conjunction exists precisely because its first
mark is a common name, so every one of those mutations turns the module into
something that diagnoses ordinary Node projects as somebody's library. In every
case the only fixture reaching the rule supplied all its marks at once, which is
the *"a test written beside its fix is the easiest kind to write green"* class
[§7.10](#710) already named, arriving through a different door.

**Two suppressions and the already-a-source gate were deletable with the suite
green**, for the same reason: no fixture was a complete install root, and both
quiet-folder cases returned `[]` because no rule fired rather than because the
gate stopped them. Pinning the gate needed a folder that is a valid source *and*
matches a rule — a live Marinara data root that also carries the `data/`
leftover.

**And one test could not fail at all.** *Imports nothing — the library is
untouched by a look* pointed at a fixture with nothing importable in it, so the
empty library afterwards was the fixture's doing rather than the route's. It now
carries a preset, and asserts that sweeping the same folder does produce it.

**Three citations in the rule table were wrong**, which matters more here than
usual because the table's whole claim to being checkable is that every row cites
the source it came from. 1.11.8 keeps `public/settings.json` in
`src/endpoints/settings.js`, not in `constants.js`. `slugify` does not strip
characters outside `[a-z0-9]` — it replaces runs of them with a hyphen, and the
leading-underscore guarantee comes from the *second* replace stripping leading
hyphens, so the sentence had not been guarding the property it named. The
installer's `marinara-engine.db` warning is at `:194`; `:196` is the `Abort`.
A fourth, found while checking the others: the `<install>/data` case was
attributed to a "v1.4.6 root-data era" that never existed — the earliest tag
containing that commit is v1.5.0, the revert came six hours later rather than a
day, and the commit produced `<install>/packages/data` anyway. The rule survives
on evidence that is still true (the installer probes both paths; `.env.example`
tells people to check both), and the archaeology is gone.

**One sentence was false for half of what emitted it.** Two situations shared
`import.root.sillytavernBelow`, whose words name the *program* folder — right
for the install root, wrong for the data folder, which is the failure a shared
class always has when the two things it names are not the same thing. Split.

**A process note worth keeping.** The review agents ran their mutations in the
working tree and left two of them in place, so a gate run between the review and
reading its output was measured against tampered source. Nothing shipped from
it, but the lesson generalises past this change: **a mutation is only evidence if
it is reverted**, and a green suite proves nothing about a tree somebody else has
been editing. Every rule was re-audited against the table afterwards, and the
four mutations the review had used were re-run and are now caught.

### 7.12 Import moves into the workbench — 2026-08-31

*Asked for directly, and it cuts against [05 §3](../05-ui-surfaces.md). The
tension is recorded here and written back into §3 rather than resolved by
silence.*

**What §3 says, and why this is not simply a violation of it.** The workbench is
*"a panel, not a place"*, a **reader** whose *"subject follows the main view"*,
and [05 §2] lists import under the Library surface. An import panel holds state
and mutates, which is two of the three things §3 says the panel is not. What
makes this admissible rather than a quiet reinterpretation:

- **It is the subject over the library *list*, which had none.** [P3 §1.3] scoped
  the panel to a single object's route because a list has no selection concept,
  so over `/library` the dock has always rendered *nothing here has a record to
  show*. [P3 §7.3] left open what a subjectless route should show. Import is the
  answer for this one: the list as a whole is the thing it is about. The subject
  still follows the main view, and the interim empty state survives everywhere
  else — the sessions list now carries the test that used to live here.
- **§3 already admits a mutating panel action.** *Promote a dry run* stays on the
  condition that *"a panel that changes things has to say so more loudly than a
  read-only one would"*, which the panel's *nothing is staged* sentence and the
  review below it do at length.
- **The review did not become addressable.** [P4 §1.4]'s argument — a report
  somebody pastes into an issue wants a URL, and a panel scoped to the main view
  can never be one — stands untouched, and so does P4's second named cut.

**What moved is the mount, not the module.** `ImportPanel.tsx` stays where it is
on disk: `note-labels.test.ts` greps it by literal path, and moving the file
would mean editing that gate for no gain. The workbench renders it through a
subject of its own.

**The Library page keeps a way in**, because [05 §5] says the empty library
*points at import* and a feature reachable only by knowing a keyboard chord is
pointed at by nothing. The control patches `ui.workbench-open` rather than
routing — [P3 §1.2] keeps that state out of the URL on the grounds that a
URL-addressable panel is a place — and it opens rather than toggles, because a
control that closes the panel it just opened is not what a button labelled
*Import…* promises.

**The fold, and why its default is upside down.** The controls collapse behind a
`<details>` on `ui.import-open`, copying `AsStored`'s mount-time-toggle guard so
that applying a stored preference does not write it back. **Open is the absence
of the key**, which inverts what `AsStored` and the dock itself do — those fold
detail away from a surface that is useful without it, whereas this panel *is* the
controls, and greeting somebody with a closed fold labelled *Add to your library*
would hide the whole surface by default. The review sits **outside** the fold, so
collapsing the form leaves what it produced: the report outlives the controls,
which is the reason collapsing is worth having at all.

**The dock's width forced two changes that a wider column would not have.** At
280–640px the three controls that sat side by side have nowhere to sit, so they
stack; and the review's three-column table — file, disposition, notes — was
mostly prose, so at the narrow end it degenerated into three columns of one word
wrapped six times. It is a list now. Nothing numeric lined up across rows, so
nothing was lost, and the material was one record per file rather than a grid all
along. The counts stay a row: those genuinely are comparable across entries.

**And the file chooser became a button in the same pass**, because the JSX was
being rewritten onto the shared primitives anyway. `<input type="file">` renders
as the user agent's own widget — grey, unlike anything else, reading as text
rather than as a control — so the input is `sr-only` behind a real `Button` that
clicks it, and the chosen filename is shown, since a picker whose choice leaves
no trace is one you cannot check before committing to it. The panel had **no test
for that path at all** before this; it has three now.

### 7.13 The browser directory upload, un-cut — 2026-08-31

**[§5](#5) cut this and named it first-to-cut, so reversing it needs a reason
rather than an appetite.** The cut's argument was that *the server-path sweep
alone still pays the demo on the install the demo describes; the upload variant
is reach, not core*, and that was right about the demo. What it did not weigh is
who the server path cannot serve at all:

- **Somebody whose browser is not on the machine the server runs on** has no path
  to type. StoryEngine is a self-hosted server; the household case is a box in a
  cupboard and a laptop on the sofa, and for that person the sweep is not a
  worse option, it is no option.
- **`fileAccess` is admin-only and deliberately hard to grant.** [05 §4.2.2] sets
  the bar at *somebody you would give a shell to on that machine*, which is the
  right bar for reading arbitrary host paths and far too high for *I would like
  to import my characters*.

**So the two transports serve different people and both stay.** The browser
upload needs **no `fileAccess` at all**, and that is the load-bearing difference
rather than an oversight: the sweep reads the host's filesystem through the
server's own user, while this reads nothing — the browser opened the folder under
the person's own credentials, and what arrives is a list of names they chose to
send. An account that may upload one file may upload a folder of them.

**Two routes, because it is two questions.** *What is this folder, and what of it
do you need* is answerable from **names alone**, since every probe in
`detect.ts` and `near-miss.ts` is an existence question. So
`POST /api/import/directory/plan` takes a manifest of relative paths and sizes
and answers with the verdict, the near-miss advice, and the list of files worth
carrying — all before a byte is uploaded. `POST /api/import/directory` then takes
the manifest again alongside those files.

**The whole folder is named; only some of it is sent.** A SillyTavern user
directory is thirty directories and most of them are chats, backups, thumbnails
and vectors — material the importer reports and never opens. Uploading it to
learn that would move gigabytes to discover what a name already says. The rest
arrive as `declared` paths on `MemoryFileSource`: `list()` yields them and
`exists()` finds them, so **nothing is silently dropped** still holds — the
review names them and says what they were — and `read()` answers `null`, which
is the same answer an unreadable file gives and is handled the same way.

**Which files are wanted is the registry's knowledge, not a second list.**
`SILLYTAVERN_DISPOSITIONS` already says which directories hold convertible
material, and it is the same table the walker routes by, so the two cannot drift
into disagreeing about which folder holds the cards. Checked when this landed:
the six directories the reader opens — `characters`, `worlds`, `OpenAI Settings`,
`TextGen Settings`, `sysprompt`, `User Avatars` — are exactly the six the
registry marks `converted`, plus `settings.json`, which is read because a persona
is a join between it and `User Avatars/`. A loose root wants everything, honestly:
[§7.8](#78) made it probe every file by content, so there are no positions to
narrow by and the size budget is the only bound.

**The defect found on review, which is the one worth recording.** The two halves
disagreed about what `maxUploadMb` measures. `planUpload` spends it as a running
*total* across every file it asks for; the upload route handed the same number to
busboy as `fileSize`, which is **per part**. So a folder of a thousand files each
just under the limit was a thousand times the limit, buffered into one object in
memory — reachable from any signed-in account, precisely because this route is
correctly *not* behind `fileAccess`. Reproduced before fixing: eight 200 KB files
against a 1 MB limit returned `200`. The route now accumulates and refuses at the
budget, and the test fails when that accumulation is removed.

*A limit a well-behaved client respects and the server does not enforce is not a
limit* — and this one had a client that respected it, which is exactly why
nothing looked wrong.

**A count cap rides behind the byte budget** (fifty thousand parts, the number
`DEFAULT_LOCAL_LIMITS` and the manifest schema also use) and is **named as
untested**: reaching it needs fifty thousand parts, so it is a backstop behind a
bound that is checked rather than a second line anybody has watched hold.

**Crafted paths are kept inside the folder.** The relative path travels as the
multipart *field* name, because a filename cannot carry a directory and survive
sanitising, and it is rebuilt segment-wise with `.` and `..` dropped. Nothing here
touches a disk — these become keys in a `Map` — but a path that climbed would make
the review describe a folder nobody picked.

**No suggestions on the upload response**, unlike the sweep: a near miss names a
*sibling folder* to point at, and a browser upload has no path to point anywhere
with. The plan step says it instead, which is the moment a person can still act
on it by picking again.

### 7.14 The rest of the audit, closed — 2026-08-31

*Numbered 7.14 rather than 7.11, which is what it was written as. A concurrent
session had already taken 7.11 through 7.13 — the near-miss finding, import
moving into the workbench, and the browser directory upload un-cut — and
`import/near-miss.ts` cites `[P4 §7.11]` in its own header. Source citing a
section number is heavier than prose citing one, so this moved rather than that.
The three of them are the reason to read this section last: they were written
against the same §7 on a branch that has §7.8's repair and not this entry.*

**Gate step 9 — rebuild equals incremental, after a bulk import.** Added to the
named `gate` CI step rather than beside it, because it *is* the [13 §5]
assertion. The gate called this the best stress that assertion will ever get and
the reason is the shape of what import writes rather than its size: a sweep is
the only thing here that creates many objects of many kinds in one burst,
through both `create` and `update`, with derived ids, carried assets and a
scenario deduplicated across cards — a multi-object write where the second
object's identity depends on the first having landed. The randomised property
generates sequences of single writes and cannot produce that. Fixed rather than
randomised, deliberately: what is checked is not *which* sequence but that a real
import leaves the two producers agreeing. Mutating `rebuild` to skip one kind
fails it.

**Gate step 11 and §7.4 — the report has an address.** These were one item: the
tables were unwritten *because* the addressable report was cut, and the word
*fetch* in step 11 was not true of anything. `import_item` is appended to the
migration chain, the sweep records its outcome, and `GET /api/import/jobs` and
`/jobs/:id` return the same `ImportReport` the POST answers with — the same
shape deliberately, so the client keeps one renderer for a review.

Three decisions inside that are worth having written down:

- **A table rather than more `import_event` rows**, though the columns would have
  fitted. That table is progress — key-and-params ticks, the shape `event` has
  for turns — and a review item is a row about a *file*, with a disposition and
  often an object it produced. Storing one as the other would make the report
  reconstructible only by convention, and would not answer the question
  [P5 §1.8] already needs answered: *what did the import say about this book?*
  That is a lookup by `object_id`, which is why the column exists and is indexed,
  and `importNotesFor` is the query P5 will call.
- **A refused root is a job.** Both gates that can turn one away now record it —
  the path gate and the source gate — because *why did my import not happen* is a
  question with an answer, and it should live where every other answer lives.
  Recording only half the refusals would be worse than none.
- **Written after the sweep, not streamed.** `job.progress` stays unemitted.
  Recording the outcome is what makes a report addressable; recording it live is
  what makes a progress bar, and conflating them would leave a half-built emitter
  nobody drives.

**§7.5 — CHARX built, `.seactor` struck.** The finding was really two items and
only one of them was work.

CHARX is a foreign format and this phase owed it. It arrives as a zip, so the
blocker was a reader — written here rather than depended on, for `card/png.ts`'s
reason: the needed subset is small and forty years old, and the part that matters
is the part a library would not do, which is *refusing* an archive before it
costs anything. §1.3's four bounds are all checked from the central directory
before a byte is inflated — entry count, per-entry size, total size, and path
traversal — because a bomb caught after decompression has already been
decompressed. `node:zlib` was already in use for PNG chunks, so no dependency
moved.

**And the reader paid for two things nobody asked it to.** A zip is a *root*, so
`ZipFileSource` makes §1.3's *an archive is a root read through a different file
source* literal — which closes P4.3's deferred **Marinara profile archive** and
makes a zip of a loose cards folder work, both for free and both tested.

`.seactor` was struck instead, because listing it was the error. It is *our*
container, the actor-sized sibling of the `.sepack` that [§4] puts out of scope
in as many words, `layout.ts:74–79` records P4.0 reading it exactly that way, and
**nothing writes one** — there is no export path in this build, so an importer
would have been a reader for a format with no writer. §1.3 and §1.10 are amended
by strike.

**What is left of §7.** Nothing from the audit. The two things named in §7.8.1
stand as open questions rather than defects: a Marinara envelope inside a loose
folder still reads `unrecognised` though the same file uploaded alone converts,
and re-import identity is root-relative, which is [§6.2]'s filename-identity
question reached from a third direction.

### 7.15 Delete was offered on a shadowed copy — found by covering P4.4

*Numbered 7.15 and 7.16 rather than 7.10 and 7.11, at the merge. Three sessions
wrote into §7 on the same day and each reached for the next free number it could
see; main already had both. The findings are untouched — only the numbers moved,
and [17 §3](17-p2c-brief.md)'s citation moved with them.*

`ObjectDetailPage.tsx`. Edit is gated on `source === 'user' && !object.shadowed`.
P4.4's Delete, written directly beneath it, was gated on `source` alone. Two
files can hold one id, this page opens either through `?source=&slug=`, and
every *write* route resolves an id to the winner — so Delete on the losing copy
moved a folder other than the one on screen.

**Nothing server-side could have caught it**, which is what makes it a finding
rather than a diff: from the server's side that request is well-formed and does
exactly what it asks. This is F19 a third time, with the stakes raised from
*shows the wrong object* to *removes the wrong object* — and a third occurrence
is the argument for the condition being one predicate rather than two
hand-written copies that drift apart. It is one predicate now, which is also
[polish §1](09-polish.md)'s closing note half paid.

### 7.16 A refused delete rendered nothing at all

Same file, same control. The failure path set the message and called
`setConfirming(false)`; the message was rendered only by the confirming row,
which that call had just replaced. So a `412` — the case the code's own comment
names as *exactly when a delete should stop and say so* — stopped, said
nothing, and read as a click that had not registered. Every refusal did:
`403`, `409`, a dropped connection.

**The dead branch is the tell, and it is worth naming as a class.**
`{error !== null ? … : null}` sat inside the one branch that could only render
while `error` was null, and it survived review because it is indistinguishable
from the code that would be right. The message lives outside both branches now
and is announced; the mutation that moves it back is what reddens.

### 7.17 One hand-picked file gets a look before it lands — 2026-09-01

**§1.4's decision is narrowed rather than reversed, and the narrowing is
somewhere its own argument does not reach.** *Import commits immediately and the
review reports loudly* rested on three claims: a staging area is a second library
to maintain; dangling references are survivable, visible and non-blocking by
stance; and a three-hundred-object sweep gated per-object on a human is not a
review, it is a chore. All three are about **scale and staging**. None of them
reaches one file somebody has just chosen out of a dialog — there is nothing to
maintain, nothing to reap, and the cost of asking is one click about one object.

So a **sweep** still commits first and reports. **One hand-picked file** reports
first and commits on a word, through a new `POST /api/import/file/preview`.
[05 §5](../05-ui-surfaces.md) is amended by strike, as P4.4 amended it.

**No staging area appears, which is what keeps this from reopening §1.4.** The
preview writes nothing and holds nothing: the bytes stay in the browser's own
file handle and are sent a second time on confirm, so the commit re-derives
everything from the file. Nothing is built to be discarded because nothing is
built. The two can disagree — a file changed in between makes the commit's report
the true one and the preview an expired prediction — and that is the honest
posture rather than a gap, the alternative being the server-side scratch copy
§1.4 refused.

**The commit is a second upload, not a POST of the converted object.** Sending it
to `/api/library/presets` would have been less work and cost four things at once:
`stampImported` never runs, so re-import identity is dead for that object;
`identify` never runs, so every later re-import doubles; nothing reaches the job
ledger, so `importNotesFor` — which [P5 §1.8](07-p5-implementation.md) is built
on — can never find the object's own review; and the credential rule moves from
the converter to the client. There is one write path, and this is a way of
looking at it rather than a second one.

**Not a wizard, and the reason is not only house style.**
[05 §1.1](../05-ui-surfaces.md) rejects progressive disclosure as a reflex on the
dense surfaces, and import is in the dense column by name. The stronger reason is
that the steps would be empty: the decisions here are *keep it or not* and, on a
re-import, *replace or keep both*. Everything between is a slideshow of the
server's progress, and disclosure has to be earned. Not a `Dialog` either — §5
names *a review step, not a modal that dumps*, and `size="wide"` is `max-w-lg`,
**narrower than the dock's own 640px maximum**, so it would cover the panel with
something smaller than the panel.

#### Three defects found while reading, and what became of each

**Credentials were dropped on one converter of three.**
[10 §8.4.4](../10-schemas.md) drops ST's `sensitiveFields` from every preset
unconditionally and §1.1 gives it a vendored snapshot, but only
`convertChatCompletionPreset` called it. The sysprompt and text-completion
converters copied every unconsumed field into `compat` verbatim, and the path is
short: `upload.ts`'s `SAMPLERISH` arm classifies any object with a temperature
number as a text-completion preset, so one uploaded file carrying a temperature
and a password was enough. Against **gate step 3**'s *credential gone, from the
object and from `compat`* — and `invariants.test.ts` could not have caught it,
because that test walks schema declarations and `compat` is
`Record<string, unknown>`, so no declared property denied it. Fixed here, with
assertions over the whole serialised preset rather than field by field: the claim
is that no route carries the value.

**Five sampler settings are stored and never sent.** `toSdkParams` puts eight
`GenerationParams` fields on the wire. `topK`, `topA`, `minP`,
`repetitionPenalty` and `n` are not among them, and all five convert faithfully
from a SillyTavern preset — so *"6 of 41 sampler settings carried over"* has been
true and misleading since P4.1. Named here and fixed at
[polish §8](09-polish.md), because closing it needs a provider-specific escape
hatch and that is the generation path rather than import.

*The list is read off the request body by a test rather than off the adapter, and
that is not fastidiousness: the first draft of it was written by reading
`toSdkParams` and was wrong.* `topK` **is** passed to the SDK, and
`@ai-sdk/openai-compatible` drops it before the body because `top_k` is not in
the OpenAI chat schema. So the adapter reads as though it handles `topK` and does
not, and only the wire knows. The SDK does say so — to `process.emitWarning`,
which is not a place anybody looks and not a place the turn record reaches.

**Instruct and context templates came back "nothing here recognised this file".**
A confident wrong answer about a valid file the sweep reads by position one code
path over — §7.1's defect again, differing only in how the file arrived. The
content probe gains three arms, none of which converts anything:
[10 §8.4.5](../10-schemas.md)'s *no instruct templates* stands, and what changed
is the sentence a person reads. They sit above the confidence gate because each
demands two or three co-occurring field names only SillyTavern uses, which is the
`prompts`-array side of that line rather than the `{temperature: 0.7}` side.

**And the same question was being answered twice.** The registry skips
`reasoning/`; [10 §8.4.2](../10-schemas.md) said reasoning presets *go to
`compat`*, which cannot be true of a kind that produces no `Preset` to be
`compat` on. The upload table now names the registry directory each arm must
agree with and a test holds the two together, so the file and the folder cannot
start saying different things about the same kind. The doc is corrected.

#### Smaller things this stage closed

- **`onConflict` reached every import door except the one people use.** The sweep
  and the folder upload have taken it since P4.4; `POST /import/file` ignored it,
  so re-uploading a changed preset silently replaced. It reads the field now —
  before the file part, which is where the multipart reader stops, and asserted
  rather than left to be discovered.
- **The content probe had no test file of its own**, so *"order is load-bearing
  and the reason is collisions on `name`"* was true and unchecked. It has one,
  including the adversarial direction: a chat preset that also carries
  `story_string` is still a preset.
- **`readOnePart` was extracted before the second copy existed**, not after. The
  413 is a catch rather than a check, the 415 is a `catch` arm rather than a
  content-type test, and truncation is read after the buffer — three pieces of
  arranged-just-so control flow that would have been copied and then drifted.

#### Not done here, and named

- **Card and lorebook previews.** Both converters are already pure, so the
  summary shapes and their renderers are the whole of the work. Until then those
  files preview as `{ kind: 'opaque' }` and the screen says what it honestly can
  — the **flow** is uniform for every hand-picked file from this stage on, and
  only the richness of the look varies. Uniformity is the property worth
  protecting; a preview that fired for preset JSON and not for the card PNG most
  people upload first would be §7.1 committed on purpose.
- **The sampler advisory does not appear on a folder sweep's report.** It would
  go stale in storage, and forty presets would produce forty identical notes. The
  honest counter is that somebody who only ever sweeps never learns it.
- **`POST /import/file` still records no job.** Single-file uploads appear in no
  *Earlier imports* list, and `importNotesFor` can never find an uploaded
  object's own review. One `recordImport` call; it belongs to whoever needs
  [P5 §1.8](07-p5-implementation.md).
