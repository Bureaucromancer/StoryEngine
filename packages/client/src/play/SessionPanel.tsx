// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { Link, useNavigate } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type JSX } from 'react';

import {
  ApiError,
  cookieValue,
  CSRF_COOKIE,
  CSRF_HEADER,
  errorCode,
  importChatFile,
  type ImportItem,
} from '../api.js';
import { sentence } from '../library/note-labels.js';
import {
  useDeleteSession,
  useLibrary,
  useSession,
  useSetSessionArchived,
  useSetSessionPreset,
} from '../queries.js';
import { disclosure, link } from '../ui/classes.js';
import { Alert } from '../ui/Alert.js';
import { Button } from '../ui/Button.js';
import { NumberField, SelectField } from '../ui/Field.js';
import { Field } from '../ui/Field.js';
import { Fine, Note } from '../ui/Text.js';
import { MemorySection } from './MemoryPanel.js';
import { RenditionSection } from './Rendition.js';

/**
 * What this session is prompted with, and the two verbs it has never had —
 * [P7B.2].
 *
 * ***Three absences, and any one of them alone kept the sentence
 * unchangeable*** ([P7B §0.2]): no editor, no object for an editor to open, and
 * no session-level path around either. P7B.0 made the object, P7B.1 made the
 * editor, and this is the path — the pack a *running* session uses, its
 * parameters, and the housekeeping [R9](../../../../docs/design/workplan/22-walkthrough-refinements.md)
 * graded as *"a small client stage over routes that exist"* with no phase.
 *
 * **Archive is one field on a `PATCH` this client already sends.**
 * `RenameSession` beside this has called that route since P2 with `{ name }`;
 * the same handler has accepted `{ archived }` the whole time and nothing ever
 * sent it. Not a missing route — a missing *field* on a request already being
 * made, which is the sharpest instance of the shape [P7B §0.5] collects.
 *
 * ---
 *
 * ***What [P7B §1.4] asked for and this is not.*** That section wanted **one**
 * Session panel with lore, the two axes, the pack and the verbs as sections of
 * it, on the grounds that *"three disclosures in a column is the shape
 * [10 §1.1] warns against"*. It was written when there were three. P7.5, P7.6
 * and P7.8 have since added the hook, goal and dial panels, so the play page
 * carries **six** — and folding six into one is a different and larger job than
 * the one §1.4 costed, done properly or not at all. This adds the seventh and
 * says so, rather than doing the consolidation badly inside a stage that is
 * about the pack. **The debt is real and is recorded here rather than in a
 * commit message**: the column needs a pass, and it needs one more than it did
 * before this.
 */
export function SessionPanel(props: {
  sessionId: string;
  /**
   * A block to open on — the address the workbench's *Edit in the pack* link
   * carries ([P7B.4]).
   */
  block?: string;
}): JSX.Element | null {
  const session = useSession(props.sessionId);
  // The same key the library page holds, so opening this issues no request.
  const presets = useLibrary('presets');
  const setPreset = useSetSessionPreset(props.sessionId);
  const setArchived = useSetSessionArchived(props.sessionId);
  const remove = useDeleteSession(props.sessionId);
  const navigate = useNavigate();

  /**
   * Open because somebody arrived asking for a block, or because they opened it.
   *
   * **Derived rather than synced**, which is what keeps the address the thing
   * that says what the page is showing: an effect writing `open` from the
   * search param would let the two disagree the moment either changed, and the
   * panel would need a rule about which wins.
   */
  const [openedByHand, setOpenedByHand] = useState(false);
  const open = openedByHand || props.block !== undefined;
  const [confirming, setConfirming] = useState(false);

  const current = session.data?.session;
  if (current === undefined) return null;

  const pack = current.preset;
  const params = (pack?.['params'] ?? {}) as Record<string, unknown>;
  const archived = current.archivedAt !== undefined;

  /**
   * One number on the session's own copy, sent whole — the route takes the pack.
   *
   * **Blank removes the key rather than writing zero**, and it is built by
   * filtering rather than by deleting: `params` is a portable object and an
   * explicit `undefined` in it is not the same as an absent key. Blank means
   * *leave it to the provider*, which is a real state a person passes through
   * and which zero would silently replace with a refusal to write anything.
   */
  function setParam(key: string, value: number | undefined): void {
    if (pack === undefined) return;
    const next = Object.fromEntries(
      Object.entries(params).filter(([name]) => name !== key || value !== undefined),
    );
    if (value !== undefined) next[key] = value;
    setPreset.mutate({ preset: { ...pack, params: next } });
  }

  return (
    <details
      open={open}
      onToggle={(event) => {
        setOpenedByHand(event.currentTarget.open);
      }}
      className="rounded-control border border-line bg-surface px-3 py-2"
    >
      <summary className={`${disclosure.quiet} text-sm`}>
        {typeof pack?.['name'] === 'string' && pack['name'] !== ''
          ? `Prompted with ${pack['name']}`
          : 'How this session is prompted'}
      </summary>

      <div className="mt-3 flex flex-col gap-3">
        {pack === undefined ? (
          <Note>
            This session has no pack of its own and is assembled from whatever its mode ships.
          </Note>
        ) : null}

        {props.block === undefined || pack === undefined ? null : (
          <BlockEditor
            // One editor per block. The page stays mounted when only `?block=`
            // changes, so without the key the draft typed for one block stood in
            // the next one's field — labelled as the next block, with *Save*
            // live — and saving it wrote the first block's prose over the
            // second's, in the session's only copy of its pack.
            key={props.block}
            pack={pack}
            blockId={props.block}
            onSave={(next, saved) => {
              setPreset.mutate({ preset: next }, { onSuccess: saved });
            }}
          />
        )}

        <SelectField
          label="Prompt pack"
          value=""
          options={[
            ['', 'Keep the one this session has'],
            ['default', "Switch to the mode's own"],
            ...(presets.data?.objects ?? []).map(
              (one) => [one.id, `Switch to ${one.name}`] as [string, string],
            ),
          ]}
          onChange={(presetId) => {
            if (presetId === '') return;
            setPreset.mutate({ presetId });
          }}
          hint="Switching copies the pack into this session. Turns already taken keep the blocks they were built from."
        />

        {pack === undefined ? null : (
          <>
            <ParamField
              label="Temperature"
              value={typeof params['temperature'] === 'number' ? params['temperature'] : undefined}
              whole={false}
              onCommit={(next) => {
                setParam('temperature', next);
              }}
              hint="Blank leaves it to the provider."
            />
            <ParamField
              label="Maximum reply length"
              value={typeof params['maxTokens'] === 'number' ? params['maxTokens'] : undefined}
              whole
              onCommit={(next) => {
                setParam('maxTokens', next);
              }}
              hint="In tokens. Blank leaves it to the provider."
            />
          </>
        )}

        {setPreset.isError ? <Alert tone="error">{setPreset.error.message}</Alert> : null}

        <div className="flex flex-wrap items-center gap-3 border-t border-line pt-3">
          {/*
            ***The way into the reading view*** —
            [10 §12](../../../../docs/design/10-ui-surfaces.md), [P11.1].
            §12.1 wants it *"openable at any time on any session, including one
            still in progress"*, so it sits with the session's own verbs rather
            than behind a finished state — and it is a link rather than a button
            because it is a place, addressable and sendable, which is the same
            argument [P3 §7.2] makes for `/compare`.
          */}
          <Link
            to="/read/$sessionId"
            params={{ sessionId: props.sessionId }}
            search={{}}
            className={link.action}
          >
            Read it as a story
          </Link>
          {/*
            ***The other direction*** — [10 §12.3](../../../../docs/design/10-ui-surfaces.md),
            [25 B12](../../../../docs/design/25-open-questions.md), [P11.10].
            The reading view is *for a person to read* and this is *for another
            install to load*; §12.3's table exists so the two are not conflated,
            and putting them beside each other is the place that conflation
            would otherwise happen. **A plain anchor, because it is a file**: a
            `fetch` would have to rebuild the download the browser already does,
            and the route sends a `content-disposition`.
          */}
          <a href={`/api/sessions/${props.sessionId}/export`} className={link.inline} download>
            Export this session
          </a>
          <Button
            type="button"
            onClick={() => {
              setArchived.mutate(!archived);
            }}
            disabled={setArchived.isPending}
          >
            {archived ? 'Take out of the archive' : 'Archive this session'}
          </Button>

          {confirming ? (
            <>
              {/* Two steps, like every other delete here. The sentence says
                  where it goes, because *delete* reads as *gone* and this is
                  not that ([03 §10.2]). */}
              <Button
                type="button"
                variant="danger"
                disabled={remove.isPending}
                onClick={() => {
                  remove.mutate(undefined, {
                    onSuccess: () => {
                      void navigate({ to: '/play' });
                    },
                  });
                }}
              >
                Move it to trash
              </Button>
              <Button
                type="button"
                variant="quiet"
                onClick={() => {
                  setConfirming(false);
                }}
              >
                Cancel
              </Button>
            </>
          ) : (
            <Button
              type="button"
              onClick={() => {
                setConfirming(true);
              }}
            >
              Delete this session
            </Button>
          )}
        </div>

        {/* ***The sentence [03 §10.3] asks for*** — [P8 §1.7]'s third item, and
            the only new surface in it. That section's *what deletion does not
            do* is explicit: *"it does not reach into other sessions to remove
            what this one wrote. A session that promoted an actor to the library,
            or wrote a cross-session memory, leaves those behind — **and the
            delete confirmation should say so when it applies**."*

            **Not a question**, which is [P8 §1.7]'s finding: [08 §8]'s lean was
            *ask, defaulting to keep*, and the premise it rested on argues the
            other way. A delete is a move until the retention window closes, so
            asking somebody to decide the fate of forty memory entries at the
            moment they tidy up is demanding a decision about a **reversible**
            act. Retention is P11's, and so is the only moment the question is
            real. */}
        <Fine>
          Archiving hides it from the list and changes nothing else. Deleting moves the whole folder
          to trash, where it stays for the retention window. Anything this session wrote outside
          itself stays where it was put — memories it saved remain in the characters’ books, and an
          actor it promoted to the library stays in the library.
        </Fine>

        {setArchived.isError ? <Alert tone="error">{setArchived.error.message}</Alert> : null}
        {remove.isError ? <Alert tone="error">{remove.error.message}</Alert> : null}

        {/* ***Update from source*** — [P13 §2.7], [P13.10a]. Only on a session
            made from a chat, which is the only kind with a source to update
            from: the import stamped where it came from, and that is also what
            the server finds it by. */}
        {sourceOf(current) === null ? null : (
          <UpdateFromSource sessionId={props.sessionId} source={sourceOf(current) ?? ''} />
        )}

        {/* ***Memories*** — [08 §7], [P8.4]. **A section of this panel rather
            than an eighth panel in the column**, which is the one thing [P8 §0.3]
            asks of this stage beyond the feature: the debt recorded in this
            file's own docstring is that six became seven and *one Session panel,
            not three* is further from done than when it was written. A stage
            that made it eight without saying so is how a column becomes a list.
            **It makes it seven sections in one panel instead**, which is the
            direction §1.4 wanted — and the consolidation it asked for is still
            owed. */}
        <MemorySection sessionId={props.sessionId} />

        {/* ***Pictures*** — [06 §10.6], [P9.4]. The eighth section rather than
            the eighth panel, for the reason the seventh gave: the consolidation
            §1.4 asked for is still owed, and every stage that adds to the column
            instead of to this panel makes it further owed. */}
        <RenditionSection sessionId={props.sessionId} renditions={session.data?.renditions} />
      </div>
    </details>
  );
}

/**
 * ***Where a session came from, if a chat*** — `origin.originalFilename`, which
 * the import stamps with the chat family's root path ([P13 §2.7]): `chats/<folder>/<file>.jsonl`
 * from a folder, the bare file name from one upload, `…/chats.json#<id>` from a
 * Marinara store. Read off the session as the server sends it, since the
 * summary type does not name `origin`.
 */
function sourceOf(session: unknown): string | null {
  const origin = (session as { origin?: { originalFilename?: unknown } } | undefined)?.origin;
  const named = origin?.originalFilename;
  return typeof named === 'string' && named !== '' ? named : null;
}

/**
 * The file a person would pick to update from — a chat that came in as one
 * file, named as it was then. `null` for a chat that came with its folder or a
 * store, whose name here is a path inside a tree a browser cannot open again.
 */
function pickableName(source: string): string | null {
  return source.includes('/') || source.includes('#') ? null : source;
}

/**
 * `POST /api/import/sessions/:id/update` — the sweep of the recorded folder
 * ([P13.10a]). **Here rather than in `api.ts`**: this panel is its one caller,
 * and the request is the plain JSON one `api.ts`'s own helper makes, CSRF
 * header included.
 */
async function updateFromSource(sessionId: string): Promise<{ item: ImportItem | null }> {
  const headers: Record<string, string> = {};
  const token = cookieValue(document.cookie, CSRF_COOKIE);
  if (token !== null) headers[CSRF_HEADER] = token;
  const response = await fetch(`/api/import/sessions/${encodeURIComponent(sessionId)}/update`, {
    method: 'POST',
    headers,
  });
  const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok) {
    const code = typeof payload?.['error'] === 'string' ? payload['error'] : 'unknown';
    const message =
      typeof payload?.['message'] === 'string'
        ? payload['message']
        : `The server answered with status ${String(response.status)}.`;
    throw new ApiError(response.status, code, message);
  }
  return { item: (payload?.['item'] ?? null) as ImportItem | null };
}

type Updating =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'pick' }
  | { kind: 'folder' }
  | { kind: 'done'; item: ImportItem }
  | { kind: 'failed'; message: string; notes: ImportItem['notes'] };

/**
 * ***Update from source*** — [P13 §2.7], [P13.10a]: the session menu's way to
 * bring a chat imported from SillyTavern or Marinara up to date.
 *
 * **Two doors, as §2.7 names them.** A chat that came from a folder the server
 * swept is swept again, server-side, from the path the ledger recorded. One
 * that came as a file cannot be re-read — *a browser cannot reopen a path* —
 * so the server says so and the panel offers the file picker, for the same
 * file under the same name: the name is the chat's identity ([P13 §2.4]), and a
 * file picked under another would arrive as another chat. A chat that came in a
 * folder through the browser has neither, and is told to import the folder
 * again, which updates every chat in it.
 *
 * ***What an update does and does not do is said before it is asked for***,
 * which is what §2.7 requires of the surface — and each row the update answers
 * with says what it did this time.
 */
function UpdateFromSource(props: { sessionId: string; source: string }): JSX.Element {
  const [state, setState] = useState<Updating>({ kind: 'idle' });
  const picker = useRef<HTMLInputElement | null>(null);
  const client = useQueryClient();
  const pickable = pickableName(props.source);

  const settle = (item: ImportItem | null): void => {
    // Anything keyed on this session may have moved: its head, its tree, its refs.
    void client.invalidateQueries({
      predicate: (query) => query.queryKey.includes(props.sessionId),
    });
    void client.invalidateQueries({ queryKey: ['sessions'] });
    if (item === null) {
      setState({
        kind: 'failed',
        message: 'The source was read, but this chat was not in it.',
        notes: [],
      });
    } else if (item.disposition === 'converted' || item.disposition === 'unchanged') {
      setState({ kind: 'done', item });
    } else {
      setState({
        kind: 'failed',
        message: 'The chat could not be read from its source:',
        notes: item.notes.filter((note) => note.level === 'warn'),
      });
    }
  };

  return (
    <section
      aria-label="Update from source"
      className="flex flex-col gap-2 border-t border-line pt-3"
    >
      <input
        ref={picker}
        type="file"
        accept=".jsonl"
        aria-hidden="true"
        tabIndex={-1}
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file === undefined) return;
          if (file.name !== pickable) {
            setState({
              kind: 'failed',
              message: `That is not “${pickable ?? ''}”. An update reads the same chat again, under the same name; a file with another name would arrive as another chat.`,
              notes: [],
            });
            return;
          }
          setState({ kind: 'busy' });
          void importChatFile(file).then(
            (result) => {
              settle(result.item);
            },
            (failure: unknown) => {
              setState({
                kind: 'failed',
                message: failure instanceof Error ? failure.message : 'The update failed.',
                notes: [],
              });
            },
          );
        }}
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          disabled={state.kind === 'busy'}
          onClick={() => {
            setState({ kind: 'busy' });
            void updateFromSource(props.sessionId).then(
              (result) => {
                settle(result.item);
              },
              (failure: unknown) => {
                if (errorCode(failure) === 'no-recorded-source') {
                  setState({ kind: pickable === null ? 'folder' : 'pick' });
                  return;
                }
                setState({
                  kind: 'failed',
                  message: failure instanceof Error ? failure.message : 'The update failed.',
                  notes: [],
                });
              },
            );
          }}
        >
          {state.kind === 'busy' ? 'Updating…' : 'Update from source'}
        </Button>
        {state.kind === 'pick' ? (
          <Button
            type="button"
            size="compact"
            onClick={() => {
              picker.current?.click();
            }}
          >
            {`Choose ${pickable ?? ''}`}
          </Button>
        ) : null}
      </div>
      {state.kind === 'pick' ? (
        <Note>
          {`This chat came in as one file, which the server cannot read again. Choose “${pickable ?? ''}” once more, as it is now.`}
        </Note>
      ) : state.kind === 'folder' ? (
        <Note>
          This chat came in with its folder. Import that folder again from the library’s import
          panel: it brings every chat in it up to date, this one included.
        </Note>
      ) : state.kind === 'done' ? (
        <div role="status" className="flex flex-col gap-1 text-sm text-ink">
          {state.item.disposition === 'unchanged' ? (
            <p>Nothing new: the session already holds everything its source has.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {state.item.notes.map((note, index) => (
                <li key={`${note.key}:${String(index)}`}>{sentence(note)}</li>
              ))}
            </ul>
          )}
        </div>
      ) : state.kind === 'failed' ? (
        <div role="alert" className="flex flex-col gap-1 text-sm">
          <p className="text-danger-ink">{state.message}</p>
          {state.notes.map((note, index) => (
            <p key={`${note.key}:${String(index)}`} className="text-ink-muted">
              {sentence(note)}
            </p>
          ))}
        </div>
      ) : null}
      <Fine>
        {`Reads the chat from ${props.source} again and adds what is new there: new messages, edits and branches, each beside what is already here. Nothing in this session is deleted or rewritten — a message deleted in the source stays here — and if you have played on here, your place is kept and the new messages wait on the source’s branches. Nothing is written back to the source.`}
      </Fine>
    </section>
  );
}

/**
 * One block of the session's own pack — [P7B.4].
 *
 * **The session's copy, not the library's.** Editing here changes what the
 * *next* turn assembles from and touches no library object; the turns already
 * taken keep the blocks the record holds, which is what makes a reroll the
 * comparison [10 §3] wants ([P7B §1.1]).
 *
 * **Text blocks only.** A slot positions what the engine supplies and has no
 * prose of its own to edit — the workbench's link is already withheld for one,
 * and this says so for anybody who reaches the address another way.
 */
/**
 * ***A sampler setting, written when the person is done with it*** (2026-09-27).
 *
 * These wrote the whole pack on every keystroke, from a value the session query
 * fed back: `0.75` went out as `0`, then as `0.` — which is not a number — and
 * `512` as `5` and `51`, and a refetch arriving between two keystrokes reset
 * the box under the typing, so what landed could be neither what was typed nor
 * anything asked for. The walk sheet's own test typed one character on purpose
 * because two did not work.
 *
 * So the text is this control's while it is being typed, and one write goes out
 * on leaving the box or on Enter: blank clears the setting, a number that fits
 * is sent, and one that does not is said beside the box rather than sent. The
 * text is re-seeded when the setting changes from elsewhere — another tab, a
 * pack switch — for `NumberRow`'s reason in the lorebook editor.
 */
function ParamField(props: {
  label: string;
  value: number | undefined;
  /** A whole number of one or more, as `maxTokens` must be; otherwise any number. */
  whole: boolean;
  onCommit: (value: number | undefined) => void;
  hint: string;
}): JSX.Element {
  const shown = props.value === undefined ? '' : String(props.value);
  const [held, setHeld] = useState({ text: shown, from: shown });
  const [problem, setProblem] = useState<string | null>(null);
  if (shown !== held.from) setHeld({ text: shown, from: shown });

  function commit(): void {
    const text = held.text.trim();
    if (text === '') {
      setProblem(null);
      if (props.value !== undefined) props.onCommit(undefined);
      return;
    }
    const parsed = Number(text);
    const fits =
      Number.isFinite(parsed) && (!props.whole || (Number.isInteger(parsed) && parsed >= 1));
    if (!fits) {
      setProblem(props.whole ? 'A whole number of tokens, 1 or more.' : 'A number, or blank.');
      return;
    }
    setProblem(null);
    if (parsed !== props.value) props.onCommit(parsed);
  }

  return (
    <NumberField
      label={props.label}
      value={held.text}
      onChange={(text) => {
        setHeld((was) => ({ ...was, text }));
      }}
      onCommit={commit}
      error={problem}
      hint={props.hint}
      {...(props.whole ? { min: 1 } : {})}
    />
  );
}

function BlockEditor(props: {
  pack: Record<string, unknown>;
  blockId: string;
  /** The pack with this block changed, and what to do once it is written. */
  onSave: (next: Record<string, unknown>, saved: () => void) => void;
}): JSX.Element {
  const blocks = Array.isArray(props.pack['blocks'])
    ? (props.pack['blocks'] as Record<string, unknown>[])
    : [];
  const block = blocks.find((one) => one['id'] === props.blockId);
  const template = typeof block?.['template'] === 'string' ? block['template'] : null;
  const [draft, setDraft] = useState<string | null>(null);

  if (block === undefined) {
    return <Note>{`This pack has no block called ${props.blockId}.`}</Note>;
  }
  if (template === null) {
    return (
      <Note>
        That block positions something the engine supplies. There is no text in the pack to edit.
      </Note>
    );
  }

  const value = draft ?? template;
  return (
    <div className="rounded-control border border-line p-3">
      <Field
        label={`Block: ${props.blockId}`}
        value={value}
        onChange={setDraft}
        multiline
        rows={5}
        hint="Changes the next turn, not the ones already taken. Reroll to see the difference."
      />
      <div className="mt-2 flex gap-2">
        <Button
          type="button"
          variant="primary"
          disabled={value === template}
          onClick={() => {
            // The draft is let go once the pack holding it is written, not when
            // the write is asked for: a save that fails is shown above, and the
            // text somebody wrote has to still be here to try again with.
            props.onSave(
              {
                ...props.pack,
                blocks: blocks.map((one) =>
                  one['id'] === props.blockId ? { ...one, template: value } : one,
                ),
              },
              () => {
                setDraft(null);
              },
            );
          }}
        >
          Save this block
        </Button>
      </div>
    </div>
  );
}
