# 13 — Proposed schemas

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
| **Free to move** | Session, Turn record, Channel state, Preset, rule vocabulary | Internal. Migrate at will |

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
   *  app's licence — content is not a derivative work. [08 §1.2] */
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
  | "reference"         // canonical likeness
  | "expression"
  | "pose"
  | "style"             // style exemplar, not likeness
  | "gallery"

/** Media carried *inside* the card envelope. Bounded by policy — bulk galleries
 *  and video live in the folder as `assets`. */
interface EmbeddedMedia {
  id: string
  role: MediaRole
  mime: string
  /** Raw bytes in the container's binary chunk. Not base64. */
  bytes: Uint8Array
  label?: string
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

type ActorRole = "persona" | "narrator"     // extensible

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
  media: EmbeddedMedia[]           // cover art
  provenance: Provenance
  generated: Record<string, GeneratedFieldProvenance> | null
  metadata: Record<string, unknown>
}

/** One mechanism, three behaviours, mutual exclusion by construction. Replaces
 *  characterId + characterIds + personaId + personaIds + chatId + isGlobal +
 *  scope, and the save-time rule that kept them consistent. [02 §3.4] */
type LoreScope =
  | { kind: "global" }
  | { kind: "linked"; actorIds: string[] }    // personas are actors
  | { kind: "session"; sessionIds: string[] }

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
  /** Patterns run under a hard execution timeout. [08 §5.1] */
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
    /** null = unspecified. A consumer must prompt, never assume. */
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
  requires?: Predicate[]           // ⚠ unstable — see note
  blockedBy?: string[]             // hook ids that make this nonsensical
  notBefore?: { turn?: number; afterHook?: string }

  // ── Selection and firing ──
  weight: number                   // relative likelihood among eligible hooks
  delivery: "guidance" | "seed" | "immediate"
  /** Channel effects applied on firing. This is what makes chains work: a hook
   *  that sets a flag makes other hooks eligible. */
  onFire?: Effect[]                // ⚠ unstable — see note
  once: boolean
}
```

**⚠ `Predicate` and `Effect` belong to the authored-rule vocabulary**, which is
explicitly unstable ([06 C7](06-open-questions.md)). So PlotHook is *partly*
stable: its content fields are committed, its rule-typed fields will move with
that vocabulary. Worth flagging rather than pretending otherwise — an author
writing hooks with premises and `involves` is safe; one leaning on complex
`requires` predicates should expect churn.

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

---

## 8. Package — a bundle, and nothing else

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

type PortableObject = Actor | Lorebook | Setting | Setup | Preset
```

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

## 9. Not defined here, deliberately

| Structure | Why not |
|---|---|
| **Session, Turn record** | Internal. Never leaves the install, so free to migrate — and the assembler will churn. |
| **Channel definitions and state** | Owned by modes and extensions, versioned with them ([06 B7](06-open-questions.md)). |
| **Preset** | Depends on the assembly design, which is unbuilt. Defining it now would be guessing. |
| **Rule vocabulary** (`Predicate`, `Effect`) | [06 C7](06-open-questions.md). Blocks the two PlotHook fields noted in §6.1 and nothing else. |
| **Connection** | Private, local, never exported. Free to change. |
| **Account** | Internal. |

---

## 10. Open

- **[OPEN]** Whether `ActorProfile`'s four prose fields stay fixed or become
  conventional `Section`s with well-known ids ([06 B1](06-open-questions.md)).
  Committing to §4 as written closes this in favour of fixed.
- **[OPEN]** Whether `Setting` owns a primary lorebook its editor writes into
  ([06 B2](06-open-questions.md)). Affects nothing above; it is a UI and
  ownership question.
- **[OPEN]** Embedded-media size cap ([02 §5.2.2](02-data-model.md)). A
  schema-level `maxBytes` hint versus a policy enforced at write time.
- **[OPEN]** Whether `Openings.seeds` should record the expanded result when a
  user accepts one, or leave that entirely to the session
  ([06 B9](06-open-questions.md)).
