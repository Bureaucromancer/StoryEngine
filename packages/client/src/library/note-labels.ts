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

  /**
   * **A chat, imported as a session** —
   * [P13.6](../../../../docs/design/workplan/30-p13-scene-and-session-import.md)'s
   * tree builder, for both sources.
   *
   * [P13 §2.6] ends on *"everything else is a note, never silence"*, and these
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
   * [P13.7](../../../../docs/design/workplan/30-p13-scene-and-session-import.md)'s
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
   * [P13.8](../../../../docs/design/workplan/30-p13-scene-and-session-import.md)'s
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
   * [P13.10a](../../../../docs/design/workplan/30-p13-scene-and-session-import.md),
   * [P13 §2.7].
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
   * [P13.9](../../../../docs/design/workplan/30-p13-scene-and-session-import.md).
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
   * with ([P13.10a]).
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
   * [P13.10](../../../../docs/design/workplan/30-p13-scene-and-session-import.md).
   * Read from its tables rather than a file, so these are the things a table
   * row keeps that a session does not: another kind of chat, rows with no chat,
   * and the per-message and per-chat state [P13 §2.6] lists as a note. The
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
    '“{chat}” ran Marinara agents. Their switches, tracker values and secret plot are not imported yet; they arrive with trackers and the narrative director.',

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
