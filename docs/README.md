# Documentation

- **[api.md](api.md)** — the HTTP API, as built. The client browses everything,
  edits actors since P1.7 and lorebooks since P5.1, deletes since P4.4, and
  makes an actor or a lorebook from the library page; the API is still the only
  way to *create* the four kinds that have no editor. ~~and the only way to choose
  a session's lorebooks at all.~~ *A session's lorebooks are chosen in the
  browser since P6B.0; what has no editor is a preset, a treatment or a setup,
  which is [P11](design/workplan/27-p11-implementation.md)'s.*
- **[deploy.md](deploy.md)** — running a built one: the image, the compose file
  and the unraid template, since P6A.4. The package is private, and the page
  opens by saying so.
- **[design/](design/)** — preliminary design notes. Positions to argue with,
  most of them written before any code existed. Start at
  [design/README.md](design/README.md).
- **[design/workplan/](design/workplan/)** — what gets built and in what order:
  the work plan, the triage it rests on, the phase documents, the polish list,
  testing and the release model. Split out because those change as work lands,
  while the design changes only when a position does.

Documentation of code that actually exists will live here, alongside `design/`
rather than inside it. Where the two disagree, this directory is right and the
design notes are a record of intent.

`api.md` is the first of those, and it is written to that rule: it describes what
the routes do today rather than what they are meant to become. `deploy.md` is
the second, and to the same rule.
