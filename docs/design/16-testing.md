# 16 — Testing, validation and automation

**Status: proposal.** Expands [07 §13](07-tech-stack.md), which is now a pointer
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
its token cost and the budget verdict ([02 §8](02-data-model.md)). The hardest
thing to test becomes the easiest.

**The architecture states unusually crisp invariants.** Several are properties
rather than examples, and properties make better tests than cases:

| Invariant | Where it comes from |
|---|---|
| Rebuild-from-disk index equals the incrementally-maintained index | [02 §5.1](02-data-model.md) |
| Replay-from-zero state equals nearest-snapshot-plus-replay, at every turn | [10 §4](10-branching.md) |
| Summaries shared across a fork are byte-identical to the parent's | [10 §5](10-branching.md) |
| Object → embedded PNG chunk → object is identity | [02 §5.2](02-data-model.md) |
| Export → import preserves unknown fields | [13 §2](13-schemas.md) |
| No advisory block ever appears in an effect-producing call | [03 §5.2](03-modes-and-turn-pipeline.md) |
| No portable object contains a connection or credential | [00 §3.2](00-stance.md) |

These are cheap to assert and they fail loudly when a refactor breaks the design
rather than the code.

---

## 2. Encode the day-one checklist as lint rules

[15 §2](15-work-plan.md) lists a couple of dozen decisions that are free early
and expensive late. A useful fraction are **mechanically checkable**, and a lint
rule is worth more than a paragraph in a document nobody re-reads.

| Rule | Enforces |
|---|---|
| Ban `Math.random` and direct `node:crypto` random outside the RNG service | [07 §14.4](07-tech-stack.md) |
| Ban `margin-left` / `padding-right` / `text-align: left` in CSS — logical properties only | [07 §12.6](07-tech-stack.md) |
| No bare user-facing string literals in components | i18n from the first component |
| No hand-rolled date/relative-time formatting; `Intl` only | [07 §12.6](07-tech-stack.md) |
| No direct `fs` outside the storage package | keeps the path-resolution helper the only door |

**Architectural boundaries deserve the same treatment**, and here it is not
hygiene but the enforcement of a stated design bet. [07 §10](07-tech-stack.md)
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
security-sensitive code in the project ([05 §4.4](05-ui-surfaces.md)) and it is
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
  ([07 §4](07-tech-stack.md)).
- **Schema evolution tests**: an object written against `schema/1` must still
  load once `/2` exists, and unknown fields must survive a round trip
  ([13 §2](13-schemas.md)). Most projects skip this and discover the problem from
  users.
- A **wild corpus** of real third-party exports that must import without
  crashing. See §5 for the licensing wrinkle.

### 3.5 End-to-end

Playwright, kept deliberately thin — a handful of journeys that would be
catastrophic to break: first-run setup, create an actor, import a card, start a
session, take a turn, branch, open the workbench.

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
  ([00 §2.3](00-stance.md));
- provider errors, rate limits, timeouts, mid-stream disconnection;
- prompt-cap overrun and the fragment-dropping behaviour
  ([07 §5.3](07-tech-stack.md));
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

- **A small library** — a handful of actors, lorebooks, settings, setups, a
  preset. Hand-authored, deliberately including awkward cases: an actor with no
  media, a lorebook with recursive entries, a setting with a dangling required
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

---

## 6. CI

GitHub Actions, three tiers:

**On every pull request** — must be fast enough that it is never skipped:
typecheck, lint including the boundary rules, unit, golden-file, schema
validation, build.

**Nightly** — provider conformance (live), the full wild-corpus import run,
longer property-test budgets, and a rebuild-from-disk consistency run over a
large generated library.

**On tag** — reproducible build, artifact publish, changelog
([12 §4](12-repo-and-releases.md)).

Two project-specific automations worth having beyond the usual:

- **Dependency licence scanning.** Dependencies must be AGPL-compatible
  ([08 §1](08-triage.md)), and SSPL/BUSL/source-available terms appear in this
  space. A CI check on the dependency licence set is cheap and catches it at PR
  time rather than at release.
- **Forward-port check.** Flag any commit on a `release/*` branch with no
  counterpart on `main` — the one failure the branching model is prone to
  ([12 §3](12-repo-and-releases.md)).
- **Restore test**, nightly, beside the upgrade test. Populate a data directory,
  back it up, restore into a clean install, assert the library and sessions come
  back. **An untested restore is not a backup** ([06 E6](06-open-questions.md)),
  and this is the whole reason the backup story can stay as small as it is — the
  index being derived means the archive excludes it and the restore rebuilds it.

Renovate or Dependabot for updates, grouped so the noise stays manageable.

---

## 7. The extension test kit

Extensions are third-party code running in our process ([06 A1](06-open-questions.md)),
so giving authors the means to test is partly self-defence. Published with the
SDK:

- **A harness that runs a step in isolation** against a fixture session and the
  fake provider.
- **Manifest and channel-schema validation.**
- **The replay-determinism check** — replay an extension's recorded effects and
  assert its behaviour reproduces. This is what catches unrecorded randomness
  ([11 §4.5](11-roadmap.md)), and it is a better guarantee than a lint rule we
  cannot apply to code we do not own.

If the first-party dice and poker extensions ([11 §4.4](11-roadmap.md)) are
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
