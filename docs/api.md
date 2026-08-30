# The HTTP API

**Status: as built at P2.5.** This describes what exists, not what is
planned — where the two differ, this file is right and the design notes record
intent ([docs/README.md](README.md)).

Everything is under `/api`. Responses are JSON. The client is the only consumer
today, but nothing here is client-specific: `curl` is a first-class way to drive
it, and the P1 exit gate ([P1 §3](design/workplan/03-p1-implementation.md)) is written in
terms of it.

---

## The shape of a session

Three things have to happen before a library request will work, and the order is
forced:

1. **`GET /api/auth/state`** — the only route that works on a fresh install.
   Tells you whether to show a setup form, a login form, or the library.
2. **`POST /api/auth/setup`** (first run only) or **`POST /api/auth/login`** —
   sets two cookies: `se_session` and `se_csrf`.
3. Everything else, sending both cookies and echoing `se_csrf` in the
   `x-csrf-token` header on anything that changes something.

### First-run gating

Until an account exists, **every route except `/api/auth/state` and
`/api/auth/setup` returns `503 {"error":"setup-required"}`**. That is deliberate
([04 §5.1](design/04-server-multiuser-deployment.md)): combined with the loopback
bind default, it closes the window in which anyone on the network could claim the
install.

`/api/auth/state` survives the gate because it is how a client *learns* setup is
needed — gating the discovery endpoint behind the thing being discovered leaves
the UI with a 503 and no way to read it.

### CSRF

Double-submit: `se_csrf` is a script-readable cookie, and its value must come
back in the `x-csrf-token` header. A cross-site caller can cause the cookie to be
*sent* but cannot read it to set the header.

**Only requests carrying a session are checked.** Setup and login have no ambient
authority to abuse — forging either requires already knowing the password — and
requiring a token there would be a bootstrap paradox, since the token is issued
*by* signing in. `SameSite=Lax` covers the login-CSRF gap that leaves.

### Sessions

A signed stateless cookie, 14 days, `httpOnly` + `SameSite=Lax`. **No `secure`
flag**, because there is no HTTPS by default on a LAN and a `secure` cookie over
plain HTTP is simply never sent — login would appear to succeed and nothing would
be logged in.

Logout clears the cookie. A copy already taken elsewhere stays valid until it
expires; that is the honest cost of having no session table, argued in
`packages/server/src/auth/session.ts`.

**A password change does not end them either**, and neither does an
administrator disabling the account — for the second, the identity hook re-reads
the account on every request, so a disabled account's next call is `401` even
though its cookie is still valid. A password change has nothing equivalent: the
cookie says who, not what they knew. Anyone reaching for a password change to
shut somebody out needs to know that, which is why the settings form says so
where they are doing it.

---

## Auth

### `GET /api/auth/state`

```json
{ "setupRequired": true, "account": null, "minPasswordLength": 8 }
```

`account` is the public account shape once signed in — never `passwordHash` or
`salt`, which are built by picking fields rather than omitting them so a field
added later cannot leak by default.

```json
{
  "setupRequired": false,
  "minPasswordLength": 8,
  "account": {
    "handle": "ned",
    "displayName": "ned",
    "role": "admin",
    "enabled": true,
    "locale": "en-GB",
    "capabilities": {
      "privateConnections": true,
      "fileAccess": "none",
      "enableExtensions": false
    },
    "createdAt": 1786800000000
  }
}
```

**`privateConnections` is enforced where connections resolve** — never at the
UI, which a user with write file access can bypass
([04 §4.5](design/04-server-multiuser-deployment.md)). Revoking it stops the
account's next turn from using its own connections; the files stay on disk, and
the turn falls back to the system ones. Restoring the capability restores them.

**`fileAccess` and `enableExtensions` are recorded and gate nothing yet.** Both
name features that have not shipped — an in-UI file browser and extensions — so
the settings surface groups them apart and says the setting will apply when the
feature does, rather than presenting three switches as though they were equally
live.

**`minPasswordLength` is `auth.minPasswordLength`**, the shortest password this
install accepts where one is *set*. It is here rather than on the admin config
route because the setup form needs it before any account exists, and that route
is behind both the admin guard and the first-run gate. Unauthenticated on
purpose: it is the length of a secret rather than a secret, and the same
response already says whether this install is unclaimed. `0` means the empty
string is a valid password.

### `POST /api/auth/setup`

First run only. `{ handle, password, displayName? }` → `201 { account }`, and
signs you in. `409` once an admin exists. A password shorter than
`minPasswordLength` is `400 invalid`, naming `/password` in `issues`.

`handle` becomes a directory name, so it is validated hard: lowercase letters,
digits and hyphens, 1–63 characters, not ending in a hyphen, and not a Windows
reserved device name.

`locale` is defaulted from `Accept-Language`.

### `POST /api/auth/login`

`{ handle, password }` → `200 { account }` or `401 {"error":"invalid-credentials"}`.

**One answer for a wrong password, an unknown handle and a disabled account.**
The caller cannot tell which, which costs nothing here and avoids a handle
oracle.

**No length rule applies here, deliberately.** An empty password is a legitimate
request — legal wherever `auth.minPasswordLength` is `0`, and possible on any
install, since `--reset-password` honours no minimum — and it is answered `401`
like any other wrong password. A `400` would refuse a password that is genuinely
correct, and would turn this route into a way to read the install's rule.

### `POST /api/auth/logout`

`204`. Clears both cookies.

---

## Library

`:kind` is a **folder name**, not a schema id: `actors`, `lorebooks`, `treatments`,
`setups`, `presets`, `packages`. An unknown kind is `404` and the message lists
the known ones.

**And it is checked.** Posting an object to the wrong kind is `400`, naming both
what you sent and where you sent it — both halves came from the caller, so
saying so discloses nothing. Reaching an existing object through the wrong kind
is `404`, the same answer as another user's object and for the same reason:
that collection does not hold that id, and "wrong kind" would confirm it exists
somewhere.

These are **one handler set, not six**. The registry makes it kind-agnostic —
every portable object self-describes, so nothing enumerates kinds
([10 §9](design/10-schemas.md)). Adding a kind should not touch the routes.

**No route takes a handle.** Every one resolves its root from the session,
because the path is the owner ([04 §4.3](design/04-server-multiuser-deployment.md)).
Another user's object is `404`, not `403` — confirming the id exists would leak
the one fact the separation exists to keep.

### The object envelope

Every read returns:

```json
{
  "id": "0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b",
  "schema": "storyengine.lorebook/1",
  "name": "Rain City",
  "slug": "rain-city",
  "source": "user",
  "contentHash": "sha256:…",
  "shadowed": false,
  "object": { "...": "the portable object itself" }
}
```

- **`source`** is `"user"` or `"system"`. The list merges a user's library with
  `system/library/`, which ships empty at P1 — the merge is a query rather than a
  special case. The badge needs a second channel beyond colour
  ([05 §5](design/05-ui-surfaces.md)).
- **`shadowed`** means another file holds this id at a lexicographically earlier
  path ([P1 §1.2](design/workplan/03-p1-implementation.md)). Both are listed; the shadowed
  one carries a warning. Copying a folder is a feature, so this never blocks.
- **`slug`** is the folder name, frozen at creation. **Nothing *writes* by it
  and no reference between objects uses it** — resolve by `id`. The one
  exception is reading a duplicate, below.

### `GET /api/library` and `GET /api/library/:kind`

`{ "objects": [ …envelope ] }`, sorted by name. The first is every kind at once.
The kind is a path segment rather than a mode: one handler set answers both, and
the unfiltered form exists because cross-kind queries — search, counts, an
export sweep — are a real thing to want. It is not a claim about the UI, which
browses per kind ([05 §5](design/05-ui-surfaces.md)).

### `GET /api/library/errors`

`{ "errors": [ { path, source, kind, slug, reason, detail, seenAt } ] }` — the
files that sit where an object should and cannot be read as one.

Static, so it is not a `:kind`; `errors` is not a library directory either.

`reason` is `unparsable` (the bytes are not JSON, or not a card), `wrong-kind`
(it parses, but declares another schema or has no id), or `schema` (it is that
kind and fails validation). `detail` is the parser's or the validator's own
complaint, which is the part anyone can act on. `path` is **relative to the data
directory**: the client needs to know which file, not where the server keeps its
disk.

This exists because the alternative was silence. A hand edit that breaks a file
is skipped by the index — the last good version stays readable and the write
path refuses to overwrite bytes it cannot read — but until this route the person
who saved the file got no error, no toast, and a stale object
([02 §5.1](design/02-data-model.md)). An entry clears when the file parses again,
or when it is deleted.

### `POST /api/library/:kind`

Body is the portable object, or `{ object }`. → `201 { id, slug, contentHash, object }`.

The slug is derived from `name` here, once, and then frozen. Duplicates get a
numeric suffix from `-2`.

**Read-after-write is guaranteed**: a `GET` immediately after this reflects it.
The server indexes its own writes synchronously; the watcher is only for foreign
ones ([02 §5.1.1](design/02-data-model.md)). If it ever needs a retry, something
is wrong.

### `GET /api/library/:kind/:id`

The envelope, plus an `ETag` header equal to `contentHash`.

**`?source=&slug=` reads one specific copy of a duplicated id.** Without it, an
id resolves to the winner — the earlier path — which is right for every
ordinary reference and wrong for exactly one case: the list shows both copies
and flags the loser, and the loser needs an address or the warning points at
nothing. An address that matches no row is `404`, including one that names the
`system` source for a user's object.

Three things it deliberately is not. It is **read-only**: no write takes it, so
a `PUT` still resolves to the winner and a duplicate stays a warning rather than
becoming a fork. It is **not the canonical address**: an object is its id, and
this narrows a read the way a filter does. And it is **`slug`, not the path** —
the stored path is the native absolute one and differs by platform, while the
folder name is the same string everywhere.

### `PUT /api/library/:kind/:id`

Body `{ object, contentHash? }`. The hash you last read must be presented, as
either the `If-Match` header or `contentHash` in the body. Header is the HTTP
spelling and preferred; the body field exists because a hand-written `curl` in
the exit gate should not need one.

- `200 { contentHash, object }` on success — the hash is new, keep it.
- `428 {"error":"hash-required"}` if you sent none.
- **`412 {"error":"stale", "current": …envelope}`** if the object moved since you
  read it.
- **`409 {"error":"diverged"}`** if the file on disk cannot be read at all.

**The 412 is the interesting one.** It carries the *current* object so the UI can
offer reload-and-reapply or save-as-a-copy rather than guessing
([04 §4.4](design/04-server-multiuser-deployment.md)). It is also the only defence
the hot-reload thesis has against silently eating a hand edit — the likelier
conflict is not two tabs but one tab and a text editor.

**There is no rename route.** Changing `name` is an ordinary `PUT`. The folder
keeps the slug it was born with, and the engine never moves a user's directories
([P1 §1.1](design/workplan/03-p1-implementation.md)).

**The 409 exists because these used to be the same answer, and that answer could
not terminate** (P2C finding 8). *The file changed* and *the file broke* are both
"the bytes are not what the index thinks", and both were `412 stale` carrying the
index row — whose hash is the one the caller just presented. Three tries, three
identical 412s, and a text editor as the only exit. Now they part: a readable
edit is still `412`, and **its envelope describes the file rather than the index
row**, so the hash differs from the one you sent and reload-and-reapply works at
once instead of after the watcher settles. Unreadable bytes are `409 diverged`
with no envelope, because handing back the stale row is what invited the retry.

An object cannot change its `id` or its `schema`. System-owned objects are
`403 {"error":"read-only"}` — copy-to-my-library is the intended move.

### `GET /api/library/:kind/:id/rows`

The index rows behind the object — the workbench's projection
([P3 §7.4](design/workplan/05-p3-implementation.md), decided: best-effort,
every row).

```json
{
  "rows": [
    {
      "path": "users/ned/library/lorebooks/rain-city/lorebook.json",
      "source": "user",
      "slug": "rain-city",
      "name": "Rain City",
      "schema": "storyengine.lorebook/1",
      "contentHash": "sha256:…",
      "shadowed": false,
      "tombstonedAt": null
    }
  ]
}
```

Every row the index holds for the id: the winner first in portable-path order,
shadowed copies, and any row inside its tombstone settling window
(`tombstonedAt` in epoch milliseconds, `null` for a live row). Paths are
portable — root-relative, `/`-separated — never native ones. **Best-effort,
not a contract**: the index's tables are an implementation detail
([13 §5](design/13-internal-contracts.md)) and its migration policy is
drop-and-rescan, so after an index schema bump this route may return less
until the surface catches up. Read-only; the object's contents stay the read
route's answer.

### `DELETE /api/library/:kind/:id`

Hash-checked the same way: deleting something a second tab has edited is the same
mistake as overwriting it, and rather more final. → `204`.

**A hand edit underneath refuses this too — unless the file is damaged.** A
readable edit that landed since you read the object is worth protecting, and
answers `412` like a `PUT`. Bytes the loader cannot read are not: that file used
to be **undeletable as well as unwritable**, so the one object a person most
needs to remove was the one this refused to remove (P2C finding 8). The
`If-Match` check still carries the meaning that matters — *you are deleting what
you were shown* — and the move is reversible through trash and version history
([02 §10.2](design/02-data-model.md)), which is why refusing was the more
destructive option of the two.

### `GET /api/library/:kind/:id/avatar`

The stored bytes of an actor's `card.png`, as `image/png` with an `ETag` of the
content hash. Actors only — no other kind has an image that *is* the object —
so any other kind is `404`.

---

## Version history

Every write that changes something snapshots the state it replaced, automatically
([02 §11](design/02-data-model.md)). A no-op write records nothing. History
lives inside the object's own folder (`history/index.jsonl` plus
content-addressed payloads), so it travels with the folder and survives an index
rebuild. Hand edits get history too: the watcher snapshots the previous state
before re-indexing a foreign change, with source `external`.

### `GET /api/library/:kind/:id/history`

```json
{
  "versions": [
    {
      "id": "0199…",
      "digest": "sha256 hex of the payload",
      "revision": 2,
      "authoredAt": "2026-08-15T02:55:47.584Z",
      "recordedAt": "2026-08-15T03:10:02.114Z",
      "source": { "kind": "manual" },
      "reason": "",
      "authorVersion": null,
      "pinned": false
    }
  ]
}
```

Newest first. `revision` is append order, oldest = 1 — computed for display,
never stored ([02 §11.5](design/02-data-model.md)). `authoredAt` is when the
snapshotted state was *written*, not when it was replaced, so a restored
version keeps its real date. `source.kind` is one of `manual`, `external`,
`restore`, `assist`, `extension`, `import` — the last three have no writers
until their phases.

### `GET /api/library/:kind/:id/history/:versionId`

`{ version, object }` — the record plus the snapshotted object itself.

### `POST /api/library/:kind/:id/history/:versionId/restore`

An ordinary write wearing a route: hash-checked exactly like `PUT` (`If-Match`
or `contentHash` in the body), and it snapshots the current state first — so
going back never destroys what you were on. Restoring the state you are already
on is a no-op and records nothing. → `200 { contentHash, object }`, the same
shape as `PUT`, so a client treats it exactly as a save.

### `PATCH /api/library/:kind/:id/history/:versionId`

Body `{ reason?, pinned? }` — rename an entry, or pin it so retention pruning
never takes it ([02 §11.3](design/02-data-model.md)). → `200 { version }`.

Retention: history is pruned to `history.keepPerObject` (default 50) per
object, oldest unpinned first.

---

## Search

### `GET /api/search?q=&limit=`

`{ "objects": [ { id, schema, name, slug, source } ], "turns": [ { turnId, sessionId, sessionName, branchId, segment, offset } ] }`

Full-text across both, because a person looking for *the cathedral* does not know
or care whether they wrote it in a lorebook or said it in a turn.

`q` is FTS5 syntax and a query it cannot parse — an unbalanced quote, a bare `*`
— is `400 invalid` rather than a 500: it is the caller's to fix.

**Turn text is what was typed and what came back**, not the assembled prompt. A
search that matched the blocks would return every turn in a session the moment a
lorebook entry used the word. **Archived sessions are searched**; they are hidden
from the default list, not gone ([02 §10.3](design/02-data-model.md)), and a
search that skipped them would make archiving a quiet way of losing things.
Trashed ones are not.

API only at P2 — the UI is P3's ([05 §4](design/workplan/05-p3-implementation.md)).

---

## Sessions

### `POST /api/sessions` · `GET /api/sessions?archived=true`

`{ name, mode?, preset?, cast? }` → `201 { session }`, and a list. **`archived`
is the string `"true"`, not a boolean** — see the note under the turn routes.

`cast` is `{ persona: string | null, actors: string[] }`, at most 32 actors.
Both it and `mode` are optional, and both arrived at P2.6 — they are what makes
a preset reachable from a session rather than only from a fixture.

**`preset` is a library preset's id, copied instead of the mode's default**, and
it arrived at P4.1 for one reason: a library full of imported presets that no
session can play is a library nobody can evaluate. Omitted, a session gets the
mode's default exactly as before. `422 unknown-preset` when there is no such
preset — falling back would hand somebody a different prompt pack than they
asked for and say nothing, which is what an unknown `mode` is refused for below.
Another account's preset is `422` too, by way of a `404` inside: the path is the
owner, and confirming an id exists elsewhere leaks the fact that separation
exists to keep.

**`preset.modes` is not checked**, deliberately. It is advisory — a preset
written for a mode you do not have still imports, still shows, and still plays
if you insist ([10 §8.2](design/10-schemas.md)) — and turning a hint into a gate
would be worst in exactly the phase that fills a library with other people's
presets.

**Copied, never linked**, like the default it replaces: the session owns its
prompt pack from creation, so editing the library's copy never rewrites a game
in progress ([02 §8](design/02-data-model.md)). Browsing, previewing and
switching mid-session remain P7's surface.

**An unknown `mode` is refused here rather than resolved to the default.** The
runner falls back for a session *already* playing a mode this build does not
know — somebody else's story, which should still open
([00 §3.3](design/00-stance.md)) — but naming a mode that does not exist when
creating one is a caller error, and silently substituting would produce a
session that is not the one that was asked for.

### `PUT /api/sessions/:sessionId/cast`

`{ persona, actors }` → `{ session }`. `422 too-many-actors` when the session's
mode seats fewer than the list names.

**Ids, not objects.** A cast entry is a link resolved fresh every turn, so
improving a character card reaches an ongoing game — the asymmetry with the
copied preset is deliberate ([02 §8](design/02-data-model.md)).

### `GET /api/sessions/:sessionId`

`{ session, activeJob | null }`. The job travels with the session because a
client reloading mid-turn needs to know there *is* one before it decides whether
to open a stream or offer an input box.

A session that is not there and one that is not yours are the **same 404**. The
path is the owner ([04 §4.3](design/04-server-multiuser-deployment.md)), and
confirming an id exists elsewhere would leak the one fact that separation keeps.

### `PATCH /api/sessions/:sessionId` · `DELETE /api/sessions/:sessionId`

`{ archived: boolean }` toggles archive — hidden from the default list, fully
intact, restorable, never swept. `DELETE` answers `204` and **moves the folder
to the user's trash** rather than erasing it ([02 §10.3](design/02-data-model.md)); a
session's turns are its history, and deletion is a move.

### `GET /api/sessions/:sessionId/turns?limit=`

`{ turns }` — the path from the head, **oldest first**, not every turn in the file. A
session is a tree that P2 happens to use linearly, and a transcript is one walk
of it.

### `POST /api/sessions/:sessionId/turns`

```
{ idempotencyKey, headTurnId: string|null, input: { text, actorId?, kind? }, guidance? }
```

→ **202** `{ jobId, turnId, parentTurnId, status, cursor, stream }` when the turn
is reserved; **200** with the same body when the idempotency key already names a
job; **409 `busy`** carrying the active `job`; **412 `stale-head`** carrying the
current `head`.

Both refusals carry what a client needs to recover. A bare "no" leaves a UI able
to offer only *try again*, which produces the same "no".

**`guidance` is its own field and is never concatenated into `input.text`.**
That is the entire point of the guidance slot
([03 §5.1](design/03-modes-and-turn-pipeline.md)): typed into the action it lands in history
permanently, is summarised as narrative, is scanned by keyword matching, can be
read back as dialogue, and appears in exports — none of which the person typing
it intended. It is also **advisory**: it may shape prose and can never reach a
call that produces effects (§5.2), which the engine enforces structurally rather
than by convention.

**A query-string number or boolean is a string here.** This server replaced
Fastify's validator with the storage layer's Ajv, which does not coerce (F2) —
so `?limit=10` against `Type.Integer()` is rejected as *must be integer*. The
schemas say what is actually on the wire.

### `GET /api/sessions/:sessionId/turns/:turnId`

`{ turn }`, or `404 {"error":"not-found","message":"No such turn."}`. One turn
without the transcript riding along — `GET /turns` costs about 10.8 KB a turn
and walks the whole path, and the workbench wants one turn, including one the
head has passed. The lookup is scoped to *this* session inside the store, so a
bare turn id cannot confirm existence across the ownership boundary: a turn in
somebody else's session is the same `404` as one that never existed.

### `POST /api/sessions/:sessionId/preview`

```
{ input?: { text, actorId?, kind? }, guidance? }
```

What this turn **would** assemble to, if it were taken now — the stateless
preview ([P3 §1.6](design/workplan/05-p3-implementation.md)). → `200 { preview }`.

```json
{
  "preview": {
    "state": "assembled",
    "headTurnId": "0199…",
    "pendingInput": true,
    "stepId": "se.narrate",
    "callKind": "narrate",
    "purpose": "prose",
    "resolved": { "connectionId": "0199…", "modelId": "…" },
    "blocks": [],
    "budget": {},
    "notFilled": []
  }
}
```

**It writes nothing**: no job is reserved, no draft is checkpointed, no turn is
appended, and no hand edit is reconciled — the last of those deliberately, since
reconciliation appends a divergence turn and this route is called every time
somebody pauses typing. `POST` rather than `GET` because the body carries up to
100 000 characters of prose, which does not belong in a URL.

`input` is optional: its absence is *nothing typed yet*, which is what the
context meter shows at rest. There is no `headTurnId` — the preview assembles
against the session's current head and echoes back which one that was.
`pendingInput` says whether an action or guidance was supplied, which is how the
workbench decides between showing the composed turn and the last committed one.

When no model resolves for the prose role the answer is still `200`, in its
other arm — because *nothing is bound* is a true answer to *how full is the
context*, not a refused request:

```json
{ "preview": { "state": "unmeasurable", "reason": "role-unbound", "notFilled": [] } }
```

`reason` is `role-unbound`, `role-dangling` (a binding whose connection is gone)
or `no-prose-step`. `notFilled` rides on **both** arms: *why is there no lore in
this prompt* is answerable without a model.

### `POST /api/sessions/:sessionId/jobs/:jobId/cancel`

`202`, or `409 finished` if the turn is already over. Cancelling **commits a
failed turn** with whatever it produced — it does not abandon the job, because an
abandoned job writes no turn at all and a stop after real prose had arrived would
make it silently never have happened.

### `GET /api/sessions/:sessionId/stream`

`text/event-stream`. Frames:

```
event: snapshot     { sessionId, job, turn, text, cursor }   once, at open
id: <jobId>.<seq>
event: progress     { jobId, seq, key, params, at }          durable, sequenced
event: delta        { jobId, text }                          ephemeral — no id
event: overflow     { cursor }                               then the stream ends
event: error        { error }                                a class, never a message
: keepalive
```

Resume with `?after=<jobId>.<seq>` or the `Last-Event-ID` header a browser
resends by itself. The cursor is **exclusive** — it names the last event you
have — and an unparseable one is treated as *absent* rather than rejected, so a
bad `Last-Event-ID` cannot brick a reconnect.

`progress` keys are [04 §3.3](design/04-server-multiuser-deployment.md)'s vocabulary:
`turn.started`, `step.started`, `step.skipped`, `step.failed`, `step.finished`,
`call.started`, `call.streaming`, `call.finished`, `effect.applied`,
`turn.finished`. They are **structural** — the client renders them — and carry a
failure *class*, never a provider's words.

`effect.applied` carries `{ channelId, accepted, reason }`, where `reason` names
the policy that refused — the same class the turn record keeps
(`engine-computed`, `user-only`, `unknown-channel`, open for an extension's own)
— and is `null` when the effect applied. Added at [P3.5] so the live view and
the record cannot disagree about *why* something was refused.

**Deltas are not durable and carry no id.** A reattach may see coalesced text
rather than every delta that painted it live, which [P2 §2.10](design/workplan/04-p2-implementation.md)
states as the trade; the snapshot's `text` is what makes that lossless.

The stream authenticates by cookie and requires no CSRF header, because that is
what `EventSource` can do — it sends cookies and cannot set headers. Nothing may
later add a header requirement to this route.

---

## Providers, and what "supported" means

There are no provider routes yet — P2.5 is where a turn is submitted — but the
compatibility surface is a decision rather than a gap, and it is stated here
because it is the kind of thing people should read rather than discover:

> **If it speaks OpenAI-compatible chat, it works. If it does not, it does not.**

There is no raw-completion path, no instruct templates, no context templates and
no stop-sequence machinery ([07 §5.5](design/07-tech-stack.md)). A local model
is a connection with a `localhost` URL and no key — llama.cpp, Ollama, vLLM, LM
Studio and KoboldCpp all expose the same shape. A completion-only service needs
a translating proxy in front of it, which is an off-the-shelf thing to point at
rather than a path this server maintains.

**Connections are usable but never readable.** A user sees a label, a provider
type and which models it offers. Not the key, and not the endpoint URL — which
can itself carry a token or name a private host
([04 §4.5](design/04-server-multiuser-deployment.md)). There is no
copy-to-my-library for a connection, because copying would mean copying the
credential.

---

## Settings

Everything a signed-in person may change about themselves
([05 §15.1](design/05-ui-surfaces.md)). Roles, enabled flags and capabilities are
somebody else's business and live under Administration.

### `GET /api/me` · `PATCH /api/me`

`{ "account": …PublicAccount }`. The patch takes `displayName` and `locale`, and
**nothing else** — a body carrying `role`, `enabled` or `capabilities` is
refused with `400 invalid`, naming the field.

Refused rather than ignored, deliberately. Stripping the field and answering
`200` teaches a client that the request worked; the next version of it sends the
field on purpose, and the version after that depends on it.

`locale` is nullable, and `null` is a real state distinct from `""`: it means
*no preference*, and the client formats with the browser's.

### `POST /api/me/password`

`{ currentPassword, newPassword }` → `204`. The current password is wrong →
`401 invalid-credentials`; the new one is shorter than
`auth.minPasswordLength` → `400 invalid`, naming `/newPassword` in `issues`.

The length is checked **before** the current password is verified, so a request
that is wrong in both ways answers `400` rather than `401`. Neither field carries
a minimum in the schema: an account whose password is empty — legal at
`minPasswordLength: 0`, and reachable on any install through the console reset —
must be able to change it.

**This does not sign out other browsers.** Sessions are signed stateless cookies
with no denylist, so nothing can revoke one that is already issued — a copy taken
elsewhere stays valid until it expires. The settings form says so where somebody
is changing a password, because the reason they are usually doing it is that they
want exactly the opposite.

### `GET /api/me/prefs` · `PATCH /api/me/prefs`

`{ "prefs": { …namespaced keys } }` — client preferences, stored in
`users/<handle>/prefs.json` ([06 B13](design/06-open-questions.md), resolved).

A patch **merges shallowly** and `null` **deletes**. The response is the whole
document rather than an acknowledgement, so a client lands on the truth rather
than on its own guess — which is what makes the one optimistic mutation in the
client safe to be optimistic about. A whole-document write would make two open
tabs a lost update.

**The server does not interpret what it holds.** A key it has never heard of is
stored and returned unchanged, so a preference the client stops using rots
quietly rather than needing a migration, and a newer client can store one an
older server does not know. What it does enforce are *bounds, not validation*: a
key must be namespaced (`library.density`, not `density`) and the document has a
size cap. Those exist because an unvalidated store is otherwise an unbounded
write surface for any signed-in account. A bad key is `400 invalid`; too large is
`413 too-large`.

---

## Administration

Everything under `/api/admin` needs an administrator, enforced by **one
`onRequest` hook on the prefix** rather than a check per handler — two spellings
of a guard is how the second one gets missed
([P2A §2.4](design/workplan/13-p2a-configuration-surface.md)).

- **`401 unauthenticated`** for an anonymous caller.
- **`403 forbidden`** for a signed-in non-admin. Deliberately *not* the library's
  404-for-another-user's-object: that hides whether an id exists, which is worth
  hiding, while `/api/admin` is a fixed path whose existence is not a secret —
  and a 404 would leave a client unable to tell *this build has no admin API*
  from *you are not an admin*.
- Identity, CSRF and the setup gate all run **before** it, so a state-changing
  call with no token answers `403 csrf` rather than `forbidden`, and every admin
  route is `503 setup-required` before an install has an administrator.

### `GET /api/admin/accounts`

```json
{
  "accounts": [ { "…PublicAccount": true, "hasUsableConnection": false } ],
  "withoutUsableConnection": 2,
  "systemConnectionCount": 0
}
```

**Counts, never contents.** The warning
[04 §4.5](design/04-server-multiuser-deployment.md) commissioned — *"2 users have
no usable connection"* — needs a number, not a list of what somebody has
configured. A connection stays opaque, so nothing here names one.

An account has a usable connection **if `prose` resolves for it** — the turn's
own question, asked through the turn's own resolver, so the capability above is
honoured by the same code that honours it at call time.

*This counted connection **files** until
[P2B](design/workplan/14-p2b-provider-configuration.md).4, and that could not
witness what the warning is for: a system connection with nothing bound to it
made every account read as fine while every turn failed `unbound`. Corrected
rather than patched — a key on disk that no binding points at is exactly the
dead end this number exists to name.*

So: a connection has to exist, something has to be bound to it at either layer,
and the account has to be allowed to use it. Revoking `privateConnections` puts
somebody holding only a personal connection back in the warning without touching
a file; so does removing the connection an install default points at, which is
`dangling` rather than `unbound` and is a different sentence in the role table.

`systemConnectionCount` is still a file count, and stays one on purpose: it is
what decides which second sentence the warning uses — *no system connection is
configured, so adding one fixes this for everybody* against *give them their own
connection*.

### `POST /api/admin/accounts`

`{ handle, password, role, displayName?, locale?, capabilities? }` →
`201 { account }`. A duplicate handle is `409 exists`. Unknown fields are refused,
the same way `/api/me` refuses them. A password shorter than
`auth.minPasswordLength` is `400 invalid`, naming `/password`.

The library directory is created with the account, so `ls data/users/<handle>/`
works immediately rather than after their first write.

### `PATCH /api/admin/accounts/:handle`

Everything `/api/me` takes, plus `role`, `enabled` and `capabilities`.
Capabilities **merge**, so a form sending one switch does not clear the other
two, and a newer build's capability survives an older client's patch.

`enabled: false` is how an account is disabled, and it needs no route of its own.
Their data is untouched and their next request is `401` — the identity hook
re-reads the account rather than trusting the cookie.

### `POST /api/admin/accounts/:handle/password` · `DELETE /api/admin/accounts/:handle`

`{ newPassword }` → `204`, and a `DELETE` → `204`. A password shorter than
`auth.minPasswordLength` is `400 invalid`, naming `/newPassword`. The console's
`--reset-password` is the one path that honours no minimum at all.

A reset does **not** re-enable a disabled account: an administrator who disabled
somebody and then reset their password should not have undone the disablement by
accident. Re-enabling is a `PATCH`, which is a separate thing to decide and
therefore a separate thing to do.

**Deleting moves rather than erases.** `data/users/<handle>/` goes to
`data/removed/<handle>-<suffix>/`, which no sweep touches — it is per-user
retention and this is not a user any more. StoryEngine will not delete it; remove
that folder yourself when you are sure. The handle is free for reuse
immediately, and a new account with that name sees none of the old data.

### Nobody can lock the install out

Demoting, disabling or removing the **last usable administrator** is
`409 last-admin`. One predicate covers all three, because they are one failure
wearing three faces.

*Usable* is the load-bearing word: an install whose only administrator is
disabled is locked out exactly as thoroughly as one with none, and that is a
state somebody can otherwise reach in one click while the account list still
shows an administrator.

409 rather than 403: the request is well formed and the caller is permitted — an
administrator may demote an administrator, just not the last one — so what
refuses it is the state of the install.

### `GET /api/admin/config` · `PUT /api/admin/config`

```json
{
  "config": { "…the running config": true },
  "path": "/data/config.json",
  "tiers": { "server.port": "restart", "log.level": "live" },
  "appliers": { "log.level": "applied", "limits.maxUploadMb": "unread" },
  "bounds": { "server.port": { "minimum": 1, "maximum": 65535 } },
  "pendingRestart": []
}
```

**The tier table travels as data.** The client may not import from the server
package, and a duplicated copy would falsify
[13 §4](design/13-internal-contracts.md)'s claim that the annotation *is* the
source — so a key a newer build adds renders with the right badge without a
client release. `appliers` is the honest half beside it: a tier says what a key
is *for*, and this says whether anything reads it yet. The two are allowed to
disagree, and the form puts the `unread` ones in a group that says so rather than
telling somebody a change took when it was only stored.

`bounds` is the same argument applied to the numeric constraints, and it is
derived from the schema rather than written down twice: it carries `minimum` and
`maximum` for every numeric key that declares one, so the form's inputs refuse an
out-of-range value before a save has to. A key with neither bound is absent
rather than present-and-empty.

`PUT` takes `{ config }`, a whole document rather than a patch.

- **Unknown keys in the body are dropped**; the write picks the keys this build
  knows rather than trusting what arrived. A key the caller invents never reaches
  disk — not because it was rejected, but because nothing looked at it.
- **Unknown keys in the file are preserved.** A newer build's key may
  legitimately be there, and eating it would make a downgrade destructive.
- A value the schema refuses is `400 invalid` and **nothing is written**: the
  document is validated by the same function the server boots on, so a save
  cannot leave a file the process will not start on.

### The stale check

A config file that has changed on disk since this server read it answers
`412 stale`, carrying `current` (what the file means) and `currentDocument` (what
it says). That is what makes the form safe against a text editor without a
watcher — [04 §6.2](design/04-server-multiuser-deployment.md)'s hot-reload claim
is about *content*, and config is explicitly not content.

Compared against the file as this process read it, not against the running
config: `--data` overrides `dataDir` after the load, and an install with no
config file runs entirely on defaults, so comparing the merged view would report
a hand edit on every container start.

**A file that will not parse does not block a write that fixes it.** Refusing
there would trap an administrator inside the problem they are trying to leave,
with the settings form as the one tool that could repair it and the one tool that
will not.

### `GET /api/admin/connections`

```json
{
  "connections": [
    {
      "id": "0199…",
      "label": "The house key",
      "provider": "openai-compatible",
      "scope": "system",
      "models": ["gpt-hi", "gpt-lo"],
      "baseUrl": "https://api.openai.com/v1",
      "hasKey": true,
      "shadowed": false,
      "contentHash": "sha256:…"
    }
  ]
}
```

**The system scope, and only the system scope.** A user's own `connections/` is
read by the resolver, counted by the delete warning, hand-written by anyone who
wants one, and reachable from no route here
([P2B §2.7](design/workplan/14-p2b-provider-configuration.md)).

**Two shapes exist and the boundary between them is the key alone.** What a
non-admin can reach carries a label, a provider and its models
([04 §4.5](design/04-server-multiuser-deployment.md)); this adds `baseUrl`,
because a form that cannot show the URL back is a write-only form — type it,
save, reopen, and the field is empty.

`hasKey` rather than the key, and not because the key is merely hidden: *a key
is set* and *no key, this is a local endpoint* are different states an
administrator has to tell apart, and an empty password box cannot distinguish
them. Without it the form would either mangle the stored key or make somebody
retype it on every edit.

`shadowed` means an earlier file in resolution order already claims this id, so
nothing will ever resolve to this one. Both are listed and nothing is blocked —
[P1 §1.2](design/workplan/03-p1-implementation.md)'s posture — but the one that
loses says so, or an administrator edits the copy nothing reads and watches the
change do nothing.

### `POST /api/admin/connections` · `PUT /api/admin/connections/:id`

```json
{
  "label": "The house key",
  "provider": "openai-compatible",
  "apiKey": "sk-…",
  "baseUrl": "https://api.openai.com/v1",
  "models": ["gpt-hi", "gpt-lo"],
  "capabilities": { "maxContextTokens": 32768, "reportsUsage": true }
}
```

**Ids are minted server-side and never taken from the body**, which closes the
shadowing hole for anything created through the UI without outlawing the
hand-written file that already works.

**`apiKey` absent means keep what is stored; an explicit empty string clears
it.** That is what makes `hasKey` workable as a form affordance, and the write
honours it — otherwise editing a label would silently delete the credential.

**`capabilities` is optional and works the same way**: absent keeps what is
stored, and it is merged rather than replaced, so an override written by hand for
a capability the form has no control for survives a save. It was undocumented
here until P2C, which meant the only way to find it was to read the route — and
the settings form now offers the two an operator has a reason to set.

Those two are `maxContextTokens` and `reportsUsage`, and they are the two only
the operator can know: **this build assumes a conservative context window**, and
an endpoint that does not count tokens will make every figure in a turn record
null. The rest of the capability shape travels untouched.

**A provider this build cannot construct is refused at save**, `400 unbuildable`,
naming it. `KNOWN_PROVIDERS` carries capability defaults for five names and one
adapter ships, so a connection naming `anthropic` would otherwise store cleanly
and fail at the next turn — the worst place to find out. The form offers only
what can be built and this refuses the rest anyway, because a route that trusts
its own form is a route that has not met one.

`PUT` additionally **requires** `contentHash`, and answers `412 stale` carrying
`current` (the connection as it is now) and `contentHash` (what to present to
get through). The writer this defends against is a text editor rather than a
second administrator: `connections/` is hand-editable by design. An id nothing
claims is `404`, not `412` — a 412 there would send a form looking for something
to reload that is not there.

An edit writes back to the file it came from rather than to `<id>.json`. A
hand-named `house.json` stays where it is; deriving the path would create a
second file claiming the same id and lose the key stored in the first.

### `DELETE /api/admin/connections/:id`

`204`, and **every file claiming that id is removed**, not the first one found.
The case is an administrator revoking a leaked key
([P2B §2.8](design/workplan/14-p2b-provider-configuration.md)) — being told
*gone* while the connection still resolves from a second file is the worst
answer available there. Refusing until the directory is tidied by hand is the
other consistent choice and blocks at exactly the wrong moment.

### `GET /api/admin/connections/:id/bindings`

`{ "bindings": 2 }` — how many bindings, across the install defaults and every
account, point at this connection.

**Warns and proceeds**, never refuses: an administrator revoking a leaked key
must not be blocked by the fact that people were using it. And **counts, never
contents** — a list of who binds what to which key is a different feature with a
different justification and nobody has asked for it.

### `POST /api/admin/connections/models`

`{ "baseUrl": "…", "apiKey": "…" }` → `{ "models": ["gpt-hi"] }`, or
`401 unauthorized` when the endpoint refused the key, or `502 unreachable` for
everything else. The two are distinct because their remedies point in opposite
directions: *unreachable* sends an admin to the URL and the network, and the
one case where that is exactly wrong is the endpoint answering perfectly well
that the key is bad. Either way the body carries a class and never the
endpoint's own words — those can echo the key being refused.

**An assist, not the path.** Typing a model id from memory is where *paste in one
API key and take a turn* falls down, so this fills a picker from the endpoint's
own `GET {baseUrl}/models`. A failed fetch is a notice rather than a blocked
save, the model field stays free text, and an endpoint that does not implement
`/models` costs the administrator nothing but the typing they would have done
anyway. `/models` is optional in practice, and several local runtimes answer it
with one entry called `gpt-3.5-turbo` regardless of what is loaded.

A shape this build does not recognise is an empty list rather than an error: it
is the one response in the server that comes from a host an administrator named
and nobody vetted.

**This makes the server fetch a URL somebody supplied, and private addresses are
not refused.** On a box whose whole purpose is pointing at `localhost:8080` and
the machine next door, refusing them would break the primary use case. The
mitigation is that the action is administrator-only, explicit, never automatic,
and its response only populates a picker. That is a smaller claim than *this is
safe*, and it is the true one.

A `POST` that writes nothing, because it carries a key — and a key does not
belong in a URL.

### `GET /api/admin/bindings` · `PUT /api/admin/bindings`

```json
{
  "bindings": { "prose": { "connectionId": "0199…", "modelId": "gpt-hi" } },
  "contentHash": "sha256:…"
}
```

The install defaults, layered under every account's own
([07 §5.1](design/07-tech-stack.md)). A whole document rather than a patch per
role: eight roles is not a chatty write path, and a wrong binding stops turns
rather than collapsing a pane.

`PUT` presents `contentHash` and answers `412 stale` with `current`. A hash the
client presents rather than a comparison the server holds, because nothing here
keeps a prior read — every request reads the file fresh. **An absent file hashes
as the empty document**, so *there is no file* and *there is an empty file*
present the same guard, which is what a first write needs since the client has
neither.

Roles this build does not know are dropped rather than rejected; unlike config
there is nothing on disk to preserve, so a write is a whole rewrite.

### `POST /api/admin/bindings/defaults`

`{ "hi": { "connectionId": "…", "modelId": "…" }, "lo": { … }, "contentHash": "…" }`
→ the same shape `GET /api/admin/bindings` returns.

**Two bindings in, a whole document out** — [07 §5.1]'s *a good one and a cheap
one*, spread across the roles that have a text fallback. Which role gets which
is policy — the expensive model writes, everything else uses the cheap one — and
it stays on the server so that no install ends up with `prose` on the cheap
model without anybody having chosen that. `image`, `video` and `speech` are left
unbound, because there is no sensible text fallback for them and a binding that
gave them one would fail at the call rather than at the setup.

Under the same hash guard as the whole-document write, and for a sharper reason:
the offer this answers appears right after a connection is saved, which is
exactly when somebody else is most likely to have put something there already.

### `GET /api/admin/roles`

```json
{
  "roles": [
    {
      "role": "prose",
      "tier": "hi",
      "ok": true,
      "via": "default",
      "connectionId": "0199…",
      "connectionLabel": "The house key",
      "modelId": "gpt-hi"
    },
    { "role": "image", "tier": "unset", "ok": false, "reason": "unbound" }
  ]
}
```

**What every role will do, resolved rather than described.** `via` — which layer
won — is a local in `resolveRole`, deliberately absent from the turn record
([13 §1.4](design/13-internal-contracts.md) specifies no such field), and
returned by nothing before this. A surface showing it would have had to
reimplement [07 §5.1]'s layering in the browser, against two binding maps it
would also have had to fetch: a second copy of the resolution order, in a
different language from the first.

`tier` is the one thing the resolution cannot supply, because it is a statement
about *policy* rather than about state. `image` reporting `unbound` on a fresh
install is the defaults working; `prose` reporting `unbound` is an install
nobody can play on. Same resolution, opposite meanings, and a client that showed
them alike would send an administrator hunting a fault that is not there.

`reason` is `unbound` (nothing is bound) or `dangling` (something is, and the
connection it names is gone). The remedies differ, so the answers do
([00 §3.3](design/00-stance.md)).

**The install's answer, not the caller's.** It resolves the system bindings
against the system connections and passes no personal layer, because the
question this surface asks is *what has the install got*. A user's own view of
which of their bindings are personal is [05 §15.1](design/05-ui-surfaces.md)'s,
and waits with the rest of that half.

### `GET /api/admin/notices`

`{ "pendingRestart": ["server.port"], "canRestart": false }`.

Its own route because the restart banner is on **every** page rather than on the
settings page ([04 §6.3](design/04-server-multiuser-deployment.md)) — the person
who needs to know is often not the one looking at the form.

Computed per request and stored nowhere, which is what makes it self-healing:
change a value, change it back, and the list empties. It is also why every
administrator sees the same list — one process, one answer, not a per-session
note.

`canRestart` is `false` and says so rather than being absent. **The server does
not restart itself**: under no supervisor a restart control leaves the
administrator with no server and possibly no shell
([04 §6.4](design/04-server-multiuser-deployment.md)), so it needs supervisor
detection and a drain, neither of which exists. A notice that invites *"so how do
I restart it?"* is a worse answer than one that says.

---

## Errors

| Status | `error` | Means |
|---|---|---|
| 400 | `invalid` | The object failed schema validation, named a schema this build does not know, or was posted to a kind that is not its own. Carries `issues` — `{path, message}` per field — whichever validator refused it |
| 401 | `unauthenticated` | No session |
| 401 | `invalid-credentials` | Login failed |
| 403 | `csrf` | Missing or mismatched `x-csrf-token` |
| 403 | `read-only` | A system-library object |
| 403 | `forbidden` | A signed-in non-admin on `/api/admin` |
| 404 | `not-found` / `unknown-kind` | No such object, or no such kind |
| 409 | `busy` | The session already has a turn in flight. Carries the active `job` |
| 409 | `finished` | That turn is already over, so there is nothing to cancel |
| 412 | `stale-head` | The session moved on since this was composed. Carries the current `head` |
| 409 | `conflict` / `already-setup` | That id already exists; setup already ran |
| 409 | `exists` | An account with that handle already exists |
| 409 | `last-admin` | The change would leave the install with no administrator who can sign in |
| 413 | `too-large` | The preference document would exceed its size cap |
| 412 | `stale` | Hash mismatch — `current` holds the object as it is now. **A 412 always carries a hash different from the one you sent**; if it did not, reload-and-reapply could not terminate, which is exactly what `diverged` below exists to stop happening |
| 409 | `diverged` | The file on disk cannot be read, and the index still holds the last good version — a hand edit that broke the file. **Not a retry**: nothing about the request is wrong, so reloading returns the same hash. Repair the file, or `DELETE` the object, which works in this state on purpose |
| 422 | `refused-path` | The object's folder name is one this build will not open — `con`, a trailing space. The message names the reason and the segment, never a filesystem path |
| 428 | `hash-required` | A write with no content hash |
| 503 | `setup-required` | No accounts exist yet |
| 500 | `internal` | Something the server did not expect. The message is deliberately uninformative — the detail is in the log, where it can name a filesystem path safely |

---

## Not here yet

No workbench (P3), no import (P4), and no static file serving: the client runs
on Vite's dev server and talks to this over `/api`.

*Mode and preset selection on a session was listed here and shipped at P2.6; it
is documented under Sessions above. The provider settings surface was listed
here and shipped at [P2B](design/workplan/14-p2b-provider-configuration.md); it
is documented under Administration above.*

**One half of it is still deferred, deliberately**, so it is named here rather
than left to be discovered: there is **no route that writes a user's own
connection or their own `bindings.json`.** P2B writes the system scope and only
the system scope ([P2B §2.7](design/workplan/14-p2b-provider-configuration.md)),
and [05 §15.1](design/05-ui-surfaces.md)'s *your connections* half waits with the
rest of the user surface. Both files are read by the resolver and hand-written
by anyone who wants one, exactly as before.
