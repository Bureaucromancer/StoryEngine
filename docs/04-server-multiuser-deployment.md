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
- **a human summary** — one line fit to be a notification body. Composing that
  later from structured fields produces the "New event in session 4f2a" school
  of notification.
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

### 4.1 Defaults

- Bind `0.0.0.0` on a fixed port, auth required, HTTP.
- Advertise over mDNS as `storyengine.local` so nobody types an IP. This is a
  small feature with a large effect on whether non-technical household members
  ever use it.
- No HTTPS by default. It cannot be done well on a LAN without either a real
  domain or a private CA, and self-signed certificates train people to click
  through warnings. Document the plain-HTTP-on-a-trusted-LAN position honestly;
  offer a reverse-proxy guide for those who want TLS.

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

### 4.3 Packaging

Docker Compose as the primary distribution (one volume, one port, one env file),
plus a plain `node` install for people who prefer it. No launcher `.exe`, no
Tauri shell, no Android build at 1.0. If a native wrapper is ever wanted it
should be a thin client pointing at a server, not a second copy of the engine.

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
  embeds its commit hash and the link is version-aware. A link to `main` is not
  strictly compliant when the operator is running a patched build — and the
  patched-build case is exactly the one §13 exists for.
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
