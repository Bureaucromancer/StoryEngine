// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type {
  Candidate,
  StepDefinition,
  StepHost,
  StepImplementation,
  StepInput,
} from '@storyengine/sdk';

import type { Lorebook } from '@storyengine/shared';
import { newLoreEntry } from '@storyengine/shared';

import { moveText } from '../assembly/pictures.js';
import { read, update, type LibraryContext } from '../library.js';
import { ensureMemoryBook, type MemoryScope } from './books.js';
import { readMemoryConfig } from './config.js';

/**
 * ***The automatic extractor*** —
 * [08 §2.1](../../../../docs/design/08-cross-session-memory.md),
 * [P8 §5](../../../../docs/design/workplan/25-p8-implementation.md)'s named cut,
 * [P11.12](../../../../docs/design/workplan/28-p11-implementation.md).
 *
 * **[P8](../../../../docs/design/workplan/25-p8-implementation.md) cut this
 * deliberately and named no arrival**, which is how it came to be owned by
 * nobody for two phases —
 * [manual testing §10.1](../../../../docs/design/workplan/05-manual-testing.md)
 * records the finding, and [P11 §0.4] made the decision rather than carrying it
 * a third time. **The ground was never the feature**: two of P8's three
 * criticals are *vacuous* while nothing extracts, so leaving it unowned did not
 * defer a feature, it left a closed phase's gate permanently unfinishable.
 *
 * ***Discrete facts, not summaries*** — §2.1, and it is the one instruction
 * this step's prompt exists to carry: *"a summary is one blob with one
 * relevance; five memories are five things that can be retrieved independently,
 * attributed separately, and deleted individually when one turns out to be
 * wrong."* The rolling summary is a different feature in a different file and
 * this must not become a second one.
 *
 * ***A `post` step, where the summariser is `pre`.*** `summarise.ts` is `pre`
 * because what it produces goes into **this** turn's prompt; a memory is a
 * reading of what just happened and goes into a **book**, so arriving after the
 * prose is exactly right. The precedent is `suggest.ts`, which is `post` for the
 * same reason and whose report likewise reaches the next turn.
 *
 * ***`warn`, never `abort`.*** A memory is derived and disposable — [P8]'s own
 * safety argument — and a turn thrown away because an extractor timed out would
 * trade the story for a note about it.
 */

export const SE_EXTRACT_MEMORY = 'se.memory.extract';

/**
 * How often it runs.
 *
 * ***§2.1 says "at session end, and periodically during long sessions", and
 * this build has no session end.*** A session is never closed — it is left, and
 * left sessions are exactly the ones a person comes back to — so *at session
 * end* has no event to hang on and a step that waited for one would never run.
 * **The periodic half is therefore the whole of it**, which is the honest
 * reading rather than a reduction: what §2.1 is asking for is that a long
 * session deposit memories as it goes, and a cadence does that at every length.
 *
 * *Eight, which is a judgement and is written down as one.* Short enough that a
 * session of forty turns leaves five memories rather than one; long enough that
 * the extra call is a twelfth of the turns rather than every one of them.
 */
export const EXTRACT_EVERY_N_TURNS = 8;

export const EXTRACT_STEP: StepDefinition = {
  id: SE_EXTRACT_MEMORY,
  stage: 'post',
  reads: ['transcript'],
  /**
   * Nothing, and the reason is [08 §5]'s: a memory **leaves** the session
   * rather than changing it. What it does write — the escaped effect that makes
   * the abandonment banner non-zero — is recorded by the write path, not
   * declared here, because it is not session state either.
   */
  writes: [],
  callKind: 'summarise',
  when: { when: 'cadence', everyNTurns: EXTRACT_EVERY_N_TURNS },
  failure: 'warn',
  /**
   * `prose`, for `summarise.ts`' stated reason: nothing in this build binds any
   * role but that one and `resolveRole` has no cross-role fallback, so asking
   * for `fast` would make every long session log a failed step.
   */
  role: 'prose',
};

/**
 * ***What the model is asked for, and the three things it is told not to do.***
 *
 * Each refusal is a failure mode §2.1 or [08 §6] names, and each would be
 * invisible in the output — a plausible memory that is wrong in a way only a
 * reader of the session could see.
 */
export const EXTRACT_PROMPT = [
  'From the exchange below, list the discrete facts and events worth remembering later.',
  '',
  'Each one is a single, self-contained statement — something that happened, something',
  'somebody learned, a decision, a promise, a relationship that changed. Not a summary:',
  'five separate memories are better than one paragraph covering the same ground.',
  '',
  'Do not invent. If the exchange says nothing worth remembering, return none.',
  'Do not record what a character privately thought unless it was said aloud.',
  'Do not speculate about what will happen next.',
  '',
  'For each memory also give the words somebody would later search for to find it —',
  'names, places, objects. Two or three is usually right.',
].join('\n');

/** The shape the call is asked for, and the shape the writer trusts. */
export const EXTRACT_SCHEMA = {
  type: 'object',
  properties: {
    memories: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          keys: { type: 'array', items: { type: 'string' } },
        },
        required: ['text', 'keys'],
        additionalProperties: false,
      },
    },
  },
  required: ['memories'],
  additionalProperties: false,
} as const;

export interface ExtractedMemory {
  text: string;
  keys: string[];
}

/**
 * What a model said, narrowed to what a book will take.
 *
 * ***A memory with no keys is dropped rather than written***, which is
 * `capture.ts`'s rule applied to the automatic path and matters more here: a
 * person writing a keyless memory would at least see it in the editor, while an
 * extractor producing them would fill a book with entries that exist, are
 * listed, are editable and **can never reach a prompt**.
 */
export function readExtraction(value: unknown): ExtractedMemory[] {
  if (typeof value !== 'object' || value === null) return [];
  const listed = (value as { memories?: unknown }).memories;
  if (!Array.isArray(listed)) return [];

  const found: ExtractedMemory[] = [];
  for (const one of listed) {
    if (typeof one !== 'object' || one === null) continue;
    const shape = one as { text?: unknown; keys?: unknown };
    const text = typeof shape.text === 'string' ? shape.text.trim() : '';
    const keys = Array.isArray(shape.keys)
      ? shape.keys.filter((key): key is string => typeof key === 'string' && key.trim() !== '')
      : [];
    if (text === '' || keys.length === 0) continue;
    found.push({ text, keys: keys.map((key) => key.trim()) });
  }
  return found;
}

/**
 * ***Whether this book already knows this.***
 *
 * §2's *"a second session about the same events does not double the book"*, and
 * the shape of the answer is the whole of what a dedupe can honestly be here:
 * **no embeddings** ([25 E2] puts semantic retrieval post-1.0), so what is left
 * is the text and the keys. Normalised case and punctuation, because a model
 * asked twice about the same evening produces the same sentence with different
 * commas far more often than it produces a different sentence.
 *
 * *This is a coarse rule and it errs towards not writing*, which is the right
 * direction: a memory missed is retrievable from the transcript, and a book
 * with four copies of one fact is a retrieval budget spent four times on it.
 */
export function alreadyKnown(book: Lorebook, memory: ExtractedMemory): boolean {
  const wanted = normalise(memory.text);
  return book.entries.some((entry) => normalise(entry.content) === wanted);
}

function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N} ]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface ExtractContext {
  library: LibraryContext;
  handle: string;
  sessionId: string;
  /** The session document, for its memory config and its cast. */
  session: {
    name: string;
    cast?: { persona: string | null; actors: string[] } | undefined;
    memory?: unknown;
  };
  /** An actor's name, for the book's own title. */
  nameOf: (actorId: string) => string | null;
  /** What it wrote, for the record and the tests. */
  report: (written: { bookId: string; entryIds: string[] }[]) => void;
}

export function extractMemories(context: ExtractContext): {
  definition: StepDefinition;
  run: StepImplementation;
} {
  return {
    definition: EXTRACT_STEP,
    run: async (input: StepInput, host: StepHost) => {
      /**
       * ***`share` governs the write, exactly as it does for a manual
       * capture.*** [08 §4]'s table has two rows about a session that reads
       * history without adding to it, and neither is expressible unless
       * something refuses to write. **Checked before the call**, not after: a
       * session that is not sharing must not spend a model call to discover
       * that it is not sharing.
       */
      if (!readMemoryConfig(context.session).share) return {};

      const cast = context.session.cast ?? { persona: null, actors: [] };
      if (cast.actors.length === 0) return {};

      const exchange = renderExchange(input);
      if (exchange === '') return {};

      const result = await host.call({
        candidates: [
          block('se.memory.task', 'system', EXTRACT_PROMPT),
          block('se.memory.turns', 'user', exchange),
        ],
        schema: EXTRACT_SCHEMA,
      });

      const memories = readExtraction(result.object);
      if (memories.length === 0) return {};

      const written: { bookId: string; entryIds: string[] }[] = [];
      for (const actorId of cast.actors) {
        const entryIds = await writeInto(
          context,
          { actor: actorId, persona: cast.persona },
          memories,
        );
        if (entryIds.bookId !== null) {
          written.push({ bookId: entryIds.bookId, entryIds: entryIds.entryIds });
        }
      }
      context.report(written);
      return {};
    },
  };
}

/**
 * Appends what this book does not already know.
 *
 * ***The locked rule is here, and it is a rule about what is never touched
 * rather than about what is written.*** [P8.3] gave `LoreEntry.locked` a writer
 * and said its reader was owed — *"the extractor never rewrites a locked
 * entry"* — and the shape that honours it is the one this build already has:
 * **this appends and never updates**, so a hand-written memory cannot be eaten
 * because nothing here edits an entry at all. *A book that eats corrections is
 * a book people stop correcting*, and the cheapest way not to eat them is to
 * have no code that could.
 *
 * **Extracted entries are not locked**, which is the other half of the same
 * decision: the field means *locked against automatic modification*, and an
 * entry this step wrote is exactly the kind a later refinement should be free
 * to improve. A person who corrects one by hand is editing it in the editor,
 * and that is a different act with a different field.
 */
async function writeInto(
  context: ExtractContext,
  scope: MemoryScope,
  memories: readonly ExtractedMemory[],
): Promise<{ bookId: string | null; entryIds: string[] }> {
  const book = await ensureMemoryBook(context.library, context.handle, scope, {
    actor: context.nameOf(scope.actor) ?? 'someone',
    persona: scope.persona === null ? null : context.nameOf(scope.persona),
  });

  const current = read(context.library, context.handle, book.id);
  const held = current.body as Lorebook;

  const fresh = memories.filter((memory) => !alreadyKnown(held, memory));
  if (fresh.length === 0) return { bookId: null, entryIds: [] };

  const entries = fresh.map((memory) => ({
    ...newLoreEntry(titleFor(memory.text)),
    keys: memory.keys,
    content: memory.text,
    metadata: {
      'se.memory': {
        sessionId: context.sessionId,
        at: new Date().toISOString(),
        // ***`extracted`, where a capture writes `manual`.*** The workbench and
        // the panel both read this, and telling a person which of their
        // memories they wrote is the difference between correcting one and
        // wondering where it came from.
        by: 'extracted',
      },
    },
  }));

  await update(
    context.library,
    context.handle,
    book.id,
    { ...held, entries: [...held.entries, ...entries] },
    current.contentHash,
    {
      source: { kind: 'memory', sessionId: context.sessionId },
      reason: `remembered from ${context.session.name}`,
    },
  );

  return { bookId: book.id, entryIds: entries.map((entry) => entry.id) };
}

/** The first line, bounded — a name for the shelf rather than a summary. */
function titleFor(text: string): string {
  const first = text.split('\n')[0] ?? text;
  return first.length <= 60 ? first : `${first.slice(0, 57)}…`;
}

/**
 * The turns this call is about, as one block.
 *
 * ***What it does not carry is the point.*** [08 §6] asks that memory never be
 * derived from hidden content, and [P8.1] took the structural half: the
 * `transcript` payload is *what was said*, with nothing about how it was
 * produced. This reads that payload and nothing else, so a hook's premise, a
 * hidden channel and GM-only state are unreachable here rather than filtered.
 *
 * ***The turns since it last ran, not the session*** (2026-09-27). The
 * transcript is the whole path's story, and this rendered all of it every
 * eighth turn: the fortieth turn's extraction re-read the first thirty-nine,
 * so the cost of remembering grew with the square of the session, every old
 * exchange was offered for extraction again (and a paraphrase of a known fact
 * is a new fact to `alreadyKnown`), and a long session outgrew the window with
 * a block that is required and so cannot be trimmed. The cadence runs on the
 * eighth story turn and the transcript stops before the turn running it, so
 * the last eight are exactly the ones since the last run — this turn's own
 * exchange is the first of the next eight.
 */
function renderExchange(input: StepInput): string {
  return (input.transcript ?? [])
    .slice(-EXTRACT_EVERY_N_TURNS)
    .map((turn) =>
      // The move with its pictures' stand-ins, so a remembered moment that was a
      // picture is remembered as one ([25 E15]).
      [turn.input === undefined ? '' : `> ${moveText(turn.input)}`, turn.output?.text ?? '']
        .filter((line) => line !== '')
        .join('\n'),
    )
    .filter((turn) => turn !== '')
    .join('\n\n');
}

/** A local helper, like the summariser's and the suggester's, and for its reason. */
function block(id: string, role: 'system' | 'user', text: string): Candidate {
  return {
    id,
    source: { kind: 'step', stepId: SE_EXTRACT_MEMORY },
    reason: 'what is worth remembering from this',
    role,
    text,
    required: true,
  };
}
