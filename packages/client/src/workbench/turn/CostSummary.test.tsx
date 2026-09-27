// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { TurnCost } from '@storyengine/shared';

import { CostSummary } from './CostSummary.js';

/**
 * ***Unpriced is not free*** — `TurnCost.money`, added 2026-09-27.
 *
 * The panel already said *not counted* rather than zero for tokens; money is the
 * same claim with more riding on it, because a person who reads `$0.00` beside a
 * turn believes it cost nothing. Every turn today is unpriced, and every turn
 * written before the field existed has none at all — both must read as such.
 */

const COUNTED: TurnCost = {
  promptTokens: 1200,
  completionTokens: 300,
  wallMs: 2_400,
  model: 'fake-hi',
};

function moneyRow(): string {
  const label = screen.getByText('Money');
  return label.nextElementSibling?.textContent ?? '';
}

describe('what a turn cost in money', () => {
  it('says not priced for a turn written before the field existed', () => {
    render(<CostSummary cost={COUNTED} locale="en-US" />);
    expect(moneyRow()).toBe('Not priced');
  });

  it('says not priced, not zero, when nothing priced the calls', () => {
    render(<CostSummary cost={{ ...COUNTED, money: null }} locale="en-US" />);
    expect(moneyRow()).toBe('Not priced');
  });

  it('shows what the provider priced, to a fraction of a cent', () => {
    render(
      <CostSummary
        cost={{ ...COUNTED, money: { amount: 0.0034, currency: 'USD' } }}
        locale="en-US"
      />,
    );
    expect(moneyRow()).toBe('$0.0034');
  });
});
