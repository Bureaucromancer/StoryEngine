// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { useQuery } from '@tanstack/react-query';
import type { JSX } from 'react';

import { readUsedBy, type Usage } from '../api.js';
import { Fine } from '../ui/Text.js';

/**
 * ***What this object is used by*** —
 * [10 §5.2](../../../../docs/design/10-ui-surfaces.md),
 * [03 §10.1](../../../../docs/design/03-data-model.md),
 * [P11.7](../../../../docs/design/workplan/28-p11-implementation.md).
 *
 * **One component for two surfaces**, which is [P4 §6.6]'s *"whichever phase
 * builds that panel pays both"* kept where it actually costs something: the
 * panel on the object page and the sentence in the delete confirmation are the
 * same list rendered two ways, and two components would eventually count
 * differently.
 *
 * ***A count is information and not a gate*** — [03 §10.2]'s posture, and the
 * reason the delete confirmation says this rather than refusing. Delete is a
 * move to trash until the retention window closes, so a person removing an
 * actor twelve sessions use should be **told** and then allowed.
 *
 * *Nothing while it loads and nothing when there is nothing*, because this sits
 * beside a control somebody is about to press: a spinner in a confirmation
 * dialog is a reason to hesitate about the wrong thing.
 */
export function useUsedBy(kind: string, id: string): Usage[] | undefined {
  const query = useQuery({
    queryKey: ['used-by', kind, id],
    queryFn: () => readUsedBy(kind, id),
  });
  return query.data?.usedBy;
}

/** How many of each kind point here, as a sentence. */
export function usedByLine(usage: readonly Usage[]): string | null {
  if (usage.length === 0) return null;
  const counts = new Map<string, number>();
  for (const one of usage) counts.set(one.fromKind, (counts.get(one.fromKind) ?? 0) + 1);

  const parts = [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([kind, count]) => `${String(count)} ${nameFor(kind, count)}`);
  return `Referenced by ${list(parts)}.`;
}

/**
 * The plural of a kind, in this client's words.
 *
 * *A kind this build has no word for renders as its own id*, which is
 * `InputKind.tsx`'s rule and for its reason: a newer server may know a kind
 * this one does not, and hiding it would hide a reference.
 */
function nameFor(kind: string, count: number): string {
  const words: Record<string, [string, string]> = {
    session: ['session', 'sessions'],
    'se.actor.v1': ['actor', 'actors'],
    'se.lorebook.v1': ['lorebook', 'lorebooks'],
    'se.treatment.v1': ['treatment', 'treatments'],
    'se.preset.v1': ['preset', 'presets'],
    'se.setup.v1': ['setup', 'setups'],
    'se.package.v1': ['package', 'packages'],
  };
  const pair = words[kind];
  if (pair === undefined) return kind;
  return count === 1 ? pair[0] : pair[1];
}

/**
 * `a`, `a and b`, `a, b and c` — assembled here rather than in JSX.
 *
 * **A list is a sentence**, and the lint rule that forbids building one out of
 * JSX children is right about why: the conjunction, the commas and the order
 * all differ between languages, so a list joined in markup is a list no
 * catalogue can ever hold ([P11.8]).
 */
function list(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1] ?? ''}`;
}

/**
 * The panel on the object page — the names, not just the count.
 *
 * §5.2 asks for *Used by* on the object, and the names are what make it worth
 * having: *twelve sessions* tells somebody the object matters, and *The
 * harbour, Rain City…* tells them which story they would be changing.
 */
export function UsedByPanel(props: { kind: string; id: string }): JSX.Element | null {
  const usage = useUsedBy(props.kind, props.id);
  if (usage === undefined || usage.length === 0) return null;

  return (
    <section className="flex flex-col gap-1" aria-labelledby="used-by">
      <h3 id="used-by" className="text-sm font-medium text-ink-muted">
        Used by
      </h3>
      <Fine>{usedByLine(usage) ?? ''}</Fine>
      <ul className="flex flex-wrap gap-2 text-sm text-ink-muted">
        {usage.map((one) => (
          <li
            key={`${one.fromKind}:${one.fromId}`}
            className="rounded-control bg-surface-muted px-2 py-1"
          >
            {one.fromName}
          </li>
        ))}
      </ul>
    </section>
  );
}
