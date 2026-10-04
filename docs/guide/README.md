# Using StoryEngine

StoryEngine is a self-hosted engine for character-driven interactive fiction. You
run it on a machine of your own, point it at the language models you already have
— a local Ollama or LM Studio, a box on your network, or any OpenAI-compatible
service — and play from a browser. Several people can share one install, each with
their own library and stories.

This guide is for the people who use an install: playing, building characters and
worlds, bringing in what you already have from SillyTavern, Marinara Engine or
Aventuras, and — if the install is yours — looking after it. It describes what
StoryEngine does **today**. The design notes in [`docs/design/`](../design/README.md)
describe what it is meant to become; where the two differ, this guide follows the
code.

> **Which build this describes.** The guide was written against the `main` branch
> on 1 October 2026. The newest tagged release, 1.0.0-alpha.4 (9 September 2026),
> is older than much of what is described here, and its version string is still
> what a build of `main` reports. If you run that release, expect parts of this
> guide to describe things your install does not have yet.

## Start here

- [Getting started](getting-started.md) — from a running server to your first turn.
- [Concepts](concepts.md) — the ideas the rest of the guide leans on: the library's
  kinds, sessions as a tree, modes, connections and jobs.

## Playing

- [Playing a session](playing.md) — starting one, the composer, branching and
  rewinding, the panels beside the story, the workbench, reading and searching.
- [Modes](modes.md) — Scene, Freeform and the assistant: what each is for and what
  it adds.
- [Pictures](pictures.md) — illustrations, backdrops and faces, and showing the
  model a picture of your own.

## Building

- [The library](library.md) — characters, treatments, setups and the other kinds;
  editing, history, tags, pictures, copies and deleting.
- [Lorebooks and memory](lorebooks-and-memory.md) — how entries fire, folders and
  gates, memory books and the running summary.
- [Presets and prompts](presets.md) — what a preset is, its blocks, and how a
  prompt is put together.
- [Importing and exporting](importing-and-exporting.md) — what comes in from other
  tools, what goes back out, and what a conversion cannot carry.

## Running an install

- [Connections and models](connections-and-models.md) — endpoints, the jobs models
  are bound to, and which model answers.
- [Settings, accounts and the install](settings-and-accounts.md) — signing in,
  your settings, accounts, configuration, restarting.
- [Backups, restore and the trash](backups-and-trash.md) — archives, getting data
  back, and undoing a delete.
- [Running a built StoryEngine](../deploy.md) — the container, the unraid template,
  the systemd tarball, HTTPS and updates.

## When something goes wrong

- [Troubleshooting](troubleshooting.md) — what the common refusals and failures
  mean, and where to look.

## How this guide is written

- Words in **bold** are what the screen says — a button, a heading, a field — except where
  they introduce a term or lead a list item.
  *Settings → Administration → Accounts* is a path through the app.
- *Administrators only* marks what an ordinary account does not see.
- `Code` is a configuration key, a file, or something you type.
- In the app, the **Assistant** in the header can answer many of the same questions
  from a built-in help lorebook, and the [HTTP API](../api.md) documents most routes
  for anyone scripting an install.
