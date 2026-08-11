# 04 — Server, multi-user, deployment

**Status: proposal.**

---

## 1. The shape of the product

**StoryEngine is a server.** The default install is a long-running process on a
box on your LAN, bound to `0.0.0.0`, that people reach from browsers on their
phones, laptops and TVs. There is no desktop app, no bundled Electron shell, and
no "run it locally and also maybe expose it" ambiguity.

This is a real divergence from all three sources: SillyTavern defaults to
localhost with an IP whitelist and treats remote access as a documented
adventure; Aventuras is a Tauri desktop app; Marinara ships a launcher `.exe`,
Docker, and Android packaging, i.e. it hedges.

Consequences that follow immediately and are worth accepting deliberately:

- Auth is **on by default**, because binding to the LAN by default and auth by
  default have to be the same decision.
- The client is a **view**. It renders server state and sends intents. It does
  not orchestrate generation, own chat history, or hold the only copy of
  anything.
- Every session must survive the client going away mid-turn — closed tab, dead
  battery, walked out of wifi range. Turn execution completes server-side and the
  client reattaches to the result.

---

## 2. Server-authoritative generation

The most consequential architectural divergence, and it is forced several times
over: by multi-user, by autonomous messages, by mobile, and by resumability.

```
client  ──intent──▶  server
                      ├─ resolve session + mode
                      ├─ run turn pipeline (steps, model calls, effects)
                      ├─ append turn record
                      └─ publish events ──▶ all subscribed clients
```

- **Intents, not instructions.** The client sends "send this message", "regenerate
  turn 44 with block X edited", "switch persona" — not an assembled prompt.
- **One event stream per session** (SSE at 1.0; WebSocket if bidirectional need
  appears). Token deltas, step start/finish, effect application, errors. Multiple
  clients on the same session stay in sync for free, which is worth having even
  before real multiplayer — one user with a phone and a laptop is the common
  case.
- **A turn is a server-side job with an id.** Reattachable, cancellable,
  observable. Not a promise living in a browser tab.
- **Autonomous messages fall out of this**, rather than needing a mechanism.
  Messages mode's scheduler is a server-side timer that starts a turn; the fact
  that no client is connected is uninteresting.

**[OPEN]** Job durability across a server restart mid-turn. Simplest honest
answer for 1.0: turns are not resumed across restart, but the partial turn is
recorded as failed with its blocks intact so it can be re-run rather than lost.

---

## 2b. Notifications

**Build this early.** Two unrelated pressures point at it, and the second is the
architectural one.

The small pressure: **completion sounds**. Marinara has them, Aventuras does not,
and the absence is a genuine daily irritation — long generations mean you look
away, and without a sound you either sit watching a spinner or come back late.
It is a tiny feature that materially changes how the app feels to use.

The large pressure: **Messages mode does not work without it.** Autonomous
messages ([03 §7.1](03-modes-and-turn-pipeline.md)) exist to reach you when you
are *not* looking. A character messaging you first, with no way for that to
surface, is a feature that does nothing.

### 2b.1 It is a consumer of the event stream, not a new subsystem

The session event stream already exists ([§2](#2-server-authoritative-generation)).
Notifications are events plus a **router** plus a set of **delivery channels**:

```
turn events ──▶ notification router ──▶ in-app (sound, toast, badge)
(server-side)     · event class          browser Notification API
                  · target user          Web Push
                  · user preferences     webhook / ntfy / Gotify
                  · presence
                  · dedupe window
```

**Routing decisions are server-side.** This is the part that must not be got
wrong: if the client decides what to notify about, notifications only work while
a client is connected, which fails the one case that motivated the feature. The
server knows who should be told and through which channel; the client only
renders the in-app part.

**Presence is already the input this needs.** Messages mode specifies per-user
presence — Active, Idle, Do Not Disturb, Invisible ([03 §7.1](03-modes-and-turn-pipeline.md)).
That is exactly the routing signal: suppress on DND, prefer in-app when Active
and viewing the session in question, escalate to push when Idle or disconnected.
Reuse it rather than inventing a parallel notion.

**Per-user, and scoped by ownership.** A household server must never tell one
person about another's session. Session visibility ([§3.3](#33-shared-library-private-sessions--the-divergence-from-sillytavern))
already answers this.

### 2b.2 What this obliges 1.0 to do, even if channels ship late

The retrofit cost is not in the delivery channels — those are additive. It is in
the **event schema**, because every producer changes if it is wrong. From the
start, events carry:

- **class** — turn-complete, message-received, awaiting-input, failed, agent-note.
  A small closed set; per-class preferences are the entire user-facing model.
- **target user** — resolved server-side, never inferred by the client.
- **a renderable summary as `{ key, params }`, not English prose.** One line fit
  to be a notification body — but composed at display time, because the server
  cannot know the reader's language and a baked English string is
  untranslatable ([07 §10c.5](07-tech-stack.md)). Note this cuts both ways: the
  params must carry everything the sentence needs, since composing a summary
  later from *unstructured* fields produces the "New event in session 4f2a"
  school of notification.
- **a dedupe key and coalescing window** — five characters replying in a group
  chat is one notification, not five. Trivial to design in, unpleasant to add
  once producers exist.

**Awaiting-input deserves special mention.** If a turn can suspend for player
input ([06 C5](06-open-questions.md)), and the player has wandered off, the
session is stuck until told. That class is the strongest argument for push
rather than in-app-only.

### 2b.3 Delivery channels, in order of cost

1. **In-app** — sound, toast, unread badge, document title. Covers the
   completion-sound case entirely and needs no infrastructure.
2. **Browser Notification API** — works when the tab is backgrounded but the
   browser is open. Small step, large practical gain.
3. **Web Push** — works when the browser is closed. See §2b.4.
4. **Outbound webhook, plus ntfy/Gotify shapes** — the self-hoster's expectation
   and cheap to add, since it is an HTTP POST against a user-supplied endpoint.
   It also sidesteps mobile push entirely for people who already run ntfy, which
   is a large fraction of this audience. Treat the endpoint as user
   configuration, not server configuration.

### 2b.4 A correction to the no-service-worker position

[05 §1](05-ui-surfaces.md) says "no offline story. No service worker, no local
cache-as-database, no sync." **Web Push requires a service worker**, so that
needs narrowing rather than quietly contradicting.

The position stands as written for what it was aimed at: no offline caching, no
client-side database, no sync reconciliation. A service worker registered
*solely* to receive push and post a notification reintroduces none of that — it
holds no state and serves no cached responses. That is a different thing wearing
the same name.

So: a push-only service worker is permitted; an offline-caching one is not. Worth
writing down because the distinction is easy to lose, and a service worker that
starts caching "while it is there anyway" is exactly how the offline
state-reconciliation problem arrives uninvited.

---

## 3. Multi-user

### 3.1 Threat model, stated plainly

This is **access separation among people who already trust each other**, on a
network they control. It keeps your sister out of your sessions. It does not
withstand a determined attacker and is not intended to.

That has to be written down in three places — this doc, the README, and the
setup UI — because the failure mode is someone port-forwarding it. The setup
flow should say so at the moment of binding, not in documentation nobody reads.

What that buys us: we can skip rate limiting, account lockout, password
complexity policy, email verification, and 2FA. What it does *not* excuse:
storing passwords in anything but a proper KDF (argon2id, or scrypt as ST does),
CSRF protection on state-changing routes, session cookies with sane flags, and
path traversal checks on every filesystem-touching route. Those are cheap and
their absence is embarrassing rather than defensible.

### 3.2 Users

```ts
interface Account {
  handle: string          // stable, used for directory names, immutable
  displayName: string
  passwordHash, salt      // argon2id
  role: "admin" | "user"
  enabled: boolean
  locale: string | null   // BCP-47; defaulted from Accept-Language on first login
  createdAt: number
}
```

First-run creates the first admin. Admins manage accounts and install
extensions; users do everything else. That is the entire authorisation model, and
it should stay that small unless something forces otherwise.

### 3.3 Shared library, private sessions — the divergence from SillyTavern

SillyTavern gives each user a complete private island: ~30 directories per user,
nothing shared. For a household server this is exactly backwards. People want to
share character cards, lorebooks, settings and packages, and absolutely do not
want to share their sessions.

So:

```
/data/library/…            shared, readable by all users
/data/users/<handle>/…     private: sessions, connections, preferences
```

- **Library objects have an `owner` and a `visibility`.** Default `shared` for
  actors/lorebooks/settings/packages/presets — that is the point of a family
  server.
- **Sessions default `private`** and live under the owner. There is no browse-all
  for sessions, including for admins. (An admin can read the files on disk. That
  is a property of the box, not a permission we should grant in the UI.)
- **Connections are always private, never shared, never listed to others.** They
  hold credentials. A user's API key is theirs.
- **[OPEN]** Should an admin be able to configure a *server-level* connection
  that all users may use without seeing the key? Very likely yes — it is the
  natural household setup ("Dad pays for the API") — and it means connections
  need a scope (`user` | `server`) with the key readable by neither, only usable.
  Worth designing in early; awkward to retrofit.
- **Deletion of a shared object** that others' sessions were seeded from is safe
  by construction: sessions copy, they don't link ([00 §3.1](00-stance.md)).

### 3.4 Concurrent edits

Two users editing the same shared actor is now possible and it wasn't before.
Files on disk plus no database means no transactions.

Proposal: optimistic concurrency. Each object read carries a version (content
hash); a write that presents a stale version is rejected, and the UI offers
"reload and reapply" or "save as a copy". No merge, no locking, no last-writer-
wins-silently. Conflicts on a family LAN will be rare enough that the cheapest
correct answer is the right one.

---

## 4. LAN, Tailscale, and getting to it

### 4.1 Defaults — loopback on first boot

**Revised.** An earlier draft had this binding `0.0.0.0` by default, reasoning
that LAN-first and auth-on-by-default were the same decision. That was wrong in
one specific and important window: **a freshly installed instance has no admin
account**, so between first boot and first-run setup there is an interval where
anyone on the network can reach the create-the-first-admin flow and claim it.
That is a well-known way self-hosted software gets embarrassed, and the cost of
avoiding it is one config line.

So:

- **Bind `127.0.0.1` on first boot.** LAN exposure is an explicit act, not a
  default.
- **Flipping it must be trivial, and available in both places** — a setting in
  the UI (admin only), and a plainly-named key in `config.yaml` for people who
  never open the UI first. Neither may be the only route.
- **Containers are the exception, necessarily** — see §4.3.
- Advertise over mDNS as `storyengine.local` once bound beyond loopback, so
  nobody types an IP. Small feature, large effect on whether non-technical
  household members ever use it.
- No HTTPS by default. It cannot be done well on a LAN without either a real
  domain or a private CA, and self-signed certificates train people to click
  through warnings. Document the plain-HTTP-on-a-trusted-LAN position honestly;
  offer a reverse-proxy guide for those who want TLS.

**First-run setup gates everything.** Until an admin account exists, every route
except setup returns the setup flow. Combined with the loopback default this
closes the claim window on bare-metal installs.

**When the bind is non-loopback and no admin exists yet**, print a one-time
setup token to the server console and require it to create the first admin.
Only someone with host access sees the console, which is exactly the right
audience. This is what makes §4.3's container default safe rather than merely
unavoidable.

### 4.2 Tailscale

Wanted eventually; worth designing the seam now because it changes the auth model
rather than sitting beside it. Three levels, in increasing order of effort:

**Level 1 — Detect and inform.** Notice a `100.64.0.0/10` interface, show the
tailnet address and MagicDNS name in the UI as a copyable "reach this from
anywhere" URL. Pure convenience, near-zero cost, and it should ship early because
it is where most of the practical value is.

**Level 2 — Identity from the tailnet.** Tailscale can supply the identity of the
calling node's user. Trusting that means "if you're on my tailnet, you're you" —
which is a *better* auth story than passwords on a LAN, and it maps onto machinery
SillyTavern already demonstrates: header-based SSO gated behind an explicit
`trustedProxies` allowlist, validated with `ip-matching` (`src/users.js`). Same
pattern: trust an identity header only when the request arrives on the Tailscale
interface from a trusted source, map the tailnet identity to a StoryEngine
account, fall back to password auth otherwise.

**Level 3 — Embedded node (`tsnet`).** StoryEngine appears as its own device on
the tailnet with its own name and identity, no host Tailscale install required,
and per-user identity available directly rather than inferred from headers.
Cleanest result, largest commitment (a Go component or an equivalent binding),
and it makes Funnel/Serve available if anyone ever wants controlled outside
access.

**[OPEN]** Which level is the 1.0 target. Lean: ship Level 1, design the auth
layer so Level 2 is a provider plugged into an existing identity interface rather
than a special case, and treat Level 3 as a genuine later project.

**[OPEN]** Whether tailnet-identity users get auto-provisioned accounts on first
sight, or must be pre-created by an admin. Auto-provisioning is friendlier and
means anyone you share your tailnet with gets a StoryEngine account.

### 4.3 Packaging, and why containers invert the bind default

Docker Compose as the primary distribution (one volume, one port, one env file),
plus a plain `node` install for people who prefer it. No launcher `.exe`, no
Tauri shell, no Android build at 1.0. If a native wrapper is ever wanted it
should be a thin client pointing at a server, not a second copy of the engine.

Full target list in [§4.4](#44-which-packages-are-first-class).

**Inside a container, binding loopback is simply broken.** `127.0.0.1` in a
container is the *container's* loopback, so the process is unreachable from the
host no matter how the port is mapped. A container image that shipped §4.1's
default would appear completely dead on first run, and the resulting bug reports
would all say "it doesn't work".

So the container image binds `0.0.0.0`, and the security argument shifts rather
than disappearing:

- **The port mapping is the user's explicit act.** `-p 8080:8080` is the
  deliberate exposure decision that §4.1 is trying to force; in a container the
  runtime already forces it.
- **The console setup token (§4.1) covers the rest** — `docker logs` is exactly
  the host-access-only channel it assumes.

This should be a single, documented environment variable rather than a hidden
build difference, so that a bare-metal user can opt into the same behaviour and
a container user can tighten it.

**Ship an unraid Community Applications template as a first-class artifact.**
Unraid is a large share of this audience, and a good template — port mapping,
`/data` volume, WebUI URL, sensible defaults — turns "set it up for the LAN" into
the install itself, which is the stated goal. A template that only half-works is
worse than none, so it belongs in the repo and in the release checklist rather
than being left to a third party.

**[OPEN]** Whether to also publish to the unraid CA store directly, which means
maintaining a presence there, versus letting the template be community-submitted.

### 4.4 Which packages are first-class

**The reframe that settles most of this: we are packaging a *service*, not a
desktop application.** There is no GUI, no tray icon, no file associations, no
window. The only questions that matter are:

1. Does it install cleanly with its dependencies?
2. **Does it start on boot and come back after a reboot?**
3. Where does `/data` live, and does an upgrade leave it alone?

Question 2 is the one that decides the list. A packaging format that does not
give service integration is not buying anything a tarball does not, and several
Linux formats that feel obligatory are desktop-application mechanisms wearing
Linux hats.

#### The tiers

**Tier 1 — the OCI image.** Docker/Podman image plus a compose file. This is the
distribution; everything else is a convenience. It also covers far more ground
than it appears to: Podman, unraid, TrueNAS, Synology, Portainer, Proxmox users
running Docker inside a VM or LXC, and anyone on a NAS. The unraid CA template
(§4.3) is a thin wrapper over it.

**Tier 2 — a generic tarball with a systemd unit and an install script.** The
single highest-value non-container artifact, and the one most easily skipped.
It answers question 2 for *every* Linux that is not Debian or Arch, which means
it quietly obsoletes the need for `.rpm` at this project's size. Ship the unit
file, create a service user, put data in a sane place, and document the upgrade
path.

**Tier 3 — `.deb` and the Arch AUR package.** Conveniences, plus one strategic
reason each:

- **`.deb`** covers the largest single slice of homelab Linux (Debian, Ubuntu,
  Raspberry Pi OS) and its users genuinely expect `apt`.
- **AUR**, as you say, is worth claiming before somebody else does it badly.
  This is a real distinction rather than territorial instinct: **an AUR package
  looks official.** It sits under the project's name, and when it breaks the
  bug reports arrive here. Formats where third-party packaging is clearly
  branded as third-party — Proxmox helper scripts, Nix expressions — do not
  carry that problem, and are fine to leave alone.

**Windows and macOS, both of which are Tier 2-ish**, because "run the server on
the machine I already have" is a real and well-populated case in this audience:

- **Windows** — an installer that registers a Windows Service, so it survives a
  reboot. This is the same question-2 requirement in different clothes. A
  double-clickable launcher that dies when the console closes is the failure
  mode to avoid.
- **macOS, Apple Silicon** — a **Homebrew tap** is the idiomatic answer for a
  service, since `brew services start storyengine` gives launchd integration for
  free and costs a formula rather than a signed `.pkg` and a notarisation dance.

#### Not doing these, and why

- **Flatpak** — a desktop-application format. Sandboxed, desktop-integrated,
  and a poor fit for a long-running background service. Nobody runs Jellyfin,
  Immich or Home Assistant this way. It *feels* like it should be on the list and
  it buys nothing here.
- **AppImage** — same category error, and your instinct is right that it
  under-delivers. A portable single file is a desktop convenience; a server
  wants an install location and a service.
- **Snap** — as above, plus confinement fights with a data directory the user is
  expected to browse and hand-edit ([05 §4](05-ui-surfaces.md)).
- **`.rpm`** — Tier 2's tarball covers it. Revisit only if Fedora/RHEL users turn
  up in numbers and say otherwise.
- **LXC templates** — genuine in Proxmox homelabs, but Proxmox users overwhelmingly
  either run Docker inside a container or use the community helper-script
  ecosystem, which is clearly branded as third-party and therefore safe to leave
  to it. Reconsider if that changes; you are right that it feels more like a
  future than a present.
- **Intel macOS builds** — agreed, and not marginal. The remaining hardware is a
  small number of Mac Minis and Mac Pros, all of which can run something better
  supported. Worth noting the DIY path serves them for free anyway: a Node
  server with few or no native dependencies builds on Intel macOS without our
  doing anything, so this is declining to *test and ship* a binary rather than
  declining to work. Happy to bless it as official if someone else maintains it.

#### On "fuck it, build scripts and DIY"

Mostly right, and worth being precise about where it stops being right.

The instinct is correct because **every package format is a recurring cost, not
a one-time build**: a CI matrix entry, a signing story, a thing that breaks on
someone else's schedule, and an implied support promise. For a very small team
on a power-user project, a short list that works beats a long list that rots.
Build-from-source should be genuinely first-class — documented, scripted, and
the path maintainers actually use — not the shameful fallback it usually is.

Where it stops being right is question 2. "Clone the release branch and run it"
produces installs that die on the first reboot, and those become support load
regardless of what the README said. That is why Tier 2 exists and why it is
Tier 2 rather than optional: **the minimum honest artifact for a server is
something that starts on boot.** A tarball with a unit file and an install script
is a few hours of work and removes the single most common failure mode.

So: Tier 1 and Tier 2 always. Tier 3 as capacity allows, with AUR earlier than
its usage share suggests for the reason above. Everything else, documented
build scripts and someone else's enthusiasm.

**[OPEN]** Auto-update. Container users have watchtower or a pull; package
users have their package manager; tarball users have nothing. An in-app update
check that merely *notices* a new release and links to it is cheap, and pairs
with the version-awareness the AGPL §13 source link already needs (§5).

---

## 4b. Reloading, restart-required, and restarting from the UI

Three requests that turn out to be one mechanism, which is the reason to design
them together rather than bolt the second onto the first.

### 4b.1 Annotate every config key with what it takes to apply

```ts
reload: "live" | "reconnect" | "restart"
```

- **live** — re-read on change, effective immediately. Log level, pacing
  defaults, notification preferences, prompt templates, most feature toggles.
- **reconnect** — effective for new sessions or after clients reconnect.
- **restart** — bind address, port, data root, anything establishing a listener
  or a file handle.

**Everything else follows from this being declared rather than remembered.** The
restart-required notice (§4b.3) is *derived*, not hand-maintained — which
matters because a hand-maintained list of "settings that need a restart" is
wrong within two releases, and wrong in the direction where users change a
setting, see nothing happen, and conclude the app is broken.

### 4b.2 Content already hot-reloads, and that is not a dev feature

Worth stating because it is easy to file under "dev mode" and it is not: because
files on disk are canonical and the index is watcher-fed
([02 §5.1](02-data-model.md)), **editing a lorebook, setting, preset or prompt
template on disk takes effect with no restart, in production, for everyone.**
That falls straight out of the storage design.

It is also the property that makes in-UI file access ([05 §4](05-ui-surfaces.md))
coherent, and the reason prompt-template iteration does not need a dev
environment at all.

### 4b.3 Restart-required notification

When a change lands — from the UI, the config file, or an extension install —
the server computes whether anything now pending requires a restart, and surfaces
a **persistent banner naming the specific changes**, not a toast.

- Server-held, so it survives a page reload and shows on every admin's client.
- Lists *what* is pending. "Restart required" alone invites people to restart
  and hope.
- Sits next to a **Restart now** action (§4b.4).

### 4b.4 Restart from the UI, with honest preconditions

Admin-only, and there are two things it must not do naively.

**It only works under a supervisor.** Docker with `restart: unless-stopped`,
systemd, or unraid will bring the process back; a bare `node server.js` will
simply exit and the admin who clicked the button now has no server and possibly
no shell. So: detect whether the process is supervised, and where it is not,
disable the control with an explanation rather than offering a trap.

**Drain before exiting.** A restart during a turn loses it — C4 says in-flight
turns are recorded as failed rather than resumed, which is survivable but rude
when self-inflicted. Restart should refuse new turns, wait for in-flight ones
within a timeout, then exit. And because this is multi-user, the confirmation
must say what it is about to interrupt: *"2 other users have active sessions."*

Clients reconnect on their own, since the event stream already reconnects
([07 §8](07-tech-stack.md)), so the user-visible result is a brief disconnected
banner rather than a manual refresh.

**[OPEN]** Whether extension install/uninstall can avoid a full restart. In-process
ESM modules make true unloading hard — stale references, already-registered
channel definitions — so "restart required" is the honest 1.0 answer, and a
cleaner lifecycle depends on [06 A1](06-open-questions.md).

---

## 5. Licence obligations that are actually features

StoryEngine is AGPL-3.0 ([08 §1](08-triage.md)), and §13 — the network clause —
applies squarely to a multi-user server reached over a LAN: people interacting
with it remotely must be offered the corresponding source for the version they
are interacting with.

This is small, and it is a 1.0 requirement rather than a later tidy-up:

- A **Source** link in the UI, visible to every logged-in user, not buried in an
  admin screen.
- It must resolve to **the version actually running**, which means the build
  embeds its tag and commit hash and the link is version-aware. A link to `main`
  is not strictly compliant when the operator is running a patched build — and
  the patched-build case is exactly the one §13 exists for. The permanent
  release branches and tags in [12 §2](12-repo-and-releases.md) are what keep
  those links resolving years later.
- An **About** surface showing version, commit, licence, and the dependency
  licence manifest. Cheap to generate at build time and independently useful for
  bug reports.

The same surface should state the licence boundary plainly, because the
project asks copyleft of one category and nothing of the other
([08 §1.2](08-triage.md)):

- **Code extensions and modes are AGPL-3.0.** They import the SDK and run in our
  process.
- **Content is the author's own** — actors, settings, lorebooks, presets,
  sessions, and packages including their authored rules. These are data the
  program produces, not derivative works of it. Nobody's characters become AGPL
  by being authored here, and a package of rules can be licensed however its
  author likes, or not at all.

Saying both halves clearly and in the same place is the cheapest available
defence against the misreading that copyleft is creeping into people's stories.

---

## 6. Multiplayer, and why `participants` is a list now

Two people in the same session — one narrating, two personas, or a "GM plus
players" arrangement — is a genuinely attractive feature and explicitly **not a
1.0 goal**. But the data model should not preclude it, and three cheap decisions
made now keep the door open:

1. `Session.participants` is a list (length 1 at 1.0).
2. `PartyMember.control: "player"` is not structurally limited to one member
   ([03 §8](03-modes-and-turn-pipeline.md)).
3. Turn execution is already server-side with an event stream, so a second
   subscriber is not a new mechanism.

What is genuinely hard and deliberately not being solved: turn arbitration
between humans, per-user visibility of hidden state, and simultaneous input.
Those are the actual feature, and none of them are prejudiced by the three
decisions above.

**[OPEN]** Worth confirming this is the right posture — "don't preclude, don't
build" — versus either committing to multiplayer at 1.0 or explicitly declaring
it out of scope forever.
