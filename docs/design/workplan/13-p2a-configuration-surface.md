# 13 — P2A implementation plan

**Status: built.** P2A.0 through P2A.7 have landed. §3 carries what each stage
found; this is what the phase as a whole did that the plan did not predict.

Three defects, each recorded where it happened rather than only here:

- **`applyLiveConfig` replaced the running config object rather than assigning
  into it**, so the runner, the budgeter and the library context each held a
  record the server had stopped using — six `live` keys could not change on a
  running server for that reason alone. §2.5 predicted the shape of this and
  understated the size.
- **The in-place fix then aliased the module defaults**, because `mergeDefaults`
  shares whatever the file does not mention. One save rewrote `DEFAULT_CONFIG`
  for the life of the process, and it surfaced as a test passing for the wrong
  reason. Reaching it needs a *sparse* config file, which is the ordinary case —
  an install with no config file at all cannot reproduce it.
- **The 400 for a refused field did not name the field.** Ajv reports
  `additionalProperties` against the parent's path, so *refused rather than
  ignored* — this plan's own test for §2.2 — was answering `/ must NOT have
  additional properties`. Fixed for every closed body in the API.

And two of the plan's worries turned out to be **unreachable rather than
latent**, which is worth recording because the code now says so rather than
carrying a comment claiming a live consequence. A Fastify plugin instance's `log`
*is* the root logger, so registering the settings routes inside `/api/admin`
never endangered `log.level`; and a second `Accounts` instance would not have
been stale, because it revalidates against the file on every read. Both are now
pinned by tests, which is the useful half of having worried about them.

Written immediately after P2 closed, against a
design section that four other documents already cite as though it were built.
Format follows [03](03-p1-implementation.md).

**P2A delivers**, from [01 P2A](01-work-plan.md): the settings surface —
[05 §15.1](../05-ui-surfaces.md) in full, [05 §15.2](../05-ui-surfaces.md) in
full, and the half of §15.3 that has something to configure. One route, one
navigation entry, the admin half **absent** rather than disabled.

**The demo that defines done:** *create a second account for someone in the
house from the browser, sign in as them, change their password and display name
— and watch the admin list say plainly that they still have no usable
connection, because they do.* That last clause is the phase. The surface earns
its place by reporting the dead-end state
([04 §4.5](../04-server-multiuser-deployment.md)) rather than leaving it to
arrive as a bug report from someone who cannot send a message. Fixing that state
without a text editor is [P2B](14-p2b-provider-configuration.md)'s demo, not
this one.

**P2A is where three things stop being documents.**
[13 §4.2](../13-internal-contracts.md)'s *"the settings UI writes this file"*,
including the self-write rule it attaches; `pendingRestart()`, which P2 built,
tested, and left with no caller ([04 Appendix A](04-p2-implementation.md)); and
`Capabilities`, a persisted shape since P1 that nothing has ever honoured.

**CI this phase establishes:** two checks, both the mechanised half of
[01 §2.3](01-work-plan.md). The **config drift test** — `config.example.json`
declares every key `ConfigSchema` does — and the **route-table test**, which
asserts every path under `/api/admin` refuses a non-admin without naming any of
them. A list of admin routes maintained by hand is wrong the first time somebody
adds one in a hurry.

---

## 1. Why this is a phase and not P10's problem

[05 §15.5](../05-ui-surfaces.md) homes this at P10 and then leaves the door
open: *"the halves can land separately."* The case for walking through it is not
that the surface would be nice. It is that **five shipped artifacts already
behave as though it exists**, and each is currently saying something untrue:

- **`config.example.json` calls the settings UI "the primary path"** for
  configuration, in its own header, in the file every operator reads first.
- **[13 §4.2](../13-internal-contracts.md) contracts the write path** — *"The
  settings UI ([05 §15](../05-ui-surfaces.md)) writes this file"* — and derives
  a self-write-suppression requirement from it.
- **[04 §4.5](../04-server-multiuser-deployment.md) commissioned a specific
  sentence**, *"2 users have no usable connection"*, and named the admin screen
  as where it appears.
- **P2 shipped `pendingRestart()` correct and unreachable.** F8 split the notice
  from its surface and sent the surface to P10; the function has sat there
  since, asserted only by its own test.
- **Every account mutation that exists is a console command.** After first-run
  setup there is no route that changes a display name, a locale, a password, a
  role, an enabled flag or a capability. `Accounts.list()` is called by nothing
  at all.

**So this is not a P10 feature arriving early; it is a dependency that was never
scheduled.** The distinction matters because it is exactly what
[01 §2.1](01-work-plan.md)'s deferral question is meant to catch and did not.
Asked of *the settings screen*, "what does it cost to add this a year later?"
answers "the work itself", and the screen defers correctly. Asked of *the
ability to configure the thing you just built*, it answers "every phase in
between ships a feature nobody can turn on without a text editor". The question
was right and it was asked about the wrong noun. [01 §2.3](01-work-plan.md) is
the correction.

**What it is not is a licence to build §15 entirely.** Half of §15.3 configures
subsystems that do not exist, and §2.6 refuses each of them by name.

---

## 2. Decisions this plan had to make

### 2.1 Capability enforcement moves forward, and only one of the three bites

[01 §2.2](01-work-plan.md) uses capability enforcement as its worked example of
a correct split: the `Capabilities` record ships at P1 because it is a persisted
shape, the enforcement waits for P10 because it is additive. That split was
right while nothing granted capabilities. **A screen that grants them changes
the argument**, because the same section forbids building a system whose only
purpose is to be replaced — and a switch labelled *"may add their own provider
keys"* that adds nothing is not a small version of the real thing. It is a false
front, which is the failure §2.2 names outright.

So enforcement lands here, and the change is one expression. `turns/runner.ts`
passes `{ privateConnections: true }` as a **literal** into
`resolveConnections`, defeating the loader-level check
[04 §4.5](../04-server-multiuser-deployment.md) calls the load-bearing one — and
calls it that precisely because a UI-level check is a trivial bypass for anyone
with `fileAccess: "write"`. It becomes the account's real capability, read
through the same `Accounts` instance the routes use, so a revocation is seen by
the very next turn rather than at the next restart. Two instances would be two
caches and a revocation that takes effect eventually.

**Two of the three capabilities still gate nothing, and the surface says so.**
`fileAccess` gates a file browser [01 §4](01-work-plan.md) moved to the roadmap;
`enableExtensions` gates extensions, which appear in no phase list at all. Two
dishonest options were available and both are refused: inventing a partial
enforcement so the switch feels real, and rendering three switches as though
they were equally live. **The account form groups them instead** — *in force
now* against *recorded for later*, the second carrying one sentence saying the
feature has not shipped and the setting will apply when it does.
[05 §15.2](../05-ui-surfaces.md) asks for the consequence written next to each
switch; this is the other half of that truth, which is *when*.

`auth/accounts.ts`'s own comment says *"Nothing enforces these at P1…
Enforcement is additive and waits for P10."* It becomes false the moment the
runner changes, and it is repaired in the same stage rather than left to be
found. [The API doc](../../api.md) carries the same claim and gets the same fix.

### 2.2 B13 closes: preferences are a per-user file

[06 B13](../06-open-questions.md) is the only question in its block still marked
OPEN, and it leans to the third of three answers: a separate per-user file
rather than `localStorage` or a map on `Account`. **The lean is already written
into the layout** — [04 §4.3](../04-server-multiuser-deployment.md)'s canonical
per-user block lists `prefs.json` — so closing the question is mostly letting
two documents agree.

`data/users/<handle>/prefs.json`, an envelope matching `accounts.json` so the
file self-describes, namespaced string keys, JSON values, **unvalidated by the
server** so a preference the client stops using rots quietly rather than needing
a migration.

Three details the question did not settle, decided here:

- **A patch merges shallowly, and `null` deletes.** A whole-document write would
  make two open tabs a lost update. Keys are flat and namespaced, so a shallow
  merge is well defined; the response is the whole map afterwards, so the client
  lands on the truth rather than on its own guess.
- **Writes serialise per handle** through the existing `KeyedQueue`.
  Read-modify-write across an `await` is exactly what that primitive is for.
- **An unreadable file reads as empty**, logged at `warn`, repaired by the next
  write. A deliberate asymmetry with `accounts.json`, which refuses to start on
  a malformed file: a broken accounts file means the server cannot tell who
  anyone is, and a broken prefs file means somebody's pane is collapsed wrong.

**Bounds are not validation, and the code has to say which it is doing.** A key
pattern and a document size cap exist because an unvalidated store is otherwise
an unbounded write surface for any signed-in account. They bound the file; they
do not interpret it. Without that comment the next reader improves them into a
schema, which is the one thing B13 ruled out.

This unblocks [polish §2](09-polish.md)'s *As stored* pane state, which is hard
blocked, and [polish §4](09-polish.md)'s all-kinds view, which is not — §4
authorises deleting that view rather than waiting, and no longer has to.

### 2.3 Removal: disable is the default, and the second choice says what it does

[05 §15.2](../05-ui-surfaces.md) leaves this `[OPEN]`: whether removal offers
*keep the data, disable the login* as the default. It does, and the two are
**two verbs rather than one verb with a flag**. `PATCH` with `enabled: false` is
the ordinary path and needs no route of its own; `DELETE` is unambiguously the
destructive one. A `keepData` flag that turns a delete into a not-delete is
precisely the shape that makes a dangerous control feel routine.

**And the destructive verb moves rather than erases.** The record leaves
`accounts.json`; the directory moves to `data/removed/<handle>-<suffix>/`, which
the maturation sweep does not touch — it is per-user retention and this is not a
user any more. The surface says this in words, with the honesty
[02 §10.2](../02-data-model.md) requires of the trash: *their library is moved
to `data/removed/` on the server, StoryEngine will not delete it, remove that
folder yourself when you are sure.* The handle is free for reuse immediately and
the old data is not reachable through it, which is the property that makes the
move better than either erasing or leaving it in place.

Deletion being a move is not a new position; it is the one `trashDestination`
already takes for objects and sessions.

### 2.4 The admin guard is a prefix, not a habit

`adminOnly` is an `onRequest` hook on an encapsulated `/api/admin` plugin, and
**this plan commits to never adding a per-handler admin check.** Two spellings
of the same guard is how one of them gets missed, which is the same argument the
library already makes about there being no `:handle` parameter to forget.
`requireAccount` is unchanged and stays per-handler in the user half, where the
account object is the thing the handler wants rather than a gate.

Three consequences worth writing down:

- **403, not 404, for a signed-in non-admin.** Deliberately different from the
  library's 404 for another user's object. `/api/admin` is a fixed path whose
  existence is not a secret, and a 404 would leave a client unable to tell *this
  build has no admin API* from *you are not an admin*.
- **401 for an anonymous caller**, which is a different fact and gets a
  different code.
- **The order is already correct and is asserted rather than assumed.** The root
  hook runs identity, CSRF and the setup gate before any encapsulated hook, so a
  state-changing admin call with no token answers `csrf` rather than
  `forbidden`. That is a security property, so it is a gate step and a test, not
  a paragraph.

Nothing in P2A joins `survivesSetupGate`. A settings surface before an admin
exists is meaningless, and 503 is the right answer.

### 2.5 The config truth has to be repaired before a form displays it

The decision this plan did not expect to make, and the largest thing in the
phase. **Reading the config subsystem in order to render a form found that most
of what it declares is not true of the running server.**

- **`applyLiveConfig` destroys the information the restart banner is made of.**
  It computes the pending set against the running config and then replaces the
  running config with the new one. After a single save the record claims the new
  bind address while the listener holds the old, and the next save computes its
  delta against an already-moved baseline. The banner
  [04 §6.3](../04-server-multiuser-deployment.md) specifies — persistent,
  server-held, naming what is pending — cannot be built on that. It would be
  right once, never clear, and lie about what is outstanding.
- **The runner captured the config object rather than a reference.** Three
  `live`-tier keys are read off that captured object, and `applyLiveConfig`
  replaces the object, so those three never change on a running server.
- **Most of the rest are fixed at construction or read by nothing.** Of the
  **eleven** keys the table calls `live`, exactly one — `log.level` — genuinely
  is. *(This section said eight while it was a plan; the count is eleven, and
  P2A.0's table is what made miscounting them impossible.)*
- **`ConfigSchema` does not close `additionalProperties`**, so a validated `PUT`
  would accept a credential-shaped key and the unknown-key-preserving write
  would put it on disk. That falsifies the structural claim
  [13 §4](../13-internal-contracts.md) makes about config having nowhere to put
  a key.

**The repairs, in the order they have to happen:**

- **`bootConfig`**, a clone taken at assembly and never reassigned. The notice
  becomes `pendingRestart(bootConfig, config)` — a property of the process,
  computed per request, stored nowhere. That makes it self-healing: change a
  value, change it back, the notice clears, because it is derived rather than
  accumulated. A stored field would be a second source of truth for a derived
  value, which is what [13 §4](../13-internal-contracts.md) argues against at
  length.
- **`applyLiveConfig` assigns into the running config in place** rather than
  replacing it, so every holder of that reference sees the change. Its own
  docstring already claims values are read at the point of use; this is the
  commit where that becomes true.
- **`LIVE_APPLIERS`**, a table beside `CONFIG_TIERS`, keyed by the same dotted
  paths, marking each `live` key `applied` or `unread`. It ships over the wire
  and the form renders `unread` keys in a group that says so. **This is the
  mechanism that stops the settings surface ever showing a control that does
  nothing**, which is the placeholder failure [01 §2.2](01-work-plan.md)
  forbids — and it is cheaper than the alternative, which is remembering.
- **`limits.maxUploadMb` is *not* re-tiered**, and this plan's first draft said
  it should be. [04 §3](04-p2-implementation.md) named the tier as out of P2.0's
  scope and gave a reason worth keeping: *"the key names uploads; there is no
  upload route yet, and re-tiering the contract to match today's shortcut would
  lock the shortcut in."* That is right. The tier describes what the key is for;
  the construction-time read is the implementation lagging behind it. So the
  contract stands and `LIVE_APPLIERS` carries the gap — which is the whole
  argument for having that table rather than editing the tier every time an
  implementation is behind. **The general rule this settles:** where a tier and
  an implementation disagree, the appliers table records the disagreement; the
  tier moves only when the *intent* changes.
- **The write picks known keys out of the body rather than trusting it**, which
  mirrors `toPublic()` and needs no second closed copy of the schema. Unknown
  keys **in the body are dropped**; unknown keys **in the file are preserved**.
  That asymmetry is the correct one: a newer build's key may legitimately be on
  disk, and no client may invent one.

**The tier table travels to the client as data**, because the client may not
import from the server package and a duplicated table would falsify
[13 §4](../13-internal-contracts.md)'s claim that the annotation is the source.
Sending it means a key a newer build adds renders with the right badge without a
client release.

**No config watcher lands here**, and the reason is recorded rather than left to
be rediscovered: [04 §6.2](../04-server-multiuser-deployment.md)'s hot-reload
claim is about content, config is explicitly not content, and a stale check on
write gives the settings UI everything a watcher would without introducing a
second writer to the in-memory record on the day the first one ships. When a
watcher does land, two things change together — the ignore predicate stops
ignoring `config.json`, and the handler claims the self-write token first. That
pairing is noted at both sites, because splitting it is how a server ends up
reacting to its own rename.

### 2.6 What §15.3 does not carry, and why each one is absent

[05 §15.3](../05-ui-surfaces.md) lists five things. P2A builds one and a half,
and the section is **not** marked done — [05 §15.5](../05-ui-surfaces.md) gains
a line naming exactly which bullets closed, so P2B and P10 inherit an accurate
remainder rather than a section that looks finished.

- **System connections** — [P2B](14-p2b-provider-configuration.md). The whole of
  the next phase.
- **The system library** — nothing, and this is the one place §15 asks for a
  panel that fails its own test. [05 §4.2](../05-ui-surfaces.md) makes the
  system library never-writable and
  [04 §4.3](../04-server-multiuser-deployment.md) withholds admin write at 1.0
  deliberately, because that permission is one step from making it the household
  share. So there is no *action* — grant, revoke, create, disable, restart,
  install — for an admin to take, and [05 §15.4](../05-ui-surfaces.md) says a
  panel without one does not belong. The design document is what to fix here,
  not the phase.
- **Extensions** — install does not exist and is scheduled nowhere.
- **Restart now** — the notice ships; the button does not.
  [04 §6.4](../04-server-multiuser-deployment.md) is explicit that under no
  supervisor the control leaves the admin with no server and possibly no shell,
  so it needs supervisor detection and a drain, neither of which exists. **The
  banner says so in one sentence** rather than listing pending changes and
  offering nothing, because a notice that invites *"so how do I restart it?"* is
  a worse answer than a notice saying the server does not restart itself.
- **Connectivity and bind state** — the bind is readable today, but the signal
  worth showing is [04 §6.5](../04-server-multiuser-deployment.md)'s
  all-local-versus-any-remote judgement, whose producer is P11's update check.
  Building the display first means a panel that can only ever say one thing.

**Notification preferences are not here either**, though
[04 §3.5](../04-server-multiuser-deployment.md) puts one row per class in
settings. No class has a producer and the router is P10's. Building the rows
first would invent a preference model ahead of the event schema that binds it,
which is the wrong order for the one contract
[04 §3.4](../04-server-multiuser-deployment.md) says must be complete from the
first producer.

**Two things §15 does not anticipate and the form has to.** `dataDir` is the key
that decides where `config.json` itself lives, so a form that edits it and then
writes to the old location is a one-click way to appear to lose everything — it
renders read-only, pointing at `--data` and the file. And `server.host` becomes
a **fourth** place someone binds beyond loopback, so it carries the same
sentence [04 §4.1](../04-server-multiuser-deployment.md) requires of the other
three, at the moment of binding rather than in documentation nobody reads.

---

## 3. Stages

### P2A.0 — Make the config truth true before a UI shows it

**Status: built.**

§2.5, all of it: `bootConfig`; `applyLiveConfig` assigning in place and fanning
out the keys a live read cannot reach on its own; the runner taking an
`Accounts` instance; the raw parsed document on the load result, so unknown-key
preservation has a document to preserve from; `LIVE_APPLIERS` with a
completeness test; the four schema keys missing from `config.example.json` added
with their tier comments; the route table the admin test reads.

**Two of these were named as out of P2.0's scope and are now in.** The
`config.example.json` drift test and `limits.maxUploadMb`'s tier were both left
because neither cited a finding ([04 §3](04-p2-implementation.md)) — the right
call under that stage's rule. The drift test enters here because a settings form
makes the example file's accuracy load-bearing rather than cosmetic; the tier
stays where P2 left it, for P2's reason, and §2.5 records why the first draft of
this plan got that wrong.

**Named as out of this stage**, so the sweep does not absorb them on the way
past: the config *routes* (P2A.5), and any new config key. This stage adds no
settings; it makes the ones that exist mean what the table says.

*Tests:* the drift test between `ConfigSchema` and `config.example.json`; a
`LIVE_APPLIERS` completeness test beside the existing every-key-has-a-tier one;
and a log-capture test proving `log.level` applies to the **root** logger rather
than only to the `/api` child — assigning to the child half-works silently and
is the likeliest bug in the phase.

*Ends at:* every `live` key is either observably applied on a running server or
declared `unread` in a table a test keeps honest, and the restart notice
computed from `bootConfig` clears when a change is undone.

**Landed.** Four notes on where it differed from the paragraphs above.

- **A defect the plan did not predict, and the worst of the set.**
  `history.keepPerObject` was the one live key an in-place assign cannot reach:
  `LibraryContext` carries it as its own field and the **watcher copied it a
  second time** at construction. So the routes' write path and the watcher's
  could trim one object's history to two different depths, and a change reached
  neither. §2.5 predicted the fan-out was needed; it did not predict that the
  two readers already disagreed. The watcher now holds the same context the
  routes do rather than a number out of it.
- **Why the original bug survived its tests, which is the transferable part.**
  `applyLiveConfig` rebound `services.config`, so asking `services.config`
  afterwards could not tell the broken implementation from the fixed one — and
  that is exactly what the tests asked. The assertion now goes through a
  reference taken *before* the call, which is the position the runner, the
  budgeter and the library context are actually in.
- **The count in §2.5 was wrong and the table is what fixed it.** Eleven live
  keys, not eight: five applied, six honestly declared `unread`. The
  completeness test runs both directions — a `live` key with no entry fails, and
  an entry for a key that is not `live` fails — so a re-tier cannot leave a
  stale row behind.
- **Two items deferred rather than dropped**, both plumbing this stage had no
  test for: the runner does not yet take an `Accounts` instance, and there is no
  route table. Each moves to the stage that gives it a consumer — P2A.3 and
  P2A.4 below. An unused dependency wired a stage early is the same false front
  §2.1 refuses for capabilities.

`ConfigLoadResult` gained `document` as planned, with the reason sharpened: the
merged view cannot stand in, because every unset key is present there carrying a
default, so a writer round-tripping through it would pin the entire default set
into a file somebody deliberately left sparse. And `config.ts`'s docstring
referencing `assertTiersComplete` — a function that never existed — was repaired
on the way past.

### P2A.1 — The account store grows verbs

`updateSelf`, `update`, `changePassword`, `remove`; `resetPassword` re-expressed
as `changePassword` plus a re-enable, because re-enabling is right for the
break-glass path and wrong to inherit in the self-service one. The last-admin
predicate — one check covering demote, disable and remove — which is the first
thrower `AccountError`'s declared `last-admin` code has ever had. The two new
layout members for `data/removed/`, and the prefs path.

No routes. *Ends at:* every account mutation P2A needs exists as a tested store
method.

### P2A.2 — The user half, and the preferences store

`/api/me` — profile patch, password change requiring the current one, prefs read
and patch. The prefs module with its keyed queue. The client's preference hooks,
including the one optimistic mutation in this codebase: a toggle must feel
instant, the value is trivially reversible, and there is no hash to be stale
against — the exact inverse of the editor's deliberately unpolled base.

One repair the stage forces: the epoch formatter throws on a malformed locale,
and a locale is now something a user can save. It falls back rather than
breaking every date on the page.

*Tests:* a role in the body is **refused, not ignored** — 400 naming the field,
and a following read shows the role unchanged, because ignoring teaches a client
that it worked. And an unknown preference key is stored and returned unchanged,
which is B13's rot-quietly position asserted rather than described.

*Ends at:* a signed-in person changes their display name, locale and password
through the API, cannot change their role by asking, and a preference survives a
move to another browser — closing [06 B13](../06-open-questions.md).

### P2A.3 — Capability enforcement

§2.1. The literal becomes the account's capability; the `disabled` list
`resolveConnections` has always returned starts being populated in production,
and logged. The honesty repairs to `auth/accounts.ts`'s comment and to
[the API doc](../../api.md).

**Carries the `Accounts` wiring deferred from P2A.0** — the runner takes the
instance here, where reading a capability off it is what the stage is for. One
instance shared with the routes, so a revocation is seen by the very next turn;
two would be two `(mtime, size)` caches and a revocation that takes effect
eventually.

*Ends at:* revoking `privateConnections` stops the next turn resolving a
personal connection, with the file untouched on disk — which is
[04 §4.5](../04-server-multiuser-deployment.md)'s *revoking disables, never
deletes*, demonstrated rather than asserted.

### P2A.4 — The admin half: accounts

The `/api/admin` plugin and its prefix guard; list, create, patch, admin
password reset, remove. The dead-end summary as **counts, never contents** — the
warning needs a number, and
[04 §4.5](../04-server-multiuser-deployment.md) keeps a connection opaque — read
from the system directory once rather than once per account.

**Carries the route table deferred from P2A.0**, because this is the stage that
gives it a consumer: the every-admin-route-refuses-a-non-admin test reads it,
and a table with no reader is a fixture waiting to go stale.

*Ends at:* every account operation [05 §15.2](../05-ui-surfaces.md) names is
reachable, admin-only by prefix rather than by remembering, and no admin can
lock the install out.

### P2A.5 — The admin half: the install

Config read and write, the notices route, the pick-based write, the stale check,
unknown-key preservation.

**The stale check is what makes the form safe against a text editor** without a
watcher: a config on disk differing from the running one answers 412 carrying
the current document, in the library's own vocabulary. A broken file on disk
does **not** block a write that fixes it — refusing there would trap the admin
inside the problem they are trying to leave.

*Ends at:* the whole `Config` shape is writable, an unknown key from a newer
build survives the round trip, a key the caller invents does not reach disk, and
every admin sees the same pending list.

### P2A.6 — The client surface

`/settings`, one entry in the shell, and the restart banner above the outlet
because [04 §6.3](../04-server-multiuser-deployment.md) wants it on every page
rather than on the settings page. The focus trap extracted from the conflict
dialog so two new dialogs can use it — in a commit that changes nothing else,
because the existing dialog test is the only thing that makes the extraction
safe. Checkbox, select and number siblings for the field primitive, in the same
file, so *does this field have assist?* keeps having one answer.

**Absent is implemented as absent.** The admin sections are not rendered for a
non-admin, so their hooks never mount, so their browser issues no request that
could be refused. That is the difference between absent and disabled expressed
as a mechanism, and it is directly testable.

*Not done here:* any settings end-to-end journey. The Playwright tier does not
exist ([12 §1.2](12-p2-manual-gate.md)) and P2A does not create it.

*Ends at:* one route, one navigation entry, two halves.

### P2A.7 — Docs and drift

[The API doc](../../api.md) gains the settings and administration sections and
loses two false claims; [06 B13](../06-open-questions.md) is marked resolved in
the file's own vocabulary; [05 §15.2](../05-ui-surfaces.md)'s `[OPEN]` closes;
[05 §15.5](../05-ui-surfaces.md) names which bullets P2A actually closed;
[13 §4](../13-internal-contracts.md)'s tier table gains the four keys and the
re-tier.

*Ends at:* no document still says capability enforcement waits for P10, and no
shipped file describes a config key the schema does not have.

---

## 4. Verification — the P2A exit gate

```bash
pnpm install && pnpm build && pnpm lint && pnpm test
pnpm dev    # http://127.0.0.1:8080
```

1. Sign in as a non-admin and open `/settings` → the user half renders, there is
   no Administration heading, and the network log shows **no** request to
   `/api/admin/*` (§2.4).
2. Change your display name → the header updates without a reload and
   `accounts.json` holds the new value.
3. `PATCH /api/me` with a `role` field by curl → `400` naming the field, and a
   following read still says `user`.
   *Refused, not ignored — ignoring teaches a client that it worked.*
4. Change your own password with the wrong current one → `401
   invalid-credentials`; with the right one → the old password no longer logs in
   and the new one does ([05 §15.1](../05-ui-surfaces.md)).
5. Toggle a preference, sign in from a second browser → it is there. Hand-edit
   `prefs.json` into nonsense, reload → the app works and the preference is back
   at its default (§2.2).
6. Revoke `privateConnections` from an account holding a personal connection and
   submit a turn as that account → system connections resolve, the personal
   connection file is still on disk, and the log names how many were ignored
   (§2.1).
7. Open the admin account list with one account that has no usable connection →
   that row says so **inline**, and the heading carries the count
   ([04 §4.5](../04-server-multiuser-deployment.md),
   [05 §15.4](../05-ui-surfaces.md)).
8. Create an account and sign in as it → its library directory exists and the
   capabilities granted are the ones shown.
9. Disable an account with an open session in another tab → its next request is
   `401` and its data is untouched on disk.
10. Attempt to demote the only admin, disable the only admin, demote yourself,
    and remove yourself → four refusals, each naming why, and `accounts.json`
    unchanged after all four (§2.4).
11. Remove an account, typing the handle back to confirm →
    `data/users/<handle>/` is gone, `data/removed/<handle>-*/library/` holds
    their objects, and the surface said in those words that this is what would
    happen (§2.3).
12. Change `log.level` in the form → the next log line is at the new level, with
    no restart and no banner (§2.5).
13. Change `server.port` → a banner naming `server.port` appears on **every**
    admin's client, survives a reload, and offers no restart control. Change it
    back → the banner clears (§2.5, §2.6).
14. Hand-add an unknown key to `config.json`, then save the form → the key is
    still there. Send a credential-shaped key in the same `PUT` by curl → it is
    not (§2.5).
15. Hand-edit `config.json` while the form is open, then save → `412` offering
    *load what is on disk* or *overwrite with mine*, and neither happens by
    accident (P2A.5).
16. A state-changing call to `/api/admin/*` with no CSRF token → `403 csrf`, not
    `403 forbidden`. *The order is a security property, so it is asserted rather
    than assumed* (§2.4).
17. `pnpm test` green on ubuntu and Windows, `pnpm lint` clean, and the
    route-table test refuses a non-admin on every path under `/api/admin`
    without naming any of them.

**And the standing line, from [01 §2.3](01-work-plan.md): no phase exits with
configuration that has no surface.** For P2A it is discharged by steps 12–14 and
by the drift test. For every phase after it, it is a question to answer before
calling the phase done.

**What needs a person.** Steps 1, 7, 11 and 13 have automatable cores and
user-visible halves that do not automate — that a warning reads as a warning,
that the removal sentence is the one somebody would want to have read before
clicking. Following [12](12-p2-manual-gate.md)'s precedent, those halves are
written down rather than rounded off.

---

## 5. Out of scope, deliberately

Per-user connections and role bindings ([P2B](14-p2b-provider-configuration.md)
— P2A does the enforcing that unblocks them); the system library panel, the
extensions panel, *Restart now*, and connectivity state
([05 §15.3](../05-ui-surfaces.md), each refused by name in §2.6); notification
preferences, the router and delivery channels (P10); the setup token, mDNS, the
container inversion and the About surface (P10); aggregate spend (post-1.0); the
Playwright tier (P11).

**And session revocation, which the password change deliberately does not
attempt.** Sessions are signed stateless cookies with no denylist, so a password
change does not end sessions held elsewhere — [the API doc](../../api.md) has to
say so. Pretending otherwise would be the lie; the honest upgrade is the one
`auth/session.ts` already names, and it is not this phase's.

**The line most likely to erode is P2A.0's.** Repairing the config subsystem
means opening `app.ts`, `config.ts` and the runner in one stage, and every one
of those files has something else worth improving. The fence is §2.5's list: the
stage fixes what a form would otherwise display falsely, and nothing else. If
P2A.0 is growing items that no rendered control would have exposed, it has
already eroded.

**The second is §15's own gravity.** [05 §15.4](../05-ui-surfaces.md) exists
because an administration screen attracts every idea anyone has ever had about a
dashboard, and the test it sets — an admin has an *action* — is the fence. A
count of users with no usable connection passes it, because the action is
granting them one. A count of turns taken this week does not.
