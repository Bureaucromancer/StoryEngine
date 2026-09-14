# 16 — Publish: assembling something to send

**Status: proposal.** Publish is the single user-facing action that turns
something you own into something you can give away: pick an object, a set of
them, a session or a World; the closure is computed and shown; you adjust it;
a file comes out.

**Scheduled for 1.0** ([work plan §0](workplan/01-work-plan.md)), where the
exchange work already sits ([P11](workplan/28-p11-implementation.md)). It reads
after [15](15-world.md), whose kind it fills, and beside
[10 §5](10-ui-surfaces.md), whose import review it is the mirror of.

> **Import is a review step, and so is export.** The asymmetry was never
> intentional.

---

## 1. Why this is a document rather than a button

**[04 §9.1](04-schemas.md) already specified most of it** — the single action,
the reference walk, the review — under the heading *one action produces a
package*. That section stays where it is for the closure table's normative
force, and this note exists for three reasons it could not carry:

- **It is a flow over every kind, and §9.1 lives inside the definition of
  one.** Publishing an actor, a lorebook, a session and a World are the same
  gesture with different starting points; specifying it inside the container's
  schema section made it look like the container's feature.
- **Its output is no longer only a file.** §9.1 ends *"exporting produces a
  file, not a library object"*, with keeping one as a separate *Save this
  package* action. [15](15-world.md) inverts that: the durable object is the
  point, and the file is its image. §3 is where that lands.
- **Nothing owned the surface.** The library's export affordance was a verb in
  a list ([10 §5](10-ui-surfaces.md)) and a closure table in a schema note, with
  no document saying what the person sees. Import got a review step argued over
  three times ([P4 §1.4](workplan/16-p4-implementation.md),
  [P4 §7.17](workplan/16-p4-implementation.md)); export got a bullet.

## 2. What you can publish

**Anything in the library, any set of things in the library, and any session.**
The starting point decides nothing except where the walk begins.

| Start from | What comes out |
|---|---|
| One actor, lorebook, treatment, setup or preset | That object and its closure |
| A multi-selection of any of those | All of them and the union of their closures |
| A session | The session, its `localActors`, its channel state, its branch structure and renditions ([26 B12](26-open-questions.md)) |
| A World | Its members and their closures — which is the case the other rows are special cases of |

**A single object of a single kind may leave as its own file** — `.seactor` for
an actor, and the sibling forms for the rest — because *here is a character* is
the commonest thing anyone will ever send and wrapping one in a World would be
ceremony. Everything else leaves as a `.seworld`.

**A manuscript is not on this list at 1.0.** [13 §5.3](13-write-mode.md) keeps
Manuscript in the internal tier with a portability *path* rather than a
promise, and publishing one would be an interchange claim no second
implementation would honour. Getting a manuscript out stays three things that
already exist: the reading view, the `text/` folder, and a zip that is transport
rather than a format. A manuscript may be a World **member** — the ref is
harmless and the set is the user's to define — and simply does not reach the
wire until the tier is promoted.

## 3. Publishing a set is how a World gets made

**This is the part that is new rather than moved**, and it is the answer to a
question [15](15-world.md) would otherwise leave hanging: where does a World
come from, if not from play?

Select five things and publish them, and you have described a canon. The file
is the thing you send; **the World is the thing you keep**, and keeping it is
not a second action to remember — it is what publishing a set *means*. The old
*Save this package* affordance is gone, along with the problem it was invented
to solve: §9.1 worried that auto-saving on every export *"would fill the library
with near-identical bundles nobody chose to keep"*, which was true of a snapshot
and is not true of a set. Publishing the same World twice produces two files and
one object.

**So [04 §9.1](04-schemas.md)'s `[OPEN]` closes.** It asked whether a saved
package re-resolves its closure on re-export or replays the exact contents it
was built with, and leaned re-resolve. A World **re-resolves**, necessarily,
because it holds refs and the objects are edited in place; the published file is
the frozen image. *Show the diff* was the right instinct and belongs to §5's
review: publishing a World you have published before opens on what changed.

**One case stays a snapshot and should say so.** Publishing an ad-hoc selection
you do not want to keep produces a file and no object — the *send this and
forget it* path. It is offered as a choice in the review rather than inferred,
because a person who did not want a library entry should not have to delete one,
and a person who did should not have to notice they were supposed to tick
something.

## 4. The closure walk

**Filling a container by hand — find the treatment, find its three lorebooks,
remember the actor whose own lorebook the cast depends on, check nothing dangles
— is exactly the work nobody does.** So the closure is computed by following
outbound references transitively from whatever you started with.

The table is [04 §9.1](04-schemas.md)'s, unchanged, and is the normative one:

| From | Follows | Default |
|---|---|---|
| Treatment | `lore[]` where `required` | included, and cannot be silently dropped |
| Treatment | `lore[]` where not required | included, can be unchecked |
| Treatment | `cast[].ref` | included |
| Actor | its bare lore `Ref[]` | included |
| Setup | `treatment`, and the closure above | included |
| Setup | its own `lore[]`, and `cast.personaOptions` / `partyDefault` / `narrator` | included |
| Setup | `preset` | included, can be unchecked — a preset is tuning, and some authors ship it while others would not |

Two rows are added by the kinds §2 admits:

| From | Follows | Default |
|---|---|---|
| **World** | every member, and each member's closure | included; members are individually uncheckable |
| **Session** | `localActors`, the Setup it was started from, and that Setup's closure | the session included; **its sessions-siblings never implied** |

**The second row's exclusion is the one worth stating.** A session's closure
reaches its Setup and stops. It does not pull in the other sessions of the same
World, because *this story* and *my six stories* are different things to send and
one must not silently become the other.

**`requires` is derived where it can be.** A Setup names a concrete mode, so
`requires.modes` is populated from it rather than typed by hand; extension and
capability requirements come from what the collected objects actually reference.
An author can add to the list and should rarely need to.

## 5. The review, which is the surface

**Every level is shown, not just the first.** The actor two steps out whose
lorebook came along is named, because *"why is this 40 MB"* should be answerable
before the file exists rather than after.

- **Unchecking a `required` link is permitted and warned about.** `required`
  describes the author's intent and never blocks ([00 §3.3](00-stance.md)) — but
  it is the one case where the review says plainly that the recipient will be
  missing the world, not a nice extra.
- **Sessions are a checkbox, and this is the whole of the old two-features
  problem.** [15](15-world.md)'s §3 sent *share the setting* and *share my
  sessions* to different features; here they are one flow and one decision,
  defaulted off, because sending somebody your transcripts is a thing to choose
  rather than a thing to discover you did.
- **History is opt-in, and the review says which it is doing.** A `.seactor` or
  `.seworld` carries the object, not its edit history
  ([03 §11.6](03-data-model.md)) — *"a working record people do not necessarily
  intend to publish"* — and the toggle carries that sentence.
- **Re-publishing opens on the diff.** §3's consequence: what changed since the
  last file, so *send them 1.2* is a decision made against what 1.2 actually is.
  [polish §3.1](workplan/06-polish.md) already wanted this and had nowhere to
  put it.
- **It renders in the panel, not a modal**, for the reason import's does: a
  pending decision that vanishes when somebody collapses the form is worse than
  one that does not fold ([10 §5](10-ui-surfaces.md)). No stepper.

**What the review never does is write.** It holds nothing and stages nothing;
the file is produced on confirm from the library as it is then. That is the same
posture [P4 §7.17](workplan/16-p4-implementation.md) took for import preview —
no server-side scratch copy — and it means the preview can be wrong if you edit
an object while looking at it, which is the honest failure rather than a
prevented one.

## 6. Where it lives

**In the Library, as Import already is.** [10 §5](10-ui-surfaces.md) commits to
*one list component, one set of badges, filters, sorting and bulk actions, one
detail route, one import and export path* — Publish is that export path given a
name and a surface, not a new place in the application.

**It is not a fourth top-level surface**, and the temptation to make it one
should be named so it can be refused. Publish reads like a destination because
the word implies an audience; there is no audience, there is a file. A surface
exists when a set of modes wants a layout the others cannot give them
([10 §2](10-ui-surfaces.md)), and a review panel over a computed list is not
that.

**It is reachable from three places, all of which are the same flow**: the
object detail page, a multi-selection in a panel, and a World's own page. Home
does not carry it — [10 §2.2](10-ui-surfaces.md) reserves arrival for *resume*
and *start*, and publishing is neither.

## 7. Non-goals

- **Not a registry, a store, or a network.** Publishing produces a file on your
  disk. There is no index, no discovery, no upload, no account, and nothing
  phones anywhere. [09 §4.2.2](09-server-multiuser-deployment.md) is explicit
  that this is not a hosted product, and a publish flow is exactly where that
  would erode first.
- **Not sharing between users on one install.** That stays deferred
  ([03 §5](03-data-model.md)) — the path is the owner and there is no sharing
  primitive. Two accounts on one server exchange a file like anybody else, which
  is unglamorous and correct.
- **Not a licence or a rights surface.** `Provenance.license` is the author's
  own statement and the review shows it; it does not offer a picker, explain a
  licence, or check that the objects agree with each other.
  [triage §1.2](workplan/02-triage.md) is clear that content is not a derivative
  work of the application, and this flow has no opinion beyond carrying what the
  author wrote.
- **Not a build step.** No minification, no asset transcoding, no re-encoding of
  anybody's PNG. The zip is a container, stored rather than deflated
  ([03 §5.2.3](03-data-model.md)).

## 8. How we would know this was wrong

- **Watch whether anyone publishes twice from the same World.** §3's whole claim
  is that the durable set is worth keeping because you come back to it. If every
  publish is a first publish, the World was scaffolding and the snapshot path in
  §3 should have been the only one.
- **Watch what gets unchecked.** If the closure is right, the review is mostly a
  confirmation and very little is dropped. If people routinely uncheck half of
  it, §4's table is over-collecting and the defaults are wrong — which is
  cheaply visible and worth counting.
- **Watch whether the session checkbox is ever ticked.** It exists because
  [15](15-world.md) argued that *share my six sessions* is a real thing to want.
  If nobody ever wants it, session export is serving backup and migration rather
  than sharing, and this flow is carrying a case that belongs elsewhere.
