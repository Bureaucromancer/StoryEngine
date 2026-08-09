# StoryEngine — Preliminary Design Notes

**Status: early design exploration. Nothing here is decided.**

These are working documents for a clean-sheet engine that takes the *feature
territory* of Aventuras, Marinara Engine and SillyTavern without inheriting
their accumulated structure. They are deliberately **not comprehensive**. They
record an initial set of positions on where StoryEngine should *diverge* from
the obvious approach — "port the three feature sets into one server" — and they
leave large areas untouched on purpose.

Where a document takes a position, it is a proposal to argue with, not a
decision. Open questions are collected in [06-open-questions.md](06-open-questions.md)
and also flagged inline as **[OPEN]**.

## Reading order

| Doc | What it covers |
|---|---|
| [00-stance.md](00-stance.md) | Design principles, and the specific legacy patterns being dropped |
| [01-source-survey.md](01-source-survey.md) | What the three codebases actually do, what to take, what to leave |
| [02-data-model.md](02-data-model.md) | Actor cards, settings, game packages, lorebooks, sessions, on-disk layout |
| [03-modes-and-turn-pipeline.md](03-modes-and-turn-pipeline.md) | The mode contract, the three v1 modes, party, narrator/embodied axes |
| [04-server-multiuser-deployment.md](04-server-multiuser-deployment.md) | Multi-user, LAN-first, Tailscale, server-authoritative generation |
| [05-ui-surfaces.md](05-ui-surfaces.md) | Web-only client stance, library and workbench surfaces, file access as a permission |
| [06-open-questions.md](06-open-questions.md) | Decisions needed before implementation planning |
| [07-tech-stack.md](07-tech-stack.md) | Language, runtime, framework and library recommendations with reasoning |

## The four commitments these documents are built around

1. **Natively multi-user.** Username/password access separation for a trusted
   LAN. Not a security boundary, and the docs say so plainly wherever it matters.
2. **Natively web-based, server-first.** The default install is a server
   expecting LAN connections. The browser is *the* client — no desktop app, no
   native mobile app — and it is a view onto server-side state, not the place
   generation happens. The only secondary interface is direct file access to the
   data directory, offered in-UI as a permission level.
3. **Three chat modes at 1.0** — Messages (Marinara "Convo"), Scene
   (SillyTavern/Marinara RP), and Adventure (the "Game Mode" family) — with
   Adventure shipping two official presets and specified as an *extension point*
   rather than a fixed feature set.
4. **Data objects that make sense for LLM workflows**, stored as files on disk,
   with character cards stored natively as cards — drag a folder out of the
   storage directory and you have exported it.

## Terminology used throughout

- **Actor** — the single card type. Personas and NPCs are flags/tags on an
  actor, not separate types.
- **Setting** — the reusable tone/framing object that *points at* world content
  rather than containing it.
- **Package** — a shareable bundle of actors, settings, lorebooks, presets and
  mode config; the "full game setup" export.
- **Session** — one running story/chat. Sessions are created *from* settings and
  packages by copy, and never hold a live link back to them.
- **Mode** — the thing that defines how a turn is built and what state it owns.
- **Channel** — a named, typed slice of session state owned by a mode or
  extension (HP, quests, clock, weather, relationship, …).
