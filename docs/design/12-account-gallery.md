# 15 — The account gallery, and the choice of front door

**Status: proposal.** An alternative arrival screen in the SillyTavern style:
a gallery of avatar tiles, one per account, where clicking a face asks for
that account's password. It is opt-in per install, opt-out per account, and it
changes nothing about how anyone authenticates. This note is the design; the
build is P10's (§8). It reads beside [04](04-server-multiuser-deployment.md)
and [05](05-ui-surfaces.md) in the index's "The design" group, and carries the
number 15 only because 00–14 were taken when it was written —
[14](14-roadmap.md) remains the end of the design side in the sense the README
means, and this note hands off to the work plan like any other.

> **Exposure is an explicit act, twice.** The install shows a gallery because
> an admin chose to; an account appears on it because nobody chose otherwise —
> and either choice is reversible without locking anyone out, because typing a
> handle always works.

## 1. Two front doors, one key

**The pre-auth client renders one of two arrival screens, and `config.json`
decides which.** The by-name form that exists today stays exactly what it is,
and stays the default. The gallery is a second front door, and the choice
between them is the install's — made once, by an admin — not negotiated per
browser. An arrival screen chosen by the visitor would defeat the point of an
install having chosen one at all.

### 1.1 `auth.loginScreen`

`auth.loginScreen: "form" | "gallery"`, default `"form"`, tier `live`. It
sits beside `auth.minPasswordLength` and works the same way: read per request
in the `/auth/state` handler off the live config, so flipping it takes effect
on the next arrival with no restart. The union type does quiet work — the
admin config form renders string-literal unions as selects from the server's
own schema, so the control ships with the key and there is no client change
to forget: the configuration-ships-with-its-surface rule
([P2A](workplan/13-p2a-configuration-surface.md)) satisfied by construction.

**The default is `"form"` because exposure is an explicit act.** The
precedent is the bind address ([04 §5.1](04-server-multiuser-deployment.md)):
the server listens on loopback until someone deliberately opens it up,
because a disclosure should be a decision with a person attached. The same
reasoning lands harder here, since §3 is about to concede that the gallery
discloses something. A fresh install, and every existing install, shows
exactly the screen it shows today and keeps the unauthenticated surface it
has today, until an admin picks the other door.

The key's row in [13 §4](13-internal-contracts.md)'s table, its tier entry
and its applier land with the build, per the precedent of every key before
it; until then this note owns the name.

### 1.2 What `GET /api/auth/state` grows

One required field: `loginScreen: "form" | "gallery"`. That route is the one
place the pre-auth client learns anything, and this is the same kind of fact
as `minPasswordLength` — configuration a screen needs before anybody types,
not a secret. The handler's own comment already carries the argument: the
same response *"says whether this install is unclaimed, which is the more
sensitive fact by some distance."* Which door is open is a smaller fact than
whether the house has an owner.

## 2. The gallery surface

**A Quiet surface: faces, names, and nothing else.**
[05 §1.1](05-ui-surfaces.md) splits the surfaces into dense tooling and quiet
arrival, and [06 E10](06-open-questions.md) already placed sign-in on the
quiet side — a Quiet surface that must be styled before anyone has
authenticated. The gallery is that screen with the typing removed: a grid of
avatar tiles, each with the account's display name beneath it, centred in the
same calm the form occupies today. No counts, no roles, no last-seen, no
administrative anything. Aesthetically it is a gallery of people, not a user
table — the tile *is* the avatar, and the name is a caption rather than a
row.

**It lives where the form lives: in the gate, not the router.** The pre-auth
screens are deliberately outside the router, which mounts signed-in surfaces
only; the gallery joins the login and setup forms as a third gate screen,
chosen by `loginScreen`, with the gallery/by-name switch as local state
exactly the way setup and login swap today. It is also the client's first
tile grid — there is no grid layout anywhere in the client yet — and the
pattern lands in the appearance layer's terms ([05 §1.2](05-ui-surfaces.md)):
semantic tokens, the look in `ui/`, no `dark:` variants, rather than a
one-off.

**Clicking a tile asks for a password; it never edits a handle.** The tile
opens password entry for that account — the face and name held, the handle
fixed, one password field and a submit. Wanting to type a different name is
what the by-name link is for, and the distinction is worth keeping sharp: a
tile is *this person signs in*; the link is *someone else does*. What the
click submits is the unchanged `POST /api/auth/login`, and §3 leans on that.

**The by-name clickthrough is unconditional.** *Sign in by name*, a plain
link on the gallery, leading to today's form — always present, styled as an
aside rather than as a tile, and conditional on nothing: not the flag, not
the config, not whether the listing succeeded. This is the lockout invariant
that makes hiding safe: an account hidden from the gallery — or every account
hidden at once — has lost a shortcut, not a door. It is also why the
last-admin guard needs no fourth gesture: hiding is not disable, demote or
remove, and an admin hidden from every gallery still signs in the way they
did before the gallery existed.

**The edges all fall back to the form, because the form cannot be wrong.**

- Zero listed accounts — everyone hidden, or everyone disabled — renders the
  by-name form. An empty gallery is a front door with no handles.
- A failed listing fetch renders the by-name form. Arrival never dead-ends
  on a degraded install.
- `setupRequired` wins over everything, as it already does in the gate. The
  gallery is not consulted on an unclaimed install.
- A disabled account is never listed, flag or no flag. A tile that can only
  answer 401 is a lie in the one place built to be welcoming.

## 3. What the gallery discloses, and to whom

**This reverses a written position, and says so.** The login route's contract
is explicit — *"One answer for a wrong password, an unknown handle and a
disabled account. The caller cannot tell which, which costs nothing here and
avoids a handle oracle"* (`docs/api.md`, and the same words sit on the
authenticate method itself). A gallery is a handle oracle by construction: it
exists to show who lives here. Being precise about the reversal's size: on an
install whose admin chose `"gallery"`, the handles, display names and avatars
of listed, enabled accounts are readable by anyone who can reach the port,
before authentication.

**On this threat model, that is the doorbell nameplate, not the keys.**
[04 §4.1](04-server-multiuser-deployment.md) frames multi-user as access
separation among people who already trust each other, on a network they
control; [00 §4](00-stance.md) says plainly that this is not a security
product. The people who can reach the port on the intended deployment are the
household, and the household already knows who lives there — SillyTavern has
shipped this screen to the same audience for years without it being the thing
anyone regrets. What would be regretted is the failure mode 04 already names:
the port-forwarded install. An admin who exposes a gallery-mode install to
the internet has published their household's names and faces to it. That is
the same person [04 §4.1](04-server-multiuser-deployment.md) already worries
about, and the same answer applies — the default, and the warning at the
moment of binding, not a mechanism this product has forsworn.

**The mitigations are layered, and each one is somebody's explicit act.**

- The install-level default is `"form"` (§1.1): no install discloses
  anything new until an admin decides it should.
- The account-level flag (§4): one person can object without the install
  changing its mind for everyone.
- The authentication oracle never opens: `POST /api/auth/login` keeps its
  one answer, from either door. The gallery names accounts; it never
  confirms a guess about one it did not name, and a probe against the login
  route learns exactly what it learns today, which is nothing.

**And one structural rule: the disclosure surface is the listing, alone.**
The avatar route (§5.3) answers only for accounts the listing would name, and
only in gallery mode — so the disclosure is one route family behind one
config value, not a probe target that exists on every install because a
feature elsewhere wanted an image.

## 4. One flag on the account, and it is presentation

**`hiddenFromGallery`, optional, and absent means listed.** The polarity is
chosen so absence is correct by construction: every account written before
the field existed is a listed account, and the filter that builds the gallery
— keep `enabled`, drop `hiddenFromGallery` — does the right thing to a record
that has never heard of the flag, with no default machinery to forget. The
positive spelling (`listedInGallery`, default true) fails exactly there: the
first reader that forgets the default hides every account created before the
feature shipped. Only objectors carry the field, which also keeps
`accounts.json` what its store says it is — *"a plain document somebody can
read"* — where a field's presence marks a choice somebody made.

**The build constraint, stated here so it is not rediscovered:** the field is
optional in the schema with the default applied in code. Account validation
runs with `useDefaults` off, every current field is required, and the
accounts store refuses to start on a file that fails validation — it is the
one store that blocks rather than degrades, deliberately. A required field
would brick every existing install on upgrade.

**It is not a fourth capability.** Capabilities are what an account *may
do*, enumerated so an admin can be shown each one with its consequence
([04 §4.2.1](04-server-multiuser-deployment.md)), and
[05 §15.4](05-ui-surfaces.md)'s rule guards the enumeration: if the surface
starts to want a matrix, the model is right and the matrix is wrong.
`hiddenFromGallery` grants nothing and withholds nothing — the account signs
in identically either way. It is kin to `displayName`: a fact about how the
account is *shown*, not about what it can do.

**It lives on `Account` because the server reads it before anyone is signed
in.** [05 §15.1](05-ui-surfaces.md) already draws this line for the theme:
what only your own browser reads goes in `prefs.json`; what other people and
the server read is an `Account` field. The gallery is built by the server for
a reader who is nobody yet — there is no session to have preferences — so the
flag sits beside `displayName` and `enabled`, and reaches signed-in clients
only when `toPublic` is taught to pick it, which is that function's whole
design working as intended.

**Both the person and the admin can set it.** The account holder toggles
their own visibility — it is a privacy preference about their own face — in
[05 §15.1](05-ui-surfaces.md)'s *You* form, as *Shown on the sign-in screen*
with the consequence written beside it. `updateSelf` grows the field, which
is the deliberate act its shape demands: that method rebuilds its patch
field by field precisely so a widening is a decision, and this is one.
Admins get the same toggle on the account list
([05 §15.2](05-ui-surfaces.md)), where the rule is already that a control
carries its consequence — and where, on an install whose `loginScreen` is
`"form"`, the toggle says it currently changes nothing, the same honesty
`fileAccess` and `enableExtensions` practise about gating features that have
not shipped.

## 5. Account avatars

The gallery's whole aesthetic claim is faces, and accounts have no image
today. This section adds one.

### 5.1 Where the bytes live

**`data/users/<handle>/avatar.<ext>` — inside the user's own directory.**
`accounts.json` sits *outside* every user directory for a stated reason: it
holds password hashes, and a future file browser over a user's directory must
never be able to serve a secret ([P1 §1.3](workplan/03-p1-implementation.md)).
An avatar is that reasoning's mirror image — user-authored, not secret, and
uploaded specifically to be shown — so it belongs with the user's other
authored things, where the file browser's own rule is that what the user
authored is exactly what it may expose ([05 §4.2](05-ui-surfaces.md)).

The clinching argument is removal. Removing an account moves the user's whole
directory to `data/removed/<handle>-<uuid>` before the record goes, and that
promise — nothing deletes it but a person — should cover the face along with
the library. In the user's directory, the avatar leaves the gallery in the
same gesture that removes the account, with zero new code; in a system-side
store it would be a second account-adjacent orphan needing its own sweep. The
build adds a `Layout` accessor beside the prefs file and nothing else.

### 5.2 Uploading one, which is the server's first upload

**Self-service only: `POST /api/me/avatar`.** The face is the account
holder's to set, the way the display name is; admins get the hide flag, not
somebody else's portrait. And this is — worth saying plainly — the first
upload route in the server. There is no multipart handling anywhere today,
and `limits.maxUploadMb` has never been read. The route brings three
obligations with it:

- **Sniff the bytes, never trust the extension** — the rule
  [05 §4.4](05-ui-surfaces.md) already states for the file browser. PNG,
  JPEG and WebP by sniffed type, stored as received with the type recorded.
  The server has no raster re-encoder and should not grow one for this;
  contrast the actor card, which is PNG-only because the card *is* the
  object ([02 §5.2](02-data-model.md)) — a constraint with no purchase here.
- **Bound the size** by `limits.maxUploadMb` — its first honest reader —
  plus a fixed sanity cap in the handler, because an avatar that large is a
  mistake whatever the config says. No new config key: nobody tunes avatar
  sizes, and not everything is a setting.
- **Replace atomically**, like every other write.

### 5.3 Serving one, unauthenticated, and the cache story

**`GET /api/auth/gallery/:handle/avatar`.** Nested under the gallery contract
so the scoping is structural rather than remembered: it answers only in
gallery mode, only for accounts the listing (§6) would name, and 404
otherwise — §3's one-route-family rule made concrete. The cache story is the
actor avatar's, copied: `ETag` of the content hash, cache-busted by the
version token the listing carries, so a changed face is a changed URL and an
unchanged one is a 304.

### 5.4 The tile nobody uploaded

**Accounts without an avatar get a generated tile, rendered client-side.**
Deterministic and cheap: initials taken from the display name, since that is
the name on the tile; hue from a hash of the handle, since the handle is
immutable and a rename should not change anybody's colour. An SVG the client
draws — no bytes stored, no server involvement, no upload required, and every
account has a face from the day the feature ships. An uploaded image is an
override, not a requirement.

### 5.5 Removal

Nothing to design. §5.1 put the avatar where removal already operates, and
that is the argument for §5.1.

## 6. The listing contract

**One new unauthenticated route: `GET /api/auth/gallery`.** It returns the
gallery and nothing else:

```ts
interface GalleryEntry {
  handle: string
  displayName: string
  avatar: string | null // content-hash token; null → the client draws §5.4
}
```

**Its own projection, never `PublicAccount`.** `toPublic` is built by picking
rather than omitting, on the argument that the fields most likely to be added
are the ones that must not leak — and it is still too wide for this socket:
`PublicAccount` carries `role`, `enabled`, `capabilities`, `locale` and
`createdAt`, none of which belongs in front of an unauthenticated caller. The
gallery projection is a second, narrower picking function with the same
property: a field added to `Account` reaches the gallery only when a line of
code picks it, and a test holds the projection to exactly these three.

**Filter: enabled and not hidden. Nothing else.**

**Order: file order**, which is creation order, the convention the storage
model already keeps ([02 §5.5](02-data-model.md)) — deterministic, stable
under display-name changes, and free of collation. Alphabetical order would
have to pick a locale's collation rules for a response addressed to nobody in
particular, which is a decision this feature has no business making.

**It does not join the setup gate's allowlist.** Before first-run the client
renders the setup form before it would ever ask for a gallery, and the
pre-setup surface is a claim window
([04 §5.1](04-server-multiuser-deployment.md)) kept deliberately small — two
routes. This note declines to widen it. And when `loginScreen` is `"form"`,
the family answers 404: a default install's unauthenticated surface is
byte-for-byte what it is today, which is the sentence §1.1's default exists
to make true.

## 7. Deferred: the live filter, and what it does to the clickthrough

**A type-to-filter box over the tiles is deferred, and its home is the
polish list ([polish §7](workplan/09-polish.md)).** The account store's own
comment sets the scale: *"a household has single-digit accounts."* A filter
over six tiles is chrome, and it earns its place when tile count defeats
scanning — which is observable on a real install rather than predictable from
here. It clears the polish bar exactly: it changes what a user sees, it is
bounded, and it needs no schema change and no new contract, because the
listing already carries everything a client-side filter needs. It is
deliberately not a [14 §3](14-roadmap.md) row — that table's bar is a feature
deferred past 1.0 that is additive to the data model, and this is neither.

**When it lands, the by-name clickthrough may fold into it.** A filter box is
a text entry; a typed handle that matches no tile is the by-name case; at
that point the separate link can retire and the gallery has one text
affordance instead of two. Until then the link stays, because an inline text
box is exactly the pollution the gallery exists to avoid — the screen is a
gallery of faces, and it gets to keep being one until the face count itself
argues otherwise.

## 8. When it gets built

**P10 owns the build**, by argument rather than by default: P10 — multi-user,
notifications, deployment — already owns the rest of the arrival story (the
loopback bind and its container inversion, the setup token, mDNS) and the
remainder of [05 §15](05-ui-surfaces.md), which is where both toggles land.
The gallery is deployment-facing work on the same front door. P3, in flight,
does not touch auth; P2A, which built the account surfaces the toggles
extend, is closed. Recording the owner here rather than leaving the feature
described and unowned is the lesson
[work plan §2.3](workplan/01-work-plan.md) exists to teach.

What the build obliges, so P10's planning is not surprised:

- `auth.loginScreen` end to end: the schema entry, tier row and applier the
  config tests enforce, the [13 §4](13-internal-contracts.md) table row, and
  the select the admin config form derives from the union.
- `hiddenFromGallery` end to end: the optional field, `toPublic`,
  `updateSelf` and `update`, the client's hand-written account types, and
  both settings toggles with their consequence sentences.
- `GET /api/auth/state` growing `loginScreen`.
- The gallery route family (§5.3, §6) — including the server's first upload
  route, with the multipart, sniffing and size-bound obligations §5.2 names.
- The client's first tile grid, in the appearance layer's terms, plus the
  generated tile (§5.4).
- Whole sentences for every new user-facing string, as everywhere.

The tests that keep it honest, named now:

- **The projection picks, and picking is the test.** A field added to
  `Account` does not appear in a `GalleryEntry` until a line picks it — the
  `toPublic` property, asserted again on the narrower shape.
- **A hidden account still signs in by handle.** §2's lockout invariant as
  an integration test rather than a sentence.
- **In form mode, the unauthenticated surface is unchanged.** The
  route-enumeration pattern the admin-guard tests already use, extended: the
  gallery family is the only unauthenticated addition, and it answers only
  in gallery mode.

## 9. What this is not

- **Not self-registration.**
  [04 §4.2](04-server-multiuser-deployment.md) stands: the gallery shows
  accounts, it does not mint them, and there is no *new account* tile.
- **Not roles.** Nothing here moves
  [04 §4.2.1](04-server-multiuser-deployment.md). The flag is presentation
  (§4), and the answer to "can we hide accounts from *some* viewers" is that
  the question describes a permission matrix, and
  [05 §15.4](05-ui-surfaces.md) already answered it.
- **Not passwordless entry.** SillyTavern lets a passwordless user click
  straight through their tile. StoryEngine refuses this even though
  effectively-passwordless accounts exist — `auth.minPasswordLength: 0`
  makes the empty string a password, and `--reset-password` honours no
  minimum anywhere. A tile always leads to password entry; an empty password
  is typed as empty and submitted, the posture the login form already takes
  by not requiring the field. The tile changes what you see, never what
  authenticates you: `POST /api/auth/login` is byte-for-byte the same
  contract from either door, which is what keeps §3's reversal narrow.
- **Not multi-tenant hardening.**
  [04 §4.2.2](04-server-multiuser-deployment.md)'s decision rule applies
  unchanged. A gallery with real access control between viewers is a hosted
  product's feature, and this is not a hosted product.
