# 13 — Internal contracts

**Status: proposal.** The structures that never leave the install but that
everything is built against.

**Why this document exists.** [10](10-schemas.md) covers portable structures and
deliberately stops there — a turn record never crosses an install boundary, so it
is free to migrate ([10 §1](10-schemas.md)) and defining it early buys no
compatibility. That reasoning is right and produced a gap: *free to move* was
read as *need not exist*, and four of the turn record's substructures ended up
referenced across eight documents and defined nowhere.

They are not incidental. The turn record is described as the artefact everything
reads ([00 §1](00-stance.md)), the highest-value test surface
([work plan P2](workplan/01-work-plan.md)), and what branching, replay and the workbench are all
built on. **P2 cannot be written without these types.**

> **The tier is unchanged: internal, migrate at will.** Nothing here carries a
> `schema` field or a version number, nothing here is validated on import, and
> changing any of it is a normal refactor rather than a compatibility event.
> Defined because the first line of code needs them, not because they are stable.

---

## 1. The turn record, completed

[02 §8](02-data-model.md) defines `Turn` and `AssembledBlock` and references four
types it does not define. Here they are, with the properties other documents
depend on called out.

### 1.1 `BlockSource` — one vocabulary, used from both ends

Currently two vocabularies describing the same thing:
`AssembledBlock.source.kind` ([02 §8](02-data-model.md)) and `SlotSource.of`
([10 §8.2](10-schemas.md)). They overlap, disagree, and nothing relates them —
which would mean the workbench's block list and a preset's slot list disagreeing
about what anything *is*, while golden-file tests snapshot the former and authors
edit the latter.

**They are one vocabulary.** A preset slot names a source, the assembler fills
it, the resulting block records where it came from. Same name, both ends.

```ts
type BlockSource =
  | { kind: "persona" }
  | { kind: "actor"; actorId: ActorId; sectionId?: string; field?: "traits" | "visual" }
  | { kind: "lore"; entryId: string; phase: "before" | "after" }
  | { kind: "history"; range: [number, number] }
  | { kind: "examples"; actorId: ActorId }
  | { kind: "channel"; channelId: ChannelId }
  | { kind: "setting"; part: "framing" | "tone" }
  | { kind: "goal"; goalId: string }
  // ── The two a slot can never name, because no preset positions them ──
  | { kind: "preset"; blockId: string }   // a TextBlock: authored prose
  | { kind: "step"; stepId: StepId }      // contributed at runtime
```

**`preset` and `step` are the asymmetry**, and naming it is the point. A slot
positions content the engine produces, so it can never point at "the preset's own
prose" — that is a `TextBlock`, which *is* a block rather than a reference to
one. Likewise a step's contribution has no slot because it did not exist when the
preset was authored. `SlotSource` is therefore **`BlockSource` minus those two**,
which is a derivation rather than a second list.

The identifiers (`actorId`, `entryId`, `stepId`) are what make a block's
provenance clickable in the workbench — *which* lore entry, not just "a lore
entry". [03 §5](03-modes-and-turn-pipeline.md)'s "the reason is a product
feature, not a debug string" needs this to be true of the source as well.

### 1.2 `ChannelEffect` — the one to get right

**The most load-bearing type in this document.** It carries reversibility
([09 §2](09-branching.md)), it crosses the worker boundary
([12 §4](12-extensions.md)), it is what a branch replays
([09 §4](09-branching.md)), and it is what undo inverts
([00 §2.8](00-stance.md)). An effect that cannot state its own inverse breaks all
four at once.

```ts
interface ChannelEffect {
  id: string
  turnId: TurnId
  channelId: ChannelId
  /** Which value, when the channel is scoped per actor or per entry. */
  scopeKey: string | null

  op: EffectOp
  /** State before, for exactly the keys this effect touched. This is what
   *  makes the effect invertible without replaying from zero — §1.2.1. */
  before: unknown
  after: unknown

  /** Who proposed it, and who decided. The model proposing and the engine
   *  deciding is [03 §4]'s update policy, recorded rather than assumed. */
  proposedBy: { kind: "model"; callId: string }
               | { kind: "step"; stepId: StepId }
               | { kind: "user" }
               | { kind: "engine" }
  applied: boolean
  /** Present when `applied` is false. Validation failure, an engine-computed
   *  rule overriding a model proposal, or a policy refusal. */
  rejectedReason: string | null

  /** Schema version of the channel this was written against. [03 §4.2] */
  channelVersion: number

  /** Whether the effect stayed inside the session or escaped it — a library
   *  write, a generated asset, anything a branch cannot un-write. Escaped
   *  effects are recorded like everything else but never replayed or
   *  reverted ([09 §7]). Added ahead of P2 so P6 needs a field, not a
   *  migration ([P2 §2.7], closing [P6 §1.5]); P2 writes only "session". */
  scope: "session" | "escaped"
}

type EffectOp =
  | { type: "set"; path: string }
  | { type: "merge"; path: string }
  | { type: "delete"; path: string }
  | { type: "append"; path: string }
  | { type: "increment"; path: string; by: number }
```

#### 1.2.1 Why `before` is stored rather than derived

It looks redundant — the previous state is replayable — and storing it makes
three things cheap:

- **Undoing the tip is local.** Reverting the newest turn means applying
  `before`, not replaying 0..N-1. [00 §2.8](00-stance.md)'s promise, in place of
  Aventuras' hand-maintained `PersistentRetryState`.
- **The workbench can show a diff** without materialising two full states.
- **A snapshot disagreement is diagnosable.** [09 §4](09-branching.md) requires
  CI to assert replay-from-zero equals snapshot-plus-replay; when that fails,
  `before`/`after` pairs say *which effect* diverged rather than only that the
  end states differ.

##### `before` does not give arbitrary historical undo

An earlier draft of this section claimed it did — *"inverting turn N means
applying `before`"* — and that is wrong for any N that is not the tip.

> HP goes `10 → 8` at turn N. Later it goes `8 → 5`. Applying turn N's
> `before: 10` at the current head does not undo turn N; it destroys the later
> change and produces a state no turn ever wrote.

The general rule: **`before` is only a valid inverse when nothing has touched
the same path since.** Blind application is a silent corruption, and silent is
the operative word — the value is plausible, so nothing surfaces.

**Two operations, and they are genuinely different:**

| | Mechanism |
|---|---|
| **Undo the tip** | Apply `before`. Local, O(1), what the undo button does. |
| **Change something further back** | **Branch and replay** ([09 §3](09-branching.md)) |

The second is not a limitation to apologise for — it is the design's existing
answer. "Go back to turn N and do it differently" is a pointer move plus new
turns, which is cheaper *and* more honest than mutating history in place: the
original line survives, both are readable, and nothing is destroyed. A tree
model that also offered destructive historical edit would be offering a worse
version of what it already does well.

**So the implementation rule:** applying an inverse requires the effect to be at
the tip for its `(channelId, scopeKey, path)`. If it is not, the operation is
refused and the branch path is offered instead. That check is cheap — the index
knows the latest effect per path — and it converts a silent corruption into a
UI affordance.

*Cost:* effects grow with the state they touch, and a `merge` over a large object
stores a large `before`. Bounded by scoping `before` to the touched keys — hence
`op` carrying a `path` — and channel state is tracked numbers and flags
([03 §4.2](03-modes-and-turn-pipeline.md)), not prose.

#### 1.2.2 Rejected effects are recorded, not dropped

`applied: false` with a reason, kept in the record. A model proposing an illegal
state change is information — it is how a preset gets debugged and how
`engine-computed` demonstrates that it overrode something
([05 §3](05-ui-surfaces.md) lists exactly this in the workbench's effects view).
Dropping them would make "the model tried to give itself 40 gold" invisible.

They are skipped on replay, which follows from `applied`.

### 1.3 `ChannelState` and `ChannelDefinition`

```ts
interface ChannelState {
  /** Which schema version the value was written against. One integer, never
   *  the schema itself. [03 §4.2] */
  version: number
  value: unknown                 // validated against the definition's schema
  /** Set when load-time validation failed and the value was quarantined.
   *  The raw value survives here until the user chooses. [03 §4.2] */
  degraded?: { reason: string; raw: unknown }
}
```

`ChannelDefinition` is [03 §4](03-modes-and-turn-pipeline.md)'s, with one field
that section describes in prose and does not show:

```ts
interface ChannelDefinition {
  id: ChannelId
  owner: ModeId | ExtensionId | PackageId   // package: [03 §4.1], 2.0
  version: number                            // paired with ChannelState.version
  schema: JSONSchema
  scope: "session" | "actor" | "entry"
  init: InitPolicy
  update: "model-proposed" | "engine-computed" | "user-only"
  visibility: "player" | "hidden"            // [03 §7.3]
  budget: number | null
  surface?: WidgetSpec
  /** Optional, and optional deliberately — most schema evolution never needs
   *  one. Must be pure and deterministic: it sits inside the replay path.
   *  [03 §4.2] */
  migrate?: (fromVersion: number, state: unknown) => unknown
}
```

### 1.4 `ModelCall`

```ts
interface ModelCall {
  id: string
  stepId: StepId
  role: ModelRole                 // never a model id — [07 §5.1]
  /** What the role actually resolved to, recorded because the binding can
   *  change between turns and "why is this turn different" needs an answer. */
  resolved: { connectionId: string; modelId: string }
  messages: RenderedMessage[]     // §2
  params: GenerationParams
  /** Provider-reported, not estimated. The measured half of budgeting with a
   *  margin ([06 E5](06-open-questions.md)). */
  usage: { promptTokens: number; completionTokens: number } | null
  cost: { amount: number; currency: string } | null
  wallMs: number
  outcome: "ok" | "refused" | "error"
  /** Classified per [06 E7](06-open-questions.md), so the UI can offer the
   *  right recovery rather than surfacing a provider string. */
  error: { class: "transient" | "retryable" | "terminal"; message: string } | null
  retries: number
}
```

**`resolved` is the field most likely to be skipped and most likely to be
wanted.** Steps name roles, so nothing in the pipeline knows the model — which
means without this the record cannot answer *what actually ran*, and that is the
first question anyone asks about a turn that came out wrong.

### 1.5 `BudgetVerdict`

```ts
interface BudgetVerdict {
  /** The window, and where the number came from — a provider capability, a
   *  preset ceiling, or a user override. Presets carry absolute ceilings from
   *  ST import ([10 §8.4.1]) and a 4k number must not silently apply at 200k. */
  limit: { tokens: number; source: "provider" | "preset" | "user" }
  reserved: number                // held back for the completion
  spent: number
  /** Ordered as considered. Every block appears, including the included ones —
   *  a verdict listing only drops cannot answer "what falls out next". */
  decisions: {
    blockId: string
    tokens: number
    included: boolean
    /** The rule, in the language the workbench shows. "book budget",
     *  "priority 3 < cutoff", "always". [05 §3] */
    rule: string
  }[]
  /** What would drop on the next turn at current pressure. [05 §3] promises
   *  this is answerable *before* it happens, which requires computing it. */
  nextToDrop: string[]
}
```

### 1.6 `VersionRecord`

One line of `history/index.jsonl` inside a library object's folder
([02 §11.2](02-data-model.md)). Internal: the *payload* is a portable object, but
the bookkeeping around it never leaves the install and is free to migrate.

```ts
interface VersionRecord {
  id: string
  /** sha256 of the snapshot payload — the filename under history/v/, and what
   *  makes an edit-and-revert store one copy rather than two. */
  digest: string

  /** When the snapshotted state was *authored*, not when it was superseded.
   *  Taken from the replaced object's `provenance.updatedAt`. The subtlety
   *  Marinara names explicitly and the reason a restored version keeps its real
   *  date in the list. [02 §11.1] */
  authoredAt: string
  /** When the snapshot was taken. Usually uninteresting; occasionally the only
   *  way to explain an out-of-order list. */
  recordedAt: string

  /** What made the change this snapshot preserves the state before. */
  source:
    | { kind: "manual" }
    | { kind: "assist"; field: string }        // [05 §11.1]
    | { kind: "extension"; extensionId: string }
    | { kind: "import"; from: string }
    | { kind: "external" }                     // a hand-edit, seen by the watcher
    | { kind: "restore"; fromVersionId: string }
  /** Free text. Sometimes generated ("Saved before restoring an earlier
   *  version"), sometimes the user's — they may rename it later. */
  reason: string

  /** The author's own version string at the time ([02 §11.5]) — theirs, not
   *  ours, and displayed alongside our revision number rather than instead
   *  of it. */
  authorVersion: string | null
  /** Exempt from retention pruning. [02 §11.3] */
  pinned: boolean
}
```

**`revision` is not a field.** It is the entry's ordinal in the file, computed on
read, exactly as Marinara does it. Storing it would mean rewriting records when
one is pruned, and an append-only file should never be rewritten for a display
number.

**The live object appears at the top of the history list** as a synthetic
current entry rather than being written to the file — also Marinara's approach,
and it is what makes "compare against current" the same operation as comparing
any two versions.

---

## 2. Rendering: blocks to provider messages

[03 §5](03-modes-and-turn-pipeline.md) step 4 is one sentence, and it hides a
decision: **what happens to adjacent blocks with the same role?** Six consecutive
`system` blocks — one message or six?

It is not a detail. Providers differ, and some reject consecutive same-role
messages outright. SillyTavern ships `squash_system_messages` as a *user-facing
setting*, which is what a project does after discovering the answer varies by
endpoint.

**So it is a provider capability, not a global choice** — `mergeSameRole` on
`ProviderCapabilities` (§3), defaulted per known provider and overridable per
connection, exactly like the prompt caps beside it
([07 §5.3](07-tech-stack.md)).

```ts
interface RenderedMessage {
  role: "system" | "user" | "assistant"
  content: string
  /** Which blocks produced this message, in order. Non-empty always. */
  fromBlocks: string[]
}
```

**`fromBlocks` is the requirement that merging must not break.** The workbench
maps every sent byte back to the block that produced it
([05 §3](05-ui-surfaces.md)), and a merge that concatenates six blocks into one
string without recording which six destroys that mapping — quietly, and only
noticeably when someone is debugging. Keeping the list makes merging a rendering
detail rather than a loss of provenance.

Two rules that follow:

- **Merging is the last step**, after budgeting. The budget verdict is per block
  and must stay so.
- **A merged message is never re-split.** If a provider changes its mind, the
  next assembly renders differently; the record shows what was actually sent.

---

## 3. `ProviderCapabilities`

[07 §5.3](07-tech-stack.md) sketches this and trails off in a `// …`. Completed
here because the adapter layer is P2.

```ts
interface ProviderCapabilities {
  supportsTools: boolean
  supportsStructuredOutput: boolean
  supportsStreaming: boolean
  /** Whether consecutive same-role messages are acceptable. §2 */
  mergeSameRole: "required" | "preferred" | "never"
  /** Whether a leading system message is supported at all — some endpoints
   *  want it folded into the first user message. */
  systemMessage: "supported" | "fold-into-first-user"
  maxPromptChars?: number         // hard: what the endpoint accepts
  usefulPromptChars?: number      // soft: where quality degrades
  maxContextTokens?: number
  /** Whether the provider reports token usage. When false, the record's
   *  `usage` is null and the budgeter's margin is the only signal. */
  reportsUsage: boolean
}
```

Defaults ship per known provider and are overridable **per connection**, because
a limit is a property of that endpoint and connections are private production
config ([00 §3.2](00-stance.md)).

---

## 4. `config.json`

Referenced in the storage layout ([02 §5.1](02-data-model.md)), given a
permission rule ([05 §4](05-ui-surfaces.md)), promised a commented example
([02 §5.4](02-data-model.md)), and required by
[06 D0](06-open-questions.md) to annotate **every key** with a reload tier — with
no key list anywhere. It is P1 work: the bind address alone decides first-boot
behaviour.

```ts
interface Config {
  dataDir: string
  server: { host: string; port: number; trustProxy: boolean }
  log: { level: "silent" | "error" | "warn" | "info" | "debug"; format: "json" }
  index: { rebuildOnStart: boolean }
  sessions: { snapshotEveryNTurns: number }
  limits: { maxUploadMb: number; extensionStorageQuotaMb: number }
  trash: { retentionDays: number }          // [02 §10.2]
  history: { keepPerObject: number }        // [02 §11.3]
  updates: { checkEnabled: boolean; channel: "latest" | "testing" | "nightly" }
  dev: { enabled: boolean }                  // [07 §14]
}
```

| Key | Tier | Default | Note |
|---|---|---|---|
| `dataDir` | `restart` | `./data` | |
| `server.host` | `restart` | **`127.0.0.1`** | Loopback on first boot; the container image inverts it ([04 §5.1](04-server-multiuser-deployment.md)) |
| `server.port` | `restart` | `8080` | |
| `server.trustProxy` | `restart` | `false` | |
| `log.level` | `live` | `info` | `silent` exists for tests, which build a whole app each ([P2 §1.4](workplan/04-p2-implementation.md)) |
| `log.format` | `restart` | `json` | §4.1. `pretty` is not a value: it would be a second dependency no section here names |
| `index.rebuildOnStart` | `restart` | `false` | The rebuild-from-disk option ([work plan P1](workplan/01-work-plan.md)) |
| `sessions.snapshotEveryNTurns` | `live` | `10` | Generous during alpha ([06 C8](06-open-questions.md)) |
| `limits.*` | `live` | — | |
| `trash.retentionDays` | `live` | `30` | |
| `history.keepPerObject` | `live` | `50` | Pinned versions are exempt ([02 §11.3](02-data-model.md)) |
| `updates.checkEnabled` | `live` | `true` | Disableable in one obvious place ([04 §6.5](04-server-multiuser-deployment.md)) |
| `updates.channel` | `live` | `latest` | |
| `dev.enabled` | `restart` | `false` | |

**The tier annotation is the source, not documentation of it.** The
restart-required notice ([04 §6](04-server-multiuser-deployment.md)) is derived
from this table at runtime rather than hand-maintained, which is the whole point
of [06 D0](06-open-questions.md) — a hand-maintained list of "things that need a
restart" is wrong within two releases.

**No credentials here.** Connections live in `connections/`
([04 §4.5](04-server-multiuser-deployment.md)), and config has nowhere to put a
key — the same structural enforcement as the portable types
([00 §3.2](00-stance.md)).

### 4.1 The log record

`log.format` had two literals and no meaning behind either. This is the meaning,
written before the first line is emitted, because
[P2 §4](workplan/04-p2-implementation.md)'s gate step 19 asks the log to answer a
question — *a turn was killed mid-flight; reconstruct its lifecycle* — and a log
answers that only if the fields were decided in advance.

**One JSON object per line on stdout.** Not a file: the process does not own its
own destination, because every way of running it already has one — a terminal, a
service manager, a container runtime. A log file would also be the only writer
outside the storage package, against the day-one rule that keeps
path resolution behind one door ([testing §2](workplan/10-testing.md)).

Every line carries `level`, `time`, `msg`. Beyond that, the contract is
**bindings, not prose**: a value a later reader will filter on is a field, never
a phrase inside `msg`. The bindings that matter are the ones that name a subject
someone will grep for — `requestId`, `account`, `sessionId`, `jobId`, `turnId`,
`objectId`, `kind` — and the rule is that a child logger binds them once at the
point the subject comes into existence rather than each call site repeating
them. `jobId` is the one gate step 19 turns on: the turn job binds it when the
job is created ([P2 §2.10](workplan/04-p2-implementation.md)) and every line from
that job inherits it, which is what makes *filter by job id* a complete
lifecycle rather than a sample of one.

Levels mean what an operator would expect, and the boundary that matters is
`warn` versus `error`: **`error` is for what the server could not do**, `warn`
for what it refused. A rejected write, a stale hash, a refused path and an
invalid foreign file are all `warn` — they are the system working. `silent`
exists for tests and is not an operational setting.

**What never appears**: credentials of any kind (there are none here to leak,
which is the point of the paragraph above), portable object bodies (a log is not
a backup and user prose is not diagnostic), and **absolute filesystem paths** —
a path is named relative to the data root, because the log is the thing people
paste into issues.

### 4.2 What a reload does, including when it cannot

`log.level` is the first key re-read live ([P2 §2.2](workplan/04-p2-implementation.md)),
so the reload path stops being hypothetical and needs its failure states stated.
Three, and only the third is the happy one:

- **The file is unreadable, unparsable, or violates the schema.** The running
  config stands, unchanged and complete. The failure is logged at `error` naming
  the file and the reason; nothing is partially applied. A config that fails to
  parse is a typo mid-edit, and a server that reverts to defaults on a typo is a
  server that silently unbinds itself from its port.
- **The file is absent.** On *startup* that is the ordinary first-run case and
  the defaults are correct. On *reload* it is not: a delete or a rename-away is
  an editor mid-save, and treating it as "every key reverts to its default"
  would silently rewrite every setting the operator has — and then report the
  `restart`-tier ones as genuine pending changes. So a reload over an absent
  file keeps the running config and is treated as the first case.
- **The file is valid.** `live` keys apply immediately. `restart`-tier
  differences are collected by `pendingRestart` and surfaced as the
  restart-required notice ([04 §6.3](04-server-multiuser-deployment.md)) — the
  notice is the *only* thing that fires; nothing restarts itself.

**A reload is never triggered by the server's own write.** The settings UI
([05 §15](05-ui-surfaces.md)) writes this file, and the write is atomic, so the
config source must consume the same self-write suppression the object watcher
uses ([P1 §1.4](workplan/03-p1-implementation.md)) rather than reacting to its
own rename.

---

## 5. Index invariants

The index has no schema here on purpose: it is derived, disposable, and its
tables are an implementation detail. What is *not* an implementation detail is
what must be true of it.

- **Rebuild-from-disk equals incremental.** The CI assertion from
  [work plan P1](workplan/01-work-plan.md), and now sharper because there are two producers to
  agree ([02 §5.1.1](02-data-model.md)).
- **Read-after-write for the server's own writes.** A `GET` after a `POST`
  reflects it. Foreign writes have no such guarantee and need none.
- **Nothing is answerable only from the index.** The test in
  [02 §5.1](02-data-model.md): if a feature cannot be reconstructed from disk,
  it is storing data in the wrong place.
- **Turn text is indexed on write**, not lazily ([07 §7.1](07-tech-stack.md)),
  and rows off the current path stay indexed but carry their branch
  ([05 §14.2](05-ui-surfaces.md)).
- **Deleting `index.sqlite` is a non-event.** Startup notices and rebuilds.

### 5.1 Operational state is not derived, and must not live in the index

The index's defining property is that deleting it costs time and nothing else.
Anything for which that is false does not belong in it — and three things had
been put there or implied into it:

| State | Why it is not derived |
|---|---|
| **Auth sessions** | [07 §9](07-tech-stack.md) put session records "in the index database". Deleting the index would log every user out — recoverable, but it is not a non-event, and it means the index is not disposable after all. |
| **Notification inbox** | "Persist until seen" ([04 §3.2](04-server-multiuser-deployment.md)) is a durability claim. A notification lost to a rebuild was never durable. |
| **Jobs and idempotency keys** | A turn in flight, and the keys that stop a retry charging twice, are facts about work — not restatements of anything on disk. |
| **In-flight turn drafts, and sequenced progress events** | The live turn *during* execution ([P2 §2.10](workplan/04-p2-implementation.md)). The JSONL segment is append-only and terminal-only ([02 §5.5](02-data-model.md)), so the draft's only consistent home is here; event rows carry the reattach cursor and are prunable once the terminal turn exists, because the turn record is their durable meaning. |

**So: a small operational store, separate from the index**, at
`/data/state/state.sqlite`. It is authoritative, it is backed up, and it is *not*
rebuildable — which is exactly why keeping it out of the index matters. Both are
SQLite; the distinction is what happens when you delete them.

**Auth may not need it at all.** Signed stateless cookies with a short lifetime
and a server-side revocation list ([07 §9](07-tech-stack.md)) reduce this to a
small denylist rather than a session table, which is the cheaper answer for a
household. The store is still wanted for jobs and notifications.

The general rule, since the operational surface will grow: **if losing it would
surprise a user, it is not derived.** The index holds restatements of what is on
disk; anything else has its own home.

---

## 6. What is deliberately still absent

| Structure | Why not here |
|---|---|
| Preset internals beyond [10 §8](10-schemas.md) | Portable; 13 owns it |
| `InitPolicy`, `WidgetSpec` | Want the mode contract built first |
| Rule vocabulary (`Predicate`, `Effect`) | 2.0 ([work plan §0.4](workplan/01-work-plan.md)) |
| The SSE wire format | [04 §3.3](04-server-multiuser-deployment.md) has the event list; the encoding is a transport detail |
| Extension `HostApi` | [12 §4](12-extensions.md) owns it |

**The rule for adding to this document:** a type belongs here when something is
*built against it* and it never leaves the install. A type that only one module
uses belongs in that module.
