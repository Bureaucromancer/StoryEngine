# 06 — Open questions

Collected from the inline **[OPEN]** markers, plus questions that don't belong to
one document. Ordered by how expensive they are to answer late.

---

## A. Decide before writing code

**A1. Extension execution model.** In-process modules (simple, every installed
extension is fully trusted) or sandboxed workers with message passing (safer,
much more work, constrains the API shape)? Given LAN multi-user with a shared
library and admin-only installation, in-process may be acceptable — but this is
close to unretrofittable. *[03 §9]*

**A2. Can a package ship code?** If a package may bundle a mode or extension
implementation, importing a package becomes a code-execution decision. Lean:
declare dependencies only at 1.0. *[02 §7]*

**A3. Server-scoped connections.** Can an admin configure a connection that all
users may *use* but none may read? Almost certainly yes — it is the natural
household setup — and it means connections need a scope from the start. *[04 §3.3]*

**A4. Raw-completion support.** [00 §2.2] proposes making chat-shaped APIs with
structured output the core contract and raw completion an edge adapter. How much
raw/local-backend support ships at 1.0, and is the resulting disadvantage to
those backends acceptable? *[00 §2.2]*

**A5. Multiplayer posture.** Confirm "don't preclude, don't build": `participants`
is a list, `control: "player"` isn't structurally limited to one, turns are
already server-side — but no arbitration, no per-user hidden state, no
simultaneous input at 1.0. *[04 §5]*

**A6. Client framework.** *Largely resolved*: [05 §7] settles that extensions
declare widgets from a versioned vocabulary rather than shipping components,
which removes the framework from every public contract and makes the choice
reversible. [07 §6] recommends React + Vite + TanStack on the strength of the
dense-data surfaces (library, workbench); Svelte 5 remains a genuine
alternative that Aventuras proves works in this domain. What is *not* resolved
is the escape hatch for extensions needing genuinely custom rendering — a
sandboxed iframe with a narrow postMessage API is the obvious answer and real
work. *[05 §7, 07 §6]*

**A7. Schema direction of derivation.** [07 §4] recommends TypeBox, so JSON
Schema is the artefact and TypeScript types are derived — on the grounds that
package and extension manifests must be validatable by tools not compiled
against our TypeScript. Zod v4 with `toJSONSchema()` is the better-DX reversal
and a defensible one. Decide before the first schema is written; the migration
is mechanical but touches everything.

**A8. Runtime and index driver.** Node LTS with `node:sqlite` if it holds up,
`better-sqlite3` as fallback. The derived-index design makes this low-risk (a
driver bug costs a rebuild, not data), but it decides whether the project has a
native dependency at all, which shapes Docker builds. *[07 §2, §7]*

---

## B. Data model questions

**B1. Fixed profile fields or conventional sections?** Are `summary`,
`appearance`, `voice`, `background` real fields on `ActorProfile`, or four
`sections` with well-known ids? Current lean: fixed, because the default preset
benefits from being able to rely on them. *[02 §2.1]*

**B2. Does a Setting own a primary lorebook** that its editor writes into, or
only link to independently-owned ones? Affects the "add a location" affordance
and what happens on delete. *[02 §4]*

**B3. Turn record retention.** Full records are large. Keep everything by
default with optional compaction of old turns, or compact automatically past N?
*[02 §8]*

**B4. Turn storage layout.** One file per turn (simple, thousands of files per
campaign) vs JSONL segments (~200 turns per file). Lean: segments. *[02 §5.5]*

**B5. Embedded payload compression** in PNG cards — plain base64 `tEXt` or
`zTXt`? Affects third-party tool compatibility, so decide once and don't
revisit. *[02 §5.2]*

**B6. JSON or YAML** for hand-edited kinds. Possible split: JSON for
machine-written objects, YAML for config and preset templates. *[02 §5.4]*

**B7. Channel schema migration.** What happens to an in-flight session when the
mode that owns its channels updates its schema? Needs an answer before anything
ships. *[03 §4]*

**B8. Translated play.** Aventuras smears `translated*` fields across every
entity, which does not scale. Is translated play a 1.0 requirement at all? If
yes, a translation sidecar keyed by (objectId, field, language) is the obvious
alternative. *[01 §2]*

**B9. Can an expanded opening seed be saved back** to its source object as a new
written opening? Cheap and useful; small provenance question. *[02 §6]*

**B11. Lorebook — confirm the four revisions.** [02 §3] now takes entry
activation, timing, recursion, placement and budgeting from Marinara
essentially unchanged. Four changes remain proposed and each is arguable:
(a) entry state (`dynamicState`, quests, relationships, disposition) moves to
session channels, with only a `stateSchema` on the entry — justified by lorebook
portability, since an exported lorebook must not carry your playthrough;
(b) `activationConditions` + `schedule` unify as typed channel predicates;
(c) `embedding` moves to the derived index; (d) the five overlapping book-level
scoping mechanisms collapse to one `LoreScope` union. (d) is nearly free; (a) is
the one with real consequences for how quest-like content is authored. *[02 §3]*

**B10. Prologue packages.** May a package ship a partially-played session as a
starting state? Attractive for authored content; crosses the content/session
line the rest of the model keeps clean. *[02 §7]*

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

---

## D. Deployment questions

**D1. Tailscale target level for 1.0.** Level 1 (detect and show the tailnet
URL) is cheap and captures most of the practical value; Level 2 (tailnet
identity as auth, following SillyTavern's trusted-proxy header pattern) changes
the auth model; Level 3 (`tsnet` embedded node) is a real project. Lean: ship
1, design auth so 2 is a provider rather than a special case. *[04 §4.2]*

**D2. Auto-provision accounts from tailnet identity**, or require an admin to
pre-create them? *[04 §4.2]*

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

- **Image, audio and video generation.** All three sources invest heavily here.
  Nothing above says how generation assets attach to sessions and actors, how
  image-prompt construction relates to the turn record, or what ships at 1.0.
- **Memory and summarisation.** Aventuras has chapters, batched summarisation and
  retrieval; Marinara has rolling summaries and session recaps. The channel model
  gestures at where this lives but nothing here designs it. This is a large
  omission and probably the next document to write.
- **Embeddings and vector search.** Assumed available as a retriever
  ([02 §3](02-data-model.md)); no position on what provides it or where the index
  lives.
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
