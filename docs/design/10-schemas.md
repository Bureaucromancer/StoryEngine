# 10 — Proposed schemas

**Status: proposal, but the tightest one here.** These are the structures worth
agreeing before code, because other people's data ends up in them.

Written as TypeScript for readability. The implementation derives these from
TypeBox, and **the published artifact is JSON Schema**
([07 §4](07-tech-stack.md)) — third-party tools need a schema they can validate
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
| **Stable** | Actor, Lorebook, Treatment, Setup, Package, and the shared substructures in §3 | Define now, change only additively, version on breakage |
| **Provisional** | Preset (§8) | Portable, so it needs a schema — but at `/0`, which says the shape will move |
| **Free to move** | Session, Turn record, Channel state, rule vocabulary | Internal. Migrate at will |

**Preset moved out of the internal tier**, where an earlier draft had it, on the
grounds that it plainly fails this section's own test: a preset travels between
installs — it is the object this ecosystem trades most — so calling it internal
was a contradiction with [02 §1](02-data-model.md), which lists it as portable.
§8 works through the consequences.

**Package used to be a prototype exception and no longer is.** It was marked
unstable because it carried a game definition — an `entry` block naming a mode,
a treatment and a cast — that nobody had tested against real authored content.
Splitting that out into Setup (§7) leaves Package as a self-describing container
(§8) with almost no surface of its own: it does not enumerate the kinds it
holds, so a new portable kind does not change it. What was genuinely unstable was
the game definition, and that is now a normal object versioned like the rest.

The asymmetry that justified the exception still holds and is worth keeping in
mind: **breaking a container costs a re-export; breaking an Actor costs somebody's
character.**

**Turn records are internal despite being large and valuable.** They never leave
the install, so they can churn freely — which matters, because the assembler
will churn. With one horizon worth knowing: session export is wanted eventually
([06 B12](06-open-questions.md)), and when it ships the turn record becomes a
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
 *  source disclosed. Keyed by dotted path in `generated`. [05 §11.2] */
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
 *  a written opening is content, a seed is an instruction. [02 §6] */
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
   *  lineage is visible. [02 §6] */
  fromSeedId?: string
}

/** Normalised 0..1 rectangle of a source image. Normalised rather than pixels
 *  so it survives the source being resized or re-encoded. [05 §11.3] */
interface SourceRect {
  x: number; y: number; width: number; height: number
}

/** Structured appearance for image and video pipelines. Prose `appearance` is
 *  for the narrator; this is for machines. [02 §2.1] */
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
 *  likeness. [02 §5.2.2] */
type MediaRole =
  | "portrait-source"   // the uncropped original behind the card's own pixels
  | "reference"         // canonical likeness — of a person, or of a place
  | "expression"
  | "pose"
  | "style"             // style exemplar, not likeness
  | "map"               // a diagram rather than a likeness. Lore, mostly
  | "gallery"

// One vocabulary, not one per kind. `reference` means the same thing on a
// lorebook entry as on an actor — *this is what it looks like*, suitable for
// conditioning generation — which is what lets a later feature treat a
// location's reference image the way it already treats an actor's
// ([14 §3](14-roadmap.md)). `map` is the only addition lore needed, because a
// diagram is genuinely not a likeness. `illustration` was considered and
// rejected as a synonym for `reference` that would leave authors guessing.

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
   *  ([02 §5.2](02-data-model.md)). */
  ref: string
  label?: string
  /** Arbitrary, author-defined: "winter", "aerial", "concept art", "before the
   *  fire", "by Mireille". The counterpart to `role`, and the division of
   *  labour is the same one `ActorRole` and `Actor.tags` already make
   *  ([02 §2.2](02-data-model.md)):
   *
   *    role — closed union. The engine reads it and acts on it.
   *    tags — open. Nothing in the engine branches on them.
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
 *  that folder — never absolute, never escaping it. [02 §5.3] */
interface AssetRef {
  path: string
  role: MediaRole
  label?: string
}

/** A preference, never a binding. An imported card may express what it wants;
 *  it can never repoint anyone's provider. Resolution is local. [02 §2.6] */
interface ModelHint {
  role: "prose" | "fast" | "reasoning" | "vision"
  preferredModelIds?: string[]
  note?: string
}
```

### 3.1 WritingSample

Prose offered as an exemplar — *show, do not tell*. Carried by Actor, Lorebook
and Treatment; the full argument is [18](18-writing-samples.md).

The rest of this design describes style: `tone.styleNotes` says "terse,
hardboiled", `se.voice` is register and verbal tics and is explicit that it is
not what somebody sounds like. This is the field that *demonstrates* it — a
passage from the setting, pasted whole. The precedent is [20 §5](20-authoring.md),
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
most likely to invite the first — [18 §5](18-writing-samples.md) states the
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
   *  controls what pickers offer first. [02 §2.2] */
  roles: ActorRole[]
  /** "npc" lives here. Nothing in the engine branches on it. */
  tags: string[]

  profile: ActorProfile
  openings: Openings
  /** Prose written *as* this person, offered as an exemplar — §3.1.
   *  Top-level rather than under `profile`, and beside `openings`: the profile
   *  is what somebody is like, while a sample demonstrates how they are
   *  written, which [20 §5](20-authoring.md) classes as production. */
  writingSamples?: WritingSample[]
  lore: Ref[]                      // linked lorebooks, not embedded

  media: EmbeddedMedia[]           // travels inside the card
  assets: AssetRef[]               // bulk, travels with the folder
  /** Crop applied to produce the card's own pixels. The source is retained in
   *  `media` with role "portrait-source", so re-cropping is lossless. */
  portraitCrop: SourceRect | null

  modelHint: ModelHint | null
  /** Namespaced by owning mode or extension. A mode may only read its own key;
   *  unknown keys survive round trips untouched. [02 §2.4] */
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
> are now `writingSamples` ([§3.1](#31-writingsample), [18](18-writing-samples.md)).
> The reasoning that put them in a Section is unchanged and still holds — the
> card declares no assembly, and a sample is still positioned and budgeted by a
> preset slot. What failed was the container: a `Section` has no `priority`, and
> [00 §2.6](00-stance.md) requires every block to carry one, so a sample in a
> Section could not participate in the rule the budgeter is built on.

---

## 5. Lorebook

Entry activation is taken from Marinara close to unchanged, because it is a
decade of empirical tuning and it is the interchange format
([02 §3](02-data-model.md)). The changes are ~~four~~ **five**, all scoped —
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
   *  this lorebook is active. Treatments remain the primary home. [02 §4.1] */
  hooks?: PlotHook[]
  entries: LoreEntry[]
  /** Prose from this world, offered as an exemplar — §3.1. Book-scoped rather
   *  than on an entry: an exemplar that appears only when somebody says a magic
   *  word is not an exemplar. Overrides [16 §4](16-lorebooks-as-a-format.md)'s
   *  refusal of new fields; the reasoning is [18 §6.2](18-writing-samples.md). */
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
  /** Bulk, in the folder rather than the manifest. Parity with Actor. [02 §5.3] */
  assets: AssetRef[]
  provenance: Provenance
  generated: Record<string, GeneratedFieldProvenance> | null
  metadata: Record<string, unknown>
}

/** One mechanism, three behaviours, mutual exclusion by construction. Replaces
 *  characterId + characterIds + personaId + personaIds + chatId + isGlobal +
 *  scope, and the save-time rule that kept them consistent. [02 §3.4] */
/** Portable scopes only. `global` and `linked` travel — an actor id is portable
 *  and resolves or dangles like any other Ref ([00 §3.3](00-stance.md)). */
type LoreScope =
  | { kind: "global" }
  | { kind: "linked"; actorIds: string[] }    // personas are actors

// Session scoping is NOT here. Session ids are install-local, so a shared
// lorebook carrying them exports identifiers that are meaningless everywhere
// else — noise on import at best, and a false resolution against an unrelated
// local session at worst. "This lorebook applies to this session" is a fact
// about the *session*, so it lives on the session's own lore links
// ([02 §8](02-data-model.md)), pointing outward at the lorebook rather than the
// lorebook pointing inward at the session.

// And as of [P5.7]'s reversal, that outward-pointing link is the ONLY way a
// lorebook reaches a session: `session.lore`, or the treatment the session
// names. NOTHING READS THIS FIELD. It is carried, exported and preserved on
// import because it is part of the format; it selects nothing, because a field
// on a library object opting itself into somebody's story put every book a
// person owned into every prompt — `global` being both this schema's factory
// default and the SillyTavern importer's fallback ([02 §3.4]).
//
// Two questions left open rather than settled, in [06](06-open-questions.md):
// §B14, may `scope` narrow a book the session already chose; and §B15, what a
// new book's scope should default to. [19 §5.3](19-world.md) is where a
// consumer would come from — inheritance, designed, not inferred from the
// union's wording.

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
   *  built in stays a flat field above. [02 §3.1] */
  extensionActivations?: { by: string; config: unknown }[]

  /** If this entry tracks state, its shape. The *values* live in a session
   *  channel keyed by entry id — never here, because an exported lorebook must
   *  not carry somebody's playthrough. [02 §3.3] */
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
predicates; the rest become channels ([02 §3.3](02-data-model.md)).


**Also absent: `category`.** An earlier draft carried Marinara's five-value
book-level union — `world`, `character`, `npc`, `spellbook`, `uncategorized` —
described as organisational only and explicitly not affecting activation. It is
removed rather than renamed, and the reasons compound:

- **It argued against itself.** [02 §3.4](02-data-model.md) rejects closed
  vocabularies one paragraph earlier — *"Aventuras' closed `EntryType` union is
  the one with the ceiling. Take Marinara's shape"* — and then kept a closed
  union at book level. `LoreEntry.tag` is free text for exactly this reason.
- **The values were not one axis.** `world`, `character` and `npc` are subject
  matter; `spellbook` is one genre's artefact; `uncategorized` is a null wearing
  a value's clothes.
- **`character` and `npc` as separate values contradict the actor model.**
  Persona and NPC are flags on a single Actor kind ([02 §2.2](02-data-model.md)),
  and two book categories for one actor concept re-import the split that
  unification removed.
- **`tags` already does the job**, openly, and is what the library's filters
  read.

The trigger was the collision — `category: "world"` alongside a reserved World
concept ([19](19-world.md)) — but the collision only made the field worth
reopening. What was found on reopening is why it is gone rather than renamed.

### 5.1 Images on lore

New territory rather than a port: Marinara carries one `imagePath` per book for
the library card and nothing per entry, and SillyTavern's World Info has no
images at all. Reasoning in [02 §3.6](02-data-model.md); the shape is two
`EmbeddedMedia[]` fields, one on the book and one on the entry, both resolving
into the object's folder.

**Nothing in the engine reads them at 1.0**, and the `⚠` on `LoreEntry.media` is
the load-bearing part of this addition rather than a caution. What makes it worth
adding now anyway is that **typed roles cannot be retrofitted**
([02 §5.2.2](02-data-model.md)) — the same argument made for cards, unchanged.
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
said. The panel that spends `primaryMediaId` is [05 §5.3](05-ui-surfaces.md).

The intended first real consumer is rendition conditioning
([14 §3](14-roadmap.md)): a location's `reference` image is the same shape of
input to *illustrate this scene* that an actor's already is
([03 §10.3](03-modes-and-turn-pipeline.md)). That is why `reference` carries the
same meaning across both kinds rather than lore getting a vocabulary of its own.

### 5.2 Entry-level exchange

Entries import and export independently of the book they live in, as a routine
editor action rather than a special case ([05 §11.2c](05-ui-surfaces.md)). The
schema pays nothing for it, which is most of the argument for doing it this way.

- **The exchange file is a `Lorebook`.** `entries` holds the selection, `folders`
  holds the ancestors of those entries, and everything else is an ordinary book.
  A `LoreEntry[]` fragment format was considered and rejected: it saves a handful
  of book-level fields and gives up the one property that makes this schema worth
  taking close to unchanged ([02 §3](02-data-model.md)) — that every tool in the
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
  only when asked — is at [05 §11.2c](05-ui-surfaces.md).
- **Nothing session-scoped travels, because nothing session-scoped is present.**
  `stateSchema` is a declaration and belongs to the entry; the values live in a
  channel keyed by entry id ([02 §3.3](02-data-model.md)) and are not in the book
  to leak.

Container rules are unchanged and are the book's: JSON where the selection
carries no media, the zip form where it does ([02 §5.2.3](02-data-model.md)).

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
> **`World` is now reserved** for the 3.0 continuity container over sessions
> ([19](19-world.md)) and is deliberately not spent on a library label.

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
   *  §6.1b, [03 §10.6]. */
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
section on ([02 §4](02-data-model.md)).

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
hook is a Y looking for its moment ([02 §4.1](02-data-model.md)).

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
both belonged to the authored-rule vocabulary. That vocabulary is now 5.0
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
severe failure [02 §4.1](02-data-model.md) exists to name. So the predicate is
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

**Lorebooks may carry these too, with one cost stated.** [02 §4.1](02-data-model.md)'s
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
[03 §6.1](03-modes-and-turn-pipeline.md). What is settled *here* is only where the
value may be written down, and the answer is the shape `openings` already uses:
**a Treatment proposes, a Setup overrides, and the running session owns it.**

**A Treatment may carry it, which is not obvious and is worth the sentence.**
Pacing looks like a property of a game rather than of a reading of a world, which
would put it on Setup alone. But a treatment is where hooks primarily live
([02 §4.1](02-data-model.md)), and *this material wants to be sparse* is a real
authorial intent that would otherwise be lost the moment somebody builds a Setup
over it. `modeHints` (§6) is the precedent for an advisory-only field there, and
the channel that carries the live value already has a *from treatment* init arm
([03 §4](03-modes-and-turn-pipeline.md)) — so the mechanism exists and declining
to use it would be the arbitrary choice.

**Optional on both, because a required field added to a published `/1` is a `/2`
change** ([§2](#2-versioning-and-compatibility)). Absent means unspecified, which
the session resolves to its own default; it does not mean `normal`.

**Not a production setting**, and it does not become one by being live: it says
how much authored plot should be pushed at a player, which is authorial, and it
has nowhere to put an endpoint or a key ([00 §3.2](00-stance.md)).

#### `stagingNotes` is the second field this argument covers

Added when [03 §10.6](03-modes-and-turn-pipeline.md) needed a way for a treatment
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
([03 §6.1](03-modes-and-turn-pipeline.md) puts the numbers in engine code and the
words in the pack), while this one only ever reaches a model. There is nothing
for the engine to do with it, so there is nothing to enumerate.

### 6.2 `contentRating` is advisory — and says so

Settled in [06 E8](06-open-questions.md), recorded here because it constrains
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
([02 §8](02-data-model.md)) rather than buried in engine logic.

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
    partyDefault: Ref[]            // [03 §8] — the party always contains the persona
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

**Sessions are created from a Setup by copy**, per prefill-not-binding
([00 §3.1](00-stance.md)). Editing a Setup afterwards cannot reach a running
session. The reverse operation is also worth having and now has a clean shape:
**a running session can emit a Setup**, which is Marinara's play-first-share-
afterwards snapshot as a first-class object rather than a text file.

### 7.1 Goal

What the player is trying to do. Reasoning and the mode behaviour around it are
in [03 §7.3.3](03-modes-and-turn-pipeline.md); this is the shape.

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
   *  ([03 §7.3](03-modes-and-turn-pipeline.md)), so the reveal affordance and
   *  the budgeting are shared rather than reinvented. */
  visibility: "player" | "hidden"

  /** "mechanical" — completion computed from channel state — waits on the
   *  authored-rule vocabulary and arrives as a third variant at 5.0
   *  ([work plan §0.4](workplan/01-work-plan.md)). Adding a variant is additive. */
  completion:
    | { kind: "narrative" }        // an evaluation step judges it
    | { kind: "manual" }           // the player says when

  /** Seeds the offer made at completion; never applied without asking
   *  ([03 §7.3.4](03-modes-and-turn-pipeline.md)). */
  thenDefault: "continue-open" | "advance" | "end"
  /** Authored successor, for a designed chain. null = ask. */
  next: string | null
}
```

**Both completion kinds are stable**, because the one that depended on the rule
vocabulary is not here yet. Campaign is where mechanical completion actually
earns its place — a quest whose state is real data — but Campaign at 4.0 does not
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
> by design, while [03 §7.3.1](03-modes-and-turn-pipeline.md) requires difficulty
> to be *"changeable mid-session, recorded as an effect like anything else"* — and
> an effect path cannot carry something the host has no schema for. The two
> statements have coexisted because nothing consumed them together. Hook pacing
> does not inherit the problem, because it is a channel from the start rather than
> a `mode.config` key, but the next dial will, so it is recorded here.
>
> **Two dials have arrived since, and neither inherited it** — which is evidence
> about the shape rather than a resolution. Illustration pacing
> ([03 §10.6](03-modes-and-turn-pipeline.md)) is a channel for exactly hook
> pacing's reasons and copies its declaration line for line; `stagingNotes`
> (§6.1b) is authored prose with no live value to locate at all. So the prediction
> above has held twice by dials following the precedent rather than by the
> question being answered, and it stays open for the first one that does not —
> which will be a dial belonging to a single mode, since that is what puts a value
> in `mode.config` and out of the host's reach.

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
| Difficulty is a sycophancy dial ([03 §7.3.1](03-modes-and-turn-pipeline.md)) | *"The levels live in the prompt pack, not in engine code"* |
| Model-behaviour patching ([08 §5](08-infinite-worlds.md)) | Sycophancy correction, agency-based evaluation |

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
   *  ([03 §7.3.1](03-modes-and-turn-pipeline.md)). Omitted = the built-in
   *  pack. Supplied = this preset owns the meaning of "hard". */
  difficultyLevels?: DifficultyLevel[]

  /** Author-declared variables the templates interpolate, with defaults and
   *  help text. The Aventuras `CustomVariable` shape ([05 §6](05-ui-surfaces.md)). */
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
  /** Guidance-class blocks are refused by effect-producing calls. [03 §5.2] */
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
  | { of: "actor"; sectionId: string }     // "se.summary", "se.appearance", …
  /** Non-prose actor fields. `traits` is a real field rather than a Section
   *  ([§4](#4-actor)), so a slot cannot reach it through `sectionId` — and
   *  card import puts a legacy `personality` here ([02 §2.7](02-data-model.md)),
   *  which makes this the slot ST's `charPersonality` converts to. §8.4.1. */
  | { of: "actor"; field: "traits" | "visual" }
  | { of: "lore"; phase: "before" | "after" }
  | { of: "history" }
  /** Writing samples — §3.1, [18 §4](18-writing-samples.md). **Renamed from
   *  `examples`**, which named ST's `mes_example` rather than the thing it
   *  fills; free to rename because this schema is `/0` and no shipped preset
   *  positioned the old arm. `from` absent = every carrier, in the order
   *  treatment → lore → actor. */
  | { of: "samples"; from?: "actor" | "treatment" | "lore" }
  | { of: "channel"; channelId: ChannelId }
  | { of: "treatment"; part: "framing" | "tone" }
  | { of: "goal" }                          // [03 §7.3.3]
  /** The guidance slot. [03 §5.1] positions this one by preset explicitly; the
   *  producer is recorded on the block, not chosen by the slot. */
  | { of: "guidance" }
  /** The previous attempt a guided redo shows the model — the second advisory
   *  slot, [03 §5.1]. Filled from the server's record of the turn a submission
   *  names; which turn is recorded on the block. Forced advisory like
   *  `guidance`, and the one slot that wants a `wrapper`, since bare it is an
   *  unlabelled system message of prose the model itself wrote. */
  | { of: "attempt" }
  /** The player's current action — not `history`, which is turns that already
   *  happened. Every preset decides where it sits relative to the lore. */
  | { of: "input" }

// SlotSource is BlockSource ([13 §1.1](13-internal-contracts.md)) minus its two
// assembler-only origins — `preset`, because a preset's own prose *is* a
// TextBlock rather than a reference to one, and `step`, because a step's
// contribution did not exist when the preset was authored. One vocabulary, used
// from both ends: a slot names a source, the assembler fills it, and the block
// it produces records the same source back.

/** Prose the preset author wrote. */
interface TextBlock extends BlockCommon {
  kind: "text"
  /** Liquid, rendered within the block — never across blocks. [03 §5] */
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
| `injection_trigger[]` | `appliesTo` |
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
| `dialogueExamples` | ~~`{ of: "examples" }`~~ `{ of: "samples" }` — the arm was renamed when dialogue examples stopped being a `Section` ([§3.1](#31-writing-samples)); corrected at P4.1 |
| `scenario` | `{ of: "treatment", part: "framing" }` |

The `scenario` row is the interesting one, and it is the same move
[02 §2.7](02-data-model.md) makes for card import: ST's scenario is per-character
text, ours is the treatment's framing, and routing it there is where it always
wanted to live.

**The `charPersonality` row is the one that has to agree with card import, and
an earlier draft got it wrong.** It pointed at `se.voice`, which reads sensibly
in isolation and is broken in practice: [02 §2.7](02-data-model.md) routes a
card's `personality` to `traits` + `summary`, so a converted preset and a
converted card from the *same* install would have produced a slot that resolves
to a section nothing ever wrote. Empty forever, and `omitWhenEmpty` would have
hidden it.

> **The rule this establishes:** the card importer and the preset importer
> convert opposite ends of one format and have to be checked *against each
> other*. Verified separately, both look right.

The check is cheap and belongs in the fixture suite
([testing §5](workplan/10-testing.md)): import a real ST directory, assemble one turn, and
assert that **no slot resolves empty**. It is the kind of failure that produces
silence rather than an error, which is exactly what a golden-file test is for.

#### 8.4.2 What is lossy, and how each loss is reported

Every item here lands in the import review step ([05 §5](05-ui-surfaces.md)) as a
named consequence, never as a silent drop.

- **Macros.** `{{char}}`, `{{user}}`, `{{persona}}`, `{{scenario}}` and friends
  become Liquid at import, per [00 §2.1](00-stance.md). A closed mapping table
  covers the common set; **an unrecognised macro is preserved verbatim and
  flagged**, because a mangled prompt that looks fine is worse than one that
  visibly needs a look. `{{charIfNotGroup}}` and similar conditionals become
  Liquid conditionals rather than being dropped.
- **`system_prompt: true`** means *"came from the built-in set"*, not *"has the
  system role"* — a genuinely misleading field name. It carries no meaning here
  and drops.
- **`forbid_overrides`** governs whether a character card may override a prompt.
  Cards cannot override prompts at all ([00 §2.4](00-stance.md)), so it is moot
  and drops.
- **Per-character `prompt_order` entries.** ST keys orderings by
  `character_id`, with `100000` and `100001` as dummy ids for the global and
  group defaults. Only the global order converts; a preset carrying genuinely
  per-character orders gets **one preset plus a warning naming the characters**,
  rather than a silent choice among them.
- **Instruct and context templates** are not converted at all
  ([00 §2.2](00-stance.md), [triage §6.1](workplan/02-triage.md)). They exist to serve raw
  completion, which is unsupported ([07 §5.5](07-tech-stack.md)).

  *Extended at [P4 §7.17](workplan/06-p4-implementation.md): they are now
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

  *Corrected at [P4 §7.17](workplan/06-p4-implementation.md), and it was a real
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
| `impersonation_prompt` | A `TextBlock`, `appliesTo: ["impersonate"]` — the block behind [03 §3.1](03-modes-and-turn-pipeline.md) |

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
bargain [02 §2.7](02-data-model.md) strikes for character cards, and it is the
right one.

#### 8.4.6 What the review may say *before* it commits

**Added at [P4 §7.17](workplan/06-p4-implementation.md).** One hand-picked file
now gets a look before it lands ([05 §5](05-ui-surfaces.md), narrowed there).
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
adapter, and closing the gap is [polish §8](workplan/09-polish.md) rather than an
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
its effect is visible in the turn record ([02 §8](02-data-model.md)) as a block
with a source and a reason, rather than buried in a conditional. Someone who
dislikes how "hard" behaves can read the fragment that caused it and change it.

---

## 9. Package — a bundle, and nothing else

With Setup carrying the game definition, a Package is reduced to what it always
should have been: **an arbitrary bundle of portable objects, for moving them
between installs.**

```ts
interface Package {
  schema: "storyengine.package/1"
  id: string
  name: string
  version: string
  description: string
  media: EmbeddedMedia[]

  /** Self-describing portable objects — each carries its own `schema`. The
   *  package does not enumerate kinds, which is exactly why it stays stable
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

/** Open, not closed. The comment above says the package does not enumerate
 *  kinds; an earlier draft then enumerated them one line later, which meant an
 *  older reader would reject a package containing a kind it had never heard of
 *  — exactly the stranding [§2](#2-versioning-and-compatibility) forbids. */
type PortableObject =
  | Actor | Lorebook | Treatment | Setup | Preset
  | UnknownPortableObject

/** Any self-describing object this reader does not know. Preserved verbatim,
 *  round-tripped intact, shown in the import review as "1 object of an
 *  unrecognised kind (storyengine.campaign/1) — kept, not usable here". */
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
Package stable when a new kind appears, and it is the same rule as
[§2](#2-versioning-and-compatibility)'s unknown-field preservation applied one
level up.

**No `entry` field.** A package containing one or more Setups is startable, and
that is the whole mechanism — "start this" is "start that Setup". A package with
no Setup is a content drop, which is a perfectly good thing to share and had no
home before. *"Here are five characters and a lorebook"* is now expressible.

**It is stable now, and can be `/1`.** §1 marked it `/0` because it was
carrying a game definition nobody had tested. As a self-describing container it
has almost no surface of its own: new kinds do not change it, and the payload is
made of independently-versioned objects.

Contents are **embedded copies resolved on import**, not links: links inside the
package resolve within it first, then locally, then dangle visibly
([00 §3.3](00-stance.md)). `requires` is checked at import and produces a clear
warning with a degraded-start option rather than a hard block where possible.

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
| Actor | its bare lore `Ref[]` ([§4](#4-actor)) | included |
| Setup | `treatment`, and the closure above | included |
| Setup | its own `lore[]`, and `cast.personaOptions` / `partyDefault` / `narrator` | included |
| Setup | `preset` | included, can be unchecked — a preset is tuning, and some authors ship it while others would not |

Every level is shown, not just the first: the actor two steps out whose lorebook
came along is named in the review, because "why is this package 40 MB" should be
answerable before the file exists rather than after.

**Review, for the same reason import is a review step** ([05 §5](05-ui-surfaces.md)).
Unchecking a `required` link is permitted and warned about, since `required`
describes the author's intent and never blocks ([00 §3.3](00-stance.md)) — but
it is the one case where the export says plainly that the recipient will be
missing the world, not a nice extra.

**`requires` is derived where it can be.** A Setup names a concrete mode, so
`requires.modes` is populated from it rather than typed by hand; extension and
capability requirements come from what the collected objects actually reference.
An author can add to the list and should rarely need to.

**This is what makes the object split free at exchange time.** A Treatment stays
independent of any one lorebook ([02 §4](02-data-model.md)) and is nonetheless
shareable as a self-contained artefact, because the bundled form is *produced on
demand* rather than being the storage shape. The recurring pull toward folding
world content and framing into one file is, at bottom, a request for this
button.

**Exporting produces a file, not a library object.** A package is a snapshot of a
closure at one moment, and auto-saving one on every export would fill the library
with near-identical bundles nobody chose to keep. Keeping the package — as a
re-exportable object that remembers its closure and picks up later edits — is a
separate, explicit *Save this package* action.

**[OPEN]** Whether a saved package re-resolves its closure on re-export or
replays the exact contents it was built with. The first keeps a shared campaign
current; the second is the only one that reproduces a byte-identical artefact,
which matters if packages are ever addressed by hash. Lean: re-resolve, and show
the diff.

---

## 10. Not defined here, deliberately

| Structure | Why not |
|---|---|
| **Session, Turn record** | Internal. Never leaves the install, so free to migrate — and the assembler will churn. Defined in [13](13-internal-contracts.md), because *free to move* is not the same as *need not exist* when P2 has to write one. |
| **Channel definitions and state** | Owned by modes and extensions, versioned with them ([06 B7](06-open-questions.md)). Shape in [13 §1.3](13-internal-contracts.md). |
| **Rule vocabulary** (`Predicate`, `Effect`) | Deferred to 5.0, the authoring tier ([work plan §0.6](workplan/01-work-plan.md)). Now blocks nothing: the fields that depended on it are gone from §6.1 and §7.1, and both return additively. |
| **Connection** | Private, local, never exported. Free to change. |
| **Account** | Internal. |

---

## 11. Open

- **[OPEN]** Embedded-media size cap ([02 §5.2.2](02-data-model.md)). A
  schema-level `maxBytes` hint versus a policy enforced at write time.
- **[OPEN]** Whether `Openings.seeds` should record the expanded result when a
  user accepts one, or leave that entirely to the session
  ([06 B9](06-open-questions.md)).

**Two entries removed as already answered**, and both had drifted into
contradicting their own resolutions:

- *Whether `ActorProfile`'s prose fields stay fixed.* Decided in
  [02 §2.1](02-data-model.md): **there are no fixed prose fields**, all prose is
  `Section`s and four are conventional. The entry claimed committing to §4 would
  close it "in favour of fixed", which is the opposite of what §4 now says.
- *Whether `Treatment` owns a primary lorebook.* Decided in
  [§6](#6-treatment): **a Treatment owns no lorebook, it only links** — which is what
  allows many treatments over one world and removes the ownership-on-delete
  question.
