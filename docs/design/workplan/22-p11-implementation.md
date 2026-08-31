# 22 — P11 implementation plan

**Status: skeleton.** Drafted 2026-08-29 alongside
[P7](18-p7-implementation.md) through [P10](21-p10-implementation.md); to be
revisited before the phase starts. [18 §0](18-p7-implementation.md) says what a
skeleton this far out is for, and this is the furthest one — so it is the most a
*register of deferrals* and the least a plan. Format follows
[03](03-p1-implementation.md); citation convention as
[P4](06-p4-implementation.md)'s.

**P11 delivers**, from [01 P11](01-work-plan.md): everything the 1.0 spec commits
to that the phases above did not absorb — the assistant,
editors-are-not-dumb-forms across every editor, the reading view
([05 §12](../05-ui-surfaces.md)), impersonation in Scene
([03 §3.1](../03-modes-and-turn-pipeline.md)), the plot-hook selector's *tuning*,
the in-app update check, the localisation catalogue extraction sweep
([01 §0.4](01-work-plan.md)), trash retention and restore, the systematic
accessibility audit, and **packaging as all six artifacts**.

**Plus three things [01 §0.5](01-work-plan.md) moved into 1.0 after this document
was first written**: session export ([06 B12](../06-open-questions.md)), backup
and restore with its CI restore test ([06 E6](../06-open-questions.md),
[testing](10-testing.md)), and the four packaging artifacts that used to sit at a
"1.0 bar" nothing owned. §1.8 covers what that does to this phase's size, which
is the honest question.

**The demo that defines done:** *a two-hundred-turn story read end to end as
prose and exported as Markdown with no machinery visible — from a fresh
container built reproducibly from a tag, running in French.* Two halves that
have nothing to do with each other, which is honest about what this phase is.

**What "beta" means, and why this phase is where it gets defined rather than
assumed.** [releases §0](11-repo-and-releases.md) defines beta as **feature
complete to the 1.0 spec** — a completeness gate, checkable against the design
documents rather than negotiable — *and* names release engineering as the other
half of the same bar. [01 §8](01-work-plan.md) sketches that half and says
explicitly that it **awaits expansion and should be rewritten rather than
extended**. This phase does the rewriting. A hardening phase that does not know
what it is hardening toward ends when someone gets tired.

**CI this phase establishes:** the thin Playwright tier
([testing §3.5](10-testing.md)) — first-run setup, create an actor, import a
card, start a session, take a turn, branch, open the workbench — against the
fake provider, so it is deterministic and free; and the release pipeline itself
as a check, since a build chain that is not run on every merge is a build chain
that is broken on the day it matters.

---

## 1. Decisions this plan has to make

### 1.1 A hardening phase is a list, and a list without owners never ends

The rule this phase runs on, and the only thing in it that must survive the
revisit intact:

> **Every item names the artifact it completes and the check that says it is
> complete.** An item that cannot name both is not a hardening item; it is a
> feature, and it goes to the roadmap or to a phase.

[01 §8](01-work-plan.md)'s bar plus [releases §0](11-repo-and-releases.md)'s gate
is what the list is checked against — not against a sense that things feel
finished.

### 1.2 The audit comes first, and it is not the same as the work

**P11.0 is a pass over the design documents producing the list**, because the
list does not exist anywhere today. It is scattered across every phase document
as *home P11*, and one of those homings is already a warning:
[P2 §2.11](04-p2-implementation.md) says what P11 owns for accessibility is *the
audit — a systematic pass over surfaces built to the habit, not a rescue of
surfaces built without it*, and adds that **a phase that defers the habit has
already made P11's pass a rewrite.** That sentence generalises to nearly
everything in this phase, which is why the audit is a stage rather than a
morning.

### 1.3 The i18n sweep is extraction, and only the discipline made it mechanical

[01 §0.4](01-work-plan.md) reduced the i18n obligation to three things that
cannot be retrofitted — never assemble a sentence from fragments, never branch on
displayed text, CSS logical properties and `Intl` — and moved **catalogue
extraction** here as a pre-beta sweep. The trade is explicit: *extraction over a
codebase that never concatenated is mechanical work; extraction over one that did
is a rewrite.*

[P2 §1.4](04-p2-implementation.md) narrowed [testing §2](10-testing.md)'s strings
rule to match, and recorded the count of real violations as **two** rather than
the ninety the wide rule flagged. **So the sweep's size is measurable before the
phase starts**, and re-running that count at the revisit is the cheapest possible
early warning: if it has grown from two to twenty, the discipline eroded and this
stage is a different size than planned.

Two things the sweep must do beyond extraction, both already latent:
[04 §3.4](../04-server-multiuser-deployment.md)'s notification summaries are
`{ key, params }` and the params must carry everything the sentence needs; and
[P3 §3](05-p3-implementation.md) records the key-and-params conversion of the
workbench's collector as P11 sweep debt — *a block's `reason` is free English
prose in a durable record* — with one line pointing here so P3 is not the phase
that quietly ratifies it.

### 1.4 The reading view is cheap, which is why it is at risk

[05 §12](../05-ui-surfaces.md) calls it a 1.0 feature and a cheap one — every
input exists, it is a path through the turn tree rendered as prose, HTML with a
real print stylesheet plus Markdown and plain text, and no PDF library. Cheap
items in a hardening phase are the ones that get cut when the phase runs long,
so the argument for keeping it is worth carrying in the plan rather than
rediscovering: **readability and rollback are a pair.** Rollback is branching —
you can always go back. Readability is this — you can always see what you have.
Together they are what makes someone willing to commit two hundred turns; either
alone is noticeably less reassuring.

**And it must not drift toward the workbench.** They read the same records and
share nothing else. If the reading view starts showing costs, it has become the
thing it is the opposite of.

### 1.5 The assistant is the mode contract's third witness, arriving late

[03 §7.4](../03-modes-and-turn-pipeline.md): *it is a session, in a mode, with an
actor card — that is the whole design*, and **if building it requires a parallel
chat implementation, something in the mode contract is wrong.**
[18 §1.8](18-p7-implementation.md) raises the consequence from the other end: 1.0
ships the more similar pair of modes, so the contract gets a weaker test than the
design assumed, and the assistant is the least similar consumer available.

**The two plans must agree at their revisits.** Either the assistant's mode
definition moves to P7 as the contract's third witness and P11 builds only its
surface and tools, or it all stays here and P11 accepts that it may find the
contract wrong after everything is built on it. What must not happen is both
documents leaving it to the other.

### 1.6 The update check produces a signal P10 already ships a surface for

[21 §1.7](21-p10-implementation.md) states this from the other side and leans to
moving the check into P10. Recorded here so the two plans do not both defer it:
**the check is small**, [04 §6.5](../04-server-multiuser-deployment.md) argues
the connectivity signal is free because the request is being made anyway, and its
best use is not the badge but **better error messages** — *"this server appears
to have no internet access"* instead of a raw DNS or TLS error, and the same
sentence at first run before someone configures a remote provider that will never
work.

Whichever phase builds it, the conditionality is the part not to lose: an install
whose connections are all local is a legitimate deployment, and telling its
operator their server is broken because it cannot reach a release feed would be
both wrong and irritating.

### 1.7 The hook tuning is not the hook build — a correction 01 already made

Both the P7 line and the P11 line have read as owning the plot-hook selector, and
two homes for one job is a scheduling argument waiting to be had.
[P7](18-p7-implementation.md) ships the mechanism. **What is left here is the
part that can only be done by playing**: what the four pacing levels resolve to,
how long a commitment should wait, how the judgement prompt is worded, and the
hook panel affordances that make a large pool authorable
([05 §10.1](../05-ui-surfaces.md)). [01 §2.1](01-work-plan.md) lists *that hook
pacing works at all* among the hypotheses nothing has tested — every claim in
these documents is a hypothesis, and none is tested by being written down — and
this is the phase that tests this one.

### 1.8 This phase grew by three, and the growth should be sized rather than absorbed

[01 §0.5](01-work-plan.md) moved three things into 1.0 and gave all three to this
phase. None was a scope increase for the *product* — each was already wanted —
but all three were previously outside any phase, which is a different thing from
being cheap.

**Packaging is now all six artifacts, not two.**
[releases §0](11-repo-and-releases.md) still requires only the OCI image and the
tarball *for beta to count*, and that is unchanged. What changed is that `.deb`,
AUR, Homebrew, the Windows service and the unraid template
([04 §5.3](../04-server-multiuser-deployment.md)) are owned here rather than by a
"1.0 bar" — a bar this phase had itself put out of scope, which left four
required artifacts with a requirement and no builder. The unraid template is
worth naming because it is the one most likely to feel obligatory: a first-class
artifact *for 1.0*, and a half-working template is worse than none.

**Session export is the largest of the three and the one with a dependency.**
It drags `localActors`, channel state, branch structure and renditions
([06 B12](../06-open-questions.md)), and it **freezes the turn record** — which
is why [17 §4](../17-write-mode.md) has to be settled before the format is
fixed, not after. That is a design dependency on a document about a 2.0 feature,
and it is the sharpest scheduling consequence of the release re-cut. If §2's
audit finds 17 unsettled when this stage arrives, the stage blocks on 17 rather
than guessing.

**Backup and restore is the smallest.** Quiesce, archive excluding the index,
restore and rebuild ([06 E6](../06-open-questions.md)). The part that matters is
the CI restore test, which belongs to [testing](10-testing.md) rather than here.

**What this means for the phase.** P11 was already the largest and least
well-specified phase in the plan, and this makes it larger. The response is not
to quietly absorb it: §2's audit stage should size these three alongside
everything else it finds, and if the answer is that P11 has to split, that is a
finding rather than a failure. A phase that ends when someone gets tired is the
failure mode this document exists to prevent.

---

## 2. Stages

The audit first, because §1.2 says the list does not exist; then the two large
user-facing items; then the sweeps, which are cheapest once nothing new is
landing; then release engineering, which gates the phase rather than being part
of it.

### P11.0 — The audit that makes the list

A systematic pass over the design documents producing every 1.0 commitment with
no owner, cross-checked against every *home P11* recorded in the phase
documents. §1.3's violation re-count runs here. §1.1's rule is applied as the
list is built, not after.

*Ends at:* a list where every item names its artifact and its check — and a
count, so the phase's size is known before it starts rather than discovered.

### P11.1 — The reading view

[05 §12](../05-ui-surfaces.md): any node rather than only the head, live rather
than an export step, renditions inline where P9 produced them, HTML with a real
print stylesheet plus Markdown and plain text. §1.4's fence enforced.

### P11.2 — Editors are not dumb forms, across every editor

[05 §11](../05-ui-surfaces.md) applied where P1's prototype editor, P2A's forms,
P5's entry editor and P7's panels each stopped short: the field assist contract,
provenance ([05 §11.2](../05-ui-surfaces.md)), image slots, and
[05 §11.2c](../05-ui-surfaces.md)'s entry-level import and export. The polish
half of this is [polish §1–§2](09-polish.md)'s and lands there or here but not
twice.

### P11.3 — The assistant

§1.5's decision executed: the mode definition wherever it ended up, plus the
surface ([05 §7](../05-ui-surfaces.md)) — summonable from anywhere as a panel,
starter prompts, ambient context **disclosed as a block in the turn record**,
domain tools rather than filesystem tools, and every mutation a reviewable diff
carrying `GeneratedFieldProvenance`.

### P11.4 — Scene's remainder, and impersonation

[03 §3.1](../03-modes-and-turn-pipeline.md)'s impersonation, which
[P2's P2.6 stage](04-p2-implementation.md) recorded as shipping in Scene *at
P7/P11 scope* — so this stage is whatever half of that P7 did not take, and
the revisit should start by finding out which.

### P11.5 — Hook tuning, played

§1.7. Not a build stage — a stage whose output is settings, prompt wording and a
panel that survived contact with a real pool.

### P11.6 — Update check, About badge, and better failures

§1.6, if P10 did not take it; the conditional connectivity warning, admin-only;
and the error-message improvement that is the feature's actual value.

### P11.7 — Trash retention and restore, and the accessibility audit

[P2 §2.11](04-p2-implementation.md)'s F7 second half — delete already *moves* to
`users/<h>/trash/`, history and all, so what is missing is the retention sweep
and the restore UI ([02 §10.2](../02-data-model.md)). And §1.2's accessibility
pass, which is an audit over surfaces built to the habit or it is a rewrite.

### P11.8 — The localisation sweep

§1.3: extraction into catalogues, the deliberately bad machine-generated French
for testing ([07 §12.4](../07-tech-stack.md)), and missing keys falling back to
English **silently, per key** — a 60%-translated UI should look bilingual, not
broken.

### P11.9 — Release engineering, which is the other half of the bar

[01 §8](01-work-plan.md) rewritten rather than extended, and then built: CI that
builds, tests and produces artifacts on every merge; reproducible builds of the
container and the tarball from a tag; the release cut automated — tag, build,
publish, changelog; channels wired and *boring*, because a nightly that is often
broken is worse than none ([releases §4](11-repo-and-releases.md)); version and
commit embedded in the build, which AGPL §13 requires anyway and which
[P10](21-p10-implementation.md) needs for its About surface.

*Ends at:* the demo.

---

## 3. Verification — the P11 exit gate

Sketch; expand on revisit. **This gate is also the beta gate**, which is the one
structural difference from every other phase document here.

1. P11.0's list is empty, item by item, with each item's named check green.
2. A two-hundred-turn session reads end to end as prose, at the head and at an
   abandoned node, prints to a clean PDF through the browser, and copies as
   Markdown that pastes usefully elsewhere.
3. Every editor in the app offers assist, provenance and history — and a
   collapsed section names what inside it is not at its default, the invariant
   [P5 §2](07-p5-implementation.md) refused to cut.
4. The assistant answers a question about the user's own library, proposes a
   change as a diff, and the applied change carries provenance. **And no part of
   it is a second chat implementation** (§1.5) — the check is a grep and it
   belongs in the gate.
5. Hook pacing at each of four levels produces recognisably different sessions,
   and a session at `sparse` with eligible hooks explains its own quiet.
6. The app runs in the test French with no layout breakage, and an untranslated
   key renders English with no placeholder and no console noise.
7. A deleted object is restorable within the retention window and gone after it,
   with its history intact in both directions.
8. The Playwright journeys pass against the fake provider, on CI, on every
   merge.
9. `git tag` produces the container and the tarball reproducibly, and the
   artifact reports the tag's commit.
10. **Only a person can walk, and it is the whole gate:** read the 1.0 design
    documents and say, capability by capability, whether it exists and works.
    That is what [releases §0](11-repo-and-releases.md) means by feature
    complete, and it is deliberately checkable against documents rather than
    negotiable.

**And the standing line from [01 §2.3](01-work-plan.md): no phase exits with
configuration that has no surface.** By this phase the line is not a per-phase
check but a **completeness claim** — there is no later phase to defer to, so
anything still configurable only by text editor either gets a surface here or
gets removed.

---

## 4. Out of scope, deliberately

The branch tree visualiser ([14 §1](../14-roadmap.md)); the Character Studio
([20 §4](../20-authoring.md)); the file browser
([06 D3](../06-open-questions.md)) and Tailscale
([06 D1](../06-open-questions.md)), all four on the feature list; the prologue
packages that unblock once export lands ([06 B10](../06-open-questions.md));
chapterisation and embeddings ([14 §3](../14-roadmap.md),
[06 E2](../06-open-questions.md)); quality evals of any kind
([testing §4.3](10-testing.md)); and every committed release after 1.0 — the
Write surface, World, Campaign and the authored-rule tier — which are scheduled
rather than deferred ([01 §5](01-work-plan.md)) and whose arrival answers
[01 §0.2](01-work-plan.md)'s checks.

**No longer out of scope, and moved into §1.8:** session export, backup and
restore, and the four packaging artifacts. All three were listed here when they
had no release; [01 §0.5](01-work-plan.md) gave them one, and it is this one.

**One item here is a design dependency rather than a deferral.**
[17](../17-write-mode.md) is a 2.0 document, and export cannot freeze the turn
record until its §4 is settled. That does not put Write in this phase; it puts
*settling 17* on the critical path to a stage in it.

**And the one thing a hardening phase most wants to add and must not:** polish.
[09-polish.md](09-polish.md) is a working todo list with its own bar, and its
items are user-facing, bounded, and need no schema change and no new contract.
Items graduate *out* of it when they clear the roadmap bar; they do not graduate
into a release gate because the gate happened to be open.
