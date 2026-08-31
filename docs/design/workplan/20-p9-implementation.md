# 20 — P9 implementation plan

**Status: skeleton.** Drafted 2026-08-29 alongside
[P7](18-p7-implementation.md), [P8](19-p8-implementation.md),
[P10](21-p10-implementation.md) and [P11](22-p11-implementation.md); to be
revisited before the phase starts. [18 §0](18-p7-implementation.md) says what a
skeleton this far out is for. Format follows [03](03-p1-implementation.md);
citation convention as [P4](06-p4-implementation.md)'s.

**P9 delivers**, from [01 P9](01-work-plan.md): per-turn and on-demand
illustration ([03 §10](../03-modes-and-turn-pipeline.md)), built against the
general **rendition** shape so that video and speech are later *kinds* rather
than later subsystems.

**The demo that defines done:** *a turn completes on text and an image arrives
seconds later, rendering in place; illustrate a turn from forty turns back and
get a second rendition beside the first, not instead of it; delete the pixels of
both and re-create either from its recipe.*

**The shortest phase in the plan, and the one with the most surprising first
stage.** Two things it does not have to build are already settled and already
paid for: renditions never block the turn, so a failed image is a placeholder
with a retry button rather than a failed turn
([03 §10.2](../03-modes-and-turn-pipeline.md)); and a rendition is **not** a
channel effect, so it does not participate in state
reconstruction — a branch inherits a turn's renditions by inheriting the turn
([09 §2](../09-branching.md)). What it does have to build first is a contract that
does not exist (§1.1).

**CI this phase establishes:** golden-file coverage of prompt assembly under the
provider's declared cap — the ranked-fragment path from
[07 §5.3](../07-tech-stack.md) getting its second consumer and its first one with
a hard external limit — plus the recipe-survives-eviction property: *for any
rendition, dropping `asset` and re-running from `prompt` and `provenance`
produces a request byte-identical to the original's.*

---

## 1. Decisions this plan has to make

### 1.1 `Rendition` is specified in one document and appears in no schema

**The phase's first stage is a contract, not a feature**, and this is the reason.
[03 §10.1](../03-modes-and-turn-pipeline.md) gives the full interface — `kind`,
`scope`, `state`, `prompt`, `asset`, `provenance`, `error` — and it is the only
place in the design that has it. It is **not** in [10](../10-schemas.md), which
owns portable objects; **not** in [13](../13-internal-contracts.md), which owns
internal ones; and **not** in [02](../02-data-model.md), which owns what is on
disk. `sessions/<id>/assets/` exists in the layout with nothing writing to it.

That is the same shape of gap as
[P2B §1](14-p2b-provider-configuration.md)'s missing fallback layer — three
documents relying on a thing no document defines — and it is named here so it is
found while planning rather than on the day. The remedy is small: one section in
[13](../13-internal-contracts.md), one paragraph in
[02 §5](../02-data-model.md) about where the bytes live, and the turn record's
link to them.

**Internal rather than portable, leaning — and the counter-argument now has a
date.** A rendition hangs off a turn, and turns are internal. The
counter-argument is that the recipe is the durable half and someone will want it
to survive an export.

When this was written, export was [06 B12](../06-open-questions.md) with no
release attached, so deciding here would have been deciding early and blind.
**Export now ships at 1.0** ([01 §0.5](01-work-plan.md)) at P11, which is after
this phase — so the lean still holds, but it is no longer a decision that can be
left indefinitely. **P9 owes P11 an answer rather than a lean**: what a rendition
contributes to an exported session, and whether the recipe travels with it.

### 1.2 The provider layer speaks chat, and no image endpoint does

`image` is one of the eight model roles ([07 §5.1](../07-tech-stack.md)) and is
**unset until a matching connection exists**, because there is no sensible
text-model fallback for it. So the role vocabulary is ready. What is not ready is
the adapter: `Provider` in `packages/server/src/providers/types.ts` is
`generate(request) → GenerationResult` with an optional text `stream`, and
[07 §5.5](../07-tech-stack.md)'s compatibility surface is stated as *if it speaks
OpenAI-compatible chat, it works* — which no image-generation API does.

So the phase owns a genuine question rather than a wiring job: **does `Provider`
grow a second arm, or do renditions get their own client behind the same
connection and binding machinery?** The considerations, so the revisit does not
re-derive them:

- Connections, credentials-never-leave-the-server, role binding and the
  five-layer override order are all worth reusing whichever answer wins; the
  *capability record* and the request/response shapes are not.
- [07 §5.5](../07-tech-stack.md) already says the chat bet is reversible at a
  single seam because rendering is isolated as one step. A second *provider
  kind* is a larger claim than a second renderer and should be made
  deliberately.
- Whatever ships must not make `image` look bound when nothing can serve it.
  [P2B](14-p2b-provider-configuration.md)'s dangling posture is the precedent:
  visible, named, and never a turn that fails obscurely.

### 1.3 Old turns: recorded state or present state

[03 §10.6](../03-modes-and-turn-pipeline.md)'s standing `[OPEN]` — whether an
on-demand rendition of an *old* turn assembles from that turn's recorded state or
from the present. Recorded state is more correct and more surprising; the turn
record makes either possible.

**Decidable now in a way it was not when written**, because P3 shipped the record
reader and P6 shipped reconstruction at a node — so *that turn's state* is a
function call rather than a research project. **Lean: recorded**, with the
surprise mitigated by saying which it used, in the rendition's own prompt
listing, where the workbench already shows ranked fragments.

### 1.4 Eviction is a later decision, and that is only true if the hook ships

[06 E3](../06-open-questions.md) is explicit that an eviction policy can be
adopted later *because adopting one can never cost history*. That holds only if
two things are true from the first commit: `asset: null` renders as a
regenerable placeholder rather than a broken image, and the recipe — prompt,
seed, model, workflow parameters — is never discarded. **The policy is deferred;
the shape that makes it safe is not**, and a phase that ships pixels without
`asset: null` having a rendering has quietly made eviction a migration.

### 1.5 `artifact.ready` has a producer here and a router two phases later

[04 §3.5](../04-server-multiuser-deployment.md) defines the class and names
renditions as its only 1.0 producer; the notification **router** is
[P10](21-p10-implementation.md)'s. So this phase emits an event nothing routes,
and the phases are in that order for good reasons on both sides.

The obligation that follows is [04 §3.4](../04-server-multiuser-deployment.md)'s
and it is cheap here and expensive later: the event carries its class, its target
user resolved **server-side**, `actionable: false`, a renderable summary as
`{ key, params }` rather than English prose, and a dedupe key. Getting the schema
right is the retrofit risk; the delivery is additive.

### 1.6 Two fields that keep video and speech cheap, and cost nothing now

[03 §10.5](../03-modes-and-turn-pipeline.md) records both. `kind` is a union from
the first commit even though only `"image"` is ever written, and
`scope.messageId` exists even though images virtually never need it — speech is
per utterance, and under `per-actor` dispatch a turn holds several. Neither is
speculative machinery: they are two fields whose absence would force a schema
change on a stored type.

**What is *not* being pre-built** is any provider, step or surface for the other
two kinds. The shape is general; the implementation is images.

---

## 2. Stages

### P9.0 — The contract

§1.1: `Rendition` lands in [13](../13-internal-contracts.md), the bytes get a
home in [02 §5](../02-data-model.md) under `sessions/<id>/assets/`, and the turn
record links to them. §1.2's provider question answered and written down before
any adapter is chosen.

*Ends at:* a rendition record that can be written, read and rendered as
`state: "pending"` with no provider behind it at all.

### P9.1 — The step, and the prompt

An ordinary `post`-stage step ([03 §10.3](../03-modes-and-turn-pipeline.md)),
composing from what is already there: the turn's output text, present actors'
`VisualDescriptors` and their `reference` media, channel state, and the
treatment's tone. Assembled as **ranked fragments under the provider's declared
cap** ([07 §5.3](../07-tech-stack.md)) so overrun drops the lowest-ranked
fragment rather than truncating mid-sentence — work that was specified for
exactly this case and has had no consumer until now.

### P9.2 — Jobs that never block, and the surfaces that follow from that

Renditions dispatched as their own jobs, arriving over the event stream and
rendering in place; placeholder while pending; retry on failure; §1.5's event
shape. This is the stage where [03 §10.2](../03-modes-and-turn-pipeline.md)'s
*not an optimisation, the only workable design* is either true in the code or
quietly false.

### P9.3 — Accumulation, selection, and the permanent recipe

Many renditions per turn with the user choosing which is shown — structurally
the turn tree again, siblings under a node, and for the same reason:
regeneration must never be destructive
([06 E3](../06-open-questions.md), [03 §10.7](../03-modes-and-turn-pipeline.md)).
Variations ship; §1.4's `asset: null` rendering ships with them.

### P9.4 — Controls

Per session: off, on-demand only, or every turn. Per-mode defaults, since Scene
wants illustration far more than a text-only Freeform does. The manual
**Illustrate** action on any message in the history — the same step invoked by
hand, additive and never replacing — and §1.3's decision, disclosed.

### P9.5 — The workbench over renditions

Deferred here by name from [P3 §5](05-p3-implementation.md). Renditions are
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

**And the standing line from [01 §2.3](01-work-plan.md): no phase exits with
configuration that has no surface.** Three settings arrive here — the per-session
mode, the per-mode default, and the `image` role binding — and the third of them
belongs on [P2B](14-p2b-provider-configuration.md)'s existing surface rather than
a new one.

---

## 4. Out of scope, deliberately

Video and speech as *implementations* (the shape is general from P9.0 and the
two fields that keep them cheap ship now — §1.6); **beats** and storyboarding
([03 §10.4](../03-modes-and-turn-pipeline.md) — it needs a planner call, and the
schema already permits many renditions per turn, so it is expressible later as a
step emitting several prompts); an eviction *policy* (§1.4 — the hook, not the
policy); **lore-conditioned renditions** ([14 §3](../14-roadmap.md): committed
intent rather than a maybe, and deferred because *choosing which images* is the
hard part when six active entries and three present actors all carry references
— it wants P7's location channel for an honest selector and real sessions to
tune against); the Character Studio ([20 §4](../20-authoring.md)); any
model-quality evaluation of generated images ([testing §4.3](10-testing.md) —
do not build quality evals, and an image eval is the most tempting version of
the mistake).
