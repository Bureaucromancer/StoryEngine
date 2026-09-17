// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { Link } from '@tanstack/react-router';
import type { JSX, ReactNode } from 'react';

import type { AssembledBlock, BudgetVerdict, ModelCall, Turn } from '@storyengine/shared';

import { ApiError } from '../api.js';
import { formatCount, formatDuration, formatTimestamp } from '../format.js';
import { useAuthState, useTurn } from '../queries.js';
import { link, page, table } from '../ui/classes.js';
import { Note, PageTitle, SectionTitle, SubsectionTitle } from '../ui/Text.js';
import { AlignedBlockTable } from '../workbench/turn/AlignedBlockTable.js';
import { OUTCOME_LABELS } from '../workbench/turn/labels.js';

/**
 * Two turns of one session, side by side — [P3.6], and this phase's **one
 * addressable exception** to [10 §3](../../../../docs/design/10-ui-surfaces.md)'s
 * rule that the workbench is a panel rather than a place.
 *
 * **The address is the whole argument.** §3 escalated comparison out of the
 * panel on the grounds that a panel *"has one subject by construction"* — an
 * argument [P3 §1.5](../../../../docs/design/workplan/15-p3-implementation.md)
 * found does not carry, because [10 §11.2a] already ships a two-payload diff
 * *inside* a panel and cites §3 as its precedent. What actually forces a full
 * view is that a comparison has to be **bookmarkable, pasteable into a bug
 * report, and reopenable after the head has moved past both turns**, and a
 * panel scoped to what the main view is showing can be none of those. That
 * substitution is settled at this stage ([P3 §7.2]) and written back into §3.
 *
 * **It reads each turn by id, which is what [P3.0]'s route was for.** The
 * transcript walks the path from the head; a comparison target may be a turn
 * the head has passed or a re-run sibling off the path entirely, so the walk
 * cannot serve it. Each side is its own component so each can call `useTurn`
 * unconditionally — the hook has no disabled arm, and rules-of-hooks forbids
 * guarding it inline.
 */

export interface ComparePair {
  before?: string;
  after?: string;
}

export function ComparePage({
  sessionId,
  pair,
}: {
  sessionId: string;
  pair: ComparePair;
}): JSX.Element {
  const auth = useAuthState();
  const locale = auth.data?.account?.locale ?? undefined;

  return (
    <div className={`${page.tooling} flex flex-col gap-6`}>
      <div className="flex flex-col gap-1">
        <PageTitle>Compare two turns</PageTitle>
        <p>
          <Link to="/play/$sessionId" params={{ sessionId }} className={link.back}>
            Back to the session
          </Link>
        </p>
      </div>

      {/* An address naming no pair is a real address somebody can arrive at —
          a truncated paste, a link written by hand — and it should say what it
          is missing rather than render an empty comparison. */}
      {pair.before === undefined || pair.after === undefined ? (
        <Note>
          This address does not name two turns. A comparison is opened from the workbench, over a
          turn that has one before it.
        </Note>
      ) : (
        <Pair sessionId={sessionId} before={pair.before} after={pair.after} locale={locale} />
      )}
    </div>
  );
}

function Pair({
  sessionId,
  before,
  after,
  locale,
}: {
  sessionId: string;
  before: string;
  after: string;
  locale: string | undefined;
}): JSX.Element {
  const left = useTurn(sessionId, before);
  const right = useTurn(sessionId, after);

  /**
   * A 404 gets its own sentence because it is the failure this surface will
   * actually meet: an id typed by hand, or a turn removed since the link was
   * saved. The message says *this session* rather than *this turn does not
   * exist*, because the route is session-scoped and a turn of somebody else's
   * session answers 404 too — which is the anti-leak behaviour, not a bug to
   * explain away.
   */
  for (const side of [left, right]) {
    if (side.isError) {
      return (
        <p role="alert" className="text-sm text-danger-ink">
          {side.error instanceof ApiError && side.error.status === 404
            ? 'One of these turns is not in this session.'
            : side.error.message}
        </p>
      );
    }
  }
  if (left.data === undefined || right.data === undefined) {
    return <Note>Reading both turns…</Note>;
  }

  return <Comparison before={left.data.turn} after={right.data.turn} locale={locale} />;
}

function Comparison({
  before,
  after,
  locale,
}: {
  before: Turn;
  after: Turn;
  locale: string | undefined;
}): JSX.Element {
  /**
   * Calls pair **by ordinal, with both step ids named** — and the naming is
   * what makes the ordinal honest. A turn may make several calls and two
   * turns need not have made the same ones; nothing in the record aligns
   * them, and inventing an alignment by step id would silently drop a call
   * whose step was renamed. So: pair by position, print both step ids, and
   * say plainly when they differ rather than letting the pairing be the news
   * nobody notices.
   */
  const beforeCalls = before.request?.calls ?? [];
  const afterCalls = after.request?.calls ?? [];
  const count = Math.max(beforeCalls.length, afterCalls.length);

  return (
    <>
      <section aria-label="The pair" className="flex flex-col gap-2">
        <SectionTitle>The pair</SectionTitle>
        <TwoColumn>
          <Row label="Turn">
            <code className="break-all text-xs">{before.id}</code>
            <code className="break-all text-xs">{after.id}</code>
          </Row>
          <Row label="Taken">
            {formatTimestamp(before.createdAt, locale)}
            {formatTimestamp(after.createdAt, locale)}
          </Row>
          <Row label="Status">
            {before.status}
            {after.status}
          </Row>
          <Row label="Prompt tokens">
            {counted(before.cost?.promptTokens, locale)}
            {counted(after.cost?.promptTokens, locale)}
          </Row>
          <Row label="Completion tokens">
            {counted(before.cost?.completionTokens, locale)}
            {counted(after.cost?.completionTokens, locale)}
          </Row>
          <Row label="Wall time">
            {before.cost === undefined ? 'Not counted' : formatDuration(before.cost.wallMs, locale)}
            {after.cost === undefined ? 'Not counted' : formatDuration(after.cost.wallMs, locale)}
          </Row>
        </TwoColumn>
      </section>

      {count === 0 ? (
        // Absent or empty, and the sentence has to be true of both: a turn
        // with no `request` never assembled, a turn with `calls: []` assembled
        // and produced no call, and neither has anything to align. Worded as
        // *call* rather than *request* so it says the same thing `TurnSubject`
        // does on the same records.
        <Note>Neither of these turns assembled a call, so there is nothing to align.</Note>
      ) : null}

      {Array.from({ length: count }, (_, at) => (
        <CallPair
          key={at}
          ordinal={at + 1}
          count={count}
          before={beforeCalls[at]}
          after={afterCalls[at]}
          locale={locale}
        />
      ))}

      <section aria-label="What came out" className="flex flex-col gap-3">
        <SectionTitle>What came out</SectionTitle>
        <div className="grid gap-4 md:grid-cols-2">
          <Output label="Before" text={before.output?.text} />
          <Output label="After" text={after.output?.text} />
        </div>
      </section>
    </>
  );
}

function CallPair({
  ordinal,
  count,
  before,
  after,
  locale,
}: {
  ordinal: number;
  count: number;
  before: ModelCall | undefined;
  after: ModelCall | undefined;
  locale: string | undefined;
}): JSX.Element {
  const title = count > 1 ? `Call ${String(ordinal)}` : 'The call';

  if (before === undefined || after === undefined) {
    return (
      <section aria-label={title} className="flex flex-col gap-2">
        <SectionTitle>{title}</SectionTitle>
        <Note>
          {before === undefined
            ? 'Only the turn on the right made this call, so there is nothing to align it against.'
            : 'Only the turn on the left made this call, so there is nothing to align it against.'}
        </Note>
      </section>
    );
  }

  // Computed after the guard above, not beside `title`: `assemblyOf` reads
  // the call, and a call that only one side made is not there to be read.
  const beforeAssembly = assemblyOf(before);
  const afterAssembly = assemblyOf(after);

  return (
    <section aria-label={title} className="flex flex-col gap-3">
      <SectionTitle>{title}</SectionTitle>

      {before.stepId === after.stepId ? null : (
        <Note>
          {`These are two different steps — ${before.stepId} before, ${after.stepId} after — paired by their position in the turn.`}
        </Note>
      )}

      {/* Both sides need blocks and a verdict to be alignable, and a call
          recorded before [P3.0] has neither — so a comparison reaching back
          across that repair says which side it cannot read rather than
          aligning a table against nothing. */}
      {beforeAssembly === null || afterAssembly === null ? (
        <Note>
          {beforeAssembly === null && afterAssembly === null
            ? 'Neither of these calls kept what went into its prompt — both were recorded before the turn carried its blocks, so there is nothing to align.'
            : beforeAssembly === null
              ? 'The earlier call was recorded before the turn kept what went into its prompt, so there is nothing to align the later one against.'
              : 'The later call was recorded before the turn kept what went into its prompt, so there is nothing to align the earlier one against.'}
        </Note>
      ) : (
        <AlignedBlockTable before={beforeAssembly} after={afterAssembly} locale={locale} />
      )}

      <SubsectionTitle>What was asked</SubsectionTitle>
      <TwoColumn>
        <Row label="Step">
          <code className="text-xs">{before.stepId}</code>
          <code className="text-xs">{after.stepId}</code>
        </Row>
        <Row label="Model">
          <code className="break-all text-xs">{before.resolved.modelId}</code>
          <code className="break-all text-xs">{after.resolved.modelId}</code>
        </Row>
        <Row label="Parameters">
          <code className="break-all text-xs">{JSON.stringify(before.params)}</code>
          <code className="break-all text-xs">{JSON.stringify(after.params)}</code>
        </Row>
        {/* Window, reserved and spent together, because the walk found the
            first two are needed to explain the third: the meter's denominator
            is window *minus* reserved, so a page showing only the window
            reads as disagreeing with the meter by exactly the reservation. */}
        <Row label="Window">
          {budgeted(before, (verdict) => formatCount(verdict.limit.tokens, locale))}
          {budgeted(after, (verdict) => formatCount(verdict.limit.tokens, locale))}
        </Row>
        <Row label="Reserved for the answer">
          {budgeted(before, (verdict) => formatCount(verdict.reserved, locale))}
          {budgeted(after, (verdict) => formatCount(verdict.reserved, locale))}
        </Row>
        <Row label="Spent">
          {budgeted(before, (verdict) => formatCount(verdict.spent, locale))}
          {budgeted(after, (verdict) => formatCount(verdict.spent, locale))}
        </Row>
        <Row label="Outcome">
          {OUTCOME_LABELS[before.outcome]}
          {OUTCOME_LABELS[after.outcome]}
        </Row>
      </TwoColumn>
    </section>
  );
}

/**
 * The two-value table this page is made of.
 *
 * Not `MetadataRow` and not a `<dl>`: a description list pairs one term with
 * one description, and every fact here has two. Forcing it would mean either
 * two lists the reader has to align by eye — the thing this page exists to
 * stop — or a `dd` holding both values, which is a table row spelled as prose.
 */
function TwoColumn({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div className="overflow-x-auto">
      <table className={table.root}>
        <thead>
          <tr className={table.head}>
            <th scope="col" className={table.thCompact}>
              <span className="sr-only">Fact</span>
            </th>
            <th scope="col" className={table.thCompact}>
              Before
            </th>
            <th scope="col" className={table.thCompact}>
              After
            </th>
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: [ReactNode, ReactNode];
}): JSX.Element {
  return (
    <tr className={table.row}>
      <th scope="row" className={table.thCompact}>
        {label}
      </th>
      <td className={table.cellCompact}>{children[0]}</td>
      <td className={table.cellCompact}>{children[1]}</td>
    </tr>
  );
}

function Output({ label, text }: { label: string; text: string | undefined }): JSX.Element {
  return (
    <div className="flex flex-col gap-1">
      <SubsectionTitle as="h3">{label}</SubsectionTitle>
      {text === undefined ? (
        // A turn that produced no prose is a different claim from one that
        // produced an empty string, and only one of them is worth a sentence.
        <Note>This turn produced no output.</Note>
      ) : (
        <p className="whitespace-pre-wrap text-story text-ink">{text}</p>
      )}
    </div>
  );
}

/** `null` is *nobody counted*; the turn cost view draws the same distinction. */
function counted(count: number | null | undefined, locale: string | undefined): string {
  return count === null || count === undefined ? 'Not counted' : formatCount(count, locale);
}

/**
 * The alignable half of a call, or `null` when the record predates it.
 *
 * `blocks` and `budget` arrived together at [P3.0] and are absent together on
 * a P2-era record; pairing them here means the table's two inputs are proven
 * present at one site rather than at four, and `CallView` draws the same line
 * for the same reason.
 */
function assemblyOf(call: ModelCall): { blocks: AssembledBlock[]; budget: BudgetVerdict } | null {
  const { blocks, budget } = call;
  return blocks === undefined || budget === undefined ? null : { blocks, budget };
}

/** A figure from a verdict, or the honest word when no verdict was kept. */
function budgeted(call: ModelCall, read: (verdict: BudgetVerdict) => string): string {
  return call.budget === undefined ? 'Not recorded' : read(call.budget);
}
