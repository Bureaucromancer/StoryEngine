// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { labels } from '../../i18n/catalogue.js';

/**
 * ***The review's words*** — [P16.3g](../../../../../docs/design/workplan/35-p16-world.md),
 * [16 §5](../../../../../docs/design/16-publish.md).
 *
 * **Whole phrases with the values substituted in**, the client's rule ([20
 * §12.2], and the lint rule that refuses a sentence assembled from fragments):
 * every count has its one and its many as two entries, because *1 pictures* is
 * the bug and a plural is not a suffix in every language a catalogue may hold.
 *
 * *In the review's chunk*, with the review: none of it is read before somebody
 * presses *Publish…* ([21 §7]).
 */
export const WORDS = labels('publish.review', {
  title: 'Publish',
  loading: 'Gathering what this would send…',
  // ~~*everything that names*~~, which had no object (2026-10-11, the P16.3g review).
  worldLead: 'This world, with everything it holds and everything they name, as one file.',
  objectLead: 'This {kind} and everything it names, as one file.',
  selectionTitle: '{count} things you chose',
  selectionLead: 'These and everything they name, as one file.',
  sameAs: '“{name}” already holds exactly these — publish that world instead.',

  just: 'Nothing else would leave with “{name}”, so the file would hold this {kind} alone. Download hands it over exactly as stored, which is what one object on its own is for.',
  justPictures:
    'Nothing else would leave with “{name}”. Download hands this {kind} over as stored, without its {count} pictures; the file Publish makes carries them.',
  download: 'Download this {kind}',
  downloading: 'Preparing the file…',

  groupWorld: 'Members of this world',
  groupSelection: 'You chose these',
  groupObject: 'What you are publishing',
  groupOne: 'What they name',
  groupTwo: 'Two steps out',
  groupFurther: 'Further out',
  include: 'Include “{name}”',
  root: 'This is what you are publishing, so it is always in the file.',
  foundByName:
    'Found by its name: the id it was named by is not in your library, and the name matched.',
  required: 'Marked required.',
  builtIn:
    'From the built-in library — off unless you tick it, since whoever opens the file may have it already.',
  optional: 'Can be left out without a warning.',
  presetHint:
    'A preset is tuning rather than content: left out, the story plays with the reader’s own.',
  requiredLeftOut:
    'Marked required by its author. Left out, whoever opens the file will be missing the world, not a nice extra — you can still publish without it.',
  missingUnder: 'Not in your library: “{name}” ({kind}). The file says it is missing.',
  missingUnderRequired:
    'Not in your library, and marked required: “{name}” ({kind}). Whoever opens the file will be missing the world, not a nice extra.',
  /*
   * ***A reference from a row the file does not hold*** (2026-10-11, the P16.3g
   * review): `fileSet` notes a missing reference only from a carried node, so
   * under an unticked row — or an unticked session — *the file says it is
   * missing* is not true. Said as a fact about the row instead, without the
   * warning.
   */
  namesMissing: 'It names “{name}” ({kind}), which is not in your library.',
  /*
   * ~~*so the file says it is missing*~~ (2026-10-11, the P16.3g review): a
   * starting point that does not resolve is never in `leftBehind`, and the
   * writer filters the World's contents to what travels, so the file neither
   * holds nor names it. The review is the only description of the file the
   * sender reads, so it says what the file does.
   */
  missingRoot: '“{name}” is not in your library any more, so the file will not hold it or name it.',
  excludedNested:
    '“{name}” is a world inside this world. A world holds objects and sessions, not worlds, so it never travels.',
  excludedUnknown:
    '“{name}” is a kind this build does not know ({schema}), so there is nothing here to send.',
  writtenByPlay:
    'Stays home whatever is ticked: play wrote this book, and its entries are what sessions said — sessions you are not sending among them.',
  tooLarge:
    'Stays home whatever is ticked: “{name}” is {size}, larger than one file in a world may be.',
  orphan: 'Nothing left in the file names this — it came with “{name}”.',
  orphanGroup:
    'These came with “{name}”, which you left out, and nothing left in the file names them:',
  leaveOut: 'Leave these out too',
  sizeOnly: '{size}',
  picturesOne: '1 picture, {size}',
  picturesMany: '{count} pictures, {size}',
  allNotes: 'Everything this review notes',

  sessionsTitle: 'Sessions in this world',
  sessionsLead:
    'Each is off until you tick it: sending somebody your stories is a thing to choose, not a thing to find out you did.',
  sessionFacts: '{turns}, {pictures}, {size}, last played {date}',
  turnsOne: '1 turn',
  turnsMany: '{count} turns',
  sessionPicturesOne: '1 picture',
  sessionPicturesMany: '{count} pictures',
  bringsOne: 'Brings 1 thing not otherwise in the file.',
  bringsMany: 'Brings {count} things not otherwise in the file.',
  bindings: 'The connections it was set to play with stay here: a file never carries a connection.',
  models: 'Its turns record which model answered each one.',
  memories:
    'Its recorded prompts may quote memories drawn from your other sessions; they travel as the session sent them.',
  archived: 'Archived.',
  missingPixelsOne: '1 of its pictures is not on disk, and stays behind.',
  missingPixelsMany: '{count} of its pictures are not on disk, and stay behind.',
  nameOnly: 'This file would hold the world’s name and nothing else.',
  nothingAtAll: 'Nothing would be in this file, so there is nothing to publish.',

  historyLabel: 'Include each object’s edit history',
  historyHint:
    'Edit history is a working record — the false starts, the abandoned phrasings — that people do not necessarily intend to publish. Without it, the file carries each object as it is now.',
  historyNone: 'Nothing ticked has an earlier version.',
  historyOne: 'Adds 1 earlier version, {size}.',
  historyMany: 'Adds {count} earlier versions, {size}.',

  needsTitle: 'What opening it needs',
  modeHere: 'The {mode} mode — {version} here.',
  modeNotHere:
    'The {mode} mode, which this install does not have: the file says it needs it, and whoever opens it is told.',
  omittedPicture:
    'A picture of “{name}” ({ref}, {size}) is larger than one file in a world may be, and stays behind.',
  objectTooLarge: '“{name}” stays home: at {size} it is larger than one file in a world may be.',
  /**
   * ***What a build without the World file reader does with the file*** —
   * [P16 §1.1]'s last row, owed as a sentence in the review, **corrected by
   * trying it** (2026-10-11, [P16.3g]: a World file written by this branch,
   * with history on and a book scoped to the World, sent to alpha 6's own
   * upload door as alpha 6's client sends it). §1.1 said an older build
   * *refuses it at the import panel*; the plan's reading of the code said it
   * *reads it as a folder of loose files*. Both were half right. Alpha 6's
   * picker does not offer `.seworld`; picked anyway (*All files*), it took the
   * upload, refused the manifest, the World and every session as kinds it does
   * not know, refused the book scoped to the World as not valid, left a
   * lorebook's gallery picture unattached, and brought in the rest — an actor
   * with her card, a book, a treatment — under their own ids. **With history
   * in the file, each object with history then landed at one of its older
   * versions**, because every earlier version is a whole body under the live
   * id and the default *replace* wrote each one over the last.
   *
   * ***Corrected twice the same day, by the P16.3g review.***
   *
   * - ~~*and not a lorebook's own pictures*~~ — **no picture but an actor's
   *   own card's.** The review's re-run gave a treatment a picture as well,
   *   and alpha 6 left it as loose as the book's
   *   (`import.file.pictureWithoutACard`; the treatment landed naming a media
   *   file its folder did not hold, and the picture's route answered 404),
   *   while the actor's expression, carried inside `card.png`, answered.
   *   Alpha 6's loose-file reader says the same in its source: a PNG with no
   *   card payload is a picture without a card, and only a card is given
   *   `assets` to carry — so a setup's pictures, and a lorebook entry's, go
   *   the same way. The writer keeps every kind but an actor in the folder
   *   layout, pictures in `assets/` beside it.
   * - ~~*Builds before this one*~~ — **alpha 6 and earlier.** Every build
   *   compiles this sentence in, and the first release carrying P16.3e's reader
   *   reads the file as a world; *before this one* would be false from the
   *   next release on. Named by its boundary instead: no build up to alpha 6
   *   has the reader, so none reads it as a world. *What* an older build does
   *   with it was tried on alpha 6 alone, and the sentence after the first
   *   says alpha 6 by name for that reason.
   *
   * Both sentences say only that.
   */
  olderBuilds:
    'Alpha 6 and earlier builds cannot read this as a world. Alpha 6 does not offer the file in its import picker, and given it anyway brings in the objects alone: not the world, not its sessions, not a book scoped to a world, and no picture except those inside a character’s card.',
  olderBuildsHistory:
    'With history included, alpha 6 also lands each object that has history at one of its earlier versions rather than as it is now.',

  keepLegend: 'What publishing keeps',
  keepWorldOne: 'Keep this one as a world named',
  keepWorld: 'Keep these {count} as a world named',
  keepName: 'The world’s name',
  keepSnapshot: 'Just make the file',
  keepHint: 'What you leave out above leaves the file, not the world.',
  keepWorldStart: 'Publishing again makes a new file; the world stays one world.',
  keepObject: 'Publishing one object keeps nothing.',
  nameNeeded: 'A world needs a name.',

  totals: 'In the file: {objects}, {sessions}, {pictures} — {size}.',
  objectsOne: '1 object',
  objectsMany: '{count} objects',
  sessionsOne: '1 session',
  sessionsMany: '{count} sessions',
  publish: 'Publish',
  publishing: 'Publishing…',
  lookAgain: 'Look again',
  looking: 'Looking again…',
  beforeYouPublish: 'Before you publish:',
  saved: 'Saved {file}.',
  savedNoName: 'Saved the file.',
  kept: 'Kept as the world “{name}”.',
  openIt: 'Open it',
  drift:
    'The library changed while you were looking, so the file holds it as it is now rather than exactly what you reviewed.',
  missingOne: '1 reference could not be carried: it names something not in your library.',
  missingMany: '{count} references could not be carried: they name things not in your library.',
  keptAlready:
    'This selection is the world “{name}” now. To send it again, publish that world from its page, which keeps no second one.',
});

/**
 * ***Why there is no review, or no file*** — by the class the server sends,
 * never its English (`errorCode`'s rule, [22 §1.4]).
 */
export const REFUSAL_WORDS = labels('publish.refusal', {
  notFound: 'Nothing there to publish — what was chosen is not in your library any more.',
  worldInSelection: 'A world is published from its own page, not as part of a selection.',
  invalidName: 'A world kept from a selection needs a name: one line, at most 200 characters.',
  tooLarge:
    'This would make a file larger than a world file can hold. Leave something out — a session, or the history — and publish again.',
  changed:
    'Something changed while the file was being written, so no file was made. Publish again.',
  changedKept: 'The world “{name}” was kept before that happened; publish it from its page.',
  noSpace: 'There is not enough free space on the server’s disk for this file.',
  failed: 'That could not be published.',
  unreachable: 'The server could not be reached, so nothing was published.',
  previewFailed: 'What this would send could not be worked out.',
  /*
   * ***The body failed after the headers*** (2026-10-11, the P16.3g review):
   * the World a selection kept is named from the header, by `changedKept`
   * below, so the next press does not keep a second.
   */
  interrupted: 'The file did not arrive — the connection ended part way — so nothing was saved.',
  downloadGone: 'That is not here any more, so there was nothing to download.',
  downloadFailed: 'That could not be downloaded.',
  downloadUnreachable: 'The server could not be reached, so nothing was downloaded.',
});

/** A count as its phrase — the one and the many are whole phrases, for a catalogue to word. */
export function countPhrase(one: string, many: string, count: number): string {
  return count === 1 ? one : many.replace('{count}', String(count));
}
