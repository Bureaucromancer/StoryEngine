# 21 — Client loading as the application grows

**Status: design exploration; implementation deferred.** Written 2026-09-05
after the audit of `main` at `a54afcc` reported a 676.82 kB minified JavaScript
bundle, 199.15 kB gzip, and Vite's 500 kB warning. The import observations below
were checked against `main` at `3ab6a62`; the size is the earlier audit's
measurement, not a new measurement of that commit. No bundle attribution or
browser performance profile was taken for this note.

**The planning assumption is continued growth.** The client has reached this
size with much of the intended application still ahead of it. Modes, richer
editors, memory inspection, renditions and localisation will add browser code;
~~Write, World and authoring add whole surfaces later~~ **Write and authoring
add whole surfaces later, and World arrives inside this release without being
one** (§3). The next few phases should be expected to increase the bundle.
Neither ordinary cleanup nor the end of the current phase is a reason to expect
that trend to reverse.

This note gives that future work an address and compares the options. It
changes no build setting, assigns no new implementation stage, and makes no
claim that 676.82 kB already causes a usability failure. Read it beside
[20 §6](20-tech-stack.md), which owns the client stack, and
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
- **P8A, which lands between those two:** the World panel, a membership view
  that renders in both directions ([10 §5](10-ui-surfaces.md)), and the story
  bible that [15 §7](15-world.md) ships beside the container rather than after
  it. That note calls the bible cheap and is right about what it means — no new
  data, a reader over records the pipeline already writes — but cheap in data is
  not cheap in bytes. A reader is still a view with its own layout, filters and
  empty states.
- **P10 and P11:** more administration, notifications, richer editing,
  assistance, Publish's review over a computed closure
  ([16 §5](16-publish.md)), and localisation. Translation resources can have a
  language boundary as well as a feature boundary.
- **Later surfaces:** Write's binder and prose tooling, and authoring.
  Their release order remains [work plan §0](workplan/01-work-plan.md)'s. They
  should not become part of resuming a Play session just because one client
  hosts all of them.

**Amended 2026-09-14: World appeared here and in the opening as a later
surface, and it is neither a surface nor later than this release.** It ships in
the 1.0 series as a portable library kind with a panel beside the other five,
and Publish is a flow in the Library rather than a fourth top-level place
([15 §3](15-world.md), [16 §6](16-publish.md), [10 §2](10-ui-surfaces.md)).
**Half of that was owed before this note was written.** *World is not a surface*
is the one clause of [15](15-world.md)'s old refusal that its rewrite left
standing, so the original sentence was right about the release order it had and
wrong about the shape on the day it was typed. Moving the kind into 1.0 changes
only the address: the cost lands at P8A and P11 rather than after them.

**The correction is worth more than the tidy-up, because the mechanism above
does not care which it was.** Cumulative reachability is indifferent to
navigation. A sixth portable kind costs the browser nothing at all until
something imports a view of it, and this one did not even widen the shared
registry [§2](#2-where-the-current-application-makes-everything-an-arrival-cost)
weighs: the kind was renamed rather than added, so six schemas are still six
([15 §3](15-world.md)). `LIBRARY_KINDS` derives from that registry, so World
reached the library filter without a line of client code written for it
([`api.ts`](../../packages/client/src/api.ts)). What it costs is whatever its
panel, its bible and its review pull in. A surface is a fact about
navigation ([10 §2](10-ui-surfaces.md)); arrival cost is a fact about the import
graph, and a panel reached from an eagerly imported Library page is as
reachable as a page of its own. That is also why this is the expected growth
this note accepts rather than a reason to interrupt feature work:
[§7](#7-when-to-revisit-and-what-the-work-would-produce)'s trigger names a *new
top-level surface*, and correctly does not fire here.

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

Admin Settings, history/diff panels, import and publish review, future rich
editors and language resources are further candidates. A permission check still
belongs on the server; deferred admin code is only a loading choice.

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

[20 §6](20-tech-stack.md) keeps the framework choice reversible. A framework
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
