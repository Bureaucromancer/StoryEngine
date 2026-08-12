# 17 — Extensions: the boundary and the interface

**Status: proposal.** Resolves [06 A1](06-open-questions.md) and
[06 A1c](06-open-questions.md), and expands [03 §9](03-modes-and-turn-pipeline.md).

---

## 1. The decision

**Extensions run behind a message-passing boundary, in worker threads, from
1.0.** Built-in modes go through the same interface.

The instinct to sandbox is right, and the fear of regretting it is less
well-founded than it feels — because of §3, which is the actual argument.

---

## 2. Two isolations, which get bundled and should not be

"Sandbox" conflates two things with very different costs. Separating them is
what makes this decidable.

| | What it stops | Cost |
|---|---|---|
| **Fault isolation** | A crash, a hang, an infinite loop, a memory leak, a catastrophic regex — taking down the server or blocking everyone's turns | Low. Worker threads, an async API, serialisable payloads. |
| **Authority isolation** | An extension reading `connections/`, another user's sessions, or the host filesystem at all | High. Needs a genuinely restricted runtime, a stripped module graph, or a separate process with no filesystem. |

**Take fault isolation now. Defer authority isolation, deliberately.**

Fault isolation buys most of the practical safety on a LAN server: the realistic
failure is a well-meaning extension with a bug, not an attacker. It is also the
part that shapes the API — async, serialisable, declared reads — and that shape
is what cannot be retrofitted.

Authority isolation is deferrable because the threat model is weaker than it
looks: extensions are **AGPL, so source-available** ([08 §1.1](08-triage.md)),
and **admin-installed** ([06 A1](06-open-questions.md)). That is not "arbitrary
code from the internet"; it is code an operator chose, whose source they can
read. Deferring it is a judgement about *this* threat model, not an oversight —
and tightening later is additive, because it removes reachability without
changing the interface.

---

## 3. Why sandboxing is cheap here: the surface already serialises

The usual reason sandboxing hurts is that the extension surface is
"arbitrary code doing arbitrary things", and forcing it through a serialisation
boundary mangles it. **That is not the surface this design has.**

Walk [03 §9](03-modes-and-turn-pipeline.md)'s list of what an extension must be
able to do:

| Requirement | What crosses the boundary |
|---|---|
| Declare channels, schemas, widgets, reducers | **Nothing.** Declarative manifest. |
| Declare a setup wizard | **Nothing.** A schema the host renders. |
| Define input kinds, participant policy | **Nothing.** Declarative. |
| Contribute UI surfaces | **Nothing** — extensions declare widgets, not components ([05 §8](05-ui-surfaces.md)). |
| Contribute pipeline steps | A function over serialisable data. |
| Read library objects | An async host call. |
| Request a model call | An async host call by role. |

Five of seven are declarative and cross nothing at all. The remaining two are
**a pure-ish function over JSON-shaped data, and request/response calls** — which
is precisely the shape that survives a worker boundary without complaint.

This is not luck. It is the accumulated effect of decisions made for other
reasons: declarative modes ([03 §2](03-modes-and-turn-pipeline.md)), declarative
widgets, channels as typed state rather than objects with methods, and a turn
record that is already serialisable because it is written to disk.

**The design pre-paid for the sandbox.** That is the answer to "will I regret
it".

### 3.1 `reads` is already the payload filter

`StepDefinition` already declares `reads: (ChannelId | "history" | "output")[]`.
That field was added so the pipeline could reason about dependencies. It does
double duty here:

- **The host sends only what the step declared it reads.** Serialisation cost
  scales with what a step actually needs, not with the size of the session.
- **It is a capability boundary in itself.** A step that did not declare
  `history` does not receive it.

Another mechanism that already existed.

---

## 4. What the boundary looks like

```ts
// In the worker. The whole surface an extension implements.
type StepFn = (ctx: StepContext) => Promise<StepResult>

interface StepContext {
  turn: { id, index, input }            // no parent chain, no session log
  channels: Record<ChannelId, unknown>  // only those declared in `reads`
  history?: Message[]                   // only if declared
  output?: string                       // only at `extract` / `post`
  config: unknown                       // the extension's own settings
  host: HostApi                         // async, narrow, typed
}

interface StepResult {
  blocks?: AssembledBlock[]
  effects?: ChannelEffect[]
  messages?: Message[]
  suspend?: InputRequest                // [06 C5]
  diagnostics?: string[]                // surfaced in the workbench
}
```

`HostApi` is the only way out, and every method is async:

```ts
interface HostApi {
  library: {
    getActor(id): Promise<Actor | null>
    findLore(query): Promise<LoreEntry[]>
    propose(change): Promise<ProposalId>   // never a direct write — [03 §7.4]
  }
  model: {
    call(role: ModelRole, req: ModelRequest): Promise<ModelResponse>
  }
  random: RandomApi                        // the one RNG source — [07 §14]
  storage: ExtensionStorage                // §5
  log(level, message, meta?): void
}
```

Three properties worth stating explicitly:

- **No connection or credential ever crosses.** An extension asks for a call by
  *role*; the host resolves the connection and executes it
  ([07 §5.1](07-tech-stack.md)). This was already the rule and the boundary now
  enforces it structurally rather than by convention.
- **No direct library writes.** `propose` returns something reviewable
  ([03 §7.4](03-modes-and-turn-pipeline.md)).
- **Randomness comes from the host.** Which finally makes
  [07 §14.4](07-tech-stack.md)'s "self-policing under test" into "impossible to
  get wrong" — an extension in a worker cannot reach an unrecorded source.

### 4.1 Built-ins go through the same boundary

[07 §10](07-tech-stack.md) says built-in modes must consume the published SDK
exactly as a third party would, enforced by package boundaries. **Run them in
workers too**, by default.

The temptation is to give first-party code an in-process fast path. Resist it
initially: the moment built-ins run differently, they start relying on shared
references and the contract drifts without anyone noticing. Measure first; add a
first-party fast path only if measurement demands it, and if it is added, keep
CI running built-ins through the worker path so drift still surfaces.

---

## 5. Extension storage — resolving A1c

Noodle surfaced the gap ([11 §4.6](11-roadmap.md)): an extension can own session
state via channels and can read the library, but has nowhere to keep durable
data of its own.

**The boundary makes the answer cleaner than a directory would have been.**
Storage is a host API, not a filesystem path:

```ts
interface ExtensionStorage {
  get(key: string): Promise<unknown>
  set(key: string, value: unknown): Promise<void>
  list(prefix?: string): Promise<string[]>
  delete(key: string): Promise<void>
}
```

- **Namespaced per (user, extension).** No cross-user reach, no cross-extension
  reach, both by construction rather than by check.
- **Backed by files on disk** under the user's directory, so it participates in
  the same watcher, index and backup story as everything else
  ([02 §5.1](02-data-model.md)). The extension never learns the path.
- **Quota'd**, with the limit declared in the manifest and enforced by the host.
- **Removed on uninstall**, with an explicit "keep the data?" prompt, because
  uninstalling a social-feed extension and silently deleting a year of posts
  would be indefensible.

**Values are JSON.** An extension wanting to store an image stores an asset
through a separate call that returns a handle — bulk bytes should not travel
through a key-value API.

---

## 6. Manifest

Declarative, validated at install, and the thing the installer shows a human
before enabling anything.

```jsonc
{
  "id": "com.example.weather",
  "name": "Weather Engine",
  "version": "1.2.0",
  "license": "AGPL-3.0",            // [08 §1.1] — required and displayed
  "sdk": "^1.0.0",                  // API version range — §8
  "modes": [ /* … */ ],
  "channels": [ /* … */ ],
  "steps": [ /* … */ ],
  "widgets": [ /* … */ ],
  "capabilities": ["model:fast", "storage"],   // requested, granted at install
  "storageQuotaMb": 5
}
```

**`capabilities` is a declared request, shown at install.** Not a security
boundary on its own — the host still enforces — but it makes "this extension
wants to make model calls and keep 5 MB of data" a sentence a person reads
before clicking enable.

---

## 7. Lifecycle and failure

- **Install** is admin-only. Enable is per-user.
- **Update** requires a restart at 1.0 ([04 §6.4](04-server-multiuser-deployment.md)),
  because worker reload with live channel definitions is not worth solving yet.
- **A worker that throws** fails its step. `StepDefinition.failure` already says
  what that means — `abort`, `warn` or `ignore` — and `warn` with a retry
  affordance stays the default ([03 §6](03-modes-and-turn-pipeline.md)).
- **A worker that hangs** is killed on a per-step deadline. This is the case
  in-process cannot handle at all, and the single most valuable thing fault
  isolation buys.
- **A worker that crashes repeatedly** gets disabled with a visible reason
  rather than crash-looping.
- **Every failure lands in the turn record** and therefore in the workbench,
  with the extension named. Debugging someone else's extension should not
  require reading server logs.

---

## 8. Versioning, and the pressure that will actually hurt

§3 argues the structural regret is small. The *velocity* regret is real and
worth naming: **with a boundary, anything the API does not expose is impossible
until the API grows.** In-process, an extension just does the thing.

Three mitigations, all cheap:

- **Version the SDK API and widen additively.** Extensions declare a range;
  widening never breaks anyone.
- **Ship the reference extensions against the same API.** Dice and poker
  ([11 §4.4](11-roadmap.md)) exist partly to surface gaps before third parties
  hit them. Poker in particular reaches for per-actor hidden state and
  multi-participant sequencing, which is where an API is most likely to be found
  wanting.
- **Publish a capability-request path.** A documented way to say "I need X" that
  is not "fork the engine". Pretending the API is complete is how sandboxes
  acquire their reputation.

---

## 9. How we would know this was wrong

Worth writing down while the decision is fresh, because the failure is gradual:

- **Extension authors routinely blocked** on capabilities, with the request
  queue growing faster than it drains.
- **The API accreting escape hatches** — a generic `invoke(anything)` appearing
  is the sign the boundary was drawn in the wrong place.
- **Serialisation showing up in profiles** as a real cost rather than noise.
- **First-party code quietly acquiring an in-process path** for reasons that
  turn out to be convenience.

If those appear, relaxing to in-process is a small change — the API stays, the
boundary goes. That asymmetry is the whole reason to start here: **sandboxed →
in-process is a relaxation nobody notices; in-process → sandboxed breaks every
extension ever written.**

---

## 10. Still open

- **[OPEN]** Whether extensions may bring npm dependencies, or must ship
  bundled. Bundled is simpler to sandbox and to audit; dependencies are what
  authors expect. Lean: bundled at 1.0.
- **[OPEN]** Authority isolation, when it arrives — a restricted module graph,
  a permissions-based runtime, or a child process with no filesystem. §2 defers
  it; it should be revisited if extensions ever become installable by
  non-admins.
- **[OPEN]** Whether widget vocabulary gaps force the sandboxed-iframe escape
  hatch ([05 §8](05-ui-surfaces.md)) earlier than planned. Tactical combat and
  anything map-shaped are the likely triggers.
