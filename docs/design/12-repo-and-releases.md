# 12 — Repository and release model

**Status: proposal.** Process rather than architecture. This document is the
draft of what eventually becomes `CONTRIBUTING.md`; it lives here while the
project is still design-only.

---

## 0. Project phases, and what each one gates

Most of this document does not apply yet. Recording the phases so it is clear
what is deferred rather than forgotten.

| Phase | Definition | Distribution |
|---|---|---|
| **Alpha** | *now.* Building toward the 1.0 spec. | **Build it yourself.** No release artifacts, no channels, no packages. |
| **Beta** | **Feature complete to the 1.0 spec** — every capability the design documents commit to exists and works. | Release handling starts here: tags, release branches, channels, the packaging tiers in [04 §5.4](04-server-multiuser-deployment.md). |
| **1.0** | Beta, stabilised. | Full packaging matrix. `release/1.0` persists. |
| **2.0 beta → 2.0** | The same gate again, against the 2.0 scope — Adventure–Campaign and Messages ([15 §0](15-work-plan.md)). | 2.0 work continues on `main` while `release/1.0` takes fixes. |

**1.0 is a real release, not a staging post.** It ships two modes — Scene and
Adventure–Freeform — chosen as the ones this project has opinions about, with
Campaign and Messages held for a 2.0 series ([15 §0](15-work-plan.md)). The
release model already handles the shape: `release/1.0` persists and takes
hotfixes, `main` moves on.

**Beta is a completeness gate, not a quality gate.** "Feature complete to 1.0
spec" is a usefully hard line — it is checkable against the design documents
rather than negotiable, and it puts the argument about whether something ships
*before* beta rather than during it.

**It is also only half the bar.** The other half is release engineering —
build chains, release automation, and workflows stable enough that shipping is
repeatable rather than an event. That belongs *in* the beta gate rather than
after it, and is sketched pending expansion in
[15 §7](15-work-plan.md).

Two consequences worth naming:

- **Release engineering is post-alpha work.** The packaging tiers, the channels,
  signing, and CI matrices are all beta-phase concerns. Building them now would
  be maintaining a distribution for software that has no users.
- **"Build it yourself" is the alpha distribution strategy, not a permanent
  philosophy.** [04 §5.4](04-server-multiuser-deployment.md) argues that
  build-from-source should stay genuinely first-class forever — that remains
  true, but during alpha it is the *only* path, which is a different claim.

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
([04 §7](04-server-multiuser-deployment.md)), which means builds embed their tag
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
  [04 §5.4](04-server-multiuser-deployment.md) the real install paths are a
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
[04 §6.5](04-server-multiuser-deployment.md), including the deliberate limits
that keep it from becoming telemetry, and its secondary use as a connectivity
signal that improves generation error messages.

**None of this exists until the pipeline is boring.** A nightly that is often
broken teaches people to ignore it, which is worse than not offering one.

---

## 5. Merge strategy

**Squash-merge into `main`.** One commit per feature or bugfix.

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
  ([02 §7](02-data-model.md)).
- **Every release tag needs a changelog entry**, because the About surface links
  to it and because §13 makes "what am I running" a user-facing question rather
  than a maintainer one.

---

## 8. Open

- **[OPEN]** When to introduce `nightly` and `testing`. Gated on CI reliability
  per §4, and on reaching beta per §0.
- **[OPEN]** How long a release line is maintained. "Forever" for the *branch*
  is cheap; "forever" for *fixes* is not, and the two are easy to conflate in
  users' expectations. A stated support window — current minor plus one — costs
  nothing to declare now and is awkward to introduce later.
- **[OPEN]** Whether release branches are cut at feature freeze or at release.
  Freeze allows stabilisation without blocking `main`, which is the usual reason
  to want them, and is probably right.
