# 04 — Proposed schemas

**Status: proposal, but the tightest one here.** These are the structures worth
agreeing before code, because other people's data ends up in them.

Written as TypeScript for readability. The implementation derives these from
TypeBox, and **the published artifact is JSON Schema**
([20 §4](20-tech-stack.md)) — third-party tools need a schema they can validate
against without compiling our types.

---

## 1. The stability boundary is portability

The question "which schemas should we commit to early?" has a clean answer:

> **A structure that travels between installs must be stable. A structure that
> lives only inside one install can be migrated freely.**

Portable structures hold data authored by people who are not us, possibly read
by tools that are not ours. Breaking them destroys or strands that work.
Internal structures can be migrated on upgrade because we own every copy.

| Tier | Structures | Commitment |
|---|---|---|
| **Stable** | Actor, Lorebook, Treatment, Setup, World — *Package until [P16.0](workplan/35-p16-world.md), the same kind renamed ([§9](#9-world--a-named-set-held-by-reference))* — and the shared substructures in §3 | Define now, change only additively, version on breakage |
| **Provisional** | Preset (§8) | Portable, so it needs a schema — but at `/0`, which says the shape will move |
| **Free to move** | Session, Turn record, Channel state, rule vocabulary | Internal. Migrate at will |

**Preset moved out of the internal tier**, where an earlier draft had it, on the
grounds that it plainly fails this section's own test: a preset travels between
installs — it is the object this ecosystem trades most — so calling it internal
was a contradiction with [03 §1](03-data-model.md), which lists it as portable.
§8 works through the consequences.

**Package used to be a prototype exception and no longer is.** It was marked
unstable because it carried a game definition — an `entry` block naming a mode,
a treatment and a cast — that nobody had tested against real authored content.
Splitting that out into Setup (§7) leaves Package as a self-describing container
(~~§8~~ §9) with almost no surface of its own: it does not enumerate the kinds it
holds, so a new portable kind does not change it. What was genuinely unstable was
the game definition, and that is now a normal object versioned like the rest.
*(2026-10-10: the container is the World since [P16.0](workplan/35-p16-world.md)
renamed the kind, and the argument transfers unchanged — the World's fields are
the Package's. The section reference read §8, which is Preset's; corrected in
the same change.)*

The asymmetry that justified the exception still holds and is worth keeping in
mind: **breaking a container costs a re-export; breaking an Actor costs somebody's
character.**

**Turn records are internal despite being large and valuable.** They never leave
the install, so they can churn freely — which matters, because the assembler
will churn. With one horizon worth knowing: session export is wanted eventually
([26 B12](26-open-questions.md)), and when it ships the turn record becomes a
portable format and this freedom ends.

---

## 2. Versioning and compatibility

Every portable structure carries a schema identifier:

```ts
schema: "storyengine.actor/1"
```

Rules, which matter more than the number:

- **Readers must preserve unknown fields**, not reject or drop them. A file
  written by a newer version must survive a round trip through an older one.
  This is what `metadata` and `compat` are for, and it is the single rule that
  lets the format evolve without stranding anyone.
- **Additive changes do not bump the version.** New optional fields are free.
- **Removals, renames and semantic changes do.** A field that means something
  different is a new version even if it has the same name and type.
- **Version bumps are read-compatible where possible**: a `/2` reader accepts
  `/1` and upgrades in memory. Writing back is what materialises the upgrade.
- **`null` and absent are distinguished deliberately.** `contentRating: null`
  means *unspecified, ask the user*; absent means the same for compatibility;
  neither means "sfw". Anywhere this distinction carries meaning it is
  commented below.

---

## 3. Shared substructures

Defined once, used across every stable type. Getting these right matters more
than any individual entity, because a flaw here appears everywhere.

```ts
/** A link to another object. Resolution order is always: exact id, then
 *  case-insensitive name, then show as missing and continue. Never blocks.
 *  [00 §3.3] */
interface Ref<T = unknown> {
  id: string
  /** For display, and for name-fallback resolution when the id is unknown. */
  name: string
  /** Content hash at link time. Lets the UI say "this has changed since"
   *  without blocking anything. Optional; absence is not an error. */
  fingerprint?: string
}

/** A link to a lorebook, with a strength. Used by Treatment and Setup rather than
 *  a bare Ref, because "this world does not work without Rain City" is worth
 *  saying and "this is a nice extra" is not the same claim. */
interface LoreLink {
  ref: Ref
  /** When true, a consumer warns loudly if the lorebook cannot be resolved.
   *  Still never blocks — [00 §3.3]. Default false. */
  required: boolean
}

/** Where an object came from and who made it. */
interface Provenance {
  source: "manual" | "import" | "generated" | "package" | "session"
  creator: string | null
  /** Author's own version string. Free text; not our schema version. */
  version: string | null
  /** Licence the *author* places on this content. Never inherited from the
   *  app's licence — content is not a derivative work. [triage §1.2] */
  license: string | null
  originalFilename: string | null
  createdAt: string        // ISO 8601. Never epoch ms.
  updatedAt: string
}

/** Retained generated value for one field, so an edit can be reverted and the
 *  source disclosed. Keyed by dotted path in `generated`. [10 §11.2] */
interface GeneratedFieldProvenance {
  /** The generated value. JSON-encoded for non-string fields. */
  original: string
  at: string
  model: string | null
  /** The input the generation ran from. */
  seed: string | null
  /** False once a human has reviewed or edited it. */
  unreviewed: boolean
}

/** Two genuinely different things, so two lists rather than one with a flag:
 *  a written opening is content, a seed is an instruction. [03 §6] */
interface Openings {
  written: Opening[]
  seeds: Opening[]
  /** An ordered list plus a designated primary — not a `primary` field and an
   *  `alternates` array. Reordering is then free and the first element is not
   *  special. */
  primaryWrittenId: string | null
  primarySeedId: string | null
}

interface Opening {
  id: string
  label: string
  text: string
  /** Author guidance. For a seed, this steers the expansion. */
  note?: string
  /** Set when this written opening was promoted from an expanded seed, so the
   *  lineage is visible. [03 §6] */
  fromSeedId?: string
}

/** Normalised 0..1 rectangle of a source image. Normalised rather than pixels
 *  so it survives the source being resized or re-encoded. [10 §11.3] */
interface SourceRect {
  x: number; y: number; width: number; height: number
}

/** Structured appearance for image and video pipelines. Prose `appearance` is
 *  for the narrator; this is for machines. [03 §2.1] */
interface VisualDescriptors {
  face?: string
  hair?: string
  eyes?: string
  build?: string
  clothing?: string
  accessories?: string
  distinguishing?: string
}

/** Roles are typed from the start. A flat image list forecloses everything
 *  downstream — an image pipeline must know which picture is the canonical
 *  likeness. [03 §5.2.2] */
type MediaRole =
  | "portrait-source"   // the uncropped original behind the card's own pixels
  | "reference"         // canonical likeness — of a person, or of a place
  | "expression"        // one face from a set the scene chooses between
  | "pose"              // one body from a set, the same way
  | "style"             // style exemplar, not likeness
  | "map"               // a diagram rather than a likeness. Lore, mostly
  | "gallery"
  | "background"        // the backdrop a scene is staged against [06 §10.1a]

// One vocabulary, not one per kind. `reference` means the same thing on a
// lorebook entry as on an actor — *this is what it looks like*, suitable for
// conditioning generation — which is what lets a later feature treat a
// location's reference image the way it already treats an actor's
// ([25 §3](25-roadmap.md)). `map` is the only addition lore needed, because a
// diagram is genuinely not a likeness. `illustration` was considered and
// rejected as a synonym for `reference` that would leave authors guessing.
//
// `background` was added at P7.9 and this listing was not: the union had no
// role naming what an uploaded backdrop *is*, because nothing pointed at one
// until a channel did. The nearest was `reference`, which this section reserves
// for a likeness of a place — and a likeness is what a backdrop is conditioned
// on rather than what it is. Distinct from `Rendition.purpose`, which says the
// same thing about a *generated* image ([06 §10.1a]: "two fields because there
// are two questions"). Corrected 2026-09-13.
//
// And it widened a closed union inside `actor/1` — which §2's round-trip rule
// cannot survive for any closed portable union: a build without the arm fails
// a file that uses it, whole. No released build can meet one (alpha.1–4 export
// and import no native object), so the cost starts with the first release that
// does; whether to open this union before then is in 25. Corrected 2026-10-01.
//
// `expression` and `pose` are the two arms a *set* is chosen from rather than
// a single canonical image, which is why `label` matters on them and on almost
// nothing else: Scene's stager matches a model's answer against those labels
// ([06 §7.2], P7.12), and a set whose members are unlabelled is a set nothing
// can select within.

/** Media carried *inside* the card envelope. Bounded by policy — bulk galleries
 *  and video live in the folder as `assets`. */
/** A *reference* to bytes carried by the container, never the bytes themselves.
 *  An earlier draft had `bytes: Uint8Array`, which has no representation in
 *  JSON Schema and no meaning at all inside a `.sepack`, where there is no PNG
 *  chunk to point at. The manifest form works in every container: a PNG private
 *  chunk, a zip entry, or a folder. */
interface EmbeddedMedia {
  id: string
  role: MediaRole
  mime: string
  /** Content hash of the bytes — `sha256:<hex>`. The identity of the blob, and
   *  what makes duplicate media across a package store once. */
  digest: string
  bytes: number
  /** Where the container keeps it. A PNG chunk blob index, a zip entry path, or
   *  a path relative to the object's folder — the container decides, and the
   *  reader resolves it through the same envelope interface
   *  ([03 §5.2](03-data-model.md)). */
  ref: string
  label?: string
  /** Arbitrary, author-defined: "winter", "aerial", "concept art", "before the
   *  fire", "by Mireille". The counterpart to `role`, and the division of
   *  labour is the same one `ActorRole` and `Actor.tags` already make
   *  ([03 §2.2](03-data-model.md)):
   *
   *    role — closed union. The engine reads it and acts on it.
   *    tags — open. The engine has no built-in meaning for any of them,
   *           though an author may gate lore on one ([05 §1](05-tagging.md)).
   *
   *  That split is what keeps the union small without costing authors
   *  precision. A gallery of forty images needs finer notation than six roles
   *  can carry, and every attempt to express that *through* the roles ends with
   *  a union nobody can choose from. */
  tags: string[]
  width?: number
  height?: number
  crop?: SourceRect
  generated?: GeneratedFieldProvenance
}

/** Bulk asset, stored in the object's folder. Always a relative path inside
 *  that folder — never absolute, never escaping it. [03 §5.3] */
interface AssetRef {
  path: string
  role: MediaRole
  label?: string
}

/** A preference, never a binding. An imported card may express what it wants;
 *  it can never repoint anyone's provider. Resolution is local. [03 §2.6] */
interface ModelHint {
  role: "prose" | "fast" | "reasoning" | "vision"
  preferredModelIds?: string[]
  note?: string
}
```

### 3.1 WritingSample

Prose offered as an exemplar — *show, do not tell*. Carried by Actor, Lorebook
and Treatment; the full argument is [14](14-writing-samples.md).

The rest of this design describes style: `tone.styleNotes` says "terse,
hardboiled", `se.voice` is register and verbal tics and is explicit that it is
not what somebody sounds like. This is the field that *demonstrates* it — a
passage from the setting, pasted whole. The precedent is
[18 §3](18-character-studio.md),
which already separated a style exemplar from a likeness for pictures on the
grounds that style is a property of the production rather than of the person.

```ts
interface WritingSample {
  id: string
  /** Names it for the author, in the editor and the block table. Never injected. */
  title: string
  /** The prose itself. The only field that reaches a model. */
  body: string
  /** Off keeps it on the object without spending a turn on it — a draft, not a
   *  budget casualty. Distinct from deletion, deliberately. */
  enabled: boolean
  /** Budget priority. Absent = inherit the slot block's, which is how every
   *  other candidate behaves; present, it ranks samples against each other. */
  priority?: number
  /** Why this sample is here, for a person reading the object. Never injected. */
  note: string
}
```

**A list rather than one blob** on each carrier, because the budgeter's only move
against a single block is to drop all of it. **Optional on all three kinds**, so
it is additive and none of them bumped a version (§2).

**No `maxLength`.** No portable schema carries one, and a sample is the field
most likely to invite the first — [14 §5](14-writing-samples.md) states the
budget consequence instead, which is where it is actually enforced.

---

## 4. Actor

One card type. Personas and NPCs are flags and tags, not separate types.

```ts
interface Actor {
  schema: "storyengine.actor/1"
  id: string                       // uuidv7
  name: string
  /** Also the default keyword set for lore matching. */
  aliases: string[]
  /** Never inferred from the name. null means unknown, not "they". */
  pronouns: string | null

  /** Flags, not types. Advisory — any actor may be chosen as persona; the flag
   *  controls what pickers offer first. [03 §2.2] */
  roles: ActorRole[]
  /** "npc" lives here. The engine has no built-in meaning for any tag, though
   *  an author may gate lore on one ([05 §1](05-tagging.md)). */
  tags: string[]

  profile: ActorProfile
  openings: Openings
  /** Prose written *as* this person, offered as an exemplar — §3.1.
   *  Top-level rather than under `profile`, and beside `openings`: the profile
   *  is what somebody is like, while a sample demonstrates how they are
   *  written, which [18 §3](18-character-studio.md) classes as production. */
  writingSamples?: WritingSample[]
  lore: Ref[]                      // linked lorebooks, not embedded

  media: EmbeddedMedia[]           // travels inside the card
  assets: AssetRef[]               // bulk, travels with the folder
  /** Crop applied to produce the card's own pixels. The source is retained in
   *  `media` with role "portrait-source", so re-cropping is lossless. */
  portraitCrop: SourceRect | null

  modelHint: ModelHint | null
  /** Namespaced by owning mode or extension. A mode may only read its own key;
   *  unknown keys survive round trips untouched. [03 §2.4] */
  modeData: Record<string, unknown>

  provenance: Provenance
  /** Per-field generation provenance, keyed by dotted path
   *  ("profile.appearance"). */
  generated: Record<string, GeneratedFieldProvenance> | null
  /** Unrecognised fields from an import, preserved verbatim so nothing is lost
   *  and re-export is possible. */
  compat: Record<string, unknown> | null
}

type ActorRole = "persona" | "narrator" | (string & {})   // genuinely open

interface ActorProfile {
  /** Structured appearance, for image pipelines. A real field, not a section:
   *  it is not prose and nothing renders it as a block. */
  visual: VisualDescriptors | null
  traits: string[]
  /** Everything prose. Includes the four conventional sections below. */
  sections: Section[]
}

interface Section {
  /** Stable. Presets and modes address blocks by this. Ids in the `se.`
   *  namespace are reserved; author-defined sections must not use it. */
  id: string
  title: string
  body: string
  disposition: "always" | "on-demand" | "reference-only"
}
```

**Conventional sections.** There are no fixed prose fields on the profile. Four
sections are *conventional* — reserved ids that everything assumes exist:

| Id | What it holds |
|---|---|
| `se.summary` | The always-present core. Short by design. |
| `se.appearance` | Prose appearance, for the narrator. Distinct from `visual`. |
| `se.voice` | Register, verbal tics, how they talk — not what they sound like. |
| `se.background` | History. |

"Conventional" is enforced at three layers, none of them the schema:

- **The editor creates all four on a new actor** and presents them as the form,
  so in practice they always exist.
- **Generation and assists treat them as required** — a field assist for "write
  an appearance" targets `se.appearance` and will create it if somebody deleted
  it.
- **The default preset addresses them by id** and must tolerate absence, because
  structurally nothing prevents a user deleting one. Missing means empty, never
  an error.

The gain is uniformity: adding a custom section is the same operation as editing
a built-in one, the assembler has one code path rather than four fields plus a
list, and a preset can reorder or drop `se.background` without special-casing.

**Deliberately absent**, and this is most of the design:
`system_prompt`, `post_history_instructions`, `depth_prompt`, `talkativeness`,
`scenario`. Prompt assembly is owned by the preset and the mode, not by the
description of a person ([00 §2.4](00-stance.md)). Per-session numbers — HP,
inventory — live in channels and must never appear here.

> **`mes_example` left this list.** It was here, and the sentence beside it read
> ~~"Dialogue examples are a `Section` with `disposition: "on-demand"`"~~. They
> are now `writingSamples` ([§3.1](#31-writingsample), [14](14-writing-samples.md)).
> The reasoning that put them in a Section is unchanged and still holds — the
> card declares no assembly, and a sample is still positioned and budgeted by a
> preset slot. What failed was the container: a `Section` has no `priority`, and
> [00 §2.6](00-stance.md) requires every block to carry one, so a sample in a
> Section could not participate in the rule the budgeter is built on.

---

## 5. Lorebook

Entry activation is taken from Marinara close to unchanged, because it is a
decade of empirical tuning and it is the interchange format
([03 §3](03-data-model.md)). The changes are ~~four~~ **five**, all scoped —
corrected at P4.2, where the converter had to enumerate them and the code's own
header had counted five for some time.

```ts
interface Lorebook {
  schema: "storyengine.lorebook/1"
  id: string
  name: string
  description: string

  scope: LoreScope                 // see below — collapses 5 mechanisms into 1
  enabled: boolean

  scanDepth: number                // default 2; 0 = whole session
  tokenBudget: number              // default 2048; 0 = unlimited
  entryLimit: number               // default 100; range 1..1000
  recursiveScanning: boolean       // default false
  maxRecursionDepth: number        // default 3

  folders: LoreFolder[]
  /** Optional. Hooks genuinely inseparable from this lore — eligible only while
   *  this lorebook is active. Treatments remain the primary home. [03 §4.1] */
  hooks?: PlotHook[]
  entries: LoreEntry[]
  /** Prose from this world, offered as an exemplar — §3.1. Book-scoped rather
   *  than on an entry: an exemplar that appears only when somebody says a magic
   *  word is not an exemplar. Overrides [11 §4](11-lorebooks-as-a-format.md)'s
   *  refusal of new fields; the reasoning is [14 §6.2](14-writing-samples.md). */
  writingSamples?: WritingSample[]

  /** Organisational, and the only such axis — a closed `category` union was
   *  removed rather than renamed. See below. */
  tags: string[]
  /** The book's gallery — maps, establishing shots, style references for the
   *  world as a whole. §5.1 */
  media: EmbeddedMedia[]
  /** Which of `media` is the library card's picture. Ordered-list-plus-primary,
   *  as `Openings` does it (§3), rather than a separate `cover` field —
   *  reordering stays free and the first element is not special. */
  primaryMediaId: string | null
  /** Bulk, in the folder rather than the manifest. Parity with Actor. [03 §5.3] */
  assets: AssetRef[]
  provenance: Provenance
  generated: Record<string, GeneratedFieldProvenance> | null
  metadata: Record<string, unknown>
}

/** One mechanism, three behaviours, mutual exclusion by construction. Replaces
 *  characterId + characterIds + personaId + personaIds + chatId + isGlobal +
 *  scope, and the save-time rule that kept them consistent. [03 §3.4] */
/** Portable scopes only. `global` and `linked` travel — an actor id is portable
 *  and resolves or dangles like any other Ref ([00 §3.3](00-stance.md)). */
type LoreScope =
  | { kind: "global" }
  | { kind: "linked"; actorIds: string[] }    // personas are actors
  | { kind: "world"; worldIds: string[] }     // P16.2 — read once, at creation in one
  | { kind: string /* any other */ }          // open (26 B16): kept, read by nothing

// Session scoping is NOT here. Session ids are install-local, so a shared
// lorebook carrying them exports identifiers that are meaningless everywhere
// else — noise on import at best, and a false resolution against an unrelated
// local session at worst. "This lorebook applies to this session" is a fact
// about the *session*, so it lives on the session's own lore links
// ([03 §8](03-data-model.md)), pointing outward at the lorebook rather than the
// lorebook pointing inward at the session.

// And as of [P5.7]'s reversal, that outward-pointing link is the ONLY way a
// lorebook reaches a session: `session.lore`, or the treatment the session
// names. NOTHING READS THIS FIELD. It is carried, exported and preserved on
// import because it is part of the format; it selects nothing, because a field
// on a library object opting itself into somebody's story put every book a
// person owned into every prompt — `global` being both this schema's factory
// default and the SillyTavern importer's fallback ([03 §3.4]).
//
// ~~Two questions left open rather than settled~~, in [26](26-open-questions.md):
// §B14, may `scope` narrow a book the session already chose; and §B15, what a
// new book's scope should default to. [15 §5.3](15-world.md) is where a
// consumer would come from — inheritance, designed, not inferred from the
// union's wording. (2026-10-04: both answered, in the paragraph below —
// recommended answers, owner deferred.)
//
// DECIDED 2026-10-04, AND NOT YET BUILT ([15 §5.3](15-world.md),
// [P16.2](workplan/35-p16-world.md)). The union gains a third arm,
//   | { kind: "world"; worldIds: string[] }
// read once, at session creation in one of those Worlds, by copying the book
// into `session.lore`; `global` and `linked` stay read by nothing. World ids
// are portable where session ids are not, which is the whole difference between
// this arm and the one refused above. A new book defaults to
// `{ kind: "linked", actorIds: [] }`, the narrowest honest value, and so does
// every standalone SillyTavern book (§B15); §B14 keeps "no" — both the
// recommended answer, owner deferred (26 B14/B15), and neither waits on B16.
// Adding an arm to this closed union inside `/1` is
// [26 B16](26-open-questions.md)'s question, and the arm waits on its answer.
//
// BUILT 2026-10-10, ON BRANCH `p16` ([P16.2](workplan/35-p16-world.md)). The
// owner answered B16 the same day: OPEN THE UNIONS. So the `world` arm is in
// the union inside `/1`, and so is an open fourth arm — any `kind` this build
// does not know, validated as a string that is none of the three it does, kept
// verbatim and read by nothing — which is what makes a book a newer build scoped
// some new way open here instead of failing whole, as `ActorRole` and `CallKind`
// already do. A known kind with the wrong fields still fails: a `world` without
// `worldIds` is a malformed book, not an unknown one. At creation in a World, a
// book in the person's library whose scope names it is copied into
// `session.lore` after the World's own lorebook members, ordered by name; a
// request's own `lore` overrides both. The lorebook editor sets it. A build
// from before the opening still refuses a book with an arm it lacks — opening
// helps every build after it.

interface LoreFolder {
  id: string
  name: string
  parentFolderId: string | null
  /** A gate: when false every entry inside is inactive regardless of its own
   *  `enabled`, which is preserved rather than mutated. */
  enabled: boolean
  order: number
}

interface LoreEntry {
  id: string
  name: string
  content: string
  /** Read only by a knowledge-router step to judge relevance. Never injected
   *  as content. */
  description: string

  // ── Matching ──
  keys: string[]
  secondaryKeys: string[]
  selectiveLogic: "and_any" | "and_all" | "not_any" | "not_all"
  selective: boolean
  matchWholeWords: boolean
  caseSensitive: boolean
  /** Patterns run under a hard execution timeout. [triage §5.1] */
  useRegex: boolean
  scanDepth: number | null         // null = inherit from the book

  // ── Firing ──
  enabled: boolean
  constant: boolean                // fires whenever the book is active
  probability: number | null       // 0..100; null = always

  // ── Timing. Four distinct behaviours, not four takes on one. ──
  sticky: number | null            // stay active N messages after firing
  cooldown: number | null          // wait N messages between firings
  delay: number | null             // do not fire until N messages in
  ephemeral: number | null         // auto-disable after N firings

  // ── Placement ──
  position: "before_char" | "after_char" | "at_depth" | "outlet"
  /** Exact, case-sensitive, for {{outlet::name}}. Decouples "this activated"
   *  from "this gets pasted here". */
  outletName: string | null
  depth: number
  order: number                    // lower = earlier
  role: "system" | "user" | "assistant"

  // ── Grouping and gating ──
  group: string | null             // only one of a group fires
  groupWeight: number | null
  folderId: string | null
  actorFilter: LoreFilter | null
  actorTagFilter: LoreFilter | null
  generationTriggerFilter: LoreFilter | null
  /** Scan places other than recent messages — a card's description, a persona's
   *  tags, and so on. */
  additionalMatchingSources: string[]

  // ── Recursion. Three flags, all earning their place. ──
  preventRecursion: boolean        // my content triggers nothing further
  excludeRecursion: boolean        // I cannot be triggered recursively
  delayUntilRecursion: boolean     // I fire only during recursion

  // ── The one addition ──
  /** Where a retriever contributed by an extension attaches. Everything
   *  built in stays a flat field above. [03 §3.1] */
  extensionActivations?: { by: string; config: unknown }[]

  /** If this entry tracks state, its shape. The *values* live in a session
   *  channel keyed by entry id — never here, because an exported lorebook must
   *  not carry somebody's playthrough. [03 §3.3] */
  stateSchema?: unknown            // JSON Schema

  /** Free string with a suggested vocabulary ("location", "item", "quest"),
   *  not a closed union. */
  tag: string | null

  /** Pictures of the thing this entry describes. §5.1
   *
   *  ⚠ MEDIA DOES NOT ACTIVATE. An entry firing on a keyword contributes its
   *  *text*. Its images are not retrieved, not budgeted and not sent — at 1.0
   *  nothing outside the editor reads this field at all. The assumption that
   *  activation carries the whole entry is the natural one and it is wrong;
   *  twelve pictures on a `constant: true` entry would otherwise be a per-turn
   *  cost nobody chose. */
  media: EmbeddedMedia[]

  /** Locked against automatic modification by agents. */
  locked: boolean
  metadata: Record<string, unknown>
}

interface LoreFilter {
  mode: "any" | "include" | "exclude"
  values: string[]
}
```

**Deliberately absent**: `embedding` (derived — belongs in the index, and would
otherwise put megabytes of one install's vector arithmetic into every shared
lorebook), `dynamicState`, quest structures, `relationships`, and
`activationConditions` / `schedule`. The last two become typed channel
predicates; the rest become channels ([03 §3.3](03-data-model.md)).


**Also absent: `category`.** An earlier draft carried Marinara's five-value
book-level union — `world`, `character`, `npc`, `spellbook`, `uncategorized` —
described as organisational only and explicitly not affecting activation. It is
removed rather than renamed, and the reasons compound:

- **It argued against itself.** [03 §3.4](03-data-model.md) rejects closed
  vocabularies one paragraph earlier — *"Aventuras' closed `EntryType` union is
  the one with the ceiling. Take Marinara's shape"* — and then kept a closed
  union at book level. `LoreEntry.tag` is free text for exactly this reason.
- **The values were not one axis.** `world`, `character` and `npc` are subject
  matter; `spellbook` is one genre's artefact; `uncategorized` is a null wearing
  a value's clothes.
- **`character` and `npc` as separate values contradict the actor model.**
  Persona and NPC are flags on a single Actor kind ([03 §2.2](03-data-model.md)),
  and two book categories for one actor concept re-import the split that
  unification removed.
- **`tags` already does the job**, openly, and is what the library's filters
  read.

The trigger was the collision — `category: "world"` alongside a reserved World
concept ([15](15-world.md)) — but the collision only made the field worth
reopening. What was found on reopening is why it is gone rather than renamed.

### 5.1 Images on lore

New territory rather than a port: Marinara carries one `imagePath` per book for
the library card and nothing per entry, and SillyTavern's World Info has no
images at all. Reasoning in [03 §3.6](03-data-model.md); the shape is two
`EmbeddedMedia[]` fields, one on the book and one on the entry, both resolving
into the object's folder.

**Nothing in the engine reads them at 1.0**, and the `⚠` on `LoreEntry.media` is
the load-bearing part of this addition rather than a caution. What makes it worth
adding now anyway is that **typed roles cannot be retrofitted**
([03 §5.2.2](03-data-model.md)) — the same argument made for cards, unchanged.
Adding images later without roles means guessing afterwards what each one was
for, and the guess is not recoverable.

*Audit correction:* this sentence read *"nothing reads them at 1.0 outside the
editor"*, which contradicted `Lorebook.primaryMediaId` one screen above — a field
whose entire documented purpose is *"the library card's picture"*, and whose
consumer is therefore the library and not the editor. **The `⚠` is about
activation, not about display.** Media is not retrieved, not budgeted and not
sent, none of which a thumbnail on a browse row breaks, and the corrected
sentence says *engine* because that is the boundary the warning was always
drawing. The `⚠` on `LoreEntry.media` is untouched and means exactly what it
said. The panel that spends `primaryMediaId` is [10 §5.3](10-ui-surfaces.md).

The intended first real consumer is rendition conditioning
([25 §3](25-roadmap.md)): a location's `reference` image is the same shape of
input to *illustrate this scene* that an actor's already is
([06 §10.3](06-modes-and-turn-pipeline.md)). That is why `reference` carries the
same meaning across both kinds rather than lore getting a vocabulary of its own.

### 5.2 Entry-level exchange

Entries import and export independently of the book they live in, as a routine
editor action rather than a special case ([10 §11.2c](10-ui-surfaces.md)). The
schema pays nothing for it, which is most of the argument for doing it this way.

- **The exchange file is a `Lorebook`.** `entries` holds the selection, `folders`
  holds the ancestors of those entries, and everything else is an ordinary book.
  A `LoreEntry[]` fragment format was considered and rejected: it saves a handful
  of book-level fields and gives up the one property that makes this schema worth
  taking close to unchanged ([03 §3](03-data-model.md)) — that every tool in the
  ecosystem already reads this shape. A partial export that only our importer
  understands is a worse artefact than a small lorebook that everything does.
- **Its book-level fields are the source book's, and advisory on arrival.** An
  importer merging into an existing book keeps entries and folders and drops the
  rest. `scanDepth: null` means *inherit*, so an entry that inherited eight now
  inherits whatever the destination says — which is what the field means and what
  the author wrote when they left it null.
- **`LoreEntry.id` is unique within one book and carries no meaning beyond it.**
  An importer may renumber freely, two books holding the same id is ordinary
  rather than a conflict, and nothing may treat id equality across books as
  identity. The editor's rule that follows from this — add by default, replace
  only when asked — is at [10 §11.2c](10-ui-surfaces.md).
- **Nothing session-scoped travels, because nothing session-scoped is present.**
  `stateSchema` is a declaration and belongs to the entry; the values live in a
  channel keyed by entry id ([03 §3.3](03-data-model.md)) and are not in the book
  to leak.

Container rules are unchanged and are the book's: JSON where the selection
carries no media, the zip form where it does ([03 §5.2.3](03-data-model.md)).

---

## 6. Treatment

Carries tone, framing and *links* — never world facts. The rule that makes it
work: a Treatment of Rain City does not describe Rain City.

> **Named `Setting` until now.** The rename is recorded because the reasoning
> generalises. Three candidates were considered and all three named *the
> material* — `Setting` (in tabletop usage, a setting **is** the world book),
> `World` (the world lives in the lorebook, so the pair reads backwards), and
> `Scenario` (both source projects use it for the *conflated* object, and
> Marinara's own reframe uses it for the **child**, which is our Setup). This
> object is not material; it is the stance on material. Every material-word
> therefore invited exactly the misreading the invariant above forbids, which is
> why the invariant had to be written in bold in the first place — a name doing
> its job would have made it unnecessary. *Treatment* is the screenwriting term
> for how material is handled, and it holds `cast`, `openings` and `hooks`
> without strain, which `Lens` and the rest did not.
>
> The second reason was mechanical: `Setting` was one case-fold from the
> configuration surface, and the collision was already on disk — the kind's
> library folder was `settings/` while the app's config screen was Settings.
> **`World` is now reserved** for the 4.0 continuity container over sessions
> ([15](15-world.md)) and is deliberately not spent on a library label.
> *(2026-10-03: it will be spent on one —
> [26 B17](26-open-questions.md) makes World the named set that replaces
> Package, so Package's library label is the one it takes, ~~when the design
> step lands it~~ *at [P16.0](workplan/35-p16-world.md), now that the design
> step has landed — [15](15-world.md), rewritten 2026-10-04*. The reservation
> did its job: the word is free for that.)*

```ts
interface Treatment {
  schema: "storyengine.treatment/1"
  id: string
  name: string

  /** Library-card preview text. Never injected anywhere. */
  blurb: string
  /** The short "how this world is used here" piece. Injected every turn, and
   *  therefore budgeted like anything else. */
  framing: string

  tone: {
    genres: string[]
    moods: string[]
    pov: "first" | "second" | "third"
    tense: "past" | "present"
    /** Advisory. Authorial intent, not a promise about model behaviour — §6.2.
     *  null = unspecified. A consumer must prompt, never assume. */
    contentRating: "sfw" | "nsfw" | null
    styleNotes: string
  }

  /** Prose from this world, offered as an exemplar — §3.1. The demonstrative
   *  twin of `tone.styleNotes` and not a replacement for it: a directive is
   *  cheap and vague, an exemplar expensive and specific. The §6 invariant
   *  holds — a sample shows how Rain City is *written*, while what Rain City
   *  *is* stays in the linked lorebook. */
  writingSamples?: WritingSample[]

  lore: LoreLink[]                 // where the world content actually lives
  cast: CastEntry[]
  openings: Openings
  hooks: PlotHook[]                // §6.1
  /** Advisory. What pacing this material wants; a Setup may override and a
   *  session owns it thereafter. §6.1b. */
  hookPacing?: HookPacing

  /** Advisory. Authored prose asking the narrator for turns that stage well —
   *  a property of the material, never derived from the image settings.
   *  §6.1b, [06 §10.6]. */
  stagingNotes?: string

  /** Advisory only. A treatment proposes a mode; it never configures production
   *  treatments. [00 §3.2] */
  modeHints: { modeId?: string; config?: unknown }

  tags: string[]
  media: EmbeddedMedia[]
  provenance: Provenance
  generated: Record<string, GeneratedFieldProvenance> | null
  metadata: Record<string, unknown>
}

interface CastEntry {
  ref: Ref
  billing: "persona-option" | "party-option" | "npc" | "narrator-option"
  /** How this character is used *in this treatment*. */
  note: string
}
```

**Deliberately absent**: key locations, world description, NPC inline snapshots.
Locations are lorebook entries; the cast links to real actors. This is what
dissolves the materialise-or-not question Marinara's scenario design spends a
section on ([03 §4](03-data-model.md)).

**A Treatment owns no lorebook.** It only links, which is what allows **many
treatments over one lorebook** — a Rain City noir treatment and a Rain City comedy
treatment drawing on the same world, which is a normal thing to want and would be
blocked by a primary-lorebook relationship. Ownership on delete also stops being
a question nobody wants to answer.

`LoreLink.required` (§3) is the concession: an author can mark a link as load-
bearing, and a consumer warns loudly when it cannot be resolved. It still never
blocks ([00 §3.3](00-stance.md)) — the difference between "this treatment is
missing a nice extra" and "this treatment is missing its world" is worth saying
out loud, and that is all the flag does.

Actor lore links stay bare `Ref[]`: a character's own lorebook going missing is
a soft degradation, not a broken world.

**Consequence for the editor.** With no owned lorebook, an "add a location while
authoring a treatment" action has to target one of the linked lorebooks — the user
picks, or creates a new one and links it. Slightly more explicit than an implicit
home, and correct.

### 6.1 PlotHook

A pool of authored, discrete plot turns, held out of context until a selector
judges the moment right. The inverse of a rule: a rule is condition-first, a
hook is a Y looking for its moment ([03 §4.1](03-data-model.md)).

```ts
interface PlotHook {
  id: string
  /** For the author's list. Never injected. */
  title: string
  /** The content, handwritten. */
  premise: string
  /** Blast radius, not location. Named `magnitude` because `Lorebook.scope`
   *  answers a different question, and one word for two axes in two portable
   *  schemas is a trap. */
  magnitude: "sweeping" | "local" | "personal"

  // ── Eligibility. Checked mechanically, before any model call. ──
  /** Moot if these are dead, gone, or never introduced. Not bookkeeping:
   *  firing a hook about someone who died four sessions ago destroys
   *  confidence in the mechanism in one message. */
  involves: Ref[]
  blockedBy?: string[]             // hook ids that make this nonsensical
  notBefore?: { turn?: number; afterHook?: string }

  // ── Selection and firing ──
  weight: number                   // relative likelihood among eligible hooks
  delivery: "guidance" | "seed" | "immediate"
  once: boolean

  /** Present when the hook *is* a character's arrival rather than an event —
   *  §6.1a. Optional, so the schema stays `/1`. */
  introduces?: Introduction
}

/** A character as a hook. §6.1a. */
interface Introduction {
  actor: Ref
  /** Written alternates. Empty is legal: then `premise` steers an improvised
   *  arrival. */
  entrances: Entrance[]
  /** The one a manual fire uses, and the one the editor shows first. The
   *  selector otherwise draws across all of them — *not* "always use this". */
  primaryEntranceId: string | null
}

interface Entrance {
  id: string
  label: string
  text: string
  /** When this entrance fits — guidance to the *selector*, not to the narrator.
   *  Deliberately not `Opening.note`'s meaning ("this steers the expansion"),
   *  which has nothing to say about a written alternate. */
  note?: string
}
```

**Fully stable, because the rule-typed fields are gone.** An earlier draft
carried `requires?: Predicate[]` and `onFire?: Effect[]` with ⚠ warnings, since
both belonged to the authored-rule vocabulary. That vocabulary is now 6.0
([work plan §0.4](workplan/01-work-plan.md)), and rather than ship a `/1` schema with two fields
typed against something unwritten, they are removed.

**Little is lost, which is part of why the deferral was affordable.**
`involves`, `blockedBy` and `notBefore` are mechanical filters needing no
vocabulary, and between them they carry most authored hooks — *not until turn 40,
not if she is dead, not if the rival plot already fired* is the shape of nearly
every real pacing constraint. What goes is arbitrary state predicates and
effect-driven hook chaining, both of which want a real vocabulary to be worth
using at all.

**They return additively.** Two optional fields on an object that already has
optional fields is not a breaking change, so the schema stays `/1` when the
vocabulary arrives ([13 §2](#2-versioning-and-compatibility)).

### 6.1a A character as a hook

`involves` lets a hook *reference* actors. `introduces` is the hook that **is**
one: the content is *bring this person into the story*, optionally guided by one
of several authored entrances. The reason it earns a field rather than being an
ordinary hook with a name in its premise is that it needs the opposite
eligibility test, and there is nowhere else to say so.

**`premise` is the instruction; `entrances` are the content.** The same division
`Openings` makes in §3 — *a written opening is content, a seed is an
instruction* — which settles `delivery` without a new arm: with entrances
present, `guidance` weaves the chosen one; with none, `seed` expands the premise
into an arrival. The borrowing stops there. There is no expand-then-promote path
and no `fromPremiseId`, because nothing here plays the part `Openings.seeds`
plays; the analogy is about what the two fields *are*, not about a loop between
them.

**Subject eligibility inverts exactly one of `involves`' three tests, and the
other two still hold.** `involves` means *dead, gone, or never introduced*. An
introduction hook is eligible only while its subject is **not** introduced —
but a subject who is dead is no more introducible than an `involves` cast member
who is. Exempting the subject from the whole check would fire *"Vera walks into
the bar"* for a Vera the session recorded dead four sessions ago, which is the
severe failure [03 §4.1](03-data-model.md) exists to name. So the predicate is
written out rather than described as an inversion:

> Eligible when the subject **resolves**, is **not yet introduced**, carries no
> terminal status, is **not the persona**, and is **not already in the party**.

The last two are not hypothetical: a Setup's `cast.partyDefault` (§7) can name
the same actor a lorebook-borne hook wants to introduce.

**The subject belongs in `introduces.actor` and not in `involves`**, which stays
available for the other characters an entrance depends on — *only if her brother
is still alive*.

**A dangling subject is a broken hook, not a retired one**, and this is the one
place `Ref`'s never-block rule ([§3](#3-shared-substructures)) needs a second
answer. A dangling `involves` entry retires a hook quietly, which is mercy for a
cast that is gone. A dangling `introduces.actor` can never succeed at all —
there is no actor to introduce — so it is ineligible **with a visible reason**
and the author is told. Same field type, opposite treatment.

**`once` is moot when `introduces` is present, and that is better than a
constraint.** Introduction is monotone along a path and the predicate already
excludes an introduced subject, so the hook is self-limiting whatever the flag
says. Refusing `once: false` here would be the stable tier's first validation
refusal and would buy nothing — the engine derives it and the editor explains
it. (A *return* after a departure is a real and different thing: that subject is
introduced, so it belongs in `involves` and is an ordinary hook.)

**`magnitude` is unconstrained and will usually be `personal`.** Said here
because a required field with no good answer is what makes an author distrust a
form.

**An empty `premise` is legal when entrances are present** — the entrances are
the content. The selector's judgement pass is described as reading premises, so
where there is none it reads the entrance labels.

**Lorebooks may carry these too, with one cost stated.** [03 §4.1](03-data-model.md)'s
allowed-but-secondary rule applies unchanged, and *the stranger from the Flower
Kingdom* is close to its canonical case. It does mean a Lorebook can depend on an
Actor for the first time — softly, since an unresolvable subject breaks the hook
and never the book — and compatible export to third-party formats drops the whole
thing, like everything else we add ([§2](#2-versioning-and-compatibility)).

### 6.1b `HookPacing` — an authored default, never a binding

```ts
type HookPacing = "sparse" | "normal" | "aggressive" | "manual-only"
```

Semantics belong to the selector and are specified at
[06 §6.1](06-modes-and-turn-pipeline.md). What is settled *here* is only where the
value may be written down, and the answer is the shape `openings` already uses:
**a Treatment proposes, a Setup overrides, and the running session owns it.**

**A Treatment may carry it, which is not obvious and is worth the sentence.**
Pacing looks like a property of a game rather than of a reading of a world, which
would put it on Setup alone. But a treatment is where hooks primarily live
([03 §4.1](03-data-model.md)), and *this material wants to be sparse* is a real
authorial intent that would otherwise be lost the moment somebody builds a Setup
over it. `modeHints` (§6) is the precedent for an advisory-only field there, and
the channel that carries the live value already has a *from treatment* init arm
([06 §4](06-modes-and-turn-pipeline.md)) — so the mechanism exists and declining
to use it would be the arbitrary choice.

**Optional on both, because a required field added to a published `/1` is a `/2`
change** ([§2](#2-versioning-and-compatibility)). Absent means unspecified, which
the session resolves to its own default; it does not mean `normal`.

**Not a production setting**, and it does not become one by being live: it says
how much authored plot should be pushed at a player, which is authorial, and it
has nowhere to put an endpoint or a key ([00 §3.2](00-stance.md)).

#### `stagingNotes` is the second field this argument covers

Added when [06 §10.6](06-modes-and-turn-pipeline.md) needed a way for a treatment
to ask the narrator for turns that stage well — *this material wants scenes you
can see*. Every clause above transfers unchanged: advisory, optional on both for
the `/1` reason, authorial intent about the material rather than a property of
one playthrough, and holding no endpoint and no key.

**The clause that has to be checked rather than transferred is the last one**,
because this is the field with a production setting standing next to it. It is
prose, and it is **never derived from the image controls**: a treatment that
wants cinematic staging wants it with illustration switched off, because it is a
statement about how the prose should read. Marinara runs the coupling the other
way and substitutes its keyframe count into the narrator's prompt, so changing
the image budget rewrites the story — which
[01 §1](01-source-survey.md) already identifies as production and
narrative content confused with each other, one level higher up. Production must
not reach the prose; a treatment may, because a treatment is prose.

Prose rather than an enum, unlike `hookPacing`, and the difference is real: a
cadence has levels an engine schedules against
([06 §6.1](06-modes-and-turn-pipeline.md) puts the numbers in engine code and the
words in the pack), while this one only ever reaches a model. There is nothing
for the engine to do with it, so there is nothing to enumerate.

### 6.2 `contentRating` is advisory — and says so

Settled in [26 E8](26-open-questions.md), recorded here because it constrains
every surface that displays the field.

**The rating states the author's intent for the material. It is not a statement
about how any model will behave, and every surface that shows it carries that
caveat in words.** Nothing in the engine gates on it: no step refuses to run, no
lorebook entry is withheld, no connection is blocked.

The reason is not squeamishness about the enforcement work. It is that
enforcement here would be **a promise that cannot be kept** — a rating implying
the model will stay inside it is a guarantee no local software can make, and
making it badly is worse than not making it. So the field does the one thing it
can do honestly: help a human decide what to open.

**Where enforcement actually belongs is prompt packs and upstream system
prompts** — the layer that shapes model behaviour directly, authored by whoever
holds the opinion and replaceable by whoever does not. That layer also has the
better property: its effect is visible in the turn record
([03 §8](03-data-model.md)) rather than buried in engine logic.

A preset *may* read the field and act on it. That is a preset's choice, made in
the open, and is the correct place for such a choice to live.

---

## 7. Setup — how to start playing

An earlier draft folded this into Package, which conflated two unrelated jobs:
*what a game is* and *how to move objects between installs*. Split, both get
simpler.

A **Setup** is an ordinary library object like any other. It says which mode,
which treatment, which cast, which preset, which opening — everything needed to
start a session and nothing about how to transport it.

```ts
interface Setup {
  schema: "storyengine.setup/1"
  id: string
  name: string
  /** Library-card text. Never injected. */
  blurb: string

  mode: {
    id: string
    /** Whatever the mode's own setup collected. Stored verbatim, never
     *  interpreted by the host, so a game can always recover the options it
     *  was created with. */
    config: unknown
  }

  treatment: Ref | null              // one Treatment; null = start bare
  preset: Ref | null

  cast: {
    personaOptions: Ref[]          // offered as the played character
    partyDefault: Ref[]            // [06 §8] — the party always contains the persona
    narrator: Ref | null           // null = the mode's default narrator
  }

  /** Beyond whatever the treatment already links. */
  lore: LoreLink[]
  /** Overrides the treatment's when present. */
  openings: Openings
  /** Additional to the treatment's, not a replacement. */
  hooks: PlotHook[]
  /** Overrides the treatment's when present. §6.1b. */
  hookPacing?: HookPacing
  /** §7.1. Ordered: goals[0] is where play begins. Empty = no win condition,
   *  which is the deliberate opt-out rather than the default. */
  goals: Goal[]
  /** §7.2. What had already happened — the new session's summary root. */
  storySoFar?: string
  /** §7.2. Hook ids already fired before play begins, from any source. */
  spentHooks?: string[]

  tags: string[]
  media: EmbeddedMedia[]
  provenance: Provenance
  generated: Record<string, GeneratedFieldProvenance> | null
  metadata: Record<string, unknown>
}
```

**Treatment is to Setup as a reading of a world is to a game played under it.**
One Treatment, many Setups. The full ladder: *Rain City* is the lorebook — the
world; *Rain City, noir* is the Treatment — how that world is handled here; *The
Fixer's Debt*, Freeform, playing Marlow is a Setup — one game played under
it. This is the reframe Marinara's own scenario design
identified and deferred — "make Setting the first-class entity and scenarios its
children" ([01 §1](01-source-survey.md)). We adopted the parent and never built
the child; Setup is the child.

**A Setup is useful without ever being shared**, which is the strongest argument
for it being a plain object. Saving "my Rain City campaign configuration" for
your own reuse should not require building a transport artefact with embedded
copies and a dependency manifest.

**No production settings, still.** No connections, no credentials, no endpoint
URLs, no per-install toggles — enforced by there being nowhere to put them
([00 §3.2](00-stance.md)). `mode.config` is opaque to the host but is subject to
the same rule.

**[OPEN] `cast` has a party and no scene.** `partyDefault` is read at creation
as a party — seated and made companions — and nothing in `cast` names an actor
seated without being one, which a session has had since P7.3 put `se.party`
beside the cast, and which P14.5 made something a person does (the session
form's *Characters*, the cast panel's *Add to the cast*). So neither *Save as
a setup* nor a Setup made from a turn can carry a character who was present
and not travelling with you. Recorded 2026-10-04 as
[26 B19](26-open-questions.md), and left as a documented asymmetry until the
owner answers it.

**Sessions are created from a Setup by copy**, per prefill-not-binding
([00 §3.1](00-stance.md)). Editing a Setup afterwards cannot reach a running
session. The reverse operation is also worth having and now has a clean shape:
**a running session can emit a Setup**, which is Marinara's play-first-share-
afterwards snapshot as a first-class object rather than a text file.

### 7.1 Goal

What the player is trying to do. Reasoning and the mode behaviour around it are
in [06 §7.3.3](06-modes-and-turn-pipeline.md); this is the shape.

```ts
interface Goal {
  id: string
  /** Short, always injected. "Get the ledger out of the Foundry."
   *  Difficulty prompt fragments reference it by name, which is why it is
   *  present in context rather than consulted on demand. */
  statement: string
  /** The author's fuller version. Available to steps; not injected by default,
   *  so a long one costs nothing per turn. */
  detail: string | null
  /** "hidden" is the GM's arc — same mechanism as a hidden channel
   *  ([06 §7.3](06-modes-and-turn-pipeline.md)), so the reveal affordance and
   *  the budgeting are shared rather than reinvented. */
  visibility: "player" | "hidden"

  /** "mechanical" — completion computed from channel state — waits on the
   *  authored-rule vocabulary and arrives as a third variant at 6.0
   *  ([work plan §0.4](workplan/01-work-plan.md)). Adding a variant is additive. */
  completion:
    | { kind: "narrative" }        // an evaluation step judges it
    | { kind: "manual" }           // the player says when

  /** Seeds the offer made at completion; never applied without asking
   *  ([06 §7.3.4](06-modes-and-turn-pipeline.md)). */
  thenDefault: "continue-open" | "advance" | "end"
  /** Authored successor, for a designed chain. null = ask. */
  next: string | null
}
```

**Both completion kinds are stable**, because the one that depended on the rule
vocabulary is not here yet. Campaign is where mechanical completion actually
earns its place — a quest whose state is real data — but Campaign at 5.0 does not
*supply* it: a `Goal` lives on Setup, which is authored content, so the condition
belongs to the author rather than to the mode. The vocabulary therefore lands a
release later with the rest of the authoring tier
([work plan §0.6](workplan/01-work-plan.md)), and Campaign ships with narrative
and manual completion, which is what its own quests need.

**Why `Goal` sits on Setup rather than Treatment.** A Treatment is a world and a
world has no win condition — the same rule that keeps world facts out of it
([§6](#6-treatment)). *Rain City* does not have an objective; *The Fixer's Debt*
does. Placing goals here is what allows several Setups with different objectives
over one world, which is the whole point of the split.

**Difficulty is deliberately not here.** It belongs to Freeform and Campaign rather than to every mode, so
it lives in `mode.config` where the host does not interpret it. Modelling it on
Setup would imply Messages and Scene have a difficulty, which they do not.

**`hookPacing` (§6.1b) *is* here, for the reason that is the exact converse**, and
the contrast is drawn rather than left implicit because the two look alike and are
not. Hooks are on every Treatment and every Setup and are mode-agnostic, so the
argument that keeps difficulty in `mode.config` — *it belongs to one mode* — does
not reach pacing at all.

> **[OPEN] Where difficulty's *live* value lives is a question this paragraph does
> not answer, and did not used to have to.** `mode.config` is opaque to the host
> by design, while [06 §7.3.1](06-modes-and-turn-pipeline.md) requires difficulty
> to be *"changeable mid-session, recorded as an effect like anything else"* — and
> an effect path cannot carry something the host has no schema for. The two
> statements have coexisted because nothing consumed them together. Hook pacing
> does not inherit the problem, because it is a channel from the start rather than
> a `mode.config` key, but the next dial will, so it is recorded here.
>
> **Two dials have arrived since, and neither inherited it** — which is evidence
> about the shape rather than a resolution. Illustration pacing
> ([06 §10.6](06-modes-and-turn-pipeline.md)) is a channel for exactly hook
> pacing's reasons and copies its declaration line for line; `stagingNotes`
> (§6.1b) is authored prose with no live value to locate at all. So the prediction
> above has held twice by dials following the precedent rather than by the
> question being answered, and it stays open for the first one that does not —
> which will be a dial belonging to a single mode, since that is what puts a value
> in `mode.config` and out of the host's reach.
>
> ***Answered 2026-09-13 at [P7.8](workplan/23-p7-implementation.md), by the dial
> this paragraph predicted.*** Difficulty is exactly the case it named — a dial
> belonging to a single mode — and the answer is **a channel the mode itself
> declares**, which is not the evasion it looks like. This question was posed
> when a channel could only be engine-owned, so it framed a choice between two
> bad options: `mode.config`, opaque and unable to take an effect, or Setup,
> which *"would imply Messages and Scene have a difficulty, which they do not"*.
> [P7](workplan/23-p7-implementation.md) added a third that did not exist when
> the paragraph was written. A mode declares its own channels, the registry
> enforces them, and the engine special-cases nothing — so:
>
> - **`mode.config` keeps the wizard's answer**, which is what *"opaque to the
>   host"* was protecting, and is read as a rung rather than written.
> - **The channel carries the live value**, so [06 §7.3.1]'s *"changeable
>   mid-session, recorded as an effect like anything else"* is satisfied by the
>   ordinary effect path with no special case in it.
> - **A mode with no difficulty declares neither channel**, which is precisely
>   the discrimination Setup could not express. Scene and Messages have none
>   because of what they declare, not because a field was left blank.
>
> The two ids and the declaration live in the SDK (`sdk/src/dials.ts`) rather
> than in each mode: a **surface** for a channel two modes declare independently
> requires them to declare it under one id, and three policy choices restated per
> mode is where they stop agreeing. *So the prediction held a third time in
> substance — the dial did not inherit the problem — but for a new reason, and
> the reason is worth the paragraph: the question was about where a value lives,
> and P7 changed who may own a place for it to live.*

### 7.2 A Setup made from a turn

***Added 2026-09-26 at [P15](workplan/33-p15-setup-from-a-turn.md)***, which is
where the *"running session can emit a Setup"* promised above was first built.

**Made from a turn, not from a session**, because a session is a tree and a
Setup is a starting point: the person picks the node they want to start from
again, and everything below is read *at that node* — the state on that path,
not the head's. The wizard condenses the story up to it, and what it writes is
an ordinary Setup, editable in the library and shareable in a World (*a package*
until [P16.0](workplan/35-p16-world.md)) like any hand-written one.

**Two fields exist for it, and both are optional**, so neither is a `/2`
change (§2):

- **`storySoFar`** is the condensed history. A session started from the Setup
  gets it as the **root of its rolling summary chain** — emitted by the preset's
  `summary` slot as the oldest link (*recorded as its own `story-so-far` arm,
  not a `summary` — [22 §1.1](22-internal-contracts.md), 2026-10-03*), and
  ~~folded in as `previous` by the first link the summariser derives~~ *handed to the first link the summariser derives
  as `previous`*. That is [07 §5.1](07-branching.md)'s
  `summary(n) = f(summary(n-1), turns)` with a seeded start rather than a second
  mechanism, and it costs one condition: a preset with no enabled `summary` slot
  never shows the model the root, which the wizard says out loud.

  *Corrected 2026-10-03, at the merge that brought this into `main`.* `main`
  had put the chain into **stretches** the day after this was written
  (`e9d1a142`): a link summarises its own turns and is handed the one before as
  context only, told not to repeat it. So `previous` no longer means *fold this
  in*, and the root is the stretch before the first turn rather than something
  the first link retells — **every reader of the story so far reads the root
  and the links together**, and the root stays in the prompt as its own block
  for as long as the slot has room. When it does not, the root is the **first
  part of the summary given up**, by the rule every link already follows: it is
  the oldest stretch, and as a rule the largest. What must outlast it has
  another carrier — the facts kept when the Setup was made are its companion
  lorebook's entries, which reach the prompt on their keys whatever the summary
  slot lost. The root keys the first link, so a different root is a different
  chain, and every caller that plans or derives a chain — the turn, the warm
  derivation, the preview, the draft — takes it from one plan
  ([P15 §1.1](workplan/33-p15-setup-from-a-turn.md)).
- **`spentHooks`** lists the ids of hooks that had already fired. The pool is
  rebuilt from the treatment and the lorebooks at session start, so a
  treatment's hook that fired before the chosen turn would otherwise be in the
  new pool fresh; the opening turn marks each one fired through the ordinary
  effect path. Ids are portable because every copy of a hook keeps its source's
  id ([15 §5.1](15-world.md)).

**What else carries rides on fields this section already had.** The party at
the turn is `cast.partyDefault`; the goal current at the turn is `goals[0]` and
the achieved ones are dropped; the unfired hooks this Setup or the session
authored are `hooks`, ids kept; and established facts, when kept, are a
companion lorebook in `lore`. An opening the wizard writes is a written opening,
and a session started from a Setup plays its primary one as an engine-written
first turn ([03 §6](03-data-model.md)). *(2026-10-03, at the merge that brought
this into `main`:)* **and plays it instead of the cast's greetings** in a mode
that would otherwise open on them — the owner's decision, recorded at
[03 §6](03-data-model.md) and [26 B18](26-open-questions.md). No field on the
turn says it was an opening: the branch added `Turn.opening` for that, and it
was dropped at the merge, because a turn with no `input` and no `request` is
already how the record says *nothing generated this*
([P15 §1.8](workplan/33-p15-setup-from-a-turn.md)).

**Channel state is not copied, and that is the rule.** Channel state is §1's
*free to move* tier and this object is its *stable* one, so a Setup carrying raw
channel values would freeze every engine channel's shape into a portable format
by accident. Only what has a host-owned meaning on a Setup crosses. Presence,
status and a dial's live value do not, and [P15 §1.2](workplan/33-p15-setup-from-a-turn.md)
names each.

**Distinct from a prologue package** ([26 B10](26-open-questions.md)), which is
a partly-played *session* in a package. The trade is the opposite one: the
history is condensed away and what travels is something that starts clean.

---

## 8. Preset — the prompt pack

**At `storyengine.preset/0`, and defined now despite the assembler being
unbuilt.** An earlier draft declined to define it at all, on the reasoning that
its shape depends on assembly design that does not exist yet. That reasoning was
right about the *detail* and wrong about the *decision*, for three reasons.

**It is portable, and §1's rule is not optional.** A preset moves between
installs. It is, empirically, the object this ecosystem trades most —
SillyTavern users swap presets far more readily than they swap cards. Leaving the
most-shared object as the only portable kind with no schema, no version and no
round-trip guarantee inverts the priority §1 sets out.

**Three decisions have delegated their enforcement here.**

| Decision | What it hands to this layer |
|---|---|
| Content rating is advisory ([§6.2](#62-contentrating-is-advisory--and-says-so)) | *"Where enforcement actually belongs is prompt packs and upstream system prompts"* |
| Difficulty is a sycophancy dial ([06 §7.3.1](06-modes-and-turn-pipeline.md)) | *"The levels live in the prompt pack, not in engine code"* |
| Model-behaviour patching ([02 §5](02-infinite-worlds.md)) | Sycophancy correction, agency-based evaluation |

Each is a good decision. Together they mean the layer three arguments rest on
cannot be the one layer left undefined — that is how a delegation becomes a hole.

**And the shape turned out to be knowable**, because SillyTavern's chat-completion
preset already contains most of it. §8.4 is the survey; it is the reason this
section could be written before the assembler exists, and several fields below
come directly from it rather than from first principles.

### 8.1 The two block kinds

The single structural decision, and the one the survey forced. **A preset's
blocks are of two kinds**, and an earlier sketch here wrongly had only the second:

- A **slot** positions content the *engine* supplies — the persona, the actor's
  sections, retrieved lore, channel state, history. The preset decides where it
  goes, what wraps it and what it costs. It does not author it.
- A **text block** is prose the *preset author* wrote. The main instruction, the
  style directive, the post-history push.

SillyTavern discovered this and did not name it: its `prompts[]` array holds
entries with `marker: true` (`chatHistory`, `worldInfoBefore`, `charDescription`,
`scenario`, `personaDescription`, `dialogueExamples`) alongside entries carrying
`content`. Those are slots and text blocks, in one list, distinguished by a
boolean. **The prompt manager is a block assembler whose blocks are called
prompts** — which is a strong independent confirmation of
[00 §2.1](00-stance.md)'s replacement for the mega-string, arrived at from the
other direction by the most-deployed project in the space.

Naming the two kinds explicitly is the improvement. A slot and a text block have
genuinely different fields — a slot has a source and a wrapper, a text block has
a template and an author — and collapsing them into one type with half the
fields inapplicable is what produces `marker: true` and the `content` field being
absent-but-meaningful.

### 8.2 The schema

```ts
interface Preset {
  schema: "storyengine.preset/0"
  id: string
  name: string
  blurb: string

  /** Which modes this is written for. Empty = mode-agnostic. Advisory: a
   *  preset for a mode you do not have still imports and still shows. */
  modes: ModeId[]

  /** Ordered. The unit the assembler consumes and the workbench displays —
   *  one entry here, one line in the block list. */
  blocks: PresetBlock[]

  budget: BudgetPolicy               // §8.3
  /** Sampling only. Never a model id, never a connection — [00 §3.2]. */
  params: GenerationParams

  /** Advisory model preference, resolved locally exactly as an actor's is
   *  ([§3](#3-shared-substructures)). This is where an imported preset's
   *  `openai_model` lands: expressible as a wish, never as a binding. */
  modelHint: ModelHint | null

  /** Named levels the mode's difficulty treatment resolves against
   *  ([06 §7.3.1](06-modes-and-turn-pipeline.md)). Omitted = the built-in
   *  pack. Supplied = this preset owns the meaning of "hard". */
  difficultyLevels?: DifficultyLevel[]

  /** Author-declared variables the templates interpolate, with defaults and
   *  help text. The Aventuras `CustomVariable` shape ([10 §6](10-ui-surfaces.md)). */
  variables: PresetVariable[]

  tags: string[]
  provenance: Provenance
  generated: Record<string, GeneratedFieldProvenance> | null
  /** Unrecognised fields from an import, verbatim — §8.4. */
  compat: Record<string, unknown> | null
  metadata: Record<string, unknown>
}

type PresetBlock = SlotBlock | TextBlock

interface BlockCommon {
  /** Stable, and addressable by modes, the workbench and later versions of
   *  this preset. Reordering must never break a reference. */
  id: string
  /** Author-facing. Never injected. */
  label: string
  role: "system" | "user" | "assistant"

  /** Present but off. Worth having as a real state: a disabled block is an
   *  author's note to themselves, and deleting it to try without it loses
   *  their work. Taken from ST's `prompt_order[].enabled`. */
  enabled: boolean

  /** Ordering constraints, never character offsets — [00 §2.1]. §8.3 covers
   *  the one position that needs more than this. */
  placement: Placement

  /** Budget priority. "Never trim" is a value here, never the absence of a
   *  budget — [00 §2.6]. */
  priority: number
  /** Which kinds of call this block applies to. Empty = all. This is what
   *  dissolves ST's eight special-cased template fields — §8.4.3. */
  appliesTo: CallKind[]
  /** Guidance-class blocks are refused by effect-producing calls. [06 §5.2] */
  advisory: boolean
  /** Drop the block rather than emit a heading with nothing under it. */
  omitWhenEmpty: boolean
}

/** Positions engine-supplied content. The preset chooses where and how it is
 *  framed; it never authors what goes in. */
interface SlotBlock extends BlockCommon {
  kind: "slot"
  /** What fills it. Closed vocabulary, extended by modes declaring channels. */
  source: SlotSource
  /** Optional wrapper, with `{{content}}` standing for the filled value.
   *  "Scenario: {{content}}" — this is exactly ST's `scenario_format` and
   *  `wi_format`, generalised from nine fixed fields to a property of any
   *  slot. Absent = emit the content bare. */
  wrapper?: string
}

type SlotSource =
  | { of: "persona" }
  | { of: "actor"; sectionId: string; scope?: "speaker" | "others" | "voiced" }     // "se.summary", "se.appearance", …
  /** Non-prose actor fields. `traits` is a real field rather than a Section
   *  ([§4](#4-actor)), so a slot cannot reach it through `sectionId` — and
   *  card import puts a legacy `personality` here ([03 §2.7](03-data-model.md)),
   *  which makes this the slot ST's `charPersonality` converts to. §8.4.1. */
  | { of: "actor"; field: "traits" | "visual"; scope?: "speaker" | "others" | "voiced" }
  /** `scope` on both actor arms and on `samples` — *added 2026-09-29, at
   *  [P14.2](workplan/31-p14-scene-and-session-import.md)*: on a call that
   *  speaks as a member, `speaker` narrows to them and `others` to the rest;
   *  the two partition the cast on every call, so on a call that speaks for
   *  nobody `speaker` is nobody and `others` everyone. A scope that matches
   *  nobody is recorded as `not-applicable`. On `samples` it narrows the actor
   *  carrier only — a Treatment or a Lorebook has no cast to scope.
   *  *`voiced` added 2026-09-29, at [P14.3](workplan/31-p14-scene-and-session-import.md)*:
   *  whoever the call writes as — the speaker under `per-actor` dispatch,
   *  everyone present under `merged` or on a narrator's call. It is what a
   *  card's own prompts and example dialogue need ([P14 §1.5]), and it is not
   *  a partition with the other two. */
  /** `outlet` since [P5.6](workplan/17-p5-implementation.md) (written in
   *  2026-10-01): an outlet a lore entry names, positioned by this slot —
   *  matched exactly; absent is the ordinary entries for the phase. */
  | { of: "lore"; phase: "before" | "after"; outlet?: string }
  | { of: "history" }
  /** Writing samples — §3.1, [14 §4](14-writing-samples.md). **Renamed from
   *  `examples`**, which named ST's `mes_example` rather than the thing it
   *  fills; free to rename because this schema is `/0` and no shipped preset
   *  positioned the old arm. `from` absent = every carrier, in the order
   *  treatment → lore → actor. */
  | { of: "samples"; from?: "actor" | "treatment" | "lore"; scope?: "speaker" | "others" | "voiced" }
  | { of: "channel"; channelId: ChannelId }
  /** ([P14.5a](workplan/31-p14-scene-and-session-import.md); written in
   *  2026-10-01.) What the story has established: every channel that declares
   *  itself established state, scoped values included, as one block — not one
   *  `channel` slot each, because a character tracker is a value per
   *  character. Added rather than substituted; an older build skips it. */
  | { of: "state" }
  | { of: "treatment"; part: "framing" | "tone" }
  /** *Added 2026-09-30.* A text answer the session was set up with —
   *  `mode.config[field]`, from the mode's wizard or the Setup it began from —
   *  named by the wizard field's id and read by the gather (§7's record field
   *  is opened for the pack that asks, never interpreted). Freeform slots its
   *  required premise here; before, no slot could name it and it reached no
   *  prompt. A widening of this closed union, recorded as one. */
  | { of: "setup"; field: string }
  | { of: "goal" }                          // [06 §7.3.3]
  /** ([P7.8](workplan/23-p7-implementation.md); written in 2026-10-01.) The two
   *  dials' prose: the engine resolves which level, and the slot says where
   *  its fragments go — one candidate per fragment, so a cap drops the
   *  lowest-ranked rather than cutting one. Two arms because the two are
   *  separable ([06 §7.3.2]); a preset with no levels fills them with nothing,
   *  and says why. */
  | { of: "difficulty" }
  | { of: "directedness" }
  /** The guidance slot. [06 §5.1] positions this one by preset explicitly; the
   *  producer is recorded on the block, not chosen by the slot. */
  | { of: "guidance" }
  /** The previous attempt a guided redo shows the model — the second advisory
   *  slot, [06 §5.1]. Filled from the server's record of the turn a submission
   *  names; which turn is recorded on the block. Forced advisory like
   *  `guidance`, and the one slot that wants a `wrapper`, since bare it is an
   *  unlabelled system message of prose the model itself wrote. */
  | { of: "attempt" }
  /** The player's current action — not `history`, which is turns that already
   *  happened. Every preset decides where it sits relative to the lore. */
  | { of: "input" }
  /** ([P8.1](workplan/25-p8-implementation.md); written in 2026-10-01.) The
   *  story above the history window, as a chain of summaries, one candidate
   *  per link — not a bigger `history`, which is the window's verbatim turns;
   *  the two never overlap. *(2026-10-03, at the
   *  [P15](workplan/33-p15-setup-from-a-turn.md) merge.)* Plus one more ahead
   *  of the links when the session started from a Setup that carried a story
   *  so far (§7.2): that root is emitted as its own candidate, recorded as
   *  `story-so-far` rather than `summary`, and is the first the slot gives up. */
  | { of: "summary" }
  // ~~(2026-09-30) Behind the schema: `summary`, `difficulty`, `directedness`
  // and `state` are arms of the shipped `SlotSource` this list never gained.~~
  // Written in 2026-10-01 (the audit's record, [main audit §4](workplan/32-main-audit.md)),
  // with lore's `outlet`, which it had not gained either.

// SlotSource is BlockSource ([22 §1.1](22-internal-contracts.md)) minus its ~~two~~
// three assembler-only origins — `preset`, because a preset's own prose *is* a
// TextBlock rather than a reference to one, and `step`, because a step's
// contribution did not exist when the preset was authored; and (corrected
// 2026-09-29, at P14.2) `round`, this turn's earlier speakers' replies, which
// the collector places after the input and no pack positions. One vocabulary, used
// from both ends: a slot names a source, the assembler fills it, and the block
// it produces records the same source back. *(2026-10-01)* **Five**, by the
// server's own derivation (`assembly/types.ts`): `note` (P14.3) and `continue`
// (P14.4) joined `preset`, `step` and `round`. And the correspondence is by
// meaning rather than by shape — a slot's `{ of }` is what its block records as
// `{ kind }`, except that both dial arms record one `difficulty` source whose
// `axis` says which, and `schema`, the engine's own JSON instruction, is
// recorded by no slot at all. *(2026-10-03, at the P15 merge)* And the other way
// round, one slot records two kinds: `summary` records the chain's root as
// `story-so-far` and its links as `summary` ([22 §1.1](22-internal-contracts.md)).

/** Prose the preset author wrote. */
interface TextBlock extends BlockCommon {
  kind: "text"
  /** Liquid, rendered within the block — never across blocks. [06 §5] */
  template: string
}

type Placement =
  | { at: "sequence" }                      // ordinary: position in `blocks`
  /** Inside the history run, counted from the newest message. The one thing
   *  ST does that a flat sequence cannot express, and the mechanism most
   *  modern presets depend on — §8.4.2. */
  | { at: "in-history"; fromEnd: number; tiebreak?: number }

/** Open. Modes declare their own kinds, and a preset written for a mode you do
 *  not have must still round-trip rather than failing validation on a string
 *  this build has not heard of. */
type CallKind =
  | "narrate" | "impersonate" | "continue" | "group-nudge"
  | "session-start" | "example" | "utility"
  | (string & {})
```

**Two unions were labelled extensible and defined closed** — this one and
`ActorRole` ([§4](#4-actor)). In TypeScript the comment was aspirational; in the
emitted JSON Schema it was a hard `enum`, which would have rejected a perfectly
good file from a newer build. Both are now genuinely open, and the rule
generalises: **a portable enum is a `string` with known values documented, not
an `enum`, unless the engine truly cannot proceed without understanding it.**

### 8.3 Budget, and the one placement that costs something

**`BudgetPolicy` is deliberately not a token count alone.** A preset written
against a 4k window must not silently misbehave at 200k — and ST's
`openai_max_context: 4095` sitting in a preset shared in 2026 is the concrete
form of that problem. So the policy expresses *shares and floors* against the
resolved window, with absolute values available where an author means them.

**`placement: "in-history"` is the expensive one, and it is worth paying.**
An ordinary block sits in the sequence and the budgeter treats history as one
unit. A block placed four messages from the end forces **history to be a
splittable source** rather than an atomic block: the assembler emits
`history[…-5]`, the block, then `history[-4…]`, and the budgeter has to trim a
run that now has something embedded in it.

Two reasons to accept the cost rather than refuse the placement:

- **It is not what [00 §2.1](00-stance.md) rejects.** That objection is to
  *character offsets into an assembled string* — "insert at index 4,182" — which
  is unrepresentable, unreviewable and breaks whenever anything upstream changes
  length. "After the Nth-newest message" is a **structural** position over a list
  the engine owns. It survives edits, branching and re-rendering, and it appears
  in the turn record as an ordinary ordered block.
- **Refusing it would drop most real presets on the floor.** Depth injection is
  how nearly every modern ST jailbreak and style directive works, precisely
  because recency dominates instruction-following. A converter that silently
  moved those blocks to the top would produce a preset that imports cleanly and
  behaves nothing like the original, which is the worst available outcome.

**`tiebreak` exists only because ST has it** (`injection_order`, default 100) and
two blocks can land at the same depth. Ours could have used sequence order; ST's
files carry an explicit number, so preserving it is free and dropping it would
reorder someone's prompt silently.

### 8.4 Converting a SillyTavern preset

The conversion path is worth designing *with* the schema rather than after it,
because ST presets are the largest body of authored prompt work in existence and
importing them badly is a worse outcome than not importing them.

The good news, established in §8.1: **the structural distance is small.** ST's
prompt manager is a block assembler. Most of the conversion is renaming.

#### 8.4.1 What maps cleanly

| SillyTavern | StoryEngine |
|---|---|
| `prompts[]` entry with `marker: true` | `SlotBlock`, per the identifier table below |
| `prompts[]` entry with `content` | `TextBlock`, `template` = content after macro conversion |
| `role` | `role`, unchanged |
| `prompt_order[].order[]` sequence | `blocks[]` order — a flat enabled list is the degenerate case of ordering constraints |
| `prompt_order[].order[].enabled` | `enabled` |
| `injection_position: RELATIVE` | `placement: { at: "sequence" }` |
| `injection_position: ABSOLUTE` + `injection_depth` | `placement: { at: "in-history", fromEnd }` — §8.3 |
| `injection_order` | `placement.tiebreak` |
| `injection_trigger[]` | `appliesTo` — ~~verbatim~~ *translated where there is a call (2026-09-27): `normal` → `narrate`, `continue` and `impersonate` as they are; `swipe`, `regenerate` and `quiet` ride through and never apply, which the review says* |
| `temperature`, `top_p`, `top_k`, `top_a`, `min_p`, `frequency_penalty`, `presence_penalty`, `repetition_penalty`, `seed`, `n`, `openai_max_tokens` | `params` |
| `openai_max_context` | `budget`, as a ceiling with a note that it was absolute |
| `openai_model` / `claude_model` / … | `modelHint.preferredModelIds` — a wish, never a binding ([§3](#3-shared-substructures)) |

The marker identifiers map one to one:

| ST identifier | `SlotSource` |
|---|---|
| `chatHistory` | `{ of: "history" }` |
| `worldInfoBefore` / `worldInfoAfter` | `{ of: "lore", phase }` |
| `charDescription` | `{ of: "actor", sectionId: "se.summary" }` |
| `charPersonality` | `{ of: "actor", field: "traits" }` — see below |
| `personaDescription` | `{ of: "persona" }` |
| `dialogueExamples` | ~~`{ of: "examples" }`~~ `{ of: "samples" }` — the arm was renamed when dialogue examples stopped being a `Section` ([§3.1](#31-writingsample)); corrected at P4.1 |
| `scenario` | `{ of: "treatment", part: "framing" }` |

The `scenario` row is the interesting one, and it is the same move
[03 §2.7](03-data-model.md) makes for card import: ST's scenario is per-character
text, ours is the treatment's framing, and routing it there is where it always
wanted to live.

**The `charPersonality` row is the one that has to agree with card import, and
an earlier draft got it wrong.** It pointed at `se.voice`, which reads sensibly
in isolation and is broken in practice: [03 §2.7](03-data-model.md) routes a
card's `personality` to `traits` + `summary`, so a converted preset and a
converted card from the *same* install would have produced a slot that resolves
to a section nothing ever wrote. Empty forever, and `omitWhenEmpty` would have
hidden it.

> **The rule this establishes:** the card importer and the preset importer
> convert opposite ends of one format and have to be checked *against each
> other*. Verified separately, both look right.

The check is cheap and belongs in the fixture suite
([testing §5](workplan/03-testing.md)): import a real ST directory, assemble one turn, and
assert that **no slot resolves empty**. It is the kind of failure that produces
silence rather than an error, which is exactly what a golden-file test is for.

#### 8.4.2 What is lossy, and how each loss is reported

Every item here lands in the import review step ([10 §5](10-ui-surfaces.md)) as a
named consequence, never as a silent drop.

- **Macros.** `{{char}}`, `{{user}}`, `{{persona}}`, `{{scenario}}` and friends
  become Liquid at import, per [00 §2.1](00-stance.md). A closed mapping table
  covers the common set; **an unrecognised macro is preserved verbatim and
  flagged**, because a mangled prompt that looks fine is worse than one that
  visibly needs a look. `{{charIfNotGroup}}` and similar conditionals become
  Liquid conditionals rather than being dropped. *Three corrections to the table
  as built, 2026-09-27, each read off SillyTavern's own source:* `{{persona}}`
  is the persona's **description** there, not its name, so it is refused as a
  body a slot supplies rather than mapped to `{{ user }}`; the legacy
  `<USER>`, `<BOT>`, `<CHAR>` and `<CHARIFNOTGROUP>` spellings, which it still
  resolves everywhere, convert as their curly forms in its files; and a format
  string's own placeholder (`{0}`, `{{scenario}}`, `{{personality}}`) is the
  content while its other macros convert like any template's, where every
  `{{…}}` had been taken for the content.
- **`system_prompt: true`** means *"came from the built-in set"*, not *"has the
  system role"* — a genuinely misleading field name. It carries no meaning here
  and drops.
- **`forbid_overrides`** governs whether a character card may override a prompt.
  Cards cannot override prompts at all ([00 §2.4](00-stance.md)), so it is moot
  and drops.
- **Per-character `prompt_order` entries.** ST keys orderings by
  `character_id`, with ~~`100000` and `100001` as dummy ids for the global and
  group defaults. Only the global order converts~~ ***`100001` as the order it
  sends and `100000` as the one before 1.10.0*** *(corrected 2026-09-27: the
  chat-completion prompt manager is configured with `dummyId: 100001`, so that
  is the order a generation reads and the toggles write; `100000` is the class
  default it overrides. `100001` converts, `100000` only for a file that has
  nothing else, and SillyTavern's own `Default.json` — which carries both, and
  no persona slot in `100000` — converts as SillyTavern sends it)*; a preset
  carrying genuinely per-character orders gets **one preset plus a warning
  naming the characters**, rather than a silent choice among them.
- **Instruct and context templates** are not converted at all
  ([00 §2.2](00-stance.md), [triage §6.1](workplan/02-triage.md)). They exist to serve raw
  completion, which is unsupported ([20 §5.5](20-tech-stack.md)).

  *Extended at [P4 §7.17](workplan/16-p4-implementation.md): they are now
  **recognised** as well as refused, and **recognising is not converting**.* The
  sentence above is unchanged and §8.4.5's *no instruct templates* still holds —
  what changed is the answer a person gets. Uploaded on its own, one of these
  used to fall off the end of the content probe and come back *"nothing here
  recognised this file"*, which is a confident wrong statement about a file the
  directory sweep reads by position one code path over. It is now named, with the
  reason nothing will come of it, so *not importable* does not read as *not
  implemented yet*.
- **Text-completion presets** convert to `params` only, and most of their fields
  ~~drop~~ **land in `compat`**: `dry_*`, `smoothing_*`, `mirostat_*`, `xtc_*`,
  `tfs`, `eta_cutoff`, `epsilon_cutoff`, `num_beams` and the rest are
  backend-specific sampler controls with no chat-API equivalent. *Corrected at
  P4.1:* this said "drop" while `GenerationParams`' own comment said `compat`,
  and the code comment wins — it is the reading consistent with §2's
  preservation rule and [00 §2.4](00-stance.md)'s *nothing is lost and re-export
  is possible*. Worth stating plainly in the review either way: *"this preset was
  mostly sampler settings for a local backend; 6 of 41 fields carried over."*
- **Reasoning presets** (`prefix`/`suffix`/`separator`) parse reasoning blocks
  out of output. Nothing at 1.0 consumes them; they ~~go to `compat`~~ **are
  recognised and skipped**.

  *Corrected at [P4 §7.17](workplan/16-p4-implementation.md), and it was a real
  disagreement rather than a wording slip.* `compat` is a field **on a converted
  object**, and nothing converts a reasoning preset — so there is no `Preset` for
  one to be `compat` on, and there never was. The sweep's own registry has said
  `skipped` about the `reasoning/` directory since P4.1, so the code and this
  line disagreed for three stages in a way nothing could catch. The upload arm
  now names the directory it must agree with and a test holds the two together,
  which is what stops the same question being answered twice again.
- **`sysprompt` presets** convert well and are the easy case: `content` becomes
  a `TextBlock` at the top, `post_history` a `TextBlock` after history.

#### 8.4.3 ~~Eight~~ **Nine** special-cased fields that become ordinary blocks

The most satisfying part of the conversion, and the strongest evidence that
`appliesTo` and `wrapper` are the right two fields rather than one field too
many. ST carries these as top-level preset settings, each with bespoke handling
in the assembler:

| ST field | Becomes |
|---|---|
| `wi_format` (`"{0}"`) | The lore slot's `wrapper` |
| `scenario_format` (`"{{scenario}}"`) | The treatment slot's `wrapper` |
| `personality_format` | The actor-section slot's `wrapper` |
| `group_nudge_prompt` | A `TextBlock`, `appliesTo: ["group-nudge"]` |
| `new_chat_prompt` | A `TextBlock`, `appliesTo: ["session-start"]` |
| `new_group_chat_prompt` | Same, group variant |
| `new_example_chat_prompt` | A `TextBlock`, `appliesTo: ["example"]` |
| `continue_nudge_prompt` | A `TextBlock`, `appliesTo: ["continue"]` |
| `impersonation_prompt` | A `TextBlock`, `appliesTo: ["impersonate"]` — the block behind [06 §3.1](06-modes-and-turn-pipeline.md) |

**Nine fixed fields collapse into two general properties**, and the result is
strictly more capable: an author can wrap *any* slot, and gate *any* block on
call kind, rather than being limited to the combinations someone anticipated.
This is [00 §2.7](00-stance.md)'s "per-mode reimplementation" argument appearing
in a smaller frame — each of those fields is the same idea implemented again
because there was no general mechanism.

It is also why they are worth converting rather than dropping: they are not
decoration. `continue_nudge_prompt` is why *continue* works at all.

#### 8.4.4 Credentials in shared presets — dropped, never offered

**The finding that most justifies [00 §3.2](00-stance.md), and it is not
hypothetical.** ST's chat-completion preset carries `reverse_proxy`,
`proxy_password`, `custom_url`, `custom_include_headers`, `azure_base_url`,
`azure_deployment_name`, `vertexai_express_project_id` and
`workers_ai_account_id` — a list ST itself maintains under the name
`sensitiveFields`.

ST handles it about as well as its data model allows: on both export and import
it detects those fields and offers to remove them. But the offer includes
**"Import as-is"**, and the default is a choice rather than a removal — so
**presets circulating in the wild can and do contain a working proxy password.**

**Our rule is not a prompt.** The importer drops every one of those fields
unconditionally, and the review step says which were present:

> *Removed 2 connection fields from this preset (`reverse_proxy`,
> `proxy_password`). Presets never carry connection settings —
> configure connections under Settings.*

Three things worth stating about why it is unconditional:

- **There is nowhere to put them.** `Preset` has no field that could hold an
  endpoint or a credential, so this is not a check that could be forgotten —
  it is the type refusing. That is exactly the structural enforcement
  [00 §3.2](00-stance.md) argues for, and ST is the counterexample that shows
  what the alternative costs: a runtime field list, two modal flows, and a
  correct outcome only if the user picks the right button.
- **The person importing is not the person at risk.** A leaked proxy password
  harms whoever *published* the preset — quite possibly someone who clicked
  "Import as-is" once and re-shared. Offering a choice here would be offering to
  help with something the user has no standing to decide.
- **Report it, do not merely drop it.** Silence would hide the fact that a
  circulating file contains someone's credential, which is worth someone
  knowing.

The same rule covers `custom_include_body` / `exclude_body` and any future
addition: **anything ST classifies as a connection field is discarded on sight**,
and the importer's list is derived from that category rather than enumerated
by hand.

#### 8.4.5 Round-tripping is not a goal

We import ST presets. We do not export them, and a converted preset is not
expected to reproduce ST's output token for token.

The honest reasons: the block model is strictly more expressive in some places
(wrappers on any slot, call-kind gating on any block) and deliberately narrower
in others (no character offsets, no instruct templates, no raw completion), so a
faithful reverse map does not exist. Promising round-trip fidelity would be
promising something that quietly fails.

**What is promised instead** is the thing that matters to somebody with forty
presets: the *authored prose survives intact*, the order is preserved,
depth-injected blocks stay at their depth, and everything that could not be
carried is named in the review rather than discovered later. That is the same
bargain [03 §2.7](03-data-model.md) strikes for character cards, and it is the
right one.

#### 8.4.6 What the review may say *before* it commits

**Added at [P4 §7.17](workplan/16-p4-implementation.md).** One hand-picked file
now gets a look before it lands ([10 §5](10-ui-surfaces.md), narrowed there).
Everything §8.4.2 lists as lossy is worth reading before pressing something
rather than after, and two rules govern what that screen may contain.

**It never renders a `compat` value — only the names.** This is what keeps a
preview from quietly becoming the *"import as-is"* affordance §8.4.4 refuses to
have anywhere: `compat` holds the source file's own unrecognised fields, so a
screen that showed its contents would show a proxy password to whoever was handed
the file. The converters strip credentials before the summary is built, so this
is belt as well as braces — and it is written down as a rule anyway, because the
property worth having is *no route carries a value here*, not *something upstream
was careful*. It was not, on two of three paths, until §7.17 fixed it.

**And it says which sampler settings are inert.** `GenerationParams` is the
portable subset an OpenAI-compatible endpoint *could* understand; what this build
actually puts on the wire is narrower, and the gap is five fields — `topK`,
`topA`, `minP`, `repetitionPenalty` and `n` — every one of which converts
faithfully from a SillyTavern preset, validates, is stored, is shown in the
editor, and never reaches a model. So §8.4.2's *"6 of 41 fields carried over"*
was true and misleading for three phases. `FORWARDED_SAMPLER_PARAMS` names the
narrower set, a test reads it off the outgoing request body rather than off the
adapter, and closing the gap is [polish §8](workplan/06-polish.md) rather than an
import change: it needs a provider-specific escape hatch, which is §8.5's third
open question.

### 8.5 What is committed at `/0`, and what is not

`/0` means what [§2](#2-versioning-and-compatibility) says: this will move. That
is better than leaving it undefined, which communicates the same instability
while also losing the round-trip guarantee, the `metadata` escape hatch and the
unknown-field preservation rule.

**Committed, and not expected to reverse:**

- **Two block kinds**, slot and text. §8.1's argument does not depend on
  anything unbuilt, and ST's independent arrival at the same split is strong
  evidence.
- **Ordering by constraint, never by character offset** — [00 §2.1](00-stance.md).
- **Every block budgeted and priced**, including the ones the author is sure
  matter — [00 §2.6](00-stance.md).
- **No production settings**, enforced by absence — [00 §3.2](00-stance.md),
  §8.4.4.
- **Stable block ids**, so a mode can reference a block, a workbench diff can
  line up across preset versions, and reordering is free.

**Genuinely unsettled, and why this is `/0`:** the `BudgetPolicy` vocabulary; the
`SlotSource` list, which will grow as modes declare channels; whether `params`
can stay a portable subset or needs a provider-specific escape hatch; and whether
`CallKind` is closed or extensible by modes. All four want the assembler to
exist.

**Prompt packs are where model-behaviour opinion belongs**, which is the point
of the three delegations above. This layer has a property engine code does not:
its effect is visible in the turn record ([03 §8](03-data-model.md)) as a block
with a source and a reason, rather than buried in a conditional. Someone who
dislikes how "hard" behaves can read the fragment that caused it and change it.

---

## 9. World — a named set, held by reference

***Renamed from Package at [P16.0](workplan/35-p16-world.md), 2026-10-10*** — on
branch `p16`. ~~*To be renamed World, at P16.0* — and this section keeps the name
the code and the files have until then.~~ The section was headed *Package — a
bundle, and nothing else* until then, and says World now because the code and
the files do. The owner decided on 2026-10-03 ([26 B17](26-open-questions.md))
that a World is the durable named set and **replaces Package**, and
[15](15-world.md) was rewritten against that on 2026-10-04: membership, transport
through [16](16-publish.md), and contribution to a session's lore through a
`world` arm on `LoreScope` (§5). **The kind is renamed, not joined**: the six
portable kinds stay six, the schema below is `storyengine.world/1` with the
Package's fields unchanged, and a reader keeps accepting `storyengine.package/1`
and upgrading it in memory, by §2's read-compatible rule applied to a rename
([P16 §1.1](workplan/35-p16-world.md)) — `upgradeLegacySchema` in
`shared/src/schema/world.ts`, applied at every door a stored or archived body
comes in through. A read never rewrites the file; the object's next write does. ~~**This step renames
nothing in the schema**; the rename is the phase's~~ *The design step of
2026-10-04 renamed nothing in the schema*; P16.0 renamed it, as a migration,
because installs hold Packages. **What P16.0 did not rename is the file**: the
export still writes P11.10's frozen `storyengine.package-export/1` as
`.sepack.json`, and [P16.3](workplan/35-p16-world.md) defines the World's format
once and reads that one beside it. [26 B16](26-open-questions.md) was the
deadline B17 gave the rename, and the rename shipped as the migration B17's note
of 2026-10-04 expected; the `world` arm still waits on B16.

With Setup carrying the game definition, the container was reduced to what it
always should have been: **an arbitrary bundle of portable objects, for moving
them between installs** — and the World keeps that and adds what
[15](15-world.md) gives it: a set a person names and keeps, sessions among its
members, and being read when a session starts in it. None of the three needs a
field the Package did not already have.

```ts
interface World {
  schema: "storyengine.world/1"   // "storyengine.package/1" until P16.0 — still read
  id: string
  name: string
  version: string
  description: string
  media: EmbeddedMedia[]

  /** Self-describing portable objects — each carries its own `schema`. The
   *  World does not enumerate kinds, which is exactly why it stays stable
   *  when a new kind appears (as Setup just did). */
  contents: PortableObject[]

  requires: {
    modes: { id: string; minVersion: string }[]
    extensions: { id: string; minVersion: string }[]
    capabilities: string[]
  }

  provenance: Provenance
  metadata: Record<string, unknown>
}

/** Open, not closed. The comment above says the container does not enumerate
 *  kinds; an earlier draft then enumerated them one line later, which meant an
 *  older reader would reject a container holding a kind it had never heard of
 *  — exactly the stranding [§2](#2-versioning-and-compatibility) forbids. */
type PortableObject =
  | Actor | Lorebook | Treatment | Setup | Preset
  | UnknownPortableObject

/** Any self-describing object this reader does not know. Preserved verbatim,
 *  round-tripped intact, shown in the import review as "1 object of an
 *  unrecognised kind (storyengine.campaign/1) — kept, not usable here".
 *  (2026-10-10, P16.3e: the World reader REPORTS one and does not keep it —
 *  the library has nowhere to keep an object of no kind, and a World names
 *  only what landed — `import.world.unknownKind`; the sender's review names
 *  such a member as left behind. "Kept" waits for a home to keep it in.) */
interface UnknownPortableObject {
  schema: string
  id: string
  name?: string
  [key: string]: unknown
}
```

**The container validates the envelope, never the payload kind.** A reader
checks that each entry has a `schema` and an `id`, resolves what it recognises
through the registry, and carries the rest through untouched. That is what makes
the World stable when a new kind appears, and it is the same rule as
[§2](#2-versioning-and-compatibility)'s unknown-field preservation applied one
level up.

**No `entry` field.** A World containing one or more Setups is startable, and
that is the whole mechanism — "start this" is "start that Setup". A World with
no Setup is a content drop, which is a perfectly good thing to share and had no
home before. *"Here are five characters and a lorebook"* is now expressible.

**It is stable now, and can be `/1`.** §1 marked it `/0` because it was
carrying a game definition nobody had tested. As a self-describing container it
has almost no surface of its own: new kinds do not change it, and the payload is
made of independently-versioned objects.

~~Contents are **embedded copies resolved on import**, not links~~ ***Corrected
2026-10-04: the stored form holds references, and only the file holds copies.***
The sentence described the wire and was read as describing the store, and the
code never did what it said. **A stored ~~Package's~~ World's `contents` is a list
of `{ schema, id, name }` envelopes** — `PortableObjectEnvelope` in
`shared/src/schema/world.ts` (`package.ts` until P16.0), so the "self-describing
portable objects" the sketch above promises are, on disk, references to them —
and they are **resolved against the library when the World is exported**:
`packaging/export.ts` reads each named object at that moment and writes it into
`storyengine.package-export/1` beside a manifest, reporting what no longer
resolves ([P11.10](workplan/28-p11-implementation.md)). So:

| | Holds | Because |
|---|---|---|
| **Stored** — `library/worlds/<slug>/world.json`; *`library/packages/<slug>/package.json` before [P16.0](workplan/35-p16-world.md), still read as a World, and moved to `worlds/` — under a fresh slug if a World already holds its own — by its first write* | references | the objects live in the library and are edited there; a container holding copies would be a second representation of each of them ([00 §2.8](00-stance.md)) |
| **Wire** — the exported file | the objects, each as stored — *since [P16.3](workplan/35-p16-world.md), the World file, `.seworld` ([§9.3](#93-the-world-file-manifest--what-a-seworld-says-it-carries)); P11.10's `.sepack.json` is still read* | a file naming ids is useless on the install it is sent to |

[15 §3.1](15-world.md) makes that distinction the World's, and it is unchanged by
the rename. **On import**, references inside the file resolve within it first,
then locally, then dangle visibly ([00 §3.3](00-stance.md)) — ~~*no build reads the
file yet*; [P16.3](workplan/35-p16-world.md) builds the reader, for the World's
format and the frozen package one~~ *the reader is built at
[P16.3e](workplan/35-p16-world.md) (2026-10-10), for the World file and the
frozen `.sepack.json` through one path; [16 §5.2](16-publish.md) records what it
decides*.
A malformed `requires` entry is dropped with the warning, never a block. `requires` is checked at import and produces a
clear warning with a degraded-start option rather than a hard block where
possible.

### 9.1 One action produces a package

A container is only as good as the thing that fills it, and filling one by hand
— find the treatment, find its three lorebooks, remember the actor whose own
lorebook the cast depends on, check nothing dangles — is exactly the work nobody
does. So **export-as-package is a single action on any library object**, and the
package is assembled by walking references.

**The closure is computed, then reviewed.** Starting from the exported object,
follow outbound references transitively and collect what they reach:

| From | Follows | Default |
|---|---|---|
| Treatment | `lore[]` where `required` ([§3](#3-shared-substructures)) | included, and cannot be silently dropped |
| Treatment | `lore[]` where not required | included, can be unchecked |
| Treatment | `cast[].ref` | included |
| Treatment | its bare `hooks[].involves[]` `Ref`s and `hooks[].introduces.actor` ([§6.1](#61-plothook), [§6.1a](#61a-a-character-as-a-hook)) | included |
| Actor | its bare lore `Ref[]` ([§4](#4-actor)) | included |
| Setup | `treatment`, and the closure above | included |
| Setup | its own `lore[]`, and `cast.personaOptions` / `partyDefault` / `narrator` | included |
| Setup | its own `hooks[]`, the same two fields | included |
| Setup | `preset` | included, can be unchecked — a preset is tuning, and some authors ship it while others would not |
| Lorebook | `hooks[].introduces.actor`, and its bare `hooks[].involves[]` `Ref`s with it | included |
| World | every member in `contents`, and each member's closure | included; each member individually uncheckable |
| World | every lorebook whose `scope` is `{ kind: 'world' }` naming it ([§5](#5-lorebook)), and each one's closure — *added 2026-10-10* | included, each individually uncheckable |
| Session (a World's member) | its `treatment`, its `lore[]` and its **played** cast — the persona, and `cast.actors` together with every actor the session's channels hold state for, the set a turn is played with (*corrected 2026-10-10*) — and their closures; **the actors its hook pool names** — each pooled hook's bare `involves[]` `Ref`s and its `introduces.actor`, ~~for a hook not yet fired~~ fired or not (*added, then corrected, 2026-10-10*); the session itself as its session export | the session **excluded until ticked**; never a sibling session |

***The last two rows were added 2026-10-04, with [16](16-publish.md)***, for the
kinds [15](15-world.md) puts in a set. A World is a list of starting points, so its
closure is the union of theirs, and *uncheckable per member* is where the set kept
and the file sent are allowed to differ. A session's own copies — its Setup, its
preset, its hook pool and its goals, the `setup`, `preset`, `hooks` and `goals`
fields of `SessionFile` — are inside its session export already
([P11.10](workplan/28-p11-implementation.md)) and need no walk; session-local
actors ([03 §2.3](03-data-model.md)) are designed but not on `SessionFile`
([03 §8](03-data-model.md)), so there is nothing of theirs to carry or walk. What it names in
the library does. **Its exclusion is the row's point**: the closure reaches what a
session names and stops, and never pulls in the other sessions of the same World,
because *this story* and *my six stories* are different things to send. Sessions
default to unticked for [16 §5](16-publish.md)'s reason — sending somebody your
transcripts is a thing to choose.

***Two edges added 2026-10-10, by the owner's answers at
[P16.3](workplan/35-p16-world.md)'s plan.*** **A World reaches the books scoped to
it.** P16.2 built `LoreScope`'s `world` arm, which offers a book to every session
started in a World it names — and that is an *inbound* link, from the book to the
World, which a walk that follows only outbound references never sees. Without the
row, a World published and imported would start sessions with fewer books than
it starts with here, which is the set failing to travel. The row is a query, not
an edge any field holds, and it is the only one in this table; it is included by
default because the book's author said the book belongs with the World, and
uncheckable because the person sending is the one who decides. **A ticked
session reaches the actors its hooks name.** The paragraph above is right that a
session's hook pool is a *copy*, carried inside its session export and needing no
walk — but the copy's `Ref`s point out of it, at actors in the library, for the
same reason the Treatment and Setup hook rows exist: a pooled arrival whose
subject did not come along lands as *"an arrival with nobody to arrive"*, retired
quietly on the other side. ~~A fired arrival's subject has arrived already and is in
the cast, which the row reaches anyway.~~ *(Corrected the same day, at
[P16.3b](workplan/35-p16-world.md), whose review found it false: a fired
arrival's subject is in the cast a turn is **played** with, but not in
`cast.actors` — firing writes only the hook's channel, and an arrived character
joins the played cast through its channel state (`resolveCast`). So the row reads
"its cast" as the played cast, and follows every pooled arrival's subject, fired
or not; an arrived character no longer drops out of a published session or out
of its own* Used by.*)*

Every level is shown, not just the first: the actor two steps out whose lorebook
came along is named in the review, because "why is this package 40 MB" should be
answerable before the file exists rather than after.

***The three hook rows were written 2026-09-22, and they were owed since P7.***
[P7 §1.5](workplan/23-p7-implementation.md) says this document *can, and must*
carry them once `introduces` lands, and states the reason better than a new
sentence would: *"a walker built later against the table as it stands is
precisely the 'only follows `cast`' walker the row exists to fail."*
`introduces` landed at P7.5 and the rows did not, so the table has spent every
phase since describing a closure that stops at `cast`, `lore` and `preset`. **The only
reason that has cost nothing is that the walker does not exist either** —
`packaging/export.ts` resolves exactly one level, the `contents[]` a World
(a package, when this was written) already declares — which means the omission was never going to be found by a bug
report. It was going to be found by somebody building the walker correctly
against a table that was wrong.

***Both are **bare** `Ref`s and the rows say so, which is the distinction this
table is careful about everywhere else.*** `Treatment | cast[].ref` is written
with the wrapper because a `CastEntry` wraps one, and the Actor row says *bare*
out loud for the same reason. `PlotHook.involves` is `Type.Array(Ref)` and
`Introduction.actor` is a `Ref` — neither has a `.ref` — so a walker built
against a row spelling `hooks[].involves[].ref` would resolve `undefined` on
every element and drop every `involves` edge **silently**, while
`introduces.actor` beside it worked. That is the failure quoted above arriving
through the row written to prevent it, which is why the spelling is worth a
paragraph. *(Corrected 2026-09-22; the server's own `hookActorIds` had it right,
which is the harder direction to notice from.)*

**Both hook fields, because they point for opposite reasons and an export needs
them for the same one.** `involves` is the eligibility test —
[03 §4.1](03-data-model.md) retires a hook whose cast is gone, quietly and by
design — and `introduces.actor` is the hook's subject, eligible only while that
actor is *not* yet present. A package that dropped the first arrives with hooks
that are silently ineligible; one that dropped the second arrives with an arrival
and nobody to arrive. Both are this section's opening complaint exactly —
*remember the actor whose own lorebook the cast depends on, check nothing
dangles* — reached through the one field nobody thinks of as a link.

**The Lorebook row is the first time a lorebook follows anything at all**, and
that is worth a sentence because the previous answer was categorical rather than
accidental. Its entries are inside it, its folders are inside it, and the nearest
thing it has ever had to an outward pointer is `LoreEntry.actorFilter`
([§5](#5-lorebook)) — a list of bare strings matched against whoever is in the
session, which is a filter and not a reference to a library object.
`introduces.actor` is a `Ref` ([§3](#3-shared-substructures)), and
[26 C7d](26-open-questions.md) allowed it onto lorebook-carried hooks knowing
exactly that, *"over the objection that it makes a Lorebook depend on an Actor
for the first time"*, on the ground that **the dependency is soft**: *"an
unresolvable subject breaks the hook, never the book."* That is why the row is an
ordinary *included* and not the warned case a `required` lore link is — the
recipient who unchecks it gets a world that reads and one hook that sits
ineligible with a clause the panel can state ([10 §10.1](10-ui-surfaces.md)),
rather than a book missing its content.

**Review, for the same reason import is a review step** ([10 §5](10-ui-surfaces.md)).
Unchecking a `required` link is permitted and warned about, since `required`
describes the author's intent and never blocks ([00 §3.3](00-stance.md)) — but
it is the one case where the export says plainly that the recipient will be
missing the world, not a nice extra.

**`requires` is derived where it can be.** A Setup names a concrete mode, so
`requires.modes` is populated from it rather than typed by hand; extension and
capability requirements come from what the collected objects actually reference.
An author can add to the list and should rarely need to.

**This is what makes the object split free at exchange time.** A Treatment stays
independent of any one lorebook ([03 §4](03-data-model.md)) and is nonetheless
shareable as a self-contained artefact, because the bundled form is *produced on
demand* rather than being the storage shape. The recurring pull toward folding
world content and framing into one file is, at bottom, a request for this
button.

~~**Exporting produces a file, not a library object.** A package is a snapshot of a
closure at one moment, and auto-saving one on every export would fill the library
with near-identical bundles nobody chose to keep. Keeping the package — as a
re-exportable object that remembers its closure and picks up later edits — is a
separate, explicit *Save this package* action.~~ ***Reversed 2026-10-04, by
[16 §3](16-publish.md):*** publishing a selection of two or more keeps a World,
because the worry was true of a snapshot and is not true of a set — a World holds
references, so publishing it twice produces two files and one object. One object
published keeps nothing ([16 §2](16-publish.md)). A file with no World
kept is still offered, as a choice in the review, for *send this and forget it*.

~~**[OPEN]** Whether a saved package re-resolves its closure on re-export or
replays the exact contents it was built with. The first keeps a shared campaign
current; the second is the only one that reproduces a byte-identical artefact,
which matters if packages are ever addressed by hash. Lean: re-resolve, and show
the diff.~~ ***Closed 2026-10-04: it re-resolves, and the code answered first.***
A World holds references and the objects are edited in place, so it cannot
replay anything; the published file is the frozen image. `packaging/export.ts`
has read every named object at export time since
[P11.10](workplan/28-p11-implementation.md), so the lean was the shipped
behaviour before it was the design. *Show the diff* is [16 §5](16-publish.md)'s:
re-publishing opens on what changed. Addressing by hash, if it ever arrives,
addresses the file.

---

## 9.2 The backup manifest — what an archive says it is

*Added at [P12.2](workplan/29-p12-implementation.md).* `backup.json`, the first
member of every backup archive, carrying
`schema: "storyengine.backup-manifest/1"`.

```ts
interface BackupManifest {
  schema: "storyengine.backup-manifest/1"
  scope: "install" | "account"
  handle: string | null           // the account, for an account archive
  contents: "full" | "redacted"   // whether it carries credentials
  takenBy: { version: string | null; at: string }
  reason: "manual" | "schedule" | "start"
  files: number
  unpackedBytes: number           // so a restore can size a disk before committing
  handles: string[]               // so an install import can plan per account
  omitted: ImportNote[]           // what this archive does not carry, and why
}
```

**Here rather than in [22](22-internal-contracts.md) because it travels.** That
document's header states that nothing in it carries a `schema` field or a
version number; this does both, for the reason every portable record does — an
archive written by one install is read by another, and possibly by an older one.

***It is deliberately not in `PORTABLE_SCHEMAS`***, and neither is
`storyengine.session-export/1`. That registry holds the six library kinds and
`emit-schemas` writes one JSON Schema artefact per entry; an envelope is not an
object somebody edits, and shipping a schema for it would suggest it were.

**First member, so a reader can answer *what am I holding* without inflating the
rest.** A listing, an import preview and a restore's free-disk check all need
that before they need the bytes — and `unpackedBytes` is here precisely because
the only other way to know it is to inflate the archive, which is the thing
being checked for room.

***`omitted` is `{ key, params }` rather than prose***, the vocabulary the
import review uses and `export/writers.ts` already answers *what this file does
not carry* in. A person handed a redacted archive should be able to read what
was left out of it rather than discover it during a restore — and a file whose
path no tar header can name is reported here at `warn` rather than failing the
whole archive, because all-or-nothing is the right failure for a restore and the
wrong one for a backup.

**It carries no path from the machine that wrote it.**
[22 §4.1](22-internal-contracts.md)'s rule about logs applies with more force to
a file that travels.

---

## 9.3 The World file manifest — what a `.seworld` says it carries

*Added at [P16.3c](workplan/35-p16-world.md), read at
[P16.3e](workplan/35-p16-world.md).* `storyengine-world.json`, written as the
first member of every World file — a stored zip of the members' own folders,
[16 §5.2](16-publish.md)'s decision — carrying
`schema: "storyengine.world-file/1"`.

```ts
interface WorldFileManifest {
  schema: "storyengine.world-file/1"
  exportedBy: { version: string | null; at: string }   // a header, never a gate
  origin: "object" | "selection" | "world"
  world: (WorldFileObject & { description: string }) | null  // null: one object, or a snapshot
  objects: WorldFileObject[]        // members first, then what the walk brought
  sessions: WorldFileSession[]
  leftBehind: LeftBehind[]          // what a carried thing names and the file does not hold
  requires: World["requires"]       // the World's own, joined with what the closure needs
  history: boolean
  omitted: ImportNote[]             // a picture or a session too large, damaged, unreadable
}
interface WorldFileObject {
  schema: string; id: string; name: string
  folder: string                    // library/<kind-dir>/<folder>/ inside the zip
  file: string                      // its stored file's name there
  contentHash: string               // sha256 of those bytes, in this zip
  member: boolean                   // named by the World, or brought by the walk
}
interface WorldFileSession {
  id: string; name: string; folder: string   // sessions/<id>/
  turns: number; headTurnId: string | null
  pictures: number; attachments: number; mode: string | null
}
```

**Here for §9.2's reason**: it travels, so it has a schema and a version, and it
is not in `PORTABLE_SCHEMAS` — an envelope is not an object somebody edits.

- **The layout mirrors `data/`**: `library/<kind-dir>/<folder>/` holds an
  object's stored file byte for byte, its pictures under `assets/` — only those
  its media rows name — and, when asked for, `history/`; `sessions/<id>/` holds
  the session's export and its pictures and attachments. A person who knows the
  data directory can read the file.
- **The manifest is the integrity check.** Each object's `contentHash` is checked
  on arrival and a mismatch refuses that object alone; a picture is checked
  against its `sha256` name. The zip's CRCs are parsed and enforced nowhere, as
  for every other archive this reads.
- **A reader holds the file to its manifest before it writes**: a member named
  twice, a file or id listed twice, a row whose id is not its body's, or a
  manifest of another schema or a later version is refused whole, and nothing
  lands. The manifest is written first, and *found* anywhere — a re-zipped World
  file is still a World file.
- **What is never in it**: the index, a connection, an orphan picture, an
  unticked session or any trace of one, an object play wrote, an absolute path.

## 10. Not defined here, deliberately

| Structure | Why not |
|---|---|
| **Session, Turn record** | Internal. Never leaves the install, so free to migrate — and the assembler will churn. Defined in [22](22-internal-contracts.md), because *free to move* is not the same as *need not exist* when P2 has to write one. |
| **Channel definitions and state** | Owned by modes and extensions, versioned with them ([26 B7](26-open-questions.md)). Shape in [22 §1.3](22-internal-contracts.md). |
| **Rule vocabulary** (`Predicate`, `Effect`) | Deferred to 6.0, the authoring tier ([work plan §0.6](workplan/01-work-plan.md)). Now blocks nothing: the fields that depended on it are gone from §6.1 and §7.1, and both return additively. |
| **Connection** | Private, local, never exported. Free to change. |
| **Account** | Internal. |
| **Backup settings** (`users/<handle>/backup.json`) | Internal, and never in an archive's manifest: a schedule is a fact about *this* install's disk, not about the data. [P12.4](workplan/29-p12-implementation.md). |

---

## 11. Open

- **[OPEN]** ~~Embedded-media size cap~~ **Embedded-media size *indicator***
  ([03 §5.2.2](03-data-model.md)), *restated 2026-09-14 to match the split made
  there*: the editor showing the number is the requirement, and a cap — schema
  `maxBytes` hint or a policy at write time — is the separate and weaker
  question. Neither is owned by a phase; the indicator is deferred with a stated
  condition rather than a date ([P11 §0.1](workplan/28-p11-implementation.md)).
- **[OPEN]** Whether `Openings.seeds` should record the expanded result when a
  user accepts one, or leave that entirely to the session
  ([26 B9](26-open-questions.md)).

**Two entries removed as already answered**, and both had drifted into
contradicting their own resolutions:

- *Whether `ActorProfile`'s prose fields stay fixed.* Decided in
  [03 §2.1](03-data-model.md): **there are no fixed prose fields**, all prose is
  `Section`s and four are conventional. The entry claimed committing to §4 would
  close it "in favour of fixed", which is the opposite of what §4 now says.
- *Whether `Treatment` owns a primary lorebook.* Decided in
  [§6](#6-treatment): **a Treatment owns no lorebook, it only links** — which is what
  allows many treatments over one world and removes the ownership-on-delete
  question.
