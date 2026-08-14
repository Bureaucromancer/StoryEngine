# `server/src/storage`

**The only directory in the repository permitted to import `fs`.**

That is a lint rule, not a convention — see the `no-restricted-imports` block in
`eslint.config.js` and its single override for this path. Everything else in the
tree reaches the filesystem through the helpers that will live here.

The rule exists ahead of the code it guards because the code it guards is
[07 §9](../../../../docs/design/07-tech-stack.md)'s *"single most important piece
of security code in the project"*: one audited path resolver, containment-checked
against the requesting user's root, symlink-aware. A rule written after the first
route touches `fs` is a rule negotiated with existing code.

## What is here

| File | Job |
|---|---|
| `paths.ts` | the audited path helper |
| `atomic.ts` | `write-file-atomic`, plus the self-write suppression token P1.4 needs |
| `layout.ts` | user and system roots, kind directories, slug resolution |

**`paths.ts` has two entry points and the difference matters.** `resolveWithin`
is lexical — pure, synchronous, and it catches everything expressible in the
path string. `resolveWithinReal` additionally follows symlinks, because a
lexically innocent path still escapes if something along it is a link pointing
out of the root, and only the filesystem knows that. Anything that will actually
touch the disk wants the second.

**Windows rules apply on every platform.** A trailing dot, a reserved device
name, an alternate data stream and an illegal character are all rejected on
Linux too — not out of caution, but because a data directory written on one
platform has to be readable on the other, and a name that is legal in one place
and not the other is a portability bug waiting to become a support thread.

**`atomic.ts` is the only writer.** Its self-write registry keys on
`(path, mtime, size)` rather than on the path alone, so a *foreign* write to a
file we also wrote is not swallowed by our own token — which is the difference
between suppressing an echo and losing an edit
([02 §5.1.1](../../../../docs/design/02-data-model.md)).

Coming next: `card.ts` at P1.3 — the PNG chunk envelope, which splices chunks
and never re-encodes pixels
([02 §5.2](../../../../docs/design/02-data-model.md)).
