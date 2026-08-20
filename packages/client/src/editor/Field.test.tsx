// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CheckboxField, Field, NumberField, SelectField } from './Field.js';

/**
 * The field primitives, and the thing they were all supposed to be doing.
 *
 * [05 §15.2](../../../../docs/design/05-ui-surfaces.md) asks for the consequence beside the
 * control, and P2A.6 wrote those sentences into `hint` on every one of these.
 * **Only `CheckboxField` announced them.** `Notes` gave an id to its error and
 * not to its hint, and `Field`/`NumberField` pointed `aria-describedby` at the
 * error id or at nothing — so on a text or a select field the sentence
 * explaining what the control does was present for a sighted reader and
 * silently skipped for everyone else.
 *
 * Found by surveying for [P2B](../../../../docs/design/workplan/14-p2b-provider-configuration.md),
 * whose most consequential strings are hints — *empty means OpenAI's own
 * endpoint*, *a key is set, leave blank to keep it* — and worth fixing before
 * three more depend on it.
 *
 * Asserted through `{ description }`, which Testing Library resolves the way a
 * screen reader does: it follows `aria-describedby`. A hint that is merely
 * *nearby in the DOM* fails it, which is exactly the state these were in.
 */

const HINT = 'Empty means the provider default.';

describe('a hint', () => {
  it('is announced with a text field', () => {
    render(<Field label="Base URL" value="" onChange={vi.fn()} hint={HINT} />);

    expect(screen.getByRole('textbox', { name: 'Base URL', description: HINT })).toBeDefined();
  });

  it('is announced with a number field', () => {
    render(<NumberField label="Context tokens" value="8192" onChange={vi.fn()} hint={HINT} />);

    expect(
      screen.getByRole('spinbutton', { name: 'Context tokens', description: HINT }),
    ).toBeDefined();
  });

  it('is announced with a select', () => {
    render(
      <SelectField
        label="Provider"
        value="openai-compatible"
        options={[['openai-compatible', 'OpenAI-compatible']]}
        onChange={vi.fn()}
        hint={HINT}
      />,
    );

    expect(screen.getByRole('combobox', { name: 'Provider', description: HINT })).toBeDefined();
  });

  it('is announced with a checkbox, which is the one that always was', () => {
    render(<CheckboxField label="Trust proxy" checked onChange={vi.fn()} hint={HINT} />);

    expect(screen.getByRole('checkbox', { name: 'Trust proxy', description: HINT })).toBeDefined();
  });
});

/**
 * **The read-only reason is a hint too**, and is the one a person most needs
 * announced: a control they cannot edit, with the explanation attached to it
 * rather than floating beneath it.
 */
describe('a read-only note', () => {
  it('is announced, and the control is read-only rather than disabled', () => {
    render(
      <Field
        label="dataDir"
        value="./data"
        onChange={vi.fn()}
        readOnlyNote="Set with --data when you start the server."
      />,
    );

    const control = screen.getByRole('textbox', {
      name: 'dataDir',
      description: 'Set with --data when you start the server.',
    });
    // Read-only rather than disabled: a disabled input is skipped by tab order,
    // so somebody reading the form with a keyboard would never reach the field
    // whose whole purpose here is to tell them something.
    expect(control.hasAttribute('readonly')).toBe(true);
    expect(control.hasAttribute('disabled')).toBe(false);
  });
});

describe('an error', () => {
  it('replaces the hint rather than joining it', () => {
    render(<Field label="Port" value="x" onChange={vi.fn()} hint={HINT} error="Not a number." />);

    // One description, not two: a control announcing both the advice and the
    // complaint buries the complaint.
    expect(
      screen.getByRole('textbox', { name: 'Port', description: 'Not a number.' }),
    ).toBeDefined();
    expect(screen.queryByText(HINT)).toBeNull();
  });
});

/**
 * `SelectField` passed its **own control id** to the notes element, so a select
 * with a hint rendered two nodes claiming one id. It never surfaced because
 * nothing asserted on the hint at all — the same gap in both directions.
 */
describe('ids', () => {
  it('are unique across a select and its hint', () => {
    render(
      <SelectField
        label="Provider"
        value="openai-compatible"
        options={[['openai-compatible', 'OpenAI-compatible']]}
        onChange={vi.fn()}
        hint={HINT}
      />,
    );

    const ids = [...document.querySelectorAll('[id]')].map((node) => node.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
