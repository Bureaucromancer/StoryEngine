// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { BlockSource } from '@storyengine/shared';

/**
 * A block's source as the panel presents it — a label always, a library
 * address when the source names an object that has a page.
 *
 * Gate step 4 has two halves and this helper is both: *"no `unknown` sources
 * on an ordinary turn"* is the label map being total (its own test constructs
 * every arm), and *"clickable through to the object it came from"* is the
 * link — which, per the decision recorded at planning, **navigates the main
 * view** rather than re-subjecting the panel: [05 §2]'s stateless-reader rule
 * holds, and [P3 §7.1]'s tension stays open where it is written.
 *
 * What links and what does not, stated rather than discovered:
 * - **actor** and a persona with an id → the actor's library page.
 * - **lore** names an entry *inside* a book — no route addresses an entry, so
 *   a label until one does.
 * - **history** names a turn, not a library object; its address arrives with
 *   the compare view (P3.6).
 * - **attempt** names a turn too — the sibling a guided redo showed the model
 *   ([03 §5.1]) — and gets its address with history's, for the same reason.
 * - **samples** names a sample inside whichever object carried it. The actor
 *   carrier links, for the reason `actor` does — it is a library object with a
 *   page. Treatment and Lorebook get a label until those pages exist.
 * - **preset** names a block in the session's *copied* pack. The copy keeps the
 *   id it was copied from, so an **imported** preset links back to the file it
 *   came out of — which is what P4.4's demo turns on. A pack copied from a mode
 *   default, and every record written before P4.4, carries no id, and those get
 *   a label like anything else.
 * - **input / guidance / step / channel / treatment / goal** — no library
 *   object behind them at this phase.
 */
export interface SourceAddress {
  label: string;
  link?: { kind: 'actors' | 'presets'; id: string };
}

/**
 * Keyed by value, never reverse (`library/labels.tsx`'s rule) — and typed
 * open, because a record written by a newer build can carry a source kind
 * this build has never heard of, and the honest label for that is the word
 * itself rather than a crash or a blank.
 */
const SOURCE_LABELS: Record<string, string> = {
  persona: 'Persona',
  actor: 'Actor',
  lore: 'Lore',
  history: 'History',
  samples: 'Writing sample',
  channel: 'Channel',
  treatment: 'Treatment',
  /**
   * The retired spelling of the arm above, kept rather than replaced. The slot
   * literal became `treatment` at P4.0 ([P4 §1.7]) because the docs had spelled
   * it that way since [10 §6]'s rename and the code never followed — but a turn
   * record is free-to-move tier, and every record committed before that day
   * carries `kind: 'setting'` forever. The open map is exactly the mechanism
   * that lets an old record keep rendering, so this entry is that rule being
   * used rather than an exception to it, and it costs one line.
   */
  setting: 'Setting',
  goal: 'Goal',
  guidance: 'Guidance',
  attempt: 'Previous attempt',
  input: 'Action',
  preset: 'Preset',
  step: 'Step',
};

export function blockSourceAddress(source: BlockSource): SourceAddress {
  const label = SOURCE_LABELS[source.kind] ?? source.kind;

  if (source.kind === 'actor') {
    return { label, link: { kind: 'actors', id: source.actorId } };
  }

  if (source.kind === 'preset' && typeof source.presetId === 'string') {
    return { label, link: { kind: 'presets', id: source.presetId } };
  }
  if (source.kind === 'persona' && source.actorId !== null) {
    return { label, link: { kind: 'actors', id: source.actorId } };
  }
  // A sample the cast carried is prose on somebody's card, so the block table
  // can click through to it — the same claim the `actor` arm makes. The other
  // two carriers have no editor page to reach yet.
  if (source.kind === 'samples' && source.owner.kind === 'actor') {
    return { label, link: { kind: 'actors', id: source.owner.id } };
  }
  return { label };
}
