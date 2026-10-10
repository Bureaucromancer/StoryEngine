# `server/src/storage`

**The only directory in the repository permitted to import `fs`.**

That is a lint rule, not a convention — see the `no-restricted-imports` block in
`eslint.config.js` and its single override for this path. Everything else in the
tree reaches the filesystem through the helpers that will live here.

The rule exists ahead of the code it guards because the code it guards is
[20 §9](../../../../docs/design/20-tech-stack.md)'s *"single most important piece
of security code in the project"*: one audited path resolver, containment-checked
against the requesting user's root, symlink-aware. A rule written after the first
route touches `fs` is a rule negotiated with existing code.

## What is here

| File | Job |
|---|---|
| `paths.ts` | the audited path helper |
| `atomic.ts` | `write-file-atomic`, plus the self-write suppression token the watcher consumes |
| `files.ts` | the read side |
| `layout.ts` | user and system roots, kind directories, slug resolution, and the inverse: path → object |
| `card/` | the embedded card envelope and its PNG codec |
| `history.ts` | version history on library objects |
| `trash.ts` | the trash, and its retention sweep |
| `stamp.ts` | which build last opened this data directory |
| `transaction.ts` | a mutation run as one unit |
| `keyed-queue.ts` | a per-key FIFO, the serialisation behind the write paths |
| `captures.ts` | the cassette recorder's filesystem half |
| `local-source.ts` | a real directory, read as an import source |
| `import-scratch.ts` | scratch for an import, one directory per use, removed whole |
| `upload-landing.ts` | an upload written to disk as it arrives |
| `zip.ts`, `zip-file.ts` | a zip read as bytes with bounds, and a zip read where it lies |
| `zip-writer.ts` | a stored zip written — the World file's container, refusing before it writes anything those two would refuse ([P16.3c]) |
| `sqlite-snapshot.ts`, `sqlite-snapshot-worker.ts` | a consistent private copy of somebody else's SQLite database |
| `tar.ts`, `tar-archive.ts` | one ustar header — the server's copy of `tools/tar.mjs` — and a gzipped tar written from inside the server |
| `test-zip.ts` | real zip archives, for tests |

~~`files.ts` — the read side — the only other `fs` in the server.~~ *Corrected
2026-10-01:* the table had stopped at five rows while the directory grew to
twenty-odd, and ten of them import `node:fs` — `atomic`, `captures`, `files`,
`local-source`, `paths`, `sqlite-snapshot`, `tar-archive`, `trash`,
`upload-landing` and `zip-file`. That is the rule working, not breaking: it
says *where* the filesystem is touched, never *how often*. *(2026-10-10,
[P16.3c]: eleven, with `zip-writer`, which holds its `.part` through a
`FileHandle` as `zip-file` holds the archive it reads.)*

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
([03 §5.1.1](../../../../docs/design/03-data-model.md)).

**`card/` splices chunks and never re-encodes pixels.** A PNG is a list of typed
chunks, so writing a card rewrites the *list* — drop ours, append fresh ones,
re-serialise — and `IHDR`/`IDAT` pass through byte-identical. `card.png` is the
actor ([03 §5.2](../../../../docs/design/03-data-model.md)), not a thumbnail of
it, and decode-then-recompress would degrade the user's art a little on every
save, invisibly.

The envelope is deliberately separate from the PNG layout. `envelope.ts` defines
a `{schema, version, payload}` document and a `CardCodec` interface; `png.ts` is
one implementation of it. WebP `XMP` and JPEG `APP1` are then a codec rather
than a migration. **A codec never inspects the payload** — no validation, no
reading its `media` array — because that needs the registry and a place to
report problems, and a codec that understood payloads would need changing every
time a kind gained a field.

The JSON rides base64 in a `tEXt` chunk so any tool that lists PNG text can read
it; the media rides raw bytes in a private `seMd` chunk, because ~33% on the
large half of a card is worth avoiding
([26 B5](../../../../docs/design/26-open-questions.md)).

**`files.ts` exists because of the rule rather than in spite of it.** The index
at `../index-db` needs to read files, and the answer to *"may it import
`node:fs`?"* is no — it asks here. The veneer is thin on purpose: the point is
not abstraction but that there is exactly one directory to audit, and one place
to add a permission check when `fileAccess`
([10 §4.2](../../../../docs/design/10-ui-surfaces.md)) grows teeth.

Tests are exempt, and that is deliberate too: a storage test is playing the part
of the user with a file manager — renaming a folder, hand-editing a card — which
is the behaviour under test rather than a bypass of it.
