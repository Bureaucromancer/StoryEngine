# The HTTP API

**Status: as built, and kept so.** Written at P2.5 and revised with every phase
since — last at [P7.5](design/workplan/23-p7-implementation.md), for the pacing
dial and the plot-hook selector's line on the turn record. This describes what exists, not what
is planned — where the two differ, this file is right and the design notes
record intent ([docs/README.md](README.md)).

Everything is under `/api`. Responses are JSON. The client is the only consumer
today, but nothing here is client-specific: `curl` is a first-class way to drive
it, and the P1 exit gate ([P1 §3](design/workplan/07-p1-implementation.md)) is written in
terms of it.

**The prefix is a boundary, not a convention.** Since
[P6A.1](design/workplan/19-p6a-alpha-1.md) the same process can also serve the
web client, so an address outside `/api` may answer HTML — but an address
*under* it never does. One that matches no route is
`404 {"error":"not-found"}` like any other JSON error, because a client that
parses this API is worse served by a page than by a 404. Whether the UI is
served at all is one config key, `server.clientRoot`
([21 §4](design/21-internal-contracts.md)); in development it is unset and the
client is a second process.

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
([09 §5.1](design/09-server-multiuser-deployment.md)): combined with the loopback
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
{
  "setupRequired": true,
  "setupTokenRequired": true,
  "account": null,
  "minPasswordLength": 8,
  "build": { "version": "1.0.0-alpha.2", "commit": "7573e8a…" }
}
```

`account` is the public account shape once signed in — never `passwordHash` or
`salt`, which are built by picking fields rather than omitting them so a field
added later cannot leak by default.

```json
{
  "setupRequired": false,
  "setupTokenRequired": false,
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
  },
  "build": null
}
```

**`privateConnections` is enforced where connections resolve** — never at the
UI, which a user with write file access can bypass
([09 §4.5](design/09-server-multiuser-deployment.md)). Revoking it stops the
account's next turn from using its own connections; the files stay on disk, and
the turn falls back to the system ones. Restoring the capability restores them.

**`fileAccess` and `enableExtensions` are recorded and gate nothing yet.** Both
name features that have not shipped — an in-UI file browser and extensions — so
the settings surface groups them apart and says the setting will apply when the
feature does, rather than presenting three switches as though they were equally
live.

**`setupTokenRequired` says whether creating the first admin needs the token
from the server's console** (F10, [09 §5.1](design/09-server-multiuser-deployment.md)).
It is true exactly when setup is still needed *and* this process is bound beyond
loopback. A client cannot work that out for itself — it may be reaching a
loopback server directly or an exposed one through a proxy — and both guesses
fail visibly: a token box on a laptop is baffling, and no box on an exposed
install makes it look broken. It narrows nothing that this same response does not
already say, and the token itself never leaves the console.

**`build` is what this build is**, or `null` for one nobody identified — every
development run ([P6A §1.5](design/workplan/19-p6a-alpha-1.md)). Here as well as
on the admin notices route, since alpha.2, because the UI says it on every page:
the footer under login and setup as much as under the library, and the About
block at the top of Settings, for every account. Unauthenticated on purpose, and
it narrows nothing: this response already says whether the install is
unclaimed, the login page is served to anyone who can reach the port, and a
version is a fact about the software rather than about anybody's data. It is
also user-facing by design — [09 §7](design/09-server-multiuser-deployment.md)
makes *what am I running* a question the running version answers for everyone
who interacts with the server. The name a person reads (*1.0-alpha 2*) is
derived from the string by [releases §7.1](design/workplan/04-repo-and-releases.md)'s
rule; the response carries the string.

**`minPasswordLength` is `auth.minPasswordLength`**, the shortest password this
install accepts where one is *set*. It is here rather than on the admin config
route because the setup form needs it before any account exists, and that route
is behind both the admin guard and the first-run gate. Unauthenticated on
purpose: it is the length of a secret rather than a secret, and the same
response already says whether this install is unclaimed. `0` means the empty
string is a valid password.

### `POST /api/auth/setup`

First run only. `{ handle, password, displayName?, setupToken? }` →
`201 { account }`, and signs you in. `409` once an admin exists. A password
shorter than `minPasswordLength` is `400 invalid`, naming `/password` in
`issues`.

**`setupToken` is required when `setupTokenRequired` is true** and ignored
otherwise — a wrong one, or none, is
`403 {"error":"invalid-setup-token"}`. Absent and wrong are the same answer for
the reason login gives one answer for three failures. The token is written to
the server's console on every start until an admin exists, and kept at
`state/setup.token` in the data directory, and nowhere else — which is the
point: only somebody with host access can read either, and that is exactly the
audience entitled to claim an unclaimed install. It is checked before the
password rule and after nothing, except that an install which already has an
admin answers `409 already-setup` instead — the honest reason, rather than a
token refusal about a route that no longer applies.

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
([04 §9](design/04-schemas.md)). Adding a kind should not touch the routes.

**No route takes a handle.** Every one resolves its root from the session,
because the path is the owner ([09 §4.3](design/09-server-multiuser-deployment.md)).
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
  ([10 §5](design/10-ui-surfaces.md)).
- **`shadowed`** means another file holds this id at a lexicographically earlier
  path ([P1 §1.2](design/workplan/07-p1-implementation.md)). Both are listed; the shadowed
  one carries a warning. Copying a folder is a feature, so this never blocks.
- **`slug`** is the folder name, frozen at creation. **Nothing *writes* by it
  and no reference between objects uses it** — resolve by `id`. The one
  exception is reading a duplicate, below.

### `GET /api/library` and `GET /api/library/:kind`

`{ "objects": [ …envelope ] }`, sorted by name. The first is every kind at once.
The kind is a path segment rather than a mode: one handler set answers both, and
the unfiltered form exists because cross-kind queries — search, counts, an
export sweep — are a real thing to want. It is not a claim about the UI, which
browses per kind ([10 §5](design/10-ui-surfaces.md)).

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
([03 §5.1](design/03-data-model.md)). An entry clears when the file parses again,
or when it is deleted.

### `POST /api/library/:kind`

Body is the portable object, or `{ object }`. → `201 { id, slug, contentHash, object }`.

The slug is derived from `name` here, once, and then frozen. Duplicates get a
numeric suffix from `-2`.

**Read-after-write is guaranteed**: a `GET` immediately after this reflects it.
The server indexes its own writes synchronously; the watcher is only for foreign
ones ([03 §5.1.1](design/03-data-model.md)). If it ever needs a retry, something
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
([09 §4.4](design/09-server-multiuser-deployment.md)). It is also the only defence
the hot-reload thesis has against silently eating a hand edit — the likelier
conflict is not two tabs but one tab and a text editor.

**There is no rename route.** Changing `name` is an ordinary `PUT`. The folder
keeps the slug it was born with, and the engine never moves a user's directories
([P1 §1.1](design/workplan/07-p1-implementation.md)).

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
([P3 §7.4](design/workplan/15-p3-implementation.md), decided: best-effort,
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
([21 §5](design/21-internal-contracts.md)) and its migration policy is
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
([03 §10.2](design/03-data-model.md)), which is why refusing was the more
destructive option of the two.

### `POST /api/import/file`

**The first upload route this server has had**, and at P4.1 the only one.
`multipart/form-data` with one file part → `201 { item, notes }` when it
converted, `200 { item, notes }` when it did not.

`item` is one row of the import review's vocabulary — `{ source, disposition,
notes, objectId? }` — where `source` is the filename **as it arrived**, never a
path ([21 §4.1.1](design/21-internal-contracts.md)). `disposition` is
`converted`, `recorded` or `unrecognised`, and the middle one is the interesting
answer: a PNG card today is a file this build converts at **P4.2**, so it is
reported as *not yet* rather than refused as broken. Answering `4xx` would tell
somebody their file is wrong when the truth is that the build is unfinished.

Notes are `{ key, params, level }` and never sentences — the client composes the
prose ([P4 §1.4](design/workplan/16-p4-implementation.md)).

- `413 {"error":"too-large"}` over `limits.maxUploadMb`, **read per request**.
  That is what moved the key from `unread` to `applied` after three phases as
  the standing example of a live key nobody read: raise the limit in Settings and
  the next upload takes the file, without a restart. Fastify's constructor
  `bodyLimit` stays as the outer bound.
- `415 {"error":"not-multipart"}` for a body that is not multipart.
- `400 {"error":"no-file"}` for a multipart body with no file in it.

CSRF applies exactly as it does to every other mutation. An upload form is
precisely where one would be tempted to make an exception, so there is a test
that says there is none.

**An optional `onConflict` field** decides what a re-upload of a changed file
does — `replace` (the default, and the safe one), `keep-both` or `skip`, meaning
exactly what they mean on a sweep. **It must come before the file part.** The
route reads the parts that arrived ahead of the file, which is where the
multipart reader stops; a field appended after it is sent by the browser and
never parsed. A word this build does not know is treated as absent rather than
refused: the file has already been buffered by then, and throwing away a good
upload over a spelling is the worse answer.

**An optional `destination` field** — `treatment` or `lorebook` — decides what a
source with a genuine choice becomes. It follows the same before-the-file rule
and the same unknown-is-absent rule, for the same reasons.

Exactly one format reads it, and that is the point rather than a limitation. A
character card is an Actor and a world file is a Lorebook; neither poses a
question, and a control over either would be a control with one answer.
Aventuras' `VaultScenario` is the exception because it is the *conflated* object
[04 §6](design/04-schemas.md) names when it records why `Scenario` was refused as
a kind name — setting prose, a cast and an opening in one file. `treatment` is
the default and is what StoryEngine calls the unconflated version of that;
`lorebook` is for a scenario whose setting prose is really a setting bible, and
it costs the opening messages, which a lorebook has nowhere to hold.

### `POST /api/import/file/preview`

**What that upload would do, with nothing written.** `multipart/form-data` with
one file part → `200 { preview }`. Same limits, same three transport refusals and
the same CSRF rule as `/import/file`, because both doors read the part through
the same function.

`preview` is `{ source, disposition, notes, advisories, object, reimport }`.
`disposition` and `reimport` are **predictions**, not records — the file could
change underneath, and the commit's answer is the real one.

- `object` is `{ kind: 'preset', name, blocks, params, maxContextTokens,
  preferredModelIds, compatKeys }` for a preset, `{ kind: 'scenario', name,
  blurb, framingChars, cast, openings, destination, alternatives }` for an
  Aventuras scenario, `{ kind: 'sweep' }` for an archive or a Marinara envelope,
  `{ kind: 'opaque', name }` for something that converts and has no summary yet,
  and `null` when nothing would be imported.
- The scenario arm is the only one carrying a **question** rather than only
  statements: `alternatives` is what it could also be converted to, so a client
  can offer the switch without knowing which formats have a choice. It takes the
  same optional `destination` field as `/import/file`, because a control that
  changed what a commit produced without changing what the look showed would be
  a look at something else. `framingChars` is a measurement and not the prose —
  a preview describes a file, it does not render one.
- `compatKeys` carries **names and never values** ([04 §8.4.6](design/04-schemas.md)).
  A screen that showed what was in the file would show a proxy password to
  whoever was handed the file.
- `notes` are the converter's, about the file. `advisories` are about **this
  build** — which sampler settings the adapter forwards — and are a separate
  array because they must never be stored: they go stale on an upgrade without
  the file changing. Near-miss `suggestions` ride beside a sweep report for the
  same reason.
- `reimport` is `new`, `unchanged`, `changed`, or `unknown` for a kind this build
  has no summary for. `unknown` is an answer rather than a guess — working it out
  means converting, and that arm has not.

**A file this cannot identify is `200`, not `4xx`.** A file is a fact about the
world rather than a malformed request, which is the shape `/import/file` already
takes.

**The commit is a second upload of the same bytes to `/import/file`**, not a
`POST` of the object this returns. There is no staging area: nothing is written
here and nothing is held, so the bytes travel twice and what lands is always what
the converter says about the bytes that arrived. Posting the converted object to
`/api/library/presets` would skip `stampImported` and the re-import check — so
every later re-import of that file would double — leave no row in the job ledger,
and move the credential rule from the server to the client.

### `POST /api/import/sweep`

`{ root, onConflict? }` → `200 { report }`. Points the server at a folder on its
own filesystem and imports what it finds.

**Gated on `fileAccess`**, as [10 §4.2.2](design/10-ui-surfaces.md) widened it —
`read` is enough, since the sweep never writes to the source. `403
{"error":"no-file-access"}` without it.

**And `/data` is carved out**, which is what makes that widening safe rather than
merely honest: without it, `fileAccess: read` would be a way to reach another
account's library, which the scope table says `never`. Compared on real paths, so
a symlink into the data directory is refused like a literal one.

- `422 {"error":"inside-data-root"}` — the folder is inside this install's own data.
- `422 {"error":"not-absolute"}` — a relative path means whatever the cwd is.
- `422 {"error":"unreadable-root"}` — nothing readable there.
- `422 {"error":"live-install"}` — the source application is running, or is
  part-way through an upgrade. Reading it produces a torn library *quietly*,
  which is why this refuses rather than warns.
- `422 {"error":"unknown-format"}` — written by a newer version than this build
  reads.
- `422 {"error":"ambiguous-root"}` — the folder probes as two applications at
  once. A wrong guess would convert a library through the wrong tables and the
  review would report that it went fine, so this refuses rather than picks.

Every refusal happens **before anything is written**. A refusal after the first
object is a half-import, which is worse than none.

`onConflict` decides what a re-import does when a file has changed: `replace`
(the default, and the safe one — the write goes through the version history, so
the state it replaced becomes a version), `keep-both`, or `skip`. Unchanged
objects are never rewritten and are reported as `unchanged`, which is a different
answer from `skipped`.

**Source files in the report are named relative to the root**, never absolutely
([21 §4.1.1](design/21-internal-contracts.md)) — a review somebody pastes into an
issue must not be a description of their filesystem.

The response also carries `suggestions` — see below. A sweep of the wrong folder
**succeeds**, because a directory matching no probe is swept as loose files, so
nothing in the report itself says the wrong folder was named.

### `POST /api/import/inspect`

`{ root }` → `200 { verdict, suggestions }`. Says what a folder is without
importing anything from it — the check behind the path box.

Same permission and the same refusals as the sweep, because it reads the same
way: `403 {"error":"no-file-access"}`, and every `422` listed above. A cheaper
gate here would be a way to ask questions about the filesystem that the route
which actually reads it refuses to answer.

`verdict` is what the probes decided: `sillytavern`, `marinara`, or
`loose-files` for a folder that matches nothing. Those are the only three a
directory can produce — `marinara-archive` and `marinara-envelope` are members of
the same vocabulary but are reached on the upload path, never by pointing at a
folder.

**It never lists a directory.** Every answer is a yes/no probe at a path this
build already names in its own source. [10 §4.2.2](design/10-ui-surfaces.md)
keeps the sweep's report relative so the review does not become a filesystem map;
an endpoint that enumerated children would hand back exactly the map that clause
refuses.

`suggestions` is an array of near misses — the folder is recognisably part of a
real SillyTavern or Marinara install, but is not the one to point at:

```json
{
  "situation": "sillytavern-install-root",
  "suggest": "data/default-user",
  "root": "/home/bob/SillyTavern/data/default-user",
  "leadsTo": "sillytavern",
  "confidence": "verified",
  "note": { "key": "import.root.sillytavernBelow", "params": { "path": "data/default-user" }, "level": "warn" }
}
```

`suggest` is relative to the folder named; `root` is the absolute form a retry
carries. `confidence` is `verified` when every mark of `leadsTo` was found at
that path — so the classifier would agree — and `inferred` when the finding is
read off the neighbourhood. `suggest` and `leadsTo` are both `null` for a folder
that is recognised but whose right sibling cannot honestly be named, which is a
real answer rather than a failure to have one: a SillyTavern data folder holding
several people's libraries has no handle to guess, and a Marinara install from
before 1.5.7 has no newer folder to point at.

**A suggestion is advice, not a gate.** Acting on one sends a fresh absolute path
back through this route or the sweep, which re-validate from scratch — the
carve-out included.

### `POST /api/import/directory/plan`

`{ entries: [{ path, bytes }] }` → `200 { verdict, suggestions, wanted, declared, wantedBytes }`.
The first half of a browser folder upload: what the folder is, and which of its
files the importer will actually open.

**No `fileAccess` gate, and that is the point of the transport.** The sweep reads
the host's filesystem through the server's own user, which is why
[10 §4.2.2](design/10-ui-surfaces.md) grants it to *somebody you would give a
shell to*. This reads nothing — the browser opened the folder under the person's
own credentials, and what arrives is a list of names they chose to send. An
account that may upload one file may upload a folder of them.

`entries` is every file in the picked folder, relative and `/`-separated, capped
at 50,000. Names alone are enough to classify, because every probe is an
existence question — so the verdict and the near-miss advice come back before a
byte is uploaded. `suggestions` carries a `null` `root`: a browser upload has no
path to point anywhere with, so acting on the advice means picking again.

`wanted` is the paths to upload; `declared` is the rest. `422` for the same
classification refusals as the sweep.

### `POST /api/import/directory`

`multipart/form-data` → `200 { report }`. The folder itself.

Each file's **relative path travels as its field name** — a multipart filename
cannot carry a directory and survive sanitising — and is rebuilt segment-wise
with `.` and `..` dropped. A `manifest` field carries the full path list as JSON;
an `onConflict` field is optional and means what it does on the sweep.

**Named and not sent is not the same as absent.** Paths in the manifest without
bytes are *declared*: listed, reported, and never read. That is what keeps
*nothing is silently dropped* true across a transport that deliberately does not
carry everything.

- `400 {"error":"no-manifest"}` — a folder upload without its manifest.
- `413 {"error":"too-large"}` — **the whole folder** past `limits.maxUploadMb`,
  not each file in it. The limit is a running total; a thousand files each just
  under it is still a thousand times it.
- `415 {"error":"not-multipart"}`.

No `suggestions` here — the plan step is where advice can still be acted on.

### `GET /api/library/:kind/:id/download`

**The object as stored, byte for byte** → `200`, `application/json`, with a
`content-disposition` naming an ASCII-slugged file. Works for every kind.

**The primitive, and it converts nothing.** Everything under `/export/` below is
a *writer*, and a writer loses something by definition; this loses nothing
because nothing is converted. It carries no `x-storyengine-missing`: a package
resolves references and can come up short, and an object is just itself.

Until this route existed, nothing in the build downloaded a library object except
a `.sepack` — a strange absence in a surface whose whole claim
([10 §2.1](design/10-ui-surfaces.md)) is that these are your files, in folders you
may open in a text editor.

### `GET /api/library/:kind/:id/export/:format`

**The same object, written as somebody else's format** →
`200` with that format's content type and extension.

`:format` is an id from the shared `EXPORT_FORMATS` table, which says what each
format accepts and whether the application it belongs to can read it back. One
route and a registry rather than a route per format: the second format is the one
that decides which of those you have built, and adding a third is a table row.

- `404 {"error":"unknown-format"}` — no format by that id.
- `409 {"error":"wrong-kind"}` — the format exists and is not written from this
  kind.
- `422 {"error":"not-exportable"}` — the stored object does not match its own
  schema. The folder is the object and somebody may have hand-edited it, so
  *this file is not a treatment any more* is a real answer and a better one than
  a cheerfully empty download.

**What the file does not carry travels in `x-storyengine-export-notes`**, base64
of a JSON `ImportNote[]`. In a header on `.sepack`'s reasoning — *the body is the
file*, and a note to the recipient's importer about the exporter's library does
not belong inside the document. Base64 because a header is latin-1 and a note's
params carry whatever an object is called. Every writer loses something and each
one names what: a treatment's cast narrowed to a card's one character, a
lorebook's folder gates flattened, a linked lorebook a scenario has nowhere to
hold.

Formats at this stage: `aventuras.scenario` and `sillytavern.card` from a
Treatment, `aventuras.character` from an Actor, `aventuras.lorebook` from a
Lorebook. **`aventuras.scenario` does not round-trip into Aventuras** and the
table says so — its scenario import routes every uploaded file through the
character-card pipeline and never sniffs for a `VaultScenario`, so that format is
archival while the card is the one that travels. It round-trips into *this*
build, which is what `export/writers.test.ts` asserts and the first real exercise
[00 §2.4](design/00-stance.md)'s *nothing is lost and re-export is possible* has
had.

### `GET /api/library/:kind/:id/avatar`

The stored bytes of an actor's `card.png`, as `image/png` with an `ETag` of the
content hash. Actors only — no other kind has an image that *is* the object —
so any other kind is `404`. **The object's own pixels, which is what makes it
actors-only**; media the object merely *carries* is the route below.

### `GET /api/library/:kind/:id/media/:mediaId`

The bytes of one entry in an object's `media` manifest — [P7.10]. `content-type`
from the entry's own `mime`, and an `ETag` of **the media's `digest`**, not the
object's `contentHash`: the two differ, and the digest is the right one because
a picture does not change when the prose beside it does.

**Any kind, unlike `/avatar`.** [04 §3](design/04-schemas.md) puts `media` on
treatments, lorebooks and packages as well as on actors, so the route is keyed
the same way the rest of the library is.

- `404` when the object has no entry with that id.
- `404` when the manifest has the entry and the container has no blob behind its
  `ref`. **This is a real state rather than a defensive branch** — a PNG whose
  ancillary chunks were stripped in transit keeps its manifest and loses its
  bytes ([03 §5.2.2](design/03-data-model.md)) — and it answers `404` rather than
  `500` because the object is intact and one thing inside it is not.

*What reads it today:* expression sprites, imported with the character
([P7.10] again — an actor arriving with a `sprites/` directory keeps every image
as `role: "expression"` with the filename stem as its label, where before only
`assets[0]` survived as the portrait). ~~[P9](design/workplan/26-p9-implementation.md)
is the second consumer: a rendition's asset needs serving too, and
`MediaSelection`'s two arms are already the one shape both go through.~~
***It is, as of 2026-09-16 — below.***

### `GET /sessions/:sessionId/renditions`

Every rendition this session holds, as
`{ renditions: Rendition[], selection: Record<turnId, renditionId> }` —
[06 §10](design/06-modes-and-turn-pipeline.md),
[21 §7](design/21-internal-contracts.md), [P9.2], [P9.4].

**Off the session read and off the transcript read, deliberately**, which is
`GET /sessions/:id/memory`'s argument: a rendition's state changes *after* its
turn is written, so folding it into either would make two reads that are cached
differently disagree about whether a picture has arrived.

**`selection` rides with them** ([06 §10.7], added [P9.4]). Which sibling a turn
shows is a pointer on the session file, and answering it from a second read would
put the set and the choice on two cache entries that expire independently — the
reader would then watch a picture they did not choose for as long as the stale
half survived.

### `GET /sessions/:sessionId/renditions/:renditionId/asset`

The pixels, in the shape `/library/:kind/:id/media/:mediaId` above already uses:
`content-type` from the record, `etag` from the bytes' own digest, and the
buffer. The client cache-busts with `?v=<digest>` as it does for media.

**`404` for a rendition with no `asset`**, which is three different states and
one answer: still pending, failed, or **evicted**. That last one is
[25 E3](design/25-open-questions.md)'s whole point — *"deleting one leaves
`asset: null` and a picture that can be made again"* — so a 404 here is what the
client renders a regenerable placeholder from, rather than an `<img>` quietly
failing.

### `POST /sessions/:sessionId/turns/:turnId/illustrate`

**Illustrate** this turn, or **Set the scene** for it —
[06 §10.6](design/06-modes-and-turn-pipeline.md), [P9.4]. Body:
`{ purpose?: "illustration" | "background" }`, defaulting to `illustration`.

**One route and two verbs**, because they are one act under two purposes: two
routes would be two copies of the gather, the resolution and the dispatch,
differing in one string.

**`202` with the `pending` record.** The pixels arrive on the session stream as a
`rendition` frame; a route that waited for them would be
[06 §10.2](design/06-modes-and-turn-pipeline.md)'s failure — *"a story that
stalls on either is unusable"* — moved from the turn to a button.

**A refusal is a `200` with a class, not a `4xx`.** `{ held: "no-binding" }` when
nothing is bound to the `image` role, which is the ordinary state of every
install ([19 §5.1](design/19-tech-stack.md)), and `{ held: "no-moment" }` when
the turn has no prose or the moment call declined. Both are answers to *can you
make a picture*, not failed requests. A turn that does not exist is a `404`.

**It assembles from the turn's recorded state**, not from the head —
[06 §10.6]'s standing `[OPEN]`, decided at [P9.4] and disclosed through the
rendition's own prompt listing rather than through a setting.

### `PUT /sessions/:sessionId/turns/:turnId/rendition`

Which of a turn's siblings is shown — [06 §10.7], [P9.3]. Body:
`{ renditionId }`, and the rendition has to be that turn's or the answer is a
`404`: a pointer to another turn's picture would render one moment under
another's prose.

*Illustrations only.* Which **backdrop** is showing is channel state
([06 §10.1a]) because it has to rewind and branch, and it moves through
`PUT /sessions/:id/channels/se.backdrop` like any other engine-computed value.

### `POST /sessions/:sessionId/renditions/:renditionId/retry`

Runs a recipe again — the retry on a failed picture and the re-creation of an
evicted one, which are the same act: a record with no pixels, run again
([25 E3](design/25-open-questions.md), [P9.4]).

**No text call is made.** The record already holds the fragments, the separator,
the budget and the seed, so there is no assembly on this path and no role to
resolve — which is what makes re-creation a *replay* rather than a second
answer.

**`202` with the record set back to `pending`**, like the illustrate route above
and for the same reason: the pixels arrive on the stream, and a `200` would read
as *here is your picture*.

---

## Tags

The tag registry — [05](design/05-tagging.md). One document per account, at
`users/<handle>/tags.json`.

**The registry decorates tag names; it does not own them.** An object may carry
a tag the registry has never heard of, and that tag renders, filters and gates
lore exactly as a registered one does — it simply has no colour and no place in
the manual order. Nothing here validates a tag against the registry, nothing
refuses a name it has not seen, and no route rejects an object because of what
is or is not in this document.

**The verb split is the safety property.** `DELETE /api/tags/:id` removes an
*entry* and touches no object: the tag survives on everything carrying it. Any
operation that would rewrite the user's files is a `POST` with a verb in the
path, and none of those exists yet.

A tag entry is:

```jsonc
{
  "id": "01930f...", // stable across renames
  "name": "noir",
  "swatch": "rose", // a palette name, or null for the neutral chip
  "sortOrder": 0, // manual order, dense within a registry
  "folder": "none", // "none" | "open" | "closed"
  "hidden": false, // hidden from an object's inline chip strip, and nowhere else
  "createdAt": "2026-09-08T10:00:00Z"
}
```

`swatch` and `folder` are **documented open strings, not closed sets**
([04 §8.2](design/04-schemas.md)'s rule). A value this build does not recognise
renders neutral, or reads as `none`, and is stored back unchanged rather than
blanked — a newer build wrote it.

### `GET /api/tags`

`{ tags }`, in stored order.

**No counts.** `GET /api/library` already ships every object's body, so how many
objects carry a tag is one pass over data the client is holding; a second answer
computed here would eventually disagree with the first.

### `POST /api/tags`

`{ name, swatch?, folder?, hidden? }` → `201` with the whole list.

`409` when the name is an existing tag in any case, and the message names the
spelling that exists — *noir is already a tag* is unhelpful to somebody who has
just typed `Noir` and can see no `noir`.

### `PATCH /api/tags/:id`

`{ swatch?, folder?, hidden? }` → the whole list.

**`name` is not accepted here**, and its absence is deliberate. Renaming is not a
property edit: an entry's `actorTagFilter` naming the old spelling stops matching
([05 §1](design/05-tagging.md)), so a rename can change which lore fires and owes
an answer about the gates it found. A `name` in this body is `400` with the field
named, rather than being applied as if it were a colour.

### `DELETE /api/tags/:id`

Removes the entry. **Objects are untouched** — the tag goes on being carried,
filtered and gated on, and reappears in the manager as a tag in use with no
entry. Losing a registry row must never lose data.

### `POST /api/tags/:id/rename`

`{ to, rewriteGates? }` → the whole list, plus what it found.

**One registry write.** An adopted object references the entry, so changing the
entry changes what every carrier is called without touching a single object file
— which is the whole reason `tagIds` exists.

**And one question.** A lore entry's `actorTagFilter` holds author-written tag
*names*, and activation compares them exactly and case-sensitively
([05 §1](design/05-tagging.md)), so a rename that ignored them would silently
change which lore fires. Gates naming the old spelling are reported in
`gatesFound` **always**, and rewritten only when `rewriteGates` is true. Both
answers are defensible — an author who wrote a gate on *noir* may have meant that
tag, or may have meant that word — so the server reports and lets somebody
decide.

`409` when the new name is another tag: merging is a different operation with a
different answer about what happens to the objects.

### `POST /api/tags/adopt`

→ the whole list, plus `{ adopted, minted, skipped, unchanged }`.

**One deliberate write across the library**, after which renaming is free. It
mints a registry entry for every tag name in use that has none, then stamps
`tagIds` alongside each object's `tags`, index-aligned.

A route somebody presses rather than a migration on startup: every object it
touches gains a history entry, and a server that did that on first boot after an
upgrade would be rewriting a person's files without being asked.

**Idempotent.** A second run mints nothing and writes nothing, so a partial first
run is simply repeated. System-library objects cannot be written and are reported
in `skipped` rather than swallowed — a tag used only by the system library is
still in use.

### `PUT /api/tags/order`

`{ ids }` → the whole list, renumbered densely from zero.

The whole order, not a patch of positions: two reorders in flight are two whole
answers and the later one wins, where two position patches could produce an order
neither client asked for. Ids the registry does not know are ignored rather than
refused, so a stale tab reordering a list somebody has since pruned is not an
error page.

---

## Version history

Every write that changes something snapshots the state it replaced, automatically
([03 §11](design/03-data-model.md)). A no-op write records nothing. History
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
never stored ([03 §11.5](design/03-data-model.md)). `authoredAt` is when the
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
never takes it ([03 §11.3](design/03-data-model.md)). → `200 { version }`.

Retention: history is pruned to `history.keepPerObject` (default 50) per
object, oldest unpinned first.

---

## Search

### `GET /api/search?q=&limit=`

`{ "objects": [ { id, schema, name, slug, source } ], "turns": [ { turnId, sessionId, sessionName, segment, offset, onPath, headTurnId } ], "entries": [ { entryId, entryName, objectId, objectName, slug, source, snippet } ] }`

Full-text across all three, because a person looking for *the cathedral* does not
know or care whether they wrote it in a lorebook, in one entry of one, or said it
in a turn — [10 §14.5](design/10-ui-surfaces.md)'s *one query, three kinds of
hit*.

**`entries` is why the third kind exists.** A match inside a three-hundred-entry
book used to return *the book*, which §14.5 calls close to useless at that scale.
`objectId` and `entryId` together are an address — `/library/lorebooks/{objectId}
?entry={entryId}` — and that is the whole rule for what the index carries:
**a fragment is indexable when it has an address.** An actor's greetings and a
preset's block text have none, so they get no rows.

`snippet` is the excerpt around the match, from whichever of the entry's five
searched fields matched (`name`, `keys`, `secondaryKeys`, `description`,
`content`), elided with `…` at either end where it does not reach the field's
edge. **It is not marked up.** A marker inserted into the text is
indistinguishable from the same characters occurring in it, and the client
already highlights matches itself; what it costs is that a prefix or boolean
query will not be highlighted by a plain substring matcher.

**One match can appear under two keys.** A phrase in an entry matches that entry
*and* the book, because the object index holds the whole serialised object.
That is the design rather than a duplicate. Ranks are per table and are not
comparable across the three arrays, so a client cannot interleave them by
relevance.

`q` is FTS5 syntax and a query it cannot parse — an unbalanced quote, a bare `*`
— is `400 invalid` rather than a 500: it is the caller's to fix.

**Turn text is what was typed and what came back**, not the assembled prompt. A
search that matched the blocks would return every turn in a session the moment a
lorebook entry used the word. **Archived sessions are searched**; they are hidden
from the default list, not gone ([03 §10.3](design/03-data-model.md)), and a
search that skipped them would make archiving a quiet way of losing things.
Trashed ones are not.

API only at P2 — the UI is P3's ([P3 §4](design/workplan/15-p3-implementation.md)).

---

## Sessions

### `GET /api/modes` · `GET /api/modes/:modeId`

```json
{
  "modes": [
    {
      "id": "storyengine.scene",
      "displayName": "Scene",
      "voice": "narrator",
      "dispatch": "merged",
      "participants": { "select": "fixed", "maxActors": 1 },
      "inputs": ["do"],
      "presetIds": [],
      "setup": { "kind": "none" },
      "surfaces": []
    }
  ],
  "defaultModeId": "storyengine.scene"
}
```

**What this install can play.** Added at P7.4, and until then nothing could tell
a client which modes exist — the session form offered *the mode's own preset* and
had nothing to say about modes.

`defaultModeId` is the mode a `POST /api/sessions` with no `mode` plays. It is
sent rather than left to be assumed, because a client falling back to the first
mode in the list would render one mode's wizard and create a session on another
the moment registration order stopped matching it.

`setup` is the mode's wizard, **declared rather than coded**
([06 §7.3](design/06-modes-and-turn-pipeline.md)): either `{ kind: "none" }` or
`{ kind: "declared", fields: [...] }`, where each field has an `id`, an optional
`required`, and a `widget` from a closed vocabulary — `text` (with an optional
`hint` and `lines`), `choice` (with `options` of `{ value, label }`), or
`toggle`. A client renders the form from that and nothing else, which is what
lets a mode the engine has no knowledge of have a wizard. There is deliberately
no way for a mode to ship UI, and deliberately no `html` field anywhere in the
vocabulary ([10 §8](design/10-ui-surfaces.md)).

**A field carries no schema of its own.** What its answer is validated against is
*derived* from the widget — a toggle is a boolean, a choice is one of its
options' values, a text field is a string — so there is one description of a
field rather than two that can disagree.

What is deliberately **not** sent: the mode's `assembly` (a session copies its
preset at creation, so the pack is not the client's to see or change), its
`steps`, and its `channels` — a channel reaches a client as a rendered entry in
`GET /api/sessions/:id`'s `hud`, never as a declaration.

`GET /api/modes/:modeId` answers one, and `404 unknown-mode` for one this build
does not have. The runner falls back to the default for a session *already
playing* an unknown mode, because that is somebody's story and it should still
open — but answering this question with a different mode's declaration would
render a wizard for a mode nobody chose.

### `POST /api/sessions` · `GET /api/sessions?archived=true`

`{ name?, mode?, modeConfig?, preset?, cast?, treatment?, lore?, setup?, opening?, hooks? }`
→ `201 { session, activeJob? }`, and a list. **`archived` is the string `"true"`,
not a boolean** — see the note under the turn routes.

**`name` is optional, and an empty one means the same as none**: both store
`""`, which clients render as *Untitled session*. A session is id-addressed —
its folder is the uuidv7 and nothing resolves a session by name — so starting
one unnamed freezes nothing, which is why this route can be relaxed where the
library's create routes could not. It is trimmed here, but `session.json` is
hand-editable, so a client must still expect a blank. Rename with `PATCH` below.

`treatment` and `lore` have been accepted since P5.6 and this line never said
so. Both are links rather than copies, and neither is validated: an id that
resolves to nothing is a session with no books, not a rejected request
([00 §3.3](design/00-stance.md)).

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

**`modeConfig` is the mode's wizard, answered** — a flat object keyed by the
field ids the mode declares, added at P7.4. It is stored at `session.mode.config`,
which is where *how it was configured* has lived since P2.3 and what the portable
`Setup` calls the same value. It is checked against a schema **derived from
that mode's declaration** rather than one written here, so a mode that adds a
field is asked for it without a second edit to this route. A required field
missing, a choice the mode does not offer, a field of the wrong type, or a key
the mode never declared is `422 setup-invalid` carrying `issues` — the field
names, because a refusal reading only *invalid* leaves somebody guessing which
field on a form the engine generated for them.

A mode declaring `{ kind: "none" }` accepts exactly `{}`, so sending answers to a
mode with no wizard is refused rather than quietly ignored. Omit the field
entirely and `session.mode.config` stays `null` — which is every session written
before P7.4, and `{}` would be a claim that a wizard ran and collected nothing.

**`setup` is a Setup from the library** — *how to start playing*, in one object
([04 §7](design/04-schemas.md)): a mode and its config, a preset, a treatment, a
cast to choose from, and lore. Added at P7.4, and the first consumer that kind
has ever had.

Everything it carries is a **default that a parameter sent beside it overrides**,
which is [04 §6.1b](design/04-schemas.md)'s layering — *a Treatment proposes, a
Setup overrides, and the running session owns it* — with the request's own
parameters as the last word. Its `mode.config` is checked against the mode's
declaration exactly as `modeConfig` is, so a Setup written against a different
build is refused rather than written into a session the mode cannot read.

The session keeps a **copy** at `session.setup`, so editing the Setup afterwards
cannot reach a running game — the same asymmetry the preset has. `422
unknown-setup` when there is no such Setup: a dangling *treatment* or *lorebook*
is a session missing a book and is accepted, but a dangling Setup is a session
that would be created as something other than what was asked for.

**A Setup's opening is the session's first turn**, since P13.3
([03 §6](design/03-data-model.md)). `opening` chooses which: absent is the
Setup's primary written opening, a string names one of its written openings, and
`null` starts cold. The turn carries the opening's text as `output`, no `input`,
`opening: { id }`, and the effects that seed what the Setup carries — its
`cast.partyDefault` made `companion` on `se.party` (and seated in `cast.actors`),
and each of its `spentHooks` that the pool holds marked `fired` on `se.hook`. A
Setup with no opening and nothing to seed writes no turn. `422 unknown-opening`
for an id the Setup does not hold, or for any `opening` sent without a `setup`.
A generating mode's setup turn is the opening's child. The session in the `201`
is the one **after** the append, so its `headTurnId` already names the opening.

A redo or rewrite naming an opening (`redoOf` / `rewriteOf` on the turn route)
is `422 opening-turn`: nothing generated it, so there is nothing to generate
again.

**`hooks` are the session's own plot hooks**, added at P7.4's successor stage —
[03 §4.1](design/03-data-model.md)'s fourth source, which that section calls the
primary path for adding one to a game in progress.

The session is created with a **pool** at `session.hooks`, copied from all four
sources — the treatment, the Setup, every active lorebook, and these — and each
entry carries `{ hook, source }` so the UI can say where a hook came from and
navigate to whichever object owns it. A lorebook's `source` names the book,
because a hook carried by one is only eligible while that book is active.

**A copied hook keeps the source hook's id.** Within a continuity, a hook that
fired in one session must not fire again in the next, and cross-session
de-duplication is only possible if the copy preserved it
([15 §5](design/15-world.md)). The pool is a copy rather than a live resolution:
editing a treatment does not reach a session already running, which is
[06 §6.1](design/06-modes-and-turn-pipeline.md)'s *pulled, never pushed*. Omitted
when nothing carried a hook — absent is not an emptied pool.

**`activeJob` is present when the mode generates its world**, added at P7.4. A
mode may declare *parts* alongside its wizard's fields
([06 §7.3](design/06-modes-and-turn-pipeline.md)) — world overview, cast, sheets,
each a separate validated generation — and they run as the steps of the session's
**first turn**, with the answers as its input. So the reply carries a job in the
same shape `POST /sessions/:id/turns` does, and a client opens the stream it
already opens for a turn: generation is watched rather than waited out, and each
part reports through the ordinary `step.*` progress events.

Each part is retried and validated by the machinery any step's call gets, and
its effects apply as it succeeds — so a part that fails leaves what the others
produced, and says which one failed. A mode that declares no parts reserves no
turn and the reply has no `activeJob`: an empty plan would commit a turn that did
nothing, which is a blank first entry in somebody's transcript.

**`preset.modes` is not checked**, deliberately. It is advisory — a preset
written for a mode you do not have still imports, still shows, and still plays
if you insist ([04 §8.2](design/04-schemas.md)) — and turning a hint into a gate
would be worst in exactly the phase that fills a library with other people's
presets.

**Copied, never linked**, like the default it replaces: the session owns its
prompt pack from creation, so editing the library's copy never rewrites a game
in progress ([03 §8](design/03-data-model.md)). Browsing, previewing and
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
copied preset is deliberate ([03 §8](design/03-data-model.md)).

### `POST /api/sessions/:sessionId/goals`

`{ goal }` → `{ session }`. A goal written at a completion —
[06 §7.3.4](design/06-modes-and-turn-pipeline.md)'s *"set the next goal, either
the authored `next` or one written now"*, and the clause that makes the chain a
session field rather than a link into the Setup.

**It writes the chain and not the cursor**, which is two acts on purpose. Adding
the goal is an authoring act and lands on the session file, appending no turn;
*moving play onto it* is a move in the story and goes through the channel write
below, where it becomes a turn a rewind can undo. That section is emphatic that
`thenDefault` *"seeds the offer; it does not decide it"*, and a route doing both
would have decided it. An `id` is minted when the goal arrives without one, for
the reason the hook route mints one: `se.goal` is scoped by it and `Goal.next`
names it.

### `POST /api/sessions/:sessionId/hooks` · `DELETE /api/sessions/:sessionId/hooks/:hookId`

`{ hook }` → `{ session }`, and the delete answers the same. A hook added to a
**running** session — [03 §4.1](design/03-data-model.md) calls that *the primary
path*, and until this route creation was the only way in.

**An authoring act, not a story event.** It lands on the session file rather than
as a channel effect, which is that section's own line: *"adding a hook
mid-session is an authoring act, not a story event, and must survive a rewind"*.
So the pool is session-wide — a hook added at turn forty is in the pool at turn
one — while everything about what has *happened to* a hook stays per-node in
`se.hook`. The turn list is untouched: nothing happened in the story.

The body is open beyond `{ hook }` itself, like the creation route's `hooks`
array: a hook the schema would refuse is an authoring mistake to **show** rather
than a request to reject, and the selector's filter is where a broken one stops
being eligible with a class the panel turns into a sentence. **An `id` is minted
when the hook arrives without one** — every other hook in a pool was copied from
an object that had one and [15 §5](design/15-world.md) requires the copy to keep
it, but a session's own hook has no upstream, and without an id it could never be
committed, blocked, or recorded as fired.

The delete takes **any** hook, whichever source put it there: the pool was copied
at creation, so a treatment-borne entry is this session's copy and refusing to
remove it would make the copy a binding ([00 §3.1](design/00-stance.md)). It does
not reach the treatment. Removing one that is already gone succeeds — it is the
state the caller asked for — while a missing **session** is still a `404`.

### `POST /api/sessions/:sessionId/hooks/:hookId/promote`

`{ target: { kind: 'treatment' | 'setup' | 'lore', id }, from? }` →
`{ object: { id, name, kind } }`. The pooled hook named by `:hookId` is appended
to that library object's `hooks`, **keeping its id**, and the object is written
through the ordinary library update path.

**`from` is which pooled row, and an id alone cannot say.** It is the row's own
`source` — `{ kind: 'treatment' | 'setup' | 'lore', id }` or `{ kind: 'session' }`,
the vocabulary `GET /hooks` already returns — and the pool needs it because
`poolFor` deliberately does not de-duplicate: *the same hook reaching a session
through two sources is a real authoring situation*, so two rows can share an id
and carry different content, and the panel draws both. Without it the handler
takes the first match, which is the row above the one that was pressed — and the
409 below then refuses every later attempt, so the hook somebody meant can never
reach that object. It carries no hook content, only a kind and an id the server
already holds. Omitting it means *the first row with that id*, which is the
honest reading of a request that names only one.

**The valve the pair above never had.** A session copies hooks in from all four
of [03 §4.1](design/03-data-model.md)'s sources and may gain its own while
playing; until this route there was no way back out of one, so a hook realised
mid-play — which [06 §6.1](design/06-modes-and-turn-pipeline.md) calls most of
why the feature earns its place — died with the session it was realised in. This
is the other direction, and it is an **offered** act rather than an automatic
one: it is [03 §2.3](design/03-data-model.md)'s rule for session-local actors —
*promotion to the library is an explicit user action, and an offered one* —
arriving at its first implementation, one object at a time and only because
somebody pressed something.

**Why this is a route at all, which is not a preference.** The client cannot do
this as a read-modify-write because **it has never been shown the hook**. The
panel's surface ([10 §10.1](design/10-ui-surfaces.md)) is a redaction: a
`premise` only once the hook is spent, `entrances` by label and never by text,
and `involves`, `weight`, `delivery`, `once`, `notBefore` and `blockedBy` not
sent at all. Making a client-side copy possible would mean handing the panel an
unfired premise and unfired entrance text, which
[08 §6](design/08-cross-session-memory.md) and 10 §10.1 forbid by name — an
unfired entrance is hidden content, and the person reading the panel is the
person the arrival is being kept from. So the request carries **no hook
content**: it names which hook and which object, and the server is the only party
that ever holds the thing being copied.

**The id survives, and that is what the 409 protects.** A promoted hook is the
same hook, and [15 §5.1](design/15-world.md) makes keeping its id an obligation
whose failure is *unrecoverable later* — a corpus of sessions whose hooks carry
unrelated ids cannot be assembled into a continuity afterwards, because the
information that would have linked them was never written. So a target that
already carries a hook with this id is **`409 already-there`** rather than a
second copy or a re-mint. Pressing the control twice is an ordinary thing to do:
the first press leaves the panel row looking exactly as it did.

**The session is not touched.** The pool entry keeps `source: { kind: 'session'
}` and no turn is appended. Re-attributing it to the target would claim the
target owns the copy that is running, and for a `lore` target it would silently
add *eligible only while that book is active* to a hook that never had that
clause — 06 §6.1's *pulled, never pushed*, read in the direction that bites here.
A client that wants the panel to say where the hook now also lives reads the
object, not the session, which is why the reply carries the object.

**The target's history is the record.** The write goes through the same path
every other library edit takes, with a `manual` change attribution whose reason
names the session. The **conclusion** is [10 §11.2c](design/10-ui-surfaces.md)'s,
read one kind over — *the book's history is the record of the import*, so nothing
new is stored to say a hook came from a session, because the version the write
leaves behind says it where somebody looking at the object will look.

***The mechanism is deliberately not §11.2c's, and that is worth saying rather
than stepping around.*** That section's rule is concretely `source: "import"`
*naming what came in and from where*, and `VersionSource` has exactly that arm.
It is not taken here because `import` in this build means *content that was not
in this library arrived in it* — a `.sepack`, a card, a book somebody sent you —
and a promoted hook came **from** the library and never crossed a boundary. The
cost is real and is named in `sessions/promote.ts`: `manual` plus prose is not
queryable, so a later feature wanting *which sessions contributed hooks to this
treatment* would have to match a string, and the honest repair then is an eighth
`VersionSource` arm rather than a reinterpretation of this one.

**Four refusals, and each claims something different.** `404 no-session`, `404
no-such-hook` when this pool has no such id, and `404 no-such-object` when the
target has been deleted since the panel listed it — three answers rather than a
shared *not found*, because a person sent to the wrong one of them looks in the
wrong place. `409 already-there` is above. Beyond those the library's own
refusals apply unchanged: `403 read-only` for a system-library target
(copy-to-my-library is the move), `400 invalid` if the pooled hook is one the
carrier's schema refuses, and `409 diverged` if the target's file broke
underneath the write.

***`412 stale` is the one library refusal this route does not pass through***,
and answers `409 target-moved` with **no envelope** instead. The 412 arm attaches
`current` — the whole target object — so that an *editor* can offer
reload-and-reapply; on this route that object is a treatment's or a lorebook's
every hook, which means every **unfired** premise and every entrance text on it,
sent to the play client. That is exactly the content [08 §6](design/08-cross-session-memory.md)
and [10 §10.1](design/10-ui-surfaces.md) name as hidden, at the surface they name
it about, arriving through the error path of the route whose whole reason for
being server-side is that redaction. Nothing is lost by withholding it: the
client has never held the hook, so there is no *reapply my edits* it could offer,
and *try again* is the whole of the recovery.

### `POST /api/sessions/:sessionId/turns/:turnId/setup-draft`

`{ parts: ('storySoFar' | 'opening' | 'title' | 'facts')[], guidance?, openingFrom? }`
→ `200 { draft: { carry, warnings, parts } }`. **The draft of *make a setup from
here*, and it writes nothing** — P13.6,
[04 §7.2](design/04-schemas.md). `404 no-such-turn` for a turn not in the
session.

**Each part is its own call with its own outcome** — `{ ok: true, value, model }`
or `{ ok: false, reason }`, where `reason` is `role-unbound`, `role-dangling`,
`call-failed` or `no-answer` — so a failed part is a `200` beside the parts that
succeeded rather than an error that loses them. `title`'s value is
`{ name, blurb }`; `facts`' is `{ text, keys }[]`, drafted with the memory
extractor's own prompt and minus anything a linked book already says. The parts
run one after another in that fixed order. `guidance` is a person's steer,
keyed by part and at most 2000 characters each, and reaches only the part it
names. `openingFrom: 'verbatim'` answers `opening` with the narrator's last words
at the turn and makes no call.

**What the model is shown is what the player saw**: the transcript up to the
turn, and the session's own summary chain built from it — extended under the
session's own summariser key, so links already on disk are read rather than
re-derived and a link this writes is one the runner would have written. No
hidden channel, unfired hook or hidden goal reaches these prompts.

**`carry` is redacted**: the configuration and the party by name, the goal play
would begin on as `{ statement }` only when a player may read it (else
`{ hidden: true }`), and hooks as counts — `{ carried, spent }`. `warnings`
holds `no-summary-slot` when the session's preset positions no summary, so a
session started from the Setup with the same pack would never show the model the
story so far.

The step every part dispatches as is `se.condense`, `prose`-role, so a session's
`stepRoles` can send it to a different model from the narration.

### `POST /api/sessions/:sessionId/turns/:turnId/setup`

`{ texts: { name, blurb, storySoFar, opening: { label, text } }, include: { party, goals, hooks }, facts: { text, keys }[], generated? }`
→ `201 { setup: { id, name }, lorebook: { id, name } | null }`. **The commit of
*make a setup from here*** — P13.7, [04 §7.2](design/04-schemas.md). `404
no-such-turn` for a turn not in the session; library refusals as every library
write's.

**The carry is recomputed from the turn, never read from the request.** The body
holds what a person decided — the texts, the facts they kept, and which of the
three carried groups to keep — and no field that could carry a hook, a goal or a
party member, so a client can leave one out and never add one. The Setup is
built from the state at the turn as the draft's `carry` described it: the mode,
treatment, preset and lorebooks by id and name, the persona as its one option,
the party as `cast.partyDefault`, the goal the story was on first with the
achieved ones dropped, the unfired hooks the session's Setup or the session
authored, and every fired hook's id in `spentHooks`. `provenance.source` is
`session`.

**Facts become a companion lorebook, written first** — named *"<name> —
established facts"*, `provenance.source: generated` (never `session`, which the
retriever reads as a memory book and marks advisory), one entry per fact with its
keys, and linked from the Setup's `lore` as `required`. A fact with no keys is
dropped, as the memory extractor drops one. If the Setup's write then fails, the
book is removed. `lorebook` is `null` when no fact was kept.

`generated` names which fields a model wrote first — `name`, `blurb`,
`storySoFar`, `openings.written.0.text` — each `{ original, model }`, recorded in
the Setup's `generated` map with `unreviewed: false`: the wizard is the review.
**The answer carries ids and names only**, because the Setup holds hidden goals
and hooks and the person saving it is still playing the session they came from.

### `PUT /api/sessions/:sessionId/lore`

`{ treatment, lore }` → `{ session }`. The treatment is an id or `null`; `lore`
is a list of lorebook ids, and `[]` clears it. Both replace what was there
rather than adding to it.

**Selection is the only way a lorebook reaches a session.** A book does not
volunteer — its own `scope` selects nothing — so this route is what makes a
world reachable at all: without it a session started without naming books could
never gain one, and every session written before the field existed would be
stuck without one permanently. The cast route's sibling, for the same reason:
both are links a story legitimately changes partway through.

Ids that resolve to nothing are accepted, exactly as a cast's are. A dangling
link is a session missing a book, not a rejected request, and the retriever
reports what it could not read on every turn where somebody playing can see it
([00 §3.3](design/00-stance.md)).

### `PUT /api/sessions/:sessionId/roles`

`{ roles?, stepRoles? }` → `{ session }`. Each is a map from name to
`{ connectionId, modelId }`; `roles` is keyed by model role (`prose`,
`summarize`, …) and `stepRoles` by step id. Both are **replaced wholesale**, and
an omitted key means the empty map — a partial update could not express *clear
this override*, and clearing one is the commoner act.

**Two of [19 §5.1](design/19-tech-stack.md)'s five layers, and the reason they
live on the session rather than in a mode** is that section's opening sentence:
*nothing in a mode, step or extension refers to a provider or a model id*. A
binding names a `connectionId` that exists on exactly one install, so *a cheap
model for one noisy step* is an operator's decision about their own providers,
not an author's about their story.

Validated for shape and not for existence. A binding naming a connection that is
gone, or one this account may not use, is not refused: `resolveRole` drops
through to the next layer that resolves, and reports `dangling` only when none
did. Anything beyond the two ids is `400` — the route is outside `/api/admin`
and carrying no credential is what lets it be.

### `PUT /api/sessions/:sessionId/channels/:key`

`{ value }` → `{ session, effect, health, hud }`. The key is a channel key —
`se.clock`, or `se.presence#<actorId>` for a scoped channel — URL-encoded like
every other id here.

**One route for all three recoveries [06 §4.2](design/06-modes-and-turn-pipeline.md)
offers**, which is why it takes a value rather than naming an action: *retry*
sends the quarantined raw value back, *edit* sends what the person typed, and
*accept* sends the value already standing, which clears the `degraded` marker
because only an effect carrying a reason ever writes one.

**A refusal is `200` carrying the effect, not a 4xx.** A retry that still does
not fit is a recorded refusal — that is the point of writing it through the same
path a model's proposal takes — and an error status would throw away the record.
Read `effect.applied`.

The write lands as a turn with no model call and no tape, the same shape an undo
and a divergence turn take, because [03 §8.1](design/03-data-model.md) promises a
change of state is visible in the turn record.

**It is how the three offers at a goal completion are taken** —
[06 §7.3.4](design/06-modes-and-turn-pipeline.md), and why none of them needed a
route: *continue open* writes `se.goal.current` to `null` (the achievement is
retained; nothing new is set), *advance* writes it to the next goal's id, and
*end* writes `se.concluded` to `true`. **Concluded is a state, not a deletion** —
the session stays readable and branchable, and rewinding past the ending un-ends
it. Manual completion is `se.goal#<goalId>` set to `"achieved"`, which
[06 §7.3.3] keeps *always available* because the narrative judge is biased toward
*not met* on purpose.

**It is also how a hook is committed or forced** — [06 §6.1]'s two hand
controls, and the reason neither needed a route of its own. The channel is
`engine-computed`, which refuses a model and a step and **admits a person**, so
this route is the one thing that may write either.

`se.hook#<hookId>` set to `"committed"` marks a hook must-fire: it skips
eligibility, is exempt from cooldown and cadence, and opens the pacing gate every
turn until it lands. *What it does not do is choose the moment* — the selector
still runs, with the question changed from *whether* to *where*, and after
**three turns** an unplaced commitment lapses back into the pool, which the
turn's `hooks.lapsed` records.

`"forced"` is the other one and is what it sounds like: **delivered on the next
turn with no judgement call at all**, no gate and no model call. A `fired`
verdict whose `considered` entry carries `forced` is the record saying nobody was
asked. Both say what they skipped, in `overrode`.

**And it is the only way to turn a `user-only` channel**, of which the build has
one: `se.hook.pacing`, the hook selector's dial —
`sparse` | `normal` | `aggressive` | `manual-only`
([06 §6.1](design/06-modes-and-turn-pipeline.md),
[04 §6.1b](design/04-schemas.md)). A treatment may propose a level and a setup
override it, but once a session has been through this route its own value
outranks both, and rewinding past that turn hands the authored answer back. Every
other proposer is refused and recorded — a model or a step, and **the engine
too**, because how much authored plot a session pushes at a player is a person's
decision and a selector able to widen its own gate is not a dial.

### `GET /api/sessions/:sessionId`

`{ session, activeJob | null, health, hud, surfaces, cast, hooks, goals, dials,
inputs, suggesting }`. The job travels with the
session because a client reloading mid-turn needs to know there *is* one before
it decides whether to open a stream or offer an input box.

`hooks` is the hook panel's surface ([10 §10.1]): `{ pacing, rows }`, where
`pacing` is [04 §6.1b]'s three rungs already resolved — the session's own value,
a Setup's, a Treatment's — and each row carries a hook's `title`, `source`,
`state`, the `refusal` class blocking it (`null` when it is eligible now), a
`committed: { overrode }` when a person's Commit is carrying it (or
`forced: { overrode }` when they force-fired it), the `firedOn` turn if it has
gone, and its `entrances` **by label**. *The `premise` appears
only once the hook has fired and entrance **text** never appears at all*: an
unfired hook's premise is hidden content ([08 §6]), and the workbench's block
list already shows a fired hook's exact words. Empty `rows` for a session with no
pool, which is every session that was not created with one.

`goals` is `{ rows, concluded }` ([06 §7.3.3], [06 §7.3.4]): each row carries a
goal's `statement`, `visibility`, `completion` kind, whether it is `current`,
whether it is `achieved` and on which turn (`achievedOn`, derived from the path
so a rewind changes it), its authored `next`, and the `thenDefault` that *seeds*
the offer. **The three offers are not sent** — they are the same three every
time, and what decides whether to raise them is `achieved` plus `next`. *The
author's fuller `detail` does not travel*: [04 §7.1] reserves it for steps.

`goals` rows also carry `proposed` — the narrator judged the goal met and a
person has not ruled ([25 C12], answered *ask* at P7.6). `se.goal` declares
`confirm: ['achieved']`, so the judge's completion lands on the turn recorded and
**unapplied**: the three offers stay down and the panel asks. `proposed` and
`achieved` are never both true, because confirming *is* the applied effect that
clears the first.

`surfaces` is what this session's **mode** asked to have shown, and where
([06 §9], [P7.11]): `{ region, key, channelId, scopeKey, kind, label }` plus one
of `text`, `image: { url, alt }` or `on`, already resolved. Four regions — `hud`
(the strip, which a contribution *appends* to), `panel` (the stack beside the
story), `message` (a decoration on a turn) and `stage` (the picture behind it,
[10 §2.3]'s chrome). **Separate from `hud` because they answer different
questions**: `hud` is every channel that declared itself worth a strip row, and
this is every placement a mode asked for. A `kind` or a `region` a client does
not know is **skipped**, which is what keeps both vocabularies additive — and
there is deliberately no `html` anywhere in either ([10 §8]).

`inputs` is the kinds this session's mode accepts ([06 §1], [06 §9]) — Scene
sends `['do']`, Freeform `['do','say','think','story']`. It is the same list
`POST /turns` refuses against, so a client that renders a selector from it cannot
offer a kind the server will reject. *One kind means no selector*, which the
client decides.

`suggesting` is whether this session asks for suggested actions ([R11]) — a
channel, so it branches. **Off by default**, because a suggestion is a second
model call on every turn and on a self-hosted build that is the player's own
machine. The offers themselves travel on `turn.suggestions`, not here.

`dials` is difficulty and directedness ([06 §7.3.1], [06 §7.3.2]), **present only
for a mode that declares them**: `{ difficulty?, directedness? }`, each
`{ levelId, levels: [{ id, label }] }` with the levels in `rank` order. `levelId`
is already resolved over the channel and then `mode.config`, falling to the
pack's lowest rank for a level the pack does not have — so a control renders it
directly. *The levels travel because they are the prompt pack's rather than the
engine's* ([06 §7.3.1]: *"'Hard' meaning something different in one prompt pack
than another is a feature"*), and a client with its own list would produce a
recorded refusal against a pack that ships a fourth. **The fragments do not
travel**: they are what goes to the model, and the surface needs the label.
*Absent for Scene and Messages*, which declare no difficulty — [04 §7]'s
explicit case rather than an empty one.

`health` is the channels that are quarantined and why ([06 §4.2]); `hud` is the
channels declaring a `surface`, already rendered through their own `render`
template; `cast` is one row per person this story is about — presence, status,
an unanswered terminal proposal, whether they have been introduced, and who
authors them if they are travelling with you
([06 §8](design/06-modes-and-turn-pipeline.md) for the last,
[06 §8.1](design/06-modes-and-turn-pipeline.md) and
[10 §13.2](design/10-ui-surfaces.md) for the rest). The rows are the union of the
session's roster and everyone the channels name, which is the same set the
prompt is assembled around. All three are reconstructed at the
session's head, so they are the state a panel should be showing rather than a
summary of the file.

A session that is not there and one that is not yours are the **same 404**. The
path is the owner ([09 §4.3](design/09-server-multiuser-deployment.md)), and
confirming an id exists elsewhere would leak the one fact that separation keeps.

### `PATCH /api/sessions/:sessionId` · `DELETE /api/sessions/:sessionId`

`{ archived?: boolean, name?: string }` → `200 { session }`. At least one field
is required; `{}` is a `400`, so a patch that asks for nothing is refused rather
than answered with a 200 that did nothing.

`archived` toggles archive — hidden from the default list, fully intact,
restorable, never swept. `name` renames, and `""` un-names, which is the state
a session may have started in.

**A rename is one write and answers with no report**, which is why it lives here
rather than behind a verb. Compare
[`POST /api/tags/:id/rename`](#post-apitagsidrename): a tag rename reaches the
user's object files and changes which lore fires, because a lore entry's
`actorTagFilter` holds author-written *names* compared exactly — so it has to
report what it found and offer a second action. A session name matches nothing
and is denormalised into exactly one index row, so it is an ordinary property
edit and `PATCH` is what an ordinary property edit is. The same file already
renames a branch ref through `PATCH …/refs/:refId`.

`DELETE` answers `204` and **moves the folder to the user's trash** rather than
erasing it ([03 §10.3](design/03-data-model.md)); a session's turns are its history, and
deletion is a move.

### `GET /api/sessions/:sessionId/turns?limit=`

`{ turns, siblings }` — the path from the head, **oldest first**, not every turn
in the file. A session is a tree, and a transcript is one walk of it.

`siblings` maps a turn on that path to every child of its parent, in creation
order, and **only for nodes that have more than one**. History shows the
selected path only ([07 §6](design/07-branching.md)), so this is how an
alternative is reachable at all — a swipe is a sibling nobody named, and without
this it would be on disk and invisible. A map of every turn to its lone self
would grow with the transcript and say nothing.

### `POST /api/sessions/:sessionId/turns`

```
{ idempotencyKey, headTurnId: string|null, parentTurnId?: string|null,
  rewriteOf?: string, redoOf?: string, input: { text, actorId?, kind? },
  guidance? }
```

→ **202** `{ jobId, turnId, parentTurnId, status, cursor, stream }` when the turn
is reserved; **200** with the same body when the idempotency key already names a
job; **409 `busy`** carrying the active `job`; **412 `stale-head`** carrying the
current `head`; **404 `no-such-parent`** when `parentTurnId` names a turn that
is not in this session.

Both refusals carry what a client needs to recover. A bare "no" leaves a UI able
to offer only *try again*, which produces the same "no".

**`parentTurnId` is how a client branches, and its absence is how it does not.**
A submission names the node it attaches to; leaving the field out means *the
head*, and a head that has moved is still refused with `412`. Sending it means
*I mean this node*, the head check does not apply, and the turn lands as a
sibling of whatever else that node already has. The distinction is the whole of
it: a server that took any non-head parent at face value would turn every
client whose head moved under it into a branch nobody asked for, which is what
two tabs on one session look like. An explicit `null` branches from the root —
*start this story again* — and is a different request from omitting the field.
One turn at a time still holds: a second submission while a turn is in flight is
`409 busy` whether it branches or not.

**`rewriteOf` is the difference between rewrite and reroll** ([19 §14.5]). It
names a turn whose draws this one should replay: the same roll, so the same
mechanical outcome and different prose. Absent, the turn draws fresh — which is
reroll, and also every ordinary turn. **A turn id rather than a tape**, because
the draws are read from this server's record: a client cannot post the roll it
wishes it had got, and a turn from another session is `404 no-such-turn`.

Rewrite is the default of the two gestures, which is what stops swiping past a
failed check from being save-scumming by accident. A turn that consumed no
draws has nothing to reroll, and the surface must not offer it one
([19 §14.6]).

**`redoOf` is the other half of a redo**
([06 §5.1](design/06-modes-and-turn-pipeline.md), [07 §7](design/07-branching.md)).
It names a turn whose words the model is shown as *the previous attempt* — the
one this submission is redoing — so an instruction in `guidance` has something
to refer to: "make it rain harder" needs an *it*. The words come from this
server's record, never from the body, for the reason the tape does; a turn from
another session is `404 no-such-turn`. `rewriteOf` and `redoOf` answer
different questions — *whose draws* and *whose words* — and are independent: a
guided rewrite names one turn in both, a guided reroll names it in `redoOf`
alone, and a plain redo names it in neither and gets the prompt it always got.
The named turn is not required to be a sibling of the one being written; the
client always sends one, and the record carries the id either way. Usually sent
with `guidance`; the schema does not couple them.

**`guidance` is its own field and is never concatenated into `input.text`.**
That is the entire point of the guidance slot
([06 §5.1](design/06-modes-and-turn-pipeline.md)): typed into the action it lands in history
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

**`turn.hooks` says what the plot-hook selector did**, when a session has a pool
([06 §6.1](design/06-modes-and-turn-pipeline.md)): a `verdict` — `held`,
`cooling`, `nothing-eligible`, `judged-none` or `fired` — the `pacing` it was
read at, the `hookId` on a firing, and `considered`, which accounts for **every**
hook in the pool with a refusal class or `null`. *Held by pacing* and *judged
none* are deliberately different answers: a record that merged them would make a
correctly-quiet session indistinguishable from a broken one. **Absent means the
selector did not run**, which is every session with no pool — never *it ran and
had nothing to say*.

`turn.spans` is what the engine understood about the turn's text — [06 §8.2],
[03 §8](design/03-data-model.md), [10 §13.1](design/10-ui-surfaces.md). Each span
carries the `field` it indexes into (`input` or `output`), half-open `start` and
`end` offsets, a **tagged** `target` (one arm at 1.0: `{ kind: "actor", ref }`),
the `method` that asserted it (`explicit`, `matched`, `proposed` — only `matched`
is produced today), and a `confidence` that is meaningful only for `proposed`.

**An overlay, never a rewrite**: the prose is exactly what the model wrote and
the spans sit beside it, so a client that ignores the field renders the text
unchanged. **Absent rather than empty** when the extract pass did not run — which
is every turn of a session with nobody to find, and every turn taken before
P7.7. *Nothing on this path creates an actor*: the scan resolves only people the
session already has.

A `considered` entry carries `committed: { overrode }` when a person's Commit is
carrying that hook, where `overrode` is the eligibility clause it skipped or
`null` if there was none — [06 §6.1]'s rule that *skipping the filter must say
what it skipped*. `hooks.lapsed` lists the commitments that ran out of patience
on this turn and went back into the pool; it is absent on an ordinary turn and
never written empty.

### `PUT /api/sessions/:sessionId/head`

```
{ turnId: string, resume?: boolean }
```

→ **200** `{ session, abandoned }`; **404 `not-found`** for the session, **404
`no-such-turn`** when `turnId` is not a turn of it, **409 `busy`** carrying the
active `job`.

`abandoned` is `{ turns, escapedEffects }` — what the line being left keeps, and
how many of its effects escaped the session ([07 §7]). Reversibility holds for
channel state and not for what left: a library write or a generated asset cannot
be un-written by branching, so an abandoned line says how many it still has out
in the world. **It is zero until something writes an escaped effect**, which
nothing does yet.

**Moving the head moves no turn data.** It is where you are in the tree
([07 §3](design/07-branching.md)) — every node on both lines stays exactly where
it was, and the write is this session's head pointer, its channel snapshot
re-derived *at that node*, and the path the move selected.

**`resume` is the forward gesture.** From the node named, follow what was last
selected — or the only child, where there is nothing to choose between — and
stop at a fork nobody has been through. That is the difference between resuming
and guessing: a node with two children and no memory of which one you were on is
where a server would be inventing your story for you.

**Refused while a turn is in flight**, with the job, for the reason
[P2 §2.10](design/workplan/08-p2-implementation.md) gives about submissions: the
running turn will set the head when it commits, so a move that raced it would
either be overwritten without a word or overwrite the turn's own parentage.

### `POST /api/sessions/:sessionId/turns/:turnId/undo`

→ **200** `{ session, turn }`; **404** for the session or the turn; **409
`busy`** while a turn is in flight; **409 `off-path`** for a turn on a line this
session is not on; **409 `nothing-to-undo`** for a turn that changed no channel
state; **409 `not-at-tip`** carrying `keys` and `branchFrom`.

**Undo applies the effect's `before`, and the refusal is the feature.** That is
an inverse only while nothing has touched the same key since — apply it after
something has and you destroy the later change and produce a state no turn ever
wrote, plausibly enough that nothing surfaces
([21 §1.2.1](design/21-internal-contracts.md)). So a turn that is no longer the
tip **for its keys** is refused with the keys that block it and the node to
branch from instead. *Tip* is per key: a later turn on a different channel
blocks nothing.

**The undo is an append**, not an erasure — the inverse lands as its own turn,
attributed to the person, which is why undoing an undo is an ordinary undo.
Escaped effects are never inverted ([07 §7]): what left the session cannot be
un-written, and saying so is better than pretending.

### `POST /api/sessions/:sessionId/refs`

```
{ name: string, turnId: string }
```

→ **200** `{ session }` with the ref appended; **404 `no-such-turn`** when the
node is not in this session.

### `PATCH /api/sessions/:sessionId/refs/:refId`

```
{ name: string }
```

→ **200** `{ session }`; **404 `no-such-ref`**. Renaming a name does not move
the bookmark.

### `DELETE /api/sessions/:sessionId/refs/:refId`

→ **200** `{ session }`; **404 `no-such-ref`**.

**A branch ref is a name and nothing more** ([07 §3]) — an id, a name, and the
node it bookmarks. There is no `Branch` entity owning turns: a swipe is a
sibling nobody named and a branch is a sibling somebody did, so promoting one
writes about fifty bytes and moves no data. **Deleting a ref deletes a name**,
and the turns it pointed at are exactly where they were, reachable by id and by
a walk from anything below them. Several refs may name one node.

### `POST /api/sessions/:sessionId/preview`

```
{ input?: { text, actorId?, kind? }, guidance? }
```

What this turn **would** assemble to, if it were taken now — the stateless
preview ([P3 §1.6](design/workplan/15-p3-implementation.md)). → `200 { preview }`.

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
    "notFilled": [],
    "lore": {
      "books": [
        {
          "bookId": "0199…",
          "bookName": "Rain City",
          "by": "session",
          "tokenBudget": 2048,
          "tokensSpent": 41,
          "entryLimit": 100,
          "entriesKept": 1
        }
      ],
      "skipped": [{ "entryName": "The Council", "reason": "no-match", "entryId": "0199…" }],
      "refused": [],
      "unknownSources": []
    }
  }
}
```

**It writes nothing**: no job is reserved, no draft is checkpointed, no turn is
appended, and no hand edit is reconciled — the last of those deliberately, since
reconciliation appends a divergence turn and this route is called every time
somebody pauses typing. `POST` rather than `GET` because the body carries up to
100 000 characters of prose, which does not belong in a URL.

`input` is optional: its absence is *nothing typed yet*, which is what the
context meter shows at rest. It takes an optional `kind`, so a preview of a
`say` turn shows the block a `say` turn sends ([13 §8.3]). There is no `headTurnId` — the preview assembles
against the session's current head and echoes back which one that was.
`pendingInput` says whether an action or guidance was supplied, which is how the
workbench decides between showing the composed turn and the last committed one.

When no model resolves for the prose role the answer is still `200`, in its
other arm — because *nothing is bound* is a true answer to *how full is the
context*, not a refused request:

```json
{ "preview": { "state": "unmeasurable", "reason": "role-unbound", "notFilled": [] } }
```

`reason` is `role-unbound`, `role-dangling` (a binding whose connection is
gone), `no-prose-step` (the mode narrates nothing) or `not-this-turn` (it
narrates, and not on this turn — a cadence-gated prose step, [P7.9]). The last
two are different sentences with different remedies and are deliberately not
collapsed. `notFilled` rides on **both** arms: *why is there no lore in
this prompt* is answerable without a model.

`lore` rides on both arms for the same reason, and it is what the keyword tester
([10 §3](design/10-ui-surfaces.md)) is a surface over — *paste sample text, see
which entries would fire*, which needs no endpoint of its own because sample
text **is** an input.

- `books` — every book in play, which selection put it there (`treatment` or
  `session`), and what it spent of its own two limits. Reported even for a book
  that contributed nothing, because *being scanned and matching nothing* and
  *not being scanned* have different repairs.

  **Selection is the only route.** A lorebook's own `scope` selects nothing: a
  book is in a prompt because this session named it, or because the treatment
  this session names links it.
- `skipped` — **every** entry that did not fire, each with the rule that stopped
  it. This is the half nothing else records: a fired entry is already a block
  with a reason beside it. `reason` is a class the surface phrases, and the list
  is open — it will grow — so a client that meets an unfamiliar one shows the
  class itself rather than nothing. `folder` accompanies the folder gate, naming
  the outermost shut folder.
- `refused` — patterns that could not be run, deduplicated by key. One bad
  pattern in an entry scanned across eight messages is one problem, not eight.
- `unknownSources` — sources entries asked to scan that nothing supplied. An
  entry looking somewhere that does not exist never fires and looks exactly like
  an entry whose keys are wrong.

Nothing here is truncated. A surface may cap what it shows; a report that
arrived pre-trimmed could not offer *and 40 more* honestly.

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

`progress` keys are [09 §3.3](design/09-server-multiuser-deployment.md)'s vocabulary:
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
rather than every delta that painted it live, which [P2 §2.10](design/workplan/08-p2-implementation.md)
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
no stop-sequence machinery ([19 §5.5](design/19-tech-stack.md)). A local model
is a connection with a `localhost` URL and no key — llama.cpp, Ollama, vLLM, LM
Studio and KoboldCpp all expose the same shape. A completion-only service needs
a translating proxy in front of it, which is an off-the-shelf thing to point at
rather than a path this server maintains.

**Connections are usable but never readable.** A user sees a label, a provider
type and which models it offers. Not the key, and not the endpoint URL — which
can itself carry a token or name a private host
([09 §4.5](design/09-server-multiuser-deployment.md)). There is no
copy-to-my-library for a connection, because copying would mean copying the
credential.

---

## Settings

Everything a signed-in person may change about themselves
([10 §15.1](design/10-ui-surfaces.md)). Roles, enabled flags and capabilities are
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
`users/<handle>/prefs.json` ([25 B13](design/25-open-questions.md), resolved).

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

### `GET /api/me/roles` · `PUT /api/me/bindings`

```json
{
  "roles": [{ "role": "prose", "tier": "hi", "ok": true, "via": "binding", "…": "…" }],
  "bindings": { "prose": { "connectionId": "0199…", "modelId": "gpt-lo" } },
  "contentHash": "sha256:…",
  "connections": [
    { "id": "0199…", "label": "The house key", "provider": "openai-compatible",
      "scope": "system", "models": ["gpt-hi", "gpt-lo"] }
  ],
  "disabled": []
}
```

**What *your* turns will do, where `GET /api/admin/roles` says what the install
has got.** Same row shape; different layers. This one resolves your own
`users/<handle>/bindings.json` over the install defaults against the connections
you may actually use, which is [19 §5.1](design/19-tech-stack.md)'s order — and
`via` is the whole reason to ask a server rather than work it out in a browser.

One request carries the whole pane: the resolved table, the raw document to edit,
a hash to write against, and the connections a binding may pick from with their
model lists. `disabled` is personal connections on disk that were ignored for
want of `privateConnections`, returned rather than dropped so you are told rather
than left wondering why a model call started failing
([09 §4.5](design/09-server-multiuser-deployment.md)).

`PUT /api/me/bindings` takes `{ bindings, contentHash }` and answers the same
`{ bindings, contentHash }`. The document is **replaced wholesale** — it is
exactly its known role keys, so there is nothing a merge would preserve — and the
hash is the library's stale-check idiom: a mismatch is
`412 stale` carrying `current`, so a client can offer *load what is on disk*
rather than only being told no. That matters more here than for the system file,
because [10 §4](design/10-ui-surfaces.md) says hand-editing this one works.

**No administrator is involved, and no capability is checked.** [19 §5.1] is
explicit that *anyone who wants their own key overrides a role without the
admin's involvement*. A binding is two ids; what keeps that safe is that
`resolveRole` looks the `connectionId` up in the capability-filtered list, so one
naming a connection you may not use can never be access — it falls through to the
layer below. A role this build does not know is dropped rather than refused, so
a newer client is not an error; **anything else inside a binding is `400`**, which
is what lets this route live outside `/api/admin`.

---

## Administration

Everything under `/api/admin` needs an administrator, enforced by **one
`onRequest` hook on the prefix** rather than a check per handler — two spellings
of a guard is how the second one gets missed
([P2A §2.4](design/workplan/09-p2a-configuration-surface.md)).

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
[09 §4.5](design/09-server-multiuser-deployment.md) commissioned — *"2 users have
no usable connection"* — needs a number, not a list of what somebody has
configured. A connection stays opaque, so nothing here names one.

An account has a usable connection **if `prose` resolves for it** — the turn's
own question, asked through the turn's own resolver, so the capability above is
honoured by the same code that honours it at call time.

*This counted connection **files** until
[P2B](design/workplan/10-p2b-provider-configuration.md).4, and that could not
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
[21 §4](design/21-internal-contracts.md)'s claim that the annotation *is* the
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
watcher — [09 §6.2](design/09-server-multiuser-deployment.md)'s hot-reload claim
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
([P2B §2.7](design/workplan/10-p2b-provider-configuration.md)).

**Two shapes exist and the boundary between them is the key alone.** What a
non-admin can reach carries a label, a provider and its models
([09 §4.5](design/09-server-multiuser-deployment.md)); this adds `baseUrl`,
because a form that cannot show the URL back is a write-only form — type it,
save, reopen, and the field is empty.

`hasKey` rather than the key, and not because the key is merely hidden: *a key
is set* and *no key, this is a local endpoint* are different states an
administrator has to tell apart, and an empty password box cannot distinguish
them. Without it the form would either mangle the stored key or make somebody
retype it on every edit.

`shadowed` means an earlier file in resolution order already claims this id, so
nothing will ever resolve to this one. Both are listed and nothing is blocked —
[P1 §1.2](design/workplan/07-p1-implementation.md)'s posture — but the one that
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
([P2B §2.8](design/workplan/10-p2b-provider-configuration.md)) — being told
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
([19 §5.1](design/19-tech-stack.md)). A whole document rather than a patch per
role: eight roles is not a chatty write path, and a wrong binding stops turns
rather than collapsing a pane.

`PUT` presents `contentHash` and answers `412 stale` with `current` **and the
`contentHash` of what is on disk now** — so *overwrite with mine* has something to
present and a refused save is not a wedge. (Both binding writes withheld that hash
until 2026-09-11; nothing wrote bindings from a form, so the gap was unreachable.)
A hash the
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

**Two bindings in, a whole document out** — [19 §5.1]'s *a good one and a cheap
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
([21 §1.4](design/21-internal-contracts.md) specifies no such field), and
returned by nothing before this. A surface showing it would have had to
reimplement [19 §5.1]'s layering in the browser, against two binding maps it
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
which of their bindings are personal is [10 §15.1](design/10-ui-surfaces.md)'s,
and waits with the rest of that half.

### `GET /api/admin/notices`

```json
{
  "pendingRestart": ["server.port"],
  "canRestart": false,
  "build": { "version": "1.0.0-alpha.1", "commit": "a54afcc…" }
}
```

Its own route because the restart banner is on **every** page rather than on the
settings page ([09 §6.3](design/09-server-multiuser-deployment.md)) — the person
who needs to know is often not the one looking at the form.

Computed per request and stored nowhere, which is what makes it self-healing:
change a value, change it back, and the list empties. It is also why every
administrator sees the same list — one process, one answer, not a per-session
note.

**`build` is what this build is**, or `null` for one nobody identified — which
is every development run and anything not produced by a release
([P6A §1.5](design/workplan/19-p6a-alpha-1.md)). Written into the artifact at
build time rather than read from the environment, so a container cannot claim to
be something it is not. `null` rather than `0.0.0` or `"unknown"`: a version
string that is not a version is the thing a bug report quotes back at you. Since
alpha.2 the UI renders it — the footer on every page and the About block at the
top of Settings — from `GET /api/auth/state`, which carries the same value for
everyone; the About surface those grow into is [P11.6]'s. This copy stays on
**this** route because this is already the *state of this install* answer the
admin shell asks for on every navigation.

`canRestart` is `false` and says so rather than being absent. **The server does
not restart itself**: under no supervisor a restart control leaves the
administrator with no server and possibly no shell
([09 §6.4](design/09-server-multiuser-deployment.md)), so it needs supervisor
detection and a drain, neither of which exists. A notice that invites *"so how do
I restart it?"* is a worse answer than one that says.

---

## Backups

*Added at [P12.3](design/workplan/29-p12-implementation.md).* An archive of a
data directory, or of one account's part of it, written into the data directory
itself and meant to be copied somewhere else.

**Two halves that differ in one word.** `/api/me/backups` answers for the
account holding the session cookie; `/api/admin/backups` answers for the
install and sits behind the `adminOnly` hook on its prefix. There is **no
`:handle` parameter anywhere here** — the owner comes from the cookie, which is
[09 §4.3](design/09-server-multiuser-deployment.md)'s *the path is the owner*
arriving at the API.

**Taking one is gated by no capability.** `scheduledBackups`
([P12.4](design/workplan/29-p12-implementation.md)) governs whether the *server*
takes backups on a timer, because a misconfigured schedule is how a data
directory fills up while nobody is looking. A person pressing a button is not
that.

### The backup record

```json
{
  "id": "0199aa33-7c41-7b0e-9d1a-4f2c8e5a1b60",
  "scope": "account",
  "handle": "ned",
  "contents": "full",
  "takenAt": 1790000000000,
  "bytes": 184320
}
```

`id` is a uuidv7 and **is where `takenAt` comes from** — its first forty-eight
bits are the millisecond it was minted. Nothing here is read from a database:
the listing is a directory read, so deleting an archive by hand is a non-event.

`contents` is `full` or `redacted`. A **full** archive carries credentials —
the account's `connections/`, and for an install archive `accounts.json` and
the session signing key — which is what makes it restorable. A **redacted** one
omits them, and restores to an install nobody can sign into.

### `POST /api/me/backups`

**Takes one now** → `201 {"backup": …}`.

```json
{ "contents": "full" }
```

`contents` is **required and has no default**: the two produce genuinely
different files and the difference is a person's to make.

***A file whose path no tar header can name does not fail the archive.*** ustar
holds 255 bytes across its two name fields and our own longest path is about
232, so this is reachable by hand rather than by us — the library is a folder
somebody may open in a text editor. Such a file is **left out and named in the
manifest's `omitted` at `warn`**, because all-or-nothing is the right failure
for a *restore* and the wrong one for a backup: it would leave an install with
no archive at all, discovered on the day somebody needed one.

### `GET /api/me/backups`

**Everything this account has** → `200 {"backups": […], "totalBytes": n}`,
newest first.

`totalBytes` is what they weigh together. Retention is deliberately not built
([P12](design/workplan/29-p12-implementation.md)), so this number and the delete
below are how a person prunes.

### `GET /api/me/backups/:id/download`

**The archive** → `200`, `application/gzip`, with `content-length` and a
`content-disposition` naming the file. `404` for an id this account has no
archive for — including one that exists for somebody else, because whether an id
exists elsewhere is worth hiding.

***The one route in this API that streams a file body.*** Every other
`content-disposition` route sends a document it already holds; an archive is not
bounded by anything.

`:id` must be a uuidv7 or the request is refused before a handler sees it, and
the handler resolves it against the directory listing rather than building a
path from it.

### `DELETE /api/me/backups/:id`

**Removes it** → `204`, or `404` if it is not there.

### `GET /api/me/backups/settings`

**This account's schedule** → `200 {"settings": …}`.

```json
{ "frequency": "weekly", "onStart": true, "contents": "redacted" }
```

`frequency` is `off`, `daily` or `weekly`. `onStart` is **independent of it**
rather than a fourth value in the list: a machine that is up for an hour and a
machine that is up for a month want different halves, and one that is usually up
but occasionally rebooted wants both.

An account that has never set one reads back `off`, `false`, `full`. **Readable
without the capability**, and the body carries no *may they* flag — the client
gates the form on `capabilities.scheduledBackups` from `auth/state`, the same
way the connections panel is gated on `privateConnections`.

### `PUT /api/me/backups/settings`

**Replaces it** → `200 {"settings": …}`.

**Every field is required**, and unknown keys are refused. A patch would let a
client that knew about two fields leave the third at whatever it was, where the
failure is a schedule somebody believes they turned off.

`403 no-scheduled-backups` when an administrator has not granted
`scheduledBackups` for this account. **The route is the boundary and the UI is
never it** ([09 §4.5](design/09-server-multiuser-deployment.md) calls a UI-level
check a trivial bypass), which is how `fileAccess` is enforced at
`POST /api/import/sweep`. It is 403 rather than 404 because a client needs to
tell *you may not* from *there is no such thing*.

***Taking a backup is never gated by this.*** The capability governs the server
writing archives on a timer nobody is watching, which is the one way a setting
somebody made once fills a data directory — and a full disk stops the server
writing turns for everybody. A person pressing a button is not that.

### `GET /api/me/backups/:id/manifest`

*Added at [P12.10](design/workplan/29-p12-implementation.md).* **What is in
that archive** → `200 {"manifest": …}`.

```json
{
  "schema": "storyengine.backup-manifest/1",
  "scope": "account",
  "handle": "ned",
  "contents": "full",
  "takenBy": { "version": "1.0.0-alpha.1", "at": "2026-09-20T10:00:00.000Z" },
  "reason": "manual",
  "files": 42,
  "unpackedBytes": 512000,
  "handles": ["ned"],
  "omitted": []
}
```

**It costs one gzip block**, because `backup.json` is written as the archive's
first member and this reads the first member or nothing. An install archive is
not bounded by anything, so the difference between that and inflating it is the
difference between a question a person can ask casually and one they cannot.

`404` for an id this owner has no archive for. **`422 unreadable`** for a file
that will not read as one of ours — not a 500: an archive is a file that
survived, from a disk that may have had a bad week.

***This is what a backup import offers instead of a preview.***
[P4 §1.4](design/workplan/16-p4-implementation.md) settled that for every
import: a **sweep** commits and reports, because a staging area for three
hundred objects is a second library, and `import/preview.ts` is the other case —
one hand-picked file. A backup import is a sweep, so what a person reads before
committing is the archive's own account of itself, which is what the controls
turn on. `unpackedBytes` is also [P12.11]'s free-disk check.

### `POST /api/me/backups/import`

*Added at [P12.9](design/workplan/29-p12-implementation.md).* **Brings an
archive's content into this account** → `200`.

```json
{
  "id": "0199aa33-7c41-7b0e-9d1a-4f2c8e5a1b60",
  "onConflict": "skip",
  "options": { "connections": false, "prefs": false }
}
```

**Import is not restore.** This merges into a *running* server and touches
nothing that is install authority: `accounts.json`, `state/` and
`system/library/` are never read. That line is what keeps the two verbs distinct
rather than a slider, and it is why somebody who clicks the wrong one loses
nothing.

**Work and tags always; everything else is a switch somebody ticked.** Library
objects and sessions are what a person means by *my stuff*, and tags travel with
them because objects reference tags **by id** ([05 §4](design/05-tagging.md)) —
an import without them would leave every imported object pointing at names that
resolve to nothing. `connections` and `prefs` each default **false** and each is
**reported whether taken or not**, because *my keys did not come across* is a
question with an answer rather than a bug report.

`onConflict` is `skip` (the default), `keep-both` or `replace`. ***The default
differs from `POST /api/import/sweep`'s deliberately***: a re-imported foreign
file *is* the object that file produced, where a backup meeting a live account
is the past meeting the present — and the present is usually what somebody wants
to keep.

The response carries the same `report` every other import returns, with its
`jobId` in the same ledger, plus `sessions`, `tags` and the `notes` the optional
groups produced:

```json
{
  "report": { "jobId": "…", "source": "storyengine-backup", "items": [], "counts": {} },
  "sessions": { "imported": 2, "skipped": 0 },
  "tags": { "added": 1, "kept": 4 },
  "notes": [{ "key": "import.backup.prefsNotTaken", "params": {}, "level": "info" }]
}
```

`403` for a `handle` that is not this account's — a person may only read their
own subtree. `422` for an archive that will not read, or that does not hold the
handle asked for.

***The archive is named by id rather than uploaded***, which is a scoping
decision rather than an omission: a person's backups are already on this server,
because that is where they land. Moving one **between** installs is the upload
case, and an archive dropped into `data/backups/` by hand is listed and
importable today — the same capability with the file transfer done by whatever
already moves files onto that machine.

### `POST /api/admin/backups`, `GET /api/admin/backups`, `GET /api/admin/backups/:id/download`, `GET /api/admin/backups/:id/manifest`, `DELETE /api/admin/backups/:id`

**The same four, for the whole install.** Identical bodies and responses, with
`scope: "install"` and `handle: null`. An install archive carries every
account's work, `config.json`, `system/`, the operational store and — when it is
`full` — `accounts.json` and the session key, so it lives at `data/backups/`,
outside every user directory, for the reason `accounts.json` does.

**What an archive never carries**, whatever the scope: `index/`, which is
derived and whose presence would restore *a stale belief about a newer tree*;
`users/<handle>/trash/` ([03 §10.2](design/03-data-model.md)); and the backups
directories themselves.

### `POST /api/admin/backups/import`

**The same import, per account** — same body, same response, with two
differences.

`handle` is **required**, and a handle with no account on this install is
`404 no-such-account` rather than an account created to receive it: **an account
created from an archive has no password**, and who may sign in is not a thing an
archive gets to decide. There is deliberately no *all of them* arm.

`options.config` is offered here and only here. It merges the archive's
`config.json` through the same path `PUT /api/admin/config` uses, so
`pendingRestart` is computed as usual and announced to administrators — with
**`dataDir` and `server.clientRoot` refused by name**, because both are
filesystem paths on the machine the archive came from: one would point a running
server at a directory that may be somebody else's, the other would make it serve
a 404 where the built client used to be. Ticking it on an *account* archive is
`403 not-install-scope`.

### `POST /api/admin/restore`

*Added at [P12.11](design/workplan/29-p12-implementation.md).* **Puts an
archive back as the install** → `202 {"draining": true, "plan": …}`, and this
response is the last thing the process sends.

```json
{ "id": "0199aa33-7c41-7b0e-9d1a-4f2c8e5a1b60", "acceptRedacted": false }
```

***Restore is not import.*** It **replaces** the data directory rather than
merging into it, and a running server cannot do that to itself in place: it
holds open sqlite handles on files the archive would overwrite, and the session
key it would replace is the one validating this request. So it is a handoff
across a restart — write a marker, drain, exit, and swap on the next boot
([P12.12](design/workplan/29-p12-implementation.md)).

**Every precondition is checked while the server is still answering**, because
a refusal after the process has exited is one nobody can read:

| Status | `error` | When |
|---|---|---|
| 409 | `unsupervised` | Nothing would start the process again. The message carries the shell command instead |
| 404 | `not-found` | No install archive with that id. An *account* archive lands here rather than at `wrong-scope`, because the install's listing does not hold one |
| 409 | `wrong-scope` | An account archive reached the check anyway. Restoring one would leave the install holding that account and nothing else |
| 409 | `needs-confirmation` | A `redacted` archive without `acceptRedacted: true`. It carries no accounts, connections or session key, so nobody could sign in afterwards |
| 409 | `unreadable` | The archive does not read end to end, or holds fewer members than its manifest claims — a copy that ran out of space, a download that stopped |
| 409 | `unsafe-path` | A member that would escape the data root when written out |
| 507 | `no-space` | Less free space than `unpackedBytes` plus a tenth. **The directory being replaced is kept rather than deleted**, so a restore needs room for both |

***The archive is read end to end, and that is the expensive check earning its
place.*** A truncated archive is invisible from the manifest — the manifest is
the first member, so it is the part that always survives — and finding out half
way through the unpack means finding out after the old directory has been
renamed aside.

On success `state/restore.pending` is written with the archive's
**data-root-relative** path, the manifest, who asked and `attempts: 0`. The
marker lives inside the directory the swap moves aside and **no archive carries
one**, so a successful restore cannot leave one behind and an unsuccessful one
keeps exactly the state that describes itself.

### `DELETE /api/admin/restore`

*Added at [P12.12](design/workplan/29-p12-implementation.md).* **Calls off a
pending restore** → `204`, whether or not there was one.

***The one door out of a marker the boot will not act on.*** A restore that
fails to unpack keeps its marker deliberately — the failure has to survive into
the next boot to be refused there, and deleting it would turn *this did not
work* into *nobody ever asked*. But a marker nothing will act on and nobody can
remove is a trap on exactly the install this feature exists for: [25 E6]'s
operator has a shell, and `docs/deploy.md`'s household one has a web page and
nothing else.

**What happens on the next boot**, for an accepted restore: before anything
opens a handle on the data directory, the archive is unpacked to a **sibling**
directory, the live directory is renamed to `<dataRoot>.replaced-<uuidv7>`, and
the new one is renamed into place. Two renames on one filesystem; the window
between them is the only unsafe moment and it is microseconds wide.

***The replaced directory is kept and never deleted***, on `removed/`'s
precedent — *StoryEngine will not delete this; remove it yourself when you are
sure*. That is the undo, and the only property that covers *the restore worked
and was the wrong archive*. A `system.notice` names it on that boot, which is
the one place in this build where a filesystem path is deliberately put in
front of a person.

**A failed unpack leaves the install untouched** — everything is written before
anything is renamed — rewrites the marker with `attempts: 1`, and boots
normally. **A second attempt is refused rather than made**: a supervisor
restarts a process that exits, so an unpack that kept failing would take the
install down rather than one boot.

***And the archive carries no index***, so the restored install rebuilds it on
that same boot — which is [P11.11](design/workplan/28-p11-implementation.md)'s
proof obligation arriving for free.


## Errors

| Status | `error` | Means |
|---|---|---|
| 400 | `invalid` | The object failed schema validation, named a schema this build does not know, or was posted to a kind that is not its own. Carries `issues` — `{path, message}` per field — whichever validator refused it |
| 401 | `unauthenticated` | No session |
| 401 | `invalid-credentials` | Login failed |
| 403 | `csrf` | Missing or mismatched `x-csrf-token` |
| 403 | `read-only` | A system-library object |
| 403 | `forbidden` | A signed-in non-admin on `/api/admin` |
| 403 | `invalid-setup-token` | Creating the first admin on an install bound beyond loopback, with the console token missing or wrong |
| 404 | `not-found` / `unknown-kind` | No such object, or no such kind — and an address under `/api` that matches no route at all, which answers JSON rather than the client's app shell |
| 409 | `busy` | The session already has a turn in flight. Carries the active `job` |
| 409 | `finished` | That turn is already over, so there is nothing to cancel |
| 412 | `stale-head` | The session moved on since this was composed. Carries the current `head` |
| 409 | `conflict` / `already-setup` | That id already exists; setup already ran |
| 409 | `exists` | An account with that handle already exists |
| 409 | `last-admin` | The change would leave the install with no administrator who can sign in |
| 413 | `too-large` | The preference document would exceed its size cap, or an upload exceeds `limits.maxUploadMb` |
| 415 | `not-multipart` | An upload that was not `multipart/form-data` |
| 403 | `no-file-access` | A sweep from an account without the `fileAccess` capability |
| 422 | `inside-data-root` / `not-absolute` / `unreadable-root` | A sweep root this build will not read |
| 422 | `live-install` / `unknown-format` / `ambiguous-root` | A source folder refused before anything was written |
| 400 | `no-file` | A multipart upload with no file part |
| 412 | `stale` | Hash mismatch — `current` holds the object as it is now. **A 412 always carries a hash different from the one you sent**; if it did not, reload-and-reapply could not terminate, which is exactly what `diverged` below exists to stop happening |
| 409 | `diverged` | The file on disk cannot be read, and the index still holds the last good version — a hand edit that broke the file. **Not a retry**: nothing about the request is wrong, so reloading returns the same hash. Repair the file, or `DELETE` the object, which works in this state on purpose |
| 422 | `refused-path` | The object's folder name is one this build will not open — `con`, a trailing space. The message names the reason and the segment, never a filesystem path |
| 428 | `hash-required` | A write with no content hash |
| 404 | `no-such-parent` | A turn submission named a `parentTurnId` that is not a turn of this session. The request is well formed and names something that is not there, which is why it is a 404 rather than a 422 |
| 422 | `unknown-input-kind` | A turn submission whose `input.kind` is not one this session's mode declares ([06 §1], [P7.9]). Carries `accepted`, the mode's list. **A refusal rather than a coercion to `do`**, because the kinds change what the prompt says — narrating a `think` as a `do` would put the player's private thought in the scene, which is the one failure the kind exists to prevent |
| 404 | `no-session` / `no-such-hook` / `no-such-object` | Promoting a pooled hook out of a session ([03 §4.1]): the session is gone, this pool has no hook with that id, or the library object being promoted to has been deleted. **Three answers rather than one**, because they send a person to three different places and the union of them helps nobody |
| 409 | `already-there` | The promotion target already carries a hook with this id. **Never a second copy and never a fresh id** — [15 §5](design/15-world.md) makes the id the only thing that links two firings of one hook across sessions, so re-minting it is the move that cannot be undone |
| 404 | `no-such-channel` | A channel write to a key this session's mode does not enable ([06 §4.1], [P7.9]). The registry is process-wide and a session is not: a channel owned by a *mode* belongs to a session playing it, and one owned by a *package* — cast, hooks, goals, lore, suggestions — is available everywhere. **A 404 rather than a 422**, because *that exists but not for you* would leak which modes the build ships from a session route |
| 503 | `setup-required` | No accounts exist yet |
| 500 | `internal` | Something the server did not expect. The message is deliberately uninformative — the detail is in the log, where it can name a filesystem path safely |

---

## Not here yet

~~No workbench (P3),~~ ~~no import (P4),~~ ~~and no static file serving~~: in
development the client runs on Vite's dev server and talks to this over `/api`.

*Three clauses, three phases, and only the setting survives. The workbench
shipped at P3 as a reader over the turn record and needed no route of its own.
Import finished at P4.4 and P4.5 — both halves the paragraph below still calls
missing — and the directory form previews what it would do before it writes.
Static serving arrived at [P6A.1](design/workplan/19-p6a-alpha-1.md) behind
`server.clientRoot`, unset in development, so the sentence stays true where it
was written and is false in a packaged build, where one process serves both
halves.*

*Mode and preset selection on a session was listed here and shipped at P2.6; it
is documented under Sessions above. The provider settings surface was listed
here and shipped at [P2B](design/workplan/10-p2b-provider-configuration.md); it
is documented under Administration above. **Import was listed here and is half
shipped at P4.1**: single-file upload exists and converts presets, under Library
above. Cards and lorebooks convert at P4.2 and the directory sweep is P4.4, so
the clause is struck rather than deleted — the half that is missing is still
worth naming.*

*`POST /api/library/:kind` acquired its first client caller at P4.5, three
phases after the route shipped — `DELETE` got one at P4.4. Neither route
changed. What changed is the audience: `400 invalid` with `issues`,
`409 conflict` and `412 stale` are sentences a person reads on a page now
rather than `curl` output, which is the first real test of whether they say
anything useful.*

**One half of it is still deferred, deliberately**, so it is named here rather
than left to be discovered: there is **no route that writes a user's own
connection or their own `bindings.json`.** P2B writes the system scope and only
the system scope ([P2B §2.7](design/workplan/10-p2b-provider-configuration.md)),
and [10 §15.1](design/10-ui-surfaces.md)'s *your connections* half waits with the
rest of the user surface. Both files are read by the resolver and hand-written
by anyone who wants one, exactly as before.
