// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CheckboxField, Field, NumberField, SelectField } from './Field.js';

/**
 * The field primitives, and the thing they were all supposed to be doing.
 *
 * [10 §15.2](../../../../docs/design/10-ui-surfaces.md) asks for the consequence beside the
 * control, and P2A.6 wrote those sentences into `hint` on every one of these.
 * **Only `CheckboxField` announced them.** `Notes` gave an id to its error and
 * not to its hint, and `Field`/`NumberField` pointed `aria-describedby` at the
 * error id or at nothing — so on a text or a select field the sentence
 * explaining what the control does was present for a sighted reader and
 * silently skipped for everyone else.
 *
 * Found by surveying for [P2B](../../../../docs/design/workplan/10-p2b-provider-configuration.md),
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

  /**
   * ***And so is a multiline one*** (2026-09-27). The `<textarea>` branch
   * ignored the note, which stayed latent while no read-only field was ever
   * multiline — until every generic text field became one.
   */
  it('makes a multiline control read-only too', () => {
    render(
      <Field
        label="notes"
        value="Kept on the server."
        onChange={vi.fn()}
        multiline
        readOnlyNote="Not written from here."
      />,
    );

    expect(screen.getByRole('textbox', { name: 'notes' }).hasAttribute('readonly')).toBe(true);
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

/**
 * Required-ness, marked twice for two readers — [10 §11.1a].
 *
 * The pair is the point, and each half fails differently if it goes missing: a
 * glyph alone is invisible to a screen reader, and `aria-required` alone is
 * invisible to everyone else. The third assertion is the one that is easy to
 * get wrong on the way to the first two — a glyph left readable makes every
 * required field announce its own name with *asterisk* on the end.
 */
describe('a required field', () => {
  it('announces itself required', () => {
    render(<Field label="Name" value="" onChange={vi.fn()} required />);

    expect(screen.getByRole('textbox', { name: 'Name' }).getAttribute('aria-required')).toBe(
      'true',
    );
  });

  it('carries a visible mark', () => {
    render(<Field label="Name" value="" onChange={vi.fn()} required />);

    expect(screen.getByText('*')).toBeDefined();
  });

  it('keeps the mark out of the accessible name', () => {
    render(<Field label="Name" value="" onChange={vi.fn()} required />);

    // `getByRole` resolves the name the way a screen reader does, so a mark
    // that is not `aria-hidden` shows up here as "Name *".
    expect(screen.getByRole('textbox', { name: 'Name' })).toBeDefined();
  });

  it('says nothing at all when the field is optional', () => {
    render(<Field label="Pronouns" value="" onChange={vi.fn()} />);

    expect(screen.getByRole('textbox', { name: 'Pronouns' }).hasAttribute('aria-required')).toBe(
      false,
    );
    expect(screen.queryByText('*')).toBeNull();
  });

  it('reaches the multiline control, which is a different element', () => {
    render(<Field label="Content" value="" onChange={vi.fn()} required multiline />);

    expect(screen.getByRole('textbox', { name: 'Content' }).getAttribute('aria-required')).toBe(
      'true',
    );
  });

  it('reaches a number field, which shares the shape and had to share the prop', () => {
    render(<NumberField label="Budget" value="" onChange={vi.fn()} required />);

    expect(screen.getByRole('spinbutton', { name: 'Budget' }).getAttribute('aria-required')).toBe(
      'true',
    );
  });
});
