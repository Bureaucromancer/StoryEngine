// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { Link } from '@tanstack/react-router';
import type { JSX } from 'react';

import type { AssembledBlock } from '@storyengine/shared';

import { formatCount } from '../../format.js';
import { Badge } from '../../ui/Badge.js';
import { link, table } from '../../ui/classes.js';
import { blockSourceAddress } from '../address.js';

/**
 * The block list, in order — [10 §3]'s primary view: source, plain-language
 * reason, tokens, and included-or-dropped with the responsible rule. A table
 * rather than thirty disclosures, per [10 §1.1]'s density check, and the
 * first consumer of `ui/classes.ts`'s table recipes.
 *
 * The ruling column reads from the verdict's decisions (`droppedBy` exists
 * only on drops; the verdict names the rule for keeps too — *"a verdict
 * listing only drops cannot answer what falls out next"*). `reason` is the
 * collector's free English, rendered as-is — turning it into a key and
 * params is recorded P11 sweep debt, pointed at rather than ratified here.
 *
 * A source that names an object with a page links to it, **navigating the
 * main view** — the planning decision over [P3 §7.1], which stays open.
 */
export function BlockTable({
  blocks,
  rules,
  locale,
  sessionId,
}: {
  blocks: AssembledBlock[];
  /** blockId → the verdict's rule, from `budget.decisions`. */
  rules: ReadonlyMap<string, string>;
  locale: string | undefined;
  /**
   * Whose pack these blocks came from, when there is one — [P7B.4].
   *
   * Absent over a preview subject and over the import and library subjects,
   * which have blocks and no session. The column below is absent with it: a
   * control that cannot work is worse than no control ([10 §11.1a] makes the
   * same call about Save).
   */
  sessionId?: string;
}): JSX.Element {
  return (
    <div className="overflow-x-auto">
      <table className={table.root}>
        <thead>
          <tr className={table.head}>
            <th scope="col" className={table.thCompact}>
              Block
            </th>
            <th scope="col" className={table.thCompact}>
              Source
            </th>
            <th scope="col" className={table.thCompact}>
              Reason
            </th>
            <th scope="col" className={table.thNumeric}>
              Tokens
            </th>
            <th scope="col" className={table.thCompact}>
              Ruling
            </th>
            {sessionId === undefined ? null : (
              <th scope="col" className={table.thCompact}>
                <span className="sr-only">Edit</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {blocks.map((block) => (
            <BlockRow
              key={block.id}
              block={block}
              rule={rules.get(block.id) ?? block.droppedBy}
              locale={locale}
              {...(sessionId === undefined ? {} : { sessionId })}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BlockRow({
  block,
  rule,
  locale,
  sessionId,
}: {
  block: AssembledBlock;
  rule: string | undefined;
  locale: string | undefined;
  sessionId?: string;
}): JSX.Element {
  const address = blockSourceAddress(block.source);
  return (
    // A dropped block stays a row — the drop is the information — and fades
    // rather than disappears.
    <tr className={block.included ? table.row : `${table.row} text-ink-faint`}>
      <td className={table.cellCompact}>
        <code className="text-xs">{block.id}</code>
      </td>
      <td className={table.cellCompact}>
        <span className="flex items-center gap-1">
          {address.link === undefined ? (
            <span>{address.label}</span>
          ) : (
            <Link
              to="/library/$kind/$id"
              params={{ kind: address.link.kind, id: address.link.id }}
              search={{}}
              className={link.inline}
            >
              {address.label}
            </Link>
          )}
          {block.advisory === true ? <Badge tone="provenance">Advisory</Badge> : null}
        </span>
      </td>
      <td className={table.cellCompact}>{block.reason}</td>
      <td className={table.cellNumeric}>{formatCount(block.tokens, locale)}</td>
      <td className={table.cellCompact}>{rule}</td>
      {sessionId === undefined ? null : (
        <td className={table.cellCompact}>
          {/*
           * ***Edit a block and re-run*** — [10 §3]'s sentence, answered at
           * [P7B.4] after [P3 §1.8] sent it to P6 and
           * [P6 §1.8](../../../../../docs/design/workplan/18-p6-implementation.md)
           * answered a different question.
           *
           * **Through the pack, not through the record** ([P7B §1.6]). The two
           * shapes were a one-off override recorded on the turn — honest, and a
           * record change [P7B §0.4] refuses this phase — or an edit to the
           * session's own copy followed by an ordinary reroll. The second wins
           * because it is what somebody reaching for the workbench to fix a
           * prompt actually wants: the sentence that was wrong stays wrong on
           * the next turn otherwise.
           *
           * *What it gives up, stated:* the edit is durable rather than
           * one-off, so *just this once* means editing back. The first shape is
           * refused until a finding asks for it by name.
           *
           * **Only a preset's own blocks**, because only those have anything to
           * edit — a slot positions what the engine supplies and its text is
           * not in the pack at all.
           */}
          {block.source.kind === 'preset' ? (
            <Link
              to="/play/$sessionId"
              params={{ sessionId }}
              search={{ block: block.id }}
              className={link.inline}
            >
              Edit in the pack
            </Link>
          ) : null}
        </td>
      )}
    </tr>
  );
}
