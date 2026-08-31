# 21 — P10 implementation plan

**Status: skeleton.** Drafted 2026-08-29 alongside
[P7](18-p7-implementation.md), [P8](19-p8-implementation.md),
[P9](20-p9-implementation.md) and [P11](22-p11-implementation.md); to be
revisited before the phase starts. [18 §0](18-p7-implementation.md) says what a
skeleton this far out is for. Format follows [03](03-p1-implementation.md);
citation convention as [P4](06-p4-implementation.md)'s.

**P10 delivers**, from [01 P10](01-work-plan.md), what is left of multi-user,
notifications and deployment after three earlier phases took the parts that
could not wait: the remainder of [05 §15](../05-ui-surfaces.md) — the extensions
panel, *Restart now*, connectivity state, the notification preference rows — plus
the notification router and its two 1.0 delivery channels, the loopback bind and
its container inversion, the setup token's **check**, mDNS, the account gallery
([15](../15-account-gallery.md)), the About surface and the AGPL §13 source link.

**The demo that defines done:** *two people on one household server, each
notified only about their own turns; a fresh container that comes up reachable,
prints a setup token to `docker logs` and gates every route until an admin
exists; and a sign-in screen showing a gallery of faces rather than a text
field.*

**The spine, because a remainder phase does not have one by default.** Accounts,
login and first-run went to P1; account management and capability enforcement
went to [P2A](13-p2a-configuration-surface.md); system connections and bindings
went to [P2B](14-p2b-provider-configuration.md). What is left is not a subsystem
and will read as a list unless it is given a test. The test:

> **This is the phase that makes the install reachable, and safe, for someone
> who is not the developer.**

Anything here that does not sit on that line should be checked against
[P11](22-p11-implementation.md) before it is built, and anything found elsewhere
that does sit on it belongs here.

**CI this phase establishes:** the route-enumeration assertion extended —
[15 §8](../15-account-gallery.md) already specifies it — *the gallery family is
the only unauthenticated addition, and it answers only in gallery mode*; the
projection test, *a field added to `Account` does not appear in a `GalleryEntry`
until a line picks it*; and the notification routing test that matters on a
household server, *user A's turn never produces an event addressed to user B*.

---

## 1. Decisions this plan has to make

### 1.1 The setup token: the check, not the print

[04 §5.1](../04-server-multiuser-deployment.md) records this precisely, and the
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

### 1.2 The container inverts the bind default, and that is not a hidden build flag

[04 §5.3](../04-server-multiuser-deployment.md): `127.0.0.1` inside a container
is the *container's* loopback, so an image shipping
[§5.1](../04-server-multiuser-deployment.md)'s default would appear completely
dead on first run. The image binds `0.0.0.0`, the port mapping becomes the user's
explicit act, and §1.1's token covers the rest.

**It must be one documented environment variable rather than a build
difference**, so a bare-metal user can opt into the same behaviour and a
container user can tighten it. A hidden difference between artifacts is a
support burden shaped like a security feature.

### 1.3 The router is server-side, and 1.0 has no presence signal

[04 §3.1](../04-server-multiuser-deployment.md) is unambiguous about the part
that must not be got wrong: **if the client decides what to notify about,
notifications only work while a client is connected**, which fails the case that
motivated the feature. The server knows who should be told and through which
channel; the client renders the in-app part.

The wrinkle this phase inherits: the routing signal the design names — per-user
presence, Active/Idle/DND/Invisible — **arrives with Messages, which is now
unscheduled** ([14 §3.4](../14-roadmap.md)). So 1.0
routes on what it has: connection state, and whether the connected client is
viewing the session in question. Write it as a presence *input* with one
implementation rather than as a connection check, so real presence substitutes
rather than rewrites whenever it lands. **That is now an open-ended wait rather
than a one-release one**, which makes the substitutable shape more important, not
less — [01 §0.3](01-work-plan.md) records the cost of a seam with no date.

### 1.4 Every class either has a producer or is not shipped

[04 §3.5](../04-server-multiuser-deployment.md) lists five 1.0 classes.
`turn.complete`, `turn.failed` and `system.notice` have producers today;
`artifact.ready` gets one at [P9](20-p9-implementation.md);
`turn.awaiting-input` has one only if [06 C5](../06-open-questions.md)'s
suspending step exists, which [P3 §1.6](05-p3-implementation.md) notes arrives
early in a different shape — *park, publish, resume-on-intent* — and warns that
the obvious name is already taken, since `Turn.status: 'suspended'` means a turn
that will resume.

**Decide per class, and say so in the preference rows.** A preference row for a
class nothing emits is [01 §2.3](01-work-plan.md)'s failure inverted: a surface
for configuration that has no producer.

### 1.5 The extensions panel needs installation, and nothing installs

[05 §15.5](../05-ui-surfaces.md) names the blocker plainly. The manifest and the
lifecycle are specified ([12 §6–§7](../12-extensions.md)) and
[P7](18-p7-implementation.md) builds the boundary they run behind, but no
document owns *acquiring and enabling an extension on an install*.

**To decide at the revisit:** whether P10 builds installation — and therefore
the panel — or the panel stays deferred with its blocker named and an owner
attached. Building the panel over a stub is the one option to refuse: a screen
that lists nothing and installs nothing is exactly the false front
[05 §15.5](../05-ui-surfaces.md) uses capability granting to illustrate.

*And note the standing `[OPEN]` it drags along*
([04 §6.4](../04-server-multiuser-deployment.md)): whether install and uninstall
can avoid a full restart. In-process ESM makes true unloading hard, so
*restart required* is the honest 1.0 answer — which puts §1.6 on the critical
path for the panel rather than beside it.

### 1.6 *Restart now* is honest or it is a trap

[04 §6.4](../04-server-multiuser-deployment.md), and both halves are the
decision. **It only works under a supervisor** — Docker with
`restart: unless-stopped`, systemd, unraid — and under a bare `node server.js`
the admin who clicked it has no server and possibly no shell. So detect
supervision and **disable the control with an explanation** where it is absent.
And **drain**: refuse new turns, wait for in-flight ones within a timeout, then
exit, with the confirmation naming what it is about to interrupt — *"2 other
users have active sessions."*

### 1.7 Connectivity state ships with its producer, or it ships dark

[05 §15.5](../05-ui-surfaces.md) lists connectivity state as remaining at P10 and
names its producer as [P11](22-p11-implementation.md)'s update check;
[P2B §6](14-p2b-provider-configuration.md) records the same dependency from the
other side. **Two phases, one signal, in the wrong order.**

The revisit has to pick one: move the update check into P10 (it is small, and
[04 §6.5](../04-server-multiuser-deployment.md) already argues the signal is free
because the request is being made anyway), or ship the surface reading a source
that is always *unknown* and let P11 light it up. **Lean: move the check.** The
alternative ships a panel that cannot be tested by looking at it, which is the
class of thing this repository has already been burned by twice.

### 1.8 §15.3's system-library bullet has no owner, and that is a defect to close

[05 §15.5](../05-ui-surfaces.md) says so in its own voice: the scope is
never-writable, [04 §4.3](../04-server-multiuser-deployment.md) withholds admin
write at 1.0 deliberately, and [05 §15.4](../05-ui-surfaces.md) says a panel with
no action does not belong. **Either the bullet goes or 1.0's position on admin
write changes**, and this phase is where it stops sitting there looking
scheduled. It is a documentation edit, not a build, and it belongs in the plan
so it does not get built by accident.

### 1.9 The gallery's obligations are enumerated; take them as written

[15 §8](../15-account-gallery.md) lists what the build owes — `auth.loginScreen`
end to end with its schema entry, tier row, applier and derived select;
`hiddenFromGallery` through `toPublic`, `updateSelf` and `update` and both
settings toggles; `GET /api/auth/state` growing `loginScreen`; the route family
including **the server's first upload route** with its multipart, sniffing and
size bounds; the client's first tile grid and the generated tile. It also names
the three tests that keep it honest. That section was written to be read at the
build rather than re-derived, and the only thing this plan adds is: the
type-to-filter escalation is [polish §7](09-polish.md)'s, is blocked on the
gallery existing, and should be built as the **one** text affordance that
subsumes *sign in by name* rather than as a second box beside it.

---

## 2. Stages

Reachability first — the phase's spine — then the things that make a second
person's experience correct, then arrival.

### P10.0 — Reachable and safe: bind, container, token, mDNS

§1.1's stored-and-checked token; §1.2's single documented environment variable
and the image that uses it; first-run setup gating every route until an admin
exists, verified from a non-loopback bind; mDNS advertising `storyengine.local`
once bound beyond loopback. Cookie `secure`/`trustProxy` hardening,
deferred at [P2 §2.11](04-p2-implementation.md) with the loopback default cited
as what made the deferral safe — and it stops being safe in this stage, which
is why it lands in it.

*Ends at:* `docker run`, a token in `docker logs`, an admin created, a turn
taken — from a machine that is not the host.

### P10.1 — The notification router

§1.3's server-side routing with a substitutable presence input; §1.4's
producer-by-producer class decision; the dedupe key and coalescing window from
[04 §3.4](../04-server-multiuser-deployment.md) — *five characters replying in a
group chat is one notification, not five*, trivial to design in and unpleasant to
add once producers exist; per-user scoping by ownership, which
[04 §4.3](../04-server-multiuser-deployment.md) already answers.

### P10.2 — The two delivery channels 1.0 gets

In-app — sound, toast, unread badge, document title — which covers the
completion-sound case entirely and needs no infrastructure; and the browser
Notification API, which works when the tab is backgrounded. Together they cover
everything 1.0 generates, because without Messages nothing needs to reach you
when no browser is open.

*And the secure-context caveat is documentation, not code*
([04 §3.6](../04-server-multiuser-deployment.md)): plain LAN HTTP is not a secure
context, and channel 2's availability therefore depends on how the install is
reached. Say it where someone will read it.

### P10.3 — The remainder of [05 §15](../05-ui-surfaces.md)

The notification preference rows, one per shipped class; §1.6's *Restart now*
with supervisor detection and drain; §1.7's connectivity state; §1.5's
extensions panel or its named deferral; §1.8's bullet closed one way or the
other.

### P10.4 — The account gallery

§1.9, as [15 §8](../15-account-gallery.md) specifies it, including the
unauthenticated listing contract and the three tests. The one judgement this
plan adds: the gallery is **not** self-registration and has no *new account*
tile ([15 §9](../15-account-gallery.md)) — worth restating in the stage because
a grid of accounts is a shape that invites the extra tile.

### P10.5 — About, the source link, and the embedded version

[04 §7](../04-server-multiuser-deployment.md)'s licence obligations that are
actually features: the running version and commit embedded in the build — **no
build embeds one today**, which [04 §6.5](../04-server-multiuser-deployment.md)
names as this phase's to fix — and the §13 source link. If §1.7 moved the update
check here, its badge lands on this surface rather than in a notification class.

*Ends at:* the demo.

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
   something that actually emits (§1.4).
6. *Restart now* is disabled with a reason under a bare process, and under a
   supervisor it drains in-flight turns and names how many other users it is
   about to interrupt.
7. Gallery mode: tiles for listed accounts, a hidden account absent from the
   listing but still able to sign in by handle, and the unauthenticated surface
   unchanged in form mode ([15 §8](../15-account-gallery.md)'s three tests).
8. About shows a real version and commit, and the source link resolves.
9. `storyengine.local` reaches the server from a second machine on the LAN.
10. **Only a person can walk:** hand the install to a household member who has
    never seen it, from the URL alone, and watch where they stop. The phase's
    whole claim is about that person.

**And the standing line from [01 §2.3](01-work-plan.md): no phase exits with
configuration that has no surface.** This phase is the line's last large debtor —
if anything shipped since P1 still needs a text editor to configure, this is
where it is found and fixed, not P11.

---

## 4. Out of scope, deliberately

Web Push and outbound webhooks/ntfy/Gotify (with Messages, unscheduled —
[04 §3.6](../04-server-multiuser-deployment.md), [14 §3.4](../14-roadmap.md)); the service worker that Push
implies ([04 §3.7](../04-server-multiuser-deployment.md)); Tailscale at every
level (feature list at High, [06 D1](../06-open-questions.md)); the file browser
([06 D3](../06-open-questions.md), roadmap); sharing content between users
([06 A2e](../06-open-questions.md), deferred deliberately, with the merge path
kept open at [04 §4.3](../04-server-multiuser-deployment.md)); multiplayer and
shared heads ([04 §8](../04-server-multiuser-deployment.md)); a role system
([04 §4.2.1](../04-server-multiuser-deployment.md) — named capabilities, and
[P2A](13-p2a-configuration-surface.md) already built them); auto-provisioning
accounts ([06 D2](../06-open-questions.md)); and packaging, all six artifacts of
which [P11](22-p11-implementation.md) now owns ([01 §0.5](01-work-plan.md)).
