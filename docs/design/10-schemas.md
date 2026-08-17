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
| **Stable** | Actor, Lorebook, Setting, Setup, Package, and the shared substructures in §3 | Define now, change only additively, version on breakage |
| **Provisional** | Preset (§8) | Portable, so it needs a schema — but at `/0`, which says the shape will move |
| **Free to move** | Session, Turn record, Channel state, rule vocabulary | Internal. Migrate at will |

**Preset moved out of the internal tier**, where an earlier draft had it, on the
grounds that it plainly fails this section's own test: a preset travels between
installs — it is the object this ecosystem trades most — so calling it internal
was a contradiction with [02 §1](02-data-model.md), which lists it as portable.
§8 works through the consequences.

**Package used to be a prototype exception and no longer is.** It was marked
unstable because it carried a game definition — an `entry` block naming a mode,
a setting and a cast — that nobody had tested against real authored content.
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

/** A link to a lorebook, with a strength. Used by Setting and Setup rather than
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
`mes_example`, `scenario`. Prompt assembly is owned by the preset and the mode,
not by the description of a person ([00 §2.4](00-stance.md)). Dialogue examples
are a `Section` with `disposition: "on-demand"`. Per-session numbers — HP,
inventory — live in channels and must never appear here.

---

## 5. Lorebook

Entry activation is taken from Marinara close to unchanged, because it is a
decade of empirical tuning and it is the interchange format
([02 §3](02-data-model.md)). The changes are four, all scoped.

```ts
interface Lorebook {
  schema: "storyengine.lorebook/1"
  id: string
  name: string
  description: string
  /** Organisational only. Explicitly does not affect activation. */
  category: "world" | "character" | "npc" | "spellbook" | "uncategorized"

  scope: LoreScope                 // see below — collapses 5 mechanisms into 1
  enabled: boolean

  scanDepth: number                // default 2; 0 = whole session
  tokenBudget: number              // default 2048; 0 = unlimited
  entryLimit: number               // default 100; range 1..1000
  recursiveScanning: boolean       // default false
  maxRecursionDepth: number        // default 3

  folders: LoreFolder[]
  /** Optional. Hooks genuinely inseparable from this lore — eligible only while
   *  this lorebook is active. Settings remain the primary home. [02 §4.1] */
  hooks?: PlotHook[]
  entries: LoreEntry[]

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

### 5.1 Images on lore

New territory rather than a port: Marinara carries one `imagePath` per book for
the library card and nothing per entry, and SillyTavern's World Info has no
images at all. Reasoning in [02 §3.6](02-data-model.md); the shape is two
`EmbeddedMedia[]` fields, one on the book and one on the entry, both resolving
into the object's folder.

**Nothing reads them at 1.0 outside the editor**, and the `⚠` on
`LoreEntry.media` is the load-bearing part of this addition rather than a
caution. What makes it worth adding now anyway is that **typed roles cannot be
retrofitted** ([02 §5.2.2](02-data-model.md)) — the same argument made for cards,
unchanged. Adding images later without roles means guessing afterwards what each
one was for, and the guess is not recoverable.

The intended first real consumer is rendition conditioning
([14 §3](14-roadmap.md)): a location's `reference` image is the same shape of
input to *illustrate this scene* that an actor's already is
([03 §10.3](03-modes-and-turn-pipeline.md)). That is why `reference` carries the
same meaning across both kinds rather than lore getting a vocabulary of its own.

---

## 6. Setting

Carries tone, framing and *links* — never world facts. The rule that makes it
work: a Setting for Rain City does not describe Rain City.

```ts
interface Setting {
  schema: "storyengine.setting/1"
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

  lore: LoreLink[]                 // where the world content actually lives
  cast: CastEntry[]
  openings: Openings
  hooks: PlotHook[]                // §6.1

  /** Advisory only. A setting proposes a mode; it never configures production
   *  settings. [00 §3.2] */
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
  /** How this character is used *in this setting*. */
  note: string
}
```

**Deliberately absent**: key locations, world description, NPC inline snapshots.
Locations are lorebook entries; the cast links to real actors. This is what
dissolves the materialise-or-not question Marinara's scenario design spends a
section on ([02 §4](02-data-model.md)).

**A Setting owns no lorebook.** It only links, which is what allows **many
settings over one lorebook** — a Rain City noir setting and a Rain City comedy
setting drawing on the same world, which is a normal thing to want and would be
blocked by a primary-lorebook relationship. Ownership on delete also stops being
a question nobody wants to answer.

`LoreLink.required` (§3) is the concession: an author can mark a link as load-
bearing, and a consumer warns loudly when it cannot be resolved. It still never
blocks ([00 §3.3](00-stance.md)) — the difference between "this setting is
missing a nice extra" and "this setting is missing its world" is worth saying
out loud, and that is all the flag does.

Actor lore links stay bare `Ref[]`: a character's own lorebook going missing is
a soft degradation, not a broken world.

**Consequence for the editor.** With no owned lorebook, an "add a location while
authoring a setting" action has to target one of the linked lorebooks — the user
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
  scope: "world" | "local" | "personal"

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
}
```

**Fully stable, because the rule-typed fields are gone.** An earlier draft
carried `requires?: Predicate[]` and `onFire?: Effect[]` with ⚠ warnings, since
both belonged to the authored-rule vocabulary. That vocabulary is now 2.0
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
which setting, which cast, which preset, which opening — everything needed to
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

  setting: Ref | null              // one Setting; null = start bare
  preset: Ref | null

  cast: {
    personaOptions: Ref[]          // offered as the played character
    partyDefault: Ref[]            // [03 §8] — the party always contains the persona
    narrator: Ref | null           // null = the mode's default narrator
  }

  /** Beyond whatever the setting already links. */
  lore: LoreLink[]
  /** Overrides the setting's when present. */
  openings: Openings
  /** Additional to the setting's, not a replacement. */
  hooks: PlotHook[]
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

**Setting is to Setup as a world is to a game played in it.** One Setting, many
Setups: *Rain City* is the world; *The Fixer's Debt*, Adventure mode, playing
Marlow is a way to play in it. This is the reframe Marinara's own scenario design
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
   *  authored-rule vocabulary and arrives as a third variant at 2.0
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
earns its place — a quest whose state is real data — and Campaign is 2.0
([work plan §0](workplan/01-work-plan.md)), so the vocabulary and its first serious consumer
arrive together rather than one waiting on the other.

**Why `Goal` sits on Setup rather than Setting.** A Setting is a world and a
world has no win condition — the same rule that keeps world facts out of it
([§6](#6-setting)). *Rain City* does not have an objective; *The Fixer's Debt*
does. Placing goals here is what allows several Setups with different objectives
over one world, which is the whole point of the split.

**Difficulty is deliberately not here.** It is Adventure's, not every mode's, so
it lives in `mode.config` where the host does not interpret it. Modelling it on
Setup would imply Messages and Scene have a difficulty, which they do not.

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

  /** Named levels the mode's difficulty setting resolves against
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
   *  `wi_format`, generalised from eight fixed fields to a property of any
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
  | { of: "examples" }
  | { of: "channel"; channelId: ChannelId }
  | { of: "setting"; part: "framing" | "tone" }
  | { of: "goal" }                          // [03 §7.3.3]
  /** The guidance slot. [03 §5.1] positions this one by preset explicitly; the
   *  producer is recorded on the block, not chosen by the slot. */
  | { of: "guidance" }
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
| `dialogueExamples` | `{ of: "examples" }` |
| `scenario` | `{ of: "setting", part: "framing" }` |

The `scenario` row is the interesting one, and it is the same move
[02 §2.7](02-data-model.md) makes for card import: ST's scenario is per-character
text, ours is the setting's framing, and routing it there is where it always
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
- **Text-completion presets** convert to `params` only, and most of their fields
  drop: `dry_*`, `smoothing_*`, `mirostat_*`, `xtc_*`, `tfs`, `eta_cutoff`,
  `epsilon_cutoff`, `num_beams` and the rest are backend-specific sampler
  controls with no chat-API equivalent. Worth stating plainly in the review:
  *"this preset was mostly sampler settings for a local backend; 6 of 41 fields
  carried over."*
- **Reasoning presets** (`prefix`/`suffix`/`separator`) parse reasoning blocks
  out of output. Nothing at 1.0 consumes them; they go to `compat`.
- **`sysprompt` presets** convert well and are the easy case: `content` becomes
  a `TextBlock` at the top, `post_history` a `TextBlock` after history.

#### 8.4.3 Eight special-cased fields that become ordinary blocks

The most satisfying part of the conversion, and the strongest evidence that
`appliesTo` and `wrapper` are the right two fields rather than one field too
many. ST carries these as top-level preset settings, each with bespoke handling
in the assembler:

| ST field | Becomes |
|---|---|
| `wi_format` (`"{0}"`) | The lore slot's `wrapper` |
| `scenario_format` (`"{{scenario}}"`) | The setting slot's `wrapper` |
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
  | Actor | Lorebook | Setting | Setup | Preset
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

---

## 10. Not defined here, deliberately

| Structure | Why not |
|---|---|
| **Session, Turn record** | Internal. Never leaves the install, so free to migrate — and the assembler will churn. Defined in [13](13-internal-contracts.md), because *free to move* is not the same as *need not exist* when P2 has to write one. |
| **Channel definitions and state** | Owned by modes and extensions, versioned with them ([06 B7](06-open-questions.md)). Shape in [13 §1.3](13-internal-contracts.md). |
| **Rule vocabulary** (`Predicate`, `Effect`) | Deferred to 2.0 ([work plan §0.4](workplan/01-work-plan.md)). Now blocks nothing: the fields that depended on it are gone from §6.1 and §7.1, and both return additively. |
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
- *Whether `Setting` owns a primary lorebook.* Decided in
  [§6](#6-setting): **a Setting owns no lorebook, it only links** — which is what
  allows many settings over one world and removes the ownership-on-delete
  question.
