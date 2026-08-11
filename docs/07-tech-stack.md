# 07 — Tech stack

**Status: proposal with recommendations.** Nothing here has been specified by
the requirements, so this document takes positions and shows the reasoning. The
recommendations are ordered by how much they constrain everything else.

The constraints these choices have to satisfy, from the preceding documents:

1. Long-running server process; LAN; multi-user; auth ([04](04-server-multiuser-deployment.md))
2. Files on disk canonical, SQLite as a derived index rebuilt from a watcher ([02 §5](02-data-model.md))
3. Server-authoritative generation with an event stream ([04 §2](04-server-multiuser-deployment.md))
4. Background schedulers (autonomous messages) independent of any connected client ([03 §7.1](03-modes-and-turn-pipeline.md))
5. Third-party extensions and modes against a published, typed contract ([03 §9](03-modes-and-turn-pipeline.md))
6. Schemas used at runtime in four places: channel state, extension manifests, LLM structured output, declarative setup forms
7. Web-only client, dense data UI (library, workbench) plus streaming text ([05](05-ui-surfaces.md))

---

## 1. Language: TypeScript, end to end

**Recommendation: TypeScript everywhere — server, client, shared, and the
extension SDK. One repo, one language.**

This is the least negotiable choice in the document, and the deciding argument is
constraint 5. Extension and mode authors in this space write JavaScript. That is
what the SillyTavern and Marinara ecosystems have trained; it is the pool of
people who might write a mode. Choosing a server language that isn't JS/TS means
either extensions are written in that language (and nobody writes them) or you
embed a JS runtime anyway (and you have two languages plus a bridge).

Given a JS runtime in-process regardless, the second argument follows: a single
`shared` package holding types and schemas used by server, client and extensions
is worth a great deal on a design this schema-heavy. Every cross-boundary
contract in these documents — the turn record, channel definitions, mode
manifests, the package format — benefits from being one definition rather than
three.

**Why not Python.** The LLM-ecosystem advantage is real and shrinking; the
provider layer (§4) covers what we need. The cost is losing shared types across
client/server/extension, which is this design's highest-value property.

**Why not Go.** A single static binary is genuinely attractive for LAN
self-hosting, and Go would be a better fit for the file-watching and
process-supervision parts. But extensions would need either Go plugins (poor
story, no ecosystem here) or an embedded JS runtime — at which point the
simplicity that motivated Go is gone.

---

## 2. Runtime: Node LTS

**Recommendation: current Node LTS. Keep code runtime-agnostic where free, but
target Node.**

- Native module ecosystem matters here: image processing for thumbnails and card
  chunk manipulation, and SQLite. Node has the mature story.
- Docker images, process supervision and long-run stability are well understood.
- Largest contributor pool.

**Bun** is faster and its all-in-one tooling is pleasant, but for a long-running
server that people self-host and leave running for months, native-module
compatibility and operational maturity matter more than startup time. **Deno**
has the nicest permission model — genuinely relevant to the extension sandboxing
question — but the ecosystem cost is real. Neither is ruled out forever; neither
should be the 1.0 bet.

---

## 3. HTTP server: Fastify

**Recommendation: Fastify.**

The deciding argument is constraint 6. This design needs runtime JSON Schema in
four places already; Fastify makes route validation and response serialisation a
fifth use of the *same* mechanism rather than a parallel one. One schema
technology, five jobs.

Beyond that: first-class TypeScript, a plugin/encapsulation model that maps well
onto extension-contributed routes, and good performance without effort.

**Express** (SillyTavern's choice) is ubiquitous and I would not argue hard
against it, but its typing is weak and it brings no schema story.
**Hono** is excellent and lighter; it wins if portability across runtimes ever
becomes a goal, which §2 says it isn't.

---

## 4. Schema: JSON Schema as source of truth, authored with TypeBox

**Recommendation: TypeBox. JSON Schema is the artefact; TypeScript types are
derived from it.**

The direction of derivation is the actual decision, and it turns on constraint 5:
**a package or extension manifest schema has to be publishable and consumable by
people who are not compiling against our TypeScript.** A third-party tool that
validates a `.sepack` should be able to fetch a schema file. That points to JSON
Schema as the artefact and TS types as the derivative — which is TypeBox's model
(`Static<typeof T>`), not Zod's.

The same schemas then serve: Fastify route validation, channel state validation,
LLM structured-output requests (providers take JSON Schema directly), and
rendering declarative setup forms ([05 §6](05-ui-surfaces.md)) — that last one
*requires* runtime-inspectable schema and is impossible against opaque validators.

**Zod v4** is the alternative and has meaningfully better authoring ergonomics;
`z.toJSONSchema()` closes most of the gap. If the team's preference is strongly
for Zod's DX, that is a defensible reversal — the cost is that JSON Schema
becomes generated output, which is fine until a construct doesn't round-trip.

---

## 5. LLM provider layer: Vercel AI SDK, behind our own interface

**Recommendation: AI SDK as the adapter, wrapped in a thin internal interface.**

Aventuras already demonstrates this across ~8 providers (`@ai-sdk/anthropic`,
`openai`, `google`, `mistral`, `groq`, `xai`, `deepseek`, `openai-compatible`,
plus OpenRouter). It provides streaming, tool calling and structured output as
first-class primitives — which is exactly the model contract
[00 §2.2](00-stance.md) argues should be the baseline. Marinara and SillyTavern
both hand-roll per-provider adapters and both carry the maintenance.

The thin wrapper is not ceremony. It is where the raw-completion adapter attaches
([00 §2.2](00-stance.md)), where `ModelHint` resolution happens
([02 §2.6](02-data-model.md)), where per-call cost accounting is captured for the
turn record, and where capability negotiation lives ("this model has no tool
calling — degrade to prompted JSON with validation").

**[OPEN]** Local backends. AI SDK's OpenAI-compatible provider covers
llama.cpp/Ollama/vLLM's compatible endpoints, which is most of it. KoboldCpp and
raw text-completion backends need the adapter, and how far that goes is
[06 A4](06-open-questions.md).

---

## 6. Client: React + Vite, with the framework decision deliberately reversible

**Recommendation: React + TypeScript + Vite. TanStack Query / Router / Virtual /
Table. Tailwind + a headless primitive library (Radix or equivalent).**

Reasoning, in order:

- **The hard UI here is dense data, not chat.** Play is streaming text and is
  easy in anything. Library and Workbench are filtered tables, tree views, diffs,
  virtualised lists of hundreds of context blocks, and schema-driven forms. The
  TanStack family plus headless primitives is the strongest available toolkit for
  exactly that, and it is the largest single practical difference between the
  candidates.
- **Server-authoritative state maps cleanly onto TanStack Query** — nearly all
  client state is server state, with the SSE stream patching the cache. Very
  little genuine client state remains.
- Contributor pool, again.

**Svelte 5** is a genuine alternative and Aventuras is a working existence proof
in this exact domain; runes are excellent, and the resulting client would be
smaller and probably nicer to read. The honest summary is that this is a
preference-weighted call rather than a forced one, and the tooling argument above
is the strongest thing on React's side.

**What makes it reversible.** Because extensions declare widgets rather than
shipping components ([05 §7](05-ui-surfaces.md)), the framework is not part of
any public contract. Nothing outside the client package knows what it is. That
resolves the open question from the earlier draft: the framework choice is
ordinary, not architectural, *provided* the extension-UI decision holds.

---

## 7. Storage layer

- **SQLite** for the derived index, with **FTS5** for search across cards,
  entries and turn text.
- **`node:sqlite`** (built into Node) is worth preferring over `better-sqlite3`
  if it holds up: it removes the only unavoidable native dependency and
  materially simplifies Docker builds. The derived-index design de-risks this —
  a bug in the driver costs a rebuild, not data. Fall back to `better-sqlite3`,
  which is mature and has the same synchronous ergonomics, if anything bites.
- **`chokidar`** for the filesystem watcher feeding the index, which is also what
  makes [05 §4](05-ui-surfaces.md)'s file access safe.
- **`write-file-atomic`** for every canonical write (temp + rename). SillyTavern
  already uses it; the failure it prevents is a truncated character card.
- **`png-chunks-extract` + `png-chunk-text`** — the pair SillyTavern's card
  parser is built on. Proven, small, and the technique matters more than the
  library: splice chunks, never re-encode pixels ([02 §5.2](02-data-model.md)).
- **`sharp`** for thumbnails. Native, but well-supported in Docker and far better
  than the pure-JS alternatives for a server generating them on ingest.
  (SillyTavern uses `jimp`, presumably to stay native-dependency-free; a server
  can afford `sharp`.)

---

## 8. Realtime: SSE

**Recommendation: Server-Sent Events for the session event stream; ordinary POST
for intents.**

The traffic is overwhelmingly one-directional — token deltas, step transitions,
effect application, presence. Intents are infrequent and fit request/response.
SSE gives automatic reconnection with `Last-Event-ID` resumption, passes through
reverse proxies without special configuration, and needs no connection lifecycle
management.

WebSockets buy bidirectionality we don't need yet. Revisit if real multiplayer
([04 §5](04-server-multiuser-deployment.md)) arrives — that is when
simultaneous input and turn arbitration would make it worth the complexity.

---

## 9. Auth: no framework

Given the threat model in [04 §3.1](04-server-multiuser-deployment.md):

- **`scrypt` from `node:crypto`.** No native dependency, in the standard library,
  and what SillyTavern uses. argon2id is marginally better and costs a native
  module; not worth it here.
- **httpOnly, SameSite=Lax signed session cookie**, with session records in the
  index database.
- **CSRF token on state-changing routes.**
- **One audited path-resolution helper** used by every filesystem-touching route
  — the single most important piece of security code in the project, per
  [05 §4.4](05-ui-surfaces.md).

An identity-provider interface should exist from the start even with one
implementation, so Tailscale identity ([04 §4.2](04-server-multiuser-deployment.md))
plugs in as a provider rather than a special case.

---

## 10. Repository shape

pnpm workspaces (Marinara's arrangement, which works):

```
packages/
  shared/      types + schemas. No runtime deps.
  sdk/         the published extension/mode contract. Depends on shared.
  server/
  client/
  modes/messages/  ⎫ built-in modes, each its own package,
  modes/scene/     ⎬ consuming sdk exactly as a third party would
  modes/adventure/ ⎭
```

**`sdk` is AGPL-3.0, like everything else, and that is deliberate rather than
incidental.** Extensions import it, which is what makes them combined works and
what makes [08 §1.1](08-triage.md)'s decision hold. Publishing it under a
permissive licence "to be friendly to extension authors" would quietly reverse
that decision, so it is worth a comment in the package manifest saying why.

The modes arrangement is the other important part, and it is a **discipline
mechanism, not organisation**. [03 §2](03-modes-and-turn-pipeline.md) claims the built-in modes
must be implemented only through the public mode contract, or "modes as
extensions" is aspirational. Putting them in separate packages that depend on
`sdk` and *not* on `server` turns that claim into a build error. It is the
cheapest possible enforcement of the design's central bet.

---

## 10b. Dev mode

**A priority, not a nicety.** Marinara's live-refresh-on-change is the bar. The
loop this shortens is the one that dominates work on this kind of app — change a
prompt, run a turn, read the output, change it again — and every second of
restart in that loop is paid hundreds of times a day.

What reloads, in descending order of how easily:

| Changes to | Behaviour | Notes |
|---|---|---|
| Client code | Vite HMR | Free. |
| **Content and templates** | **Live, in production too** | Falls out of the watcher-fed index ([04 §4b.2](04-server-multiuser-deployment.md)). Not a dev-mode feature. |
| Config marked `live` | Re-read on change | Per [04 §4b.1](04-server-multiuser-deployment.md). |
| Server code | Watch-restart (`tsx watch` or equivalent) | Fast, but drops SSE connections and in-flight turns. |
| Extension code | Process restart | True ESM unloading is not worth attempting; see [04 §4b.4](04-server-multiuser-deployment.md). |
| Config marked `restart` | Process restart | Notified, not silently ignored. |

Two dev-mode specifics worth building deliberately:

- **The client must survive a server restart gracefully.** In dev this happens
  constantly, so the SSE reconnect path is exercised more in an hour of
  development than in a month of use. That is a gift: the reconnect logic gets
  hardened for free, provided the client shows a quiet reconnecting state and
  resumes rather than erroring out and demanding a refresh.
- **Preserve the session across a restart.** Losing your place on every server
  reload makes the loop useless. Since sessions are files on disk and the client
  is a view ([04 §2](04-server-multiuser-deployment.md)), this mostly works
  already — but it needs to be verified deliberately rather than assumed.

**[OPEN]** Whether prompt-template changes should trigger anything beyond taking
effect next turn — a "re-run the last turn with the new template" action would
close the iteration loop entirely, and it is nearly free given the turn record
already holds everything needed to re-assemble ([02 §8](02-data-model.md)).

---

## 11. Testing

- **Vitest** (both Marinara and Aventuras use it), **Playwright** for end-to-end.
- **The highest-value tests are golden-file tests of the assembler and budgeter.**
  Given a fixture library and a fixture session, assemble a turn and snapshot the
  turn record. Because the record already captures every block, its source, its
  reason, its cost and the budget verdict ([02 §8](02-data-model.md)), the thing
  hardest to test in every one of the three sources becomes the easiest thing to
  test here. A regression in lore activation shows up as a diff.
- Marinara's `scripts/regressions/*` pattern — targeted scenario scripts run in
  CI, including a `context-fit` regression pinning budget behaviour — is worth
  copying as a category.

---

## 12. Randomness: one canonical source

**Decision: the server provides a single RNG service. Nothing else draws random
numbers — not steps, not modes, not the rules evaluator, not extensions. It is
server-local and has no network dependency of any kind.**

Implementation is deliberately unremarkable; the constraints are the point.

### 12.1 Why singular is a correctness property

Not tidiness. Three things depend on it:

- **Replay and branching.** Every draw is recorded in the turn's effects
  ([02 §8](02-data-model.md)), because state at turn N must remain a pure
  function of the effect log ([10 §2](10-branching.md)). A caller that draws
  its own number without recording it breaks that invariant silently, and the
  symptom appears much later as a branch that reconstructs wrong.
- **Auditability.** In a mode with dice, "was that roll fair?" is a question
  players genuinely ask. One source, every draw logged, visible in the turn
  record, is a complete answer.
- **Testability.** One seam to inject a deterministic generator through.

### 12.2 The API has to be complete, or it will be bypassed

If the service does not offer what a caller needs, they will reach for
`Math.random()` and the invariant is gone. Completeness is therefore a
correctness requirement, not a convenience. It should cover at least:

`int(min, max)` · `float()` · `bool()` · `chance(p)` · `pick(items)` ·
`weightedPick(items)` · `shuffle(items)` · `dice(notation)`

`dice` and `chance` are not speculative: the authored-rules vocabulary already
needs `<<1d20>>` and `triggerOnRandomChance`
([09 §3](09-infinite-worlds.md)), and both first-party reference extensions
need dice ([11 §3.4](11-roadmap.md)). `weightedPick` covers loot-table shapes,
which is where people would otherwise improvise.

### 12.3 Implementation

**`node:crypto`.** `randomInt` and `randomBytes` — standard library, no
dependency, no network, and `randomInt` is uniform rather than modulo-biased.
The naive `Math.floor(Math.random() * n)` is subtly non-uniform, which is
exactly the sort of thing that goes unnoticed in a dice system for years.

The service takes its underlying generator by injection, so tests supply a
deterministic PRNG and fixtures roll predictably. No third-party dependency is
needed for any of this.

**Explicitly not:** any remote entropy service, any provider-side randomness,
anything requiring connectivity. A LAN server with no internet must roll dice
normally.

### 12.4 Enforcement

- A lint rule banning `Math.random` and direct `node:crypto` random calls
  outside the service. Cheap, and catches the common case in our own code.
- For in-process extensions the lint rule does not apply, so the honest position
  is that this is discipline rather than enforcement — **except** that it is
  self-policing under test: an extension using unrecorded randomness will fail a
  replay-determinism check, because replaying its recorded effects will not
  reproduce its behaviour. That check belongs in the extension test kit, and it
  is a better guarantee than a rule nobody can enforce.

### 12.5 Rewrite and reroll — DECIDED

Because every draw is recorded, a turn carries a **tape** of the values it
consumed, and the service can run in replay mode against it. That makes two
operations expressible where the sources have one, and both ship:

| | What it does | Default |
|---|---|---|
| **Rewrite** | Replay the tape. Same mechanical outcome, different prose. | **Yes** — the ordinary swipe |
| **Reroll** | Fresh draws. New outcome. | Explicit second action |

**Rewrite is the default.** "I didn't like how that was written" is by far the
more common intent, and making the other one deliberate is what stops swiping
from being save-scumming by accident: fail a check, swipe, succeed. Both
operations are legitimate — the point is that the user should be choosing, not
discovering.

### 12.6 What the tape covers, and how it is keyed

**Everything drawn during the turn**, not only the obvious dice: engine-computed
channel effects, rules evaluation (`triggerOnRandomChance`), stochastic lorebook
entry activation (Marinara's per-entry `probability`,
[02 §3.1](02-data-model.md)), and extension draws. A rewrite therefore
reproduces the same assembled context as well as the same outcome, which gives
the honest and predictable definition: *same setup, same result, different
words*.

**Not covered: the model's own sampling.** That belongs to the provider, and it
is precisely the source of the new prose. A consequence worth stating plainly —
at temperature 0 a rewrite returns approximately the same text. That is correct
behaviour, not a bug.

**Key draws by site, never by position.** A positional tape — "the fifth draw" —
desynchronises the moment a rewrite takes a slightly different execution path,
and then a value drawn for a lore probability gets handed to a skill check. Each
draw should carry a stable key (step or rule id, plus a purpose and an index
within that site), and replay should look up by key, drawing fresh on a miss.

This costs nothing and buys two things beyond robustness: partial replay is
well-defined when a path genuinely differs, and the turn record becomes legible
in the workbench — `skill-check:persuasion d20 → 7` rather than an anonymous
list of numbers. The record should also mark which draws were replayed and which
were fresh, so a rewrite that partially diverged says so.

**Surface it only when it exists.** In a mode that consumed no draws, rewrite
and reroll are the same operation, and the second affordance should not appear.
No dice, no distinction, no clutter.

**[OPEN]** Whether a session can flip the default — some users will want reroll
and will find the extra click tiresome. A per-session setting is cheap; the
default stays rewrite.

---

## 13. Summary

| Layer | Recommendation | Main alternative |
|---|---|---|
| Language | TypeScript throughout | Python / Go — both rejected on the extension story |
| Runtime | Node LTS | Bun, Deno |
| HTTP | Fastify | Express, Hono |
| Schema | TypeBox, JSON Schema as artefact | Zod v4 (better DX, generated schema) |
| LLM | Vercel AI SDK behind a thin interface | Hand-rolled adapters |
| Client | React + Vite + TanStack + Tailwind | Svelte 5 — a genuine call, not a clear loss |
| Index | SQLite via `node:sqlite`, FTS5 | `better-sqlite3` |
| Realtime | SSE | WebSockets |
| Auth | `node:crypto` scrypt, signed cookies | any auth framework |
| Randomness | one core service over `node:crypto`, every draw recorded | callers rolling their own |
| Repo | pnpm workspaces, modes as SDK consumers | single package |
