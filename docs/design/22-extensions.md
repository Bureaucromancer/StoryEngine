# 22 — Extensions: the boundary and the interface

**Status: proposal.** Resolves [25 A1](25-open-questions.md) and
[25 A1c](25-open-questions.md), and expands [06 §9](06-modes-and-turn-pipeline.md).

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

Authority isolation is deferrable because of one property, not two:
**extensions are admin-installed** ([25 A1](25-open-questions.md)). Installing
one is a deliberate act by the operator, on the same footing as anything else
they choose to run on that box. Deferring is a judgement about *that* threat
model, and tightening later is additive — it removes reachability without
changing the interface.

**The licence is not part of this argument**, though an earlier draft counted it.
Extensions being AGPL and therefore source-available ([triage §1.1](workplan/02-triage.md))
means auditable *by someone who audits*, which is not a control and stops
nothing on its own. Treating source availability as mitigation is a common and
comfortable error, and it would let the deferral look better-supported than it
is. One reason, honestly stated, is worth more than two where one is decorative.

**And "fault isolation" is the whole of what this buys.** §4.0 spells out what a
worker does not stop, because the gap between *fault-separated* and *sandboxed*
is exactly where this decision could be misread.

---

## 3. Why sandboxing is cheap here: the surface already serialises

The usual reason sandboxing hurts is that the extension surface is
"arbitrary code doing arbitrary things", and forcing it through a serialisation
boundary mangles it. **That is not the surface this design has.**

Walk [06 §9](06-modes-and-turn-pipeline.md)'s list of what an extension must be
able to do:

| Requirement | What crosses the boundary |
|---|---|
| Declare channels, schemas, widgets, reducers | **Nothing.** Declarative manifest. |
| Declare a setup wizard | **Nothing.** A schema the host renders. |
| Define input kinds, participant policy | **Nothing.** Declarative. |
| Contribute UI surfaces | **Nothing** — extensions declare widgets, not components ([10 §8](10-ui-surfaces.md)). |
| Contribute pipeline steps | A function over serialisable data. |
| Read library objects | An async host call. |
| Request a model call | An async host call by role. |

Five of seven are declarative and cross nothing at all. The remaining two are
**a pure-ish function over JSON-shaped data, and request/response calls** — which
is precisely the shape that survives a worker boundary without complaint.

This is not luck. It is the accumulated effect of decisions made for other
reasons: declarative modes ([06 §2](06-modes-and-turn-pipeline.md)), declarative
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

> **What P2 built, where it differed, and how the three differences were
> settled.** ~~The shape below is the P7 target.~~ P2's step contract lived in
> `packages/server/src/turns/steps.ts` and diverged deliberately in three places,
> each recorded rather than reconciled because reconciling them then would have
> been guessing at P7's boundary. ***All three were settled at
> [P7.0](workplan/23-p7-implementation.md), 2026-09-11, when the contract moved
> into `packages/sdk` — publishing a type is deciding it — and in two of the
> three the engine was right, so this document is what changed.***
>
> - ~~A step returns `candidates: Candidate[]` rather than `blocks:
>   AssembledBlock[]`.~~ **`Candidate` won.** A block is what the *assembler*
>   produces once the budgeter has ruled, and a step cannot produce one because
>   it does not know what fits. The sketch below is corrected.
> - ~~Effects are `EffectProposal` — no `before`, no `applied`, no id.~~
>   **`EffectProposal` won**, for the reason that was already written here: a
>   step proposes; the engine decides and stamps ([21 §1.2]). Only the engine can
>   record a refusal. The sketch below is corrected.
> - ~~`StepHost.rng` is a live `Rng` with synchronous methods, which **cannot
>   cross a worker hop**… Nothing at P2 draws inside a step.~~ **Converted at
>   P7.0.** `StepHost.random` is a `RandomApi` supplied by the host, and its
>   `at(site, purpose)` is synchronous — it *names* a draw rather than making
>   one, so across a hop it is a local constructor and only the draws are
>   messages — with the eight methods behind it asynchronous. *The last sentence
>   was retired before the conversion, not by it: since P5.6 the retriever draws
>   inside a step's `call`, engine-side of the seam and never from a mode's own
>   body. The narrowed claim is that no **mode** step draws.*
>
> **The sketch below is still a sketch of the worker boundary, not a copy of the
> shipped contract, and the remaining differences are deliberate rather than
> unnoticed** *(listed 2026-09-11, so the next reader does not have to
> rediscover them)*. `StepContext` is two parameters in the built contract —
> `StepImplementation = (input: StepInput, host: StepHost) => Promise<StepResult>`
> — because a host that is a *field on the payload* is the thing that cannot be
> serialised; `StepResult` carries one `message`, not `messages[]`; `config` has
> no shipped home yet; and `suspend` ([25 C5]) and `diagnostics` are unbuilt. The
> split into input-and-host is the shape §4's own argument wants, and is the
> reason the rest of this block reads as it does.
>
> `StepInput` and `StepResult` are both `structuredClone`-able today, asserted
> in `turns/steps.test.ts`, which is the half of [01 §2]'s day-one item that can
> be held to account before the boundary exists.

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
  candidates?: Candidate[]              // not blocks — the assembler makes those
  effects?: EffectProposal[]            // no before, no applied, no id — [21 §1.2]
  messages?: Message[]
  suspend?: InputRequest                // [25 C5]
  diagnostics?: string[]                // surfaced in the workbench
}
```

`HostApi` is the only way out, and every method is async:

```ts
interface HostApi {
  library: {
    getActor(id): Promise<Actor | null>
    findLore(query): Promise<LoreEntry[]>
    propose(change): Promise<ProposalId>   // never a direct write — [06 §7.4]
  }
  model: {
    call(role: ModelRole, req: ModelRequest): Promise<ModelResponse>
  }
  random: RandomApi                        // the one RNG source — [19 §14]
  storage: ExtensionStorage                // §5
  log(level, message, meta?): void
}
```

Three properties worth stating explicitly — **and stating precisely**, because an
earlier draft of this list claimed more than §2 delivers:

- **No connection or credential is *passed* across.** An extension asks for a
  call by *role*; the host resolves the connection and executes it
  ([19 §5.1](19-tech-stack.md)). Credentials are not in the worker's payload.
- **No direct library writes *through this API*.** `propose` returns something
  reviewable ([06 §7.4](06-modes-and-turn-pipeline.md)).
- **Randomness is *provided* by the host**, which makes
  [19 §14.4](19-tech-stack.md)'s replay-determinism check pass for free when an
  extension uses it. *Provided, not enforced* — §4.0 below is the whole of why
  that word is doing work, and [06 §9](06-modes-and-turn-pipeline.md) was
  corrected on 2026-09-11 because it had claimed the stronger thing.

### 4.0 What a worker does not stop

The earlier phrasing — "`HostApi` is the only way out", "an extension in a worker
cannot reach an unrecorded source" — was wrong, and wrong in the direction that
matters. §2 already says authority isolation is deferred; this list must not
quietly take it back.

**A Node worker thread is not a sandbox.** It can `require('node:fs')`,
`node:net` and `node:crypto`; it receives a copy of the environment; and an
out-of-memory condition can still take the whole process down. Those are
documented properties of `worker_threads`, not gaps in our usage of it.

So the honest description is **fault-separated, not sandboxed**, and the
vocabulary matters because the wrong word invites the wrong deployment
behaviour. Concretely, until real authority isolation exists
([§10](#10-still-open)):

- **Workers are for built-in modes and extensions an operator has chosen to
  trust.** They buy crash, hang and runaway-loop containment — which is the
  realistic failure ([§2](#2-two-isolations-which-get-bundled-and-should-not-be)) — and nothing more.
- **Third-party extension code is administrator-trust code**, equivalent to
  anything else the operator installs on the box, and its bundled dependencies
  are too.
- **No one-click remote install.** Installation stays a deliberate act with the
  source available to read, and the installer says plainly what trust is being
  extended rather than implying a boundary that is not there.
- **`HostApi` is the *supported* surface, not the only reachable one.** An
  extension that goes around it is misbehaving rather than prevented — the same
  status as a built-in module that ignores its own contract.

**And AGPL is not a supply-chain control.** [§2](#2-two-isolations-which-get-bundled-and-should-not-be)
leans on extensions being source-available and admin-installed as part of why
deferring authority isolation is defensible. Source-available means auditable by
someone who audits; it stops nothing on its own, and it should not be counted as
mitigation. The defensible half of that argument is *admin-installed*; the
licence half should be dropped from the reasoning.

Real isolation, when it comes, is a **separate process with a stripped
environment and OS-level filesystem and network restriction** — not a stricter
worker. That is [§10](#10-still-open)'s open item, and it is now the item that
carries the word "sandbox".

### 4.1 Built-ins go through the same boundary

[19 §10](19-tech-stack.md) says built-in modes must consume the published SDK
exactly as a third party would, enforced by package boundaries. **Run them in
workers too**, by default.

The temptation is to give first-party code an in-process fast path. Resist it
initially: the moment built-ins run differently, they start relying on shared
references and the contract drifts without anyone noticing. Measure first; add a
first-party fast path only if measurement demands it, and if it is added, keep
CI running built-ins through the worker path so drift still surfaces.

---

## 5. Extension storage — resolving A1c

Noodle surfaced the gap ([24 §4.6](24-roadmap.md)): an extension can own session
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
  ([03 §5.1](03-data-model.md)). The extension never learns the path.
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
  "license": "AGPL-3.0",            // [triage §1.1] — required and displayed
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
- **Update** requires a restart at 1.0 ([09 §6.4](09-server-multiuser-deployment.md)),
  because worker reload with live channel definitions is not worth solving yet.
- **A worker that throws** fails its step. `StepDefinition.failure` already says
  what that means — `abort`, `warn` or `ignore` — and `warn` with a retry
  affordance stays the default ([06 §6](06-modes-and-turn-pipeline.md)).
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
  ([24 §4.4](24-roadmap.md)) exist partly to surface gaps before third parties
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
  hatch ([10 §8](10-ui-surfaces.md)) earlier than planned. Tactical combat and
  anything map-shaped are the likely triggers.
