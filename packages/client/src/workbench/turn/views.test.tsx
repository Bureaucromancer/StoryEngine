// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { ChannelEffect } from '@storyengine/shared';

import {
  ACTOR_ID,
  cancelledTurn,
  divergenceTurn,
  legacyTurn,
  pendingPreview,
  richTurn,
  unmeasurablePreview,
} from '../turn-fixtures.js';

/**
 * The turn views over literal fixtures — the `HistoryPanel.test` style: no
 * providers, no transport, nothing between the assertion and the rendering.
 * The fixtures carry the shapes no real turn has produced yet (a dropped
 * block, a timeout, unknown cost, a superseded effect), which is exactly why
 * they are fixtures — and why they must never be promoted to the server's
 * cassette corpus.
 *
 * The router is mocked wholesale (the file's only mock): `BlockTable` links
 * a source to its library page, and the stub keeps `to`+`params` as an
 * `href` so the destination is assertable — the same trick `Shell.test.tsx`
 * uses, for the same reason.
 */

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    params,
  }: {
    children: React.ReactNode;
    to?: string;
    params?: Record<string, string>;
  }) => {
    let href = to ?? '#';
    for (const [key, value] of Object.entries(params ?? {})) {
      href = href.replace(`$${key}`, value);
    }
    return <a href={href}>{children}</a>;
  },
}));

const { TurnSubject } = await import('./TurnSubject.js');
const { PreviewSubject } = await import('./PreviewSubject.js');
const { EffectList } = await import('./EffectList.js');

describe('the block table', () => {
  it('keeps a dropped block as a faded row with the responsible rule', () => {
    render(<TurnSubject turn={richTurn()} locale={undefined} />);

    const rows = screen.getAllByRole('row');
    const dropped = rows.find((row) => row.textContent.includes('se.history.t-9.output'));
    expect(dropped).toBeDefined();
    // The rule, from the verdict's decisions — the falsifying mutation is
    // rendering every row as included.
    expect(dropped?.textContent).toContain('over budget — priority 20');
    expect(dropped?.className).toContain('text-ink-faint');
  });

  it('links an actor source through to the object it came from', () => {
    render(<TurnSubject turn={richTurn()} locale={undefined} />);

    // Gate step 4's clickable half; the mutation is dropping the link arm.
    const links = screen.getAllByRole('link', { name: 'Actor' });
    expect(links[0]?.getAttribute('href')).toBe(`/library/actors/${ACTOR_ID}`);
  });

  it('marks the advisory block as itself, from the record field', () => {
    render(<TurnSubject turn={richTurn()} locale={undefined} />);
    expect(screen.getAllByText('Advisory').length).toBeGreaterThan(0);
  });
});

describe('the budget verdict', () => {
  it('does not cry wolf with headroom to spare, and still names the next to fall', () => {
    render(<TurnSubject turn={richTurn()} locale={undefined} />);

    // 86 of 5,344 — gate step 5's roomy case, phrased as an idle fact.
    const notes = screen.getAllByText(/Nothing is close to falling out/);
    expect(notes.length).toBeGreaterThan(0);
    expect(notes[0]?.textContent).toContain('se.guidance');
    expect(screen.queryByText(/^About to fall out/)).toBeNull();
  });
});

describe('the call view', () => {
  it('shows the estimate beside the reported figure, without alarm', () => {
    render(<TurnSubject turn={richTurn()} locale={undefined} />);
    // Gate step 6, the first measurement: 86 estimated against 92 reported —
    // the delta is the chat template, and the sentence carries no warning.
    expect(screen.getByText('86 estimated, 92 reported')).toBeTruthy();
  });

  it('renders the timeout as itself, in the boundary’s own words', () => {
    render(<TurnSubject turn={richTurn()} locale={undefined} />);
    // Twice, legitimately: the call records the failure and the step that
    // made the call records it too.
    expect(
      screen.getAllByText('terminal: The endpoint sent nothing for 30000ms.').length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByText('Failed').length).toBeGreaterThan(0);
  });

  it('says a stopped call names the model that was asked', () => {
    render(<TurnSubject turn={cancelledTurn()} locale={undefined} />);
    expect(screen.getByText('Stopped')).toBeTruthy();
    expect(
      screen.getByText('The model named above is the one that was asked — nothing answered.'),
    ).toBeTruthy();
  });

  it('maps each rendered message back through its block ids', () => {
    render(<TurnSubject turn={richTurn()} locale={undefined} />);
    expect(screen.getByText(/from se\.instruction, se\.persona/)).toBeTruthy();
  });
});

describe('the not-filled slots', () => {
  it('answers why there is no lore in this prompt', () => {
    render(<TurnSubject turn={richTurn()} locale={undefined} />);

    const list = screen.getByText('Collected nothing').parentElement;
    expect(list?.textContent).toContain('se.lore');
    expect(list?.textContent).toContain('nothing produces this yet');
  });
});

describe('the effects', () => {
  /**
   * **Two entries, one channel** — [P5 §3] step 8, fixed at [P6B.1].
   *
   * `se.lore.timing` is scoped per entry, so a turn holding four sticky
   * entries writes the same channel id four times. The list printed the id
   * alone, which made the one surface carrying the numbers the one surface
   * that could not say whose numbers they were.
   *
   * Built here rather than in the shared fixture because the claim is about
   * two effects that differ in exactly one field, and a fixture that carried
   * them would be answering the question in advance.
   */
  it('tells two effects on one scoped channel apart', () => {
    const scoped = (id: string, entry: string): ChannelEffect => ({
      id,
      turnId: 't-10',
      channelId: 'se.lore.timing',
      scopeKey: entry,
      op: { type: 'set', path: '/' },
      before: { sticky: 3 },
      after: { sticky: 2 },
      proposedBy: { kind: 'engine' },
      applied: true,
      rejectedReason: null,
      supersedes: null,
      channelVersion: 1,
      // `scope` is session-versus-escaped and has nothing to do with the
      // channel's per-entry scoping, which `scopeKey` carries. Easy to
      // misread, and the compiler catches it.
      scope: 'session',
    });

    render(
      <EffectList effects={[scoped('fx-a', 'entry-ferryman'), scoped('fx-b', 'entry-rain')]} />,
    );

    const effects = screen.getByRole('region', { name: 'Effects' });
    expect(within(effects).getByText('se.lore.timing[entry-ferryman]')).toBeTruthy();
    expect(within(effects).getByText('se.lore.timing[entry-rain]')).toBeTruthy();
  });

  /** An unscoped channel still reads as the plain name it is. */
  it('leaves an unscoped channel alone', () => {
    render(<TurnSubject turn={richTurn()} locale={undefined} />);

    const effects = screen.getByRole('region', { name: 'Effects' });
    expect(within(effects).getAllByText('se.clock').length).toBe(2);
  });
  it('renders all three outcomes: applied, refused with its policy, superseded with its link', () => {
    render(<TurnSubject turn={richTurn()} locale={undefined} />);

    const effects = screen.getByRole('region', { name: 'Effects' });
    expect(within(effects).getByText('Rejected')).toBeTruthy();
    expect(within(effects).getByText('refused — the engine computes this channel')).toBeTruthy();
    // The record's own link, not an adjacency guess — the mutation is
    // ignoring `supersedes`.
    expect(within(effects).getByText('Replaced a refused proposal from this turn.')).toBeTruthy();
  });
});

describe('the steps', () => {
  it('shows skipped and failed as themselves', () => {
    render(<TurnSubject turn={richTurn()} locale={undefined} />);

    const steps = screen.getByRole('region', { name: 'Steps' });
    expect(within(steps).getByText('Skipped')).toBeTruthy();
    expect(within(steps).getByText('not its turn yet')).toBeTruthy();
    expect(within(steps).getByText(/terminal: The endpoint sent nothing/)).toBeTruthy();
  });
});

describe('the cost', () => {
  it('renders unknown as not-counted, never as zero', () => {
    render(<TurnSubject turn={cancelledTurn()} locale={undefined} />);

    const cost = screen.getByRole('region', { name: 'Cost' });
    // The TurnCost doctrine, on screen: the mutation is `?? 0`.
    expect(within(cost).getAllByText('Not counted')).toHaveLength(2);
    expect(within(cost).queryByText('0')).toBeNull();
    expect(within(cost).getByText('Nothing answered')).toBeTruthy();
  });
});

describe('a turn with no request', () => {
  it('says so, rather than rendering an empty table', () => {
    render(<TurnSubject turn={divergenceTurn()} locale={undefined} />);

    expect(
      screen.getByText('This turn made no request — nothing was assembled and nothing was sent.'),
    ).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });
});

describe('a turn that assembled no call at all', () => {
  /**
   * `request: { calls: [] }` is not `request: undefined` — the first says
   * assembly ran and produced no call (the prose role was unbound, so there
   * was nothing to ask), the second says assembly never ran. Both are real
   * records in this repo's data directory, and the panel used to render the
   * second's sentence and the first's silence.
   */
  it('says so rather than rendering nothing between the header and the effects', () => {
    const turn = { ...divergenceTurn(), request: { calls: [] } };
    render(<TurnSubject turn={turn} locale={undefined} />);

    expect(screen.getByText(/assembled no call/)).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('keeps that distinct from a turn that never assembled anything', () => {
    render(<TurnSubject turn={divergenceTurn()} locale={undefined} />);

    expect(screen.queryByText(/assembled no call/)).toBeNull();
    expect(screen.getByText(/made no request/)).toBeTruthy();
  });
});

describe('a cost recorded before null meant nobody answered', () => {
  it('reads an empty model as nothing answered, which is what P2 wrote', () => {
    // P2 wrote  where the contract now says . Rendering the
    // empty string put a labelled row on screen with nothing beside it.
    const turn = {
      ...richTurn(),
      cost: { promptTokens: 0, completionTokens: 0, wallMs: 0, model: '' },
    };
    render(<TurnSubject turn={turn} locale={undefined} />);

    expect(
      within(screen.getByRole('region', { name: 'Cost' })).getByText('Nothing answered'),
    ).toBeTruthy();
  });
});
describe('a turn recorded before P3.0 repaired the record', () => {
  /**
   * The panel is a reader over what is **on disk**, not over what this build
   * would write. `blocks`, `budget`, `notFilled` and `purpose` arrived at
   * [P3.0]; every turn taken before it lacks them, and those turns are still
   * in every install that ran P2 — two of the three sessions in this repo's
   * own data directory are exactly this shape. Reading one threw
   * `call.blocks.filter` and took the whole panel down with it.
   */
  it('renders the call it can read instead of throwing', () => {
    render(<TurnSubject turn={legacyTurn()} locale={undefined} />);

    // The facts a P2 record does carry are still shown.
    expect(screen.getAllByText('se.narrate').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/gemma-4-31B/).length).toBeGreaterThan(0);
  });

  it('says the block table is missing rather than rendering an empty one', () => {
    render(<TurnSubject turn={legacyTurn()} locale={undefined} />);

    // Absent, not empty — the same distinction the no-request case draws. An
    // empty table would claim this call assembled nothing, which is a fact
    // about the prompt; the truth is a fact about the build that wrote it.
    expect(screen.getByText(/predates the block table/)).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });
});
describe('two calls render as two sections', () => {
  it('keeps each call’s blocks its own — no derived union', () => {
    render(<TurnSubject turn={richTurn()} locale={undefined} />);

    expect(screen.getByRole('region', { name: 'Call 1: se.narrate' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Call 2: se.extract' })).toBeTruthy();
    // The guidance block is in the prose call and not the effects call —
    // per-call truth a union table would have to blur.
    const second = screen.getByRole('region', { name: 'Call 2: se.extract' });
    expect(within(second).queryByText('Advisory')).toBeNull();
  });
});

describe('the turn about to be taken', () => {
  it('renders the pending assembly through the same views a record uses', () => {
    render(<PreviewSubject preview={pendingPreview()} locale={undefined} />);

    // The block table and the verdict are unchanged components fed assembly
    // data directly — which is the evidence the panel is a reader rather than
    // a second assembler.
    expect(screen.getByText('se.instruction')).toBeTruthy();
    expect(screen.getByText('over budget — priority 20')).toBeTruthy();
    // An **included** row's rule, which comes only from the verdict: the
    // table falls back to `droppedBy` for drops, so a `rulesOf` that returned
    // nothing would still label every dropped row correctly and leave the
    // kept ones silently blank. This is the assertion that notices.
    expect(screen.getByText('included — priority 90')).toBeTruthy();
    expect(screen.getByText(/Nothing is close to falling out/)).toBeTruthy();
    expect(
      screen.getByText('What would be sent if this turn were taken now — nothing has been sent.'),
    ).toBeTruthy();
  });

  it('names the model that would be asked, and says the figures are estimates', () => {
    render(<PreviewSubject preview={pendingPreview()} locale={undefined} />);

    expect(screen.getByText('se.narrate')).toBeTruthy();
    expect(screen.getByText(/Token counts are estimated from the text/)).toBeTruthy();
    // No wall time, no usage, no rendered messages: this call has not
    // happened, which is a different claim from having reported nothing.
    expect(screen.queryByText('Wall time')).toBeNull();
  });

  it('keeps the not-filled answer when it cannot be budgeted at all', () => {
    render(<PreviewSubject preview={unmeasurablePreview()} locale={undefined} />);

    // The falsifying mutation is rendering `NotFilledList` only on the
    // assembled arm — which would take *why is there no lore in this prompt*
    // away from exactly the install most likely to be asking.
    expect(screen.getByText(/Nothing is bound to the prose role/)).toBeTruthy();
    expect(screen.getByText('Collected nothing')).toBeTruthy();
    expect(screen.getByText('se.lore')).toBeTruthy();
    // And no block table: a list of blocks nothing has ruled on would be a
    // second assembly shape for a state that already has an honest answer.
    expect(screen.queryByRole('table')).toBeNull();
  });
});
