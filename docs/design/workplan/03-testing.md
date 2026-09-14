# 03 — Testing, validation and automation

**Status: proposal.** Expands [20 §13](../20-tech-stack.md), which is now a pointer
here.

Written for a solo developer and a very small team, which is the constraint that
shapes every recommendation: **high leverage per unit of effort, and nothing that
needs babysitting.** A flaky suite that gets ignored is worse than a small one
that gets trusted.

---

## 1. Two advantages worth exploiting

This design is unusually testable in two specific ways, and both should be
leaned on hard.

**The turn record makes prompt assembly snapshot-testable.** In all three source
projects, "what did the engine actually send, and why" is the hardest thing to
verify. Here it is a persisted artefact with every block, its source, its reason,
its token cost and the budget verdict ([03 §8](../03-data-model.md)). The hardest
thing to test becomes the easiest.

**The architecture states unusually crisp invariants.** Several are properties
rather than examples, and properties make better tests than cases:

| Invariant | Where it comes from |
|---|---|
| Rebuild-from-disk index equals the incrementally-maintained index | [03 §5.1](../03-data-model.md) |
| Replay-from-zero state equals nearest-snapshot-plus-replay, at every turn | [07 §4](../07-branching.md) |
| Summaries shared across a fork are byte-identical to the parent's | [07 §5](../07-branching.md) |
| Object → embedded PNG chunk → object is identity | [03 §5.2](../03-data-model.md) |
| Export → import preserves unknown fields | [04 §2](../04-schemas.md) |
| No advisory block ever appears in an effect-producing call | [06 §5.2](../06-modes-and-turn-pipeline.md) |
| No portable object contains a connection or credential | [00 §3.2](../00-stance.md) |
| A hook committed or fired on a turn is uncommitted and unfired after a rewind past it | [03 §4.1](../03-data-model.md) |
| The same path selects the same entrance | [06 §6.1](../06-modes-and-turn-pipeline.md) |
| A closure walk over a Treatment reaches an actor named only by `introduces` | [04 §9.1](../04-schemas.md) |
| A fired introduction hook whose arrival was never narrated is not left marked fired | [06 §6.1](../06-modes-and-turn-pipeline.md) |

These are cheap to assert and they fail loudly when a refactor breaks the design
rather than the code.

*The four hook rows arrive with P7 and are listed now because each states a
property the obvious implementation gets wrong.* Firing state kept as a session
field passes every functional test and fails the first; an entrance chosen off
the RNG tape fails the second; a package walker that only follows `cast` fails
the third; and treating *delivered* as *fired* fails the fourth by losing a
character permanently the first time a narrator ignores its guidance.

---

## 2. Encode the day-one checklist as lint rules

[work plan §2](01-work-plan.md) lists a couple of dozen decisions that are free early
and expensive late. A useful fraction are **mechanically checkable**, and a lint
rule is worth more than a paragraph in a document nobody re-reads.

| Rule | Enforces |
|---|---|
| Ban `Math.random` and direct `node:crypto` random outside the RNG service | [20 §14.4](../20-tech-stack.md) |
| Ban `margin-left` / `padding-right` / `text-align: left` in CSS — logical properties only | [20 §12.6](../20-tech-stack.md) |
| No sentence assembled from fragments, and no branching on displayed text | [work plan §2](01-work-plan.md)'s reduced i18n discipline |
| No hand-rolled date/relative-time formatting; `Intl` only | [20 §12.6](../20-tech-stack.md) |
| No direct `fs` outside the storage package | keeps the path-resolution helper the only door |
| `config.example.json` declares every key the schema does | [work plan §2.3](01-work-plan.md)'s mechanically checkable core |

**The last row is a test rather than a lint rule**, and it is in this table
anyway because the table is a list of *claims turned into checks* and that is
what it is. ESLint cannot compare a schema to a JSON document; a two-line
assertion beside the config tests can, and it lives at
[P2A §3](09-p2a-configuration-surface.md). The general shape of
[work plan §2.3](01-work-plan.md) — *does anything this phase built need a value set?*
— is not mechanisable and stays a gate question.

**The strings rule is the reduced one, deliberately.** [work plan §2](01-work-plan.md)
kept the half of i18n discipline that cannot be retrofitted — never build a
sentence by assembling clauses in code, never branch on a displayed string — and
moved catalogue extraction to a pre-beta sweep. An earlier draft of this table
said "no bare user-facing string literals", which is the *unreduced* rule: it
fails on some ninety strings across a client that has no `t()` to put them in,
and it would be satisfied by wrapping each one in a helper that is a catalogue in
everything but name. The narrow rule has a handful of violations, each of them
the thing that actually forecloses translation. Recorded at
[P2 §1.4](08-p2-implementation.md), because the wider rule was on this list from
day one and is being narrowed rather than quietly dropped.

**Architectural boundaries deserve the same treatment**, and here it is not
hygiene but the enforcement of a stated design bet. [20 §10](../20-tech-stack.md)
says built-in modes must consume the published SDK exactly as a third party
would — "a discipline mechanism, not organisation". That only holds if
`modes/*` importing `server` is a **build error**. `dependency-cruiser` or
`eslint-plugin-boundaries` turns the claim into a check:

```
modes/*     → sdk, shared          (never server, never client)
client      → shared               (never server)
sdk         → shared               (never server)
extensions  → sdk                  (never anything else)
```

Stylelint for the CSS rules, ESLint flat config for the rest.

---

## 3. The layers, in order of value

### 3.1 Golden-file assembly tests — the flagship

Given a fixture library and a fixture session, assemble a turn and snapshot the
turn record. Every regression in lore activation, budget behaviour, block
ordering, preset rendering or prompt drift shows up as a reviewable diff.

**Snapshot a rendered table, not raw JSON.** This is the difference between a
suite that gets reviewed and one that gets `-u`'d blindly:

```
block                        source                 reason                     tok  ✓
se.summary                   actor:vera             always                      84  ✓
lore:rain-city/the-docks     lorebook:rain-city     keyword "docks"            132  ✓
lore:rain-city/the-council   lorebook:rain-city     keyword "council"          210  ✗ book budget
channel:clock                channel:clock          always                      12  ✓
history[-8..]                history                 recency                   1840  ✓
                                                                    total 2278/4096
```

A four-thousand-line JSON blob is not a test, it is a rubber stamp.

Marinara's `scripts/regressions/*` pattern is the precedent worth copying as a
*category* — targeted scenario scripts, including a `context-fit` regression
pinning budget behaviour under pressure.

### 3.2 Unit tests on the pure logic

Vitest. The genuinely algorithmic parts, all of which are pure functions and
none of which need a model:

- Keyword matching: whole-word, case, regex, selective AND/NOT logic.
- Timing: sticky, cooldown, delay, ephemeral, and their interactions.
- Recursion: `preventRecursion` / `excludeRecursion` / `delayUntilRecursion`.
- The budgeter's trim order and skip reasons.
- Dice notation, weighted pick, distribution sanity.
- Crop maths and normalised-rectangle round-trips.
- Ref resolution: id → name-fallback → dangle.

**Path resolution deserves an adversarial corpus of its own.** It is the most
security-sensitive code in the project ([10 §4.4](../10-ui-surfaces.md)) and it is
pure, so it is cheap to hammer: `..` in every position, symlinks escaping the
root, absolute paths, UNC paths, Windows reserved device names, alternate data
streams, unicode normalisation, case-folding collisions, and null bytes.

### 3.3 Property tests

`fast-check` for the invariants in §1, especially the round-trips. Round-trip
properties are where property-based testing earns its keep and where
example-based tests systematically miss.

The replay invariant is the highest-value one: **for a generated session of N
turns, state at every index must be identical whether reconstructed from zero or
from the nearest snapshot.** That single property protects branching,
regeneration and undo simultaneously.

### 3.4 Schema and fixture validation

- Validate every fixture and every shipped system-library object against the
  JSON Schemas, in CI. Free, given schemas are the artefact
  ([20 §4](../20-tech-stack.md)).
- **Schema evolution tests**: an object written against `schema/1` must still
  load once `/2` exists, and unknown fields must survive a round trip
  ([04 §2](../04-schemas.md)). Most projects skip this and discover the problem from
  users.
- A **wild corpus** of real third-party exports that must import without
  crashing. See §5 for the licensing wrinkle.

### 3.5 End-to-end

Playwright, kept deliberately thin — a handful of journeys that would be
catastrophic to break: first-run setup, create an actor, import a card, start a
session, take a turn, branch, open the workbench.

*"Create an actor" meant through the API when this was written, because the
browser had no way to. Since [P4.5](16-p4-implementation.md) it does, so the
journey is a journey: name it on the library page, land in the editor, save.
The tier is still unbuilt.*

Run against the fake provider (§4) so it is deterministic and free. E2E that
calls a real model is slow, flaky and expensive, and tests the model rather than
the app.

---

## 4. Testing the model-dependent parts

The hard part, and where naive approaches burn money and produce a suite nobody
trusts.

**Almost nothing should call a real model in CI.**

### 4.1 A fake provider is the main tool

Implement the provider interface with a scripted double: canned responses, and a
record of every request it received. That makes the entire pipeline testable
deterministically, including the paths that are hardest to trigger for real:

- tool calls and structured-output responses;
- malformed structured output, and the bounded re-ask loop
  ([00 §2.3](../00-stance.md));
- provider errors, rate limits, timeouts, mid-stream disconnection;
- prompt-cap overrun and the fragment-dropping behaviour
  ([20 §5.3](../20-tech-stack.md));
- a step failing without failing the turn.

Because it records requests, it also *is* the golden-file harness from §3.1.

### 4.2 Provider conformance, run on a schedule and not on every commit

The one place real calls are warranted. For each provider adapter, a small suite
asserting that streaming, tool calling, structured output and error shapes still
behave as the adapter assumes. **Providers change under you without notice**, and
this is how you find out before users do.

Nightly or weekly, not per-commit. It costs money and it will occasionally fail
for reasons that are not your fault, which is precisely why it must not gate a
merge.

Cassette-style record-and-replay is worth having for the adapter tests so the
recorded shapes can also be asserted offline.

### 4.3 Do not build quality evals

The tempting mistake. LLM-as-judge suites scoring narrative quality are
expensive, noisy, hard to interpret, and answer a question a solo developer can
answer better by playing the thing for twenty minutes.

**Test the mechanism deterministically; evaluate the writing by reading it.**
What is worth automating is whether the right blocks reached the model at the
right budget — which is §3.1, and which is a fact rather than a judgement.

---

## 5. Fixtures

A `fixtures/` corpus is a first-class asset, not test scaffolding:

- **A small library** — a handful of actors, lorebooks, treatments, setups, a
  preset. Hand-authored, deliberately including awkward cases: an actor with no
  media, a lorebook with recursive entries, a treatment with a dangling required
  link.
- **Sessions of varying length**, including one long enough to exercise
  budgeting under pressure and one with a branch structure.
- **A wild corpus** of real third-party exports for import testing.

**The wild corpus has a licensing problem worth solving before P4** rather than
during it: character cards are other people's authored content and generally not
redistributable. Practical answer — synthesise cards that exercise the same
structural edge cases, keep a handful of explicitly-permissive real ones, and
maintain a larger private local corpus for manual verification that never enters
the repository.

**Which corpus CI runs, settled 2026-08-29** ([P4 §1.2](16-p4-implementation.md)
owed this sentence and took it early): **CI runs the in-repo set** — synthesised
plus permissive — per-PR for schema validation and nightly for the full import
run. §6's "full wild-corpus import run" cannot mean the private corpus, because
CI cannot run a corpus that never enters the repository. **The private corpus is
walked by hand**, at gate time and whenever fidelity bugs arrive, with findings
triaged into synthesised fixtures that *can* enter the repo.

**And a correction to the tense: the private corpus does not exist yet.** There
is no used SillyTavern data directory and no used Marinara install on hand, so
the in-repo synthesised corpus carries P4 on its own and the hand-walk is a
named outstanding task rather than a prerequisite that was quietly assumed done.

**Synthesising for a source whose library is a database.** P4 imports two folder
sources, and only one of them is a tree of files. A Marinara fixture is a
**data root** — a `storage/manifest.json` and hand-authored table snapshots,
including one sharded table so both on-disk layouts are exercised
([source survey §1](../01-source-survey.md)). The source checkouts are schema
oracles,
cited by commit; the rows are ours. Copying an install's bundled default
character into a fixture would be redistributing somebody's authored card under
cover of a test, which is the thing this section exists to prevent.

### 5.1 The importers must be tested against each other

**A converted card and a converted preset have to meet**, and testing each
importer alone will not find out whether they do. The card importer routes ST's
`personality` one way ([03 §2.7](../03-data-model.md)); the preset importer points
the `charPersonality` slot somewhere ([04 §8.4.1](../04-schemas.md)). Both can be
individually correct and disagree, and an earlier draft of the two did exactly
that — producing a slot that would have resolved empty forever, hidden by
`omitWhenEmpty`.

So one fixture pair and one assertion:

> Import a SillyTavern directory containing **both** cards and a chat-completion
> preset, assemble one turn from them, and assert that **no slot resolves to
> nothing**.

It is a two-line assertion over machinery the golden-file tests already build
(§3.1), and it catches the whole class: any slot whose source no importer
populates. The class matters because its failure mode is *silence* — no error,
no warning, just a prompt quietly missing a section — which is the one thing
golden-file testing is uniquely good at catching and manual testing is uniquely
bad at.

The same check generalises beyond import: a hand-authored preset referencing
`{ of: "channel", channelId: … }` for a channel the mode does not declare fails
it too, which is worth having.

---

## 6. CI

GitHub Actions, three tiers:

**On every pull request** — must be fast enough that it is never skipped:
typecheck, lint including the boundary rules, unit, golden-file, schema
validation, build. **On both ubuntu and Windows**, from
[P2 §3](08-p2-implementation.md)'s P2.0 — the paths, the watcher and the layout
are exactly the code most likely to be wrong on the platform the CI never ran,
and F4 is the proof of what that costs. And **the rebuild-equals-incremental
property test as a named step**, rather than folded anonymously into the suite:
a gate that can be retired by a `test.skip` nobody notices is not a gate.

**Nightly** — provider conformance (live), the full wild-corpus import run, and
longer property-test budgets, including a rebuild-from-disk consistency run over
a large generated library. *The rebuild property test itself moved to the per-PR
tier above; what stays here is the same property at a corpus size that would
make the per-PR tier slow. Small budget every PR, large budget nightly.*

**On tag** — reproducible build, artifact publish, changelog
([releases §4](04-repo-and-releases.md)). *Built at [P6A.4](19-p6a-alpha-1.md) as
`release.yml`, filtered to `v*`: the image to a private package, the tag checked
against the root `package.json`, the CHANGELOG checked for the entry. Unrun
until the first tag, which is Alpha 1's.*

Two project-specific automations worth having beyond the usual:

- **Dependency licence scanning.** Dependencies must be AGPL-compatible
  ([triage §1](02-triage.md)), and SSPL/BUSL/source-available terms appear in this
  space. A CI check on the dependency licence set is cheap and catches it at PR
  time rather than at release.
- **Forward-port check.** Flag any commit on a `release/*` branch with no
  counterpart on `main` — the one failure the branching model is prone to
  ([releases §3](04-repo-and-releases.md)).
- **Restore test**, nightly, beside the upgrade test. Populate a data directory,
  back it up, restore into a clean install, assert the library and sessions come
  back. **An untested restore is not a backup** ([26 E6](../26-open-questions.md)),
  and this is the whole reason the backup story can stay as small as it is — the
  index being derived means the archive excludes it and the restore rebuilds it.
  **This is a 1.0 requirement rather than an eventual nicety**
  ([work plan §0.5](01-work-plan.md)): backup and restore moved off the feature list and
  into P11, and this test is the half of it that actually establishes anything.
- **Session export round-trip.** Export ships at 1.0
  ([26 B12](../26-open-questions.md), [work plan §0.5](01-work-plan.md)) and freezes the
  turn record when it does. Export a session with branches, `localActors`,
  channel state and renditions; re-import it; assert the tree, the effects and
  the reading order survive. This is the test that makes "the record is frozen"
  a checkable claim rather than a promise.

Renovate or Dependabot for updates, grouped so the noise stays manageable.

---

## 7. The extension test kit

Extensions are third-party code running in our process ([26 A1](../26-open-questions.md)),
so giving authors the means to test is partly self-defence. Published with the
SDK:

- **A harness that runs a step in isolation** against a fixture session and the
  fake provider.
- **Manifest and channel-schema validation.**
- **The replay-determinism check** — replay an extension's recorded effects and
  assert its behaviour reproduces. This is what catches unrecorded randomness
  ([25 §4.5](../25-roadmap.md)), and it is a better guarantee than a lint rule we
  cannot apply to code we do not own.

If the first-party dice and poker extensions ([25 §4.4](../25-roadmap.md)) are
written against this kit, it stays honest.

---

## 8. What not to do

- **No coverage targets.** They measure the wrong thing and reward testing
  getters. The invariants in §1 are worth more than a percentage.
- **Do not mock the filesystem.** The storage layer *is* the thing under test;
  use temporary directories.
- **Do not test the UI heavily** beyond §3.5's thin journeys. It churns most and
  breaks tests for reasons that are not defects.
- **No LLM-as-judge gates.** See §4.3.
- **Do not snapshot raw JSON.** See §3.1.
