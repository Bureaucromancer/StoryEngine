// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { JSX } from 'react';

import type { TurnPreview, UnmeasurableReason } from '../../api.js';
import { MetadataRow } from '../../ui/MetadataRow.js';
import { Fine, Note } from '../../ui/Text.js';
import { BlockTable } from './BlockTable.js';
import { BudgetVerdictView } from './BudgetVerdictView.js';
import { LoreReportView } from './LoreReportView.js';
import { NotFilledList } from './NotFilledList.js';
import { rulesOf } from './rules.js';

/**
 * The turn about to be taken — [P3.4], the other half of the meter.
 *
 * *"Clicking it opens the panel in place, already on the current turn"*
 * ([05 §3]), and the current turn is the one being composed: a panel that
 * opened on the last *committed* turn would contradict the meter that opened
 * it, which is the staleness [P3 §1.6] says the meter exists to end.
 *
 * **Not `CallView`.** That view needs `usage`, `wallMs` and the rendered
 * messages, and widening it to tolerate their absence would blur *this call
 * has not happened* with *this call reported nothing* — the absent-versus-empty
 * distinction the whole record is built on. What is shared instead is the
 * three views that take assembly data directly, unchanged: the block table,
 * the verdict, and the not-filled list. That they need no modification at all
 * is the clearest evidence the panel is a reader rather than a second
 * assembler.
 *
 * **Nothing here is recomputed.** [P3 §5]: *the panel never recomputes what a
 * dry run would produce — it asks the server.* Every number below arrives from
 * the same answer the meter is showing.
 */

const UNMEASURABLE: Record<UnmeasurableReason, string> = {
  'role-unbound':
    'Nothing is bound to the prose role, so there is no context window to measure against.',
  'role-dangling':
    'The prose role points at a connection that is gone, so there is no context window to measure against.',
  'no-prose-step': 'This mode narrates nothing, so there is no prompt to assemble.',
};

export function PreviewSubject({
  preview,
  locale,
}: {
  preview: TurnPreview;
  locale: string | undefined;
}): JSX.Element {
  if (preview.state === 'unmeasurable') {
    return (
      <div className="flex flex-col gap-4">
        <Note>{UNMEASURABLE[preview.reason]}</Note>
        {/* The half that is still answerable without a model ([P3.0] §7.5) —
            and an unconfigured install is where somebody is most likely to be
            asking why a slot is empty. Deliberately *not* accompanied by an
            un-budgeted block list: a table of blocks nothing has ruled on
            would be a second assembly shape for a state that already has an
            honest answer. */}
        <NotFilledList notFilled={preview.notFilled} />
        {/* The scan ran before the role was resolved, so its answer survives
            the failure that made the numbers unmeasurable 2014 and an
            unconfigured install is exactly where somebody is asking why their
            world is not appearing. */}
        <LoreReportView lore={preview.lore} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Note>What would be sent if this turn were taken now — nothing has been sent.</Note>

      <BlockTable blocks={preview.blocks} rules={rulesOf(preview.budget)} locale={locale} />
      <BudgetVerdictView verdict={preview.budget} locale={locale} />
      <NotFilledList notFilled={preview.notFilled} />
      {/*
       * **The keyword test, generalised** — [P5.8], [05 §3]. Below the block
       * table on purpose: what *fired* is up there with the key that did it,
       * and this is the half nothing could show. Reading downward is therefore
       * *what is in the prompt*, then *what is not and why*, which is the order
       * somebody arrives at the question in.
       */}
      <LoreReportView lore={preview.lore} />

      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
        <MetadataRow label="Step">
          <code className="text-xs">{preview.stepId}</code>
        </MetadataRow>
        <MetadataRow label="Model">
          <code className="break-all text-xs">{preview.resolved.modelId}</code>
        </MetadataRow>
      </dl>

      {/* The estimate's caveat, in the place depth was asked for — the meter
          carries the word *estimated* and this carries the sentence. */}
      <Fine>
        Token counts are estimated from the text; the figure a provider reports is recorded on the
        turn once it has run.
      </Fine>
    </div>
  );
}
