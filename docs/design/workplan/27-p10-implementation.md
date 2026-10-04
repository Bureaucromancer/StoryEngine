# 27 — P10 implementation plan

**Status: ~~built on branch `p10`, 2026-09-16 to 2026-09-17~~ — merged into
`main` 2026-09-17 at `b572c4c`, and open. Sitting P is unwalked.** ~~Skeleton, re-audited 2026-09-16 at `fee56da`.~~ Drafted 2026-08-29
alongside
[P7](23-p7-implementation.md), [P8](25-p8-implementation.md),
[P9](26-p9-implementation.md) and [P11](28-p11-implementation.md); to be
revisited before the phase starts.

***All six stages landed, and three of them were not the shape this document
predicted*** — recorded 2026-09-17, with [§3.2](#32-what-was-answered--recorded-2026-09-17)
as the results table [manual testing §0](05-manual-testing.md) requires and
[§3.1](#31-the-critical-list-and-what-a-test-answers) as the critical list.
**§1.7's update check moved into this phase** and turned two `unread` config keys
`applied`; **§1.5's fork closed as a deferral** with a row in
[25 §3.2](../25-roadmap.md) rather than as a build, on a distinction it was
missing — *1.0 needs extensions loaded, not installed*; and **the §13 source link
turned out to need the build to carry its URL**, because a constant cannot be
right for a fork and the patched-build case is the one §13 exists for. *The phase
does not close on the merge*: four criticals are unwalked and three of them are
errands, which [§3.1](#31-the-critical-list-and-what-a-test-answers) states
rather than absorbs.

***The re-audit is §5's own instruction carried out, and its answer changes a
stage.*** §0 below closes by saying what this phase *cannot yet know* — how many
notification-worthy things there will be — *"because the classes come from P7's
hooks and goals, P8's memory and P9's `artifact.ready`, three phases whose
surfaces do not exist."* **All three exist now**, and §5 names re-reading them
*"before writing the router rather than after"* as the revisit's cheapest move.
§0.1 is that read.

**What it found:** §1.4's five classes are **three** with producers, not four.
`turn.awaiting-input` never got its suspending step, and ***`artifact.ready` was
[P9](26-p9-implementation.md)'s to build and P9 did not build it*** — for a
structural reason that is correct and that this phase has to absorb. So the
producer joins the router in P10.1, and the retrofit risk P9 §1.5 named lands
here. [P7 §0](23-p7-implementation.md) says what a
skeleton this far out is for. Format follows [P1](07-p1-implementation.md);
citation convention as [P4](16-p4-implementation.md)'s.

**P10 delivers**, from [work plan P10](01-work-plan.md), what is left of multi-user,
notifications and deployment after three earlier phases took the parts that
could not wait: the remainder of [10 §15](../10-ui-surfaces.md) — the extensions
panel, *Restart now*, connectivity state, the notification preference rows — plus
the notification router and its two 1.0 delivery channels, the loopback bind and
its container inversion, the setup token's **check**, mDNS, the account gallery
([12](../12-account-gallery.md)), the About surface and the AGPL §13 source link.

**The demo that defines done:** *two people on one household server, each
notified only about their own turns; a fresh container that comes up reachable,
prints a setup token to `docker logs` and gates every route until an admin
exists; and a sign-in screen showing a gallery of faces rather than a text
field.*

**The spine, because a remainder phase does not have one by default.** Accounts,
login and first-run went to P1; account management and capability enforcement
went to [P2A](09-p2a-configuration-surface.md); system connections and bindings
went to [P2B](10-p2b-provider-configuration.md). What is left is not a subsystem
and will read as a list unless it is given a test. The test:

> **This is the phase that makes the install reachable, and safe, for someone
> who is not the developer.**

Anything here that does not sit on that line should be checked against
[P11](28-p11-implementation.md) before it is built, and anything found elsewhere
that does sit on it belongs here.

**CI this phase establishes:** the route-enumeration assertion extended —
[12 §8](../12-account-gallery.md) already specifies it — *the gallery family is
the only unauthenticated addition, and it answers only in gallery mode*; the
projection test, *a field added to `Account` does not appear in a `GalleryEntry`
until a line picks it*; and the notification routing test that matters on a
household server, *user A's turn never produces an event addressed to user B*.

---

## 0. What this document is, seven phases out

[P7 §0](23-p7-implementation.md) states the shared answer. What is specific here
is that **more of this phase is auditable today than of any other late one**,
because its subject is capabilities and configuration rather than a feature —
and both of those already exist and already have surfaces.

*Audited 2026-08-31:*

- **§1.5 holds and has a companion.** `enableExtensions` still gates nothing, and
  `auth/accounts.ts` says so in as many words. So the extensions panel's problem
  — a switch with no installer behind it — is unchanged.
- **But `fileAccess` stopped being its twin, and that is the useful half.** P4
  gated the import sweep on it and then had to move the control out of the
  settings surface's *Recorded for later* group and rewrite its three labels,
  because the capability had quietly widened to *may direct the server to read
  paths outside their own directory* ([10 §4.2.2](../10-ui-surfaces.md),
  [P4 §7.2](16-p4-implementation.md)). **That is this phase's §1.4 rehearsed on
  a smaller subject**: a capability either has an enforcer or it is not shipped,
  and the moment it acquires one, the words in front of the administrator have
  to change in the same commit. P10 inherits a worked example rather than a
  principle.
- **The notification vocabulary does not exist yet** — no router, no classes, no
  producers. `04 §3.4`'s `{ key, params }` summaries are a design, and §1.4's
  rule (every class has a producer or is not shipped) is therefore still cheap
  to keep. It stops being cheap the moment the first class ships.

**What this phase cannot yet know** is how many notification-worthy things there
will be, because the classes come from P7's hooks and goals, P8's memory and
P9's `artifact.ready` — three phases whose surfaces do not exist. §1.4 is
written to survive that, which is why it is a rule rather than a list.

### 0.1 Re-audited 2026-09-16 at `fee56da`, after P7, P7B, P8 and P9

***The bullets above were written on 2026-08-31 and four phases have shipped
since*** — [P7](23-p7-implementation.md), [P7B](24-p7b-presets-and-prompts.md),
[P8](25-p8-implementation.md) and [P9](26-p9-implementation.md), the last three
merged between 2026-09-15 and 2026-09-16. That makes this the stalest plan in the
corpus, and it is stale in precisely the place it predicted: **the paragraph
directly above says what this phase cannot yet know, and it can now be known.**

**This section is [§5](#5-the-honest-size-and-what-only-the-revisit-can-settle)'s
instruction rather than an initiative of its own.** *"The revisit's cheapest move
is to re-read those three plans' gates for things a person should be told about,
and to do it before writing the router rather than after."* Run early, because
cheap is only true while P10.1 is unwritten.

#### §1.4 re-scored: two of five classes have no producer

[09 §3.5](../09-server-multiuser-deployment.md)'s five, against the tree:

| Class | Producer today |
|---|---|
| `turn.complete` | ✅ `turnFinished` in `state/events.ts` |
| `turn.failed` | ✅ the same |
| `system.notice` | ✅ **in substance** — `pendingRestart` is computed per request, and *no usable connection* is a state `resolveConnections` already reaches. What is missing is the class, not the knowledge |
| `artifact.ready` | ❌ **nothing**. `grep -rn "artifact.ready"` over `packages/` returns zero, and [P9](26-p9-implementation.md) was the phase that was going to build it |
| `turn.awaiting-input` | ❌ **nothing**, and its precondition did not arrive. [26 C5](../26-open-questions.md)'s suspending step does not exist: `turnFinished` accepts `'suspended'` and no step produces it, and `packages/sdk/src/steps.ts` has no suspend verb at all |

***So §1.4's own rule, applied today, ships ~~three~~ **four** classes rather
than five.*** That is a smaller P10.1 and a smaller P10.3 — ~~**three preference
rows, not five**~~ **four preference rows, not five** — and it is the rule doing
exactly what it was written to do. *The rule was also right to be a rule rather
than a list*: a list written on 2026-08-31 would have had five rows and four
phases of drift.

***Corrected 2026-09-16 at [P10.1], and the correction is this section's own
argument arriving one stage later.*** The scoring above counted producers **that
existed when it was run**, and the row below then moved `artifact.ready`'s
producer into P10.1 — so the count was true for about two hundred lines and false
by the time the stage it was scoping had been built. Four classes ship, four
preference rows are owed, and the rule is unchanged: *every class either has a
producer or is not shipped*, and `artifact.ready` now has one.

#### `artifact.ready` is P11's row 20 in the other direction

**[P9 §1.5](26-p9-implementation.md) is unusually specific about what it owed
this phase**, and it is worth quoting because the specificity is what makes the
gap legible: the event *"carries its class, its target user resolved
**server-side**, `actionable: false`, a renderable summary as `{ key, params }`
rather than English prose, and a dedupe key"*, and — the sentence that matters —
***"Getting the schema right is the retrofit risk; the delivery is additive."***

**P9 shipped and emitted none of it.** [P9.2](26-p9-implementation.md) built a
whole-record `rendition` SSE frame and argued **against** a `ProgressEvent` in
terms this section has no quarrel with: the `event` table foreign-keys to
`job(id)` and `resolveJobs` walks forward from the cursor's anchor, so a
rendition event would need a `job` row it must not have, and making one would
have put a picture inside the turn-progress machinery it was built to stay out
of. *The structural argument is correct. The obligation is undischarged.*

***Which leaves each document pointing at the other*** — §1.4 here says the
producer arrives at P9; P9 §1.5 says the router arrives at P10 — and that is the
shape [P11 §0.2](28-p11-implementation.md)'s row 20 and
[manual testing §10.1](05-manual-testing.md) are both about. **The difference,
and it is the whole reason this is a correction rather than a finding: both ends
are still live.** P9 is merged and open; P10 is unbuilt. So this resolves rather
than dangles — **P10.1 takes the producer with the router** — and the resolution
is cheap, because a `Rendition` already carries the purpose, the turn, the
session, the state and the error a `{ key, params }` summary needs, and
`stream/bus.ts` already fans out per session. *What P9 could not do was choose a
transport; what it did not do was emit a class. Those are separable, and the
second one is a morning.*

#### And the reverse problem §5 warns about has exactly one instance

§5 says the rule *"does nothing about the reverse problem — P7, P8 and P9 each
producing something notification-worthy and no class existing for it."* Read
against all three, there is **one**, and P9 created it: **a rendition that
failed.**

[09 §3.5](../09-server-multiuser-deployment.md) defines `artifact.ready` as
*"an async artefact attached to a turn has **completed**"*. A failure is not a
completion — and P9 ships `RenditionError` with five values, one of which is
`interrupted`, which exists *because a server restarted mid-job*. So somebody who
closes the tab with a picture pending has no way to learn it will never arrive;
the retry button is on a placeholder they have to go and look at.

**A decision for P10.1, named here so the router is not written before it is
taken:** widen the class to *settled* and put the outcome in the params, or add
a sibling. *The first is likelier right* — [09 §3.5](../09-server-multiuser-deployment.md)
chose the name `artifact.ready` over `rendition-ready` precisely so a second
instance would not require renaming it, and the same instinct argues against a
second class for the same artefact in a different state.

**Nothing from P7 or P8 joins it.** A hook firing and a goal concluding are story
events inside a turn the person is watching; P8's manual capture is synchronous
and user-initiated. Both are correctly out, and saying so is the half of this
check that stops it being re-run.

#### Two halves discharged, and both by a phase that was not P10

- **P10.5 is down to the §13 source link** — and [P6A](19-p6a-alpha-1.md) left a
  **marked slot** for it rather than a gap: `about/BuildFooter.tsx` says *"The
  AGPL §13 source link, when publication brings it ([09 §7]), goes here"* and
  `about/AboutBuild.tsx` names it too. The version and commit have been embedded
  and shown since alpha.2, which that stage already records.
- **P10.3's *your connections* is half built.** `PUT /api/me/bindings` landed at
  [P7.3](23-p7-implementation.md) — `providers/bindings.ts` dates it 2026-09-12 —
  so the role-bindings bullet of [10 §15.1](../10-ui-surfaces.md) is done. **The
  personal connection list is not**: `/me/` serves `password`, `prefs`, `roles`
  and `bindings`, and nothing else. So what is left is one of the two halves this
  stage's own paragraph lists, which is worth knowing before it is sized.

#### Three of the four unsurfaced config keys are this phase's

[P11 §0.2](28-p11-implementation.md) found `config.ts`'s `CONFIG_TIERS` marks a
key **`'unread'`** when nothing consumes it, and `config.test.ts` fails when a key
is missing from the table. **Three of the four are P10's**, which is a sharper
statement of [§3](#3-verification--the-p10-exit-gate)'s *"this phase is the
line's last large debtor"* than the prose had:

- `updates.checkEnabled` and `updates.channel` — **§1.7's *ships dark*, made
  observable.** That section poses a choice between moving the update check here
  and shipping a surface that reads a source that is always *unknown*. The
  settings for it already shipped, ahead of any producer, which is the second
  option happening by default rather than by decision. *It strengthens §1.7's
  own lean* — move the check — because the alternative is already partly built
  and is exactly what that section calls *"a panel that cannot be tested by
  looking at it"*.
- `limits.extensionStorageQuotaMb` — §1.5's third artefact. The capability
  (`enableExtensions`, four phases gating nothing), the quota, and the panel are
  three pieces of a subsystem with **no installer**, which is that section's fork
  restated in inventory.

*The fourth is P11.7's `trash.retentionDays`*, so this instrument says the same
thing §3 does: the unsurfaced remainder is mostly here.

#### Unchanged, checked so nobody re-checks

**§1.5 holds exactly as written.** `auth/accounts.ts`'s docstring still reads
*"`enableExtensions` still gates nothing"*, and there is still no
`packages/server/src/extensions/`. The fork — build installation, or defer the
panel with an owner — is untouched and is still this phase's to settle.

**§1.8's system-library bullet is still open**, four phases and two audits later.
[P11 §0.1](28-p11-implementation.md)'s negative half recorded it as adopted into
P10.3; nothing has closed it. §5's third bullet calls *a defect with no owner at
the revisit one that ships*, and it now has a date attached to how long it has
been sitting.

**mDNS is unbuilt** — no `mdns`, no `bonjour`, no `storyengine.local` anywhere in
the server. P10.0 is what it says it is.

#### What this section does not do

- **It does not decide §1.5's fork or close §1.8's bullet.** Both are named as
  the revisit's, and a re-audit that quietly decided them would be doing the
  thing §1.8 exists to prevent — a decision made by accident rather than in the
  plan.
- **It does not write the class list.** §1.4's rule produces it; this establishes
  what the rule currently answers, which is what §5 asked for and no more.
- **It does not re-open P9.** P9.2's transport decision stands; what moves is a
  producer P9 never wrote, into the phase that was always going to route it.

---

## 1. Decisions this plan has to make

### 1.1 The setup token: the check, not the print

[09 §5.1](../09-server-multiuser-deployment.md) records this precisely, and the
record is the decision. P1 printed a freshly generated token on every
non-loopback boot and stored it nowhere, so nothing ever checked it — security
theatre in the one place theatre is worst, because an operator who sees a token
printed reasonably concludes something is enforcing it. **P2.0 removed the print
rather than implementing the check**, and homed the check here beside the
container inversion that is the reason it exists.

So the obligation is specific: a stored token, a check on the two auth routes
and the setup form, and the console as its only channel. Until an image ships,
nothing binds non-loopback without someone typing a bind address — which is what
has been carrying the safety in the meantime, and what stops carrying it in this
phase.

**~~this phase~~ — [P6A](19-p6a-alpha-1.md) built it, and this section is why.**
The sentence above states the trigger as *until an image ships*, which is a
condition rather than a date; P6A ships the image, so the condition fired there.
Nothing about the decision changed — a stored token, checked, on the console —
and the framing this section exists for, **the check and not the print**, is what
P6A implemented. Kept rather than deleted because it is the argument, and because
the phase that inherited it should be able to read why.

**Its twin came with it.** The cookie `secure`/`trustProxy` hardening deferred at
[P2 §2.11](08-p2-implementation.md) rests on the identical premise — the loopback
default — so it expired at the same instant and shipped in the same stage
([P6A §1.4](19-p6a-alpha-1.md)). What is left for this phase is what always was:
mDNS, and the surfaces below.

### 1.2 The container inverts the bind default, and that is not a hidden build flag

[09 §5.3](../09-server-multiuser-deployment.md): `127.0.0.1` inside a container
is the *container's* loopback, so an image shipping
[§5.1](../09-server-multiuser-deployment.md)'s default would appear completely
dead on first run. The image binds `0.0.0.0`, the port mapping becomes the user's
explicit act, and §1.1's token covers the rest.

**It must be one documented environment variable rather than a build
difference**, so a bare-metal user can opt into the same behaviour and a
container user can tighten it. A hidden difference between artifacts is a
support burden shaped like a security feature.

**Built at [P6A](19-p6a-alpha-1.md), and this rule is what shaped it.** The
finding that made it expensive rather than trivial belongs here, because it is
this section's own constraint that produced it: the server read **exactly one
environment variable in the entire codebase**, and it was dev-only, so *one
documented environment variable* meant building the environment layer that had
never existed rather than reading a value that had. The baked-build shortcut this
paragraph forbids was the only thing the code could otherwise have done — which
is the rule earning its keep, at the cost of the largest single piece of
construction in that phase.

### 1.3 The router is server-side, and 1.0 has no presence signal

[09 §3.1](../09-server-multiuser-deployment.md) is unambiguous about the part
that must not be got wrong: **if the client decides what to notify about,
notifications only work while a client is connected**, which fails the case that
motivated the feature. The server knows who should be told and through which
channel; the client renders the in-app part.

The wrinkle this phase inherits: the routing signal the design names — per-user
presence, Active/Idle/DND/Invisible — **arrives with Messages, which is now
unscheduled** ([25 §3.4](../25-roadmap.md)). So 1.0
routes on what it has: connection state, and whether the connected client is
viewing the session in question. Write it as a presence *input* with one
implementation rather than as a connection check, so real presence substitutes
rather than rewrites whenever it lands. **That is now an open-ended wait rather
than a one-release one**, which makes the substitutable shape more important, not
less — [work plan §0.3](01-work-plan.md) records the cost of a seam with no date.

### 1.4 Every class either has a producer or is not shipped

[09 §3.5](../09-server-multiuser-deployment.md) lists five 1.0 classes.
`turn.complete`, `turn.failed` and `system.notice` have producers today;
~~`artifact.ready` gets one at [P9](26-p9-implementation.md)~~;
`turn.awaiting-input` has one only if [26 C5](../26-open-questions.md)'s
suspending step exists, which [P3 §1.6](15-p3-implementation.md) notes arrives
early in a different shape — *park, publish, resume-on-intent* — and warns that
the obvious name is already taken, since `Turn.status: 'suspended'` means a turn
that will resume.

**Decide per class, and say so in the preference rows.** A preference row for a
class nothing emits is [work plan §2.3](01-work-plan.md)'s failure inverted: a surface
for configuration that has no producer.

***Scored 2026-09-16 (§0.1), and the rule answers ~~three~~ **four** rather than
five.*** *(The strikethrough is [P10.1]'s, same day: the scoring ran before this
phase agreed to build `artifact.ready`'s producer, and building it is what made
the fourth class shippable. §0.1 carries the full correction.)*

- **`artifact.ready` did not get a producer at P9**, and the strikethrough above
  is the correction rather than the finding. [P9 §1.5](26-p9-implementation.md)
  specified the event in full and called its schema *"the retrofit risk"*;
  [P9.2](26-p9-implementation.md) then built a whole-record `rendition` SSE frame
  and argued against a `ProgressEvent` — correctly, because the `event` table
  foreign-keys to `job(id)`. **So the producer is this phase's too**, and P10.1
  gains it. It is small: a `Rendition` already carries the purpose, turn,
  session, state and error a `{ key, params }` summary needs.
- **`turn.awaiting-input`'s condition resolved to *no*.** Four phases later
  nothing suspends — no step in `packages/sdk/src/steps.ts` can, and
  `turnFinished` accepts `'suspended'` with nobody passing it. **The class is
  not shipped**, which is this section's rule rather than an exception to it, and
  it comes back with [26 C5](../26-open-questions.md).
- **And one thing the five do not cover**: a rendition that **failed**. The class
  is defined as *completed*, and P9 ships an `interrupted` error because a server
  can restart mid-job. §0.1 argues for widening `artifact.ready` to *settled*
  with the outcome in the params rather than adding a sibling — the same instinct
  that named it `artifact.ready` instead of `rendition-ready`. **Decide it before
  the router, not after.**

### 1.5 The extensions panel needs installation, and nothing installs

[10 §15.5](../10-ui-surfaces.md) names the blocker plainly. The manifest and the
lifecycle are specified ([23 §6–§7](../23-extensions.md)) and
[P7](23-p7-implementation.md) builds the boundary they run behind, but no
document owns *acquiring and enabling an extension on an install*.

**To decide at the revisit:** whether P10 builds installation — and therefore
the panel — or the panel stays deferred with its blocker named and an owner
attached. Building the panel over a stub is the one option to refuse: a screen
that lists nothing and installs nothing is exactly the false front
[10 §15.5](../10-ui-surfaces.md) uses capability granting to illustrate.

***Confirmed, not resolved, 2026-09-14.*** [P11 §0.1](28-p11-implementation.md)'s
documentation sweep looked for 1.0 commitments no phase owns and found this one
already named here, with one detail worth adding: **the account capability
exists and has never gated anything.** `enableExtensions` has shipped on
`Capabilities` since P2A, and `auth/accounts.ts` says so in its own docstring —
*"`enableExtensions` still gates nothing, and the settings surface says so rather
than rendering it as though it were live: extensions appear in no phase list at
all."* That is the honest handling of a capability with no subject, and it is
also **a dangling owner written into the code rather than into a document** — it
has sat there for four phases saying *no phase list*, which is true and is
nobody's to fix. The fork above is unchanged and stays this phase's to settle;
what the sweep adds is that the field waiting on it is already in every
account.

***Confirmed again 2026-09-16 (§0.1), with a third artefact.*** Nothing moved
across four phases: the docstring still says it, and there is still no
`packages/server/src/extensions/`. What the re-audit adds is that
**`limits.extensionStorageQuotaMb` is marked `'unread'`** in `CONFIG_TIERS` — so
the capability, the quota **and** the panel are three pieces of a subsystem with
no installer, and the fork below now has an inventory rather than a single
example.

*And note the standing `[OPEN]` it drags along*
([09 §6.4](../09-server-multiuser-deployment.md)): whether install and uninstall
can avoid a full restart. In-process ESM makes true unloading hard, so
*restart required* is the honest 1.0 answer — which puts §1.6 on the critical
path for the panel rather than beside it.

### 1.6 *Restart now* is honest or it is a trap

[09 §6.4](../09-server-multiuser-deployment.md), and both halves are the
decision. **It only works under a supervisor** — Docker with
`restart: unless-stopped`, systemd, unraid — and under a bare `node server.js`
the admin who clicked it has no server and possibly no shell. So detect
supervision and **disable the control with an explanation** where it is absent.
And **drain**: refuse new turns, wait for in-flight ones within a timeout, then
exit, with the confirmation naming what it is about to interrupt — *"2 other
users have active sessions."*

### 1.7 Connectivity state ships with its producer, or it ships dark

[10 §15.5](../10-ui-surfaces.md) lists connectivity state as remaining at P10 and
names its producer as [P11](28-p11-implementation.md)'s update check;
[P2B §6](10-p2b-provider-configuration.md) records the same dependency from the
other side. **Two phases, one signal, in the wrong order.**

The revisit has to pick one: move the update check into P10 (it is small, and
[09 §6.5](../09-server-multiuser-deployment.md) already argues the signal is free
because the request is being made anyway), or ship the surface reading a source
that is always *unknown* and let P11 light it up. **Lean: move the check.** The
alternative ships a panel that cannot be tested by looking at it, which is the
class of thing this repository has already been burned by twice.

***The lean is stronger than it was, because the second option has started
happening by itself*** — 2026-09-16, §0.1. `config.ts`'s `CONFIG_TIERS` marks
**`updates.checkEnabled` and `updates.channel` as `'unread'`**, the tier that
means *nothing consumes this*. The settings for the check shipped ahead of the
check. That is not *shipping dark* as a decision; it is **shipping dark by
default**, which is the version this section exists to prevent — and it is now
mechanically visible rather than predicted, because `config.test.ts` fails when a
key is missing from that table.

### 1.8 §15.3's system-library bullet has no owner, and that is a defect to close

[10 §15.5](../10-ui-surfaces.md) says so in its own voice: the scope is
never-writable, [09 §4.3](../09-server-multiuser-deployment.md) withholds admin
write at 1.0 deliberately, and [10 §15.4](../10-ui-surfaces.md) says a panel with
no action does not belong. **Either the bullet goes or 1.0's position on admin
write changes**, and this phase is where it stops sitting there looking
scheduled. It is a documentation edit, not a build, and it belongs in the plan
so it does not get built by accident.

***Still open on 2026-09-16, and now with a duration attached*** (§0.1). Two
audits have passed over it — [P11 §0.1](28-p11-implementation.md)'s negative half
recorded it as adopted into P10.3, which is a routing rather than a closure — and
four phases have shipped. §5's third bullet says *a defect with no owner at the
revisit is one that ships*; this one has an owner and is still sitting there,
which is the milder failure and the same outcome. **It costs a paragraph and it
has cost two sweeps.**

### 1.9 The gallery's obligations are enumerated; take them as written

[12 §8](../12-account-gallery.md) lists what the build owes — `auth.loginScreen`
end to end with its schema entry, tier row, applier and derived select;
`hiddenFromGallery` through `toPublic`, `updateSelf` and `update` and both
settings toggles; `GET /api/auth/state` growing `loginScreen`; the route family
including **the server's first upload route** with its multipart, sniffing and
size bounds; the client's first tile grid and the generated tile. It also names
the three tests that keep it honest. That section was written to be read at the
build rather than re-derived, and the only thing this plan adds is: the
type-to-filter escalation is [polish §7](06-polish.md)'s, is blocked on the
gallery existing, and should be built as the **one** text affordance that
subsumes *sign in by name* rather than as a second box beside it.

---

## 2. Stages

Reachability first — the phase's spine — then the things that make a second
person's experience correct, then arrival.

### P10.0 — Reachable and safe: ~~bind, container, token,~~ mDNS

**Mostly built at [P6A](19-p6a-alpha-1.md), and this stage is what is left.**
Struck rather than rewritten, because what this stage *was* is the clearest
statement of what that phase took: §1.1's stored-and-checked token, §1.2's single
documented environment variable and the image that uses it, first-run setup
gating every route until an admin exists verified from a non-loopback bind, and
the cookie `secure`/`trustProxy` hardening whose deferral premise the container
removes. All of it landed at P6A.0 through P6A.2, for the reason §1.1 gives:
those deferrals were scheduled against the image, and P6A is where the image
shipped.

**What remains here is mDNS** — advertising `storyengine.local` once bound beyond
loopback — plus verifying the whole first-run path again against the artifact
this phase inherits rather than one it built.

*One question for that re-verification, from Alpha 1's first install
(2026-09-07, [P6A §3](19-p6a-alpha-1.md) step 11):* Docker creates a missing
bind-mount source as root, the image runs as uid 1000, and the first start on
unraid died on `mkdir /data/state`. Alpha 1 answers with a one-time `chown` on
the host, said in the template and refused in one line by the server. The
convention unraid users expect is the other answer — a container that starts
as root, takes ownership of its volume and drops to `PUID`/`PGID` — and it
costs the non-root user P6A.4 chose. Which of the two this phase ships is its
to decide against a second install, not the first.

~~*Ends at:* `docker run`, a token in `docker logs`, an admin created, a turn
taken — from a machine that is not the host.~~ That gate became
[P6A §3](19-p6a-alpha-1.md)'s steps 3 through 7 — **and it has not been met.**
This paragraph said *met* before the phase ran; corrected 2026-09-05 at P6A's
close, which shipped every file the image needs and built no image, because
there was no daemon on the machine that wrote it. It is walked when Alpha 1 is
cut, by a person, and this stage's re-verification then runs against a build
that has already passed it once. *Ends at:* somebody on the LAN reaching the
install by name rather than by address.

**And the stage is now much smaller than its neighbours**, which changes §5's
reading of this phase: the *"two phases wearing one number"* argument was about
P10.0's deployment work versus everything after it, and P10.0 is no longer the
half where the risk lives. That paragraph is corrected in place below.

#### Done — 2026-09-17

***A responder rather than a dependency, and the argument is scope rather than
pride.*** An mDNS library brings service discovery, browsing, TXT and SRV
records, arbitration across a record set, and a cache. What [09 §5.1] asks for is
one sentence — *"advertise over mDNS as `storyengine.local` once bound beyond
loopback, so nobody types an IP"* — which is **one host, one A record, one
name**, and that is a hundred lines of `DataView` against a format fixed in 1987.
*The other half of the argument is the supply chain*: [20 §10] makes the
dependency licence manifest a shipped artefact, and a package that opens a
multicast socket and parses attacker-shaped bytes off the local network is
exactly the kind worth not having.

***It probes before it claims, which is what makes it well-behaved rather than
merely working*** (RFC 6762 §8.1). Two installs in one household both answering
for `storyengine.local` is a race whose winner nobody can identify. Three
queries, 250 ms apart; anything that answers means the name is taken, and this
install advertises nothing and says so with the name it tried. **And it says
goodbye** — a TTL-zero answer on shutdown, so a restart is a restart rather than
two minutes of a household reaching a dead address.

***One config key doing two jobs, and both are things a person has an opinion
about.*** `server.mdnsName` is **the name**, because two installs collide and
`attic` and `study` is a real answer to a real problem, and **off**, spelled as
the empty string. *Advertising is conditional on the bind regardless* — §5.1's
own condition, and the same `isLoopbackHost` the setup token uses, because two
spellings of *is this exposed* is a security bug rather than an inconsistency.

***Every failure is a log line and a running server.*** macOS runs
`mDNSResponder` and most Linux desktops run Avahi, both of which hold port 5353;
a container under the default bridge often has no multicast route to the LAN at
all. Each of those is *no `.local` name*, none is *no server*, and the first is
arguably a better outcome than what this would have done — that machine is
already reachable by its own hostname.

**What this stage cannot end at.** *Ends at* above is *somebody on the LAN
reaching the install by name rather than by address*, which needs a second
machine on a real network. The **bytes** that would reach them are asserted
exactly (`packet.test.ts` is pure: cache-flush bit, unicast bit, compression
pointers, pointer loops, every malformed shape answering `null`); what is between
the bytes and the neighbour is a socket, and a socket is a person with two
machines. **Recorded as owed to the gate rather than claimed**, alongside the
container first-run question this stage was also asked to settle against a second
install — which likewise has not happened, and is §3's to carry rather than this
block's to assert.

### P10.1 — The notification router

§1.3's server-side routing with a substitutable presence input; §1.4's
producer-by-producer class decision; the dedupe key and coalescing window from
[09 §3.4](../09-server-multiuser-deployment.md) — *five characters replying in a
group chat is one notification, not five*, trivial to design in and unpleasant to
add once producers exist; per-user scoping by ownership, which
[09 §4.3](../09-server-multiuser-deployment.md) already answers.

***The class decision is decidable now rather than at the stage*** — §0.1, and
§5 asked for exactly this. ~~**Three classes ship**: `turn.complete`,
`turn.failed` and `system.notice`.~~ **Four**, once this stage builds
`artifact.ready`'s producer, which the paragraph below commits it to.
`turn.awaiting-input` has no suspending step after four more phases and comes
back with [26 C5](../26-open-questions.md).

***And this stage gains a producer it was not going to have.***
`artifact.ready` was [P9](26-p9-implementation.md)'s and P9 did not emit it — for
a structural reason §0.1 accepts — so **the producer comes with the router**.
That is the one piece of construction this stage did not expect, and it is small:
a `Rendition` carries the purpose, the turn, the session, the state and the error
that a `{ key, params }` summary needs, and `stream/bus.ts` already fans out per
session. What it is **not** is a second transport — P9's `rendition` SSE frame is
how the *picture* reaches an open page; this is how a *person* is told, and the
two answer different questions.

**Decide the failure case before writing the table, not after** (§0.1): a
rendition that failed is not *ready*, and `interrupted` exists because a server
can restart mid-job. The lean is to widen the class to *settled* with the outcome
in the params.

#### Done — 2026-09-16

***The lean was taken, and the name was not.*** A failed picture is
`artifact.ready` with `outcome: 'failed'` in the params, not a fifth class and
not a rename — which is [09 §3.5](../09-server-multiuser-deployment.md)'s own
reason for choosing `artifact.ready` over `rendition-ready`, *"precisely so its
second instance would not require renaming it"*, applied to the second instance
that actually arrived. **The callback into the worker is called `settled` and the
class it feeds is called `artifact.ready`**, which is the distinction written
into the two names rather than into a comment.

***A test found a real defect in the first hour, and it is the one worth
recording.*** `state/notifications.ts` resolved `actionable` from a per-class
table, with `artifact.ready` marked `false` — [09 §3.5]'s own column — and the
router overriding it for the failed arm. **The override could not reach the
store**: the table won, and a failed picture landed with `actionable: false`.
`router.test.ts` caught it on its first run. The fix is in the table rather than
as a special case in `notify`, because the table was making a claim it does not
have the information to make: what it actually encodes is **who decides**, and
two of the four classes have an answer that is the occasion's rather than the
class's. *This is §1.4's "decide per class" read one level down — the decision
is per class, and for two of them the decision is `varies`.*

***The presence interface got its implementation somewhere §1.3 did not
predict, because the obvious place could not work.*** The first draft put
`Presence` over `TurnStream`'s subscriber map, which is `sessionId ->
Set<Listener>` — and **a listener carries no account**, deliberately: [09 §4.3]
withholds sharing at 1.0, so anyone who can read a session stream is its owner
and that bus has never needed to know who. So presence and delivery live together
in `notifications/bus.ts`, which is the same registry read two ways: *connected*
is holding a notification stream, and that stream is where a notification is
delivered. **Viewing is counted rather than flagged** — two tabs on one session
are two attachments, and a flag makes the second close wrong in a way that only
shows for somebody who had two tabs open.

**Three producers, at the three places that know**: the runner after
`finaliseTurn` (both its paths, including the unstartable one, which is the path
that most needs it because it leaves no prose at all); the rendition worker at
its two settle points; and the settings save, where `pendingRestart` already
computes the keys. ***And the runner tracks **why** it stopped***, because
`aborted` is set by two different events — a step declaring `failure: 'abort'`
and a person pressing **Stop** — and only one of them is news. A toast saying
*your turn failed* about a turn somebody just cancelled is the app reporting
their own act back to them as a problem.

***What is deliberately not built here is the client***, which is P10.2's whole
subject. The three routes are in `route-callers.test.ts`'s `OWED` map with that
stage named, as three lines rather than one, because P10.2 pays them separately:
the badge and the list come from the two JSON routes and the toast needs the
stream.

**Also landed, because a record's shape is not finally said in a workplan:**
[22 §8](../22-internal-contracts.md) now carries `Notification`, which §5.1 above
has been promising a durable home since P2.3 and which no document held.

### P10.2 — The two delivery channels 1.0 gets

In-app — sound, toast, unread badge, document title — which covers the
completion-sound case entirely and needs no infrastructure; and the browser
Notification API, which works when the tab is backgrounded. Together they cover
everything 1.0 generates, because without Messages nothing needs to reach you
when no browser is open.

*And the secure-context caveat is documentation, not code*
([09 §3.6](../09-server-multiuser-deployment.md)): plain LAN HTTP is not a secure
context, and channel 2's availability therefore depends on how the install is
reached. Say it where someone will read it.

#### Done — 2026-09-16

***"Documentation, not code" was half right, and the half it missed is the one
§3.6 spends a paragraph on.*** The caveat is in
[`docs/deploy.md`](../../deploy.md) with the three-row table, which is the
documentation this line asked for. But §3.6's own first obligation is *"say so
where the user chooses… a greyed toggle with no reason is the worst version of
this"* — and that is code: `browser.ts` distinguishes **four** states rather than
a boolean, because *unsupported*, *insecure context*, *not yet asked* and
*refused* need four different sentences and only one of them is a control. **The
order of the checks carries the finding**: a browser on plain HTTP reports
`permission: 'default'`, which reads as askable and then refuses the prompt, so
`isSecureContext` is read first or the surface promises something it cannot do.

***One hook for four channels, because they are four renderings of one fact.***
Sound, toast, badge and title split across four components would each hold their
own copy of *what has arrived*, and the way that fails is a badge showing two
while the title shows three. So `useNotifications` is mounted once, in the shell,
and the query cache is the state the stream writes into — `usePatchPrefs`' shape
on a second subject.

***The subtle half is that **arriving** and **being told** are different
things.*** A notification on the stream's **snapshot** is recorded as announced
without announcing it: what is on a snapshot was already true before this tab
attached, and on a flaky LAN the stream reattaches every three seconds — so
without that, one finished turn becomes a chime every three seconds until the
network settles, after which a person reasonably concludes notifications are
broken. **But a fold is news again, once**: *your picture is ready* and *three
pictures are ready* are different facts, so the memory is a count per id rather
than a set of ids, and [09 §3.4]'s coalescing would be pointless if the second
one were silent.

*Corrected 2026-09-28.* ~~what is on a snapshot was already true before this tab
attached~~ — of the first snapshot, and not of a reattach's. A row raised in the
seconds the stream was down reaches the tab only inside the reattach's snapshot,
so it was recorded as announced and never announced: no chime for the turn a
person left the room waiting to hear, and no toast for the notice a restore's
restart raises before it listens. The flaky-LAN case never needed the silence —
the per-row fold count already refuses a repeat. So a later snapshot announces
the newest row it had not said yet, if it is unread and inside the coalescing
window of the server's clock, which the snapshot now carries as `at`; a laptop
waking hours later still does not chime for what finished while it slept.

***The transport was extracted rather than copied.*** `play/stream.ts` was
written when the session stream was the only one; [09 §3.1] describes two, and
the second has the same retry problem at a different address. So the `fetch`
loop, the refusal arms and the backpressure moved to `sse/connect.ts`, and
`openTurnStream` became a twenty-line caller of it — **with its own test file
unchanged**, which is what makes the move a refactor rather than a rewrite. On
the server the same seam appears as `SseWriter.emit`, beside the typed `send`:
the session stream's frame union stays closed, and a per-account stream's frames
are not in it.

***The sound is synthesised.*** Two oscillators and an envelope, because an
audio asset would be a binary in a text repository, would need a licence line
([20 §10](../20-tech-stack.md)), and would have to be fetched over a LAN from the
server that is busy making the turn it announces.

***And a mechanical instrument came with it***, which is the part that outlives
the stage: `labels.test.ts` greps the server's `NotificationClass` union against
the client's sentence table, both directions. It is
`library/note-labels.test.ts` on a second subject and it exists for that file's
reason — that table had drifted by twenty-four keys with nothing saying so,
because the fallback renders an unlabelled key as itself, which is right for a
version skew and silent for a build shipped against itself.

**The three routes [P10.1] left in `OWED` are paid**, which is one stage
outstanding — the shortest that map has carried a debt.

*A test race this stage caused and fixed, worth the line because it is the
ordering [P10.1] chose.* `#announce` runs **after** `finaliseTurn`, which is what
marks a job committed — so a test that read the collector the instant the turn
was on disk passed alone and failed under the full suite. The turn is
deliberately not delayed by the notification; the test waits instead, and the
one that asserts an *absence* buys its window with a second turn rather than with
a sleep, which is `runner.test.ts`'s standing rule.

### P10.3 — The remainder of [10 §15](../10-ui-surfaces.md)

The notification preference rows, one per shipped class — **three of them, not
five**, per §1.4's re-scoring (§0.1); §1.6's *Restart now* with supervisor
detection and drain; §1.7's connectivity state, **whose two settings already
ship unread**, so this row either lights them or removes them; §1.5's
extensions panel or its named deferral; §1.8's bullet closed one way or the
other.

**And [10 §15.1](../10-ui-surfaces.md)'s *your connections*** — personal
connections, personal bindings and the personal-versus-system view — which
[P2B §2.7](10-p2b-provider-configuration.md) sent to *"the phase after, or at
P10 with the rest of §15.1"*, [P6B §5](20-p6b-playable.md) calls P10's, and
this list never carried until 2026-09-11. The enforcement half landed at P2A
and the fallback display at P2B, so what is left is ~~the writer for
`users/<handle>/bindings.json`, the second column of the role table, and~~ a
user's own connection list — the same form the admin has, scoped to the path
that is the owner. ~~*The role-binding editor itself is P7.3's on branch `p7`;
this is the per-user half of it.*~~

***Half of this landed at [P7.3](23-p7-implementation.md) and the strikethroughs
are it*** — 2026-09-16, §0.1. `PUT /api/me/bindings` shipped on 2026-09-12, which
`providers/bindings.ts` dates in its own docstring and calls
[10 §15.1](../10-ui-surfaces.md)'s *role bindings* bullet. **What is left is the
personal connection list alone**: `/me/` serves `password`, `prefs`, `roles` and
`bindings`, and nothing else. *The sequencing that section describes is why* —
a personal surface predating the `privateConnections` check would have been
[09 §4.5](../09-server-multiuser-deployment.md)'s *"trivial bypass, wearing a
UI"*, and the check has been real since P3.

#### Done — 2026-09-16, in two commits

***Six bullets, and the interesting half is that four of them were waiting on a
blocker rather than on a decision.*** What this stage mostly did was build
blockers.

**The preference rows: four, and the list is mechanical.** §1.4's rule is about
**surfaces** — a row for a class nothing emits is
[work plan §2.3](01-work-plan.md)'s failure inverted — so the rows come from
`NOTIFYING_CLASSES`, which `prefs.test.ts` checks against the server's own union
in both directions. A fifth class cannot arrive with no row, and a row cannot
outlive its class.

***And [10 §9](../10-ui-surfaces.md) asked for three things this plan did not
mention, all of which were right.*** **Distinct sounds per class** — *"tellable
apart from another room, which is the entire point of having a sound rather than
a toast"* — so the contour carries it, rising for finished and falling for
failed, because a change of waveform does not survive a laptop speaker two rooms
away. **A global mute and a start-muted preference**, Marinara's, which is for a
shared room and fails exactly once if you have to remember it. And ***prime the
audio on first interaction***, which that section calls *"a well-known trap that
presents as 'sounds work sometimes'"* — the failure is not silence, it is a
person who clicked something hearing it and a person who opened a tab and waited
not, which is unreportable.

***A tension worth recording rather than resolving.*** [10 §9] says *"suppress
what is already visible… the sound is still wanted; the toast is not"*, and
[P10.1]'s router suppresses the **whole notification** for a session you are
watching. Both are right about their own subject: §9's case is a *message*
arriving in a chat you are reading, where the sound tells you across the room;
[09 §3.1] and this phase's §1.3 put routing server-side, where the only honest
unit is the notification. **Messages is unscheduled** ([25 §3.4]), so nothing at
1.0 produces §9's case — and when it does, the split it needs is a per-channel
decision in the router rather than a client-side override. Recorded here because
the next person to read §9 will notice the same thing.

**Your connections.** [20 §5.1]'s *"anyone who wants their own key overrides a
role without the admin's involvement"*, which until now meant writing a JSON
file by hand into a directory the UI never mentioned.
`routes/connections.ts` grew a second registrar rather than a second module and
the client grew a second panel over one form, for the same reason both times:
what the scopes share is a record shape, a stale check and an error vocabulary,
so the failure to design against was never a second copy — it was one surface
quietly reading the other's directory. ***The personal routes are the first
entries on `connections.test.ts`'s exemption table that carry a key***, so the
old argument (*this route handles ids, never credentials*) was unavailable and a
third probe kind was needed: the capability.

***§1.6: *Restart now* is built, and the detection is mostly *ask*.*** That is
the finding rather than a shortcut — **nothing inside a container can see its own
restart policy**, and every heuristic people reach for (PID 1, `/.dockerenv`, a
cgroup path) detects *being in a container*, which is a different question whose
false positive is precisely §6.4's trap: a `docker run` with no policy. So
`SE_SUPERVISED` is set beside the `restart:` line in `compose.yaml` and in the
unraid template — §1.2's *one documented environment variable* on a second
subject — and systemd's own `INVOCATION_ID` is the one honest detection.
**Default-deny**, because a wrong *no* costs one manual restart and a wrong *yes*
costs the server.

*Corrected 2026-09-27* ([09 §6.4](../09-server-multiuser-deployment.md) has the
whole of it). Two of the three wrappers this section counted as supervised were
not: the unraid template had no restart policy, and the unit's
`Restart=on-failure` did not restart the clean exit *Restart now* made. Under
all three the process never exited in the first place, because the admin's own
tab held the listener's close open. And `INVOCATION_ID` was not honest on its
own. It is inherited, and for eighteen CI runs every test server on the GitHub
runner, itself a systemd service, believed it. The stream closer runs in
`preClose`, the restart exits 75, the unraid template sets
`--restart=unless-stopped`, the unit declares `SE_SUPERVISED=1` beside a
`RestartForceExitStatus=75`, and detection asks for `SYSTEMD_EXEC_PID` as well.
`restart.test.ts`'s in-process proof was sound and could not see any of this:
`services.exit` is null under the harness, and `inject()` never listens.

*And "drain" meant writing one*, because `runner.drain()` aborts. The sequence is
**stop accepting** (a 503 with `retry-after` at the submission route, which is
the only door), then `settle()`, then — after thirty seconds — the abort, which
commits what is left as failed turns rather than losing them. `restart.test.ts`
drives a real turn through a slow provider and asserts the exit does not happen
while it runs, which is the claim the whole stage rests on.

***§1.7: the check moved, and the section's own prediction is why.*** Two config
keys had shipped ahead of it and `CONFIG_TIERS` had been saying `'unread'` about
both for four phases — *"not shipping dark as a decision; shipping dark by
default"*. Both are `'applied'` now.

***What §6.5 did not have to distinguish, and this build does.*** A failed check
is two things: **a transport failure**, where nothing answered, and **an HTTP
answer this build cannot use** — a 404, an empty feed, no release for the
channel. Only the first is a connectivity signal; the second *proves the internet
works*. **That is this project's present state rather than a hypothetical**: the
repository is private and [releases §4](04-repo-and-releases.md) says `latest`
*"names nothing"* until a release is cut, so the default channel's feed answers
404. A check that conflated them would tell every alpha operator their server was
offline. *(Noted 2026-10-04: the repository was decided public on 2026-10-03,
and [releases §0.1a](04-repo-and-releases.md) records the day the switch lands.
Once it is public, with no GitHub Release, the feed answers an empty list
instead, which reads as the same `unknown` with the internet working. The case
outlives the switch, as `updates.ts` now says beside its own copy of this
sentence.)* And §6.5's conditionality is built the way it is written: an all-local
install is told nothing, because *"a fully local setup is a legitimate,
fully-functional deployment and its operator chose it deliberately"*.

**Not built, and named rather than left:** §6.5's *"better use"* — an engine that
says *"this server appears to have no internet access"* instead of surfacing a
raw connection error when a turn fails against a remote provider. It is genuinely
the more valuable half and it belongs where a provider failure becomes a
`StepFailureReason`, which is `turns/calls.ts` rather than a settings surface.
~~**Owed to [P11.3](28-p11-implementation.md)**, whose subject is the error
vocabulary, and the signal it needs now exists.~~ **Owed to
[P11.6](28-p11-implementation.md)** — corrected 2026-09-17, on the re-audit. The
stage number was wrong and the routing was right: P11.3 is *the assistant*, and
the stage whose third clause is *better failures* is **P11.6**, which its own
*Depends on* had already made conditional on this paragraph — *"if P10 takes the
check, this stage is the error messages alone"*. P10 took the check, so that arm
is the live one, and this is the debt that lands in it.

***Paid the same day.*** [P11.6](28-p11-implementation.md) built `remedyFor` in
`packages/shared/src/remedy.ts`, reading exactly the signal this paragraph
argued for, and the two halves of the distinction above became the two arms
`endpoint-silent-offline` and `endpoint-silent-online`. **The conditionality
§6.5 asks for is the assertion the stage is proved by**: a local endpoint is
told nothing about the internet *even when this server knows it has none*.

***§1.5 and §1.8 are closed, which is the part that had cost two sweeps.***
§1.8's system-library bullet is **struck** in [10 §15.3](../10-ui-surfaces.md):
it offered two ways out and nothing in four phases argued for changing 1.0's
position on admin write, so the bullet goes and the argument stays beside it
struck rather than deleted. §1.5's fork is closed by a distinction it was
missing — ***1.0 needs extensions **loaded**, not **installed***. The dice
reference extension the work plan keeps at 1.0 is first-party and ships inside
the image the way a built-in mode does; acquiring one from outside is a
subsystem no 1.0 goal requires, and it is now a row in
[25 §3.2](../25-roadmap.md) rather than an owner-shaped hole. **The three
artefacts that presuppose it all stay** — the capability, the quota key, the
manifest — because each is cheap, specified, and *visibly* inert, which is what
`'unread'` and that docstring are for.

### P10.4 — The account gallery

§1.9, as [12 §8](../12-account-gallery.md) specifies it, including the
unauthenticated listing contract and the three tests. The one judgement this
plan adds: the gallery is **not** self-registration and has no *new account*
tile ([12 §9](../12-account-gallery.md)) — worth restating in the stage because
a grid of accounts is a shape that invites the extra tile.

~~**And Home**, [10 §2.2](../10-ui-surfaces.md) — the arrival screen *after*
sign-in, which [polish §5](06-polish.md) details and nothing scheduled until
2026-09-11; `/` still redirects to the library. The gallery is arrival before
sign-in, and one stage owning both keeps the two from disagreeing about what
arrival is for. Polish §5's scope rule travels with it: nothing computed for
home alone, no endpoint that exists only to populate it, and every element a
link into a surface that does the real work.~~

***Home is not this stage's, reversed by direction 2026-09-14.*** The full
[10 §2.2](../10-ui-surfaces.md) home is **deferred**: not core-alpha work, still
nominally a 1.0 feature, expected immediately before the cut-over to
feature-complete beta, and possibly further out
([polish §5](06-polish.md) carries the wording). A changelog-only prototype
lands at [P7B.9](24-p7b-presets-and-prompts.md) so `/` stops being a redirect
and the wordmark has somewhere to point.

**The argument above for pairing it with the gallery was good and it survives
the reversal**, so it is kept rather than struck out of the reasoning: arrival
before sign-in and arrival after it should not disagree about what arrival is
for. What that now means is a constraint on whoever builds the full home — *it
has to be read against this stage* — rather than a claim about which stage
builds it. Polish §5's scope rule travels with it either way.

#### Done — 2026-09-16

***[12 §8] was written to be read at the build rather than re-derived, and it
was.*** Every obligation it enumerates shipped: the config key end to end with
its tier row, applier and derived select; `hiddenFromGallery` through `toPublic`,
`updateSelf`, `update` and both toggles; `loginScreen` on `/auth/state`; the
route family; the tile grid and the generated tile. The three tests it names are
`gallery.test.ts`'s, under the names that section gives them.

***The upload route was not the server's first, and [12 §5.2] said it would
be.*** P4 built one for the import sweep, and it had already extracted
`readOnePart` — *"before the second copy existed rather than after"*, in its own
words — so two of the three obligations that section names were waiting with a
caller. **What was actually new is the sniffing**, which is this route's own:
`readOnePart` bounds the size and hands over bytes, and believing a filename is
how an HTML document gets stored as `avatar.png` and served back with a type
somebody else chose.

***The generated tile's two inputs are the part worth arguing about, and [12
§5.4] got them right.*** Initials from the **display name**, hue from the
**handle** — so a rename moves your letters and leaves your colour, which is what
lets the tile be how you find yourself in a grid. *The falsifying mutation is
hashing the display name*, and `tile.test.ts` is written against exactly that.
**`oklch` rather than `hsl`**, which the appearance layer already decided for
every other colour in the build: equal lightness numbers look equally light
across hues there and do not in `hsl`, so a tile in `hsl` would be the one
surface whose yellows glare.

***Two mechanical instruments caught things during the build, and both are worth
recording.*** `routes.test.ts`'s own comment predicted the shallow-spread problem
— *"complete today because the section has one key, and it would silently stop
being complete the moment a second joins it"* — and a second key joined it;
**the compiler refused the literal by name**, so the warning was right about the
risk and wrong about the failure mode, and it is corrected in place.
`tailwind-utilities.test.ts` caught `hover:bg-surface-raised`, a token that does
not exist, which is the exact defect that test was written for: an element
silently losing a property, found by somebody looking at the page weeks later.

***And a real defect in [P9]'s own tests, found by load rather than by
reading.*** Six waits of the form
`eventually(() => renditions.every((one) => one.state === 'ready'))` **pass
vacuously over an empty list**, so they wait for nothing whenever the record has
not been written yet — and the next line reads `[0]` off an empty array. It
presented once in a full run as *"the backdrop never landed"* and passed in
isolation every time. *It is the vacuous half of the fire-and-forget design
[P9.2] chose deliberately*: the dispatch is detached, so **no renditions yet** and
**all renditions settled** are the same answer to `every`. Fixed in all three
gate files with the non-empty clause, and named here rather than called a flake.

### P10.5 — About, the source link, and the embedded version

[09 §7](../09-server-multiuser-deployment.md)'s licence obligations that are
actually features: the running version and commit embedded in the build — ~~**no
build embeds one today**, which [09 §6.5](../09-server-multiuser-deployment.md)
names as this phase's to fix~~ embedded at [P6A §1.5](19-p6a-alpha-1.md) and
shown since alpha.2, as the footer on every page and the About block at the top
of Settings ([10 §15.1](../10-ui-surfaces.md)) — and the §13 source link, which
is what is left here. If §1.7 moved the update check here, its badge lands on
that About block rather than in a notification class.

***And the slot for it is already cut*** — 2026-09-16, §0.1.
`about/BuildFooter.tsx` carries the line *"The AGPL §13 source link, when
publication brings it ([09 §7]), goes here"*, and `about/AboutBuild.tsx` names it
too. So this stage is **one link into a marked place**, not a surface — which is
[P6A](19-p6a-alpha-1.md) leaving the phase it deferred to something better than a
gap. *The condition in that comment is the scheduling*: §13 attaches on
publication, which is [P11.9](28-p11-implementation.md)'s audience half, so the
link's **content** depends on a phase after this one even though its **place**
does not.

*Ends at:* the demo.

#### Done — 2026-09-16

***The place was cut and the content was the question, and the answer is that
the **build** carries it.*** [09 §7] names the case that makes a §13 link more
than a constant: *"a link to `main` is not strictly compliant when the operator
is running a patched build — and the patched-build case is exactly the one §13
exists for."* So `BuildInfo` grows a `source` field, written by
`tools/write-build-info.mjs` from the `origin` remote of whatever repository the
build was cut from. **A fork that ships its own image ships its own link**, with
no code change and nothing to remember — which is what a hardcoded constant
could never have done, and it is the whole reason this is three lines in a build
script rather than one in a component.

***And it resolves to a tag rather than a branch.***
[releases §2](04-repo-and-releases.md) keeps tags immutable and release branches
forever *"directly to serve an obligation we already have"*: a branch answers
*where do I fix this?* and a tag answers *what precisely is the user running?*,
and §13 asks the second.

**Three absences that are each the honest answer**, rather than a fallback to
somebody else's repository: no remote, no link; an unidentified build, no link;
a scheme that is not `http(s)`, dropped at the parse. *The last one matters more
than it sounds* — `build-info.json` is a file a hand edit reaches, and this
becomes an anchor's `href` on every page of a signed-in surface.

***The other half of [09 §7] went to the About block, and the split is that
section's own.*** The **offer** must be *"visible to every logged-in user, not
buried in an admin screen"*, which the footer is; the **licence boundary** is a
paragraph somebody reads once, which is what an About block is for. Both halves
in the same words, for every account, because §7 calls saying them plainly *"the
cheapest available defence against the misreading that copyleft is creeping into
people's stories"* — and the person who needs that sentence is whoever wrote a
character, which is everybody.

**Nothing here waits on publication.** §13 attaches on distribution
([releases §0](04-repo-and-releases.md)) and this repository is private, so the
obligation has not fired — but the *mechanism* is what a later phase would
otherwise have to invent under time pressure, and it is cheaper now: a private
build links to a private repository, which is correct and harmless, and the day
the repository is public the link already works. *(Noted 2026-10-04: that day
was decided on 2026-10-03, for this reason among others, and
[releases §0.1a](04-repo-and-releases.md) records when it lands. From then the
**Source** link opens for everyone. The obligation still waits on distribution,
because the image stays private, but an install with other people on it is no
longer offering them a source they cannot read.)*

---

## 3. Verification — the P10 exit gate

Sketch; expand on revisit.

1. Fresh container, no volume: comes up reachable on the mapped port, prints a
   token, refuses every route but setup, and accepts the first admin only with
   the token.
2. The same image with the environment variable set to loopback binds loopback,
   and a bare-metal install with it set to `0.0.0.0` binds that — one documented
   knob, two artifacts (§1.2).
3. Two accounts, two sessions: A's turn completing notifies A and produces
   nothing addressed to B, asserted server-side rather than observed in a
   browser.
4. Five events inside the coalescing window arrive as one notification.
5. A completion sound fires with the tab backgrounded, and the class can be
   turned off in preferences — and every row in that list corresponds to
   something that actually emits (§1.4). ***Three rows as of 2026-09-16***
   (§0.1), and the number is the assertion: a fourth means somebody shipped a
   class without a producer, and a second means `artifact.ready`'s producer did
   not come with the router.
6. *Restart now* is disabled with a reason under a bare process, and under a
   supervisor it drains in-flight turns and names how many other users it is
   about to interrupt.
7. Gallery mode: tiles for listed accounts, a hidden account absent from the
   listing but still able to sign in by handle, and the unauthenticated surface
   unchanged in form mode ([12 §8](../12-account-gallery.md)'s three tests).
8. About shows a real version and commit, and the source link resolves.
9. `storyengine.local` reaches the server from a second machine on the LAN.
10. **Only a person can walk:** hand the install to a household member who has
    never seen it, from the URL alone, and watch where they stop. The phase's
    whole claim is about that person.

**And the standing line from [work plan §2.3](01-work-plan.md): no phase exits with
configuration that has no surface.** This phase is the line's last large debtor —
if anything shipped since P1 still needs a text editor to configure, this is
where it is found and fixed, not P11.

***And the debt is now countable*** — 2026-09-16, §0.1. `config.ts`'s
`CONFIG_TIERS` marks a key **`'unread'`** when nothing consumes it, and
`config.test.ts` fails when a key is missing from the table — so *the line's last
large debtor* is a number rather than a characterisation. **Three of the four are
this phase's**: `updates.checkEnabled` and `updates.channel` (§1.7),
`limits.extensionStorageQuotaMb` (§1.5). The fourth is
[P11.7](28-p11-implementation.md)'s. ~~**This gate should read that table reaching
one**~~ — **it reaches two**, 2026-09-17, and the difference is §1.5's fork
closing as a *deferral* rather than as a build: the update check's two keys are
`applied`, and `limits.extensionStorageQuotaMb` **stays `unread` on purpose**,
beside [25 §3.2](../25-roadmap.md)'s row for extension installation. *That is the
tier doing its job rather than the debt going unpaid* — a key that is stored, not
read, and visibly so, which is what the annotation exists to say.

### 3.1 The critical list, and what a test answers

*Planned to [§0](05-manual-testing.md)'s criterion rather than sketched — the
sixth phase to do so, and the first whose gate is mostly about **deployment**,
which changes what the criterion returns.*

***Four criticals, and three of them are blocked on a thing rather than an
hour.*** That is unusual and it is a property of the subject: this phase's claim
is *"the install is reachable, and safe, for someone who is not the
developer"*, and every clause of it is about a machine that is not this one.

| Row | Why it is critical | Blocked on |
|---|---|---|
| **C1** A completion sound with the tab backgrounded | Clause (i): the feature that motivated the whole of [09 §3] is *the completion-sound case*, and whether it fires in a backgrounded tab is a browser's answer rather than a test's. Clause (ii): every later delivery channel is built on this one working | Nothing — a browser and a turn |
| **C2** *Restart now* under a supervisor | Clause (i): [09 §6.4] says the control *"is honest or it is a trap"*, and the trap is the half a test cannot reach — `restart.test.ts` proves the refusal and the drain in-process, and what nobody has watched is the process coming **back** | **R11**, a supervised install |
| **C3** `storyengine.local` from a second machine | Clause (i): the bytes are asserted exactly and what is unproven is that a neighbour hears them. Clause (ii): it is the arrival story every later install instruction assumes | **R5**, a second machine |
| **C4** A household member, from the URL alone | Clause (i), and it **is** the phase's claim rather than a check on it. The gate's own step 10 says so: *"the phase's whole claim is about that person"* | **R4**, a non-author for an hour |

***What the criterion excludes, and it is most of the gate.*** Steps 1 and 2 are
[P6A](19-p6a-alpha-1.md)'s claims living in P10's gate — clause (i) — and belong
to [sitting I](05-manual-testing.md), which already holds them. Steps 3, 4, 7 and
the standing line are **asserted by name** below. Step 8's composition is
asserted and its *resolves* half is blocked on publication, which is
[P11.9](28-p11-implementation.md)'s.

***And the one this phase was asked to decide and did not.*** [P10.0] carries
the container first-run question — a one-time host `chown` against a container
that takes its volume and drops to `PUID`/`PGID` — and says it is *"this phase's
to decide against a second install, not the first."* **There has been no second
install**, so it is carried into sitting P rather than decided at a desk, which
is the honest handling of a question whose whole point was that it is answered by
watching somebody.

### 3.2 What was answered — recorded 2026-09-17

*The results table [manual testing §0](05-manual-testing.md) asks for, in
[P9 §3.2](26-p9-implementation.md)'s shape. **The ten steps above are not
edited**; this is the second table, which is that model's first honesty condition
and the whole reason there are two.*

| Step | Discharged by | Result |
|---|---|---|
| **1** Fresh container: reachable, token, setup gate | — | **Not this phase's.** [P6A](19-p6a-alpha-1.md)'s claim in P10's gate — criterion (i) — and it is [sitting I](05-manual-testing.md) rows 1–6, one `PASS` and three `PART` from the first install |
| **2** One environment variable, two artifacts | `config.test.ts` | ✅ **in part** — that the variable maps a key, is documented, and is refused by name when wrong. *Two artifacts* is I's, for step 1's reason |
| **3** A's turn notifies A and nothing addressed to B | `notifications/router.test.ts`, `routes/notifications.test.ts` | ✅ — the phase's named CI claim, and asserted **twice on purpose**: once where the account is an argument, once where it comes from a session cookie and there is no other way to name one |
| **4** Five events inside the window arrive as one | `state/notifications.test.ts` | ✅ — and on `folded` rather than on the row count, because *a replace also yields one row*. That is the assertion that separates *five people replied* from *somebody replied, and we told you about the last one* |
| **5** A sound with the tab backgrounded; every row has a producer | `notifications/prefs.test.ts`, `notifications/labels.test.ts` **in part** | **C1. Never walked.** The row count is mechanical in **both directions** — the rows are generated from `NOTIFYING_CLASSES`, which is checked against the server's own union — so a class with no row and a row with no class each fail a test. *What no test reaches is whether a sound happens in a tab nobody is looking at* |
| **6** *Restart now* refused bare; drains and names who it interrupts | `restart.test.ts`, `supervision.test.ts` | ✅ **in part** — the refusal, the 503 at the submission door, the drain waiting on a real turn through a slow provider, and the counts split mine-from-others. **C2** is the half where the process comes back |
| **7** [12 §8]'s three tests | `routes/gallery.test.ts`, `auth/Gallery.test.tsx`, `auth/tile.test.ts` | ✅ — all three by the names that section gives them, plus the one it did not ask for: *a tile never authenticates*, which is [12 §9]'s refusal and the thing this feature is most likely to be quietly "improved" into |
| **8** About shows a real version and commit; the source link resolves | `build-info.test.ts`, `about/BuildFooter.test.tsx` | ✅ **in part** — the composition is asserted, including the tag rather than a branch and the three absences. *Resolves* needs a public repository, which is [P11.9]'s, and **an identified build**, which needs a release build |
| **9** `storyengine.local` from a second machine | `mdns/packet.test.ts`, `mdns/responder.test.ts` **in part** | **C3, blocked on R5. Never walked.** Every byte that would reach a neighbour is asserted — the cache-flush bit, the unicast bit, compression pointers, pointer loops, every malformed shape answering `null`. What is between the bytes and the neighbour is a socket |
| **10** A household member, from the URL alone | — | **C4, blocked on R4. Never walked**, and it is the phase's whole claim rather than a check on it |
| **The standing line** — no configuration without a surface | `config.test.ts`, `route-callers.test.ts` | ✅ **as stated, at two rather than one** — `updates.*` became `applied` when §1.7's check moved here; `limits.extensionStorageQuotaMb` stays `unread` beside its roadmap row, and `trash.retentionDays` is [P11.7]'s. **Four routes joined `OWED` and left it one stage later**, which is the shortest that map has carried a debt |

***Seven rows discharged in whole or in part; four criticals, three of them
errands.*** The distinction [§0](05-manual-testing.md) draws holds here as it did
at P9: **a deferral is a judgement and a block is an errand**. Nobody decided C2,
C3 or C4 were not worth walking.

***What that leaves true and what it leaves unproven, plainly.*** Every claim
this phase makes about **who is told what** is asserted, and it is the one that
would be worst to get wrong: a household server that notified the wrong person,
published an account list it should not have, or served a portrait somebody had
hidden. What is unproven is every claim about **reaching the install** — a sound
in a tab nobody is watching, a process that comes back, a name a neighbour
resolves, and a person who has never seen it getting in. *That is the same shape
P9's gate had and for the same structural reason*: the mechanisms are in this
repository and the audience is not.

---

## 4. Out of scope, deliberately

Web Push and outbound webhooks/ntfy/Gotify (with Messages, unscheduled —
[09 §3.6](../09-server-multiuser-deployment.md), [25 §3.4](../25-roadmap.md)); the service worker that Push
implies ([09 §3.7](../09-server-multiuser-deployment.md)); Tailscale at every
level (feature list at High, [26 D1](../26-open-questions.md)); the file browser
([26 D3](../26-open-questions.md), roadmap); sharing content between users
([26 A2e](../26-open-questions.md), deferred deliberately, with the merge path
kept open at [09 §4.3](../09-server-multiuser-deployment.md)); multiplayer and
shared heads ([09 §8](../09-server-multiuser-deployment.md)); a role system
([09 §4.2.1](../09-server-multiuser-deployment.md) — named capabilities, and
[P2A](09-p2a-configuration-surface.md) already built them); auto-provisioning
accounts ([26 D2](../26-open-questions.md)); and packaging, all six artifacts of
which [P11](28-p11-implementation.md) now owns ([work plan §0.5](01-work-plan.md)).

---

## 5. The honest size, and what only the revisit can settle

*Added 2026-08-31.*

**Two phases are wearing one number.** P10.0 — bind, container, token, mDNS — is
deployment work with a security posture and a container story; P10.1 through
P10.4 are a notification router, two delivery channels, the remainder of
[10 §15](../10-ui-surfaces.md) and a gallery. They share no code and almost no
reasoning, and the only thing joining them is *what has to be true before
somebody who is not the developer can use this*. That is a real organising
principle, but the revisit should price them separately, because the risk lives
almost entirely in the first.

**P10.0 is where a mistake is unrecoverable.** Everything else here can ship
wrong and be fixed in a patch; a default bind address, a setup token and a
container that inverts the default are decisions that get copied into people's
compose files and stay there. §1.1 and §1.2 already treat them that way — *the
check, not the print*, and *not a hidden build flag* — and the revisit should
resist any pressure to soften either for convenience.

**Both paragraphs above are now history, and they were right.**
[P6A](19-p6a-alpha-1.md) took the unrecoverable half — the bind default, the
token, the container — and the two rules this section told the revisit to defend
are the two that survived contact: P6A built the environment layer rather than a
baked build difference, and shipped the check rather than the print. **The
warning worked, which is the argument for having written it down a phase early.**

So the correction is to the *shape*, not the reasoning: P10 is no longer two
phases wearing one number. P10.0 is a stage-sized remainder — mDNS and a
re-verification — and the phase's centre of gravity, and its risk, has moved to
the notification router and the surfaces after it. **The thing to price
separately at the revisit is now P10.1**, for the reason two paragraphs down:
its classes have to be agreed with three phases that will already have shipped.

**What is smaller than it looks:** the gallery (P10.4). §1.9 says its
obligations are enumerated in [12](../12-account-gallery.md) and to take them as
written, which is the cheapest kind of stage — a specification that already did
the deciding.

**What is larger than it looks:** the notification router (P10.1). Not the
routing, which is a table; the *classes*, which have to be agreed with three
phases that will already have shipped. §1.4's rule protects the phase from
shipping empty classes but does nothing about the reverse problem — P7, P8 and
P9 each producing something notification-worthy and no class existing for it.
**The revisit's cheapest move is to re-read those three plans' gates for things
a person should be told about**, and to do it before writing the router rather
than after.

***Run 2026-09-16, and it was cheap — §0.1.*** All three have shipped, so the
read is against a tree. **Three answers:**

- **The rule fires twice.** `turn.awaiting-input` has no suspending step after
  four phases, and `artifact.ready` has no producer at all — so three classes
  ship rather than five, and both absences are the rule working rather than
  failing.
- **The reverse problem has one instance**, and it is a *state* rather than an
  event nobody classed: a rendition that **failed**. Nothing from P7 or P8 joins
  it — a hook firing and a goal concluding happen inside a turn the person is
  watching, and manual capture is synchronous.
- **And a third thing this bullet did not anticipate**: the phase whose producer
  was assumed did not write it. `artifact.ready` was P9's, P9.2 went another way
  for a structural reason that is right, and **the producer therefore joins the
  router**. So P10.1 is larger than it looks for the reason this section gives
  *and* for one it does not — though the increment is a morning, not a stage.

***What this makes the section's advice worth, since it is the point of writing
it down:*** the read cost an hour and it moved a producer between phases, sized
two stages down and one up, and turned a five-row preference list into three.
**Doing it at the stage would have found the same things after the table was
written**, which is the outcome the sentence above was trying to prevent.

**Three things only the revisit can settle:**

- **Whether 1.0 ships push at all** (§1.3's *no presence signal*). The router
  can be real while the delivery channels are one; deciding that early is what
  keeps §1.7's *ships with its producer or ships dark* from becoming a late
  argument.
- ~~**What the container image actually is.** §1.2 decides the bind default
  inverts inside it; nothing yet says what *it* is, and that is a
  [20](../20-tech-stack.md) question this phase inherits.~~ **Closed by
  [P6A §2](19-p6a-alpha-1.md)**, which answers it — base image, package manager,
  the workspace prune, the volume, the user, the compose file — rather than
  passing it on again. Worth noting that it was routed to
  [20](../20-tech-stack.md) and [20](../20-tech-stack.md) never grew a section
  for it: a question forwarded to a document that does not answer it is a
  question with no owner, which is what this bullet was really recording.
- **Whether §1.8's system-library bullet found an owner.** It is recorded here
  as a defect to close, which is the right place for it — but a defect with no
  owner at the revisit is one that ships. ***Checked 2026-09-16 (§0.1): it has an
  owner — P10.3 — and is still open after two audits and four phases.*** That is
  the milder failure than the one this bullet feared and it has the same ending,
  so the thing to watch is not whether it is owned but whether anybody spends the
  paragraph.
