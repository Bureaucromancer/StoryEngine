// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { useNavigate } from '@tanstack/react-router';
import { useState, type JSX } from 'react';

import {
  useDeleteSession,
  useLibrary,
  useSession,
  useSetSessionArchived,
  useSetSessionPreset,
} from '../queries.js';
import { Alert } from '../ui/Alert.js';
import { Button } from '../ui/Button.js';
import { NumberField, SelectField } from '../ui/Field.js';
import { Fine, Note } from '../ui/Text.js';

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
export function SessionPanel(props: { sessionId: string }): JSX.Element | null {
  const session = useSession(props.sessionId);
  // The same key the library page holds, so opening this issues no request.
  const presets = useLibrary('presets');
  const setPreset = useSetSessionPreset(props.sessionId);
  const setArchived = useSetSessionArchived(props.sessionId);
  const remove = useDeleteSession(props.sessionId);
  const navigate = useNavigate();

  const [open, setOpen] = useState(false);
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
        setOpen(event.currentTarget.open);
      }}
      className="rounded-control border border-line bg-surface px-3 py-2"
    >
      <summary className="cursor-pointer text-sm text-ink-subtle">
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
            <NumberField
              label="Temperature"
              value={typeof params['temperature'] === 'number' ? String(params['temperature']) : ''}
              onChange={(next) => {
                setParam('temperature', next.trim() === '' ? undefined : Number(next));
              }}
              hint="Blank leaves it to the provider."
            />
            <NumberField
              label="Maximum reply length"
              value={typeof params['maxTokens'] === 'number' ? String(params['maxTokens']) : ''}
              onChange={(next) => {
                setParam('maxTokens', next.trim() === '' ? undefined : Number(next));
              }}
              min={1}
              hint="In tokens. Blank leaves it to the provider."
            />
          </>
        )}

        {setPreset.isError ? <Alert tone="error">{setPreset.error.message}</Alert> : null}

        <div className="flex flex-wrap items-center gap-3 border-t border-line pt-3">
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

        <Fine>
          Archiving hides it from the list and changes nothing else. Deleting moves the whole folder
          to trash, where it stays for the retention window.
        </Fine>

        {setArchived.isError ? <Alert tone="error">{setArchived.error.message}</Alert> : null}
        {remove.isError ? <Alert tone="error">{remove.error.message}</Alert> : null}
      </div>
    </details>
  );
}
