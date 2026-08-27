// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ACTOR_ID, cancelledTurn, divergenceTurn, richTurn } from '../turn-fixtures.js';

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
