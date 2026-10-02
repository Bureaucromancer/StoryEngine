# Documentation

- **[api.md](api.md)** — the HTTP API, as built. The client browses everything,
  edits actors since P1.7 and lorebooks since P5.1, deletes since P4.4, and
  makes an actor or a lorebook from the library page; the API is still the only
  way to *create* ~~the four kinds that have no editor~~ ***nothing: every
  library kind has an editor and a create control from [P7B](design/workplan/24-p7b-presets-and-prompts.md)***. ~~and the only way to choose
  a session's lorebooks at all.~~ *A session's lorebooks are chosen in the
  browser since P6B.0;* ~~*what has no editor is a preset, a treatment or a
  setup, which is [P11](design/workplan/28-p11-implementation.md)'s.*~~
  ***Wrong twice, corrected 2026-09-14: it is four kinds, not three — preset,
  treatment, setup and package — and [P11](design/workplan/28-p11-implementation.md)
  never owned them. Its editor stage improves editors that exist and creates
  none. **All four are
  [P7B](design/workplan/24-p7b-presets-and-prompts.md)'s**, which is the phase
  that closes this sentence for good.***
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
- **[guide/](guide/README.md)** — the user's guide: how to use StoryEngine as
  it is built today, from a first turn through the library, lore, presets,
  importing, pictures, connections, accounts and backups, with a page of
  troubleshooting. Written 2026-10-01 against `main`, from the code rather than
  from the design notes.

Documentation of code that actually exists will live here, alongside `design/`
rather than inside it. Where the two disagree, this directory is right and the
design notes are a record of intent.

`api.md` is the first of those, and it is written to that rule: it describes what
the routes do today rather than what they are meant to become. `deploy.md` is
the second, and to the same rule. `guide/` is the third, and holds to it most
strictly of the three, because its readers are the people least able to tell a
plan from a feature: where a control is missing, a setting can only be made by
editing a file, or a behaviour is a known fault, the guide says so in the place
a reader would trip over it, rather than describing what was intended.
