# 06 — P4 implementation plan

**Status: plan.** The revisit the skeleton asked for, performed 2026-08-29
against the repo at `693b266` (branch `p3`, P3.−1 through P3.6 Landed). The
skeleton was drafted during P1 and said so; nearly every one of its "to decide
on revisit" items is decided below, several against ground that moved under it,
and the deviations from its leans are named where they happen. Format follows
[03](03-p1-implementation.md); the readiness audit, honest-size and
still-to-settle sections follow [05](05-p3-implementation.md)'s.

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
triage ([triage §4](02-triage.md): Marinara's `import/`, ~4,450 lines, "the
single largest body of 'someone already found the edge cases' in any of the
three") — turning an empty install into a realistic library.

**The demo that defines done:** *point it at a real SillyTavern data directory
and get a populated library, with a review step showing what resolved, what
went to `compat`, and what dangled — and a converted preset whose block list,
read in the workbench over a real turn, is recognisably the preset that went
in.* The last clause got sharper at the revisit: "read in the workbench" means
read over a turn the preset actually drove, which needs §1.9's one piece of
wiring.

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

**Ground that moved:**

- **The treatment slot literal never made it into code.** The Setting→Treatment
  rename ([10 §6]'s blockquote) updated the docs — [10 §8.2] and the
  [10 §8.4.1] marker table say `{ of: "treatment" }`, and [13 §1.1]'s
  `BlockSource` spells the same arm `kind: "treatment"` — while every line of
  shipped code, the scene preset, the workbench fixtures and the published
  JSON Schema artifact say `'setting'`. An importer written to the marker
  table emits presets the shipped `/0` schema rejects. §1.7 settles it.
- **`LoreScope` shipped with two arms, not [02 §3.4]'s three** — session
  scoping was deliberately moved to the session's own lore links
  (lorebook.ts:30–44). An ST book scoped to a chat has no representable
  target; the review names the drop (§1.4).
- **Marinara moved twice.** Its storage went SQLite → JSON snapshots under
  `storage/tables/` during this project's design window, and the
  `feat/scenarios` branch — the *only* place its "scenario" format ever
  existed — is gone from the remote ([triage §2A.3]). The skeleton's "Marinara
  scenarios → Setup" example targets an object that does not ship. At ~712
  commits in nine days, any survey of Marinara is a snapshot; §1.5 pins one.
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

**What a unit of import is** — widened from the skeleton's three examples to
what [02 §5.2] already committed to: a bare PNG, a V2/V3 card PNG, a **CHARX**
zip (card plus assets; the assets land in the object's `assets/` directory), a
JSON card, a `.seactor` folder-zip, a lorebook JSON — including an
entry-subset file, which [10 §5.2] makes a lorebook like any other — and a
preset JSON (chat-completion, text-completion, or sysprompt). Plus the
directory sweep.

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
  `fileAccess` capability — its first real teeth; the grant surface is the
  admin accounts page, per [01 §2.3]'s no-configuration-without-a-surface rule
  — for the self-hosted single box the demo describes. And a **browser
  directory upload** (`webkitdirectory`, many files with relative paths
  through the same multipart route) for a client that is not on the server's
  machine. One sweep engine over an abstract file source with two adapters —
  a local-path walker and an uploaded batch — so the converters never know
  which transport fed them.

**The sweep is a job.** A real ST directory is years of data; a request that
walks it inline times out. The sweep lands in the operational store
([13 §5.1]) with the existing job/idempotency vocabulary, emits progress, and
announces completion as `system.notice` — the closed notification list
([06 A2c](../06-open-questions.md)) is not widened for this. Its durable
output is the review report (§1.4).

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
`{key, params}` — and the sentence is composed at display time through
Intl/ICU. A report stored as English sentences would be A2d's latent bug
rebuilt. The reason-class vocabulary is a shared type (the client imports only
from `@storyengine/shared` — [P3.0]'s precedent for the turn record), and the
client label maps stay open with raw-word fallback, because a newer build's
class can arrive from disk.

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

### 1.5 Marinara and Aventuras — all three sources, survey first

Decided at this revisit: P4 keeps all three sources, and **P4.3 opens with a
survey stage whose questions are enumerated now** rather than discovered
mid-stage — because the survey ground moved (§0) and the skeleton's own
examples went stale:

**Marinara** (pin a commit; ~712 commits in nine days makes an unpinned survey
stale on arrival, and its storage layout has already changed once):

- Cards are literally V2 plus fifteen engine fields — they ride P4.2's ST card
  path with the extensions going verbatim to `compat` ([00 §2.4]).
- Lorebooks are the interchange format ([02 §3]) and land nearly unchanged;
  Marinara's *categories* map to `tags`, because `Lorebook.category` was
  removed deliberately ([14 §2d]).
- **The preset format is undocumented** — the survey's first question, against
  the pinned commit, before any conversion is budgeted.
- **Scenarios do not exist.** The `feat/scenarios` branch is deleted and no
  scenario type or table ships. There is nothing to record, and the skeleton's
  "Marinara scenarios → Setup" line dies here. `GameSetupConfig` (~70 fields
  mixing narrative and production) remains Setup-shaped later machinery —
  recorded, not converted, with [00 §3.2] stripping the production half if it
  ever converts.
- Personas convert as actors — the unified card exists because two of three
  sources regret the split ([survey §4](../01-source-survey.md)).

**Aventuras** (v0.7.8, single-user Tauri app, "local database"):

- **The extraction path is the survey's gating question — nothing documents
  how data leaves the app.** Until an artefact exists that a person can hand
  the importer, conversion cannot even be designed. If the survey finds none,
  P4.3 ships the finding, the review's "not yet importable" category covers
  the formats, and that is a completed stage rather than a failure — the
  fallback is named now so it is not negotiated under pressure.
- What maps if the path exists: `VaultCharacter` → actor (its own shape, *not*
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
  vocabulary to 2.0 anyway), and [triage §6.1]'s `[OPEN]` on authoring-side
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

### 1.8 What the sweep does with everything else in an ST user directory

A real ST user tree is ~30 directories; the sweep must have a stated
disposition for each class or the review's "nothing silently dropped" is a
lie. Decided dispositions: **convert** — `characters` (cards), `worlds`
(lorebooks), `OpenAI Settings` (chat-completion presets), `TextGen Settings`
(text-completion presets, params-only, ratio reported), sysprompt presets,
personas (actors; where they live on disk is a P4.0 survey line — the
source survey never documented it). **Record, not converted** — `groups`/`group chats`
(session/mode-shaped; member references would resolve-or-dangle if they ever
convert), chats (see §4). **Not converted, by position** — instruct and
context template files, `NovelAI Settings`/`KoboldAI Settings` (the
raw-completion fossil). **Skipped and counted** — `backgrounds`, `themes`,
`backups`, `vectors` (embeddings are derived data, [00 §2.8]), QuickReplies
(absent from every survey document; the sweep counts them by name so the
review is honest about what it saw), and anything unrecognised.

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

§1.2's corpus built (synthesised structural cases, permissive real ones, the
private corpus's location documented outside the repo); the
parses-but-is-wrong table harness for every parser; §1.7's slot-literal rename
completed across code, fixtures and the emitted schema artifact; §1.3's write-
path extensions (the card-bytes composer; nothing else — `create()`'s
no-version-record behaviour is kept and documented); the wrapper `replaceAll`
nit; the shared report/reason-class types and the import module skeleton; the
sweep-as-job vocabulary in the operational store; the P2C log's finding 8 verified
fixed or fixed here; the fixture-pair CI assertion wired as a **named step**,
failing. The ST-personas-on-disk survey line closed.

### P4.1 — SillyTavern presets, and the renderer they need

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

§1.10's card converter — V2/V3 PNG, CHARX, JSON card, `.seactor` — checked
**against** P4.1's slot targets, which is the whole point of
[testing §5.1](10-testing.md): the card importer and the preset importer
convert opposite ends of one format and must be checked against each other.
Scenario→Treatment creation with sweep-level dedupe; `character_book`
extraction and linking; personas. §1.11's lorebook converter with the decode
tables. **The fixture-pair assertion goes green here**, in its §3 step 2 form.

### P4.3 — Marinara, then Aventuras — survey first

§1.5, in order: the pinned-commit Marinara survey (preset format, categories,
storage-layout detection), then conversion of what it confirms — cards and
lorebooks are expected nearly free, presets are survey-dependent; the
Aventuras survey gated on the extraction-path question, conversion only if an
artefact exists, the named fallback otherwise. Everything that needs later
machinery is recorded with the review category that says when.

### P4.4 — The review surface, the sweeps, and the way out

§1.4 rendered: the routed report view over the structured report; the two
sweep transports over one engine (§1.3), the server-path side gated on
`fileAccess` with its grant surface in admin accounts; the re-import
skip/replace/keep-both flow; the client delete affordance and its api.ts
function; the import entry point on the Library page (whose empty-state
sentence finally learns the word "import"); `address.ts` grows the preset
source arm its docstring currently rules out, so the demo's block list links
back to the imported preset. 05 §5's review bullet amended per §1.4. The demo.

### Then: PLAYABLE

Not a stage of P4 and listed so it is not forgotten: wire the crude Scene mode
to the imported library — the preset picker from P4.1 is the wiring — sit
down, and play ([01 §4.1]). The four hypotheses get their answers here, the
answers feed the revisit of [07](07-p5-implementation.md) before P5 starts,
and [16 §6](../16-lorebooks-as-a-format.md)'s two corpus counts (Mentions and
folders across the imported corpus) run shortly after import lands, as that
document asks. **PLAYABLE needs the P2C sessions to have run** (§0) — a real
endpoint, proven, not the stub.

---

## 3. Verification — the P4 exit gate

1. **The sweep, for real**: point the server-path sweep at a real ST data
   directory (the private corpus, by hand) → populated library, review report
   at an address, nothing crashed, and **every file the sweep saw is accounted
   for** — converted, recorded, skipped-by-position, or counted as
   unrecognised. Nothing silently dropped.
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
   credential*) runs as a property over the whole imported corpus.
4. **Depth**: a depth-4 block sits four **messages** from the end in the
   workbench block list — not at the top, and not eight messages back.
5. **Macros, both halves**: an unrecognised macro → imported verbatim,
   flagged; a *recognised* macro → renders through Liquid in the assembled
   prompt, and no literal `{{` from the closed table's set reaches a rendered
   message.
6. **Re-import the same directory** → §1.3's identity rule: unchanged objects
   skip and are reported unchanged; a changed one offers replace (the
   version-history `import` arm fires — its first writer) or keep-both.
   Nothing doubles silently.
7. **The in-repo corpus imports without a crash, in CI** — and the private
   corpus has been walked by hand at least once, findings triaged into
   synthesised fixtures.
8. **One poisoned file never aborts a sweep**: a deliberately corrupt card in
   the fixture directory is a `warn`-class row in the review, and the sweep
   completes around it.
9. **Rebuild equals incremental, after a bulk import** — the [13 §5] CI
   assertion gets the best stress it will ever get, run against the
   post-import library.
10. **The config surface is honest**: the `LIVE_APPLIERS` row for
    `limits.maxUploadMb` reads `applied` and its test passes; the `fileAccess`
    grant surface exists where an admin can reach it. **And the standing line
    from [01 §2.3]:** if this phase built anything else that needs a value
    set, name where someone sets it before calling the phase done.
11. **The report is data**: fetch the review report over the API — reason
    classes, counts and parameters, no stored English prose; the sentences are
    composed client-side through Intl/ICU.
12. **Undo is real in-app**: delete a badly-imported object from the client;
    the tombstone behaviour is visible and the library reflects it.

---

## 4. Out of scope, deliberately

- **Export in any source's format.** We import ST; we do not write it.
  [00 §2.4]'s "re-export is possible" is a claim about `compat` preserving the
  bytes, not an obligation to build the writer.
- **Instruct and context templates** — not converted, *by position*
  ([00 §2.2]: raw completion is not supported at all). A distinct review
  category, because "will never come" answers differently from "not yet".
- **Chat and session history import — closed, not deferred.** The skeleton
  said "to confirm on revisit"; [06 E4] had already answered: session import
  is speculative and unroadmapped, "a half-working importer generates more
  support burden than no importer at all. Better none than one that rots" —
  and card/lorebook/preset import is explicitly distinguished as the bounded
  surface against formats that barely move. Confirmed by citation.
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
phase); **the review surface as a routed view over a job**; and **the
Marinara/Aventuras half, whose yield is survey-dependent by construction**.

The cut order, decided ahead of pressure rather than under it:

1. **The browser directory upload goes first** — the server-path sweep alone
   still pays the demo on the install the demo describes; the upload variant
   is reach, not core.
2. **Aventuras conversion goes second** — the survey still ships either way,
   and the extraction-path question may cut this one for us (§1.5 names the
   fallback as a completed stage).
3. **Marinara presets go third** — cards and lorebooks ride the ST paths
   nearly free and stay.

**What must not be cut, with the downstream phase as the reason:** the
credential drop (the stance's own showcase, [00 §3.2]); the fixture-pair
assertion (it exists because two individually-correct importers disagreed once
already); the single-file import path (it is what people use forever after,
and what [17 §14](../17-write-mode.md)'s content-import posture later leans
on); the Liquid renderer (PLAYABLE); the preset picker (PLAYABLE, again); and
the review report itself — P5's retrieval debugging inherits a library whose
provenance the review wrote.

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
deferred to 2.0. P4 proceeds on the settled half (Liquid for block templating,
chosen in three documents) and deliberately does not close C6; §1.6's scope
fence says so in place.

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
makes it true): [05 §5] — the review posture, post-hoc, amended by strike
(§1.4, lands with P4.4). [10 §8.4.2] — text-completion fields to `compat`;
[10 §8.4.3] — the heading's "Eight" becomes "Nine" (both with P4.1).
[13 §4.1] — the foreign-path doctrine (with P4.0). [testing §5/§6] — which
corpus CI runs (with P4.0). routes/sessions.ts's recorded P7 position — the
copy-at-creation amendment (with P4.1). [02 §2.7] — the table restated in
section terms with `talkativeness`'s destination (with P4.2); 02's header
self-contradiction ("see [10] … 13 is current") fixed in passing. [10 §5]'s
"the changes are four" — five, as the code's header already counts (with
P4.2). And the two stale code comments this audit caught: layout.ts:74–79
(package shape "settled at P4") and lorebook.ts:231 ("Settings remain the
primary home").

**6.5 What P4's landing changes for the panel's rules.** [P3 §7.1] (whether the
panel may re-subject itself) stays open and P4 does not force it: the review
is a full view by §1.4's addressability argument, so its rows navigate the
main view like any other link. [P3 §7.3] (the panel over a subjectless view)
gains one more surface — the review route — and inherits the same interim
answer: honestly empty.
