# 05 — UI surfaces

**Status: proposal.**

---

## 1. The client stance: web, and only web

**StoryEngine is a web application.** The browser is *the* client, and every
surface in this document is built for it. There is no desktop app, no Electron
shell, no Tauri build and no native mobile app.

**Softened from "and no plan for any", with a bar attached.** Notification-driven
modes — Messages especially ([03 §7.1](03-modes-and-turn-pipeline.md)) — are the
kind of thing a native client genuinely serves better, so a blanket never is the
wrong shape. The position instead:

> **Not a priority, and not ours to build. Pitch it if you want to contribute
> one — but nothing ships that is not a feature-complete client with a real
> advantage over the web app.**

A partial native client is worse than none: it splits the surface, halves the
testing, and teaches people that some features live in one place and some in the
other. The bar is the whole point of the position.

This is a stronger position than any of the three sources takes — Aventuras is a
Tauri desktop app, Marinara ships a launcher `.exe` plus Docker plus an Android
build, SillyTavern is a local server people reach in a browser but whose docs
treat that as a local-first arrangement. Hedging across shells is a real tax:
it forces filesystem access through an abstraction that has to work in three
environments, it doubles the packaging surface, and it makes the multi-user
server the *secondary* configuration in a product where it should be the only one.

What follows from this:

- **Responsive from day one**, because a phone browser is a real client. But
  "responsive and genuinely usable on a phone" is the 1.0 bar, not "designed
  phone-first". A *truly* mobile-optimised layout — different navigation model,
  different play surface, thumb-reachable controls — is a later, separate
  project, and it is a mode of the same web app, not a different artefact.
  (This is a deliberate softening of Marinara's "mobile is a first-class play
  surface" principle. Marinara is right for Marinara; a LAN server whose primary
  users are on laptops has different priorities at 1.0.)
- **No offline story.** No local cache-as-database, no sync. No service worker
  *for caching* — though a push-only one is permitted, and the distinction is
  drawn in [04 §3.7](04-server-multiuser-deployment.md).
  The server is on your LAN; if you can't reach it there is nothing to do.
  This removes an entire class of state-reconciliation problems.
- **Nothing is installed on the client.** Bookmark a URL. That is the whole
  install experience for everyone who isn't the person running the server.

The one legitimate secondary interface is **direct file access to the data
directory** — which is not a client at all, it's the storage design working as
intended. See §4.

### 1.1 Density, and the aesthetic position

Stated because it is doing work in every other section and has never been
written down, so it keeps getting re-derived — usually as its opposite, since
the opposite is what most current design writing assumes.

> **Application style to the tooling; clean prose first.**
>
> Or at length: a sophisticated, high-density interface for the surfaces where
> work happens, and a quiet typographic one for the surfaces where the story is.

On the tooling side, both words carry weight. **Modern**: current CSS, real
typography, proper focus and keyboard handling, responsive down to a phone (§1),
no skeuomorphic gradients, no 1994 business software. **Dense**: a lot of
information on screen at once, laid out so it can be *read* rather than hunted
for. The question this design asks of any borrowed pattern is *"how would that
dense style be clarified and modernised"* — not *"how do modern phone apps do
this"*.

**Who this is for, since it is a real choice and not a neutral one.** The people
who will run a server on their own LAN, hand-edit an object folder in a text
editor and enjoy it — the crowd for whom a well-structured `.md` file is a thing
of beauty. That audience is not incidental: the storage thesis
([02 §5](02-data-model.md)) recruits it directly, and designing past it to chase
a mass-market posture would cost the users this project actually has without
winning the ones it does not.

**What is being rejected on the tooling surfaces**, specifically, because it is
the prevailing default and the default is wrong there:

- **Whitespace as a substitute for hierarchy.** Space is one tool for showing
  structure. Typography, weight, rule lines and alignment are others, and they
  cost no room. A layout that can only express *these things are different* by
  pushing them apart runs out of screen immediately.
- **Progressive disclosure as a reflex.** Hiding a control behind a click makes
  a screenshot calmer and the actual work slower. Disclosure has to be earned by
  the thing being genuinely rare or genuinely dangerous — not by a designer's
  discomfort at seeing eight things at once.
- **Infinite layers of click-through.** Every layer is a place to get lost in
  and a thing to hold in your head. Depth is a cost paid for by the user, and it
  is charged per visit.

**Which surfaces this governs, because it is not all of them.** The split is by
what the user is doing at that moment, not by taste:

| Dense — tooling | Quiet — story and arrival |
|---|---|
| Workbench panel (§3), library (§5), editors (§11), cast panel (§13.2), search (§14), administration (§15) | Reading view (§12), the modes' play surfaces, first-run and the setup flows (§6) |
| Someone with forty actors and a lorebook that is not firing is *working*, and every hidden control is a tax on that | Someone reading their own story wants prose, and someone starting their first one wants a path, not an instrument panel |

**The reading view is the case that proves the rule**, and it is already written
that way: §12 strips the machinery on purpose. Nothing here softens that. A dense
workbench and a calm reading view are not a contradiction — they are the same
design answering two different questions, and §2 says as much about the pair.

**Where the two meet, tooling gives way.** The play surfaces carry controls, and
the temptation is to treat them as tool surfaces because there is a lot the
engine could show. They are not: what the engine understands belongs in §13's
affordances and the workbench, on demand.

**What this is not.** Not an excuse for clutter: density and noise are
different, and the difference is entirely in whether the layout has a structure
you can learn — which is a real cost in typographic discipline and consistent
affordances, and dense done badly is worse than sparse done badly. Not a
rejection of the phone (§1) — a dense desktop layout and a usable phone layout
are the same design at two sizes, which is a real constraint and is meant to be.
And not a rejection of defaults: sensible defaults are how someone survives a
dense surface on day one.

**Why this order, even if the end state is calmer than this.** Dense converts to
sparse; sparse does not convert back. Adding space, splitting a panel or hiding
a control behind a disclosure is mechanical work. Recovering an information
architecture from a design that never needed one is a rewrite, because the
question *"how do these forty things relate on one screen"* was never asked. So
the dense layout is the one to build first regardless of where the argument
below lands.

**[OPEN]** Whether the tooling surfaces eventually need a **simple/advanced
split**, or **a user-rearrangeable layout** so density is something a user dials.
Carried as [06 E10](06-open-questions.md), where the caution that matters is
recorded: **neither is a licence to skip designing the surface now.** Themes
move look, not information architecture, and "the user can rearrange it later"
is how a UI ends up never having been designed at all.

### 1.2 Where the look lives

§1.1 is the position; this is the machinery that makes it enforceable rather
than remembered. Two places, and nowhere else.

**The palette is `packages/client/src/index.css`.** One `@theme` block naming
every colour, radius and type step the app uses — `--color-surface`,
`--color-ink-muted`, `--color-danger-line`, `--text-section` — and a second block
redefining the colours for the dark theme. It is the only file in the client
permitted to name a Tailwind scale like `slate-800`; everywhere else that is a
build error, because a component reaching past the tokens is a component that
stays light when the rest of the app goes dark.

**The look is `packages/client/src/ui/`.** `Button`, `Alert`, `Badge`, `Panel`,
`Dialog`, the type steps, and the two field primitives. They spend token names
and never scales, and they carry **no `dark:` variants at all** — a component
that needs one is a component whose token is missing, and adding the token fixes
every other surface that was about to need the same variant.

**The boundary between the two kinds of thing in `ui/`:** a **component** when
it owns behaviour or ARIA, a **class list** when it owns appearance only.
`Dialog` is a component because it owns the focus trap and `aria-modal`, which
three surfaces were otherwise spelling separately. Links and table cells stay
class lists, because the router owns the one element and a test asserts on the
other.

**Light and dark are two designed defaults**, and the OS picks between them via
`prefers-color-scheme`. Someone who wants to override that says so in
Preferences (§15.1), which writes `ui.theme` to their own `prefs.json` and sets
`[data-theme]`; a `:not([data-theme='light'])` guard on the media query is what
lets the explicit choice win in *both* directions, including choosing light on a
machine set to dark.

**`system` is the absence of the preference rather than a third stored value.**
Choosing it deletes the key, so a person who never opened the setting and a
person who chose *Match my system* are in one state rather than two that have to
be kept behaving alike. The choice is also mirrored to `localStorage` — the only
use of it in the client — so a load can apply it before rendering; without that,
anyone whose choice differs from their OS gets a flash of the other theme on
every navigation. The mirror is a cache and never an authority: nothing reads it
to decide what to save.

**Dense and Quiet share the palette**, and that is a finding rather than a
shortcut: [P2C](workplan/15-p2c-first-real-run.md) diagnosed the dark play
surface as *"a stranded assumption rather than a theme"* — sixteen `neutral-*`
utilities against a hundred and seventy-two `slate-*` — and its typed text
measured **1.01 to 1**. What separates the two families is **type** (`text-story`
at looser leading against the tooling steps), **measure** (`--container-reading`
against the shell's width), and **chrome**: the story surfaces carry no border
and no panel background, so tool chrome cannot land on one by accident.

---

## 2. Two surfaces and an inspector

| Surface | What it is |
|---|---|
| **Play** | The modes' chat, scene and adventure views, plus the affordances that make starting and managing a story quick (§2.2) |
| **Library** | Actors, lorebooks, treatments, setups, presets, packages — one panel per kind (§5), browse, edit, organise, import, export |
| **Workbench** | Not a surface. An inspector panel that expands over whichever of the two you are in — §3 |

Plus the **reading view** (§12) — the story as prose, with the machinery
stripped. The workbench and the reading view answer opposite questions over the
same records.

**The workbench used to be listed here as a third peer, and is not one.** The
demotion is in navigation only, and the distinction matters because this section
previously ran the two together: *"'Peer' is a design-process claim as much as a
layout one."* The design-process claim stands and is the important half — the
workbench gets designed in the same pass as Play, not retrofitted once Play
works. Both source projects that have workbench-ish features arrived at them as
debug panels (Marinara's Injections tab is gated behind Debug mode; Aventuras'
`retrievalSnapshot` is annotated *"Diagnostic only — nothing reads it back"*),
and that origin shows.

What does not survive is the layout claim. §3 defines the workbench as **a
reader** over records that already exist, which means it has no state of its own
and no standalone entry point: its subject is always whatever you are currently
looking at. Reaching it as a place meant re-selecting a session and a turn you
had *just* selected in Play — [§1.1](#11-density-and-the-aesthetic-position)'s
*"depth is a cost paid for by the user, and it is charged per visit"*, charged to
arrive somewhere you already were.

### 2.1 The library is the model; play is the product

The division of labour between the two surfaces, stated because it decides a
long list of smaller questions and was being re-derived at each one.

> **The library represents the objects as they are. Play is where the
> conveniences live.**

**The library is a near-raw view of the data and the files.** Real kind names,
real field names, the folder path, nothing invented to be friendlier. This is
already half-written: §5 calls the legible disk layout *"a rare case where
exposing the storage mechanism is the feature"*, and §1.1 names the audience as
people who *"run a server on their own LAN, hand-edit an object folder in a text
editor and enjoy it."* The library is the surface that audience is for.

**Play carries the player-facing ergonomics** — quick setup, resuming, managing a
story in flight, and eventually grouping sessions that share a continuity
([14 §2d](14-roadmap.md)). Someone who wants to *play* should never have to learn
the object graph to do it, and someone who wants to *author* should never have to
see through a friendly label to find out what they are editing.

**What this replaces.** An earlier draft answered "eight kinds is a lot to arrive
at" with a translation layer over the model — a *Worlds* panel for the Treatment
kind, a *Games* panel for Setup. That layer is what produced a long naming
argument whose only stake was being friendlier than the schema, and it put the
teaching burden on the surface least suited to carry it. The kinds are now named
what they are, and the teaching moved to Play, where the ladder is learned by
using it rather than by reading a shelf.

**Three boundaries keep this honest:**

- **Raw is not undesigned.** §1.1's warning applies with full force: *"density
  and noise are different, and the difference is entirely in whether the layout
  has a structure you can learn."* A faithful rendering of a three-hundred-entry
  lorebook with a two-tier budget does not explain itself merely because nothing
  was hidden. Raw means no invented vocabulary, no hidden fields, no lossy
  summary — it does not mean no information architecture.
- **Browse and inspect are raw; editing is assisted.** §11 is emphatic that
  editors are not dumb forms, and field assist (§11.1), provenance (§11.2) and
  version history (§11.2a) all live library-side. None of that is in tension
  here: fidelity is a claim about what the surface *shows*, not about how little
  it helps while you change it.
- **Play's conveniences emit ordinary objects.** A quick setup that creates a
  Treatment creates a real one, in the library, in a folder, indistinguishable
  from a hand-written one. Never a parallel play-side store — the same
  discipline [14 §2c.1](14-roadmap.md) puts on the story bible, and the same
  instinct already behind *"emit a Setup from this running session"*
  ([02 §7.1](02-data-model.md)).

**What the two claims cost each other, since they pull in opposite directions.**
A raw library and an inspector panel both supply fidelity, and it would be easy
to end up with two answers to one question. They divide by depth: the library is
faithful in its *structure* — the kinds, the names, the links, the paths — and
the panel supplies the *contents* on demand, at any depth, anywhere. Neither
substitutes for the other, and the panel is what allows the library to stop short
of rendering raw JSON in a browse list.

### 2.2 Home, and what arrival is for

Play and Library are where work happens. Neither answers the question a person
actually arrives with, which is not *"find me a thing"* but **"what is this, and
what was I doing?"**

**Home is the arrival point, and it is not one of the two.** It owns no
editing, computes nothing of its own, and every element on it is a link into a
surface that does the real work. What it holds, in order of how much it matters:

1. **Resume.** The overwhelmingly common reason to open the app is to continue
   something. Recent sessions, straight back into the reading surface.
2. **Start.** The kinds you actually start from — a Setup above all — as entry
   points. Starting a game is what someone with nothing in progress is trying to
   do, and Play is where §2.1 puts that convenience.
3. **Notice.** Shadowed objects, failed loads, anything the watcher flagged —
   already visible per-object, and here made countable.
4. **Recent work.** The bridge back into whatever was half-written yesterday.

**The library does not own arrival.** It is where you go to find a thing you are
already thinking of, which is a different question, and answering the first with
the second is how an app ends up opening on a list of everything you own. This
matters more once the library is per-kind panels (§5): there is no single list
left to land on, and picking one kind arbitrarily would be worse than the list
was. See [polish §5](workplan/09-polish.md) for the build-level detail.

---

## 3. Workbench — the inspector panel

The turn record ([02 §8](02-data-model.md)) is designed to be displayed. The
workbench is its viewer and editor, and because the record is complete and
persistent, the workbench is a *reader*, not a second implementation of the
assembler. That is the whole trick.

**It is a panel, not a place** — the browser-devtools shape, and for the reason
devtools has it. A reader holds no state of its own; its subject is whatever is
in the main view. So it expands *over* Play or Library rather than being
navigated to: one keyboard toggle, docked to a side or the bottom, remembering
open-or-closed and its size across navigation so it can be left open while you
work. §2 records why this is a demotion in layout only.

**Never gated behind a debug mode.** This is the specific failure §2 names in
both source projects, and a panel is the shape that most invites it. The
workbench is a first-class designed surface that happens to be summoned rather
than visited; the moment it needs switching on, it is back to being the thing
whose *"origin shows"*.

**Its subject follows the main view.** Over a turn in Play it shows the record
below. Over an object in the Library it shows the raw truth of that object — the
JSON as stored, the folder path, provenance, version history, the index rows —
which is the depth [§2.1](#21-the-library-is-the-model-play-is-the-product)
deliberately keeps out of a browse list.

What it shows for any turn, current or historical:

- **The block list**, in order, each with source, inclusion reason in plain
  language ("keyword match: *cathedral*", "sticky, 2 messages remaining", "party
  location == Rain City"), token cost, and included/dropped with the rule
  responsible. Marinara's `LorebookActivationSource` and its budget skip-reason
  reporting already produce most of this data
  ([02 §3.1–3.2](02-data-model.md)); the workbench is where it stops being an
  amber notice in a popover and becomes the primary view.
- **The budget verdict** — what the ceiling was, what was spent, what got
  dropped and what would drop next. "What is about to fall out of context"
  should be answerable *before* it happens.
- **The calls** — one per model call, with parameters, model, and the actual
  messages. Multiple calls for `per-actor` dispatch and for steps.
- **The effects** — proposed channel changes, which applied, which failed
  validation, which were overridden by an engine-computed rule.
- **Cost** — tokens and wall time for *this turn*, itemised by call, so "agents
  cost extra" is a number rather than a documentation note. This is displaying a
  field the record already holds. **Aggregate spend tracking is post-1.0**
  ([14 §3](14-roadmap.md)) — the people running this at the development stage
  are power users who already monitor their provider usage, and a usage
  dashboard is a very nice feature that is not core functionality.

What it lets you do:

- **Edit a block and re-run.** Marinara already does the important half of this:
  editing a saved agent snippet "changes only what is used when you regenerate
  that same reply. It does not change the reply already on screen." That
  separation is correct and should be preserved. Re-running follows the same
  rewrite/reroll distinction as an ordinary swipe
  ([07 §14.5](07-tech-stack.md)) and defaults to **rewrite** — editing a block
  is changing the input, not asking for different luck.
- **Diff two turns**, or the same turn before and after a preset change. The
  cheapest possible answer to "it got worse and I don't know what I changed".
- **Promote a dry run.** Assemble without sending, inspect, adjust, then send.
- **Keyword test, generalised.** Marinara's keyword-test panel — paste sample
  text, see which entries would fire — is excellent and currently applies to one
  lorebook's keyword rules only. As a workbench feature over the whole assembly,
  against a real session's channel state, it covers every activation source.

**[RESOLVED] What belongs in Play persistently versus in the panel.** The old
question was "a persistent affordance versus a separate view", and the answer was
"something minimal, clickable through to the full record." The panel makes that
concrete without the trip: Play keeps one always-visible signal — a context-fill
meter — and clicking it opens the panel in place, already on the current turn. A
full workbench beside every message is still not the answer; a full workbench one
keystroke behind every message is.

**Two of the features above do not fit a panel, and should not be forced into
one.**

- **Diff two turns** is inherently two-subject, and a panel scoped to what the
  main view is showing has one subject by construction. Comparison escalates to a
  full view. Devtools has the same seam and draws it the same way — inspection is
  a panel activity, profiling is not.
- **Promote a dry run** mutates rather than reads. It stays, because §3's
  rewrite-versus-reroll scoping already makes it safe, but a panel that changes
  things has to say so more loudly than a read-only one would: dry-run state is
  visibly pending until sent, and *edit a block and re-run* announces which turn
  it is about to rewrite.

**On a phone, the panel is a sheet.** §1 commits to a usable phone layout, and a
dock is a desktop metaphor. Same content, same toggle, full-height sheet over the
main view — which is also the honest admission that on a phone the workbench *is*
briefly a place, because there is no room for it to be anything else.

---

## 4. File access as a permission level

**Deprioritised. Experimental at best, and on the roadmap rather than in 1.0
([14 §3](14-roadmap.md)).** The reasoning below stands and the feature is still
wanted; what changed is its position. Import and export UIs exist for a reason,
in-app library management matters more, and a file-management UI is a
disproportionate amount of surface — and of risk — for something most people
will never open.

**Two things survive the deprioritisation and should still land at 1.0:**

- **The capability field** ([04 §4.2](04-server-multiuser-deployment.md)) and the
  **single audited path-resolution helper** ([07 §9](07-tech-stack.md)). The
  helper is needed by every filesystem-touching route regardless, and having one
  from the start is the difference between a security property and a hope.
- **Hand-editing on disk keeps working**, because that was never about the UI.
  §4.1's forcing function is unaffected: if editing a file on disk does not
  reflect without a restart, the storage design has failed on its own terms.
  Someone with shell access still gets everything; what is deferred is the
  in-browser route to it.

The requirement, restated: since the data directory is the system of record and
is human-navigable by design ([02 §5](02-data-model.md)), a user with an account
on the server but no shell on the box should be able to reach their own files
*through the web UI*.

### 4.1 Why this fits rather than fights the architecture

It looks like a scary feature and mostly isn't, because of a decision already
made elsewhere: **the SQLite index is derived and rebuilt from a filesystem
watcher.**

That means a hand-edited file is not a special case. Something changed on disk,
the watcher notices, the object is re-parsed and re-indexed. There is no "the UI
wrote it so it's trusted / the user wrote it so it's suspect" distinction — both
end up as bytes on disk, re-parsed by the same loader and validated by the same
schema. A file browser is a view onto the truth rather than a back door around
it.

**Precisely:** the server indexes its own writes synchronously and the watcher
handles foreign ones ([02 §5.1.1](02-data-model.md)), so the two do not share a
*code path* — they share the loader, the schema and the index. That is the part
that matters here, and it is what makes hand-editing safe rather than merely
tolerated. Hand edits are the watcher's actual job rather than a side effect of
it.

The corollary is that the feature is nearly free *if* the watcher path is correct,
and impossible to add safely if it isn't. Which makes it a useful design forcing
function even before it ships: **if hand-editing a file on disk doesn't work,
the storage design has already failed** on its own terms.

### 4.2 The permission

```ts
type FileAccess = "none" | "read" | "write"
```

One of the named account capabilities
([04 §4.2](04-server-multiuser-deployment.md)), admin-granted, default `none`.
Scoped roots, resolved and enforced server-side:

| Root | `read` | `write` |
|---|---|---|
| `/data/users/<own handle>/library/` | yes | yes |
| `/data/users/<own handle>/sessions/` | yes | yes |
| `/data/users/<own handle>/memories/` | yes | yes |
| `/data/users/<own handle>/account.json` | **never** | **never** — §4.2.1 |
| `/data/users/<own handle>/connections/` | never (listing only) | yes |
| `/data/system/library/` | yes | never — app-shipped, and an update would overwrite edits anyway |
| `/data/system/connections/` | **never** | never — system connections are usable, not readable ([04 §4.5](04-server-multiuser-deployment.md)) |
| `/data/users/<other>/` | never | never |
| `/data/config.json`, `/data/index/`, operational state | never | never |

**Content roots, not the whole user directory.** An earlier draft rooted this at
`/data/users/<own handle>/` and reasoned that everything in it is theirs to
break. That was wrong, and §4.2.1 is why.

#### 4.2.1 `account.json` is not content

It lives under the user's own directory ([02 §5.1](02-data-model.md)) and holds
`role: "admin" | "user"` alongside the password hash
([04 §4.2](04-server-multiuser-deployment.md)). Rooting file access at the
directory therefore handed **any user with `fileAccess: "write"` a one-line path
to `role: "admin"`** — and admin is what gates extension installation and the
system connection scope ([04 §4.5](04-server-multiuser-deployment.md)).

That is worth naming precisely rather than filing under "not a security
product". [00 §4](00-stance.md) says multi-user is access separation among people
who trust each other, and that stands — it means we do not defend against a
determined attacker on the LAN. **It does not mean a documented feature should
hand out privilege escalation**, because the failure is not an attack, it is a
household member idly editing a file and acquiring the ability to install code.

The fix is the table above: file access is scoped to **content and session
roots**, and account, credential, job and operational state are outside it.
`account.json` is reached through the account API, which can enforce that a user
may change their display name and password and not their role.

**The general rule this establishes**, since more operational state is coming
([13 §5](13-internal-contracts.md)): *the file browser exposes what the user
authored, never what the server decides with.* Anything the engine reads to make
an authorisation or scheduling decision is out of scope by construction, and new
files under the user directory are excluded by default rather than included by
default.

Two exclusions worth stating explicitly, both about credentials:

- **The user's own `connections/`** is within their writable root, which is
  defensible — they are that user's own keys — but the file browser should still
  refuse to *display* the contents, so a shoulder-surfer or a screen share does
  not reveal a key the UI otherwise only ever shows masked.
- **`system/connections/` is excluded outright**, and this is the one place the
  system scope is *not* readable the way `system/library/` is. System
  connections are usable, never readable
  ([04 §4.5](04-server-multiuser-deployment.md)) — an admin who wants to inspect
  one has shell access to the box, which is the right gate.

### 4.3 What it is, concretely

A file manager: tree, upload, download, rename, move, delete, and a text editor
for the JSON kinds with schema validation on save. Plus — the actually
useful part — **download a folder as a zip** and **upload a zip into place**,
which is the drag-and-drop export/import story working through a browser for
people who can't reach the disk directly.

Notably *not*: executing anything, following symlinks out of the roots, or
touching binary card payloads with a text editor (offer download/replace
instead).

### 4.4 What it costs

Honest accounting, because the user is right that this is a pain:

- **Path handling is where this class of feature always breaks.** Every path
  must be resolved to a real path and re-checked against the allowed roots after
  resolution, symlinks that escape rejected, and `..` handled by resolution
  rather than by string inspection. Windows adds ADS, reserved device names, and
  case-insensitivity to the list. This is well-understood but unforgiving, and it
  wants one audited helper that every route uses rather than per-route checks.
- **Users will break things.** A malformed lorebook, a card PNG with a corrupt
  chunk, a deleted folder a session was seeded from. The answer is that
  validation failures are *visible and inert*: the object appears in the library
  flagged invalid with the parse error shown, and nothing crashes, hides it, or
  silently rewrites it. That behaviour is needed anyway for hand-edited-on-disk
  files and for imports, so the file browser doesn't create the requirement.
- **Upload is an attack surface** even among trusted users: size limits, no
  archive traversal on zip extraction (`zip-slip`), no execute bits, and content
  sniffing rather than trusting extensions.
- **It is not a 1.0 feature.** Recommendation: define the permission field and
  the scoped-root helper in the initial auth work so the shape exists, ship
  read-only download-and-zip early because it is cheap and immediately useful,
  and defer write and the text editor to 1.x.

**[OPEN]** Whether `write` should require re-entering the password, the way
admin actions sometimes do. Probably overkill given the threat model in
[04 §4.1](04-server-multiuser-deployment.md), but worth one conversation.

---

## 5. Library

Browse, search, tag, folder, favourite, filter, bulk select, import, export,
duplicate. All three sources converged on roughly this and there is no reason to
be inventive.

Where it should differ:

- **One library, one panel per portable kind.** Not one merged list with a kind
  filter. ("Portable" as in exportable ([10 §1](10-schemas.md)); libraries
  themselves are per-user and nothing is shared between accounts on one
  install.) **The kinds
  are distinct on purpose and the browsing surface should say so.** An Actor is
  deliberately not a prompt configuration file ([00 §2.4](00-stance.md));
  personas and NPCs are flags on one kind rather than separate types
  ([02 §2.2](02-data-model.md)); Treatment and Setup are split because conflating
  them is the mistake every source made ([10 §7](10-schemas.md)). A single
  undifferentiated table puts that mush straight back, at the exact moment a
  user is forming their model of what these things are — and it is also the one
  view where no column but *Kind* can be load-bearing, because an actor, a
  lorebook and a preset share almost no attributes. Per-kind panels can carry
  the columns, sort and empty state that each kind actually wants.
- **What is being rejected is separate implementations, not separate panels.**
  This section used to say *"not five panels behind five buttons"*, and the
  objection underneath that phrasing stands: list widgets that drift apart, a
  search box per kind, a different set of bulk actions in each — a real failure,
  and the reason "one surface" got written in the first place. **Shared
  handling, distinct surfaces** — one list component, one set of badges,
  filters, sorting and bulk actions, one detail route, one import and export
  path. The panels are presentations of one library, not six libraries.
- **The user's library and the system library render as one list**, with a
  source badge and a filter, not as two panels. This is a *scope* merge, not a
  kind merge, and it survives the bullets above intact: within an Actors panel,
  yours and the system's appear together. Hunting in two places to find a
  character is worse than a badge. Read-only system objects show a **Copy to my
  library** action in place of edit — which forks a real copy they own
  ([04 §4.3](04-server-multiuser-deployment.md)). Objects link across kinds constantly and the
  cross-links should be navigable inline.
- **A mixed all-kinds list is a preference, off by default — and really it
  belongs to search.** There is a genuine use for one list of everything, but
  its organising principle is a query rather than "everything you own": a search
  result set is a mixed list nobody has to be taught to read. FTS5 is already in
  the stack for library search ([07 §7.1](07-tech-stack.md)). So *browse* takes
  a kind and *find* does not, and the unfiltered browse view is kept as a
  machinery-visible preference alongside the rest of them. None of this is a
  contract change: the API goes on accepting an absent kind
  ([api.md](../api.md)), because cross-kind queries are a real thing to want.
- **Links are visible and bidirectional.** From a lorebook: which treatments,
  actors and packages reference this. From an actor: which lorebooks it links.
  Missing links show as missing, inline, non-blocking ([00 §3.3](00-stance.md)).
  **Specified in §5.2** — the inbound direction carries a relationship the
  schemas deliberately leave unencoded, so it is not left to the page.
- **The disk layout is legible.** Since the folder *is* the object, show the path
  and — for users with file access — link straight into the file browser at that
  location. This is a rare case where exposing the storage mechanism is the
  feature: it is how a user learns that drag-and-drop export works at all.
- **Export produces one file**, not a folder the user has to zip themselves
  ([02 §5.2.3](02-data-model.md)) — singly and in bulk. On disk everything stays
  a folder; the single-file form exists for exchange only.
- **Import is a review step, not a modal that dumps.** Show what was recognised,
  what went to `compat`, what resolved, what dangled, and let the user fix it
  before committing.

### 5.1 Eight kinds is a lot to arrive at — and the library is not where that gets solved

Worth stating as a presentation position, because the data model does not solve
it and pretending otherwise is how it gets ignored.

[02 §1](02-data-model.md) defines eight persistent kinds. Someone arriving from
SillyTavern has priors for exactly two of them — a character card and world info
— and no prior at all for Treatment, Setup, Preset or Package. Every one of those
splits is *correct* and none should be undone; the Treatment/Setup split in
particular is what Marinara's own scenario design identified and never built
([10 §7](10-schemas.md)). But correct is not the same as learnable.

**The earlier answer here was a translation layer, and it is withdrawn.** This
section used to rename the panels — *Worlds* for Treatment, *Games* for Setup —
on the grounds that those were the words people already use. Three things went
wrong with it. It put the teaching burden on the surface least able to carry it,
since a browse list can let someone *move through* eight kinds without helping
them *understand* eight kinds. It made the label a load-bearing design decision,
which produced a long argument whose only stake was being friendlier than the
schema — and produced a *wrong* label, because *Worlds* sat next to *Lorebooks*
while the world lived in the lorebook. And it cost the one property the library
is actually for: saying plainly what the thing on disk is called.

**So: the panels are named for the kinds.** Actors, Lorebooks, Treatments,
Setups, Presets, Packages — six panels, no demotions, no presented subset, real
names. Per [§2.1](#21-the-library-is-the-model-play-is-the-product) the library
is the model, and a model with a friendlier alias for two of its six types is not
a model.

**The teaching moves to Play**, which is where it belonged. The ladder —
*Rain City* the lorebook, *Rain City, noir* the treatment, *The Fixer's Debt* the
setup — is learned by starting a second game under a treatment you already have,
which makes the one-to-many self-evident and needs no explanation at all. That
was always the good half of the old argument; it just was not a library feature.
Setup flows (§6) and Home's *Start* (§2.2) are the surfaces that carry it.

**Six panels rather than a collapsed three** is deliberate and unchanged, and it
follows from §1.1: density is the position, so the answer to "this is a lot to
arrive at" is a shelf that shows every kind legibly, not one that shows three and
hides the rest behind a mode. Folding Lorebook into Treatment would also mean one
panel with two kinds in it — the merged-list problem in miniature, applied to the
pair most often confused. **Marked as *for now*:** six is the shape to build
against, and the simple/advanced-versus-rearrangeable question in §1.1 is where
any reduction should be settled, not here.

**What this is not:** a data model change, not a merged type, and not a merged
surface. Nothing about the storage, the schemas, the panels or the export
boundaries moves. What changes is that the library stopped trying to be an
onboarding surface, and Play picked it up.

### 5.2 The backlink panel, specified

The §5 bullet says links are visible and bidirectional. That is understated: the
inbound view is not a convenience on a detail page, it is **the surface that
carries a relationship the data model deliberately does not encode**, and it
should be specified rather than left to whoever builds the page.

A Treatment links lorebooks and never the reverse ([02 §4](02-data-model.md)) —
which is what allows many treatments over one lorebook, and many lorebooks under
one treatment. The cost of that freedom is that a lorebook, on its own, looks like
an orphan: nothing in the file says *Rain City is played three ways*. The
recurring proposal that follows is to fold Treatment into the lorebook as a child
array. It is refused for the reasons in [02 §4](02-data-model.md), and this
panel is what pays the refusal off — the cohesion the fold was reaching for,
delivered as a view, where it costs no schema.

**On a lorebook's page, a *Used by* section.** Grouped by kind, treatments first
and rendered as cards with their `blurb` rather than as table rows, because
"the three ways to play this world" is the thing a person came to see and a row
in a list does not read as one. Actors, setups and packages follow as ordinary
rows.

**With a *New treatment on this world* action in that section**, creating a
Treatment prefilled with a `LoreLink` to this book. This is the affordance the
primary-lorebook relationship would have bought ([06 B2](06-open-questions.md)),
without buying the relationship: authoring flows from the world you are looking
at, and the result is still an independent object linking N books.

**The reverse page is not symmetric, and should not be.** A treatment's page shows
its lore links as *outbound* — ordered, `required` marked, editable — and its
setups as inbound. Same data, two different jobs: outbound is a thing you
arrange, inbound is a thing you discover.

**Dangling references render in place**, named, non-blocking, with a resolve
action — [00 §3.3](00-stance.md), applied to whichever direction the break shows
up in.

**It costs no new machinery.** The derived index answers "which treatments link
this lorebook" already ([02 §5.1](02-data-model.md)); this is the third consumer
of one query, alongside the delete confirmation's reference counts
([02 §10.1](02-data-model.md)) and the package closure
([10 §9.1](10-schemas.md)). Anything that makes the index cheaper or staler is
therefore a decision about all three at once.

---

## 6. Setup flows

Both sources use wizards and both wizards are good. Worth taking:

- **From Aventuras:** the seed → AI expand → edit → accept loop for treatment
  creation, including `useSettingAsIs()` — the escape hatch that skips expansion
  entirely. The expansion is an assist, not the path.
- **From Marinara:** every step but the first has a working default, and the
  wizard is skippable into the settings drawer. "Only the connection is
  required" is the right bar.
- **From Marinara:** the immutable setup snapshot, so a good combination can be
  shared *after* playing rather than by remembering to record it beforehand. Here
  it is stronger, because the snapshot is a real **Setup** object
  ([10 §7](10-schemas.md)) rather than a text file — editable, re-runnable, and
  shareable by dropping it in a package.

Where it differs: **the wizard is declared, not coded.** `ModeDefinition.setup`
([03 §2](03-modes-and-turn-pipeline.md)) is a schema the shell renders, so an
extension mode gets a first-class setup flow without writing UI. Aventuras' pack
`CustomVariable` — typed, enum options, required flag, defaults, sort order, help
text — is a working precedent and close to the right vocabulary.


**This is also where the object ladder gets taught**, per
[§5.1](#51-eight-kinds-is-a-lot-to-arrive-at--and-the-library-is-not-where-that-gets-solved).
The library names the kinds and explains none of them; the wizard is what makes
the relationships legible, because it walks them in order and in context — this
lorebook holds the world, this treatment is how it is being handled, this Setup
is the game you are about to start. The moment that does the real work is
starting a *second* Setup under a treatment already in the library: the
one-to-many becomes self-evident and needs no copy written for it. So the flow
should make that second start cheap and obvious rather than treating every game
as a fresh trip through six steps.

---

## 7. The assistant surface

Specified in [03 §7.4](03-modes-and-turn-pipeline.md), which covers why it is a
session rather than a bespoke thing. The UI side:

- **Summonable from anywhere**, including mid-session, without losing your
  place. A panel rather than a route — the same shape as the workbench (§3), and
  for the same reason: it acts on what you are looking at, so navigating away
  from that to reach it is backwards.
- **Two scales of help, deliberately distinct.** The in-editor field assist
  ([§11](#11-editors-are-not-dumb-forms)) is for *this field*; the assistant is
  for "help me work out what I'm doing". Both should exist and neither should
  try to be the other — a refine box that opens a chat is annoying, and an
  assistant that can only rewrite one field is useless.
- **Starter prompts on an empty assistant**, per Marinara's suggestion chips.
  The gap between a blank input and knowing what to ask is most of why in-app
  assistants go unused.
- **Proposed changes render as diffs**, reviewed and applied explicitly, never
  written silently.
- **Show what it can see.** The ambient context — which actor is open, which
  session you came from — belongs on screen, not just in the turn record.

---

## 8. Extension-contributed UI

Resolved here because it is what decouples the frontend framework choice from
everything else (see [07 §6](07-tech-stack.md)).

**Extensions do not ship UI components.** They declare widgets from a versioned
vocabulary that the host renders: HUD widgets, side panels, message decorations,
input-bar actions, setup form fields, library columns. Marinara's HUD widget
specs and Aventuras' `RuntimeVariable` display metadata (colour, icon, pinned,
min/max) are both evidence that the declarative vocabulary covers the real cases.

This buys three things: extensions cannot break the app's rendering, the
frontend framework stays a reversible decision, and an extension written today
still works after a framework upgrade.

### 8.1 Custom rendering: deferred as far as it will go

An extension that genuinely needs to draw something — a map, a card table, a
graph — has no route under the vocabulary. The obvious answer is a sandboxed
iframe with a narrow `postMessage` protocol.

**Decision: push this as far into the future as it will go.** Not "not yet"
in the sense of being next; in the sense of doing everything possible to avoid
needing it.

**It is painful for everyone it touches, which is the real argument:**

- **For us** — a message protocol, and then *versioning* that protocol; theming
  across the boundary so an extension does not look pasted in; focus management,
  keyboard handling and accessibility, none of which cross an iframe for free;
  mobile layout; and a second security surface to reason about.
- **For extension authors** — they stop declaring a widget and start maintaining
  a small application, with a build, a bundle and their own styling problem.
  Most people who wanted to add a HUD field will not do that.
- **For users** — inconsistent surfaces, theming that breaks in one panel,
  things that work on desktop and not on a phone. The declarative vocabulary
  exists precisely so extensions inherit the app's look rather than approximating
  it.

**The paired commitment matters more than the deferral.** Deferring the escape
hatch is only honest if the vocabulary keeps growing: every widget type added is
one fewer reason to reach for an iframe. Concretely, when an extension cannot
express something, the *first* response is to ask what widget would let it —
a gauge, a grid, a small table, a timeline, a picker — and add that. Widening a
declarative vocabulary is cheap, benefits every extension at once, and keeps the
result consistent.

**The signal to build it anyway** is a genuine class of thing the vocabulary
cannot reach without becoming a rendering engine in disguise. Tactical combat and
anything map-shaped are the likely triggers ([14 §4.3](14-roadmap.md)) — and
both are things we have already decided not to build ourselves, so the pressure
would be coming from outside, which is the right kind of evidence to act on.

What must **not** happen is the vocabulary quietly acquiring an `html: string`
field. That is the escape hatch arriving without any of the safety, and it is
how this decision would be undone by accident rather than on purpose.

---

## 9. Turn status, notification, and sounds

**The live turn view is the turn record being written**
([04 §3.3](04-server-multiuser-deployment.md)) — the same component that renders
a finished turn in the workbench, fed by progress events instead of a file. A
collapsed line while things go well; expanded, the whole chain with per-step
timing, what each step contributed, what was skipped and why, and any failure
attached to the step that produced it rather than to the turn.

That is deliberately more verbose than either source: Marinara names a failed
agent, Aventuras emits phase events as diagnostics, and neither lets you watch
the chain. It costs nothing extra because the record already carries it.

The rest is the client half of [04 §3](04-server-multiuser-deployment.md). Routing is
server-side; the client renders sound, toast, unread badges and the document
title.

- **Distinct sounds per event class**, not one generic chime. Turn-complete,
  message-received, awaiting-input and failed should be tellable apart from
  another room — which is the entire point of having a sound rather than a
  toast. Per-class volume, a global mute, and a start-muted preference
  (Marinara's, worth copying).
- **Prime the audio on first interaction.** Browsers block audio until a user
  gesture has occurred, so the *first* completion sound after a page load is
  silently dropped unless an audio context was unlocked by an earlier click.
  This is a well-known trap that presents as "sounds work sometimes", and the
  fix — unlock on the first interaction of the session — has to be deliberate.
- **Suppress what is already visible.** A toast for a message rendering in the
  session you are looking at is noise. The sound is still wanted; the toast is
  not.
- **Unread state belongs to the server**, so it survives a reload and is
  consistent across a phone and a laptop open at once. Marinara's floating
  avatar bubble for a message in an unviewed chat is a good pattern, and it
  collapses on mobile rather than stacking.

**[OPEN]** Whether per-actor notification sounds are worth it in Messages mode —
knowing *who* messaged without looking is genuinely useful, and it is one more
thing to configure per card.

---

## 10. The guidance box

Every session input carries an expandable guidance box, collapsed and empty by
default, specified in [03 §5.1](03-modes-and-turn-pipeline.md). It is the
supported place for "keep this short", "focus on Vera's reaction", "don't
resolve the fight yet" — the meta-instruction people currently smuggle in as
`(OOC: …)` inside their action.

UI notes:

- **Collapsed by default, and visibly empty when collapsed.** A guidance box
  that silently retains last turn's text becomes a standing instruction by
  accident, which is exactly what [03 §5.1](03-modes-and-turn-pipeline.md) says
  it must not be. Clear on send.
- **[OPEN]** Offer the previous guidance as a one-click refill. Convenient for
  repeated nudges, and one step from the accidental-standing-instruction
  problem. Probably worth it as an explicit recall action rather than a
  persisted value.
- **Show it in the turn record.** It was an input to that turn and belongs in
  the workbench block list like any other, marked advisory.
- **The `advisory` marker should be visible**, not just internal. A user typing
  "she fails the check" into the box should be able to see that this text
  reached the narrator and not the resolver — otherwise the guarantee in
  [03 §5.2](03-modes-and-turn-pipeline.md) is invisible and nobody trusts it.

---

## 11. Editors are not dumb forms

A cross-cutting requirement, and one that has to be decided early precisely
*because* it is cross-cutting. Two capabilities belong to **every** editor in
the application, not to particular ones:

1. **Every text field can be generated, refined and reverted** — Aventuras'
   pattern, applied everywhere rather than only in the wizard.
2. **Every image slot can be generated, uploaded, cropped and replaced** —
   Marinara's in-UI crop, available wherever an image can appear.

Retrofitting these field by field produces exactly what all three sources have:
assistance in the two or three places someone got round to, and a plain textarea
everywhere else. They should be **primitives the editors are built from**, so
that "does this field have AI assist?" is never a question anyone asks.

### 11.1 The field assist contract

Four operations on any text field:

- **Generate** — write this field from nothing.
- **Refine** — rewrite it against a free-text guidance string. Aventuras'
  `refineSetting(guidance)` with its `settingElaborationGuidance` box is the
  model, and the guidance box matters: "make it darker" is the whole interaction,
  and without it the only recourse is regenerate-and-hope.
- **Revert** — back to the value before the assist ran, and separately back to
  the generated original after manual editing. Aventuras keeps
  `previousExpandedSetting` for exactly the first of these.
- **Accept as-is** — the escape hatch. Aventuras' `useSettingAsIs()` skips
  expansion entirely and takes the raw seed. Nothing may *require* a model call
  to proceed, ever.

**Context is the part that gets skimped.** "Generate an appearance" must see the
actor's name, summary, tags and the treatment it is being authored against. An
assist that receives only the field label produces generic slop and trains
people not to use it. The assist call therefore needs a context builder over the
object being edited and its links — which is a small, reusable thing, but it is
real work and it is why this must be a primitive rather than a per-field bolt-on.

### 11.2 Provenance, taken from Marinara

Marinara's scenario work already has the persistence half of this, and it is
right:

```ts
interface GeneratedFieldProvenance {
  original: string      // the generated value, JSON-encoded for non-string fields
  at: string            // ISO timestamp
  model: string | null
  seed: string | null   // the input the generation ran from
}
```

…stored as a map keyed by dotted field path (`"treatment.themes"`). Adopt it.

It buys three things, the third of which is the interesting one:

- Revert-to-generated after hand editing.
- Honest disclosure — "this was model-written, from this prompt, with this
  model."
- **A library-wide view of what is authored and what is machine-written.** In a
  library that has grown by generation, "which of these characters did I
  actually write?" becomes answerable. No source offers this, and it is a real
  trust feature rather than a novelty.

### 11.2a Version history, in every editor

Every library object keeps an edit history automatically
([02 §11](02-data-model.md)), and the editor is where it surfaces. Marinara's
character editor is the model here and the interaction is worth copying closely.

**A history panel listing revisions**, newest first, with the live object pinned
at the top as *current*. Each entry shows its authored date, the author's own
version string if set ([02 §11.5](02-data-model.md)), what made the change, and
its reason.

Four actions, three of them Marinara's:

- **Restore.** Non-destructive — restoring snapshots the current state first, so
  the thing you were on is one entry away ([02 §11.1](02-data-model.md)).
- **Rename**, which sets the entry's reason. History becomes useful when the
  entries are labelled *"before I rewrote her backstory"* rather than
  timestamped, and only the author can write that.
- **Pin**, so a version survives retention pruning
  ([02 §11.3](02-data-model.md)). The escape hatch that makes a cap acceptable.
- **Diff**, which is ours and nearly free. The workbench already diffs two turn
  records (§3); two versions of an object are the same problem with a simpler
  payload, and *"what actually changed between these"* is the question a list of
  timestamps cannot answer.

**The source badge is not decoration.** More things edit objects here than in
Marinara — a field assist, an extension proposal, an import that overwrote, a
hand-edit picked up from disk. *"Who changed my character"* has several possible
answers and this is where it gets one, which puts it squarely under
[00 §3.6](00-stance.md): the engine showing what it did, where it can be
corrected.

**Not shown by default.** The panel is behind a control, because the common case
is editing a character and not thinking about history at all. It should be
discoverable at the moment it is wanted, which is immediately after a bad edit —
so an undo affordance in the editor pointing at it is worth more than
prominence.

### 11.2b Lore galleries

Lorebooks and their entries carry images ([02 §3.6](02-data-model.md)), and the
editor is the only thing that reads them at 1.0.

- **The book gets a gallery**, one image designated as the library card's
  picture. Maps, establishing shots, style references for the world.
- **Each entry gets its own strip**, small and inline with the entry rather than
  behind a tab — the point is seeing the place while writing about it, and a
  gallery you have to navigate to is one you forget is there.
- **Role and tags are both editable**, and the difference has to read clearly:
  role is a short pick-list the software understands, tags are free text the
  author organises by. Getting this wrong in the UI produces tag soup in the role
  field.
- **No assist.** Generating a location image is a rendition
  ([03 §10](03-modes-and-turn-pipeline.md)) and wants providers, so it arrives
  with them and not before.

**Nothing here suggests the images are used.** They are not sent, and an editor
implying otherwise would be making a promise the engine does not keep — which
matters more than usual here, because it is exactly the assumption the schema
warns against.

### 11.3 Image slots

Wherever an image can appear — actor avatar, sprites, gallery, treatment cover,
lorebook entry art, package cover — the same four affordances: **upload,
generate, crop, replace.**

**Cropping is non-destructive at the editing layer.** Marinara stores a
normalised source rectangle rather than baking the crop into pixels:

```ts
interface SourceRectAvatarCrop { srcX, srcY, srcWidth, srcHeight }  // 0..1 of source
```

Normalised coordinates survive the source being resized or re-encoded, which is
the reason to prefer them over pixel offsets. Marinara also keeps a legacy
zoom+offset variant as a *render-only* compatibility path so old crops display
unchanged until re-edited — a good pattern to copy when this format inevitably
changes.

**One tension to resolve deliberately, because our storage decision creates it.**
[02 §5.2](02-data-model.md) makes `card.png` canonical *and* requires that
dragging it out yields a usable character in another tool. A crop stored only as
metadata means other tools render the uncropped source — often badly framed,
sometimes absurdly. That undercuts the interop commitment we already made.

So, for actor cards specifically:

- **The card's pixels are the cropped result.** That is what other tools will
  show, so it must be the portrait as intended.
- **The uncropped source is retained** in the actor's `assets/`, with the crop
  rectangle in the card JSON, so re-cropping is lossless and reversible.

Destructive for interop, non-destructive in substance. Cropping never costs you
the original.

### 11.4 An architectural note: not every model call is a turn

Everything up to here has assumed the turn pipeline is the only path to a model.
Field assists and image generation in the library are a **second call path**,
running outside any session, and that has three consequences worth stating
before they are discovered:

- **They need a connection**, and it should not silently be the chat one. This
  is what `ModelHint.role` ([02 §2.6](02-data-model.md)) is for — assist work
  wants the `fast` role, image work wants an image connection, and a household
  server needs those resolvable per user.
- **They cost money, and must be *recorded* even though nothing displays it at
  1.0.** Recording is nearly free and cannot be added retroactively — a spend
  view built later over data that was never captured shows nothing for the first
  year. So capture assist-call cost from the start and leave the aggregate view
  to [14 §3](14-roadmap.md).
- **They produce no turn record.** §8.2's provenance is the record, which is
  another reason it is not optional.

### 11.5 Traps

- **Never auto-generate.** Not on field focus, not on blur, not on opening an
  empty editor. User-initiated only. An editor that fills itself in is an editor
  people stop trusting.
- **Never block on the model.** Every field stays directly typeable while an
  assist is running or failing.
- **Refine must be cheap to reject.** One click back to the previous value, no
  confirmation dialogue.

---

## 12. The reading view

**A story should be readable as a story, at any point, without the machinery.**
Infinite Worlds does this well and it is the feature of theirs most worth
copying: the ability to produce a reading-oriented output whenever you like.

This is a **1.0 feature**, and a cheap one — every input already exists.

### 12.1 What it is

A path through the turn tree, rendered as prose. Narration and dialogue in
order, speaker attribution, scene breaks, images inline where a turn produced
them. Nothing else: no blocks, no budgets, no costs, no step timings, no channel
state.

**It is the opposite of the workbench, and deliberately so.** The workbench
answers *why did the engine do that*; the reading view answers *what happened in
the story*. They read the same turn records and share nothing else, and neither
should drift toward the other.

- **Any node, not just the head.** Read the current path, or a branch you
  abandoned, or the story as it stood forty turns ago.
- **Live, not an export step.** Openable at any time on any session, including
  one still in progress.
- **Renditions inline**, where they exist ([03 §10](03-modes-and-turn-pipeline.md)).

### 12.2 Formats, and not shipping a PDF library

**HTML with a real print stylesheet, plus Markdown and plain text.**

That covers PDF without any PDF code: a clean printable page means the browser's
own print-to-PDF produces a good result. Shipping a PDF renderer would be real
weight — fonts, pagination, layout — for an outcome the platform already gives
away. If PDF ever needs to be produced *server-side*, headless-browser printing
is the next step, and still not a PDF library.

Markdown matters for a different reason: it is what someone pastes elsewhere,
and it round-trips into every other tool people already use.

### 12.3 Not the same thing as session export

Worth separating before they get conflated:

| | **Reading view** | **Session export** ([06 B12](06-open-questions.md)) |
|---|---|---|
| For | A person to read | Another install to load |
| Fidelity | Lossy by design — the machinery is stripped | Lossless |
| Ships | 1.0 | Eventually, not early |

The reading view being lossy is the point. An export that dropped the turn
records would be broken; a reading view that included them would be unreadable.

### 12.4 Why it belongs at 1.0

Beyond being cheap: **"full readability and rollback" is the pair that makes a
long session feel safe.** Rollback is branching ([09](09-branching.md)) — you can
always go back. Readability is this — you can always see what you have. Together
they are what makes someone willing to commit two hundred turns to a story, and
either one alone is noticeably less reassuring.

---

## 13. Showing what the engine understands

The workbench (§3) makes the *prompt* legible. This section is the companion for
the play surface: making the engine's **understanding of the fiction** legible,
in place, without a detour into the workbench.

Two features, and they are the same feature seen from two angles. Both have an
obvious convenience justification and a better diagnostic one, and the
diagnostic is what earns them a place at 1.0.

Together with the workbench they are the three instances that made
[00 §3.6](00-stance.md) a stated principle rather than three coincidences — *the
engine's understanding is visible, and correctable*. What follows is that
principle applied to identity and presence.

**The observation behind both:** in Aventuras the bookkeeping layer gets
character identity wrong in ways the *model* usually gets right — one NPC
recorded several times, or several treated as one. That asymmetry is the useful
clue. It says the failure is in the application's tracking rather than in
generation, and a tracking failure nobody can see is a tracking failure nobody
can correct. The answer is therefore not a cleverer resolver. It is showing the
resolver's conclusions where the user is already looking.

### 13.1 Mentions: linked, and marked by confidence

Names of known actors are highlighted and linked to their cards, in both the
input box and the output.

The link is the small half — click through to a card, useful, unremarkable. The
half that matters is that **highlighting is the engine reporting what it
resolved.** A name that renders plain is a name the app does not know is a
character, and that is information the user currently has no way to obtain until
the world state is already wrong.

**The two failures it exposes are duals of each other:**

- **Splitting** — *Vera*, *Vera Kohl* and *the fixer* become three records of
  one person. Shows up as prose full of unlinked names.
- **Merging** — two characters collapse into one. Shows up as two clearly
  different people linking to the same card.

Neither is detectable today until something downstream behaves oddly. Both are
obvious at a glance once mentions are marked.

**Annotate, never rewrite.** Mentions are an overlay on the turn record —
`{ start, end, ref, method, confidence }` spans — and the message text stays
canonical plain prose with no markup injected into it. Editing a message
recomputes the spans; the reading view (§12) may render or drop them; a branch
inherits them with the turn. Same rule as renditions
([03 §10.7](03-modes-and-turn-pipeline.md)) and provenance (§11.2): the artefact
is annotated, the authored bytes are not touched.

**Three resolution methods, and they must look different:**

| Method | Source | Rendering |
|---|---|---|
| `explicit` | The user typed it with `@` | Certain — full-strength link |
| `matched` | Exact hit on `name` or `aliases` ([10 §4](10-schemas.md)) | Confident |
| `proposed` | Fuzzy, or a model-proposed resolution | **Visibly tentative**, clickable to confirm or reject |

Collapsing these into one appearance throws away the whole diagnostic value. A
tentative match that looks identical to a certain one is worse than no
highlighting at all, because it reports confidence the engine does not have.

**It never silently creates an actor.** This is precisely where duplicate records
come from: materialising a record on first mention, repeatedly, for the same
person under three names. So an unresolved capitalised name is an **offer** —
*create actor? link to an existing one?* — never a write. Model proposes, user
disposes, which is the channel policy ([03 §4](03-modes-and-turn-pipeline.md))
applied to entity resolution rather than a new principle.

**An unresolved mention is not an error.** Most names in prose are scenery, and a
UI that nags about every one is a UI people switch off. Visible, non-blocking,
ignorable ([00 §3.3](00-stance.md)).

**It shares the lorebook keyword pass.** `Actor.aliases` is already specified as
the default keyword set for lore matching ([10 §4](10-schemas.md)), so mention
resolution and lorebook keyword activation are scanning the same text for the
same strings. One pass, two consumers. Two matchers that can disagree about
whether *the fixer* means Vera is a bug waiting to happen — and the shared pass
also guarantees that the turn record's inclusion reasons and the highlighting in
the transcript tell the same story.

**Input side: `@` autocomplete over the cast.** The cheapest part and possibly the
most valuable. It produces `explicit` mentions, which are ground truth the other
two tiers can be measured against; it is a real disambiguation tool when two
characters could plausibly be *her*; and an explicit mention is a strong
activation signal for the assembler with no heuristics involved.

**Not in scope at 1.0:** extending this to locations, items and factions. The
span model generalises to any entity type and should be built so that it can,
but shipping actor mentions first keeps the surface honest — actors are where
the identity failures actually hurt.

### 13.2 The cast panel

Aventuras' character panel, adopted along with its state tracking, which the
requirement rightly values as much for confirming the software is following
along as for playing.

It lists the actors in the session with their current state, and it is the
natural home for per-actor model bindings under `per-actor` dispatch
([03 §3](03-modes-and-turn-pipeline.md)).

**Two axes, not one enum.** Aventuras' *active / inactive / dead* squashes
together two things that behave differently:

- **Presence** — in the scene right now. Volatile, changes several times a
  session, uninteresting historically.
- **Status** — alive, dead, departed, imprisoned. Durable, changes rarely, and
  each change is narratively significant.

One enum cannot say *dead but present* — the body in the room, the ghost, the
open casket — nor *alive, elsewhere, coming back*, which is the ordinary state of
most of the cast most of the time. Splitting them is nearly free now and
unpleasant to retrofit once sessions carry the squashed value.

**The UI still shows one badge**, derived from both axes, because a two-axis
matrix is the wrong thing to put in a sidebar. The split is in the data, not on
the screen.

**Presence and status are channels** ([03 §4](03-modes-and-turn-pipeline.md)),
model-proposed and engine-decided, which buys three properties with no new
machinery: changes are effects in the turn record, invertible at the tip and
otherwise revisited by branching ([13 §1.2.1](13-internal-contracts.md));
panel state is reconstructible at any node; and **a branch gets it right** —
someone dead on one line and alive on another is a requirement, not a bug, and it
falls out of effects being per-node ([09 §4](09-branching.md)).

**Party is a subset, not a second list.** The party already exists as a timeline
([03 §8](03-modes-and-turn-pipeline.md)). The panel marks party members
distinctly and introduces no parallel membership concept — a second source of
truth about who is in the story is exactly the class of bug this section exists
to surface.

**Death is asymmetric, and needs the goal-completion treatment.** Models kill
characters casually and in passing. A missed death is an annoyance corrected in
one click; a false one silently removes someone from the story, and every
subsequent turn is then assembled around their absence. So a proposed status
change to `dead` is surfaced prominently rather than applied as a quiet badge
change, and it is reversible from the effect log. Same reasoning as
[06 C12](06-open-questions.md), same bias: under-fire, and keep the manual path
always available.

**The panel must be editable, and this is what makes it worth building.** If it
is where the user sees the software's understanding, it has to be where they fix
it:

- **Merge** two records that are one person. Leaves a redirect rather than
  breaking references — turn records point at actor ids and history must not rot
  ([00 §3.3](00-stance.md)).
- **Split** one record being used for two people.
- **Correct presence and status** directly.
- **Link an unresolved mention** to an existing actor, which is §13.1's offer
  arriving from the other direction.

Read-only, the panel is a complaint the user cannot act on. Editable, it is the
repair surface for exactly the failures §13.1 makes visible — which is why the
two belong in one section rather than as unrelated features.

---

## 14. Searching your own story

**Find the moment.** *"Where did I first meet Vera."* *"What did she say about
her brother."* *"That inn, four sessions ago."*

Over six hundred turns this is the single most common thing a person wants from
their own history, and none of the three sources answers it well — SillyTavern
has no session search at all, and scrolling is the interface. It is also, given
this architecture, close to free: turns are on disk, the index is derived and
rebuildable, FTS5 is already in the stack for library search
([07 §7.1](07-tech-stack.md)), and the tree walk already produces reading order.

**Argued for 1.0** on the grounds that it is small, that it is a differentiator
on a dimension nobody competes on, and that the alternative — scrolling a
six-hundred-turn transcript — is the experience it exists to prevent.

### 14.1 Two scopes, one surface

- **Within a session.** The common case. Results as a list of turns with a
  snippet, jumping to that point in the transcript or the reading view (§12).
- **Across all your sessions.** *"Which story had the lighthouse in it?"* Less
  frequent, more delightful, and the same query with a wider scope.

Filters that fall out of data already recorded, at no extra cost: by speaker,
by input kind (`do` / `say` / `story`), by date range, and by whether the hit is
on the current path.

### 14.2 Branch hits are shown, and labelled

The one genuinely tricky part, and the answer follows an existing rule rather
than a new one.

Abandoned branches are still real history — [09 §6](09-branching.md) makes
discarded swipes permanently recoverable, which is a feature none of the sources
offers, and a search that pretends they do not exist throws it away. But
[09 §7](09-branching.md) is equally clear that content from a discarded line
must not surface as though it were current.

**So: hits off the current path are returned, visually distinguished, and
labelled with where they live** — *"on a branch you left at turn 214"* — with the
default filter set to the current path and one click to widen. Hiding them loses
real answers; showing them undifferentiated produces the worse failure of
someone acting on something that never happened in their story.

### 14.3 Why this and not embeddings

[06 E2](06-open-questions.md) puts semantic retrieval post-1.0 and aims it at
cross-session memory rather than at lorebooks. Text search is the complement, not
a lesser version of it:

- **The query is usually lexical.** People search for the name, the place, the
  phrase they remember. That is exactly what FTS is good at, and "cosine 0.71" is
  no more actionable here than it was there.
- **It is verifiable.** A hit contains the words you typed. A semantic near-miss
  cannot be distinguished from a semantic hit without reading everything, which
  is the problem you were trying to solve.
- **It costs no provider.** No embedding model, no re-embedding on edit, no
  network dependency, nothing to configure. It works on a disconnected LAN
  server on first boot.

If embeddings arrive, they extend this surface rather than replacing it — the
same results list, one more retriever behind it.

### 14.4 What it is not

- **Not a replacement for memory.** Search is what *you* do; summarisation and
  retrieval are what the *engine* does ([06 E1](06-open-questions.md),
  [11](11-cross-session-memory.md)). They meet at the index and nowhere else, and
  a search result never enters a prompt because a search happened.
- **Not full-corpus search over other people's libraries.** Per-user scoping
  ([04 §4.3](04-server-multiuser-deployment.md)) applies unchanged; the system
  library is searchable because it is readable, and another account's sessions
  are neither.

---

## 15. Administration, accounts and settings

**Written because four other documents already refer to "the admin screen" as
though it were specified.** [04 §4.5](04-server-multiuser-deployment.md) wants it
to say *"2 users have no usable connection"*; [04 §6.3](04-server-multiuser-deployment.md)
puts the restart control there; [04 §6.5](04-server-multiuser-deployment.md)
routes connectivity failures to admins; [04 §7](04-server-multiuser-deployment.md)
says the Source link must *not* be buried in it. The capability model
([04 §4.2](04-server-multiuser-deployment.md)) is enumerated and admin-granted
and never says where the granting happens. This section is that where.

**It is one surface with two halves**, not two surfaces. Everyone gets *Treatments*
about themselves; admins additionally get *Administration* about the install. One
route, one navigation entry, the admin half absent rather than disabled for
people who do not have it.

### 15.1 The user half: settings about yourself

Available to every account, admin or not.

- **Display name, and locale.** Both already on `Account`
  ([04 §4.2](04-server-multiuser-deployment.md)); locale defaults from
  `Accept-Language` on first login and this is where it stops being a guess.
- **Change your own password.** Requires the current one. **This is not account
  recovery** and does not weaken the position that there is none
  ([04 §5.1](04-server-multiuser-deployment.md)): it is a logged-in user
  rotating a secret they already hold. Someone locked out is still recovered
  from the console with `--reset-password`, which is the whole design.
  The form states *this install's* length rule
  ([04 §4.1](04-server-multiuser-deployment.md)) rather than a number this build
  carries, and reports a refusal against the same number — the two used to be
  separate literals, and one of them was a guess about why any failure happened.
- **Your connections** ([04 §4.5](04-server-multiuser-deployment.md)) and role
  bindings, if `privateConnections` is granted. The one place a user sees which
  of their bindings are personal and which fall back to system defaults.
- **Preferences** — the presentation choices the app accumulates. §1.1's
  density question will eventually land here, and two more are waiting: the
  *As stored* pane state ([polish §2](workplan/09-polish.md)) and the all-kinds
  library view ([polish §4](workplan/09-polish.md)). **Where these persist was
  [06 B13](06-open-questions.md)**, and the answer is a per-user `prefs.json`
  rather than a field on `Account`, settled at
  [P2A §2.2](workplan/13-p2a-configuration-surface.md) — the question had to
  close before the first preference shipped, not before this surface did.

  **The theme is that first preference**, and the pane exists now because of it:
  light, dark, or match my system (§1.2). It is separate from *You* above rather
  than another field in that form, and the line is where the value lives. A
  display name and a locale are `Account` fields that other people and the
  server read — your name appears beside your turns, your locale picks the
  language of a notification composed while the app is closed. A theme is read
  by nothing but your own browser. One Save button writing to two stores with
  different semantics, one of them optimistic, is the arrangement that split
  avoids. And there is no Save button here at all: the choice applies as you
  make it, because a control whose entire feedback is the page changing colour
  should not ask you to confirm what you can already see.
- **What is deliberately not here:** the Source link. It is required to be
  visible to every logged-in user without hunting
  ([04 §7](04-server-multiuser-deployment.md)), which a settings page is not.

### 15.2 The admin half: accounts

**The list is the surface.** Every account, with handle, display name, role,
enabled state, and — the part that makes it worth building — *what is wrong with
this account*, inline. The dead-end state from
[04 §4.5](04-server-multiuser-deployment.md) is the motivating case: a user with
no private connections allowed and no system connection available cannot do
anything at all, and today that is discovered as a bug report from someone who
cannot send a message.

- **Create an account.** Handle, display name, initial password, role,
  capabilities. All accounts are manually provisioned
  ([04 §4.2](04-server-multiuser-deployment.md)) — no invites, no
  self-registration — so this is the only way anyone but the first admin exists.
  The password field states the install's minimum, and says plainly what a blank
  box does where the minimum is `0`: it creates an account that signs in with an
  empty password, rather than one with no password set.
- **Capabilities are granted here**, and they are the enumerated three:
  `privateConnections`, `fileAccess` (`none` / `read` / `write`, default `none`,
  §4.2), `enableExtensions`. Each with the consequence written next to it rather
  than in a manual — *"may add their own provider keys"*, *"may browse and edit
  their own files in the app"*.
- **Disable, and reset a password.** Disable is reversible and does not delete;
  the console reset stays the break-glass for the admin who cannot log in.
- **Removing an account is a deletion of a person's library**, and the surface
  has to say so in those words, with the same honesty the trash gets
  ([02 §10.2](02-data-model.md)). ~~**[OPEN]**~~ **Closed at
  [P2A §2.3](workplan/13-p2a-configuration-surface.md):** *disable the login,
  keep the data* is the default, hard removal is the deliberate second choice,
  and they are **two verbs rather than one verb with a flag** — a `keepData`
  toggle that turns a delete into a not-delete is what makes a dangerous control
  feel routine. Removal moves the directory to `data/removed/` rather than
  erasing it, and says so: the handle frees up immediately, the data does not
  come back through it, and nothing deletes it but a person.
- **Revoking `privateConnections` disables rather than deletes**, and the user
  is told ([04 §4.5](04-server-multiuser-deployment.md)). The surface that does
  the revoking is the one that owes that explanation.

### 15.3 The admin half: the install

The system-scope and server controls, which are admin capabilities rather than
account ones:

- **System connections** ([04 §4.5](04-server-multiuser-deployment.md)) — the
  household's shared keys, and the default role bindings everyone inherits.
- **The system library** ([04 §4.3](04-server-multiuser-deployment.md)) — a scope
  an admin administers, explicitly **not** an account and with no system login.
- **Extensions**: install is admin-only, enable is per-user
  ([12 §7](12-extensions.md)). Both halves of that live in their respective
  halves of this surface.
- **Restart, and server notices** ([04 §6.3](04-server-multiuser-deployment.md)) —
  including the two things restart must not do naively.
- **Connectivity and bind state** ([04 §6.5](04-server-multiuser-deployment.md)),
  shown here because a regular user cannot act on it.
- **The config form**, generated from what the server sends rather than from a
  list of fields kept here. Its numeric inputs carry the server's own bounds, and
  it says so when a save is refused — for a while it rendered only success, so a
  value past its range looked exactly like a value that had been accepted. That
  is where `auth.minPasswordLength` ([04 §4.1](04-server-multiuser-deployment.md))
  is set.

### 15.4 What this is not

**Not a dashboard, and not a place to put anything that is nobody's job.** The
test for a panel here is that an admin has an *action*: grant, revoke, create,
disable, restart, install. Statistics that lead to no action belong in the
workbench (§3) or nowhere.

**Not a permission system.** [04 §4.2.1](04-server-multiuser-deployment.md)
enumerates three capabilities and two roles on purpose — no groups, no
per-object ACLs, no custom roles. If this surface starts to want a matrix, the
answer is that the model is right and the matrix is wrong.

**Not where the density argument gets tested.** This is tooling by §1.1's split,
so it is dense: the account list shows state inline rather than behind a
per-account drill-down, which is the whole reason the dead-end warning is
visible at all.

### 15.5 When it gets built

**The core is [P2A](workplan/13-p2a-configuration-surface.md)**, immediately
after P2. An earlier revision of this section homed the whole surface at P10 and
then observed that two pieces were wanted earlier; what changed is the reason.
It is not that the user half is small — it is that five shipped artifacts
already describe this surface as existing, from `config.example.json` calling it
*"the primary path"* to [13 §4.2](13-internal-contracts.md) contracting the
write against it. That makes it a missing dependency rather than an early
feature, and [work plan §2.3](workplan/01-work-plan.md) is the rule written so
the same gap does not open again.

**What P2A closes:** §15.1 entire, §15.2 entire — including capability
*granting*, with enforcement pulled forward from P10 so the grant is not a false
front — and two of §15.3's five bullets, the config form and the restart notice.
It also closes [06 B13](06-open-questions.md), because a preferences pane needs
somewhere to put a preference.

**What [P2B](workplan/14-p2b-provider-configuration.md) closes:** system
connections and the default role bindings, admin-only. The *your connections*
bullet in §15.1 waits with it, because a personal-connection surface that
predates the `privateConnections` check is the trivial bypass
[04 §4.5](04-server-multiuser-deployment.md) warns about, wearing a UI.

**What genuinely remains at P10**, and not by default — each has a named
blocker: the extensions panel (installation does not exist); *Restart now*
(supervisor detection and drain, [04 §6.4](04-server-multiuser-deployment.md));
connectivity state (its producer is P11's update check); and the notification
preference rows [04 §3.5](04-server-multiuser-deployment.md) asks for (no class
has a producer, and the router is P10's).

**And §15.3's system-library bullet has no owner, which is a defect in this
section rather than a scheduling question.** §4.2 makes that scope
never-writable and [04 §4.3](04-server-multiuser-deployment.md) withholds admin
write at 1.0 deliberately, so there is no *action* an admin takes there — and
§15.4 says a panel without one does not belong. Either the bullet goes or 1.0's
position on admin write changes; it should not sit here looking scheduled.
