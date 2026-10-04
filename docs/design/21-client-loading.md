# 20 — Client loading as the application grows

**Status: design exploration; implementation deferred.** Written 2026-09-05
after the audit of `main` at `a54afcc` reported a 676.82 kB minified JavaScript
bundle, 199.15 kB gzip, and Vite's 500 kB warning. The import observations below
were checked against `main` at `3ab6a62`; the size is the earlier audit's
measurement, not a new measurement of that commit. No bundle attribution or
browser performance profile was taken for this note.

*2026-10-04: one boundary is built — the setup wizard's dialog, the client's
first `lazy()`, recorded at [§7.2](#72-the-first-lazy-boundary-the-setup-wizards-dialog-2026-10-04).
Everything else here is still exploration, and §6's baseline was never taken.*

**The planning assumption is continued growth.** The client has reached this
size with much of the intended application still ahead of it. Modes, richer
editors, memory inspection, renditions and localisation will add browser code;
Write, World and authoring add whole surfaces later. The next few phases should
be expected to increase the bundle. Neither ordinary cleanup nor the end of
the current phase is a reason to expect that trend to reverse.

This note gives that future work an address and compares the options. It
changes no build setting, assigns no new implementation stage, and makes no
claim that 676.82 kB already causes a usability failure. Read it beside
[19 §6](19-tech-stack.md), which owns the client stack, and
[10](10-ui-surfaces.md), which owns the surfaces being loaded. The review
handoff is [§7](#7-when-to-revisit-and-what-the-work-would-produce).

## 1. What the warning establishes

The audit's production build emitted one JavaScript asset and one stylesheet:

| Asset | Minified size | Reported gzip size |
|---|---:|---:|
| JavaScript | 676.82 kB | 199.15 kB |
| CSS | 27.97 kB | 6.04 kB |

Vite compares its warning threshold to the **uncompressed chunk size**. Its
gzip figure is a build-time calculation; it does not establish that the server
or proxy serves compressed responses. Those are separate facts to measure.
See [Vite's build options](https://vite.dev/config/build-options#build-chunksizewarninglimit).

There are at least four costs to distinguish: transferred bytes, JavaScript
parsing and execution, requests that must finish in sequence, and the work of
rendering the selected page. A fast LAN reduces transfer time. It does not
make a slower browser execute JavaScript faster. Conversely, splitting files
can add waits on navigation even when it reduces the initial download.

The useful target is **the code needed for a particular visit**. A person
resuming Play should eventually pay for Play and the shared frame; opening
the workbench can pay for inspection. The total installed client may keep
growing after that change, and that is compatible with a faster arrival.
Keeping every emitted file below 500 kB would not prove this: the entry can
still import every smaller file immediately.

## 2. Where the current application makes everything an arrival cost

These are source-level observations, not estimates of each module's share of
the 676.82 kB:

| Import path | Consequence | Candidate boundary |
|---|---|---|
| [`App.tsx`](../../packages/client/src/App.tsx) imports the router before its authentication gate renders | Setup and sign-in share an entry graph with the signed-in application, even though the router only mounts afterwards | Optionally load the signed-in application after authentication |
| [`router.tsx`](../../packages/client/src/router.tsx) imports all page components | Library, Play, comparison, both editors and Settings are statically reachable from every arrival | Route components |
| [`Shell.tsx`](../../packages/client/src/Shell.tsx) imports `Workbench` | A closed dock avoids rendering and queries, but does not defer its code | Dock contents |
| [`Workbench.tsx`](../../packages/client/src/workbench/Workbench.tsx) imports every subject | Opening one inspector reaches import, library, live-turn and completed-turn readers | Subjects, if loading the whole dock later is still too expensive |
| [`SettingsPage.tsx`](../../packages/client/src/settings/SettingsPage.tsx) imports every admin section | A non-admin does not mount those sections, but their code is statically reachable | The admin section as one optional group |
| [`api.ts`](../../packages/client/src/api.ts) gets `LIBRARY_DIRECTORIES` from shared; [`library/fields.ts`](../../packages/client/src/library/fields.ts) reads `PORTABLE_SCHEMAS` | Small runtime metadata and full schema machinery meet in the same shared export graph | Measure whether metadata and validation need separate entry points |

The shell is the important qualification to the original recommendation of
route-level splitting. Making pages lazy while leaving every inspector in the
shell can leave much of the optional tooling in the entry. Shared readers also
have multiple callers: comparison imports an aligned block table from the
workbench. Folder names alone cannot define the resulting chunks.

There is a second qualification in `fields.ts`: its comment says schema use
costs the bundle nothing because the schemas and validator are already there.
That describes an assumed marginal cost in today's graph. It is not a reason
to keep them in every future visit. The shared registry imports all six schemas
and Ajv; a production module report must establish what the bundler retains.
A barrel export alone is not evidence that every export survives tree shaking.

## 3. Growth to plan around

The mechanism is cumulative reachability: a new panel imported by an eager
parent becomes part of that parent's loading cost. Planned work adds several
different kinds of pressure:

- **P7:** mode selection, setup, party, hooks, goals and their declarative
  widgets. Engine steps remain server-side; the browser cost is the controls
  and readers, not the whole mode implementation.
- **P8 and P9:** memory/summary inspection and rendition presentation. Image
  bytes are a separate budget, but selectors, viewers and their controls still
  add JavaScript. Code splitting does not reduce the size of an illustration.
- **P10 and P11:** more administration, notifications, richer editing,
  assistance and localisation. Translation resources can have a language
  boundary as well as a feature boundary.
- **Later surfaces:** Write's binder and prose tooling, World, and authoring.
  Their release order remains [work plan §0](workplan/01-work-plan.md)'s. They
  should not become part of resuming a Play session just because one client
  hosts all of them.

This is a directional forecast. There is no defensible multiplier or future
megabyte figure from one build, and no evidence yet that React, schemas or
application code dominates the present bundle. The design should allow a much
larger application without requiring its full code on every visit.

## 4. Options, and the current preference

### 4.1 Coarse route boundaries — the first experiment

**Preference: retain React, Vite and the current code-based router, and make
the substantial pages load on demand.** Start with Play, Library/detail,
editors, comparison and Settings as candidate groups. Whether detail shares
Library's chunk or deserves its own is a measured choice. Small UI primitives
should remain ordinary imports.

TanStack supports splitting code-based routes with `Route.lazy()` and
`createLazyRoute`; route matching and search validation can stay eager while
page rendering loads separately. `getRouteApi` lets a page use typed route
hooks without importing the route configuration back into itself. Its automatic
splitting uses file-based routing and a bundler integration, so it is not a
flag to enable on this router unchanged.
[TanStack code splitting](https://tanstack.com/router/latest/docs/guide/code-splitting).

The experiment must trace imports in both directions. A lazy page re-exported
through an eager helper, or an eager registry importing every renderer, can
undo the boundary. Moving a page into another file without an asynchronous
import does not change when it loads.

**Cost:** first use of a page now has a loading and failure state. Routes whose
queries begin only after components mount can acquire a code-then-data wait.
Measure that before deciding whether selected data requests should start with
navigation. Splitting need not require rewriting all data fetching at once.

### 4.2 Optional tools within a page — needed alongside routes

The workbench is the first candidate because it is shared by the shell and
explicitly optional. Keep its opener, preference handling and any necessary
frame light; load its contents when opened. A restored open preference counts
as an open request. Begin with one dock boundary, then split subjects only if
the report shows that opening one subject still downloads too much unrelated
tooling. Request the known subject alongside the frame where practical, rather
than building a chain of sequential discoveries.

Admin Settings, history/diff panels, import review, future rich editors and
language resources are further candidates. A permission check still belongs on
the server; deferred admin code is only a loading choice.

React's `lazy` and `Suspense` provide component loading and a local pending
view. Lazy declarations belong at module scope. React caches the loading
promise, including a rejected load, so merely resetting a render error boundary
is not a complete retry design.
[React lazy reference](https://react.dev/reference/react/lazy).

**Cost:** too many small boundaries make opening a tool feel like assembling
it. Prefer one useful operation per boundary, then measure before subdividing.
Keep the transcript, composer and unsaved editor mounted while a neighbouring
panel loads. Code-loading state must not become a new owner of session state.

### 4.3 Separate runtime metadata from schemas and validation

If attribution shows shared initialization occupying the common entry, consider
supported exports for lightweight identifiers/metadata, schema descriptions,
and validation. The API's folder-name lookup should not need a validator merely
to know the library kinds. Conversely, a schema-driven editor has a legitimate
reason to load a schema.

Options include separating constants from schema construction, loading schemas
per kind, or consuming generated schema data in the browser. Any generated
metadata must derive from the existing authority and be checked for agreement;
there must not be a second hand-maintained definition of an actor or lorebook.
Package exports and boundary lint rules need to recognize any new entry points.

**Cost:** this is more invasive than moving page imports, and a careless split
can undermine the shared validation contract. First measure retained modules
and initialization. Do not remove client validation, declare the whole package
side-effect-free, or replace Ajv on the strength of an import statement alone.

### 4.4 Deliberate common chunks, compression and caching

Let the bundler form common chunks initially. If the output shows duplication
or excessive cache invalidation, evaluate explicit groups for the stable
runtime or schema tooling. Vite exposes Rolldown configuration through
`build.rolldownOptions`; check the installed version when implementing rather
than copying a recipe for an older bundler.
[Vite chunking strategy](https://vite.dev/guide/build#chunking-strategy).

Common chunks can improve reuse across routes and builds. An eagerly imported
`vendor` file still has to load eagerly, however. One giant vendor group can
also make unrelated library changes invalidate everything. Judge it by the
requests made for each journey and reuse across two builds, not its filename.

Compression and HTTP caching complement these boundaries. Compare gzip/Brotli
support at the actual server or reverse proxy, including a direct LAN install
with no proxy. Content-hashed assets are candidates for long-lived immutable
caching; HTML needs revalidation. Verify headers, `Content-Encoding`, and
actual transfer sizes. Compression reduces transfer, not JavaScript execution.

### 4.5 File-based routing, another framework, or separate applications

File-based routing may eventually earn its generator through the number of
routes and the benefit of automatic splitting. Revisit it when maintaining
manual boundaries becomes repetitive. The loading problem alone does not
require that migration.

[19 §6](19-tech-stack.md) keeps the framework choice reversible. A framework
change, server rendering or separate applications for Play and Write would be
much larger decisions: shared navigation, drafts, query caches and deployment
all have to survive them. Reserve those options for measured limits that the
smaller changes cannot resolve, or a separate product requirement. The current
warning provides no evidence for choosing one.

Raising `chunkSizeWarningLimit` is a reporting decision and may eventually
accompany an explicit budget. It buys no reduction in loading cost. Keep the
warning visible during the accepted growth period; do not make passing that
number the definition of success.

## 5. Loading and upgrading become part of the interaction

**A delayed panel needs to remain usable as a panel.** Preserve its place and
close control while loading, announce the pending state, and keep keyboard focus
predictable. A failed inspector should leave the page beside it usable. Test
rapid open/close, navigation during loading and the saved-open preference.
Existing draft guards, scroll regions and SSE reattachment must keep working.

**Prefetch selectively.** Navigation intent, including keyboard focus, is a
candidate signal for likely next code. Avoid preloading every route at sign-in:
that can turn deferred work into immediate background traffic. Code prefetch
does not authorize a mutation or model call. Network and CPU profiles must
include the prefetch traffic, not stop counting when the first frame appears.

**An upgrade can remove a chunk an old tab has not requested yet.** Vite reports
dynamic-import failures through `vite:preloadError`. Its documentation describes
the old-deployment asset problem and HTML revalidation; the example reload is
not a suitable unconditional policy for an editor holding an in-memory draft.
[Vite load error handling](https://vite.dev/guide/build#load-error-handling).

The current [`app.ts`](../../packages/server/src/app.ts) SPA fallback also sends
`index.html` for a missing asset. That does not execute as a replacement
JavaScript module; it fails the module request. A future loading pass should
give missing assets a real failure response while preserving HTML fallback for
application routes and JSON errors for `/api`.

The preferred recovery shape is a local error with a safe retry where supported,
and an explicit refresh action when a new application version is needed.
Preserve drafts or offer a way to recover their text before replacement. A
single failed request does not establish that an upgrade happened; offline and
transient network failures need useful answers too. Avoid automatic reload
loops. If retaining old hashed assets is chosen instead, name the retention
window and where they survive a container replacement; a new image does not
automatically contain its predecessor's files. This is a future review of
serving behavior, not a prerequisite being added to the current release.

## 6. What to measure when this becomes work

Rebuild at an identified commit with the lockfile and runtime recorded. Produce
a module-attribution report and record total emitted JavaScript, the static
dependency closure of each entry, compressed sizes, chunk count and CSS. Treat
source line counts as context, never as bundle attribution. Use the production
server: Vite's development module graph is a different loading experiment.

Measure these journeys separately, with a cold browser cache and then a warm
one, on the developer machine and a named slower client/network profile:

| Journey | Question |
|---|---|
| Setup/sign-in | How much signed-in tooling arrives before it is needed? |
| Direct link to Play, dock closed | When can the person read and compose, and what code did that require? |
| Open the dock during Play | How long until the correct subject is usable, and does the composer stay responsive? |
| Library to an actor or lorebook editor | What does first-use navigation cost; do drafts and focus survive adjacent loading? |
| Settings as a non-admin and an admin | Is the optional half actually deferred, including through shared imports? |
| Existing tab after a deployment change | Can a failed new chunk be recovered without losing work? |

For each, record transferred bytes, parse/evaluation time, long tasks, request
ordering, and time to the action the person came to perform. Keep a small and
a realistically large library/session so API payload and rendering costs can
be distinguished from code loading. Report total bytes for the journey across
all chunks; a smaller entry with a larger immediate dependency set is not a win.

Set numeric budgets after these measurements. The first useful guardrails are
structural: a closed dock should not require its unique readers, and unrelated
editors should not arrive with Play. Browser network checks plus a build graph
can establish those properties; a unit test that renders a mocked lazy component
cannot. CI can track deterministic byte totals and regressions once a baseline
exists. Timing decisions need repeated browser measurements with the device and
network profile attached, rather than a tight wall-clock assertion on a shared
runner.

## 7. When to revisit, and what the work would produce

**Accept growth in the short term and preserve the option to divide it later.**
The immediate discipline is modest: keep heavy new tooling behind identifiable
feature modules, avoid putting feature registries into the shared shell without
considering their imports, and record a production size at meaningful phase
boundaries. This note does not require every new component to be lazy or every
feature commit to pass a new performance gate.

The proposed review point is **P11's opening audit, before broader
distribution**, when much more of the 1.0 client exists. Bring it forward if
PLAYABLE exposes slow arrival or first interaction, a substantial new browser
dependency joins the common entry, or a new top-level surface would expand
every visit's dependency set. Growth alone is expected; measured harm or a
costly new coupling is the reason to interrupt feature work. The work plan owns
the eventual scheduling decision.

At that review, the bounded sequence is:

1. Capture §6's baseline and attribute the common entry.
2. Experiment with coarse page boundaries and the optional dock together.
3. Re-measure full journeys; split shared metadata/validation or individual
   tools only where the remaining cost justifies it.
4. Verify loading, failed requests and deployment replacement with drafts;
   settle selective prefetch, cache headers and compression on the shipped path.
5. Record the chosen boundaries, measured budgets and regression checks, or
   an explicit decision to defer with the measurements that justify it.

**Open until then:** which page groups load together; whether the sign-in gate
earns its own boundary; what the shared registry actually costs; what device
and network define acceptable arrival; and whether old assets are retained or
the client offers refresh recovery. The architecture preference is already
clear enough to guide growth: keep one application, make its substantial
surfaces and optional tools load when used, and allow its total size to grow
without making every visit load all of it.

### 7.1 The trigger fired: `react-markdown` on the arrival route (2026-09-15)

§7 names three conditions for bringing the review forward. One of them —
**"a substantial new browser dependency joins the common entry"** — has now
happened, deliberately and with the measurement taken at the time rather than
reconstructed later. This subsection records it, because a trigger that fires
and is not written down is a trigger nobody will find.

**What changed.** Home ([P7B.9], revised) stopped rendering `CHANGELOG.md` as
text in a `<pre>` and started rendering it as a document. That needs a markdown
renderer, and `react-markdown` is pinned in
[`packages/client/package.json`](../../packages/client/package.json). `/` is the
entry route, so this is the common entry by definition — there is no route it
could be behind.

**Measured, by building `main` and the change back to back on the same machine
with the same toolchain.** Vite's own per-chunk report, which is where §1's
figures came from. `main` here is `d490838`, re-measured at merge so that the
pair below is the pair that is true of `main` rather than of the branch's older
base — the delta came back within 0.01 kB gzip of the branch measurement, which
is itself the evidence that it is the dependency being measured and not four
commits of unrelated drift:

| | Modules | JavaScript | gzip | CSS | gzip |
| --- | --- | --- | --- | --- | --- |
| Before | 567 | 788.66 kB | 231.40 kB | 33.28 kB | 6.82 kB |
| After | 729 | 909.25 kB | 268.11 kB | 34.06 kB | 6.94 kB |
| Delta | +162 | **+120.59 kB** | **+36.71 kB (+15.9%)** | +0.78 kB | +0.12 kB |

Two things to read off that table rather than off the headline. The first is
that **§1's baseline is stale**: it records 676.82 kB / 199.15 kB from the audit
at `a54afcc`, and the entry had already grown to 788.66 kB / 231.40 kB before
this change touched it. The dependency is not what made this client large. The
second is that +36.71 kB gzip is nevertheless a real sixth of the entry, arriving
on the one route every visit starts at, for a feature that is read once per
upgrade.

**The decision, stated rather than deferred by silence: the review is not
brought forward, and this is the number that justifies not bringing it
forward.** §7's remedy for a fired trigger is to schedule the audit, not to
refuse the dependency, and the audit's value comes from having much more of the
1.0 client to measure. One dependency at one sixth does not change what that
audit would find or what it would recommend; it changes the starting figure,
which is why the figure is here. The review point stays **P11.0**, and the
first line of its baseline capture is now known.

**The contingency, pre-argued so that it is a decision and not a scramble.** If
arrival on the entry route becomes a complaint before P11.0, the answer is not to
remove the renderer but to move it off the common entry: `React.lazy` around
[`ChangelogDocument`](../../packages/client/src/home/ChangelogDocument.tsx)
inside `HomePage`, behind a `Suspense` fallback. That leaves the parser, the
labels and the workbench's release table — none of which touch markdown — in the
entry, and puts only the renderer in a chunk `/` fetches. It is exactly §4.2's
*optional tools within a page*, and the cost is one line of fallback text on a
surface [10 §1.1](10-ui-surfaces.md) files as Quiet, which should be a sentence
rather than a spinner.

### 7.2 The first lazy boundary: the setup wizard's dialog (2026-10-04)

**What forced it was the tripwire, not a complaint.** `tools/entry-budget.test.ts`
is [P11.9](workplan/28-p11-implementation.md)'s recorded ceiling on the entry
bundle, and between 2026-09-29 and 2026-10-03 it was raised five times — 310 to
320, 325, 331, 336 and 342 kB — each time naming the same remedy and declining
it as a loading decision no feature stage should make in passing. The fifth,
at [P15](workplan/33-p15-setup-from-a-turn.md)'s merge, named a candidate:
*make a setup from here*, a dialog nobody sees until they press a button on one
turn. [P15 §1.11](workplan/33-p15-setup-from-a-turn.md) took it, on the
recommended answer with the owner's decision deferred, and the ceiling went
back to 336.

**The boundary is §4.2's, at the smallest useful size.** The button
(`play/SetupFromTurn.tsx`) stays on the play page, because every turn draws it;
the dialog (`play/SetupWizard.tsx`) is a chunk fetched the first time somebody
presses it. *Not a route boundary*: §4.1's first experiment is still unrun, and
this does not start it. Measured with the entry-budget test's own compressor —
gzip level 9, the units its ceiling is written in — the entry went from
**337.79 kB** to **335.38**, and to **335.55** with review's changes to the
button's side (below). Imported statically again, with those changes kept, the
dialog puts the entry at **338.19**, so it costs the entry 2.64; the chunk is
**3.78** on its own. *The gap is not shared modules* — the modules the dialog
shares with the entry stay on the entry and are in neither number — but
compression and wiring. Gzipped alone, the chunk lacks the entry's context:
appended to the entry it costs **3.04**, so about 0.74 is compression the
chunk cannot borrow. The other 0.40 is the split's own code: the chunk's
import of the bindings it shares with the entry, and on the entry an export
list for them and the `import()` that fetches the chunk. (The bundler's preload
helper was on the entry already, for the locale catalogues.)

**The loading and failure states, against §5:**

- *Where both are drawn*: under the turn's row of gestures, not in it. That row
  is transparent unless the turn is hovered or holds focus, and the first
  version drew the waiting sentence and the failure note beside the button,
  inside it — so on any device that can hover the note vanished when the
  pointer left the turn, which its own advice (send or copy what you typed)
  makes the pointer do. Review moved them out, where the guided redo's field
  already was: the module hands the play page the button for the row and what
  it opens for after it (`useSetupFromTurn`). *Remember this* is the known
  exception — its panel and its refusal are still drawn inside the row and
  fade the same way once neither pointer nor focus is in the turn; focus stays
  in the panel while it is typed into, which is most of its life, and moving
  it is a change to that component of its own, not this boundary's.
- *Pending* is a sentence under the turn's gestures, announced as a status,
  rather than a modal frame. Nothing is covered while the chunk loads, so there
  is no close control to keep; and a frame the dialog replaced could leave the
  dialog's focus trap remembering one of the frame's buttons as the place to
  return focus to, which keeping focus predictable rules out.
- *Failure* is a local error boundary: a note under the turn's gestures, and
  the page beside it — transcript, composer, an unsent move — is untouched.
  Without it the router's page-level boundary would have replaced the whole
  play page. **The boundary guards the dialog's render as well as its load**,
  because it wraps everything the dialog draws, and §5's *a failed inspector
  should leave the page beside it usable* holds for a bug as much as for a
  missing file. *Only a failed load is told to reload*: the `lazy` factory
  wraps the import's rejection in an error of its own type, and the boundary
  says *could not be loaded … reload the page to fetch the new version* to
  that alone. Anything else — the dialog throwing once its chunk is in — says
  the wizard stopped with an error, because a reload would only repeat a bug
  and the upgrade it blames did not happen.
- *Focus*: the note's *Dismiss* hands focus back to the button. It unmounts
  itself while holding focus, and the browser would otherwise drop it on
  `<body>`; the dialog's own close already returns focus through its trap.
- *No retry, and no reload control.* React caches a rejected `lazy` load as it
  caches a success (§4.2), so *Try again* through the same declaration cannot
  ask the network again; the failure a self-hosted install is likeliest to see
  is the upgrade under an open tab, which only a reload answers; and a reload
  button would discard an unsent move, which nothing keeps. So the sentence
  says what to do and the person chooses when. *A retry that builds a fresh
  `lazy` is the shape to reach for* if transient failures turn out to matter.
- *Upgrades*: unchanged from §5. The server still answers a missing asset with
  `index.html`, which fails the module request — a rejected load, so the
  boundary catches it and gives it the reload advice.

**The guardrail is structural, as §6 asks.** Besides the byte ceiling, the
entry-budget test now asserts *keeps the setup wizard off the entry*: a chunk
named for the module exists, and `index.html` does not reference it. With the
lazy import reverted to a static one, both checks fail (the entry measured
338.19 kB). The component tests cannot be this guardrail — §6 says why, and
`SetupFromTurn.load.test.tsx` says it again — so they hold the pending and
failure states, the focus on *Dismiss*, and (`SetupFromTurn.crash.test.tsx`)
the dialog that fails as it draws, and nothing about where the code lives;
`PlayPage.test.tsx` holds where on the page the states are drawn.

**What it does not settle**, and §7's list still holds: which page groups load
together, prefetch, compression and cache headers, and whether old assets are
retained across an upgrade. This is one optional tool off the entry, and the
precedent it sets is the sizing — the dialog, not the button; one boundary,
not a subdivision — and the two states every later boundary owes, drawn where
they stay visible and with focus handed back when one is dismissed.
