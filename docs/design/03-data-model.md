# 03 — Data model

**Status: proposal.** Shapes below are sketches for arguing about, and this
document exists to explain *why* they are shaped as they are.

**For the consolidated, reconciled schemas, see [04](04-schemas.md).** Where the
two differ, ~~13~~ **10** is current — this document keeps the reasoning, 10
carries the definitions. *(The sentence pointed at 10 and then named 13, which
is a different document; corrected at P4.2, having been read wrong at least
once while writing the importer.)*

---

## 1. The object set

Eight persistent kinds. Everything else is a sub-structure of one of them.

| Kind | Portable | What it is |
|---|---|---|
| **Actor** | yes | A person. Personas and NPCs are flags on this, not separate types. |
| **Lorebook** | yes | World content. Entries with retrieval rules and optional tracked state. |
| **Treatment** | yes | Tone, framing and *links*. Carries no world facts of its own. |
| **Setup** | yes | How to start playing: mode, treatment, cast, preset, opening. The "full game" definition. |
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

> **Definition: [04 §4](04-schemas.md).** This section covers why it is shaped
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
[10 §11.2](10-ui-surfaces.md) for why it earns a place in the *data* model
rather than being a UI concern.

### 2.1 The profile

**Decision: there are no fixed prose fields. All prose is sections, and four of
them are conventional** — `se.summary`, `se.appearance`, `se.voice`,
`se.background` ([04 §4](04-schemas.md)).

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
`depth_prompt`, `talkativeness`, `scenario`. Those are prompt-assembly decisions
and belong to the preset and the mode. See [00 §2.4](00-stance.md).

`mes_example` was on that list, and the note beside it read: ~~dialogue examples
are a *style sample*, and where they go and how many survive budgeting is a
preset decision; they belong in `sections` with a disposition, not as a magic
field~~. **The first half of that was right and became the feature.** Dialogue
examples *are* a style sample — which is a thing a Treatment and a Lorebook want
as much as a person does, so it became `writingSamples` on all three
([04 §3.1](04-schemas.md), [14](14-writing-samples.md)).

What changed is only the container, and the reason is narrow: where a sample goes
and what survives budgeting is still a preset decision, but a `Section` carries
no `priority`, and [00 §2.6](00-stance.md) makes "never trim this" a priority
value rather than the absence of a budget. A sample that could not rank itself
could not take part in that rule.

### 2.2 Roles and the persona flag

```ts
type ActorRole = "persona" | "narrator"   // extensible
```

- **No persona type.** An actor with `roles` containing `"persona"` is offerable
  as a played character. The flag is advisory: any actor can be selected as the
  persona for a session, the flag just controls what the picker shows first.
- **NPCs are a tag, not a role or a type.** Per the requirement: once an NPC is
  more than a single session's context, it is a short actor card tagged `npc`.
  Nothing in the engine branches on `npc` by name; it drives library filtering
  and editor defaults (a smaller form). An *author* may gate lore on it, or on
  any other tag, through `LoreEntry.actorTagFilter` — [05 §1](05-tagging.md).
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
channels** ([06 §4](06-modes-and-turn-pipeline.md)). An actor card must never
carry HP.

The actor may carry a *sheet template* under `modeData` — "this character, in an
RPG-ish game, starts as a rogue-ish thing with these attributes" — as a seed for
channel initialisation, not as live state.

### 2.6 Model hints, not model bindings

Required for per-character models in individual-dispatch Scene mode, and
dangerous if done naively — a shared card must not repoint anyone's provider.

A hint names an abstract capability class — `prose`, `fast`, `reasoning`,
`vision` — plus optional advisory model ids and a free-text note
([04 §3](04-schemas.md)).

Resolution is local: the install maps `role` → connection, and
`preferredModelIds` is consulted only if the user has that model configured. An
imported card can express a preference; it can never *effect* one.

### 2.7 Import from V2/V3

A shim, not an adoption:

*Restated at P4.2 in the shipped schema's own terms, and `profile.summary` was
always shorthand for the reserved `se.summary` **section** rather than a field.*

| Legacy | Destination |
|---|---|
| `name`, `description` | `name`, the `se.summary` section body |
| `personality` | `profile.traits` when list-shaped, otherwise a paragraph of `se.summary` — a heuristic, user-editable, and **the review names which happened** |
| `scenario` | **Not the actor's.** ~~Offered as a new Treatment draft.~~ **Created as a Treatment and reported**, one per distinct scenario text within a sweep — the post-hoc posture [P4 §1.4](workplan/16-p4-implementation.md) decided leaves nothing to offer it into |
| `first_mes`, `alternate_greetings` | `openings.written`, first as primary |
| `mes_example` | `writingSamples`, one entry, enabled ([14](14-writing-samples.md)) |
| `system_prompt`, `post_history_instructions`, `depth_prompt`, `talkativeness` | `compat` + surfaced in the importer as "this card wants to override prompts; review" |
| `character_book` | extracted to a real Lorebook, linked and scoped to the actor it travelled with |
| `extensions.*` | `compat` verbatim |

*Two rows moved at P4.2.* `talkativeness` was in the deliberately-absent list
with no destination at all, and now has one — `compat`, with the rest of what a
card wants and cannot have. And **only the sections the mapping fills are
created**: `se.appearance`, `se.voice` and `se.background` stay absent on an
imported card, because splitting a description into them by heuristic would be
inventing structure the source does not have.

The `scenario` → Treatment move is the interesting one and directly serves the
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
live. The channel model gives it somewhere ([06 §4](06-modes-and-turn-pipeline.md)),
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
sessions ([04 §5](04-schemas.md)). Same three behaviours the docs describe,
mutual exclusion by construction rather than by a save-time rule, and the persona
duplication disappears for free once persona is a flag on an actor.

> **Corrected after [P5.7] acted on it.** This section describes the *shape*
> correctly and the resulting **behaviour** does not follow from it. P5.7 read
> "where it applies" as a discovery mechanism — a `global` book scanned by every
> session, a `linked` one by every session casting its actors — and the
> consequence was immediate: `global` is the factory default *and* the
> SillyTavern importer's fallback, so a person's entire library was in every
> session's prompt with no way out but hand-editing JSON. A library is not a
> world.
>
> The rule is: **no lorebook is active that has not been selected for the
> session** — by `session.lore`, or by the treatment the session names. The
> union stays, because it is what the format carries and what an import must
> preserve, but nothing reads it. Giving it a consumer again means designing
> **inheritance** — something above the session that contributes books, which is
> a Worlds-shaped concept ([15 §5.3](15-world.md)) — rather than letting a field
> on a library object opt itself into somebody's story.
>
> **Two questions were left open rather than settled by the reversal**, both
> recorded so the next person meets them instead of re-deriving them:
> [26 §B14](26-open-questions.md) — whether `scope` should *narrow* a book the
> session has already chosen, which is coherent and was not taken because it
> introduces a new way for a deliberate choice to go quiet; and
> [26 §B15](26-open-questions.md) — what a new book's `scope` should default to,
> given that `global` is the widest value in the union and is what both the
> factory and the importer currently produce.

**`category` is removed**, not renamed — reversing an earlier decision here that
kept Marinara's five-value book-level union as-is. The trigger was a collision
(`category: "world"` against the World concept reserved for [15](15-world.md)),
but reopening the field is what condemned it: the values are not one axis
(`world` and `character` are subject matter, `spellbook` is one genre's
artefact, `uncategorized` is a null in a value's clothes), `character` and `npc`
as separate values re-import the split §2.2 removed by unifying actors, and
`tags` already does organisational classification without a ceiling. Full
argument at [04 §5](04-schemas.md).

That leaves this section's point about closed vocabularies applying uniformly
rather than at one level only. The earlier objection to closed type vocabularies
was aimed at the wrong target: Marinara already has a free-text `tag` on the
entry ("location", "item", "lore", "quest"). Aventuras' closed `EntryType` union
is the one with the ceiling. Take Marinara's shape — at both levels.

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
| Book-level `category` | **Removed.** Closed, mixed-axis, and duplicated by `tags` — §3.4. |
| Images on the book and on entries | **New.** Not a port — see §3.6. |
| Import and export of individual entries | **New.** The unit an author moves is often smaller than the book; the exchange file is a lorebook carrying a subset ([04 §5.2](04-schemas.md), [10 §11.2c](10-ui-surfaces.md)). |
| Reading, browsing and searching the entries | **No schema change.** Every affordance is a rendering of a field that already exists — eleven of them currently have no reader at all. Position in [11](11-lorebooks-as-a-format.md); surfaces in [10 §5.3](10-ui-surfaces.md). |

### 3.6 Images on lore

**A lorebook and its entries may carry images.** Definitions in
[04 §5.1](04-schemas.md); this is why.

The case is simply that world content is often visual and currently has nowhere
to put it. A place looks like something, an item has a picture, a region has a
map — and the author is the person who wants to see it, while writing the entry
that describes it. Marinara carries one picture per book for the library card;
SillyTavern's World Info has none. Neither is a decision against the idea so much
as an absence.

**At 1.0 the feature is exactly that: a place to put pictures.** Shown in the
editor, and nowhere else.

#### Activation is a text mechanism, and stays one

The rule that has to be stated because the wrong reading is the natural one:

> **An entry firing does not bring its images.** Keyword activation contributes
> the entry's *text*. Media is not retrieved, not budgeted, not sent.

Someone will otherwise assume activation carries the whole entry, and the failure
is quiet and expensive: twelve pictures on a `constant: true` entry become a
per-turn cost nobody chose, discovered on a bill. Keeping the rule explicit costs
one sentence; discovering it costs a redesign of the budgeter's relationship to
lore ([§3.2](#32-take-unchanged-budgeting)).

#### Roles are closed, tags are open

Two fields, because they answer different questions. `role` is the small closed
union the engine acts on — `reference` for *this is what it looks like*, `map`
for a diagram, `gallery` for pictures without a claim. `tags` are arbitrary and
authorial: *winter*, *aerial*, *before the fire*, *by Mireille*.

**Same division the actor already makes** (§2.2): `ActorRole` is closed and read
by the engine, `tags` are open and the engine has no built-in meaning for any of
them. On an actor that is a weaker claim than it sounds — an author may point a
lore gate at a tag ([05 §1](05-tagging.md)) — while on media nothing reads them
at all.

A gallery of forty images needs finer notation than any role vocabulary should
try to carry, and every attempt to express that *through* roles ends with a union
nobody can choose from.

#### Why now, given nothing consumes it

Because **typed roles cannot be retrofitted** — the argument §5.2.2 makes for
cards, unchanged. A flat image list forecloses what comes after it, and adding
roles later means guessing what each existing image was for. That guess is not
recoverable, which makes the taxonomy the part that has to land early even though
the feature does not.

The intended first consumer is rendition conditioning
([25 §3](25-roadmap.md)), and it is deferred for a real reason rather than a
scheduling one: passing an image to an image model is trivial, but choosing
*which* image, when six entries and three actors all carry references, is not.
That wants the location channel to exist and real sessions to tune against.

---

## 4. Treatment

The requirement, restated as an invariant:

> **A Treatment contains no world facts.** Its prose says how this world is *used
> here* — tone, framing, what the story is about. World content lives in linked
> lorebooks.

So a Treatment for Rain City does not describe Rain City. It says "hardboiled, rain
never stops, you're a fixer who owes the wrong people", carries
`lore: [ref("Rain City")]`, and lets the lorebook be the single home for what
Rain City *is*.

> **Definition: [04 §6](04-schemas.md).**

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
  treatment cannot hold locations in the first place, the question never arises —
  the editor's "add a location" action creates a lorebook entry.
- `contentRating: null` means unspecified, and consumers must prompt rather than
  assume. Taken directly from Marinara's scenario type; it is correct.

### 4.1 Plot hooks

A pool of authored, discrete, usually major plot turns that a treatment or setup
carries and a step fires at an opportune moment. "X and Y have been having an
affair and will soon announce their marriage." "The Flower Kingdom will declare
war over some damned island."

> **Definition: [04 §6.1](04-schemas.md).**

A hook carries its premise and `magnitude` — blast radius, renamed from `scope`
so the word means one thing across the portable schemas — mechanical eligibility
(`involves`, `blockedBy`, `notBefore`), and firing behaviour (`weight`,
`delivery`, `once`).

*(Corrected 2026-09-22, while the open question at the end of this section was
being closed. Both lines above named `requires` and `onFire`, and the blockquote
described the definition as carrying them "typed against the unstable rule
vocabulary while its content fields are committed". §6.1 does not: the two
fields were **removed** rather than carried with a warning, because the
vocabulary they were typed against is the 6.0 authoring tier's
([26 C7](26-open-questions.md), [work plan §0.4](workplan/01-work-plan.md)) and
a `/1` schema with two fields pointing at something unwritten is worse than a
`/1` schema without them. They return additively, so nothing here has to move
when the vocabulary arrives.)*

#### Where hooks live

**Treatments are the primary home.** A Setup may add its own on top, a session may
add its own while running ([06 §6.1](06-modes-and-turn-pipeline.md)), and a
package carries all of them by carrying the objects.

**Lorebooks may also carry hooks, optionally** — and the reason is better than
convenience. A hook is often *about* a specific piece of world content: "the
Flower Kingdom will declare war" belongs with the Flower Kingdom. Two things
follow that make this principled rather than a shortcut:

- **It travels with the thing people actually exchange.** Lorebooks are the
  universal currency of this ecosystem; Treatments are ours. A hook attached to a
  lorebook reaches anyone who imports it.
- **It gets a natural eligibility condition for free.** A hook carried by a
  lorebook is only eligible while that lorebook is active in the session. That
  is a sensible default and a mechanical justification for the association,
  rather than "it seemed handy".

**The costs, stated.** Hooks now come from up to four places — treatment, setup,
lorebooks, session — which is more sourcing than any other object has.
Mitigations are the same ones lore entries already rely on: every hook shows its
source, and editing navigates to whichever object owns it.

The real risk is conceptual drift. Lorebooks are *world facts*; hooks are
*narrative intent*. If hooks-on-lorebooks became the common path, the
separation that keeps a lorebook portable and a treatment free of world content
would erode. So: **allowed, secondary, and documented as being for hooks that
are genuinely inseparable from a piece of lore.** Treatments stay the default
answer to "where do I put this?".

Compatible export to third-party lorebook formats drops them, like everything
else we add ([04 §2](04-schemas.md)) — worth knowing, not a reason to decline.

Session creation copies hooks from all sources, per prefill-not-binding
([00 §3.1](00-stance.md)). **The valve runs the other way too, and only when it
is asked to**: a hook realised while playing is *promoted* back out onto the
treatment, the Setup or one of the books the session names — an explicit, offered
act, settled in the decision that closes this section. Copying in is what
prefill-not-binding requires; copying out is what keeps the copy from being a
one-way door, and without it the fourth source is the only one a hook can never
leave.

**Which have fired is channel state, not a session field.** *(Correction. This
said "the session tracks which have fired", and a session-level set is exactly
what [06 §8](06-modes-and-turn-pipeline.md) demolished for party membership:
kept outside channels it does not reconstruct at a node, does not appear as an
effect in the turn record, and does not branch correctly. Fire a hook, rewind
past it, and the flat set leaves the hook burnt on a line where it never
happened.)* The **pool** stays session-wide — adding a hook mid-session is an
authoring act, not a story event, and must survive a rewind — while everything
about *what has happened to* a hook is per-node and lives in a channel. That
split is also what makes a committed hook ([06 §6.1](06-modes-and-turn-pipeline.md))
implementable at all: patience, cooldown and un-commit-on-rewind are each
measured along a path.

**The copy keeps the source hook's `id`.** Not a detail: it is the only thing
that makes cross-session de-duplication possible later, and a World
([15 §5.1](15-world.md)) needs it — a hook fired in session one must not fire
again in session two of the same continuity, which is this section's own
someone-died-four-sessions-ago failure reached by a different route. Minting a
fresh id on copy would be invisible at 1.0 and unrecoverable afterwards, since
nothing would remain to match the two firings against each other.

**What makes this a distinct object rather than a use of an existing one.** It
is worth placing precisely, because it looks like three things it is not:

| Not | Because |
|---|---|
| A lorebook entry | Lore is retrieved by *relevance* to what is being discussed. A hook is selected by *narrative readiness*. Opposite criteria; a hook must stay out of context until it fires. |
| The Narrative Director's Secret Plot | That is a model-generated hidden arc. This is an author-written pool of discrete, specific events. |
| An authored rule ([02 §3](02-infinite-worlds.md)) | **A hook is the inverse of a trigger.** A trigger says "when X happens, do Y". A hook is a Y looking for its moment. |
| An `Openings` entry (§6) — for the introduction hook below | An opening is how a *session* starts; an entrance is how a character arrives in a story already running. The substructure is nearly the same and the moment is not, which is why they are two names. |

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

The introduction hook below is an **exception to where the subject is declared,
not a repeal of this paragraph**. Its subject is named in `introduces.actor`
rather than `involves` because it must be eligible only while that character is
*not* yet introduced — but the other two halves of the check, not dead and not
gone, apply to it exactly as they do here, and for the reason just given.

#### A character as a hook

> **Definition: [04 §6.1a](04-schemas.md).**

A hook can *be* a character rather than describe an event: the arrival of the
stranger, the return of the sister, the fixer who turns up when you are already
in trouble. Authors reach for this constantly and currently have to fake it by
writing "X arrives" in a premise, which loses the link to the card and gets the
eligibility exactly backwards.

**It is a hook and not an opening, and the distinction is the whole reason it
needs its own field.** An `Openings` entry is how a session *starts*; nothing
selects it, and it plays once at a moment already known. An arrival is a Y
looking for its moment in a story already running, which is the definition at the
top of this section. The alternates look identical on the page — several written
variants with a designated primary — and mean two different things, which is why
they are `entrances` and not more openings.

**`premise` is the instruction, `entrances` are the content**, the same division
[§6](#6-openings) already draws between a seed and a written
opening. An author who has written the arrival gets it woven; an author who has
only said what should happen gets it improvised. Both are useful and neither is
the degraded case.

**Firing an introduction hook writes nothing by itself, and cannot.** It is
tempting to have it add the character to the cast directly, and that is an
`onFire` effect — the vocabulary deferred to the 6.0 authoring tier ([26 C7](26-open-questions.md)).
The available path is the one [06 §5.2](06-modes-and-turn-pipeline.md) already
blesses: the hook contributes guidance, the narrator writes the arrival, and
presence follows the story like any other model-proposed change. Saying so
plainly is what stops `onFire` being reintroduced through this feature's side
door, and it has one consequence that must be designed for rather than
discovered.

**That consequence: a fired introduction hook is *provisional* until the arrival
is confirmed.** Guidance is advisory, so the narrator may ignore it. For most
hooks a miss is an annoyance. Here it is silent and permanent — the hook is
marked fired, the character never arrived, and because introduction is
once-only it never fires again. So the hook is committed as fired only when the
extraction pass confirms the character is present, and reverts to eligible
otherwise, with the attempt recorded. Same asymmetry, and the same answer, as
flagging a death rather than applying it quietly
([06 §8.1](06-modes-and-turn-pipeline.md)).

**Firing also has to supply what the assembler cannot.** A character who is not
in the session cast contributes no block to the prompt and no aliases to the
keyword pass — so without help the narrator would be describing a stranger from
the entrance text alone, and the mention resolver would fail to link the arrival
it had just written, on the one turn where the link matters most. Firing
therefore contributes the subject's card for that turn and adds their aliases to
the scan. Neither is a new mechanism; both are existing producers pointed at an
actor the cast does not yet contain.

**Only one introduction hook per character is eligible at a time.** With four
sources, the likely collision is a treatment's hook and a lorebook's naming the
same character — which is not a pathological case but the one hooks-on-lorebooks
exists to serve. `blockedBy` is manual and cross-source, so authors cannot
express this themselves. The engine picks by weight and then by source, and the
losers retire as **superseded** rather than silently: an author must never find
an entrance they wrote unused and unexplained. The same word covers the other way
this happens — the narrator introduces the character spontaneously and the
authored entrance is pre-empted. Quiet retirement is for a cast that is gone;
this is not that, and the author wants to know.

**Decision: hooks are not a shareable kind of their own. The three carriers
above are the answer, and a hook leaves a session by promotion.** *(Closed
2026-09-22. What stood here was **[OPEN]** ~~whether hooks are also a shareable
kind in their own right — a "hook pack" droppable onto any treatment~~, leaning
"not at 1.0" — which was already weaker than the position the corpus had taken
elsewhere: [26 C7b](26-open-questions.md) says flatly that "'Hook packs' as a
separately shareable kind stay declined". Two documents disagreeing about a
decline is how a decline gets relitigated, and the place the question is asked is
the place a reader asks it again, so it is answered here rather than pointed
at.)*

**The negative half is the easy one**, and the question states most of it: a
hook's value is in being specific, and a droppable pack of generic ones produces
*a stranger arrives with news* in a story that already had the stranger. The
structural objection it does not state is worse — **a pack would be a fifth
source**, added to a feature whose own cost paragraph above calls four *more
sourcing than any other object has*, and every one of those four is a mitigation
somebody has to keep working: a source label on every hook, and *edit this*
navigating to whichever object owns it.

**The positive half is that the carrier is the unit.** A hook attaches to a
Treatment by default, to a Setup when it belongs to one way of starting rather
than to the story, and to a Lorebook when it is genuinely inseparable from a
piece of world — the three above, in that order of preference, with the session's
pool as the fourth and the only one that is not an object anybody can send. That
is not a new answer; it is the answer this section already gave, and what it
lacked was anything that made it true. A hook had nowhere to be authored on any
of the three ([P7 §1.5](workplan/23-p7-implementation.md) recorded exactly that)
and no way out of the fourth, which is how a feature designed across four
carriers came to read as a session-level one.

**A hook reaches a carrier from a session by promotion, which is offered and
never automatic.** [§2.3](#23-session-local-actors) settled the shape for
session-local actors — *"Promotion to the library is an explicit user action —
and per Marinara's own conclusion, an offered one"* — and hooks are where that
sentence first became something a person can press
([10 §10.1](10-ui-surfaces.md), [api.md](../api.md),
[P11.2](workplan/28-p11-implementation.md)). It is the same rule read in the
direction that bites here rather than the one §2.3 was written for: an abandoned
session must leave nothing behind, and a hook somebody wrote at turn forty is the
one thing in it that was **authored** rather than played, so the cost of no valve
is not clutter, it is the loss of the thing
[06 §6.1](06-modes-and-turn-pipeline.md) calls most of why the feature earns its
place. Promotion does not touch the
session: the pool entry stays the session's own, because re-attributing it would
claim the target owns the running copy — and for a lorebook target it would
quietly add *eligible only while that book is active* to a hook that never had
that clause.

**So the shareable artifact is a Treatment carrying only hooks**, and it needs
nothing built. [10 §11.2c](10-ui-surfaces.md) reached the same answer one kind
over, for lore entries, and the sentence transfers intact: *an entry export is a
lorebook* — no fragment schema, nothing new to version, and the file opens in
anything that already reads the kind. A treatment whose `hooks` is the whole of
its content is a hook pack in every respect except the one that would have cost a
schema, a version, an editor, a library shelf and an import path; it rides the
export and package machinery that exists ([04 §9.1](04-schemas.md)), and a
recipient drops it in beside their own treatments rather than learning a sixth
noun.

**And one place hooks are not like entries, which is what an implementer would
get wrong by analogy.** [10 §11.2c](10-ui-surfaces.md)'s merge rule is *"ids
are book-local, so the default is add and never overwrite"*, and an incoming
entry whose id collides
takes a fresh one, on the reasoning that two books holding an entry under one id
is a sign of shared ancestry rather than permission to overwrite. **A hook id may
never be re-minted.** [15 §5.1](15-world.md) makes preserving it across a copy an
obligation — it is the only thing by which a World knows that the hook which
fired in session one is the one declining to fire in session two — and names the
failure *"unrecoverable later"*, because once two firings carry unrelated ids
nothing remains to match them against each other. So a hook arriving at a carrier
that already holds that id is **refused, not renamed**: the person is told it is
already there, which costs them a moment, where the rename costs a continuity
that cannot be reassembled afterwards. The asymmetry is the whole of it — an
entry id is local to its book, a hook id is the key a continuity is keyed by, and
the same collision therefore has opposite correct answers.

**Decision: a Treatment owns no lorebook. It only links.** A "primary lorebook"
would have made the *add a location* affordance obvious and cost more than it
was worth: it blocks **many treatments over one lorebook**, which is a normal
thing to want — a Rain City noir and a Rain City comedy drawing on the same
world — and it creates an ownership question on delete that nobody wants to
answer.

The concession is `LoreLink.required` ([04 §3](04-schemas.md)): an author can
mark a link load-bearing, and a consumer warns loudly when it will not resolve.
It never blocks ([00 §3.3](00-stance.md)). The distinction between "missing a
nice extra" and "missing its world" is worth being able to state, and that is
all the flag does.

The editor consequence is that *add a location* targets one of the linked
lorebooks — the user picks, or creates a new one and links it. Slightly more
explicit than an implicit home, and correct.

**The mirror proposal — a lorebook that owns treatments — is refused too**, and
for a reason the primary-lorebook argument does not cover. Folding Treatment into
an extended lorebook preserves many treatments over one book, so it survives the
objection above; what it spends is the *other* direction. `lore` is a list: a
noir treatment draws on Rain City, a period reference book and a shared genre
book, and no host among them is the obvious one. Nominating a host also
entangles authored intent with an imported file — an upstream update to Rain
City becomes a merge rather than a re-link. And the invariant this section opens
with, *a Treatment contains no world facts*, is currently held up by the object
boundary; inside one file it survives only as editor discipline.

What the fold is actually reaching for is two things, and both are answered
elsewhere: *"here is Rain City and here are the three ways to play it"* is the
library's backlink panel ([10 §5.2](10-ui-surfaces.md)), and *"send this world
and its framing as one thing"* is one action on the package
([04 §9.1](04-schemas.md)).

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
      treatments/
      presets/              #   default preset per mode
      setups/               #   onboarding sample
      packages/
    connections/            # admin-managed. Usable by all, readable by none.
  users/
    <handle>/
      account.json
      library/                # every object folder may carry history/ — §11.2
        actors/     <slug>/card.png        + assets/
        lorebooks/  <slug>/lorebook.json   + assets/
        treatments/   <slug>/treatment.json    + cover.png
        presets/    <slug>/preset.json
        setups/     <slug>/setup.json
        packages/   <slug>/...             (see §7)
      trash/                  # deleted objects awaiting the retention window §10.2
      backup.json             # this account's backup schedule. [P12.4]
      usage.jsonl             # what model calls that make no turn spent. Append-only. [10 §11.4]
      task-roles.json         # which role field assist asks for — a stopgap for [26 C15]
      backups/                # their own archives. Never inside another archive.
      connections/            # the user's own. Credentials never leave the server.
      sessions/<session-id>/
        session.json
        turns/000001.jsonl …   # append-only segments, never rewritten. §5.5
        snapshots/             # derived channel state, keyed by TurnId. [07 §4]
        summaries/             # derived, content-addressed. [07 §5.1], P8.0
        renditions/            # one file per rendition — the recipe. §5.5, P9.0
        assets/                # the pixels, and the one disposable directory
        attachments/           # pictures a player attached. Not disposable. §5.5, [26 E15]
  backups/              # the install's archives — [26 E6], [P12.2]
  index/
    index.sqlite        # derived. Deleting it must be a non-event.
```

***The two `backups/` directories are outside every archive***, which is not
tidiness: an archive of the archives makes every generation carry every one
before it, so the growth is in the number of backups taken rather than in the
library. The install's sits at the data root rather than inside a user
directory, for `accounts.json`'s reason — it holds everybody's work and, when it
is a full archive, their password hashes.

***~~`memories/`~~ is gone from the tree above, 2026-09-16 at P8.2.*** It sat
there from the first draft, beside `library/` and outside everything the index
walks — so a book under it would have been unindexed, unsearchable and
unaddressable, while [08 §7](08-cross-session-memory.md) asks for *a link to the
memory book itself, opening the ordinary lorebook editor*, which needs a library
address. `Layout.memoriesRoot()` existed from P1 with no caller and no directory
ever created.

**[P8 §1.1](workplan/25-p8-implementation.md) decided it: a memory book is an
ordinary library lorebook**, under `library/lorebooks/` like any other, marked
`provenance.source = 'session'`. The deciding argument was not the one that
section expected — it is that the resolver has to answer *"the memory book for
this user, actor and persona"* as a **query**, and only the library already has a
table to ask. The helper is deleted rather than left leaning, with a repo-shape
assertion behind the deletion, because *"a path helper that survives the phase
without a caller is the same defect twice."*

**Every user owns a complete, independent library.** There is no shared *user*
area and no ownership field — the path is the owner
([09 §4.3](09-server-multiuser-deployment.md)).

**`system/library/` is a full library with the same layout**, shipped with the
app, read-only, and loaded for every user alongside their own. Same structure
means the same loader, the same index code and the same UI — the merge is a
query, not a special case.

Sharing between *users* stays deferred, and this is the shape it will most
likely take: a third location read the same way. See
[09 §4.3](09-server-multiuser-deployment.md).

The rule that makes this work: **the index is never authoritative and never the
only home for a fact.** It exists for search, listing, tag queries, cross-refs
and multi-user read concurrency. A full rebuild from disk must always be
possible, must be a startup option, and should be exercised in CI. If a feature
can only be answered from the index, that feature is storing data in the wrong
place.

*Honest cost:* every write is a file write plus an index update, and the two can
diverge under crash. Mitigations: atomic replace (write temp + rename), a
startup consistency check (mtime/size against recorded values) with automatic
re-index of anything that does not match, and the write path in §5.1.1.

***The startup consistency check was built on 2026-09-27.*** The other two
mitigations were built at P1 and this one never was, though §5.1.1 below leans on
it. A start that did not rebuild looked at nothing, and the watcher starts with
`ignoreInitial`, so an edit, an addition or a delete made while the server was
stopped went unseen until the file changed again. Sessions, which the watcher
never looks at, never caught up at all: a turn that reached its segment and not
the index before a crash stayed unsearchable, as did a session folder copied in.
What the check does now (`index-db/reconcile.ts`):

- **An object** is read again when its size or modification time differs from
  what its row recorded, or when it has an error on record (an error row
  records neither, and a `chmod` can fix a file without changing either). It is
  read through the watcher's own path, so an edit made while the server was
  stopped gets the history version one made while it ran gets (§11.2). A row
  whose file has gone is forgotten.
- **A session** had no recorded values to compare. The index now keeps a stamp
  over `session.json` and its segments, written by a rebuild and by the check
  and deliberately not by the running server's own writes. A session whose
  stamp differs, which includes every session played since the last start, is
  derived again whole.
- It runs where a rebuild would, before the mode presets are written and before
  the watcher starts. Its answer is held to a rebuild's over randomised changes
  made with nothing watching.

*What it cannot see* is the limit of the check this section chose: a file
rewritten to the same length within one tick of the filesystem's clock, or given
its old time back by hand. `index.rebuildOnStart` is there for anyone who doubts
it.

#### 5.1.1 Two writers, one index

**The server updates the index synchronously for its own writes. The watcher
exists for foreign writes.** Both feed one index; neither is the only path.

An earlier draft said index updates should come from the watcher *rather than*
from application code, which is appealing — one path, no duplication, the index
provably a function of the disk. It is also wrong in a way that would not have
surfaced until the P1 demo, because it makes every write **eventually
consistent**:

```
POST /actors → write file → 201
                    ↓  chokidar: 10–100ms, unbounded under load
              watcher fires → index updated
```

A `GET` immediately after a create can legitimately miss it. That is a bad
property for the most-used API in the product: every UI mutation needs an
optimistic update or a refetch-with-retry, and **tests race by construction**
rather than occasionally.

So, two writers with different jobs:

| Writer | Handles | Timing |
|---|---|---|
| **Application** | The server's own writes | Synchronous with the file write. Read-after-write is guaranteed. |
| **Watcher** | Hand edits, git checkouts, restored backups, anything not us | Whenever it happens |

**Self-write events are suppressed**, not merely tolerated. Each application
write registers a short-lived `(path, mtime, size)` token; a watcher event
matching one is a no-op rather than a redundant re-index. Without this, `temp +
rename` produces an add/unlink pair per write and the index does every job twice.

**Nothing the design values is given up.** The index remains derived, disposable
and rebuildable from disk; a feature that can only be answered from the index is
still storing data in the wrong place; and hand-editing still works, because that
is a foreign write and foreign writes are exactly what the watcher is for.

**The CI check gets stronger, not weaker.** "Rebuild-from-disk equals incremental
index" ([work plan P1](workplan/01-work-plan.md)) now has two producers to hold to one answer,
which is a sharper assertion than one producer agreeing with itself.

*What this costs:* a crash between the file write and the index update leaves a
divergence the watcher would have caught. That is what the startup consistency
check above is for, and it was needed regardless — the same crash can land
between temp and rename.

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
anything** ([10 §11.3](10-ui-surfaces.md)). What the card *emits* is a copy that
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
typed role plus ~~bytes~~ **a reference to bytes the container resolves**
([04 §3](04-schemas.md)) — corrected 2026-09-13, because `bytes: Uint8Array` is
the draft 04 §3 explicitly rejected: it has no representation in JSON Schema and
no meaning inside a `.sepack`, where there is no PNG chunk to point at. Roles:
`portrait-source`, `reference`, `expression`, `pose`, `style`, `map`, `gallery`,
`background`. *~~Six~~ eight — `map` arrived with lore media and `background` at
[P7.9](workplan/23-p7-implementation.md), for a backdrop that had no role naming
what it is. 04 §3's listing was corrected on the same day and this parallel one
was missed, which is the argument for one of the two being a copy rather than a
second statement.*

**Roles are typed from the start, and that is the part worth insisting on now.**
A flat list of images is cheap and forecloses everything downstream: an image
pipeline needs to know *which* picture is the canonical likeness and which is a
costume variant. Retrofitting roles onto a flat list means guessing, so the
taxonomy goes in at 1.0 even if only two roles are populated. This is the format
prerequisite for the Character Studio ([18](18-character-studio.md), 3.0).

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

**[OPEN]** ~~The cap. A few MB is shareable; tens are not. Needs a default and a
visible indicator in the editor, since a card that silently grew to 80 MB is a
bad surprise at share time.~~

***Separated 2026-09-14, because this sentence asked for two things and only one
of them is wanted.*** **The requirement is the indicator.** A few MB is
shareable and tens are not, and a card that silently grew to 80 MB is a bad
surprise at share time — **so the editor has to show the number.** *The cap
is a different question and a weaker one*: a hard limit turns a bad surprise at
share time into a refusal at edit time, and refusing somebody's own file on
their own install is the worse of the two failures. If a default lands at all it
should be a warning threshold that the indicator crosses, not a write that
fails.

**Deferred, with the condition rather than a date.** Found unowned by
[P11 §0.1](workplan/28-p11-implementation.md)'s sweep and deferred there on the
stated ground that the audience is currently the developer and people treating
this as a development project, for whom an 80 MB card is a curiosity rather than
a broken share. **That is checkable and it expires**: the deferral ends when the
audience does, which is the same moment [P10](workplan/27-p10-implementation.md)
makes the install reachable by somebody who is not the developer.

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
  ([10 §1](10-ui-surfaces.md)), so nothing on the user's machine would declare
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
| Hand-editable on disk ([10 §4](10-ui-surfaces.md)) | Requires unzip/rezip to change one field |
| Watcher-fed index sees per-file changes ([09 §6.2](09-server-multiuser-deployment.md)) | Whole archive re-read on any change |
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
treatment for any lorebook or treatment that carries assets.

### 5.3 Asset manifest

`assets` on the actor is a manifest of *relative paths within the actor folder*,
never absolute paths and never paths outside the folder. This is what keeps the
folder self-contained and drag-portable, and it is the check that prevents a
malicious package from writing outside its own directory.

### 5.4 Everything else is JSON

Lorebooks, treatments, presets: plain JSON, formatted for humans, one object per
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
`session.json` holds metadata, cast, branch refs and the **head channel
snapshot** — derived, not authoritative (§8.1).

**Turns are append-only JSONL segments**, rolling on whichever limit is reached
first — a turn count or a byte size. Not one file per turn (thousands of small
files for a long campaign), and not one growing document (rewritten on every
turn).

```
sessions/<id>/
  session.json
  turns/000001.jsonl … 000014.jsonl     # append-only, never rewritten
  renditions/<rendition-id>.json        # the recipe: prompt, seed, parameters
  assets/<rendition-id>.png             # the pixels
  attachments/<sha256-hex>.<ext>        # pictures a player attached — 2026-09-27
```

***Two directories rather than one, and the split is the whole of §10.7's
promise*** — drawn 2026-09-16 at [P9.0](workplan/26-p9-implementation.md).
`renditions/` holds the record and `assets/` holds the output of running it, so
*"deleting one leaves `asset: null` and a picture that can be made again"* is a
statement about two paths rather than about two fields in one file. **Deleting
`assets/` costs money and deleting `renditions/` costs history**, which is the
sentence an eviction policy has to be able to act on and could not if the recipe
lived inside the thing being evicted.

*One file per rendition rather than one per turn*, because a rendition is written
by exactly one job and read by everybody: two workers finishing two pictures of
one turn would each rewrite a shared file and the second would win. It is
`snapshots/` and `summaries/` at the level below, for the reason those two are
one file per key.

**Neither root is a `Layout` method**, and that is deliberate rather than an
omission. `summariesRoot` and `snapshotsRoot` are module functions in the modules
that write them, and this is how a session subdirectory has always been added
here — which is also why [P8 §1.1](workplan/25-p8-implementation.md)'s rule
against a dangling path helper is honoured by not creating one rather than by
timing it.

**`assets/` is where renditions put their pixels** — illustrations and backdrops
alike ([06 §10](06-modes-and-turn-pipeline.md)) — and it is the one directory
here whose contents are **deliberately disposable**. The record of a rendition
lives in the turn log with its prompt, seed and parameters; the file under
`assets/` is the output of running them. Deleting one leaves `asset: null` and a
picture that can be made again, which is what lets an eviction policy be a later
decision rather than a migration ([26 E3](26-open-questions.md),
[06 §10.7](06-modes-and-turn-pipeline.md)).

Two consequences worth stating where the layout is, because both are easy to get
backwards:

- **The backdrop is not stored anywhere else.** A backdrop shown across fifty
  turns is one file here, pointed at by channel state
  ([06 §10.1a](06-modes-and-turn-pipeline.md)) — not copied per turn, and not
  promoted into the library. It is session content, and it travels and deletes
  with the session (§10.3).
- **Size lands here rather than in the turn log.** §5.5's *keep everything* is a
  claim about records, which run tens to a couple of hundred megabytes for a
  thousand turns. Generated media is a different order of magnitude and a
  different policy: the records are kept because they are small and
  irreplaceable, and the pixels are evictable because they are neither.

***`attachments/` is the third directory, and exists because `assets/` is
disposable*** — added 2026-09-27 with R1 of
[26 E15](26-open-questions.md), pictures on a player's move. Everything in
`assets/` has a recipe that makes it again; a picture somebody uploaded has
none, so in `assets/` the first eviction policy anyone wrote would delete the
only copy of something a person made. The two directories differ on exactly the
axis the paragraph above draws:

- **Content-addressed**, `<sha256 hex>.<ext>` with the extension read from the
  bytes' own signature: a picture attached twice, or carried across by a redo,
  is one file and two references.
- **Written atomically**, the library's posture rather than the renditions',
  because a torn upload cannot be made again.
- **Swept, never evicted.** A file goes only when no turn in the session names
  it — every turn a reader sees, siblings included — *and* nobody has wanted it
  for a day, which is the composer's grace: an upload waits in the composer,
  unnamed, while the session goes on committing. *Wanted* is an upload or a
  submitted move naming it, either of which renews the file. Walking the head
  path would be the obvious reachability function and would delete a swipe's
  pictures. *A tombstoned turn is not a reference*: the reader skips it, and
  whether a pruned branch keeps its pictures is for whoever designs pruning.
- **Contained where it lands.** Every path is resolved against the real session
  folder, as the library's asset paths are (§5.3), so an
  `attachments` that is a link leads nowhere.
- **The turn names it; the turn is not changed by it.** The record is
  `input.attachments` (§8), and the pixels are never copied into it.

*A module function rather than a `Layout` method*, as the other two are.

#### File order is creation order. Reading order is a tree walk.

This is the decision that makes branching a non-issue for storage, and it is
worth stating because the natural instinct points the other way.

Turns form a tree ([07 §3](07-branching.md)), and the tempting move is to make
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
branch subtree ([25 §1.4](25-roadmap.md)) does, and retrofitting deletion into a
format that assumed pure append is a migration rather than a feature.

**Retention: keep everything.** No automatic compaction of old records
([26 B3](26-open-questions.md)). A full record runs roughly 10–100× its message
text, so a thousand-turn session is tens to a couple of hundred megabytes —
acceptable, and the reason the layout above matters.

---

## 6. Openings

Requested as two types, each with primary and secondary alternatives. Defined
once and reused on Actor, Treatment and Package.

> **Definition: [04 §3](04-schemas.md).**

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
  ([04 §3](04-schemas.md)).

  Promotion targets the object the seed came from — a treatment, an actor, a setup
  — not the session, which keeps its own copy regardless.

***The written half is built, for a Setup's openings, at
[P15.3](workplan/33-p15-setup-from-a-turn.md)*** (2026-09-26). Creating a session from
a Setup plays its primary written opening, or the one the request names, as the
session's first turn: the opening's text as output, no input, no call, and the
effects that seed what the Setup carries ([04 §7.2](04-schemas.md)). `null`
starts cold. The seed half — expand, edit, accept, promote — stays with the
revisit [P7B §1.11](workplan/24-p7b-presets-and-prompts.md) left it to, ~~and a
treatment's or an actor's openings are still read by nothing~~ *and a
treatment's openings are still not played at creation.*

***Corrected 2026-10-03, at the merge that brought this into `main`:*** *an
actor's openings are read*, and had been since
[P14.4](workplan/31-p14-scene-and-session-import.md) (2026-09-30), on `main`
while the sentence above was on a branch that could not see it. In a mode that
declares `openingTurn`, a session whose cast carries written openings opens on
them as **greetings** — an output-only turn holding one message per cast member
with a written opening, a single character's alternates as that turn's
siblings, a group's chosen per member at creation. So two written halves were
built, one for each object, and both write turn 1. **Which plays is decided, by the owner, on the
same date: when a Setup carries a written opening, the Setup's opening is the
session's first turn, always, and the cast's greetings are not used for that
session** — whichever of the Setup's openings is chosen, and even when the
session starts cold. A Setup with no written opening leaves the greetings as
P14.4 has them. The reasoning is [P15 §1.7](workplan/33-p15-setup-from-a-turn.md)'s,
and [26 B18](26-open-questions.md) records the decision where every document it
touches can find it.

---

## 7. Setup and Package — two jobs, split

> **Definitions: [04 §7](04-schemas.md) (Setup), [04 §9](04-schemas.md) (Package).**

An earlier draft had a single `Package` doing both jobs: it carried an `entry`
block defining the game *and* the bundling machinery for moving objects. Splitting
them makes both simpler, and the split is worth stating as a rule:

| | |
|---|---|
| **Setup** | *What a game is.* Mode, treatment, cast, preset, opening. An ordinary library object. |
| **Package** | *How objects travel.* An arbitrary bundle, for moving anything between installs. |

**Sharing a full game is putting a Setup in a Package.** The Setup is the game;
the Package is the envelope.

### 7.1 Why Setup is a plain object

- **It is useful without ever being shared.** Saving "my Rain City campaign
  configuration — this treatment, this cast, this mode config" for your own reuse
  should not require building a transport artefact with embedded copies and a
  dependency manifest. Under the old shape it did.
- **It completes a reframe we half-adopted.** Marinara's scenario design
  identified and deferred "make Setting the first-class entity and scenarios its
  children" ([01 §1](01-source-survey.md)). We took the parent and never built
  the child. One Treatment, many Setups: *Rain City* is the world, *Rain City,
  noir* is a treatment of it, *The Fixer's Debt* is a game played under that.
- **It gives the session-to-setup direction a shape.** Marinara's
  play-first-share-afterwards snapshot becomes "emit a Setup from this running
  session" — a real object rather than a text file.

### 7.2 Why Package gets simpler, and stabler

Reduced to a container, Package has almost no surface of its own:

- **Contents are self-describing.** Each object carries its own `schema`, so the
  package does not enumerate kinds — and therefore does not change when a new
  portable kind appears, as Setup just did. This is why
  [04 §1](04-schemas.md) can now treat it as stable rather than `/0`.
- **No `entry` field.** A package holding one or more Setups is startable; that
  *is* the mechanism. A package with no Setup is a content drop — *"here are five
  characters and a lorebook"* — which is a perfectly reasonable thing to share
  and had nowhere to live before.
- **Contents are embedded copies, resolved on import** into the recipient's
  library (with a "these already exist, link or duplicate?" step). Links resolve
  within the package first, then locally, then dangle visibly. The only reliable
  way to ship something working to someone whose library you know nothing about.
- **`requires` is declared and checked at import**, producing "this wants
  Campaign ≥ 2 and an image connection; you have neither" rather than a
  broken session later. A warning with a degraded-start option where possible,
  not a hard block.
- **No production settings, in either object.** No connection ids, no keys, no
  endpoint URLs, no per-install toggles — enforced by there being nowhere to put
  them ([00 §3.2](00-stance.md)).
- **Filling one is a single action.** Export-as-package walks outbound
  references from whatever you exported and collects the closure — a treatment's
  lorebooks, its cast, the actors' own lorebooks — then shows it for review
  ([04 §9.1](04-schemas.md)). This is the piece that keeps the object split from
  costing anything at exchange time: a Treatment stays independent of any one
  lorebook (§4) and is still shareable as one self-contained artefact, because
  the bundled form is produced on demand rather than being the storage shape.
- On disk a package is a folder, zipped as `.sepack` for exchange
  (§5.2.3).

**[OPEN]** Can a package ship an extension/mode *implementation*, or only declare
a dependency on one? Shipping code makes packages far more powerful and makes
importing one a code-execution decision. Strong lean: **declare only** at 1.0
([26 A2](26-open-questions.md)).

**[OPEN]** Should a package be able to ship a partially-played session as a
starting state (a "pre-run prologue")? Attractive for authored content, and it
crosses the content/session line the rest of the model keeps clean. Note the
split makes this cleaner to reason about: it would be a *session* in a package,
not a variant of Setup.

---

## 8. Session and the turn record

```ts
interface Session {
  id, name, createdAt, updatedAt
  // No owner or visibility field: the session lives under its owner's
  // directory, and there is nobody to share it with. [09 §4.3]
  participants: UserId[]          // length 1 at 1.0 — see [09 §8]

  mode: { id: ModeId; config: unknown }
  preset: Preset                  // resolved copy, not a link
  origin: Provenance              // which Setup/version seeded this. Provenance only — a dead link.

  cast: {
    /** The one static member. Chosen at setup; changing it is an explicit act
     *  rather than an outcome of play, so it needs no per-node history. */
    persona: ActorId
    // Party, control and narrator are NOT here. Like presence and status they
    // change as a result of turns, so they are channels — `se.party`,
    // `se.narrator` — reconstructed per node and branching correctly.
    // [06 §8, 06 §8.1]
  }
  localActors: Actor[]
  lore: Ref<Lorebook>[]

  /** THE HEAD SNAPSHOT, not the source of truth. Channel state is
   *  reconstructed by replaying effects ([07 §4](07-branching.md)); this is a
   *  materialisation of it at `headTurnId`, derived and regenerable. It lives
   *  here so a human opening the file can read the clock. §8.1 */
  channels: Record<ChannelId, ChannelState>

  // Turns form a tree, not a list — see [07 §3](07-branching.md).
  headTurnId: TurnId              // where the user currently is
  branchRefs: BranchRef[]         // names bookmarking nodes; swipes need no record
}
```

**The field shipped as `name`, and it is optional to fill in.** This sketch said
`title` and nothing ever recorded the rename; the shape actually on disk is
`SessionFile` in `packages/server/src/sessions/types.ts`. A session may be started
without a name and renamed at any time — it is id-addressed, so unlike a library
object nothing is derived from the name and frozen — and an unnamed one stores
`""`, which clients render as *Untitled session* ([26 E13](26-open-questions.md)).
The rest of this block is older than the implementation in other ways too:
`participants`, `origin` and `localActors` are not on `SessionFile`.

`origin` is provenance only. Per [00 §3.1](00-stance.md), editing the source
treatment later must not affect this session.

***A copy of the mode's own pack gains what the mode ships later*** (2026-09-27).
`preset` is a resolved copy, and for a pack taken from the library it stays
exactly that: editing the library's preset reaches no session. But nothing ever
brought a copy of the **mode's own** pack up to date either, so a session begun
on the first alpha went without the summary slot, the goal slot and the pacing
levels for good — its story above the window never reached a prompt — and the
only remedy, switching to the mode's own, discarded every edit made to the copy.
A copy that carries the id of its mode's default is now read with each block and
level list the mode ships and the copy lacks, placed where the mode puts it
(`sessions/preset-of.ts`), at every read and never written back. **Presence is
the test, never state**: a block switched off stays off, and an edited block
keeps its edit. *A change to a block the copy already has still reaches new
sessions only* — telling an unedited block from an edited one needs a digest per
block recorded at the copy, which sessions do not carry yet.

### 8.1 `session.json`'s channel state is the head snapshot

Worth stating plainly, because the naive reading produces a bug that only
surfaces at P6 and is expensive by then.

A session is a **tree** ([07 §3](07-branching.md)), so "the channel state of a
session" is not a thing that exists. State exists *at a node*, and is
reconstructed by replaying effects from the nearest snapshot
([07 §4](07-branching.md)). A single `channels` map in `session.json` can
therefore only mean **state at `headTurnId`** — and it is derived, exactly like
the snapshots under `snapshots/` and the SQLite index. Deleting it must cost a
recomputation and nothing else.

Read as authoritative instead, it becomes a mutable state blob that switching
branches has to rewrite — which is the same failure
[07 §5.1](07-branching.md) rules out for rolling summaries, arriving by a
different door.

**So why keep it in the file at all?** Because [00 §3.4](00-stance.md) means
someone will open `session.json`, and a session file that cannot tell you what
time it is in the story fails the legibility promise the storage design is built
on. Materialising the head is cheap and it is the one snapshot that is always
wanted.

#### Hand-editing it writes an effect

The move that keeps both properties, and it is worth having for its own sake.

A user who edits `channels.hp.current` in the file on disk has expressed an
intent, not corrupted a cache. On load, the engine compares the file's channel
state against the state replayed at head, and **any divergence becomes a
user-authored `ChannelEffect` appended at the head** — attributed, visible in the
turn record, and reversible like any other effect.

- The effect log stays the single source of truth.
- Editing your own data on disk ([10 §4](10-ui-surfaces.md)) works for sessions
  and not only for library objects, which it otherwise would not.
- The change survives branching, appears in the workbench, and can be undone.
- **A stale snapshot is self-healing rather than dangerous**: if the divergence
  came from a bug rather than a person, it still lands as a visible effect
  someone can inspect, instead of silently persisting.

The alternative — treating the file as authoritative — buys the same editability
and costs the branching model.

### The turn record is a first-class artefact

This is the point where the requirement that "call construction UI ranks with the
chat UI" becomes a data-model decision rather than a UI decision.

```ts
interface Turn {
  id: TurnId                     // stable, opaque — never (branch, index); [07 §3]
  sessionId: SessionId
  parentTurnId: TurnId | null    // the tree edge. Siblings are swipes/branches.
  createdAt: string
  input: { actorId: ActorId | null; kind: InputKind; text: string; raw: string
           /** Pictures on the move — 2026-09-27, [26 E15] R1. Each has an id,
            *  an open `kind`, the digest, and the type, size and pixel
            *  dimensions the server read from its own store (optional, so a
            *  record whose bytes never arrived can still say a picture was
            *  there), and the player's caption. An annotation: `text` stays the
            *  player's words, never an `[image]` marker. */
           attachments?: { id; kind; digest?; mime?; bytes?; width?; height?; caption? }[] }

  /** One entry per model call, each carrying its own `blocks` and `budget`
   *  (P3.0) — "one per model call" made shape rather than promise. Blocks are
   *  re-collected per call, so the same block id can recur across calls with
   *  different verdicts; the runner used to overwrite one turn-level table,
   *  which left earlier calls' ids naming rows no longer in it. The turn's
   *  blocks are a derived union readers fold; nothing stores the union. */
  request: {
    calls: ModelCall[]           // params, model, messages — and its blocks + budget
  }

  /** `toolCalls` is deliberately absent: no `ToolCall` type is defined anywhere
   *  in this design, and no adapter reports one distinctly. It arrives with the
   *  first step that needs it rather than as a field nothing can fill.
   *  `messages` — P14.0, [P14 §1.1]: one per speaker, each `{ speaker: Ref |
   *  null, text, reasoning?, carried?, original? }`, null the narrator. A turn
   *  is still one node however many it holds, and when they are present `text`
   *  is derived from them — their texts joined by a blank line — so every
   *  reader of `text` keeps working. */
  output: { text: string; reasoning?: string; messages?: OutputMessage[] }
  /** Terminal only — a turn in flight lives in the operational store ([P2 §2.10]). */
  status: "complete" | "failed" | "suspended"
  /** Every draw the turn consumed, keyed by site ([20 §14.6]). */
  tape: Tape
  /** A tombstone the reader skips. Nothing removes turns at 1.0; pruning a
   *  branch subtree does (§5.5). */
  removed?: true
  /** What each step did — the durable counterpart of the `step.*` progress
   *  events. [09 §3.3](09-server-multiuser-deployment.md) opens by saying the live view *is*
   *  this record being built, which only holds if every event has somewhere
   *  durable to land; without this, `step.skipped` and `step.failed` are
   *  live-only and the history view disagrees with the live one about what
   *  happened. Added at P2.5, with the runner that produces them. */
  steps: StepOutcome[]
  effects: ChannelEffect[]       // proposed and applied changes. Invertible at the tip; see [22 §1.2.1]
  /** Resolved references into `input.text` and `output.text`, as an overlay.
   *  The text itself is never rewritten with markup. [06 §8.2, 10 §13.1]
   *  ~~`mentions: MentionSpan[]`~~ — renamed 2026-09-11, see below. */
  spans: TextSpan[]
  cost: { promptTokens, completionTokens, wallMs, model, money? }  // money: 2026-09-27, [26 E16]
}

interface TextSpan {
  /** Which text this indexes into — the two are stored separately. A different
   *  record supplies its own field names; this union is the turn's. */
  field: "input" | "output"
  /** Character offsets. Recomputed when a message is edited. */
  start: number
  end: number
  /** **Tagged, from the first span ever written** — [13 §13]. */
  target: SpanTarget
  /** How the span came to be asserted. Rendered differently per method, because
   *  a tentative match that looks certain is worse than no highlighting.
   *  [10 §13.1] */
  method: "explicit" | "matched" | "proposed"
  /** Only meaningful for "proposed". */
  confidence: number | null
}

/** **One arm at 1.0, and the tag is the whole point.** [13 §13] needs three
 *  consumers of one span shape — mentions, machine-written provenance and beat
 *  positions — and the second two are Write's, at 2.0. Adding them is then an
 *  arm rather than a migration. Shaped like `BlockSource` (§8) deliberately:
 *  this codebase already has one tagged-reference vocabulary and does not need a
 *  second. */
type SpanTarget =
  | { kind: "actor"; ref: Ref<Actor> }
```

***Renamed and re-shaped 2026-09-11, at [P7](workplan/23-p7-implementation.md)
§1.7's request, and this document is the one that had to change because it is the
one somebody reads while writing the record.***

**`MentionSpan` was §1.7's failure case verbatim.** [13 §13](13-write-mode.md)
calls the span overlay *"Real, and the largest"* obligation Write places on 1.0:
Write needs three consumers of one span shape, so *generalises* has to mean **a
tagged reference from the first span ever written**, and the type must not carry
an actor reference in its name or its shape. The old type was named for mentions,
carried `ref: Ref<Actor>` directly, and sat under a turn field called `mentions`
— failing that on all three counts, in the document an implementer follows.

**`Ref<T>`'s parameter is phantom, which is why a tag was needed rather than
merely tidy.** [04 §3](04-schemas.md) defines a `Ref` as `{id, name,
fingerprint?}`; the `<Actor>` is documentation and erases on the way to JSON. A
stored span whose `ref` had no `kind` would be a span that cannot say what it
points at — and a reader added later could not tell an actor span from a beat
span without guessing from context.

**Three documents gave three shapes and now give one.** [06 §8.2](06-modes-and-turn-pipeline.md)
wrote `{ start, end, ref, method, confidence }` with no `field`, which is
ambiguous over a record that stores two texts; this section had `field` and the
actor baked in; §1.7 said only what the type must not be. `field` is kept — the
turn does store two texts — and 06 §8.2 now points here rather than restating a
shape.

*Nothing implements this yet, which is what made the rename free:
`packages/shared/src/turn.ts` records the field as the one part of this section
still absent, fenced to P7's `extract` step. It is corrected there too.*

```ts
interface AssembledBlock {
  id: string
  /** The rendered text. Present because the workbench maps every sent byte back
   *  to the block that produced it, which a reference alone cannot do. */
  text: string
  /** One vocabulary, shared with the preset's slots — [22 §1.1]. Carries the
   *  identifier too (*which* lore entry), so provenance is clickable. */
  source: BlockSource
  reason: string                 // "keyword match: 'cathedral'" / "always" / "pinned by user"
  role: "system" | "user" | "assistant"
  tokens: number
  included: boolean
  droppedBy?: string             // which budget rule dropped it
  /** Carried from the candidate (P3.0). With `purpose` on the call, this is
   *  what makes [testing §1]'s invariant — no advisory block in an
   *  effect-producing call — expressible over a committed record. */
  advisory?: true
  /** A picture on a player's move, and whether its pixels went — 2026-09-27,
   *  [26 E15] R1. Decided per call: `{ attachmentId, digest, mime, sent,
   *  withheld? }`, where `withheld` says why the block's text went instead —
   *  `unknown-kind`, `outside-window`, `not-user-role`, `missing-bytes`,
   *  `model-text-only` (the model last when several hold) — or `budget`, when
   *  the budgeter dropped the block (a picture in history, or a step's own)
   *  and neither went. A disclosure
   *  rather than a not-filled slot, because the picture *did* emit something:
   *  its words, which are `text`. */
  image?: BlockImage
}
```

**A slot that collected nothing enters the record** — as a `notFilled` entry
beside the call's blocks (`{ blockId, source, reason }`, the reason a class:
`disabled`, `not-applicable`, `no-producer`, `empty-source`, `unknown-slot`),
never as a block: `included` stays two-valued, because a slot that produced no
candidate has no text, no tokens and no budget ruling, and a row among the
blocks would be a block-shaped hole. The reason travels as a class rather than
prose, so the panel's answer to *"why is there no lore in this prompt"* is a
rendering of the record rather than a recomputation. (Decided at P3.0,
closing the question [P3 §7.5] carried; on the first real turn measured, ten
of twelve preset blocks left no row and the record could not say why.)

**`request`, `output`, `cost` and `steps` are absent rather than empty when
nothing happened.** A turn recording a hand edit to `session.json` (§8.1) made no
request, ran no steps and sent no message — and an empty `request` there would
be a record claiming a prompt was built. *Absent* and *empty* are different
claims, and the workbench renders the difference.

**`ModelCall`, `BudgetVerdict`, `ChannelEffect`, `ChannelState` and `BlockSource`
are defined in [22](22-internal-contracts.md).** They are internal and free to
migrate ([04 §1](04-schemas.md)); they are written down because the assembler
cannot be built against a reference. `ChannelEffect` is the one worth reading
before writing any of this — it carries the reversibility
[07 §2](07-branching.md) depends on.

Aventuras stores a `retrievalSnapshot` annotated "Diagnostic only — nothing reads
it back", and Marinara has an Active Context popover plus a debug-only Injections
tab. Both are the same instinct arriving as an afterthought. Making the turn
record complete and permanent buys, from one decision:

- "why did it say that" — fully answerable, after the fact, with no debug flag
- deterministic replay and regeneration with an edited block
- honest per-turn cost accounting
- the prompt workbench in [10](10-ui-surfaces.md), which is otherwise a
  reimplementation of the assembler
- reproducible bug reports that don't require the reporter's library

There is a fifth consequence that only became visible later, and it is the one
with the sharpest test attached: **`effects` being complete and reversible is
what makes branching a pointer rather than a copy** ([07 §2](07-branching.md)).
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

> **Definition: [04 §3](04-schemas.md).** A `Ref` is `{id, name, fingerprint?}`.

Resolution order, everywhere, per [00 §3.3](00-stance.md): exact id →
case-insensitive name → show as missing and continue. `fingerprint` lets the UI
say "this lorebook has changed since this package was built" without blocking
anything. Marinara's `resolveGameSetupImport` already does the first two steps
and reports misses as warnings; the third is the addition.

---

## 10. Deletion

Unspecified until now, and it is the most frightening operation in the product.
[00 §3.3](00-stance.md) makes a broken reference *survivable*, which is necessary
and not sufficient: it says the sessions still open after you delete an actor, not
that you meant to.

The gap is worth naming plainly, because this design otherwise sells safety hard.
Branching means you can always go back ([07](07-branching.md)); full history means
nothing is lost to summarisation ([26 E1](26-open-questions.md)); files on disk
mean you can always get your data out (§5). Against all of that, an unqualified
Delete button is the one place where *gone* means gone — and the first person to
lose a character they had spent an evening writing will not be consoled by the
sessions still loading.

Two mechanisms, both cheap because the pieces exist already.

### 10.1 Reference counts before the fact, not after

The derived index (§5.1) already knows every inbound reference — it exists partly
to answer "which treatments link this lorebook" for the library's bidirectional link
view ([10 §5](10-ui-surfaces.md)). Pointing the same query at the delete
confirmation costs nothing:

> Delete **Vera Kohl**?
> Referenced by **12 sessions**, **3 treatments** and **1 package**.

That is the whole feature. It converts a decision made blind into one made
informed, and it uses a query that has to exist anyway.

**It never blocks.** Counts inform; they do not veto. A user deleting something
with forty references may well be doing exactly what they intend, and a product
that refuses would be substituting its judgement for theirs — which is also the
[00 §3.3](00-stance.md) posture applied one step earlier: *visible, and
non-blocking*.

### 10.2 Trash, with a retention window

**Deleting moves the folder to a per-user trash. A sweeper removes what has been
there past the window.**

```
/data/users/<handle>/
  library/            the live objects
  trash/              deleted objects, awaiting the window
```

The reason it is nearly free is the same reason the storage design keeps paying:
**the folder is the object** (§3.4 of [00](00-stance.md), §5.2 here). Deletion is
a move, restoration is a move back, and neither needs a serialisation format, a
tombstone convention or a schema. The index treats trashed objects as absent —
they do not appear in the library, do not resolve as references, and do not match
search. Restoring re-indexes them. *(2026-09-27: for a session it did not, until
now — the restore left it to the watcher, which does not look under `sessions/`,
so a restored session was listed and never matched a search again. The restore
indexes what it puts back, sessions through the rebuild's own derivation.)*

Four properties worth fixing now:

- **The window is a treatment with a sane default**, not a constant. Someone
  running this on a NAS with 8TB and someone on a Pi have different opinions and
  both are right.
- **Trash is per-user**, under the user's own directory, like everything else
  ([09 §4.3](09-server-multiuser-deployment.md)). No shared trash, no admin
  reviewing other people's deletions.
- **Purge is available and honest.** *Delete permanently* exists, says so, and
  skips the trash. The point of the window is to make the ordinary path
  recoverable, not to make deletion impossible for someone who means it.
  *Two corrections, 2026-09-27.* The window never expired anything on a server
  restarted more often than daily, because the sweep's only timer was a daily
  interval; it now has a pass a minute after the start, and skips a pass when
  the wall clock has jumped. And a session's prompts and prose outlived its
  purge in the operational store, which kept every turn's draft and events;
  those are collected now, a day after the turn (21 §5.1).
- **Trash is excluded from export and from backup by default**
  ([26 E6](26-open-questions.md)) — restoring a backup should not resurrect
  everything the user threw away before taking it. ***This sentence had no
  enforcer from P4 until [P12.0](workplan/29-p12-implementation.md)***: delete
  became a move at P4.4 and `tools/backup.mjs` archived `trash/` along with
  everything else. Both the script and `backup/archive.ts` exclude it now.

### 10.3 Sessions delete the same way, with one addition

A session is a folder too, so §10.2 covers it unchanged. What sessions want on
top is a state that is not deletion at all:

**Archive.** Hidden from the default list, fully intact, restorable, never swept.
Most sessions people stop playing are not sessions they want gone — they are
sessions they want out of the way, and offering only Delete for that pushes people
into a destructive action to solve a cosmetic problem. It also pairs with the
concluded state a finished goal chain produces
([06 §7.3.4](06-modes-and-turn-pipeline.md)), which is already "over but kept".

**What deletion does not do:** it does not reach into other sessions to remove
what this one wrote. A session that promoted an actor to the library, or wrote a
cross-session memory ([08](08-cross-session-memory.md)), leaves those behind —
they are separate objects, owned by the library, and quietly deleting them because
their origin was removed would be a much worse surprise than leaving them. Same
reasoning as the escaped-effects warning on branch pruning
([07 §7](07-branching.md)), and the delete confirmation should say so when it
applies.

---

## 11. Version history on library objects

**Every library object keeps its own edit history, automatically.** Editing an
actor, lorebook, treatment, setup or preset snapshots the state being replaced, and
any earlier state can be inspected, compared, or restored.

Adopted from Marinara, which implements this for character and persona cards
(`packages/server/src/services/storage/characters.storage.ts`,
`packages/shared/src/types/character.ts`) and gets the hard parts right. What
changes here is the storage substrate and the scope: Marinara keeps versions in a
database table for two card types; ours are files, for every kind.

### 11.1 What Marinara gets right, and is worth taking unchanged

Four behaviours, each of which is the non-obvious choice:

- **Snapshots are automatic, not requested.** There is no "save a version"
  button. Any write that actually changes something records the previous state
  first. A feature that depends on remembering to use it protects nobody, and
  the moment you want history is *after* the edit you regret.
- **No-op writes do not snapshot.** The write path compares content, comment and
  image before recording anything. Without this, every autosave and every
  round-trip through an editor produces an identical entry and the history
  becomes unreadable within a day.
- **The snapshot carries the replaced state's own timestamp**, not the moment it
  was superseded. Marinara's comment on this is exact — *"so a restored version
  keeps its real date in history"*. A version dated when it stopped being current
  tells you nothing; dated when it was authored, the list reads as a timeline.
- **Restore is itself an edit.** Restoring snapshots the current state first, in
  one transaction, so going back never destroys what you were on and an
  interruption cannot leave a half-applied card. Marinara skips the snapshot when
  the current state already equals the target, which is the same no-op rule
  applied to the same problem.

And two fields worth keeping verbatim: **`source`** — what made this change
(`manual`, `assist`, `extension`, `import`, `restore`) — and **`reason`**, free
text that is sometimes generated (*"Saved before restoring an earlier version"*)
and sometimes the user's.

`source` earns its place here more than it does in Marinara, because more things
edit objects in this design: field assists ([10 §11.1](10-ui-surfaces.md)), the
assistant's proposals ([23 §4](23-extensions.md)), and import. *"Who changed my
character"* is a question with several possible answers, and the history is where
it gets one.

### 11.2 What has to change: versions are files

Marinara stores versions in a table. That is not available here — the database is
a derived index and deleting it must be a non-event (§5.1), so anything held only
there would be lost on a rebuild.

**History lives inside the object's own folder.**

```
library/actors/vera-solano--01h9x2/
  actor.json
  card.png                    derived
  history/
    index.jsonl               append-only: one record per version
    v/<sha256>.json           the snapshot payloads, content-addressed
  assets/
```

Four consequences, and the second is the one that makes this design better than
the database version rather than merely equivalent:

- **History travels with the object.** The folder is the object
  ([00 §3.4](00-stance.md)), so dragging it out takes the history along. Nothing
  extra to export, nothing left behind.
- **Hand-edits get history for free.** A foreign write — someone editing
  `lorebook.json` in a text editor — reaches the engine through the watcher
  (§5.1.1), and the engine snapshots the *previous* state before re-indexing. So
  breaking a file by hand is recoverable, which is a promise Marinara structurally
  cannot make and which this design gets as a side effect of the storage thesis.
  It is also the strongest argument for building the mechanism in P1, when the
  watcher exists and no editor does.
- **Media dedupes automatically.** Snapshots reference embedded media by digest
  ([04 §3](04-schemas.md)), so forty versions of an actor whose portrait never
  changed store the portrait once. The payloads are JSON and small; without this
  the feature would be unaffordable for actors specifically.
- **Content-addressed payloads dedupe too.** Edit, revert by hand, edit back —
  the repeated state is one file with two entries pointing at it.

**`index.jsonl` is append-only**, which is the same decision as turn segments
(§5.5) for the same reasons: cheap writes, clean git diffs, and a corrupted tail
costs the newest entry rather than the history.

*Corrected 2026-09-27.* ~~a corrupted tail costs the newest entry~~ A corrupted
tail cost the newest entry **and the one after it**, here and in turn segments
alike: the next append landed on the end of the torn line, and the two made one
line that parsed as neither. For a segment that could be the whole story,
because the turn that tore was the one the commit appended again, the head was
set to it, and a path walk from a head it could not read is empty.
`storage/files.ts`'s `appendLine` now ends a torn line before it appends, and
the history index goes through it. The sentence above is true again.

### 11.3 Retention

**Marinara has no cap**, and that is the one place its design should not be
copied. An agent making a run of small edits can produce hundreds of entries, and
an unbounded list is a list nobody scrolls.

- **A generous default count, tunable** ([22 §4](22-internal-contracts.md)) —
  prune oldest first, per object.
- **Pinned versions are never pruned.** Pinning is what a user does to the state
  they might want back in a year, and it is the entire answer to "the cap ate
  something I cared about".
- **Prune by count, not by age.** A card edited heavily one evening and left
  alone for six months should not lose that evening.
- **Pruning is not deletion of content.** Content-addressed payloads referenced
  by a surviving entry stay; only unreferenced ones are collected.

*Corrected 2026-09-27.* The bytes beside a folder object, a lorebook's gallery
and its entries' pictures, were under neither rule. A version names them and
does not hold them, and the sweep on save ([10 §11.2b](10-ui-surfaces.md))
deleted a file the moment the current manifest stopped naming it, so a restored
version could name a picture that was gone. The sweep now keeps a file while
any surviving version names it, which is the bullet above applied to the bytes.

### 11.4 Three scales of undo, and why they do not overlap

Worth stating together, because this is the third one and someone will otherwise
ask why there are three:

| Scale | Mechanism | Question it answers |
|---|---|---|
| **A field** | `generated.original` ([04 §3](04-schemas.md)) | *Undo what the model wrote in this box* |
| **An object** | Version history — this section | *Put this character back how it was* |
| **A story** | Branching ([07](07-branching.md)) | *Go back to before that happened* |

They are genuinely different: field-level revert is about one generated value and
survives no further edits; object history is about an authored artefact across
its whole life; branching is about narrative time and does not touch the library
at all.

**And they compose without interacting.** Restoring an actor to an older version
does *not* reach into running sessions — sessions copy from the library at
creation and hold no live link ([00 §3.1](00-stance.md)). That is worth saying
explicitly, because it is the first thing someone worries about, and the answer
is a principle that already exists rather than a special case.

### 11.5 What the author's own version string is, and is not

`Provenance.version` ([04 §3](04-schemas.md)) is free text the *author* sets —
`"1.2"`, `"final-ish"`, whatever they like. Marinara snapshots the equivalent
field alongside each version and displays both, which is right and worth
copying.

**Two different notions, deliberately kept apart:**

- **The revision** is ours: monotonic, per object, computed for display rather
  than stored, and meaningless outside this install.
- **The version string** is theirs: a claim about the content that travels with
  the object when it is shared.

An author who bumps `"1.1"` to `"1.2"` is making a statement to whoever they
share the card with. The revision counter is bookkeeping. Conflating them would
mean either renumbering someone's release when they fix a typo, or pretending
seventeen local edits were one.

### 11.6 Not part of an export, by default

A `.seactor` or `.sepack` carries the object, not its history. Two reasons, and
they point the same way: forty drafts make the file large for no benefit to the
recipient, and edit history is a working record — the false starts, the
abandoned phrasings — that people do not necessarily intend to publish.

**Opt-in on export** for the case where it is wanted: handing a character to a
collaborator who will keep working on it. Same treatment as the trash
(§10.2), and the export UI says which it is doing.
