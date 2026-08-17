# 04 — P2 implementation plan

**Status: plan.** Expanded from the skeleton at the P2 revisit, after P1
completed and after a code audit of what P1 actually built. Two things changed
since the skeleton: the leans are now argued decisions, and the plan opens with
a repair stage — §1 records why. Format follows [03](03-p1-implementation.md).

**P2 delivers**, from [01 P2](01-work-plan.md): the provider layer with model
roles, assembler → budgeter → render, the complete turn record, the turn as a
resumable server-side job with an SSE event stream, the RNG service, and the
smallest real Scene mode.

**The demo that defines done:** *type a message, get a streamed reply, close the
tab mid-turn, and reattach to the finished result. Read the whole turn record as
JSON.* The reattach half is the architectural claim
([04 §2](../04-server-multiuser-deployment.md)) — a turn is a server-side job, not
a promise in a browser tab — and the JSON half is the record claim
([02 §8](../02-data-model.md)): complete from the first turn, because everything
after P2 reads it.

**P2 is where [13](../13-internal-contracts.md) stops being a document.**
`BlockSource`, `ChannelEffect`, `ChannelState`, `ModelCall`, `BudgetVerdict`,
`RenderedMessage` and `ProviderCapabilities` all become code here, and the
discipline is that they become code *as written* — deviations go back into doc
13 first, because five later phases are specified against it. That discipline
is already exercised once by this plan: `ChannelEffect` gains a `scope` field
in [13 §1.2](../13-internal-contracts.md) before any code writes an effect
(§2.7).

**And P2 opens by paying P1's debt.** P1 shipped fast with minimal review; a
code audit ran before this plan was written, and its verdicts are §1. The
findings do not change P2's charter, but several of them sit directly under
P2's foundations — the write path P2 multiplies, the routes P2 adds to, the
conflict mechanism P2 extends to sessions — so the plan opens with a bounded
hardening stage (P2.0) rather than building on ground known to be soft. The
rule that keeps repair from becoming refactoring is §2.1.

**CI this phase establishes:** golden-file assembly tests
([10 §3.1](10-testing.md)) — fixture library + fixture session → assemble →
snapshot the turn record as a rendered table — **and finishes the P1 gate**:
the rebuild-equals-incremental *property* test as a named CI step, and a
Windows job, both owed since P1 (§1, F11/F17).

---

## 1. The spine P2 stands on

An audit of the P1 codebase (server; shared/client/tooling) ran before this
revisit. This section carries the verdicts and the triage; the finding-level
detail with file references is Appendix A. **Every finding below was then
re-verified against the code before P2.0 opened** — because §2.1 makes this
list P2.0's work order, and a work order that sends someone to write a test
that exists is how a boundary rule stops being believed. What that run changed
is marked in place and summarised in [Appendix A.3](#a3-after-the-audit).

### 1.1 What held

More than "vibe coded" predicts, and the list matters because it is the
argument that P2.0 is a *stage*, not a rewrite. The dual write path was fully
delivered — synchronous self-indexing, consumed-on-claim suppression tokens,
tombstone-and-match — including a real discovered bug (chokidar delivers
add-before-unlink on a rename, the opposite of what P1 §1.1 assumed) found
and fixed correctly. The path-traversal corpus is thorough and includes the
subtle cases (drive-relative paths, ADS, reserved device names on the stem).
The atomic-write kill-safety test SIGKILLs a real child process and guards its
own vacuous pass. `Config` matches [13 §4](../13-internal-contracts.md)
field-for-field with an exhaustiveness test over the tier table. The portable
schemas have zero field-level drift against [10](../10-schemas.md); uuidv7 is
bit-correct with monotonicity handled; unknown-field preservation is enforced
three separate ways. The boundary lint is two-layered and fixture-tested. And
the phase's most fragile commitment — the empty assist slot — held: no assist
scaffolding exists anywhere.

### 1.2 What did not

Twenty findings, numbered here and used by number everywhere below — plus F21,
which is not from the audit at all and says so where it appears.

**Write-path integrity**

- **F3.** The stale-hash check is a TOCTOU: it compares against the index row,
  then awaits three times before writing. It loses against a concurrent `PUT`
  and against a foreign edit younger than the watcher's 150 ms settle window —
  the exact "eat a hand-edit" failure [04 §4.4](../04-server-multiuser-deployment.md)'s
  mechanism exists to prevent.
- **F5.** Version history's JSONL is appended by one code path and
  whole-file-rewritten by two others (pin/rename, prune) with no
  synchronisation — a `PATCH` can eat a concurrent snapshot. The snapshot is
  also taken *before* the write it protects, so a failed write leaves a
  phantom version.
- **F6.** `provenance.updatedAt` is stamped only by the React editor, so
  `VersionRecord.authoredAt` — the subtlety [13 §1.6](../13-internal-contracts.md)
  exists to preserve — is wrong for every other writer: curl, the SDK, and P4's
  importer.
- **F9.** Tombstone maturation only runs from the watcher (rows accumulate
  forever with the watcher off), and `ingestFile` awaits mid-mutation with no
  transaction, so watcher and API ingests can interleave half-applied.
- **F4.** The watcher's `ignored` predicate compares mixed path separators and
  never matches on Windows — the development platform — so the index's own
  SQLite files are watched, feeding events back into the queue.
- **F7.** `DELETE` hard-deletes the object folder *including its history*,
  with `trash.retentionDays` configured and unimplemented and zero DELETE
  tests — precisely the unrecoverable-bad-save scenario P1.7 argued
  history exists to remove.

**Validation and routes**

- **F1.** The symlink-aware resolver — the audited half of "the single most
  important piece of security code in the project" — has **zero production
  callers**. Every real path uses the lexical check only; the corpus tests
  dead code.
- **F2.** No request-body validation on any object route (P1.5 named
  this and it was not delivered): a null body is a 500, and the `:kind` URL
  segment is decorative — `POST /api/library/lorebooks` with an actor body
  creates an actor, and `GET /library/actors/<lorebook-id>` returns the
  lorebook.

**Observability**

- **F8.** There is no logging subsystem at all — Fastify runs `logger: false`,
  `main.ts` uses raw `console.log`, and `log.level`/`log.format` are wired to
  nothing. The config reload tiers are data-only: `pendingRestart()` has no
  callers and no `live` key is actually re-read live.

**Client trust**

- **F12.** The editor's query cache is never invalidated on save or restore,
  so returning to the editor within the cache window loads a stale
  `contentHash` — and the next save raises the conflict dialog *for the user's
  own change*. The flagship P1 mechanism cries wolf.
- **F13.** The editor casts `as unknown as Actor` with no runtime guard and
  the app has no error boundary: a hand-edited actor missing a field — the
  product's *invited* input — is a white screen.
- **F14.** Two silent failures: save-as-a-copy has no error handling, and a
  412 without a parseable body shows neither dialog nor message.

**Test and CI debt**

- **F11.** Exit-gate debt: [P1 §3](03-p1-implementation.md) step 16 (manual vs external
  distinguishable in *one* object's history) is never asserted together;
  rebuild-equals-incremental is three fixed examples, not the property test
  the gate names; step 11's "admin can still log in" half and the whole DELETE
  route are untested.
- **F15.** Two of [10 §2](10-testing.md)'s five day-one lint rules were never
  written (no bare user-facing strings; `Intl`-only) — and four concatenation
  violations exist that they would catch.
- **F16.** Vitest includes `.test.ts` but not `.test.tsx` and no DOM
  environment is installed: component tests are silently impossible, and the
  first one written would lint, typecheck, and never run.
- **F17.** CI is ubuntu-only (the paths and watcher tests never run on the
  platform they were written for — F4 is the proof of what that costs), the
  rebuild gate is not a named step, `format:check` never runs, and lint runs
  without `--max-warnings 0` so warn-level rules can never fail CI.

**Small traps and drift**

- **F10.** A dead `Accounts.invalidate()` whose docstring claims hand-edit
  pickup works; a `layout.accountFile()` helper pointing at the per-user
  account-file anti-pattern P1 §1.3 explicitly overturned; a first-run
  setup token printed but stored and enforced nowhere; cookie `secure=false`
  hardcoded; FTS5 `search()` built with no route; a read-then-write race in
  slug allocation.
- **F18.** Shared and misc: the Package kind has no factory and is absent from
  the round-trip fixtures (5 of 6 covered); the credential denylist test walks
  the TypeBox objects rather than the emitted JSON, leaving the emit step
  untested; emitted schema filenames do not match their `$id`s; the `se.`
  section-prefix reservation is enforced nowhere; `shared` carries two runtime
  deps against P1.0's "no runtime deps"; the editor cannot add/remove
  sections and gate step 17 is unreachable through the UI; the conflict dialog
  has no focus trap; `pnpm dev` fails on a fresh clone.
- **F19.** Duplicate-id rows list correctly, but the detail address contains
  only `{kind, id}` and `findById` always returns the winner. Clicking the
  shadowed row therefore opens the winning copy while the page claims the
  shadowed copy is being shown. The warning exists; the object it warns about
  is not addressable.
- **F20.** An invalid foreign edit is skipped by ingest without replacing or
  annotating the prior valid index row. The P1 closeout's disk re-hash now
  prevents an API write from overwriting those bytes, but the list and editor
  continue to present the old object; P1's visible-filesystem thesis and
  this plan's invalid-object error-card check are not yet true.

**And one finding from after the audit.** `--reset-password` landed once this
plan was already written, so nothing above could have seen it. A verification
pass over §1.2 before P2.0 opened read it:

- **F21.** `--reset-password` is well tested where the work happens —
  `auth/reset.test.ts` covers replace, re-enable, unknown handle, and the
  cross-instance staleness case that the accounts-cache change exists for — but
  the `main.ts` wrapper around it is not: argv parsing, the handle-missing path
  and the exit codes have no test. It is the only entry point in the codebase
  that changes a credential, and the half that a person actually types is the
  untested half.

**And four from reading P2.0 itself.** Before the stage opened, each of its
items was traced from its finding into the code it would touch. That found four
live defects the audit did not, all of them in code P2.0 is about to open —
which is the argument for numbering them rather than fixing them in passing:
§2.1 stops work that cannot cite a number, and a stage that has to stop four
times to argue about scope is a stage that stops being bounded.

- **F22.** `PathEscapeError` is not a `LibraryError`, so `respondToLibraryError`
  rethrows it into Fastify's default 500 — carrying, in the message, **both
  absolute filesystem paths**. It is reachable today without F1: `parseObjectPath`
  lifts `slug` straight off the on-disk folder name and never checks it, so a
  hand-made folder named `con` or `evil.` — legal on Linux, and hand-making
  folders is this design's headline feature — is indexed happily and then 500s
  on history and every other read that rebuilds a path from the slug. *And the
  worse half, found by writing the test: `rebuild` builds each path through the
  same guard with nothing catching it, so one such folder **aborts the whole
  scan** — every object after it left unindexed because of a directory nobody
  asked the server to open.*
- **F23.** The shadowed duplicate is chosen differently on different platforms.
  The index stores the **native** absolute path and orders duplicates by it
  under SQLite's default BINARY collation, so the byte that decides is the path
  separator: `/` is 0x2F, `\` is 0x5C. Where one slug is a prefix of another —
  `vera` and `vera2` — the winner flips between Linux and Windows. That is
  precisely [P1 §3](03-p1-implementation.md) step 12's user action, about to run
  on a Windows job for the first time.
- **F24.** `--reset-password` given as the final argument yields `undefined`,
  the guard reads it as absent, and **the server boots normally** — no reset, no
  error, and an operator who believes they just changed a password. F21's tests
  are what would have caught it, which is why it is numbered beside them rather
  than folded into them.
- **F25.** Two lint-config gaps in the files P2.0 opens. The test-file overrides
  match `**/test-*.ts` but not `**/test-*.tsx`, so the shared render helper F16
  needs — named by this repo's own convention — is linted as production code.
  And the test override drops the cross-package import bans, which exist
  precisely as the backup for when the native resolver behind the boundary rules
  misbehaves; P2.0 is the stage that writes the most test files, on the platform
  where that resolver is least proven.

### 1.3 Triage

The assignment rule, stated once so it is not renegotiated per finding:

> A finding is **P2.0-blocking** if it is (a) a data-loss or correctness bug in
> a write path that P2's own charter multiplies — turn job, watcher and API
> writing concurrently is P2's *design*, not an edge case — or (b) debt against
> the P1 exit gate itself: a claim P1 §3 makes that was never asserted. It
> is **fix-when-touched** if a specific P2 stage rebuilds the code it lives in.
> It is **record-and-defer** only if deferral is safe *and* it has a named home.

| # | Finding | Disposition | Where |
|---|---|---|---|
| F1 | Symlink resolver has no production callers | **P2.0** | Wire `resolveWithinReal` into the real read/write path; the corpus already exists |
| F2 | No body validation; `:kind` decorative | **P2.0** | Named P1.5 deliverable; the pattern must exist before session/turn routes multiply it. *The null-body 500 was guard-fixed at P1 closeout; the schemas remain.* |
| F3 | Stale-hash TOCTOU | **Fixed at P1 closeout** | Per-object write queue (`KeyedQueue`) + a disk re-hash inside the critical section, with the verified bytes threaded into the encode. P2.3 clones the *fixed* pattern |
| F4 | Watcher `ignored` broken on Windows | **Fixed at P1 closeout** | `isContained` over index/state/accounts/config, with a watcher test. The F17 Windows CI job still lands at P2.0 |
| F5 | History append/rewrite race; phantom version | **Fixed at P1 closeout** | History mutators serialised per object root; `snapshotReplaced` one critical section; write→snapshot→ingest reorder. The queue is the utility P2.3's turn segments reuse |
| F6 | `authoredAt` correct only via the React editor | **Fixed at P1 closeout** | `provenance.updatedAt` stamped server-side on real changes (§2.3); restore exempt; create exempt (imports keep original authorship) |
| F7 | DELETE destroys history; trash unimplemented | **Split — first half done at P1 closeout** | Delete now *moves* the folder, history and all, to `users/<h>/trash/` ([02 §10.2]'s shape), with tests. Retention sweep and restore UI: defer, **home P11** |
| F8 | No logging; config tiers data-only | **Scoped in** | Logging lands P2.0 (§2.2); `log.level` becomes the first real live-tier key. Restart-notice UI: defer, **home P10** |
| F9 | Tombstone maturation watcher-only; ingest not transactional | **Fix-when-touched** | P2.3 extends ingest for sessions/turns anyway: transactional after I/O, maturation on startup + timer |
| F10 | Traps: dead `invalidate`, `accountFile`, setup token, `secure=false`, dead FTS, slug race | **Split** | *Slug race and the uncaught accounts `JSON.parse` fixed at P1 closeout; the dead `invalidate` overtaken by `--reset-password` (§1.4) — the method is gone and the forever-cache it lied about is now revalidated per read against `(mtime, size)`, which is the fix, not the docstring honesty this row planned.* P2.0 sweep: `accountFile`/setup token. FTS route: **P2.3**. Cookie flags: defer, **home P10** (loopback default makes it safe) |
| F11 | Exit-gate gaps (step 16, rebuild property, step 11, DELETE) | **P2.0** | This *is* P2.0's exit: the P1 gate automated in full. *DELETE coverage landed at P1 closeout (trash, slug reuse, 404); step 16, the rebuild property test and the login half remain* |
| F12 | False conflict on the user's own save | **Fixed at P1 closeout** | Editor cache invalidated on save and restore |
| F13 | Unchecked cast + no error boundary | **Fixed at P1 closeout** | `actorFormShape` guard before every cast + the router's `defaultErrorComponent` |
| F14 | Silent save-as-copy / bodyless 412 | **Fixed at P1 closeout** | Copy errors render in the dialog; the banner filter excludes only dialog-owned 412s |
| F15 | Two missing day-one lint rules | **P2.0** | Write both, fix the five violations in the same commit; day-one rules get more expensive per day. *The strings rule is [testing §2](10-testing.md)'s narrowed one — §1.4 records why, and why the count is five rather than the four the audit found* |
| F16 | Component tests silently impossible | **P2.0** | Config + DOM env + one smoke component test proving the pipe, before P2.6 ships the first complex surface |
| F17 | CI: ubuntu-only, unnamed gate, no format check, warnings can't fail | **P2.0** | All configuration; the Windows job is what would have caught F4 |
| F18 | Shared/misc drift | **Split** | P2.0 sweep: Package factory + fixture, denylist over *emitted* JSON, `$id` filenames, fresh-clone dev, focus trap. *The step-17-via-API test in this row was already written at P1.7 and miscounted as debt — see Appendix A.* `se.` enforcement: **P2.4** (first `se.*` ids). Runtime-deps line: recorded in §1.4, not chased. Editor completeness: defer, **home P11** ([05 §4](05-p3-implementation.md) declines it; [09 §1–§2](09-polish.md) takes its polish half) |
| F19 | Shadowed duplicate cannot be opened | **P2.0** | Give duplicate rows a stable path/slug discriminator in the read route and client link; keep ordinary references id-only and winner-resolving. *The discriminator belongs to the read route and the link contract, not to the merged list it was found in — [05 §5](../05-ui-surfaces.md) has since reversed to one panel per kind, with that client work at [09 §4](09-polish.md). A fix shaped around the merged list would be rewritten by a reorg P2 does not own* |
| F20 | Invalid foreign edit remains invisible | **Fix-when-touched** | **P2.3, beside F9** — by §1.3's own rule: the closeout's disk re-hash removed the data-loss half, and the debt is against *this* plan's gate step 7, not P1's. P2.3 reworks ingest for F9 anyway; the file-error state lands in the same opening rather than opening ingest twice. Reads name the path/problem; writes stay hash-blocked meanwhile |
| F21 | `--reset-password`'s CLI wrapper untested | **P2.0** | One test beside the existing `auth/reset.test.ts`: argv parsing, the missing-handle path, exit codes. It rides in the test sweep — a credential-changing entry point is not the place to leave the typed half unasserted |
| F22 | `PathEscapeError` → 500 disclosing absolute paths; and it aborts a rebuild | **P2.0, first** | A refused path answers **422 `refused-path`**, message naming the reason and the segment and nothing else; a rebuild counts one and steps over it. Ahead of F1 and F19 because both open this code and neither should have to carry it. *The leftover — a rebuild skips such a folder while the watcher indexes it, so the two producers F11's property test holds to one answer disagree — is **P2.3**'s, beside F20: the same question of how the index represents a file it cannot open. A test asserts the divergence so the fix is found by failing* |
| F23 | Shadow winner is platform-divergent | **P2.0, in the doc** | Recorded here now; the fix — ordering duplicates by the portable relative path, which the layout already computes — belongs with **P2.3**'s ingest rework beside F9/F20. Until then F11's step-12 fixture avoids prefix-pair slugs, and says why |
| F24 | `--reset-password` as the last argument boots the server | **P2.0** | One-line guard, and it is F21's test that proves it. The two land together |
| F25 | Lint config: `test-*.tsx` unmatched; test override drops the package bans | **P2.0** | Both in the F16 infrastructure commit, before the first file that would land in the gap |

### 1.4 Corrections to the record

So the plan of record stays honest — the P1 ones annotated in
[P1](03-p1-implementation.md) with pointers back here:

- **P1.0's "`shared`: types + schemas, no runtime deps" is false as built.**
  `shared` depends on TypeBox and Ajv at runtime, with the exception argued
  only in a `package.json` note. The dependency is right (one schema
  technology, five jobs — [07 §3](../07-tech-stack.md)); the doc line was wrong,
  and the record is this section, not a JSON comment.
- **P1.5's "Fastify validates against the same JSON Schema" was not
  delivered** — params only, no body schemas (F2). Repaired at P2.0.
- **[P1 §3](03-p1-implementation.md)'s "automated equivalents of 4 and 7–19 are
  this phase's CI suite" overstates what P1 automated** — steps 16, 11's login
  half, DELETE, and the rebuild *property* test were not automated (F11).
  Completed at P2.0.
- **`--reset-password` shipped between P1 and P2 and this section is its first
  design-doc mention.** The flag existed only in the README, and it did two
  things this plan depends on: it changed the `Accounts` cache from a
  never-invalidated map to a per-read `(mtime, size)` revalidation — closing
  F10's `invalidate()` half outright — and it made a credential-changing CLI
  entry point that F21 now covers. The flag itself is documented at
  [04 §5.1](../04-server-multiuser-deployment.md), beside the first-run material
  it belongs with; the record that P2's foundations moved under it is here.

**And four corrections from tracing P2.0 into the code before opening it.** Each
is a place where this plan, or a doc it rests on, asked for something that turned
out to be impossible, harmful, or already superseded. They are recorded rather
than quietly worked around, because §2.1's rule only means anything if the
instructions it enforces are true:

- **"Body schemas via the shared JSON Schemas" cannot mean the emitted files.**
  Fastify's Ajv fails to compile all six of them, and the failure is at
  `ready()` — the server does not start. The rescue everyone tries next
  (draft-07 Ajv plus `addMetaSchema`) fails too. **The route schemas are
  `PORTABLE_SCHEMAS`**, the in-memory TypeBox objects the storage layer already
  validates with, which compile clean today. That also makes the route validator
  and `assertValidObject` literally the same document, which is what the server's
  own comment already claimed. Two constraints ride with it, and both are
  correctness rather than taste: the validator is configured **non-mutating**
  (`useDefaults` and `coerceTypes` off — Ajv mutates the body *in place*, and
  that body is what gets written to disk, so a POST omitting
  `provenance.source` would otherwise be accepted with a manufactured
  authorship claim that `assertValidObject` cannot see), and **no
  `schema.response` on any library route** — response serialisation emits only
  declared properties, which would silently strip every unknown field off a
  portable object on the way out, against [10 §2](../10-schemas.md) and P1 gate
  step 14.
- **"Body schemas on every object route" over-reaches by one word.** `PUT`,
  `DELETE` and restore all accept the hash in an `If-Match` header — the
  spelling [the API doc](../../api.md) calls preferred — and restore has no
  object in its body at all. A required body schema turns each into a 400 and
  breaks tests that assert the documented behaviour. Body schemas go where there
  is a body: `POST` and `PUT` carry the object, the rest validate their optional
  `contentHash` and tolerate an absent body.
- **P2.0's exit is restated in tiers.** "The P1 gate, all nineteen steps" claims
  more than [P1 §3](03-p1-implementation.md) ever did — it only ever offered
  automated equivalents of 4 and 7–19 — and several steps are browser clauses
  this stage does not fund. The exit is now: every server-observable step as an
  app or watcher test; the client halves of steps 8, 13, 15 and 19 as component
  tests, which is what F16's infrastructure is for; and a Playwright residue of
  about one clause (step 1's first-run landing) that P2.0 explicitly does not
  own. **Step 5 reduces to its server half**, because it asserts the merged
  library list [05 §5](../05-ui-surfaces.md) has since reversed — F19's own
  argument, applied to the gate that would otherwise re-encode the old design in
  a slower tier.
- **[testing §2](10-testing.md)'s strings rule was the unreduced one.** It read
  "no bare user-facing string literals", which [01 §2](01-work-plan.md) had
  already narrowed to *never assemble a sentence from fragments, never branch on
  displayed text*, with catalogue extraction moved to P11. The wide rule has
  some ninety violations and no catalogue to land them in; the narrow rule has
  five, and they are the ones that actually foreclose translation. Rewritten
  there, and F15's own row corrected: **five** violations, not four — one was
  added by the P1 closeout after the audit counted.

---

## 2. Decisions this plan had to make

### 2.1 P2 opens with a hardening stage, and one rule keeps it bounded

Against distributing every fix into later stages: F2, F3 and F5 sit under
*every* stage — the turn pipeline writes `session.json` and JSONL segments
continuously while the watcher and API are live, P2.3 deliberately clones the
stale-hash pattern for sessions and the append-only JSONL pattern for turns,
and a stage that inherits a broken pattern copies it. **The pattern must be
fixed before it is cloned**; that is a sequencing argument, and sequencing is
what a stage is.

Against a general hardening phase: [01 §1](01-work-plan.md) (slices, not
layers) and [01 §2.2](01-work-plan.md) (nothing built to be discarded) both cut
against repair becoming refactoring. So the boundary rule:

> **Every P2.0 change traces to a numbered finding. No feature work. No
> rewriting code that works.** Work that cannot cite a finding number stops.

What makes the stage cheaper than it looks: the F3/F5/F6 fixes share one
per-object write-serialization utility — which is exactly the machinery P2.3's
turn segments and head-snapshot maintenance need anyway. P2.0 builds P2
infrastructure while paying P1 debt, which is [01 §2.2](01-work-plan.md)'s good
case.

And it has a crisp exit in P1's own terms: **the P1 exit gate
([P1 §3](03-p1-implementation.md)) exists as automated tests and is green — on
Windows CI as well as ubuntu.** The audit converted back into CI. What "the
gate, automated" means precisely — three tiers, and which clause lands in which
— is §3's P2.0 entry, restated there because the original wording claimed more
than P1 ever offered (§1.4).

### 2.2 Logging is a P2 subsystem, not a P10 retrofit

A resumable server-side job that fails overnight with `console.log` is
undebuggable by design, and P2's charter is exactly that job. So: Fastify's
logger on with structured output per [13 §4.1](../13-internal-contracts.md), and
`log.level` becomes the **first real consumer of the `live` reload tier** —
which makes the tier minimally real at the same time
([01 §2.2](01-work-plan.md) forbids a config key as a false front). P2.5 then
threads job and turn ids through log context, which is the payoff. The
`pendingRestart` notice *surface* stays at P10 with the admin UI it belongs to.

**Two shapes settled here rather than in code.** The logger is **Fastify's own**
— the option, not an injected instance — because pino already travels with
Fastify and declaring it directly would be this stage silently choosing a
logging library that no design section names. And `log.format` loses its
`pretty` value: it was the documented default with no implementation behind it,
and honouring it means a second dependency and a transport, for an ergonomic
gain in dev only. JSON everywhere; a terminal that wants it pretty can pipe it.
[13 §4.1](../13-internal-contracts.md) is where the record's *fields* are
specified, and that section had to be written before this code, because gate
step 19 asks the log a question it can only answer if the bindings were decided
in advance.

### 2.3 `provenance.updatedAt` is stamped server-side

`authoredAt` correctness is the server's job, not a courtesy the client may
remember to extend (F6). The write path stamps it; the client stops being the
only honest writer; and P4's importer — the next non-UI writer — inherits
correct history for free. Records written wrong between P1 and this fix never
heal, which is why this is P2.0 rather than fix-when-touched: the cost of
deferral accrues daily into persisted data ([01 §2.1](01-work-plan.md)'s first
cost shape).

### 2.4 The Scene mode lives in `server` until P7 — carried

Unchanged from the skeleton, confirmed. The mode is written as data and steps
against the internal `ModeDefinition` shape
([03 §2](../03-modes-and-turn-pipeline.md)), lives inside `server`, and
**relocates** behind the SDK at P7 without changing shape. What keeps it honest
is the step contract being **async and serialisable from the first step**
([01 §3](01-work-plan.md)) — if the P2 steps only work because they share
memory with the engine, the P7 move becomes the rewrite
[01 §2.2](01-work-plan.md) exists to prevent.

Contents: `voice`/`dispatch` fixed to `narrator`/`merged`, one `generate`
step, history, persona, one actor, a default preset. No channels beyond §2.7,
no hooks, no participant policy beyond "the user and one actor", no setup
wizard.

### 2.5 Turn storage lands here, tree-shaped from the first turn — carried

Sessions and turns are P2 storage even though branching is P6. Two things are
not deferrable, per [01 §2](01-work-plan.md):

- **`parentTurnId` from the first turn.** The turn store is a tree that P2
  happens to use linearly. Retrofitting the edge at P6 is a migration; writing
  it now is a field.
- **Append-only JSONL segments in creation order**
  ([02 §5.5](../02-data-model.md)), rolling on count or byte size, with
  id → `(segment, offset)` in the index, and tolerance for removal designed in.

The skeleton called this "the sessions half of the storage thesis P1 proved
for library objects." **The audit shows P1 did not fully prove it** — F3 and
F5 are both failures of that thesis under a second writer — so this stage now
depends on P2.0 explicitly: sessions clone the *fixed* pattern, built on the
same serialization utility. Turn text goes into FTS on write as part of the
same ingest pass ([07 §7.1](../07-tech-stack.md)).

### 2.6 The operational store opens here — carried

`/data/state/state.sqlite` ([13 §5.1](../13-internal-contracts.md)) — jobs,
idempotency keys, later the notification inbox. P2 is the first phase with
state that is not derived, so the index/operational split is made now. Job
durability across restart keeps [04 §2](../04-server-multiuser-deployment.md)'s
simple answer: turns are not resumed across a restart; the partial turn is
recorded failed with its blocks intact, re-runnable rather than lost. Auth
stays on stateless cookies and does not move here.

### 2.7 Channel machinery: `se.clock`, not `se.party` — and the `scope` field lands now

The skeleton left "which trivial channel" open. **Closed: `se.clock`.** In a
fixed-participant P2 mode nothing ever writes a party effect, so a party
channel would exercise nothing — a placeholder-shaped channel. The clock
advances every turn (engine-computed), so it genuinely exercises effect
application, replay-from-zero, and the head snapshot
([02 §8.1](../02-data-model.md)) — including
hand-edit-divergence-becomes-an-effect, which is the sessions half of the
storage thesis. `se.party` lands at P7 beside `ParticipantPolicy`, which is
what gives it semantics. Reconstruction is replay-from-zero only; the snapshot
*cache* is P6's ([09 §4](../09-branching.md)).

**And [08 §1.5](08-p6-implementation.md)'s question is closed the way it
leaned:** `ChannelEffect` gains `scope: "session" | "escaped"` in
[13 §1.2](../13-internal-contracts.md) now, and P2 writes only `"session"`. A
field today is cheaper than a migration at P6, and the doc-18-first discipline
in the header is exercised rather than asserted.

### 2.8 The fake provider is a P2 deliverable — carried

[10 §4.1](10-testing.md): a scripted implementation of the provider interface,
recording every request. It is the golden-file harness, the E2E backend, and
the only way to test reattach, mid-stream disconnection, malformed structured
output and the failing-step path deterministically. Built beside the real
adapter, not after.

### 2.9 Guidance: the slot is non-deferrable; the box is the pressure valve

`advisory: true` refused by effect-producing calls is a day-one item
([01 §2](01-work-plan.md)) enforced in the assembler, so the guidance *block*,
its exclusion rule ([03 §5.2](../03-modes-and-turn-pipeline.md)), its one-shot
record semantics, and the golden test that no advisory block reaches an
effect-producing call all land here. The input-bar *box*
([05 §10](../05-ui-surfaces.md)) is a collapsed textarea — and it is this phase's
named pressure valve: if P2 runs long, the box slips to P3 and guidance is
exercised via API until then. The slot semantics cannot slip; they are record
shape.

If a second valve is needed, the FTS search route (P2.3) slips to P3 without
harm — it is a reader. Nothing else here is cuttable: the rest is persisted
shapes, contracts, or the demo itself.

### 2.10 One active turn per session, and one idempotent submission protocol

P2 has two kinds of concurrency and they must not be confused. Any number of
clients may **observe** one session and its stream; only one turn may **advance**
that session at a time. Allowing two jobs to start from the same
`headTurnId` would make both claim the same parent, race the head snapshot and
apply two sets of effects in an order neither record states. That is accidental
branching five phases before branching has semantics.

**DECIDED: one active turn job per session in P2.** Submission carries both an
idempotency key and the `headTurnId` the client composed against. Under the
session's keyed write queue, the server re-reads the head and then does one of
three things:

- the idempotency key already names a job: return that job, whether it is
  queued, running or terminal;
- another job is active, or the expected head is stale: reject with the current
  job/head rather than queue work whose context has already changed;
- neither is true: reserve the key and create the job in one operational-store
  transaction, then begin work.

The key is scoped to the account and session and retained long enough for a
browser retry or reconnect to be harmless. A retry must never make a second
provider call or charge twice ([13 §5.1](../13-internal-contracts.md)). P6 may turn
the stale-head case into an explicit sibling; P2 must not manufacture one by
race.

#### The operational draft is live; the JSONL turn is terminal

An append-only turn segment cannot also be a document rewritten on every token.
During execution, the authoritative **in-flight draft** therefore lives with
the job in `state.sqlite`: assembled blocks, calls, streamed output, effects,
cost and failures are checkpointed as they become durable enough to show. The
session SSE snapshot is a rendering of that draft. On complete, failed or
suspended, one terminal `Turn` is appended to JSONL; completed turns are then
authoritative files and the operational draft may be collected.

Finalisation is a recoverable protocol rather than a pretend transaction across
SQLite, a JSONL segment and `session.json`:

1. checkpoint the terminal draft in the operational transaction;
2. append the terminal turn, idempotently by `turnId`;
3. apply accepted effects and advance `session.json`'s head snapshot;
4. mark the job committed and publish `turn.finished`.

Startup recovery resumes **finalisation**, never generation. A job left running
becomes a failed terminal draft with the blocks and calls checkpointed so far;
a job interrupted in steps 2–4 completes those steps idempotently. This closes
[04 §2](../04-server-multiuser-deployment.md)'s restart question without claiming
that a provider stream itself can resume. If `state.sqlite` is deleted, an
uncommitted draft can be lost — the explicit cost of deleting authoritative
operational state — but a terminal turn already appended to JSONL is reconciled
into the session rather than duplicated or discarded.

Progress events receive a monotonically increasing per-job sequence in the same
operational transaction as the draft change they describe. **Streaming deltas
coalesce into those checkpoints rather than each being one** — a durable
transaction per token would be an fsync storm, and the snapshot already carries
the accumulated text. The exactly-once, in-order guarantee applies to durable
checkpointed events; a reattach may observe coalesced text rather than every
delta that painted it live. Reattach reads
`snapshot + cursor`, then subscribes strictly after that cursor; this ordering
closes the snapshot/subscribe race. Event rows are ephemeral and may be pruned
after the terminal record exists, because the turn record is their durable
meaning ([04 §3.2](../04-server-multiuser-deployment.md)).

### 2.11 What stays broken on purpose

Argued once so the deferrals are decisions rather than omissions. **Trash**
(F7's second half): additive ([01 §2.1](01-work-plan.md)), config key already
reserved, home **P11** — but P2.0 stops the destruction of `history/` now,
which converts hard-delete from unrecoverable to recoverable at near-zero
cost. **Editor completeness** beyond the P2.0 sweep (section add/remove,
`visual`/`roles`/`openings`/`lore`/`modelHint`, the undo affordance):
additive, home **P11**, where editors-are-not-dumb-forms lives — with the
by-field and *As stored* halves of it already claimed as polish at
[09 §1–§2](09-polish.md). P3 is the workbench and does not claim this
([05 §4](05-p3-implementation.md) says so explicitly); the earlier "P3/P11"
here was a home that had not agreed to it. **Cookie `secure`/`trustProxy`
hardening** (F10): home **P10** with deployment; the loopback default
([04 §5.1](../04-server-multiuser-deployment.md)) is what makes deferral safe.
**Restart-notice UI** (F8's second half): home **P10** with the admin surface.
Each is named again in §5 so the list survives this section being skimmed.

**Accessibility is not on that list, and saying so is the point.**
[01 §2.1](01-work-plan.md) names accessible markup as one of the three things
that cannot be deferred — a habit, not a feature, retrofitted only by touching
everything. So every surface P2 ships is accessible as it ships, the P2.0 sweep
pays the one specific debt found (the conflict dialog's focus trap, F18), and
what P11 owns is the *audit* — a systematic pass over surfaces built to the
habit, not a rescue of surfaces built without it. A phase that defers the habit
has already made P11's pass a rewrite.

---

## 3. Stages

Ordered so the repaired foundations exist before anything builds on them, and
the record types and their tests exist before anything produces records.

### P2.0 — Hardening: pay the P1 debt

Every item cites a finding; the clusters are the work plan.

**The P1 closeout already absorbed the live-bug half of this stage** — the
write-path serialization cluster (F3, F5, F6, F10-slug: the `KeyedQueue`, the
disk re-hash, the write→snapshot reorder, server-side stamping,
delete-to-trash) and the client-trust cluster (F12, F13, F14), each with its
regression tests. What remains here is the hardening-and-debt half:

**The stage opens with what everything else stands on** (F17, F22, F8, F16,
F25). The Windows job comes first because every item below it touches paths, a
watcher, or a timing-sensitive test, and F4 is what an ubuntu-only CI costs. The
`PathEscapeError` mapping comes first because F1 and F19 both open that code.
The logger comes first because a 500 out of a read route is invisible in CI
while Fastify is built with `logger: false`. The test harness comes first
because a `.test.tsx` written before it lints, typechecks, and never runs. Then:

- **Resolver and routes** (F1, F2): `resolveWithinReal` wired into the real
  read/write path — *and into the two doors that are not call sites: the index
  row, whose stored path is read straight off SQLite, and the watcher, which
  follows symlinks by default*; body schemas from `PORTABLE_SCHEMAS`, configured
  non-mutating, with no response schema and no required body where the hash
  travels in a header (§1.4); `:kind` checked against the object's own `schema`
  field (mismatch is a 400, not a silent lie). **Before F19**, because without
  the kind in hand a slug is not unique across kinds.
- **Filesystem honesty** (F19): shadowed duplicates are individually
  addressable — the discriminator in the read route and the link contract, so
  it survives [09 §4](09-polish.md)'s per-kind panels — without changing
  id-based reference resolution.
  (F20, the invalid-file half of this pair, rides with F9's ingest rework at
  P2.3 — §1.3's table records why.)
- **Logging** (F8): Fastify's logger on, JSON per [13 §4.1](../13-internal-contracts.md),
  `log.level` live-reloadable — the first real live-tier consumer. The config
  *source* consumes self-write suppression rather than reacting to the settings
  UI's own write, and a reload that cannot read a valid file keeps the running
  config ([13 §4.2](../13-internal-contracts.md)).
- **Test, CI and lint sweep** (F11, F15, F16, F17, F18-subset, F21, F24, F25):
  the P1 gate completed to the exit below — manual-vs-external asserted in one
  history, the rebuild property test (randomised write/edit/rename/delete/copy
  sequences) as a **named** CI step, the login-after-index-delete half; the two
  missing day-one lint rules written and their five violations fixed; `.test.tsx`
  + DOM environment + one smoke component test; Windows CI job (which is what
  would have caught F4), `format:check`, `--max-warnings 0`; Package factory and
  fixture, denylist over the emitted JSON, `$id`-matching filenames, fresh-clone
  `pnpm dev`, the conflict dialog's focus trap, and the `--reset-password` CLI
  wrapper with its argv guard (F21, F24). *Gate step 17 is already asserted
  through the API — `routes/history.test.ts`'s "a save that changes nothing
  records no version and keeps the hash", written at P1.7 and missed by the
  audit's own inventory. Nothing to write; the row stands as coverage.*
- **Trap removal** (F10 remainder): `layout.accountFile()` deleted and the setup
  token **removed**, its deferral recorded at
  [04 §5.1](../04-server-multiuser-deployment.md) — enforcing it is a new
  user-facing field on two auth routes and the setup form, which is feature work
  under a no-feature-work rule, and the consumer that gives the token a job is
  P10's container inversion. *The dead `Accounts.invalidate()` is already gone —
  see §1.4.*

**Named as out of this stage**, so the sweep does not absorb them on the way
past: `limits.maxUploadMb`'s reload tier (the key names uploads; there is no
upload route yet, and re-tiering the contract to match today's shortcut would
lock the shortcut in), a `config.example.json` drift test, the disagreement
between the ESLint and Stylelint axis rules, and the dead `formatEpochMs`. Each
is real; none cites a finding; §2.1 therefore says they stop. They are written
here rather than left to be rediscovered as "while I'm in here".

*Ends at:* **[P1 §3](03-p1-implementation.md)'s gate, automated, green on both
OSes, in three tiers** — every server-observable step as an app or watcher test;
the client halves of steps 8, 13, 15 and 19 as component tests on F16's new
infrastructure; and step 1's first-run browser landing left to the Playwright
tier ([testing §3.5](10-testing.md)), which this stage does not stand up. Step 5
is asserted as its server half only, for the reason §1.4 gives. The audit paid,
in one legible unit.

### P2.1 — Provider layer

`packages/server/src/providers/`: the AI SDK behind the thin internal
interface ([07 §5](../07-tech-stack.md)); `ProviderCapabilities` per
[13 §3](../13-internal-contracts.md) with known-provider defaults; model **roles**
with the hi/lo binding default ([07 §5.1](../07-tech-stack.md)); connections in
`connections/` per [04 §4.5](../04-server-multiuser-deployment.md) —
account-scoped plus system scope, never in a portable object; prompt caps as
ranked-fragment budgets ([07 §5.3](../07-tech-stack.md)). The fake provider
(§2.8) ships here, beside the first real adapter. Chat-completion only
([07 §5.5](../07-tech-stack.md)) — no completion adapter, no instruct templates,
stated in user-facing docs rather than discovered.

*Tests:* capability negotiation and degradation paths against the fake;
provider conformance is scheduled, not per-commit ([10 §4.2](10-testing.md)).

### P2.2 — RNG service

`int/float/bool/chance/pick/weightedPick/shuffle/dice`, `node:crypto` uniform
draws, injectable generator, every draw recorded keyed **by site**
([07 §14](../07-tech-stack.md)). The tape and replay mode are built now even
though nothing rerolls until P6 — the tape is part of the turn record, and a
record without it cannot support rewrite later. The P1.0 lint rule stops
banning randomness everywhere and starts pointing here.

### P2.3 — Session and turn storage

Session CRUD under `users/<handle>/sessions/`, `session.json` with the head
snapshot, JSONL segments per §2.5 — written through P2.0's serialization
utility — ingest into the index, FTS on turn text on write, and the FTS
**search route** wired (F10: `search()` exists and is unreachable; this stage
gives it its second consumer and its first caller — API only, UI is P3's).
Ingest becomes transactional after I/O completes and tombstone maturation runs
on startup plus a timer (F9) — and in the same opening, an invalid foreign
file becomes a **visible, path-scoped error state** rather than a silent skip
(F20): the index records what failed to parse and why without treating the
bytes as an object, reads surface it, and the closeout's hash-block keeps
writes refused meanwhile. Session delete **tombstones** — F7's lesson
applied to the new kind rather than copied from the old one. Effect
application and head-snapshot maintenance per §2.7, including
hand-edit-divergence-becomes-an-effect ([02 §8.1](../02-data-model.md)).

The operational schema also lands here: job, idempotency reservation, in-flight
turn draft and sequenced progress event. Implement §2.10's terminal commit and
startup reconciliation before a real provider can write a turn; P2.5 adds the
runner and transport to this already crash-testable store.

*Tests:* the P1 gate's storage properties extended to sessions; segment
rollover; a hand-edited `session.json` clock landing as a user-attributed
effect; search returning a turn-text hit; terminal append/finalise interrupted
after each protocol step and recovered without duplicate turns or effects; an
invalid foreign edit surfaces as a path-scoped error and clears when the file
is fixed (F20).

### P2.4 — Assembler, budgeter, render

The four steps of [03 §5](../03-modes-and-turn-pipeline.md). Collect from the
sources that exist (persona, actors, history, preset blocks, the guidance
block); annotate with `BlockSource` + reason; budget with a full
`BudgetVerdict` including `nextToDrop`; render to `RenderedMessage[]` with
`fromBlocks` intact and same-role merging as a provider capability
([13 §2](../13-internal-contracts.md)). **History is a splittable source** from
the start — in-history placement is how real presets work and P4 imports
them. Lore retrieval is not here (P5); the lore slot exists and resolves
empty. The `se.` prefix reservation is enforced here (F18), where the first
`se.*` ids appear in anger.

The golden-file suite starts with this stage and is CI from here on.

### P2.5 — The turn job and the event stream

Turn as a job with an id in the operational store; SSE per
[07 §8](../07-tech-stack.md); the progress-event vocabulary of
[04 §3.3](../04-server-multiuser-deployment.md) (`turn.started` …
`turn.finished`), snapshot-plus-cursor reattach. Step failure per
[03 §6](../03-modes-and-turn-pipeline.md): `failure: "warn"` does not lose the
turn. Events carry `{key, params}`, never prose ([01 §2](01-work-plan.md)) —
the notification *classes* and router are P10; the event schema they need is
complete from the first producer. This is where §2.2's logging pays off:
job-scoped log context, every state transition logged, and the falsifiable
claim that a killed turn's lifecycle is reconstructable from the log alone.
Submission and reattach implement §2.10: expected-head plus idempotency key,
one active job per session, sequenced events, and a snapshot/cursor subscription
with no gap between them. Two clients may watch the same job; they may not race
two jobs into the same head.

### P2.6 — The Scene mode and the play surface

The mode of §2.4, wired to routes, and a deliberately thin chat view:
message list, input, streaming render, reattach on reload, the collapsed
guidance box (§2.9, unless the valve was pulled), and a raw "view turn record"
JSON affordance that P3 replaces — one `<pre>` tag, not a system. The
component-test infrastructure and the error boundary already exist from P2.0,
so the first complex surface ships with component tests rather than before
them. Impersonation and the axis controls are not here —
[03 §3](../03-modes-and-turn-pipeline.md) ships in Scene at P7/P11 scope.

*Ends at:* the demo.

---

## 4. Verification — the P2 exit gate

1. **The P1 gate stays green** — [P1 §3](03-p1-implementation.md), automated to
   the three tiers §3's P2.0 entry defines, on ubuntu and Windows, as standing
   regression (P2.0).
2. Two concurrent `PUT`s presenting the same valid hash → exactly one wins,
   the other gets a 412 with the current object; neither write is silently
   lost (F3).
3. Hand-edit a file on disk, `PUT` within the watcher's settle window → the
   write is rejected, the hand-edit survives (F3).
4. Pin or rename a version while a save is snapshotting → both records exist
   afterwards; nothing is eaten (F5).
5. Write an object via curl with no `provenance.updatedAt` → its history entry
   carries a correct `authoredAt` (F6).
6. `DELETE` an object → `history/` remains on disk (F7).
7. Hand-edit an actor into an invalid shape, open it → an error card naming
   the path and problem, app alive, list still works; an attempted save cannot
   overwrite the invalid bytes (F13, F20).
8. Save in the editor, navigate away and back, save again → no conflict
   dialog for your own change (F12).
9. Send a message → streamed reply → close the tab mid-generation → reopen →
   the finished turn is there. The job survived the client.
10. Kill the *server* mid-turn → restart → the partial turn is recorded failed
    with blocks intact and can be re-run (§2.6 store).
11. Read the turn record: every block with source and reason, the budget
    verdict with `nextToDrop`, `ModelCall.resolved` naming what actually ran,
    every RNG draw on the tape keyed by site, cost captured. No nulls where
    [13](../13-internal-contracts.md) says data.
12. Two clients on one session both see the stream.
13. Submit the same idempotency key twice → one job id and one provider call.
    Submit two different keys concurrently against one head → one starts and
    the other is rejected with the active job/current head; no implicit sibling
    turn and no double-applied effect.
14. Disconnect between taking the SSE snapshot and subscribing → reconnect from
    its cursor observes every later event exactly once in order.
15. Delete `index.sqlite` → sessions, turns and library all still read, and
    the admin still logs in. Delete `state.sqlite` → an in-flight turn is
    lost and *that is expected*; nothing else is.
16. Replay-from-zero reproduces the head channel state; hand-edit
    `session.json`'s clock on disk → the divergence lands as a
    user-attributed effect (§2.7).
17. Type guidance → it appears as an advisory block in the record, does not
    enter history, and the golden suite asserts no advisory block ever
    reaches an effect-producing call (§2.9).
18. Search returns a hit from turn text, through the route (F10, P2.3).
19. Kill a turn mid-flight → its full lifecycle is reconstructable from the
    structured log alone, by job id (F8, §2.2).
20. The golden-file suite runs against the fake provider, snapshots the
    rendered block table, and the rebuild property test is a named CI step on
    both OSes (F11, F17).

---

## 5. Out of scope, deliberately

The workbench (P3 — the JSON affordance in P2.6 is one `<pre>` tag); import
(P4); lore activation (P5 — the slot renders empty); branching UI,
snapshots-as-cache, rewrite/reroll surfaces (P6 — but the tape and
`parentTurnId` are written now); channels beyond `se.clock`, hooks, the mode
registry, the SDK boundary, setup wizards, `se.party` (P7); summarisation
(P8); renditions (P9); notification routing and delivery, cookie hardening,
the restart-notice UI, capability enforcement (P10); trash, editor completeness
([09 §1–§2](09-polish.md) for its polish half) and the systematic a11y audit
(P11) — the *habit* of accessible markup being in scope for everything P2
ships, per §2.11.

Two erosion lines, and the first is new:

**The line most likely to erode is P2.0's boundary.** Hardening invites
refactoring — every file it touches has something else worth improving, and
"while I'm in here" is how a repair stage becomes a rewrite phase. The fence
is §2.1's rule: work that cannot cite a finding number stops. If P2.0 is
growing items without findings, it has already eroded.

**The mode's line still matters.** A second step, a channel with a widget, a
participant policy — each is small and each belongs to P7, where the contract
is tested by two real modes rather than grown one convenience at a time. The
P2 mode is allowed to be embarrassingly small; that is what it is for.

---

## Appendix A — Audit findings in full

The finding-level detail behind §1, with file references, from the two audit
passes (server; shared/client/tooling) run at the P2 revisit. Line numbers are
as of the audit commit and will drift; the file and symbol names are the
stable part.

### A.1 Server

| # | Where | Detail |
|---|---|---|
| F1 | `storage/paths.ts:270` | `resolveAssetPath` (the only caller of `resolveWithinReal`) has zero production callers; every live path uses lexical `resolveWithin`. The symlink corpus (incl. escape-via-nonexistent-target, root-is-a-link) tests dead code |
| F2 | `routes/library.ts:111,144,168,354` | `:kind` resolved then never checked against the object; no body schemas on POST/PUT (params/history-PATCH only); `:114`/`:164` dereference the body unguarded → 500 on null (**guard-fixed at P1 closeout**, `objectFromBody`); `respondToLibraryError` rethrows non-`LibraryError` (a `PathEscapeError` from a bad slug is a 500 + stack) |
| F3 | `library.ts:294` | Hash compared against the index row, then `encodeObject`/`writeAtomic`/`ingestFile` with three awaits between check and write. Loses to a concurrent PUT and to a foreign edit younger than the 150 ms `awaitWriteFinish` window. Also: `If-Match: *` and weak etags treated as literal hashes; etag header emitted unquoted. **Race fixed at P1 closeout** (per-object queue + disk re-hash); the etag-syntax quirks stand |
| F4 | `index-db/watcher.ts:97` | `ignored: (path) => path.includes(`${dataRoot}/index`)` — mixed separators, never matches on win32; index SQLite/WAL/SHM watched on the dev platform. Nothing ignores `state/`, `accounts.json`, or per-object `history/`. **Fixed at P1 closeout** (`isContained` over index/state/accounts/config; per-object `history/` still traverses to a harmless 'ignored') |
| F5 | `storage/history.ts:185,207,234` | `recordVersion` appends while `patchVersion`/`pruneVersions` read-whole → rewrite-whole with no lock: a PATCH from a stale read clobbers an interleaved append. `library.ts:326` snapshots *before* the write, so a failed write leaves a phantom version. **Fixed at P1 closeout** (mutators serialised per object root; write→snapshot→ingest reorder) |
| F6 | `storage/history.ts:164` | `authoredAt` read from client-supplied `provenance.updatedAt`; the only stamping in the repo is `client/src/editor/ActorEditorPage.tsx:102`. Any other writer collapses `authoredAt` to `recordedAt`. **Fixed at P1 closeout** (server stamps on real changes; restore and create exempt) |
| F7 | `library.ts:490` | `remove()` = `removeTree` of the object folder including `history/`; `trash.retentionDays` configured, `Layout.trashRoot()` exists, no trash implementation; zero DELETE tests. **First half fixed at P1 closeout** (delete moves to trash via `moveTree`, tested); retention/restore stay P11 |
| F8 | `app.ts:97`, `main.ts` | `logger: false`, raw `console.log`; `log.level`/`log.format` consumed by nothing; `pendingRestart()` (config.ts:161) has no callers outside its test; no `live` key is re-read live; `ReloadTier` declares an unused `'reconnect'`; `main.ts:33` mutates `dataDir` post-validation |
| F9 | `index-db/ingest.ts`, `watcher.ts:150` | `matureTombstones` called only from the watcher — with `watch: false`, tombstones accumulate forever. `ingestFile`/`dropVanishedDuplicates` await mid-DB-mutation with no transaction; watcher and API ingests can interleave on the same `DatabaseSync` |
| F10 | various | `Accounts.invalidate()` (accounts.ts:279) dead, docstring claims hand-edit pickup (**overtaken by `--reset-password`** — the method is gone and `#read()` now revalidates against `(mtime, size)` on every call, `accounts.ts:140-193`); `layout.accountFile()` (layout.ts:184) points at the per-user account-file anti-pattern P1 §1.3 overturned; setup token (main.ts:71) printed, stored nowhere, enforced nowhere; `secure=false` hardcoded (routes/auth.ts:44); CSRF checked only when `request.account` truthy (app.ts:132) and the setup-gate uses `startsWith` (app.ts:180); FTS5 `search()` (query.ts:144) has no route; `create()` slug resolution is read-then-write (library.ts:236, **fixed at P1 closeout** — per-kind queue); `accounts.ts:155` uncaught `JSON.parse` (**fixed at P1 closeout**); Ajv validator recompiled per read (accounts.ts:156); five unvalidated `as PortableSchemaId` casts; stale module docstring (index.ts:7) |
| F11 | test suite | Gate step 16 (manual vs external in one history) split across files, never asserted together; rebuild==incremental is three fixed examples (two driving ingest directly, not through the watcher), not the named property test; step 11's login-after-index-delete half untested; DELETE untested; no malformed-body tests; no concurrency tests. **DELETE and concurrency coverage landed at P1 closeout** (`routes/concurrency.test.ts`); step 16, the rebuild property and the login half remain |

### A.2 Shared, client, tooling

| # | Where | Detail |
|---|---|---|
| F12 | `client/src/queries.ts:90-97,144,174` | `['editor', kind, id]` cached with `staleTime: Infinity`; save/restore invalidate only `['library']` → returning within `gcTime` loads the pre-save `contentHash` → spurious 412 dialog for the user's own change. **Fixed at P1 closeout** |
| F13 | `client/src/editor/form.ts:49-63` | `object as unknown as Actor`, no runtime guard, reads `actor.profile.traits` etc.; no error boundary anywhere in the client → white screen on a malformed hand-edited actor. **Fixed at P1 closeout** (`actorFormShape` guard + router `defaultErrorComponent`) |
| F14 | `ActorEditorPage.tsx:150-158,118`, `api.ts:131` | `createCopy.mutate` has no `onError` and `isError` never rendered; a 412 whose body lacks `code:'stale'`+`current` opens no dialog, and the general banner filters all 412s → nothing shown. **Fixed at P1 closeout** |
| F15 | `eslint.config.js` / `eslint.rules.js` | Two of testing §2's five day-one rules never written (bare user-facing strings; Intl-only). Violations they would catch: `api.ts:129` status-sentence, `HistoryPanel.tsx:140` `Revision {n}`, `:151` `v{authorVersion}`, `ActorEditorPage.tsx:149` `` `${name} (copy)` `` |
| F16 | `vitest.config.ts:22-23` | Includes `.test.ts` only — not `.test.tsx` — while eslint and tsconfig include `.tsx` tests: the first component test would lint, typecheck, and never run. No jsdom/happy-dom/@testing-library anywhere; zero component tests exist |
| F17 | `.github/workflows/ci.yml`, `package.json:22` | ubuntu-only (paths/watcher/layout tests never run on the dev platform); rebuild gate not a named step (a `test.skip` retires it silently); `format:check` defined, never run; `eslint .` without `--max-warnings 0` while `exhaustive-deps` is warn-level |
| F18 | various | Package: no factory, absent from round-trip and minimal-instance fixtures (5 of 6). Denylist walks TypeBox objects, not emitted JSON — `emit-schemas.ts` is the untested link. `$id` (`…/storyengine.actor/1.json`) ≠ emitted filename (`storyengine.actor.1.json`). `RESERVED_SECTION_PREFIX` exported, enforced nowhere. `shared` has 2 runtime deps vs P1.0's line, argued only in a package.json note; `"types":["node"]` on the browser-safe package. Editor: sections not addable/removable, `visual`/`roles`/`openings`/`lore`/`modelHint` absent, save-disabled-when-unchanged makes gate step 17 unreachable via UI (*the API half is covered — `routes/history.test.ts` 'a save that changes nothing records no version and keeps the hash', from P1.7; the audit inventory missed it*), conflict dialog lacks focus trap/Escape/restore, `index.html` `lang`/`dir` static. eslint Tailwind rule permits `mt-*`/`mb-*` while stylelint bans block-axis physical properties — the two halves disagree. `pnpm dev` on a fresh clone fails (shared not built first). `format.ts:44` dead; duplicated input class strings; `formChanges` runs `structuredClone`+2× `JSON.stringify` per keystroke |
| F19 | `client/src/library/LibraryPage.tsx`, `index-db/query.ts:findById` | Both duplicate-id rows link by the same id; the detail query orders winner-first and has no path/slug discriminator. The shadowed row is visible but cannot be opened, despite the detail copy saying it is showing that copy |
| F20 | `index-db/ingest.ts:decodeObject/ingestFile` | Parse/schema failure returns `skipped: invalid` and leaves the previous valid row untouched. The closeout disk re-hash prevents destructive overwrite, but every read still serves believable stale content and no path-scoped error reaches the client |

**What held** (the counter-list, so the appendix is not only debt): the dual
write path complete with consumed-on-claim tokens and the
add-before-unlink discovery (ingest.ts:165-203); the traversal corpus incl.
drive-relative and ADS; kill-safety with a vacuous-pass guard
(atomic.test.ts:135-234); config exhaustiveness-tested against its tier table;
zero schema drift vs [10](../10-schemas.md); bit-correct uuidv7 with monotonicity; triple
unknown-field enforcement; two-layer fixture-tested boundary lint; the assist
slot still an empty `<span aria-hidden>` with no scaffolding behind it.

### A.3 After the audit

Not from either audit pass — from the verification run over §1.2 before P2.0
opened, against the two commits that landed after this plan was written.

| # | Where | Detail |
|---|---|---|
| F21 | `main.ts:50-52,114-127`, `auth/reset.test.ts` | The `--reset-password` path is tested at the `Accounts` layer and untested at the wrapper: no test drives `argumentValue('--reset-password')`, the missing-handle branch, or the exit codes. The password itself is read from stdin only and never from argv, which is right and should stay asserted rather than assumed |

**What the same run confirmed still true**, so the plan reads as a work order
rather than a description of work already done: every finding marked *Fixed at
P1 closeout* is fixed in the code as described (F3's `KeyedQueue` plus the
in-section disk re-hash, F4's `isContained`, F5's serialised history mutators
and the write→snapshot→ingest order, F6's server-side stamping with restore and
create exempt, F7's `moveTree` to trash, F12/F13/F14 client-side), and every
finding assigned to P2.0 or P2.3 is genuinely open — no P2.0 work has landed.
The three §1.4 corrections are annotated in P1 with pointers back, and
`ChannelEffect.scope` landed in [13 §1.2](../13-internal-contracts.md) as §2.7
promised. Two items were **struck** rather than confirmed: the step-17-via-API
test (already written at P1.7) and F10's dead `invalidate()` (already removed).
