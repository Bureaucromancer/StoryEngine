// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { useRef, useState, type JSX } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';

import { ApiError, importSessionDocument } from '../api.js';
import { labels } from '../i18n/catalogue.js';
import { Button } from '../ui/Button.js';
import { Fine } from '../ui/Text.js';

/**
 * ***A session somebody else exported*** —
 * [18 §3](../../../../docs/design/18-session-import.md),
 * [25 B12](../../../../docs/design/25-open-questions.md),
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
 */

const WORDS = labels('sessions.import', {
  open: 'Load an exported session',
  reading: 'Reading…',
  hint: 'A `.json` a StoryEngine install exported. It arrives as a new session, with every branch.',
  unreadable: 'That file is not a session export this build can read.',
  wrongSchema: 'That is a StoryEngine file of another kind.',
  noTurns: 'That export has no turns in it.',
  alreadyHere:
    'That session is already here. A copy of it would share its turns, so it is not loaded twice.',
  failed: 'The session could not be loaded.',
});

export function ImportSession(): JSX.Element {
  const picker = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const client = useQueryClient();

  return (
    <div className="flex flex-col gap-1">
      <input
        ref={picker}
        type="file"
        accept="application/json,.json"
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
          void file
            .text()
            .then((text) => importSessionDocument(JSON.parse(text) as unknown))
            .then(
              (result) => {
                setBusy(false);
                void client.invalidateQueries({ queryKey: ['sessions'] });
                void navigate({
                  to: '/play/$sessionId',
                  params: { sessionId: result.sessionId },
                });
              },
              (failure: unknown) => {
                setBusy(false);
                /**
                 * **A class into a sentence, here** — [21 §1.4]. The server
                 * sends `unreadable`, `wrong-schema`, `no-turns` or
                 * `already-here`, and each has its own remedy: a broken file,
                 * the wrong file, a file that is right and empty, and a
                 * session this install already holds.
                 *
                 * ***Read from `ApiError.code`*** (2026-09-27). This read
                 * `failure.body.error`, which `ApiError` has never had, so every
                 * refusal showed the fallback and none of these sentences had
                 * ever rendered.
                 */
                const code = failure instanceof ApiError ? failure.code : undefined;
                setError(
                  code === 'wrong-schema'
                    ? WORDS.wrongSchema
                    : code === 'no-turns'
                      ? WORDS.noTurns
                      : code === 'unreadable'
                        ? WORDS.unreadable
                        : code === 'already-here'
                          ? WORDS.alreadyHere
                          : WORDS.failed,
                );
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
      {error === null ? (
        <Fine>{WORDS.hint}</Fine>
      ) : (
        <p role="alert" className="text-sm text-danger-ink">
          {error}
        </p>
      )}
    </div>
  );
}
