// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { JSX } from 'react';

import type { Rendition, RenditionReport } from '@storyengine/shared';

import { formatCount } from '../../format.js';
import { MetadataRow } from '../../ui/MetadataRow.js';
import { Fine, Note, SubsectionTitle } from '../../ui/Text.js';
import { labels } from '../../i18n/catalogue.js';

/**
 * What this turn asked to have made, and what it was made from —
 * [06 §10.7](../../../../../docs/design/06-modes-and-turn-pipeline.md),
 * [10 §3](../../../../../docs/design/10-ui-surfaces.md), [P9.5].
 *
 * ***This is the surface the recipe exists for.*** [06 §10.7] is emphatic that
 * *"the recipe is never discarded"* and [P9 §1.3] leans on that to decide a
 * standing question by **disclosure rather than by a setting**: an on-demand
 * picture of an old turn assembles from that turn's *recorded* state, which is
 * more correct and more surprising, and the mitigation is that a reader can see
 * exactly which state it used. A phase that kept the recipe and never showed it
 * would have paid the storage and taken none of the argument.
 *
 * ***Gate row 6 is the seed, and it is the row that would be missing.*** *"Two
 * renditions of one turn carry different seeds, and the workbench says so — **why
 * did this one come out different** is answerable without guessing."* A sampling
 * seed is the one field that makes two pictures of one recipe different, so a
 * panel that showed the prompt and not the seed would answer the question wrong
 * rather than not answer it.
 *
 * ***And what the capper dropped, which is the other row that must not be
 * missing.*** A prompt shown without its dropped fragments is a prompt that was
 * never sent: `providers/prompt-caps.ts` exists because *"the cap is an input to
 * generation, not a guillotine at send"*, and the evidence that it worked is the
 * list of what it took out. [06 §10.3] names the failure it prevents —
 * Aventuras' prompt *"routinely overruns the character limit its own system
 * prompt spends four lines insisting on, and nothing downstream checks"*.
 *
 * **A section per rendition rather than a table**, because the interesting thing
 * about two siblings is the *difference* between two recipes, and a table with
 * one column per picture would need a reconciliation rule the moment their
 * fragment lists differed — which is the argument `TurnSubject` already makes
 * for rendering blocks per call.
 */

export function RenditionList({
  renditions,
  report,
  locale,
}: {
  /** This turn's records, read by the panel — the page's rule, not a leaf query. */
  renditions: readonly Rendition[];
  /**
   * What the step reported, which is a **different claim** from what exists.
   *
   * [03 §8]'s doctrine, which this panel is built on: *this never happened* and
   * *this happened and was empty* are different, and a turn whose step ran and
   * asked for nothing is the second. The report is the only thing that can say
   * so — a backdrop resolved to one already made writes no new record at all,
   * and without this the panel would render that as *nothing happened here*.
   */
  report?: RenditionReport;
  locale: string | undefined;
}): JSX.Element | null {
  if (renditions.length === 0 && report === undefined) return null;

  return (
    <section aria-label="Pictures" className="flex flex-col gap-3">
      <SubsectionTitle as="h4">Pictures</SubsectionTitle>

      {report?.reused === undefined ? null : (
        <Note>
          {`Nothing was made: this place had already been drawn, and the backdrop was pointed at
            the picture that recipe produced before (${report.reused.digest.slice(0, 12)}…).`}
        </Note>
      )}
      {report?.held === undefined ? null : <Note>{HELD_WORDS[report.held] ?? report.held}</Note>}

      {renditions.map((one) => (
        <RenditionRow key={one.id} rendition={one} locale={locale} />
      ))}
    </section>
  );
}

/**
 * Why the step asked for nothing, in the reader's language.
 *
 * Open rather than exhaustive, for `SOURCE_LABELS`' reason: a record written by
 * a newer build can carry a reason this one has never heard of, and the honest
 * rendering of that is the word itself.
 */
const HELD_WORDS: Record<string, string> = labels('workbench.rendition.held', {
  'place-unchanged': 'Nothing was made: the place had not changed since the last backdrop.',
  'no-moment': 'Nothing was made: this turn held no moment worth a picture.',
  'no-binding': 'Nothing was made: no model is bound to the image role.',
  'no-place': 'Nothing was made: the story has not said where this is yet.',
});

function RenditionRow({
  rendition,
  locale,
}: {
  rendition: Rendition;
  locale: string | undefined;
}): JSX.Element {
  const { prompt, provenance } = rendition;
  const seedNoteText = seedNote(rendition);

  return (
    <div className="flex flex-col gap-2 rounded-control border border-line p-3">
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
        <MetadataRow label="What for">{`${PURPOSE_WORDS[rendition.purpose] ?? rendition.purpose} · ${STATE_WORDS[rendition.state] ?? rendition.state}`}</MetadataRow>
        {/**
         * ***Gate row 6.*** Two siblings of one turn differ by this number and
         * by nothing else the reader can see, so *why did this one come out
         * different* is answerable here or nowhere.
         *
         * **Null is *not recorded*, never zero** — `CostSummary`'s doctrine,
         * and zero is a perfectly ordinary seed, so rendering an absent one as
         * `0` would be a false claim rather than a blank.
         *
         * ***And a seed the endpoint was never sent says so beside the
         * number.*** Until 2026-10-03 no seed reached the wire at all while
         * this row went on showing one, which answered the gate's question
         * wrong in exactly the way the row exists to prevent. The number stays
         * — it is the recipe's, and what a re-creation replays once the
         * connection declares a seed — but it no longer stands alone as an
         * explanation it cannot give.
         */}
        <MetadataRow label="Seed">
          {provenance.seed === null ? (
            'Not recorded'
          ) : (
            <>
              <span>{formatCount(provenance.seed, locale)}</span>
              {seedNoteText === null ? null : <Fine>{seedNoteText}</Fine>}
            </>
          )}
        </MetadataRow>
        {/**
         * ***The model the recipe was keyed on, and the one that answered.***
         * They are two fields because they are two facts: `binding` is what the
         * digest hashes ([P9 §0.3]'s item 2) and is on the record **before** the
         * call, and `answeredAs` is what came back. A gateway that silently
         * served a different model is exactly the disagreement this pair makes
         * visible, and one merged field would hide it.
         */}
        <MetadataRow label="Asked">
          {provenance.binding === null ? (
            'Not recorded'
          ) : (
            <code className="break-all text-xs">{provenance.binding.modelId}</code>
          )}
        </MetadataRow>
        <MetadataRow label="Answered">
          {provenance.answeredAs === null ? (
            'Nothing answered yet'
          ) : (
            <code className="break-all text-xs">{provenance.answeredAs}</code>
          )}
        </MetadataRow>
        {/* The reuse key, short. It is what makes *this place, again* free, so
            a reader comparing two backdrops wants to see whether it matched —
            and the whole hash is forty-odd characters of nothing anybody
            reads. */}
        <MetadataRow label="Recipe">
          <code className="text-xs">{rendition.digest.slice(0, 16)}</code>
        </MetadataRow>
        {rendition.scope?.anchor === undefined ? null : (
          <MetadataRow label="Beside">
            <q className="text-ink-muted">{rendition.scope.anchor}</q>
          </MetadataRow>
        )}
        {rendition.error === null ? null : (
          <MetadataRow label="Why not">{rendition.error}</MetadataRow>
        )}
      </dl>

      {/**
       * ***The fragments as ranked, in the order the capper considered them.***
       * `kept` is the ids that survived, so this is the only place that shows
       * both what was offered and what went — which is what makes a capped
       * prompt legible rather than mysteriously short.
       */}
      <div className="flex flex-col gap-1">
        <Fine>
          {prompt.budget.usefulChars === null && prompt.budget.maxChars === null
            ? 'Fragments, highest rank first — this endpoint declares no cap'
            : `Fragments, highest rank first — ${String(prompt.text.length)} of ${String(prompt.budget.usefulChars ?? prompt.budget.maxChars ?? 0)} characters`}
        </Fine>
        <ul className="flex flex-col gap-0.5 text-sm text-ink-muted">
          {prompt.fragments.map((fragment) => {
            const dropped = prompt.dropped.find((one) => one.id === fragment.id);
            return (
              <li key={fragment.id} className="flex items-baseline gap-2">
                <code className="text-xs">{fragment.id}</code>
                {/* Struck rather than hidden, which is the whole point of the
                    row: a dropped fragment that simply vanished would leave a
                    prompt that reads as though it was never asked for. */}
                <span className={dropped === undefined ? '' : 'line-through'}>{fragment.text}</span>
                {dropped === undefined ? null : (
                  <Fine>{DROP_WORDS[dropped.reason] ?? dropped.reason}</Fine>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

/**
 * What the Seed row says beside the number, or nothing.
 *
 * ***Three answers, and only one of them is silence.*** `seedSent` is `true`
 * when the seed was sent, which needs no note — *sent* is the claim the number
 * already makes, and whether the endpoint honoured it no response says. `false`
 * is the default install: the endpoint drew its own seed, and the reader needs
 * to know this number will not bring the picture back. **Absent** on a picture
 * that was made is a record from before the field existed, and the honest
 * rendering of *nobody wrote this down* is saying so rather than implying
 * either answer. Pending and failed records have nothing to report yet.
 */
function seedNote(rendition: Rendition): string | null {
  const sent = rendition.provenance.seedSent;
  if (sent === false) return SEED_WORDS['not-sent'];
  if (sent === undefined && rendition.state === 'ready') return SEED_WORDS['not-recorded'];
  return null;
}

const SEED_WORDS = labels('workbench.rendition.seed', {
  'not-sent':
    'Not sent: this connection does not say its endpoint takes a seed, so re-creating the picture will not reproduce it.',
  'not-recorded': 'Not recorded whether this reached the endpoint.',
});

const PURPOSE_WORDS: Record<string, string> = labels('workbench.rendition.purpose', {
  illustration: 'An illustration',
  background: 'A backdrop',
});

const STATE_WORDS: Record<string, string> = labels('workbench.rendition.state', {
  pending: 'being made',
  ready: 'made',
  failed: 'did not come out',
});

const DROP_WORDS: Record<string, string> = labels('workbench.rendition.drop', {
  'over-hard-cap': 'dropped — over the endpoint’s limit',
  'over-useful-cap': 'dropped — past where this endpoint stops reading',
});
