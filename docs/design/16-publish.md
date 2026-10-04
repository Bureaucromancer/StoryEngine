# 16 — Publish: assembling something to send

**Status: proposal, written 2026-10-04** under the owner's decision of
2026-10-03 ([26 B17](26-open-questions.md)). Publish is the one flow that turns
something you own into something you can give away: start from an object, a
selection of them, or a World; the closure is computed and shown; you adjust it;
a file comes out — and when you started from a selection of two or more, a World
is kept. One object, however far its closure reaches, keeps nothing.

**Scheduled for 1.0, at [P16.3](workplan/35-p16-world.md).** It reads directly
after [15](15-world.md), whose kind it fills, and beside
[10 §5](10-ui-surfaces.md), whose import review it mirrors, and
[10 §5.0a](10-ui-surfaces.md), whose two doors for a single object it leaves
where they are.

> **Import is a review step, and so is export.** The asymmetry was never
> intentional.

---

## 0. Where this came from, and what was already here

**The `worlds` branch wrote a *16 — Publish* on 2026-09-14**, beside its rewrite
of [15](15-world.md), and it is the material for this note — adapted rather than
adopted, because `main` built three of the things it specified while the branch
was out, and built them slightly differently. [26 B17](26-open-questions.md) says
where the branch's text is reachable.

**What `main` already had on 2026-10-04**, read from the code rather than from
the notes, because a design for an export flow that claimed an exporter the code
does not have — or ignored one it does — would be wrong on day one:

| What | Where | What it does, and does not |
|---|---|---|
| **The closure table** | [04 §9.1](04-schemas.md) | Specifies the walk: ten rows, the three hook rows added 2026-09-22, newer than the branch's. **No code walks it.** |
| **Download** | [10 §5.0a](10-ui-surfaces.md), `GET /library/:kind/:id/download` | One object as stored — an actor as its card, everything else as its JSON. No closure, no conversion |
| **Export as…** | [10 §5.0a](10-ui-surfaces.md), `EXPORT_FORMATS` | Writers into other applications' formats, each saying what it lost. One object |
| **Export this package** | [P11.10](workplan/28-p11-implementation.md), `GET /library/packages/:id/export`, `packaging/export.ts` | A Package's declared contents resolved **one level** and written as `storyengine.package-export/1` — a manifest beside the objects, `.sepack.json`, no pixels — with a count of what no longer resolves. **No walk, no review, and no reader**: the guide says plainly that a `.sepack.json` cannot be imported |
| **Session export** | [P11.10](workplan/28-p11-implementation.md), `storyengine.session-export/1` | One session, whole — every turn, its renditions' records, not their pixels — and **Load a session** reads it back on another install |

So most of the *specification* existed and most of the *flow* did not. What this
note adds is the part that was never anybody's: the flow over every kind, the
review as a surface, the World it keeps, and the two rows the walk needs once a
World and a session can be in it.

## 1. Why this is a document rather than a button

**[04 §9.1](04-schemas.md) already specified the walk and the review**, under the
heading *one action produces a package*. That section keeps the closure table and
its normative force, and this note exists for three reasons it could not carry:

- **It is a flow over every kind, and §9.1 lives inside the definition of one.**
  Publishing an actor, a lorebook, a selection and a World are one gesture with
  different starting points; specifying it inside the container's schema section
  made it read as the container's feature.
- **Its output is no longer only a file.** §9.1 ends *"exporting produces a file,
  not a library object"*, with keeping one as a separate *Save this package*
  action. [15](15-world.md) inverts that: the durable set is the point, and the
  file is its image. §3 is where that lands.
- **Nothing owned the surface.** Export was a verb in a list
  ([10 §5](10-ui-surfaces.md)), a closure table in a schema note, and a link on
  one kind's page. Import got a review step argued over three times
  ([P4 §1.4](workplan/16-p4-implementation.md),
  [P4 §7.17](workplan/16-p4-implementation.md)); export got a bullet.

## 2. What you can publish

**Any library object, any selection of library objects, and any World — and,
inside a World, its sessions.** The starting point decides nothing except where
the walk begins.

| Start from | What comes out |
|---|---|
| One actor, lorebook, treatment, setup or preset | That object and its closure |
| A selection of any of those, in one panel or across several | All of them, and the union of their closures |
| A World | Its members and their closures — the case the other two are special cases of |
| A session, as a member of a World being published | Its session export, and the closure of what it names (§4) |

**One object as itself is not Publish's — it is Download's**
([10 §5.0a](10-ui-surfaces.md)). *Here is a character* is the commonest thing
anyone will ever send, and the stored object is already a file; wrapping it in a
World would be ceremony. So the two doors stay two: **Download** hands over one
object exactly as stored, and **Publish** hands over a closure. When an object's
closure turns out to be the object alone, the review says so and offers Download
beside it, because nothing more than the object would leave. **Publishing one
object keeps no World either way** — from its detail page, or a selection of one
in a panel: a World is a set somebody named (§3), and one object with what the
walk found is not one. The file is what comes out, and the library is unchanged.

**One session as itself is not Publish's either** — it is session export, which
[P11.10](workplan/28-p11-implementation.md) built and *Load a session* reads.
A session reaches Publish by being a member of a World (§5), because *this story*
and *these stories, with the setting they were played in* are different things
to send, and the second is the one that needs a review.

**A manuscript is not on this list at 1.0.** [13 §5.3](13-write-mode.md) keeps
Manuscript in the internal tier with a portability *path* rather than a promise,
and publishing one would be an interchange claim no second implementation would
honour. A manuscript may be a World member when Write lands — the reference is
harmless — and simply does not reach the wire until the tier is promoted; the
review says it was left behind and why.

**A connection is never on it**, and there is no toggle to put one there
([00 §3.2](00-stance.md)): portable kinds have nowhere to hold one.

## 3. Publishing a selection is how a World gets made

**This is the part that is new rather than moved**, and it answers the question
[15](15-world.md) would otherwise leave hanging: where does a World come from, if
not from play?

Select five things and publish them, and you have described a set. The file is
what you send; **the World is what you keep**, and keeping it is not a second
action to remember — it is what publishing a selection *means*. *A selection
here is two or more*: one object is the object, whatever its closure carries
along, and §2 sends it out without making anything. The old *Save
this package* affordance goes, along with the problem it was invented to solve:
§9.1 worried that saving on every export *"would fill the library with
near-identical bundles nobody chose to keep"*, which is true of a snapshot and
not true of a set. **Publishing the same World twice produces two files and one
object.** Publishing *from* a World creates nothing new.

**So [04 §9.1](04-schemas.md)'s `[OPEN]` closes, and the code had answered it
first.** It asked whether a saved package re-resolves its closure on re-export or
replays the exact contents it was built with, and leaned re-resolve, with a diff.
A World **re-resolves**, necessarily: it holds references and the objects are
edited in place, so the published file is the frozen image and the World is not.
*That is already what `packaging/export.ts` does* — it reads every named object
from the library at the moment of export — so the lean has been the shipped
behaviour since [P11.10](workplan/28-p11-implementation.md), and this note makes
it the design. *Show the diff* was the right instinct and belongs to §5:
publishing a World you have published before opens on what changed.

**One case stays a snapshot, and says so.** Publishing a selection you do not
want to keep produces a file and no World — the *send this and forget it* path.
It is offered as a choice in the review rather than inferred, because a person
who did not want a library entry should not have to delete one, and a person who
did should not have to notice they were supposed to tick something. The default
is to keep: a World nobody opens again is cheap, and §8's first test is what says
whether that default was right.

## 4. The closure walk

**Filling a container by hand — find the treatment, find its three lorebooks,
remember the actor whose own lorebook the cast depends on, check nothing dangles —
is exactly the work nobody does.** So the closure is computed by following
outbound references transitively from wherever you started.

**The table is [04 §9.1](04-schemas.md)'s, and it is normative there.** It is not
copied here, because two copies of a table is the drift
[polish §1](workplan/06-polish.md) spends its argument on, and the copy is the one
that goes stale. As of this note it has twelve rows: the ten that stood on
2026-09-22, including the three hook rows that were *owed since P7*, and two
added with this note for the kinds [15](15-world.md) admits:

- **World — every member, and each member's closure; included, each member
  individually uncheckable.** A World is a list of starting points, so its
  closure is the union of theirs. *Uncheckable* is what makes the review
  honest: the set you keep and the file you send may differ, and the review is
  where that is decided, per member.
- **Session — its `treatment`, its `lore[]`, its cast and persona, and their
  closures; the session included; never a sibling session.** A session's own
  copies — its Setup, its preset, its hook pool and its goals — are inside its
  session export already and need no walk; session-local actors
  ([03 §2.3](03-data-model.md)) are designed but not on `SessionFile`, so there
  is nothing of theirs to carry. **The exclusion is the row's
  point**: a session's closure reaches the objects it names and stops. It does
  not pull in the other sessions of the same World, because *this story* and *my
  six stories* are different things to send and one must not silently become the
  other.

**What a walker built against the table has to get right**, since the table
itself says these and a walker is where they would be lost:

- **Bare references and wrapped ones are different shapes.** `Treatment |
  cast[].ref` carries a wrapper; an actor's lore links and a hook's
  `involves[]` and `introduces.actor` are bare `Ref`s. §9.1 spends a paragraph on
  the walker that resolves `undefined` on every element of the second kind and
  drops every edge silently; that paragraph is this flow's specification as much
  as the table's.
- **Every level, not the first.** `packaging/export.ts` resolves exactly one
  level — the contents a Package already declares — which is why the omission of
  the hook rows cost nothing for three phases: *the walker does not exist either*.
  [P16.3](workplan/35-p16-world.md) builds it, and against the table as it stands
  rather than as anybody remembers it.
- **A reference that resolves to nothing is reported, never dropped and never
  refused.** That is P11.10's rule for a Package and it holds for a closure: a
  set outlives an object it names, and the review says so where the export route
  today says it in a count under the link.

**`requires` is derived where it can be.** A Setup names a concrete mode, so
`requires.modes` is populated from it rather than typed by hand; extension and
capability requirements come from what the collected objects actually reference.
An author can add to the list and should rarely need to.

## 5. The review, which is the surface

**Every level is shown, not just the first.** The actor two steps out whose
lorebook came along is named, because *why is this so large* should be
answerable before the file exists rather than after.

- **Unchecking a `required` link is permitted and warned about.** `required`
  describes the author's intent and never blocks ([00 §3.3](00-stance.md)) — but
  it is the one case where the review says plainly that the recipient will be
  missing the world, not a nice extra.
- **Sessions are a checkbox each, defaulted off — and this is the whole of the old
  two-features problem.** The old [15](15-world.md) sent *share the setting* and
  *share my sessions* to different features; here they are one flow and one
  decision per session, off until ticked, because sending somebody your
  transcripts is a thing to choose rather than a thing to discover you did. A
  ticked session leaves as its session export, inside the World's file.
- **History is opt-in, and the review says which it is doing.** A published file
  carries each object, not its edit history ([03 §11.6](03-data-model.md)) —
  *"a working record people do not necessarily intend to publish"* — and the
  toggle carries that sentence. [polish §3.1](workplan/06-polish.md)'s *the
  active version, with full history as an opt-in* is the same rule.
- **Pictures, and the review says what it is carrying.** The envelope P11.10
  shipped carries each object's JSON and no pixels — so an actor travels without
  the portrait its card holds, and a lorebook without the gallery in its
  `assets/`. Until §5.2's question is answered, the review names every picture
  that stays behind, by object, rather than letting a recipient find the gaps.
- **Re-publishing opens on the diff.** §3's consequence: what changed since the
  last file, so *send them 1.2* is a decision made against what 1.2 actually is.
  [polish §3.1](workplan/06-polish.md) already wanted this and had nowhere to put
  it.
- **It renders in the panel, not a modal**, for the reason import's does: a
  pending decision that vanishes when somebody collapses the form is worse than
  one that does not fold ([10 §5](10-ui-surfaces.md)). No stepper.

**The review writes one thing, and it is the point.** It stages nothing and holds
no copy: the file is produced on confirm from the library as it is then, which is
the posture [P4 §7.17](workplan/16-p4-implementation.md) took for import preview —
no server-side scratch copy — and it means the preview can be wrong if you edit
an object while looking at it, which is the honest failure rather than a
prevented one. **The one write is the World**, kept on confirm when the starting
point was a selection of two or more and the snapshot choice was not taken,
because that is what publishing a selection means (§3). Starting from one object
writes nothing (§2).

### 5.1 And the other side: a World arriving

The mirror is the import review [10 §5](10-ui-surfaces.md) already has, and a
published file goes through it rather than beside it. **A hand-picked file
reports first and commits on a word**: what is inside, by kind and name — the
manifest exists so that *do I want these in my library* can be answered before
anything is written — what already exists here, and what dangles. On commit, the
objects land as library objects, each ticked session lands through the session
reader P11.10 built as a new session, and **a World lands naming what landed**.

**It reads both formats.** [P16.3](workplan/35-p16-world.md) writes the World's
own format and reads the frozen `storyengine.package-export/1` beside it, so a
`.sepack.json` written before the rename imports as a World. Nothing reads one
today, so nothing anyone holds is stranded by the rename; the legacy read is for
the files dev installs have written since P11.10, and it is kept.

### 5.2 [OPEN] Whether the World's file is JSON or a zip

**The question the pictures bullet defers**, and [P16](workplan/35-p16-world.md)'s
revisit decides it before P16.3 writes a format, because that format is frozen
the first time a release writes it.

- **P11.10's JSON envelope, renamed.** A manifest beside each object's stored
  JSON. It is specified, emitted and tested today, and it is one file a person
  can read in a text editor. **It cannot carry an actor's portrait**, because an
  actor is stored as a card image and its JSON is a reading of that card; and
  inlining pixels would be the *hundred megabytes of base64* P11.10 refused.
- **A zip of the members' own stored folders**, stored rather than deflated —
  [03 §5.2.3](03-data-model.md)'s folder-as-file, which is already how `.seactor`
  is specified and how SillyTavern's `.charx` works. Each member arrives as
  exactly what is on disk, card and `assets/` included, and *an unrecognised
  folder is carried through* is the envelope rule by a cheaper mechanism.

**Lean: the zip**, on the argument that embedding is a fact about the file
([15 §3.1](15-world.md)) and an actor without its face is not the object. Its
cost is a writer the server does not have — it reads zips, for `.charx` and
import, and writes tar for backups — and a format that is not one readable
document. Sessions inside it would be their session exports, which stay JSON.

## 6. Where it lives

**In the library, as import already is.** [10 §5](10-ui-surfaces.md) commits to
*one list component, one set of badges, filters, sorting and bulk actions, one
detail route, one import and export path* — Publish is that export path given a
name and a surface, not a new place in the application.

**It is not a fourth top-level surface**, and the temptation to make it one
should be named so it can be refused. Publish reads like a destination because
the word implies an audience; there is no audience, there is a file. A surface
exists when a set of modes wants a layout the others cannot give them
([10 §2](10-ui-surfaces.md)), and a review panel over a computed list is not that.

**It is reachable from three places, and all three are the same flow**: an
object's detail page, a selection in a library panel, and a World's own page —
where it replaces today's *Export this package* link. **Sessions reach it through
a World**, added from the session list or from the World's editor
([15 §3.2](15-world.md)), because a selection spanning the library and Play is a
gesture neither surface has. Home does not carry it:
[10 §2.2](10-ui-surfaces.md) reserves arrival for *resume* and *start*, and
publishing is neither.

## 7. Non-goals

- **Not a registry, a store, or a network.** Publishing produces a file on your
  disk. There is no index, no discovery, no upload, no account, and nothing
  reports anywhere. [09 §4.2.2](09-server-multiuser-deployment.md) is explicit
  that this is not a hosted product, and a publish flow is exactly where that
  would erode first.
- **Not sharing between users on one install.** That stays deferred
  ([03 §5](03-data-model.md)) — the path is the owner and there is no sharing
  primitive. Two accounts on one server exchange a file like anybody else, which
  is unglamorous and correct.
- **Not a licence or a rights surface.** `Provenance.license` is the author's own
  statement and the review shows it; it does not offer a picker, explain a
  licence, or check that the objects agree with each other.
  [triage §1.2](workplan/02-triage.md) is clear that content is not a derivative
  work of the application, and this flow has no opinion beyond carrying what the
  author wrote.
- **Not a build step.** No minification, no asset transcoding, no re-encoding of
  anybody's PNG. If the file is a zip (§5.2), it is a container, stored rather
  than deflated ([03 §5.2.3](03-data-model.md)).

## 8. How we would know this was wrong

**Runnable once [P16.3](workplan/35-p16-world.md) ships**, and watched by whoever
publishes, on their own install:

- **Watch whether anyone publishes twice from the same World.** §3's whole claim
  is that the durable set is worth keeping because you come back to it. If every
  publish is a first publish, the World was scaffolding and the snapshot path in
  §3 should have been the default. [15 §8](15-world.md) watches the same risk
  from the kind's side.
- **Watch what gets unchecked.** If the closure is right, the review is mostly a
  confirmation and very little is dropped. If people routinely uncheck half of
  it, the table is over-collecting and the defaults are wrong — which is cheaply
  visible and worth counting.
- **Watch whether the session checkbox is ever ticked.** It exists because
  [15](15-world.md) argued that *share my six sessions* is a real thing to want.
  If nobody ever wants it, session export is serving backup and migration rather
  than sharing, and this flow is carrying a case that belongs elsewhere.
- **Watch which door one object leaves by.** §2 sends a single object to Download
  and a closure to Publish. If people reach for Publish to send one character and
  get nothing Download would not have given them — the closure the object alone,
  again and again — the two doors are one door's worth of distinction, and the
  review's *this is just the object* offer is doing the work a design should have
  done.
