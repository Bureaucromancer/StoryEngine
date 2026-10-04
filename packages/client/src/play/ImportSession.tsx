// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { useRef, useState, type JSX } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';

import {
  errorCode,
  importChatFile,
  importSessionDocument,
  type ImportFileResult,
  type ImportItem,
} from '../api.js';
import { labels } from '../i18n/catalogue.js';
import { sentence } from '../library/note-labels.js';
import { Button } from '../ui/Button.js';
import { Fine } from '../ui/Text.js';

/**
 * ***A session somebody else exported*** —
 * [19 §3](../../../../docs/design/19-session-import.md),
 * [26 B12](../../../../docs/design/26-open-questions.md),
 * [10 §12.3](../../../../docs/design/10-ui-surfaces.md),
 * [P11 §3](../../../../docs/design/workplan/28-p11-implementation.md)'s row 10.
 *
 * ***The other end of the anchor on the session panel.*** *Export this session*
 * has been a download since [P11.10] and there was nothing anywhere that could
 * read one back — which made row 10's *"loads on another one"* a sentence about
 * a capability rather than about this build.
 *
 * **On the sessions page rather than in the library's import panel**, and the
 * line is what the thing *is*: [10 §5]'s import is for **library objects**, it
 * reports a per-object disposition, and it merges into a shelf. A session is not
 * a library object, it does not merge, and what it produces is a session — so it
 * belongs where sessions are made.
 *
 * *A file input rather than a drop zone*, which is the smaller thing that works
 * everywhere including a phone, and which the library's own panel can be read
 * as the argument for when a second consumer wants one.
 *
 * ***And a chat from SillyTavern or Marinara*** —
 * [P14.8](../../../../docs/design/workplan/31-p14-scene-and-session-import.md)'s
 * *"one file"* door. A `.jsonl` is somebody else's chat rather than our own
 * export, so it does not go where an export goes: it is uploaded to the
 * library's import, which reads it, finds its characters in this account's
 * library and builds the session ([P14 §2.1]), and answers with the new
 * session's id. **Told apart by the name's extension, here and only here** —
 * the server decides what the bytes are by their content either way; this
 * only picks which of two doors to knock on, and a `.jsonl` sent to the
 * export's door would be refused as not JSON.
 *
 * ***The hint says once what an import and an update are*** — [P14.8]'s
 * *"the surface says once what an update from source does and does not do"*,
 * [P14 §2.7]. It shipped at P14.8 as an interim sentence (*updating comes
 * later*), because there was no update to describe; [P14.10a] made sync, and
 * this is the §2.7 sentence: loading a chat again brings its session up to
 * date — new messages, edits and branches added beside what is here, nothing
 * deleted or rewritten, the person's place kept if they played on, nothing
 * written back — and a chat imported with its folder is updated through its
 * folder, because it was keyed by its place there and not by a bare file name.
 * Play's session menu says the same beside *Update from source*.
 *
 * ***What the chat import could not do is said here, before the session
 * opens*** — a character not in the library, a persona or lorebook not found,
 * a line that would not read. The door answers with one review row and keeps
 * no record of it elsewhere, so a row's warnings shown nowhere are warnings
 * nobody is ever told; a chat that came back clean opens straight away.
 */

const WORDS = labels('sessions.import', {
  open: 'Load a session or a chat',
  reading: 'Reading…',
  hint: 'A `.json` a StoryEngine install exported, or a `.jsonl` chat from SillyTavern or Marinara. Either arrives as a new session, with every branch. Loading a chat again updates its session: new messages, edits and branches are added beside what is there, nothing in it is deleted or rewritten, and if you played on, your place is kept. Nothing is written back to the source. A chat imported with its folder is updated by importing the folder again.',
  unreadable: 'That file is not a session export this build can read.',
  wrongSchema: 'That is a StoryEngine file of another kind.',
  noTurns: 'That export has no turns in it.',
  brokenTree:
    'That export’s turns do not make a story: one names a turn before it that is not in the file.',
  alreadyHere:
    'That session is already here. A copy of it would share its turns, so it is not loaded twice.',
  chatUnreadable: 'That file is not a chat this build can read.',
  chatAlreadyHere:
    'That chat is already here as a session, and nothing in it has changed since it was imported, so there was nothing to add.',
  chatNotLoaded: 'That chat could not be loaded as a session:',
  importedWithNotes: 'The chat is a session now. The import could not do all of it:',
  openImported: 'Open the session',
  failed: 'The session could not be loaded.',
});

type Note = ImportItem['notes'][number];

/**
 * ***Which door a picked file goes through*** — a chat by its `.jsonl`, and
 * everything else as an export, which is what this control loaded before chats
 * could come in by it.
 */
function isChat(file: File): boolean {
  return /\.jsonl$/i.test(file.name);
}

/**
 * A chat upload's one row, as the session it made or the refusal it is.
 *
 * *Thrown as a class, like the export's refusals*, so the one handler below
 * turns every failure into a sentence by the same read.
 *
 * ***Read by the chat pass's own notes, not by the disposition alone.*** The
 * library's import answers `converted` with an `objectId` for anything it
 * wrote, and an id that is not a session's opens a page for nothing. So a
 * session is a row that says `import.chat.imported`, or — a chat loaded again
 * after it grew — `import.chat.extended`, which names the session it brought up
 * to date ([P14.10a]); *already here* is one that says
 * `import.chat.alreadyHere`. Anything else made no session, and its warnings
 * are the only account of why.
 */
function sessionOf(result: ImportFileResult): { sessionId: string; notes: Note[] } {
  const { item } = result;
  const said = (key: string): boolean => item.notes.some((note) => note.key === key);
  const warnings = item.notes.filter((note) => note.level === 'warn');
  if (
    item.disposition === 'converted' &&
    item.objectId !== undefined &&
    (said('import.chat.imported') || said('import.chat.extended'))
  ) {
    return { sessionId: item.objectId, notes: warnings };
  }
  if (item.disposition === 'unchanged' && said('import.chat.alreadyHere')) {
    throw new ChatRefused('chat-already-here', []);
  }
  throw new ChatRefused('chat', warnings);
}

class ChatRefused extends Error {
  readonly code: 'chat' | 'chat-already-here';
  readonly notes: Note[];
  constructor(code: 'chat' | 'chat-already-here', notes: Note[]) {
    super(code);
    this.name = 'ChatRefused';
    this.code = code;
    this.notes = notes;
  }
}

export function ImportSession(): JSX.Element {
  const picker = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; notes: Note[] } | null>(null);
  /** A chat that became a session with something to say first. */
  const [imported, setImported] = useState<{ sessionId: string; notes: Note[] } | null>(null);
  const navigate = useNavigate();
  const client = useQueryClient();

  return (
    <div className="flex flex-col gap-1">
      <input
        ref={picker}
        type="file"
        accept="application/json,.json,.jsonl"
        /**
         * ***Hidden from everyone, not just from sight.*** This was `sr-only`,
         * which hides a thing visually and leaves it in the accessibility tree
         * — so the page offered two controls for one act, the button below and
         * a bare *Choose File* with no label, and only the second of them told
         * you nothing about what it loads. Found by the Playwright tier's own
         * page snapshot, which is the sort of thing only a whole-page reading
         * catches.
         *
         * `aria-hidden` with `tabIndex={-1}`, together: hiding a focusable
         * element from the tree while leaving it in the tab order is the worse
         * bug, a stop on the keyboard path that announces nothing at all.
         */
        aria-hidden="true"
        tabIndex={-1}
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          // The input keeps its value, so choosing the same file twice would
          // otherwise fire nothing the second time — which reads as a broken
          // control rather than as a browser rule.
          event.target.value = '';
          if (file === undefined) return;

          setBusy(true);
          setError(null);
          setImported(null);
          const loaded: Promise<{ sessionId: string; notes?: Note[] }> = isChat(file)
            ? importChatFile(file).then(sessionOf)
            : file.text().then((text) => importSessionDocument(JSON.parse(text) as unknown));
          void loaded.then(
            (result) => {
              setBusy(false);
              // Now, whether or not the session opens now: it exists either way.
              void client.invalidateQueries({ queryKey: ['sessions'] });
              if (result.notes !== undefined && result.notes.length > 0) {
                setImported({ sessionId: result.sessionId, notes: result.notes });
                return;
              }
              void navigate({
                to: '/play/$sessionId',
                params: { sessionId: result.sessionId },
              });
            },
            (failure: unknown) => {
              setBusy(false);
              /**
               * **A class into a sentence, here** — [22 §1.4]. The server
               * sends `unreadable`, `wrong-schema`, `no-turns`,
               * `broken-tree` or `already-here`, and each has its own
               * remedy: a broken file, the wrong file, a file that is right
               * and empty, a file whose turns name a parent it does not hold
               * (a hand edit, or a producer's defect — [P13.10]), and a
               * session this install already holds.
               *
               * ***Read from `ApiError.code`*** (2026-09-27). This read
               * `failure.body.error`, which `ApiError` has never had, so every
               * refusal showed the fallback and none of these sentences had
               * ever rendered.
               *
               * *And a file that is not JSON is `unreadable` too*, though no
               * server said so: it fails in `JSON.parse` above, before any
               * request is made — the commonest way to pick the wrong file,
               * and the one the class read alone still sent to the fallback.
               *
               * ***A chat's refusal is a row, not a status*** ([P14.8]):
               * the library's import answers `200` with the file's
               * disposition, so `sessionOf` turns a row that made no
               * session into a `ChatRefused`, and it is read here with the
               * rest.
               */
              const code =
                failure instanceof SyntaxError
                  ? 'unreadable'
                  : failure instanceof ChatRefused
                    ? failure.code
                    : errorCode(failure);
              /**
               * *A chat refused with warnings says them*, under a line that
               * does not claim the file is not a chat — a session the store
               * would not write, or a file the parser refused by name, is a
               * chat with a reason, and the reason is in its notes.
               */
              const notes = failure instanceof ChatRefused ? failure.notes : [];
              setError({
                message:
                  code === 'wrong-schema'
                    ? WORDS.wrongSchema
                    : code === 'no-turns'
                      ? WORDS.noTurns
                      : code === 'broken-tree'
                        ? WORDS.brokenTree
                        : code === 'unreadable'
                          ? WORDS.unreadable
                          : code === 'already-here'
                            ? WORDS.alreadyHere
                            : code === 'chat'
                              ? notes.length > 0
                                ? WORDS.chatNotLoaded
                                : WORDS.chatUnreadable
                              : code === 'chat-already-here'
                                ? WORDS.chatAlreadyHere
                                : WORDS.failed,
                notes,
              });
            },
          );
        }}
      />
      <Button
        type="button"
        disabled={busy}
        onClick={() => {
          picker.current?.click();
        }}
      >
        {busy ? WORDS.reading : WORDS.open}
      </Button>
      {imported !== null ? (
        <div role="status" className="flex flex-col gap-1">
          <p className="text-sm text-ink">{WORDS.importedWithNotes}</p>
          <Sentences notes={imported.notes} />
          <div>
            <Button
              type="button"
              size="compact"
              onClick={() => {
                void navigate({
                  to: '/play/$sessionId',
                  params: { sessionId: imported.sessionId },
                });
              }}
            >
              {WORDS.openImported}
            </Button>
          </div>
        </div>
      ) : error === null ? (
        <Fine>{WORDS.hint}</Fine>
      ) : (
        <div role="alert" className="flex flex-col gap-1">
          <p className="text-sm text-danger-ink">{error.message}</p>
          <Sentences notes={error.notes} />
        </div>
      )}
    </div>
  );
}

/** A row's notes as the review words them, or nothing when there are none. */
function Sentences(props: { notes: Note[] }): JSX.Element | null {
  if (props.notes.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1 text-sm text-ink-muted">
      {props.notes.map((note, index) => (
        <li key={`${note.key}:${String(index)}`}>{sentence(note)}</li>
      ))}
    </ul>
  );
}
