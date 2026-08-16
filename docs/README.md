# Documentation

- **[api.md](api.md)** — the HTTP API, as built. Still the only way to *create*
  an object; the client browses everything and, since P1.7, edits actors.
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
the routes do today rather than what they are meant to become.
