// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { newLoreEntry, uuidv7, type Actor, type Lorebook, type Turn } from '@storyengine/shared';

import { read, update, type LibraryContext } from '../library.js';
import { walkPath } from '../sessions/segments.js';
import {
  appendTurnToSession,
  readSession,
  readTurns,
  reconstructAlong,
  type SessionContext,
} from '../sessions/store.js';
import { acceptEffect } from '../turns/effects.js';
import { ensureMemoryBook, type MemoryScope } from './books.js';
import { readMemoryConfig } from './config.js';
import { SE_MEMORY_WRITTEN } from './channel.js';

/**
 * ***Remember this*** — [08 §2.1](../../../../docs/design/08-cross-session-memory.md),
 * [P8 §5], and the writer this phase ships.
 *
 * **[P8 §5] names it as the cut that cuts the right thing.** The question that
 * section frames — *whether extraction earns a model call at all* — is genuinely
 * open for the extractor and not for the summariser, and 08 §2.1's manual
 * capture *"is nearly free, needs no model call, and produces exactly the
 * discrete facts §1.4 wants — authored by the only judge who cannot be wrong
 * about what mattered."* So the phase's named fallback is the chain, the
 * pipeline, the books, **manual capture** and the toggles, with the automatic
 * extractor deferred. This is that build.
 *
 * *What is deferred with it is named where it is deferred*: the automatic pass,
 * and with it the adversary `LoreEntry.locked` exists for. The reader lands here
 * anyway — see {@link rememberThis} — so the extractor inherits it rather than
 * having to invent it.
 *
 * ---
 *
 * ***The write is an escaped effect, and the effect is a turn*** —
 * [07 §7](../../../../docs/design/07-branching.md), [P8 §1.9].
 *
 * **A memory written on a line somebody then abandons is exactly what the
 * abandonment banner exists for**, and the banner counts effects on turns. A
 * capture happens between turns, so at first sight it has no turn to attach to —
 * and a past turn cannot acquire one, because segments are append-only and never
 * rewritten ([03 §5.5]).
 *
 * **`writeChannel` has the same problem and already answers it**: it appends *a
 * turn with no model call and no tape*, for the reason its docstring gives —
 * [03 §8.1]'s promise is that a change of state is visible in the turn record,
 * and a turn is what the workbench shows. `undoTurn` and `divergenceTurn` write
 * the same shape. So does this, and the consequences fall out correctly:
 * rewinding past the capture counts it as still out in the world, which is the
 * true answer, because the entry is in the library and branching cannot un-write
 * it.
 */

export interface CaptureRequest {
  /** The turn whose words are being remembered. Must be on this session. */
  turnId: string;
  /** Whose memory it goes into. Must be in the session's declared cast. */
  actorId: string;
  /**
   * What to remember.
   *
   * **The user's words, not the turn's**, and that is the affordance rather than
   * a shortcut. [P8 §1.4]'s *extract facts, not summaries* is a judgement, and
   * 08 §2.1 says the person pressing the button is *the only judge who cannot be
   * wrong about what mattered*. The client prefills this from the message; what
   * lands is whatever they left in the box.
   */
  text: string;
  /**
   * What makes it fire later — [03 §3](../../../../docs/design/03-data-model.md).
   *
   * **Required, because an entry with no keys never activates.** A capture that
   * quietly wrote a keyless entry would produce a memory that exists, is
   * listed, is editable, and can never reach a prompt — the *my lorebook never
   * fires* diagnosis arriving one surface too late, which the shelf's `Off`
   * badge exists to prevent one file over.
   */
  keys: string[];
}

export type CaptureOutcome =
  | { kind: 'captured'; bookId: string; entryId: string }
  | { kind: 'no-session' }
  | { kind: 'no-turn' }
  | { kind: 'not-in-cast' }
  | { kind: 'empty' }
  /** [08 §6]'s *never from hidden content*, at the cheap end — see below. */
  | { kind: 'refused'; reason: string };

/**
 * ***A turn a hook fired on is refused, and told why*** — [08 §6], [P8 §1.5],
 * [P8.5]'s cheap end.
 *
 * 08 §6 asks that memory never be derived from hidden content — *a hook's
 * premise, an unfired hook's entrances, a hidden channel, GM-only state* — and
 * that the refusal happen **at the source** *"rather than filtering them
 * later"*, because by then the sentence is written down. [P8.1] took the
 * structural half of that: the `transcript` payload hands a step what was said
 * and nothing about how it was produced.
 *
 * **What is left is the content-level remainder**, and it is the sharper case:
 * *an entrance is not a summary of an arrival, it is the finished prose of one*,
 * so it reaches a prompt **through the narrator's own output** — which
 * `transcript` legitimately carries and no payload filter can reach. §1.5 asks
 * for *a refusal with a reason rather than a filter*, and this is it.
 *
 * ***Refusing the whole turn rather than the sentence***, which is coarse on
 * purpose. There is no way to tell which clause of a paragraph came from an
 * entrance; a filter that guessed would be the *"filtering later"* 08 §6 rejects
 * wearing a finer grain. A person who wants the other half of that turn
 * remembered can say it in their own words, which is the affordance this whole
 * feature is.
 */
function hiddenContentIn(turn: Turn): string | null {
  return turn.hooks?.verdict === 'fired'
    ? 'A plot hook fired on this turn, so its prose may be an entrance — words a second ' +
        'playthrough is supposed to reach freshly. Write what you want remembered in your own words instead.'
    : null;
}

/**
 * Writes one memory, and records that it left the session.
 *
 * **Under the session lock for the effect and on the library's queue for the
 * entry**, which is two locks and not one because they guard different things:
 * the turn append has to serialise against every other turn on this session, and
 * the entry append has to serialise against every other write to this book. The
 * order matters — **the library write happens first** — so a crash between them
 * leaves an entry with no effect recorded rather than an effect claiming an
 * entry that is not there. *The first is a memory the banner under-counts; the
 * second is a banner that lies.*
 */
export async function rememberThis(
  sessions: SessionContext,
  library: LibraryContext,
  handle: string,
  sessionId: string,
  request: CaptureRequest,
): Promise<CaptureOutcome> {
  const text = request.text.trim();
  const keys = request.keys.map((key) => key.trim()).filter((key) => key !== '');
  if (text === '' || keys.length === 0) return { kind: 'empty' };

  const session = await readSession(sessions, handle, sessionId);
  if (session === null) return { kind: 'no-session' };

  const turns = await readTurns(sessions, handle, sessionId);
  const subject = turns.get(request.turnId);
  if (subject === undefined) return { kind: 'no-turn' };

  const refusal = hiddenContentIn(subject);
  if (refusal !== null) return { kind: 'refused', reason: refusal };

  /**
   * ***`share` governs the write, which is what makes [08 §4]'s table real.***
   *
   * Two of its four rows are about a session that reads history without adding
   * to it — *"an experiment. Learns from history without polluting it"* and *"a
   * sealed alternate universe"* — and neither is expressible unless something
   * actually refuses to write. Refused with the reason rather than silently
   * ignored, for [00 §3.3]'s standing posture: a button that appeared to work
   * and wrote nothing is the worst of the three available behaviours.
   */
  if (!readMemoryConfig(session).share) {
    return {
      kind: 'refused',
      reason:
        'This session is not sharing its memories. Turn sharing on in the Session panel to keep this one.',
    };
  }

  /**
   * **The cast is the authority on whose memory this may be**, and checking it
   * is what keeps [08 §3]'s scope honest from the write side as well as the
   * read: a capture naming an actor who is not in this session would put words
   * into a book the session has no claim on.
   */
  const cast = session.cast ?? { persona: null, actors: [] };
  if (!cast.actors.includes(request.actorId)) return { kind: 'not-in-cast' };

  const scope: MemoryScope = { actor: request.actorId, persona: cast.persona };
  const book = await ensureMemoryBook(library, handle, scope, {
    actor: nameOf(library, handle, request.actorId) ?? 'someone',
    persona: cast.persona === null ? null : nameOf(library, handle, cast.persona),
  });

  const entry = {
    ...newLoreEntry(titleFor(text)),
    keys,
    content: text,
    /**
     * ***`LoreEntry.locked` gets its first writer here, and the reader is owed
     * rather than invented*** — [P8.3], and this is worth being exact about.
     *
     * The field reads *"locked against automatic modification by agents"* and
     * has had **no reader anywhere** since it was written. [P8.3] gives it one —
     * *the extractor never rewrites a locked entry* — and [P8 §5]'s fallback cut
     * defers the extractor, so in this build there is no agent to lock against
     * and **the reader genuinely does not exist yet.** Manufacturing one would
     * be worse than saying so.
     *
     * **What does exist is the case with the strongest claim to the field.** A
     * memory somebody typed is not a mis-extraction to be refined; it is the
     * sentence they chose, and an extractor that later rewrote it would be
     * eating a correction that was never wrong in the first place —
     * [P8 §3.1]'s C2 in its purest form: *a book that eats corrections is a book
     * people stop correcting*, silently. So a hand-written memory is locked from
     * the moment it is written, and the extractor inherits an obligation with
     * subjects already on disk rather than one it has to create examples for.
     */
    locked: true,
    /**
     * ***The origin ref and the timestamp, in `metadata`*** — [P8 §1.4], [P8.3].
     *
     * *"Each entry carries a ref to its origin session and a timestamp"*, and
     * this is **the only place they fit without opening a schema field**:
     * [11 §4](../../../../docs/design/11-lorebooks-as-a-format.md) refuses new
     * lorebook fields by name, and `metadata` is the open record it offers
     * instead. What they buy is [08 §2]'s three consequences — *attributed
     * separately, deleted individually* — and the demo's second half, where the
     * workbench names the entry **and its origin session**.
     */
    metadata: {
      'se.memory': {
        sessionId,
        turnId: subject.id,
        at: new Date().toISOString(),
        by: 'manual',
      },
    },
  };

  const current = read(library, handle, book.id);
  const held = current.body as Lorebook;
  await update(
    library,
    handle,
    book.id,
    { ...held, entries: [...held.entries, entry] },
    current.contentHash,
    {
      source: { kind: 'memory', sessionId },
      reason: `remembered from a turn in ${session.name}`,
    },
  );

  await recordEscape(sessions, handle, sessionId, book.id, entry.id);
  return { kind: 'captured', bookId: book.id, entryId: entry.id };
}

/**
 * The turn that says a memory left the session.
 *
 * A turn with no model call and no tape, which is `writeChannel`'s shape and
 * `undoTurn`'s and `divergenceTurn`'s — see the header for why a capture needs
 * one at all. Through `acceptEffect`, so the scope comes from the channel's own
 * declaration rather than from this call site: `se.memory.written` declares
 * `escapes: true`, and that is the whole of what makes the abandonment count
 * non-zero for the first time since it was built.
 */
async function recordEscape(
  sessions: SessionContext,
  handle: string,
  sessionId: string,
  bookId: string,
  entryId: string,
): Promise<void> {
  const session = await readSession(sessions, handle, sessionId);
  if (session === null) return;

  const turns = await readTurns(sessions, handle, sessionId);
  const path = walkPath(turns, session.headTurnId);
  const running = await reconstructAlong(sessions, handle, sessionId, path);

  const id = uuidv7();
  const effect = acceptEffect(
    id,
    {
      channelId: SE_MEMORY_WRITTEN,
      scopeKey: bookId,
      op: { type: 'set', path: '/' },
      /**
       * ***The ids written on **this** turn, and it cannot be a running total.***
       *
       * A first draft read the channel's current value and appended to it, which
       * is what the phrase *"appending the entry ids written this turn"* sounds
       * like it wants — and it silently produced a list of one every time.
       * **`applyEffects` skips `scope: 'escaped'`**, which is the whole point of
       * the scope: an escaped effect is never replayed, so the state it would
       * have accumulated into never exists to be read back.
       *
       * That is not a limitation to work around; it is the mechanism being
       * right. What a rewind needs to know is *how many things did the turns I
       * am leaving write*, and that is a sum over the effects on those turns —
       * `abandonedBy` counts effects, not channel values. A running total would
       * have made the newest turn's value the count for the whole line, so
       * abandoning one turn would have reported everything the line ever wrote.
       */
      after: { entryIds: [entryId] },
      proposedBy: { kind: 'user' },
    },
    running,
  );

  await appendTurnToSession(sessions, handle, sessionId, {
    id,
    sessionId,
    parentTurnId: session.headTurnId,
    createdAt: new Date().toISOString(),
    status: 'complete',
    effects: [effect],
    tape: [],
  });
}

/**
 * A title, from the memory's own first words.
 *
 * `LoreEntry` wants one and a person pressing a button does not want to be asked
 * for two fields. Truncated on a word boundary, because a title cut mid-word
 * reads as a bug rather than as a summary — and the whole text is in `content`
 * either way.
 */
/**
 * An entry's name from its words: one line, cut at a word. Exported at [P13.7]
 * for the facts a Setup made from a turn keeps, which are named the same way.
 */
export function titleFor(text: string): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  if (oneLine.length <= 60) return oneLine;
  const cut = oneLine.slice(0, 60);
  const lastSpace = cut.lastIndexOf(' ');
  return `${lastSpace > 20 ? cut.slice(0, lastSpace) : cut}…`;
}

/** An actor's name, or null when the card is gone — [00 §3.3]'s *show what you cannot resolve*. */
function nameOf(library: LibraryContext, handle: string, id: string): string | null {
  try {
    return (read(library, handle, id).body as Actor).name;
  } catch {
    return null;
  }
}
