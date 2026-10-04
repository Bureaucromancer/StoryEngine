// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { createHash } from 'node:crypto';
import type { DatabaseSync, SQLOutputValue } from 'node:sqlite';

import type { ImportNote } from '@storyengine/shared';

import type { SourceItem } from '../source.js';
import { integer } from './vault-row.js';

/**
 * ***Prompt packs, recorded and not converted*** —
 * [P13.9](../../../../../docs/design/workplan/30-p13-aventuras-import.md),
 * on [§1.10](../../../../../docs/design/workplan/30-p13-aventuras-import.md#110-packs-are-their-own-stage).
 *
 * **The stage was allowed to close this way, and closed this way on the
 * evidence.** Its first step was a table from every Aventuras template id to
 * what it would become here, with [P4 §1.6]'s namespace applied to the Liquid;
 * the table is below, one comment per group, and the stage record carries it in
 * full. What it showed:
 *
 * - **Four rows of eighty-one have a counterpart** — the two narrator prompts,
 *   `adventure` and `creative-writing`, and their `-user` halves. Every other
 *   id drives something with no preset surface here: a classifier or a lore
 *   agent whose reply is a JSON contract of Aventuras' own, the story wizard,
 *   translation, images, and a memory pipeline that is [P8]'s shape but whose
 *   prompt is engine text inside the summariser's cache key.
 * - **In those four, one variable of eighteen translates.** Our render
 *   namespace is `char` and `user` (`assembly/template.ts`), names and never
 *   bodies. `protagonistName` is `user`. The story's `genre`, `tone`, `themes`
 *   and `settingDescription`, `chapterSummaries`, `tieredContextBlock` and
 *   `storyTime` are bodies that slots supply here; `lengthInstruction`,
 *   `styleGuidance` and the two image modes have no equivalent.
 * - ***And the ones that do not translate are the ones the templates branch
 *   on.*** `pov`, `tense` and `narratorReinforcement` have no name in our
 *   namespace — a treatment's `tone` holds the first two, and a template cannot
 *   read it — so they render empty. Both `-user` halves are wholly inside a
 *   `case` or `if` on `narratorReinforcement`, and render **nothing**; the
 *   system half's voice rules take their last branch every time, so a preset
 *   made from them says *second person, present tense* to a story its own
 *   treatment says is third person, past. That is the *mangled prompt that
 *   looks fine* [04 §8.4.2] is written against, made by the importer.
 * - **The layout does not carry either.** Aventuras renders its whole context
 *   into the system prompt through those variables and sends the history as
 *   one user message; ours positions each with a slot. A preset "from" a pack
 *   would be the built-in pack's slots around a foreign system prompt — a
 *   preset this converter wrote, with somebody's prose inside it.
 *
 * A pack's `pack_variables` would carry one for one, as `PresetVariable` was
 * adopted from them ([P4 §1.5]) — and stay inert, as every imported preset's
 * do, *and* the templates' references to them would render empty for the same
 * reason. Growing the namespace is what would change the answer, and that is a
 * decision about the renderer ([06 §5], `RenderContext`'s *growing it is a
 * decision to be argued*), not about an importer.
 *
 * ***So each pack is one `recorded` row of the review***, named
 * `aventura.db/preset_packs/<id>` as a story is ([§1.5]), saying what it holds
 * and — the part a person needs — which of its templates are theirs. Nothing
 * is written. The pack tables keep their own `recorded` rows with their counts.
 *
 * ***"Theirs" is "differs from the text Aventuras ships at the pin"***, which
 * is what the stage asks and what Aventuras' own `isTemplateModified` asks —
 * not §1.10's `content_hash` against `baseline_hash`, found wanting on both
 * sides by reading the writer. A pack **imported** into Aventuras is written
 * with its content as its baseline (`import-export.ts`), so every template in
 * it reads as untouched however much somebody wrote; and a backup from before
 * migration 036 has no `baseline_hash` at all. *And §1.10's "only a pack that
 * is not the default" is wrong too*: migration 036 exists because people edit
 * the default pack's templates, and its startup refresh was reverting them.
 * The cost of this test, said in the note's own sentence: a template a pack
 * was seeded with by an older Aventuras, and never touched, differs from the
 * pin's text too.
 *
 * The hash is Aventuras' own (`packs/hash.ts`): SHA-256 of the content trimmed,
 * then with CRLF made LF. Computed from `content` here rather than trusting
 * `content_hash`, since the column is only as good as whatever wrote it.
 */

/** The table, and the middle of every pack row's `source` (§1.5). */
export const PACK_TABLE = 'preset_packs';

/**
 * ***Every template id at the pin, and the hash of its default text***, from
 * `PROMPT_TEMPLATES` (`services/prompts/templates/`) at `c43da108` — each
 * template's `content` under its id and its `userContent` under `<id>-user`,
 * as `pack-service.ts` seeds them. Forty-three ids, thirty-eight with a user
 * half: eighty-one rows.
 *
 * **Hashes only, never the text** — the registry's rule, for the registry's
 * reason: the text is another project's, and a hash is a fact about it. Each
 * group's comment is the mapping table's verdict on it.
 */
export const AVENTURAS_TEMPLATE_DEFAULTS: Readonly<Record<string, string>> = {
  // ── The narrator: a counterpart here (the `narrate` call), and still not
  //    converted — see the file header.
  adventure: '325a5132ebdceaeb1cbb3128999144a253b9087a81b36325f1a60b46942cb4d8',
  'adventure-user': '148593388e1e1c696e9d45d18203e1e3796b74780ba86fe1c70d9788d29d06e2',
  'creative-writing': '40612e638a5243408f0da966f84a78581f8210a3edf1b3203f6f65a18f4a0d84',
  'creative-writing-user': 'baa6f6bf1a0754d5cc3044d27d01c52bccb17b5bf41431830daa83087f729d44',
  // ── Memory: P8-shaped, but our summariser's prompt is engine text inside its
  //    cache key, not a preset's.
  'chapter-analysis': 'd3b9483cd6c1c943e680933f0379c302fb01a5e357dc627324853d0336bef24f',
  'chapter-analysis-user': 'de1335ea71f0ddfb26e311da63a5031eca6b076223fd1252a16e225636c30d24',
  'chapter-summarization': '2cd048d8f551ce86b933fd0c307cfa45c7c46fe303a544c5eb8e6a1e7c2a39b7',
  'chapter-summarization-user': '1eb0e8180d9a0d672863038c6dee5a7df440d4e98ab28638e5197b81f7d39e35',
  'chapter-timeline': '413376672e71163aca8762201f7f89c9c1560117a9cb322b26e3524199aaad16',
  'chapter-timeline-user': '5e070f88974a9ac5da0cdbe7cae1e9dcfa431f96f8da8c10cdbe1d46f0c0e3af',
  'retrieval-decision': '40ed8a5e3bf7b0008a4242d3ce4ff6869f2502375d1aea5344f6896d63dc0c20',
  'retrieval-decision-user': 'f374be4fdaa89b7c992d9bb42301dfbd942b92cb07d37e776dbfa79ef237ae6b',
  'timeline-fill': 'a4f69707afea66c6e5e80ec4d093fbff59f8ff4f56a853384b92b19db37202fb',
  'timeline-fill-user': '23a6252730b8fa5e9d9f8f220077d113bb04e05bcdb6da3b16a14c8f25088cc3',
  'timeline-fill-answer': '47d3db20074792fde4a724615759010260ac895c91ab132ceab1a143fb1198ca',
  'timeline-fill-answer-user': 'e5832accec60d9fcdbcfe3d08f028ea499cdf8d8811d781fef81a52f60e97732',
  'timeline-fill-batch-answer': 'c2b46d0078f6392f49dc92d65cf6460d03f7f4a71b150a750870e9aa45191884',
  'timeline-fill-batch-answer-user':
    'b7cc761afe1abe68f995f0f62bf7c614a19ac3cd815addf714b136587730653c',
  'agentic-retrieval': '38e94dc99ac4ec4144f34a650407a8fc01026fac4252aa6025466af73efdeef4',
  'agentic-retrieval-user': '05b997e8973ce54a57367394d754b3cf55c6cfdd01919b5f30396a9b975c445a',
  'tier3-entry-selection': 'bc0120f0b71789cbeb6425904cb4794e94097481191ca42b049fac21ef6afc67',
  'tier3-entry-selection-user': '336a30238b808790b045b2f40e5a503fd53d473af8de13e884c659a256bf0b68',
  // ── Classifiers and the lore agent: world-state extraction, answering in JSON
  //    contracts of Aventuras' own. No counterpart.
  classifier: 'c8e5421c024475f93acafa94b9dd6b885620bae5d5c614c388f376e07ac48802',
  'classifier-user': '2ee6918b311e280111b24694841fa3f6a8c76348a13f46804861c37362764e81',
  'lorebook-classifier': '7c9793a0125d8502a13d365fbe6e2ffc67d804e32d2bb58e15ac9fd9c92dfd27',
  'lorebook-classifier-user': '6df645f017b3f98fdff707c48ad8fcf91c35fb5a794a62cc20a02e9648529ecf',
  'lore-management': '83585c7faa0a88876c15c5dbc6d2cdc98288a13522b6a857956d8a573e91953d',
  'lore-management-user': 'b06345c27112fbf4abc689343b6d128d25db4e69b2e160b66c0509f5d1edb1f0',
  'interactive-lorebook': '2a806943e8486278d7f7631431af702b0b2a55d469b43ab6a70d747fa28704dc',
  'style-reviewer': 'abcacae230b6cf380e98ec665eec669b4faacb104753e3740feee3689fc3d787',
  'style-reviewer-user': 'e96eda7764e83a236635350cbf20ded8b03a886efadfd287bc4908645de8d28e',
  // ── Suggestions: our suggester has a call kind, and its reply is not this JSON.
  suggestions: 'bc383ab4b6ce7088a068b9e9cc077237b4323c123b27ece57dc02cae7df08cf2',
  'suggestions-user': '1ed47a2ef7c6b682f72ffbaca8e0a315703299a8e40ef796349683154f1d2e55',
  'action-choices': 'ee6e3152d55732c5b77991282c05d8f8c7f58c4c10a5b62a882111e921443088',
  'action-choices-user': '5f41c578c718dc9b7b0b87c4a95a5f45db5193427078edda894d6485ec252aea',
  // ── The story wizard and card cleaning. No counterpart.
  'setting-expansion': 'cf6230d05b31188f93fb374e8565f49cbd2bb0ef67ac4a5039fab39a116299fb',
  'setting-expansion-user': '7d7b6f8c3a46cc631979ec2e08d3cf1525d6a8224a30b9a8d47d53e59e57108f',
  'setting-refinement': '34069f000526fe197343480ac8ae1463e1e38fd32e65b6be59d6c3be15edcb8b',
  'setting-refinement-user': 'f19691376d069dd6a81bed9e28b66aec45039bc602fca0dab51bcbeee99f20d5',
  'protagonist-generation': 'e656017715c9dec2c572aea8af9f9997803c52cb23bdffbf9777e059ca318ac2',
  'protagonist-generation-user': '8553b29f4fe9babc10e332bd1d901e5d74986d54d9eb178ad504485e5dce8dfa',
  'character-elaboration': 'cd70d652bc8de362d6f2ba847f6e8f7e1f9114c41d71c649f1b0dce8a91aba28',
  'character-elaboration-user': '8f265f942f0e3bacafa0b7df6e6cdab24b44516fe653d852cff9647440ce10d6',
  'character-refinement': '2d44a889793fabb321418a83bc097280ecc009a869c46faa1d24808f939556a3',
  'character-refinement-user': 'd7b9e1deffd92547ee69357e68c10575db1f60f86a364b8b2585de3ba10c3f02',
  'supporting-characters': '37abdf87d31b877bc6b6ab672e6d3b8474946fb23ea585a3f1b618591a387831',
  'supporting-characters-user': '90c3f7f951b287b88de82f6c3ff1032956c01957aa77160f4fbddbf94cf2b99f',
  'opening-generation-adventure':
    'ab024d9897b4c8f49f7bf02f6b7d08398aa329324a24e314e99570736fca5cfb',
  'opening-generation-adventure-user':
    'c57ba62b789b04ebc237447f3aebf9f37ee6fdc9d75ca8fc2a0a9d245d63fc4e',
  'opening-generation-creative': '755dab02fe844d26c39fe0a1c01f6b3bb516800d424507257200a62e0b0b3222',
  'opening-generation-creative-user':
    'cc4045150f7ef76244326b7ff9d5e9749794acb103ac8e3fec6acfcb7b110ce3',
  'opening-refinement-adventure':
    '6b29e9ab6fb51164b58c6de7cb3ee316bb0d71294d9477ecb96ae57d17c7eb8d',
  'opening-refinement-adventure-user':
    '6c0234b54610d478324673fdc80367fd97acabd816cf213eb7dfeefe04c070a4',
  'opening-refinement-creative': '88a299a3cadf8682c9d5d1a3b99b51702b21f152103dd6c4042ce0d9d961eee5',
  'opening-refinement-creative-user':
    '78538b5835ff1d0af6814db3e330d3f8d6f134184dfbf47ee7ca5f89d88b2edd',
  'character-card-import': 'a2fd7d447d89da3731ba1e27077c98a02a2d77b72801e1fc7f90bd63acb8eca2',
  'character-card-import-user': '3f3c75686e0b55448fde702ed4952e766a40f45722352ea1e40a4bb695a3f31a',
  'vault-character-import': '4f396391ab7748cd7d02db7a3af369107717afa515a15e86941b3f492329879a',
  'vault-character-import-user': 'ca31f47f4bfb0d7ba3b384774caf8f3c6f4cf110789db3b529a8dec72dea93d0',
  // ── Translation. No counterpart.
  'translate-narration': 'da96bda0e0e9413db07bc4253c863e185a77d601be22854ee58f12f912dfac2c',
  'translate-narration-user': '52ed09e8448c395a40c52b4d91dc1818070d481a6afd2354b2653956dbf2dfc5',
  'translate-input': 'aab8ab55da32b797622df558650d4d49e0cee1f0c12b425d6317d9cdb58207a1',
  'translate-input-user': '52ed09e8448c395a40c52b4d91dc1818070d481a6afd2354b2653956dbf2dfc5',
  'translate-ui': '8e91d7267e05a467c08ddaf438c69153a2be5ca394f1a6bd5203776b70251a86',
  'translate-ui-user': '5114f21e59971704f9e2c4196d928c96e988e20d2f7cfdfd13c35655aa00d7c9',
  'translate-suggestions': 'ccbc8213a2f01304c990bb30306348762ed55545db4b004c5766dc2d8fc8ecdb',
  'translate-suggestions-user': '181232d41f9b17a5899f8899491db5c8b11f3e9396ebef94743904b212deb532',
  'translate-action-choices': 'b025dba2c6037b0084305c0076f1cc508afaed16c1ea4a9fdf0bd261dc2bbdee',
  'translate-action-choices-user':
    '720e8137248b7892a693f78700cb8fae26c0c2c53855230d08b872253134fb71',
  'translate-wizard-content': '49158a3a7d82b2398a18f5b54662d9ea774f263f28c6c10f9ef3489e699d988f',
  'translate-wizard-content-user':
    '52ed09e8448c395a40c52b4d91dc1818070d481a6afd2354b2653956dbf2dfc5',
  // ── Images: styles and scene analysis. A style is a treatment's tone here
  //    (`renditions/assemble.ts`), not a preset's.
  'image-style-soft-anime': '39e7ab7734ce3fdcea5a340e1bca16b8e1ae87ab6d02cf251414c932524576b5',
  'image-style-semi-realistic': 'fa380a616869e0d4b4904c88eb989b29d5ece4262ef8a35d99ee8b48831d118c',
  'image-style-photorealistic': 'e4989a2751b03563752450df49b237d7d1a18c528a8cc736a634137ecda21572',
  'image-prompt-analysis': '6a3ce42a1053f0fc00b46f312713f89fec2e661cb32204023a1593cf4ad53ef2',
  'image-prompt-analysis-user': '8269dd1126f1073c054fdb102c4c30db9c22dcaa9eb0469b60c8e8abd1d8979e',
  'image-prompt-analysis-reference':
    'c31816c05ab2f8d84ed8e97ea3a6be18146a1c9fc527d5c1e96b2a812f0318d1',
  'image-prompt-analysis-reference-user':
    '7cd63d46ba88d0772489baae3a92b4738743a40e50111a8d5d05dcfad5fe5035',
  'image-portrait-generation': 'cacbdac6fdc53a747414ea6ad087e84198253a829b98bd7d11e49926daefde6b',
  'background-image-prompt-analysis':
    '4f9c0603d147e8407e89b49a55e1343aa8c2063219984dbc6f1f8b7c536d2ae2',
  'background-image-prompt-analysis-user':
    '47b3dfa3959fa2f8ed17ab45b4cf2d25be7d19ff804432dfa62864f2fe7fc977',
};

/** Aventuras' `hashContent`, synchronously. */
export function templateHash(content: string): string {
  return createHash('sha256').update(content.trim().replace(/\r\n/g, '\n')).digest('hex');
}

/**
 * ***Whether a stored template is somebody's*** — see the file header. An id
 * the pin does not ship has no default to be, and is somebody's (a newer
 * Aventuras's template counts too, which the note's wording allows for); so is
 * content that is not text at all.
 */
export function templateDiffers(templateId: string, content: SQLOutputValue | undefined): boolean {
  const shipped = Object.hasOwn(AVENTURAS_TEMPLATE_DEFAULTS, templateId)
    ? AVENTURAS_TEMPLATE_DEFAULTS[templateId]
    : undefined;
  if (shipped === undefined || typeof content !== 'string') return true;
  return templateHash(content) !== shipped;
}

/**
 * **How many template ids one note names**, and how long each may be. Ids are
 * text out of somebody else's database on their way into the ledger; a real
 * one is `opening-refinement-adventure-user`, and a pack has at most the pin's
 * eighty-one unless something other than Aventuras wrote it.
 */
const LISTED_IDS = 81;
const ID_LENGTH = 64;
/** A pack's name, likewise — a real one is a few words. */
const NAME_LENGTH = 200;

export interface PackTables {
  database: string;
  /** The tables the database has: a pack table it predates has no rows (`schema.ts`). */
  tables: ReadonlySet<string>;
}

/**
 * ***One `recorded` row per pack***, default first and then by name, each
 * with {@link packRecorded}'s counts and — when any of its templates differ
 * from the pin's — the ids that do, at `warn`, since those are what somebody
 * wrote and what this import leaves in Aventuras.
 *
 * Three grouped reads and one walk of `pack_templates`, whose rows are a few
 * kilobytes of prose each; the content is hashed and let go of row by row.
 */
export function* packRows(db: DatabaseSync, where: PackTables): Generator<SourceItem> {
  if (!where.tables.has(PACK_TABLE)) return;

  const templates = new Map<string, { count: number; differ: string[] }>();
  if (where.tables.has('pack_templates')) {
    const rows = db
      .prepare('select pack_id, template_id, content from pack_templates order by template_id, id')
      .iterate();
    for (const row of rows) {
      const pack = row['pack_id'];
      if (typeof pack !== 'string') continue;
      const tally = templates.get(pack) ?? { count: 0, differ: [] };
      tally.count += 1;
      const id = typeof row['template_id'] === 'string' ? row['template_id'] : '';
      if (templateDiffers(id, row['content'])) tally.differ.push(id);
      templates.set(pack, tally);
    }
  }
  const variables = countsByPack(db, where.tables, 'pack_variables');
  const tracked = countsByPack(db, where.tables, 'pack_runtime_variables');

  const packs = db
    .prepare(
      `select id, name, is_default from ${PACK_TABLE}` +
        ' order by is_default desc, name collate nocase, id',
    )
    .all();
  let position = 0;
  for (const row of packs) {
    position += 1;
    const id = typeof row['id'] === 'string' && row['id'].length > 0 ? row['id'] : null;
    const tally = (id === null ? undefined : templates.get(id)) ?? { count: 0, differ: [] };
    const name = typeof row['name'] === 'string' ? row['name'].slice(0, NAME_LENGTH) : '';
    const notes: ImportNote[] = [
      {
        key: 'import.aventuras.packRecorded',
        params: {
          pack: name,
          templates: tally.count,
          differ: tally.differ.length,
          variables: (id === null ? undefined : variables.get(id)) ?? 0,
          tracked: (id === null ? undefined : tracked.get(id)) ?? 0,
        },
        level: 'info',
      },
    ];
    if (tally.differ.length > 0) {
      const listed = tally.differ.slice(0, LISTED_IDS).map((one) => one.slice(0, ID_LENGTH));
      notes.push({
        key: 'import.aventuras.packTemplatesDiffer',
        params: { pack: name, templates: listed.join(', ') },
        level: 'warn',
      });
      // Counted, not named, past the limit — `macros.ts`'s `unlisted`, for
      // its reason: a note is a string in the ledger, and a table somebody
      // else wrote can hold any number of rows.
      if (tally.differ.length > listed.length) {
        notes.push({
          key: 'import.aventuras.packTemplatesUnlisted',
          params: { pack: name, count: tally.differ.length - listed.length },
          level: 'warn',
        });
      }
    }
    yield {
      outcome: 'observed',
      report: {
        // A pack with no id has no identity a later import could name it by;
        // it is named by its place, as a vault row without one is.
        source:
          id === null
            ? `${where.database}/${PACK_TABLE}#${String(position)}`
            : `${where.database}/${PACK_TABLE}/${id}`,
        disposition: 'recorded',
        notes,
      },
    };
  }
}

/** One table's rows per `pack_id`, or none for a table the database predates. */
function countsByPack(
  db: DatabaseSync,
  tables: ReadonlySet<string>,
  table: 'pack_variables' | 'pack_runtime_variables',
): Map<string, number> {
  const counts = new Map<string, number>();
  if (!tables.has(table)) return counts;
  const rows = db.prepare(`select pack_id, count(*) as n from ${table} group by pack_id`).all();
  for (const row of rows) {
    const n = integer(row['n']);
    if (typeof row['pack_id'] === 'string' && n !== null) counts.set(row['pack_id'], n);
  }
  return counts;
}
