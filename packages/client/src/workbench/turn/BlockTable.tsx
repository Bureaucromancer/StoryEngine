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
 * The block list, in order — [05 §3]'s primary view: source, plain-language
 * reason, tokens, and included-or-dropped with the responsible rule. A table
 * rather than thirty disclosures, per [05 §1.1]'s density check, and the
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
}: {
  blocks: AssembledBlock[];
  /** blockId → the verdict's rule, from `budget.decisions`. */
  rules: ReadonlyMap<string, string>;
  locale: string | undefined;
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
          </tr>
        </thead>
        <tbody>
          {blocks.map((block) => (
            <BlockRow
              key={block.id}
              block={block}
              rule={rules.get(block.id) ?? block.droppedBy}
              locale={locale}
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
}: {
  block: AssembledBlock;
  rule: string | undefined;
  locale: string | undefined;
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
    </tr>
  );
}
