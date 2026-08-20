# 14 — P2B implementation plan

**Status: plan, reviewed against [P2A](13-p2a-configuration-surface.md) as
built.** Written alongside P2A and expanded as far as reading the code allowed;
§6 was a checklist of what P2A had to settle and is now the answer sheet, §6.1
carries two things P2A created that this plan did not anticipate, and §6.2
records what re-reading the code confirmed — every finding in §1 held. Format
follows [03](03-p1-implementation.md).

**P2B delivers**, from [01 P2B](01-work-plan.md): provider configuration through
the UI — system connections, the **install default bindings** everyone inherits,
and the role table that shows what resolves to what
([04 §4.5](../04-server-multiuser-deployment.md),
[05 §15.3](../05-ui-surfaces.md)). **Admin-only, deliberately**, with the
per-user half named and deferred in §2.7.

**The demo that defines done:** *install fresh, create the first admin, paste in
one API key, and take a turn — without opening a text editor once.*

**Why this is the phase immediately after P2A.** Today a fresh install cannot
run a single turn. It needs a hand-written connection JSON file whose only
worked example lives in a test, and a hand-written `bindings.json` whose writer
was deliberately not shipped. P2A's account list now says so out loud, for every
account — *"1 person has no usable connection and cannot send a message. No
system connection is configured, so adding one fixes this for everybody."* —
which is [04 §4.5](../04-server-multiuser-deployment.md)'s dead-end state made
visible at last, and a sentence with no action behind it until this phase.
**P2B is what lets an admin act on what P2A tells them**, which is
[05 §15.4](../05-ui-surfaces.md)'s test for whether either panel belongs at all.

**And it is the second phase written under [01 §2.3](01-work-plan.md).** The
provider layer shipped at P2.1 with its configuration left on disk. That is the
gap the rule exists to close, and this is the larger half of closing it: P2A
makes the install administrable, P2B makes it *usable*.

**P2B is where [04 §4.5](../04-server-multiuser-deployment.md) stops being a
document** — and §1 is the discovery that three of its sentences describe
machinery nobody has built, because nothing has ever needed it.

**CI this phase establishes:** the **opacity test** — no response from any route
under the connections surface contains an `apiKey`, and nothing a non-admin can
reach contains a `baseUrl`. §2.2 is why the boundary is worth asserting rather
than the discipline. It **enumerates** through the route table P2A introduced,
so a route added later cannot be missed — but it supplies a real body per route
rather than sweeping, because opacity is a claim about a *successful* response
and a 400 contains no key trivially. §6.1 is where that correction came from.

---

## 1. What P2B stands on, and four things that are not there

### 1.1 What holds

More than the phase expected, and it is worth saying so before the list of gaps.
`resolveConnections` merges the two scopes and enforces `privateConnections`
**at the loader**, which is the placement
[04 §4.5](../04-server-multiuser-deployment.md) calls load-bearing;
`presentConnection` is a `Pick` rather than a hand-written interface, so a field
added to `Connection` cannot leak by being forgotten; `resolveRole` already
tells `unbound` from `dangling`, and `sessions/types.ts` already carries both as
turn-failure classes, so a dangling binding reaches the UI today as a legible
failure rather than a stack trace. `capabilitiesFor` layers baseline → provider
defaults → per-connection override, and refuses to invent numbers it has not
verified.

**None of that needs revisiting. What follows is the work.**

### 1.2 The install default bindings are specified, and do not exist

**The largest finding, and it is not a UI question.** Three documents describe a
layer of bindings that belongs to the install rather than to a person:

- [04 §4.5](../04-server-multiuser-deployment.md): when an admin removes a
  system connection, bindings that point at it *"dangle and **fall back to
  system bindings** — the existing non-blocking behaviour, no new mechanism."*
- [05 §15.3](../05-ui-surfaces.md): system connections are *"the household's
  shared keys, **and the default role bindings everyone inherits**."*
- [07 §5.1](../07-tech-stack.md): the resolution order is
  *"**install default** → role binding → session override → step override →
  actor hint"*, and the
  worked example is an admin binding the two defaults so that *"every user's
  defaults resolve there — 'Dad pays for the API'."*

**What exists is one layer, not two.** `readBindings` reads
`users/<handle>/bindings.json` and nothing else; `layout` has no system bindings
path at all; and `resolveRole`'s layering is `step → session → binding`, three
layers where §5.1 names five. The install default is absent, and so is the hint
layer's plumbing (§1.5).

So *"no new mechanism"* is not true, and the sentence that says it is the one
that hides the work. A dangling personal binding cannot fall back to a system
binding that has never existed. **This is a data-model decision, not a form**,
and it is §2.1.

### 1.3 The provider cache is never invalidated, because nothing writes

`createProviderFactory()` is called once, at server assembly, and memoises
`connection.id → Provider` for the life of the process. The memo is correct and
its reasoning is good — capabilities are per connection, so keying on the
provider *string* would hand one llama.cpp box's context window to another.

**But there is no invalidation, and there has never needed to be one**, because
until P2B nothing can change a connection while the server runs. The moment an
admin edits one through a form:

- changing `baseUrl`, `apiKey`, `models` or `capabilities` leaves every
  subsequent turn talking to the **old** endpoint with the **old** limits, until
  a restart;
- deleting a connection and creating another with the same id resurrects the
  first one's provider, key included.

This is P2B's exact analogue of what P2A found in `applyLiveConfig`: a cache
whose staleness was unreachable while the surface that writes it did not exist.
**The first writer owns the invalidation**, and it is §2.4.

*Written before P2A was built, and it landed — with a second act worth carrying
here.* Repairing the config staleness by assigning **into** the running record
rather than replacing it then exposed a defect one layer down:
`mergeDefaults` shares whatever the file does not mention, so a single save
rewrote `DEFAULT_CONFIG` for the life of the process. The pattern to expect is
that **the fix for an unreachable staleness reaches something else that was
relying on the staleness** — and that it will surface as a test passing for the
wrong reason rather than as a failure. §6.2 records the check that says
`capabilitiesFor` has no such twin today, and why that stops being true the day a
capability grows an object.

### 1.4 `presentConnection` cannot serve the surface that edits a connection

`PublicConnection` is `Pick<Connection, 'id' | 'label' | 'provider' | 'scope' |
'models'>` — no `baseUrl`, no `capabilities`, and correctly no `apiKey`. That is
exactly right for what a *user* sees.

**An admin editing a connection has to see what they set**, or the form is
write-only: type a base URL, save, reopen, and the field is empty. So one shape
cannot serve both readers, and the rule this plan wanted to write — *everything
goes through `presentConnection`* — is not the rule. §2.2 is what it becomes.

### 1.5 Three smaller ones, each of which changes a route

- **The filename is arbitrary.** `readConnectionsIn` accepts any `*.json` and
  takes the id from inside the file. Nothing derives one from the other, so a
  writer has to choose a convention and a delete has to *find* the file whose
  contents carry an id — a directory scan, not a path join.
- **Nothing enforces id uniqueness**, within a scope or across them.
  `resolveRole` takes the first match from a personal-first list, so a personal
  file reusing a system connection's id silently shadows it — with the user's
  own key, which is at least the safe direction, but is not a thing anyone
  chose.
- **`sessionOverride`, `stepOverride` and `hint` are plumbed into `resolveRole`
  and never passed.** `calls.ts` supplies `role`, `bindings` and `usable` only.
  Two of the five layers §5.1 names have no caller; they are P7's, and they are
  named here so that P2B's role table does not quietly present three layers as
  though they were the whole order.

---

## 2. Decisions this plan had to make

### 2.1 The install default is a real file, and `resolveRole` grows a layer

**Decided: `data/system/bindings.json`**, the same shape as a user's, read by
the same reader, layered *under* the personal one.

`resolveRole`'s order becomes `step → session → user binding → install default`,
which is [07 §5.1](../07-tech-stack.md)'s order read from the strongest end.
The hint stays where it is, applied last and weakest over whichever layer won.

Against the alternative, recorded because it is the cheaper-looking one:
**merging the two binding maps before resolution** — `{...system, ...user}` —
gives the same answer for every case that resolves, and a worse answer for
every case that does not. A merged map cannot say *why* a role resolved, so the
role table cannot show *inherited from the install* against *yours*, which is
the substance of [05 §15.1](../05-ui-surfaces.md)'s "the one place a user sees
which of their bindings are personal and which fall back to system defaults".
`ResolutionSource` already exists to answer that question and would be lied to
by a merge. **Two layers, one resolver, and the source recorded.**

Three consequences:

- **`ResolutionSource` gains a member** — `'default'` beside `step`, `session`,
  `binding` and `hint`. It is on the turn record, so this is a record shape
  change and belongs early in the phase rather than late.
- **`dangling` becomes recoverable, which is what §4.5 promised.** A personal
  binding whose connection is gone now falls through to the install default
  instead of failing the turn. `dangling` survives as the answer only when
  *both* layers fail, which is the honest remainder.
- **First-run writes it.** `defaultBindings(hi, lo)` — built at P2.1, called by
  nothing but its own test — becomes the thing that produces this file when an
  admin adds their first connection. That is the whole of *"a good one and a
  cheap one"*, finally with a caller.

### 2.2 Two shapes, and the boundary between them is the key alone

`presentConnection` stays exactly as it is and stays the **only** shape that
reaches a non-admin. Beside it:

```ts
type AdminConnection = Omit<Connection, 'apiKey'> & { hasKey: boolean }
```

Also built by picking rather than by rest-spreading, for the reason
`toPublic()` gives: a field added to `Connection` must not appear in a response
by default. `hasKey` exists because *"a key is set"* and *"no key, this is a
local endpoint"* are different states an admin has to be able to tell apart
without being shown the secret — and an empty password field cannot distinguish
them.

**The rule, corrected from what §1.4 shows this plan first wanted:** no handler
builds a connection response inline. Every one goes through `presentConnection`
or `presentForAdmin`, and **the opacity test asserts the boundary rather than
the discipline** — over every route, no response body contains `apiKey`, and no
response from a non-admin route contains `baseUrl`.

**`baseUrl` is admin-visible and user-invisible**, which is
[04 §4.5](../04-server-multiuser-deployment.md)'s *"an admin may opt to show
it"* read as narrowly as it can be. The bullet permits showing a user the URL;
this phase does not, because the admin who set it is the only person who needs
it and *may opt to* is permission, not a requirement. `providers/connections.ts`
carries a comment calling that *"a decision at P10's admin surface"*; it is this
phase's, and the comment is repaired here rather than left pointing at the wrong
phase — as is `bindings.ts`'s, which names the writer's home as P7.

### 2.3 The file is named from the id, and a delete is a scan

**Decided: `<id>.json`**, with the id remaining authoritative *inside* the file.

The filename is derived, never read — `readConnectionsIn` keeps taking the id
from the contents, so a hand-renamed file keeps working, which is the same
position [P1 §1.1](03-p1-implementation.md) takes on library slugs and for the
same reason: the path is a convenience, the id is identity. Deriving it means a
write knows where to put a file and a delete can *try* the obvious path first,
while still falling back to a scan for a file somebody named themselves.

**Ids are minted server-side as uuidv7**, not accepted from the body, which
closes §1.5's shadowing hole for anything created through the UI without
outlawing the hand-written file that already works. A duplicate id found on disk
is reported, not repaired — the library's own posture for the same collision
([P1 §1.2](03-p1-implementation.md)).

### 2.4 The writer invalidates the cache, and the seam is one function

`ProviderFactory` becomes an object with the call signature it has today plus
`invalidate(connectionId)`, and every connection write and delete calls it. A
function type was right when nothing wrote; it is not a seam that can carry a
second verb.

**Invalidate rather than clear.** Dropping the whole map on any write would be
simpler and would also throw away every *other* connection's memo, which on a
household install means one admin's edit re-creates every provider mid-turn for
everybody. A key that is gone is rebuilt on next use; that is the entire cost.

**And an in-flight turn keeps the provider it started with**, because it holds
the instance rather than re-resolving per call. That is correct and worth
writing down rather than discovering: a turn that changed endpoints halfway
through would be a worse outcome than one that finishes against the endpoint it
began on.

### 2.5 The form offers what the build can construct, and the route re-checks

`KNOWN_PROVIDERS` carries capability defaults for five names —
`openai`, `anthropic`, `google`, `openai-compatible`, `fake` — and
`factory.build()` constructs exactly one, throwing for anything but
`openai-compatible`. A form offering the five would offer four that fail at call
time, which is the worst place to find out.

**Decided, both halves:**

- **The form offers `openai-compatible` and nothing else**, which is
  [07 §5.5](../07-tech-stack.md)'s compatibility surface stated as a control
  rather than as a paragraph: *if it speaks OpenAI-compatible chat it works, and
  if it does not it does not.* An empty `baseUrl` means OpenAI's own endpoint —
  the adapter already defaults to it — so the common cases are a key with no URL
  and a URL with no key, and the form says which is which.
- **The save route validates buildability anyway**, refusing an unbuildable
  `provider` with a message naming it. Hand-written files exist and will go on
  existing; a route that trusts its own form is a route that has not met one.

The other four names stay in `KNOWN_PROVIDERS` and stay unreachable from the
form. They are capability defaults for adapters this build does not have, which
is a head start rather than a lie — and they become selectable in the phase that
builds an adapter, not before.

### 2.6 Model discovery is offered, and never required

Typing a model id from memory is the step where *"paste in one API key and take
a turn"* falls down, and OpenAI-compatible endpoints expose `GET
{baseUrl}/models`. So the form offers a **Fetch models** action beside the
field, filling a picker from the endpoint's own answer.

**It is an assist, not the path**, which is [05 §6](../05-ui-surfaces.md)'s rule
for every wizard here — Aventuras' `useSettingAsIs()` escape hatch, generalised.
The field stays free text, a failed fetch is a notice rather than a blocked
save, and an endpoint that does not implement `/models` costs the admin nothing
but the typing they would have done anyway. That matters more than it sounds:
`/models` is optional in practice, and several local runtimes answer it with
one entry called `gpt-3.5-turbo` regardless of what is loaded.

**The one thing to be careful about, named rather than waved at:** this makes
the server fetch a URL an admin supplied. On a box whose entire purpose is
pointing at `localhost:8080` and the machine next door, refusing private
addresses would break the primary use case, so it is **not** refused — the
mitigation is that the action is admin-only, explicit, and never automatic, and
the response is used only to populate a picker. That is a smaller claim than
"this is safe" and it is the true one.

### 2.7 Nothing per-account gets a writer here, and this is the reason

**The scope line, stated once so it is not renegotiated per route: P2B writes
the system scope and only the system scope.** System connections, and
`system/bindings.json`. A user's own `connections/` and their own
`bindings.json` stay exactly as they are today — read by the resolver, counted
by §2.8's delete warning, hand-written by anyone who wants one, and reachable
from no route and no form this phase adds.

That is a sharper line than *"per-user connections are deferred"*, and it is the
right one: the per-user *bindings* file has a reader and no writer too, and it
would be easy to add one on the way past on the grounds that the shape is
already there. It is the same deferral for the same reason, and §6's open
question about a route shape is about the **system** file alone.

[05 §15.1](../05-ui-surfaces.md) wants *your connections and role bindings* in
the user half — *"the one place a user sees which of their bindings are personal
and which fall back to system defaults."* It is not here, and the reason is not
scope:

- The user half only means anything for an account with `privateConnections`,
  and a surface predating the check would have been granting an ability the
  server did not enforce — **the trivial bypass
  [04 §4.5](../04-server-multiuser-deployment.md) warns about, wearing a UI.**
  *That half is discharged: [P2A §2.1](13-p2a-configuration-surface.md) moved
  enforcement into `turns/runner.ts`, where the account's real capability now
  decides what `resolveConnections` returns. What remains is the second bullet,
  which is this phase's own work rather than a dependency.*
- The **fallback display** is the substance of that bullet, and §2.1 is what
  gives it something to fall back *to*. Built the other way round it has two
  layers and one of them is always empty.

So: system connections and install defaults here; personal connections, personal
bindings and the personal-versus-system view in the phase after, or at P10 with
the rest of §15.1. The role table this phase builds is the same component, with
one of its two columns not yet populated — which is
[01 §2.2](01-work-plan.md)'s minimal demonstration rather than a placeholder,
because nothing about it is discarded when the second column arrives.

**What this costs, recorded rather than glossed:** a user who wants their own
key still hand-writes two files, exactly as today. P2B does not improve that
case at all — it makes the case where *nobody* has configured anything work,
which is every fresh install and most household ones. The household example
[07 §5.1](../07-tech-stack.md) uses is *"Dad pays for the API"*, and that is
precisely the half this phase builds.

### 2.8 Dangling bindings: the warning is here, the notification is not

[04 §4.5](../04-server-multiuser-deployment.md) says a removed system connection
leaves bindings dangling *"and the user is told to pick another"*. Two halves,
and only the first is this phase's:

- **Warning at the moment of deletion** — *"3 role bindings point at this
  connection"*, counted across every account — is an admin surface, is
  computable from what exists, and belongs here. It **warns and proceeds**
  rather than refusing: an admin revoking a leaked key must not be blocked by
  the fact that people were using it.
- **Telling the user** is a notification, `system.notice` has no producer, and
  the router is P10's. Until then §2.1's fallback is the answer — the binding
  drops through to the install default and the turn keeps working, which is a
  better outcome than a message about a failure that no longer happens.

**Counts, never contents**, in both the deletion warning and P2A's dead-end
summary. The warning needs a number; a list of who binds what to which key is a
different feature with a different justification, and nobody has asked for it.

---

## 3. Stages

### P2B.0 — The install default layer

§2.1, and it is first because it changes the turn record. `system/bindings.json`
and its layout member; `readBindings` gaining a scope; `resolveRole` gaining the
`default` layer and `ResolutionSource` gaining the member; the golden-file
suite's expectations updated for the new `via` value.

No routes, no UI. *Ends at:* a hand-written `system/bindings.json` resolves for
a user with no `bindings.json` of their own, and a personal binding whose
connection is gone falls through to it instead of failing the turn — which is
what [04 §4.5](../04-server-multiuser-deployment.md) has claimed all along.

### P2B.1 — The connection store grows a writer

`writeConnection`, `deleteConnection` and the id-derived filename (§2.3), on the
existing atomic writer and behind the existing `assertReal`; the factory's
`invalidate` (§2.4); `presentForAdmin` (§2.2). Buildability validation, so an
unbuildable provider is refused at save.

No routes. *Ends at:* every connection mutation P2B needs exists as a tested
store function, and editing one is observable in the next turn without a
restart.

### P2B.2 — The routes

Under P2A's `/api/admin` prefix, so the guard is inherited rather than
respelled: list, create, edit, delete for system connections; read and write for
the install default bindings; the delete-time binding count (§2.8); the model
fetch (§2.6).

The prefix exists now, as an encapsulated plugin with one `onRequest` hook, and
[P2A §2.4](13-p2a-configuration-surface.md) commits to never adding a
per-handler admin check — so these routes add none. Registering them inside it
is the whole of their authorisation, and the route-table test covers them the
moment they are registered.

*Tests:* the opacity test, enumerating through the route table — no `apiKey` in
any response, no `baseUrl` in a non-admin one — which is this phase's CI
contribution and the one assertion whose *coverage* must not be a hand-written
list. Its bodies are per-route and have to be; see §6.1.

*Ends at:* a connection round-trips through the API with the key never coming
back, and a binding written through a route resolves on the next turn.

### P2B.3 — The admin surface

A third section on P2A's settings route, not a new one (§6): the connections
list, the add and edit forms with their model picker, and the role table — eight
roles, what each resolves to, and which are unbound.

What it inherits rather than builds: `Field`, `NumberField`, `SelectField` and
`CheckboxField`, the last two added at P2A.6 as siblings in one file so *does
this field have assist?* keeps having one answer; `readOnlyNote`, for a field
that must show a value nobody may edit here; and `useFocusTrap`, extracted at
P2A.6 precisely so a second and third dialog would not respell it — the
delete-a-connection warning is one of them.

**And one rule to write under rather than rediscover:** the lint rule against
sentences assembled from fragments fires on exactly the shapes this section is
made of — a count with a noun after it, a label with a parenthetical. It caught
five of them in P2A.6 and was right every time. Each user-facing sentence is one
string with the value substituted in.

**The role table is the part worth getting right.** It is the only place the
resolution order is visible, and it is what turns *"why did this turn use that
model"* from a support question into a glance. It shows the resolved connection
and model per role and the layer that won.

*Ends at:* an admin can see, in one table, what every role will do.

### P2B.4 — First run, and the dead end closing

The first connection an admin saves offers to write the install defaults from it
— [07 §5.1](../07-tech-stack.md)'s *a good one and a cheap one*, with one model
answering both when only one exists. `defaultBindings` gets its first production
caller.

*Ends at:* the demo. Fresh install → admin → one key → a turn, without anyone
having opened a text editor.

**The dead-end count cannot witness that, and this stage has to fix it or drop
the clause.** `deadEnds` counts connection *files* and never reads a bindings
file, so a system connection with no bindings gives every account
`hasUsableConnection: true` while every turn fails `unbound` — the ending would
go green over an install nobody can play on. Either the count asks whether a
role actually resolves (`resolveRole('prose', …)` per account, one more file
read each) or the clause comes out and the gate's step 1 is the only witness.

### P2B.5 — Docs and drift

[The API doc](../../api.md) gains the connections and bindings routes;
`connections.ts`'s P10 comment and `bindings.ts`'s P7 comment are repaired;
[04 §4.5](../04-server-multiuser-deployment.md)'s *"no new mechanism"* sentence
is corrected against §1.2; [07 §5.1](../07-tech-stack.md)'s resolution order is
annotated with which layers have callers and which are P7's.

*Ends at:* no document describes a fallback the code does not perform.

---

## 4. Verification — the P2B exit gate

```bash
pnpm install && pnpm build && pnpm lint && pnpm test
pnpm dev    # http://127.0.0.1:8080
```

1. Fresh install → create the admin → add one connection → take a turn. **No
   file is hand-edited at any point.** *This is the demo; if any step needs a
   text editor the phase is not done.*
2. Read every connections response, including error bodies and the model-fetch
   response → no `apiKey` anywhere, and no `baseUrl` in anything a non-admin can
   reach (§2.2).
3. Edit a connection's base URL and take a turn → the new endpoint is used,
   without a restart. Delete it, create another with the same id → the new one
   is used (§2.4).
4. Delete a connection two bindings point at → the admin is told how many
   *before* confirming, the delete proceeds, and the affected roles fall through
   to the install default rather than failing (§2.1, §2.8).
5. Remove the install default too → *now* the role reports `dangling`, and the
   turn fails naming the role. **Both states are reachable and they are
   different**, which is the whole reason `resolveRole` tells them apart.
6. A user with their own `bindings.json` overriding one role → that role uses
   theirs, **four** of the rest resolve via the install default and **three**
   report `unbound`, and the role table names which layer won for each (§2.1).
   *The arithmetic is not seven-and-one:* `defaultBindings` binds five of the
   eight roles, because `image`, `video` and `speech` have no sensible text
   fallback and a binding that gave them one would fail at the call rather than
   at the setup. So the table needs a third state — **unset by design** — which
   §2.1's prose implies and P2B.3's scope does not mention.
7. Grant `privateConnections` to a user with a personal connection file on disk
   → their bindings resolve to it over the install default; revoke it → they
   return to the install default and the file is untouched
   ([P2A §2.1](13-p2a-configuration-surface.md) did the enforcing; this asserts
   it end to end).
8. Save a connection naming a provider this build cannot construct → refused at
   save time, naming the provider — not at the next turn (§2.5).
9. Point the model fetch at an endpoint that does not implement `/models` → a
   notice, the field still accepts a typed id, and the save still works (§2.6).
10. Two connections on disk claiming one id → both listed, the shadowed one
    flagged, nothing blocked ([P1 §1.2](03-p1-implementation.md)'s posture).
    **Two gaps here, both found by walking the gate.** `AdminConnection` has no
    `shadowed` field and the list route maps presenters straight over the array,
    so there is nothing for P2B.3 to render — the presenter needs one. And
    `findConnectionFile` returns the *first* file claiming an id, so
    `deleteConnection` unlinks that one alone: **a delete answers 204 while the
    connection still resolves from the second file.** §2.8 names *revoking a
    leaked key* as this case, where being told *gone* while it still works is
    the wrong answer. Decide explicitly — delete every file claiming the id, or
    refuse and name the count.
11. `pnpm test` green on ubuntu and Windows, `pnpm lint` clean, and the opacity
    test **enumerates** every route under the connections surface from the route
    table rather than from a list — and reaches a successful response on each,
    because a refusal proves nothing about what a response body carries (§6.1).

**And the standing line from [01 §2.3](01-work-plan.md): no phase exits with
configuration that has no surface.** For P2B that is step 1, and it is the only
step that matters — this phase exists because P2 could not pass it.

**Walked, 2026-08-20 — and it does not close.** Expected rather than a
finding: P2B.3, P2B.4 and P2B.5 are not built, and they own steps 1, 6 and 9
outright plus a clause each of 4, 5 and 10. Of what *is* built (P2B.0–.2), two
steps are automated and falsifiable and five are partial. Step 11's opacity
enumeration passes and now asserts a successful response on each route,
including the `DELETE`. The corrections in steps 6 and 10 and in P2B.4 above
came out of this walk; [12 §3](12-p2-manual-gate.md) collects them beside the
rest.

**What needs a person.** Steps 1 and 9 above all: every test in this repository
runs against `FakeProvider`, so *"paste in a real key and take a turn"* is
exactly the gap [12 §1.1](12-p2-manual-gate.md) already names, and P2B is the
phase where it stops being theoretical. Run it against at least one hosted
endpoint and one local runtime, because §2.6's caveat about `/models` is the
kind of thing only a real llama.cpp answers.

---

## 5. Out of scope, deliberately

Per-user connections and the personal-versus-system view in the user half
(§2.7); notifying a user that their binding dangled (P10 — the router, and §2.8
explains why the fallback makes it less urgent rather than merely deferred);
session and step overrides, which are plumbed into `resolveRole` and belong to
P7 with the mode contract that would use them (§1.5); adapters for the four
other names in `KNOWN_PROVIDERS` (§2.5); a connection health check beyond the
model fetch — *"is this key still good"* is a live call with a cost, and it
belongs with the connectivity work P10 does once P11's producer exists.

Cost attribution per connection and the per-connection queue with a concurrency
cap that [04 §4.5](../04-server-multiuser-deployment.md) raises as 2.0's
problem, **except** the one part that section says has to be right from the
start — that the queue is scoped to the connection rather than to the user.
Nothing here forecloses that; nothing here builds it either.

And the system library panel, which [05 §15.3](../05-ui-surfaces.md) lists
beside system connections and which
[P2A §2.6](13-p2a-configuration-surface.md) refuses on the grounds that it has
no admin action at 1.0. Being adjacent in a list is not a reason.

**The line most likely to erode is the role table's.** It is the first surface
in the project that shows the resolution order, and every layer that does not
exist yet — session override, step override, actor hint — is one column away
from looking like it should be editable there. It shows what resolves and which
layer won. Adding a control for a layer with no caller would build P7's UI
against P7's unwritten contract, which is the one thing
[01 §2.2](01-work-plan.md) is unambiguous about.

---

## 6. What P2A settled

Written as open questions while P2A was a plan; **P2A is built**, so this is the
answer sheet. Every row was a thing this document assumed and could not check.

| Was open | Settled |
|---|---|
| **The route shape for `system/bindings.json`** (§2.7: the system file only) — a whole document under a hash, or a map patched per role | **The whole document, with the stale check** — the lean was right, and for a reason the lean did not name. Two admins editing bindings at once is rare; the writer the check actually defends against is a **text editor**, and `bindings.json` is hand-written today and stays hand-writable by design. That is the same argument the config form's check rests on. Inherit one lesson with it: P2A's first version compared the *merged* view against the running config and refused on every container start, because `--data` and an absent file both make the running record legitimately differ from the file. Compare the document as this process read it — [P2A §2.5](13-p2a-configuration-surface.md) |
| **Where the third section lives on the settings route** | **A third section under Administration**, stacked with accounts and the install — not a tab and not its own route. P2A's admin half is a single conditional, which is what makes *absent is absent* a mechanism rather than a style: the sections do not render for a non-admin, so their hooks never mount and their browser issues no request that could be refused. A separate route would need that guard respelled, which is the thing [P2A §2.4](13-p2a-configuration-surface.md) refuses |
| **Whether `AdminConnection` wants the stale-check idiom** | **Yes**, and the reason moved. It is not worth its weight against a second admin at this scale; it is worth it against the person editing the file on disk, which is the same writer and the same argument as the row above. The cost is known now: one field on the services record and one comparison, plus the discipline of updating that field on write — P2A's second save refused its own predecessor's work until it did |
| **The dead-end count's exact wording**, shared with P2A's account list | **Written**: *"N people have no usable connection and cannot send a message."* followed by either *"No system connection is configured, so adding one fixes this for everybody."* or *"Give them their own connection, or allow them to add one."* The second clause is the one P2B changes — the whole phase is the first sentence reaching zero. Note the shape: the lint rule for assembled sentences forbids building these around the number, so each is a whole string with the count substituted in |
| ~~**Whether the connections form reuses P2A's config form machinery**~~ Answered at P2A.0 | Partly, and the useful half is the idea rather than the code. `LIVE_APPLIERS` shipped keyed like `CONFIG_TIERS`, saying per key whether anything reads it, with completeness tests in both directions and a row asserting at least one key is honestly `unread`. A connection's `capabilities` overrides are the same shape of problem — *declared* against *in force* — but against `ProviderCapabilities`, so nothing is shared but the pattern. **What transfers is the rule**: where a declaration and an implementation disagree, a table records it and the declaration moves only when the intent changes ([13 §4.3](../13-internal-contracts.md)) |

### 6.1 Two things P2A created that this plan did not anticipate

**The route-table helper is a local function, and the opacity test needs it.**
`adminRoutes()` in `routes/admin.test.ts` walks Fastify's own printed tree —
parsing the *indentation*, because children carry only the segment they add, and
the first version of it found three routes out of five while reporting that
everything was guarded. P2B's opacity test wants the same enumeration, so it
should be extracted rather than written twice; a second copy of that parser is a
second chance to get the tree wrong.

**And the opacity test cannot be the same *shape* as the guard sweep.** The
guard sweep asserts a status code, so it needs no valid body — it hits every
route with a nonsense parameter and expects 403. Opacity is a claim about a
**successful** response, and a route that answers 400 contains no `apiKey`
trivially. So the sweep enumerates and the opacity test must still supply a real
body per route, or it proves nothing about the routes it cannot reach. That is a
smaller claim than *"asserted over the route table"* and it is the true one;
§2.2's rule survives, its mechanism is half of what this plan assumed.

### 6.2 What re-reading the code after P2A confirmed

Every finding in §1 still holds, checked rather than assumed: `readBindings`
reads one path, `layout` has no system bindings member, `resolveRole` layers
three where [07 §5.1](../07-tech-stack.md) names five, `ResolutionSource` has
four members and no `default`, `ProviderFactory` is still a bare function type
with a memo and no invalidation, `PublicConnection` is still a `Pick` without
`baseUrl`, and `sessionOverride`/`stepOverride` still have no caller outside
tests. The two comments §2.2 and §3 promise to repair — `connections.ts`'s
*"a decision at P10's admin surface"* and `bindings.ts`'s *"which is P7's"* —
are both still there, and both still name the wrong phase.

**One thing checked and found absent**, so nobody goes looking: P2A's aliasing
defect has no twin here. `capabilitiesFor` spreads `CONSERVATIVE_CAPABILITIES`
and a `KNOWN_PROVIDERS` entry, which is the same shallow-spread-of-a-module-
constant shape that let one settings save rewrite `DEFAULT_CONFIG` — but
`ProviderCapabilities` is flat scalars throughout, so a shallow spread is a
complete copy and there is nothing to alias. It becomes a live question the day
a capability grows an object.

**And one thing P2A learned that costs nothing to inherit.** A closed request
body answers 400 naming the offending field now, because Ajv reports
`additionalProperties` against the *parent's* path and the error handler was
dropping the key. Every closed body in the API gained that at P2A.2, so P2B's
connection bodies get it free — and *refused rather than ignored* stays the
rule, for the reason it has always been: ignoring a field teaches a client that
it worked.
