# 15 — P2C, the first real run

**Four phases are built and nobody has used any of them.** P1 through P2B are
1049 passing tests, and every one of them calls a provider this repository wrote
to agree with an adapter this repository also wrote. The one boundary in this
system that is not ours — a model endpoint — has never been crossed.

**Three exit gates are open on the same clause.** [P2 §4](04-p2-implementation.md)
step 9 wants a streamed reply and a reattach. [P2A §4](13-p2a-configuration-surface.md)
steps 1 and 7 want a person to read a warning and say whether it reads as one.
[P2B §4](14-p2b-provider-configuration.md) step 1 wants a fresh install, one
pasted key and a turn. Each was walked as far as automation goes, and each
stopped at the same place: *a human, and a model that is not ours*. Doc
[12](12-p2-manual-gate.md) is where they were written down instead of done.

This phase is that person. It is not a new obligation; it is three phases of the
same one, and it has been getting cheaper to defer and more expensive to
discover.

## Why this is not an early PLAYABLE

[Work plan §4.1](01-work-plan.md) already names a checkpoint whose purpose is to
stop and use the thing, at the end of P4, against a realistic imported library.
That one asks **is the design right** — is the record legible, is one budgeter
comprehensible, do inclusion reasons explain anything. Four hypotheses, none of
which a smaller library can answer.

This asks something prior and much smaller: **does the thing work.** They are
different questions and the answers do not substitute for each other, which is
why running this one now does not spend PLAYABLE's budget.

**And it has to be prior, because P3 and P4 build on what it tests.** The
workbench is a reader over the turn record; import fills a library that then has
to be playable. Both are downstream of a provider boundary whose only witness is
a stub. If the adapter is wrong, P3 reads records that never came from a real
call and P4 fills a library nobody can play — and PLAYABLE discovers it as *the
app is broken* rather than as *the design is wrong*, which is the one failure
mode that milestone cannot afford. Finding it here costs a day. Finding it there
costs two phases.

**A second reason, independent of the first.** P2A and P2B built the whole
configuration and provider surface back to back with no user in between: about
fourteen hundred lines of settings UI whose only test mocks the API it talks to.
Nobody has clicked any of it.

---

## 1. What has to be true before the first session

**This section is larger than it should be, and that is the survey's result
rather than an accident of writing it.**

Six readiness lenses over the built system — first contact, observability, the
provider adapter, setup and teardown, the standing gap list, and the suite itself
— returned seventy-nine findings between them, several verified by running the
thing rather than reading it. **Twenty-two clear the bar below**, which makes the
preparation the larger half of this phase: five or six days against the two or
three the sessions themselves need.

That is not an argument for skipping it. It is the argument for running the phase
at all. Twenty-two defects were found by *reading* a system where nothing has ever
exercised the paths they sit on, and the reason every one of them was missable is
the reason this phase exists. If reading finds twenty-two, using will find more —
and every one of them is in a layer P3 through P6 build on.

**Three are blocking and nine more were claimed to be and are not**, which is
worth recording as a ratio rather than a verdict: every *blocking* claim was
handed to a second agent told to refute it, and three survived reproduction.

The three, and none of them is a subtlety:

- **A person cannot see what they type.** The play surface uses `bg-neutral-900`
  on inputs that inherit `text-slate-900` from the light shell. Measured in a
  browser against the project's own compiled Tailwind: **1.01 to 1**. The caret
  and the placeholder resolve to the same colour, so the box reads as an empty
  bordered rectangle that does nothing when typed into, and *Turn record* — which
  [12 §2.4](12-p2-manual-gate.md) tells the tester to open and read — is a dark
  rectangle with nothing in it.
- **Every streaming failure escapes classification.** Five failure shapes driven
  through the real adapter — fetch rejection, 401, 429, 400, and a genuinely
  closed port — all produced one identical `NoOutputGeneratedError` with
  `class: undefined` and `detail: undefined`. Streaming is the only path the play
  surface uses.
- **A teardown while the server runs half-completes, and the survivor is the
  index.** So the next run starts from a state nobody chose, and the part that
  survives is the derived part.

The nine that were downgraded are worth knowing too, because each is a thing this
document would otherwise over-claim: typing `/play` *does* reach a working
sessions page; a documented recipe *does* run a scratch install; classification
*does* work on the non-streaming path; and the budgeter reads its own estimate
rather than reported usage, so a null there is a **reporting** gap and not a
pipeline one.

**For the rest of the list, what the pre-work buys is not the phase. It is
whether the phase's output can be believed.**

**And the findings have a shape, which is the most useful thing the survey
returned.** Of the twelve a live first-contact walk produced, six are one defect
wearing different hats: *the server computes a good answer and no screen shows
it.* The `unbound` reason, the failure class the reducer already holds, both play
forms' mutation errors, the config save's refusal, the connections fetch's 401 —
in every case the information exists and is discarded one layer from the eye.
That matters before the phase rather than after, because a tester who hits it
repeatedly starts writing *"nothing happens"*, and those reports do not
distinguish which nothing.

**The bar, applied ruthlessly because a pre-work list attracts everything anybody
ever wanted to fix:**

> An item is pre-work only if leaving it undone would make the phase's own
> findings wrong — by hiding a failure, by making one unfindable afterwards, or
> by producing a finding that is really about the missing thing.

**And one line under it, because it is the one that erodes: pre-work repairs the
evidence; it does not build features.** §1.7 is where that line is drawn and what
it costs.

### 1.1 Getting to a session at all — about a day

Not about evidence quality: about whether a person who has not read the source
arrives anywhere.

- **~~Nothing links to the play surface.~~ Done.** `Shell.tsx` renders Play
  and Library in the signed-in nav, with the test this item asked for —
  *offers Play and Library, addressed to their surfaces* — and its absence
  asserted when signed out.
- **The play surface is dark inside a light shell, and typed text is invisible.**
  **Blocking.** `Shell.tsx` sets `text-slate-900` on the app root; four files
  under `play/` set `bg-neutral-900` and no text colour, and Tailwind's preflight
  gives inputs `color: inherit`. Measured at **1.01 to 1**, with the caret and
  the placeholder resolving to the same value. The player's own line renders at
  2.5 to 1 and the only failure message in the app at 1.7 to 1; the control that
  opens the guidance box fades to 1.2 to 1 *on hover*.

  It is a stranded assumption rather than a theme — sixteen `neutral-*` utilities
  in the client against a hundred and seventy-two `slate-*`, and git dates the
  light shell to P1.6 and the play surface to P2.6. *Repaint onto slate: four
  files, two hours, mechanical.*

  **Discharged**, and the repaint turned into the thing that prevents the next
  one. The immediate fix was the four files; what the diagnosis above actually
  described was a client with no styling layer at all, so the colours were
  gathered into semantic tokens in `packages/client/src/index.css` and the
  repeated markup into `packages/client/src/ui/`
  ([05 §1.2](../05-ui-surfaces.md), [07 §6.1](../07-tech-stack.md)). A Tailwind
  palette scale written anywhere else in the client is now a **lint** error,
  which is the part that makes "a stranded assumption" unrepeatable rather than
  repaired. *Not a build error, as this said before it was checked:* the root
  `build` is `tsc -b`, the schema emit and `vite build`, with no ESLint in it. CI
  runs `pnpm lint` on both legs so the gate holds — the sentence did not.

  Re-measured against a body that paints `--color-canvas`, in both themes:

  | | before | light | dark |
  |---|---|---|---|
  | typed text | **1.01** | 17.83 | 17.04 |
  | the player's own line | 2.5 | 7.25 | 7.66 |
  | the failure message | 1.7 | 6.78 | 13.93 |
  | the guidance toggle, on hover | 1.2 | 17.04 | 19.27 |
  | the composer's placeholder | — | 4.76 | **3.74** |

  **Two of those rows were wrong when they were written, and the correction
  matters more than the numbers.** They read 9.9 and 13.56 — which is
  `--color-ink-muted` on `--color-canvas`, a token *neither element uses*. Three
  independent re-measurements in a real browser agree on the figures above, and
  the commit that set those classes set them to `text-ink-subtle` and
  `text-warn-ink`, so the old pair was never true for the elements named. The
  discharge stands — everything clears 4.5:1 — but the evidence did not, and this
  document's own rule applies to itself: **a check that cannot fail is worse than
  no check.**

  **And the last row is a defect the second theme introduced.**
  `--color-ink-faint` has the same value in both themes, so every placeholder in
  the app — the composer, the guidance box, the session name, every `Field` —
  sits at 3.74:1 in dark. One token value in the two dark blocks of `index.css`.
  It is the original item's own second clause, arriving in the theme that was
  built to close it.

  Two things the second theme found that one theme could not. **Nothing painted
  the app's background**: `bg-canvas` sat on `Shell`, which is the *signed-in*
  frame, so login, setup and the error boundary fell through to the browser's
  canvas — invisible while that canvas was white and the app was light. It is on
  `body` now. And **`color-scheme` was missing**, which is the same defect class
  as the original: an input whose CSS is right and whose caret is not.
- **~~The startup line names an address that serves no UI.~~ Done.** It printed
  the API's address and then *"Open the address above"* — and the server serves
  no static files, so that address is a 404 and the client is on Vite's port. The
  API line names itself `api` now, and the setup line names **the client**, which
  is where a person should go. [12 §2.1](12-p2-manual-gate.md) step 1 and
  [P2B §4](14-p2b-provider-configuration.md)'s command block are corrected with
  it. *Fastify prints its own listening line first and still names the API port;
  that one is true, it is simply not where anybody goes.*
- **~~A repeated flag is silently ignored.~~ Done, both halves.** A repeated
  flag is a `UsageError` — the same treatment F24 gave a flag with no value —
  and Vite's proxy target reads `SE_API` (its own port `SE_CLIENT_PORT`),
  which [17 §2.3](17-p2c-brief.md) documents since nothing else did.

### 1.2 The findings would be wrong — about two days

The provider boundary is the phase's subject, and five of its behaviours are
wrong in ways that would make a session's observations misleading rather than
merely incomplete. **Every one of these produces a plausible false finding.**

- **~~Every streaming failure escapes the adapter unclassified.~~ Done** —
  `onError` captured, re-thrown through `asProviderError`, with six streaming
  failure shapes and three classification routes under test, so a deleted
  route fails a test rather than going quiet. The account below is kept
  because it is the most instructive item on this page.

  Five shapes driven through the real adapter — a fetch rejection, a 401, a 429,
  a 400 and a genuinely closed port — produced one identical
  `NoOutputGeneratedError`, `class: undefined`, `detail: undefined`, reading
  *"No output generated. Check the stream for errors."* `await result.usage` sits
  outside the `try` that wraps the stream loop, and the AI SDK does not throw
  into that iterator: it calls its own `onError` and ends the stream empty, so
  `asProviderError` never runs on the path every turn takes. Two consequences
  beyond the message: the SDK dumps the real diagnosis to **stdout as a raw stack
  trace, outside pino and with no `jobId`**, which breaks
  [13 §4.1](../13-internal-contracts.md)'s one-format contract; and a transient
  blip is classified `terminal`, so the retry never fires.

  **Why the suite is green is the part worth keeping.** `stream()` has no tests —
  `openai-compatible.test.ts` has ten and every one drives `generate()`. And
  `FakeProvider.stream` throws a `ProviderError` *from inside the generator*,
  which is a shape the real adapter does not have. That is
  [12 §4.1](12-p2-manual-gate.md)'s *"a stub agrees with whatever wrote it"*,
  instantiated — and the one test that would have caught it is one whose **fetch
  stub** rejects rather than whose generator throws.

  **Three of [12 §2.2](12-p2-manual-gate.md)'s deliberate breakages are about
  this path and today all three return the same wrong answer.** *A day, and the
  streaming tests are the more valuable half.*
- **~~`usage` is null on every turn~~ Done, both halves** —
  `reportsUsage: true` for the adapter and `includeUsage: true` on the wire,
  with the streaming path's usage-only final chunk now asserted directly.
  The original account: the two reasons were independent and both had to be
  fixed — `reportsUsage: false` in the conservative baseline that
  `openai-compatible` inherits verbatim, and `includeUsage` never passed to the
  SDK, so `stream_options` never goes on the wire. *(A third — a form edit
  deleting the hand-written override that would fix the first — was found by the
  same survey and is already fixed.)* [13 §1.4](../13-internal-contracts.md)
  calls cost *provider-reported, not estimated*, so this is the phase's headline
  check and it is unpassable by construction. **It is a reporting gap and not a
  pipeline one** — the budgeter uses its own `estimateTokens` and never reads
  reported usage — which is why it is high rather than blocking, and why fixing
  it changes what the record says without changing what the turn does. *Half a
  day.*
- **~~`ModelCall.resolved` records what was asked for, never what
  answered.~~ Done** — `modelThatAnswered` reads the response's own id on both
  paths, tested. The caveat that survives into the brief: on an endpoint that
  echoes no model id the adapter falls back to what was asked for, silently,
  so a match is proof only where the endpoint is known to report one. The
  original point stands as the reason the check exists: a check that cannot
  fail is worse than no check, and this one was written into §4 before the
  survey caught it.
- **~~A truncated reply is indistinguishable from a finished one.~~ Done** —
  `finishReason` is kept and mapped to a call outcome, so a ceiling reads
  `truncated`, a filter `refused`, and a stream that simply stops —
  the local runtime's characteristic failure — `incomplete` rather than a
  successful turn. (`cancelled` joined the vocabulary later, from finding 2.)
- **~~Every connection is budgeted at 8192 tokens, because nothing ever sets
  otherwise.~~ Done, with one ask converted into a refusal** — the client's
  *Context window* and *Reports token counts* fields land end to end and
  `docs/api.md` documents the body; the third ask, a `KNOWN_PROVIDERS` entry,
  is now a written refusal at `config.ts`: capabilities.ts will not invent a
  number it cannot verify, so the override belongs to the person who knows the
  machine. The original account: *"No way to say otherwise" was wrong and is corrected here:* the
  route body, the store, the file format and the budgeter all already handle
  `capabilities`, and two audits measured a 4096 override landing end to end. The
  work is unchanged and as small as it was sized — a client field, a
  `KNOWN_PROVIDERS` entry, and a line in `docs/api.md`, whose documented body
  omits `capabilities` entirely — but it is a surface gap, not an absent
  mechanism.
  No `KNOWN_PROVIDERS` entry sets `maxContextTokens`, so `budget.ts` always falls
  through to `config.limits.contextTokens`. A local runtime with a 4k window
  truncates silently and one with 128k is throttled to a sixteenth — and the
  phase cannot tell a prompt problem from an overflow problem either way. *Half a
  day: two fields on a route body that already accepts them.*

### 1.3 The failure would be unfindable — a day and a half

[13 §4.1](../13-internal-contracts.md) is unambiguous about what the log owes:
*a child logger binds `requestId`, `account`, `sessionId`, `jobId`, `turnId` once
at the point the subject comes into existence rather than each call site
repeating them*. Measured against it, the server has 28 log call sites and **19
of them are on the turn path**; `index-db/`, `library.ts`, `storage/`, `auth/`,
`sessions/store.ts` and `providers/` have none at all.

- **~~The bindings.~~ Done, except `requestId`.** `account` appeared on exactly
  one line; `job.lost` and `job.unstartable` carried `jobId` alone and
  `job.committed` had no `sessionId`. A tester reports the id they can see —
  the session's, from the URL — and the lines that would explain it could not be
  found by it. It was closer to a deletion than an addition, as predicted: the
  child logger moved from `#body` to `start()`, which is what [13 §4.1] asks
  for — *once, where the subject comes into existence* — and the three lines
  written outside `#body` inherited the bindings by doing nothing.

  **`requestId` is deferred, with a reason rather than by omission.** It is the
  one binding in [13 §4.1]'s list that does not exist yet: Fastify mints a
  `reqId` per request, a turn outlives the request that submitted it, and
  nothing carries the id across the job table. Threading it means a column, a
  migration and a decision about what the id *means* for a turn recovered after
  a restart — which is a question about the job record, not about logging, and
  P2C has no finding that needs it. The session id is the id a tester actually
  reports. **Revisit when a finding cannot be traced without it.**

  It also cost a test. `commits a failed turn rather than wedging the session
  forever` reached the resolution region by corrupting a session's cast; the
  session reader and `resolveCast` have both since become tolerant of a broken
  file, and the fixture stopped failing without the test noticing — every
  assertion it makes is also true of an ordinary successful turn, so it passed
  by testing a turn that worked. It now corrupts `accounts.json` and asserts
  that `job.unstartable` was written, so the next hardening past its fixture is
  a failure rather than a silence.
- **~~A failed step logs the whole rendered prompt and the partial
  narration.~~ Done (F32)** — the step-failure line logs a shape (event, step,
  reason, message, class, call id) rather than the error object, so
  `partialText` and the rendered prompt stay on the record where they belong
  and out of the log, per [13 §4.1]'s *a log is not a backup and user prose is
  not diagnostic*.
- **~~Pressing Stop writes an `error` line.~~ Done, same commit** — the
  level follows the reason: `info` for a cancellation, `warn` for `ignore`
  and `warn` failure modes, `error` only for a step that aborts the turn.
  Stop pressed constantly against real latency now reads as what it is.
- **~~The provider's own error text is thrown away.~~ Done** — `detail`
  rides `CallFailed` onto the record and into the step-failure log line,
  absent rather than empty when the endpoint said nothing, so silence and a
  blank are distinguishable. The words never become UI copy; the class still
  crosses to the person.
- **~~A broken library file is logged by nothing.~~ The `warn` line is done;
  the card is still out.** The index records the failure and
  `GET /api/library/errors` exposes it, and now `library.invalid` is written at
  `warn` with the portable path
  ([`watcher.ts`](../../../packages/server/src/index-db/watcher.ts)), wired at
  `app.ts`. So the failure is no longer invisible *afterwards*, which was the
  half that mattered for evidence. It is still invisible to the tester at the
  moment it happens — no client calls the route, and [12 §3.5](12-p2-manual-gate.md)'s
  missing card is §1.7's deliberate deferral rather than an oversight.

  **A note on how this entry was found to be stale, because the lesson is the
  document's own:** it was still listed as outstanding here, and in a status
  summary written from this page rather than from the code. Nothing in the plan
  is evidence about the plan.
- **~~The log has no destination, so [§4](#4-verification--the-p2c-exit-gate)
  step 9 cannot be checked at all.~~ Done: `pnpm dev:logged`, and said in the brief at
  [17 §2.4](17-p2c-brief.md).** It is JSON on
  stdout — deliberately, since [13 §4.1](../13-internal-contracts.md) refuses a
  file and refuses a pretty transport — and the documented way to run this was
  `pnpm dev`, which multiplexes both packages and prefixes every line with
  `packages/server dev: `. **Measured rather than assumed**, because the claim
  was worth checking before building against it: every record came out as a
  string beginning with a package name and then containing JSON, and nothing
  reads that.

  `tools/dev-server.mjs` runs the server on its own and **tees** stdout to
  `./logs/server-<date>.log`. Tees rather than redirects: a redirect takes the
  output away from the person running the session, who needs to see it, and a
  terminal alone leaves nothing to search a day later — which is the whole point
  of a manual phase. Byte for byte, with no line reassembly, so the file is what
  the server wrote.

  It has a test, and the test is the shape of the bug: a real server, killed,
  and every line of the resulting file parsed. Reintroducing the prefix fails
  it. Nothing had ever read the log back, which is why the prefix survived all
  of P2.

  **And one thing found on the way: `pnpm dev:server` cannot be pointed at
  another data directory.** The package script hardcodes `--data ../../data`
  and `main.ts` rightly refuses the flag twice, so the documented route to a
  scratch install answers *`--data` was given more than once*. `dev:logged`
  takes the flag properly; `dev:server` is left alone, since its default is the
  convenience it exists for.
- **~~Nothing bounds a provider call, so a stalled endpoint is an unending
  turn.~~ Done.** `limits.providerTimeoutMs`, composed into the abort signal per
  attempt and defaulting to five minutes.

  **It bounds silence, not duration**, and that is the decision the sizing note
  did not make. A multi-minute first token is ordinary on a local runtime, so a
  wall-clock ceiling would kill healthy long generations — the clock is re-armed
  by every streamed chunk instead, and a non-streaming call has no progress to
  show, which makes the whole of it the bound. `0` disables it, because an
  operator who knows their endpoint is slower than any number here is going to
  work around it either way and the config file is the visible place to do it.

  **The failure is `terminal`**, which is the classification the sizing note
  asked for and the one that is arguable. A stall is transient in the ordinary
  sense — ask again in a minute and it may answer — but the retry ladder is two
  further attempts at the full timeout each, so classifying it `transient` makes
  the hang three times as long as the key exists to make it. A person who wants
  another attempt has a button. A person waiting on a wedged session has nothing.

  **And the key's surface came free, as [§4](#4-verification--the-p2c-exit-gate)
  said it would.** [P2A](13-p2a-configuration-surface.md)'s form generates its
  control and tier badge from the schema with no client change. The two things
  that were *not* free were the two the test suite refuses to let go: the
  `LIVE_APPLIERS` row, and the key's absence from `config.example.json` and from
  [13 §4.3](../13-internal-contracts.md)'s table. Both failed the build the
  moment the key landed, which is the honesty machinery working exactly as
  described.

### 1.4 Setup and teardown — about a day

- **Teardown half-completes while the server is running, and the survivor is the
  index. Blocking.** `rm -rf` on a live data directory removes everything
  unlocked and fails on the SQLite files — so the next run starts from a state
  nobody chose, and the part that survives is the *derived* part.
  *One hour: a written procedure and a script that stops the server first and
  removes `index/` and `state/` as directories.* **And the same procedure
  inverted is how a finding becomes an artefact somebody else can open** — stop
  the server, copy the whole directory including `-wal` and `-shm`, and know
  that `index/` is disposable while `state/`, `accounts.json` and `users/` are
  not. Three sentences, and without them a snapshot taken mid-session is a
  coin-flip.
- **Nothing seeds a library or a session.** The UI creates a session — name only,
  default mode, no cast — and creates **no library object of any kind**; a cast
  is API-only. So every session starts empty unless somebody writes curl by hand,
  and *empty* is not the case worth testing. *Half a day for a seed script under
  `tools/`, driven through the HTTP API so it exercises the same doors a person
  does — and it is worth keeping for PLAYABLE.*
- **`dataDir` is cwd-relative, the settings form writes it back, and the
  read-only guard is client-side only.** A config `PUT` naming
  `"dataDir": "../../elsewhere"` answers `200` and moves the install on the next
  restart. [P2A §2.6](13-p2a-configuration-surface.md) argued that field into a
  read-only note precisely because editing it is *"a one-click way to appear to
  lose everything"* — and then enforced it in the browser only. **A trap that
  answers 200 cannot be avoided by asking a tester not to touch it.** *Two hours:
  refuse the key server-side, naming `--data`.*
- **The README describes P1.7.** It is the document a tester follows, and it is
  three phases stale: it says objects are created through the API, and mentions
  neither the play surface nor the settings surface. *One hour.* — *and strike
  the third reason this item used to give:* it does say which address to open,
  and has since a P1.6 docs pass with an unrelated subject. The item was written
  without checking.

### 1.5 The suite, and what is owed — half a day

A manual phase produces fixes, and a fix cycle runs the suite constantly. **A
suite that fails for reasons unrelated to the change is one that stops being read
at exactly the wrong moment**, and this one does — now with numbers, because the
survey measured the ladder rather than repeating the anecdote:

| Load | Wall | Result |
|---|---|---|
| 1 suite, idle | 12s | green, twice |
| 1 suite, all 16 cores saturated by unrelated work | 47s | green |
| 2 concurrent suites | 23s | green |
| 3 concurrent suites | 38s | ~~3 of 3 red~~ → **0 of 3** |
| 4 concurrent suites | — | ~~4 of 4 red~~ → **0 of 4** |

**~~The suite fails under its own load.~~ Closed, and the ceiling is written
down here as [§1.5] asks.** Four concurrent full runs on this machine are green;
three were three-for-three red before. **The rule to know: nothing between one
and four concurrent runs breaks it any more**, and the number that did the work
was one line — a declared `testTimeout`, which was ~90% of it.

*And a green suite is still not a green build.* `pnpm test` is `vitest run` and
nothing else; `pnpm typecheck` is a separate script and vitest strips types
without checking them.

*Re-measured after the CI gate's teardown fix, and it got worse rather than
better: the ceiling did not move, the breaker did.* The gate itself now survives
a seven-run ladder without a single failure, and `sessions/store.test.ts` — a
file this section never mentions — accounts for most of what breaks instead.

The ceiling is filesystem contention rather than CPU — a saturated machine
running one suite stays green at four times the wall clock. And **the two files
that break first break for a reason worth fixing rather than for being slow**:
`logging.test.ts` and the CI gate's `rebuild-property.test.ts` both poll on a
wall clock or on snapshot *stability*, instead of on the watcher barrier that
exists and is used correctly in `watcher.test.ts`. The gate's failure text reads
as index corruption, which is the worst false alarm available to hand somebody
mid-phase.

*~~Half a day: declare a `testTimeout`… point `logging.test.ts`'s poll at
the watcher barrier, and remove the 154 KB temp directory every run leaks.~~
All three landed* — the ladder note above already said so, and this paragraph
kept re-opening what that one closed; the contradiction stood for a while and
is worth the sentence, because a document that disagrees with itself about
what is done sends somebody to re-do it. One postscript: the teardown fix
itself introduced a *new* leak — `reset-data.test.ts`'s held-file test parked
one mkdtemp directory per run, forever, in the suite that exists to prove
teardowns complete — found and fixed in the closeout.

*Three corrections to the sizing above, all measured.* The timeout is not
co-equal with the polls: it is ~90% of the ceiling and `logging.test.ts` is ~10%,
whose own per-test override is already 20s so what it hits is its `eventually`
deadline rather than the default. The gate's poll needs no work — see the ladder
note. And the leak is 154 KB per run rather than a megabyte, which is the one
number here that was overstated in the *un*flattering direction. Then write the ceiling down, so *"do not
run three suites at once"* is a known rule rather than a rediscovery.

**And one line for whatever briefs the tester:** `pnpm test` is `vitest run` and
nothing else, so a green suite is not a green build — `pnpm typecheck` is a
separate script and vitest strips types without checking them. **Done, and it
grew:** [17 §2.3](17-p2c-brief.md) lists everything `pnpm test` does not cover,
which is six things rather than one.

### 1.6 Nearly free, and owed

- **~~No CI run has ever covered any P2 code, on either platform.~~ Done, and it
  paid for itself immediately.** A draft PR ran the matrix for the first time.
  **ubuntu passed; Windows failed** — the platform everything was developed on —
  with five workers dead, zero failed assertions, and no named test. The cause
  was a native `abort()` in libuv's directory watcher: `os.tmpdir()` returns an
  8.3 alias whenever the account name runs past eight characters, GitHub's runner
  is `runneradmin`, and `Layout` handed that spelling straight to chokidar. Fixed,
  with the link-root variant it also exposed — a watcher that silently indexes
  **nothing**. Both legs are now green and
  [12 §4.5](12-p2-manual-gate.md)'s owed ubuntu run is discharged.

  **It is worth recording what this says about the rest of the list.** Twenty-two
  defects were found by reading. The twenty-third was found in ten minutes by
  *running the thing somewhere else*, and no amount of reading would have reached
  it — the mechanism is in a library, on one platform, behind a native assert.
  That is the phase's own thesis arriving early and unprompted.
- **~~A version stamp, smaller than it first looked.~~ Done, both halves.**
  The session template in [16](16-p2c-log.md) opens every finding with
  `git describe --tags --always --dirty` — the tester is the repo owner
  running from a working tree, so that answers the question at zero build
  cost — and [04](../04-server-multiuser-deployment.md)'s sentence now says
  the build *will* embed a version for AGPL §13 and that **no build embeds
  one today**. The surface stays with P10's About requirements.

### 1.7 What is tempting and is not pre-work

**The line: pre-work repairs the evidence; it does not build features.** Every
item below would improve the phase and none of them clears that.

**The library error card** — [P2 §4](04-p2-implementation.md) step 7, open since
P2, and the hardest one to leave out. A tester will hand-edit an actor into an
invalid shape within the hour, because that is [12 §2.1](12-p2-manual-gate.md)
step 8 and the storage thesis's own demo ([05 §4.1](../05-ui-surfaces.md)) —
and get silence, then stale content presented as current, then a conflict dialog
blaming an editor who does not exist. **It stays out**, because it is a surface,
and §1.3's `warn` line is the part that makes the failure *evidence* rather than
a mystery. The card is this phase's first confirmed finding and the first thing
fixed in P2C.4, which is a schedule rather than a demotion.

**A failed turn saying why on screen.** `PlayPage` renders eleven words for every
failure — *"This turn did not finish."* — while the class it needs is already on
the wire in `step.failed` and in the reducer's own `error` field. Same rule, and
it is the second thing fixed. Named here because it is the one most likely to be
argued into §1.3 on the grounds that classification is evidence: it is, and the
log is where the phase reads it.

**A cassette tier for the adapter.** [12 §4.1](12-p2-manual-gate.md) calls it the
largest single gap in the suite and it is — and it **cannot** come first, because
a cassette is a recording of an exchange nobody has had. It is the phase's
output, and §2.2 makes it the most valuable one.

**A Playwright harness.** [testing §3.5](10-testing.md) wants a thin set of
journeys and names a guess at which. Building it now encodes that guess into a
dependency on the day before finding out; the phase produces the list.

**A home screen.** [polish §5](09-polish.md) already names it — arrival is an
arbitrary library view — and P2C.1's whole subject is what a stranger does in the
first minute, which makes it the most tempting item on this page. **Out**, and
the reason is that the phase is what decides what a home should contain. Building
one first is testing an answer instead of finding one.

**The session routes' O(n) re-parse.** Every session read re-parses every turn in
the session, and each turn record embeds the last twenty. That decides whether
long sessions are viable at all — so **measure it before the phase and fix it
during**: on a hundred-turn session the numbers are the useful artefact, and
changing the code first destroys the measurement.

**Reasoning models.** The shipped preset sends `max_tokens`, which OpenAI's
o-series and gpt-5 family reject in favour of `max_completion_tokens`. *Write the
constraint into the phase brief with a known-good model list* — ten minutes —
rather than building a per-connection parameter dialect, which is real work with
no design behind it yet.

**Written: [17 §4](17-p2c-brief.md), and the ten minutes found two things this
sentence had wrong.** The shipped preset sends `temperature` as well as
`max_tokens`, so a list vetted for one is incomplete; and `stream_options` rides
on every request because the shipped mode always streams. The *list* is not
written and deliberately so: which models accept what is a fact about somebody
else's API on the day, so the brief carries the rule and the check, and the list
is an output of P2C.1.

**Everything else in [polish](09-polish.md), and [12 §3.6](12-p2-manual-gate.md)'s
smaller ones.** That file's own framing is that its entries are *"obvious the
moment a real person uses the app and invisible while reading the spec"*.
Clearing it before the phase is clearing it from the spec, which is the position
it says does not work.

### 1.8 If this has to be smaller

The full list is five or six days and it is the honest recommendation. If it has
to be cut, **cut whole groups rather than items within them**, and cut from the
bottom — with one exception, because the three blocking items do not sit in one
group. **§1.1's palette, §1.2's streaming classification and §1.4's teardown come
out of any cut whatever it is**, and the table below assumes they have.

| Keep | Days | What dropping the rest costs |
|---|---|---|
| §1.1 alone | 1 | A person arrives somewhere and can read the screen. Nothing else — the provider findings would be wrong, and unfindable |
| §1.1 + §1.2 | 3 | **The minimum worth running.** The boundary can be tested and believed. Failures are real but hard to chase, and every run starts from a state nobody chose |
| + §1.3 | 4½ | Findings are chaseable afterwards, which is what makes the phase's output reusable rather than a memory |
| + the rest of §1.4, §1.5, §1.6 | 6 | Runs are repeatable and comparable, the suite can be trusted through the fix cycle, and two things that are owed anyway get paid |

**The one group not to cut is §1.2.** Without it the phase produces confident
findings about a boundary that is misreporting itself, which is worse than not
running it — a wrong answer nobody knows is wrong outlives a missing one.

---

## 2. Decisions this plan had to make

### 2.1 It tests the boundary, not the experience

The temptation is to run a first manual pass as a UX review, because that is what
a person is best at and because the surfaces are new. **Resist it, for a
scheduling reason rather than a quality one.** P3 adds the workbench and P4 adds
import; both change what these screens sit beside and what somebody arrives at. A
copy pass now is a copy pass to do again.

So findings about how the app *reads* are recorded and deferred — to
[polish](09-polish.md) if they clear its bar, to PLAYABLE if they are about
legibility. The findings this phase acts on are the ones about whether the
machinery *works*: the provider boundary, storage under a real session, and
config and accounts under a second real browser.

**One exception, and it is narrow.** Copy whose job is to get somebody unstuck is
tested here rather than deferred, because its failure mode is a person who cannot
proceed rather than a person who is mildly annoyed. [12 §2.4](12-p2-manual-gate.md)
already names the three: the dead-end sentence
([04 §4.5](../04-server-multiuser-deployment.md) commissioned it), the removal
dialog, and the restart banner.

**And that exception is smaller than it was**, because the readiness survey ran a
live first-contact walk and read them: the dead-end sentence appears verbatim
where [12 §2.1](12-p2-manual-gate.md) step 2 predicts it, the role table's third
state renders as *"Nothing can do this yet, and nothing needs to"* and does the
job it was built for, and the capability grouping and removal dialog read
honestly. What is left for a person is the judgement a grep cannot make — whether
those sentences land — rather than whether they are there.

### 2.2 Every real call becomes a fixture, and that is the phase's best output

**A manual phase whose output is a document is a phase that has to be run again.**
The output that outlasts it is bytes.

[testing §4.2](10-testing.md) already asks for cassette-style record-and-replay
for the adapter tests. It could not be built, because there was nothing to
record: you cannot capture a real exchange before you have made one. **This phase
is the something**, and that makes the ordering a fact rather than a preference —
the cassette tier is this phase's *output*, not its prerequisite.

So every exchange with a real endpoint is captured verbatim — request and
response, credentials redacted, the streamed body byte for byte — and committed
as a fixture `openai-compatible.test.ts` replays.

**The recorder is built** — `--capture <dir>` on the server, on by default
under `pnpm dev:logged` into `./captures/<the log file's stamp>`, so a
session's log and its cassettes correlate by name and nobody has to remember a
flag for exchanges that happen exactly once. It sits at the adapter's own
`fetch` seam — the same seam every adapter test injects a stub through, which
is what makes record and replay two ends of one interface — tees the stream
with the recorder's branch pumped eagerly, files a mid-stream cut as a
*partial* cassette rather than a loss, and redacts by exact-secret
substitution at the byte level, so a key split across chunk boundaries is
still caught and everything a secret did not touch round-trips byte for byte.
Proven end to end: a real turn against a stub endpoint that deliberately
echoed the key inside the streamed prose landed one cassette with the key
redacted, the host gone, and the chunk boundaries intact.

**The corpus and its replay test remain this phase's output, on purpose.**
The replay block in `openai-compatible.test.ts` is written at P2C.2 when the
first real cassette is curated — copied from `./captures`, re-read for
secrets, given a `meta.expect`, committed under
`packages/server/src/providers/fixtures/`. It is not written now because a
corpus test over an empty directory must either fail (wrong until the phase
runs) or skip — **and a skip-when-empty test is a check that cannot fail,
which this document has caught twice already.** That converts *does the adapter
parse a real stream* from a manual step into a permanent test, and leaves the
manual budget for what only a person can do.

**Held honestly, with [12 §4.1]'s caveat attached:** a recording goes stale the
day the provider changes and nothing tells you. It is not a substitute for
[testing §4.2](10-testing.md)'s scheduled conformance run against the live
endpoint; it is the offline half of it, and the scheduled half stays owed.

### 2.3 One hosted endpoint and one local runtime, because they fail differently

Not for coverage. They break in different places, and each break is invisible from
the other side.

A hosted endpoint exercises authentication, rate limiting, a real `usage` block,
and errors that arrive as structured JSON. A local runtime exercises the opposite
half: no key at all, an endpoint that may not implement `/models`, one that
answers `/models` with a single entry called `gpt-3.5-turbo` regardless of what is
loaded ([P2B §2.6](14-p2b-provider-configuration.md)), a context window the
adapter has no way to ask about, and `usage` that is frequently absent — which
matters because [13 §1.4](../13-internal-contracts.md) calls cost
*provider-reported, not estimated*, and an endpoint that reports nothing makes
every cost figure in the record a zero that looks like a number.

**And the local one is the primary case, not the exotic one.** [00 §1](../00-stance.md)'s
position is that this runs on your own machine; the household example
[07 §5.1](../07-tech-stack.md) uses is *"Dad pays for the API"*, which is the
hosted case, but the install nobody has to pay for is the one that decides whether
this is worth running at all.

### 2.4 Time-boxed, with the scenarios fixed before it starts

**Three days, and the list written down first.** Both halves matter and for
opposite reasons.

The box, because a manual phase with no end is one that either stops when
somebody gets bored — which correlates with nothing — or expands to fill the time
before P3. The list, because an unbounded session finds what is in front of it,
and what is in front of a person who just built something is the thing they just
built.

The list is [12 §2](12-p2-manual-gate.md), which already exists and was written
by walking three gates. **§3.2 below is that list, sequenced.** What it is not is
a script to be followed to the exclusion of noticing things — §3.3 is the half
that exists for exactly that.

### 2.5 Triage is decided now, before there is a finding to be tempted by

Every finding lands in one of five places, and which one is decided by a rule
rather than by how interesting it was. Written before the phase for the obvious
reason: afterwards, every finding argues for its own importance.

| Where | The rule |
|---|---|
| **Stops the phase** | It means the observations already made were of a broken system. §2.6 |
| **Fixed inside the phase** | It blocks a later scenario, or it is a defect in something this phase's own stages built |
| **A gate correction** | It shows an exit-gate step describing behaviour the code does not have — the shape [P2B §4](14-p2b-provider-configuration.md)'s first walk found three times |
| **[Polish](09-polish.md)** | User-facing, bounded, no schema change and no new contract. That file's own bar, and its own framing says these are *"obvious the moment a real person uses the app"* — which is what this phase is |
| **[PLAYABLE](01-work-plan.md)** or [roadmap](../14-roadmap.md) | Anything about whether the record is legible or the budgeter comprehensible is §4.1's question, not this one's. A deferred feature is the roadmap's |

**Nothing is allowed to have no home.** The phase does not end until every
finding has one, which is [§4](#4-verification--the-p2c-exit-gate)'s last step
and the one most likely to be skipped.

### 2.6 One thing stops the phase, and it is not a defect

A phase that stops at every defect finds one defect. So the rule is narrow:
**stop only when a finding means the observations already made were of a broken
system** — the adapter mangling every response, the index not reflecting writes,
a session losing turns. Then the fix comes first and the scenarios already run
are run again, because their results are worth nothing.

Everything else is recorded and the session continues. A tester who stops to fix
loses the state that produced the next finding, and the next finding is usually
the better one.

### 2.7 It costs money, so the bound is stated

A hosted endpoint charges for this. The bound is **a few dollars** on a
pay-as-you-go key created for the purpose and deleted afterwards, and the reason
to write it down is that *"test it against a real provider"* with no bound is how
a testing phase becomes a bill.

The cheap model does most of the work: the scenarios are about whether a turn
completes, is recorded, resumes and reports its cost — not about what it wrote.
[testing §4.3](10-testing.md) is the standing position and it applies here:
**test the mechanism deterministically; evaluate the writing by reading it.**

---

## 3. Stages

**P2C.0 is work; P2C.1 to P2C.3 are sessions; P2C.4 is bookkeeping that decides
whether any of it mattered.** Five or six days, three days and half a day — and
the first of those numbers is the one that surprised this document. §1 is why.

### P2C.0 — Before the first session

**§1's twenty-two items, in its six groups, and nothing that argues its way in
afterwards.** They are grouped by *what dropping them costs* rather than by
subsystem, which is what makes [§1.8](#18-if-this-has-to-be-smaller)'s cut
possible: reach a session, believe the provider, chase a failure, repeat a run,
trust the suite, and pay what is owed.

**~~Order them §1.1 first and §1.2 second.~~ §1.2 heads the list now, on its own
merit.** The old rule was that §1.1 is cheapest and §1.2 is the one whose absence
is invisible. **§1.1's blocking half is done** — a person can reach the play
surface from a link in the header and read what they type at 17.8 to 1 — so the
premise is satisfied and what remains of §1.1 distributes on cost like everything
else. §1.2 goes first because a phase that starts with the provider still
misreporting itself produces confident findings that have to be thrown away, and
nobody can tell which ones.

**~~Two hours at the very top: a throwaway smoke run.~~ It has been performed —
do not spend the two hours again; spend them reading what it found.**

The argument for it stands and is worth keeping: this document's thesis is that
reading missed twenty-two defects because nothing had ever exercised the paths,
and it then spent six days on reading-derived fixes before the first real turn.
That was the plan arguing against itself.

What settled it was not two hours of hand-driving but an automated run over the
whole stack against a local endpoint that speaks the streaming API — fifty-seven
turns on a scratch install, including reattach, crash recovery, a second account,
five deliberate breakages, a cancel, hand-edited library files and a live
teardown. **Its observations are still not findings in the sense §1.2 means** —
the boundary was misreporting itself throughout, so everything about failure
classification is re-taken in P2C.1. What it produced is exactly what the two
hours were for: **a reordering**, and a list of things nobody was looking for.
Both are in [16](16-p2c-log.md).

*And it moved four claims in this document from stated to measured, three of
which were wrong.* Those corrections are inline above, each marked where it sits.

**And the brief itself, which five items above point at: [17](17-p2c-brief.md).**
The runbook, the log and snapshot recipes, the model constraint, three pages of
*what not to report*, and the triage and stop rules restated where a person will
have them open. **Written against the source rather than against this document**,
and the checking found four things this page had wrong plus a defect in a config
key added the day before — which is the argument for the method, since the whole
function of a brief is to direct and withhold somebody's attention.

**And one thing to set up rather than build:** somewhere for findings to go while
the sessions run. A running file — `16-p2c-log.md` — appended to as things
happen and emptied by P2C.4's triage, with a five-line template at the top so a
finding arrives as a record rather than as prose: build (`git describe --tags
--always --dirty`), endpoint and model, session id, turn id, expected, observed,
snapshot path. Kept afterwards rather than deleted, because *what a person saw
the first time* is not reconstructible later and is the one artifact a second
pass cannot produce.

**And one rule for how the pre-work lands, because it is the least-reviewed code
this repository will contain.** Six days of changes in the provider adapter, the
log, the config surface, the dev harness and the suite — under phase time
pressure, in the layer P3 through P6 sit on. So: **every §1 item lands with a
test that would have caught it, or a written reason it cannot have one** (a
contrast ratio is the honest example), and the P2, P2A and P2B gates are re-run
before P2C.1 rather than after. The alternative is a phase that repairs its
instruments by damaging what they measure.

*Ends at:* a person who has never seen this repository can reach the play
surface from the address the server prints, read what they type into it, and take
a turn whose usage, model and finish reason are recorded — and a turn's whole
lifecycle can be filtered out of the log by the session id in the URL bar.

### P2C.1 — First contact, and it is perishable

**Thirty to sixty minutes, from the README and nothing else, with a real key in
hand and every scenario list closed.**

Deliberately before the scripted pass rather than after it, because **the
stranger's view of a system exists once.** After twenty scripted scenarios
nobody can un-know where the buttons are, and the questions that matter most
here — *what am I looking at, what do I do next, why did that not work* — are
exactly the ones that stop being askable.

So: a fresh data directory, `pnpm dev`, and the browser. Create the admin, find
the settings, add a connection, take a turn. **Write down every moment of
hesitation, and fix nothing** — a fix now costs the rest of the hour.

What to write down, because it is the part people forget: where you looked
first, what you expected a control to do before you clicked it, and every point
at which you consulted the source instead of the screen. That last one is the
signal; a person who has to read the code to configure the app has found a
defect in the app.

**The stranger is a problem this plan cannot solve by itself, and it should say
so rather than pretend.** The tester is the person who built this. §1.6 says so
in its own words, and the stage above calls the view perishable — which makes the
one thing it needs the one thing the author cannot supply.

*The mitigation, in order of preference:* borrow a non-author for
forty-five minutes with the README and a URL and nothing else, while the author
watches silently and writes; failing that, watch a screen recording of yourself a
week later, which recovers some of it; failing that, **write down in advance what
you expect each screen to do**, and treat every divergence as a finding, because
a prediction made before looking is the closest an author gets to not knowing.
The app's target user is a household member, so a stranger is not a hard thing to
find here — it is only a thing that has to be arranged before the day, which is
why it is written into the stage rather than left as an aspiration.

*Ends at:* one turn, from an empty directory, without opening the source. Which
is [P2B §4](14-p2b-provider-configuration.md) step 1, still the phase's plainest
statement of what it is for.

### P2C.2 — The scripted pass

**[12 §2](12-p2-manual-gate.md), sequenced, against both endpoints.** That list
exists, it was written by walking three exit gates, and its §2.1 is already
ordered as a session.

Two things travel with every scenario:

- **Capture the exchange.** §2.2 — every real call becomes a fixture, request and
  response, credentials redacted, streamed body byte for byte. Done as you go,
  not reconstructed afterwards from memory.
- **Name the turn.** Record the session id and turn id beside each observation. A
  finding without one is an anecdote, and P2C.0 exists to make the ids findable.

**Five scenarios the standing list does not have**, added here because the
readiness survey found nobody had asked for them and each is under an hour:

- **Be a second user.** The account half of P2A and P2B has never had two people
  in it. Create a non-admin, sign in from a second browser profile, take a turn
  on the system connection, then revoke `privateConnections` and watch what the
  turn does. That capability is enforced in the resolver and its enforcement has
  never been seen from the outside.
- **Hand-edit a committed turn.** No route edits, deletes or re-runs one — that
  is P3's and P5's — but the file is on disk, and *what happens when somebody
  changes it* is a storage question this phase can answer and no test asks.
- **Use a real editor, not `fs`.** Every write the watcher has ever seen came
  from node. Save once from a full editor, once from Notepad, and once as an
  Explorer or Finder copy-over, watching an open detail page. `awaitWriteFinish`
  has a 150 ms stability threshold and real editors write in ways `fs` does not.
- **Two sessions at once**, against the local runtime — the case §2.3 makes
  primary and the one with a single model slot. There is no queue and no
  concurrency cap; whatever happens is the finding.
- **The version history panel**, which is the app's only editing surface beyond
  the actor form and is on nobody's list. Edit five times, restore an old one,
  and confirm the restore is itself recorded.

The deliberate breakages are the valuable half and the easy half to skip because
nothing is going wrong yet: a wrong key, a model id that does not exist, a
completion ceiling of ten tokens — **which has no UI: hand-edit the session's
own `preset.params.maxTokens` in `session.json`, a one-line edit, since a
created session carries a full inline preset** — an endpoint that returns HTML,
the machine's network turned off mid-stream. [12 §2.2](12-p2-manual-gate.md)
lists them, and each should surface as a *classified* failure
([06 E7](../06-open-questions.md)) rather than as a provider string in the UI.
The ceiling is the one whose classification is not E7's: it surfaces as
`outcome: 'truncated'` on the call rather than as an error class, because a
ceiling reached is not a failure — which is itself the thing to verify.

*Ends at:* every step of [12 §2](12-p2-manual-gate.md) run, with an outcome
written beside it, and the cassette corpus committed.

### P2C.3 — The long pass

**A real session, a few hours, unscripted, on the local runtime.**

Not a second scripted pass with a different list. The point is *duration and
accumulation*: a session with forty turns in it, a library with things in it that
were made rather than seeded, an index that has been written to all afternoon and
a watcher that has seen a hundred events. None of the automated tests run long
enough to be interesting, and none of the scripted scenarios above leave anything
behind.

What tends to show up only here: memory and handle growth, a session that gets
slower as it gets longer, index and watcher disagreement after a lot of writes,
SQLite lock contention, a keepalive that stops keeping alive, and the turn record
getting harder to read as the thing it records gets longer.

**Play it rather than test it.** [testing §4.3](10-testing.md)'s position is that
narrative quality is evaluated by reading, and the same applies to whether an
hour with this software is tolerable. The scripted pass answers whether a turn
works; this answers whether forty do.

*Ends at:* a session long enough to be boring, still working, with the server's
memory and the log looked at afterwards rather than not.

### P2C.4 — Triage, and what the phase leaves behind

**Every finding gets a home by §2.5's rules, and the phase does not end until
none is left over.** This is the stage most likely to be skipped and the one that
decides whether the previous three were work or entertainment.

Three things are left behind, and each is worth more than the report:

- **The cassette corpus**, and `openai-compatible.test.ts` replaying it. §2.2.
- **The journeys worth a Playwright test.** [testing §3.5](10-testing.md) asks for
  *"a handful of journeys that would be catastrophic to break"* and lists a guess
  at which. This phase is how that guess becomes a list — the harness is not built
  here, but the list it should encode is, and it is written from what actually
  broke rather than from what seemed important.
- **The gate corrections.** Any exit-gate step this phase showed to be describing
  behaviour the code does not have, corrected in place in the phase document that
  owns it — which is what
  [P2B §4](14-p2b-provider-configuration.md)'s first walk did three times, and the
  reason those corrections were worth more than the ticks.

*Ends at:* no finding without a home, and [12](12-p2-manual-gate.md) rewritten
against what a person actually saw rather than against what a gate walk predicted
they would.

---

## 4. Verification — the P2C exit gate

Unusually for these documents, most of this gate is **not automatable and that is
the point**. What is written below is what a person has to have seen, in a form
somebody else can check they saw it.

1. **A turn against a hosted endpoint and a turn against a local runtime**, each
   from an empty data directory, with no file hand-edited at any point. *This is
   [P2B §4](14-p2b-provider-configuration.md) step 1, and it closes it.*
2. **Both turns carry a token count that came from the provider**, and a cost
   of `null` rather than `0`. The first half is what §1.2 fixes;
   [13 §1.4](../13-internal-contracts.md) calls usage *provider-reported, not
   estimated*, and today it is null on every turn for two independent reasons.
   The second half is deliberate and stays: no price table ships, and the adapter
   hard-codes `cost: null` rather than fabricate a number. **An earlier draft of
   this step asked for a non-zero cost — a check that could not pass, written
   before the survey caught it.** What is worth eyeballing is that the record
   shows null, because a `0` there would be the fabrication the adapter refuses
   to make.
3. **`ModelCall.resolved` names the model that answered**, and it is the model
   the binding asked for — checked against the provider's own response, not
   against what was sent. **This was a self-certifying check when it was
   written**: both adapter paths return the id the caller passed in and discard
   the one the SDK supplies, so the step compared a value to itself. §1.2 fixes
   it, and the step is kept because it is the right check.
4. **Five deliberate failures, five classifications** — a wrong key, a model id
   that does not exist, a completion ceiling of ten tokens, an endpoint returning
   HTML, and the network cut mid-stream. Each surfaces as a class
   ([06 E7](../06-open-questions.md)) and **none puts a provider's own string in
   front of the user.** *Two corrections from walking this step against the
   code:* the ceiling has no UI — it is a one-line hand-edit of the session's
   inline `preset.params.maxTokens`, which [17 §6](17-p2c-brief.md) spells out —
   and its classification is not an error class at all but
   `outcome: 'truncated'` on the call, because a ceiling reached is not a
   failure. Four failures and one truncation is the honest count.
5. **The model fetch, against three endpoints**: one that implements `/models`,
   one that does not, and one that answers with a single entry unrelated to what
   is loaded. All three end with a connection saved and usable, because the field
   is free text and the fetch is an assist ([P2B §2.6](14-p2b-provider-configuration.md)).
6. **The corpus replays offline.** Every exchange captured, committed with
   credentials redacted, and `openai-compatible.test.ts` asserting against it with
   `pnpm test` green and no network available. *This is the step that makes the
   phase repayable rather than repeatable.*
7. **A session long enough to be boring** — forty turns or more — still working,
   with the process's memory before and after written down, and a session read
   still answering in the time it did at turn one. *That last one is the
   measurement §1.7 defers: every session route re-parses every turn in the
   session, and forty turns is where a person finds out whether that matters.*
8. **The index rebuilds to the same thing.** Stop the server, delete `index/`,
   start it again: the library and the session read identically. A person can do
   this because the index is disposable by design
   ([02 §5.1](../02-data-model.md)) — and it is the one PLAYABLE hypothesis
   partly answerable now, since *files on disk beat a database* rests on the
   derived half being genuinely disposable.
9. **Every failure seen during the phase was findable in the log from its session
   id**, without a log line being added afterwards to find it. A failure that
   needed new instrumentation to explain is a P2C.0 item that was missed, and it
   goes back into P2C.0 rather than being waved through.
10. **The three unstick sentences read by a person** — the dead-end warning, the
   removal dialog, the restart banner — and each either kept deliberately or
   rewritten. [12 §2.4](12-p2-manual-gate.md).
11. **`pnpm test` green on ubuntu, watched by a person**, and the result quoted.
    [12 §4.5](12-p2-manual-gate.md) has been carrying this since it was written.
12. **The token estimator has been calibrated once.** `estimateTokens` is
    `Math.ceil(text.length / 4)` and its own comment says the provider reports
    the real number afterwards — which nothing has ever compared it to. For ten
    turns across ordinary prose and one code-heavy or non-English session, write
    down the estimate and the reported prompt tokens and keep the ratio. **This
    phase is the only opportunity before P5 budgets against that number**, and it
    costs nothing but writing two figures down per turn.
13. **Every finding has a home** by §2.5's table, and no document still says a
    person needs to do something this phase did.

**And the success criterion, which a stop rule is not.** §2.6 says what halts the
phase; this says when it is done: **P3 starts when the scripted pass has been run
end to end with no fix landing in the middle of it.** If a fix landed, the pass
is re-run rather than ticked — because a scenario that passed before the fix and
a scenario that passed after are two different observations, and only one of them
is about the software that ships.

**And the standing line from [01 §2.3](01-work-plan.md): no phase exits with
configuration that has no surface.** P2C adds exactly one key —
`limits.providerTimeoutMs`, from §1.3 — and it is discharged by machinery rather
than by remembering: [P2A](13-p2a-configuration-surface.md)'s install form
generates every control from the config the server sends, including its tier
badge, so a key added here renders with no client change at all. **What still has
to be done by hand is the row in `LIVE_APPLIERS`**, which says whether anything
*reads* the key yet — the honesty table beside the tier table, and the one thing
a new key can still be forgotten in.

---

## 5. Out of scope, deliberately

**PLAYABLE's four hypotheses** ([§4.1](01-work-plan.md)) — whether the record is
legible, whether one budgeter is comprehensible, whether inclusion reasons
explain anything, and whether files beat a database. Three of the four need the
workbench and a realistic imported library, which are P3 and P4. The fourth,
hand-editing a card mid-session, *is* exercised here — but as *does it reflect*,
which P1 already asserts, rather than as *is this how one wants to work*, which
is the hypothesis.

**The Playwright harness.** [testing §3.5](10-testing.md) wants a thin set of
journeys and this phase produces the list rather than the harness — building both
at once means encoding a guess about which journeys matter into a dependency, on
the day before finding out.

**The scheduled provider conformance run.** [testing §4.2](10-testing.md)'s live
half — nightly or weekly, against the real endpoint, catching a provider changing
under you — stays owed. The cassettes this phase produces are its offline half
and are not a substitute: a recording goes stale silently.

**Multi-user under load.** Two browsers, not ten. The concurrency questions
[04 §4.5](../04-server-multiuser-deployment.md) raises — a queue per connection,
shared rate limits, cost attribution — are 2.0's and P10's, and one person with
two tabs cannot answer them.

**Deployment.** Container, upgrade-with-data-intact, backup and restore. Those
are [§8](01-work-plan.md)'s beta bar and P11's, and every one of them needs a
release artifact this project does not yet build.

**Adapters for the four other names in `KNOWN_PROVIDERS`.** This build speaks
OpenAI-compatible chat and refuses the rest at save time
([P2B §2.5](14-p2b-provider-configuration.md)). Testing an adapter that does not
exist is not a manual-testing question.

**SSE framing, and it is worth saying so because it looks like the risk.** The
adapter never touches bytes — `@ai-sdk/openai-compatible` does all the parsing —
and the readiness survey drove the real adapter against transports covering
`[DONE]`, keepalive comments interleaved with data, a response chopped into
seven-byte pieces that split JSON objects mid-object, CRLF line endings, and a
usage-only final chunk. All of it handled. **Spending session time on framing
would be spending it on the one part of the boundary that is somebody else's
tested code**, which is the opposite of what §2.3 says the sessions are for.

**~~Everything present but deliberately unreachable, which the brief has to list
or the finding log fills with roadmap items.~~ Done: [17 §3](17-p2c-brief.md)**,
and it is three pages rather than half of one, because an audit of every route
against every client caller found seven more than this paragraph names — the
sharpest being that **a session's cast cannot be set from the browser at all**,
so every session started from the UI runs with no actors in it. The list below
is kept as written, with its errors, because two of them are instructive:
`GET /api/search` has tests and no client caller (P3's); `layout.memoriesRoot`
exists per user and nothing writes it (P8's) — *nor reads it, so the directory is
never created*; branching is a storage affordance with no route (P6's); sessions
and library objects cannot be deleted or renamed from the UI; nothing creates a
library object of any kind.

**The two errors.** *"Cannot be renamed"* is false for actors: the actor editor's
Name field saves, and what actually cannot happen is the folder moving, because a
slug is fixed at creation. The disk-versus-display divergence is the thing worth
pre-briefing, and saying *you cannot rename* would have sent a tester past it.
*"Nothing creates a library object"* is false by one side door: an actor save
conflict offers *save as a copy*, which posts a new object. Both errors share a
shape — **a claim about the UI reasoned from the absence of a route** — which is
why [17](17-p2c-brief.md) was written from the components.

Drawn from [12 §3](12-p2-manual-gate.md) and [01 §4](01-work-plan.md)'s phase
list — and it is the difference between a log of findings and a log of
rediscoveries.

**And the things already checked and found sound**, listed for the same reason —
so they do not consume session time. **Re-verified against the code for
[17 §3.5](17-p2c-brief.md)**; all of it holds, with two caveats now written into
the brief — nothing tests the watcher's *production* `awaitWriteFinish` value,
and the three-call ceiling is a fact about the one shipped mode rather than a
cap the runner enforces. Slug derivation handles Windows reserved
names, CJK-only names and case collisions; the watcher's `awaitWriteFinish`
threshold is set; sessions are fourteen-day signed tokens against a persisted key
file, so expiry will not bite mid-phase and a wiped data directory lands a stale
cookie on the setup form rather than a broken screen; CSRF is double-submit and
the client echoes it on every mutation; and the step plan is fixed per mode with
two retry backoffs, so no turn can loop into a runaway bill.

**One entry was removed from that list because it was false, and this is the
worst place in the document for a wrong claim** — the list's entire function is
to keep session time *off* the things it names. It said the assembled prompt
gives history turns real `user` and `assistant` roles. It did not: every
completed turn was collapsed into **one merged block labelled `assistant`,
which contained the player's own prose**. **Since fixed** — finding 3 in
[16](16-p2c-log.md): history now emits two candidates per turn, the input as
`user` and the output as `assistant`, sharing one priority so the budgeter's
drop-whole-turns behaviour survives the split. The paragraph is kept because
its method note still stands: the item reached the reassurance list without
anybody driving a prompt through a real request and reading it, which is the
exact failure this phase exists to end.

**And the production topology.** The server serves no static files, so everything
this phase exercises runs behind Vite's dev proxy. Anything that only appears
when one process serves both — cookie scope on a single origin, asset caching,
the reverse-proxy case [04 §5](../04-server-multiuser-deployment.md) describes —
is structurally out of reach here and belongs with P10's container work, which is
also the shape PLAYABLE will be played on.
