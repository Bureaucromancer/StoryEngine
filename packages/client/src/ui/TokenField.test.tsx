// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type JSX } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Dialog } from './Dialog.js';
import { TokenField, type TokenOption } from './TokenField.js';

/**
 * The combobox contract — [05](../../../../docs/design/05-tagging.md).
 *
 * Nearly every test here is a **key**, because the keyboard is the half of this
 * component that cannot be seen and therefore the half that rots without being
 * noticed. Two of them are behaviours the surface this imitates does not have:
 * Enter committing what you typed without arrowing onto it first, and Backspace
 * removing the last chip. They are the two things somebody tries once.
 *
 * The last describe is the collision worth its own test: `useFocusTrap` binds
 * Escape on `document`, so a popup that does not stop the event closes the
 * dialog it is standing in.
 */

const VOCABULARY = ['noir', 'city', 'napoleonic'];

function options(term: string, held: readonly string[]): TokenOption[] {
  const offerable = VOCABULARY.filter((name) => !held.includes(name));
  const hits = offerable.filter((name) => name.includes(term.toLowerCase()));
  const rows: TokenOption[] = hits.map((name) => ({ value: name, label: name }));
  if (term !== '' && !VOCABULARY.includes(term.toLowerCase())) {
    return [{ value: term, label: term, create: true }, ...rows];
  }
  return rows;
}

/** A controlled host, because the field is controlled and the test is about commits. */
function Host(props: { initial?: string[]; onChange?: (values: string[]) => void }): JSX.Element {
  const [values, setValues] = useState<string[]>(props.initial ?? []);
  return (
    <TokenField
      label="Tags"
      values={values}
      onChange={(next) => {
        setValues(next);
        props.onChange?.(next);
      }}
      optionsFor={(term) => options(term, values)}
      renderToken={(value) => <span>{value}</span>}
    />
  );
}

function box(): HTMLElement {
  return screen.getByRole('combobox', { name: 'Tags' });
}

function chips(): string[] {
  return [...document.querySelectorAll('li button')].map((node) =>
    (node.getAttribute('aria-label') ?? '').replace('Remove ', ''),
  );
}

describe('the popup', () => {
  it('opens on focus with nothing typed, so the field can be browsed', async () => {
    render(<Host />);

    expect(box().getAttribute('aria-expanded')).toBe('false');

    await userEvent.click(box());

    expect(box().getAttribute('aria-expanded')).toBe('true');
    expect(screen.getAllByRole('option').map((node) => node.textContent)).toEqual(VOCABULARY);
  });

  it('narrows as it is typed', async () => {
    render(<Host />);
    await userEvent.type(box(), 'no');

    // The typed term is offered first as the create option, then the matches.
    expect(screen.getAllByRole('option').map((node) => node.textContent)).toEqual(['no', 'noir']);
  });

  it('points aria-activedescendant at an option that exists', async () => {
    render(<Host />);
    await userEvent.click(box());
    await userEvent.keyboard('{ArrowDown}');

    const id = box().getAttribute('aria-activedescendant');
    expect(id).not.toBeNull();
    expect(document.getElementById(id ?? '')?.getAttribute('role')).toBe('option');
  });

  it('leaves the options unfocusable, so a dialog trap cannot land on them', async () => {
    render(<Host />);
    await userEvent.click(box());

    for (const option of screen.getAllByRole('option')) {
      expect(option.hasAttribute('tabindex')).toBe(false);
    }
    expect(document.activeElement).toBe(box());
  });
});

describe('committing', () => {
  /**
   * **The first improvement over the reference**, whose input does nothing at
   * all when you type a new tag and press Enter — you have to arrow onto the
   * option showing your own text first.
   */
  it('takes what you typed on Enter, with no arrowing at all', async () => {
    render(<Host />);
    await userEvent.type(box(), 'ronin{Enter}');

    expect(chips()).toEqual(['ronin']);
    expect(box()).toHaveProperty('value', '');
  });

  it('takes the arrowed-onto option instead, when one has been moved to', async () => {
    render(<Host />);
    await userEvent.type(box(), 'no');
    // The create option showing your own text is active from the first
    // keystroke, so one press down is the existing tag underneath it.
    await userEvent.keyboard('{ArrowDown}{Enter}');

    expect(chips()).toEqual(['noir']);
  });

  it('takes a comma as an end-of-tag, the way the reference does', async () => {
    render(<Host />);
    await userEvent.type(box(), 'ronin,');

    expect(chips()).toEqual(['ronin']);
  });

  it('commits a clicked option', async () => {
    render(<Host />);
    await userEvent.click(box());
    await userEvent.click(screen.getByRole('option', { name: 'city' }));

    expect(chips()).toEqual(['city']);
  });

  /**
   * Typing a tag and clicking Save is the flow people actually hit. Discarding
   * the term on blur is silent data loss in exactly that flow.
   */
  it('commits a term left in the box when focus leaves', async () => {
    render(<Host />);
    await userEvent.type(box(), 'ronin');
    await userEvent.tab();

    expect(chips()).toEqual(['ronin']);
  });

  it('refuses a duplicate rather than carrying it twice', async () => {
    render(<Host initial={['noir']} />);
    await userEvent.type(box(), 'noir{Enter}');

    expect(chips()).toEqual(['noir']);
  });

  it('never submits the form it is standing in', async () => {
    const submit = vi.fn();
    render(
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <Host />
      </form>,
    );

    await userEvent.type(box(), 'ronin{Enter}');

    // The editors put this field inside their save form; an Enter that reached
    // it would save the actor mid-tag.
    expect(submit).not.toHaveBeenCalled();
    expect(chips()).toEqual(['ronin']);
  });
});

describe('removing', () => {
  /**
   * **The second improvement.** The reference has no keydown handling on its
   * tag input at all, so a chip can only go by finding its small `×`.
   */
  it('drops the last chip on Backspace in an empty box', async () => {
    render(<Host initial={['noir', 'city']} />);
    await userEvent.click(box());
    await userEvent.keyboard('{Backspace}');

    expect(chips()).toEqual(['noir']);
  });

  it('leaves the chips alone while there is a term to delete instead', async () => {
    render(<Host initial={['noir']} />);
    await userEvent.type(box(), 'ab{Backspace}');

    expect(chips()).toEqual(['noir']);
    expect(box()).toHaveProperty('value', 'a');
  });

  it('labels each remove button with the tag it removes', async () => {
    render(<Host initial={['noir']} />);

    await userEvent.click(screen.getByRole('button', { name: 'Remove noir' }));

    expect(chips()).toEqual([]);
  });
});

describe('escape', () => {
  it('closes the popup and keeps what was typed', async () => {
    render(<Host />);
    await userEvent.type(box(), 'ron');
    expect(box().getAttribute('aria-expanded')).toBe('true');

    await userEvent.keyboard('{Escape}');

    expect(box().getAttribute('aria-expanded')).toBe('false');
    expect(box()).toHaveProperty('value', 'ron');
  });

  it('clears the term on a second press, once the popup is already closed', async () => {
    render(<Host />);
    await userEvent.type(box(), 'ron');
    await userEvent.keyboard('{Escape}{Escape}');

    expect(box()).toHaveProperty('value', '');
  });

  /**
   * The collision this component was written knowing about. `useFocusTrap`
   * listens on `document`, so without `stopPropagation` one press would close
   * the popup and the dialog together — which is the bug the reference surface
   * carries a purpose-built guard for on its own colour picker.
   */
  it('does not close the dialog the field is standing in', async () => {
    const dismiss = vi.fn();
    render(
      <Dialog role="dialog" labelledBy="heading" onDismiss={dismiss}>
        <h2 id="heading">Manage tags</h2>
        <Host />
      </Dialog>,
    );

    await userEvent.type(box(), 'ron');
    await userEvent.keyboard('{Escape}');

    expect(dismiss).not.toHaveBeenCalled();
    expect(box().getAttribute('aria-expanded')).toBe('false');
  });

  it('still lets the dialog close once the popup is out of the way', async () => {
    const dismiss = vi.fn();
    render(
      <Dialog role="dialog" labelledBy="heading" onDismiss={dismiss}>
        <h2 id="heading">Manage tags</h2>
        <Host />
      </Dialog>,
    );

    await userEvent.type(box(), 'ron');
    await userEvent.keyboard('{Escape}{Escape}{Escape}');

    expect(dismiss).toHaveBeenCalled();
  });
});

/**
 * ***Ids rather than words*** — [P16.2]'s scope pickers. A tag is whatever
 * somebody types; an id is not, so under `strict` the text only narrows and a
 * value is committed only by choosing an option — and `nameOf` is how a chip
 * whose value is a uuid is spoken.
 */
describe('a strict field, over ids', () => {
  const PEOPLE = [
    { value: 'id-mira', label: 'Mira' },
    { value: 'id-ossian', label: 'Ossian, the elder' },
  ];
  const NAMES = new Map(PEOPLE.map((one) => [one.value, one.label] as const));

  function StrictHost(props: { initial?: string[] }): JSX.Element {
    const [values, setValues] = useState<string[]>(props.initial ?? []);
    return (
      <TokenField
        label="Characters"
        values={values}
        onChange={setValues}
        strict
        nameOf={(value) => NAMES.get(value) ?? value}
        optionsFor={(term) =>
          PEOPLE.filter(
            (one) =>
              !values.includes(one.value) && one.label.toLowerCase().includes(term.toLowerCase()),
          )
        }
        renderToken={(value) => <span>{NAMES.get(value) ?? value}</span>}
      />
    );
  }

  function field(): HTMLElement {
    return screen.getByRole('combobox', { name: 'Characters' });
  }

  it('commits the option Enter is on, by its value', async () => {
    render(<StrictHost />);
    await userEvent.type(field(), 'mir{Enter}');

    expect(chips()).toEqual(['Mira']);
  });

  it('commits nothing for text no option matches, and says so', async () => {
    render(<StrictHost />);
    await userEvent.type(field(), 'Nobody{Enter}');

    expect(chips()).toEqual([]);
    expect(screen.getByText('Nothing matches Nobody.')).toBeTruthy();
  });

  /**
   * Escape closes the popup and keeps the term; Enter then reopens the options
   * the term matches rather than saying nothing matches, and a second Enter
   * commits the one it is on.
   */
  it('reopens the options on Enter after Escape, rather than saying nothing matches', async () => {
    render(<StrictHost />);
    await userEvent.type(field(), 'mir{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();

    await userEvent.keyboard('{Enter}');
    expect(screen.queryByText('Nothing matches mir.')).toBeNull();
    expect(screen.getByRole('option', { name: 'Mira' })).toBeTruthy();

    await userEvent.keyboard('{Enter}');
    expect(chips()).toEqual(['Mira']);
  });

  /** A name can hold a comma, so under `strict` it is a character and not an end-of-tag. */
  it('takes a comma as part of the search', async () => {
    render(<StrictHost />);
    await userEvent.type(field(), 'ossian,{Enter}');

    expect(chips()).toEqual(['Ossian, the elder']);
  });

  it('leaves a term in the box when focus leaves, rather than committing it', async () => {
    render(<StrictHost />);
    await userEvent.type(field(), 'Mira');
    await userEvent.tab();

    expect(chips()).toEqual([]);
    expect(field()).toHaveProperty('value', 'Mira');
  });

  it('names each remove button by the name, not the id', () => {
    render(<StrictHost initial={['id-mira', 'id-gone']} />);

    // An id with no name is spoken as itself — still removable, and still there.
    expect(chips()).toEqual(['Mira', 'id-gone']);
  });
});
