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
  'import.preset.maxLengthUnclear':
    'The preset’s max_length ({tokens}) could be the reply length or the context size, so it was kept aside rather than guessed.',
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
  'import.card.ownNameWritten':
    'Wrote {actor}’s name in the {count} places the card had left a placeholder for it.',
  'import.card.playerPlaceholderKept':
    'This card names the player with SillyTavern’s placeholder. It is kept as written, so the model reads the placeholder rather than a name.',
  'import.card.wantsPromptOverride': 'This card wants to override prompts ({fields}); review.',
  'import.card.portraitUnreadable': 'The portrait could not be read, so the card has none.',
  /**
   * ***The portrait that was a picture and not a PNG*** — [P13.3]. A card's
   * own image can only be a PNG, so an Aventuras portrait in JPEG or WebP is
   * kept on the actor as its source image and the card starts blank; this is
   * the sentence that stops a blank card reading as a lost face.
   */
  'import.card.portraitAsSource':
    'The portrait is a {format}, and a card’s own image has to be a PNG, so it is kept with {actor} as the portrait’s source image and the card itself is blank.',
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
  'import.backup.picturesNotStored':
    '{count} pictures on players’ moves could not be written here. Their moves keep their captions.',
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
  'import.backup.configWithheld':
    'Kept this install’s own {keys}: they describe the machine a server runs on, not how it behaves.',
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
  // ~~was left as written — {because}~~ (2026-09-27): a refused macro is taken
  // *out*, which is the whole difference from an unrecognised one, and
  // `{because}` printed a code. `sentence` turns the code into words.
  'import.macro.refused': 'The macro {macro} in “{block}” was taken out: {because}.',
  'import.macro.unlisted':
    '{count} more uses of macros were converted the same way and are not listed one by one.',
  'import.preset.paramsCarried': '{count} sampler settings carried over.',
  'import.preset.legacyOrderUsed':
    'This preset only had the prompt order older SillyTavern versions used, so that one was converted.',
  'import.preset.unusedPromptsKept':
    'Kept {count} prompts the preset held but did not use ({names}), switched off.',
  'import.preset.duplicatesDropped':
    'The preset named some prompts twice ({identifiers}); the first of each was kept.',
  'import.preset.triggerHasNoCall':
    'The “{identifier}” block only runs for {triggers} in SillyTavern, which has no equivalent here, so it never applies.',
  'import.preset.sectionOrderUnreadable':
    'The preset’s section order could not be read, so its sections are in the order they were stored.',
  'import.preset.groupWrappersDropped':
    'Marinara also wraps each group of sections in the group’s name ({groups}); the sections keep their own wrappers, and the group’s is not carried.',
  'import.preset.fromBeforePromptManager':
    'An older SillyTavern preset, from before its prompt manager, converted the way SillyTavern upgrades one.',
  'import.preset.unknownMarker': 'The “{identifier}” block is not one this understands.',
  'import.preset.promptFieldsIgnored':
    'The “{identifier}” block had {fields} of a kind this cannot read, and they were left out.',
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
   * ***Aventuras' config directory, beneath the folder picked*** — [P13.7].
   * The path is said in full because it is the one part nobody remembers: a
   * reverse-DNS folder name, sometimes under a hidden folder, which a person
   * with a file picker would otherwise have to go and find.
   */
  'import.root.aventurasBelow':
    'Aventuras keeps its library in {path}, beneath this folder — point at that instead.',
  'import.root.aventurasAbove':
    'This is one folder out of an Aventuras folder. Point at the folder above it, which holds the database with the whole library in it.',

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
  /**
   * ***One sentence for two roads*** — [P13.5]. From a file the link can never
   * resolve, and the remedy is a second export; from a database it resolves to
   * the book that row became, and this fires only when the row is not there,
   * or was refused and nothing from an earlier import is here. The sentence
   * names both, since the note is the same key on both.
   */
  'import.aventuras.linkedLorebookMissing':
    'This points at an Aventuras lorebook that was not imported with it, so the link was left out. From a file, export that lorebook from Aventuras separately and import it too; from a whole library, the lorebook was missing or could not be read.',
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
  'import.aventuras.repeatedNpcNames':
    '{count} characters in this scenario shared a name with an earlier one. Each was kept as its own actor.',
  'import.aventuras.walCopied':
    'Aventuras may have been open while this was read, so its latest changes were taken from its unsaved log. If anything looks missing, close Aventuras and import again.',

  /**
   * ***A whole Aventuras install, read and not yet converted*** — [P13.2].
   *
   * The review of a database is a row per table and a row per story, so these
   * say what each row held. `settingsDropped` is the one with a reason in it:
   * the table is where Aventuras keeps provider keys in plain text, and a
   * person should read that they were left behind *unread*, not merely left
   * behind. *"May include"* since the P13.2 review: the reader never looks, so
   * it cannot say an install that kept only a theme there holds a key.
   *
   * `storyRecorded` says *across all its branches* because that is what its
   * numbers are — a branch's edits and tombstones left out, and a branch that
   * copied the whole world counted once per branch — and not what any one of
   * Aventuras' own views shows (the reader's `entitiesOnly`).
   */
  'import.aventuras.database':
    'An Aventuras database at schema version {version}, with {tables} tables. Each is listed here with what became of it; a table that was imported is listed as the things it held.',
  'import.aventuras.tableRows': '{rows} rows in {table}.',
  'import.aventuras.settingsDropped':
    '{rows} settings were dropped without being read. They may include provider keys, which are never imported.',
  'import.aventuras.storyRecorded':
    '“{story}”, across all its branches: {entries} entries, {branches} branches, {characters} characters, {locations} locations, {items} items, {beats} story beats, {lore} lorebook entries, {chapters} chapters, {checkpoints} checkpoints and {images} images. Stories become sessions only when an import asks for them.',

  /**
   * ***A story, brought across as a session*** — [P13.11]. The import that
   * asks for stories makes each one a session of its own: an action and its
   * answer are one turn, Aventuras' branches are named branches, and the
   * session opens where the person left the story. These say what came, what
   * was re-read to make it a tree, and what stayed in Aventuras — ~~the
   * world,~~ the chapters and the pictures, which later stages bring (the
   * world came at P13.12, below), and a narrator
   * prompt of the story's own, which is written for Aventuras' prompt layout
   * the way its prompt packs are (`packRecorded` says why those stay).
   *
   * *"Plays here in this server's default mode"*: the importer names no mode
   * (a mode is the registry's knowledge, not the engine's), so an imported
   * story plays in whichever mode this install starts sessions in.
   */
  'import.aventuras.storyImported':
    '“{story}” is now a session of {turns} turns, with {branches} named branches besides the main line, opening where the story was left. It was an Aventuras {mode} story, and plays here in this server’s default mode.',
  'import.aventuras.storyWorldRecorded':
    'Not brought across yet from “{story}”: {chapters} chapters, {checkpoints} checkpoints and {images} images. They are still in Aventuras.',
  /**
   * ***And its world*** — [P13.12]. The characters, places, items, story
   * beats and lorebook entries of the branch the session opens on: the
   * characters become the session's cast, the rest one lorebook of the
   * story's own, each kind in a folder and tagged by what it is. Story beats
   * are there *for now* — `storyBeatsAsLore` says so, because a person who
   * later finds a place of their own for beats should know where these went.
   * `worldBranchesDiffer` is the one sentence about the branches the person
   * was not on: one session has one cast, so what those held differently
   * stays in Aventuras, and the counts say how much.
   *
   * `storyWorldRecorded` keeps its key and loses the world from its sentence,
   * so a review saved before this stage still reads — with the older counts
   * it carried simply not named.
   */
  'import.aventuras.storyWorld':
    '“{story}” came with its world: {characters} characters in its cast, and a lorebook of its own with {lore} lorebook entries, {locations} locations, {items} items and {beats} story beats, as they stood on the branch the story was left on.',
  'import.aventuras.storyPersona':
    '{actor} is who you played in “{story}”, so they are the session’s persona.',
  'import.aventuras.storyBeatsAsLore':
    '{count} story beats from “{story}” are lorebook entries for now, tagged “story-beat” with everything Aventuras kept about them, until story beats have a place of their own here.',
  'import.aventuras.worldBranchesDiffer':
    'In “{story}”, {branches} other branches hold a different world from the one brought across — {entities} characters, places, items, beats or entries differ in at least one of them. Only the branch the story was left on came across; the others are still in Aventuras.',
  'import.aventuras.worldFieldsUnreadable':
    'In “{story}”, {count} saved details of its characters, places, items, beats or entries could not be read and were left out. Everything else about them was brought across.',
  'import.aventuras.storyAlreadyHere':
    '“{story}” was brought across before and is already a session here, so it was not imported again. Anything written in it in Aventuras since then is not brought across.',
  'import.aventuras.storyEmpty':
    '“{story}” has nothing in it yet, so there was no session to make.',
  'import.aventuras.storyRefused':
    '“{story}” could not be made into a session ({reason}), and nothing was written for it.',
  'import.aventuras.forkSplitPair':
    'In “{story}”, the branch “{branch}” begins between an action and its answer, so here the action is repeated at the start of the branch with the branch’s own answer — beside the main line’s answer rather than after it.',
  'import.aventuras.forkEntryMissing':
    'In “{story}”, the place the branch “{branch}” started from is missing from the database, so its turns start the session over as a line of their own.',
  'import.aventuras.headBranchMissing':
    '“{story}” was left on a branch the database no longer has, so the session opens at the end of the main line.',
  'import.aventuras.entryTypeUnknown':
    'In “{story}”, {count} entries of a kind this build does not know (“{type}”) were left out.',
  'import.aventuras.entriesUnplaced':
    'In “{story}”, {count} entries belong to a branch the database no longer has, so Aventuras could not show them either; they were left out.',
  'import.aventuras.entryFieldsUnreadable':
    'In “{story}”, {count} saved details — generation settings, or the story’s own settings — could not be read and were left out. The text of every entry was brought across.',
  'import.aventuras.customNarratorPrompt':
    '“{story}” has a narrator prompt of its own ({length} characters). It is written for Aventuras’ prompt layout and variables, so it was not brought across; it is still in Aventuras, to copy into a preset by hand.',
  /**
   * ***A prompt pack, recorded*** — [P13.9]. Packs are not imported: their
   * templates are written against Aventuras' own variables and its own prompt
   * layout, and the narrator's — the only ones with a counterpart here — branch
   * on point of view, tense and reinforcement, which a preset here cannot read.
   * So the row says what the pack held, and the warning names the templates
   * that are somebody's, since those are what the person is leaving behind.
   *
   * *"Differ from the ones Aventuras ships"* rather than *"were edited"*,
   * because that is the test (`packs.ts`): a pack imported into Aventuras reads
   * as untouched by Aventuras' own edit flag, and a template a pack was seeded
   * with by an older Aventuras differs without anybody having touched it — so
   * the sentence allows for that rather than claiming an edit.
   */
  'import.aventuras.packRecorded':
    'The prompt pack “{pack}”: {templates} templates, {differ} of them different from the ones Aventuras ships; {variables} custom variables and {tracked} tracked variables. Prompt packs are not imported: their templates are written for Aventuras’ own prompt layout and variables, and would not read here as they do there.',
  'import.aventuras.packTemplatesDiffer':
    'In “{pack}”, these differ from Aventuras’ own and were not brought across: {templates}. Each is an edit, a pack somebody shared, or text from another version of Aventuras. They are still in Aventuras; copy any you want into a preset.',
  'import.aventuras.packTemplatesUnlisted':
    'In “{pack}”, {count} more templates differ from Aventuras’ own and are not named here.',
  'import.aventuras.newerSchema':
    'This database comes from a newer Aventuras (schema version {version}; this build knows {known}). Everything this build reads was there, so it was read; anything newer was left alone.',
  'import.aventuras.backupMetadata':
    'An Aventuras backup, made by version {appVersion} on {createdAt}, holding {storyCount} stories.',

  /**
   * ***A vault row, read around a field*** — [P13.3]. A database row is
   * somebody's character with one unreadable field, not an unreadable file,
   * so both of these say what was left behind and let the rest import.
   * *Since P13.4* a lorebook's too — with one difference the sentence has to
   * say: an `entries` column that will not read is the book, not a field of it,
   * so that row is refused and nothing is written, rather than a book imported
   * empty that a re-sweep would put in place of a good one. *Since P13.5* a
   * scenario's cast, alternate openings and metadata — where its lorebook link
   * lives — refuse the row by the same argument.
   */
  'import.aventuras.columnUnreadable':
    'The {column} column could not be read as Aventuras writes it, so it was left out. If it held a lorebook’s entries, or a scenario’s cast, openings or metadata, that row was not imported, and any copy already here was left as it was.',
  'import.aventuras.portraitTooLarge':
    'The portrait is larger than the {limit} MB a card can carry, so {actor} was imported without it.',

  /**
   * ***A vault tag, merged into the tag list*** — [P13.6]. Each row of
   * Aventuras' `vault_tags` joins this account's tags by name: a new one is
   * added, and one already here is left exactly as it is, colour included.
   * These say which happened, and what became of the colour — Aventuras'
   * seventeen colours land on the nearest of this library's eight swatches,
   * and it keeps a tag list per kind of thing where this library keeps one,
   * so a name two kinds shared is one tag with one colour. *"Anything carrying
   * it keeps it as written"* because tags are open: an object's tag with no
   * entry here still works, and only has no colour.
   */
  'import.aventuras.tagMinted':
    'Added the tag “{tag}” from Aventuras’ {kind} tags, coloured {swatch} — the nearest of this library’s swatches to its {colour}.',
  'import.aventuras.tagColourUnreadable':
    'Added the tag “{tag}” from Aventuras’ {kind} tags without a colour: “{colour}” did not read as one.',
  'import.aventuras.tagShared':
    'Aventuras’ {kind} tag “{tag}” is the same tag here as another kind’s of that name: this library keeps one list of tags, not one per kind.',
  'import.aventuras.tagKept':
    '“{tag}” is already a tag here, so it was left as it is, its name and colour unchanged.',
  'import.aventuras.tagColourDiffers':
    'Aventuras’ {kind} tag “{tag}” would have been {swatch}; the tag here is {kept}, and keeps it. A name used by more than one kind is one tag here, with one colour.',
  'import.aventuras.tagNameTooLong':
    'The tag “{tag}” is longer than the {limit} characters a tag here can be, so it was not added. Anything carrying it keeps it as written.',
  'import.aventuras.tagsFull':
    'The tag “{tag}” was not added: this library already has {limit} tags, the most it keeps. Anything carrying it keeps it as written.',

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
    if (value === undefined) return whole;
    // A macro's reason arrives as the converter's code, which is not a sentence.
    if (key === 'because' && typeof value === 'string') return MACRO_REASONS[value] ?? value;
    return String(value);
  });
}

/**
 * ***Why a macro was taken out, in words*** (2026-09-27). The server sends
 * `macros.ts`'s `MacroRefusal` code; `note-labels.test.ts` holds this table to
 * every code that file can send.
 */
export const MACRO_REASONS: Readonly<Record<string, string>> = labels('import.macro-reason', {
  'body-comes-from-a-slot': 'that text comes from one of the pack’s own blocks here',
  'randomness-must-be-drawn-and-recorded':
    'a random pick has to come from the engine, or a turn could not be replayed',
  'time-is-not-reproducible': 'the time would change every time a turn was replayed',
  'no-equivalent': 'nothing here does what it did',
});
