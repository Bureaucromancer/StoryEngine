# 26 — P9 implementation plan

**Status: skeleton.** Drafted 2026-08-29 alongside
[P7](23-p7-implementation.md), [P8](25-p8-implementation.md),
[P10](27-p10-implementation.md) and [P11](28-p11-implementation.md); to be
revisited before the phase starts. [P7 §0](23-p7-implementation.md) says what a
skeleton this far out is for. Format follows [P1](07-p1-implementation.md);
citation convention as [P4](16-p4-implementation.md)'s.

**P9 delivers**, from [work plan P9](01-work-plan.md): per-turn and on-demand
illustration ([06 §10](../06-modes-and-turn-pipeline.md)), built against the
general **rendition** shape so that video and speech are later *kinds* rather
than later subsystems — **and the backdrop a scene is staged against**, which is
the same shape under a second *purpose*
([06 §10.1a](../06-modes-and-turn-pipeline.md), §1.7).

**The demo that defines done:** *a turn completes on text and an image arrives
seconds later, rendering in place; illustrate a turn from forty turns back and
get a second rendition beside the first, not instead of it; delete the pixels of
both and re-create either from its recipe; walk into a new place and the backdrop
follows, walk back and the first one returns without being paid for twice, and
rewind past the doorway and it is behind you again.*

**The shortest phase in the plan, and the one with the most surprising first
stage.** Two things it does not have to build are already settled and already
paid for: renditions never block the turn, so a failed image is a placeholder
with a retry button rather than a failed turn
([06 §10.2](../06-modes-and-turn-pipeline.md)); and a rendition is **not** a
channel effect, so it does not participate in state
reconstruction — a branch inherits a turn's renditions by inheriting the turn
([07 §2](../07-branching.md)). What it does have to build first is a contract that
does not exist (§1.1).

**CI this phase establishes:** golden-file coverage of prompt assembly under the
provider's declared cap — the ranked-fragment path from
[19 §5.3](../19-tech-stack.md) getting its second consumer and its first one with
a hard external limit — plus the recipe-survives-eviction property: *for any
rendition, dropping `asset` and re-running from `prompt` and `provenance`
produces a request byte-identical to the original's.* The backdrop's reuse key
is the same property read from the other side (§1.7), so it is one assertion
rather than a second harness: *equal recipes hash equal, and a place already
rendered dispatches no job.*

**That property is now load-bearing in a way it was not when it was written**,
because one fragment of the prompt is written by a model
([06 §10.3](../06-modes-and-turn-pipeline.md)). Byte-identical re-runs and equal
digests both survive only if the moment is stored and **replayed** rather than
asked for a second time, so the assertion has to be run against an implementation
that makes no text call on re-creation. Written the natural way it regenerates,
the golden files pass anyway on the day, and the digest quietly stops matching
itself a month later. P9.1 says it again where the code is.

---

## 0. What this document is, six phases out

[P7 §0](23-p7-implementation.md) states the shared answer. Two things are
specific to this one, and both are about a phase whose subject does not exist
yet in any form.

**§1.1's claim was re-checked on 2026-08-31 and still holds:** `Rendition` is
specified in [06 §10](../06-modes-and-turn-pipeline.md) and appears in **no
schema** — the name is absent from `packages/shared/src` entirely. So this
phase is not extending a type, it is introducing one, and §1.1 is the decision
that matters most in the document. Everything after it is a consumer.

**It is the phase most dependent on other phases having gone well**, which is
unusual for something this late and worth naming:

- **P6 owes it reconstruction-at-a-node.** §1.3 — old turns rendered against
  *recorded* state rather than present state — is only answerable because P6
  makes *that turn's state* a thing you can ask for.
  [P6 §0](18-p6-implementation.md) now records the dependency from its end.
- **P10 owes it a router.** §1.5 is explicit that `artifact.ready` has a
  producer here and a consumer two phases later, which means this phase ships a
  signal nobody listens to and has to say so rather than quietly not emitting
  it.
- **P7 owes it a step that can be added without a back door.** A rendition step
  is the mode contract's fourth witness, after Scene, Freeform and the
  assistant, and the first one added by a phase that is not about modes.
- **P7 also owes it a channel value it can write.** §1.7 — the backdrop
  channel P7 declares must hold a media reference able to name a rendition's
  asset, not only an uploaded file. Free there, a migration here.
  [P7.9](23-p7-implementation.md) records it from its end.

---
## 1. Decisions this plan has to make

### 1.1 `Rendition` is specified in one document and appears in no schema

**The phase's first stage is a contract, not a feature**, and this is the reason.
[06 §10.1](../06-modes-and-turn-pipeline.md) gives the full interface — `kind`,
`purpose`, `scope` (both halves, §1.6), `state`, `prompt`, `asset`, `provenance`,
`error` — and it is the only place in the design that has it. It is **not** in
[04](../04-schemas.md), which owns portable objects; **not** in
[21](../21-internal-contracts.md), which owns internal ones; and **not** in
[03](../03-data-model.md), which owns what is on disk. `sessions/<id>/assets/`
exists in the layout with nothing writing to it.

That is the same shape of gap as
[P2B §1](10-p2b-provider-configuration.md)'s missing fallback layer — three
documents relying on a thing no document defines — and it is named here so it is
found while planning rather than on the day. The remedy is small: one section in
[21](../21-internal-contracts.md), one paragraph in
[03 §5](../03-data-model.md) about where the bytes live, and the turn record's
link to them.

**One field of that interface names a type that does exist, and it is the wrong
one.** *Found 2026-09-01, while adding §1.7.* `Rendition.provenance` is typed as
`GeneratedFieldProvenance`, which ships today in
`packages/shared/src/schema/common.ts` — and it cannot carry what
[06 §10.7](../06-modes-and-turn-pipeline.md) requires. Its `seed` is documented
as *"the input the generation ran from"*, a string holding the prompt an assist
ran against; §10.7 means the **sampling seed**, and calls it *"the load-bearing
field here, and the one an implementation is most likely to drop as
uninteresting"*. There is also no field for workflow parameters, which the same
paragraph says are never discarded.

So the recipe promise is **not satisfiable by the type the design names**, and
the two readings of `seed` are close enough that an implementation would satisfy
the type, pass review, and quietly ship a rendition that cannot be reproduced.
That is a small correction and a large one at the same time: it sharpens *the
contract is the phase* rather than contradicting it, and it is the second
strongest argument in this document for P9.0 existing as a stage. The revisit
decides whether renditions get a provenance type of their own or
`GeneratedFieldProvenance` grows — and either way the digest §1.7 depends on has
to hash something real.

**Internal rather than portable, leaning — and the counter-argument now has a
date.** A rendition hangs off a turn, and turns are internal. The
counter-argument is that the recipe is the durable half and someone will want it
to survive an export.

When this was written, export was [25 B12](../25-open-questions.md) with no
release attached, so deciding here would have been deciding early and blind.
**Export now ships at 1.0** ([work plan §0.5](01-work-plan.md)) at P11, which is after
this phase — so the lean still holds, but it is no longer a decision that can be
left indefinitely. **P9 owes P11 an answer rather than a lean**: what a rendition
contributes to an exported session, and whether the recipe travels with it.

### 1.2 The provider layer speaks chat, and no image endpoint does

`image` is one of the eight model roles ([19 §5.1](../19-tech-stack.md)) and is
**unset until a matching connection exists**, because there is no sensible
text-model fallback for it. So the role vocabulary is ready. What is not ready is
the adapter: `Provider` in `packages/server/src/providers/types.ts` is
`generate(request) → GenerationResult` with an optional text `stream`, and
[19 §5.5](../19-tech-stack.md)'s compatibility surface is stated as *if it speaks
OpenAI-compatible chat, it works* — which no image-generation API does.

So the phase owns a genuine question rather than a wiring job: **does `Provider`
grow a second arm, or do renditions get their own client behind the same
connection and binding machinery?** The considerations, so the revisit does not
re-derive them:

- Connections, credentials-never-leave-the-server, role binding and the
  five-layer override order are all worth reusing whichever answer wins; the
  *capability record* and the request/response shapes are not.
- [19 §5.5](../19-tech-stack.md) already says the chat bet is reversible at a
  single seam because rendering is isolated as one step. A second *provider
  kind* is a larger claim than a second renderer and should be made
  deliberately.
- Whatever ships must not make `image` look bound when nothing can serve it.
  [P2B](10-p2b-provider-configuration.md)'s dangling posture is the precedent:
  visible, named, and never a turn that fails obscurely.

### 1.3 Old turns: recorded state or present state

[06 §10.6](../06-modes-and-turn-pipeline.md)'s standing `[OPEN]` — whether an
on-demand rendition of an *old* turn assembles from that turn's recorded state or
from the present. Recorded state is more correct and more surprising; the turn
record makes either possible.

**Decidable now in a way it was not when written**, because P3 shipped the record
reader and P6 shipped reconstruction at a node — so *that turn's state* is a
function call rather than a research project. **Lean: recorded**, with the
surprise mitigated by saying which it used, in the rendition's own prompt
listing, where the workbench already shows ranked fragments.

**Backgrounds are the case where recorded is not even surprising** (§1.7). A
backdrop's whole subject is *where you were standing*, so present state is
visibly the wrong answer — regenerating the tavern from a rooftop three hours
later is a bug nobody has to have explained. Worth noting because it is
evidence rather than restatement: an argument that looks finely balanced on
illustrations is one-sided on the other purpose, and the field they share should
not be decided twice.

### 1.4 Eviction is a later decision, and that is only true if the hook ships

[25 E3](../25-open-questions.md) is explicit that an eviction policy can be
adopted later *because adopting one can never cost history*. That holds only if
two things are true from the first commit: `asset: null` renders as a
regenerable placeholder rather than a broken image, and the recipe — prompt,
seed, model, workflow parameters — is never discarded. **The policy is deferred;
the shape that makes it safe is not**, and a phase that ships pixels without
`asset: null` having a rendering has quietly made eviction a migration.

### 1.5 `artifact.ready` has a producer here and a router two phases later

[09 §3.5](../09-server-multiuser-deployment.md) defines the class and names
renditions as its only 1.0 producer; the notification **router** is
[P10](27-p10-implementation.md)'s. So this phase emits an event nothing routes,
and the phases are in that order for good reasons on both sides.

The obligation that follows is [09 §3.4](../09-server-multiuser-deployment.md)'s
and it is cheap here and expensive later: the event carries its class, its target
user resolved **server-side**, `actionable: false`, a renderable summary as
`{ key, params }` rather than English prose, and a dedupe key. Getting the schema
right is the retrofit risk; the delivery is additive.

**A backdrop arriving emits the same event**, and does not earn a class of its
own: [09 §3.5](../09-server-multiuser-deployment.md) named the class
`artifact.ready` rather than `rendition-ready` precisely so its second instance
would not require renaming it, and a second *purpose* is a weaker case for a new
class than a second kind would be. Whether a backdrop is worth ringing about is
a delivery-policy question and therefore P10's — the summary's `{ key, params }`
has to distinguish the two purposes so P10 *can* decide, which is the only part
that is this phase's to get right.

### 1.6 Three fields whose absence would force a schema change later

[06 §10.5](../06-modes-and-turn-pipeline.md) records the first two. `kind` is a
union from the first commit even though only `"image"` is ever written, and
`scope.messageId` exists even though images rarely need it — speech is per
utterance, and under `per-actor` dispatch a turn holds several. Neither is
speculative machinery: they are fields whose absence would force a schema change
on a stored type.

**`scope.anchor` is the third, and it is the one with a consumer in this phase**
([06 §10.4a](../06-modes-and-turn-pipeline.md)). That makes it a different
argument from the other two rather than a longer version of the same one: they
are shapes held open for kinds nobody builds at 1.0, while the anchor is used on
the first turn P9 illustrates — the picture lands *in* the prose rather than
under it — and its miss path (P9.1) gets exercised long before the multi-moment
turns of §4's deferred judgement depend on it. Note what that does to the
section's own framing: `scope` is now a field two callers want different halves
of, which is a better warrant for its shape than the one it was introduced with.

**What is *not* being pre-built** is any provider, step or surface for the other
two kinds. The shape is general; the implementation is images.

### 1.7 Backgrounds are the second thing this phase delivers, and a second field

*Added 2026-09-01.* [06 §10.1a](../06-modes-and-turn-pipeline.md) is the design
side of this; what follows is what it costs the phase and what the phase owes
back.

**The gap it closes is older than this document.**
[06 §7.2](../06-modes-and-turn-pipeline.md) has described Scene as *"staged
scene, optional background and sprites"* since it was written, and has always
said backgrounds are steps writing to channels. **No document has ever said
where the image comes from.** [P7.9](23-p7-implementation.md) repeats the
channel and inherits the silence; [P4](16-p4-implementation.md) counts
SillyTavern's `backgrounds/` folder among the directories it *skips*, correctly,
because thirty JPEGs are not a StoryEngine object. So at the end of P7 the
engine has a channel that says which backdrop is showing and nothing at all that
can give it a value. **This is the phase that can, and the reason is that a
backdrop is a rendition.**

**`purpose` is one closed union, and it is not `kind`.** `kind` answers *how is
this produced* — provider, latency, cost, the axis on which the three kinds of
[06 §10.1](../06-modes-and-turn-pipeline.md) genuinely differ. `purpose` answers
*what is it for*. The rejected shape is putting `"background"` into `kind`,
which is smaller by one field and wrong in a way that shows up exactly once, late:
an animated backdrop is `{ kind: "video", purpose: "background" }` here and
inexpressible there. In a document with a whole section (§1.6) about the two
fields that keep video cheap, spending the union that carries video on something
else would be a particular kind of own goal.

**The other rejected shape is not doing it here at all**, leaving backdrops to
P7's channel and a folder of uploads. That is a smaller P9 and it costs the three
things renditions exist to provide: a permanent recipe, accumulation with
selection, and a workbench row. A backdrop is the rendition a user stares at
longest and the one most likely to be regenerated until it is right, which makes
it the *worst* candidate for the version with no history.

#### What it adds to this phase, honestly

- **A field**, in P9.0, alongside the rest of the contract. Free at that moment
  and a migration at any later one.
- **A second ranking of the same fragments**, in P9.1. Not a second assembly
  path — the same step under the same cap, ranking channel state and tone up and
  the turn's output text and actor descriptors out, because a backdrop is a place
  and not a moment.
- **A channel binding**, in P9.3, which is the stage that already owns selection.
- **A control and a surface**, in P9.4.

**What it does not add is a mechanism.** The pointer to the selected backdrop is
an ordinary `ChannelEffect`, so rewind and branching come from
[07 §2](../07-branching.md) with nothing written for them, and
[06 §10.2](../06-modes-and-turn-pipeline.md)'s corollary is sharpened rather than
weakened: *the artefact is not an effect; the selection is.* If this phase finds
itself writing branch-aware code for backdrops, the split was implemented
backwards.

#### The reuse key, and the money

**A backdrop generates when the place changes, not every turn**, and the second
half matters more: **before dispatching, the step looks for a ready background
rendition in this session whose recipe digest already matches** — a hash over
the assembled ranked fragments as sent, excluding the sampling seed — and selects
that one. Returning to a place you have been costs nothing, and it returns the
backdrop you *chose* for that place, because the digest resolves to the currently
selected sibling rather than the oldest.

**The digest is free, and that is not a coincidence.** It hashes the recipe
minus the seed — the assembled prompt, which is the same artefact this
document's own exit gate re-runs in the recipe-survives-eviction property. A
recipe permanent enough to re-run is a recipe stable enough to key on; if the
digest turns out to be hard to compute, the property is not being honoured, and
the digest is a cheap early warning for it. (Subject to §1.1's finding — the seed
has to be a field the recipe actually holds before excluding it means anything,
and in the type the design currently names it is not.)

**This is also §5's cost question, answered for the one purpose that could
answer it.** Every other rendition is a deliberate act that spends money once.
A backdrop is the one the engine would run on its own, and per-turn it would
multiply the bill by the length of the session. Keyed, it costs roughly one image
per *place*. That does not settle what a rendition costs a person — §5 is right
that none of the budget, quota or consent vocabulary exists — but it stops
backgrounds from being the reason the question becomes urgent.

#### What P9 owes P7, and it is one sentence in P7's document

**The background channel's value must be a media reference able to name either
an authored image or a rendition's asset, from the declaration onward.** P7 ships
that channel two phases before anything can generate for it, so the natural
declaration is the one that matches what P7 can actually produce — a file
somebody uploaded — and narrowing it that way means widening a channel's schema
under live sessions ([06 §4.2](../06-modes-and-turn-pipeline.md)) to admit the
generated case. It is free in P7 and a migration in P9, which is the same shape
of obligation [P6 §0](18-p6-implementation.md) already records from its end, and
it is recorded in [P7.9](23-p7-implementation.md) from that end.

#### The line this does not cross

**Text in, images out.** A background prompt is built from channel state as
*text*. Conditioning generation on a location's `reference` **image** is
**lore-conditioned renditions**, deferred past 1.0 by [24 §3](../24-roadmap.md)
and by §4 below, for a reason that survives contact with this feature: *choosing
which images* is the hard part when six active entries and three present actors
all carry references, and attaching all of them produces mud.

Naming it here rather than only in §4 because **a backdrop of a place is the most
plausible excuse anyone will ever have to cross that line** — the location entry
is right there, it has exactly one `reference` image, and the selector problem
looks solved for this one case. It is not solved; it is absent, and the next
request after it works for one location is the one with six.

---

## 2. Stages

### P9.0 — The contract

§1.1: `Rendition` lands in [21](../21-internal-contracts.md), the bytes get a
home in [03 §5](../03-data-model.md) under `sessions/<id>/assets/`, and the turn
record links to them. §1.2's provider question answered and written down before
any adapter is chosen. **Both unions are closed here** — `kind` with one value
ever written and `purpose` with both (§1.6, §1.7) — and §1.1's `provenance`
finding is resolved rather than inherited, because the recipe is what §1.7's
digest and the exit gate's property both hash.

*Ends at:* a rendition record that can be written, read and rendered as
`state: "pending"` with no provider behind it at all.

### P9.1 — The step, and the prompt

An ordinary `post`-stage step ([06 §10.3](../06-modes-and-turn-pipeline.md)),
composing from what is already there: **the moment**, present actors'
`VisualDescriptors` and their `reference` media, channel state, and the
treatment's tone. Assembled as **ranked fragments under the provider's declared
cap** ([19 §5.3](../19-tech-stack.md)) so overrun drops the lowest-ranked
fragment rather than truncating mid-sentence — work that was specified for
exactly this case and has had no consumer until now.

**The moment is the one fragment with an author**, and it is where this stage
stopped being pure assembly. A cheap `fast`-role call reads the turn's output
text and answers *what is the picture of*, because handing a whole paragraph to
an image model produces a prompt about a paragraph
([06 §10.3](../06-modes-and-turn-pipeline.md)). The call also returns the
**anchor** — a verbatim quote saying where in the message the picture belongs
([06 §10.4a](../06-modes-and-turn-pipeline.md)) — and its miss path is built
here, not deferred: an anchor that does not resolve renders the image at the end
of its message and records the miss, and it must never fail the rendition.

**One image per turn this phase.** The call asks for *the* moment, singular.
[06 §10.4](../06-modes-and-turn-pipeline.md)'s count judgement — a list, a
salience, a cap, top-*k* — is specified and deliberately not built (§4), which is
only safe if this stage does not foreclose it: the step contract emits a **list**
of rendition requests from the first commit even though the list has one element,
and the ordering field the judgement will sort on has a home on the record.

**The moment is written once and replayed, never regenerated.** This is the
constraint that keeps a model call from costing the phase its central property:
the recipe-survives-eviction assertion above and the backdrop reuse key both hash
the fragments as sent, and a second call is a second answer. Re-creating an
evicted rendition makes **no text call at all** — it replays the stored fragment.
Test it in that direction, because the natural implementation regenerates and the
golden files will still pass on the day it is written.

**And the background ranking, which is the same step with a different answer**
(§1.7): channel state and tone up, the turn's output text and the actor
descriptors out — **and no moment call**, because a backdrop is a place and a
place has no moment. Built here rather than later because two rankings of one
fragment set is the design, and a second assembly path written in P9.4 under
pressure to show a backdrop is how it stops being one. The **recipe digest**
lands with it, over the fragments as sent.

### P9.2 — Jobs that never block, and the surfaces that follow from that

Renditions dispatched as their own jobs, arriving over the event stream and
rendering in place; placeholder while pending; retry on failure; §1.5's event
shape. This is the stage where [06 §10.2](../06-modes-and-turn-pipeline.md)'s
*not an optimisation, the only workable design* is either true in the code or
quietly false.

### P9.3 — Accumulation, selection, and the permanent recipe

Many renditions per turn with the user choosing which is shown — structurally
the turn tree again, siblings under a node, and for the same reason:
regeneration must never be destructive
([25 E3](../25-open-questions.md), [06 §10.7](../06-modes-and-turn-pipeline.md)).
Variations ship; §1.4's `asset: null` rendering ships with them.

**The backdrop's channel binding belongs here**, because *which one is showing*
is the same question this stage answers for illustrations and a different
mechanism only for backdrops: a `ChannelEffect` naming the selected rendition
(§1.7). Digest reuse resolves through that selection, which is what makes
returning to a place return the backdrop you picked for it rather than the first
one generated there. Rewind and branching are then [07 §2](../07-branching.md)'s
and nothing is written for them — the check is that nothing *was*.

### P9.4 — Controls

Per session: off, on-demand only, or each turn that has a moment worth one
([06 §10.6](../06-modes-and-turn-pipeline.md)). The third setting reads as
conditional in the design because the count judgement may answer none — but that
judgement is §4's deferral, so **what P9 ships behind that label is one image per
turn**, and the label is written to survive the later phase rather than promise
what it does not yet do. Per-mode defaults, since Scene wants illustration far
more than a text-only Freeform does. The manual **Illustrate** action on any
message in the history — the same step invoked by hand, additive and never
replacing — and §1.3's decision, disclosed.

**Neither pacing dial is P9's** — not the cap and not the cadence
([06 §10.6](../06-modes-and-turn-pipeline.md)). They arrive with the judgement
they gate, and building either here would be a control over a decision nothing
makes yet.

***And nothing owns the judgement they arrive with*** — found 2026-09-14 by
[P11 §0.1](28-p11-implementation.md)'s sweep.
[06 §10.4](../06-modes-and-turn-pipeline.md) says the count judgement *"lands in
a later one"* and **P10 and P11 are the only later phases; neither mentions it**.
So this deferral, and the two dials with it, currently point at nobody — which
is [manual testing §10.1](05-manual-testing.md)'s exact shape, a deferral moved
off one owner and onto a phase that never took it. *The narrowing that makes it
smaller than it reads:* the **storyboard surface** downstream of the judgement is
on the feature list ([24 §3.3](../24-roadmap.md)) rather than in 1.0, so what is
actually unowned is the judgement and the two dials, not the surface they would
feed. Recorded here rather than assigned, because inventing an owner is the
thing that stops anybody looking.

**The backdrop's own control, which is off or on and has no per-turn setting**
([06 §10.6](../06-modes-and-turn-pipeline.md)): *on* means when the place
changes, and a per-turn backdrop is the failure mode rather than the thorough
option. **Set the scene** is its manual counterpart. And the surface it renders
on — [10 §2.3](../10-ui-surfaces.md), where the constraint is that the prose
wins: a backdrop is chrome behind a reading column, never a thing the story has
to compete with. **Off leaves Play exactly as it was**, which is
[06 §7.2](../06-modes-and-turn-pipeline.md)'s text-only-is-first-class applied to
the feature most likely to treat its own absence as an empty state.

### P9.5 — The workbench over renditions

Deferred here by name from [P3 §5](15-p3-implementation.md). Renditions are
worth showing for the same reason calls are: they cost money, they can fail, and
*why did this one come out different* is answerable from two seeds. No new
viewer — the block and call tables already exist and this is a third row kind.

*Ends at:* the demo.

---

## 3. Verification — the P9 exit gate

Sketch; expand on revisit.

1. A turn completes on text with an image still pending, and the session is
   fully usable while it resolves.
2. The image arrives over the event stream and renders in place; close the tab
   mid-generation and reattach to the finished result.
3. A failed rendition is a placeholder with a retry, and the turn is `complete`
   rather than `failed`.
4. Illustrate a turn from forty turns back: a **second** rendition appears
   beside the first and the first is still selectable.
5. Set `asset` to null on both: the recipes remain, the placeholders render as
   regenerable, and re-running either produces the same request (the property
   test).
6. Two renditions of one turn carry different seeds, and the workbench says so —
   *why did this one come out different* is answerable without guessing.
7. A prompt that overruns the provider's cap drops its lowest-ranked fragment
   and says which, rather than truncating mid-sentence.
8. With no `image` binding, the controls say plainly that nothing can serve them
   — the dangling posture, not an obscure turn failure (§1.2).
9. Branch a turn that has renditions: the branch inherits them by inheriting the
   turn, and nothing was replayed to make that true.
10. Walk into a new place and a backdrop follows; walk back and the first one
    returns **without a second generation being dispatched** — asserted on the
    job, not on the pixels, because a reuse that quietly regenerates looks
    identical on screen and only shows up on a bill.
11. Rewind past the doorway: the earlier backdrop is showing again, and the
    diff of what P9 wrote to make that work is empty (§1.7). Branch at the same
    point and both branches are in their own room.
12. Turn the backdrop off: Play is pixel-identical to a text-only session, and
    no `image` call was made.
13. An illustration renders **at its anchor** — inside the prose, at the sentence
    the moment call quoted, not underneath the message
    ([06 §10.4a](../06-modes-and-turn-pipeline.md)).
14. Edit that message so the quote no longer occurs in it: the image renders at
    the end of the message, the unresolved anchor is recorded, and the rendition
    is still `ready`. A miss is ordinary and must never be an error — this is the
    assertion that stops the natural implementation from throwing.
15. Re-create an evicted rendition and **no text call is made**: the moment is
    replayed from `prompt`, not asked for again (§1.1, P9.1). Assert on the call
    log, because assertion 5's byte-identical request passes either way on the
    day it is written and only diverges later.

**And the standing line from [work plan §2.3](01-work-plan.md): no phase exits with
configuration that has no surface.** Five settings arrive here — the per-session
illustration mode, the per-mode default, the backdrop's own on/off, and two role
bindings, since the moment call (P9.1) needs a `fast` binding beside the `image`
one. Both bindings belong on
[P2B](10-p2b-provider-configuration.md)'s existing surface rather than a new one;
the other three do not have a surface anywhere in
[10](../10-ui-surfaces.md) yet, and P9.4 is where that debt comes due.

---

## 4. Out of scope, deliberately

Video and speech as *implementations* (the shape is general from P9.0 and the
fields that keep them cheap ship now — §1.6); **the count judgement** — which
moments of a turn deserve a picture, and how many — now specified in full at
[06 §10.4](../06-modes-and-turn-pipeline.md) and deliberately not built here,
along with the storyboard surface downstream of it; an eviction *policy* (§1.4 —
the hook, not the policy); **lore-conditioned renditions**
([24 §3](../24-roadmap.md): committed
intent rather than a maybe, and deferred because *choosing which images* is the
hard part when six active entries and three present actors all carry references
— it wants P7's location channel for an honest selector and real sessions to
tune against — and §1.7 is explicit that a backdrop is the most plausible excuse
for crossing that line and still does not cross it); the Character Studio
([17](../17-character-studio.md)) — which is now a committed release at 3.0 and
therefore the nearest post-1.0 consumer of everything this phase builds, rather
than a member of the authoring tier at 6.0; any model-quality evaluation of
generated images
([testing §4.3](03-testing.md) — do not build quality evals, and an image eval is
the most tempting version of the mistake).

**The count judgement is the one deferral on that list that constrains this
phase**, and the constraint is worth stating because it is easy to honour now and
expensive to recover later. Deferring a design is only cheap when the phase
before it does not foreclose it, so three things are P9's even though the
judgement is not: the step contract emits a **list** of rendition requests rather
than one, from the first commit, with a list of one; the anchor field ships and
is used (§1.6); and the moment call is shaped as *the* moment of a turn, so
widening it to a list of moments with a salience is a change to one call's
schema rather than a new call. Nothing here builds the cap, the ranking or the
pacing dial ([06 §10.6](../06-modes-and-turn-pipeline.md)).

**Three more that backgrounds specifically do not drag in** (§1.7), named
because each is one step away from something this phase does build:

- **Sprites and expression selection stay P7's.** They are steps writing
  channels ([06 §7.2](../06-modes-and-turn-pipeline.md)) and a sprite is not a
  rendition at 1.0. The backdrop is here because it has no source anywhere else;
  sprites have one.
- **Video backdrops stay expressible and unbuilt.**
  `{ kind: "video", purpose: "background" }` is the shape §1.7 preserves and
  §1.6's posture applies unchanged: the union is general, the implementation is
  images.
- **SillyTavern's `backgrounds/` folder stays skipped.**
  [P4](16-p4-implementation.md) counts it among the directories it does not
  convert, correctly — thirty loose JPEGs are not a StoryEngine object — and
  giving backdrops a generator is not a reason to reopen an import decision. An
  uploaded backdrop reaches the channel the way any authored image does.

---

## 5. The honest size, and what only the revisit can settle

*Added 2026-08-31. §1.7's addition folded in 2026-09-01.*

**The contract is the phase; the pictures are the easy part.** P9.0 defines
`Rendition` — a type six phases of design have referred to and none has written
— and once it exists, generating an image is a provider call and a job. The
risk is entirely in getting the type right, because it is the one thing here
that later phases and later *releases* will be stuck with: video and speech are
named in [24](../24-roadmap.md) as things the `kind` union and
`scope.messageId` should keep cheap, and §1.6 is the three fields that do it —
the third, `scope.anchor`, being the one this phase actually uses.

**The provider layer is the second real cost, and it is structural.** §1.2 says
plainly that our provider layer speaks chat and no image endpoint does. That is
not an adapter, it is a second shape of provider — and the honest question the
revisit has to answer is whether image providers go behind the same
`Connection` vocabulary or beside it. Deciding that during P9.1, under pressure
to show a picture, is how the answer gets made by accident.

**Backgrounds did not change that, and this document should not pretend they
made the phase much larger.** §1.7 adds one field to the contract, a second
ranking of a fragment set the step already assembles, a channel write, and a
control — and it removes an absence that P7 would otherwise ship: a backdrop
channel with no possible value. The phase is still short. What it is no longer
is *only* illustration, and the header says so.

**What is smaller than it looks:** jobs that never block (P9.2) reuse the
operational store's job vocabulary, which has existed since P2 and by then will
have carried imports as well as turns. Accumulation and selection (P9.3) is a
list on an object. The backdrop's persistence across turns looks like the
exception and is the cheapest part of it — a pointer in channel state, which is
machinery [07 §2](../07-branching.md) already paid for.

**What is at risk of being cut and should not be:** the workbench over
renditions (P9.5). It is the only surface that answers *why does this picture
look like this*, and this project's whole posture is that a generated thing
explains itself. Cutting it leaves renditions as the one subsystem with no
account of itself.

**Three things only the revisit can settle:**

- **Whether renditions are worth 1.0 at all.** Not currently asked, and it
  should be. This is the phase most easily deferred to a later release without
  the core loop noticing, and [work plan §0.4](01-work-plan.md)'s further-cuts
  discipline is where that argument belongs if PLAYABLE says the loop is thin
  elsewhere. **§1.7 raises the price of that cut** without settling it: deferring
  P9 now also leaves P7 shipping a backdrop channel nothing can fill, so the cut
  has to take Scene's backgrounds with it or explain what does. Worth weighing
  rather than treating as an argument that wins — a channel with no value is a
  smaller embarrassment than a subsystem nobody wanted.
- **Eviction** (§1.4), which the document already makes contingent on the hook
  shipping.
- **What a rendition costs a person.** Every other subsystem here is free to
  run; this one spends money per image on most providers, and none of the
  budget, quota or consent vocabulary that implies exists anywhere in the
  design. That is the gap most likely to be discovered late.

  **Backgrounds arrive with half of their own answer** (§1.7) and it is worth
  separating from the rest. They are the rendition the engine would run on its
  own, which is the version of this question that turns into a bill without
  anyone choosing it — and they are also the only one that caches perfectly, so
  the digest makes a backdrop cost roughly one image per *place* rather than one
  per turn. That removes backgrounds as the reason this becomes urgent. It does
  not answer the question, and the revisit should resist reading it as though it
  had: nothing here gives a person a budget, a quota, or a number before the
  fact.

  **The count judgement brings the other half, and it arrives after this phase**
  ([06 §10.4](../06-modes-and-turn-pipeline.md), §4). Two of its rules are cost
  rules wearing other clothes: a cap enforced in code rather than requested in a
  prompt is the only kind that bounds a bill, and a cadence dial gating the
  judgement puts a *rate* on illustration the way §1.7's digest puts one on
  backdrops. Both narrow the gap. Neither closes it — a rate is not a budget, and
  a person still cannot see a number before the fact — so the vocabulary this
  entry asks for is still missing, and is now missing from a phase later than
  this one too.
