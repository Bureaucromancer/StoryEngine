# 04 — Repository and release model

**Status: proposal.** Process rather than architecture. This document is the
draft of what eventually becomes `CONTRIBUTING.md`; it lives here while the
project is still design-only.

---

## 0. Project phases, and what each one gates

Most of this document does not apply yet. Recording the phases so it is clear
what is deferred rather than forgotten.

| Phase | Definition | Distribution |
|---|---|---|
| **Alpha** | *now.* Building toward the 1.0 spec. | **Build it yourself.** No *distribution* — no channels, no packages anyone else installs. One private artifact from [P6A](19-p6a-alpha-1.md) onward; see below. |
| **Beta** | **Feature complete to the 1.0 spec** — every capability the design documents commit to exists and works. | Release handling starts here: tags, release branches, channels, the packaging tiers in [09 §5.4](../09-server-multiuser-deployment.md). |
| **1.0** | Beta, stabilised. | Full packaging matrix. `release/1.0` persists. |
| **2.0 beta → 2.0** | The same gate again, against the 2.0 scope — the Write surface ([work plan §0](01-work-plan.md), [13](../13-write-mode.md)). | 2.0 work continues on `main` while `release/1.0` takes fixes. |
| **3.0 beta → 3.0** | The same gate again, against the 3.0 scope — the Character Studio ([work plan §0](01-work-plan.md), [18](../18-character-studio.md)). | 3.0 work continues on `main` while `release/2.0` takes fixes. |
| **4.0 beta → 4.0** | The same gate again, against the 4.0 scope — World ([work plan §0](01-work-plan.md), [15](../15-world.md)). | 4.0 work continues on `main` while `release/3.0` takes fixes. |
| **5.0 beta → 5.0** | The same gate again, against the 5.0 scope — Campaign and the RPG channel library ([work plan §0](01-work-plan.md)). | 5.0 work continues on `main` while `release/4.0` takes fixes. |
| **6.0 beta → 6.0** | The same gate again, against the 6.0 scope — the authoring tier ([work plan §0.6](01-work-plan.md)). | And so on. The pattern does not change again. |

**1.0 is a real release, not a staging post.** It ships the Play surface with two
modes — Scene and Freeform — chosen as the ones this project has opinions about,
with Write, the Character Studio, World and Campaign held for later series
([work plan §0](01-work-plan.md)).
The release model already handles the shape: `release/1.0` persists and takes
hotfixes, `main` moves on.

**The gate definition does not change as the series go up.** *Feature complete
to the 2.0 spec* is checkable against [13](../13-write-mode.md) exactly as the
first one is checkable against the 1.0 design notes, and *to the 3.0 spec*
against [18](../18-character-studio.md) after it. The branch model needs nothing
new either:
§2 already makes release branches per **minor line**, so each major is one more
line rather than a new pattern. **There is no `1.x` line and never was** — a
point release is a patch on the release branch, not a place to park deferred
features.

**What the table does not contain is as important as what it does.** Only
committed scopes get rows. Everything on the feature list
([25](../25-roadmap.md)) has a priority rather than a release, so nothing there
is late, and nothing there gates a beta.

**Beta is a completeness gate, not a quality gate.** "Feature complete to 1.0
spec" is a usefully hard line — it is checkable against the design documents
rather than negotiable, and it puts the argument about whether something ships
*before* beta rather than during it.

**It is also only half the bar.** The other half is release engineering —
build chains, release automation, and workflows stable enough that shipping is
repeatable rather than an event. That belongs *in* the beta gate rather than
after it. One piece is settled: the canonical build must deliver **the OCI image
and the tarball** ([09 §5.4](../09-server-multiuser-deployment.md)) for beta to
count. The other four packaging artifacts are a **1.0** requirement rather than a
beta one — enough to have users is the beta test, and four more build chains is
work that reads as progress while delaying the thing being packaged.

**They are owned by P11 rather than by a bar** ([work plan §0.5](01-work-plan.md)),
which is the correction to an earlier version of this paragraph. "At the 1.0
bar" left four required artifacts with a requirement and no builder, because P11
is the last phase and had put them out of scope. A bar nobody owns is a wish.
The rest is sketched pending expansion in [work plan §8](01-work-plan.md).

Two consequences worth naming:

- **Release engineering is post-alpha work.** The packaging tiers, the channels,
  signing, and CI matrices are all beta-phase concerns. Building them now would
  be maintaining a distribution for software that has no users.
- **"Build it yourself" is the alpha distribution strategy, not a permanent
  philosophy.** [09 §5.4](../09-server-multiuser-deployment.md) argues that
  build-from-source should stay genuinely first-class forever — that remains
  true, but during alpha it is the *only* path, which is a different claim.

### 0.1 The distinction the table above was missing

*Added at [P6A](19-p6a-alpha-1.md), which is the phase that needed it.*

Both bullets say **distribution**, and both are right about it. Neither
distinguishes distribution from the thing that happens to share its build chain:

- **A release artifact** is tagged, changelogged, published to a channel, tracked
  by other people's auto-updaters, and carries an implied support promise. Every
  word of the two bullets applies to it, and it stays post-alpha.
- **A build the project produces for itself** is tagged, changelogged,
  reproducible and identified — and handed to nobody. None of the recurring costs
  [09 §5.4](../09-server-multiuser-deployment.md) warns about attach to it,
  because every one of them is a cost of having an audience.

**P6A cuts the second and calls it Alpha 1.** A private repository, a private
registry package, an unraid template written and committed rather than submitted.
`latest` moves nowhere, `nightly` does not exist, and the other five packaging
artifacts stay exactly where §0's table puts them. **The maintaining-a-
distribution argument is not weakened by this; it is what the privacy is for.**

Two things follow that are worth stating rather than inferring:

- **AGPL §13 attaches on distribution**
  ([09 §7](../09-server-multiuser-deployment.md)), so it does not attach to
  Alpha 1 — which is why the About surface and the version-aware source link stay
  at P10 and P11 rather than being dragged forward.
- **Publishing is therefore one decision, not a toggle.** A public image obliges
  a public repository at the same instant, plus the §13 surface, plus a data
  story for strangers' installs. [P6A §4](19-p6a-alpha-1.md) lists them together
  for that reason.

### 0.1a The repository went public; the build did not (2026-10-03)

**The repository is public from 2026-10-03, for reasons of licensing and CI,
not readiness.** Nothing above is reversed by it, and nothing in it is a
release: the image stays a private package, `latest` moves nowhere, no GitHub
Release exists, the `v1.0.0-alpha.*` tags remain builds the project made for
itself, and no one is promised support, a data story or a migration. The
bullet above runs in one direction — a public image obliges a public
repository — and this is the other direction, which obliges nothing.

**Why now, and why these reasons rather than readiness:**

- **Licensing.** The code is AGPL, and a release build tells everyone who uses
  an install where its source is — the **Source** link at the foot of every
  page, which §13 asks for, pointing at this repository. While the repository
  was private that link opened for nobody but its owner, so any install with
  other people on it was offering them a source they could not read. The repository also carries
  code from three AGPL projects (SillyTavern, Marinara Engine, Aventuras), and
  publishing it is the plainest way to keep their terms; the audit that
  preceded the switch found three files holding such code under version 3
  alone, relabelled them `AGPL-3.0-only`, and wrote `THIRD_PARTY_NOTICES.md`.
- **CI.** Private repositories draw on a 2000-minute month with Windows billed
  double. September's ran out on the 27th and October's six hours into the 1st,
  after which every job on `main` was refused before it started. Public
  repositories' standard runners are not metered, so the full matrix — both
  platforms, on every change — can run again as [testing §6](03-testing.md)
  describes it.

**What it does not change, said because the old text implied otherwise:** the
argument that privacy is what makes Alpha 1 *a build and not a distribution*
was always about the artifact, and the artifact is still private.
[P6A §5](19-p6a-alpha-1.md)'s *"it does not go public before [PLAYABLE]"* was
written about Alpha 1 and is broken for the repository, knowingly: PLAYABLE has
still not run, and that remains the checkpoint
[work plan §4.1](01-work-plan.md) puts ahead of beta. Read anywhere else, the
repository's being public says only that its source can be read.

***2026-10-03 is the decision's date, not the switch's*** *(added 2026-10-04)*.
`gh repo view` still reported the repository private on 2026-10-04, while the
work that was to go first was finished. The switch is the owner's act, and
**the day it lands is written here, once, when it does.** Until then every
*public since 2026-10-03* elsewhere — the heading above, the README, the deploy
guide, the docs index and `ci.yml` — reads as the date of the decision. The
correction pass after the switch starts from this paragraph rather than from a
search. The notes added on 2026-10-04 (the Dockerfile, the unraid template and
the deploy guide's icon sentence, `updates.ts` and its test, the update badge,
`release.yml`, and [P10](27-p10-implementation.md)'s and
[P11](28-p11-implementation.md)'s copies of the feed sentence) cite the decision
and say what holds while private and what holds once public, so they need no
such pass.

**What the owner does at the switch, and what waits on it** (2026-10-04):

- **Turn on private vulnerability reporting**, right after the visibility
  changes: Settings → Code security → *Private vulnerability reporting*. It is
  a per-repository setting, it is off by default (the owner's one public
  repository, a fork, has it off), and going public does not turn it on.
  [`SECURITY.md`](../../../SECURITY.md)'s only reporting route is its **Report a
  vulnerability** button, which exists only when it is on. It cannot be set
  beforehand: `gh api repos/Bureaucromancer/StoryEngine/private-vulnerability-reporting`
  answers 404 while the repository is private, and should answer
  `{"enabled":true}` after. `SECURITY.md` says what a reporter does in the gap.
- **Decide the tarball's upload before the next `v*` tag.** The heading's *the
  build did not* holds only until then. `release.yml`'s tarball job ends in
  `actions/upload-artifact`, and on a public repository a run's artifacts can
  be downloaded by anyone signed in to GitHub, for ninety days unless
  `retention-days` says otherwise. The step has never run: the job arrived at
  P11.9, after alpha 4. Keep the upload and say so here, give it a short
  retention, or drop the step. The workflow's comment above the step says the
  same, and [the deploy guide](../../deploy.md)'s *Cutting a release* warns the
  person cutting the tag.

**Two policies for a public repository — recommended answer, owner deferred,
2026-10-04**, recorded here so they can be overruled in one place. The README
and `SECURITY.md` state them and point back at this paragraph.

- **No contributions for now.** Pull requests will not be merged; forks under
  the AGPL are welcome. Nothing above implies this. It is new, and it is the
  plainest reading of a project that promises no support and has one person
  deciding its design.
- **Security reports go privately and promise nothing.** They go through
  GitHub's private vulnerability reporting, the setting the switch's first step
  turns on, with no
  response time, fix, advisory or credit promised. The no-promise half follows
  from *no one is promised support* above. The private channel is the new part.

---

## 1. The model

```
main                    trunk. Always releasable in principle.
release/1.0             cut at feature freeze. Kept forever.
release/1.1
feature/<slug>          branched from main, merged to main
bugfix/<slug>           branched from main, merged to main
hotfix/<slug>           branched from a release/*, merged back to it
```

**`main` is main.** Work lands there through short-lived branches; nothing is
developed on `main` directly.

**Release branches survive permanently.** This is the deliberate deviation from
the common practice of cutting a tag and deleting the branch, and the reason is
the one that motivates it: a live branch can be built against, and fixed
against, at any point in the future. `release/1.0` still existing in three years
means a 1.0.4 is possible without archaeology.

**`hotfix/*` targets a release**, not `main` — which matches the intuition that
a hotfix exists because something already shipped. A fix that has not shipped
anywhere is a `bugfix/*` against `main`.

---

## 2. Branches are maintenance lines; tags are artifacts

Worth separating explicitly, because permanent release branches make it easy to
conflate them.

- **`release/1.2` is a line of maintenance.** It moves. Patches land on it.
- **`v1.2.0`, `v1.2.1` are tags.** They are immutable and each one is exactly
  what a given build was made from.

Both are needed. The branch answers "where do I fix 1.2?"; the tag answers "what
precisely is the user running?" Only the tag can answer the second, because the
branch has moved since.

Release branches are per **minor line**, not per patch — `release/1.2` carries
1.2.0 through 1.2.7. Per-patch branches would be write-only.

**This model directly serves an obligation we already have.** AGPL §13 requires
offering the source corresponding to *the running version*
([09 §7](../09-server-multiuser-deployment.md)), which means builds embed their tag
and commit and the About surface links to them. Permanent release branches and
permanent tags are what make that link resolve years later. A model that deleted
release history would quietly make §13 compliance harder over time.

---

## 3. The hotfix flow, including the step everyone forgets

```
git switch release/1.2
git switch -c hotfix/token-refresh
  … fix …
merge to release/1.2  →  tag v1.2.1  →  build
FORWARD-PORT to main
```

**The forward-port is not optional and it is the step that gets skipped.** A fix
that lands only on `release/1.2` is absent from `main`, so it regresses in 1.3
and returns as a bug report against a version that "already fixed that". Two
mitigations worth having:

- A merge or cherry-pick to `main` in the same session, not "later".
- CI that flags a commit on a `release/*` branch with no corresponding commit on
  `main`. Cheap, and it catches the one failure this model is prone to.

Where the fix does not apply cleanly to `main` — because the code moved — the
forward-port is a fresh implementation of the same fix, not a skip.

---

## 4. `latest` and `nightly` are channels, not branches

Recorded with a recommendation, since these were raised as "nice to have if
automated and reliable" — and the automation condition is the tell.

**Neither wants to be a branch.**

- A **`latest` branch** could only ever mirror the newest release tag, so it
  duplicates information git already holds, and keeping it accurate means an
  automated fast-forward that can drift or fail silently. The genuine use case
  is convenience for install instructions — `git clone -b latest` reading better
  than "look up the newest tag". But per
  [09 §5.4](../09-server-multiuser-deployment.md) the real install paths are a
  container image and a tarball, and both already have a `:latest` concept that
  is not a git ref.
- A **`nightly` branch** is a category error in the same way: nightly builds are
  built *from* `main`. There is nothing for the branch to contain that `main`
  does not already have. What is actually wanted is a nightly *artifact*.

So express these as **release channels**, realised as container tags and
published build artifacts. If a git ref is ever genuinely wanted, add it then as
an automatically-updated alias where no work happens.

Three channels:

| Channel | Source | Gate | For |
|---|---|---|---|
| **latest** | newest release tag | a release was cut | normal use, and the thing auto-update tracks |
| **testing** | a chosen commit on `main` | **a human decided `main` is in a good state** | manual testing of unreleased work |
| **nightly** | `main` HEAD | schedule only | seeing today's state; may be broken |

**An alpha build occupies one of these rows since alpha.2 — `testing`.**
[P6A](19-p6a-alpha-1.md) published Alpha 1 under an immutable tag and moved no
alias; on 2026-09-07 the maintainer's own unraid install asked for a channel it
could follow, and the `testing` row is exactly what a tagged alpha is: *a chosen
commit on `main`* — a prerelease is a tag on `main`
([P6A §1.6](19-p6a-alpha-1.md)) — *gated on a human deciding*, which a tag is.
So every `v*` tag also pushes the image as `:testing`, the unraid template
follows that tag, and `compose.yaml` stays pinned to the version — the build
you can go back to. *The tag stays the human decision; since 2026-10-01 it has a
mechanical backstop — the release workflow re-runs the Linux check and the
changelog check on the tagged commit, and moves nothing until both pass.* **`latest` still names nothing**, and it stays that way
until a release is actually cut. The reason is concrete rather than tidy —
`updates.channel` already ships as a closed union defaulting to `latest`, and
both unraid's auto-update and watchtower track exactly that alias, so moving it
is how an alpha turns into an unattended upgrade for everyone who ever installs
one. `updates.channel` itself is unchanged by the channel existing: it
configures P11's in-app update *check*, and which channel an install *pulls* is
a property of the thing pulling — the template's tag, watchtower, compose — and
not of the server.

**`testing` and `nightly` are not the same channel at different frequencies**,
and most projects blur them. `nightly` is unattended and carries no claim.
`testing` is somebody's judgement that the current trunk is worth other people's
time — which is precisely what makes it useful, and why it cannot be a cron job.

**`latest` is what makes automatic updates possible**, and it is worth being
precise about what that means for a server: we *publish* a channel others track,
rather than updating ourselves in place. Container users get it through their
platform (unraid's auto-update, watchtower, a scheduled pull); package users
through their package manager; tarball and build-it-yourself users through an
in-app check that notices a new release and links to it.

**Self-updating in place is not planned.** A server with a live data directory,
in-flight turns and possible schema migration is a bad place for a process to
rewrite itself, and every mechanism above already delivers the outcome without
that risk.

The in-app check is specified in
[09 §6.5](../09-server-multiuser-deployment.md), including the deliberate limits
that keep it from becoming telemetry, and its secondary use as a connectivity
signal that improves generation error messages.

**None of this exists until the pipeline is boring.** A nightly that is often
broken teaches people to ignore it, which is worse than not offering one.

---

## 5. Merge strategy

**Squash-merge into `main`.** One commit per feature or bugfix.

*Not what the phase merges have done — §7's last bullet records the deviation
rather than hiding it.*

The practical argument here is the forward-port in §3: a single clean commit is
far easier to cherry-pick between `main` and a release line than a merge bubble
of fifteen work-in-progress commits. The convention and the maintenance workflow
happen to reinforce each other.

Merges *from* `hotfix/*` into `release/*` follow the same rule. Merges of
`release/*` back to `main` are cherry-picks, not merges, so release lines do not
drag their whole history into trunk.

---

## 6. Considered and declined: a `staging` branch

Marinara routes all contributions through `staging`, with promotion to `main`
restricted to the lead maintainer. That is a sensible arrangement for a project
with outside contributors and a release cadence to protect.

For a very small team it is overhead that buys little: pull requests into `main`
plus CI give the same gate with one fewer long-lived branch and no promotion
step. Revisit if the contributor count grows to the point where `main` needs
protecting from merge volume rather than from individual mistakes.

---

## 7. Conventions worth writing down early

- **Branch names are convention until CI enforces them.** A simple name check on
  PR open is cheap and stops `fix-thing` and `feature/fix-thing` and
  `Feature/Fix-Thing` all coexisting.
- **Semantic versioning**, with the caveat that pre-1.0 it means little and the
  data formats are the thing that actually needs a compatibility story — package
  and card schema versions are independent of the app version
  ([03 §7](../03-data-model.md)). The string is what the machinery reads; what
  a person calls a build is §7.1.
- **Every release tag needs a changelog entry**, because the About surface links
  to it and because §13 makes "what am I running" a user-facing question rather
  than a maintainer one.
- **Recorded at P6A's close, because five phases had already done it:** the
  phase branches are bare `p3`, `p4`, `p5`, `p6` and `p6a` rather than
  `feature/<slug>`, and each was merged with `--no-ff` as a true merge commit
  whose subject carries a colon subtitle — not §5's squash. The reason is worth
  keeping: the phase documents cite stage commits by hash, and a squash would
  leave every one of those citations pointing at nothing reachable from `main`.
  Whether §5 changes or the practice does is open; until CI enforces a name,
  this bullet is the one place the deviation is written down.

### 7.1 How a build is named — recorded 2026-09-05, before the first tag exists

*Stated at P6A's close and written down ahead of the first tag, because a tag
cannot be renamed and this was the last moment the scheme was free to change.
It changed once, the same day: the alphas had been `0.1.0-alpha.N`, and §8
records why they joined the regular sequence before anything was tagged.*

**Every build has a string and a name, and the string is the one the machinery
reads.** The string is semver: the tag is `v` plus it, `write-build-info.mjs`
refuses a tag that disagrees with the root `package.json`, `release.test.ts`
holds `compose.yaml`, the unraid template and the CHANGELOG entry to the same
string and the release workflow to the same image tag, and the data-directory
stamp ([P6A §1.7](19-p6a-alpha-1.md)) orders two builds by it. The name is
**derived from the string by one rule and typed nowhere on its own** — four
places carried the version before anything compared them, and a fifth that
could not be derived would be a fifth to disagree.

**One sequence, every prerelease named after the release it leads to:**

| Build | Name | String | Tag |
|---|---|---|---|
| The first alpha of 1.0 — the build [P6A](19-p6a-alpha-1.md) calls Alpha 1 | *1.0-alpha 1* | `1.0.0-alpha.1` | `v1.0.0-alpha.1` |
| The alphas after it, one sequence | *1.0-alpha 2* | `1.0.0-alpha.2` | `v1.0.0-alpha.2` |
| The first beta — feature-complete to the 1.0 spec (§0) | *1.0-beta 1* | `1.0.0-beta.1` | `v1.0.0-beta.1` |
| A hotfix on that beta | *1.0-beta 1.1* | `1.0.0-beta.1.1` | `v1.0.0-beta.1.1` |
| The release | *1.0* | `1.0.0` | `v1.0.0` |
| A hotfix on the release, on `release/1.0` (§2, §3) | *1.0.1* | `1.0.1` | `v1.0.1` |
| The next series, the same way | *2.0-alpha 1*, *2.0-beta 1*, *2.0* | `2.0.0-alpha.1`, `2.0.0-beta.1`, `2.0.0` | `v2.0.0-alpha.1`, … |

**A dot release is a hotfix, and the two kinds of build read it at different
depths.** A prerelease has one number, and a hotfix on it adds a second:
*1.0-beta 1.1* is a fix on *1.0-beta 1*, never a feature. A release has the
usual three levels, so the second is a release on a line of its own and the
third is a hotfix on it — if a *1.2* ever existed, *1.2.1* and then *1.2.2*
would be its hotfixes. §0 says the committed series are majors and that no
feature parks in a point release; the level exists in the scheme whether or not
anything uses it. Nothing deeper than a hotfix level is planned, and nothing
forbids one if it is ever needed.

**Alphas are not expected to be hotfixed, and the branch model does not
provide for it.** A prerelease is a tag on `main` ([P6A §1.6](19-p6a-alpha-1.md)),
so a hotfix on an alpha would need a branch cut from that tag, and §1 lists no
such branch. Recorded as a gap rather than filled: the intent is not to hotfix
an alpha at all, and a branch nobody wants to use is the kind of thing this
document exists to avoid writing. A beta hotfix has a home if `release/1.0` is
cut at beta 1, which is the freeze-not-release answer §8 leans toward.

**Why every prerelease carries the release's name.** The committed versions
([work plan §0](01-work-plan.md)) are one surface or tier each — 1.0 Play, 2.0 Write,
3.0 the Character Studio, 4.0 World, 5.0 Campaign, 6.0 the authoring tier — so
the major number moves
faster than the word usually implies, and *2.0-beta 1* says which of those it
is feature-complete to where a bare *beta 7* would not. The alphas carry it for
the same reason and for one more: a prerelease of `1.0.0` claims nothing about
feature-completeness. It says *before 1.0*, which is what an alpha is, and it
puts the whole line to 1.0 under one major, so every build orders against every
other.

**The semver underneath needs no rule of its own for any of this.** Prerelease
identifiers compare field by field, numerically when both are numeric, and a
longer set outranks a shorter one it extends — so `alpha.1 < alpha.2 < beta.1 <
beta.1.1 < beta.2 < 1.0.0` falls out of the specification. `compareVersions` in
`packages/server/src/build-info.ts` implements exactly that, and its test names
the hotfix shape in both directions, so that a stamp written by *1.0-beta 1*
opens under *1.0-beta 1.1* and not the other way round. The `v` on the tag is
for the workflow's `v*` filter, which exists because ~~`p1` is a tag too~~ a
phase marker such as `p1` would otherwise cut a release *(corrected 2026-10-04:
`p1` was a tag when this was written and is gone, and the filter's reason
outlived it)*; **the
image tag is the string without it**, which is what `compose.yaml` and the
template pull, and the workflow strips it before tagging.

**Rendering, so the name follows from the string by one rule:** drop the patch
when it is zero (`1.0.0` is *1.0*, `1.0.1` stays *1.0.1*), keep the hyphen and
put a space where the dot before the number was (`-beta.1` is *-beta 1*), and
keep a hotfix's second field as a dot (`-beta.1.1` is *-beta 1.1*). Read the
other way, every name yields its string. The rule is code since alpha.2 —
`versionName` in `packages/shared/src/version.ts` — and `version.test.ts`
reads the table above as its contract, so a row added here that the rule does
not produce fails the suite.

**In the CHANGELOG** the heading opens with the bare string, because
`release.yml` and `release.test.ts` both look for `## <version>` at the start
of a line; the name and the date follow after dashes —
`## 1.0.0-alpha.1 — 1.0-alpha 1 — unreleased` today, the date in place of
*unreleased* once the tag is cut.

---

## 8. Open

- **[OPEN]** When to introduce `nightly` and `testing`. Gated on CI reliability
  per §4, and on reaching beta per §0. **Resolved in part at
  [P6A](19-p6a-alpha-1.md), and the halves are worth naming separately** because
  only one of them moved. The *CI reliability* half is substantially met — the
  per-PR tier runs format, typecheck, lint, build, schema-drift, the suite and
  the named gate on ubuntu and Windows, and P6A adds the on-tag tier. The
  *reaching beta* half is **unchanged** and still gates both channels, because
  what P6A settles is only that a build may exist before beta (§0.1), not that
  one may be published to an audience. What remains genuinely open is therefore
  narrower than it was: not whether artifacts may exist during alpha, but when
  the project takes on people tracking one. **`testing` exists since alpha.2**
  (§4), moved by every `v*` tag for the project's own installs — the package
  is still private, so the *reaching beta* half still governs publishing a
  channel to an audience, and `nightly` is still open.
- **[OPEN]** How long a release line is maintained. "Forever" for the *branch*
  is cheap; "forever" for *fixes* is not, and the two are easy to conflate in
  users' expectations. A stated support window — current minor plus one — costs
  nothing to declare now and is awkward to introduce later.
- **[OPEN]** Whether release branches are cut at feature freeze or at release.
  Freeze allows stabilisation without blocking `main`, which is the usual reason
  to want them, and is probably right.
- ~~**[OPEN]** Which string carries an alpha~~ **Closed 2026-09-05, the day it
  was opened and before the tag: the alphas join the regular sequence as
  `1.0.0-alpha.N`, a hotfix as `1.0.0-alpha.N.M`, and the tree was renamed in
  one commit** — the root `package.json`, the CHANGELOG heading, `compose.yaml`,
  the template and [P6A §1.6](19-p6a-alpha-1.md), with `release.test.ts` proving
  they agree. The rendering settled with it: *1.0-alpha 1*, no `.0`, the same
  shape as *1.0-beta 1*. The question as it was put, kept because the reasoning
  is the record: the tree held `0.1.0-alpha.N`, chosen at
  [P6A §1.6](19-p6a-alpha-1.md) because pre-1.0 semver *"means little"*, and
  three things followed from that choice that the naming made visible — the
  `0.1.0` was a constant that meant nothing; the alpha was the one series whose
  name was not derivable by §7.1's general rule; and alphas had two rules where
  betas had one, `0.1.0-alpha.N` before 1.0 and `2.0.0-alpha.N` after it. The
  recommendation was the sequence now in force: one rule for every series, the
  string saying which release it is an alpha of, the whole line to 1.0 ordering
  under one major, and a prerelease of `1.0.0` claiming nothing about
  feature-completeness — it says *before 1.0*, which is what an alpha is. The
  cost was five strings and no data directory anywhere carried a stamp; after
  the tag it would have been a `v0.1.0-alpha.1` that stayed the odd one out for
  as long as the repository exists. The other coherent mapping, `0.N.M` with no
  prerelease identifier, matched the names as first stated and would have made
  a running build report a string with *alpha* nowhere in it.
