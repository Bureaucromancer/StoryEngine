// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { ImportNote } from '@storyengine/shared';
import { labels } from '../i18n/catalogue.js';

/**
 * **The review vocabulary: one sentence per note class the converters emit.**
 *
 * The server never sends a sentence — a note is a key and its params
 * ([P4 §1.4]), so that the words can be rewritten, or eventually translated,
 * without a converter knowing. This is where the words live.
 *
 * **It moved out of `ImportPanel` at [P5.0], and the move is the point.**
 * [10 §5.3] puts the facts an import established on the *book*, not only in the
 * sweep that created them: somebody debugging an entry six months later will
 * not think to look for the review. So there are two renderers now, and a
 * catalogue private to one of them would have meant the second either importing
 * from a panel or growing a copy — and a copy of a sentence table is the drift
 * `polish §1` spends its argument on, in the place where the drift would read
 * as the two surfaces disagreeing about what an import did.
 *
 * `note-labels.test.ts` greps this file against every key the server emits, so
 * a note class added without a sentence fails loudly rather than rendering as a
 * dotted machine string. That test names this path; moving the table again
 * means repointing it.
 */
export const NOTE_LABELS: Record<string, string> = labels('import.note', {
  'import.preset.credentialsRemoved': 'Removed connection fields: {fields}.',
  'import.preset.contextCeilingWasAbsolute':
    'The context limit ({tokens}) was an absolute number in the source, and is a ceiling here.',
  'import.preset.perCharacterOrdersDropped':
    'Per-character prompt orders were dropped: {characters}.',
  'import.preset.samplerRatio': 'Sampler settings: {carried} of {total} fields carried over.',
  'import.preset.markerNeedsLaterMachinery': 'The “{marker}” block needs machinery from {when}.',

  /**
   * **The five that arrived while this catalogue was being moved**, carried
   * across at the merge of `feat/preset_import` into `p5`.
   *
   * Both branches were right and neither could see the other: P5.0 moved the
   * sentence table out of `ImportPanel` so two surfaces could not disagree about
   * what an import did, and the preset-import work taught the converters five
   * new notes in the copy it was moving away from. Take either side whole and
   * the result is silently wrong — git resolves it as *deleted vs modified* and
   * offers no hint that keys went missing.
   *
   * Silently is the operative word, and it is why this comment is long. The
   * fallback at `sentence()` renders an unlabelled key **as itself**, so the
   * only symptom would have been a dotted machine string on the review — the
   * exact failure the twenty-four-key audit below was run to end, reintroduced
   * by a merge a fortnight later. Harvested by diffing the emitted keys of both
   * catalogues rather than by reading, because reading is what missed them.
   */
  'import.template.instruct':
    'A SillyTavern instruct template. It shapes a raw-completion prompt, which this build does not send — so there is nothing here for it to become.',
  'import.template.context':
    'A SillyTavern context template. It lays out a raw-completion prompt; this build assembles from blocks instead.',
  'import.template.reasoning':
    'A SillyTavern reasoning template. It splits reasoning out of a model’s reply, which nothing here reads.',
  'import.preset.samplerNotForwarded':
    '{count} of them are stored but do not reach the model in this build: {fields}.',
  'import.file.importsAsFolder':
    '{file} is a folder in a file. Importing it brings in everything inside, and reports afterwards rather than first.',
  'import.macro.unrecognised': 'Unrecognised macro {macro} in “{block}” — left as written.',
  'import.card.personalityAsTraits': 'Personality read as {count} traits.',
  'import.card.personalityAsProse': 'Personality read as prose, and kept in the summary.',
  'import.card.wantsPromptOverride': 'This card wants to override prompts ({fields}); review.',
  'import.card.portraitUnreadable': 'The portrait could not be read, so the card has none.',
  // [P7.10]: a count rather than silence. An import that quietly grew a
  // character eight pictures is a surprise; one that says it did is a feature.
  'import.card.expressions': 'Brought {count} expressions in with {actor}.',
  'import.lore.positionCollapsed': '“{entry}” sat at {original}, which has no equivalent here.',
  'import.lore.entryLimitClamped': 'Entry limit reduced from {from} to {to}.',
  'import.lore.chatScopeDropped': '“{book}” was scoped to one chat; it is global here.',
  'import.object.unchanged': 'Unchanged.',
  'import.object.replaced': 'Replaced what was here; the previous version is in its history.',
  'import.object.keptBoth': 'Kept alongside the existing one.',
  'import.object.differsAndKept': 'Differs from what is here, and was not written.',

  /**
   * **The twenty-four the map was missing**, found by the P4 completeness audit
   * ([P4 §7.1]) and added with it.
   *
   * The first eighteen were written from the design's expected vocabulary
   * rather than harvested from the converters, so the map drifted the moment a
   * converter learned a new note — and the fallback at `sentence()` is silent
   * about it by design: an unlabelled key renders as itself, which is right for
   * a newer build's class and wrong as a permanent state.
   *
   * `import.card.bookExtracted` is the sharpest case. It fires on **every** card
   * that carries a lorebook, which is most of them, so the most common note in
   * the most common import was rendering as a dotted machine string. Five of
   * these reach the single-file upload for the first time in this change, which
   * is why closing the gap belongs to it rather than to a later tidy.
   *
   * Harvested with a grep for the emitted keys and diffed against this map, so
   * the list is the code's rather than a guess at it.
   */
  'import.card.bookExtracted': 'Carried a lorebook, imported separately as “{book}”.',
  'import.card.bookRefused': 'The lorebook inside this card could not be read ({refusal}).',
  'import.card.treatmentCreated':
    'Its scenario became the treatment “{treatment}”, shared by {actors}.',
  'import.file.notACard': '{file} is not a character card.',
  'import.file.pictureWithoutACard': '{file} is a picture with no character in it.',
  'import.file.notJson': '{file} is not readable as JSON.',
  'import.file.unrecognised': 'Nothing here recognised {file}.',
  'import.file.unreadable': '{file} could not be read, so nothing looked inside it.',
  'import.file.badArchive': '{file} is an archive this build will not open ({refusal}).',
  'import.file.refused': '{file} could not be read ({refusal}).',

  /**
   * ***A backup of our own*** —
   * [P12.8](../../../../docs/design/workplan/29-p12-implementation.md).
   *
   * These read differently from the rest of this table on purpose. Every other
   * row is about a file somebody else's application wrote, where *we could not
   * read this* is the expected outcome for some of them. These are about **our
   * own archive**, where any of them means the file is not what it says it is —
   * so each says what was skipped rather than offering a conversion note.
   */
  'import.backup.noSuchAccount': 'This backup does not hold an account called {handle}.',
  'import.backup.unknownKind':
    '{file} is in a folder this build does not recognise, and was skipped.',
  'import.backup.unreadable': '{file} could not be read, and was skipped.',
  'import.backup.wrongKind':
    '{file} says it is something other than what its folder holds, and was skipped.',

  /**
   * ***What an import did, and what it declined to do*** —
   * [P12.9](../../../../docs/design/workplan/29-p12-implementation.md).
   *
   * **Both halves are here on purpose.** *My provider keys did not come across*
   * is a question with an answer, and a review that said nothing about the
   * groups nobody ticked would turn it into a bug report. So each optional
   * group reports either way.
   */
  'import.backup.tagsMerged': 'Brought {added} tags across and kept {kept} that were already here.',
  'import.backup.sessions': 'Brought {imported} sessions across, and left {skipped}.',
  'import.backup.connectionsTaken':
    'Brought {added} connections across and kept {kept} that were already here.',
  'import.backup.connectionsNotTaken':
    'Connections were not brought across. Tick that box to include them.',
  'import.backup.prefsTaken': 'Brought {added} preferences across.',
  'import.backup.prefsNotTaken':
    'Preferences were not brought across. Tick that box to include them.',
  'import.backup.configTaken':
    'Brought the settings across. {count} of them need a restart to take effect.',
  'import.backup.configNotTaken':
    'Settings were not brought across. Tick that box to include them.',
  'import.backup.configMissing': 'That backup carries no settings file.',
  'import.backup.configRefused': 'The settings in that backup were not valid here ({message}).',
  'import.file.notStored': '“{object}” could not be saved ({reason}).',
  'import.file.notYetConvertible':
    'Read and named, but this build has nowhere to put a {kind} yet.',
  'import.row.unreadable': 'A row in {table} could not be read and was skipped.',
  'import.lore.stateDropped': '“{entry}” had a {field} setting that does not exist here.',
  'import.lore.unknownPosition': '“{entry}” sat at position {code}, which has no meaning here.',
  'import.lore.logicNarrowed':
    '“{entry}” used {original} matching, narrowed to what this supports.',
  'import.lore.characterLinksDangle':
    'Was linked to {count} characters that were not imported with it.',
  'import.macro.refused': 'The macro {macro} in “{block}” was left as written — {because}.',
  'import.preset.paramsCarried': '{count} sampler settings carried over.',
  'import.preset.groupOrderUsed': 'Prompt order taken from the preset’s own group.',
  'import.preset.groupOrderDropped': 'The preset’s group ordering could not be used.',
  'import.preset.unknownMarker': 'The “{identifier}” block is not one this understands.',
  'import.preset.modePromptConverted': 'Its {field} became a block.',
  'import.preset.variablesInert': '{count} variables were kept but do nothing yet.',
  'import.preset.noBlocksInSamplerPreset': 'A sampler panel only — it carries no prompt blocks.',
  'import.preset.postHistoryIsAfterNotAtDepth':
    'Its post-history instructions go after the conversation rather than at a depth.',

  /**
   * **What the folder is, when it is not the folder to point at.** These come
   * from `import/near-miss.ts` rather than from a converter, and they are the
   * first notes here that are about the *request* instead of about an object —
   * which is why they read as advice rather than as a record.
   *
   * They are deliberately in the same map. The alternative was a second
   * vocabulary with its own renderer, and the note class is already the thing
   * this review composes prose from; a near miss being a different kind of fact
   * does not make it a different kind of sentence.
   */
  'import.root.sillytavernBelow':
    'This looks like SillyTavern’s program folder rather than its library. The library is in {path} — point at that instead.',
  'import.root.sillytavernDataFolder':
    'This is SillyTavern’s data folder. One person’s library is in {path} — point at that instead.',
  'import.root.sillytavernOldLayout':
    'This SillyTavern is older than the 1.12 layout change, so its library is still in {path}.',
  'import.root.sillytavernUserFolders':
    'This is SillyTavern’s data folder, which holds one folder per person. Point at the one named for you.',
  'import.root.sillytavernProgramFolder':
    'This is SillyTavern’s program folder, not its library. Where the library lives is set by dataRoot in config.yaml; unless that was changed, it is data/default-user.',
  'import.root.sillytavernAbove':
    'This is one folder out of a SillyTavern library. Point at the folder above it to bring in the lorebooks, presets and personas too.',
  'import.root.marinaraBelow': 'A Marinara data folder is in {path} — point at that instead.',
  'import.root.marinaraTwoDataFolders':
    'There are Marinara data folders in both {first} and {second}, which a version change used to leave behind. Marinara’s own notes say to check which is newer rather than assume.',
  'import.root.marinaraUpdateBackup':
    'This looks like a copy the Marinara launcher made before an update, rather than the folder it is using now.',
  'import.root.marinaraProgramFolder':
    'This is Marinara’s program folder rather than its data folder. Either nothing has been saved yet, or its data folder has been moved elsewhere.',
  'import.root.marinaraStorageFolder':
    'This is the storage folder inside a Marinara data folder. Point at the folder above it, which holds the pictures as well.',
  'import.root.marinaraAbove':
    'This is one folder out of a Marinara data folder. Point at the folder above it.',
  'import.root.marinaraTablesFolder':
    'This is inside a Marinara storage folder. Point two folders up, at the data folder itself.',
  'import.root.marinaraTooOld':
    'This is a Marinara data folder from before version 1.5.7, which kept everything in one database file. This build reads only the newer file storage.',

  /**
   * **Aventuras' three single-file vault exports** — [P4 §1.5]'s *"honest
   * remaining work"*, four phases after it was named.
   *
   * `settingAsFraming` is the sharpest sentence here and the one that earns its
   * `warn`. [04 §6] is bold that *a Treatment contains no world facts*, and a
   * scenario's `settingSeed` is world facts: the import puts them in `framing`
   * anyway, because nothing can split one prose blob into tone and facts
   * mechanically and the card importer has bent the same invariant the same way
   * since P4. A bent invariant that says so is a decision; a silent one is a bug,
   * and this is the saying-so.
   */
  'import.aventuras.settingAsFraming':
    'The setting prose ({chars} characters) became this treatment’s framing, which is injected every turn. If it is really world detail, move it into a lorebook.',
  'import.aventuras.npcsAsActors':
    '{count} characters were imported beside “{name}” and billed into its cast.',
  'import.aventuras.primaryNotInCast':
    'The scenario names “{actor}” as its lead, and no character by that name came with it.',
  'import.aventuras.linkedLorebookMissing':
    'This scenario points at a lorebook that is not in the file. Export that lorebook from Aventuras separately and import it too.',
  'import.aventuras.scenarioAsLorebook':
    'The setting and its cast became {entries} entries. The setting is always active; each character fires on their own name.',
  'import.aventuras.openingsDropped':
    '{count} opening messages were not carried: a lorebook has nowhere to put them. Import it as a treatment instead to keep them.',
  'import.aventuras.visualDescriptors':
    '{count} appearance fields carried across to {actor} unchanged.',
  'import.aventuras.portraitNotCarried':
    'The portrait in this file was not imported. Add a picture in the editor instead.',
  'import.aventuras.lorebookEntries': 'Read as an Aventuras lorebook: {count} entries.',
  'import.aventuras.entryStateRecorded':
    '{count} entries carried tracked state from a story in progress. It is kept as it was and nothing reads it here.',
  'import.aventuras.repeatedEntryNames':
    '{count} entries shared a name with an earlier entry in the same book. Each was kept as its own entry.',

  /**
   * **The other direction, and it is new at this stage.**
   *
   * [00 §2.4]'s *"nothing is lost and re-export is possible"* was kept by
   * preservation alone until the library grew writers, and a writer loses
   * something by definition. These are what each one lost, said where somebody
   * about to send the file will read it — the only place they ever would, since
   * an export leaves no record behind.
   */
  'export.cast.unresolved':
    '{count} characters in the cast are no longer in this library, so they are not in this file.',
  'export.card.noCastMember':
    '“{treatment}” has no character to name, so the card is named after the treatment itself.',
  'export.card.castNarrowed':
    'A character card holds one character, so {count} of the cast were left out.',
  'export.aventuras.hooksDropped':
    '{count} plot hooks were not carried: an Aventuras scenario has nowhere to put them.',
  'export.aventuras.loreNotCarried':
    '{count} linked lorebooks were not carried. Aventuras keeps a scenario’s lore as a separate file, so export those lorebooks too.',
  'export.aventuras.sectionsFolded':
    '{count} sections were folded into one description: {sections}.',
  'export.aventuras.foldersDropped':
    'Folders were not carried, so {count} entries lost the gate above them — any that a shut folder was holding off will arrive switched on.',
});

/**
 * `{name}` substitution, which is all the catalogue needs until ICU arrives.
 *
 * Takes the two fields it reads rather than a whole `ImportNote`, because its
 * two callers do not agree about the third: the client widens `level` to a
 * string where the shared type keeps the union, and a renderer that never looks
 * at `level` has no business insisting on which of those it is given.
 */
export function sentence(note: Pick<ImportNote, 'key' | 'params'>): string {
  const template = NOTE_LABELS[note.key];
  if (template === undefined) return note.key;
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => {
    const value = note.params[key];
    return value === undefined ? whole : String(value);
  });
}
