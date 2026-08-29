// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { JSX } from 'react';

import type { AssembledBlock, BudgetVerdict } from '@storyengine/shared';

import { formatCount } from '../../format.js';
import { table } from '../../ui/classes.js';
import { Fine } from '../../ui/Text.js';
import { blockSourceAddress } from '../address.js';
import { alignBlocks, changeOf, type BlockChange } from './align.js';
import { rulesOf } from './rules.js';

/**
 * Two turns' blocks in one table, a row per block id — [P3.6].
 *
 * A table rather than two tables side by side, because the question a
 * comparison answers is *what is different*, and two independent lists make
 * the reader do the pairing the machine already did. It is the same shape
 * `BlockTable` uses — the recipes, the source addresses, the faded row for a
 * block that did not make it — with each fact given twice and a word for what
 * became of it.
 *
 * **A block on one side only reads as absent, not as zero.** The
 * absent-versus-empty doctrine is the whole of why the record is trusted, and
 * a comparison is exactly where a blank cell would otherwise be read as a
 * count of nothing.
 */

const CHANGE_LABELS: Record<BlockChange, string> = {
  same: 'Unchanged',
  ruling: 'Ruling moved',
  changed: 'Changed',
  added: 'Only after',
  removed: 'Only before',
};

export function AlignedBlockTable({
  before,
  after,
  locale,
}: {
  before: { blocks: AssembledBlock[]; budget: BudgetVerdict };
  after: { blocks: AssembledBlock[]; budget: BudgetVerdict };
  locale: string | undefined;
}): JSX.Element {
  const beforeRules = rulesOf(before.budget);
  const afterRules = rulesOf(after.budget);
  const aligned = alignBlocks(before.blocks, after.blocks);

  const rows = aligned.map((row) => ({
    row,
    beforeRule:
      row.before === undefined ? undefined : (beforeRules.get(row.id) ?? row.before.droppedBy),
    afterRule:
      row.after === undefined ? undefined : (afterRules.get(row.id) ?? row.after.droppedBy),
  }));

  /**
   * Only said when it is actually the answer. Past the history window's
   * length a block's ruling moves because its priority *is* its position, so
   * a session long enough to slide reports rulings that changed with nothing
   * behind them — and a reader who had just edited a preset would reasonably
   * read that as their doing. Rendered only when such a row exists, because a
   * standing caveat about a rare case is clutter every other time.
   */
  const drifted = rows.some(
    ({ row, beforeRule, afterRule }) =>
      changeOf(row, beforeRule, afterRule) === 'ruling' && row.before?.source.kind === 'history',
  );

  return (
    <div className="flex flex-col gap-2">
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
              <th scope="col" className={table.thNumeric}>
                Before
              </th>
              <th scope="col" className={table.thNumeric}>
                After
              </th>
              <th scope="col" className={table.thCompact}>
                Ruling before
              </th>
              <th scope="col" className={table.thCompact}>
                Ruling after
              </th>
              <th scope="col" className={table.thCompact}>
                Change
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ row, beforeRule, afterRule }) => {
              const change = changeOf(row, beforeRule, afterRule);
              const block = row.before ?? row.after;
              return (
                <tr
                  key={row.id}
                  className={change === 'same' ? `${table.row} text-ink-faint` : table.row}
                >
                  <td className={table.cellCompact}>
                    <code className="break-all text-xs">{row.id}</code>
                  </td>
                  <td className={table.cellCompact}>
                    {block === undefined ? '—' : blockSourceAddress(block.source).label}
                  </td>
                  <td className={table.cellNumeric}>
                    {row.before === undefined ? 'absent' : formatCount(row.before.tokens, locale)}
                  </td>
                  <td className={table.cellNumeric}>
                    {row.after === undefined ? 'absent' : formatCount(row.after.tokens, locale)}
                  </td>
                  <td className={table.cellCompact}>{beforeRule ?? '—'}</td>
                  <td className={table.cellCompact}>{afterRule ?? '—'}</td>
                  <td className={table.cellCompact}>{CHANGE_LABELS[change]}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {drifted ? (
        <Fine>
          A history block’s ruling carries its priority, and its priority is its position in the
          window — so once a session is longer than the window, the same block reports a moved
          ruling without anyone having changed anything.
        </Fine>
      ) : null}
    </div>
  );
}
