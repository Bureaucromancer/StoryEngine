// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { Button } from './Button.js';
import { enter, press } from './classes.js';
import { Dialog } from './Dialog.js';
import { Popover } from './Popover.js';

/**
 * ***Two of the five motions, on the components that own them*** (2026-10-13,
 * [P12A](../../../../docs/design/workplan/35-p12a-the-look.md) P12A.6) — a
 * press acknowledged, and a panel entering. Each is a recipe in `classes.ts`,
 * which `theme.test.ts` holds to the tokens; what is held here is that the
 * component every call site goes through spends it, so no call site has to
 * remember to. jsdom runs no transition, so this reads classes; whether the
 * motion looks right, and whether it is absent under reduced motion, is T5's.
 */

const has = (element: Element, recipe: string): boolean => {
  const classes = (element.getAttribute('class') ?? '').split(/\s+/);
  return recipe.split(' ').every((token) => classes.includes(token));
};

describe('a press acknowledged', () => {
  /**
   * Every variant, because the decision was *every button and not Send
   * alone* — `press`'s docstring says why. Mutation: the recipe dropped from
   * `Button`, or spent by one variant's string only.
   */
  it('is spent by every button, whatever it looks like', () => {
    const variants = ['primary', 'secondary', 'danger', 'dangerOutline', 'quiet'] as const;
    render(
      <div>
        {variants.map((variant) => (
          <Button key={variant} type="button" variant={variant}>
            {variant}
          </Button>
        ))}
      </div>,
    );
    for (const variant of variants) {
      expect(has(screen.getByRole('button', { name: variant }), press), variant).toBe(true);
    }
  });

  /**
   * A disabled Send that went down under a press would acknowledge a press
   * that does nothing. Mutation: `active:` without `enabled:` before it.
   */
  it('does not go down when the button cannot be pressed', () => {
    const pressed = press.split(' ').filter((token) => token.includes('active:'));
    expect(pressed.length).toBeGreaterThan(0);
    expect(pressed.filter((token) => !token.startsWith('enabled:'))).toEqual([]);
  });
});

describe('a panel entering', () => {
  /**
   * On the scrim, which holds the card, so the two fade as one — and not on
   * the card as well, which would fade it twice over, the card's opacity
   * multiplied by the scrim's. Mutations: the recipe dropped, moved onto the
   * card alone, and spent by both.
   */
  it('fades a dialog in with its scrim, as one', () => {
    render(
      <Dialog role="dialog" labelledBy="title" onDismiss={() => undefined}>
        <h2 id="title">Leave the session?</h2>
        <button type="button">Stay</button>
      </Dialog>,
    );
    const scrim = screen.getByRole('dialog', { name: 'Leave the session?' });
    expect(has(scrim, enter)).toBe(true);
    const card = scrim.firstElementChild;
    expect(card).not.toBeNull();
    expect(card !== null && has(card, enter)).toBe(false);
  });

  /**
   * Both places a popover opens — beside its trigger, drawn while open, and
   * under its box, hidden rather than unmade, which `@starting-style` fades
   * on every opening all the same. Mutation: either arm without the recipe.
   */
  it('fades a popover in, beside its trigger and under its box', async () => {
    render(
      <div>
        <Popover trigger="Vera" triggerClassName="" label="Who Vera is">
          <a href="#vera">Open Vera</a>
        </Popover>
        <Popover trigger="Time" triggerClassName="" label="The time" place="under">
          <a href="#time">Set the time</a>
        </Popover>
      </div>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Vera' }));
    expect(has(screen.getByRole('dialog', { name: 'Who Vera is' }), enter)).toBe(true);

    await userEvent.click(screen.getByRole('button', { name: 'Time' }));
    expect(has(screen.getByRole('dialog', { name: 'The time' }), enter)).toBe(true);
  });
});
