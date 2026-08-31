# 07 — Tech stack

**Status: recommendations, with the load-bearing ones now confirmed.** Runtime,
schema direction and client framework are settled
([06 A6–A8](06-open-questions.md)). Nothing here was specified by the
requirements, so this document takes positions and shows the reasoning. The
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

**CONFIRMED ([06 A8](06-open-questions.md)): current Node LTS. Keep code runtime-agnostic where free, but
target Node.**

**The pin, taken at P1.0, is Node 26** — which is Current at the time of writing
and becomes LTS in October 2026. This is not an exception to the rule above so
much as the rule applied forward: the first commit lands in August, 26 is blessed
about two months later, and P1 is not finished by then. Pinning 24 would be work
with a known expiry date.

The alternative also costs something specific rather than only time. 26 is where
`node:sqlite`'s FTS5 support was verified ([P1 §1.4](workplan/03-p1-implementation.md)),
and that verification is what retires the `better-sqlite3` fallback in §7.
Targeting 24 means re-opening the one live risk in this document in exchange for
a few months of orthodoxy.

**The next bump is an ordinary one.** This is a timing call, not a carve-out —
nothing here licenses running ahead of LTS as a habit.

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

**CONFIRMED ([06 A7](06-open-questions.md)): TypeBox. JSON Schema is the artefact; TypeScript types are
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

The thin wrapper is not ceremony. It is where `ModelHint` resolution happens
([02 §2.6](02-data-model.md)), where role bindings resolve to connections
(§5.1), where per-call cost accounting is captured for the turn record, and
where capability negotiation lives ("this model has no tool calling — degrade to
prompted JSON with validation"). It is *not* where a raw-completion adapter
attaches, because there is not one (§5.5).

### 5.1 Model roles, and a hi/lo default

**Steps never name a model. They name a role, and the install binds roles to
connections.**

```
prose · fast · reasoning · vision · image · video · speech · embedding
```

Narration asks for `prose`; a classification or summarisation step asks for
`fast`; a rendition step asks for `image` ([03 §10](03-modes-and-turn-pipeline.md)).
Nothing in a mode, step or extension refers to a provider or a model id — which
is what makes an install portable, an extension safe to share, and per-actor
`ModelHint` ([10 §3](10-schemas.md)) resolvable as a *request* rather than a
binding.

**Default the eight roles onto two bindings.** A system-wide default plus
per-agent overrides is not enough on its own, and eight separate pickers is too
much setup for anyone. So the first-run question is two models — **a good one
and a cheap one** — and every role defaults onto one of them:

| Binds to *hi* | Binds to *lo* |
|---|---|
| `prose`, `reasoning` | `fast`, `vision`, `embedding` |

`image`, `video` and `speech` are unset until a matching connection exists,
because there is no sensible text-model fallback for them.

A binding may point at a **personal or a system connection**
([04 §4.5](04-server-multiuser-deployment.md)), which is what makes the
household case work: an admin binds the two defaults to system connections, and
anyone who wants their own key overrides a role without the admin's involvement.

Overrides layer on top in a fixed order: **install default → role binding →
session override → step override → actor hint.** Most people set two models and
never see the rest; someone who wants a different narrator for one session, or a
cheap model for one noisy step, has a place to say so.

*Which layers have callers, so the order above is not read as a description of
what runs. `resolveRole` implements four of the five.*

| Layer | State |
|---|---|
| **install default** | **Built at [P2B §2.1](workplan/14-p2b-provider-configuration.md).** `system/bindings.json`, written by the admin surface, read by `readSystemBindings`, resolved as `via: 'default'` |
| **role binding** | Built. Read from `users/<handle>/bindings.json`; **hand-written only** — the writer for the per-user file is still deferred with the rest of [05 §15.1](05-ui-surfaces.md)'s user half ([P2B §2.7](workplan/14-p2b-provider-configuration.md)) |
| **session override** | Plumbed into `resolveRole` and never passed. P7's, with the mode contract that would use it |
| **step override** | Same |
| **actor hint** | Built. Applied last and weakest: it may choose among the models the resolved connection already offers and may never change the connection, which is what stops an imported actor card repointing somebody's provider |

*One correction the implementation forced, because the order alone did not say
it: **the first layer that resolves wins, not the first that exists.** A
personal binding whose connection is gone drops through to the install default
rather than failing the turn, and `dangling` is the answer only when every layer
that bound something failed. Written the other way, [04 §4.5]'s promise that a
removed system connection *"falls back to system bindings"* described something
the code could not do.*

~~**[OPEN]**~~ **Closed at P2.1, as the convenience reading.** The data model is
eight independent bindings; `hi` and `lo` are what the first-run flow asks for
and then spreads across them. A tier would be a third thing to keep consistent —
a binding, a tier, and the mapping between them — and the moment somebody
overrides one role it is either a lie or recomputed from the bindings, at which
point it was a view of them all along. The tier reading's one advantage has no
consumer in P2, and a tier stays derivable from bindings later while the reverse
is not true. The original question, for the record: whether `hi`/`lo` are real
named tiers in the data model or purely a
setup-flow convenience over eight independent bindings. The convenience reading
is simpler and probably right; the tier reading makes "use the cheap one for
this" expressible without knowing which roles are involved.

#### The policy, not just the mechanism

The bindings above are the mechanism. The policy is worth stating separately,
because a new step has to inherit it by default rather than deciding for itself:

> **The expensive model writes. Everything else uses the cheap one.**

`prose` is for narration — the thing the user reads and judges the product by.
Nearly everything else in this design *judges, extracts or classifies*, and that
list has grown long enough that the default matters:

| `fast` work | Where |
|---|---|
| Summarisation | [06 E1](06-open-questions.md) |
| Extraction and world-state classification | [03 §6](03-modes-and-turn-pipeline.md) |
| Plot-hook selection | [03 §6.1](03-modes-and-turn-pipeline.md) |
| Mention resolution, where it is model-assisted | [03 §8.2](03-modes-and-turn-pipeline.md) |
| Goal completion judgement | [03 §7.3.3](03-modes-and-turn-pipeline.md) |
| Continuity checking | [14 §2c.2](14-roadmap.md) |
| Field assists and the assistant | [05 §7](05-ui-surfaces.md), [05 §11.1](05-ui-surfaces.md) |

Several of those run **every turn**. Bound to `hi` by accident, they would
multiply a session's cost several times over for no perceptible gain, and the
user would experience it as *"this app is expensive"* without ever seeing why.
The turn record itemises cost per call ([05 §3](05-ui-surfaces.md)), so the
mistake is at least visible — but it is much better not made.

**Two caveats, so this does not become dogma.** Evaluation before narration
([08 §4.3](08-infinite-worlds.md)) decides *what happens* rather than how it
reads, and a mode with real mechanics may reasonably bind it higher. And a
`fast` binding pointed at a genuinely poor model produces bad extraction, which
surfaces as bad state rather than bad prose and is therefore harder to diagnose —
which is an argument for the first-run flow asking for two *usable* models, not a
good one and whatever is free.

### 5.2 No embedded model runtime

**Local models are supported as connections. They are never embedded in the
server.**

Marinara ships a `sidecar` service and a bundled local model for scene effects.
The appeal is obvious — no configuration, no second process, free inference for
small tasks — and it is still the wrong trade here:

- It puts **model weights in the distribution**, which breaks the packaging
  story ([04 §5.4](04-server-multiuser-deployment.md)) — the container stops
  being small, and the tarball stops being a tarball.
- It makes the server **compete with itself for GPU and RAM** on a box that is
  usually also doing something else.
- It drags in **platform-specific native builds**, which is precisely what the
  runtime choice avoided ([§2](#2-runtime-node-lts)).
- And it duplicates something the ecosystem already does better: **Ollama,
  llama.cpp and vLLM all expose OpenAI-compatible endpoints**, so a local model
  is already just a connection with a `localhost` URL and no key.

The `fast` role in §5.0 is the honest version of the same idea: point it at a
local endpoint and cheap work runs locally, without the engine owning an
inference stack.

### 5.3 Prompt length caps are a provider capability

**Every generated string sent to a provider is capped by a declared limit.**
Prompted most sharply by image generation, where an expanded prompt routinely
overruns what the model or endpoint will accept, but the same failure exists
wherever the engine hands a model something it generated.

The failure mode is worse than an error, because the common behaviour is
**silent truncation**: the request succeeds, the tail is discarded, and the user
gets a degraded image with nothing to indicate why. That is the specific thing
this prevents.

So the capability record the adapter already carries gains limits:

```ts
interface ProviderCapabilities {
  supportsTools: boolean
  supportsStructuredOutput: boolean
  maxPromptChars?: number       // hard: what the endpoint accepts
  usefulPromptChars?: number    // soft: where quality degrades
  // … completed in [13 §3], including same-role message merging
}
```

**Two numbers, not one**, because they are genuinely different questions. CLIP's
77-token window is a *useful* limit — many implementations chunk past it and
attention simply degrades — whereas a provider's request-size limit is a hard
one. Conflating them either wastes headroom or silently produces bad output.

Applies across the board, not only to images: video prompts, TTS input (which
has real length limits), embedding input, and tool queries are all generated
strings handed to a provider.

**Ship known-provider defaults.** Nobody should have to discover CLIP's 77
tokens themselves. Defaults per known provider, overridable per connection —
and per connection is the right home, because a limit is a property of *that
endpoint*, and connections are private production config rather than shareable
content ([00 §3.2](00-stance.md)).

**The cap is an input to generation, not just a guillotine at send.** A step
generating an image prompt should be *told* its budget so it writes within it —
which produces a good short prompt rather than a truncated long one. Enforcement
at send is the backstop, not the mechanism.

**Assemble prompts from prioritised parts.** Where a prompt is composed —
subject, style, quality tags, character reference, negative — build it as ranked
fragments and drop the lowest-ranked when over budget, rather than cutting
mid-sentence. This is the same shape as context budgeting
([03 §5](03-modes-and-turn-pipeline.md)) and it is what makes §5.2 cheap later.

**Never silently.** The turn record shows the prompt was capped and what was
dropped, exactly as it does for context blocks
([02 §8](02-data-model.md)) — including for library-time generation, which
produces no turn record and therefore records it as field provenance
([05 §11.2](05-ui-surfaces.md)) instead.

### 5.4 Overrun recovery — post-1.0

An automatic handler that recognises a length-driven refusal and retries
smaller, bounded by a **regenerate attempts** setting. Deferred, and the
deferral is honest: providers signal this inconsistently — a clear 400 from one,
a generic error from another, a silent 200 with truncation from a third — so
detection is heuristic and needs real-world failures to tune against.

What matters now is that §5.1 makes it cheap when it arrives: with a cap
declared and prompts assembled from ranked fragments, a retry is *drop the
lowest fragment and resend*, not a fresh generation round-trip. Recorded in
[14 §3](14-roadmap.md).

### 5.5 The compatibility surface: OpenAI-compatible chat, and nothing below it

**Decision: raw text completion is legacy and is not supported.** There is no
downgrade adapter, no instruct templates, no context templates, no stop-sequence
machinery. The supported surface is stated in one line:

> **If it speaks OpenAI-compatible chat, it works. If it does not, it does not.**

That is a position rather than an omission, and it is worth stating that plainly
in user-facing documentation rather than letting people discover it.

**Why this costs less than it looks.** The completion-only era is largely over:
llama.cpp, Ollama, vLLM, LM Studio, KoboldCpp and text-generation-webui all
expose OpenAI-compatible chat endpoints, so a local model is a connection with a
`localhost` URL and no key ([§5.2](#52-no-embedded-model-runtime)). The genuinely
excluded set is small — completion-only services such as NovelAI, Horde-style
backends, and anyone deliberately driving a raw endpoint for control.

**Those users have an answer that is not ours to build.** A translating proxy in
front of the endpoint is an off-the-shelf solved problem. Pointing at one is a
documentation line; maintaining a completion path is a permanent tax on every
provider change.

**What is actually lost**, stated honestly:

- **Byte-exact control of the final prompt string.** Chat APIs impose a message
  structure. The turn record and workbench show precisely what was sent
  ([05 §3](05-ui-surfaces.md)), and blocks are editable — but the last
  serialisation step belongs to the provider. This is the loss power users will
  feel.
- **Continuation semantics.** "Continue this text" rather than "reply to this".
  Assistant prefill covers much of it where a provider supports it.
- **Completion-only models with no chat variant.**

**Reversing this later is a single seam.** [03 §5](03-modes-and-turn-pipeline.md)
already isolates rendering as step 4 — "the only place that knows what a chat API
looks like". A completion renderer would be a second implementation of that one
step, not a rewrite, because the core representation stays structured. So this
is a cheap decision to unmake if the bet on chat-shaped APIs ever turns.

**Two conditionals elsewhere now close firmly rather than conditionally:**
bundled tokenizers stay discarded ([triage §6.2](workplan/02-triage.md)), and the entire
instruct/context template surface stays discarded
([00 §2.2](00-stance.md)).

---

## 6. Client: React + Vite, with the framework decision deliberately reversible

**CONFIRMED ([06 A6](06-open-questions.md)): React + TypeScript + Vite. TanStack Query / Router / Virtual /
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
shipping components ([05 §8](05-ui-surfaces.md)), the framework is not part of
any public contract. Nothing outside the client package knows what it is. That
resolves the open question from the earlier draft: the framework choice is
ordinary, not architectural, *provided* the extension-UI decision holds.

### 6.1 The styling layer, and the one word it turns on

Tailwind v4, CSS-first: there is no `tailwind.config.js`, and the theme is an
`@theme` block in `packages/client/src/index.css`. What lives there and what
lives in `packages/client/src/ui/` is [05 §1.2](05-ui-surfaces.md); this is the
mechanical part.

- **Plain `@theme`, never `@theme inline`.** `inline` resolves each token at
  build time and writes the value into the utility — `background-color:
  oklch(…)` rather than `background-color: var(--color-accent)`. The whole
  theming layer depends on that indirection surviving into the browser, because
  a second theme is a redefinition of the variable. One word, and the difference
  between a themeable app and a repaint.
- **Every light value aliases a Tailwind default** rather than restating the hex
  it resolves to. That is what made migrating a hundred and seventy hard-coded
  colours on to these tokens provably non-visual — a rename cannot change a
  colour if the token *is* the old colour. Pinned by `theme.test.ts`.
- **`color-scheme` is declared in each theme.** It is what tells the browser to
  render the caret, scrollbars and native `<select>` popups to match. Omitting it
  produces an input that is styled correctly and still unusable, which is the
  shape of the [P2C](workplan/15-p2c-first-real-run.md) defect.
- **A token declared but referenced by no utility is pruned** from `:root`.
  Worth knowing before assuming a runtime override will reach one; `@theme
  static` is the escape hatch if that day comes.
- **Radix is still the intended primitive library** and is still not installed.
  `ui/` is where it lands: `Dialog` already owns the focus trap and `aria-modal`
  that a Radix primitive would take over, so the boundary exists ahead of the
  dependency.

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

*Two more arrived at P4.1, argued here rather than noticed in a lockfile:*

- **`liquidjs`** for block templates — [triage §7](workplan/02-triage.md)'s BUY,
  and the language [03 §5](03-modes-and-turn-pipeline.md),
  [08 §8](08-infinite-worlds.md) and [10 §8.4.2](10-schemas.md) had all already
  chosen. It could not be deferred past import: the macro table converts
  SillyTavern's macros *into* Liquid, so without a renderer a converted preset's
  `{{char}}` reaches the model as literal braces, and PLAYABLE would be testing
  prompt garbage. **What makes it a safe dependency is the fence rather than the
  library**: rendering is block-scoped over a closed namespace of two names, so
  the surface we depend on is `parseAndRenderSync` and nothing else. Swapping it
  would be a day's work, which is the test §6 applies to the framework.
- **`@fastify/multipart`** for the one upload route. The first non-JSON body this
  server accepts, and the reason `limits.maxUploadMb` stopped being a live key
  nobody read. First-party to Fastify, so it shares the framework's own
  maintenance and versioning rather than adding a second thing to track.

Both are MIT and pinned exactly, like everything above them.

### 7.1 Turn text in the index is a feature, not a side effect

The FTS5 line above says *"cards, entries and turn text"*, and the third of those
was written as though it were free capacity. It is the more valuable one:
searching your own story is the thing people want most and none of the three
sources does well ([05 §14](05-ui-surfaces.md)).

Three consequences for the index, all cheap now and awkward later:

- **Index turn text on write**, as part of the same incremental pass that indexes
  library objects. A search that only works after a manual reindex is a search
  nobody trusts.
- **Store the turn id and the session id**, not an offset into a rendered
  transcript. Reading order comes from a tree walk ([02 §5.5](02-data-model.md))
  and offsets into it are not stable across branching.
- **Records off the current path stay indexed**, because they are still real
  history — but a hit on an abandoned branch must be *labelled* as one. The
  branch-awareness rule in [09 §7](09-branching.md) already says library search
  must not surface content from a discarded line as though it were current; this
  is the same rule for turn search, and the honest resolution is to show it with
  its branch rather than to hide it.

None of this is work beyond what indexing turn text already implies. It is worth
stating because the natural shortcut — index the current path only, rebuild
lazily — produces a search that quietly loses the thing you were looking for.

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
([04 §7](04-server-multiuser-deployment.md)) arrives — that is when
simultaneous input and turn arbitration would make it worth the complexity.

---

## 9. Auth: no framework

Given the threat model in [04 §4.1](04-server-multiuser-deployment.md):

- **`scrypt` from `node:crypto`.** No native dependency, in the standard library,
  and what SillyTavern uses. argon2id is marginally better and costs a native
  module; not worth it here.
- **httpOnly, SameSite=Lax signed session cookie.** Session records go in the
  **operational store**, not the index ([13 §5.1](13-internal-contracts.md)) — an
  earlier draft put them in the index, which is defined as deletable without
  consequence, and logging every user out is a consequence. Signed stateless
  cookies plus a revocation denylist avoid the table entirely and are probably
  the right answer at household scale.
- **CSRF token on state-changing routes.**
- **One audited path-resolution helper** used by every filesystem-touching route
  — the single most important piece of security code in the project, per
  [05 §4.4](05-ui-surfaces.md).

An identity-provider interface should exist from the start even with one
implementation, so Tailscale identity ([04 §5.2](04-server-multiuser-deployment.md))
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
  modes/scene/     ⎫ built-in modes, each its own package,
  modes/adventure/ ⎬ consuming sdk exactly as a third party would.
                   ⎭ Messages joins at 2.0 [work plan §0].
```

**`sdk` is AGPL-3.0, like everything else, and that is deliberate rather than
incidental.** Extensions import it, which is what makes them combined works and
what makes [triage §1.1](workplan/02-triage.md)'s decision hold. Publishing it under a
permissive licence "to be friendly to extension authors" would quietly reverse
that decision, so it is worth a comment in the package manifest saying why.

The modes arrangement is the other important part, and it is a **discipline
mechanism, not organisation**. [03 §2](03-modes-and-turn-pipeline.md) claims the built-in modes
must be implemented only through the public mode contract, or "modes as
extensions" is aspirational. Putting them in separate packages that depend on
`sdk` and *not* on `server` turns that claim into a build error. It is the
cheapest possible enforcement of the design's central bet.

---

## 11. Dev mode

**A priority, not a nicety.** Marinara's live-refresh-on-change is the bar. The
loop this shortens is the one that dominates work on this kind of app — change a
prompt, run a turn, read the output, change it again — and every second of
restart in that loop is paid hundreds of times a day.

What reloads, in descending order of how easily:

| Changes to | Behaviour | Notes |
|---|---|---|
| Client code | Vite HMR | Free. |
| **Content and templates** | **Live, in production too** | Falls out of the watcher-fed index ([04 §6.2](04-server-multiuser-deployment.md)). Not a dev-mode feature. |
| Config marked `live` | Re-read on change | Per [04 §6.1](04-server-multiuser-deployment.md). |
| Server code | Watch-restart (`tsx watch` or equivalent) | Fast, but drops SSE connections and in-flight turns. |
| Extension code | Process restart | True ESM unloading is not worth attempting; see [04 §6.4](04-server-multiuser-deployment.md). |
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

## 12. UI localisation

Settled before code because two of the decisions below are nearly free now and
expensive later, and one of them is already a latent bug in
[04 §3.4](04-server-multiuser-deployment.md).

**Scope: application chrome only.** Not story content, not character cards or
lorebooks (that is [06 B8](06-open-questions.md), a different problem), not log
output, and not the documentation — see §12.7.

### 12.1 The real risk is rot, not library choice

The planning assumption should be that **the main dev does not translate**, and
that the only first-party translation is a deliberately bad machine-generated
French one for testing. Everything below follows from that.

SillyTavern is the useful data point, being the most deployed project in this
space. It ships 17 languages as flat JSON, and the key counts diverge sharply —
French around 2,060 entries against German, Japanese and Icelandic all around
1,455. **Partial translation is the steady state**, not a transient condition to
be fixed. A design that treats a missing string as an error will produce a
worse experience than one that treats it as normal.

So: **missing keys fall back to English, silently, per key.** No placeholder, no
`[MISSING]`, no console noise in production. A 60%-translated UI should look
like a bilingual UI, not a broken one.

### 12.2 Explicit keys, not English source text

SillyTavern keys on the English string (`"Delete": "Supprimer"`), which is
tempting because it makes the fallback trivial. Its own files show where that
goes: alongside the English keys sit `clickslidertips`, `kobldpresets`,
`guikoboldaisettings` — explicit keys that appeared because source-text keys
become unusable once a string is a sentence. The result is a hybrid nobody
chose.

The deeper problem is that **source-text keys make every English copy-edit a
translation-invalidating event.** Fixing a typo or tightening a label orphans
that string in all 17 languages. On a young project where English wording churns
constantly, that is the rot mechanism.

Use explicit hierarchical keys — `settings.connection.title` — with the English
catalog as just another catalog file. Copy-editing English then costs nothing.

### 12.3 i18next

**Recommendation: `i18next` with `react-i18next`, flat JSON catalogs, ICU
MessageFormat via plugin.**

The deciding factor is not the React binding, it is that **i18next runs on the
server too**. Push notification bodies are rendered without the app open
(§12.5), so the server must be able to localise; a client-only library would
mean two localisation stacks. Beyond that: largest ecosystem, first-class
Weblate support, and catalogs that are plain JSON — which matters because both
casual contributors and a machine-translation script have to edit them.

Lingui is the better authoring experience and its extraction is cleaner; it is
the reasonable alternative if the server-side need turns out to be small.

**ICU MessageFormat is not optional.** Pluralisation is where naive i18n breaks:
English has two plural forms, Russian and Arabic have more, and `count === 1 ?
"entry" : "entries"` cannot express that. ICU handles plurals, gender and
selection in the catalog where translators can reach them.

### 12.4 Machine translation as a first-class path

Given the stated constraint, this is the primary mechanism rather than a
fallback, and should be built as such:

- A script that diffs each catalog against English and fills gaps via an LLM.
- **Every machine-filled entry carries a provenance marker** — the same idea as
  `GeneratedFieldProvenance` ([05 §11.2](05-ui-surfaces.md)), applied to strings.
- The marker is what makes human contribution work: a translator sees which
  entries are machine-generated and unreviewed, and fixing one clears the flag.
  Without it, a contributor cannot tell their careful work from a script's
  output and will not trust either.
- Machine translation runs **on demand, not in CI**. Automatic translation on
  every merge produces churn, cost, and diffs nobody reviews.

**Give translators context.** A key alone is not enough to translate well —
`actions.open` is a verb or an adjective depending on where it lives. Extraction
should carry the developer comment and, where cheap, the surface it appears on.
This helps a human translator and materially improves machine output.

### 12.5 Two things that are latent bugs right now

**The server must emit keys and parameters, never English prose.**
[04 §3.4](04-server-multiuser-deployment.md) currently specifies that
notification events carry "a human summary — one line fit to be a notification
body". As written that is baked English and untranslatable. It must be
`{ key, params }`, rendered at the point of display. Corrected there.

**Accounts need a locale.** Push notifications are rendered by a service worker
or by the push service with the app closed, so the *server* localises them —
which means it must know each user's language. A `locale` field on the account
([04 §4.2](04-server-multiuser-deployment.md)), defaulted from `Accept-Language`
on first login and overridable in settings. Cheap now; a migration later.

### 12.6 Decisions that are free now and painful later

- **CSS logical properties from the first stylesheet.** `margin-inline-start`,
  not `margin-left`; `padding-inline`, not `padding-left/right`. This costs
  nothing while writing new CSS and makes right-to-left support a `dir="rtl"`
  attribute rather than a rewrite. Arabic and Hebrew are otherwise permanently
  out of reach, which for a project with 17-language ambitions is a real
  foreclosure.

  Enforced twice, because a Tailwind utility is not a declaration and Stylelint
  cannot see one: `stylelint.rules.js` for real CSS, `eslint.rules.js` for class
  strings. The ESLint half was originally anchored on
  `JSXAttribute[name.name="className"]`, and **that anchor was removed** when the
  class strings moved into `packages/client/src/ui/` — a string in a `const` has
  no such ancestor, so the rule had been silent on every extracted class list,
  including the one `Shell.tsx` passed through `activeProps`. Unanchored, the
  pattern also had to become *exact*: it now sees SQL and ordinary English, and
  `left`/`right` must carry a Tailwind-shaped suffix or a `left join` and a test
  named *"accepts the right password"* both report. Both halves are pinned by
  fixtures in `tools/lint-fixtures/`.
- **`Intl` for everything formatted.** Dates, numbers, currency, and especially
  `Intl.RelativeTimeFormat` for "2 minutes ago". Hand-rolled relative time is
  untranslatable and always slightly wrong.
- **No string concatenation to build sentences.** `"Deleted " + n + " entries"`
  cannot be translated into a language with different word order. One key, one
  full sentence, with parameters. **This is the one that is genuinely
  unretrofittable** — see §12.6a.
- **No user-visible string in logic.** Nothing branches on displayed text and
  nothing uses it as a key. Cheap to hold, and it is what keeps a later
  extraction pass mechanical.

#### 12.6a What is actually unretrofittable, and what only feels like it

Scoped down deliberately ([work plan §0.4](workplan/01-work-plan.md)). Full i18n ceremony from
the first component is a real ongoing tax on a solo developer whose only planned
translation is one bad machine-generated French pass, and paying it from commit
one buys less than it appears to.

The distinction that matters is between a **habit** and a **task**:

| | Cost if deferred |
|---|---|
| Concatenated sentences, strings in logic, `margin-left`, hand-rolled relative time | **A rewrite.** Every component that did it has to be reworked, and nothing flags them. |
| Wrapping strings in `t()`, the catalogue, the key hierarchy, extraction in CI | **The work itself.** Mechanical, greppable, and done once. |

The first row stays on the day-one checklist ([work plan §2](workplan/01-work-plan.md)) and is
non-negotiable. **The second becomes a pre-beta sweep**, run as its own task
against a codebase that never concatenated — which is exactly the codebase the
first row guarantees.

This holds nearly all the value and drops most of the cost. It also fails
honestly if it fails: an un-extracted string is visible, findable and fixable,
whereas a concatenated one is invisible until a translator hits it.

- **Extraction is a build step once it exists.** From the sweep onward, a key in
  source but not in the English catalogue is a bug and CI fails on stale
  extraction. It must **never** fail on missing translations in other languages —
  that is the normal state, per §12.1.

### 12.7 What not to translate, and one warning

**Documentation is out of scope.** Marinara maintains translated docs on a
separate `docs-i18n` branch, with per-language folders mirroring English 1:1,
generated manifests, hash validation scripts, and a contributing rule requiring
every PR touching `docs/` to update every language folder or file a follow-up
issue. That is a well-built system and an accurate picture of the ongoing cost.
For a solo dev it is not affordable. Translate the UI; leave docs in English.

Also untranslated: log output and developer-facing errors (they are for the
person reading a terminal), and user content (B8).

### 12.8 The contributor path

**Weblate.** It is free for libre projects, hosts a web UI so a translator never
touches git, and syncs to the repository as ordinary commits. For a project
where the maintainer will not translate, this is the entire mechanism by which
translations actually appear — a `CONTRIBUTING` note saying "edit the JSON and
open a PR" produces roughly zero translations.

**[OPEN]** Whether to self-host Weblate or use their hosted libre offering. The
hosted one is the obvious start.

---

## 13. Testing

**Vitest** for unit and golden-file tests, **Playwright** for a thin set of
end-to-end journeys, **fast-check** for the round-trip and replay invariants.

The headline is that **prompt assembly is snapshot-testable here**, because the
turn record already captures every block, its source, its reason, its cost and
the budget verdict ([02 §8](02-data-model.md)). The thing hardest to test in all
three sources becomes the easiest thing to test in this one.

**Full treatment in [testing](workplan/10-testing.md)** — the layers, the fake provider that
keeps model calls out of CI, encoding the day-one checklist as lint rules,
architectural boundary enforcement, fixtures, and the CI tiers.

---

## 14. Randomness: one canonical source

**Decision: the server provides a single RNG service. Nothing else draws random
numbers — not steps, not modes, not the rules evaluator, not extensions. It is
server-local and has no network dependency of any kind.**

Implementation is deliberately unremarkable; the constraints are the point.

### 14.1 Why singular is a correctness property

Not tidiness. Three things depend on it:

- **Replay and branching.** Every draw is recorded in the turn's effects
  ([02 §8](02-data-model.md)), because state at turn N must remain a pure
  function of the effect log ([09 §2](09-branching.md)). A caller that draws
  its own number without recording it breaks that invariant silently, and the
  symptom appears much later as a branch that reconstructs wrong.
- **Auditability.** In a mode with dice, "was that roll fair?" is a question
  players genuinely ask. One source, every draw logged, visible in the turn
  record, is a complete answer.
- **Testability.** One seam to inject a deterministic generator through.

### 14.2 The API has to be complete, or it will be bypassed

If the service does not offer what a caller needs, they will reach for
`Math.random()` and the invariant is gone. Completeness is therefore a
correctness requirement, not a convenience. It should cover at least:

`int(min, max)` · `float()` · `bool()` · `chance(p)` · `pick(items)` ·
`weightedPick(items)` · `shuffle(items)` · `dice(notation)`

`dice` and `chance` are not speculative: the authored-rules vocabulary already
needs `<<1d20>>` and `triggerOnRandomChance`
([08 §3](08-infinite-worlds.md)), and both first-party reference extensions
need dice ([14 §4.4](14-roadmap.md)). `weightedPick` covers loot-table shapes,
which is where people would otherwise improvise.

### 14.3 Implementation

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

### 14.4 Enforcement

- A lint rule banning `Math.random` and direct `node:crypto` random calls
  outside the service. Cheap, and catches the common case in our own code.
- For in-process extensions the lint rule does not apply, so the honest position
  is that this is discipline rather than enforcement — **except** that it is
  self-policing under test: an extension using unrecorded randomness will fail a
  replay-determinism check, because replaying its recorded effects will not
  reproduce its behaviour. That check belongs in the extension test kit, and it
  is a better guarantee than a rule nobody can enforce.

### 14.5 Rewrite and reroll — DECIDED

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

### 14.6 What the tape covers, and how it is keyed

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

## 15. Summary

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
