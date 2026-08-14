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

Arriving at **P1.2** ([19](../../../../docs/design/19-p1-implementation.md)):

| File | Job |
|---|---|
| `paths.ts` | the audited path helper |
| `atomic.ts` | `write-file-atomic`, plus the self-write suppression token P1.4 needs |
| `layout.ts` | user and system roots, kind directories, slug resolution |

Then `card.ts` at P1.3 — the PNG chunk envelope, which splices chunks and never
re-encodes pixels ([02 §5.2](../../../../docs/design/02-data-model.md)).
