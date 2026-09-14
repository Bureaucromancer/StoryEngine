# 26 — P10 implementation plan

**Status: skeleton.** Drafted 2026-08-29 alongside
[P7](23-p7-implementation.md), [P8](24-p8-implementation.md),
[P9](25-p9-implementation.md) and [P11](27-p11-implementation.md); to be
revisited before the phase starts. [P7 §0](23-p7-implementation.md) says what a
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
[P11](27-p11-implementation.md) before it is built, and anything found elsewhere
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
unscheduled** ([24 §3.4](../24-roadmap.md)). So 1.0
routes on what it has: connection state, and whether the connected client is
viewing the session in question. Write it as a presence *input* with one
implementation rather than as a connection check, so real presence substitutes
rather than rewrites whenever it lands. **That is now an open-ended wait rather
than a one-release one**, which makes the substitutable shape more important, not
less — [work plan §0.3](01-work-plan.md) records the cost of a seam with no date.

### 1.4 Every class either has a producer or is not shipped

[09 §3.5](../09-server-multiuser-deployment.md) lists five 1.0 classes.
`turn.complete`, `turn.failed` and `system.notice` have producers today;
`artifact.ready` gets one at [P9](25-p9-implementation.md);
`turn.awaiting-input` has one only if [25 C5](../25-open-questions.md)'s
suspending step exists, which [P3 §1.6](15-p3-implementation.md) notes arrives
early in a different shape — *park, publish, resume-on-intent* — and warns that
the obvious name is already taken, since `Turn.status: 'suspended'` means a turn
that will resume.

**Decide per class, and say so in the preference rows.** A preference row for a
class nothing emits is [work plan §2.3](01-work-plan.md)'s failure inverted: a surface
for configuration that has no producer.

### 1.5 The extensions panel needs installation, and nothing installs

[10 §15.5](../10-ui-surfaces.md) names the blocker plainly. The manifest and the
lifecycle are specified ([22 §6–§7](../22-extensions.md)) and
[P7](23-p7-implementation.md) builds the boundary they run behind, but no
document owns *acquiring and enabling an extension on an install*.

**To decide at the revisit:** whether P10 builds installation — and therefore
the panel — or the panel stays deferred with its blocker named and an owner
attached. Building the panel over a stub is the one option to refuse: a screen
that lists nothing and installs nothing is exactly the false front
[10 §15.5](../10-ui-surfaces.md) uses capability granting to illustrate.

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
names its producer as [P11](27-p11-implementation.md)'s update check;
[P2B §6](10-p2b-provider-configuration.md) records the same dependency from the
other side. **Two phases, one signal, in the wrong order.**

The revisit has to pick one: move the update check into P10 (it is small, and
[09 §6.5](../09-server-multiuser-deployment.md) already argues the signal is free
because the request is being made anyway), or ship the surface reading a source
that is always *unknown* and let P11 light it up. **Lean: move the check.** The
alternative ships a panel that cannot be tested by looking at it, which is the
class of thing this repository has already been burned by twice.

### 1.8 §15.3's system-library bullet has no owner, and that is a defect to close

[10 §15.5](../10-ui-surfaces.md) says so in its own voice: the scope is
never-writable, [09 §4.3](../09-server-multiuser-deployment.md) withholds admin
write at 1.0 deliberately, and [10 §15.4](../10-ui-surfaces.md) says a panel with
no action does not belong. **Either the bullet goes or 1.0's position on admin
write changes**, and this phase is where it stops sitting there looking
scheduled. It is a documentation edit, not a build, and it belongs in the plan
so it does not get built by accident.

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

### P10.1 — The notification router

§1.3's server-side routing with a substitutable presence input; §1.4's
producer-by-producer class decision; the dedupe key and coalescing window from
[09 §3.4](../09-server-multiuser-deployment.md) — *five characters replying in a
group chat is one notification, not five*, trivial to design in and unpleasant to
add once producers exist; per-user scoping by ownership, which
[09 §4.3](../09-server-multiuser-deployment.md) already answers.

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

### P10.3 — The remainder of [10 §15](../10-ui-surfaces.md)

The notification preference rows, one per shipped class; §1.6's *Restart now*
with supervisor detection and drain; §1.7's connectivity state; §1.5's
extensions panel or its named deferral; §1.8's bullet closed one way or the
other.

**And [10 §15.1](../10-ui-surfaces.md)'s *your connections*** — personal
connections, personal bindings and the personal-versus-system view — which
[P2B §2.7](10-p2b-provider-configuration.md) sent to *"the phase after, or at
P10 with the rest of §15.1"*, [P6B §5](20-p6b-playable.md) calls P10's, and
this list never carried until 2026-09-11. The enforcement half landed at P2A
and the fallback display at P2B, so what is left is the writer for
`users/<handle>/bindings.json`, the second column of the role table, and a
user's own connection list — the same form the admin has, scoped to the path
that is the owner. *The role-binding editor itself is P7.3's on branch `p7`;
this is the per-user half of it.*

### P10.4 — The account gallery

§1.9, as [12 §8](../12-account-gallery.md) specifies it, including the
unauthenticated listing contract and the three tests. The one judgement this
plan adds: the gallery is **not** self-registration and has no *new account*
tile ([12 §9](../12-account-gallery.md)) — worth restating in the stage because
a grid of accounts is a shape that invites the extra tile.

**And Home**, [10 §2.2](../10-ui-surfaces.md) — the arrival screen *after*
sign-in, which [polish §5](06-polish.md) details and nothing scheduled until
2026-09-11; `/` still redirects to the library. The gallery is arrival before
sign-in, and one stage owning both keeps the two from disagreeing about what
arrival is for. Polish §5's scope rule travels with it: nothing computed for
home alone, no endpoint that exists only to populate it, and every element a
link into a surface that does the real work.

### P10.5 — About, the source link, and the embedded version

[09 §7](../09-server-multiuser-deployment.md)'s licence obligations that are
actually features: the running version and commit embedded in the build — ~~**no
build embeds one today**, which [09 §6.5](../09-server-multiuser-deployment.md)
names as this phase's to fix~~ embedded at [P6A §1.5](19-p6a-alpha-1.md) and
shown since alpha.2, as the footer on every page and the About block at the top
of Settings ([10 §15.1](../10-ui-surfaces.md)) — and the §13 source link, which
is what is left here. If §1.7 moved the update check here, its badge lands on
that About block rather than in a notification class.

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

---

## 4. Out of scope, deliberately

Web Push and outbound webhooks/ntfy/Gotify (with Messages, unscheduled —
[09 §3.6](../09-server-multiuser-deployment.md), [24 §3.4](../24-roadmap.md)); the service worker that Push
implies ([09 §3.7](../09-server-multiuser-deployment.md)); Tailscale at every
level (feature list at High, [25 D1](../25-open-questions.md)); the file browser
([25 D3](../25-open-questions.md), roadmap); sharing content between users
([25 A2e](../25-open-questions.md), deferred deliberately, with the merge path
kept open at [09 §4.3](../09-server-multiuser-deployment.md)); multiplayer and
shared heads ([09 §8](../09-server-multiuser-deployment.md)); a role system
([09 §4.2.1](../09-server-multiuser-deployment.md) — named capabilities, and
[P2A](09-p2a-configuration-surface.md) already built them); auto-provisioning
accounts ([25 D2](../25-open-questions.md)); and packaging, all six artifacts of
which [P11](27-p11-implementation.md) now owns ([work plan §0.5](01-work-plan.md)).

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

**Three things only the revisit can settle:**

- **Whether 1.0 ships push at all** (§1.3's *no presence signal*). The router
  can be real while the delivery channels are one; deciding that early is what
  keeps §1.7's *ships with its producer or ships dark* from becoming a late
  argument.
- ~~**What the container image actually is.** §1.2 decides the bind default
  inverts inside it; nothing yet says what *it* is, and that is a
  [19](../19-tech-stack.md) question this phase inherits.~~ **Closed by
  [P6A §2](19-p6a-alpha-1.md)**, which answers it — base image, package manager,
  the workspace prune, the volume, the user, the compose file — rather than
  passing it on again. Worth noting that it was routed to
  [19](../19-tech-stack.md) and [19](../19-tech-stack.md) never grew a section
  for it: a question forwarded to a document that does not answer it is a
  question with no owner, which is what this bullet was really recording.
- **Whether §1.8's system-library bullet found an owner.** It is recorded here
  as a defect to close, which is the right place for it — but a defect with no
  owner at the revisit is one that ships.
