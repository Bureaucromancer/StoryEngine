# 16 — P2C findings log

**Appended to as things happen; emptied by [P2C.4](15-p2c-first-real-run.md)'s
triage; kept afterwards rather than deleted.** What a person saw the first time is
not reconstructible later, and it is the one artifact a second pass cannot
produce — a second pass is by definition made by somebody who already knows.

**This file is not a queue.** Nothing is fixed *because* it is written here.
[P2C §2.5](15-p2c-first-real-run.md) decides where each entry goes, and the
decision is made at triage rather than at the moment of annoyance, because
afterwards every finding argues for its own importance.

---

## How to write one

Five lines, in this order, so a finding arrives as a record rather than as prose.
The first three are what make it reproducible; the last two are what make it a
finding rather than a feeling.

```
build     git describe --tags --always --dirty
endpoint  the provider and the model, or `fake`
session   session id, and turn id if there is one
expected  what you thought would happen, written *before* looking further
observed  what did, including the log line if there is one
snapshot  path to a copied data directory, or `none`
```

**`expected` before `observed`**, and written before investigating. A finding
recorded after the diagnosis is a finding shaped by it, and the gap between what
somebody expected and what happened is most of what this phase is for — it is the
part that stops being visible the moment you understand the cause.

**`snapshot` is a real path or the word `none`.** [P2C §1.4](15-p2c-first-real-run.md)
buys the procedure: stop the server, copy the whole directory including `-wal` and
`-shm`. A finding whose state is gone is one somebody will re-derive from scratch.

---

## Sessions

*Each session gets a heading with its date and which stage it belongs to.
Findings go under it in the order they happened, not in order of importance —
the order they happened is data, and reordering by importance discards it.*

<!-- No sessions yet. P2C.0 is the work before the first one. -->

---

## Triage

*Filled at [P2C.4](15-p2c-first-real-run.md). Every finding above gets exactly one
row, and the phase does not end while this table is shorter than that list.*

| Finding | Home | Why |
| --- | --- | --- |

**The five homes, from [P2C §2.5](15-p2c-first-real-run.md):** stopped the phase ·
fixed inside it · a gate correction · [polish](09-polish.md) ·
[PLAYABLE](01-work-plan.md) or [roadmap](../14-roadmap.md).
