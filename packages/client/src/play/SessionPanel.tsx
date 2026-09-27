// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { Link, useNavigate } from '@tanstack/react-router';
import { useState, type JSX } from 'react';

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
