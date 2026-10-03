# Third-party notices

StoryEngine is free software under the GNU Affero General Public License,
version 3 or (at your option) any later version — **except the files listed
under [Version 3 only](#version-3-only)**, which contain code from projects
licensed under version 3 alone and so can be offered under version 3 alone. The
program as a whole can therefore be relied on under AGPL-3.0; the *or later*
permission applies file by file, to every file not in that table.

[Triage §1](docs/design/workplan/02-triage.md) set the rule this file keeps:
*attribution and the original notices must be preserved on anything taken.*
Written 2026-10-03, when the repository was made public, from an audit of every
tracked file and every commit against the upstream sources.

## Where the line falls

- **Upstream code copied into a file** — a function, a table of patterns —
  and the file carries the version-3-only header
  (`SPDX-License-Identifier: AGPL-3.0-only`) and is listed below. The lint
  configuration enforces that header on exactly these files (`DERIVED_FILES` in
  [`eslint.rules.js`](eslint.rules.js)), and a test holds that list to the
  table here, so neither can change without the other.
- **A function re-implemented from what the upstream one does**, and **facts
  about a format** — the names of a project's files, directories, tables,
  columns and fields, the values its enums take, the hash of a template it
  ships — are recorded with their source but not relabelled. So is a single
  credited sentence of prompt text.

Reading another project's files to learn their format, which is most of what
the importers do, takes nothing from that project's code.

## The upstream projects

| Project | Source | Licence | Pinned at |
| --- | --- | --- | --- |
| SillyTavern | <https://github.com/SillyTavern/SillyTavern> | AGPL-3.0 (version 3; no *or later*) | `06bde939` (1.19.0) |
| Marinara Engine | <https://github.com/Pasta-Devs/Marinara-Engine> | AGPL-3.0 (version 3; no *or later*) | `459f8b85` |
| Aventuras | <https://github.com/AventurasTeam/Aventuras> | AGPL-3.0 (version 3; no *or later*) | `c43da108` |

Each project's `package.json` declares `AGPL-3.0`, which names version 3 and
does not grant later versions. Copyright in each belongs to its contributors;
none of the files taken from carries a copyright line of its own. The names are
used only to say what StoryEngine imports from; Marinara Engine's trademark
policy (`TRADEMARKS.md` in its repository) governs its name and marks.

## Version 3 only

Each file below is licensed `AGPL-3.0-only` and says so in its header.

| File | From | What was taken |
| --- | --- | --- |
| `packages/server/src/import/marinara/store-format.ts` | Marinara Engine | `encodeShardKey`, `WINDOWS_RESERVED_BASENAMES` and the shard-file pattern, copied from `packages/server/src/db/file-backed-store.ts`, with line references in the file |
| `packages/server/src/import/marinara/preset.ts` | Marinara Engine | `wrapperFor`'s tag-name rules, copied from `nameToXmlTag` in `packages/shared/src/utils/xml-wrapper.ts` |
| `packages/server/src/import/sillytavern/chat.ts` | SillyTavern | `parseTimestamp`, ported from `public/scripts/utils.js` branch for branch, with its four date patterns verbatim; and two patterns from moment (below) |

## Credited, not relabelled

Recorded so that nothing taken goes unnamed, on the facts-about-a-format side
of the line:

- **SillyTavern's continue nudge**, one sentence, verbatim —
  `packages/server/src/assembly/collect.ts`, credited there.
- **SillyTavern's default main prompt**, one sentence, adapted —
  `packages/modes/scene/src/preset.ts`, credited there.
- **SillyTavern's ChatML and DeepSeek instruct templates**, as test input —
  `packages/server/src/import/upload.test.ts`, credited there.
- **Format vocabularies and registries** — the file, field, table and column
  names of all three projects, in `packages/server/src/import/registries/`,
  `packages/server/src/import/sillytavern/vocabulary.ts` and
  `sensitive-fields.ts`, `packages/server/src/import/aventuras/packs.ts`
  (template hashes, no template text) and `pic-tags.ts`.
- **Aventuras' vault row mappers** — `mapVaultCharacter`, `mapVaultLorebook`,
  `vaultEntryToEntryLike`, `mapVaultScenario` and `mapVaultTag`, from
  `src/lib/services/database.ts` and `lorebookImportExport/export/vault.ts` —
  re-implemented from what they do (which column becomes which field), not
  copied, in `packages/server/src/import/aventuras/vault-*.ts`; each file says
  which mapper it reproduces.
- **The lorebook entry's shape**, modelled on Marinara Engine's
  `types/lorebook.ts` ([03 §3](docs/design/03-data-model.md)) and written as
  this project's own schema in `packages/shared/src/schema/lorebook.ts`.

Every import fixture is written for this project and says so; no character,
lorebook, preset or chat from any of the three projects, or from anywhere else,
is in the repository or its history.

## moment

`packages/server/src/import/sillytavern/chat.ts` contains two regular
expressions and a table of ISO 8601 formats from moment 2.30.1
(<https://github.com/moment/moment>), under this licence:

```text
Copyright (c) JS Foundation and other contributors

Permission is hereby granted, free of charge, to any person
obtaining a copy of this software and associated documentation
files (the "Software"), to deal in the Software without
restriction, including without limitation the rights to use,
copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the
Software is furnished to do so, subject to the following
conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES
OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
OTHER DEALINGS IN THE SOFTWARE.
```

## Dependencies

Every production dependency is under a permissive licence compatible with the
AGPL (MIT, Apache-2.0, ISC, BlueOak-1.0.0, BSD-3-Clause, Unlicense), and each
carries its own notice in its package; `pnpm licenses list --prod` lists them.
