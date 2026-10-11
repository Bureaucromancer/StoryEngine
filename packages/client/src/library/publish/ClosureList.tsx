// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { useEffect, useRef, type JSX } from 'react';

import {
  PRESET_SCHEMA,
  type Closure,
  type ClosureNode,
  type FileSet,
  type FoundNode,
  type NodeKey,
} from '@storyengine/shared';

import { kindOfSchema } from '../../api.js';
import { megabytes } from '../../format.js';
import { Alert, AlertNote } from '../../ui/Alert.js';
import { Button } from '../../ui/Button.js';
import { disclosure, link } from '../../ui/classes.js';
import { Fine, Note } from '../../ui/Text.js';
import { kindWord } from './kind-words.js';
import {
  depthGroups,
  isOn,
  missingUnder,
  nameOf,
  orphanGroups,
  reasonsOf,
  tooLarge,
  type DepthGroup,
} from './model.js';
import { publishSentence } from './notes.js';
import { reasonFor } from './reasons.js';
import { countPhrase, WORDS } from './words.js';

/**
 * ***Every level, and every reason as text*** — [16 §5](../../../../../docs/design/16-publish.md),
 * [P16.3g](../../../../../docs/design/workplan/35-p16-world.md).
 *
 * **One column of rows, never a table** ([P16.3]'s plan; P12A.8, AA14): a
 * row's reasons are sentences, there can be several, and a table cell holding
 * three sentences at 280 px either scrolls sideways or squeezes each to a word
 * a line. So a row is a block — the checkbox, the kind and the name on one
 * line that wraps, then each fact on its own — and nothing in it has a width.
 *
 * **Nothing here is said only in a hover title.** Every reason an object is in
 * the file, *found by name*, the pictures and their size, the built-in source,
 * the required warning, the orphan's *came with*, and what stays home and why
 * are text on the row, because a title is invisible on a phone and to a person
 * who does not hover ([P16.3]'s plan).
 *
 * **Unticking never cascades** (R1). A row left ticked after what brought it
 * in was unticked says *nothing left in the file names this — it came with
 * …*, and its group offers *Leave these out too*, which unticks that group
 * and nothing else: the cascade, in one click, when it is wanted.
 *
 * ***The keyboard is not dropped with the group*** (2026-10-11, the P16.3g
 * review): the button unticks its own group, so the group — and the button,
 * which held focus — is gone in the next render, and focus would fall to
 * `<body>`. It is given to the next group's button, or, when that was the
 * last, to the first heading of the list, which is where the rows it changed
 * begin.
 */
export function ClosureList(props: {
  closure: Closure;
  set: FileSet;
  ticked: Readonly<Record<NodeKey, boolean>>;
  onTick: (key: NodeKey, on: boolean) => void;
  onLeaveOut: (keys: readonly NodeKey[]) => void;
}): JSX.Element {
  const { closure, set } = props;
  const byKey = new Map(closure.nodes.map((node) => [node.key, node]));
  const orphanOf = new Map(set.orphans.map((orphan) => [orphan.key, orphan.cameWith]));
  const requiredLeftOut = new Set(set.requiredLeftOut.map((entry) => entry.key));
  const carried = new Set([...set.objects, ...set.sessions].map((node) => node.key));
  const list = useRef<HTMLDivElement>(null);
  const refocus = useRef(false);
  useEffect(() => {
    if (!refocus.current) return;
    refocus.current = false;
    const next =
      list.current?.querySelector<HTMLElement>('[data-leave-out]') ??
      list.current?.querySelector<HTMLElement>('h2');
    next?.focus();
  });
  return (
    <div ref={list} className="mb-8 flex flex-col gap-6">
      {orphanGroups(set).map((group) => (
        <Alert key={group.cameWith ?? ''} tone="neutral">
          <p>
            {WORDS.orphanGroup.replace('{name}', () => nameOf(byKey.get(group.cameWith ?? '')))}
          </p>
          <ul className="my-2 ms-4 list-disc">
            {group.keys.map((key) => (
              <li key={key} className="break-words">
                {nameOf(byKey.get(key))}
              </li>
            ))}
          </ul>
          <Button
            type="button"
            size="compact"
            data-leave-out=""
            onClick={() => {
              refocus.current = true;
              props.onLeaveOut(group.keys);
            }}
          >
            {WORDS.leaveOut}
          </Button>
        </Alert>
      ))}

      {depthGroups(closure, set).map((group) => (
        <section key={group.depth} aria-labelledby={`publish-depth-${String(group.depth)}`}>
          {/*
            `SectionTitle`'s look, as `HistoryPanel` spells it, and focusable
            by script only: where *Leave these out too* gives the keyboard.
          */}
          <h2
            id={`publish-depth-${String(group.depth)}`}
            tabIndex={-1}
            className="mb-3 text-section text-ink"
          >
            {groupTitle(closure, group)}
          </h2>
          <ul className="flex flex-col gap-3">
            {group.rows.map((node) => (
              <Row
                key={node.key}
                closure={closure}
                node={node}
                byKey={byKey}
                on={isOn(node, props.ticked)}
                orphanCameWith={orphanOf.get(node.key) ?? null}
                requiredLeftOut={requiredLeftOut.has(node.key)}
                carried={carried.has(node.key)}
                onTick={props.onTick}
              />
            ))}
          </ul>
        </section>
      ))}

      {/*
        ***Everything the review notes, as sentences*** — `fileSet`'s own notes,
        the record the rows above draw from. Folded, because every one of them
        is already said on its row; it is here so that a note is never only a
        state of a checkbox, and so the warnings can be read as one list.
      */}
      {set.notes.length === 0 ? null : (
        <details>
          <summary className={`${disclosure.quiet} text-sm`}>{WORDS.allNotes}</summary>
          <ul className="mt-2 flex flex-col gap-1 text-sm text-ink-subtle">
            {set.notes.map((note, index) => (
              <li key={index} className="break-words">
                {publishSentence(note)}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function groupTitle(closure: Closure, group: DepthGroup): string {
  if (group.depth === 0) {
    return closure.origin === 'world'
      ? WORDS.groupWorld
      : closure.origin === 'selection'
        ? WORDS.groupSelection
        : WORDS.groupObject;
  }
  return group.depth === 1
    ? WORDS.groupOne
    : group.depth === 2
      ? WORDS.groupTwo
      : WORDS.groupFurther;
}

/** One thing the walk reached, and every sentence about it. */
function Row(props: {
  closure: Closure;
  node: ClosureNode;
  byKey: ReadonlyMap<NodeKey, ClosureNode>;
  on: boolean;
  orphanCameWith: NodeKey[] | null;
  requiredLeftOut: boolean;
  /** In the file by `fileSet`'s rule — what a missing reference under it may claim of the file. */
  carried: boolean;
  onTick: (key: NodeKey, on: boolean) => void;
}): JSX.Element {
  const { closure, node } = props;
  if (node.state === 'missing') {
    return (
      <li className="break-words">
        <AlertNote tone={node.required ? 'error' : 'neutral'}>
          {WORDS.missingRoot.replace('{name}', () => nameOf(node))}
        </AlertNote>
      </li>
    );
  }
  if (node.state === 'excluded') {
    return (
      <li className="break-words text-sm text-ink-subtle">
        {(node.reason === 'nested-world' ? WORDS.excludedNested : WORDS.excludedUnknown)
          .replace('{name}', () => node.name ?? node.id)
          .replace('{schema}', () => node.schema)}
      </li>
    );
  }
  if (node.state !== 'found') return <li />;

  const checkbox = `publish-tick-${node.key}`;
  /** Stays home whatever is ticked: play wrote it, or it is too large to be one file. */
  const staysHome = node.writtenByPlay === true || tooLarge(node);
  const tickable = node.canUncheck && !staysHome;
  return (
    <li className="flex min-w-0 flex-col gap-1 border-b border-line pb-3">
      <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
        {tickable ? (
          <input
            id={checkbox}
            type="checkbox"
            checked={props.on}
            aria-label={WORDS.include.replace('{name}', () => node.name)}
            onChange={(event) => {
              props.onTick(node.key, event.target.checked);
            }}
          />
        ) : null}
        <span className="text-xs text-ink-subtle">{kindWord(node.schema)}</span>
        <ObjectLink node={node} />
      </span>
      <ul className="flex flex-col gap-0.5 text-sm text-ink-subtle">
        {/*
          A literal space between the sentences, not a margin: a screen reader
          reads the text, and two spans with only `ms-1` between them were read
          as *lore.Marked required.* (2026-10-11, the P16.3g review).
        */}
        {reasonsOf(closure, node).map((edge, index) => (
          <li key={index} className="break-words">
            <span>{reasonFor(edge, nameOf(props.byKey.get(edge.from ?? '')))}</span>
            {edge.required ? (
              <>
                {' '}
                <span>{WORDS.required}</span>
              </>
            ) : null}
            {edge.resolvedBy === 'name' ? (
              <>
                {' '}
                <span>{WORDS.foundByName}</span>
              </>
            ) : null}
          </li>
        ))}
      </ul>
      {tooLarge(node) ? null : <Facts node={node} />}
      {/*
        *Always in the file* is the one root of an object start — unless it
        stays home whatever is ticked, when the sentence below says so instead
        and this one would contradict it (2026-10-11, the P16.3g review: a
        book play wrote, chosen on its own, drew both).
      */}
      {node.canUncheck || staysHome ? null : <Note>{WORDS.root}</Note>}
      {node.owner === 'system' ? <Note>{WORDS.builtIn}</Note> : null}
      {node.optional ? (
        <Note>{node.schema === PRESET_SCHEMA ? WORDS.presetHint : WORDS.optional}</Note>
      ) : null}
      {/*
        ***The memory book stays home, and the row says why*** — [P16.3c]
        decided an object play wrote never leaves (its entries are what a
        session said, an unticked session's included), [P16.3d] made `fileSet`
        the rule that says so, and this is the review saying it before the
        writer does: no checkbox, because no tick could send it.
      */}
      {node.writtenByPlay === true ? (
        <AlertNote tone="warning">{WORDS.writtenByPlay}</AlertNote>
      ) : null}
      {/* Too large to be one file — the writer's `too-large`, said before it ({@link tooLarge}). */}
      {node.writtenByPlay !== true && tooLarge(node) ? (
        <AlertNote tone="warning">
          {WORDS.tooLarge
            .replace('{name}', () => node.name)
            .replace('{size}', megabytes(node.facts?.omitted[0]?.bytes ?? 0))}
        </AlertNote>
      ) : null}
      {/*
        ***A required book left out*** — [16 §5]: *"Unchecking a required link
        is permitted and warned about … the one case where the review says
        plainly that the recipient will be missing the world, not a nice
        extra."* Inline, on the row, and Publish still goes.
      */}
      {props.requiredLeftOut ? <AlertNote tone="warning">{WORDS.requiredLeftOut}</AlertNote> : null}
      {props.orphanCameWith === null ? null : (
        <Note>
          {WORDS.orphan.replace('{name}', () =>
            nameOf(props.byKey.get(props.orphanCameWith?.[0] ?? '')),
          )}
        </Note>
      )}
      <MissingUnder closure={closure} nodeKey={node.key} carried={props.carried} />
    </li>
  );
}

/** The name, opening the object's own page in a new tab, so the review keeps its ticks. */
function ObjectLink(props: { node: FoundNode }): JSX.Element {
  const kind = kindOfSchema(props.node.schema);
  if (kind === null) return <span className="break-words font-medium">{props.node.name}</span>;
  return (
    <a
      href={`/library/${kind}/${encodeURIComponent(props.node.id)}`}
      target="_blank"
      rel="noreferrer"
      className={`${link.object} break-words`}
    >
      {props.node.name}
    </a>
  );
}

/** Its pictures and its size — *why is this so large*, answered on the row ([16 §5]). */
function Facts(props: { node: FoundNode }): JSX.Element | null {
  const facts = props.node.facts;
  if (facts === undefined) return null;
  const size = megabytes(facts.bytes);
  const line =
    facts.pictures.count === 0
      ? WORDS.sizeOnly.replace('{size}', size)
      : countPhrase(WORDS.picturesOne, WORDS.picturesMany, facts.pictures.count).replace(
          '{size}',
          size,
        );
  return <Fine>{line}</Fine>;
}

/**
 * The references it makes that resolve to nothing — under the row that names
 * them ([16 §4]).
 *
 * ***What the file says only when the row is in it*** (2026-10-11, the P16.3g
 * review). `fileSet` records a missing reference — and the manifest says it —
 * only from a node that is carried; under a row left out, or a session not
 * ticked, *the file says it is missing* and *whoever opens the file will be
 * missing the world* were both untrue. There the line is a plain fact about
 * the row, without the warning.
 */
export function MissingUnder(props: {
  closure: Closure;
  nodeKey: NodeKey;
  carried: boolean;
}): JSX.Element | null {
  const missing = missingUnder(props.closure, props.nodeKey);
  if (missing.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1">
      {missing.map(({ node, edge }) => (
        <li key={node.key} className="break-words">
          <AlertNote tone={props.carried && edge.required ? 'warning' : 'neutral'}>
            {(props.carried
              ? edge.required
                ? WORDS.missingUnderRequired
                : WORDS.missingUnder
              : WORDS.namesMissing
            )
              .replace('{name}', () => nameOf(node))
              .replace('{kind}', kindWord(node.expected))}
          </AlertNote>
        </li>
      ))}
    </ul>
  );
}
