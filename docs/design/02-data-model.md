# 02 — Data model

**Status: proposal.** Shapes below are sketches for arguing about, and this
document exists to explain *why* they are shaped as they are.

**For the consolidated, reconciled schemas, see [13](13-schemas.md).** Where the
two differ, 13 is current — this document keeps the reasoning, 13 carries the
definitions.

---

## 1. The object set

Eight persistent kinds. Everything else is a sub-structure of one of them.

| Kind | Portable | What it is |
|---|---|---|
| **Actor** | yes | A person. Personas and NPCs are flags on this, not separate types. |
| **Lorebook** | yes | World content. Entries with retrieval rules and optional tracked state. |
| **Setting** | yes | Tone, framing and *links*. Carries no world facts of its own. |
| **Setup** | yes | How to start playing: mode, setting, cast, preset, opening. The "full game" definition. |
| **Preset** | yes | Prompt templates, budgets, generation params, authored variables. |
| **Package** | yes | An arbitrary bundle of the above, for moving them between installs. |
| **Session** | no | One running story. Lives under its owner. |
| **Connection** | **never** | Provider endpoint + credentials. Local, private, never exported. |

The line between the portable kinds and `Connection` is the content/production
seam from [00 §3.2](00-stance.md). It is enforced by the type system: portable
kinds have no field that could hold a connection.

**Setup and Package are deliberately separate**, and an earlier draft conflated
them. A Setup is *what a game is*; a Package is *how objects travel*. Sharing a
full game means putting a Setup in a Package — but the Setup is an ordinary
library object, useful for your own reuse without any of the transport
machinery. See §7.

---

## 2. Actor

One card type. This is the largest single divergence from all three sources.

> **Definition: [13 §4](13-schemas.md).** This section covers why it is shaped
> that way.

The card holds identity, not prompt configuration. Beyond the obvious fields it
carries: `roles` and `tags` as flags rather than types (§2.2), linked lorebooks
rather than embedded ones, a `modelHint` that is a preference and never a
binding (§2.6), namespaced `modeData` (§2.4), and two provenance maps — one for
the object, one **per field**.

That per-field map is Marinara's generation provenance, adopted wholesale and
widened from scenarios to every authored kind. It records what a model wrote,
when, with which model and from what input, so an edit can be reverted and a
machine-written field disclosed as one. See
[05 §11.2](05-ui-surfaces.md) for why it earns a place in the *data* model
rather than being a UI concern.

### 2.1 The profile

**Decision: there are no fixed prose fields. All prose is sections, and four of
them are conventional** — `se.summary`, `se.appearance`, `se.voice`,
`se.background` ([13 §4](13-schemas.md)).

"Conventional" means everything behaves as though they exist, without the schema
guaranteeing it: the editor creates all four on a new actor and presents them as
the form, generation and assists treat them as required and will recreate a
deleted one, and the default preset addresses them by id while tolerating
absence. Missing means empty, never an error.

The gain is that **there is one kind of prose block, not two.** Adding a custom
section is the same operation as editing a built-in one; the assembler has a
single code path instead of four fields plus a list; a preset can reorder or drop
`se.background` without special-casing. The earlier argument for fixed fields —
that the default preset needs something reliable to inject — is met by the three
enforcement layers rather than by the type.

`traits` and `visual` stay real fields: neither is prose, and nothing renders
either as a block. The split between prose `se.appearance` and structured
`visual` is deliberate — prose is for the narrator, fields are for image and
video pipelines, which need attributes rather than a paragraph.

Deliberately **absent**: `system_prompt`, `post_history_instructions`,
`depth_prompt`, `talkativeness`, `mes_example`, `scenario`. Those are
prompt-assembly decisions and belong to the preset and the mode. See
[00 §2.4](00-stance.md).

`mes_example` in particular is worth naming: dialogue examples are a *style
sample*, and where they go and how many survive budgeting is a preset decision.
They belong in `sections` with a disposition, not as a magic field — and under
this decision that is no longer a demotion, since the conventional four live
there too.

### 2.2 Roles and the persona flag

```ts
type ActorRole = "persona" | "narrator"   // extensible
```

- **No persona type.** An actor with `roles` containing `"persona"` is offerable
  as a played character. The flag is advisory: any actor can be selected as the
  persona for a session, the flag just controls what the picker shows first.
- **NPCs are a tag, not a role or a type.** Per the requirement: once an NPC is
  more than a single session's context, it is a short actor card tagged `npc`.
  Nothing in the engine branches on that tag; it drives library filtering and
  editor defaults (a smaller form).
- **Narrator/GM cards are the same thing too.** Marinara's
  `GameGmMode: "standalone" | "character"` becomes: the narrator slot either
  holds an actor with `roles: ["narrator"]` or holds nothing, in which case the
  mode's default narrator persona applies.

The practical payoff is that party membership, group participation, GM selection
and persona selection all take `ActorId`, and Marinara's
`partyCharacterIds: string[]` holding "library character ids or `npc:<slug>`
tracked-NPC ids" simply does not arise.

### 2.3 Session-local actors

An NPC invented mid-scene should not force a library write. Sessions carry their
own `localActors: Actor[]` using the same type, with `provenance.origin =
"session"`. Promotion to the library is an explicit user action — and per
Marinara's own conclusion, an *offered* one (an agent may suggest it; nothing
auto-promotes). A session tried once and abandoned must leave nothing behind.

### 2.4 Mode-specific data

Marinara's honest solution to "Conversation mode needs a display name and an
about-me, and RP must never read them" was fifteen fields on `extensions` with
comments. The structural version:

```ts
modeData: {
  "storyengine.messages": { displayName, aboutMe, presenceDefault, schedule },
  "storyengine.adventure": { sheetTemplate },
}
```

Rules: keys are mode or extension ids; a mode may only read its own key; unknown
keys survive round-trips untouched; export may strip keys for modes the
recipient doesn't have (with a warning, not silently).

### 2.5 What replaces the character sheet

Marinara generates a per-game `GameCharacterCard` (class, abilities, strengths,
weaknesses, attributes, HP, pools) separate from the character card, and
Aventuras' packs let authors define `RuntimeVariable`s per entity. Both are
right: **durable identity lives on the actor; per-session numbers live in
channels** ([03 §4](03-modes-and-turn-pipeline.md)). An actor card must never
carry HP.

The actor may carry a *sheet template* under `modeData` — "this character, in an
RPG-ish game, starts as a rogue-ish thing with these attributes" — as a seed for
channel initialisation, not as live state.

### 2.6 Model hints, not model bindings

Required for per-character models in individual-dispatch Scene mode, and
dangerous if done naively — a shared card must not repoint anyone's provider.

A hint names an abstract capability class — `prose`, `fast`, `reasoning`,
`vision` — plus optional advisory model ids and a free-text note
([13 §3](13-schemas.md)).

Resolution is local: the install maps `role` → connection, and
`preferredModelIds` is consulted only if the user has that model configured. An
imported card can express a preference; it can never *effect* one.

### 2.7 Import from V2/V3

A shim, not an adoption:

| Legacy | Destination |
|---|---|
| `name`, `description` | `name`, `profile.summary` |
| `personality` | `profile.traits` + `profile.summary` (heuristic; user-editable) |
| `scenario` | **Not the actor's.** Offered as a new Setting draft. |
| `first_mes`, `alternate_greetings` | `openings.written` |
| `mes_example` | `profile.sections["examples"]`, disposition `on-demand` |
| `system_prompt`, `post_history_instructions`, `depth_prompt` | `compat` + surfaced in the importer as "this card wants to override prompts; review" |
| `character_book` | extracted to a real Lorebook, linked |
| `extensions.*` | `compat` verbatim |

The `scenario` → Setting move is the interesting one and directly serves the
requirements: it is where per-card scenario text has always wanted to live.

---

## 3. Lorebook

**Position: lorebooks are the one part of this ecosystem that has genuinely
converged, and entry-level activation should be taken essentially as-is.**

An earlier draft of this section proposed replacing the flat activation field
set with a `RetrievalRule[]` list and opening up the entry type vocabulary. On
reading Marinara's `types/lorebook.ts` and its four lorebook guides properly,
most of that was reinvention of something already finished. This section records
what to take unchanged, what is actually accreted, and the one genuine
layer violation.

### 3.1 Take unchanged: entry activation semantics

Marinara's `LorebookEntry` is ST World Info plus a decade of accumulated
empirical tuning, and it is *good*. The vocabulary:

- **Matching** — `keys`, `secondaryKeys` with `selectiveLogic`
  (`and` / `and_all` / `not` / `not_all`), `matchWholeWords`, `caseSensitive`,
  `useRegex` (with a documented regex timeout), `scanDepth` per entry.
- **Always-on** — `constant`, plus `probability` for stochastic firing.
- **Timing** — `sticky` (stay active N messages after firing), `cooldown`,
  `delay` (don't fire until N messages in), `ephemeral` (auto-disable after N
  activations), with per-chat `LorebookEntryTimingState` holding the counters.
- **Recursion** — `recursiveScanning` + `maxRecursionDepth` at book level, and
  `preventRecursion` / `excludeRecursion` / `delayUntilRecursion` per entry.
  Three separate flags, and all three earn their place.
- **Placement** — `position` (before char / after char / at depth / outlet),
  `depth`, `order`, `role`.
- **Grouping** — `group` + `groupWeight` so only one of a set fires.
- **Gating** — `characterFilterMode/Ids`, `characterTagFilterMode/Filters`,
  `generationTriggerFilterMode/Filters`, and `additionalMatchingSources` (scan
  the character description, persona tags, etc. as well as chat text).
- **Outlets** — `position: 7` + `outletName`, making activated content available
  to a `{{outlet::name}}` macro instead of auto-injecting. This is a genuinely
  good idea: it decouples "this entry activated" from "this entry gets pasted
  here", which is exactly the block-addressing property [00 §2.1](00-stance.md)
  wants, arrived at from the other direction.

Reasons this should be taken rather than redesigned:

1. It is the **interchange format**. Every lorebook anyone has, from any of the
   three tools, is shaped like this. Diverging costs import fidelity and buys
   nothing users can perceive.
2. Each flag is a **direct UI control**. A flat field set maps one-to-one onto an
   editor; a `RetrievalRule[]` union maps onto a rule builder, which is more
   elegant on paper and worse to use for the 95% case of "type a keyword".
3. The apparent redundancy is mostly **not** redundancy. `sticky` vs `cooldown`
   vs `delay` vs `ephemeral` look like four takes on one idea and are four
   distinct behaviours people actually use.

**Two additions, both small:**

- `stateSchema?: JSONSchema` — see §3.3.
- `extensionActivations?: { by: ExtensionId; config: unknown }[]` — the one seam
  the flat model lacks. A new retriever contributed by an extension has nowhere
  to live otherwise. Everything built in stays a flat field; only genuinely new
  activation sources go here.

Marinara's `LorebookActivationSource`
(`current_location | keyword | semantic | constant | sticky | recursive`) is
already the per-block "why was this included" value that
[02 §8](#8-session-and-the-turn-record) needs. Take it and let it grow.

### 3.2 Take unchanged: budgeting

Also already solved, and solved the way [00 §2.6](00-stance.md) argues for:

- Two nested budgets — per-lorebook `tokenBudget` + `entryLimit`, and a
  chat-wide total. Both apply; an entry can be blocked by either.
- A **documented, deterministic trim order**: constants first, then entries
  matching the latest message, then normal injection order — and the scan
  continues past a skipped entry, so a small entry can still fit after a large
  one was dropped.
- **Skip reasons are surfaced to the user** in Active Context: "N matching lore
  entries were skipped by token budget", expandable, each naming the entry and
  which budget blocked it.

That last point is the turn record's `droppedBy` field, already shipping. Take
the whole mechanism.

### 3.3 The genuine layer violation: state in the lorebook

Where I do still disagree with the sources, and it is one issue rather than
several. `LorebookEntry` carries:

```ts
dynamicState: Record<string, unknown>          // "for quests etc."
activationConditions: ActivationCondition[]    // { field: "location", operator, value }
schedule: LorebookSchedule | null              // activeTimes / activeDates / activeLocations
relationships: Record<string, string>
embedding: number[] | null
```

plus `QuestData` / `QuestStage` / `QuestObjective` types in the same file.
Aventuras does the same thing more deliberately: its `Entry` unifies lore with
`CharacterEntryState` (presence, disposition, a −100..100 relationship level and
its history), `adventureState`, `creativeState`.

Both tools pulled state into the lore entry because state had nowhere else to
live. The channel model gives it somewhere ([03 §4](03-modes-and-turn-pipeline.md)),
and the decisive argument is **portability**:

> A lorebook you export must not contain your session's quest progress.

Rain City's lorebook should be shareable. If quest stages, completion flags,
relationship levels and NPC dispositions live inside its entries, sharing it
either leaks your playthrough or requires a stripping pass that has to know
which fields are state — and `dynamicState: Record<string, unknown>` makes that
undecidable.

So:

- The entry **declares** `stateSchema` — "a thing of this kind tracks these
  fields" — which is authored content and travels.
- The **values** live in a session channel keyed by entry id. Session state,
  never exported with the lorebook.
- `activationConditions` and `schedule` become one thing: a channel predicate.
  Marinara's `{ field: "location", operator: "equals", value: X }` and its
  `activeTimes/activeDates/activeLocations` are the same feature written twice,
  both stringly-typed against game state that may not exist. Against declared
  channels they are typed, and an entry conditioned on a channel no active mode
  provides is a visible warning rather than a silent never-fires.
- `embedding: number[] | null` moves to the derived index (§5.1). It is derived
  data, it is large, it invalidates on content edit, and storing it in the
  portable artefact means every shared lorebook carries megabytes of one
  install's vector arithmetic.

### 3.4 Actually accreted: book-level scoping

The one place a clean pass pays for itself. A `Lorebook` currently decides where
it applies through **five overlapping mechanisms**:

```ts
characterId: string | null      // and
characterIds: string[]          // an unfinished singular→plural migration
personaId: string | null        // same again
personaIds: string[]
chatId: string | null
isGlobal: boolean
scope: LorebookScope            // { mode: "all" | "disabled" | "specific", chatIds }
```

…with a documented mutual-exclusion rule enforced at save time ("Turning on
**Global** clears any character or persona links"). Two of those pairs are a
migration that never completed, and the invariant is maintained by code rather
than by shape.

Collapse to a single three-variant union — global, linked to actors, or scoped to
sessions ([13 §5](13-schemas.md)). Same three behaviours the docs describe,
mutual exclusion by construction rather than by a save-time rule, and the persona
duplication disappears for free once persona is a flag on an actor.

`category` stays as-is — five values, purely organisational, explicitly does not
affect activation. And the earlier objection to closed type vocabularies was
aimed at the wrong target: Marinara already has a free-text `tag` on the entry
("location", "item", "lore", "quest"). Aventuras' closed `EntryType` union is the
one with the ceiling. Take Marinara's shape.

### 3.5 Summary

| Area | Verdict |
|---|---|
| Entry matching, timing, recursion, placement, grouping, gating | **Take as-is.** Add `extensionActivations` only. |
| Outlets | Take, and generalise — it is block addressing. |
| Two-tier token budget, trim order, skip reporting | **Take as-is.** Already the budgeter this design wants. |
| Activation source tracking | Take; feed the turn record. |
| Entry state (`dynamicState`, quests, relationships, disposition) | **Move to channels.** Schema on the entry, values in the session. |
| `activationConditions` + `schedule` | Unify as typed channel predicates. |
| `embedding` | Move to the derived index. |
| Book-level scoping (5 mechanisms) | **Collapse to one `LoreScope` union.** |
| Entry `kind` / `tag` | Free string, per Marinara. Not Aventuras' closed union. |

---

## 4. Setting

The requirement, restated as an invariant:

> **A Setting contains no world facts.** Its prose says how this world is *used
> here* — tone, framing, what the story is about. World content lives in linked
> lorebooks.

So a Setting for Rain City does not describe Rain City. It says "hardboiled, rain
never stops, you're a fixer who owes the wrong people", carries
`lore: [ref("Rain City")]`, and lets the lorebook be the single home for what
Rain City *is*.

> **Definition: [13 §6](13-schemas.md).**

It carries `blurb` and `framing`, a `tone` block, links to lorebooks, a `cast`
of billed actor links, openings, plot hooks (§4.1), and advisory mode hints.
Notes on why:

- `blurb` vs `framing` is a real distinction and both sources conflate it.
  Aventuras' `VaultScenario.description` and Marinara's `Scenario.description`
  are both library-preview text, and Marinara had to annotate "Not injected
  anywhere" to keep it straight. Two fields, two purposes, named for their
  purpose.
- `cast` holds *links with billing*, not inline copies. Marinara's `ScenarioNpc`
  keeps an inline snapshot as authoritative with `characterId` as a pointer
  "nothing dereferences yet" — a reasonable interim, but the reason it exists is
  that scenarios came before unified actors. With actors unified and
  session-local actors available (§2.3), inline snapshots are unnecessary:
  the cast links to actors, and a Package embeds copies of them (§7).
- **This dissolves the `keyLocations` problem.** Marinara's consumption design
  spends a full section on when to materialise a scenario's key locations into
  lorebook entries and how to avoid competing with a linked lorebook. If a
  setting cannot hold locations in the first place, the question never arises —
  the editor's "add a location" action creates a lorebook entry.
- `contentRating: null` means unspecified, and consumers must prompt rather than
  assume. Taken directly from Marinara's scenario type; it is correct.

### 4.1 Plot hooks

A pool of authored, discrete, usually major plot turns that a setting or setup
carries and a step fires at an opportune moment. "X and Y have been having an
affair and will soon announce their marriage." "The Flower Kingdom will declare
war over some damned island."

> **Definition: [13 §6.1](13-schemas.md)**, including the note that its
> `requires` and `onFire` fields are typed against the *unstable* rule
> vocabulary while its content fields are committed.

A hook carries its premise and scope, mechanical eligibility (`involves`,
`requires`, `blockedBy`, `notBefore`), and firing behaviour (`weight`,
`delivery`, `onFire`).

#### Where hooks live

**Settings are the primary home.** A Setup may add its own on top, a session may
add its own while running ([03 §6.1](03-modes-and-turn-pipeline.md)), and a
package carries all of them by carrying the objects.

**Lorebooks may also carry hooks, optionally** — and the reason is better than
convenience. A hook is often *about* a specific piece of world content: "the
Flower Kingdom will declare war" belongs with the Flower Kingdom. Two things
follow that make this principled rather than a shortcut:

- **It travels with the thing people actually exchange.** Lorebooks are the
  universal currency of this ecosystem; Settings are ours. A hook attached to a
  lorebook reaches anyone who imports it.
- **It gets a natural eligibility condition for free.** A hook carried by a
  lorebook is only eligible while that lorebook is active in the session. That
  is a sensible default and a mechanical justification for the association,
  rather than "it seemed handy".

**The costs, stated.** Hooks now come from up to four places — setting, setup,
lorebooks, session — which is more sourcing than any other object has.
Mitigations are the same ones lore entries already rely on: every hook shows its
source, and editing navigates to whichever object owns it.

The real risk is conceptual drift. Lorebooks are *world facts*; hooks are
*narrative intent*. If hooks-on-lorebooks became the common path, the
separation that keeps a lorebook portable and a setting free of world content
would erode. So: **allowed, secondary, and documented as being for hooks that
are genuinely inseparable from a piece of lore.** Settings stay the default
answer to "where do I put this?".

Compatible export to third-party lorebook formats drops them, like everything
else we add ([13 §2](13-schemas.md)) — worth knowing, not a reason to decline.

Session creation copies hooks from all sources, per prefill-not-binding
([00 §3.1](00-stance.md)), and the session tracks which have fired.

**What makes this a distinct object rather than a use of an existing one.** It
is worth placing precisely, because it looks like three things it is not:

| Not | Because |
|---|---|
| A lorebook entry | Lore is retrieved by *relevance* to what is being discussed. A hook is selected by *narrative readiness*. Opposite criteria; a hook must stay out of context until it fires. |
| The Narrative Director's Secret Plot | That is a model-generated hidden arc. This is an author-written pool of discrete, specific events. |
| An authored rule ([09 §3](09-infinite-worlds.md)) | **A hook is the inverse of a trigger.** A trigger says "when X happens, do Y". A hook is a Y looking for its moment. |

That last line is the useful framing: rules are condition-first, hooks are
content-first, and the two compose — a hook's `onFire` effects are ordinary rule
effects, and a rule can require that a hook has fired.

**Chains produce the emergent ordering.** A hook that sets a channel flag on
firing makes other hooks eligible. A package with thirty loosely-dependent hooks
therefore yields a different but coherent sequence each playthrough, which is
exactly the "unpredictable specific flow over handwritten situations" this is
for. It costs nothing beyond `onFire` and `requires` already being there.

**Declaring `involves` is not optional bookkeeping.** The characteristic failure
of a system like this is firing a hook about someone who died four sessions ago,
and it is a *severe* failure — it destroys confidence in the whole mechanism in
one message. Mechanical eligibility must be checked before anything else, and a
hook whose cast is gone should be quietly retired rather than adapted.

**[OPEN]** Whether hooks are also a shareable kind in their own right — a "hook
pack" droppable onto any setting. Attractive for generic material ("a stranger
arrives with news"), and it cuts against hooks being specific, which is where
their value is. Lean: not at 1.0.

**Decision: a Setting owns no lorebook. It only links.** A "primary lorebook"
would have made the *add a location* affordance obvious and cost more than it
was worth: it blocks **many settings over one lorebook**, which is a normal
thing to want — a Rain City noir and a Rain City comedy drawing on the same
world — and it creates an ownership question on delete that nobody wants to
answer.

The concession is `LoreLink.required` ([13 §3](13-schemas.md)): an author can
mark a link load-bearing, and a consumer warns loudly when it will not resolve.
It never blocks ([00 §3.3](00-stance.md)). The distinction between "missing a
nice extra" and "missing its world" is worth being able to state, and that is
all the flag does.

The editor consequence is that *add a location* targets one of the linked
lorebooks — the user picks, or creates a new one and links it. Slightly more
explicit than an implicit home, and correct.

---

## 5. Storage: files on disk

### 5.1 Canonical store and derived index

Files on disk are the system of record. A database exists only as a **derived,
disposable index**.

```
/data
  config.json
  system/
    library/                # shipped with the app. Read-only. Loads for everyone.
      actors/               #   default assistant card, starter actors
      lorebooks/            #   the documentation the assistant reads
      settings/
      presets/              #   default preset per mode
      setups/               #   onboarding sample
      packages/
    connections/            # admin-managed. Usable by all, readable by none.
  users/
    <handle>/
      account.json
      library/
        actors/     <slug>/card.png        + assets/
        lorebooks/  <slug>/lorebook.json   + assets/
        settings/   <slug>/setting.json    + cover.png
        presets/    <slug>/preset.json
        setups/     <slug>/setup.json
        packages/   <slug>/...             (see §7)
      memories/               # auto-maintained, see [14](14-cross-session-memory.md)
      connections/            # the user's own. Credentials never leave the server.
      sessions/<session-id>/
        session.json
        turns/000001.json …
        assets/
  index/
    index.sqlite        # derived. Deleting it must be a non-event.
```

**Every user owns a complete, independent library.** There is no shared *user*
area and no ownership field — the path is the owner
([04 §4.3](04-server-multiuser-deployment.md)).

**`system/library/` is a full library with the same layout**, shipped with the
app, read-only, and loaded for every user alongside their own. Same structure
means the same loader, the same index code and the same UI — the merge is a
query, not a special case.

Sharing between *users* stays deferred, and this is the shape it will most
likely take: a third location read the same way. See
[04 §4.3](04-server-multiuser-deployment.md).

The rule that makes this work: **the index is never authoritative and never the
only home for a fact.** It exists for search, listing, tag queries, cross-refs
and multi-user read concurrency. A full rebuild from disk must always be
possible, must be a startup option, and should be exercised in CI. If a feature
can only be answered from the index, that feature is storing data in the wrong
place.

*Honest cost:* every write is a file write plus an index update, and the two can
diverge under crash. Mitigations: atomic replace (write temp + rename), index
updates derived from a filesystem watcher rather than written in parallel by
application code, and a cheap consistency check at startup (mtime/size against
recorded values) with automatic re-index of anything that doesn't match.

### 5.2 Actors are folders; the card is a PNG

```
library/actors/vera-solano/
  card.png            ← the actor. JSON embedded in the image.
  assets/
    sprites/{neutral,angry,…}.png
    gallery/*.png
```

- **`card.png` is canonical for the actor data.** Not a mirror of a JSON file —
  there is no JSON file. Two sources of truth is the failure mode to avoid.
- **The PNG's own pixels are the portrait as intended** — the cropped result,
  because that is what a dumb tool will render. See §5.2.1.
- **Drag the folder out and you have exported the actor**, assets included, with
  no UI involvement. Drag just `card.png` and you get the actor plus its
  **embedded media set** (§5.2.2) — degraded only in bulk assets, not in
  identity.
- **Chunk splicing, never pixel re-encode.** SillyTavern's parser gets this
  right and it matters: re-encoding on every save quietly degrades user art.
- **Import accepts** a bare PNG, a folder, a zip of a folder (`.seactor`), a V2/V3
  PNG, a CHARX, or a JSON card.

**Envelope, not format.** PNG `tEXt` is PNG-specific and it would be a mistake to
bake it in. Define an *embedded card envelope* — a `{schema, version, payload}`
document — with per-container encoders: PNG `tEXt`/`iTXt`, WebP `XMP`, JPEG
`APP1`. Ship PNG at 1.0; the others are then a codec, not a migration.

#### 5.2.1 Cropping is non-destructive, and still emits a cropped card

The crop is stored as a normalised source rectangle and **never destroys
anything** ([05 §11.3](05-ui-surfaces.md)). What the card *emits* is a copy that
is only the crop.

So there are two images, both first-class:

- **The PNG's pixels** — the crop, rendered. This is what SillyTavern, Chub, or
  anything else that only knows "a card is a picture" will show, and it is why
  the drag-out-and-it-works promise holds.
- **The uncropped source** — carried in the embedded media set (§5.2.2), with
  the crop rectangle in the card JSON.

Re-cropping is therefore lossless and reversible from the card alone, without
needing the folder. The crop is a view, not an edit.

#### 5.2.2 The card format embeds media natively

**Decision: carrying more than the single portrait is a feature of the format,
not of the folder.** A V2/V3 card is one picture plus text, and that ceiling is
why every tool in this space bolts sprites and galleries onto the side. Here the
envelope (§5.2 above) carries a **media set** alongside the JSON:

The envelope carries an `EmbeddedMedia[]` alongside the JSON, each entry a
typed role plus bytes ([13 §3](13-schemas.md)). Roles: `portrait-source`,
`reference`, `expression`, `pose`, `style`, `gallery`.

**Roles are typed from the start, and that is the part worth insisting on now.**
A flat list of images is cheap and forecloses everything downstream: an image
pipeline needs to know *which* picture is the canonical likeness and which is a
costume variant. Retrofitting roles onto a flat list means guessing, so the
taxonomy goes in at 1.0 even if only two roles are populated. This is the format
prerequisite for the Character Studio ([11 §2](11-roadmap.md)).

**Binary, not base64.** PNG ancillary chunks hold arbitrary bytes, so a private
chunk can carry a length-prefixed blob index directly and avoid base64's ~33%
overhead. That matters once a card carries a reference sheet and eight
expressions rather than one avatar.

**Bounded by policy, not unbounded.** The embedded set is the character's
*visual identity* — portrait source, references, a curated expression set. Bulk
galleries, video, and large sprite libraries stay in `assets/` and travel with
the folder or a `.seactor` zip. Without a cap, cards become hundreds of
megabytes and stop being shareable, which defeats the point.

**The honest risk:** ancillary chunks are droppable by spec-compliant tools that
do not understand them, so a round trip through a careless image editor can
strip the media. That risk already exists for the `chara` chunk the whole
ecosystem depends on, so it is not new — but the export UI should warn, and
`.seactor` remains the lossless transport.

**[OPEN]** The cap. A few MB is shareable; tens are not. Needs a default and a
visible indicator in the editor, since a card that silently grew to 80 MB is a
bad surprise at share time.

**[OPEN]** Compression of the embedded payload. Base64 in `tEXt` is ~33%
overhead and text payloads are small, so probably not worth it — but `zTXt`
exists and costs nothing to support on write. Decide once, since it affects what
third-party tools can read. Binary media (above) sidesteps this entirely.

#### 5.2.3 Folder-as-file: what actually works

The instinct that a folder is untidy for sharing is right, and worth separating
from what the two named mechanisms actually are:

- **AppImage** is not applicable. It is an executable format — a SquashFS image
  appended to an ELF runtime — not a way to make a data directory look like a
  file.
- **macOS bundles** are a Finder presentation convention: a directory with a
  registered UTI is shown as one opaque item. That registration comes from an
  installed application. StoryEngine is a web app with no macOS client
  ([05 §1](05-ui-surfaces.md)), so nothing on the user's machine would declare
  the type, and the folder would present as a folder.

**The mechanism that actually delivers this is a zip with a custom extension**,
which is what every format in this position uses: `.docx`, `.epub`, `.apk`,
`.krita`, and — directly relevant — SillyTavern's own `.charx`. That is already
the `.seactor` transport format above.

**Decision: folders are the only live form. `.seactor` is for import, export and
exchange, and nothing else.**

Making the zip a storage form — canonical, or even accepted alongside folders —
would cost the properties the folder was chosen for, and they are not small:

| Folder | Zipped store |
|---|---|
| Hand-editable on disk ([05 §4](05-ui-surfaces.md)) | Requires unzip/rezip to change one field |
| Watcher-fed index sees per-file changes ([04 §6.2](04-server-multiuser-deployment.md)) | Whole archive re-read on any change |
| One sprite changes → one file written | One sprite changes → archive rewritten |
| Git-able with real diffs | Opaque blob, no diffs |
| Partial write loses one file | Partial write loses the actor |
| PNG chunk splice is a direct write | Splice requires unpack and repack |

And the sharing case — which is what motivates the tidiness — is already served,
because **export produces one file**. That is where a single-file artifact
genuinely helps, and it is the only place it is worth having one.

Supporting both forms in the store was considered and rejected: it doubles the
loader, the watcher and the write path to buy tidiness in a directory most users
will reach through the library UI rather than a file manager. Keeping exactly
one live form is worth more than the neatness.

**Store, do not compress.** A `.seactor` is almost entirely PNG and JPEG, which
are already compressed — deflate buys roughly nothing and costs CPU on every
read. Use zip as a *container*, with entries stored rather than deflated. This
is why `.docx` compresses well and `.charx` does not, and it is worth deciding
deliberately rather than accepting a library default.

The same split applies to every multi-file kind: folders live, a
custom-extension zip for exchange — `.sepack` for packages, and the same
treatment for any lorebook or setting that carries assets.

### 5.3 Asset manifest

`assets` on the actor is a manifest of *relative paths within the actor folder*,
never absolute paths and never paths outside the folder. This is what keeps the
folder self-contained and drag-portable, and it is the check that prevents a
malicious package from writing outside its own directory.

### 5.4 Everything else is JSON

Lorebooks, settings, presets: plain JSON, formatted for humans, one object per
file. Diffable, greppable, git-able. A user who wants to keep their library in
git should be able to, and that should be a deliberately supported story.

**Decision: JSON everywhere, including config.** YAML is genuinely nicer to
hand-edit and supports comments, and it is still not worth it: JSON is the norm
in this space, every import and export path already speaks it, and mixing two
serialisation formats inside one application is a small tax paid forever by
everyone who has to remember which is which.

The one real loss is comments — a `config.json` cannot document itself. Cover it
by shipping a commented `config.example.json`, documenting the keys, and keeping
the settings UI the primary path so hand-editing config stays rare.

### 5.5 Sessions

Sessions are the one high-write-volume kind, and they live under the owning user.
`session.json` holds metadata, cast, channel state and branch refs.

**Turns are append-only JSONL segments**, rolling on whichever limit is reached
first — a turn count or a byte size. Not one file per turn (thousands of small
files for a long campaign), and not one growing document (rewritten on every
turn).

```
sessions/<id>/
  session.json
  turns/000001.jsonl … 000014.jsonl     # append-only, never rewritten
  assets/
```

#### File order is creation order. Reading order is a tree walk.

This is the decision that makes branching a non-issue for storage, and it is
worth stating because the natural instinct points the other way.

Turns form a tree ([10 §3](10-branching.md)), and the tempting move is to make
storage resemble that — per-branch files, or segments kept in reading order. That
is where "reconstructing the primary thread of a long, repeatedly branched
session" becomes genuinely hard.

**So do not.** Turns append in the order they were created, whatever branch they
belong to, and the segment is never touched again. Reading a path is:

1. walk `parentTurnId` from the head — the tree structure lives in the records;
2. resolve each id to `(segment, offset)` through the index;
3. read.

Consequences worth having:

- **Branching costs nothing in the write path.** A branch is more appends. No
  branch-aware cap, no special case for a session that has never branched, and
  no segment that ever needs piecing back together.
- **Segments stay immutable**, which keeps them rsync- and backup-friendly and
  means a corrupted segment loses a bounded window rather than a session.
- **The index earns its keep again.** It already maps ids to locations and is
  already rebuildable from disk (§5.1); path materialisation for the current head
  is one more derived thing it holds.
- The hot read is almost always "the last N turns of the current path", which
  caches trivially.

**Turn storage must tolerate removal** — a tombstone the reader skips, plus a
compaction pass that rewrites a segment. No UI needs it at 1.0, but pruning a
branch subtree ([11 §1.4](11-roadmap.md)) does, and retrofitting deletion into a
format that assumed pure append is a migration rather than a feature.

**Retention: keep everything.** No automatic compaction of old records
([06 B3](06-open-questions.md)). A full record runs roughly 10–100× its message
text, so a thousand-turn session is tens to a couple of hundred megabytes —
acceptable, and the reason the layout above matters.

---

## 6. Openings

Requested as two types, each with primary and secondary alternatives. Defined
once and reused on Actor, Setting and Package.

> **Definition: [13 §3](13-schemas.md).**

Two lists — `written` and `seeds` — each with a designated primary.

- The two lists are genuinely different things and should not be merged with a
  flag: a written opening is content, a seed is an instruction. They render
  differently in the editor and consume differently at session start.
- "Primary and secondary" is modelled as *an ordered list plus a designated
  primary* rather than a `primary` field and an `alternates` array. Same
  information, no special-casing of the first element, reordering is free. This
  is the fix for `first_mes` + `alternate_greetings` being two shapes for one
  concept.
- At session creation the user picks one written opening, one seed to expand, or
  neither (start cold). Aventuras' seed→expand→edit→accept loop is the right
  interaction for the seed path: expansion produces editable text, and accepting
  it stores the *result* on the session, not a live link to the seed.
- **An expanded seed can be promoted back to the source object as a written
  opening.** This is the point of having two lists rather than one: a seed is
  reusable machinery for generating openings, and a good expansion is worth
  keeping as content. The loop closes — seed → expand → edit → accept → promote —
  and the promoted opening records `fromSeedId` so the lineage stays visible
  ([13 §3](13-schemas.md)).

  Promotion targets the object the seed came from — a setting, an actor, a setup
  — not the session, which keeps its own copy regardless.

---

## 7. Setup and Package — two jobs, split

> **Definitions: [13 §7](13-schemas.md) (Setup), [13 §8](13-schemas.md) (Package).**

An earlier draft had a single `Package` doing both jobs: it carried an `entry`
block defining the game *and* the bundling machinery for moving objects. Splitting
them makes both simpler, and the split is worth stating as a rule:

| | |
|---|---|
| **Setup** | *What a game is.* Mode, setting, cast, preset, opening. An ordinary library object. |
| **Package** | *How objects travel.* An arbitrary bundle, for moving anything between installs. |

**Sharing a full game is putting a Setup in a Package.** The Setup is the game;
the Package is the envelope.

### 7.1 Why Setup is a plain object

- **It is useful without ever being shared.** Saving "my Rain City campaign
  configuration — this setting, this cast, this mode config" for your own reuse
  should not require building a transport artefact with embedded copies and a
  dependency manifest. Under the old shape it did.
- **It completes a reframe we half-adopted.** Marinara's scenario design
  identified and deferred "make Setting the first-class entity and scenarios its
  children" ([01 §1](01-source-survey.md)). We took the parent and never built
  the child. One Setting, many Setups: *Rain City* is the world, *The Fixer's
  Debt* is a way to play in it.
- **It gives the session-to-setup direction a shape.** Marinara's
  play-first-share-afterwards snapshot becomes "emit a Setup from this running
  session" — a real object rather than a text file.

### 7.2 Why Package gets simpler, and stabler

Reduced to a container, Package has almost no surface of its own:

- **Contents are self-describing.** Each object carries its own `schema`, so the
  package does not enumerate kinds — and therefore does not change when a new
  portable kind appears, as Setup just did. This is why
  [13 §1](13-schemas.md) can now treat it as stable rather than `/0`.
- **No `entry` field.** A package holding one or more Setups is startable; that
  *is* the mechanism. A package with no Setup is a content drop — *"here are five
  characters and a lorebook"* — which is a perfectly reasonable thing to share
  and had nowhere to live before.
- **Contents are embedded copies, resolved on import** into the recipient's
  library (with a "these already exist, link or duplicate?" step). Links resolve
  within the package first, then locally, then dangle visibly. The only reliable
  way to ship something working to someone whose library you know nothing about.
- **`requires` is declared and checked at import**, producing "this wants
  Adventure mode ≥ 2 and an image connection; you have neither" rather than a
  broken session later. A warning with a degraded-start option where possible,
  not a hard block.
- **No production settings, in either object.** No connection ids, no keys, no
  endpoint URLs, no per-install toggles — enforced by there being nowhere to put
  them ([00 §3.2](00-stance.md)).
- On disk a package is a folder, zipped as `.sepack` for exchange
  (§5.2.3).

**[OPEN]** Can a package ship an extension/mode *implementation*, or only declare
a dependency on one? Shipping code makes packages far more powerful and makes
importing one a code-execution decision. Strong lean: **declare only** at 1.0
([06 A2](06-open-questions.md)).

**[OPEN]** Should a package be able to ship a partially-played session as a
starting state (a "pre-run prologue")? Attractive for authored content, and it
crosses the content/session line the rest of the model keeps clean. Note the
split makes this cleaner to reason about: it would be a *session* in a package,
not a variant of Setup.

---

## 8. Session and the turn record

```ts
interface Session {
  id, title, createdAt, updatedAt
  // No owner or visibility field: the session lives under its owner's
  // directory, and there is nobody to share it with. [04 §4.3]
  participants: UserId[]          // length 1 at 1.0 — see [04 §8]

  mode: { id: ModeId; config: unknown }
  preset: Preset                  // resolved copy, not a link
  origin: Provenance              // which Setup/version seeded this. Provenance only — a dead link.

  cast: {
    persona: ActorId
    party: PartyMember[]
    narrator: ActorId | null
    // No `present` list. Presence and status are channels — `se.presence`,
    // `se.status` — so they reconstruct per node and branch correctly.
    // [03 §8.1]
  }
  localActors: Actor[]
  lore: Ref<Lorebook>[]

  channels: Record<ChannelId, ChannelState>

  // Turns form a tree, not a list — see [10 §3](10-branching.md).
  headTurnId: TurnId              // where the user currently is
  branchRefs: BranchRef[]         // names bookmarking nodes; swipes need no record
}
```

`origin` is provenance only. Per [00 §3.1](00-stance.md), editing the source
setting later must not affect this session.

### The turn record is a first-class artefact

This is the point where the requirement that "call construction UI ranks with the
chat UI" becomes a data-model decision rather than a UI decision.

```ts
interface Turn {
  id: TurnId                     // stable, opaque — never (branch, index); [10 §3]
  sessionId: SessionId
  parentTurnId: TurnId | null    // the tree edge. Siblings are swipes/branches.
  createdAt: string
  input: { actorId: ActorId | null; kind: InputKind; text: string; raw: string }

  request: {
    blocks: AssembledBlock[]     // every block, in order, with source + token cost
    budget: BudgetVerdict        // what was included, what was dropped, and why
    calls: ModelCall[]           // one per model call: params, model, messages, tools
  }

  output: { text: string; reasoning?: string; toolCalls: ToolCall[] }
  effects: ChannelEffect[]       // proposed and applied state changes, individually reversible
  /** Resolved actor mentions in `input.text` and `output.text`, as an overlay.
   *  The text itself is never rewritten with markup. [03 §8.2, 05 §13.1] */
  mentions: MentionSpan[]
  cost: { promptTokens, completionTokens, wallMs, model }
}

interface MentionSpan {
  /** Which text this indexes into — the two are stored separately. */
  field: "input" | "output"
  /** Character offsets. Recomputed when a message is edited. */
  start: number
  end: number
  ref: Ref<Actor>
  /** How it was resolved. Rendered differently per method, because a tentative
   *  match that looks certain is worse than no highlighting. [05 §13.1] */
  method: "explicit" | "matched" | "proposed"
  /** Only meaningful for "proposed". */
  confidence: number | null
}

interface AssembledBlock {
  id: string
  source: { kind: "actor" | "lore" | "setting" | "channel" | "history" | "preset" | "step"; id: string }
  reason: string                 // "keyword match: 'cathedral'" / "always" / "pinned by user"
  role: "system" | "user" | "assistant"
  tokens: number
  included: boolean
  droppedBy?: string             // which budget rule dropped it
}
```

Aventuras stores a `retrievalSnapshot` annotated "Diagnostic only — nothing reads
it back", and Marinara has an Active Context popover plus a debug-only Injections
tab. Both are the same instinct arriving as an afterthought. Making the turn
record complete and permanent buys, from one decision:

- "why did it say that" — fully answerable, after the fact, with no debug flag
- deterministic replay and regeneration with an edited block
- honest per-turn cost accounting
- the prompt workbench in [05](05-ui-surfaces.md), which is otherwise a
  reimplementation of the assembler
- reproducible bug reports that don't require the reporter's library

There is a fifth consequence that only became visible later, and it is the one
with the sharpest test attached: **`effects` being complete and reversible is
what makes branching a pointer rather than a copy** ([10 §2](10-branching.md)).
Any change that makes state at turn N unreconstructible from the log breaks
branch-anywhere, which is a much more concrete failure than "undo would be
nice".

*Cost:* turn records are big — plausibly 10–100× the message text. This is the
main argument for JSONL segments (§5.5) and for a retention policy.
**[OPEN]** retention: keep full records for the last N turns and compact older
ones to `{blocks: summary, calls: params-only}`? Lean: keep everything by
default, offer compaction, never compact the current branch's tail.

---

## 9. References and drift

> **Definition: [13 §3](13-schemas.md).** A `Ref` is `{id, name, fingerprint?}`.

Resolution order, everywhere, per [00 §3.3](00-stance.md): exact id →
case-insensitive name → show as missing and continue. `fingerprint` lets the UI
say "this lorebook has changed since this package was built" without blocking
anything. Marinara's `resolveGameSetupImport` already does the first two steps
and reports misses as warnings; the third is the addition.
