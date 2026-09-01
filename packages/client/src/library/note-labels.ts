// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { ImportNote } from '@storyengine/shared';

/**
 * **The review vocabulary: one sentence per note class the converters emit.**
 *
 * The server never sends a sentence — a note is a key and its params
 * ([P4 §1.4]), so that the words can be rewritten, or eventually translated,
 * without a converter knowing. This is where the words live.
 *
 * **It moved out of `ImportPanel` at [P5.0], and the move is the point.**
 * [05 §5.3] puts the facts an import established on the *book*, not only in the
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
export const NOTE_LABELS: Record<string, string> = {
  'import.preset.credentialsRemoved': 'Removed connection fields: {fields}.',
  'import.preset.contextCeilingWasAbsolute':
    'The context limit ({tokens}) was an absolute number in the source, and is a ceiling here.',
  'import.preset.perCharacterOrdersDropped':
    'Per-character prompt orders were dropped: {characters}.',
  'import.preset.samplerRatio': 'Sampler settings: {carried} of {total} fields carried over.',
  'import.preset.markerNeedsLaterMachinery': 'The “{marker}” block needs machinery from {when}.',
  'import.macro.unrecognised': 'Unrecognised macro {macro} in “{block}” — left as written.',
  'import.card.personalityAsTraits': 'Personality read as {count} traits.',
  'import.card.personalityAsProse': 'Personality read as prose, and kept in the summary.',
  'import.card.wantsPromptOverride': 'This card wants to override prompts ({fields}); review.',
  'import.card.portraitUnreadable': 'The portrait could not be read, so the card has none.',
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
};

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
