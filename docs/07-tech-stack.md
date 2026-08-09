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

The last part is the important one and it is a **discipline mechanism, not
organisation**. [03 §2](03-modes-and-turn-pipeline.md) claims the built-in modes
must be implemented only through the public mode contract, or "modes as
extensions" is aspirational. Putting them in separate packages that depend on
`sdk` and *not* on `server` turns that claim into a build error. It is the
cheapest possible enforcement of the design's central bet.

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

## 12. Summary

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
| Repo | pnpm workspaces, modes as SDK consumers | single package |
