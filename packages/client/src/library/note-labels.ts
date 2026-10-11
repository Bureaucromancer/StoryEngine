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
  'import.file.overLimit':
    '{file} did not fit under this server’s {limit} MB upload limit with the rest of the folder, so it was named and not sent. Import the folder from the server’s disk to bring it, or pick it on its own.',
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
   * ***A World arriving*** —
   * [P16.3e](../../../../docs/design/workplan/35-p16-world.md),
   * [16 §5.1](../../../../docs/design/16-publish.md).
   *
   * **Said in the World's terms, never in ids.** A World file is somebody's
   * set arriving, and what a person needs from the review is which of their
   * things landed, which did not and why, and what the set now names. Two
   * things it deliberately never says: *which* objects arrived under a fresh
   * id (a re-mint) — an id another account holds and an id nobody holds must
   * read the same, or the review would describe other people's libraries — and
   * anything about the sessions beyond their names, which land at P16.3f.
   */
  'import.world.landed':
    'The world “{world}” landed, naming {members} objects and {sessions} sessions.',
  'import.world.memberNotLanded': '“{member}” did not land, so the world does not name it.',
  'import.world.nestedWorld':
    '“{name}” is a world inside this world, and was not brought in: a world holds objects and sessions, not worlds.',
  'import.world.damaged':
    '“{object}” arrived damaged — {file} is not what the file says it holds — and was not brought in.',
  'import.world.pictureDamaged':
    'A picture of “{object}” ({file}) arrived damaged and was left behind.',
  'import.world.historyDamaged':
    'The history of “{object}” arrived damaged and was left behind; the object itself came in.',
  'import.world.historyNotCarried':
    'The history of “{object}” stayed behind with the copy’s original: a copy starts with none of its own.',
  'import.world.unlisted':
    '{file} is in the file but not in its list of contents; it came in as a loose object, outside the world.',
  'import.world.unknownKind':
    '“{object}” is a kind of object this build does not know ({schema}), and was not brought in.',
  'import.world.builtIn':
    '“{object}” is the built-in library’s own, unchanged, so nothing was written.',
  'import.world.notRead':
    '{file} is not part of anything in this world’s file, and was left alone.',
  // The ids are left off and the names kept: an object whose tags name
  // another library's registry lands with them as plain names (P16.3e review).
  'import.world.tagsDropped':
    '{count} tags on {objects} objects belong to the library that wrote this file; they came in as plain names.',
  'import.world.requiresMode':
    'This world asks for the {mode} mode, at version {minVersion} or later, which this install does not have. It came in anyway; what needs that mode may not play.',
  'import.world.sessionsNotTaken':
    'The session “{session}” is in this file. This build does not bring sessions in from a world’s file yet.',
  'import.world.legacyNoPictures':
    'This file is the older kind, which carries no pictures: portraits, galleries and other images stayed with the install that wrote it.',
  'import.world.noPortrait':
    '“{actor}” arrived without a portrait — files of the older kind carry none — and is on a blank card.',

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
   * world,~~ the chapters ~~and the pictures~~, ~~which a later stage brings~~
   * which P13.14 recorded rather than brought (the world came at P13.12, and
   * the pictures at P13.13, below), and a narrator
   * prompt of the story's own, which is written for Aventuras' prompt layout
   * the way its prompt packs are (`packRecorded` says why those stay).
   *
   * *"Plays here in this server's default mode"*: the importer names no mode
   * (a mode is the registry's knowledge, not the engine's), so an imported
   * story plays in whichever mode this install starts sessions in.
   */
  'import.aventuras.storyImported':
    '“{story}” is now a session of {turns} turns, with {branches} named branches besides the main line, opening where the story was left. It was an Aventuras {mode} story, and plays here in this server’s default mode.',
  /**
   * ***What stayed behind, and — since P13.14 — why the chapters did.*** The
   * key and its counts are P13.11's, so a review saved before still reads;
   * what changed is the sentence. ~~*"Not brought across yet"*~~: the chapter
   * summaries are not coming later. Each is Aventuras' model's summary of a
   * stretch of the story, and this server keeps its own summaries of a long
   * session, written by its own summariser from the turns — every one of
   * which came across — so the story loses nothing it plays with, and a
   * summary somebody else's model wrote is never passed off as one this
   * server wrote. Checkpoints are the phase's *deliberately not carried*.
   */
  'import.aventuras.storyWorldRecorded':
    'Not brought across from “{story}”: {chapters} chapter summaries and {checkpoints} checkpoints, which are still in Aventuras. The chapter summaries were written by Aventuras’ own model; every turn they summarise came across, and this server writes its own summaries of a long story from those turns.',
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
   * it carried simply not named. *And at P13.13 it loses the images*, below,
   * on the same terms.
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
  /**
   * ***And its pictures*** — [P13.13]. Each picture Aventuras drew into an
   * entry is on the turn that entry became, on whichever branch, and each
   * branch's backdrop on the turn its line ends on. *"Not shown until you
   * choose it"*: the import names no mode, and which backdrop is showing is
   * something a mode that stages one keeps, so a backdrop comes across as a
   * picture and not as a choice. `pictureModels` is the one place the model
   * that drew them is said: this server has no connection that drew them, and
   * a record claiming one would be a request that never happened.
   */
  'import.aventuras.storyPictures':
    '“{story}” came with its pictures: {illustrations} drawn into its text, each beside the turn it illustrates, and {backgrounds} backgrounds, each on the last turn of the branch it belonged to — not shown until you choose it, in a mode that shows a background.',
  'import.aventuras.pictureModels':
    'The pictures in “{story}” were drawn in Aventuras by {models}. They came with the prompts they were drawn from; drawing one again here uses this server’s own image model.',
  'import.aventuras.picturesUnfinished':
    'In “{story}”, {count} pictures Aventuras never finished drawing have nothing to bring across, and were left out.',
  'import.aventuras.picturesUnplaced':
    'In “{story}”, {count} pictures belong to entries or branches the database no longer has, so there is no turn to put them beside; they were left out.',
  'import.aventuras.checkpointBackgrounds':
    'In “{story}”, {count} backgrounds saved with checkpoints stay with the checkpoints, which are not brought across. They are still in Aventuras.',
  'import.aventuras.pictureTooLarge':
    'In “{story}”, {count} pictures are larger than {limit} MB and were left out. The rest of the story was brought across.',
  'import.aventuras.pictureUnreadable':
    'In “{story}”, {count} pictures could not be read as PNG, JPEG or WebP images — or are links, which are never fetched — and were left out. The rest of the story was brought across.',
  'import.aventuras.picturesWithoutPixels':
    'In “{story}”, {count} pictures could not be written and came across as the prompts they were drawn from, which can be drawn again here.',
  'import.aventuras.storyAlreadyHere':
    '“{story}” was brought across before and is already a session here, so it was not imported again. Anything written in it in Aventuras since then is not brought across.',
  'import.aventuras.storyEmpty':
    '“{story}” has nothing in it yet, so there was no session to make.',
  'import.aventuras.storyRefused':
    '“{story}” could not be made into a session ({reason}), and nothing was written for it.',
  /**
   * ***A story's own file*** — [P13.15]. An Aventuras `.avt` is one story,
   * every row of it, and comes across exactly as the same story does from
   * the database: the same session, and the same one — so bringing a story
   * across from either and then the other finds it already here, and every
   * sentence above says the rest. These say what only a file can: which
   * version of the format wrote it, that a format this build does not know
   * is refused rather than guessed at, and the backdrop a file carries with
   * no branch to put it on, which Aventuras' own import drops too. And one
   * for the files an older backup carries beside its database, which are the
   * database's own stories again, so the database is what is read.
   */
  'import.aventuras.avtStory':
    '“{story}”, an Aventuras story file (format {version}): {entries} entries across {branches} branches besides the main line. Importing it makes it a session, with its characters, lorebook and pictures.',
  'import.aventuras.avtOlderFormat':
    'The file for “{story}” was written by an older Aventuras (format {version}). What that format did not carry yet — branches, pictures or portraits, depending on its age — is not in it, so it is not here either.',
  'import.aventuras.avtNewerFormat':
    'The file for “{story}” comes from a newer Aventuras (format {version}; this build knows {known}). Everything this build reads was there, so it was read; anything newer was left alone.',
  'import.aventuras.avtUnknownFormat':
    '{file} is an Aventuras story file in a format this build cannot read (format {version}; this build reads 1.x up to {known}). Nothing was imported from it.',
  'import.aventuras.avtUnreadable':
    '{file} looks like an Aventuras story file, but it could not be read ({reason}). Nothing was imported from it.',
  'import.aventuras.avtBackdropNotCarried':
    'The file for “{story}” carries a background picture without saying which branch it belonged to, so it was left out, as Aventuras itself leaves it out when it imports the file.',
  'import.aventuras.avtBesideDatabase':
    'A story file beside the database. The database holds the same stories and is what was read, as Aventuras’ own restore does; to bring a story that is only in this file, import the file on its own.',
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
   * **A chat, imported as a session** —
   * [P14.6](../../../../docs/design/workplan/31-p14-scene-and-session-import.md)'s
   * tree builder, for both sources.
   *
   * [P14 §2.6] ends on *"everything else is a note, never silence"*, and these
   * are the places where the session is not quite the chat: a speaker the
   * library does not have, a hidden line with no exact home, a branch whose
   * parent never arrived. `hiddenInputShown` and `hiddenDisagrees` are the ones
   * that change what the model is sent, which is why they warn — a turn here
   * hides whole or by reply, and a player's line is neither; and a session has
   * one answer for whether a line is hidden where the family's chats had one
   * each.
   */
  'import.chat.speakerUnresolved':
    '“{name}” is not in this library. Their messages keep the name, and the character shows as missing.',
  'import.chat.castCapped':
    '{count} more characters speak in this chat than the {limit} a cast can hold. Their messages keep their names; they are not in the cast.',
  'import.chat.hiddenKept':
    '{count} messages were hidden from the model in the source, and are hidden here too.',
  'import.chat.hiddenInputShown':
    '{count} of the player’s messages were hidden in the source while the replies to them were not. A turn here hides whole or by reply, so those messages are shown to the model.',
  'import.chat.hiddenDisagrees':
    '{count} messages were hidden from the model in one chat of this family and shown in another. The chats share them here, so they are hidden in every branch.',
  'import.chat.swipes':
    '{count} swipes came in as alternatives beside the messages they belong to.',
  'import.chat.parentMissing':
    '“{chat}” says it was branched from {parent}, which is not in this import. It is kept here anyway, sharing whatever it has in common with the other chats.',
  'import.chat.emptyChat': '“{chat}” has no messages, so it has no branch in this session.',

  /**
   * **One chat file, read** —
   * [P14.7](../../../../docs/design/workplan/31-p14-scene-and-session-import.md)'s
   * SillyTavern JSONL parser, which also reads Marinara's per-chat export.
   *
   * *Every one names its chat*, because a family's notes are read together: a
   * branch and its parent share most of their lines, and "line 7" is only
   * useful to somebody who knows which file to open. The warnings are the ones
   * that change what the model is sent — a line lost, a tool call it no longer
   * sees, an attachment gone, variables a prompt read, a note placed elsewhere;
   * the rest say what was left behind and why nothing is missing because of it.
   */
  'import.chat.lineUnreadable': 'Line {line} of “{chat}” could not be read, so it was left out.',
  'import.chat.interfaceSkipped':
    '{count} of SillyTavern’s own screens saved in “{chat}” — help pages, the welcome message and the like — were left out. They were never part of the story.',
  'import.chat.toolCallsHidden':
    '{count} tool-call records in “{chat}” came in as hidden narration. SillyTavern sent them to models that could call tools; a turn here has nowhere to keep a tool call, so the model no longer sees them.',
  'import.chat.attachmentsNotCarried':
    '{count} messages in “{chat}” had files or pictures attached. The chat file does not hold them, so the messages came in without them.',
  'import.chat.modelsNotCarried':
    '{count} replies in “{chat}” recorded the model that wrote them. That is not kept: a turn here records only a request this server made.',
  'import.chat.variablesNotCarried':
    '“{chat}” had {count} chat variables set by scripts. They are not carried, so anything in the prompt that read them reads nothing.',
  'import.chat.noteOutsideHistory':
    'The author’s note in “{chat}” sat beside the story string in SillyTavern, outside the chat history. Here it sits in the history, {depth} messages from the end.',
  'import.chat.noteRole':
    'The author’s note in “{chat}” was sent as the {role}’s message in SillyTavern. Here it is placed the way the Scene pack places notes.',

  /**
   * **A chat, found against the library and loaded as a session** —
   * [P14.8](../../../../docs/design/workplan/31-p14-scene-and-session-import.md)'s
   * resolver and the doors that share it.
   *
   * `imported` is the row's first sentence because the disposition beside it
   * says *Imported* and its help says *now in your library*, and a session is
   * not in the library — so the row says where it went. The unresolved and
   * ambiguous ones warn, since each is a character, a persona or a book the
   * model will not be given. `alreadyHere` is only information: it is said
   * only when a session holds every turn the chat has, so nothing was lost by
   * not writing it twice. The three that are not a session
   * at all — not chosen, over the upload limit, not taken by this kind of
   * import — say why in the terms of the choice that decided it.
   */
  'import.chat.imported':
    'Imported as the session “{name}”, {turns} turns long. It is in Play, with your other sessions.',
  'import.chat.alreadyHere':
    'Already here, and unchanged since: a session on this account was made from this chat, and it holds everything the chat has.',
  'import.chat.sessionRefused': '“{chat}” could not be loaded as a session ({reason}).',
  'import.chat.nameAmbiguous':
    '{count} things in this library are called “{name}”, so the chat was linked to none of them rather than to a guess.',
  'import.chat.personaUnresolved':
    'The persona this chat was played as, {persona}, is not in this library, so the session has none. Your messages keep their words.',
  'import.chat.loreUnresolved':
    'The chat’s lorebook “{book}” is not in this library, so it is not linked to the session.',
  'import.chat.notChosen':
    'Chats were not chosen for this upload, so this one was named and not sent.',
  'import.chat.overLimit':
    'This chat did not fit under the {limit} MB upload limit with the rest of the folder, so it was named and not sent. Import it on its own, or sweep the folder from the server.',
  'import.chat.notImportedHere':
    'This import brings in library objects only, so the chat was read and not turned into a session.',

  /**
   * **Sync: a chat imported before, brought up to date** —
   * [P14.10a](../../../../docs/design/workplan/31-p14-scene-and-session-import.md),
   * [P14 §2.7].
   *
   * `extended` is the row's first sentence, as `imported` is a first import's:
   * where the chat went, and how much came. The rest are each one thing sync
   * did or declined to do, and §2.7 asks for the second kind to be said as
   * plainly as the first — the head kept for somebody who played on, lines the
   * source deleted still here, a round that grew beside its earlier self.
   * `mutesWaiting` warns, because a character the source muted is speaking
   * here until the next message arrives to carry the mute.
   */
  'import.chat.extended':
    'The session “{name}” was brought up to date from its source: {count} new turns. Nothing already in it was changed or removed.',
  'import.chat.syncBranches':
    '{count} new branches in the source came in as branches of the session, each named for its chat.',
  'import.chat.roundGrew':
    '{count} replies were added in the source to a round that was already here. Each round as it now stands is beside the round as it was imported, as another version of it.',
  'import.chat.syncPlayedOn':
    'You have played on in “{chat}” since it was imported, so your place in it was kept. The new messages are on the source’s branches; open a branch named for its chat to read them.',
  'import.chat.notInSource':
    '{count} turns imported before are no longer in the source (deleted or edited there). They are still in the session; nothing is deleted by an update.',
  'import.chat.syncHidden':
    '{count} turns were hidden or shown again, as they now are in the source. Anything hidden or shown here was left as you set it.',
  'import.chat.syncSettings':
    '{count} of the chat’s settings (reply order, voice, author’s note) were changed in the source and taken from it. Settings you changed here were kept.',
  'import.chat.syncMutes':
    '{count} characters were muted or unmuted, as they now are in the source, from the new messages on.',
  'import.chat.mutesWaiting':
    '{count} characters were muted or unmuted in the source, but no new message came with the change to carry it, so it will arrive with the next update that brings one.',
  'import.chat.syncCast':
    '{count} characters spoke for the first time in the new messages and were added to the session’s cast.',

  /**
   * **Families and groups** —
   * [P14.9](../../../../docs/design/workplan/31-p14-scene-and-session-import.md).
   *
   * A SillyTavern branch or checkpoint is its own file, and a family of them is
   * one session; `inFamily` is the row of every file but the family's first,
   * so a person scanning the review by file name finds where each chat went.
   * The group notes say what a `groups/` file did — or, missing, did not do —
   * for the chats beside it. `familyCycle` and `mutedUnresolved` warn: one is a
   * guess about which chat came first, the other a character who was muted and
   * is not now, since the session has nobody to mute. `parentNotHere` warns
   * because a chat was left out that a whole-folder import would bring, and
   * `groupChatsClaimed` because two groups claiming one chat means one of them
   * was not applied. `groupRead` counts the sessions made from the group's
   * chats; `groupSynced` those already here, which sync compared the group
   * with ([P14.10a]).
   */
  'import.chat.inFamily':
    '“{chat}” is a branch of “{family}”, and came in as a branch of that session.',
  'import.chat.familyCycle':
    '“{chat}” is in a loop of chats that each name another in the loop as the chat they were branched from (it names “{parent}”). “{chat}” was taken as the original.',
  'import.chat.familySelfParent':
    '“{chat}” names itself as the chat it was branched from, so it was taken as an original.',
  'import.chat.parentNotHere':
    'This chat is a branch of “{parent}”, which is in the source but was not brought in, so it was held back rather than imported as a session of its own. Import the folder whole, or sweep it from the server, to bring the family in together.',
  'import.chat.groupRead':
    'The group “{group}”: its {members} members, reply order and muted members were applied to {sessions} sessions made from its chats.',
  'import.chat.groupSynced':
    'The group “{group}” was compared with {sessions} sessions already here from an earlier import. What it changed in the source since came across where nothing here had changed it; each chat’s row says what.',
  'import.chat.groupNoChats':
    'The group “{group}” came without any of its chats, so there was nothing to apply its members and settings to.',
  'import.chat.groupChatsClaimed':
    'The group “{group}” lists chats that the group “{other}” lists too. They came in as “{other}”’s sessions, so nothing was applied from this group.',
  'import.chat.groupLegacyFormat':
    'The group “{group}” was saved by an older SillyTavern, with its members by name and one chat. It was read as SillyTavern reads it, matching each member by name.',
  'import.chat.groupLegacyMetadata':
    'The group “{group}” was saved by an older SillyTavern that kept its chats’ settings (branches, author’s notes, persona and lorebook) in the group file. A chat without its own copy had them read from there.',
  'import.chat.groupMissing':
    '“{chat}” is a group chat whose group file did not come with it. Its cast is whoever speaks in it, and it replies the way Scene does by default.',
  'import.chat.groupStrategyUnknown':
    'The group “{group}” uses a reply order this version does not know ({strategy}), so its sessions use Scene’s default.',
  'import.chat.groupGenerationMode':
    'The group “{group}” built its prompts in SillyTavern’s “{mode}” mode. That is recorded only: here, which character’s card a reply sees is decided by the Scene pack.',
  'import.chat.mutedUnresolved':
    '“{name}” was muted in the group, but is not in this library, so they could not be muted here.',

  /**
   * **A Marinara store's chats** —
   * [P14.10](../../../../docs/design/workplan/31-p14-scene-and-session-import.md).
   * Read from its tables rather than a file, so these are the things a table
   * row keeps that a session does not: another kind of chat, rows with no chat,
   * and the per-message and per-chat state [P14 §2.6] lists as a note. The
   * agents' state is the one that is a stage away rather than a choice — it
   * arrives with the tracker and director channels — and the label says so.
   */
  'import.chat.modeNotImported':
    '“{chat}” is a Marinara {mode} chat. Only roleplay chats become sessions, so it is recorded here and not imported.',
  'import.chat.orphanedMessages':
    '{messages} messages and {swipes} swipes in the Marinara store belong to no chat it holds, so they were not imported.',
  'import.chat.roleUnknown':
    '{count} messages in “{chat}” have a role Marinara does not write, so they were left out.',
  'import.chat.hiddenPerCharacter':
    '{count} messages in “{chat}” were hidden from some characters and not others. A message here is hidden from everyone or no one, so these are shown to all of them.',
  'import.chat.hiddenFromUserShown':
    '{count} messages in “{chat}” were sent to the model but hidden from the chat. Here every message the model is sent is shown, so these are visible.',
  'import.chat.rewriteOriginalsNotCarried':
    '{count} messages in “{chat}” were rewritten by Marinara’s prose guardian. The rewritten text came in; the originals were not kept.',
  'import.chat.summaryNotCarried':
    '“{chat}” had a rolling summary in Marinara. The summary itself was not imported.',
  'import.chat.summaryHiddenRestored':
    '{count} messages in “{chat}” had been hidden by Marinara’s rolling summary. The summary did not come across, so they are visible to the model again.',
  'import.chat.conversationStartHidden':
    '{count} messages in “{chat}” came before its latest conversation start, so Marinara no longer sent them to the model. They are hidden here for the same reason.',
  'import.chat.conversationStartPerCharacter':
    '{count} messages in “{chat}” started a new conversation for some characters and not others. A conversation start here is for everyone or no one, so these were not treated as starts.',
  'import.chat.branchLinkMissing':
    '“{chat}” was a branch in Marinara, but the export removed its link to the chat it came from. It is a session of its own, repeating the start it shares with that chat.',
  'import.chat.agentsNotCarried':
    '“{chat}” ran Marinara agents this version does not import, or imports under another name (expressions, backgrounds, illustrations, summaries). Their switches were not carried.',

  /**
   * **The editor and the echo chamber** —
   * [P14.5c](../../../../docs/design/workplan/31-p14-scene-and-session-import.md).
   * Their switches and settings come; the two agents that are not built each
   * say why, in a sentence a person can act on.
   */
  'import.chat.scenarioAmbiguous':
    'The characters in “{chat}” brought different scenarios, so the session was given none.',
  'import.chat.continuityApplies':
    '“{chat}” ran Marinara’s continuity checker, which rewrites what it finds, so it came across doing the same.',
  'import.chat.echoChamberDiffers':
    '“{chat}” ran Marinara’s Echo Chamber, a live audience. Here the echo chamber has the scene’s characters react instead.',
  'import.chat.immersiveHtmlNotBuilt':
    '“{chat}” ran Marinara’s immersive HTML agent. It is not built here: markup a model wrote could run code in this app.',
  'import.chat.cardEvolutionNotBuilt':
    '“{chat}” ran Marinara’s card-evolution auditor. It is not built here: a card changed inside one story would carry it into every other.',

  /**
   * **The trackers' state** —
   * [P14.5a](../../../../docs/design/workplan/31-p14-scene-and-session-import.md).
   * What came across is counted; what did not is said, each with why. The
   * models are the one a Marinara user will look for: they are global there,
   * so here the trackers run on the session's own model roles.
   */
  'import.chat.trackersCarried':
    '{count} tracker snapshots in “{chat}” came across as the tracked state of the messages they belong to, each swipe with its own.',
  'import.chat.trackerSnapshotsUnplaced':
    '{count} tracker snapshots in “{chat}” name a swipe its message does not have, so they were not placed.',
  'import.chat.trackerKeysNotCarried':
    '{count} locked or hidden tracker fields in “{chat}” name a row or field this version does not keep, so they were not carried.',
  'import.chat.manualTrackersPerAgent':
    '“{chat}” set some trackers to run only when asked. Here that is one setting for every tracker: if every tracker the chat ran was set that way, they all run only when asked; otherwise those ones were left switched off, so none runs every turn where Marinara ran it only on request. Switch them on and use Update trackers to run them.',
  'import.chat.agentModelsNotCarried':
    '“{chat}” ran trackers on models Marinara chooses per agent, for every chat. Those were not imported: the trackers here use this session’s model roles.',
  'import.chat.stateMemberUnresolved':
    'Tracked state for {count} characters ({names}) came with the chat, but they are not in this session’s cast, so it was left out.',

  /**
   * **What a Marinara store's own files said** ([P4 §7.18]). Each is a thing
   * Marinara's store does on its own boot — fall back to a backup, restore a
   * table from before a migration, set aside a file an older build wrote — and
   * the review says so because the person otherwise has no way to know the
   * library came from somewhere other than the file they would have guessed.
   */
  'import.marinara.backupUsed':
    '{file} could not be used, so the backup copy beside it was read instead. It may be one save older.',
  'import.marinara.rowsMalformed':
    '{count} entries in {file} were not rows this build could read, and were left out.',
  'import.marinara.monolithSuperseded':
    '{file} is an older copy an earlier version of Marinara wrote beside the newer one, and was not read. Marinara sets it aside too; anything only in it has to be recovered by hand.',
  'import.marinara.preShardRestored':
    'The {table} table was read from {file}, the backup Marinara keeps from before it reorganised its files — the same copy Marinara would restore on its next start.',
  'import.marinara.rowsMissing':
    'Marinara counts {expected} rows in {table}; {found} were found here.',
  'import.marinara.unshardUnfinished':
    '{file} says an offline reorganisation of this folder did not finish. What is here was read as it stands.',

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
