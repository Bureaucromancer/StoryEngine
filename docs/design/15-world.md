# 15 — World: the set that travels, and the continuity that waits for play

**Status: proposal, rewritten 2026-10-04** against the owner's decision of
2026-10-03 ([26 B17](26-open-questions.md)). A World is a **named set of library
objects** — actors, lorebooks, treatments, setups, presets, and sessions — that
a person keeps, sends as one file, and starts new sessions from. *"Rain City"*,
holding the books, the cast, two readings of them and the sessions played in it.
What playing in a World would one day leave behind — memory keyed on it, hooks
that do not fire twice across its sessions, a story bible — is designed here and
**not scheduled**: it waits for real play (§4).

**Half of it is scheduled for 1.0, at [P16](workplan/35-p16-world.md)**: the kind,
membership, contribution and transport. **The other half — accrual and the story
bible — is gated on play rather than on a date** (§4.3), and keeps 4.0's place in
[work plan §0](workplan/01-work-plan.md) as its latest home rather than as a
promise. Like [12](12-account-gallery.md) and [13](13-write-mode.md) it is a
design note that arrived after the original run rather than a new tier of
document, and it reads after [03](03-data-model.md), [04](04-schemas.md) and
[08](08-cross-session-memory.md), whose object set, container and memory keying
it changes. [16](16-publish.md) reads directly after it and fills its kind.

*History: written as the 4.0 continuity container, a play-side grouping of
sessions and explicitly not a portable kind; marked superseded in part on
2026-10-03 when [26 B17](26-open-questions.md) was decided; rewritten on
2026-10-04, when those markers came out and what they marked went into §0.*

> **A Setup is what a game is. A World is the set the game draws from — and, once
> there is play worth remembering, what that play left behind.**

---

## 0. What this note used to say, and why it changed

**This note is a rewrite rather than a revision**, so the old positions are
recorded here rather than struck line by line through a document that no longer
has their shape. It opened:

> A World is a grouping of sessions that share a continuity — history available
> as context across them, a shared starting set of lorebooks and a shared
> treatment baseline … Grouping your own sessions is a convenience over
> sessions, not a seventh portable kind.

and built four refusals on it: **no portable kind, no library panel, out of the
export surface, not an authoring surface.** It was scheduled for 4.0, on the
argument in §2 that a continuity container designed before any continuities
exist is designed against a guess.

**What changed it was a branch, an audit and an owner's decision, in that order.**

- **The `worlds` branch (2026-09-14) argued that this note and
  [04 §9](04-schemas.md) were describing one object from opposite ends**, each
  refusing the half the other had: a Package was a set that travels and could
  not be read at session creation, and the old World could be read at session
  creation and could not travel. Its proof was a defect in
  [06 §4.1](06-modes-and-turn-pipeline.md): `ChannelDefinition.owner` accepts a
  package id so that authored content can own state, while 04 §9 said a
  package's contents were *"embedded copies resolved on import"* — so a package
  dissolved on arrival, and a channel owned by one would point at nothing. The
  branch renamed Package to World in code (`448c53e3`), rewrote this note, and
  wrote a *16 — Publish* and a phase plan, P8A, that built all of it — accrual
  and the bible included — for 1.0. ***Its text is the material this rewrite
  adapts, and none of it is adopted as written*** ([26 B17](26-open-questions.md)
  says where each piece is reachable).
- **The audit that put the branch to the owner (2026-10-03) corrected the proof
  by half.** The code never stored copies. A stored Package's `contents` is a
  list of `{ schema, id, name }` envelopes — references — resolved against the
  library when it is exported (`packaging/export.ts`). A Package has been a
  library object since P1, and since
  [P7B.6](workplan/24-p7b-presets-and-prompts.md) one a person can edit. So on
  the install that made it, a Package never
  dissolved; what the design text said dissolved was the *wire* form, which still
  has no reader at all. **What survives the correction is narrower and still
  decisive**: one identifier, `PackageId`, was carrying two unrelated things (§6,
  [06 §4.1](06-modes-and-turn-pipeline.md)), and the content-bundle half needed an
  object with a portable id that persists on the install it arrives at — which a
  stored set holding references is, once importing a set keeps the set as well
  as its members.
- **And the same shape arrived from this note's own side.** Its §5.3, written at
  [P5.7]'s reversal, observed that `LoreScope` is stored, exported, preserved on
  import, and read by nothing, and that *"Worlds is the shape that could change
  that, and it is the only one on the table"* — something above the session that
  contributes books. That is a durable named set read at session creation,
  described by a document whose §3 had just refused to let it travel.
- **The owner took the branch's argument in part — option 2.** A World becomes
  the durable named set and **replaces Package**: membership, transport, and
  contribution to a session's lore through a `world` arm on `LoreScope`.
  **Accrual and the story bible wait for real play**, because the old reason for
  4.0 still fits that half exactly. The branch's own plan said as much — its
  §1.5 conceded that two of its five stages *"ship against a guess"* and that the
  revisit should ask whether PLAYABLE had produced any session worth putting in a
  World — and option 2 takes that sentence at its word rather than shipping
  against it.

**So Package is renamed rather than joined.** The six portable kinds stay six
([04 §1](04-schemas.md)); World takes Package's place, its panel, its routes and
its file. The rename is [P16.0](workplan/35-p16-world.md), a migration with a
path that reads the old name for as long as anything might hold it — **nothing
on disk is renamed by this note**, and until that stage ships the code, the
library and the guide all say Package and are right to. *(**2026-10-10: it has
shipped** — P16.0 landed on branch `p16`, and the code, the library's Worlds
panel, the routes and the guide say World. What still says package is what this
phase leaves for later on purpose: the export envelope, `.sepack.json` and
`storyengine.package-export/1`, which [P16.3](workplan/35-p16-world.md) owns;
the namespace and workspace senses (§6); and `Provenance.source`'s `'package'`
literal ([P16 §1.7](workplan/35-p16-world.md)).)*

**Where this rewrite departs from the branch**, so that nobody reads one for the
other:

- **The split.** The branch scheduled accrual and the bible for 1.0; here they
  are §4, gated on play.
- **The wire.** The branch specified a `.seworld` zip as though it were settled.
  What shipped is [P11.10](workplan/28-p11-implementation.md)'s JSON envelope,
  `storyengine.package-export/1`, which carries the objects beside a manifest and
  no pixels. [16 §5.2](16-publish.md) starts from what shipped and keeps the
  choice open until the phase writes a format — leaning to the zip, for the
  branch's reason, which is that an actor's portrait is in its card and a JSON
  reading of the card leaves it behind.
- **The closure table.** The branch copied [04 §9.1](04-schemas.md)'s table as it
  stood on 2026-09-14. Main's is newer — it gained three hook rows on 2026-09-22
  — and [16 §4](16-publish.md) starts from main's.
- **The rename.** The branch's was a find-and-replace in code. Here it is a
  migration, because installs now hold `library/packages/` folders and a
  `.sepack` format was frozen while the branch was out.
- **The release line.** The branch moved World into 1.0 whole and shortened the
  series by one. Here only the half that never needed play moves; the line is
  unchanged ([work plan §0](workplan/01-work-plan.md)).

## 1. What it is: four functions, one object

**A World answers one question — *what belongs to this set* — and the rest
follows from the answer rather than being bolted to it.**

| Function | What it is | Where it stands |
|---|---|---|
| **Membership** | Which objects belong, sessions included. Stored as references; an object may belong to several Worlds or none, and a World never blocks a delete. | **1.0**, [P16.1](workplan/35-p16-world.md) — §3.1, §3.2 |
| **Transport** | The envelope a set leaves in. Publishing a selection of two or more is how a World gets made; re-publishing one re-resolves it. | **1.0**, [P16.3](workplan/35-p16-world.md) — §3.3, [16](16-publish.md) |
| **Contribution** | What a new session started in the World starts from — its books into `session.lore`, its treatment, the hooks those carry. Copied, prefill and never binding. | **1.0**, [P16.2](workplan/35-p16-world.md) — §5.3 |
| **Accrual** | What playing in it leaves behind: memory keyed on the World, a hook fired in one session not firing again in another, an introduction made once per World — and the story bible that shows it. | **Deferred, and gated on real play** — §4 |

**None of the four is a feature added to a bundle.** Each is what a set of
objects obviously does once the software knows the set exists. Package could
not contribute because nothing read it at session creation; the old World could
not travel because it held only sessions and was specified to stay home.

**The first three need no play to be worth something.** Five objects and a name
is a World on the day it is made, with no session in it at all, and refusing
that was refusing the thing people most obviously want to do with a setting:
write it down, start games in it, and hand it to somebody. **The fourth needs
play to be designed at all**, and §4 is where that argument is kept rather than
deleted.

**Two existing open questions are what made this a real object rather than a
nice idea, and both survive the split** — one answered now, one by the half that
waits:

- [08 §8](08-cross-session-memory.md) carries *"cross-session memory for the
  narrator rather than a character — 'the GM remembers your last campaign'.
  Coherent, and **a different scope key**."* Memory is keyed
  `(user, actor, persona)`, character-centric, and a World is the world-centric
  key that question noticed was missing and did not name. **The key exists from
  P16.0** — a World has a stable, portable id — and **using it is accrual**
  (§4.1).
- [25 §2c.1](25-roadmap.md) first defined the story bible as *what a
  **session** has established*. A World is that widened across sessions, and
  §4.2's bible — *"a derived view of what a **continuity** has established"* —
  keeps its discipline unchanged: **derived, never authoritative.** *(2026-10-04:
  this line used to quote the session wording as §4's own, and carried that into
  the rewrite; §4 has said "continuity" since the bible moved here, and the
  session wording is the roadmap's.)*

**The word was reserved at 1.0 and is spent here.**
[10 §2.1](10-ui-surfaces.md) declined to use "World" as a library label, and
[04 §6](04-schemas.md) declined it as the name for Treatment, precisely so that
this could have it. That was a cheap decision when this was a roadmap entry; it
is what lets Package's panel take the name now without colliding with anything.

## 2. What separates it from Setup — and the half of the old answer that holds

They will otherwise be confused, and the distinction is still the design. It is
not the one this note used to make.

**The old distinction, and why half of it fell.** It read:

> A Setup looks forward at one game and is complete the moment play begins. A
> World looks backward across many and is worth nothing until the third session.

That is true of a World that can only accrue, and false of one that is also a
set. *Worth nothing until the third session* was the claim the 4.0 schedule rested
on, and §1 is the reason it no longer describes the object: membership,
contribution and transport are worth something before the first session.

**The distinction that replaces it, and it is sharper:**

> **A Setup is one configuration. A World is the set a configuration draws
> from.**

One World, many Setups — the one-to-many that already runs from Lorebook to
Treatment to Setup ([04 §7](04-schemas.md)), one level up. *Rain City* the World
holds the books, the cast and two readings of them; *The Fixer's Debt*,
Freeform, playing Marlow, is a Setup that is one of its members. The ladder is
learned by starting a second game in a World you already have, which is the
teaching [10 §5.1](10-ui-surfaces.md) moved to Play, with one more rung.

**The old reason survives, unchanged, for the half that accrues.** This note
said:

> It is also why 4.0 is the right release rather than an earlier one: a
> continuity container designed before any continuities exist is designed
> against a guess, and the shape of the guess would be the shape of the feature.

**Every word of that still holds of accrual and the bible**, and none of it ever
held of membership, which needs no play to design. That is the sentence
[26 B17](26-open-questions.md) cites, and §4.3 is where it binds.

**It still cannot be modelled as "a Setup with several sessions"**, for the old
reason and a new one. A Setup that has been used twice is unchanged, and a World
that has been played in twice will be a different object from the one that was
made — once accrual exists to make it so. And a World that has never been played
in is also a real object now, which no reading of a Setup can accommodate.

## 3. It is a portable kind — Package's place, and the central refusal reversed

The old §3 said *"no new library panel, and no seventh kind"*, and cited
[work plan §0.2](workplan/01-work-plan.md)'s release check: *World at 4.0 must
add no portable kind at all.*

**That check's letter holds and its reasoning does not.** No portable kind is
added: the kind that exists is renamed, and the count is six. The check existed
to stop a play-side convenience growing into a format commitment nobody had
designed; what happened instead is that a format commitment which already
existed turned out to be this. [Work plan §0.2](workplan/01-work-plan.md) now
carries the check worth running in its place: **World must change no other
portable schema** — not Actor, Lorebook, Treatment, Setup or Preset — **with one
exception named in advance**, `LoreScope`'s `world` arm (§5.3), which is
additive.

The old paragraph that predicted this is worth keeping, because it was right
about the pressure and wrong about the answer:

> **The pressure to break the first two will be real**, and it will arrive the
> first time somebody wants to share a World. The answer is that the shareable
> part is already shareable, twice over, and what remains — which sessions of
> mine belong together — is not information anyone else can use.

The pressure arrived on 2026-09-14, as predicted. *The shareable part is already
shareable* was describing a Package, and the Package is this. Sharing *the Rain
City setting* and sharing *my six Rain City sessions* were sent by that
paragraph to two different features; [16 §5](16-publish.md) makes them one
action with a checkbox.

**So: a library panel, an export surface, and a kind.** The panel is Package's,
renamed — *Worlds* — and it is **not** the renaming layer
[10 §5.1](10-ui-surfaces.md) withdrew: that layer gave Treatment a friendlier
alias and put *Worlds* next to *Lorebooks* while the world lived in the lorebook;
this is a panel named for the kind it shows, which is the rule that section
adopted. **What survives untouched is the third refusal: World is not a
surface.** It adds no top-level place to the application
([10 §2](10-ui-surfaces.md)); it is a library kind with a panel like the other
five, and [16](16-publish.md) is a flow inside the library, not a fourth surface.

### 3.1 Membership: a stored World names its members; a published World carries them

**One distinction everything else rests on:**

| | Holds | Why |
|---|---|---|
| **Stored** — `library/worlds/<slug>/world.json` from [P16.0](workplan/35-p16-world.md); `library/packages/<slug>/package.json` until then — *and after it, read as a World until that object's first write moves it (2026-10-10)* | **references** — the `{ schema, id, name }` envelopes a stored Package's `contents` already holds | The objects live in the library and are edited there. A World holding copies would be a second representation of every object in it — [00 §2.8](00-stance.md)'s derived data persisted as truth, at the scale of a set |
| **Wire** — the published file ([16](16-publish.md)) | **the objects**, each as it is stored | *"The only reliable way to ship something working to someone whose library you know nothing about"* ([03 §7.2](03-data-model.md)), unchanged |

**Embedding is a fact about the file; linking is a fact about the store.** Get it
backwards in either direction and one of two failures follows: a stored set full
of copies drifts from the library the first time anyone edits anything, and a
file full of references strands every recipient. *This is already how the code
works* — the audit's finding (§0) — and [04 §9](04-schemas.md) now says so; P16
renames the stored form and does not change what it means.

**Import is where the two meet.** The objects arrive as real library objects
through the ordinary review step ([10 §5](10-ui-surfaces.md)), and the World that
arrives with them names what landed. References inside the file resolve within
it first, then locally, then dangle visibly ([00 §3.3](00-stance.md)) — which is
[04 §9](04-schemas.md)'s rule unchanged, now with somewhere for the result to be
kept. *No build reads a `.sepack` today*; [P16.3](workplan/35-p16-world.md)
builds the reader, and it reads the frozen package format as well as the new one.

**A member that is edited or deleted afterwards.** Edited: the World sees the
edit, because it holds a reference and that is the point. Deleted: the reference
dangles, visibly and without blocking anything, like every other dangling
reference in this system ([00 §3.3](00-stance.md)). **A World never blocks a
delete** — [26 B2](26-open-questions.md)'s answer applied one level up, since a
container that could refuse to let go of an object would make membership an
ownership claim, and it is not one. **An object may belong to several Worlds,
and to none**, and membership never hides an object from its own panel or makes
the World the place an actor is edited.

**What may be a member.** The five other portable kinds, and sessions (§3.2).
**Not another World**, at 1.0: a set of sets is a question nobody has asked, and
the envelope rule (§3.3) already carries a World found inside a file as an object
like any other, so refusing nesting in the editor forecloses nothing. **A
manuscript, when Write lands at 2.0**, may be a member — the reference is
harmless and the set is the person's to define — and does not reach the wire
while [13 §5](13-write-mode.md) keeps Manuscript in the internal tier
([16 §2](16-publish.md)).

### 3.2 Sessions are members, and membership lives in one place

**A session is a member like anything else**: a reference in the World's list,
beside the books. That is what collapses the old note's two features into one —
a World published without its sessions is *the Rain City setting*, and with them
it is *my six Rain City sessions*; which one leaves is
[16 §5](16-publish.md)'s review rather than a property of the kind.

**Starting a session in a World makes it a member**, by adding it to that
World's list — the same reference a person could add from the World's editor or
from the session list. And **that is the only place the fact is written**: the
session carries no World of its own at 1.0. [00 §2.8](00-stance.md) is the reason
— two records of one membership is a query that has to agree with another query
— and so is the next paragraph.

**Where a session's World would live for accrual is accrual's question, and
deliberately not this one's.** A session may belong to several Worlds, which is
harmless for a set and fatal for a memory key: a key has to be one value, read on
every turn, and a reverse lookup over every World's member list is a key in name
only. The branch answered by putting the World on the session; that is the right
shape *for accrual* and it is a second fact *for membership*. So §4.1 inherits
the question with its argument, and nothing at 1.0 writes a field accrual would
then have to reinterpret. *A session field added then is additive under
[04 §2](04-schemas.md), and the session export carries unknown fields
through* — so the deferral costs nothing later, which is the test
[work plan §2.1](workplan/01-work-plan.md) asks of every deferral.

**Prologue packages are the same mechanism with one session ticked**
([26 B10](26-open-questions.md)): a World published with a partly played session
in it is a game somebody can continue from where its author stopped, and it
needs no feature of its own.

### 3.3 Transport is [16](16-publish.md)'s

The envelope is [04 §9](04-schemas.md), and the flow that fills it is
[16](16-publish.md); neither is restated here. Two properties are this note's to
hold rather than theirs, because both are about what a World *means* rather than
what a file validates:

- **The container validates the envelope, never the payload kind.** A reader
  checks that each entry has a `schema` and an `id`, resolves what it recognises
  through the registry, and carries the rest through untouched. That is what
  keeps the kind stable when a new kind appears, and it survives the rename
  unchanged.
- **There is nowhere to put a connection.** [00 §3.2](00-stance.md) is enforced
  by the type system rather than by discipline: portable kinds have no field that
  could hold an endpoint, a key or a per-install toggle, so **importing a
  stranger's World cannot repoint your provider or flip your content rating.** The
  rename does not widen this and must never be allowed to.

**Rules travel; code does not.** [26 A2](26-open-questions.md)'s answer is
unchanged in substance and moves with the name: **a World may ship rules, never
code**, and the rule vocabulary that would let it is the authoring tier's
([17 §2](17-authoring.md)). A World is also what an authored channel will name as
its owner when that tier arrives — the content-bundle arm of
[06 §4.1](06-modes-and-turn-pipeline.md)'s `owner`, which could not name a
durable owner until this kind existed (§6).

## 4. Accrual and the story bible: the half that waits for real play

**This is the half of the old note whose argument survived, and it is kept whole
rather than deleted**, because the next person to reach for it should meet the
reasoning instead of re-deriving it. None of it is scheduled. §4.3 says what
schedules it.

### 4.1 Accrual: what a World would remember

**What makes a World that has been played in a different object from the one that
was made.** Three behaviours, and two of them already have their machinery:

- **World-scoped memory.** The fourth key [08 §8](08-cross-session-memory.md)
  named and could not supply — not a second memory store, but the existing
  mechanism with one more scope ([08](08-cross-session-memory.md)). The 1.0
  obligation is met: [P8.2](workplan/25-p8-implementation.md) keyed memory books
  on a record of named keys rather than on the three-tuple, so adding `world` is a
  field on an open record (§5).
- **A hook fired once does not fire again in another session.** Session creation
  copies hooks from every source ([03 §4.1](03-data-model.md)), and within one
  World a hook fired in session one must not fire in session two — the *"firing a
  hook about someone who died four sessions ago"* failure reached by another
  route. This works only because a copied hook keeps the source hook's id, which
  §5.1 made an obligation and [P7.5](workplan/23-p7-implementation.md) met.
- **An introduction has one first time per World.** [04 §6.1a](04-schemas.md)'s
  `introduces` fires on a character rather than an event, so the failure is *this
  person arriving for the first time, twice*; the suppression key is the subject,
  not the hook (§5.2), and only its scope widens from session to World.

**And the question membership left it** (§3.2): where a session's World lives.
For a set it lives on the World; for a key it has to be one value on the
session, read every turn. Accrual decides that — including what a session that
belongs to two Worlds remembers through — and it is the first decision its design
owes, because all three behaviours are keyed on the answer.

### 4.2 The story bible

**A derived view of what a continuity has established**, separate from its
prose. Who exists and what is known about them, what state the channels hold,
which lore entries have fired and when, which goals were completed and where.

**It ships with accrual, not with the set**, because the old sentence still holds
of the half it was written about: *a continuity container with no way to see
what the continuity contains is half a feature.* A set with no continuity has a
view already — its member list, with the backlinks
[10 §5.2](10-ui-surfaces.md) gives every object — and a bible built over sessions
nobody has grouped would be the session-scoped view under a World's name.

Nothing in it is new data. Actors and their presence come from
[06 §8.1](06-modes-and-turn-pipeline.md); established facts come from extraction
steps whose output already lands as channel effects; lore activation history is
in every turn record ([03 §8](03-data-model.md)); the goal chain is in its own
channel ([06 §7.3.4](06-modes-and-turn-pipeline.md)). **The bible is a reader**,
in the same sense that the workbench is a reader — which is why it is cheap, and
why it was worth designing the record to be complete.

Two reasons it earns a place rather than being a nicety:

- **People already do this by hand.** The spreadsheet-beside-the-session is a
  well-known habit in long-form RP, and it exists because the information is
  genuinely scattered and genuinely needed. Software that has all of it and shows
  none of it is leaving the obvious on the table.
- **It is the appendix to the reading view** ([10 §12](10-ui-surfaces.md)). One
  answers *what happened*, the other *what is true*, and a long story wants both.

**Where it must not go:** the bible is derived, never authoritative. Editing it
means editing the thing underneath — a channel, an actor, a lore entry — not
writing to a parallel store. A bible that could drift from the sessions it
describes would be [00 §2.8](00-stance.md)'s derived-data-persisted-as-truth
failure in a new costume. *And a cache it keeps must be reconstructible by
deleting it*, which is the branch's rule and the right one: a derived view over
four sources is slow enough that caching looks obviously correct, and a cache
that survives a restart without a rebuild is a store.

**It has a second consumer at 2.0.** Write's outline is what a manuscript
*intends*, where the bible is what play *established* ([13 §10](13-write-mode.md));
the two want the same discipline, and the second one built should reuse the
first one's shape rather than inventing a parallel view.

**Continuity checking is not part of this.** Reading established state back
against recent turns to flag contradictions is a separate, more expensive feature
with a false-positive problem the bible does not have, and it stays on the
feature list ([25](25-roadmap.md)). The bible is what makes it *possible* later;
it is not a down payment on it.

### 4.3 The gate, and what reopens it

**Accrual and the bible are gated on PLAYABLE having produced sessions worth
putting in a World** ([work plan §4.1](workplan/01-work-plan.md)) — on evidence,
not on a release number. Until there are continuities, a continuity container is
designed against a guess (§2), and the honest response to that is to wait for the
continuities rather than to guess carefully.

**What counts as the evidence**, so that the gate is checkable rather than a
mood. Any of these, from real play:

- **A second session in the same setting**, played because the first left
  something worth continuing — §8's first test, runnable now.
- **Session names that hand-encode continuity** — *"Rain City 3"*, *"Rain City
  4"* — which is the feature asking to exist and the cheapest evidence there is.
  Also §8, also runnable now.
- **Worlds made at P16 that hold sessions** — counted per World once
  [P16.1](workplan/35-p16-world.md) ships — and somebody wishing the second one
  knew what happened in the first.

**Its place in the release line is 4.0's, as the latest home rather than a
schedule** ([work plan §0](workplan/01-work-plan.md)): the line is unchanged,
Campaign's gate on a continuity to run in is unchanged, and if the evidence
arrives sooner the half moves forward through a phase plan of its own — never
folded into a phase that is building something else.

**What 1.0 did so that waiting costs nothing.** The three obligations that would
have been unrecoverable if missed are met (§5): copied hooks keep their ids,
introductions key on the subject, and memory is not keyed on a hard-coded tuple.
Everything else accrual needs is a field added to an open record or a reader over
records that already exist, which is the definition of something that can wait.

## 5. What 1.0 builds, and what it already owes

**These are requirements, not insurance.** As a roadmap entry this table was a
list of cheap options. As a committed design it is a list of things that are true
when [P16](workplan/35-p16-world.md) closes, and of the three that had to be true
long before it.

| Element | Obligation | Lands |
|---|---|---|
| **The kind** | Package renamed World — schema id, folder, file, panel, routes — as a migration that reads the old name and writes the new one. No new kind. | [P16.0](workplan/35-p16-world.md) |
| **Membership** | References, sessions included; never blocks a delete; an object in several Worlds or none. | [P16.1](workplan/35-p16-world.md) |
| **Contribution** | A new session in a World copies its books into `session.lore`, offers its treatment, and copies the hooks those carry — §5.3. The `world` arm waits on [26 B16](26-open-questions.md). | [P16.2](workplan/35-p16-world.md) |
| **Transport** | [16](16-publish.md)'s review; publishing a selection of two or more makes a World, one object makes none; re-publishing re-resolves. | [P16.3](workplan/35-p16-world.md) |
| Sessions belong to a World | **None on the session.** Sessions are the *free to move* tier ([04 §1](04-schemas.md)), and membership is a reference on the World (§3.2). | — |
| World-scoped memory | **Met.** Memory books must not hard-code the `(user, actor, persona)` three-tuple; `MemoryScope` is a record of named keys ([P8.2](workplan/25-p8-implementation.md)). The key itself is accrual's (§4.1). | P8 |
| Hook identity survives the copy | **Met, and pinned.** §5.1 | P7 |
| Introduction hooks key on the subject | **Met.** §5.2 | P7 |

### 5.1 Hook identity must survive the copy

[03 §4.1](03-data-model.md) has session creation *copy* hooks from all sources.
Within a World, a hook fired in session one must not fire again in session two —
the same *"firing a hook about someone who died four sessions ago"* failure that
document calls severe, reached by a different route.

Cross-session de-duplication is only possible if a session's copied hook keeps
the **source hook's `id`** rather than getting a fresh one. `PlotHook.id` exists
and `blockedBy` / `notBefore.afterHook` already reference ids, so the field is
there; what needed pinning at P7 was that copying preserves it. **One line then,
unrecoverable later** — a corpus of sessions whose hooks have unrelated ids
cannot be retro-fitted into a continuity, because the information that would link
them was never written.

Where the firing record itself lives is orthogonal: that state is a channel as of
[03 §4.1](03-data-model.md), and the obligation was always about the *id*
surviving the copy.

*Met at [P7.5](workplan/23-p7-implementation.md) and pinned by
`sessions/hook-pool.test.ts` — *keeps the source hook’s id, which a continuity
cannot be built without* — and kept in the other direction by promotion, which
refuses a second copy rather than re-minting one. The obligation outlived the
schedule it was written for: it is accrual's (§4.1), and accrual waits, and the
ids are already right.*

### 5.2 An introduction hook needs a second key, and id is not it

[04 §6.1a](04-schemas.md)'s `introduces` fires on a character rather than an
event, so the failure it must avoid is *this person arriving for the first time,
twice*. Id-matching catches only the case where the **same hook** fired before;
it misses the commoner one, where a different hook — or the narrator, unprompted
— introduced them in session one.

So within a World the suppression key is the **subject**, not the hook: a
character already introduced in this continuity has no first arrival left to
stage. This costs 1.0 nothing, because the *introduced* predicate it needs
already exists per-session ([06 §8.1](06-modes-and-turn-pipeline.md)) and only its
scope widens.

*Met at [P7.5](workplan/23-p7-implementation.md): the predicate keys on the
subject, per session. Widening its scope is accrual's.*

### 5.3 Contribution, and `LoreScope` gets the consumer P5.7 took away

*Recorded at [P5.7]'s reversal, because this is where somebody would be standing
when the question next mattered. It matters now; the record is kept, and the
answer follows it.*

**A lorebook reaches a session by being selected, and by nothing else**
([03 §3.4](03-data-model.md)): `session.lore`, or the treatment the session names.
P5.7 briefly let a book's own `LoreScope` admit it — `global` everywhere,
`linked` wherever one of its actors was cast — and that was reversed within the
day. `global` is the factory default *and* the SillyTavern importer's fallback,
so the effect was a person's entire library appearing in every session's prompt
with no way out but hand-editing JSON. A library is not a world; that sentence is
this document's own premise, arriving from the other direction.

So `scope` is stored, exported, preserved across import — and read by nothing.
**Worlds is the shape that could change that**, and it is the only one on the
table: something *above* the session contributing books is exactly what a `scope`
of `global` was reaching for and had no legitimate way to express. If that
arrives, three things have to be decided together rather than one at a time —
what inherits, whether `scope` then narrows, and what a new book's `scope`
defaults to. The trap is the one already sprung once: inferring a *behaviour*
from the union's wording because "where it applies" sounds like a rule. It
describes a shape. What consumes it is a separate decision, and this section is
where it gets made.

**Decided 2026-10-04.** *The copy and the arm follow from the owner's answer to
[26 B17](26-open-questions.md); the default and B14's answer below are
recommended answers the owner deferred, each marked where it is stated, and
either can be overruled in 26.*

**What inherits: a copy, at creation, and nothing after.** A World is a prefill
source exactly like a Treatment, and [00 §3.1](00-stance.md)'s prefill-not-binding
holds without amendment. Starting a session in a World:

- **copies its lorebook members into `session.lore`** — as data, on disk,
  editable like any other selection, and selected from then on by being there;
- **offers its treatment members as the session's treatment** — preselected when
  there is one, a choice when there are several, and the person's to change;
- **copies the hooks** those carry, by [03 §4.1](03-data-model.md)'s rule for
  every carrier a session names, ids kept (§5.1).

There is no live pointer back. A World edited after the session started changes
nothing in it, and per-session divergence is the default rather than a feature
to add. **The rule that a lorebook reaches a session by being selected is
intact**: a World is one more thing that does the selecting, once, visibly, with
the result in the session's own list. *The check that proves it*, which
[P16.2](workplan/35-p16-world.md) ends on: after starting a session in a World,
`session.lore` names the books on disk, and nothing reaches the prompt that is
not selected there. If a book reaches the prompt without appearing in that list,
the stage rebuilt P5.7.

***(2026-10-10: built on branch `p16`, the arm excepted.*** Starting a session
in a World — from its page, or as a choice on the new-session form — copies its
lorebook members into `session.lore`, uses its treatment when it holds exactly
one, and copies the hooks they carry; the request's own `lore` and `treatment`
override all of it, as they override a Setup's. `routes/world-contribution.test.ts`
is the check above, with a `global` book outside the World keyed on a word the
input says, and it holds. **The `world` arm below is not built**: it waits on
[26 B16](26-open-questions.md), and [P16.2](workplan/35-p16-world.md) records it as
waiting.)*

**`LoreScope` gains one arm — `{ kind: 'world', worldIds: string[] }` — and it is
the only arm anything reads.** It is a book's own statement, carried with the
book, that it belongs to sessions started in those Worlds: at creation in one of
them, a book in the person's library whose scope names that World is copied into
`session.lore` beside the World's members. **The two sources are different facts
by different people** — membership is the curator saying *this set holds this
book*, scope is the author saying *this book is for that World*, and a book sent
on its own keeps its author's statement on an install where somebody else holds
the World — and both end in the same place: a copy in the session's list,
decided once. `global` and `linked` stay carried, exported, preserved, and read
by nothing.

**The test that makes this arm legitimate is one the schema already applies to a
rejected sibling.** `lorebook.ts` refuses session scoping in as many words:
*"Session ids are install-local, so a shared lorebook carrying them exports
identifiers that are meaningless everywhere else."* A World id is not
install-local. A World is portable and keeps its id across installs, so a book
scoped to one means the same thing where it arrives — it travels with, or meets,
the World that gives it meaning. That is the whole difference between the arm
refused and the arm added.

**It widens a closed portable union inside its version, which is
[26 B16](26-open-questions.md)'s question exactly, and the arm waits on B16's
answer.** `LoreScope` is closed in `storyengine.lorebook/1`; an older build
fails a book that uses an arm it does not know, whole. Whichever way B16 is
answered — open the unions, bump the version, or accept and say so — decides how
the arm lands, and [P16.2](workplan/35-p16-world.md) lands the copy from
membership first and the arm second, so that the half of contribution that
changes no portable schema does not wait on the half that does.

**[26 B15](26-open-questions.md) is answered by consequence** — *recommended
answer, owner deferred, 2026-10-04; overrule at [26 B15](26-open-questions.md)*.
A new book's scope defaulted to `global` because nothing read the field;
something reads one arm of it now, and *a field nobody sets should not default to
the widest value in its own union* becomes actionable. **The default becomes
`{ kind: 'linked', actorIds: [] }`** — the narrowest honest value, meaning *this
book has not said where it applies*, read by nothing, with the same effect as
today for a book nobody scopes — and **every standalone SillyTavern book takes
the same value**. The importer writes `global` for all of them today, not only a
chat-bound one: SillyTavern's format carries no scope at all, so there is nothing
to preserve and the value is the importer's own choice, which a chat id only adds
a warning to. *A native `storyengine.lorebook` file that says `global` keeps
saying it*: that format carries the value and imports preserve what they are
given, which is safe because `global` admits nothing. That is a factory default
and an importer's value, not a schema change, so it does not wait on B16.

**[26 B14](26-open-questions.md) keeps its answer, which is no** — *recommended
answer, owner deferred, 2026-10-04; overrule at [26 B14](26-open-questions.md)*.
Scope
contributes at creation; it does not narrow a book the session has already
chosen. A person who selected a book and sees nothing from it would have to learn
that a field on the *book* overruled their choice, and that is the same class of
silent surprise the reversal removed, pointing the other way.

## 6. The word: capital W, lowercase w, and the three senses of *package*

**The old rule is void, and what it protected has happened on purpose.** The old
note recorded that two stable schemas had spent the word — `PlotHook` renamed
`scope: "world"` to `magnitude`, and `Lorebook.category: "world"` was removed
([04 §5](04-schemas.md), [04 §6.1](04-schemas.md)) — and closed:

> **Any new use of the word in a portable structure between now and 4.0 should
> be refused.**

The word is now spent *in* a portable structure, as the name of a portable kind,
which is what the rule existed to keep available. It did its job: both
collisions were cleared before the name was needed, and neither schema has to be
bumped now.

**What replaces it is narrower and still worth holding: lowercase "world" in
prose means the material, and capital-W World means this kind.** *"A lorebook is
the world; a treatment is how it is handled here"* ([03 §4](03-data-model.md))
stays true and stays lowercase, and so do *world facts*, *world info* and *how
hard the world pushes back*. A World is the set that holds the lorebook, the
treatment and the rest. A new portable field spelled `world` that means the
material should still be refused, for the old rule's reason.

**And *package* turns out to have carried three senses, which the rename has to
separate rather than replace:**

| Sense | What it is | What happens to it |
|---|---|---|
| **The content bundle** | The portable kind — `storyengine.package/1`, the Packages panel, `.sepack`, and [06 §4.1](06-modes-and-turn-pipeline.md)'s `owner` arm for authored content | **Becomes World** at [P16.0](workplan/35-p16-world.md) — *all but `.sepack`, which is the export envelope and [P16.3](workplan/35-p16-world.md)'s ([P16 §1.1](workplan/35-p16-world.md): the envelope is not touched at P16.0). Became, 2026-10-10.* |
| **A first-party namespace** | An engine subsystem that is not a mode and answers for the state it writes — `storyengine.lore`, `storyengine.cast`, `storyengine.hooks`, `storyengine.goals`, `storyengine.suggest`, `storyengine.renditions`, `storyengine.memory`, each owning a channel | **Unchanged, and never a World.** [06 §4.1](06-modes-and-turn-pipeline.md) names it *first-party namespace*; the code's comments call these *packages* and mean this sense |
| **The workspace package** | `packages/server`, `packages/sdk`, a mode as a package — pnpm's word ([20 §10](20-tech-stack.md)) | **Untouched**, and unrelated to either |

**The first two shared one word, and a sentence about one read as a sentence about
the other.** That is how *"the retriever's timing channel is owned by
`storyengine.lore`, which is a package and not a mode"* came to read as evidence
that the content arm was exercised, when it was evidence about the namespace.
[06 §4.1](06-modes-and-turn-pipeline.md) is where the two are separated; this
section records that they were ever one word, so that the rename is never read as
licence to substitute *World* wherever *package* appears.

## 7. Non-goals

- **Not a shared or collaborative world.** A World belongs to one user, like
  every other library object. Sending somebody a file is not collaboration, real
  multiplayer stays where [09 §8](09-server-multiuser-deployment.md) put it, and
  sharing between users *on one install* is still deferred
  ([03 §5](03-data-model.md)).
- **Not automatic.** Sessions do not join a World by resembling each other. A
  World is something a person makes and puts things into, for the same reason
  chapterisation is manual ([26 E1](26-open-questions.md)): a human knows where a
  set's edges are and a heuristic does not.
- **Not an ownership claim.** An object can belong to several Worlds and to none.
  Membership never blocks a delete, never hides an object from its own panel, and
  never makes a World the place an actor is edited.
- **Not a second memory store** — when accrual comes. World-scoped memory is the
  existing mechanism with a fourth key, not a parallel system
  ([08](08-cross-session-memory.md)).
- ~~**Not an authoring surface.**~~ **This one inverts, and only halfway.** The old
  note said *"writing a setting is a Package"* and sent authoring away on that
  basis. A Package is a World, so the sentence now says that writing a setting is
  exactly this. What stays true is the narrower claim underneath: a World is not a
  *text editor*. A setting is authored by making and linking its objects, each in
  its own editor, and the World is where the set is named and kept.

## 8. How we would know this was wrong

**Watched by whoever plays it, on their own install** — nothing here reports
anywhere ([16 §7](16-publish.md)). The old note's four tests were written against
a World that could only accrue; two of them measured that assumption rather than
the feature, and they change. Each test below says when it becomes runnable.

**Runnable now, against real play — and they are the accrual gate's evidence
(§4.3):**

- **Watch whether anyone plays a second session in the same setting.** The
  premise of accrual is that continuity across sessions is something people want
  and currently fake. If sessions are overwhelmingly one-offs, accrual is a
  container for a habit nobody has. *It can no longer condemn the World*, which
  earns its place as a set; it can condemn §4.
- **Watch what people put in session names.** If they are hand-encoding
  continuity — *"Rain City 3"*, *"Rain City 4"* — that is accrual asking to exist,
  and it is the cheapest possible evidence for it.

**Runnable once [P16.1](workplan/35-p16-world.md) ships:**

- **Count members per World, by kind.** A corpus of Worlds holding only lorebooks
  means this is a lorebook collection with extra steps, and the honest response is
  to say so. A spread across kinds is the claim that a setting is a set of mixed
  things, tested.
- **Count sessions per World.** It replaces the old *count Worlds with fewer than
  three sessions*, which falsified *worth nothing until the third session* — a
  claim §2 no longer makes, so a World with no sessions is a success rather than
  an abandonment. What the count can still show is §4.3's third piece of evidence,
  or its absence.

**Runnable once [P16.2](workplan/35-p16-world.md) ships the arm:**

- **Watch whether `LoreScope`'s `world` arm gets set.** §5.3 gives the field its
  first consumer since [P5.7] took the last one away. If authors
  still never touch it, the arm is ceremony and membership was the whole of
  contribution — in which case the honest repair is to stop reading it, not to
  find it a second job.

**Runnable once [P16.3](workplan/35-p16-world.md) ships:**

- **Watch whether anybody makes a World that is not published.** The sharpest
  risk in this design is that a World is a folder with a fancy name — that
  membership is only ever a by-product of wanting to send something, and the
  durable object is scaffolding for an export. If every World is made by the
  publish flow and never opened again, the kind should not have been durable, and
  the old note was right about this half too. [16 §8](16-publish.md) watches the
  same risk from the file's side.

**Runnable once accrual and the bible exist:**

- **Watch whether the bible gets opened.** If the continuity is used and the view
  is not, §4.2's claim that they are one feature was wrong, and the bible is a
  reading-view appendix rather than a World's. *Kept from the old note unchanged —
  it never depended on the assumption that fell.*
