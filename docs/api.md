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
([22 §4](design/22-internal-contracts.md)); in development it is unset and the
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

**The gate asks which route the request reached, not how its path was spelled**
(2026-09-27). The router decodes a path before matching it, and the gate read
the raw one, so `/%61pi/…` reached every route past it. The same is true of the
CSRF check below.

### CSRF

Double-submit: `se_csrf` is a script-readable cookie, and its value must come
back in the `x-csrf-token` header. A cross-site caller can cause the cookie to be
*sent* but cannot read it to set the header.

**Only requests carrying a session are checked.** Setup and login have no ambient
authority to abuse — forging either requires already knowing the password — and
requiring a token there would be a bootstrap paradox, since the token is issued
*by* signing in. `SameSite=Lax` covers the login-CSRF gap that leaves.

**At every address** (2026-09-27). The check was limited to paths spelled
`/api/…`, and the router also answers `/%61pi/…`, so a page on another port of
the same machine could restart the server or post into a signed-in person's
library with no token. Outside `/api` only `GET` and `HEAD` are served, so the one
visible change is that a signed-in `POST` to an address nothing serves is `403
csrf` rather than the page.

### Sessions

A signed stateless cookie, 14 days, `httpOnly` + `SameSite=Lax`. **No `secure`
flag**, because there is no HTTPS by default on a LAN and a `secure` cookie over
plain HTTP is simply never sent — login would appear to succeed and nothing would
be logged in.

Logout clears the cookie. A copy already taken elsewhere stays valid until it
expires; that is the honest cost of having no session table, argued in
`packages/server/src/auth/session.ts`.

**The cookie names one account, not a handle** (2026-09-27). It carries the
account's `createdAt` beside the handle, and a request whose account was created
at another time is anonymous. Before, a removed account's cookie signed into the
next account given the same handle. A cookie from before this has no
`createdAt` and is refused, so everyone signs in once more after upgrading.

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
digits and hyphens, 1–63 characters, starting with a letter or a digit, not
ending in a hyphen, and not a Windows reserved device name. One that breaks the
rule is `400 invalid` with the rule as the message (2026-09-27; it was a `500`).

`locale` is defaulted from `Accept-Language`.

### `POST /api/auth/login`

`{ handle, password }` → `200 { account }` or `401 {"error":"invalid-credentials"}`.

**One answer for a wrong password, an unknown handle and a disabled account.**
The caller cannot tell which, which costs nothing here and avoids a handle
oracle. ***Nor from how long it took*** (2026-09-27): an unknown or disabled
handle pays the same key derivation a wrong password does. It answered in about a
millisecond against fifty, which listed the handles a request each.

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
`setups`, `presets`, `worlds`. An unknown kind is `404` and the message lists
the known ones.

***`worlds` was `packages` until [P16.0](design/workplan/35-p16-world.md)***
(2026-10-10), when the kind was renamed — `storyengine.package/1` became
`storyengine.world/1`, the folder `library/worlds/`, the file `world.json`.
**The old segment is not kept**: `/api/library/packages/*` is the unknown-kind
`404` above, because the only caller was the client that ships with this server
([P16 §1.1](design/workplan/35-p16-world.md)). The old *data* is kept: a World
still stored as `library/packages/<slug>/package.json` is listed, read and
written under `worlds` like any other — its first write moves the folder to
`worlds/`, under a fresh slug if a World already holds its own, and keeps the id
([03 §5.1](design/03-data-model.md)) — and a body that says
`storyengine.package/1`, sent to `POST` or `PUT` under `worlds`, is accepted as a
World and written as `storyengine.world/1`. **Reads answer the new id**: a body
is upgraded at every door it comes in through, so a `GET` returns
`storyengine.world/1` for a file that still says otherwise on disk.

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
(it parses, but declares another schema or has no id), `schema` (it is that
kind and fails validation), `unusable-name` (the folder is named something this
build will not open, such as `con`), `unreadable` (the file is there and cannot
be read — its permissions, or a directory where the file should be), or
`refused-path` (it is a link that leads out of the data directory). `detail` is
the parser's or the validator's own complaint, which is the part anyone can act
on. `path` is **relative to the data
directory**: the client needs to know which file, not where the server keeps its
disk.

This exists because the alternative was silence. A hand edit that breaks a file
is skipped by the index — the last good version stays readable and the write
path refuses to overwrite bytes it cannot read — but until this route the person
who saved the file got no error, no toast, and a stale object
([03 §5.1](design/03-data-model.md)). An entry clears when the file parses again,
or when it is deleted.

The library page lists these over its list, and since 2026-09-28 the page of an
object whose file broke after it was read says so where it is opened — the
reason, the complaint and the path — with Edit withheld and Delete kept. It is
matched by `source`, `kind` and `slug`, which is all a broken file still has.

### `POST /api/library/:kind`

Body is the portable object, or `{ object }`. → `201 { id, slug, contentHash, object }`.

The slug is derived from `name` here, once, and then frozen. Duplicates get a
numeric suffix from `-2`.

**`{ object, copyOf }` makes a copy that brings its pictures** (2026-09-27).
`copyOf` is the id of the object this one copies — readable by the account and
of the same kind, or the create is `404` and nothing is written. A picture is
bytes the JSON only names, so without it a copy's every picture was broken:
with it, an actor is written into the source's card, which carries its portrait
and its expressions, and any other kind gets the source's file for each picture
row the copy names. Honoured only in the envelope, never on a bare object.

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
becoming a fork. (The two other reads of an object take it too —
[`/download`](#get-apilibrarykindiddownload) and
[`/export/:format`](#get-apilibrarykindidexportformat), since 2026-09-27 — so a
copy's page hands over that copy's file.) It is **not the canonical address**:
an object is its id, and this narrows a read the way a filter does. And it is
**`slug`, not the path** — the stored path is the native absolute one and
differs by platform, while the folder name is the same string everywhere.

### `PUT /api/library/:kind/:id`

Body `{ object, contentHash? }`. The hash you last read must be presented, as
either the `If-Match` header or `contentHash` in the body. Header is the HTTP
spelling and preferred; the body field exists because a hand-written `curl` in
the exit gate should not need one.

- `200 { contentHash, object }` on success — the hash is new, keep it.
- `428 {"error":"hash-required"}` if you sent none.
- **`412 {"error":"stale", "current": …envelope}`** if the object moved since you
  read it.
- **`409 {"error":"diverged"}`** if the file on disk cannot be read as an object
  of its kind: it will not parse, it names another kind or no id, or it fails
  its schema. ~~cannot be read at all~~ (corrected 2026-09-28 — below).

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

**"Unreadable" is the index's word for it, not the parser's** (2026-09-28). The
line was drawn at *does it parse*, and the index draws it at *would I take it*:
a file that is JSON and not a valid lorebook is quarantined with the last good
row kept, like one that is not JSON at all. The writes called it an edit, so a
save was a `412` whose envelope was the refused file and the loop was back, and
a `DELETE` was a `412` every time. Both paths now ask the index's own check
(`acceptObject` in `index-db/ingest.ts`), so such a file is `409 diverged` on
save and deletable — the same answers as bytes that do not parse.

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
([22 §5](design/22-internal-contracts.md)) and its migration policy is
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
path ([22 §4.1.1](design/22-internal-contracts.md)). `disposition` is
`converted`, `recorded` or `unrecognised` — or `unchanged`, for a re-upload of
what is already here — and `recorded` is the interesting
answer: a PNG card today is a file this build converts at **P4.2**, so it is
reported as *not yet* rather than refused as broken. Answering `4xx` would tell
somebody their file is wrong when the truth is that the build is unfinished.

Notes are `{ key, params, level }` and never sentences — the client composes the
prose ([P4 §1.4](design/workplan/16-p4-implementation.md)).

- `413 {"error":"too-large"}` over `limits.maxUploadMb`, **read per request**.
  That is what moved the key from `unread` to `applied` after three phases as
  the standing example of a live key nobody read: raise the limit in Settings and
  the next upload takes the file, without a restart. ~~Fastify's constructor
  `bodyLimit` stays as the outer bound.~~ *Corrected 2026-09-27:* Fastify's
  `bodyLimit` never sees a multipart body, so this is the only bound. **Since
  [P13.8](design/workplan/30-p13-aventuras-import.md) a zip or a SQLite database
  is bounded by `limits.maxImportUploadMb` instead** (below), and the message
  names which of the two refused it. A request whose declared length is past
  both is refused before its body is read.
- `415 {"error":"not-multipart"}` for a body that is not multipart.
- `400 {"error":"no-file"}` for a multipart body with no file in it.
- `507 {"error":"no-space"}` when there is no room on the disk: for 1.1× a
  landed upload and a reserve before it is written (below), or for the copy of
  an Aventuras database the sweep reads from.
- `503 {"error":"upload-busy"}`, with `retry-after`, when another **large**
  upload is being landed — one declared larger than `limits.maxUploadMb`, or
  declaring no length at all. One at a time, server-wide, because the disk is.
- `408 {"error":"upload-stalled"}` when the file stopped arriving for a minute
  part way through.

**Every refusal made before the body has been read through carries
`Connection: close`** ([P13.8](design/workplan/30-p13-aventuras-import.md)). A browser sending a large body reads nothing
until it has finished sending, so a refusal left on an open connection reaches
it as a reset rather than as this answer; closing is what lets the answer
through. It is not a guarantee, and a client should read a dropped connection
during an upload as *the server or something in front of it refused this*.

**A zip or a SQLite database is landed, not buffered** —
[P13.8](design/workplan/30-p13-aventuras-import.md). The first sixteen bytes are
sniffed (across however many chunks they arrive in), and a file that begins
like a zip or like SQLite is written to the import scratch root as it arrives,
under `limits.maxImportUploadMb` — a limit of its own, which can be set below
`maxUploadMb` — and read from there. Everything else is buffered as before.
**A zip** is swept as a root, read on disk with the limits split: an entry is
held to four times the import limit by its declared size, anything read into
memory to 64 MB, and the archive's total to 256 MB of what was actually read —
so an Aventuras backup's database is inflated to scratch at whatever size, and
the `stories/*.avt` an old backup carries beside it cost nothing. **A bare
SQLite database**, whatever it was called, is swept as an Aventuras root of one
file, `aventura.db`, from where it landed; one that is not Aventuras' is
refused by the reader's column gate, `unrecognised` with an
`import.file.refused` note.

**A root's answer carries its whole review** —
[P13.7](design/workplan/30-p13-aventuras-import.md). A zip, a database or a
Marinara envelope is swept as a root, and its answer is `{ item, notes, report }`:
`item` and `notes` summarise it as one file (the first converted row, and every
note), and `report` is the sweep's `{ jobId, source, items, counts }` row by row,
exactly as `/import/sweep` and `/import/directory` answer — so a second upload
of the same backup reads `unchanged` row by row, as a second sweep of its folder
does. ~~`jobId` is `unsaved`: neither upload door records a job.~~ A single file's
answer has no `report`; its one row is the review.

***An upload is recorded*** (2026-09-28), as a sweep is, and the answer carries
its `jobId` — beside `item` for one file, and in `report` for a root — so the
review opens again from `GET /api/import/jobs` and the object's page shows what
the import said about it. Uploads were never recorded, so neither worked for
anything a browser sent. The job's `root` is the file's name, and the job is
marked an upload, so *Update from source*
(`POST /api/import/sessions/:sessionId/update`) never mistakes a file name for a
path it can open again: a session from an uploaded chat still answers
`409 no-recorded-source`, and the client offers the file picker.

***When nothing in a root converted, `item` says what its rows say*** (2026-09-28):
`unchanged` when anything in it was already here, and otherwise the first row's
disposition. It was `recorded` whatever happened, so an archive uploaded twice
said *read, and nowhere to put it* of a second upload whose every row said
*already here*. The status follows it: `201` only when something converted.

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

**An optional `stories` field** — the word `true` — brings an Aventuras
database's or backup's stories across as sessions, as the sweep's `stories`
does ([P13.11](design/workplan/30-p13-aventuras-import.md)); anything else,
or no field, is the default, which writes none. The same before-the-file rule
applies. Every other kind of upload ignores it — **including an Aventuras
story file**, below, which brings its story whatever the field says.

**An Aventuras story file (`.avt`)** — [P13.15](design/workplan/30-p13-aventuras-import.md) —
is recognised by its contents, whatever it is called: a JSON object whose
`story` is an object and whose `entries` is an array, which is what
Aventuras' own importer requires. It is one story, and becomes one session
exactly as the same story does from the database (the sweep's `stories`,
below): the same turns, cast, lorebook and illustrations, **under the same
key**, `aventura.db/stories/<id>` from the story's id in the file — so a story
brought across from the database and then from its file, or the other way
round, is `unchanged` with `import.aventuras.storyAlreadyHere` the second
time, naming the session the first made. The row's `source` is the file's
name. **No `stories` field is needed**: the opt-in keeps a library sweep from
filling the session list, and one file picked and previewed is a request for
that story. What a file cannot carry: **backdrops** — `background_images` is
not in a `.avt`, and the one backdrop a file may hold has no branch, so it is
left out (`import.aventuras.avtBackdropNotCarried`), as Aventuras' own import
leaves it. **The format is gated** as Aventuras reads it: `1.x` up to the
pin's `1.10.0` imports, an older one as far as it goes
(`import.aventuras.avtOlderFormat` — before 1.6.0 there are no branches, before
1.4.0 no pictures), a newer `1.x` with `import.aventuras.avtNewerFormat` at
`warn`; any other major, or a version that is not one, is `unrecognised` with
`import.aventuras.avtUnknownFormat` and writes nothing, as is a file whose
story has no id or that nests past 64 levels (`import.aventuras.avtUnreadable`).
The file is buffered under `limits.maxUploadMb` like any JSON, and read once:
its pictures stay in those bytes, measured and held to the 64 MB bound before
each is decoded, one at a time.

Exactly one format reads it, and that is the point rather than a limitation. A
character card is an Actor and a world file is a Lorebook; neither poses a
question, and a control over either would be a control with one answer.
Aventuras' `VaultScenario` is the exception because it is the *conflated* object
[04 §6](design/04-schemas.md) names when it records why `Scenario` was refused as
a kind name — setting prose, a cast and an opening in one file. `treatment` is
the default and is what StoryEngine calls the unconflated version of that;
`lorebook` is for a scenario whose setting prose is really a setting bible, and
it costs the opening messages, which a lorebook has nowhere to hold.

**A chat file becomes a session** —
[P14.8](design/workplan/31-p14-scene-and-session-import.md). A SillyTavern chat,
or Marinara's per-chat export of the same format, is JSON Lines, and it is
recognised by its **content**, never its `.jsonl` name: two object lines, a
header carrying `chat_metadata`, or — an old group chat holding only its
greeting — one message line. It is read, its characters and persona are found in
the account's library, and it is loaded as a new session in Play: `201` with
`disposition: converted`, the new **session's** id as `item.objectId`, and an
`import.chat.imported` note first. A chat a session here already holds entirely
answers `200` `unchanged` with `import.chat.alreadyHere`. One whose beginning a
session holds and which has grown in its source since answers `recorded` with
`import.chat.grownSince`, counting the turns left out: updating a session from
its source is [P14.10a](design/workplan/31-p14-scene-and-session-import.md)'s,
and until then a grown chat is neither unchanged nor a second copy.

**An optional `kind` field, `chat`, makes this door take a chat and nothing
else.** A file that is not one answers `unrecognised` with
`import.file.unrecognised` and nothing is written — the archive and envelope arms
are not tried, and neither is the `.avt` arm; an archive, landed on disk since
[P13.8](design/workplan/30-p13-aventuras-import.md), is refused before it is
opened. It follows the before-the-file rule. Play's *Import session* sends
a `.jsonl` here with `kind: chat` and opens the returned id; without the field, a
`.jsonl` that was really a card would land in the library from a control that
promised a session.

### `POST /api/import/file/preview`

**What that upload would do, with nothing written.** `multipart/form-data` with
one file part → `200 { preview }`. ~~Same limits, same three transport refusals and
the same CSRF rule as `/import/file`, because both doors read the part through
the same function.~~ *Since [P13.8](design/workplan/30-p13-aventuras-import.md)*
the same three transport refusals and the same CSRF rule, and **not the same
limits**: this door still buffers every file under `limits.maxUploadMb`, and
lands nothing. An archive or a database is only ever answered *this is a folder
in a file*, which the client knows from the file's first bytes without sending
it — so the client does not send one here at all, and a large backup is not
uploaded twice to be told what its name already said. **Since
[P13.7](design/workplan/30-p13-aventuras-import.md) a SQLite file is answered
the same way as a zip** — `import.file.importsAsFolder` and `{ kind: 'sweep' }`,
by its first sixteen bytes and whatever it was called — where it had been
`unrecognised` for bytes `/import/file` imports. The database is not opened to
answer: whether it is an Aventuras database this build can read is the column
gate's question at the commit, which can still refuse it.

***A Marinara envelope is answered as the commit will answer it*** (2026-09-28):
`importsAsFolder` for one that unpacks, and `recorded` with
`import.file.notYetConvertible` for one this build cannot unpack yet — a chat
preset, a settings profile, a memory recall. Every envelope was previewed as
*everything inside would be imported*, and the commit then imported nothing of
those.

`preview` is `{ source, disposition, notes, advisories, object, reimport }`.
`disposition` and `reimport` are **predictions**, not records — the file could
change underneath, and the commit's answer is the real one.

- `object` is `{ kind: 'preset', name, blocks, params, maxContextTokens,
  preferredModelIds, compatKeys }` for a preset, `{ kind: 'scenario', name,
  blurb, framingChars, cast, openings, destination, alternatives }` for an
  Aventuras scenario, `{ kind: 'sweep' }` for an archive or a Marinara envelope,
  `{ kind: 'opaque', name }` for something that converts and has no summary yet,
  and `null` when nothing would be imported. **An Aventuras story file** is
  `{ kind: 'opaque', name }` with the story's title, and its first note,
  `import.aventuras.avtStory`, says which story, which format version, and how
  many entries and branches it holds; its `reimport` is `new`, or `unchanged`
  with `import.aventuras.storyAlreadyHere` when the story's key already names a
  session here — answered from the key, without converting anything
  ([P13.15](design/workplan/30-p13-aventuras-import.md)).
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

`{ root, onConflict?, stories? }` → `200 { report }`. Points the server at a folder on its
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
- `422 {"error":"unknown-format"}` — a format this build does not read: written
  by a newer version (a Marinara store), or missing a part this build needs (an
  Aventuras database without a table or column it reads).
- `422 {"error":"ambiguous-root"}` — the folder probes as two applications at
  once. A wrong guess would convert a library through the wrong tables and the
  review would report that it went fine, so this refuses rather than picks.
- `507 {"error":"no-space"}` — an Aventuras folder is read from a private copy of
  its database, taken into this install's data directory first
  ([P13 §1.2](design/workplan/30-p13-aventuras-import.md)), and there is not
  room for one. The message carries the numbers. Not a refusal of the folder,
  so it is not in the import ledger: the same request succeeds once there is room.

Every refusal happens **before anything is written**. A refusal after the first
object is a half-import, which is worse than none.

**An Aventuras folder** — a config directory, or an unzipped backup — is one
database, and its review is a row for the database, one per table (with its row
count), one per prompt pack (below), one per story (with what that story holds
across all its branches — a branch's edits and deletions left out) and one per
other file in the folder;
SQLite's own `-wal`, `-shm` and `-journal` are part of the database and not rows
of their own. **Since P13.3 its characters convert**: `character_vault` has no
row of its own, and instead each of its rows is one — an actor, with the source
`aventura.db/character_vault/<id>` that a re-import is recognised by, and its
portrait carried (a PNG as the card's image, a JPEG or WebP as the card's
`portrait-source` media on a blank card). **Since P13.4 its lorebooks convert
the same way**: each `lorebook_vault` row is a lorebook with the source
`aventura.db/lorebook_vault/<id>`, taking the book's own name, description and
tags, its vault entries mapped as Aventuras' own export maps them (keywords to
keys, aliases to secondary keys, `always` to constant, `never` to disabled,
priority inverted into order), and `favorite`, `source`, `originalFilename`,
`originalStoryId` and the row's `metadata` kept in the book's `metadata`. A book
with no entries imports as an empty book; one whose `entries` will not parse
is refused with an `import.aventuras.columnUnreadable` note and nothing is
written, so a book imported from that row earlier is left as it was. **Since
P13.5 its scenarios convert too**: each `scenario_vault` row is a treatment, with
the source `aventura.db/scenario_vault/<id>`, converted exactly as the same
scenario exported as a file would be — its npcs actors of their own in its cast,
its openings, and everything the converter does not read (`starting_time`
included) kept in the treatment's `metadata`. A scenario whose `npcs`,
`alternate_greetings` or `metadata` will not parse is refused the same way a
book's `entries` is, and for the same reason; bad `tags` or `starting_time` are
noted and left out. **Links resolve inside the database**: a character's or a
scenario's `metadata.linkedLorebookId` becomes the actor's `lore`, or the
treatment's `lore` (never `required`), pointing at the book that `lorebook_vault`
row became — or, when that row was refused, at the book an earlier import of it
left here. `import.aventuras.linkedLorebookMissing` is said only when neither
exists. **Since P13.6 its tags merge into the account's tags** (`GET
/api/tags`): each `vault_tags` row is a review row with the source
`aventura.db/vault_tags/<id>` and no `objectId`, since a tag is not a library
object. A name not already a tag (compared as tags always are — case and spacing
aside) is added, `converted`, on the swatch nearest its Aventuras colour by hue,
greys on `stone` and a colour that does not read on none; a name already a tag
is `unchanged` and left exactly as it is — never recoloured or renamed, whatever
`onConflict` says. Aventuras keeps a tag list per kind and this server keeps
one, so a name two kinds share is one tag, in the first row's colour, and
`import.aventuras.tagColourDiffers` says when another row's would have been a
different swatch. **No imported object is given `tagIds`**: adopting tags stays
`POST /api/tags/adopt`'s. Tags are merged first, then lorebooks are written,
then characters, then scenarios, so every link finds its book. **Prompt packs
are recorded, not converted** ([P13.9](design/workplan/30-p13-aventuras-import.md)):
each `preset_packs` row is a `recorded` review row of its own, with the source
`aventura.db/preset_packs/<id>` and no `objectId`, whose
`import.aventuras.packRecorded` note counts its templates, how many of them
differ from the text Aventuras ships (hashed as Aventuras hashes them: trimmed,
CRLF made LF, SHA-256), its custom variables and its tracked variables; when
any differ, `import.aventuras.packTemplatesDiffer` at `warn` names them — up to
81 ids of at most 64 characters, and `import.aventuras.packTemplatesUnlisted`
counts the rest. No preset is written. **Since
[P13.11](design/workplan/30-p13-aventuras-import.md) its stories become sessions
— when the request says `stories: true`, and only then.** Each story is one
row, `aventura.db/stories/<id>`, which is also the session's
`origin.originalFilename`; `stories`, `story_entries` and `branches` — and
since P13.12 the five tables of a story's world — have no rows of their own. Asked, a story is `converted` with the new session as its
`objectId` — its tree rebuilt from Aventuras' branches and positions (an action
and its answer are one turn; an opening, a second narration in a row or a
`system` entry is a turn with no input; an action nobody answered is a
`failed` turn; a branch that begins between an action and its answer repeats
the action with the branch's own answer, and
`import.aventuras.forkSplitPair` says so), its branches as named `branchRefs`
beside *Main*, and its head on the branch the person was on. Every turn has
`foreign: { source: "aventuras", id }` and ids derived from the account, the
story and its entries; generation metadata goes to `cost` (model, wall-clock
time, Aventuras' own token count of the answer) and never to `request`;
reasoning to `output.reasoning`; saved suggestions to `suggestions`. The
session names no mode, and plays in the server's default mode;
`import.aventuras.storyImported` says which mode it had in Aventuras, and
`import.aventuras.storyWorldRecorded` counts the chapters and checkpoints
that stayed behind (the pictures, until P13.13, below). **The chapters stay
behind for good** ([P13.14](design/workplan/30-p13-aventuras-import.md),
closed `recorded`): each is a summary Aventuras' own model wrote, and a
session's summaries here are written by this server's summariser from the
turns, all of which come across — so no summary, keyword or boundary of a
chapter is read, only the count, and the note says why. Every turn's text is
the entry's with Aventuras' inline `<pic …>` tags taken out, as Aventuras
shows it (since P13.14; the pictures they stood for are below). **Since
[P13.12](design/workplan/30-p13-aventuras-import.md) its world comes too**:
`characters`, `locations`, `items`, `story_beats` and `entries` are resolved
for the branch the session opens on — a branch's edit (`overrides_id`) in
place of what it edits, a deletion (`deleted`) hidden, a row only another
branch has left out — and written before the session, which links them. Each
character is an actor keyed `aventura.db/stories/<id>/characters/<character
id>` (the id of the character a branch edited, so an edit is the same actor),
mapped as a vault character is, its portrait carried as a vault portrait is;
the protagonist (`relationship: "self"`) is the session's `cast.persona`, and
everyone else `cast.actors`. The story's entries, places, items and beats are
one lorebook keyed `aventura.db/stories/<id>/lorebook`, in `session.lore`:
places, items and beats each in a folder and tagged `location`, `item` and
`story-beat`, with Aventuras' own fields in each entry's
`metadata.aventuras` — story beats for now, until they have a home of their
own (`import.aventuras.storyBeatsAsLore`). Entry ids are derived from the
story, the table and the row, so no other book shares one. These objects
have no rows of their own: the story's row names them in `alsoProduced`, and
`import.aventuras.storyWorld` counts them. `import.aventuras.worldBranchesDiffer`
counts the other branches whose world differs, which stay in Aventuras.
**Since [P13.13](design/workplan/30-p13-aventuras-import.md) its pictures
come too**, as finished renditions of the session — `ready`, with their
bytes, and never queued as jobs: each `embedded_images` row an
`illustration` on the turn that holds its entry, on whichever branch (a
forked action's is on the turn of the line it was written on), anchored by
Aventuras' `source_text` — or, for a picture the model asked for inline,
whose `source_text` is its `<pic …>` tag, on the sentence the tag followed,
so it sits where Aventuras drew it (since P13.14; a tag first in its entry
leaves the picture unanchored, under the text, and a tag the entry does not
hold keeps the tag as its anchor with `anchorResolved: false`); and each
branch's newest `background_images` row
a `background` on the turn its line ends on, **carried and not selected**
— the import names no mode, and the `se.backdrop` selection is a mode's —
so it is chosen by hand in a mode that shows one. Their ids are the turn's
and an ordinal (`<turnId>.<n>`), their `prompt` is Aventuras' prompt as one
fragment (a background's is empty), their `provenance` names no binding
and no seed, and `foreign` is `{ source: "aventuras", id }`. The bytes are
sniffed, not taken from the data URL's type: a PNG, JPEG or WebP is served
by `GET /sessions/:id/renditions/:renditionId/asset` as any rendition is;
anything else, or a link, is left out (`import.aventuras.pictureUnreadable`,
`warn`), as is one past the 64 MB bound, measured before it is read
(`import.aventuras.pictureTooLarge`, `warn`) — and the rest of the story
imports. `import.aventuras.storyPictures` counts what came,
`import.aventuras.pictureModels` names the Aventuras models that drew them,
and `import.aventuras.picturesUnfinished`, `import.aventuras.picturesUnplaced`
and `import.aventuras.checkpointBackgrounds` count the ones never finished,
the ones whose entry or branch is gone, and the ones a checkpoint saved,
which stay with it. The bytes are written by the session import itself, into
the session it has just made, so a story it refuses leaves no picture
anywhere; one whose bytes cannot be written arrives as its recipe, with no
asset, and `import.aventuras.picturesWithoutPixels` counts it. A story's own narrator prompt (`settings.customSystemPrompt`) is not carried,
for the reason packs are not: `import.aventuras.customNarratorPrompt` at
`warn` names its length. A story with no entries is `skipped`
(`import.aventuras.storyEmpty`). **A story brought across before is
`unchanged`**, whatever `onConflict` says, with the session it became as its
`objectId` and `import.aventuras.storyAlreadyHere`: a session is never
replaced or doubled by an import, so what was written in Aventuras since is
not brought across — its world included: nothing of it is written again, and
the row's `alsoProduced` names what the session here already links to. Not asked, each story is `recorded`, and its
`import.aventuras.storyRecorded` note counts what it holds. Every other
table is `recorded`,
`skipped` or, for `settings`, `credential` — counted and never read, since it
holds provider keys. A database missing a column this build reads, or with no
`_sqlx_migrations`, is `422 unknown-format`; one from a *newer* Aventuras that
has every column is read, with a `warn` note saying so.

**Aventuras story files (`.avt`) in a swept folder** —
[P13.15](design/workplan/30-p13-aventuras-import.md). A folder with no
database in it — an older backup's `stories/`, or a folder of files somebody
exported — sweeps as loose files, and each `.avt` in it is read by its
contents as `/import/file` reads one: asked (`stories: true`), it is its story,
`converted` into a session under the database's key for the same story, so a
re-sweep, or the database swept later, finds it `unchanged`; not asked, it is
`recorded` with the same `import.aventuras.storyRecorded` counts a database's
story row has. **Beside a database, a `.avt` is not read**: an older backup
wrote them from that very database, so each is a story the database holds and
the database's is the one read — `skipped`, with
`import.aventuras.avtBesideDatabase`.

`onConflict` decides what a re-import does when a file has changed: `replace`
(the default, and the safe one — the write goes through the version history, so
the state it replaced becomes a version), `keep-both`, or `skip`. Unchanged
objects are never rewritten and are reported as `unchanged`, which is a different
answer from `skipped`.

**Source files in the report are named relative to the root**, never absolutely
([22 §4.1.1](design/22-internal-contracts.md)) — a review somebody pastes into an
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

`verdict` is what the probes decided: `sillytavern`, `marinara`, `charx` (an
unpacked CHARX card), `storyengine-backup` (an unpacked backup, whose library is
imported and whose sessions, tags and settings are listed and left), `aventuras`
(a folder holding `aventura.db` — Aventuras' config directory, or an unzipped
backup of it), or `loose-files` for a folder that matches nothing. Those are the
six a directory can produce. ~~`marinara-archive` and `marinara-envelope` are
members of the same vocabulary but are never produced by pointing at a folder.~~
*Corrected 2026-10-01: they were never produced by anything, and are gone from
the vocabulary.*

**`aventuras` is decided by the name alone**, and so is every verdict here: the
database is not opened to answer this. Whether this build can read it is the
sweep's question, answered from a copy — so a folder this calls `aventuras` can
still be refused by the sweep as `unknown-format`.

**It never lists a directory.** Every answer is a yes/no probe at a path this
build already names in its own source. [10 §4.2.2](design/10-ui-surfaces.md)
keeps the sweep's report relative so the review does not become a filesystem map;
an endpoint that enumerated children would hand back exactly the map that clause
refuses.

`suggestions` is an array of near misses — the folder is recognisably part of a
real SillyTavern, Marinara or Aventuras install, but is not the one to point at:

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

**Aventuras is found where the platforms put it** —
[P13.7](design/workplan/30-p13-aventuras-import.md). Its config directory is
`com.karelian.aventura` under `~/.config`, `~/Library/Application Support` or
`%APPDATA%` ([01 §2](design/01-source-survey.md)), so a folder that is one of
those, a home folder above one, `~/Library` or `AppData` is answered with the
path down to it: `leadsTo: "aventuras"`, `verified`, and the note
`import.root.aventurasBelow` with that `path`. Six fixed places, each asked one
question — is `aventura.db` there — and never a search; a folder with the
bundle id's name and no database in it is not suggested, and neither is one
reached through a link that leaves the folder named, since a sweep would not
follow that link either. A folder *inside* an Aventuras root — the `stories/`
an older backup carries — is pointed back up with `import.root.aventurasAbove`.
The sweep of the folder that was named still sweeps that folder; it never
sweeps the suggestion.

**A suggestion is advice, not a gate.** Acting on one sends a fresh absolute path
back through this route or the sweep, which re-validate from scratch — the
carve-out included.

### `POST /api/import/directory/plan`

`{ entries: [{ path, bytes }], chats? }` →
`200 { verdict, suggestions, wanted, declared, wantedBytes, limitBytes, chats, overLimit }`.
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

**Chats are opt-in** —
[P14.8](design/workplan/31-p14-scene-and-session-import.md). They are most of a
SillyTavern tree's bytes, and a person who picked their data folder to bring in
their cards has not thereby asked to send years of conversation. So `wanted`
leaves them out unless the body says `chats: true`, and `chats` says what
choosing them would add — reported whether or not they were chosen, because the
point is to say it before the choice:

- `count` — the `.jsonl` files under `chats/` and `group chats/`, or anywhere in
  a loose folder;
- `bytes` — everything the choice would send, `groups/*.json` included, since
  that is what the limit counts;
- `fit: { count, bytes }` — the same two numbers for what would actually go.

`chats: true` makes the plan again with chats in `wanted`, **the library budgeted
first**: chats spend only what the library leaves of `limits.maxUploadMb`, so one
long conversation that sorts early can never push a card out, and `fit` is how
much of the choice survives that. `limitBytes` is the limit the plan spent, so a
client can name the number. A Marinara root reports zeros: its chats are in the
store it already sends.

***`overLimit` is what the budget left out of the library*** (2026-09-28): the
wanted paths, chats aside, that `limits.maxUploadMb` ran out before — a subset of
`declared`, which also holds everything never wanted. An Aventuras database and
its log are cut together. The panel says the count before anything is sent,
while sweeping the folder from the server, which has no such limit, is still the
way round it, and hands the list back with the upload.

***The library's pass spends the limit on what the reader needs first***
(2026-10-02, at the merge of origin's main with
[P4 §7.18](design/workplan/16-p4-implementation.md)'s ranking): by rank, and
within a rank in manifest order, so a file that does not fit is passed over for
a later one that does — never the browser's first-come prefix. A SillyTavern
tree ranks `settings.json` ahead of the directories the registry converts. A
Marinara root ranks the store's manifest, then the library's tables (each shard
or single file, and its `.bak`), then ~~the pictures under `avatars/`,
`sprites/`, `lorebooks/images/` and `prompts/images/`~~ the portraits under
`avatars/`, then the library's pre-migration backups, and last the five tables
its chats are read from
([P14.10](design/workplan/31-p14-scene-and-session-import.md)) — `chats`,
`messages`, `message_swipes`, `game_state_snapshots` and `agent_memory` — with
those tables' own pre-migration backups after them. Everything else under
`storage/` is declared and never sent, the `api_connections` credential table
included. Nobody is asked about a Marinara store's chats, so a chat table the
limit cut is in `overLimit` like any library file; *chats aside* above means the
chats a person is asked about, a SillyTavern tree's or a loose folder's.

*Corrected later on 2026-10-02, at a review of that merge.* **`sprites/`,
`lorebooks/images/` and `prompts/images/` are declared, not ranked**: the reader
attaches `avatars/` alone and reports the other three `recorded` by name, so
their row is the same whether their bytes came or not — and ranked ahead of the
chats, a tree of expressions spent the limit and cut the message shards. They
are never in `overLimit`. **A backup is never sent without the file it stands
in for**: within a rank every primary is decided before any `.bak`, and a
`.bak` — a table file's, or the manifest's — whose primary is in the folder and
was cut is cut with it and named in `overLimit`, because the store reads a
backup in place of a primary that has no bytes, and the session would arrive
one save old under a review that said only *over the limit*. A `.bak` whose
primary the folder does not hold at all is the table's only copy and is
ranked like any other file.

### `POST /api/import/directory`

`multipart/form-data` → `200 { report }`. The folder itself.

Each file's **relative path travels as its field name** — a multipart filename
cannot carry a directory and survive sanitising — and is rebuilt segment-wise
with `.` and `..` dropped. A `manifest` field carries the full path list as JSON;
an `onConflict` field is optional and means what it does on the sweep, and so
is a `stories` field — `true` brings an Aventuras folder's stories across as
sessions, exactly as the sweep's `stories` does.

**Named and not sent is not the same as absent.** Paths in the manifest without
bytes are *declared*: listed, reported, and never read. That is what keeps
*nothing is silently dropped* true across a transport that deliberately does not
carry everything.

**An optional `chats` field says what the person chose**, when the plan offered
chats. `skip`: they declined, and each chat named in the manifest and not sent is
a `skipped` row with `import.chat.notChosen` — not declared, not unreadable.
`include`: they chose them, so a chat named and not sent is one the plan's budget
left out, and is `skipped` with `import.chat.overLimit` carrying the limit. No
field takes whatever arrived. Chat files that did arrive become sessions in a
pass after the library's, so each resolves against the cards that came in beside
it, and each is one row as on [`POST /api/import/file`](#post-apiimportfile).

***An optional `folder` field names the picked folder*** (2026-09-28), and the
upload is recorded under it — as an upload, like the single-file door's — with
the report's `jobId` its address; a refused one is recorded as refused.

***An optional `overLimit` field names what the plan's budget left out*** — its
`overLimit`, as JSON (2026-09-28). A path in it that the manifest names and the
upload did not carry is a `skipped` row with `import.file.overLimit`, carrying
the limit, where it read as *not recognised* or *could not be read*; a path that
did arrive is left alone, so the field can describe only a file that was in fact
not sent. *(2026-10-02)* The row keeps one note from before the rewrite,
`import.marinara.backupUsed`, ahead of the limit's: a cut Marinara file whose
`.bak` was sent was read from that backup instead, which is the one thing the
review must still say about it — and the reason the plan never sends a backup
without its primary. And a root the limit left nothing readable of — an
Aventuras folder whose database did not fit — is `413 too-large` naming the
limit, where it was `422` *there is nothing readable at that path*.

- `400 {"error":"no-manifest"}` — a folder upload without its manifest.
- `413 {"error":"too-large"}` — **the whole folder** past `limits.maxUploadMb`,
  not each file in it. The limit is a running total; a thousand files each just
  under it is still a thousand times it.
- `415 {"error":"not-multipart"}`.
- `507 {"error":"no-space"}` — as on the sweep: an Aventuras folder's database
  is copied before it is read, and there is no room for the copy.

For an `aventuras` verdict the plan wants exactly `aventura.db`, its
`aventura.db-wal` if there is one, and `metadata.json`. **The database and its
log are wanted together or not at all**: the log holds commits the file does not
have yet, so a budget that carried one without the other would hand the sweep an
older database that looks whole. An upload that names a `-wal` and does not
send it is refused `422 unreadable-root` for the same reason. Everything else in
the folder — an older backup's `stories/*.avt` among it — is declared, and
reported `skipped`, except `aventura.db-shm` and `aventura.db-journal`, which
belong to the database and are never rows of their own.

No `suggestions` here — the plan step is where advice can still be acted on.

### `GET /api/library/:kind/:id/download`

**The object as stored, byte for byte** → `200`, with a `content-disposition`
naming an ASCII-slugged file. Works for every kind. ~~`application/json`~~ —
**an actor is its card** (2026-09-28): `image/png` and `.png`, the file the
actor is stored as. The route served the index's JSON of it, which is not what
is stored for an actor: the portrait is the card's pixels and every expression
rides inside it as a chunk the JSON only names, so the download had every
picture missing and said nothing. Every other kind is `application/json`, the
file as stored; a folder kind's pictures — a lorebook's gallery and its
entries' strips, a treatment's cover — live in `assets/` beside it and stay
behind.

**A card of ours comes back as ours.** `POST /api/import/file`, and a sweep
that meets one in `characters/`, read a card carrying our envelope as the
object it carries — under its own id, pictures and all. Before 2026-09-28 a
card with no SillyTavern chunk in it was *a picture without a card*, so the
card this route now hands over could not have come back.

**`?source=&slug=` downloads one specific copy of a duplicated id**, exactly as
it reads one on [`GET /api/library/:kind/:id`](#get-apilibrarykindid). Without
it, the winner. Before 2026-09-27 the route ignored the address, so a shadowed
copy's page offered the winner's bytes under the loser's name.

**The primitive, and it converts nothing.** Everything under `/export/` below is
a *writer*, and a writer loses something by definition; this loses nothing
because nothing is converted. It carries no `x-storyengine-missing`: a World's
export resolves references and can come up short, and an object is just itself.

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

**`?source=&slug=` writes out one specific copy of a duplicated id**, as the
download does. It narrows the object being exported and nothing else: the
objects *it* names — a treatment's cast, a scenario's lorebooks — resolve by id
to their winners, as every reference does.

**What the file does not carry travels in `x-storyengine-export-notes`**, base64
of a JSON `ImportNote[]`. In a header on `.sepack`'s reasoning — *the body is the
file*, and a note to the recipient's importer about the exporter's library does
not belong inside the document. Base64 because a header is latin-1 and a note's
params carry whatever an object is called. Every writer loses something and each
one names what: a treatment's cast narrowed to a card's one character, a
lorebook's folder gates flattened, a linked lorebook a scenario has nowhere to
hold. **The detail page reads it** (2026-09-28): its links used to hand the
answer to the browser, so no note had ever been shown, and a refusal's JSON
body was saved as the file. A plain click now fetches the same address, saves
what came back, and says each note, or the refusal, under the link.

Formats at this stage: `aventuras.scenario` and `sillytavern.card` from a
Treatment, `aventuras.character` from an Actor, `aventuras.lorebook` from a
Lorebook. **`aventuras.scenario` does not round-trip into Aventuras** and the
table says so — its scenario import routes every uploaded file through the
character-card pipeline and never sniffs for a `VaultScenario`, so that format is
archival while the card is the one that travels. It round-trips into *this*
build, which is what `export/writers.test.ts` asserts and the first real exercise
[00 §2.4](design/00-stance.md)'s *nothing is lost and re-export is possible* has
had.

### `GET /api/library/worlds/:id/export`

**A World with the objects it names, as a `.sepack`** → `200`,
`application/json`, as `<World name>.sepack.json`. The contents are resolved
and carried whole, so the file works on an install that has none of them.

***At this address from [P16.0](design/workplan/35-p16-world.md)***
(2026-10-10); it was `GET /api/library/packages/:id/export`, which is not kept.
**The file is unchanged**: still P11.10's frozen `storyengine.package-export/1`
envelope — `schema`, `exportedBy`, a `manifest` of the World's id, name, version
and contents, and the `objects` — with the same `.sepack.json` name.
[P16.3](design/workplan/35-p16-world.md) defines the World's own format once,
writes it, and reads this one beside it; renaming the envelope at the rename and
reshaping it at P16.3 would be two formats written in one phase
([P16 §1.1](design/workplan/35-p16-world.md)). *No build reads a `.sepack.json`
yet* — the import panel does not take one.

**What it could not include is counted in `x-storyengine-missing`**: an id the
World names and the library no longer has is left out of the file, and the
header says how many — *reported, not dropped*, in a header for the notes'
reason above. The detail page says the count under its *Export this world*
link (*Export this package* until P16.0); before 2026-09-28 nothing read it.

The id alone: no `?source=&slug=`, so the page offers this only on the copy
an id resolves to. `404 {"error":"not-found"}` for a World that is not
there — and, since 2026-10-10, for an id that is some other kind: the writer
reads its id with no kind, so an actor's id here exported the actor as a bundle
of nothing.

### `POST /api/library/worlds/:id/members`

**Adds members to a World** — [P16.1](design/workplan/35-p16-world.md) →
`200 {contentHash, object}`, the World as stored afterwards, as `PUT` answers.

```json
{ "members": [
    { "schema": "storyengine.lorebook/1", "id": "0199…", "name": "The Docks" },
    { "schema": "storyengine.session/1",  "id": "0199…", "name": "A night out" }
] }
```

**The door for a gesture made from outside the World's own editor** — *Add to
a world* on a session's page or in the session list. The editor writes the whole
World through `PUT` like every editor; this one adds, so it needs no `If-Match`:
there is no version of the World the caller could have been wrong about. It is
the library's ordinary hash-checked write, read and retried on the server when
somebody else saved in between.

- **Idempotent by id.** A member the World already holds is left where it is,
  under the name it was added with; adding nothing new writes nothing and takes
  no history entry. New members go at the end, in the order given.
- **A member is an envelope**, `{schema, id, name?}`, of any library kind — and
  a session, as `storyengine.session/1`, which the envelope admits because its
  `schema` is a string and never a kind
  ([P16 §1.2](design/workplan/35-p16-world.md)). An id that resolves to nothing
  is kept, as every reference here is: it dangles visibly rather than blocking.
- **Not a World, and not itself** — `400 {"error":"invalid"}`. A World does not
  hold a World ([15 §3.1](design/15-world.md)).
- `404 {"error":"not-found"}` for a World that is not there, or an id of
  another kind. A World still stored under its old name moves on this write, as
  on any first write.

**Membership lives on the World alone**: a session carries no World, and the
reverse view — *In these worlds* on a session's page — is the client reading
the Worlds whose `contents` name it, from `GET /api/library/worlds`.

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
treatments, lorebooks and Worlds as well as on actors, so the route is keyed
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
[22 §7](design/22-internal-contracts.md), [P9.2], [P9.4].

**Off the session read and off the transcript read, deliberately**, which is
`GET /sessions/:id/memory`'s argument: a rendition's state changes *after* its
turn is written, so folding it into either would make two reads that are cached
differently disagree about whether a picture has arrived.

**`selection` rides with them** ([06 §10.7], added [P9.4]). Which sibling a turn
shows is a pointer on the session file, and answering it from a second read would
put the set and the choice on two cache entries that expire independently — the
reader would then watch a picture they did not choose for as long as the stale
half survived.

**A `ready` record whose file is gone is listed with `asset: null`** (2026-09-30)
— [26 E3](design/26-open-questions.md)'s evicted picture, *"a picture that can
be made again"*, which a client renders as a placeholder with a retry. It went
out as stored, so a page drew a broken image. **A read, not a reconcile**: this
route, the asset and the attachment routes and `GET …/turns/:turnId` read the
session as the preview does, since they are asked whenever something is looked
at and a reconcile could append a turn under the page that asked.

### `GET /sessions/:sessionId/renditions/:renditionId/asset`

The pixels, in the shape `/library/:kind/:id/media/:mediaId` above already uses:
`content-type` from the record, `etag` from the bytes' own digest, and the
buffer. The client cache-busts with `?v=<digest>` as it does for media.

**`404` for a rendition with no `asset`**, which is three different states and
one answer: still pending, failed, or **evicted**. That last one is
[26 E3](design/26-open-questions.md)'s whole point — *"deleting one leaves
`asset: null` and a picture that can be made again"* — ~~so a 404 here is what the
client renders a regenerable placeholder from, rather than an `<img>` quietly
failing~~. *Corrected 2026-09-30:* the client drew the `<img>` and it failed
quietly. The list says `asset: null` for an evicted picture since, and the
placeholder renders from that; a 404 here is for a page that read the list
before the file went.

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
install ([20 §5.1](design/20-tech-stack.md)), `{ held: "no-moment" }` when
the turn has no prose or the moment call declined, and — since 2026-09-30 —
`{ held: "no-place" }` for **Set the scene** where the story has named no place:
a backdrop's recipe is the place and the tone, and without the place it was a
picture of a mood. All three are answers to *can you make a picture*, not
failed requests. A turn that does not exist is a `404`. The same classes name
why a turn's own render step asked for nothing, on the turn record's
`renditions.held`.

**A client that disconnects before the answer is written cancels the moment
call**, and nothing is recorded, because the `pending` record is written only
once the moment has been chosen. A picture nobody is waiting for is a model call
nobody reads.

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
([26 E3](design/26-open-questions.md), [P9.4]).

**No text call is made.** The record already holds the fragments, the separator,
the budget and the seed, so there is no assembly on this path and no role to
resolve — which is what makes re-creation a *replay* rather than a second
answer.

**`202` with the record set back to `pending`**, like the illustrate route above
and for the same reason: the pixels arrive on the stream, and a `200` would read
as *here is your picture*.

**The pending record carries no `provenance.seedSent`** (written 2026-09-26,
merged 2026-10-03, [22 §7](design/22-internal-contracts.md)). Whether the seed was sent is the last
run's fact rather than the recipe's — the next run may go out on a connection
whose `supportsImageSeed` has changed since — so the field is dropped here and
written afresh by the run that lands. The seed itself is kept, which is what
makes this a replay.

**`409 has-pixels` when the picture is there** (2026-09-30) — `ready` with its
file on disk. A retry runs the record again under the same file name, so from a
stale view it overwrote a finished picture ([06 §10.7]: regeneration is *"never
a destructive act on something the user liked"*). Another picture of the turn is
the illustrate route, which makes a sibling.

---

## Publish

***Built at [P16.3d](design/workplan/35-p16-world.md), 2026-10-10.*** Publish
is [16](design/16-publish.md)'s flow: from one object, a selection of them, or a
World, the closure [04 §9.1](design/04-schemas.md)'s table reaches, reviewed, and
written as a World file — `storyengine.world-file/1`, a stored zip named
`<name>.seworld` ([16 §5.2](design/16-publish.md)). Two requests: a **preview**
that writes nothing, and a **confirm** that walks the library again, as it is
then, and returns the file. The client's review (P16.3g) is the only caller so
far, and until it is built `GET /api/library/worlds/:id/export` stays.

The start is the same shape on both:

```json
{ "kind": "objects", "ids": ["0199…", "0199…"] }
{ "kind": "world", "id": "0199…" }
```

One id is an **object** start, two or more a **selection**; a World is started
from by its own shape and never named in a selection
(`422 {"error":"world-in-selection"}`). Both bodies are closed: an unknown key —
a misspelt `reviewed` included — is a `400` naming it, since an ignored key that
quietly switched off a check is worse than a refusal.

### `POST /api/publish/preview`

**What would leave, and why** → `200` `PublishPreview`, writing nothing: not the
library, not the index, not the ledger, not a scratch file left behind.

- `closure` — every node the walk reached, every edge that reached it (each with
  its rule from the table, the field it was read from, and whether it resolved
  by id or by name), missing references as nodes, and each found object's and
  session's facts: its entries, pictures and their bytes, versions, a session's
  turns and attachments. History is measured as though asked for, so the choice
  can say what it adds.
- `reviewed` — a hash of what the review was drawn from. Sent back with the
  confirm, it is how a change made in between is reported (below).
- `suggestedName`; `justTheObject`, true when an object start's closure is the
  object alone ([16 §2](design/16-publish.md) sends that one to *Download*);
  `sameAs`, for a selection, the Worlds that already hold exactly it;
  `modeVersions`, this install's version of each mode the closure needs, `null`
  for one it does not have; `previous`, for a World start, the ledger's last
  record of publishing it, which the diff opens on.
- An object of yours is on by default; a system object, a session, and an object
  play wrote — a memory book, which stays home whatever is ticked — are off.

`404 {"error":"not-found"}` for a start that is not there — a lone id, a World,
or a selection none of whose ids resolve. A selection with *some* missing is a
preview with those as missing nodes.

### `POST /api/publish`

**The file** → `200`, `application/zip`, as an attachment named by the World or
the selection, with `content-length`.

```json
{ "start": { "kind": "world", "id": "0199…" },
  "choices": { "ticked": { "0199…": true, "0199…": false },
               "history": false, "keep": "world", "name": "Rain City" },
  "reviewed": "sha256:…" }
```

`ticked` overrides the defaults by id; an id the walk no longer reaches is
ignored and a new one takes its default, because the confirm walks the library
afresh. `keep` and `name` are read only for a selection: `"world"` (the default)
keeps the selection as a World of that name — **the one write a publish makes to
the library**, created only once the file is planned, so a refusal leaves none —
and `"snapshot"` keeps nothing. A World start never changes its World, and an
object start writes nothing at all.

Headers: `x-storyengine-world`, the World this publish created;
`x-storyengine-missing`, how many references could not be carried;
`x-storyengine-review-drift: 1` when `reviewed` was sent and the library has
changed since — the file is what the library is *now*, and the header says it is
not what was reviewed; `x-storyengine-export-notes`, the notes, base64 JSON,
capped at 3 KiB — warnings first, then a `publish.file.moreInManifest` count — so
that a file missing many pictures does not trip a proxy's header limit; the
manifest inside the file carries them all.

Refusals: `404` as the preview's; `409 {"error":"publish.changed"}`, naming the
file and any World this publish kept, when something it is copying changed
between planning and writing — the file is never written half; `422` for
`world-in-selection`, `invalid-name`, or `publish.tooLarge` (more entries or
bytes than a World file holds, said before anything is written); `507` when the
disk cannot hold the file, before writing it or while doing so. **A failure after
a selection's World was kept, other than the `409`, moves that World to the
trash**, so the only refusal that leaves one is the one that names it.

**Each publish that delivered a file is a line in the account's ledger**,
`users/<handle>/publishes.jsonl` ([22 §9](design/22-internal-contracts.md)) —
written when a `200`'s file has been sent to its end, never for a refusal or a
download abandoned part-way.

### `GET /api/publish/records`

**What this account has published** → `200 {count, records}`, newest first.
`?world=<id>` narrows to one World's; `?limit=` is 1 to 200, 20 by default, and
`count` is every matching record. A record names what left — each object with
its stored hash, each session with its head and when it was last changed —
which is what re-publishing compares against.

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

***`dryRun` asks first*** (2026-09-28). With `dryRun: true` nothing moves — not
the registry, not a book — and the answer carries `gatesFound` and
`actorsRenamed`: how many of the account's actors carry the tag by its id
(adopted, `tagIds` aligned with `tags`), the only carriers a rename renames. The
clash is checked before a dry run answers, so it is a `409` too. The panel asks
first because the question has to be answered **before** the rename: afterwards
the old name is nowhere left to scan for, which is why its old second press —
a rename with `rewriteGates` after the first — rewrote nothing. It asks only
when there are gates **and** a renamed actor: an actor read from its own names
keeps the old one, so a gate on it goes on matching, and rewriting that gate
would break it. The real rename answers `booksRewritten` and `skipped` as well.

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
      "surfaces": [],
      "openingTurn": false
    }
  ],
  "defaultModeId": "storyengine.scene"
}
```

`openingTurn` (added at [P14.5](design/workplan/31-p14-scene-and-session-import.md))
says whether a new session opens on its cast's written greetings, so a creation
form offers each member's opening only for a mode that writes one — the
creation body's `openings` is read by no other. *Unless the session starts from
a Setup that carries a written opening, which opens on that instead (2026-10-03,
[26 B18](design/26-open-questions.md)).*

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

`{ name?, mode?, modeConfig?, preset?, cast?, treatment?, lore?, setup?, world?, opening?, openings?, hooks? }`
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

**`world` is a World to start in** — [P16.2](design/workplan/35-p16-world.md),
[P16 §1.3](design/workplan/35-p16-world.md). Its contribution is a **default one
rung below the Setup's**, read once here and copied:

- **`lore`** — when the request sends none — is the Setup's books and the World's
  lorebook members together, the World's in the order it holds them, and **then
  every lorebook you can read whose own scope names the World** (`{ kind:
  "world", worldIds }`), ordered by name. They are a union rather than a choice,
  since all of them are simply the session's books.
- **`treatment`** — when neither the request nor the Setup names one — is the
  World's treatment member **only when it holds exactly one**; with several, none
  is chosen, because the first would be the server picking a story. A form offers
  them.
- **The hooks those carry** join the pool as every carrier's do, with their ids.

**A request that sends `lore` or `treatment` gets what it sent**: a form that
offered a World's books and had one unticked sends the rest, and the World does
not put it back — *prefill, never binding* ([00 §3.1](design/00-stance.md)). What a
World contributes lands in `session.lore`, on disk and editable, and **nothing
reaches the prompt that is not selected there**: a book's `world` scope is read
once, here, to copy it, and no scope admits a book to a session afterwards.

**The session then joins the World** — `{schema: "storyengine.session/1", id,
name}` appended to its `contents`, the one place membership is written (the
session carries no World). A World that cannot take the write in that moment — a
system one, one deleted since it was read — costs the membership, which is
logged, and not the session, which already exists. `422 unknown-world` when there
is no such World, for the Setup's reason: it decides what the session starts
with.

**A Setup's opening is the session's first turn**, since P15.3
([03 §6](design/03-data-model.md),
[P15](design/workplan/33-p15-setup-from-a-turn.md)). `opening` chooses which:
absent is the Setup's primary written opening, a string names one of its written
openings, and `null` starts cold. *A written opening is one with words*: an
opening an editor left blank is not one, and a primary that names nothing
playable falls back to the first that is. The turn carries the opening's text as
`output`, no `input` and no `request`, and the effects that seed what the Setup
carries — its `cast.partyDefault` made `companion` on `se.party` (and seated in
`cast.actors`), and each of its `spentHooks` that the pool holds marked `fired`
on `se.hook`. A Setup that seeds something with no opening chosen writes the
same turn without the `output`; a Setup with no opening and nothing to seed
writes no turn. The session in the `201` is the one **after** the write, so its
`headTurnId` already names where play begins — the opening, or a greeting below
the seeding (see the greetings below) — and a generating mode's setup turn is
that turn's child. *No field on the turn says it was an opening*: the branch
that built this added `opening: { id }`, and it was dropped at its merge
(2026-10-03, [P15 §1.8](design/workplan/33-p15-setup-from-a-turn.md)) — a turn
with no `input` and no `request` is already how the record says nothing made
it.

**`422 unknown-setup-opening`** for an id the Setup does not hold, or holds with
no words, and for a string `opening` sent without a `setup`. An `opening: null`
with no `setup` asks for no opening and gets none. *(Written as `unknown-opening`
until 2026-10-03, when the branch merged into a `main` whose `openings` below
already used that code for an actor's greeting; the causes differ, so the codes
do — [P15 §1.9](design/workplan/33-p15-setup-from-a-turn.md), recommended answer,
owner deferred. This paragraph also said any `opening` without a `setup` was
refused; the code never refused `null`.)*

**`openings` chooses each cast member's greeting** — actor id to opening id, at
most 32, added at [P14.4](design/workplan/31-p14-scene-and-session-import.md)
and read only by a mode that declares `openingTurn` (`GET /api/modes`), and only
when somebody is cast besides the persona — a Setup's party counts when no
`cast` is sent. Anywhere else the map is read by nothing, its refusals below
included. Such a session opens on an output-only turn holding one message per cast member with a
written opening, rendered once with the session's names for `{{user}}` and
`{{char}}`. With one member besides the persona, the primary is written first and
every alternate as a root beside it, and `openings` picks which the head starts
on; in a group each member's chosen opening, else the primary, is one message in
cast order. `422 unknown-opening`, carrying `actorId`, for a member not in the
cast or an opening that member does not have written — checked before the
session exists. *(Accepted since P14.4, and not written here until 2026-10-03.)*

**A Setup's opening wins over the cast's greetings, always** — the owner's
decision, 2026-10-03 ([26 B18](design/26-open-questions.md)). When the Setup
carries a written opening, the session starts on the Setup's turn — or on no
turn at all, started cold with nothing to seed — and **no greeting is written**,
whichever of its openings is chosen, and with `opening: null` too. Two edges, each the recommended answer with the owner's
decision deferred ([P15 §1.7](design/workplan/33-p15-setup-from-a-turn.md)):

- Where `openings` is read — a mode that declares `openingTurn`, with somebody
  cast — a non-empty map beside a Setup that carries an opening is **`422
  conflicting-openings`** rather than ignored: the session would not start on
  the greeting it names, and only the client knows which first turn it meant.
  Anywhere else the map is ignored, as P14.4 has it, and an empty map asks for
  nothing and passes.
- A Setup with **no** written opening, in a mode that writes greetings, gets them
  as P14.4 writes them; when that Setup seeds a party or spent hooks, its
  seeding turn is written first and **the greetings are its children**, so the
  head's path runs through the seeding rather than beside it.

A redo or rewrite of a turn nothing made — an opening, a greeting — is refused
on the turn route, `422 opening-turn`; see `redoOf` there.

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

***The goal is checked before it is kept*** (2026-09-27): against the shared
`Goal` schema with `id` optional, so one missing a field is `400 invalid` naming
it and nothing is written. The body was open, and a goal without a `completion`
made every read of the session a `500` and every turn a failure, with no route
to remove it. A goal already in the file that is not one (a hand edit, an import,
an older build) is read past: it is not a row and play does not start on it, and
the file keeps it.

### `PUT /api/sessions/:sessionId/preset`

`{ presetId }` or `{ preset }` → `{ session }`. Which pack this session is
assembled from ([P7B.2](design/workplan/24-p7b-presets-and-prompts.md)). `presetId`
names a library preset, which is copied rather than linked, or `default` for
whatever the mode ships; `preset` is the session's own pack, sent whole after an
edit. One or the other, never both: `422 one-of`. An unknown `presetId` is
`422 unknown-preset`.

***A `preset` is checked as a preset*** (2026-09-27), against the schema the
library checks one against, so one it refuses is `400 invalid` and the session
keeps the pack it had. It took any object, and a pack with no `blocks` was a
session whose every turn failed.

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

~~The body is open beyond `{ hook }` itself, like the creation route's `hooks`
array: a hook the schema would refuse is an authoring mistake to **show** rather
than a request to reject, and the selector's filter is where a broken one stops
being eligible with a class the panel turns into a sentence.~~ ***The hook is
checked as a hook*** (2026-09-27), here and in the creation route's `hooks`: the
shared `PlotHook` with `id` optional, so a mistake is `400 invalid` naming the
field and nothing is kept. The open body showed nothing: one hook without
`involves` made every read of the session a `500` and every turn a failure,
because the actor lookup iterates `involves` on every gather. A hook that
reaches the pool another way (a hand edit, an import) is never read by the
engine, and the panel lists it with the refusal `malformed`. **An `id` is minted
when the hook arrives without one** — every other hook in a pool was copied from
an object that had one and [15 §5](design/15-world.md) requires the copy to keep
it, but a session's own hook has no upstream, and without an id it could never be
committed, blocked, or recorded as fired. *Since 2026-09-27 the creation route
mints them too; it did not, and those hooks could never be removed.*

The delete takes **any** hook, whichever source put it there: the pool was copied
at creation, so a treatment-borne entry is this session's copy and refusing to
remove it would make the copy a binding ([00 §3.1](design/00-stance.md)). It does
not reach the treatment. Removing one that is already gone succeeds — it is the
state the caller asked for — while a missing **session** is still a `404`.

***`?from=&fromId=` names one row*** (2026-09-28). A pool can hold one hook
through two carriers, and the panel draws each as its own row; without the query
the delete takes every row under the id, as it always has. `from` is the row's
source kind — `session`, `treatment`, `setup` or `lore` — and `fromId` the
carrier's id, required for the three carriers and refused for `session` (`400
invalid`). A source is read as the panel shows it, so a row whose stored source
is unreadable is `from=session`. A named row the pool does not hold removes
nothing and succeeds.

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
here*, and it writes nothing** to the library or the session — P15.6,
[04 §7.2](design/04-schemas.md), [P15](design/workplan/33-p15-setup-from-a-turn.md).
`404 no-such-turn` for a turn not in the session.

**Each part is its own call with its own outcome** — `{ ok: true, value, model }`
or `{ ok: false, reason }`, where `reason` is `role-unbound`, `role-dangling`,
`window-too-small`, `call-failed`, `truncated`, `no-answer`, `summary-truncated`
or `summary-no-answer` — so a failed part
is a `200` beside the parts that succeeded rather than an error that loses them.
A `call-failed` also carries the provider failure's `class` and a `remedy`, the
same diagnosis impersonation's refusals carry, and may carry `detail`, the
endpoint's own words, for a log rather than a sentence on screen. **A part cut
off at its length limit is `truncated` and not offered**: a story so far or an
opening that lost its end is missing exactly the part a session would begin
from. A reply that was refused, empty, or still the wrong shape is `no-answer`.
*(`window-too-small`, `truncated`, `class`, `remedy` and `detail` were added on
2026-10-03, at the [P15](design/workplan/33-p15-setup-from-a-turn.md) merge:
the first was a 500 before, and a cut-off reply was offered as if whole.)*
`title`'s value is
`{ name, blurb }`; `facts`' is `{ text, keys }[]`, drafted with the memory
extractor's own prompt and minus anything a linked book already says. The parts
run one after another in that fixed order. `guidance` is a person's steer,
keyed by part and at most 2000 characters each, and reaches only the part it
names. `openingFrom: 'verbatim'` answers `opening` with the narrator's last words
at the turn and makes no call.

**What the model is shown is what the player saw**: the transcript up to the
turn, and the session's own summary chain built from it — its root, when the
session was itself started from a Setup with a story so far, and its links,
read together — extended under the session's own summariser key, so links
already on disk are read rather than re-derived and a link this writes is one
the runner would have written. *Since the merge (2026-10-03) that is true of a
session whose moves carried pictures too, and of a summary cut off at its
length limit, which is not kept, as the runner keeps none.* No hidden channel,
unfired hook or hidden goal reaches these prompts.

**A link the draft cannot derive fails every part still wanted, and no part is
asked** (2026-10-03). Each part answers with that link's own outcome — a
`call-failed` with its `class` and `remedy`, `summary-truncated` or
`summary-no-answer` for a summary that was not kept, `window-too-small`, or a
role refusal — so *Try again* asks for the link again. *(The two `summary-`
reasons since review, 2026-10-03: a link refused under a part's own
`truncated` or `no-answer` read as the part's reply being cut off, with a note
as the fix, and guidance never reaches the summariser.)* A story so far drafted from a chain that stops
short would read as the whole story with its middle missing, and nothing on
the wizard could show the gap. A part already answered without a call (a
verbatim opening) keeps its answer.

**What it costs is written down** — one line in the account's `usage.jsonl`
per call, as every call that writes no turn is: purpose `setup-draft:<part>`
for a part (`storySoFar`, `opening`, `title`, `facts`), and
`setup-draft:summarise` for each link of the chain the draft had to derive —
filed under the wizard rather than the summariser, because what a spend view
asks first is what pressing the button cost. A call that failed or was stopped
after it reached the provider is written too: it was paid for. A warm chain
costs no `setup-draft:summarise` line at all.

**A client that leaves cancels the draft.** The route reads the disconnect off
the response, as Illustrate's does (`disconnectSignal`), so a part in flight is
aborted, nothing further is asked for, and nothing is sent back to a socket
nobody holds — the cancellation it caused ends there, rather than as an error
logged for every closed tab. A failure that merely coincides with the client
leaving is still a failure. Usage lines already written stay written.

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
*make a setup from here*** — P15.7, [04 §7.2](design/04-schemas.md). `404
no-such-turn` for a turn not in the session; library refusals as every library
write's. **It makes no model call**, so it records no usage line and has nothing
for a disconnect to cancel: the texts were drafted, and edited, before it.

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

**Two of [20 §5.1](design/20-tech-stack.md)'s five layers, and the reason they
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

**`409 busy`, carrying the active `job`, while a turn is in flight**
(2026-09-27), the answer head moves and undo already gave. A turn's commit sets
the head to its own turn, so a write landing while it ran became a sibling of
that turn, on a line nobody would see again: the setting silently reverted when
the turn landed. Write it again once the turn has finished.

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

`{ session, activeJob | null, health, hud, surfaces, actions, cast, chat?, hooks,
goals, dials, inputs, suggesting }`. The job travels with the
session because a client reloading mid-turn needs to know there *is* one before
it decides whether to open a stream or offer an input box.

***`session` is not the file*** (2026-09-27), here or on any route that answers
with one. It leaves out the hook pool, carries the Setup as `{ id, name }`, and
carries each goal without its `detail`. Every reply used to send `session.json`
whole, so the pool's unfired premises, the Setup copy's goals and hooks, and
the detail this page says *does not travel* all travelled beside the panels that
redact them. The export route is the file on purpose.

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
person has not ruled ([26 C12], answered *ask* at P7.6). `se.goal` declares
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

*Since P14.5a* ([P14 §1.9.2](design/workplan/31-p14-scene-and-session-import.md)):
a fifth region, `settings` (the session's settings, where Scene's tracker
switches go), and an optional `group` — the heading a contribution is drawn
under. Two more arms: `meter: { value, min, max }`, a stat bar, and
`record: { value, fields, locks, hidden }` — **the value itself**, raw JSON,
because a record is edited field by field and the edit is the whole value
written back through `PUT …/channels/:key`. `fields` is `[{ key, label, show }]`
from a closed set (`line`, `number`, `flag`, `lines`, `pairs`, `map`, `items`,
`meters`, `checklists`; `key: ''` is the value itself); `locks` and `hidden` are
`{ key, paths }` — the set channel and its field paths, each
`<channel key>/<JSON Pointer>` with a list row named by its `name` — or `null`.
A channel whose `state.enabledBy` switch is off has no surface; an
actor-scoped record is one per **present member but the persona**, whether or
not the channel holds a value for them yet.

`actions` is what a person may run between turns — `[{ stepId, label }]`, the
mode's declared on-demand steps, each listed only while a channel it writes is
switched on (Scene's *Update trackers*). Each is run by
`POST …/steps/:stepId/run` below.

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

`chat` is how the session plays as a chat
([P14 §1.2](design/workplan/31-p14-scene-and-session-import.md), added at
[P14.5]): `{ voice, dispatch, speakers: { policy, allowSelfResponses,
namesInHistory, maxPerRound }, note | null, hidden, prompts: { instruction,
cards } }`, **the effective settings** as the server's one reader resolves them
— so a Scene session written before P14 shows the narrated, merged, `fixed`
values its turns actually get, not Scene's declared ones. **Absent for a mode
that does not play as a chat** (one that does not declare `castIsPresent`),
which is `dials`' rule.

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
deletion is a move. **`409 busy` while a turn is in flight** (2026-09-27): its
commit would write `sessions/<id>/` back beside the trashed one. A picture still
being made when the session goes writes nothing, and a restore that finds a
folder without a `session.json` in its place moves that aside into the trash.
A restore (`POST /api/me/trash/restore`) indexes what it puts back before it
answers, so a restored session is found by search again and a restored object
reads at once. `{ id }` names an entry as `GET /api/me/trash` lists it; one that
is not an address is `400 invalid`, one no longer there is `404 not-found`, and
one whose place is taken is `409 occupied`. ***Anything else is a `500` and is
logged*** (2026-09-27): every failure used to be *not an address in the trash*,
including a rename the disk refused. The second of two restores of one entry at
once is the `404` or `409` a moment's later look would give.

### `PUT /api/sessions/:sessionId/chat`

`{ voice?, dispatch?, speakers?: { policy?, allowSelfResponses?, namesInHistory?,
maxPerRound? }, note?: { text, depth, every } | null, prompts?: { instruction?,
cards?: { [actorId]: boolean | parts[] } } }` → `200 { session, chat }`, the
second being the effective settings after the write. Added at
[P14.5](design/workplan/31-p14-scene-and-session-import.md); at least one member
is required, and the vocabularies are closed (`400` otherwise).

***Writing any of voice, dispatch and speakers writes all three.*** A session
carrying none of them was written before P14 and reads as its mode's legacy
values; writing `dispatch` alone would make it modern and let its absent
`voice` fall to the mode's declared one, re-voicing a saved game. So the route
reads the effective three first and puts all of them on the file, the request
laid over. `speakers` merges member by member. `note: null` — or a note with no
text — removes it, and `every: 0` switches it off with its text kept.
`prompts.cards` merges per card: `true` or `[]` is *send everything* (no entry),
`false` skips every part, and a list of `system`, `post-history`, `depth` skips
those. `instruction: true` sends the pack's instruction (no entry).

`422 not-a-chat` for a session whose mode does not play as one — the same test
the read uses to send `chat`. Not refused while a turn runs, as a hide is not:
the running turn read its settings before it started.

### `PUT /api/sessions/:sessionId/turns/:turnId/hidden`

`{ hidden: true | false | number[] }` → `200 { session }` —
[P14 §1.6](design/workplan/31-p14-scene-and-session-import.md)'s hide, built at
[P14.4]. **A set, not a toggle**: `true` hides the turn whole, input included;
a list hides those message indices; `false` or `[]` unhides. `404 no-such-turn`
for a turn this session does not have, `422 no-such-message` for an index past
its messages. History skips what is hidden, and the transcript ghosts it.

### `GET /api/sessions/:sessionId/turns?limit=`

`{ turns, siblings, swipes }` — the path from the head, **oldest first**, not every turn
in the file. A session is a tree, and a transcript is one walk of it.

`siblings` maps a turn on that path to every child of its parent, in creation
order, and **only for nodes that have more than one**. History shows the
selected path only ([07 §6](design/07-branching.md)), so this is how an
alternative is reachable at all — a swipe is a sibling nobody named, and without
this it would be on disk and invisible. A map of every turn to its lone self
would grow with the transcript and say nothing.

`swipes` (added at [P14.5](design/workplan/31-p14-scene-and-session-import.md))
says, for each of those nodes, **where its siblings are drawn**:
`{ messages, turn }`. `messages[k]` is the ordered alternatives on message *k*'s
counter — [P14 §1.6]'s *"swipes surface on the message, not the turn"* — the
turn itself among them, or `[]` when there is only one. The counter is built
from the siblings that answer the same move and say the same messages `0..k-1`,
one alternative per distinct message *k* (by speaker and text), ordered by the
first-created sibling saying it and named by the viewing turn where it says that
line, so it reads the same from whichever member is on screen. `messages` has
one more entry than the turn has messages: the alternatives that say everything
this turn says and then go on, drawn on its last message. `turn` is the turn and
the siblings that answer a different move (an edited input, another thing typed
from the same place), which a client keeps on the turn; `[]` when there are none.

### `POST /api/sessions/:sessionId/attachments` · `GET /api/sessions/:sessionId/attachments/:digest`

A picture for a player's move, uploaded before the move is sent —
[26 E15](design/26-open-questions.md), R1. Upload is `multipart/form-data` with
one file part, the library import's two-step shape
([10 §11.2b](design/10-ui-surfaces.md)): the bytes first, then the turn names
them by digest in its ordinary JSON body.

→ **201** `{ attachment: { digest: "sha256:…", mime, bytes, width?, height? } }`
— the pixel size read from the file's header, absent if it could not be read;
**413 `too-large`** past 8 MB; **415 `not-an-image`** unless the bytes are a
PNG, JPEG or WebP **by their own signature** — never by the file name or the
part's declared type; **404 `not-found`** when the session was deleted while the
picture was on its way — the store is written under the session's lock and only
while the session is there, so a late upload never recreates a deleted
session's folder; **422 `refused-path`** when the session's folder leads
somewhere else on disk.

**Never re-encoded here.** The client scales a picture down and re-encodes it
before upload, and **fails closed**: a browser that cannot re-encode refuses
rather than sending the original, because a phone photograph records where it
was taken. The server keeps its position of having no raster encoder, so this
route stores exactly the bytes it was given, under their own content address in
`sessions/<id>/attachments/` ([03 §5.5](design/03-data-model.md)). The same
picture uploaded twice is one file, and **uploading it again renews it**: the
sweep below counts a day from the last time anybody wanted a picture, not from
the first time it was written.

**The upload also sweeps**: pictures no turn in the session names — every turn a
reader sees, siblings included, never only the head path — and nobody has
wanted for a day are removed. On age rather than on commit, because the composer
holds uploads no turn names yet while the session goes on committing; a
submitted move renews its pictures too, so one is safe while its turn is still
running. Only names this store writes are ever removed, and the turns are read
only when something is old enough to go. *A tombstoned turn is not a
reference* — the reader skips it, and nothing writes tombstones at 1.0.

`GET` serves the bytes in the rendition asset route's shape: `content-type`
from the store, the digest as the `etag`, and cached as immutable, since the
address is the content. **`404 no-picture`** when the bytes are not here, which
after an import from an export is the ordinary state rather than an error — the
record says a picture was there and carries its caption, and the client renders
that caption with a placeholder where the picture would be.

### `POST /api/sessions/:sessionId/turns`

```
{ idempotencyKey, headTurnId: string|null, parentTurnId?: string|null,
  rewriteOf?: string, redoOf?: string,
  input: { text, actorId?, kind?, attachments?: [{ digest, caption? }],
           attachmentsOf?: string },
  guidance?, speakers?: string[], push?: "natural"|"random" }
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

**`rewriteOf` is the difference between rewrite and reroll** ([20 §14.5]). It
names a turn whose draws this one should replay: the same roll, so the same
mechanical outcome and different prose. Absent, the turn draws fresh — which is
reroll, and also every ordinary turn. **A turn id rather than a tape**, because
the draws are read from this server's record: a client cannot post the roll it
wishes it had got, and a turn from another session is `404 no-such-turn`.

Rewrite is the default of the two gestures, which is what stops swiping past a
failed check from being save-scumming by accident. A turn that consumed no
draws has nothing to reroll, and the surface must not offer it one
([20 §14.6]).

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

**A turn nothing made is not redone: `422 opening-turn`.** A `redoOf` or
`rewriteOf` naming a turn with no `input` and no `request` — a Setup's opening
or its effects-only seeding turn, a cast's greeting, a hand edit's divergence
turn, a turn written by hand with no move, an import's reply to nothing — is
refused, because there is no tape to replay and no call to repeat, and a reply
to nothing in its place is *let them talk* sent from the parent. A swipe of one
message (`fromMessage`) is not refused by this: it is the gesture's own reading
of the record. *Since 2026-10-03, at the
[P15](design/workplan/33-p15-setup-from-a-turn.md) merge, and wider than
either side had it*: the branch refused only turns marked `Turn.opening`, a
field dropped at that merge, and `main` refused none of them — a redo of a
greeting answered nothing at the root. The play surface withholds **Redo** from
the same turns, by the same rule (`redoable` in `shared` names it).

**`input.attachments` names pictures already uploaded to this session** —
at most four, each by digest with an optional caption
([26 E15](design/26-open-questions.md)). **Digests and captions are all a client
says**: the type, size and dimensions on the turn are read from this server's
store, on `rewriteOf`'s reasoning. A digest the store does not hold is **`422
unknown-attachment`**, carrying the `digest`.

**`input.attachmentsOf` is a redo's pictures**: a turn in this session whose
`input.attachments` this move carries, **copied as recorded** — every id, kind
and caption, and a picture whose bytes never reached this server, which is the
ordinary state of an imported turn and goes to every model as its words.
Type, size and dimensions are re-read for any picture whose bytes are here now.
A turn that is not in this session is **`404 no-such-turn`**, and naming both
`attachments` and `attachmentsOf` is **`400`**. *Why a turn rather than a
re-sent list*: the client can only re-send what it can name, so a rebuilt list
lost every picture without a digest and turned a kind this build does not know
into `image` — which, bytes present, a model that sees would then have been
sent.

**The caption is the picture for every model that cannot see it**, and it is
never folded into `input.text`, which stays the player's words. Whether the
pixels go is decided **per call**, from the model the call resolved to: only a
picture on the move being taken, in a user message, to a model its connection
lists in `imageModels` (below), with its bytes present. Otherwise the caption
goes, or an honest placeholder when there is none — and the assembled block's
`image` says which and why (`unknown-kind`, `outside-window`, `not-user-role`,
`missing-bytes`, `model-text-only`, in the order the record prefers when several
hold: the model last, since it is the one reason another binding fixes; and
`budget` when the budgeter dropped the block — a picture in history, or a
step's own — so neither went). Nothing records a session as
able to see pictures, which is what keeps one used with a model that sees
continuable on a model that does not.

**`input` is closed** since the same change, 2026-09-27. It was open, so a
field this server did not know got a `200` and was silently dropped from the
turn; a closed object answers `400`, which a client can act on.

**`speakers` is force-talk**
([P14 §1.3](design/workplan/31-p14-scene-and-session-import.md), P14.1):
actor ids, in the order they should reply, and **it overrides the session's
speaker policy** — SillyTavern's member *speak* button and `/trigger`,
Marinara's `forCharacterId`. It reaches a **muted** member, which is what it is
for, and nobody else the policy would not: the persona is **`422
speaker-is-persona`**, an id outside the session's cast **`422
speaker-not-in-cast`**, and somebody dead or departed **`422
speaker-written-out`**, each carrying the refused `speaker`. Status is checked
at the node the turn attaches to — `parentTurnId` when sent, else the head — so
a branch from before a character died may still name them. At least one id and
no repeats (`400` otherwise), at most 32.

**A forced turn records who was named, and a rewrite keeps them.** The list is
on the turn as `input.speakers` — the request, in the order asked, not who
replied, which the output's messages say. A `rewriteOf` submission without
`speakers` is forced to the redone turn's `input.speakers`, read from this
server's record for the reason the tape is; a name that no longer passes the
checks above when the turn runs is dropped rather than refused. `speakers`
sent beside `rewriteOf` wins over the record. A reroll keeps nothing and plays
the session's policy; a client that wants the same member again sends
`speakers` again.

**`push` is Push story**
([P14 §1.9.3](design/workplan/31-p14-scene-and-session-import.md), P14.5b):
the narrative director armed for this one turn — `natural` moves the story on
through what it already has, `random` brings in something plausible nobody saw
coming. It runs `se.scene.direct` before the reply, one small call whose
direction reaches the guidance slot (as `se.guidance.direction`, a `step`
producer); when that call fails, the session's pack's own push text for the
flavour stands in. Any other value is `400`, and beside `authored` it is `422
conflicting-gesture`. **A rewrite or a guided redo keeps it**: a `rewriteOf`
or `redoOf` submission without `push` is pushed as the redone turn was, read
off that turn's director outcome; `push` sent beside either wins. A plain
reroll names no turn, so a client redoing a pushed turn sends `push` itself.

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

**A `se.speakers.smart` outcome in `turn.steps` says who smart order picked and
why** ([P14 §1.3a](design/workplan/31-p14-scene-and-session-import.md), P14.1).
The step runs only on a turn of a `smart` session that no rule settled — nobody
forced, nobody named, more than one member who may reply — so most turns of such
a session have no such outcome. When it is there it carries `speakers: { by,
picked }`: `picked` is `[{ id, name, because? }]` in the order they reply, and
`by` is `model` (the call answered usably), `fallback` (it did not, and the
rule-based pick drawn on the turn's tape played instead) or `rewrite` (a
`rewriteOf` submission, which keeps the redone turn's speakers and makes no
call). **A fallback is a `failed` outcome under `failure: "warn"`**, whose
`error` says why and whose `speakers` says who spoke instead; the turn itself
completes. `because` is the model's one line for that member and is absent on a
fallback or a rewrite, where nobody was asked.

**A `se.scene.direct` outcome in `turn.steps` says what a push directed**
([P14 §1.9.3](design/workplan/31-p14-scene-and-session-import.md), P14.5b),
present only on a pushed turn. It carries `direction: { push, by, text? }`:
`by` is `model` when the director answered and `fallback` when the pack's fixed
text stood in — a `failed` outcome under `failure: "warn"`, whose `error` says
why; the turn completes. `text` is the words the guidance slot carried, absent
only when the call failed and the pack ships no push text, so the turn ran
undirected.

**An outcome with `revisions` says what an editor did to the turn's messages**
([P14 §1.9.4](design/workplan/31-p14-scene-and-session-import.md), P14.5c) —
Scene's `se.scene.edit`, or any step whose mode declares `revises`. It is
`[{ index, edited?, changes?, notices? }]`, one row per message the editor had
something to say about, by the message's index in `output.messages` (a turn with
no `messages` is one message, index `0`). `edited: true` means the message's
text was replaced **before the turn was written**: `output.text` and the
message's `text` are the edited words, and the message's `original` is what the
model wrote (or what cleanup kept of it, when cleanup had already written one).
`changes` is the editor's account of what it changed. `notices` is what it found
and left alone — continuity findings, `{ issue, quote?, fix? }` — and one with
both `quote` and `fix` is applied by the edit gesture (`editOf` with the
message's text, `quote` replaced by `fix`), which writes a sibling. **Absent**
when the editor is off, needed no edit and found nothing, or failed; a failed
editor is a `failed` outcome under `failure: "warn"` and the turn keeps the
unedited reply. While the editor runs with its hold on, the round's `delta`
frames arrive only once the edit is in.

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
([22 §1.2.1](design/22-internal-contracts.md)). So a turn that is no longer the
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
{ input?: { text, actorId?, kind?, attachments?: [{ digest, caption? }] }, guidance? }
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

`input.attachments` previews the pictures in the composer, and each picture's
block carries the same `image` disclosure a turn's does — so *will this model
see the picture* is answerable before sending, and the composer says it under
each picture. **A digest the store does not hold is left out here rather than
refused, and only that one**: the preview runs every time somebody pauses
typing, and a picture swept a moment ago is not a request worth a `422` — nor a
reason to hide the pictures that are fine. The rest keep the ids they will have
when the move is sent. And **`input` without a `kind` previews the kind a
submission defaults to** (`do`), so a pack whose input slots are all per-kind —
Freeform's — previews the move's words and pictures rather than neither. And since 2026-09-27 the preview resolves its model
through the same session and step layers, and the same actor hint, as the turn
does; before, it read the account's binding alone, and could name a different
model from the one that answered — which the send rule would have made a
preview promising pixels the turn then sent as words.

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

### `POST /api/sessions/:sessionId/impersonate`

```
{ actorId? }
```

A draft of your own character's next message — [06 §3.1](design/06-modes-and-turn-pipeline.md),
[P11.4](design/workplan/28-p11-implementation.md). → `200 { text }`. The persona
speaks by default; `actorId` names another member you play. **Nothing is
committed**: no job, no turn, no head moved, which is also why it is not refused
while a turn is in flight. The client leaving cancels the call.

Refusals, each a class the client words:

- `409 not-a-player` — that member is not one you author.
- `422 no-prose-step` — the session's mode writes no prose, so there is no voice
  to borrow.
- `422 role-unbound` · `422 role-dangling` — no connection for the model this
  needs, or a binding to one that is gone.
- `502 provider-failed` — the endpoint failed after the server asked it
  (added 2026-09-27; it was a bare `500`). The body carries `class`
  (`transient`, `retryable` or `terminal`) and `remedy`, the same
  `FailureRemedy` a failed turn gets, so a wrong key, a model server that is
  down and a stall read as three different things. The log line is
  `impersonate.failed`, with the class, the call and the endpoint's own words,
  and never the prompt.
- `503 cancelled` — the server stopped the call before it answered.

### `POST /api/sessions/:sessionId/steps/:stepId/run`

No body. Runs one of the session's mode's **on-demand steps** between turns —
Scene's is `se.scene.track`, *Update trackers*
([P14 §1.9.2](design/workplan/31-p14-scene-and-session-import.md), P14.5a). →
`200 { session, turn, health, hud, surfaces }` when it changed something, or
`200 { turn: null, callId }` when it had nothing to change (no tracker on, or a
call that found the scene as it was).

**What it writes is an engine turn**, the shape a channel write takes: a child
of the head, no tape, no `steps`, carrying the step's call in `request` and its
effects. So it is on the current branch only, undone by the ordinary undo, and
not a story turn: it moves no cadence and is no transcript row. The step sees
the last story turn's move and reply, and the channels at the head, so edits
made since then are what it starts from.

Refusals:

- `404 no-such-step` — the session's mode declares no on-demand step by that id.
  Only a `post` step that writes effects can be one.
- `409 busy`, carrying the active `job` — a turn is in flight.
- `409 moved` — the head moved while the call ran; nothing was written. The
  call's spend is in the usage log.
- `422 role-unbound` · `422 role-dangling` · `422 window-too-small`.
- `502 provider-failed` — with `class` and `remedy`, as impersonation's; the log
  line is `on-demand.failed`.
- `502 step-failed` — the endpoint answered and the step could not use the
  answer (a shape it did not ask for). The log line is `on-demand.step-failed`.
- `503 cancelled` — the server stopped the call. The client leaving cancels it.

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
event: delta        { jobId, text, message? }                ephemeral — no id
event: rendition    { …the rendition record }                ephemeral — no id
event: summaries    { sessionId, state, links, missing, derived }   ephemeral — no id
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
`speakers.picked`, `turn.finished`. They are **structural** — the client renders them — and carry a
failure *class*, never a provider's words.

`effect.applied` carries `{ channelId, accepted, reason }`, where `reason` names
the policy that refused — the same class the turn record keeps
(`engine-computed`, `user-only`, `unknown-channel`, open for an extension's own)
— and is `null` when the effect applied. Added at [P3.5] so the live view and
the record cannot disagree about *why* something was refused.

**Deltas are not durable and carry no id.** A reattach may see coalesced text
rather than every delta that painted it live, which [P2 §2.10](design/workplan/08-p2-implementation.md)
states as the trade; the snapshot's `text` is what makes that lossless.

**`rendition` carries a picture's whole record** whenever its state moves —
`pending`, then `ready` or `failed` —
[P9.2](design/workplan/26-p9-implementation.md). It has no id and takes no part
in the backlog; a client applies it by upsert on the record's `id` and reads
`GET /sessions/:id/renditions` again after a reconnect, since a frame sent while
the stream was down reached nobody. **A `ready` background means the backdrop
moved** (2026-09-30): the worker selects it before the frame goes, so the
session's head and its `stage` surface have changed, and a client reads the
session again. One that lands while a turn is being written is held and
selected on top of that turn once it commits — after `turn.finished` — and its
frame is sent a second time then, so count them rather than dedupe by id.
**`summaries`** is the summary warm's whole state
([P14.11](design/workplan/31-p14-scene-and-session-import.md)); a client may
ignore it and lose only a progress line.

**`message` is which of the turn's messages a delta belongs to** — added at
[P14.2](design/workplan/31-p14-scene-and-session-import.md), for a round under
`per-actor` dispatch, where each speaker's call streams into a message of its
own. It is the index into the turn's `output.messages`, and `call.started` and
`call.streaming` carry the same `message` in their `params` — and since
[P14.5], `call.started` carries the message's `speaker` too, `{ id, name }`, so
a client can name the bubble as it opens. It is **absent**
on a narrator's text and on the blank line the server sends between two
speakers, so a client that appends every delta's `text` to one string — every
client written before it — still ends with the turn's `output.text`, and a
client that paints messages separately skips the deltas without one while a
round is streaming. A reply is cleaned when its call completes, so the
committed message can be shorter than what streamed; the draft and the turn
say what was kept.

**`speakers.picked` is the round's order** — `{ speakers: [{ id, name }], by }`,
added at [P14.5] for [P14 §1.3a](design/workplan/31-p14-scene-and-session-import.md)'s
*"while a round streams, the who-speaks-next control shows the picked order"*
(Marinara's `response_queue`). Sent once per turn, when the selection is final:
`by` is `rules` when the policy drew it, `forced` when the submission named
the speaker (force-talk), `rewrite` for a swipe, a continue or a rewrite that
kept the redone turn's speakers, and `model`, `fallback` or `rewrite` from the
smart order's step. Not sent for a narrator's
turn or a room nobody is cast in, because an empty queue is not an order.

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
no stop-sequence machinery ([20 §5.5](design/20-tech-stack.md)). A local model
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
`users/<handle>/prefs.json` ([26 B13](design/26-open-questions.md), resolved).

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

### `GET /api/me/roles` · `PUT /api/me/bindings` · `PUT /api/me/task-roles`

```json
{
  "roles": [{ "role": "prose", "tier": "hi", "ok": true, "via": "binding", "…": "…" }],
  "bindings": { "prose": { "connectionId": "0199…", "modelId": "gpt-lo" } },
  "contentHash": "sha256:…",
  "connections": [
    { "id": "0199…", "label": "The house key", "provider": "openai-compatible",
      "scope": "system", "models": ["gpt-hi", "gpt-lo"] }
  ],
  "disabled": [],
  "tasks": { "assist": "prose" }
}
```

**What *your* turns will do, where `GET /api/admin/roles` says what the install
has got.** Same row shape; different layers. This one resolves your own
`users/<handle>/bindings.json` over the install defaults against the connections
you may actually use, which is [20 §5.1](design/20-tech-stack.md)'s order — and
`via` is the whole reason to ask a server rather than work it out in a browser.

One request carries the whole pane: the resolved table, the raw document to edit,
a hash to write against, and the connections a binding may pick from with their
model lists. `disabled` is personal connections on disk that were ignored for
want of `privateConnections`, returned rather than dropped so you are told rather
than left wondering why a model call started failing
([09 §4.5](design/09-server-multiuser-deployment.md)).

**`shadowedBy: { "label": "…" }`, on an install connection one of your own
hides** (since 2026-10-04, [polish §26](design/workplan/06-polish.md)). A file of
yours that claims an install connection's `id` wins it for you — personal comes
first — so every binding naming that id, yours and the install's defaults alike,
reaches your file. The install connection is still listed, in resolution order,
and carries the label of the file of yours that answers in its place; every
install file claiming the id is marked, since none of them can answer for you.
Nothing else of your file travels with it. Absent everywhere else, and always
absent without `privateConnections`, because then nothing of yours resolves. A
client offering bindings should leave a marked connection's models out: a
binding chosen from them names the id, and the id reaches yours.

`PUT /api/me/bindings` takes `{ bindings, contentHash }` and answers the same
`{ bindings, contentHash }`. The document is **replaced wholesale** — it is
exactly its known role keys, so there is nothing a merge would preserve — and the
hash is the library's stale-check idiom: a mismatch is
`412 stale` carrying `current`, so a client can offer *load what is on disk*
rather than only being told no. That matters more here than for the system file,
because [10 §4](design/10-ui-surfaces.md) says hand-editing this one works.

**No administrator is involved, and no capability is checked.** [20 §5.1] is
explicit that *anyone who wants their own key overrides a role without the
admin's involvement*. A binding is two ids; what keeps that safe is that
`resolveRole` looks the `connectionId` up in the capability-filtered list, so one
naming a connection you may not use can never be access — it falls through to the
layer below. A role this build does not know is dropped rather than refused, so
a newer client is not an error; **anything else inside a binding is `400`**, which
is what lets this route live outside `/api/admin`.

**`tasks` says which of those rows the calls outside a session use** — today
only field assist, which asks for `prose` unless you chose otherwise.
`PUT /api/me/task-roles` takes `{ "assist": "prose" | "fast" | "reasoning" }` and
answers `{ tasks }`; any other role is `400`, and there is no hash, because the
file is one value and the request carries all of it. It is a stopgap for
[26 C15](design/26-open-questions.md): [10 §11.4](design/10-ui-surfaces.md) says
assists want `fast`, and until role fallback is decided for everyone, the person
who knows whether their `fast` model is bound chooses. A server older than this
omits `tasks`, which means `prose`.

### `GET · POST /api/me/connections` · `PUT · DELETE /api/me/connections/:id` · `POST /api/me/connections/models`

***Your own connections*** — [10 §15.1](design/10-ui-surfaces.md)'s *your
connections*, built at [P10.3](design/workplan/27-p10-implementation.md)
(`15043532`, 2026-09-16) and **documented here only from 2026-10-03**: until then
this file's administration section said no route reached a user's own
`connections/`, and nothing here said otherwise.

**The administration routes below, with one substitution** — your
`users/<handle>/connections/` for the system scope — so the bodies, the answers
and the errors are [`POST /api/admin/connections`](#post-apiadminconnections--put-apiadminconnectionsid)'s,
[`DELETE`](#delete-apiadminconnectionsid)'s and
[`POST /api/admin/connections/models`](#post-apiadminconnectionsmodels)'s:
`GET` answers `{ connections }` in the admin row shape, `POST` mints the id and
answers `201 { connection }`, `PUT` requires `contentHash` and answers
`412 stale` the same way, and `DELETE` is `204` and removes every file in your
scope claiming the id. What differs:

- **`privateConnections` is checked on every request**, re-read rather than
  remembered from sign-in, and its absence is **`403 forbidden`** — not `404`,
  because the route exists and what is missing is permission. It is the same
  check the resolver makes at every turn ([09 §4.5](design/09-server-multiuser-deployment.md));
  this route being refused is not what keeps a hand-written file from resolving.
- **`PUT` and `DELETE` reach your scope only.** An id that exists only in the
  system scope is `404`, never a way into the install's file.
- **`DELETE` carries no binding count.** The admin warning exists because a
  system connection is other people's; deleting your own breaks only your own.
- **`shadowed` is computed over your scope alone**, so it marks the loser of two
  of *your* files claiming one id. A file of yours claiming a **system**
  connection's id reads `shadowed: false` — true, since it wins for you — and
  ~~nothing on this route says what it hides; the runner's `connections.shadowing`
  log line is the only report, a known follow-up tracked at
  [manual testing §10](design/workplan/05-manual-testing.md)~~ *(2026-10-04:
  it says so now — next bullet)*. It wins for your
  account only: the provider memo has rebuilt per connection rather than per id
  since 2026-09-27 ([P2B §1.5](design/workplan/10-p2b-provider-configuration.md)).
- **`shadows: { "label": "…" }` names the system connection such a file hides**
  (since 2026-10-04, [polish §26](design/workplan/06-polish.md)): on the file of
  yours that wins an id a system connection also claims, the label of the system
  connection your bindings — and the install's defaults — would otherwise reach,
  which is the first system file claiming the id by label. Its label alone:
  never its key, its address or its models. On the list and on `PUT`'s answer;
  absent from every other row, from a loser already marked `shadowed`, and from
  `POST`'s, whose minted id cannot collide. The system connection's own half is
  `shadowedBy` on [`GET /api/me/roles`](#get-apimeroles--put-apimebindings--put-apimetask-roles).
- **`POST /api/me/connections/models` makes the server fetch a URL you typed**,
  which the admin twin's note calls administrator-only. It adds the timing and
  not the reach: an account with `privateConnections` can already store that URL
  as a connection and have every turn call it.
- **`POST /api/me/connections/:id/test` tries one of your own saved
  connections** (since 2026-10-03), and is documented with its admin twin at
  [`POST /api/admin/connections/:id/test`](#post-apiadminconnectionsidtest--post-apimeconnectionsidtest).
  It resolves ids among your own connections only, so a system or another
  account's id is `404`; it is `403 forbidden` without `privateConnections`,
  before anything is read; its usage line goes to your own
  `users/<handle>/usage.jsonl`; and like the models assist it adds the timing
  and not the reach, because it can only call a URL you already saved.

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
`auth.minPasswordLength` is `400 invalid`, naming `/password`. A handle the rule
under [setup](#post-apiauthsetup) refuses is `400 invalid` with that rule as
the message (2026-09-27; it was a `500`).

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
  "appliers": { "log.level": "applied", "limits.extensionStorageQuotaMb": "unread" },
  "bounds": { "server.port": { "minimum": 1, "maximum": 65535 } },
  "pendingRestart": []
}
```

**The tier table travels as data.** The client may not import from the server
package, and a duplicated copy would falsify
[22 §4](design/22-internal-contracts.md)'s claim that the annotation *is* the
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
- ***And resolved and checked as the next start would meet it*** (2026-09-27).
  The environment's `SE_*` values sit under the file, as they do at boot, so
  `pendingRestart` names what a restart would actually change. A deployment key
  that differs from what this process started with is asked of the machine:
  `server.host` must be the wildcard, loopback, or an address this machine has
  (a name must resolve to one here); a changed `server.port` must be one a
  listen here could take; `server.clientRoot` must hold an `index.html`, and
  cannot be emptied while this server serves the app; `server.cookieSecure`
  can be turned on only from a page reached over HTTPS, or through a proxy
  named in `x-forwarded-proto` when the same save trusts proxies. Each refusal
  is `400 invalid` with an `issues` line naming the key, and nothing is written.
  The schema alone had passed each of these, and each was a start that failed,
  or one nobody could reach or sign in to.
- ***A save writes what somebody chose*** (2026-09-27). The form sends the whole
  running config back; a key the file does not already set is written only
  when its value differs from what the environment or the default would give
  it. An unedited save used to copy `SE_HOST`, `SE_PORT` and `SE_CLIENT_ROOT`
  into the file, where they outranked the environment from then on.

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
      "imageModels": ["gpt-hi"],
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
wants one, and ~~reachable from no route here~~ reachable from no route under
`/api/admin` ([P2B §2.7](design/workplan/10-p2b-provider-configuration.md)).
*(2026-10-03: its owner's own routes have reached it since `15043532`, P10.3,
2026-09-16 —
[`/api/me/connections`](#get--post-apimeconnections--put--delete-apimeconnectionsid--post-apimeconnectionsmodels),
which this file did not document until today.)*

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
  "imageModels": ["gpt-hi"],
  "capabilities": {
    "maxContextTokens": 32768,
    "reportsUsage": true,
    "rendersImages": false,
    "supportsImageSeed": false
  }
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
the settings form now offers the four an operator has a reason to set — the two
below, and since 2026-10-03 `rendersImages` and `supportsImageSeed`.

Those two are `maxContextTokens` and `reportsUsage`, ~~and they are the two only
the operator can know~~ the two an operator most often has to set *(2026-10-03:
not the only ones only the operator can know. `rendersImages` (P9) and
`supportsImageSeed` are facts about the endpoint too, declared per connection
~~with no form control yet and written by hand — the guide's [Editing connection
files by hand](guide/connections-and-models.md#editing-connection-files-by-hand)
says how, and the merge above keeps them through a save; the missing
`supportsImageSeed` control is carried as a debt at
[P9 §3.2](design/workplan/26-p9-implementation.md)~~ — and, from later the same
day, set on the form beside the other two: **Makes pictures** and **Sends a seed
with a picture**, under
[polish §25](design/workplan/06-polish.md#25-a-connection-can-be-tried-without-taking-a-turn).
A hand edit still works, and the merge above keeps either through a save)*:
**this build assumes a conservative context window**, and an endpoint that does
not count tokens will make every figure in a turn record null. The rest of the
capability shape travels untouched.

**`imageModels` names which of `models` can see pictures** on a player's move
([26 E15](design/26-open-questions.md)), and it is **per model, not a
capability**, which is the point of it: one endpoint serves a vision model and a
text one, so a connection-wide flag would send pixels to the text model the
first time a binding or an actor hint picked it. Absent keeps what is stored;
anything not in `models` is dropped on save, so removing a model removes it here
too. Empty, the default, means no model on this connection is sent pictures —
their captions go instead, which is always a working answer. It is absent from
a connection that never set it, and rides on the non-admin shape too, beside
`models`.

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

**Nothing answering splits in two since [P11.6](design/workplan/28-p11-implementation.md)**:
`502 offline` when the endpoint is remote *and* the update check has
established this machine has no route out, `502 unreachable` otherwise — a
local model server that does not answer is simply not running, and *nothing has
looked yet* claims nothing about the network. The connection test below uses the
same pair, from the same function.

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
safe*, and it is the true one. *(2026-10-03: administrator-only no longer — an
account with `privateConnections` has the same fetch at
[`POST /api/me/connections/models`](#get--post-apimeconnections--put--delete-apimeconnectionsid--post-apimeconnectionsmodels)
since P10.3, which says why that adds timing rather than reach.)*

A `POST` that writes nothing, because it carries a key — and a key does not
belong in a URL.

### `POST /api/admin/connections/:id/test` · `POST /api/me/connections/:id/test`

```json
{ "kind": "text", "modelId": "gpt-hi", "prompt": "Say hello in one short sentence." }
```

One call to a **saved** connection, on demand —
[polish §25](design/workplan/06-polish.md#25-a-connection-can-be-tried-without-taking-a-turn), and the health check
[P2B §5](design/workplan/10-p2b-provider-configuration.md) deferred until the
connectivity work existed. `kind` is `text` or `image`; `modelId` is not checked
against the connection's `models`, because that list may be empty and *try this
model before adding it* is one of the things a test is for; `prompt` is at most
2,000 characters.

```json
{
  "kind": "text",
  "text": "Hello there.",
  "modelId": "gpt-hi",
  "finishReason": "stop",
  "usage": { "promptTokens": 12, "completionTokens": 3 },
  "cost": null,
  "elapsedMs": 840
}
```

```json
{
  "kind": "image",
  "mime": "image/png",
  "base64": "iVBORw0…",
  "modelId": "gpt-image-1",
  "seed": 1737849,
  "cost": null,
  "elapsedMs": 14300
}
```

`modelId` is what the endpoint says answered, which may not be what was asked
for. A picture comes back as base64 so a page can show it without the picture
being written anywhere; nothing here stores it (the usage line below records
the call, not the picture).

**What is tested is what is saved.** The connection is looked up by id and the
provider comes from the same memoised factory a turn uses, so the stored key and
address are used without the key ever reaching the client — and the body is
**closed**: one carrying `apiKey` or `baseUrl` is `400 invalid`, not honoured. A
pass means a turn will work. Under `--capture` the exchange is a cassette like
any other, because it goes through the same transport.

**The smallest question, asked as a turn asks it.** A message is asked with a
completion ceiling of 256 and no sampler settings at all — a preset's are the
preset's — through the non-streaming call, so it proves the key, the address and
the model, not the streaming path or a preset. The ceiling is not smaller
because a model that thinks before it answers spends its first tokens where
nobody sees them: at 32 it returns empty text finished by `length`, a working
connection that reads as a broken one. **An empty `length` reply is a `200`**,
and the client says why. **It goes through the same call path as every model
call that is not a turn** (`performCall`): the connection's context window is
planned against, so a window too small to hold the test beside its reply is
`422 window-too-small` before anything is sent, and a busy or unreachable
endpoint is asked again on a turn's ladder — twice more, after a quarter of a
second and a second — so a 429 that clears on the second ask passes, as it would
for a turn, and `busy` means it did not clear.

**A picture only where the connection says so** — `rendersImages` on its
capabilities — checked before anything is sent. The request is a rendition's:
a clock seed and an empty `workflow`, the seed sent only where
`supportsImageSeed` says the endpoint takes one. **A picture is asked once**:
it does not go through that call path, which has no picture arm, and picture
requests are never retried (a 429 is `busy` at the first answer).

**The timeout is `limits.providerTimeoutMs`**, the one a turn obeys, and `0`
means none — for a message as each attempt's bound, for a picture as a wall
clock on its one attempt (unlike a rendition, which no clock stops: nobody is
watching a rendition, and somebody is watching this). A local runtime's first
request loads the model, which is why this is not the model list's ten seconds.
A reverse proxy's own read timeout (nginx defaults to sixty seconds) can cut a
slow picture off first; that surfaces as whatever the proxy answers, which the
client reads as *did not come back with an answer this page understands*.

**A client that leaves ends it.** The call is aborted when the request's
connection closes before the answer is written — `disconnectSignal`, as
Illustrate and the field assist use it — on either arm, and nothing is
answered or logged as an error. A hosted endpoint may already have billed a
picture it accepted; aborting does not un-spend it.

| Status | `error` | When |
|---|---|---|
| `400` | `unbuildable` | a hand-written file names a provider this build has no adapter for |
| `401` | `unauthorized` | the endpoint refused the key (`401` or `403` from it) |
| `403` | `forbidden` | personal route, and the account lacks `privateConnections` |
| `404` | `not-found` | no connection with that id **in this scope** |
| `422` | `not-an-image-endpoint` | a picture, on a connection that does not say it makes them |
| `422` | `window-too-small` | a message, on a connection whose context window cannot hold it beside its reply |
| `502` | `busy` | the endpoint rate-limited or failed on its side (a `retryable` class) — for a message, through every retry |
| `502` | `offline` | nothing answered, the endpoint is remote, and this machine has no route out |
| `502` | `unreachable` | nothing answered, otherwise |
| `502` | `refused` | the endpoint answered and refused the request — most often a model it does not serve |
| `504` | `timeout` | `providerTimeoutMs` passed without an answer, or the transport gave up on a quiet endpoint first |

**The timeout is decided first**, because an aborted request looks `transient`
from its message alone and would otherwise read as *unreachable* about an
endpoint that was merely slow — and it is decided from the stall, whoever
noticed it: this server's clock, or the HTTP client's own header and body
limits, which give up beneath it. Then the endpoint's status, because a refused key
and a refused request are both `terminal` and point at opposite fields of the
form. Every refusal is a class and a fixed sentence and **never the endpoint's
own words**; those go to the log, as a `connection.tested` event, with the key
redacted out of them. The log line never carries the prompt, the reply or the
address.

**It costs money, so it is a button and never automatic**
([10 §11.5](design/10-ui-surfaces.md)). **And a test that returns is recorded**,
as [10 §11.4](design/10-ui-surfaces.md) asks of every model call that is not a
turn: one line in the usage log of the account that pressed it
(`users/<handle>/usage.jsonl`, [22 §1.4](design/22-internal-contracts.md)) —
an admin's own for the install's connections — with the purpose
`connection-test:text` or `connection-test:image` and the role
`connection-test`, which no binding can have, because a test resolves no role.
A picture's line has `usage: null`. A test that failed or was cancelled writes
nothing.

**The personal twin** is the same route with one substitution: it resolves ids
among the caller's own connections only, so an id that exists in the system
scope or in somebody else's directory is `404`, and without `privateConnections`
it is `403 forbidden` before anything is read. It can only reach a URL the
caller already saved, so what it adds is the timing, not the reach. Both resolve
a duplicated id to the file that wins, which is the one a turn would use.

### `GET /api/admin/bindings` · `PUT /api/admin/bindings`

```json
{
  "bindings": { "prose": { "connectionId": "0199…", "modelId": "gpt-hi" } },
  "contentHash": "sha256:…"
}
```

The install defaults, layered under every account's own
([20 §5.1](design/20-tech-stack.md)). A whole document rather than a patch per
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

**Two bindings in, a whole document out** — [20 §5.1]'s *a good one and a cheap
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
([22 §1.4](design/22-internal-contracts.md) specifies no such field), and
returned by nothing before this. A surface showing it would have had to
reimplement [20 §5.1]'s layering in the browser, against two binding maps it
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

**`507 {"error":"no-space"}` when the disk has no room for it**, whether the
free-space check refused it before writing or the disk filled while it was
written (`ENOSPC`). A state of the disk rather than a fault of the server, and a
class the client has a sentence for — it used to be the error handler's bare
`500`. The admin half (`POST /api/admin/backups`) answers the same.

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
own subtree — and for `options.config` on an account's archive, before anything
is read or written. `422` for an archive that will not read, that does not hold
the handle asked for, or (`too-large`) that holds more of that account than an
import reads in one go. ***Only the members an import reads count against those
bounds*** (2026-09-27): the account's library objects and their `assets/`, its
tags, prefs and connections, and each session's file, turns, rendition records
and pictures. Another account's work, the operational store and every object's
history used to count as well, and an ordinary account was refused as unreadable.

***What "already here" means for a session*** (2026-09-27). A session is skipped,
under every `onConflict`, when this account has it under its own id, when it is
in this account's trash, or when its turns are already on this install, which is
what an earlier import of the same archive leaves. Before, nothing was asked,
and each import of a person's own backup added another copy of every session. An
imported session's turns name the session they landed in, it is indexed and
searchable, and its pictures arrive with their records: pixels and all, since a
backup holds them, and a picture that was still being made as `interrupted`,
with a retry. The pictures a player attached to moves come too, each stored
under the digest of the bytes the archive holds
([26 E15](design/26-open-questions.md)).

**A tag whose name is already here under another id keeps the one here.** An
object brought in with the archive's id for it still reads that name, because a
dangling id falls back to the name beside it ([05 §3](design/05-tagging.md)),
and adopting tags again points it at this registry's. The merge used to throw at
that clash after the library had been written, so the sessions never came.

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

***And `server.host`, `server.port`, `server.cookieSecure` and
`server.trustProxy`*** (2026-09-27): where the other machine listened and what
stood in front of it. A laptop's loopback address imported into a container
outranked `SE_HOST` at the next start and bound the container's own loopback.
The keys the archive carried and this install kept are named in an
`import.backup.configWithheld` note, which is what *by name* promised and did
not do before.

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
remove is a trap on exactly the install this feature exists for: [26 E6]'s
operator has a shell, and `docs/deploy.md`'s household one has a web page and
nothing else.

**What happens on the next boot**, for an accepted restore: before anything
opens a handle on the data directory, the archive is unpacked to
`<dataRoot>/.restore/<id>/staging`, a journal is written to
`<dataRoot>/.restore/swap.json`, and the swap moves the install's entries into
`.restore/<id>/replaced` and the archive's into their places, one at a time.
`backups/` never moves, and each person's own archives are carried across.
~~The archive is unpacked to a **sibling** directory and the live directory
renamed aside~~ (corrected 2026-09-27): that needs to write in the data
directory's parent, which no shipped deployment allows. See
`packages/server/src/backup/swap.ts`.

***The replaced install is kept and never deleted***, on `removed/`'s
precedent — *StoryEngine will not delete this; remove it yourself when you are
sure*. That is the undo, and the only property that covers *the restore worked
and was the wrong archive*. A `system.notice` names it on that boot, which is
the one place in this build where a filesystem path is deliberately put in
front of a person.

**A failed restore leaves the install as it was.** Everything is written before
anything moves; a move that fails part way is moved back; a boot that died part
way finishes the swap from the journal. The marker is rewritten with
`attempts: 1`, and the server boots normally. **A second attempt is refused
rather than made**: a supervisor restarts a process that exits, so an unpack
that kept failing would take the install down rather than one boot. *If a move
fails and moving it back fails too*, the server refuses to start, naming both
halves, and tries to finish again on each start.

**One restore at a time.** A request while another is being prepared, or while
the server is draining for one, is refused with `409 already-restarting` before
anything is written, and so is `POST /api/admin/restart` while a restore is
being prepared. A second request used to overwrite the first one's marker and
then delete it.

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
| 413 | `too-large` | The preference document would exceed its size cap, an upload exceeds `limits.maxUploadMb`, or it exceeds a route's own fixed cap — an avatar's, or a picture on a move's (8 MB) |
| 415 | `not-multipart` | An upload that was not `multipart/form-data` |
| 403 | `no-file-access` | A sweep from an account without the `fileAccess` capability |
| 422 | `inside-data-root` / `not-absolute` / `unreadable-root` | A sweep root this build will not read |
| 422 | `live-install` / `unknown-format` / `ambiguous-root` | A source folder refused before anything was written |
| 507 | `no-space` | An import that reads from a private copy of somebody's database — an Aventuras folder, by path, upload or archive — with no room on the disk for the copy. The message carries the numbers |
| 400 | `no-file` | A multipart upload with no file part |
| 412 | `stale` | Hash mismatch — `current` holds the object as it is now. **A 412 always carries a hash different from the one you sent**; if it did not, reload-and-reapply could not terminate, which is exactly what `diverged` below exists to stop happening |
| 409 | `diverged` | The file on disk cannot be read as an object of its kind — it will not parse, names another kind or no id, or fails its schema — and the index still holds the last good version: a hand edit that broke the file. **Not a retry**: nothing about the request is wrong, so reloading returns the same hash. Repair the file, or `DELETE` the object, which works in this state on purpose |
| 422 | `refused-path` | The object's folder name is one this build will not open — `con`, a trailing space. The message names the reason and the segment, never a filesystem path |
| 428 | `hash-required` | A write with no content hash |
| 404 | `no-such-parent` | A turn submission named a `parentTurnId` that is not a turn of this session. The request is well formed and names something that is not there, which is why it is a 404 rather than a 422 |
| 422 | `unknown-input-kind` | A turn submission whose `input.kind` is not one this session's mode declares ([06 §1], [P7.9]). Carries `accepted`, the mode's list. **A refusal rather than a coercion to `do`**, because the kinds change what the prompt says — narrating a `think` as a `do` would put the player's private thought in the scene, which is the one failure the kind exists to prevent |
| 404 | `no-session` / `no-such-hook` / `no-such-object` | Promoting a pooled hook out of a session ([03 §4.1]): the session is gone, this pool has no hook with that id, or the library object being promoted to has been deleted. **Three answers rather than one**, because they send a person to three different places and the union of them helps nobody |
| 409 | `already-there` | The promotion target already carries a hook with this id. **Never a second copy and never a fresh id** — [15 §5](design/15-world.md) makes the id the only thing that links two firings of one hook across sessions, so re-minting it is the move that cannot be undone |
| 404 | `no-such-channel` | A channel write to a key this session's mode does not enable ([06 §4.1], [P7.9]). The registry is process-wide and a session is not: a channel owned by a *mode* belongs to a session playing it, and one owned by a *package* — cast, hooks, goals, lore, suggestions — is available everywhere. *Package* here is a first-party engine namespace (`storyengine.cast` and its siblings), never the library kind, which ~~becomes~~ is a World since [P16.0](design/workplan/35-p16-world.md) ([06 §4.1] separates the two, 2026-10-04). **A 404 rather than a 422**, because *that exists but not for you* would leak which modes the build ships from a session route |
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

~~**One half of it is still deferred, deliberately**, so it is named here rather
than left to be discovered: there is **no route that writes a user's own
connection or their own `bindings.json`.**~~ P2B writes the system scope and only
the system scope ([P2B §2.7](design/workplan/10-p2b-provider-configuration.md)),
and [10 §15.1](design/10-ui-surfaces.md)'s *your connections* half ~~waits with the
rest of the user surface~~ is the user surface's. Both files are read by the
resolver and hand-written by anyone who wants one, exactly as before. *(2026-10-03:
the deferral ended in two halves — [`PUT /api/me/bindings`](#get-apimeroles--put-apimebindings--put-apimetask-roles)
has written your own `bindings.json` since `201cef3b`, P7.3, 2026-09-12, and since
`15043532`, P10.3, 2026-09-16,
[`/api/me/connections`](#get--post-apimeconnections--put--delete-apimeconnectionsid--post-apimeconnectionsmodels)
writes your own connections. This paragraph went on saying neither existed.)*
