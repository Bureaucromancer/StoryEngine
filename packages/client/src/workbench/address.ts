// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { BlockSource } from '@storyengine/shared';
import { labels } from '../i18n/catalogue.js';

/**
 * A block's source as the panel presents it — a label always, a library
 * address when the source names an object that has a page.
 *
 * Gate step 4 has two halves and this helper is both: *"no `unknown` sources
 * on an ordinary turn"* is the label map being total (its own test constructs
 * every arm), and *"clickable through to the object it came from"* is the
 * link — which, per the decision recorded at planning, **navigates the main
 * view** rather than re-subjecting the panel: [10 §2]'s stateless-reader rule
 * holds, and [P3 §7.1]'s tension stays open where it is written.
 *
 * What links and what does not, stated rather than discovered:
 * - **actor** and a persona with an id → the actor's library page.
 * - **lore** names an entry *inside* a book — no route addresses an entry, so
 *   a label until one does.
 * - **history** names a turn, not a library object; its address arrives with
 *   the compare view (P3.6).
 * - **attempt** names a turn too — the sibling a guided redo showed the model
 *   ([06 §5.1]) — and gets its address with history's, for the same reason.
 * - **samples** names a sample inside whichever object carried it. The actor
 *   carrier links, for the reason `actor` does — it is a library object with a
 *   page. ~~Treatment and Lorebook get a label until those pages exist.~~
 *   ***All three carriers link since [P7B.5]*** (2026-09-14): the pages exist —
 *   lorebooks since P5.1 and treatments since
 *   [P7B.3](../../../../docs/design/workplan/24-p7b-presets-and-prompts.md) —
 *   and the condition this sentence was written under is the one the
 *   route-caller sweep went looking for. A sample is prose somebody wrote in an
 *   object they own, and the panel's whole claim is that a reader can get from
 *   a block to the thing that produced it.
 * - **preset** names a block in the session's *copied* pack. The copy keeps the
 *   id it was copied from, so an **imported** preset links back to the file it
 *   came out of — which is what P4.4's demo turns on. A pack copied from a mode
 *   default, and every record written before P4.4, carries no id, and those get
 *   a label like anything else.
 * - **round** names a reply this turn already gave ([P14.2]), and links to the
 *   member who gave it; a narrator's line has nobody to link to.
 * - **story-so-far** names the Setup the session was started from
 *   ([P15.2](../../../../docs/design/workplan/33-p15-setup-from-a-turn.md)),
 *   and links to it — linked at the P15 merge (2026-10-03), which is what
 *   the arm's `setupId` was carried for: the shared type calls it *"for the
 *   click-through `presetId` gives a preset block"*, and a reader asking where
 *   a paragraph of the window came from should land on the object they can
 *   edit it in. The session holds a copy, so the link can dangle — a Setup
 *   deleted since — and that is the preset's reading too.
 * - **input / guidance / step / channel / treatment / goal** — no library
 *   object behind them at this phase.
 */
export interface SourceAddress {
  label: string;
  link?: { kind: 'actors' | 'presets' | 'treatments' | 'lorebooks' | 'setups'; id: string };
}

/**
 * Keyed by value, never reverse (`library/labels.tsx`'s rule) — and ~~typed
 * open~~ *read* open, because a record written by a newer build can carry a
 * source kind this build has never heard of, and the honest label for that is
 * the word itself rather than a crash or a blank.
 *
 * ***Typed closed over every kind this build writes*** (2026-09-30), so a new
 * arm of `BlockSource` without a label is a compile error rather than a bare
 * word in the Source column. Typed open, three had gone out that way — `state`
 * ([P14.5a]), `difficulty` ([P7.8]) and `continue` ([P14.4]) — with the test
 * that exists to catch it green over them, because its fixture was listed by
 * hand. {@link blockSourceAddress} reads it through an open view, for the
 * newer build's sake.
 */
const SOURCE_LABELS: Readonly<Record<BlockSource['kind'] | 'setting', string>> = labels(
  'workbench.source',
  {
    persona: 'Persona',
    actor: 'Actor',
    lore: 'Lore',
    history: 'History',
    /**
     * ***A link of the rolling summary*** — [08 §5], [P8.1], labelled at [P9.5].
     *
     * **The arm shipped without a label and nothing caught it**, which is the
     * hole this line closes twice over. `address.test.ts`'s
     * `expect(address.label).not.toBe(source.kind)` exists to catch exactly this
     * — a block rendering in the Source column as the bare word `summary` — and
     * it never saw it, because the arm was missing from that test's `EVERY_ARM`
     * fixture as well. A fixture that enumerates the vocabulary by hand is only
     * as total as the hand, so both are edited together and the fixture is the
     * half that keeps this from happening to the next arm.
     *
     * *"Earlier turns"* rather than *"Summary"*, because what the reader is
     * looking at **is** the earlier turns — compressed, and standing in for them
     * in the window. `History` above is the uncompressed form of the same thing,
     * and the two labels read as the pair they are.
     */
    summary: 'Earlier turns',
    /**
     * ***What had happened before this session's first turn*** — the summary
     * chain's root, [P15.2], read off the Setup the session was started from.
     * Labelled at the merge (2026-10-03): the branch wrote the arm while this
     * map was typed open, and main's closing of it (2026-09-30) is what made
     * the gap a compile error rather than a bare `story-so-far` in the Source
     * column. *"Story so far"* because that is the Setup field's own name.
     */
    'story-so-far': 'Story so far',
    samples: 'Writing sample',
    channel: 'Channel',
    /**
     * ***Every tracker that is on, as one block*** — [P14.5a]'s state slot.
     * *Trackers*, the word the play surface uses for them (*Update trackers*).
     */
    state: 'Trackers',
    treatment: 'Treatment',
    /**
     * ***An answer the session was set up with*** (2026-09-30) — Freeform's
     * premise, and whatever a pack's `setup` slot names.
     */
    setup: 'Setup answer',
    /**
     * The retired spelling of the arm above, kept rather than replaced. The slot
     * literal became `treatment` at P4.0 ([P4 §1.7]) because the docs had spelled
     * it that way since [04 §6]'s rename and the code never followed — but a turn
     * record is free-to-move tier, and every record committed before that day
     * carries `kind: 'setting'` forever. The open map is exactly the mechanism
     * that lets an old record keep rendering, so this entry is that rule being
     * used rather than an exception to it, and it costs one line.
     */
    setting: 'Setting',
    goal: 'Goal',
    /** A fragment of a dial's level — difficulty or directedness, [P7.8]. */
    difficulty: 'Dial',
    guidance: 'Guidance',
    attempt: 'Previous attempt',
    input: 'Action',
    preset: 'Preset',
    step: 'Step',
    /**
     * The engine's own JSON instruction — [P7.4]. *Reply format* rather than
     * *Schema*, because what a reader is looking at is a sentence telling the
     * model how to answer, and the schema is the thing it quotes.
     *
     * The open map means an older build renders this as `schema` rather than
     * crashing, which is the rule the `setting` entry above is an instance of —
     * so this line buys the word rather than the survival.
     */
    schema: 'Reply format',
    /**
     * ***A reply this turn already gave*** — [P14.2]'s round: under `per-actor`
     * dispatch each speaker's call is shown the replies before it, and those are
     * not history yet, so they are a source of their own. *"Earlier this round"*
     * because that is what a reader looking at the third speaker's prompt is
     * looking at.
     */
    round: 'Earlier this round',
    /**
     * ***The session's author's note*** — [P14.3]: placed by the engine at its
     * own depth on every `every`-th input, never by a pack, so it is a source of
     * its own.
     */
    note: 'Author’s note',
    /** The line after a message being continued, asking the model to carry on — [P14.4]. */
    continue: 'Continue',
  },
);

export function blockSourceAddress(source: BlockSource): SourceAddress {
  const known: Readonly<Partial<Record<string, string>>> = SOURCE_LABELS;
  const label = known[source.kind] ?? source.kind;

  if (source.kind === 'actor') {
    return { label, link: { kind: 'actors', id: source.actorId } };
  }

  if (source.kind === 'preset' && typeof source.presetId === 'string') {
    return { label, link: { kind: 'presets', id: source.presetId } };
  }
  if (source.kind === 'persona' && source.actorId !== null) {
    return { label, link: { kind: 'actors', id: source.actorId } };
  }
  // Whose reply the next speaker was shown — the member it came from, when it
  // was a member's and not a narrator's line ([P14.2]).
  if (source.kind === 'round' && source.actorId !== null) {
    return { label, link: { kind: 'actors', id: source.actorId } };
  }
  // The Setup the story so far was copied from ([P15.2]) — `null` for a root
  // whose session carries no Setup id, which has nowhere to go.
  if (source.kind === 'story-so-far' && source.setupId !== null) {
    return { label, link: { kind: 'setups', id: source.setupId } };
  }
  // A sample is prose in an object somebody owns, so the block table can click
  // through to it — the same claim the `actor` arm makes. ~~The other two
  // carriers have no editor page to reach yet.~~ **All three have one now**
  // ([P7B.5]); the map is by carrier because the owner's `kind` is the turn
  // record's word for it and the library's folder name is a different word,
  // and a record written by a newer build may carry a third.
  if (source.kind === 'samples') {
    const kind = SAMPLE_OWNERS[source.owner.kind];
    if (kind !== undefined) return { label, link: { kind, id: source.owner.id } };
  }
  return { label };
}

/**
 * The library kind each `samples` carrier is, keyed by the record's own word.
 *
 * Open rather than exhaustive, for `SOURCE_LABELS`' reason one line up: a turn
 * record is free-to-move tier and a build that has never heard of a carrier
 * should render the label rather than crash. An unknown carrier gets no link,
 * which is what it got before any of them did.
 */
const SAMPLE_OWNERS: Record<string, 'actors' | 'treatments' | 'lorebooks' | undefined> = {
  actor: 'actors',
  treatment: 'treatments',
  lore: 'lorebooks',
};
